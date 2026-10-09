import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { formatDateParis, instantParis } from '@savr/shared/src/temps/index.js';
import { statutCollecteAdmin } from '@/lib/statut-collecte-admin';
import { LIBELLE_STATUT_COLLECTE } from '@/lib/statut-collecte-labels';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;
type Ligne = Record<string, unknown>;

/**
 * Email à l'équipe Savr quand un traiteur modifie une collecte à venir
 * (CDC §06.02 n°19, §05 « Modification d'une collecte à venir » ; texte dicté
 * par Val le 2026-10-09).
 *
 * UN email par enregistrement, qui liste chaque champ modifié avec son ancienne
 * et sa nouvelle valeur. Le formulaire d'édition enregistre en deux requêtes :
 * l'événement (pax, contacts…) puis la collecte (date, heure…). L'email part de
 * la dernière des deux :
 *   · la route collecte, qui relit la modification d'événement du même
 *     enregistrement dans le journal d'audit (`derniereModificationEvenement`) ;
 *   · la route événement, quand l'enregistrement ne touche que l'événement.
 * Les valeurs viennent toujours de la base, jamais de la requête.
 *
 * Best-effort : une notification ne doit jamais faire échouer la modification.
 */
export const TEMPLATE_MODIFICATION_COLLECTE =
  'admin_modification_collecte_traiteur';
const ADRESSE_EQUIPE = 'contact@gosavr.io';

/** Ce qu'un enregistrement a changé, avec l'état d'avant. */
export interface ModificationCollecte {
  /** Ligne `collectes` avant l'écriture. */
  collecteAvant?: Ligne | null;
  majCollecte?: Ligne;
  /** Ligne `evenements` avant l'écriture. */
  evenementAvant?: Ligne | null;
  majEvenement?: Ligne;
}

const vide = (v: unknown): boolean => v == null || v === '';

// Une heure se compare à la minute : la base rend « 16:45:00 », l'écran envoie
// « 16:45:00 » ou « 16:45 ».
const comparable = (champ: string, v: unknown): string => {
  if (vide(v)) return '';
  return champ === 'heure_collecte' ? String(v).slice(0, 5) : String(v);
};

const change = (avant: Ligne, maj: Ligne, champ: string): boolean =>
  champ in maj &&
  comparable(champ, avant[champ]) !== comparable(champ, maj[champ]);

const texte = (v: unknown): string => (vide(v) ? 'non renseigné' : String(v));
const jour = (v: unknown): string =>
  texte(formatDateParis(v as string | null | undefined));
const heure = (v: unknown): string =>
  vide(v) ? 'non renseignée' : String(v).slice(0, 5).replace(':', 'h');
const ouiNon = (v: unknown): string => (v === true ? 'Oui' : 'Non');
const contact = (nom: unknown, telephone: unknown): string => {
  if (vide(nom)) return texte(telephone);
  return vide(telephone)
    ? String(nom)
    : `${String(nom)} (${String(telephone)})`;
};

/**
 * Une ligne par champ réellement modifié, en clair (« Date de collecte : du
 * 15/01/2027 au 14/01/2027 »). Un champ renvoyé à l'identique n'est pas listé.
 * `typesEvenement` : libellé par id, pour nommer le type d'événement.
 */
export function lignesModifications(
  m: ModificationCollecte,
  typesEvenement: Record<string, string> = {},
): string[] {
  const c0 = m.collecteAvant ?? {};
  const c = m.majCollecte ?? {};
  const e0 = m.evenementAvant ?? {};
  const e = m.majEvenement ?? {};
  const apres = (champ: string): unknown => (champ in e ? e[champ] : e0[champ]);
  const lignes: string[] = [];

  if (change(c0, c, 'date_collecte'))
    lignes.push(
      `Date de collecte : du ${jour(c0.date_collecte)} au ${jour(c.date_collecte)}`,
    );
  if (change(c0, c, 'heure_collecte'))
    lignes.push(
      `Heure de collecte : de ${heure(c0.heure_collecte)} à ${heure(c.heure_collecte)}`,
    );
  if (change(e0, e, 'pax'))
    lignes.push(`Nombre de pax : de ${texte(e0.pax)} à ${texte(e.pax)}`);

  // Nom et téléphone d'un contact se lisent ensemble : une seule ligne dès que
  // l'un des deux change.
  for (const [libelle, prefixe] of [
    ['Contact', 'contact_principal'],
    ['Contact de secours', 'contact_secours'],
  ] as const) {
    const nom = `${prefixe}_nom`;
    const telephone = `${prefixe}_telephone`;
    if (change(e0, e, nom) || change(e0, e, telephone))
      lignes.push(
        `${libelle} : avant ${contact(e0[nom], e0[telephone])}. Maintenant ${contact(apres(nom), apres(telephone))}`,
      );
  }

  if (change(c0, c, 'controle_acces_requis'))
    lignes.push(
      `Contrôle d'accès : de ${ouiNon(c0.controle_acces_requis)} à ${ouiNon(c.controle_acces_requis)}`,
    );

  const textes: Array<[string, Ligne, Ligne, string]> = [
    ['Informations supplémentaires', c0, c, 'informations_supplementaires'],
    ["Nom de l'événement", e0, e, 'nom_evenement'],
    ['Client organisateur', e0, e, 'nom_client_organisateur'],
    ["Référence d'affaire", e0, e, 'reference_affaire'],
  ];
  for (const [libelle, avant, maj, champ] of textes)
    if (change(avant, maj, champ))
      lignes.push(
        `${libelle} : avant ${texte(avant[champ])}. Maintenant ${texte(maj[champ])}`,
      );

  if (change(e0, e, 'type_evenement_id'))
    lignes.push(
      `Type d'événement : avant ${texte(typesEvenement[String(e0.type_evenement_id)])}. Maintenant ${texte(typesEvenement[String(e.type_evenement_id)])}`,
    );
  if (change(e0, e, 'logo_client_organisateur_url'))
    lignes.push('Logo du client organisateur : modifié');

  return lignes;
}

/** Vrai à moins de 12 h du créneau (§05 « Modification d'une collecte à venir »). */
export function modificationUrgente(
  date: string,
  heureCollecte: string | null | undefined,
  maintenant: number = Date.now(),
): boolean {
  // Heure murale parisienne : le trigger SQL qui débite le crédit du pack ancre
  // le seuil 12h en Europe/Paris — l'API doit tomber au même instant.
  const creneau = instantParis(date, heureCollecte ?? '00:00:00');
  return creneau.getTime() - maintenant < 12 * 3600 * 1000;
}

// Le formulaire enregistre l'événement puis, dans la foulée, la collecte : la
// ligne d'audit cherchée a quelques dixièmes de seconde. La borne évite seulement
// de ressortir une modification ancienne si la requête prétend à tort que
// l'événement vient d'être modifié.
const FENETRE_MEME_ENREGISTREMENT_MS = 2 * 60 * 1000;

/**
 * La modification d'événement que CET utilisateur vient d'enregistrer, relue
 * dans le journal d'audit (écrit par PATCH /programmation/evenements/:id).
 * Objet vide si aucune.
 */
export async function derniereModificationEvenement(
  admin: AdminSupabase,
  evenementId: unknown,
  userId: string,
): Promise<Pick<ModificationCollecte, 'evenementAvant' | 'majEvenement'>> {
  if (typeof evenementId !== 'string') return {};
  const depuis = Date.now() - FENETRE_MEME_ENREGISTREMENT_MS;
  const { data } = await admin
    .from('audit_log')
    .select('old_values, new_values')
    .eq('table_name', 'evenements')
    .eq('record_id', evenementId)
    .eq('user_id', userId)
    .eq('action', 'UPDATE')
    .gte('created_at', new Date(depuis).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const maj = (data?.new_values as { updates?: Ligne } | null)?.updates;
  if (!data || !maj) return {};
  return { evenementAvant: data.old_values as Ligne, majEvenement: maj };
}

const escapeHtml = (v: string): string =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const un = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

interface CollecteApres {
  statut: string;
  statut_tms: string;
  tms_reference: string | null;
  prestataire_logistique_id: string | null;
  date_collecte: string;
  heure_collecte: string | null;
  attributions_antgaspi: unknown;
  evenement: unknown;
}

interface EvenementApres {
  pax: number | null;
  created_by: string | null;
  organisation: { nom: string } | { nom: string }[] | null;
}

/** Envoie l'email de modification à l'équipe Savr. Rien si aucun champ n'a changé. */
export async function notifierEquipeModificationCollecte(
  admin: AdminSupabase,
  m: ModificationCollecte & { collecteId: string },
): Promise<void> {
  try {
    // État APRÈS l'écriture : le statut affiché est celui que l'Admin lira en
    // ouvrant la fiche (une date modifiée peut le ramener à « Programmée »).
    const { data } = await admin
      .from('collectes')
      .select(
        `statut, statut_tms, tms_reference, prestataire_logistique_id,
         date_collecte, heure_collecte,
         attributions_antgaspi!collecte_id(id),
         evenement:evenements!inner(pax, created_by,
           organisation:organisations!organisation_id(nom))`,
      )
      .eq('id', m.collecteId)
      .maybeSingle();
    if (!data) return;
    const collecte = data as unknown as CollecteApres;
    const evenement = un(
      collecte.evenement as EvenementApres | EvenementApres[],
    );
    const e0 = m.evenementAvant ?? {};
    const e = m.majEvenement ?? {};

    let typesEvenement: Record<string, string> = {};
    if ('type_evenement_id' in e) {
      const ids = [e0.type_evenement_id, e.type_evenement_id].filter(
        (v): v is string => typeof v === 'string',
      );
      const { data: types } = await admin
        .from('types_evenements')
        .select('id, libelle')
        .in('id', ids);
      typesEvenement = Object.fromEntries(
        ((types ?? []) as Array<{ id: string; libelle: string }>).map((t) => [
          t.id,
          t.libelle,
        ]),
      );
    }

    const lignes = lignesModifications(m, typesEvenement);
    if (lignes.length === 0) return;

    const { data: compte } = evenement?.created_by
      ? await admin
          .from('users')
          .select('prenom, nom, telephone')
          .eq('id', evenement.created_by)
          .maybeSingle()
      : { data: null };
    const p = compte as {
      prenom: string | null;
      nom: string | null;
      telephone: string | null;
    } | null;
    const nomProgrammateur = [p?.prenom, p?.nom].filter(Boolean).join(' ');

    const c0 = m.collecteAvant ?? {};
    const dateInitiale = (c0.date_collecte ?? collecte.date_collecte) as string;
    const heureInitiale = (c0.heure_collecte ?? collecte.heure_collecte) as
      | string
      | null;
    const paxInitial = 'pax' in e0 ? e0.pax : evenement?.pax;

    // Le corps du template est du HTML interpolé tel quel : tout texte saisi
    // par un utilisateur est échappé ici.
    const variables: Record<string, string> = {
      organisation_nom: escapeHtml(un(evenement?.organisation)?.nom ?? ''),
      date_initiale: formatDateParis(dateInitiale),
      liste_modifications: `<ul>${lignes
        .map((l) => `<li>${escapeHtml(l)}</li>`)
        .join('')}</ul>`,
      statut_collecte: LIBELLE_STATUT_COLLECTE[statutCollecteAdmin(collecte)],
      priorite_urgence: String(
        modificationUrgente(dateInitiale, heureInitiale),
      ),
    };
    if (!vide(paxInitial)) variables.pax_initial = String(paxInitial);
    if (nomProgrammateur)
      variables.programmateur = escapeHtml(
        p?.telephone
          ? `${nomProgrammateur}, joignable au ${p.telephone}`
          : nomProgrammateur,
      );

    await sendEmail(TEMPLATE_MODIFICATION_COLLECTE, ADRESSE_EQUIPE, variables);
  } catch (err) {
    logger.error('collectes.email_modification_echec', {
      collecte_id: m.collecteId,
      erreur: err instanceof Error ? err.message : String(err),
    });
  }
}

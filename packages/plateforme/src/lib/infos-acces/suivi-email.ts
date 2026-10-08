import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { instantParis, jourParis } from '@savr/shared/src/temps/index.js';
import { CODE_ALERTE_INFOS_ACCES_NON_REMISES } from '@/lib/emails/codes-alertes.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;
type ErreurDb = { code?: string; message: string };

/**
 * Suivi de l'email « infos d'accès chauffeur » — ce qu'il est réellement advenu de
 * l'envoi, lu dans `emails_envoyes` et non déduit du tampon
 * `collectes.infos_acces_email_envoye_at`.
 *
 * Le tampon est posé AVANT l'envoi (claim anti-double-envoi de
 * `fn_infos_acces_marquer_si_complet`) : il dit « un envoi est réservé », pas
 * « l'email est arrivé ». Décision Val 2026-10-08 (C1-C4) :
 *   · la fiche collecte affiche l'état réel (envoyé / en reprise / non remis) ;
 *   · quand l'email est définitivement perdu — 4 tentatives épuisées ou refus de
 *     la messagerie du destinataire —, le tampon est retiré (la collecte revient
 *     dans la tuile « Infos accès à envoyer ») et une alerte in-app est ouverte ;
 *   · tant que le worker de retry porte l'envoi, le tampon RESTE posé : le
 *     relâcher laisserait partir un second email en parallèle ;
 *   · sans attendre les 25 h de l'échec définitif, l'alerte est ouverte dès deux
 *     tentatives échouées si la collecte a lieu dans les 24 h.
 */
export const TEMPLATE_INFOS_ACCES = 'infos_acces_collecte';

// Envoi initial + 3 reprises (§08 §4) : à la 4e tentative en échec, plus rien ne repart.
const TENTATIVES_MAX = 4;
const FENETRE_COLLECTE_PROCHE_MS = 24 * 60 * 60 * 1000;

// Collecte finie ou abandonnée : les coordonnées du chauffeur n'ont plus d'usage.
const STATUTS_SANS_SUITE = new Set([
  'realisee',
  'realisee_sans_collecte',
  'cloturee',
  'annulee',
  'rejetee_par_prestataire',
]);

export type EtatEmailInfosAcces =
  | 'a_envoyer' // rien n'est parti et rien n'est en cours
  | 'envoye' // accepté par Resend
  | 'en_reprise' // refusé pour l'instant, le worker de retry réessaie
  | 'non_remis'; // perdu : plus aucune tentative automatique

export type MotifNonRemis = 'tentatives_epuisees' | 'adresse_refusee';

export interface SuiviEmailInfosAcces {
  etat: EtatEmailInfosAcces;
  /** Date de l'envoi ('envoye') ou de la demande d'envoi (autres états). */
  date: string | null;
  /** Numéro de la dernière tentative (1 à 4), quand une ligne d'envoi existe. */
  tentative: number | null;
  motif: MotifNonRemis | null;
}

export interface DernierEmailInfosAcces {
  id: string;
  statut: string;
  tentative_numero: number;
  created_at: string;
  envoye_at: string | null;
}

/** Dernier envoi « infos d'accès » de la collecte (le plus récent fait foi). */
export async function lireDernierEmailInfosAcces(
  supabase: AdminSupabase,
  collecteId: string,
): Promise<{ data: DernierEmailInfosAcces | null; error: ErreurDb | null }> {
  // Ni `destinataire` ni `erreur` : le message d'erreur brut de Resend peut citer
  // une adresse, et la fiche collecte est servie aussi au rôle ops_savr, à qui
  // `emails_envoyes` est fermée (§09 A2bis, PII).
  const { data, error } = await supabase
    .from('emails_envoyes')
    .select('id, statut, tentative_numero, created_at, envoye_at')
    .eq('template_code', TEMPLATE_INFOS_ACCES)
    .eq('entity_type', 'collecte')
    .eq('entity_id', collecteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    data: (data as DernierEmailInfosAcces | null) ?? null,
    error: error ?? null,
  };
}

/**
 * État affichable, à partir du dernier envoi et du tampon de la collecte.
 * Sans ligne d'envoi, rien ne prouve qu'un email est parti : « à envoyer », même
 * si le tampon est posé (envoi réservé puis interrompu avant d'être tracé).
 * Le tampon ne tranche que deux cas : un envoi réussi qu'une demande de renvoi
 * a remis en jeu (tampon retiré → « à envoyer »), et un statut que ce suivi ne
 * connaît pas.
 */
export function deriverSuiviEmail(
  dernier: DernierEmailInfosAcces | null,
  tampon: string | null,
): SuiviEmailInfosAcces {
  const aEnvoyer: SuiviEmailInfosAcces = {
    etat: 'a_envoyer',
    date: null,
    tentative: null,
    motif: null,
  };
  if (!dernier) return aEnvoyer;
  const selonTampon: SuiviEmailInfosAcces = tampon
    ? { etat: 'envoye', date: tampon, tentative: null, motif: null }
    : aEnvoyer;

  const tentative = dernier.tentative_numero;
  switch (dernier.statut) {
    case 'sent':
    case 'delivered':
      if (!tampon) return selonTampon;
      return {
        etat: 'envoye',
        date: dernier.envoye_at ?? dernier.created_at,
        tentative,
        motif: null,
      };
    case 'failed':
      return tentative >= TENTATIVES_MAX
        ? {
            etat: 'non_remis',
            date: dernier.created_at,
            tentative,
            motif: 'tentatives_epuisees',
          }
        : {
            etat: 'en_reprise',
            date: dernier.created_at,
            tentative,
            motif: null,
          };
    case 'bounced':
      return {
        etat: 'non_remis',
        date: dernier.created_at,
        tentative,
        motif: 'adresse_refusee',
      };
    default:
      return selonTampon;
  }
}

async function ouvrirAlerte(
  supabase: AdminSupabase,
  collecteId: string,
): Promise<ErreurDb | null> {
  // Un seul message, vrai dans les trois cas (en reprise avant une collecte
  // proche, tentatives épuisées, adresse refusée) : l'état exact est sur la fiche.
  const { error } = await supabase.rpc('f_upsert_alerte_admin', {
    p_code: CODE_ALERTE_INFOS_ACCES_NON_REMISES,
    p_titre: 'Infos d’accès non remises au programmateur',
    p_message:
      'L’email des coordonnées du chauffeur n’est pas parvenu au programmateur. L’état de l’envoi et le bouton « Renvoyer l’email » sont sur la fiche collecte ; si la collecte est proche, transmettez les coordonnées par téléphone.',
    p_entity_type: 'collecte',
    p_entity_id: collecteId,
  });
  return error ?? null;
}

/**
 * L'email d'infos d'accès `emailId` n'arrivera pas (tentatives épuisées ou adresse
 * refusée) : tampon retiré + alerte in-app. Rejouable : le retrait est sans
 * effet la seconde fois et l'alerte n'est pas doublée tant qu'elle est ouverte
 * (résolue entre-temps, un rejeu la rouvre). Sans effet du tout si un envoi plus
 * récent existe pour la collecte : un refus tardif de l'ancien email ne doit pas
 * défaire le renvoi qui l'a remplacé.
 */
export async function signalerInfosAccesNonRemises(
  supabase: AdminSupabase,
  collecteId: string,
  emailId: string,
): Promise<ErreurDb | null> {
  const dernier = await lireDernierEmailInfosAcces(supabase, collecteId);
  if (dernier.error) return dernier.error;
  if (dernier.data?.id !== emailId) return null;

  const { error: tamponErr } = await supabase
    .from('collectes')
    .update({ infos_acces_email_envoye_at: null })
    .eq('id', collecteId);
  if (tamponErr) return tamponErr;

  return ouvrirAlerte(supabase, collecteId);
}

/** L'email est finalement parti : l'alerte ouverte pour cette collecte est close. */
export async function cloreAlerteInfosAcces(
  supabase: AdminSupabase,
  collecteId: string,
): Promise<ErreurDb | null> {
  const { error } = await supabase
    .from('alertes_admin')
    .update({ statut: 'resolue', resolue_at: new Date().toISOString() })
    .eq('code', CODE_ALERTE_INFOS_ACCES_NON_REMISES)
    .eq('entity_type', 'collecte')
    .eq('entity_id', collecteId)
    .eq('statut', 'ouverte');
  return error ?? null;
}

/**
 * Alerte anticipée (même seuil que l'outbox, §07/03 « collecte imminente ») :
 * un email d'infos d'accès encore en reprise après deux tentatives, pour une
 * collecte à venir dans les 24 h. Sans elle, l'échec définitif n'est connu que
 * 25 h après le premier essai — après le passage du camion.
 *
 * Appelée à chaque passage du cron (5 min) : un même envoi n'ouvre l'alerte
 * qu'une fois. Si l'Admin l'a résolue (programmateur prévenu par téléphone),
 * elle ne revient pas tant que cet envoi-là est en reprise.
 * Rend le nombre de collectes signalées à ce passage.
 */
export async function alerterInfosAccesEnRepriseAvantCollecte(
  supabase: AdminSupabase,
  nowMs: number = Date.now(),
): Promise<{ signalees: number; error: ErreurDb | null }> {
  const { data: lignes, error: lignesErr } = await supabase
    .from('emails_envoyes')
    .select('entity_id, created_at')
    .eq('template_code', TEMPLATE_INFOS_ACCES)
    .eq('entity_type', 'collecte')
    .eq('statut', 'failed')
    .gte('tentative_numero', 2)
    .lt('tentative_numero', TENTATIVES_MAX);
  if (lignesErr) return { signalees: 0, error: lignesErr };

  // Par collecte : date de la demande d'envoi encore en reprise.
  const demandes = new Map<string, string>();
  for (const l of (lignes ?? []) as Array<{
    entity_id: string | null;
    created_at: string;
  }>) {
    if (l.entity_id) demandes.set(l.entity_id, l.created_at);
  }
  const ids = [...demandes.keys()];
  if (ids.length === 0) return { signalees: 0, error: null };

  const { data: collectes, error: collectesErr } = await supabase
    .from('collectes')
    .select('id, date_collecte, heure_collecte, statut')
    .in('id', ids)
    .gte('date_collecte', jourParis(new Date(nowMs)));
  if (collectesErr) return { signalees: 0, error: collectesErr };

  let signalees = 0;
  for (const c of (collectes ?? []) as Array<{
    id: string;
    date_collecte: string;
    heure_collecte: string | null;
    statut: string;
  }>) {
    if (STATUTS_SANS_SUITE.has(c.statut)) continue;
    const debut = instantParis(
      c.date_collecte,
      c.heure_collecte ?? '00:00',
    ).getTime();
    if (debut - nowMs > FENETRE_COLLECTE_PROCHE_MS) continue;

    // Déjà signalé : une alerte encore ouverte, ou une alerte (même résolue)
    // ouverte depuis cette demande d'envoi.
    const { data: alertes, error: alertesErr } = await supabase
      .from('alertes_admin')
      .select('statut, created_at')
      .eq('code', CODE_ALERTE_INFOS_ACCES_NON_REMISES)
      .eq('entity_type', 'collecte')
      .eq('entity_id', c.id);
    if (alertesErr) return { signalees, error: alertesErr };
    const depuis = new Date(demandes.get(c.id) as string).getTime();
    const dejaSignale = (
      (alertes ?? []) as Array<{ statut: string; created_at: string }>
    ).some(
      (a) =>
        a.statut === 'ouverte' || new Date(a.created_at).getTime() >= depuis,
    );
    if (dejaSignale) continue;

    const alerteErr = await ouvrirAlerte(supabase, c.id);
    if (alerteErr) return { signalees, error: alerteErr };
    signalees += 1;
  }
  return { signalees, error: null };
}

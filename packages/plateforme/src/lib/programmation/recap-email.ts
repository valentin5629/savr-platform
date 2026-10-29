import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { escapeHtml } from '@savr/shared/src/email/html.js';
import { instantParis } from '@savr/shared/src/temps/index.js';
import { erreurInterne } from '@/lib/api-helpers.js';
import { facturationPlateformeActive } from '@/lib/facturation-plateforme.js';
import { calculer_tarif_zd } from '@/lib/tarif-zd.js';
import {
  ENTITE_RECAP_PROGRAMMATION,
  TEMPLATE_RECAP_PROGRAMMATION,
} from '@/lib/programmation/suivi-recap-email.js';
import {
  estZeroDechet,
  numeroterCollectes,
} from '@/lib/programmation/numerotation.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

export interface RecapProgrammationParams {
  programmeurUserId: string;
  evenementId: string;
  nomEvenement: string | null;
  organisationId: string | null;
  lieuId: string | null;
  /** Collectes que l'email annonce (celles que la requête vient de créer). */
  collecteIds: string[];
  /** Lien « Voir mes collectes » (liste Collectes de l'espace du programmeur). */
  lienCollectes?: string | null;
  /** Lien vers la fiche de l'événement (« programmez les autres collectes »). */
  lienEvenement?: string | null;
  /** Instant de référence (tests) pour l'alerte « moins de 24 heures ». */
  maintenant?: Date;
}

interface LigneCollecte {
  id: string;
  type: string;
  date_collecte: string;
  heure_collecte: string | null;
  pax: number | null;
  created_at: string | null;
}

/** « jeudi 12 novembre 2026 » (jour de Paris). */
export function dateLongue(date: string): string {
  return instantParis(date, '12:00:00').toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Alerte « moins de 24 heures » (Val 2026-10-16, reprise au récapitulatif le
 * 2026-10-29) : au moins une collecte annoncée commence dans moins de 24 h.
 */
export function collecteSous24h(
  collectes: { date_collecte: string; heure_collecte: string | null }[],
  maintenant: Date,
): boolean {
  const limite = maintenant.getTime() + 24 * 3600 * 1000;
  return collectes.some((c) => {
    const debut = instantParis(
      c.date_collecte,
      (c.heure_collecte ?? '00:00').slice(0, 5),
    ).getTime();
    return debut < limite;
  });
}

/**
 * Une ligne par collecte (décision Val 2026-10-24, B2-Q3) :
 * « Collecte Zéro Déchet #1 — jeudi 12 novembre 2026 à 19:00 — 120 convives »
 * (graphie de l'app « Zéro Déchet », arbitrage D38 du 2026-10-07).
 * Aucun texte saisi par l'utilisateur : le moteur d'email n'échappe rien.
 */
export function listeCollectesHtml(
  lignes: { libelle: string; collecte: LigneCollecte }[],
): string {
  const items = lignes.map(({ libelle, collecte }) => {
    const heure = (collecte.heure_collecte ?? '').slice(0, 5);
    const quand = heure
      ? `${dateLongue(collecte.date_collecte)} à ${heure}`
      : dateLongue(collecte.date_collecte);
    const convives =
      typeof collecte.pax === 'number' && collecte.pax > 0
        ? ` — ${collecte.pax} convive${collecte.pax > 1 ? 's' : ''}`
        : '';
    return `<li>${libelle} — ${quand}${convives}</li>`;
  });
  return `<ul>${items.join('')}</ul>`;
}

/**
 * Ligne « tarif ZD » du récap : tarif de la première collecte Zéro-Déchet
 * annoncée. Le montant n'est jamais affiché au formulaire, seulement communiqué
 * ici (CDC §06.01 § 3.b).
 */
async function ligneTarifZd(
  supabase: AdminSupabase,
  params: RecapProgrammationParams,
  collectes: LigneCollecte[],
): Promise<string> {
  const collecteZd = collectes.find((c) => estZeroDechet(c.type));
  if (!collecteZd) {
    return 'Cet événement ne comporte pas de collecte Zéro Déchet facturable.';
  }
  try {
    const tarif = await calculer_tarif_zd(
      collecteZd.pax ?? 0,
      params.organisationId,
      new Date(collecteZd.date_collecte),
      supabase,
      params.lieuId,
    );
    return `Tarif Zéro Déchet applicable : ${tarif.montant_ht.toFixed(2)} € HT.`;
  } catch {
    // Grille/tarif introuvable ou pax invalide : ne bloque pas le récap.
    return 'Le tarif Zéro Déchet applicable vous sera communiqué prochainement.';
  }
}

/**
 * Email récap de programmation au PROGRAMMEUR — BL-P1-PROG-04.
 * CDC §06.01 Actions post-confirmation : « un seul email couvrant l'événement et
 * ses collectes » ; une ligne par collecte (décision Val 2026-10-24, B2-Q3).
 * Les collectes sont relues en base (après leur création) : le libellé
 * « Collecte Zéro Déchet #n » est celui de la page de confirmation.
 *
 * Best-effort / non bloquant : l'appelant avale toute erreur. Un destinataire non
 * résoluble ⇒ aucun envoi (jamais to='' — évite de polluer emails_envoyes).
 */
export async function envoyerRecapProgrammation(
  supabase: AdminSupabase,
  params: RecapProgrammationParams,
): Promise<void> {
  // Destinataire = programmeur (utilisateur authentifié).
  const userRes = (await supabase
    .from('users')
    .select('email, prenom')
    .eq('id', params.programmeurUserId)
    .maybeSingle()) as {
    data?: { email?: string; prenom?: string | null } | null;
  } | null;

  const to = userRes?.data?.email ?? '';
  if (!to) return; // pas de destinataire résoluble → pas d'envoi

  // Toutes les collectes de l'événement : la numérotation par type en dépend.
  const { data: rows, error } = await supabase
    .from('collectes')
    .select('id, type, date_collecte, heure_collecte, pax, created_at')
    .eq('evenement_id', params.evenementId);
  if (error) throw erreurInterne(error, 'programmation.recap.collectes');
  const annoncees = new Set(params.collecteIds);
  const lignes = numeroterCollectes((rows ?? []) as LigneCollecte[]).filter(
    ({ collecte }) => annoncees.has(collecte.id),
  );
  if (lignes.length === 0) return;
  const collectes = lignes.map((l) => l.collecte);

  // Facturation hors plateforme au go-live (décision Val 2026-10-22) : aucune ligne
  // de tarif, le paragraphe du gabarit reste vide.
  const tarifLigne = facturationPlateformeActive()
    ? await ligneTarifZd(supabase, params, collectes)
    : '';

  // Nom du lieu, pour situer l'événement (« au Pavillon Ledoyen »).
  // Facultatif : si la lecture échoue, l'email part sans le lieu.
  let lieuNom = '';
  if (params.lieuId) {
    try {
      const lieuRes = (await supabase
        .from('lieux')
        .select('nom')
        .eq('id', params.lieuId)
        .maybeSingle()) as { data?: { nom?: string | null } | null } | null;
      lieuNom = lieuRes?.data?.nom?.trim() ?? '';
    } catch {
      lieuNom = '';
    }
  }

  const n = lignes.length;
  await sendEmail(
    TEMPLATE_RECAP_PROGRAMMATION,
    to,
    {
      // Formule d'appel « Bonjour Prénom, » (§06.02 §3). Vide → « Bonjour, » :
      // le template porte le prénom dans un bloc conditionnel.
      prenom: escapeHtml(userRes?.data?.prenom?.trim() ?? ''),
      nom_evenement: escapeHtml(params.nomEvenement ?? 'Votre événement'),
      lieu_nom: escapeHtml(lieuNom),
      nombre_collectes: `${n} collecte${n > 1 ? 's' : ''}`,
      liste_collectes: listeCollectesHtml(lignes),
      tarif_ligne: tarifLigne,
      lien_collectes: params.lienCollectes ?? '',
      lien_evenement: params.lienEvenement ?? '',
      collecte_sous_24h: collecteSous24h(
        collectes,
        params.maintenant ?? new Date(),
      )
        ? 'true'
        : '',
    },
    // Relu par l'écran de confirmation (suivi-recap-email.ts) : même entité.
    { entityType: ENTITE_RECAP_PROGRAMMATION, entityId: params.evenementId },
  );
}

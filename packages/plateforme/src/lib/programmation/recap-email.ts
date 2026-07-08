import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { calculer_tarif_zd } from '@/lib/tarif-zd.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

export interface RecapCollecteInput {
  // Accepte l'alias court d'entrée ('zd'/'ag') OU la valeur enum DB
  // ('zero_dechet'/'anti_gaspi') selon le chemin appelant.
  type: string;
  date_collecte: string;
}

export interface RecapProgrammationParams {
  programmeurUserId: string;
  evenementId: string;
  nomEvenement: string | null;
  pax: number;
  organisationId: string | null;
  collectes: RecapCollecteInput[];
}

const estZd = (t: string): boolean => t === 'zd' || t === 'zero_dechet';

/**
 * Email récap de programmation au PROGRAMMEUR — BL-P1-PROG-04.
 * CDC §06.01 l.397 : « un seul email couvrant l'événement et ses collectes ».
 * CDC §05 l.240 + l.1240 : destinataire = le programmeur de la collecte (utilisateur
 * authentifié), résolu via plateforme.users.email (l'AuthContext ne porte pas l'email).
 * CDC §06.01 l.180 : le tarif ZD est calculé en backend et communiqué dans ce récap.
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
    .select('email')
    .eq('id', params.programmeurUserId)
    .maybeSingle()) as { data?: { email?: string } | null } | null;

  const to = userRes?.data?.email ?? '';
  if (!to) return; // pas de destinataire résoluble → pas d'envoi

  const dateRecap = params.collectes[0]?.date_collecte ?? '';

  // Tarif ZD (une seule collecte ZD par programmation — Sujet 1 2026-05-25). Le montant
  // n'est jamais affiché au formulaire, seulement communiqué ici (CDC §06.01 l.180).
  let tarifLigne =
    'Cet événement ne comporte pas de collecte Zéro Déchet facturable.';
  const collecteZd = params.collectes.find((c) => estZd(c.type));
  if (collecteZd) {
    try {
      const tarif = await calculer_tarif_zd(
        params.pax,
        params.organisationId,
        new Date(collecteZd.date_collecte),
        supabase,
      );
      tarifLigne = `Tarif Zéro Déchet applicable : ${tarif.montant_ht.toFixed(2)} € HT.`;
    } catch {
      // Grille/tarif introuvable ou pax invalide : ne bloque pas le récap.
      tarifLigne =
        'Le tarif Zéro Déchet applicable vous sera communiqué prochainement.';
    }
  }

  await sendEmail(
    'collecte_programmee',
    to,
    {
      nom_evenement: params.nomEvenement ?? 'Votre événement',
      date_collecte: dateRecap,
      tarif_ligne: tarifLigne,
    },
    { entityType: 'evenement', entityId: params.evenementId },
  );
}

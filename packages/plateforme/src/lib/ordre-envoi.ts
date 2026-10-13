import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;
type ErreurDb = { code?: string; message: string };

/**
 * Ordre d'envoi d'une collecte au prestataire — ce qu'il est réellement advenu
 * de l'ordre mis en file par « Envoyer », lu dans `outbox_events` et non déduit
 * de `statut_tms` (décision Val 2026-10-12, C6).
 *
 * Avant, la fiche collecte disait « Envoyée » tant que la référence TMS n'était
 * pas revenue, que l'ordre soit en file, en échec avec reprise, ou abandonné.
 *
 * On ne rend que l'ordre DE TÊTE : le plus ancien ordre logistique non terminé
 * de la collecte. C'est lui que la réservation fait passer en premier, et lui
 * qui bloque les suivants (head-of-line de `fn_claim_outbox_collecte` et
 * `fn_claim_outbox_batch`) — même prédicat ici : famille logistique, statut
 * autre que `done`.
 */
export type EtatOrdreEnvoi =
  | 'en_attente' // en file, pas encore pris
  | 'en_cours' // pris par un passage du worker
  | 'echec_reprise' // en échec, une nouvelle tentative est planifiée
  | 'echec_definitif'; // abandonné : plus aucune tentative automatique

export type NatureOrdreEnvoi = 'creation' | 'modification' | 'annulation';

export interface OrdreEnvoi {
  etat: EtatOrdreEnvoi;
  nature: NatureOrdreEnvoi;
  /** Tentatives déjà comptées pour cet ordre. */
  tentatives: number;
  /** Prochaine tentative automatique ('echec_reprise'), sinon null. */
  prochaine_tentative_at: string | null;
  /** Dernière erreur enregistrée pour cet ordre, tronquée. */
  erreur: string | null;
}

export interface LigneOrdre {
  seq: number;
  event_type: string;
  statut: string;
  consumer: string | null;
  attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
}

// Envoi initial + 3 reprises (5 min / 1 h / 24 h) : à la 4e tentative en échec,
// l'ordre est abandonné. Épinglé sur `getNextRetryAt` du worker par le test.
export const TENTATIVES_MAX_ORDRE = 4;

const LONGUEUR_MAX_ERREUR = 200;

const ETATS: Record<string, EtatOrdreEnvoi> = {
  pending: 'en_attente',
  processing: 'en_cours',
  failed: 'echec_reprise',
  dead: 'echec_definitif',
};

const NATURES: Record<string, NatureOrdreEnvoi> = {
  'collecte.creee': 'creation',
  'collecte.modifiee': 'modification',
  'collecte.annulee': 'annulation',
};

/** Tous les ordres de la collecte ; le tri et le filtre sont faits par `deriverOrdreEnvoi`. */
export async function lireOrdresCollecte(
  supabase: AdminSupabase,
  collecteId: string,
): Promise<{ data: LigneOrdre[]; error: ErreurDb | null }> {
  const { data, error } = await supabase
    .from('outbox_events')
    .select(
      'seq, event_type, statut, consumer, attempts, next_retry_at, last_error',
    )
    .eq('aggregate_type', 'collecte')
    .eq('aggregate_id', collecteId);
  return { data: (data as LigneOrdre[] | null) ?? [], error: error ?? null };
}

/** L'ordre de tête de la collecte, ou `null` quand plus rien n'est en file. */
export function deriverOrdreEnvoi(lignes: LigneOrdre[]): OrdreEnvoi | null {
  const tete = lignes
    .filter((l) => l.consumer !== 'attribution_job' && l.statut !== 'done')
    .sort((a, b) => a.seq - b.seq)[0];
  if (!tete) return null;

  const erreur = tete.last_error?.trim() ?? '';
  return {
    etat: ETATS[tete.statut] ?? 'en_attente',
    nature: NATURES[tete.event_type] ?? 'creation',
    tentatives: tete.attempts,
    prochaine_tentative_at:
      tete.statut === 'failed' ? tete.next_retry_at : null,
    erreur: erreur ? erreur.slice(0, LONGUEUR_MAX_ERREUR) : null,
  };
}

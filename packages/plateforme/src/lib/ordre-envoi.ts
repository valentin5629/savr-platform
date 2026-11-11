import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  lireParLots,
  lireParPages,
  TAILLE_PAGE,
} from '@/lib/pdf/selection-par-pages.js';

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
 * On ne rend que l'ordre DE TÊTE : le plus ancien ordre logistique de la
 * collecte qui compte encore — en file, en cours, en échec avec reprise, ou
 * abandonné sans avoir été remplacé.
 *
 * Depuis la décision Val du 2026-11-03, un ordre abandonné (`dead`) ne bloque
 * plus les suivants dans la file (`fn_claim_outbox_collecte` et
 * `fn_claim_outbox_batch`) : l'Admin corrige et renvoie depuis la fiche. Un
 * abandon reste affiché tant qu'un ordre plus récent ne l'a pas remplacé
 * (`estRemplace`) : sinon la fiche ne dirait plus que rien n'est parti.
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

/**
 * Un ordre abandonné est-il remplacé par un ordre plus récent de la collecte ?
 *   - création : par une nouvelle création (le renvoi depuis la fiche) ;
 *   - modification : par tout ordre suivant, qui porte l'état complet de la
 *     collecte relu au moment de l'envoi (ou l'annule) ;
 *   - annulation : par une nouvelle annulation.
 * Une modification qui suit une création abandonnée ne la remplace pas : elle
 * ne part pas tant que rien n'existe chez le prestataire.
 */
function estRemplace(ordre: LigneOrdre, logistiques: LigneOrdre[]): boolean {
  return logistiques.some(
    (l) =>
      l.seq > ordre.seq &&
      (ordre.event_type === 'collecte.modifiee' ||
        l.event_type === ordre.event_type),
  );
}

/** L'ordre de tête de la collecte, ou `null` quand plus rien ne compte. */
export function deriverOrdreEnvoi(lignes: LigneOrdre[]): OrdreEnvoi | null {
  const logistiques = lignes.filter((l) => l.consumer !== 'attribution_job');
  const tete = logistiques
    .filter(
      (l) =>
        l.statut !== 'done' &&
        !(l.statut === 'dead' && estRemplace(l, logistiques)),
    )
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

/**
 * L'ordre de création parti vers le prestataire est-il abandonné ? Ramène la
 * collecte à « Créée » côté Admin (lib/statut-collecte-admin, décision Val
 * 2026-11-02). Un ordre de modification ou d'annulation abandonné n'en fait
 * pas partie : la demande, elle, est bien arrivée.
 */
export function envoiAbandonne(ordre: OrdreEnvoi | null): boolean {
  return ordre?.etat === 'echec_definitif' && ordre.nature === 'creation';
}

/**
 * Collectes dont l'ordre de création est abandonné, parmi `collecteIds`
 * (lignes déjà chargées) ou, sans liste, celles que l'exception touche encore
 * (filtre « Créée » / « Programmée » de la liste Admin et de son export).
 * Sans liste, les abandons de collectes depuis annulées, acceptées à la main ou
 * terminées sont écartés : ils restent `dead` en base, même remplacés, et
 * grossiraient sans fin l'URL du filtre.
 */
export async function lireCollectesEnvoiAbandonne(
  supabase: AdminSupabase,
  collecteIds?: readonly string[],
): Promise<{ data: Set<string>; error: ErreurDb | null }> {
  if (collecteIds?.length === 0) return { data: new Set(), error: null };
  // Aucune de ces lectures ne part en une requête (`lib/pdf/selection-par-pages`) :
  // une réponse est amputée à 1 000 lignes sans erreur, et un filtre `in` de
  // plusieurs centaines d'identifiants échoue. Avec une liste : par lots
  // d'identifiants. Sans liste : page après page.
  const abandons = () =>
    supabase
      .from('outbox_events')
      .select('id, aggregate_id')
      .eq('aggregate_type', 'collecte')
      // `collecte.creee` : l'ordre de l'attribution AG (`attribution.validee`)
      // n'en fait pas partie.
      .eq('event_type', 'collecte.creee')
      .eq('statut', 'dead');
  const lus = collecteIds
    ? await lireParLots<{ aggregate_id: string }>(
        [...new Set(collecteIds)],
        (lot) => abandons().in('aggregate_id', lot),
      )
    : await lireParPages<{ id: string; aggregate_id: string }>((apresId) => {
        const q = abandons();
        return (apresId ? q.gt('id', apresId) : q)
          .order('id', { ascending: true })
          .limit(TAILLE_PAGE);
      });
  if (lus.error) return { data: new Set(), error: lus.error };
  const candidats = [...new Set(lus.data.map((l) => l.aggregate_id))];
  if (candidats.length === 0) return { data: new Set(), error: null };

  // Un abandon remplacé par une création plus récente (le renvoi depuis la
  // fiche, Val 2026-11-03) ne compte plus : on garde les collectes dont la
  // DERNIÈRE création est abandonnée — même règle que `estRemplace`.
  const creations = await lireParLots<{
    aggregate_id: string;
    seq: number;
    statut: string;
  }>(candidats, (lot) =>
    supabase
      .from('outbox_events')
      .select('aggregate_id, seq, statut')
      .eq('aggregate_type', 'collecte')
      .eq('event_type', 'collecte.creee')
      .in('aggregate_id', lot),
  );
  if (creations.error) return { data: new Set(), error: creations.error };
  const derniere = new Map<string, { seq: number; statut: string }>();
  for (const l of creations.data) {
    const d = derniere.get(l.aggregate_id);
    if (!d || l.seq > d.seq) derniere.set(l.aggregate_id, l);
  }
  const ids = candidats.filter((id) => derniere.get(id)?.statut === 'dead');
  if (collecteIds || ids.length === 0)
    return { data: new Set(ids), error: null };

  // Mêmes conditions que l'exception (lib/statut-collecte-admin).
  const encore = await lireParLots<{ id: string }>(ids, (lot) =>
    supabase
      .from('collectes')
      .select('id')
      .in('id', lot)
      .eq('statut', 'programmee')
      .eq('statut_tms', 'non_envoye')
      .is('tms_reference', null),
  );
  if (encore.error) return { data: new Set(), error: encore.error };
  return { data: new Set(encore.data.map((c) => c.id)), error: null };
}

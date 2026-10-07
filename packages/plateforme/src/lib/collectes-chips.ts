import { jourParis } from '@savr/shared/src/temps/index.js';
// Prédicats des chips de filtre prédéfinis de la liste collectes (§06.06 §3).
// Source unique partagée par la liste (GET /admin/collectes) et le comptage
// (GET /admin/collectes/chip-counts) → les compteurs ne peuvent pas diverger du
// filtrage réel.

export const CHIP_KEYS = [
  'non_transmises',
  // Miroir EXACT des cartes-actions « Non transmises ZD/AG » du Dashboard Admin
  // (Bloc 1, §11 §1.1) → cibles de clic. Prédicat identique à
  // `api/v1/admin/dashboard/kpi/route.ts` (non_transmises_zd/ag).
  'non_transmises_zd',
  'non_transmises_ag',
  'attente_prestataire',
  'dirty_tms',
  'ag_attente_attribution',
  'zd_48h',
  'ag_48h',
  // Miroir EXACT de la carte Bloc 1 « Collecte <48h non validée » du Dashboard Admin
  // (fusion ex ZD/AG 48h — revue E2E 2026-07-15). Prédicat identique à
  // `api/v1/admin/dashboard/kpi/route.ts` (collectes_48h_non_validees).
  'collectes_48h_non_validees',
] as const;

export type ChipKey = (typeof CHIP_KEYS)[number];

export function isChipKey(value: string): value is ChipKey {
  return (CHIP_KEYS as readonly string[]).includes(value);
}

// Sous-ensemble fluent de PostgrestFilterBuilder utilisé par les prédicats — évite
// d'importer le type générique complet (et l'instanciation « excessively deep »
// TS2589 sur le builder réel). Non générique : les appelants re-castent le résultat
// vers leur type de builder concret (`as typeof query`).
export interface ChipQuery {
  eq(column: string, value: unknown): ChipQuery;
  is(column: string, value: unknown): ChipQuery;
  in(column: string, values: readonly unknown[]): ChipQuery;
  not(column: string, operator: string, value: unknown): ChipQuery;
  gte(column: string, value: unknown): ChipQuery;
  lte(column: string, value: unknown): ChipQuery;
}

// Définition canonique de « à dispatcher » (§11 §1.1, tranchée Val 2026-09-14) :
// non envoyée au TMS, sans référence de commande, encore ouverte (programmée OU
// validée transporteur). Elle vit ici sous deux formes côte à côte : filtre de
// requête (`aDispatcher`) et test d'une ligne déjà chargée (`estADispatcher`).
// Seule la liste des statuts est littéralement partagée ; l'accord des deux
// formes est tenu par tests/api/admin/collectes-chip-counts.m0-6.test.ts. En
// dépendent : les chips « Non transmises ZD/AG », les tuiles « AG/ZD à
// dispatcher » (chip-counts reprend le compteur de ces chips), l'action
// « Dispatcher » de la liste (collectes-table) et l'état « ordre en file
// d'envoi » de la fiche collecte Admin (collecte-detail-panel : collecte à
// dispatcher dont le prestataire adapter est déjà posé). Les cartes Bloc 1 du Dashboard
// Admin (dashboard/kpi/route.ts) en portent encore leur propre copie.
const STATUTS_A_DISPATCHER: readonly string[] = ['programmee', 'validee'];

function aDispatcher(query: ChipQuery): ChipQuery {
  return query
    .eq('statut_tms', 'non_envoye')
    .is('tms_reference', null)
    .in('statut', STATUTS_A_DISPATCHER);
}

export function estADispatcher(row: {
  statut: string;
  statut_tms: string;
  tms_reference: string | null;
}): boolean {
  return (
    row.statut_tms === 'non_envoye' &&
    row.tms_reference === null &&
    STATUTS_A_DISPATCHER.includes(row.statut)
  );
}

// Applique le prédicat d'un chip à une requête collectes. `now` injecté pour la
// testabilité (fenêtres 48h). Chip inconnu = requête inchangée.
export function applyChipPredicate(
  query: ChipQuery,
  chip: string,
  now: Date,
): ChipQuery {
  const today = jourParis(now);
  const in48h = jourParis(new Date(now.getTime() + 48 * 60 * 60 * 1000));

  switch (chip) {
    case 'non_transmises':
      // « Non transmises au TMS » = programmée ET sans référence de commande.
      return query.eq('statut', 'programmee').is('tms_reference', null);
    // « Non transmises ZD/AG » = « à dispatcher » par type, miroir EXACT des
    // cartes Bloc 1 du Dashboard Admin (§11 §1.1). Toute évolution DOIT rester
    // alignée sur dashboard/kpi/route.ts.
    case 'non_transmises_zd':
      return aDispatcher(query.eq('type', 'zero_dechet'));
    case 'non_transmises_ag':
      return aDispatcher(query.eq('type', 'anti_gaspi'));
    case 'attente_prestataire':
      return query.eq('statut_tms', 'attribuee_en_attente_acceptation');
    case 'dirty_tms':
      return query.eq('dirty_tms', true).not('tms_reference', 'is', null);
    case 'ag_attente_attribution':
      // AG programmée SANS attribution encore (anti-jointure : la relation
      // `attributions_antgaspi` doit être embarquée dans le select appelant).
      return query
        .eq('type', 'anti_gaspi')
        .eq('statut', 'programmee')
        .is('attributions_antgaspi', null);
    case 'zd_48h':
      return query
        .eq('type', 'zero_dechet')
        .gte('date_collecte', today)
        .lte('date_collecte', in48h)
        .in('statut', ['programmee', 'validee']);
    case 'ag_48h':
      return query
        .eq('type', 'anti_gaspi')
        .gte('date_collecte', today)
        .lte('date_collecte', in48h)
        .in('statut', ['programmee', 'validee']);
    case 'collectes_48h_non_validees':
      // ZD + AG dans 48 h, encore actives, NON validées par le prestataire
      // (statut_tms hors acceptee/en_attente_execution → inclut non transmises).
      return query
        .in('type', ['zero_dechet', 'anti_gaspi'])
        .gte('date_collecte', today)
        .lte('date_collecte', in48h)
        .in('statut', ['programmee', 'validee'])
        .not('statut_tms', 'in', '("acceptee","en_attente_execution")');
    default:
      return query;
  }
}

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

// Applique le prédicat d'un chip à une requête collectes. `now` injecté pour la
// testabilité (fenêtres 48h). Chip inconnu = requête inchangée.
export function applyChipPredicate(
  query: ChipQuery,
  chip: string,
  now: Date,
): ChipQuery {
  const today = now.toISOString().slice(0, 10);
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  switch (chip) {
    case 'non_transmises':
      // « Non transmises au TMS » = programmée ET sans référence de commande.
      return query.eq('statut', 'programmee').is('tms_reference', null);
    // « Non transmises ZD/AG » = miroir EXACT des cartes Bloc 1 du Dashboard Admin
    // (§11 §1.1) : non envoyée au TMS, sans référence, encore ouverte (programmée
    // OU validée). Toute évolution DOIT rester alignée sur dashboard/kpi/route.ts.
    case 'non_transmises_zd':
      return query
        .eq('type', 'zero_dechet')
        .eq('statut_tms', 'non_envoye')
        .is('tms_reference', null)
        .in('statut', ['programmee', 'validee']);
    case 'non_transmises_ag':
      return query
        .eq('type', 'anti_gaspi')
        .eq('statut_tms', 'non_envoye')
        .is('tms_reference', null)
        .in('statut', ['programmee', 'validee']);
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

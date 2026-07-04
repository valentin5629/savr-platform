// Prédicats des chips de filtre prédéfinis de la liste collectes (§06.06 §3).
// Source unique partagée par la liste (GET /admin/collectes) et le comptage
// (GET /admin/collectes/chip-counts) → les compteurs ne peuvent pas diverger du
// filtrage réel.

export const CHIP_KEYS = [
  'non_transmises',
  'attente_prestataire',
  'dirty_tms',
  'ag_attente_attribution',
  'zd_48h',
  'ag_48h',
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
    default:
      return query;
  }
}

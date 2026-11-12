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
  or(filters: string): ChipQuery;
}

// Définition canonique de « à dispatcher » (§11 §1.1) : soit jamais envoyée
// (non envoyée au TMS, sans référence de commande, programmée OU validée —
// tranchée Val 2026-09-14), soit rejetée par son prestataire et à réattribuer
// (Val 2026-11-03). Le rejet se lit sur `statut` : un seul camion refusé d'une
// collecte validée n'est pas un rejet de la collecte.
// Elle vit ici sous deux formes côte à côte : filtre de requête
// (`FILTRE_A_DISPATCHER`, pour `.or()`) et test d'une ligne déjà chargée
// (`estADispatcher`). L'accord des deux formes est tenu par
// tests/api/admin/collectes-chip-counts.m0-6.test.ts. En dépendent : les chips
// « Non transmises ZD/AG », les tuiles « AG/ZD à dispatcher » (chip-counts
// reprend le compteur de ces chips), l'action « Dispatcher » de la liste
// (collectes-table) et les cartes Bloc 1 du Dashboard Admin
// (dashboard/kpi/route.ts, dashboards/kpi-admin/route.ts).
// L'état « ordre en file d'envoi » de la fiche collecte Admin ne lit que la
// première branche (`estNonEnvoyee`) : une collecte rejetée n'a pas d'envoi en
// cours.
const STATUTS_A_DISPATCHER: readonly string[] = ['programmee', 'validee'];

// « Non validée par le prestataire » (carte « Collectes <48h non validées »,
// chip `collectes_48h_non_validees`) : collecte encore active dont le statut
// TMS ne dit pas l'acceptation. Source unique, lue aussi par le badge
// « Urgent » de la liste Admin (`estUrgente`, décision Val 2026-11-12).
export const STATUTS_48H_NON_VALIDEES: readonly string[] = [
  'programmee',
  'validee',
];
export const STATUTS_TMS_ACCEPTES: readonly string[] = [
  'acceptee',
  'en_attente_execution',
];

/** Collecte active que le prestataire n'a pas acceptée (sans borne de date). */
export function estNonValideeParPrestataire(row: {
  statut: string;
  statut_tms: string;
}): boolean {
  return (
    STATUTS_48H_NON_VALIDEES.includes(row.statut) &&
    !STATUTS_TMS_ACCEPTES.includes(row.statut_tms)
  );
}

export const FILTRE_A_DISPATCHER =
  'and(statut_tms.eq.non_envoye,tms_reference.is.null,statut.in.(programmee,validee)),' +
  'statut.eq.rejetee_par_prestataire';

function aDispatcher(query: ChipQuery): ChipQuery {
  return query.or(FILTRE_A_DISPATCHER);
}

export function estNonEnvoyee(row: {
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

export function estADispatcher(row: {
  statut: string;
  statut_tms: string;
  tms_reference: string | null;
}): boolean {
  return estNonEnvoyee(row) || row.statut === 'rejetee_par_prestataire';
}

// « Modifiée sans renvoi » (arbitrage Val 2026-10-09) : une collecte déjà partie
// vers le prestataire a été modifiée et n'a pas été renvoyée. « Partie puis
// modifiée » est porté par le drapeau `dirty_tms`, que les déclencheurs de
// `collectes` et d'`evenements` arment dès le clic de l'Admin (migration
// 20261009210000) et que le renvoi vide. Ici on ne garde que les collectes
// encore à réaliser : une collecte terminée n'a plus rien à renvoyer.
// Aucune condition sur `tms_reference` : une commande en file d'envoi n'en a pas
// encore, un transporteur joint par mail ou téléphone n'en aura jamais.
// Source unique du chip, de son compteur, de la carte du Dashboard Admin et du
// compteur de la route `dashboards/kpi-admin`.
// Deux formes côte à côte, comme « à dispatcher » : filtre de requête
// (`STATUTS_A_RENVOYER`) et test d'une ligne déjà chargée
// (`estModifieeSansRenvoi`, badge et bouton de la fiche collecte Admin).
export const STATUTS_A_RENVOYER: readonly string[] = [
  'programmee',
  'validee',
  'en_cours',
];

export function estModifieeSansRenvoi(row: {
  dirty_tms: boolean;
  statut: string;
}): boolean {
  return row.dirty_tms && STATUTS_A_RENVOYER.includes(row.statut);
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
    // cartes Bloc 1 du Dashboard Admin (§11 §1.1), qui lisent le même
    // `FILTRE_A_DISPATCHER`.
    case 'non_transmises_zd':
      return aDispatcher(query.eq('type', 'zero_dechet'));
    case 'non_transmises_ag':
      return aDispatcher(query.eq('type', 'anti_gaspi'));
    case 'attente_prestataire':
      return query.eq('statut_tms', 'attribuee_en_attente_acceptation');
    case 'dirty_tms':
      return query.eq('dirty_tms', true).in('statut', STATUTS_A_RENVOYER);
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
        .in('statut', [...STATUTS_48H_NON_VALIDEES])
        .not(
          'statut_tms',
          'in',
          `(${STATUTS_TMS_ACCEPTES.map((s) => `"${s}"`).join(',')})`,
        );
    default:
      return query;
  }
}

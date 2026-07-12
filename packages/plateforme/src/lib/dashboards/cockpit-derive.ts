/**
 * Dérivations pures du dashboard « Cockpit » (R24) — agrégats KPI, séries
 * sparkline, variation N-1, totaux/équivalences CO₂, items de jauges benchmark.
 *
 * Séparé de la page (client) pour être TESTABLE sans jsdom et RÉUTILISABLE par la
 * déclinaison Cockpit des 5 autres dashboards. Aucune donnée n'est inventée : les
 * `co2_*` proviennent figés de `v_kpi_traiteur` (jamais recalculés, §11 l.185) ; les
 * facteurs d'équivalence viennent de `plateforme.parametres_co2_divers` (ADEME,
 * éditables Admin) avec repli sur les constantes ADEME (mêmes que le trigger CO₂ ZD).
 */

/** Une ligne mensuelle de v_kpi_traiteur (grain mois × type × organisation). */
export interface TraiteurKpiRow {
  mois: string;
  type_collecte: 'zero_dechet' | 'anti_gaspi';
  nb_collectes: number;
  tonnage_kg: number | null;
  taux_recyclage_pondere: number | null;
  nb_repas_donnes: number | null;
  marge_zd_ht: number | null;
  pax_total: number;
  co2_evite_kg?: number | null;
  co2_induit_kg?: number | null;
  co2_net_kg?: number | null;
  energie_primaire_evitee_kwh?: number | null;
}

/** Coercition défensive : PostgREST peut renvoyer un numeric en chaîne. */
function num(v: number | string | null | undefined): number {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fenêtre « période précédente équivalente » (N-1) : même durée que [from,to],
 * accolée juste avant `from`. Ex. [2025-07-01, 2026-06-30] → [2024-07-02, 2025-06-30].
 * Bornes ISO `YYYY-MM-DD`. Renvoie `null` si l'une des bornes est absente/invalide.
 */
export function previousWindow(
  from: string | null,
  to: string | null,
): { from: string; to: string } | null {
  if (!from || !to) return null;
  const f = Date.parse(`${from}T00:00:00Z`);
  const t = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(f) || !Number.isFinite(t) || t < f) return null;
  const DAY = 86_400_000;
  const prevTo = f - DAY;
  const prevFrom = prevTo - (t - f);
  const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

export interface KpiAgg {
  nbCollectes: number;
  tonnage: number;
  pax: number;
  repas: number;
  /** Taux de recyclage pondéré par tonnage (%) — null si aucun tonnage tracé. */
  taux: number | null;
  /** kg/pax moyen — null si pax = 0. */
  kgPax: number | null;
  /** Marge ZD HT (€) — null si aucune ligne ne porte de marge. */
  marge: number | null;
}

/**
 * Agrège les lignes mensuelles d'un onglet (déjà mono-type) en un cadran unique.
 * Réplique les formules de la page historique (taux pondéré tonnage, marge = somme
 * des seules lignes portant une marge).
 */
export function aggregateKpis(rows: TraiteurKpiRow[]): KpiAgg {
  const nbCollectes = rows.reduce((s, r) => s + num(r.nb_collectes), 0);
  const tonnage = rows.reduce((s, r) => s + num(r.tonnage_kg), 0);
  const pax = rows.reduce((s, r) => s + num(r.pax_total), 0);
  const repas = rows.reduce((s, r) => s + num(r.nb_repas_donnes), 0);
  const tauxNum = rows.reduce(
    (s, r) => s + num(r.taux_recyclage_pondere) * num(r.tonnage_kg),
    0,
  );
  const tauxDen = rows.reduce(
    (s, r) => s + (r.taux_recyclage_pondere != null ? num(r.tonnage_kg) : 0),
    0,
  );
  const taux = tauxDen > 0 ? tauxNum / tauxDen : null;
  const kgPax = pax > 0 ? tonnage / pax : null;
  const margeRows = rows.filter((r) => r.marge_zd_ht != null);
  const marge =
    margeRows.length > 0
      ? margeRows.reduce((s, r) => s + num(r.marge_zd_ht), 0)
      : null;
  return { nbCollectes, tonnage, pax, repas, taux, kgPax, marge };
}

export interface Co2Totals {
  eviteKg: number;
  induitKg: number;
  netKg: number;
  energieKwh: number;
}

/** Somme des grandeurs CO₂ FIGÉES (jamais recalculées, §11 l.185). */
export function co2Totals(rows: TraiteurKpiRow[]): Co2Totals {
  return {
    eviteKg: rows.reduce((s, r) => s + num(r.co2_evite_kg), 0),
    induitKg: rows.reduce((s, r) => s + num(r.co2_induit_kg), 0),
    netKg: rows.reduce((s, r) => s + num(r.co2_net_kg), 0),
    energieKwh: rows.reduce(
      (s, r) => s + num(r.energie_primaire_evitee_kwh),
      0,
    ),
  };
}

export interface FacteursCo2 {
  /** kgCO₂e par km voiture thermique. */
  km_voiture: number;
  /** kgCO₂e par repas avec bœuf. */
  repas_boeuf: number;
  /** kWh consommés par foyer FR et par an. */
  foyer_kwh: number;
}

/**
 * Repli ADEME identique aux COALESCE du trigger CO₂ ZD (m4_3_co2_zd) : utilisé si
 * `parametres_co2_divers` est illisible (ne bloque jamais l'affichage).
 */
export const FACTEURS_CO2_DEFAUT: FacteursCo2 = {
  km_voiture: 0.218,
  repas_boeuf: 7,
  foyer_kwh: 4500,
};

export interface Co2Equivalences {
  kmVoiture: number;
  repasBoeuf: number;
  foyers: number;
}

/**
 * Équivalences pédagogiques = grandeur figée / facteur (même sens que
 * `buildEquivalences` des PDF). Aucune valeur inventée ; garde anti division par 0.
 */
export function co2Equivalences(
  totals: Co2Totals,
  f: FacteursCo2,
): Co2Equivalences {
  return {
    kmVoiture: f.km_voiture > 0 ? Math.round(totals.eviteKg / f.km_voiture) : 0,
    repasBoeuf:
      f.repas_boeuf > 0 ? Math.round(totals.eviteKg / f.repas_boeuf) : 0,
    foyers: f.foyer_kwh > 0 ? Math.round(totals.energieKwh / f.foyer_kwh) : 0,
  };
}

/**
 * Variation période/période (N-1) en points de %. `null` si la période précédente
 * est vide/nulle (aucune base de comparaison → la carte n'affiche pas de badge).
 */
export function variationPct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Série sparkline : une valeur par mois, triée chronologiquement. Renvoie `[]` si
 * moins de 2 points (la Sparkline se masque d'elle-même sous 2 points).
 */
export function sparkFromRows(
  rows: TraiteurKpiRow[],
  pick: (r: TraiteurKpiRow) => number | string | null | undefined,
): number[] {
  const pts = [...rows]
    .sort((a, b) => a.mois.localeCompare(b.mois))
    .map((r) => num(pick(r)));
  return pts.length >= 2 ? pts : [];
}

/** Ligne renvoyée par f_benchmark_kg_pax_zd (grain flux × type × taille). */
export interface BenchmarkRow {
  flux_code: string;
  kg_par_pax_moyen: number | string;
  nb_collectes_segment: number | string;
}

/**
 * Agrège les segments du benchmark parc en UNE valeur par flux (moyenne pondérée
 * par le nombre de collectes). Un flux sans segment (k-anonymat < 5 masqué par la
 * RPC) est absent de la map → la jauge affiche l'état « n < 5 ».
 */
export function aggregateBenchmarkPerFlux(
  rows: BenchmarkRow[],
): Record<string, number> {
  const acc = new Map<string, { num: number; den: number }>();
  for (const r of rows) {
    const code = r.flux_code;
    const w = num(r.nb_collectes_segment);
    const g = acc.get(code) ?? { num: 0, den: 0 };
    g.num += num(r.kg_par_pax_moyen) * w;
    g.den += w;
    acc.set(code, g);
  }
  const out: Record<string, number> = {};
  for (const [code, g] of acc) if (g.den > 0) out[code] = g.num / g.den;
  return out;
}

export interface GaugeItem {
  label: string;
  value: number | null;
  benchmark: number | null;
}

/**
 * Construit les items des jauges bullet (Bloc 3 ZD) : `value` = mon kg/pax du flux,
 * `benchmark` = moyenne parc. `null` des deux côtés → état insuffisant côté composant.
 */
export function benchmarkItems(
  flux: { code: string; label: string }[],
  mine: Record<string, number>,
  parc: Record<string, number>,
): GaugeItem[] {
  return flux.map((f) => ({
    label: f.label,
    value: f.code in mine ? mine[f.code]! : null,
    benchmark: f.code in parc ? parc[f.code]! : null,
  }));
}

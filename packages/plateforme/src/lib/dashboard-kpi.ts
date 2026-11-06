/**
 * Calcul des KPI Bloc 1 des dashboards collecte (ZD / AG).
 *
 * Logique extraite pour être partagée entre les dashboards client (§06.05) et la
 * vue Admin « Dashboard Client » (§06.06 §2), et testée unitairement.
 *  - ZD  : nb_collectes, tonnage_kg (Σ poids_reel_kg), taux_recyclage_pondere
 *          (moyenne pondérée par tonnage, NULL exclus), kg_par_pax.
 *  - AG  : nb_collectes, nb_repas_donnes (Σ volume_repas_realise), pax_total,
 *          repas_par_pax.
 * Les pax sont ceux des COLLECTES (lot 3, décisions Val Q1 et Q2 du 2026-10-25) :
 * `paxCumules` et `ratioParPax` ci-dessous.
 */

export type DashboardCollecteType = 'zero_dechet' | 'anti_gaspi';

export interface ZdKpi {
  nb_collectes: number;
  tonnage_kg: number;
  taux_recyclage_pondere: number | null;
  kg_par_pax: number | null;
}

export interface AgKpi {
  nb_collectes: number;
  nb_repas_donnes: number;
  pax_total: number;
  repas_par_pax: number | null;
}

export type DashboardKpi = ZdKpi | AgKpi;

interface FluxRow {
  poids_reel_kg?: number | null;
}
interface AttrRow {
  volume_repas_realise?: number | null;
}
export interface DashboardCollecteRow {
  taux_recyclage?: number | null;
  /** Convives de la COLLECTE (`collectes.pax`) ; 0 = inconnu (reprise Bubble). */
  pax?: number | null;
  collecte_flux?: FluxRow[] | null;
  // PostgREST renvoie l'embed en OBJET quand la relation est to-one
  // (attributions_antgaspi.collecte_id UNIQUE) et en TABLEAU sinon → accepter les
  // deux formes, comme partout ailleurs (loaders.ts `attrsOf`, exports, routes
  // gestionnaire). Un mock en tableau seul masque la vraie forme objet en prod.
  attributions_antgaspi?: AttrRow[] | AttrRow | null;
}

export type TailleBracket = 'XS' | 'S' | 'M' | 'L' | 'XL';

export function tailleBracket(pax: number): TailleBracket {
  if (pax < 250) return 'XS';
  if (pax < 500) return 'S';
  if (pax < 750) return 'M';
  if (pax < 1000) return 'L';
  return 'XL';
}

/** Collecte à convives connus (`collectes.pax` > 0 ; 0 = inconnu, reprise Bubble). */
export function aDesConvives(row: { pax?: number | null }): boolean {
  return (row.pax ?? 0) > 0;
}

/**
 * Σ pax des COLLECTES (lot 3, décisions Val Q1, Q2 et Q5 du 2026-10-25) : chaque
 * collecte compte ses propres convives. Deux soirées d'un même événement
 * s'additionnent ; une ZD et une AG du même soir restent chacune dans son onglet
 * (les lignes reçues sont déjà d'un seul type). Une collecte à 0 convive
 * n'ajoute rien.
 */
export function paxCumules(rows: readonly { pax?: number | null }[]): number {
  return rows.reduce(
    (s, r) => s + (aDesConvives(r) ? (r.pax as number) : 0),
    0,
  );
}

/**
 * Ratio par pax (kg/pax, repas/pax) : Σ valeur / Σ pax des seules collectes à
 * convives connus. Une collecte à 0 convive sort du numérateur ET du
 * dénominateur (décisions Val Q1 et Q2 du lot 3), comme du benchmark (lot C1,
 * Q4 du 2026-10-24). null si aucune collecte retenue n'a de convives.
 */
export function ratioParPax<T extends { pax?: number | null }>(
  rows: readonly T[],
  valeur: (row: T) => number,
): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    if (!aDesConvives(r)) continue;
    num += valeur(r);
    den += r.pax as number;
  }
  return den > 0 ? num / den : null;
}

function tonnageOf(row: DashboardCollecteRow): number {
  return (row.collecte_flux ?? []).reduce(
    (s, f) => s + (f.poids_reel_kg ?? 0),
    0,
  );
}

function repasOf(row: DashboardCollecteRow): number {
  const a = row.attributions_antgaspi;
  const attrs = Array.isArray(a) ? a : a ? [a] : [];
  return attrs.reduce((s, x) => s + (x.volume_repas_realise ?? 0), 0);
}

export function emptyKpi(type: DashboardCollecteType): DashboardKpi {
  return type === 'zero_dechet'
    ? {
        nb_collectes: 0,
        tonnage_kg: 0,
        taux_recyclage_pondere: null,
        kg_par_pax: null,
      }
    : {
        nb_collectes: 0,
        nb_repas_donnes: 0,
        pax_total: 0,
        repas_par_pax: null,
      };
}

export function computeDashboardKpi(
  rows: DashboardCollecteRow[],
  type: DashboardCollecteType,
): DashboardKpi {
  if (rows.length === 0) return emptyKpi(type);

  if (type === 'zero_dechet') {
    const tonnage = rows.reduce((s, r) => s + tonnageOf(r), 0);
    // Taux pondéré par tonnage, NULL exclus du numérateur ET du dénominateur.
    const { num, den } = rows.reduce(
      (acc, r) => {
        const kg = tonnageOf(r);
        const taux = r.taux_recyclage ?? null;
        if (taux !== null && kg > 0) {
          return { num: acc.num + taux * kg, den: acc.den + kg };
        }
        return acc;
      },
      { num: 0, den: 0 },
    );
    return {
      nb_collectes: rows.length,
      tonnage_kg: tonnage,
      taux_recyclage_pondere: den > 0 ? num / den : null,
      kg_par_pax: ratioParPax(rows, tonnageOf),
    };
  }

  const repas = rows.reduce((s, r) => s + repasOf(r), 0);
  return {
    nb_collectes: rows.length,
    nb_repas_donnes: repas,
    pax_total: paxCumules(rows),
    repas_par_pax: ratioParPax(rows, repasOf),
  };
}

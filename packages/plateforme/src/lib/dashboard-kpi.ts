/**
 * Calcul des KPI Bloc 1 des dashboards collecte (ZD / AG).
 *
 * Logique extraite pour être partagée entre les dashboards client (§06.05) et la
 * vue Admin « Dashboard Client » (§06.06 §2), et testée unitairement.
 * Réplique exacte de la sémantique de /api/v1/gestionnaire/dashboard :
 *  - ZD  : nb_collectes, tonnage_kg (Σ poids_reel_kg), taux_recyclage_pondere
 *          (moyenne pondérée par tonnage, NULL exclus), kg_par_pax (tonnage / Σ pax).
 *  - AG  : nb_collectes, nb_repas_donnes (Σ volume_repas_realise), pax_total,
 *          repas_par_pax.
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
interface EvtRow {
  pax?: number | null;
}

export interface DashboardCollecteRow {
  taux_recyclage?: number | null;
  evenements?: EvtRow | EvtRow[] | null;
  collecte_flux?: FluxRow[] | null;
  attributions_antgaspi?: AttrRow[] | null;
}

export type TailleBracket = 'XS' | 'S' | 'M' | 'L' | 'XL';

export function tailleBracket(pax: number): TailleBracket {
  if (pax < 250) return 'XS';
  if (pax < 500) return 'S';
  if (pax < 750) return 'M';
  if (pax < 1000) return 'L';
  return 'XL';
}

function evtOf(row: DashboardCollecteRow): EvtRow | undefined {
  const e = Array.isArray(row.evenements) ? row.evenements[0] : row.evenements;
  return e ?? undefined;
}

export function paxOf(row: DashboardCollecteRow): number {
  return evtOf(row)?.pax ?? 0;
}

function tonnageOf(row: DashboardCollecteRow): number {
  return (row.collecte_flux ?? []).reduce(
    (s, f) => s + (f.poids_reel_kg ?? 0),
    0,
  );
}

function repasOf(row: DashboardCollecteRow): number {
  return (row.attributions_antgaspi ?? []).reduce(
    (s, a) => s + (a.volume_repas_realise ?? 0),
    0,
  );
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

  const paxTotal = rows.reduce((s, r) => s + paxOf(r), 0);

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
      kg_par_pax: paxTotal > 0 ? tonnage / paxTotal : null,
    };
  }

  const repas = rows.reduce((s, r) => s + repasOf(r), 0);
  return {
    nb_collectes: rows.length,
    nb_repas_donnes: repas,
    pax_total: paxTotal,
    repas_par_pax: paxTotal > 0 ? repas / paxTotal : null,
  };
}

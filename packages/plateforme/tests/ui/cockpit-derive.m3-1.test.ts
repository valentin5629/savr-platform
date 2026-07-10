/**
 * M3.1 — Dérivations pures du dashboard « Cockpit » (R24). Vérifie les agrégats
 * KPI, la variation N-1, les totaux/équivalences CO₂ (facteurs ADEME), la
 * sparkline dérivée, l'agrégation benchmark par flux et la fenêtre N-1.
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateKpis,
  co2Totals,
  co2Equivalences,
  variationPct,
  sparkFromRows,
  aggregateBenchmarkPerFlux,
  benchmarkItems,
  previousWindow,
  FACTEURS_CO2_DEFAUT,
  type TraiteurKpiRow,
} from '@/lib/dashboards/cockpit-derive';

function row(over: Partial<TraiteurKpiRow>): TraiteurKpiRow {
  return {
    mois: '2026-06-01',
    type_collecte: 'zero_dechet',
    nb_collectes: 0,
    tonnage_kg: 0,
    taux_recyclage_pondere: null,
    nb_repas_donnes: null,
    marge_zd_ht: null,
    pax_total: 0,
    ...over,
  };
}

describe('M3.1 / cockpit-derive', () => {
  it('M3.1/dash_cockpit_agrege_kpis_taux_pondere_marge', () => {
    const rows = [
      row({
        mois: '2026-05-01',
        nb_collectes: 2,
        tonnage_kg: 100,
        taux_recyclage_pondere: 90,
        pax_total: 50,
        marge_zd_ht: 200,
      }),
      row({
        mois: '2026-06-01',
        nb_collectes: 3,
        tonnage_kg: 300,
        taux_recyclage_pondere: 70,
        pax_total: 150,
        marge_zd_ht: 100,
      }),
    ];
    const a = aggregateKpis(rows);
    expect(a.nbCollectes).toBe(5);
    expect(a.tonnage).toBe(400);
    expect(a.pax).toBe(200);
    // taux pondéré tonnage = (90*100 + 70*300)/400 = 75
    expect(a.taux).toBeCloseTo(75, 6);
    // kg/pax = 400/200 = 2
    expect(a.kgPax).toBeCloseTo(2, 6);
    expect(a.marge).toBe(300);
  });

  it('M3.1/dash_cockpit_marge_null_quand_aucune_ligne_marge', () => {
    const a = aggregateKpis([row({ nb_collectes: 1, tonnage_kg: 10 })]);
    expect(a.marge).toBeNull();
    expect(a.taux).toBeNull(); // aucune ligne ne porte de taux
  });

  it('M3.1/dash_cockpit_co2_equivalences_facteurs_ademe', () => {
    const rows = [
      row({
        co2_evite_kg: 121500,
        co2_induit_kg: 8200,
        co2_net_kg: 113300,
        energie_primaire_evitee_kwh: 486000,
      }),
    ];
    const t = co2Totals(rows);
    expect(t.eviteKg).toBe(121500);
    expect(t.netKg).toBe(113300);
    const eq = co2Equivalences(t, FACTEURS_CO2_DEFAUT);
    expect(eq.kmVoiture).toBe(Math.round(121500 / 0.218));
    expect(eq.repasBoeuf).toBe(Math.round(121500 / 7));
    expect(eq.foyers).toBe(Math.round(486000 / 4500)); // 108
  });

  it('M3.1/dash_cockpit_variation_n1', () => {
    expect(variationPct(120, 100)).toBeCloseTo(20, 6);
    expect(variationPct(80, 100)).toBeCloseTo(-20, 6);
    // Période précédente vide/nulle → pas de base de comparaison → null.
    expect(variationPct(50, 0)).toBeNull();
  });

  it('M3.1/dash_cockpit_sparkline_triee_min_2_points', () => {
    const rows = [
      row({ mois: '2026-06-01', tonnage_kg: 300 }),
      row({ mois: '2026-04-01', tonnage_kg: 100 }),
      row({ mois: '2026-05-01', tonnage_kg: 200 }),
    ];
    // Triée chronologiquement (avr, mai, juin).
    expect(sparkFromRows(rows, (r) => r.tonnage_kg)).toEqual([100, 200, 300]);
    // Moins de 2 points → série vide (la Sparkline se masque).
    expect(sparkFromRows([rows[0]!], (r) => r.tonnage_kg)).toEqual([]);
  });

  it('M3.1/dash_cockpit_benchmark_par_flux_pondere', () => {
    const parc = aggregateBenchmarkPerFlux([
      { flux_code: 'biodechet', kg_par_pax_moyen: 1, nb_collectes_segment: 10 },
      { flux_code: 'biodechet', kg_par_pax_moyen: 2, nb_collectes_segment: 30 },
      { flux_code: 'verre', kg_par_pax_moyen: 0.5, nb_collectes_segment: 5 },
    ]);
    // biodechet = (1*10 + 2*30)/40 = 1.75
    expect(parc.biodechet).toBeCloseTo(1.75, 6);
    expect(parc.verre).toBeCloseTo(0.5, 6);

    const items = benchmarkItems(
      [
        { code: 'biodechet', label: 'Biodéchets' },
        { code: 'carton', label: 'Cartons' },
      ],
      { biodechet: 2 },
      parc,
    );
    expect(items[0]).toEqual({
      label: 'Biodéchets',
      value: 2,
      benchmark: 1.75,
    });
    // carton : pas de « Vous » ni de parc (k-anonymat) → insuffisant (null/null).
    expect(items[1]).toEqual({
      label: 'Cartons',
      value: null,
      benchmark: null,
    });
  });

  it('M3.1/dash_cockpit_fenetre_n1_equivalente', () => {
    // Janvier 2026 (span 30 j) → décembre 2025 accolé.
    expect(previousWindow('2026-01-01', '2026-01-31')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    // Bornes manquantes / invalides → null.
    expect(previousWindow(null, '2026-01-31')).toBeNull();
    expect(previousWindow('2026-02-01', '2026-01-01')).toBeNull();
  });
});

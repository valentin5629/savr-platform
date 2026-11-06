// KPI des dashboards — pax des COLLECTES (lot 3, décisions Val Q1 et Q2 du
// 2026-10-25). Remplace le dédoublonnage par événement du lot B : chaque collecte
// compte ses propres convives, et une collecte à 0 convive (reprise Bubble) sort
// du numérateur ET du dénominateur des ratios par pax.
// Les lignes portent aussi le pax de leur ÉVÉNEMENT, celui que lisait l'ancien
// calcul : chaque test rougit s'il revient au pax de l'événement.
import { describe, expect, it } from 'vitest';

import {
  computeDashboardKpi,
  paxCumules,
  ratioParPax,
  type DashboardCollecteRow,
} from '../../src/lib/dashboard-kpi.js';

type Ligne = DashboardCollecteRow & {
  evenements: { id: string; pax: number };
};
const lignes = (rows: Ligne[]): DashboardCollecteRow[] =>
  rows as unknown as DashboardCollecteRow[];

describe('Lot 3 / KPI — pax des collectes', () => {
  it('Lot3/kpi_pax_deux_soirees — deux collectes d’un événement de deux soirées s’additionnent (300 + 200), pas le pax de l’événement', () => {
    const rows = lignes([
      { pax: 300, evenements: { id: 'ev1', pax: 500 } },
      { pax: 200, evenements: { id: 'ev1', pax: 500 } },
    ]);
    expect(paxCumules(rows)).toBe(500);
    const kpi = computeDashboardKpi(
      lignes([
        {
          pax: 300,
          evenements: { id: 'ev1', pax: 800 },
          attributions_antgaspi: [{ volume_repas_realise: 60 }],
        },
      ]),
      'anti_gaspi',
    );
    // Onglet AG d'un événement dont la ZD du même soir comptait 800 convives :
    // seuls les 300 de la collecte AG entrent.
    expect(kpi).toMatchObject({ pax_total: 300, nb_repas_donnes: 60 });
    expect((kpi as { repas_par_pax: number }).repas_par_pax).toBeCloseTo(
      0.2,
      5,
    );
  });

  it('Lot3/kpi_zd_kg_par_pax_filtre_partiel — filtre Type ou Taille qui ne retient qu’une soirée : kg/pax sur ses 300 convives, pas les 800 de l’événement (I5)', () => {
    const rows = lignes([
      {
        pax: 300,
        evenements: { id: 'ev1', pax: 800 },
        collecte_flux: [{ poids_reel_kg: 600 }],
        taux_recyclage: 80,
      },
    ]);
    const kpi = computeDashboardKpi(rows, 'zero_dechet');
    expect(kpi).toMatchObject({ nb_collectes: 1, tonnage_kg: 600 });
    expect((kpi as { kg_par_pax: number }).kg_par_pax).toBeCloseTo(2, 5);
  });

  it('Lot3/kpi_zd_collecte_sans_convives_ecartee — tonnage complet, mais le kg/pax écarte le poids et le pax de la collecte à 0 convive', () => {
    const rows = lignes([
      {
        pax: 200,
        evenements: { id: 'ev1', pax: 200 },
        collecte_flux: [{ poids_reel_kg: 300 }],
      },
      {
        pax: 100,
        evenements: { id: 'ev2', pax: 100 },
        collecte_flux: [{ poids_reel_kg: 100 }],
      },
      {
        pax: 0,
        evenements: { id: 'ev3', pax: 0 },
        collecte_flux: [{ poids_reel_kg: 50 }],
      },
    ]);
    const kpi = computeDashboardKpi(rows, 'zero_dechet');
    expect(kpi).toMatchObject({ nb_collectes: 3, tonnage_kg: 450 });
    // (300 + 100) / (200 + 100), et non 450 / 300
    expect((kpi as { kg_par_pax: number }).kg_par_pax).toBeCloseTo(
      400 / 300,
      5,
    );
  });

  it('Lot3/kpi_ag_collecte_sans_convives_ecartee — repas donnés complets, mais le repas/pax écarte la collecte à 0 convive', () => {
    const rows = lignes([
      {
        pax: 100,
        evenements: { id: 'ev1', pax: 100 },
        attributions_antgaspi: [{ volume_repas_realise: 30 }],
      },
      {
        pax: 0,
        evenements: { id: 'ev1', pax: 100 },
        attributions_antgaspi: [{ volume_repas_realise: 20 }],
      },
    ]);
    const kpi = computeDashboardKpi(rows, 'anti_gaspi');
    expect(kpi).toMatchObject({ nb_repas_donnes: 50, pax_total: 100 });
    expect((kpi as { repas_par_pax: number }).repas_par_pax).toBeCloseTo(
      0.3,
      5,
    );
  });

  it('Lot3/kpi_ratio_aucun_convive — aucune collecte à convives connus : ratio absent (null), jamais une division par 0', () => {
    const rows = lignes([
      {
        pax: 0,
        evenements: { id: 'ev1', pax: 400 },
        collecte_flux: [{ poids_reel_kg: 80 }],
      },
    ]);
    expect(ratioParPax(rows, () => 80)).toBeNull();
    expect(
      (computeDashboardKpi(rows, 'zero_dechet') as { kg_par_pax: unknown })
        .kg_par_pax,
    ).toBeNull();
  });
});

// Régression Dashboard Client Admin (E2E) — l'onglet Anti-gaspi restait vide car
// PostgREST renvoie `attributions_antgaspi` en OBJET (relation to-one :
// attributions_antgaspi.collecte_id UNIQUE), pas en tableau → `repasOf` faisait
// `.reduce` sur un objet → TypeError → l'API renvoyait 500 → la vue basculait sur
// l'état vide. Les tests AG existants mockaient la forme TABLEAU et masquaient le
// bug ; ceux-ci reproduisent la forme OBJET réellement reçue en prod.
describe('AG — embed attributions_antgaspi to-one (objet PostgREST)', () => {
  it('objet unique : repas comptés, aucun crash', () => {
    const rows: DashboardCollecteRow[] = [
      {
        pax: 100,
        // ⚠ OBJET, pas tableau — forme réelle renvoyée par PostgREST.
        attributions_antgaspi: { volume_repas_realise: 30 },
      },
      {
        pax: 50,
        attributions_antgaspi: { volume_repas_realise: 20 },
      },
    ];
    const kpi = computeDashboardKpi(rows, 'anti_gaspi');
    expect(kpi).toMatchObject({
      nb_collectes: 2,
      nb_repas_donnes: 50, // 30 + 20 (avant le fix : TypeError)
      pax_total: 150,
    });
  });

  it('formes objet et tableau mélangées : somme cohérente', () => {
    const rows: DashboardCollecteRow[] = [
      {
        pax: 100,
        attributions_antgaspi: { volume_repas_realise: 30 }, // objet
      },
      {
        pax: 100,
        attributions_antgaspi: [{ volume_repas_realise: 20 }], // tableau
      },
      {
        pax: 100,
        attributions_antgaspi: null, // aucune attribution
      },
    ];
    const kpi = computeDashboardKpi(rows, 'anti_gaspi');
    expect(kpi).toMatchObject({ nb_repas_donnes: 50, pax_total: 300 });
  });
});

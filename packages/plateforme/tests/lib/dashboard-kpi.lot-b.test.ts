// Régression Lot B — M3 : le PAX ne doit pas être double-compté quand un
// événement a 2+ collectes (dédup par evenement_id, comme v_kpi_traiteur).
import { describe, expect, it } from 'vitest';

import {
  computeDashboardKpi,
  paxTotalEvenementsDistincts,
  type DashboardCollecteRow,
} from '../../src/lib/dashboard-kpi.js';

describe('Lot B / M3 — dédup PAX par événement', () => {
  it('paxTotalEvenementsDistincts : un événement à 2 collectes ne compte qu’une fois', () => {
    const rows: DashboardCollecteRow[] = [
      { evenements: { id: 'ev1', pax: 100 } },
      { evenements: { id: 'ev1', pax: 100 } }, // 2e collecte du MÊME événement
      { evenements: { id: 'ev2', pax: 50 } },
    ];
    // Avant le fix : 100 + 100 + 50 = 250. Après : 100 + 50 = 150.
    expect(paxTotalEvenementsDistincts(rows)).toBe(150);
  });

  it('ZD : kg_par_pax utilise le pax dédupliqué (pas gonflé)', () => {
    const rows: DashboardCollecteRow[] = [
      {
        evenements: { id: 'ev1', pax: 200 },
        collecte_flux: [{ poids_reel_kg: 300 }],
        taux_recyclage: 80,
      },
      {
        evenements: { id: 'ev1', pax: 200 }, // même événement
        collecte_flux: [{ poids_reel_kg: 100 }],
        taux_recyclage: 80,
      },
    ];
    const kpi = computeDashboardKpi(rows, 'zero_dechet');
    // tonnage = 400 ; pax distinct = 200 (pas 400) → kg/pax = 2 (et non 1)
    expect(kpi).toMatchObject({ nb_collectes: 2, tonnage_kg: 400 });
    expect((kpi as { kg_par_pax: number }).kg_par_pax).toBeCloseTo(2, 5);
  });

  it('AG : repas_par_pax utilise le pax dédupliqué', () => {
    const rows: DashboardCollecteRow[] = [
      {
        evenements: { id: 'ev1', pax: 100 },
        attributions_antgaspi: [{ volume_repas_realise: 30 }],
      },
      {
        evenements: { id: 'ev1', pax: 100 }, // même événement
        attributions_antgaspi: [{ volume_repas_realise: 20 }],
      },
    ];
    const kpi = computeDashboardKpi(rows, 'anti_gaspi');
    // repas = 50 ; pax distinct = 100 (pas 200) → repas/pax = 0.5 (et non 0.25)
    expect(kpi).toMatchObject({ nb_repas_donnes: 50, pax_total: 100 });
    expect((kpi as { repas_par_pax: number }).repas_par_pax).toBeCloseTo(
      0.5,
      5,
    );
  });

  it('événements distincts : pax sommés normalement', () => {
    const rows: DashboardCollecteRow[] = [
      { evenements: { id: 'ev1', pax: 100 } },
      { evenements: { id: 'ev2', pax: 200 } },
      { evenements: { id: 'ev3', pax: 300 } },
    ];
    expect(paxTotalEvenementsDistincts(rows)).toBe(600);
  });
});

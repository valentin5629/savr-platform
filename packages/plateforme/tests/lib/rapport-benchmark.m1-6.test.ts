/**
 * M1.6 — Bloc benchmark du rapport RSE §12 §1.2 (BL-P1-RPT-01) :
 * resolveRapportBenchmark (jauges + point rouge + snapshot filtres) + buildEquivalences.
 */
import { describe, it, expect, vi } from 'vitest';

import { resolveRapportBenchmark } from '../../src/lib/pdf/rapport-benchmark.js';
import { buildEquivalences } from '../../src/lib/pdf/batch-pdf-j1.js';

function mockSupabase(
  rows: unknown[],
  evt: unknown,
): { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> } {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: evt }),
  };
  return {
    rpc: vi.fn(() => Promise.resolve({ data: rows })),
    from: vi.fn(() => chain),
  };
}

const ROWS = [
  {
    flux_id: 'f1',
    flux_code: 'biodechet',
    flux_nom: 'Biodéchets',
    taille_evenement: 'XS',
    collecte_kg_pax: 0.12,
    benchmark_kg_pax: 0.1,
    nb_collectes_segment: 42,
  },
  {
    flux_id: 'f2',
    flux_code: 'carton',
    flux_nom: 'Cartons',
    taille_evenement: 'XS',
    collecte_kg_pax: 0.05,
    benchmark_kg_pax: null,
    nb_collectes_segment: 0,
  },
];

describe('M1.6 / resolveRapportBenchmark / défaut (batch auto)', () => {
  it('mappe les jauges + résout le segment de la collecte (type + taille) pour légende/snapshot', async () => {
    const evt = {
      evenement: {
        type_evenement_id: 't1',
        type_evenement: { libelle: 'Cocktail' },
      },
    };
    const sb = mockSupabase(ROWS, evt);
    const res = await resolveRapportBenchmark(sb as never, 'col-1');

    expect(res.benchmark_flux).toHaveLength(2);
    expect(res.benchmark_flux[0]).toMatchObject({
      flux_nom: 'Biodéchets',
      collecte_kg_pax: 0.12,
      benchmark_kg_pax: 0.1,
      nb_collectes_segment: 42,
    });
    // Segment < 5 → point rouge null (k-anonymat, rendu « données insuffisantes »).
    expect(res.benchmark_flux[1]!.benchmark_kg_pax).toBeNull();

    // Snapshot filtres = segment propre de la collecte (reproductibilité §1.2 l.69).
    expect(res.filtres_benchmark.type_evenement_ids).toEqual(['t1']);
    expect(res.filtres_benchmark.taille_evenement_codes).toEqual(['XS']);
    expect(res.benchmark_legende).toContain("type d'événement : Cocktail");
    expect(res.benchmark_legende).toContain('taille : XS');
  });
});

describe('M1.6 / resolveRapportBenchmark / filtres choisis (régénération)', () => {
  it('respecte les filtres surchargés sans re-résoudre le type de la collecte', async () => {
    const sb = mockSupabase(ROWS, null);
    const res = await resolveRapportBenchmark(sb as never, 'col-1', {
      periode_debut: '2026-01-01',
      periode_fin: '2026-06-30',
      lieu_ids: ['l1', 'l2'],
      type_evenement_ids: ['t9'],
      taille_evenement_codes: ['M'],
    });
    expect(sb.from).not.toHaveBeenCalled(); // pas de fetch type (fourni)
    expect(res.filtres_benchmark.type_evenement_ids).toEqual(['t9']);
    expect(res.filtres_benchmark.taille_evenement_codes).toEqual(['M']);
    expect(res.filtres_benchmark.lieu_ids).toEqual(['l1', 'l2']);
    expect(res.benchmark_legende).toContain('2026-01-01 → 2026-06-30');
    expect(res.benchmark_legende).toContain('lieux : 2 sélectionné(s)');
  });
});

describe('M1.6 / buildEquivalences (§12 §1.2 l.63/l.65)', () => {
  it('convertit les FACTEURS figés en comptes (km voiture, repas bœuf, foyers)', () => {
    const eq = buildEquivalences(300, 9000, {
      equivalences: { km_voiture: 0.218, repas_boeuf: 7, foyer_kwh: 4500 },
    });
    expect(eq).toEqual({
      km_voiture: Math.round(300 / 0.218), // 1376
      repas_boeuf: Math.round(300 / 7), // 43
      foyer: 2, // 9000 / 4500
    });
  });

  it('retourne undefined sans CO₂ évité ou sans snapshot (bloc masqué)', () => {
    expect(buildEquivalences(null, 9000, { equivalences: {} })).toBeUndefined();
    expect(buildEquivalences(300, 9000, null)).toBeUndefined();
    // Snapshot sans bloc equivalences → undefined.
    expect(buildEquivalences(300, 9000, { autre: 1 })).toBeUndefined();
  });
});

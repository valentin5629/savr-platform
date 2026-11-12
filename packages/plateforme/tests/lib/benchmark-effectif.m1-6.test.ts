/**
 * M1.6 — Effectif du segment comparé, imprimé dans l'annexe du rapport de
 * recyclage @4 (« moyenne Savr sur 24 mois, N collectes ») : le plus grand
 * nombre de collectes parmi les flux, sur les seuls segments que la fonction du
 * parc rend (ceux sous le seuil k-anonymat n'y sont pas).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoad = vi.fn();
vi.mock('@/lib/dashboards/loaders.js', async (orig) => ({
  ...(await orig<typeof import('@/lib/dashboards/loaders.js')>()),
  loadBenchmark: (...a: unknown[]) => mockLoad(...a),
}));

import { chargerParcBenchmark } from '@/lib/collectes/benchmark-fiche.js';

const ctx = {
  userId: 'u1',
  role: 'traiteur_manager' as const,
  organisationId: 'o1',
};
const TOUS = {
  tailleCodes: null,
  typeIds: null,
  lieuIds: null,
  traiteurIds: null,
};

beforeEach(() => vi.clearAllMocks());

describe('M1.6 / effectif du segment comparé (annexe du rapport @4)', () => {
  it('somme des collectes des segments de chaque flux, puis le plus grand des flux', async () => {
    mockLoad.mockResolvedValue([
      {
        flux_code: 'biodechet',
        kg_par_pax_moyen: 0.1,
        nb_collectes_segment: 40,
      },
      {
        flux_code: 'biodechet',
        kg_par_pax_moyen: 0.2,
        nb_collectes_segment: '88',
      },
      { flux_code: 'verre', kg_par_pax_moyen: 0.07, nb_collectes_segment: 60 },
    ]);
    const r = await chargerParcBenchmark({} as never, ctx, TOUS);
    if (r.etat !== 'ok') throw new Error('attendu ok');
    expect(r.effectif).toBe(128);
    // La moyenne par flux reste celle de l'écran (pondérée par l'effectif).
    expect(r.parc.biodechet).toBeCloseTo((0.1 * 40 + 0.2 * 88) / 128, 10);
  });

  it('aucun segment rendu (tout sous le seuil) → effectif 0, jamais imprimé', async () => {
    mockLoad.mockResolvedValue([]);
    const r = await chargerParcBenchmark({} as never, ctx, TOUS);
    if (r.etat !== 'ok') throw new Error('attendu ok');
    expect(r.effectif).toBe(0);
    expect(r.parc).toEqual({});
  });
});

/**
 * M3.1 — GET /api/v1/traiteur/collectes : agrégation des résultats affichés sur la
 * carte « Réalisée » (revue écran 2026-07-15). Couvre la logique SERVEUR ajoutée :
 *  - poids_total_kg = Σ collecte_flux.poids_reel_kg (ZD)
 *  - nb_repas_donnes = Σ attributions_antgaspi.volume_repas_realise (AG), avec
 *    normalisation embed to-one (objet) OU tableau (cache PostgREST)
 *  - les embeds bruts (collecte_flux / attributions_antgaspi) ne fuitent pas au client.
 *
 * Mock du query-builder Supabase chaînable, keyé par table (résout via `.then`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeClient() {
  const results: Record<string, Result> = {};
  function chain(table: string): Record<string, unknown> {
    const res = (): Result => results[table] ?? { data: [], error: null };
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      in: () => c,
      gte: () => c,
      lte: () => c,
      order: () => c,
      limit: () => c,
      then: (resolve: (v: Result) => unknown) => resolve(res()),
    };
    return c;
  }
  return {
    from: (table: string) => chain(table),
    results,
  };
}

let rls = makeClient();
const mockRequireUser = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => rls,
}));

function makeReq(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/traiteur/collectes?${qs}`);
}

async function callGet(qs: string) {
  const { GET } = await import('@/app/api/v1/traiteur/collectes/route.js');
  return GET(makeReq(qs));
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  mockRequireUser.mockResolvedValue({
    ctx: { userId: 'u1', role: 'traiteur_manager', organisationId: 'org-1' },
  });
});

describe('M3.1 / liste traiteur — agrégation résultats collecte réalisée', () => {
  it('M3.1/liste_resultats_zd — poids_total_kg = Σ flux, co2/taux passés, embeds masqués', async () => {
    rls.results.collectes = {
      data: [
        {
          id: 'c-zd',
          type: 'zero_dechet',
          statut: 'cloturee',
          taux_recyclage: 73.8,
          co2_evite_kg: 48.9,
          collecte_flux: [
            { poids_reel_kg: 60 },
            { poids_reel_kg: 37.5 },
            { poids_reel_kg: 22.5 },
            { poids_reel_kg: null },
          ],
          attributions_antgaspi: null,
          evenements: {
            organisation_id: 'org-1',
            traiteur_operationnel_organisation_id: 'org-1',
          },
        },
      ],
      error: null,
    };
    const res = await callGet('type=zero_dechet&statut=cloturee');
    const json = (await res.json()) as { data: Record<string, unknown>[] };
    const row = json.data[0]!;
    expect(row.poids_total_kg).toBe(120); // 60 + 37.5 + 22.5 + (null→0)
    expect(row.nb_repas_donnes).toBe(0);
    expect(row.taux_recyclage).toBe(73.8);
    expect(row.co2_evite_kg).toBe(48.9);
    // Les embeds bruts ne doivent pas fuiter au client.
    expect('collecte_flux' in row).toBe(false);
    expect('attributions_antgaspi' in row).toBe(false);
  });

  it('M3.1/liste_resultats_ag_objet — nb_repas_donnes depuis attribution to-one (objet)', async () => {
    rls.results.collectes = {
      data: [
        {
          id: 'c-ag',
          type: 'anti_gaspi',
          statut: 'cloturee',
          taux_recyclage: null,
          co2_evite_kg: 70,
          collecte_flux: [],
          attributions_antgaspi: { volume_repas_realise: 28 },
          evenements: {
            organisation_id: 'org-1',
            traiteur_operationnel_organisation_id: 'org-1',
          },
        },
      ],
      error: null,
    };
    const res = await callGet('type=anti_gaspi&statut=cloturee');
    const json = (await res.json()) as { data: Record<string, unknown>[] };
    const row = json.data[0]!;
    expect(row.nb_repas_donnes).toBe(28);
    expect(row.poids_total_kg).toBe(0);
  });

  it('M3.1/liste_resultats_ag_tableau — attribution embed en tableau (cache PostgREST)', async () => {
    rls.results.collectes = {
      data: [
        {
          id: 'c-ag2',
          type: 'anti_gaspi',
          statut: 'cloturee',
          co2_evite_kg: 120,
          collecte_flux: null,
          attributions_antgaspi: [{ volume_repas_realise: 40 }],
          evenements: {
            organisation_id: 'org-1',
            traiteur_operationnel_organisation_id: 'org-1',
          },
        },
      ],
      error: null,
    };
    const res = await callGet('type=anti_gaspi&statut=cloturee');
    const json = (await res.json()) as { data: Record<string, unknown>[] };
    expect(json.data[0]!.nb_repas_donnes).toBe(40);
  });

  it('M3.1/liste_resultats_tiers — programmee_par_tiers dérivé conservé', async () => {
    rls.results.collectes = {
      data: [
        {
          id: 'c-tiers',
          type: 'zero_dechet',
          statut: 'cloturee',
          co2_evite_kg: 10,
          collecte_flux: [{ poids_reel_kg: 100 }],
          attributions_antgaspi: null,
          // Événement possédé par une autre org, opéré par org-1 → tiers.
          evenements: {
            organisation_id: 'org-2',
            traiteur_operationnel_organisation_id: 'org-1',
          },
        },
      ],
      error: null,
    };
    const res = await callGet('type=zero_dechet&statut=cloturee');
    const json = (await res.json()) as { data: Record<string, unknown>[] };
    const row = json.data[0]!;
    expect(row.programmee_par_tiers).toBe(true);
    expect(row.poids_total_kg).toBe(100);
  });
});

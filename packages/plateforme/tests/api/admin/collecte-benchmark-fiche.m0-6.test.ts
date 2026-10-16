/**
 * M0.6 — Radar de l'onglet Documents de la fiche collecte Admin (décision Val
 * 2026-10-16 : l'Admin voit le bilan du client, radar et filtres compris).
 *
 * GET /api/v1/admin/collectes/[id]/benchmark : même calcul que la fiche client
 * et que le rapport régénéré par l'Admin — sous l'identité de l'appelant,
 * k-anonymat compris, jamais en service-role.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeClient() {
  const rpcResults: Record<string, Result> = {};
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const api = {
    from: () => {
      throw new Error('aucune lecture de table attendue');
    },
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResults[name] ?? { data: null, error: null });
    },
    rpcResults,
    rpcCalls,
  };
  return api;
}

let rls = makeClient();
let admin = makeClient();
const mockRequireStaff = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireStaff: (...a: unknown[]) => mockRequireStaff(...a),
  createSupabaseServerClient: () => rls,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));

async function get(qs = '') {
  const { GET } =
    await import('@/app/api/v1/admin/collectes/[id]/benchmark/route.js');
  return GET(
    new NextRequest(
      `http://localhost/api/v1/admin/collectes/c1/benchmark${qs}`,
    ),
    { params: Promise.resolve({ id: 'c1' }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  mockRequireStaff.mockResolvedValue({
    ctx: { userId: 'admin-1', role: 'admin_savr', organisationId: null },
  });
});

describe('M0.6 / fiche collecte Admin — radar de l’onglet Documents', () => {
  it('M0.6/admin_fiche_benchmark_sous_identite — ratio de la collecte + repère parc filtré, calculés sous l’identité de l’Admin', async () => {
    rls.rpcResults.f_benchmark_single_collecte = {
      data: [{ flux_code: 'biodechet', ratio_user: 0.42 }],
      error: null,
    };
    rls.rpcResults.f_benchmark_kg_pax_zd = {
      data: [
        {
          flux_code: 'biodechet',
          kg_par_pax_moyen: 0.3,
          nb_collectes_segment: 6,
        },
      ],
      error: null,
    };

    const res = await get(
      '?type_evenement_ids=t1&taille_evenement_codes=L&lieu_ids=l1',
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        flux: Record<string, { ratio_user: number; benchmark_kg_pax: number }>;
      };
    };
    expect(data.flux.biodechet).toEqual({
      ratio_user: 0.42,
      benchmark_kg_pax: 0.3,
    });
    expect(
      rls.rpcCalls.find((c) => c.name === 'f_benchmark_single_collecte')?.args,
    ).toEqual({ p_collecte_id: 'c1' });
    // Les filtres réglés par l'Admin atteignent la fonction du parc.
    expect(
      rls.rpcCalls.find((c) => c.name === 'f_benchmark_kg_pax_zd')?.args,
    ).toMatchObject({
      p_type_evenement_ids: ['t1'],
      p_taille_evenement_codes: ['L'],
      p_lieu_ids: ['l1'],
    });
    // Jamais en service-role : le k-anonymat de la fonction s'applique.
    expect(admin.rpcCalls).toEqual([]);
  });

  it('M0.6/admin_fiche_benchmark_non_staff — refus de requireStaff relayé tel quel, rien n’est lu', async () => {
    mockRequireStaff.mockResolvedValue({
      error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }),
    });
    const res = await get();
    expect(res.status).toBe(403);
    expect(rls.rpcCalls).toEqual([]);
    expect(admin.rpcCalls).toEqual([]);
  });
});

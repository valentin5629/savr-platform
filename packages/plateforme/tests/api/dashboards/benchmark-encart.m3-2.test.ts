/**
 * M3.2 — Encart « Filtres benchmark » (§06.05 Bloc 3, BL-P1-GEST-04).
 * Couvre : endpoint /benchmark/filtres (listes parc, garde traiteur) + forward des
 * 7 params de la route benchmark vers la RPC f_benchmark_kg_pax_zd.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockRpc = vi.fn();
const mockOrder = vi.fn();

const mockClientChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: mockOrder,
};

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: () => mockClientChain,
    rpc: mockRpc,
  }),
}));

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(role: string, orgId = 'org-1'): void {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({ user_role: role, organisation_id: orgId }),
      },
    },
    error: null,
  });
}

function makeReq(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockImplementation((fn: string) => {
    if (fn === 'f_benchmark_lieux_parc')
      return Promise.resolve({
        data: [{ id: 'l1', nom: 'Lieu 1' }],
        error: null,
      });
    if (fn === 'f_benchmark_traiteurs_parc')
      return Promise.resolve({
        data: [{ id: 't1', nom: 'Traiteur 1' }],
        error: null,
      });
    return Promise.resolve({ data: [], error: null });
  });
  mockOrder.mockResolvedValue({
    data: [{ id: 'ty1', libelle: 'Gala' }],
    error: null,
  });
});

describe('M3.2 / encart filtres benchmark', () => {
  it('M3.2/GEST04_filtres_gestionnaire_listes_parc — lieux + traiteurs + types', async () => {
    setupAuth('gestionnaire_lieux');
    const { GET } =
      await import('@/app/api/v1/dashboards/benchmark/filtres/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/benchmark/filtres'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { lieux: unknown[]; traiteurs: unknown[]; types: unknown[] };
    };
    expect(body.data.lieux.length).toBe(1);
    expect(body.data.traiteurs.length).toBe(1);
    expect(body.data.types.length).toBe(1);
    // Le gestionnaire appelle bien la RPC traiteurs (rôle autorisé).
    expect(mockRpc).toHaveBeenCalledWith('f_benchmark_traiteurs_parc');
  });

  it('M3.2/GEST04_filtres_traiteur_sans_liste_traiteurs — préservation compétitive', async () => {
    setupAuth('traiteur_manager');
    const { GET } =
      await import('@/app/api/v1/dashboards/benchmark/filtres/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/benchmark/filtres'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { traiteurs: unknown[] } };
    expect(body.data.traiteurs.length).toBe(0);
    // La RPC traiteurs n'est PAS appelée pour un rôle traiteur.
    expect(mockRpc).not.toHaveBeenCalledWith('f_benchmark_traiteurs_parc');
  });

  it('M3.2/GEST04_route_forward_7_params — encart → RPC f_benchmark_kg_pax_zd', async () => {
    setupAuth('gestionnaire_lieux');
    const { GET } = await import('@/app/api/v1/dashboards/benchmark/route.js');
    const res = await GET(
      makeReq(
        '/api/v1/dashboards/benchmark?flux_code=biodechet&taille_evenement_codes=M,L&type_evenement_ids=ty1&lieu_ids=l1&periode_debut=2026-01-01&periode_fin=2026-06-30',
      ),
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'f_benchmark_kg_pax_zd',
      expect.objectContaining({
        p_taille_evenement_codes: ['M', 'L'],
        p_type_evenement_ids: ['ty1'],
        p_lieu_ids: ['l1'],
        p_periode_debut: '2026-01-01',
        p_periode_fin: '2026-06-30',
      }),
    );
  });

  it('M3.2/GEST04_route_traiteur_lieu_filter_403 — traiteur + traiteur_ids interdit', async () => {
    setupAuth('traiteur_manager');
    const { GET } = await import('@/app/api/v1/dashboards/benchmark/route.js');
    const res = await GET(
      makeReq('/api/v1/dashboards/benchmark?traiteur_ids=t1'),
    );
    expect(res.status).toBe(403);
  });
});

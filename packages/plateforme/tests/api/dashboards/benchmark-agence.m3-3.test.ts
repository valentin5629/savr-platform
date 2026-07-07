/**
 * M3.3 — Bloc 3 ZD agence : accès au benchmark parc (réplique stricte §06.04).
 * R20b active le VRAI Bloc 3 ZD agence (remplace le stub) → le rôle agence doit
 * être autorisé sur /dashboards/benchmark(+/filtres), avec la MÊME garde
 * compétitive que le traiteur (traiteur_ids rejeté, liste traiteurs vide = 4 dims).
 * Corrige le 403 latent (ALLOWED_ROLES sans agence) relevé en revue conformité.
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
  mockRpc.mockResolvedValue({ data: [], error: null });
  mockOrder.mockResolvedValue({
    data: [{ id: 'ty1', libelle: 'Gala' }],
    error: null,
  });
});

describe('M3.3 / Bloc 3 ZD agence — benchmark parc', () => {
  it('M3.3/benchmark_agence_autorise', async () => {
    setupAuth('agence');
    const { GET } = await import('@/app/api/v1/dashboards/benchmark/route.js');
    const res = await GET(
      makeReq('/api/v1/dashboards/benchmark?taille_evenement_codes=M'),
    );
    // Auparavant 403 (ALLOWED_ROLES sans agence) → le point rouge était cassé.
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'f_benchmark_kg_pax_zd',
      expect.any(Object),
    );
  });

  it('M3.3/benchmark_agence_traiteur_ids_rejete', async () => {
    setupAuth('agence');
    const { GET } = await import('@/app/api/v1/dashboards/benchmark/route.js');
    const res = await GET(
      makeReq('/api/v1/dashboards/benchmark?traiteur_ids=t1'),
    );
    // Même garde compétitive que le traiteur (§06.04 l.143).
    expect(res.status).toBe(403);
  });

  it('M3.3/benchmark_filtres_agence_sans_liste_traiteurs', async () => {
    setupAuth('agence');
    const { GET } =
      await import('@/app/api/v1/dashboards/benchmark/filtres/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/benchmark/filtres'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { traiteurs: unknown[] } };
    expect(body.data.traiteurs.length).toBe(0);
    // Variante 4 dimensions : la RPC traiteurs n'est pas appelée pour l'agence.
    expect(mockRpc).not.toHaveBeenCalledWith('f_benchmark_traiteurs_parc');
  });
});

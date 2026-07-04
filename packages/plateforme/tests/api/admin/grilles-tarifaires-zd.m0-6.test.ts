/**
 * M0.6 — API /admin/grilles-tarifaires-zd (BL-P2-04)
 * POST : validation mode (paliers/fixe_variable) + paliers obligatoires + admin-only,
 * création versionnée via RPC rpc_creer_grille_zd (plus de colonne fantôme `methode`).
 * GET : aplatit organisations(count) → nb_organisations + expose `mode`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockRpc = vi.fn();
const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  single: vi.fn(),
  rpc: mockRpc,
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(role: string) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

const validBody = {
  nom: 'Grille test',
  mode: 'paliers',
  est_defaut: false,
  valide_du: '2026-09-01',
  paliers: [{ pax_min: 1, pax_max: 250, prix_base_ht: 450 }],
};

describe('M0.6 — Grilles ZD / POST', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M0.6/grilles-zd/post — 422 si mode manquant', async () => {
    setupAuth('admin_savr');
    const { POST } =
      await import('@/app/api/v1/admin/grilles-tarifaires-zd/route.js');
    const { mode: _drop, ...noMode } = validBody;
    void _drop;
    const res = await POST(
      makeReq('POST', '/api/v1/admin/grilles-tarifaires-zd', noMode),
    );
    expect(res.status).toBe(422);
  });

  it('M0.6/grilles-zd/post — 422 si mode invalide', async () => {
    setupAuth('admin_savr');
    const { POST } =
      await import('@/app/api/v1/admin/grilles-tarifaires-zd/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/grilles-tarifaires-zd', {
        ...validBody,
        mode: 'methode_bidon',
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('mode');
  });

  it('M0.6/grilles-zd/post — 422 si aucun palier', async () => {
    setupAuth('admin_savr');
    const { POST } =
      await import('@/app/api/v1/admin/grilles-tarifaires-zd/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/grilles-tarifaires-zd', {
        ...validBody,
        paliers: [],
      }),
    );
    expect(res.status).toBe(422);
  });

  it('M0.6/grilles-zd/post — 403 si ops_savr (admin-only)', async () => {
    setupAuth('ops_savr');
    const { POST } =
      await import('@/app/api/v1/admin/grilles-tarifaires-zd/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/grilles-tarifaires-zd', validBody),
    );
    expect(res.status).toBe(403);
  });

  it('M0.6/grilles-zd/post — 201 appelle rpc_creer_grille_zd avec mode + paliers', async () => {
    setupAuth('admin_savr');
    mockRpc.mockResolvedValueOnce({
      data: { id: 'g-1', nom: 'Grille test', mode: 'paliers' },
      error: null,
    });
    const { POST } =
      await import('@/app/api/v1/admin/grilles-tarifaires-zd/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/grilles-tarifaires-zd', validBody),
    );
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith(
      'rpc_creer_grille_zd',
      expect.objectContaining({ p_mode: 'paliers', p_nom: 'Grille test' }),
    );
    const call = mockRpc.mock.calls[0]![1] as { p_paliers: unknown[] };
    expect(call.p_paliers).toHaveLength(1);
  });
});

describe('M0.6 — Grilles ZD / GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M0.6/grilles-zd/get — 200 aplatit nb_organisations et expose mode', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.order
      .mockReturnValueOnce(mockSupabaseChain)
      .mockResolvedValueOnce({
        data: [
          {
            id: 'g-1',
            nom: 'Grille standard V1',
            mode: 'paliers',
            est_defaut: true,
            actif: true,
            valide_du: '2026-01-01',
            valide_jusqu: null,
            organisations: [{ count: 3 }],
            tarifs_zero_dechet: [],
          },
        ],
        error: null,
      });
    const { GET } =
      await import('@/app/api/v1/admin/grilles-tarifaires-zd/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/admin/grilles-tarifaires-zd'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { mode: string; nb_organisations: number }[];
    };
    expect(body.data[0]!.nb_organisations).toBe(3);
    expect(body.data[0]!.mode).toBe('paliers');
  });
});

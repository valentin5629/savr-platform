/**
 * M0.6 — API /admin/tarifs-packs-ag/history (BL-P2-07)
 * L'historique = versions de la ligne versionnée (tarifs_packs_ag) enrichies par
 * l'audit_log (« Modifié par » + date). Pas de table _history (garde-fou 1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockChain,
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

function makeReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

describe('M0.6 — Tarifs AG history API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M0.6/tarifs-ag-history/get — 422 si type_pack manquant', async () => {
    setupAuth('admin_savr');
    const { GET } =
      await import('@/app/api/v1/admin/tarifs-packs-ag/history/route.js');
    const res = await GET(makeReq('/api/v1/admin/tarifs-packs-ag/history'));
    expect(res.status).toBe(422);
  });

  it('M0.6/tarifs-ag-history/get — 200 enrichit chaque version avec modifie_par_nom', async () => {
    setupAuth('admin_savr');
    // Séquence terminale : order#1=versions, in#1=chain(audit), order#2=audits, in#2=users
    mockChain.order
      .mockResolvedValueOnce({
        data: [
          {
            id: 'v-1',
            type_pack: 'unitaire',
            credits: 1,
            prix_unitaire_ht: 590,
            montant_total_ht: 590,
            mensualisable: false,
            nb_mensualites: null,
            valide_du: '2026-01-01',
            valide_jusqu_au: null,
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            record_id: 'v-1',
            user_id: 'u-1',
            created_at: '2026-01-01T08:00:00Z',
          },
        ],
        error: null,
      });
    mockChain.in.mockReturnValueOnce(mockChain).mockResolvedValueOnce({
      data: [{ id: 'u-1', prenom: 'Louis', nom: 'Martin' }],
      error: null,
    });

    const { GET } =
      await import('@/app/api/v1/admin/tarifs-packs-ag/history/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/tarifs-packs-ag/history?type_pack=unitaire'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { modifie_par_nom: string }[];
    };
    expect(body.data[0]!.modifie_par_nom).toBe('Louis Martin');
  });
});

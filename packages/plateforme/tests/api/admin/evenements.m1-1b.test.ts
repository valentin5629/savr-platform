/**
 * M1.1b — PATCH /admin/evenements/[id] : l'édition événement Admin passe désormais
 * par fn_modifier_evenement (émet E2 par collecte dispatchée + recalcul volume) au
 * lieu d'un .update() direct silencieux (fix « trou Admin », décision Val 2026-06-26).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
  data: { id: 'e1', pax: 250 },
  error: null,
}));

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({ rpc }),
}));

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

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string) {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}
function makeReq(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/admin/evenements/e1', {
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

beforeEach(() => vi.clearAllMocks());

describe('M1.1b / admin evenements PATCH', () => {
  it('M1.1b/admin_evenement_edit_emet_e2 — PATCH passe par fn_modifier_evenement', async () => {
    setupAuth('admin_savr');
    const { PATCH } =
      await import('@/app/api/v1/admin/evenements/[id]/route.js');
    const res = await PATCH(makeReq({ pax: 250, contact_principal_nom: 'X' }), {
      params: Promise.resolve({ id: 'e1' }),
    });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'fn_modifier_evenement',
      expect.objectContaining({ p_id: 'e1' }),
    );
    const args = rpc.mock.calls[0]![1] as { p_champs_modifies: string[] };
    expect(args.p_champs_modifies).toContain('pax');
  });

  it('M1.1b/admin_evenement_edit_aucun_champ — 422 si rien à modifier', async () => {
    setupAuth('admin_savr');
    const { PATCH } =
      await import('@/app/api/v1/admin/evenements/[id]/route.js');
    const res = await PATCH(makeReq({ co2_net_kg: 9 }), {
      params: Promise.resolve({ id: 'e1' }),
    });
    expect(res.status).toBe(422);
  });
});

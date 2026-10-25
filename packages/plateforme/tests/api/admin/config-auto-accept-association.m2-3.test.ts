/**
 * M2.3 — Auto-accept AG : l'association est obligatoire (décision Val I4 du
 * 2026-10-25, CDC §04 `config_auto_accept_ag` et §06.09 §6). Une règle sans
 * association ne se déclenche jamais : la route Admin la refuse en 422, à la
 * création comme à la modification, sans rien écrire.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
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

const URL = '/api/v1/admin/config-auto-accept';
const routePath = '@/app/api/v1/admin/config-auto-accept/route.js';

describe('M2.3 — config auto-accept : association obligatoire (I4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['absente', {}],
    ['nulle', { association_id: null }],
    ['vide', { association_id: '  ' }],
  ])('POST 422 si association %s, rien n’est écrit', async (_cas, extra) => {
    setupAuth('admin_savr');
    const { POST } = await import(routePath);
    const res = await POST(
      makeReq('POST', URL, { organisation_id: 'org-1', ...extra }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'association_id obligatoire' });
    expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
  });

  it('POST 201 avec une association : elle est écrite telle quelle', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'cfg-1' },
      error: null,
    });
    const { POST } = await import(routePath);
    const res = await POST(
      makeReq('POST', URL, {
        organisation_id: 'org-1',
        association_id: 'asso-1',
      }),
    );
    expect(res.status).toBe(201);
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organisation_id: 'org-1',
        association_id: 'asso-1',
      }),
    );
  });

  it.each([
    ['nulle', null],
    ['vide', ''],
  ])('PATCH 422 si association %s, rien n’est écrit', async (_cas, valeur) => {
    setupAuth('admin_savr');
    const { PATCH } = await import(routePath);
    const res = await PATCH(
      makeReq('PATCH', `${URL}?id=cfg-1`, { association_id: valeur }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'association_id obligatoire' });
    expect(mockSupabaseChain.update).not.toHaveBeenCalled();
  });

  it('PATCH avec une autre association : elle est écrite', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'cfg-1', auto_accept_actif: false },
      error: null,
    });
    const { PATCH } = await import(routePath);
    const res = await PATCH(
      makeReq('PATCH', `${URL}?id=cfg-1`, { association_id: 'asso-2' }),
    );
    expect(res.status).toBe(200);
    expect(mockSupabaseChain.update).toHaveBeenCalledWith({
      association_id: 'asso-2',
    });
  });

  it('PATCH sans association dans le corps (bascule du toggle) : passe', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'cfg-1', auto_accept_actif: true },
      error: null,
    });
    const { PATCH } = await import(routePath);
    const res = await PATCH(
      makeReq('PATCH', `${URL}?id=cfg-1`, { auto_accept_actif: true }),
    );
    expect(res.status).toBe(200);
    expect(mockSupabaseChain.update).toHaveBeenCalledWith({
      auto_accept_actif: true,
    });
  });

  it('POST refusé à un rôle non Admin, avant toute validation', async () => {
    setupAuth('traiteur_manager');
    const { POST } = await import(routePath);
    const res = await POST(makeReq('POST', URL, { organisation_id: 'org-1' }));
    expect(res.status).toBe(403);
    expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
  });
});

/**
 * M1.1b — Tests API /admin/transporteurs
 * Règle critique : code_transporteur_mts1 obligatoire si type_tms=mts1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  ilike: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
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

const BASE_TRANSPORTEUR = {
  nom: 'Strike Paris',
  siren: '123456789',
  adresse: '1 rue Test',
  code_postal: '75001',
  ville: 'Paris',
  types_vehicules: ['camion_16m3'],
  contact_nom: 'Jean Dupont',
  contact_email: 'jean@strike.fr',
  contact_telephone: '0600000000',
};

describe('M1.1b / Transporteurs / Validation MTS-1', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/transporteurs/create — 422 si type_tms=mts1 sans code', async () => {
    setupAuth('admin_savr');
    const { POST } = await import('@/app/api/v1/admin/transporteurs/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/transporteurs', {
        ...BASE_TRANSPORTEUR,
        type_tms: 'mts1',
        // pas de code_transporteur_mts1
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('code_transporteur_mts1');
  });

  it('M1.1b/transporteurs/create — 201 si type_tms=mts1 avec code', async () => {
    setupAuth('admin_savr');
    const created = {
      id: 'tr-1',
      ...BASE_TRANSPORTEUR,
      type_tms: 'mts1',
      code_transporteur_mts1: 'STRIKE-001',
    };
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: created,
      error: null,
    });
    const { POST } = await import('@/app/api/v1/admin/transporteurs/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/transporteurs', {
        ...BASE_TRANSPORTEUR,
        type_tms: 'mts1',
        code_transporteur_mts1: 'STRIKE-001',
      }),
    );
    expect(res.status).toBe(201);
  });

  it('M1.1b/transporteurs/create — 201 si type_tms=autre sans code', async () => {
    setupAuth('admin_savr');
    const created = { id: 'tr-2', ...BASE_TRANSPORTEUR, type_tms: 'autre' };
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: created,
      error: null,
    });
    const { POST } = await import('@/app/api/v1/admin/transporteurs/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/transporteurs', {
        ...BASE_TRANSPORTEUR,
        type_tms: 'autre',
      }),
    );
    expect(res.status).toBe(201);
  });

  it('M1.1b/transporteurs/create — 403 si rôle client', async () => {
    setupAuth('traiteur_manager');
    const { POST } = await import('@/app/api/v1/admin/transporteurs/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/transporteurs', BASE_TRANSPORTEUR),
    );
    expect(res.status).toBe(403);
  });
});

describe('M1.1b / Transporteurs / Modification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/transporteurs/patch — 422 si changement type_tms=mts1 sans code existant', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'tr-1',
        type_tms: 'autre',
        code_transporteur_mts1: null,
        nom: 'Test',
      },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/admin/transporteurs/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/transporteurs/tr-1', {
        type_tms: 'mts1',
      }),
      { params: Promise.resolve({ id: 'tr-1' }) },
    );
    expect(res.status).toBe(422);
  });
});

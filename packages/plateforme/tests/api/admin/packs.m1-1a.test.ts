/**
 * M1.1a — Tests API /admin/packs-antgaspi
 * Scénarios : création, doublon, idempotence, ajustement, annulation, ops peut créer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  is: vi.fn().mockReturnThis(),
  catch: vi.fn().mockResolvedValue(null),
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

function makeReq(
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
  });
}

const PACK_BODY = {
  organisation_id: 'org-1',
  type_pack: 'pack_10',
  credits_initiaux: 10,
  mode_facturation: 'globale_achat',
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('M1.1a / Packs / Création', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/packs/ops-peut-creer — ops_savr peut créer un pack (F2)', async () => {
    setupAuth('ops_savr');
    // Idempotency check → null (pas de doublon)
    mockSupabaseChain.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // idempotency
      .mockResolvedValueOnce({ data: null, error: null }); // pas de pack actif
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'pack-1',
        ...PACK_BODY,
        statut: 'actif',
        credits_consommes: 0,
      },
      error: null,
    });

    const { POST } = await import('@/app/api/v1/admin/packs-antgaspi/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/packs-antgaspi', PACK_BODY, {
        'idempotency-key': 'key-001',
      }),
    );
    expect(res.status).toBe(201);
  });

  it('M1.1a/packs/creation-ok — admin_savr crée un pack', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'pack-2',
        ...PACK_BODY,
        statut: 'actif',
        credits_consommes: 0,
      },
      error: null,
    });

    const { POST } = await import('@/app/api/v1/admin/packs-antgaspi/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/packs-antgaspi', PACK_BODY, {
        'idempotency-key': 'key-002',
      }),
    );
    expect(res.status).toBe(201);
  });

  it('M1.1a/packs/creation-doublon-bloque — 409 si pack actif existe déjà', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // idempotency ok
      .mockResolvedValueOnce({
        data: {
          id: 'pack-existant',
          type_pack: 'pack_10',
          credits_initiaux: 10,
          credits_consommes: 3,
        },
        error: null,
      }); // pack actif trouvé

    const { POST } = await import('@/app/api/v1/admin/packs-antgaspi/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/packs-antgaspi', PACK_BODY, {
        'idempotency-key': 'key-003',
      }),
    );
    expect(res.status).toBe(409);
  });

  it('M1.1a/packs/idempotency-key — 422 si clé manquante', async () => {
    setupAuth('admin_savr');
    const { POST } = await import('@/app/api/v1/admin/packs-antgaspi/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/packs-antgaspi', PACK_BODY),
    );
    expect(res.status).toBe(422);
  });

  it('M1.1a/packs/idempotency-key — 200 si clé déjà connue (pack existant retourné)', async () => {
    setupAuth('admin_savr');
    const existant = { id: 'pack-idem', ...PACK_BODY, statut: 'actif' };
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: existant,
      error: null,
    });

    const { POST } = await import('@/app/api/v1/admin/packs-antgaspi/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/packs-antgaspi', PACK_BODY, {
        'idempotency-key': 'key-idem',
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string };
    expect(json.id).toBe('pack-idem');
  });
});

describe('M1.1a / Packs / Modification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/packs/ajustement — 200 avec motif ≥ 10 chars', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single
      .mockResolvedValueOnce({
        data: {
          id: 'pack-1',
          statut: 'actif',
          credits_initiaux: 10,
          credits_consommes: 3,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'pack-1',
          credits_initiaux: 15,
          credits_consommes: 3,
          statut: 'actif',
        },
        error: null,
      });

    const { PATCH } =
      await import('@/app/api/v1/admin/packs-antgaspi/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/packs-antgaspi/pack-1', {
        action: 'ajuster_credits',
        credits_initiaux: 15,
        motif: 'Correction commerciale client',
      }),
      { params: Promise.resolve({ id: 'pack-1' }) },
    );
    expect(res.status).toBe(200);
  });

  it('M1.1a/packs/ajustement — 422 si motif < 10 chars', async () => {
    setupAuth('admin_savr');
    const { PATCH } =
      await import('@/app/api/v1/admin/packs-antgaspi/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/packs-antgaspi/pack-1', {
        action: 'ajuster_credits',
        credits_initiaux: 15,
        motif: 'Court',
      }),
      { params: Promise.resolve({ id: 'pack-1' }) },
    );
    expect(res.status).toBe(422);
  });

  it('M1.1a/packs/annulation — 200 pour pack actif', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single
      .mockResolvedValueOnce({
        data: {
          id: 'pack-1',
          statut: 'actif',
          credits_initiaux: 10,
          credits_consommes: 2,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'pack-1', statut: 'annule', credits_consommes: 2 },
        error: null,
      });

    const { PATCH } =
      await import('@/app/api/v1/admin/packs-antgaspi/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/packs-antgaspi/pack-1', {
        action: 'annuler',
        motif: 'Annulation à la demande du client',
      }),
      { params: Promise.resolve({ id: 'pack-1' }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { statut: string };
    expect(json.statut).toBe('annule');
  });

  it('M1.1a/packs/annulation — 422 si pack déjà épuisé', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'pack-1',
        statut: 'epuise',
        credits_initiaux: 10,
        credits_consommes: 10,
      },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/admin/packs-antgaspi/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/packs-antgaspi/pack-1', {
        action: 'annuler',
        motif: 'Tentative annulation invalide',
      }),
      { params: Promise.resolve({ id: 'pack-1' }) },
    );
    expect(res.status).toBe(422);
  });
});

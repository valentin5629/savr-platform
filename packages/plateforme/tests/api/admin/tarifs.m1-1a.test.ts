/**
 * M1.1a — Tests API tarifs (grilles ZD, tarifs packs AG, remises négociées)
 * Scénarios : lecture ouverte au staff, écriture admin uniquement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockInsertChain = { select: vi.fn().mockReturnThis(), single: vi.fn() };
const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn(() => mockInsertChain),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
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
    data: { session: { access_token: makeJwt({ role }) } },
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

// ── Grilles tarifaires ZD ─────────────────────────────────────────────────

describe('M1.1a / Grilles tarifaires ZD / Lecture', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/grilles-zd — 200 GET staff', async () => {
    setupAuth('ops_savr');
    // .order().order() : la chaîne retourne mockSupabaseChain (mockReturnThis).
    // await retourne {data:undefined, error:undefined} → route renvoie {data:[]} 200.
    const { GET } =
      await import('@/app/api/v1/admin/grilles-tarifaires-zd/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/admin/grilles-tarifaires-zd'),
    );
    expect(res.status).toBe(200);
  });

  it('M1.1a/grilles-zd — 403 POST si ops', async () => {
    setupAuth('ops_savr');
    const { POST } =
      await import('@/app/api/v1/admin/grilles-tarifaires-zd/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/grilles-tarifaires-zd', {
        nom: 'Test',
        methode: 'forfait',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('M1.1a/grilles-zd — 401 si non auth', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const { GET } =
      await import('@/app/api/v1/admin/grilles-tarifaires-zd/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/admin/grilles-tarifaires-zd'),
    );
    expect(res.status).toBe(401);
  });
});

// ── Tarifs packs AG ───────────────────────────────────────────────────────

describe('M1.1a / Tarifs packs AG / Lecture', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/tarifs-packs-ag — 200 GET staff', async () => {
    setupAuth('ops_savr');
    // .lte().or().order() → mockReturnThis pour toute la chaîne → 200 data:[]
    const { GET } = await import('@/app/api/v1/admin/tarifs-packs-ag/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/tarifs-packs-ag'));
    expect(res.status).toBe(200);
  });

  it('M1.1a/tarifs-packs-ag — 403 POST si ops', async () => {
    setupAuth('ops_savr');
    const { POST } =
      await import('@/app/api/v1/admin/tarifs-packs-ag/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/tarifs-packs-ag', {
        type_pack: 'standard',
        tarif_ht: 500,
        credits: 10,
      }),
    );
    expect(res.status).toBe(403);
  });
});

// ── Remises négociées ─────────────────────────────────────────────────────

describe('M1.1a / Remises négociées / Lecture', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/tarifs-negocie — 200 GET staff', async () => {
    setupAuth('ops_savr');
    // chaîne eq/order → mockReturnThis → 200 data:[]
    const { GET } = await import('@/app/api/v1/admin/tarifs-negocie/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/tarifs-negocie'));
    expect(res.status).toBe(200);
  });

  it('M1.1a/tarifs-negocie — 403 POST si ops', async () => {
    setupAuth('ops_savr');
    const { POST } = await import('@/app/api/v1/admin/tarifs-negocie/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/tarifs-negocie', {
        organisation_id: 'org-1',
        remise_pct: 10,
      }),
    );
    expect(res.status).toBe(403);
  });
});

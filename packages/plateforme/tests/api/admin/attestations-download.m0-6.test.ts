/**
 * M0.6 — Download attestation de don AG (BL-P1-BOA-07, Bloc 3 Documents).
 * Règle métier critique : embargo H+24 jamais contournable, même admin
 * (HTTP 425 si now() < eligible_at). + 202 si PDF pas encore généré, 404 introuvable,
 * 200 (URL R2 pré-signée) sinon.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let attestationResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};

const chain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(async () => attestationResult),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => chain,
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getPresignedUrl: async () => 'https://r2/signed-attestation',
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

function setupAuth(role = 'admin_savr') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

async function callGet(id: string) {
  const { GET } =
    await import('@/app/api/v1/admin/attestations/[id]/download/route.js');
  return GET(
    new NextRequest(
      `http://localhost/api/v1/admin/attestations/${id}/download`,
    ),
    { params: Promise.resolve({ id }) },
  );
}

const H24 = 24 * 3600 * 1000;

describe('M0.6 — download attestation AG (BL-P1-BOA-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
  });

  it('M0.6 — embargo H+24 : 425 tant que now() < eligible_at (jamais contournable admin)', async () => {
    attestationResult = {
      data: {
        id: 'a1',
        statut: 'emise',
        eligible_at: new Date(Date.now() + H24).toISOString(),
        genere_at: new Date().toISOString(),
        pdf_url: 'rapports/a1.pdf',
      },
      error: null,
    };
    const res = await callGet('a1');
    expect(res.status).toBe(425);
  });

  it('M0.6 — hors embargo + PDF généré : 200 + URL R2 pré-signée', async () => {
    attestationResult = {
      data: {
        id: 'a1',
        statut: 'emise',
        eligible_at: new Date(Date.now() - H24).toISOString(),
        genere_at: new Date(Date.now() - H24).toISOString(),
        pdf_url: 'rapports/a1.pdf',
      },
      error: null,
    };
    const res = await callGet('a1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe('https://r2/signed-attestation');
  });

  it('M0.6 — PDF pas encore généré (genere_at null) : 202', async () => {
    attestationResult = {
      data: {
        id: 'a1',
        statut: 'en_attente',
        eligible_at: new Date(Date.now() - H24).toISOString(),
        genere_at: null,
        pdf_url: null,
      },
      error: null,
    };
    const res = await callGet('a1');
    expect(res.status).toBe(202);
  });

  it('M0.6 — attestation introuvable : 404', async () => {
    attestationResult = { data: null, error: { message: 'not found' } };
    const res = await callGet('nope');
    expect(res.status).toBe(404);
  });
});

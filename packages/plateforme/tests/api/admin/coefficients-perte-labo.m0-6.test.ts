/**
 * M0.6 — BL-P2-32 : Coefficient de perte labo (CDC §08 §9bis).
 * Route nested `/admin/organisations/{id}/coefficients-perte-labo` : organisation
 * dans le PATH (jamais le body), contrôle `type='traiteur'` (422), annee_reference
 * bornée (422), doublon (org, année) → 409, `annee_application = annee_reference + 1`
 * calculé serveur. Écriture admin_savr uniquement, lecture admin + ops.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn(),
  maybeSingle: vi.fn(),
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

const ORG = 'org-traiteur-1';
const URL = `/api/v1/admin/organisations/${ORG}/coefficients-perte-labo`;
const routePath =
  '@/app/api/v1/admin/organisations/[id]/coefficients-perte-labo/route.js';

describe('M0.6 — Coefficient de perte labo (BL-P2-32)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M0.6 — POST 422 si organisation non traiteur (contrôle type)', async () => {
    setupAuth('admin_savr');
    // org existe mais type='agence' → 422
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: { id: ORG, type: 'agence' },
      error: null,
    });
    const { POST } = await import(routePath);
    const res = await POST(
      makeReq('POST', URL, {
        annee_reference: 2025,
        coefficient_kg_couvert: 0.15,
      }),
      { params: Promise.resolve({ id: ORG }) },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('traiteur');
    // Aucun INSERT du coefficient (single jamais atteint).
    expect(mockSupabaseChain.single).not.toHaveBeenCalled();
  });

  it('M0.6 — POST 404 si organisation inconnue', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const { POST } = await import(routePath);
    const res = await POST(
      makeReq('POST', URL, {
        annee_reference: 2025,
        coefficient_kg_couvert: 0.15,
      }),
      { params: Promise.resolve({ id: ORG }) },
    );
    expect(res.status).toBe(404);
  });

  it('M0.6 — POST 422 si annee_reference hors borne', async () => {
    setupAuth('admin_savr');
    const { POST } = await import(routePath);
    const res = await POST(
      makeReq('POST', URL, {
        annee_reference: 1999,
        coefficient_kg_couvert: 0.15,
      }),
      { params: Promise.resolve({ id: ORG }) },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('annee_reference');
  });

  it('M0.6 — POST 422 si coefficient < 0', async () => {
    setupAuth('admin_savr');
    const { POST } = await import(routePath);
    const res = await POST(
      makeReq('POST', URL, {
        annee_reference: 2025,
        coefficient_kg_couvert: -0.1,
      }),
      { params: Promise.resolve({ id: ORG }) },
    );
    expect(res.status).toBe(422);
  });

  it('M0.6 — POST 201 traiteur : org du PATH, annee_application dérivée', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: { id: ORG, type: 'traiteur' },
      error: null,
    });
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'coef-1',
        organisation_id: ORG,
        annee_reference: 2025,
        coefficient_kg_couvert: 0.15,
      },
      error: null,
    });
    const { POST } = await import(routePath);
    const res = await POST(
      makeReq('POST', URL, {
        annee_reference: 2025,
        coefficient_kg_couvert: 0.15,
      }),
      { params: Promise.resolve({ id: ORG }) },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      organisation_id: string;
      annee_application: number;
    };
    // Organisation prise du PATH, pas du body.
    expect(body.organisation_id).toBe(ORG);
    expect(body.annee_application).toBe(2026);
    // L'INSERT porte bien l'organisation du path + l'auteur.
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ organisation_id: ORG, saisi_par: 'user-1' }),
    );
  });

  it('M0.6 — POST 409 si doublon (organisation, annee_reference)', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: { id: ORG, type: 'traiteur' },
      error: null,
    });
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    const { POST } = await import(routePath);
    const res = await POST(
      makeReq('POST', URL, {
        annee_reference: 2025,
        coefficient_kg_couvert: 0.15,
      }),
      { params: Promise.resolve({ id: ORG }) },
    );
    expect(res.status).toBe(409);
  });

  it('M0.6 — POST 403 si ops_savr (écriture admin-only)', async () => {
    setupAuth('ops_savr');
    const { POST } = await import(routePath);
    const res = await POST(
      makeReq('POST', URL, {
        annee_reference: 2025,
        coefficient_kg_couvert: 0.15,
      }),
      { params: Promise.resolve({ id: ORG }) },
    );
    expect(res.status).toBe(403);
  });

  it('M0.6 — GET 200 : ops_savr lecture, annee_application = annee_reference + 1', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.order.mockResolvedValueOnce({
      data: [
        {
          id: 'coef-1',
          organisation_id: ORG,
          annee_reference: 2025,
          coefficient_kg_couvert: 0.15,
          source_commentaire: null,
          saisi_par: 'user-1',
          saisi_le: '2026-05-22T10:00:00Z',
          saisi_par_user: { prenom: 'Val', nom: 'X' },
        },
      ],
      error: null,
    });
    const { GET } = await import(routePath);
    const res = await GET(makeReq('GET', URL), {
      params: Promise.resolve({ id: ORG }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { annee_application: number }[];
    };
    expect(body.data[0]?.annee_application).toBe(2026);
  });
});

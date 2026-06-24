/**
 * M1.1b — Saisie/édition manuelle des pesées ZD (PATCH /admin/collectes/[id]/flux).
 * BL-P0-01 (2e volet) : endpoint Admin d'édition collecte_flux.poids_reel_kg, motif
 * obligatoire + audit_log, UPSERT par (collecte_id, flux_id), 409 si cloturee.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Client admin séquentiel (chaque await/single consomme la réponse suivante).
let adminClient: ReturnType<typeof makeSeqSupabase>;
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => adminClient,
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

function setupAuth(role: string, userId = 'user-1'): void {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

function makeReq(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/admin/collectes/col-1/flux', {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

const PARAMS = { params: Promise.resolve({ id: 'col-1' }) };

function makeSeqSupabase(responses: Array<Record<string, unknown>>) {
  let idx = 0;
  const next = (): Record<string, unknown> => ({
    data: null,
    error: null,
    ...responses[idx++],
  });
  const chain: Record<string, unknown> = {
    then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
      return Promise.resolve(next()).then(onF, onR);
    },
    single: vi.fn(() => Promise.resolve(next())),
    maybeSingle: vi.fn(() => Promise.resolve(next())),
  };
  for (const m of [
    'select',
    'insert',
    'update',
    'upsert',
    'eq',
    'in',
    'is',
    'not',
    'or',
    'order',
    'range',
    'gte',
    'lte',
  ]) {
    chain[m] = vi.fn(() => chain);
  }
  return { from: vi.fn(() => chain), _chain: chain };
}

beforeEach(() => vi.clearAllMocks());

describe('M1.1b / Pesées ZD / Saisie manuelle', () => {
  it('M1.1b/flux/manuel — 422 si motif < 5 caractères', async () => {
    setupAuth('admin_savr');
    adminClient = makeSeqSupabase([]);
    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/flux/route.js');
    const res = await PATCH(
      makeReq('PATCH', {
        pesees: [{ flux_code: 'biodechet', poids_reel_kg: 10 }],
        motif: 'abc',
      }),
      PARAMS,
    );
    expect(res.status).toBe(422);
  });

  it('M1.1b/flux/manuel — 422 si flux_code inconnu', async () => {
    setupAuth('admin_savr');
    adminClient = makeSeqSupabase([]);
    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/flux/route.js');
    const res = await PATCH(
      makeReq('PATCH', {
        pesees: [{ flux_code: 'plastique_inexistant', poids_reel_kg: 10 }],
        motif: 'Correction terrain',
      }),
      PARAMS,
    );
    expect(res.status).toBe(422);
  });

  it('M1.1b/flux/manuel — 422 si poids négatif', async () => {
    setupAuth('admin_savr');
    adminClient = makeSeqSupabase([]);
    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/flux/route.js');
    const res = await PATCH(
      makeReq('PATCH', {
        pesees: [{ flux_code: 'biodechet', poids_reel_kg: -5 }],
        motif: 'Correction terrain',
      }),
      PARAMS,
    );
    expect(res.status).toBe(422);
  });

  it('M1.1b/flux/manuel — 404 si collecte inconnue', async () => {
    setupAuth('admin_savr');
    adminClient = makeSeqSupabase([
      { data: null, error: { code: 'PGRST116' } },
    ]);
    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/flux/route.js');
    const res = await PATCH(
      makeReq('PATCH', {
        pesees: [{ flux_code: 'biodechet', poids_reel_kg: 10 }],
        motif: 'Correction terrain',
      }),
      PARAMS,
    );
    expect(res.status).toBe(404);
  });

  it('M1.1b/flux/manuel — 409 si collecte cloturee (correction via avoir)', async () => {
    setupAuth('admin_savr');
    adminClient = makeSeqSupabase([
      { data: { id: 'col-1', type: 'zero_dechet', statut: 'cloturee' } },
    ]);
    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/flux/route.js');
    const res = await PATCH(
      makeReq('PATCH', {
        pesees: [{ flux_code: 'biodechet', poids_reel_kg: 10 }],
        motif: 'Correction terrain',
      }),
      PARAMS,
    );
    expect(res.status).toBe(409);
  });

  it('M1.1b/flux/manuel — 200 : UPSERT poids_reel_kg + audit_log avec motif', async () => {
    setupAuth('admin_savr');
    adminClient = makeSeqSupabase([
      // 1. select collecte
      { data: { id: 'col-1', type: 'zero_dechet', statut: 'en_cours' } },
      // 2. flux_dechets resolution
      {
        data: [
          { id: 'fbio', code: 'biodechet' },
          { id: 'fcar', code: 'carton' },
        ],
      },
      // 3. snapshot avant
      { data: [] },
      // 4. upsert .select() → après
      {
        data: [
          { flux_id: 'fbio', poids_reel_kg: 120 },
          { flux_id: 'fcar', poids_reel_kg: 30 },
        ],
      },
      // 5. audit_log insert
      { data: null },
    ]);
    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/flux/route.js');
    const res = await PATCH(
      makeReq('PATCH', {
        pesees: [
          { flux_code: 'biodechet', poids_reel_kg: 120 },
          { flux_code: 'carton', poids_reel_kg: 30 },
        ],
        motif: 'Saisie manuelle — pesées MTS-1 manquantes (R9)',
      }),
      PARAMS,
    );
    expect(res.status).toBe(200);

    // UPSERT par (collecte_id, flux_id)
    const upsertSpy = adminClient._chain.upsert as ReturnType<typeof vi.fn>;
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          collecte_id: 'col-1',
          flux_id: 'fbio',
          poids_reel_kg: 120,
        }),
      ]),
      expect.objectContaining({ onConflict: 'collecte_id,flux_id' }),
    );

    // audit_log avec motif obligatoire
    const insertSpy = adminClient._chain.insert as ReturnType<typeof vi.fn>;
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        table_name: 'collecte_flux',
        action: 'UPDATE',
        motif: 'Saisie manuelle — pesées MTS-1 manquantes (R9)',
      }),
    );
  });

  it('M1.1b/flux/manuel — 401 sans session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    adminClient = makeSeqSupabase([]);
    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/flux/route.js');
    const res = await PATCH(
      makeReq('PATCH', {
        pesees: [{ flux_code: 'biodechet', poids_reel_kg: 10 }],
        motif: 'Correction terrain',
      }),
      PARAMS,
    );
    expect(res.status).toBe(401);
  });

  // Cloisonnement multi-org : l'endpoint bypasse RLS (service_role) → requireStaff
  // est l'UNIQUE garde. On prouve qu'un rôle client est rejeté (403) et que le
  // 2e rôle staff autorisé (ops_savr, §06.06 l.278) passe (200).
  it('M1.1b/flux/manuel — 403 si rôle client (traiteur_manager)', async () => {
    setupAuth('traiteur_manager');
    adminClient = makeSeqSupabase([]);
    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/flux/route.js');
    const res = await PATCH(
      makeReq('PATCH', {
        pesees: [{ flux_code: 'biodechet', poids_reel_kg: 10 }],
        motif: 'Tentative édition pesées par un client',
      }),
      PARAMS,
    );
    expect(res.status).toBe(403);
  });

  it('M1.1b/flux/manuel — 200 pour ops_savr (2e rôle staff autorisé)', async () => {
    setupAuth('ops_savr');
    adminClient = makeSeqSupabase([
      { data: { id: 'col-1', type: 'zero_dechet', statut: 'en_cours' } },
      { data: [{ id: 'fbio', code: 'biodechet' }] },
      { data: [] },
      { data: [{ flux_id: 'fbio', poids_reel_kg: 80 }] },
      { data: null },
    ]);
    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/flux/route.js');
    const res = await PATCH(
      makeReq('PATCH', {
        pesees: [{ flux_code: 'biodechet', poids_reel_kg: 80 }],
        motif: 'Saisie Ops — pesée corrigée',
      }),
      PARAMS,
    );
    expect(res.status).toBe(200);
  });
});

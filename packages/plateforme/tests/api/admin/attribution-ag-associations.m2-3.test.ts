/**
 * M2.3 — GET /api/v1/admin/attributions-ag/[collecteId]/associations : toutes les
 * associations actives triées par distance au lieu de la collecte (liste
 * déroulante de l'écran d'attribution, décision Val 2026-09-17).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let collecteResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};
let assosResult: { data: unknown; error: unknown } = { data: [], error: null };
const calls: { table: string; method: string; args: unknown[] }[] = [];

function chainFor(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit']) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: m, args });
      return chain;
    });
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve(collecteResult));
  chain.then = (resolve: (v: unknown) => unknown) =>
    resolve(table === 'associations' ? assosResult : collecteResult);
  return chain;
}

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({ from: (t: string) => chainFor(t) }),
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

function setupAuth(role: string) {
  const jwt = `h.${Buffer.from(JSON.stringify({ user_role: role, sub: 'u1' })).toString('base64url')}.s`;
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: jwt } },
    error: null,
  });
}

const COL = '11111111-2222-4333-8444-555555555555';

async function appel(collecteId = COL) {
  const { GET } =
    await import('@/app/api/v1/admin/attributions-ag/[collecteId]/associations/route.js');
  return GET(
    new NextRequest(
      `http://localhost/api/v1/admin/attributions-ag/${collecteId}/associations`,
    ),
    { params: Promise.resolve({ collecteId }) },
  );
}

beforeEach(() => {
  calls.length = 0;
  collecteResult = { data: null, error: null };
  assosResult = { data: [], error: null };
});

describe('M2.3 / GET attributions-ag/[collecteId]/associations', () => {
  it('renvoie les associations actives triées par distance au lieu de la collecte', async () => {
    setupAuth('admin_savr');
    collecteResult = {
      data: {
        id: COL,
        evenements: { lieux: { latitude: 48.8566, longitude: 2.3522 } },
      },
      error: null,
    };
    assosResult = {
      data: [
        {
          id: 'loin',
          nom: 'Loin',
          ville: 'Rouen',
          region: 'province',
          capacite_max_beneficiaires: 50,
          habilitee_attestation_fiscale: false,
          latitude: 49.4431,
          longitude: 1.0993,
        },
        {
          id: 'sans',
          nom: 'Sans GPS',
          ville: 'Paris',
          region: 'idf',
          capacite_max_beneficiaires: null,
          habilitee_attestation_fiscale: true,
          latitude: null,
          longitude: null,
        },
        {
          id: 'pres',
          nom: 'Près',
          ville: 'Paris',
          region: 'idf',
          capacite_max_beneficiaires: 300,
          habilitee_attestation_fiscale: true,
          latitude: 48.86,
          longitude: 2.36,
        },
      ],
      error: null,
    };

    const res = await appel();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; distance_km: number | null }[];
    };
    expect(body.data.map((a) => a.id)).toEqual(['pres', 'loin', 'sans']);
    expect(body.data[2]!.distance_km).toBeNull();
    // Filtres réellement posés : collecte AG ciblée, associations actives seules.
    expect(calls).toContainEqual({
      table: 'collectes',
      method: 'eq',
      args: ['id', COL],
    });
    expect(calls).toContainEqual({
      table: 'collectes',
      method: 'eq',
      args: ['type', 'anti_gaspi'],
    });
    expect(calls).toContainEqual({
      table: 'associations',
      method: 'eq',
      args: ['actif', true],
    });
  });

  it('404 si la collecte AG est introuvable', async () => {
    setupAuth('admin_savr');
    const res = await appel();
    expect(res.status).toBe(404);
  });

  it('404 sans requête base si l’identifiant n’est pas un UUID', async () => {
    setupAuth('admin_savr');
    const res = await appel('pas-un-uuid');
    expect(res.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('403 pour un rôle client, sans aucune requête base', async () => {
    setupAuth('traiteur_manager');
    const res = await appel();
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('401 sans session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const res = await appel();
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });
});

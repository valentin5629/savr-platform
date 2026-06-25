/**
 * Tests API RGPD self-service (M0.4 — BL-P0-09 / BL-P1-OBS-04 / BL-P2-27).
 *
 * Couvre les 3 droits câblés derrière /api/me/* (transverse, tous rôles) :
 *   · POST /api/me/demande-suppression — crée une demande en_attente, AUCUNE
 *     anonymisation immédiate (pas d'écriture users, pas de RPC).
 *   · GET  /api/me/export-rgpd         — renvoie les PII de l'utilisateur (self).
 *   · PATCH /api/me/profil             — rectifie {prenom,nom}, rejette le reste.
 *
 * RLS (self-scoping, cross-org) testé au niveau DB par supabase/tests/r7_rgpd_*.sql.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

let calls: Array<{ op: string; table: string; payload?: unknown }> = [];
let results: Record<string, Result> = {};

function res(key: string): Result {
  return results[key] ?? { data: null, error: null };
}

function makeChain(table: string, op: string, payload?: unknown): unknown {
  calls.push({ op, table, payload });
  const key = `${op}:${table}`;
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve(res(key)),
    maybeSingle: () => Promise.resolve(res(key)),
    single: () => Promise.resolve(res(key)),
    then: (resolve: (v: Result) => void) => resolve(res(key)),
  };
  return chain;
}

const mockSupabase = {
  from: (table: string) => ({
    select: (sel?: unknown) => makeChain(table, 'select', sel),
    insert: (payload: unknown) => makeChain(table, 'insert', payload),
    update: (payload: unknown) => makeChain(table, 'update', payload),
  }),
};

vi.mock('@/lib/api-auth.js', () => ({
  requireAnyUser: vi.fn(async () => ({
    ctx: {
      userId: 'u-victim',
      role: 'traiteur_commercial',
      organisationId: 'org-1',
      isStaff: false,
    },
  })),
  createSupabaseServerClient: () => mockSupabase,
}));

function makeReq(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/me', {
    method,
    ...(body !== undefined
      ? {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }
      : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  results = {};
});

describe('M0.4 — RGPD self-service (BL-P0-09 / OBS-04 / P2-27)', () => {
  it('POST demande-suppression crée une demande en_attente sans anonymisation immédiate', async () => {
    // pas de demande en_attente existante → insert
    results['select:demandes_suppression'] = { data: null, error: null };
    results['insert:demandes_suppression'] = {
      data: {
        id: 'd-1',
        statut: 'en_attente',
        demande_le: '2026-06-25T00:00:00Z',
      },
      error: null,
    };

    const { POST } = await import('@/app/api/me/demande-suppression/route.js');
    const res = await POST(makeReq('POST'));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.statut).toBe('en_attente');

    // la demande est insérée pour l'utilisateur courant…
    const insert = calls.find(
      (c) => c.op === 'insert' && c.table === 'demandes_suppression',
    );
    expect(insert).toBeDefined();
    expect((insert!.payload as Record<string, unknown>).user_id).toBe(
      'u-victim',
    );

    // …et AUCUNE anonymisation immédiate : pas d'écriture sur users.
    expect(calls.some((c) => c.table === 'users')).toBe(false);
    expect(calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('POST demande-suppression idempotent : demande en_attente existante → 200 sans doublon', async () => {
    results['select:demandes_suppression'] = {
      data: { id: 'd-existante' },
      error: null,
    };

    const { POST } = await import('@/app/api/me/demande-suppression/route.js');
    const res = await POST(makeReq('POST'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deja_en_attente).toBe(true);
    // pas de second INSERT
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it("GET export-rgpd renvoie les PII de l'utilisateur (self)", async () => {
    results['select:users'] = {
      data: {
        id: 'u-victim',
        email: 'victim@kaspia.test',
        prenom: 'Victime',
        nom: 'Kaspia',
        role: 'traiteur_commercial',
      },
      error: null,
    };
    results['select:demandes_suppression'] = { data: [], error: null };

    const { GET } = await import('@/app/api/me/export-rgpd/route.js');
    const res = await GET(makeReq('GET'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(
      'mes-donnees-savr.json',
    );
    const body = await res.json();
    expect(body.profil.email).toBe('victim@kaspia.test');
    expect(body.profil.prenom).toBe('Victime');
    expect(Array.isArray(body.demandes_suppression)).toBe(true);
  });

  it('PATCH profil rectifie prenom/nom et rejette les champs hors allowlist', async () => {
    results['update:users'] = {
      data: {
        id: 'u-victim',
        prenom: 'Nouveau',
        nom: 'Nom',
        email: 'victim@kaspia.test',
      },
      error: null,
    };

    const { PATCH } = await import('@/app/api/me/profil/route.js');
    // tentative d'escalade : role + email + organisation_id glissés dans le body
    const res = await PATCH(
      makeReq('PATCH', {
        prenom: 'Nouveau',
        nom: 'Nom',
        role: 'admin_savr',
        email: 'pirate@evil.test',
        organisation_id: 'org-2',
      }),
    );

    expect(res.status).toBe(200);
    const update = calls.find((c) => c.op === 'update' && c.table === 'users');
    expect(update).toBeDefined();
    // SEULS prenom + nom passent l'allowlist.
    expect(update!.payload).toEqual({ prenom: 'Nouveau', nom: 'Nom' });
  });

  it('PATCH profil sans champ éditable → 400 (aucune écriture)', async () => {
    const { PATCH } = await import('@/app/api/me/profil/route.js');
    const res = await PATCH(makeReq('PATCH', { role: 'admin_savr' }));

    expect(res.status).toBe(400);
    expect(calls.some((c) => c.op === 'update')).toBe(false);
  });
});

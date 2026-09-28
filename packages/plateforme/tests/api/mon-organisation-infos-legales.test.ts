/**
 * Informations légales modifiables par tous les rôles (décision Val 2026-09-28).
 * Routes agence + client organisateur (lib/organisation-infos-legales.ts).
 *
 * Régression E2E : /agence/mon-organisation s'affichait vide — la RLS rend à
 * l'agence sa propre organisation ET ses fiches shadow ; un SELECT non filtré
 * renvoyait plusieurs lignes, maybeSingle() échouait, tous les champs à « — ».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const next = (): Result => queue.shift() ?? { data: null, error: null };
  const chain: Record<string, unknown> = {
    __calls: calls,
    push(r: Result) {
      queue.push(r);
      return chain;
    },
  };
  for (const m of ['from', 'select', 'eq', 'update', 'insert']) {
    chain[m] = (...args: unknown[]) => {
      (calls[m] ??= []).push(args);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(next());
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & {
    push(r: Result): unknown;
    __calls: Record<string, unknown[][]>;
  };
}

let rls = makeChain();
let admin = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (...a: unknown[]) =>
      (admin.from as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(role: string, organisationId = 'org-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  const claims = { user_role: role, organisation_id: organisationId };
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`,
      },
    },
    error: null,
  });
}
function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  });
}

const ESPACES = [
  {
    espace: 'agence',
    role: 'agence',
    url: '/api/v1/agence/mon-organisation/profil',
    charger: () =>
      import('@/app/api/v1/agence/mon-organisation/profil/route.js'),
  },
  {
    espace: 'organisateur',
    role: 'client_organisateur',
    url: '/api/v1/organisateur/mon-organisation/profil',
    charger: () =>
      import('@/app/api/v1/organisateur/mon-organisation/profil/route.js'),
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
  admin = makeChain();
});

describe.each(ESPACES)(
  'Mon organisation — $espace',
  ({ role, url, charger }) => {
    it('GET : lecture filtrée sur l’organisation du JWT (jamais les fiches shadow)', async () => {
      setupAuth(role, 'org-1');
      rls.push({
        data: { id: 'org-1', raison_sociale: 'AREP SARL' },
        error: null,
      });
      const { GET } = await charger();
      const res = await GET(makeReq('GET', url));
      expect(res.status).toBe(200);
      expect((await res.json()).data.raison_sociale).toBe('AREP SARL');
      expect(rls.__calls.eq).toContainEqual(['id', 'org-1']);
    });

    it('PATCH : seules les informations légales partent, nettoyées, et sont auditées', async () => {
      setupAuth(role, 'org-1');
      rls.push({
        data: { raison_sociale: 'Ancien', siret: null, adresse: '1 rue A' },
        error: null,
      });
      rls.push({ data: { id: 'org-1' }, error: null });
      const { PATCH } = await charger();
      const res = await PATCH(
        makeReq('PATCH', url, {
          raison_sociale: '  Nouveau  ',
          siret: '12345678900011',
          adresse: '1 rue A',
          nom: 'Renommé',
          email_principal: 'x@y.test',
          logo_url: 'savr-dev/logos/0b8e6f5c-2f1a-4c47-9d3e-6a1f2b3c4d5e.png',
        }),
      );
      expect(res.status).toBe(200);
      expect(rls.__calls.update?.[0]?.[0]).toEqual({
        raison_sociale: 'Nouveau',
        siret: '12345678900011',
        adresse: '1 rue A',
      });
      expect(rls.__calls.eq).toContainEqual(['id', 'org-1']);
      // Audit : 2 champs réellement modifiés (l'adresse est identique).
      const audits = (admin.__calls.insert ?? []).map(
        (c) => c[0] as Record<string, unknown>,
      );
      expect(audits.map((a) => a.new_values)).toEqual([
        { raison_sociale: 'Nouveau' },
        { siret: '12345678900011' },
      ]);
      expect(audits[0]).toMatchObject({
        action: 'organisation_infos_legales_update',
        table_name: 'organisations',
        record_id: 'org-1',
        user_id: 'user-1',
      });
    });

    it('PATCH : chaîne vide → null', async () => {
      setupAuth(role);
      rls.push({ data: null, error: null });
      rls.push({ data: { id: 'org-1' }, error: null });
      const { PATCH } = await charger();
      await PATCH(makeReq('PATCH', url, { siret: '   ' }));
      expect(rls.__calls.update?.[0]?.[0]).toEqual({ siret: null });
    });

    it('PATCH : aucun champ légal → 400, rien n’est écrit', async () => {
      setupAuth(role);
      const { PATCH } = await charger();
      const res = await PATCH(
        makeReq('PATCH', url, { nom: 'X', telephone: '0' }),
      );
      expect(res.status).toBe(400);
      expect(rls.__calls.update).toBeUndefined();
    });

    it.each([
      ['non textuelle', 42],
      ['trop longue', 'x'.repeat(501)],
    ])('PATCH : valeur %s → 422', async (_cas, adresse) => {
      setupAuth(role);
      const { PATCH } = await charger();
      const res = await PATCH(makeReq('PATCH', url, { adresse }));
      expect(res.status).toBe(422);
      expect(rls.__calls.update).toBeUndefined();
    });

    it('PATCH : organisation introuvable (0 ligne sous RLS) → 404, aucun audit', async () => {
      setupAuth(role);
      const { PATCH } = await charger();
      const res = await PATCH(makeReq('PATCH', url, { adresse: '2 rue B' }));
      expect(res.status).toBe(404);
      expect(admin.__calls.insert).toBeUndefined();
    });

    it('refuse un autre rôle (403)', async () => {
      setupAuth('traiteur_manager');
      const { GET, PATCH } = await charger();
      expect((await GET(makeReq('GET', url))).status).toBe(403);
      expect(
        (await PATCH(makeReq('PATCH', url, { adresse: 'x' }))).status,
      ).toBe(403);
    });
  },
);

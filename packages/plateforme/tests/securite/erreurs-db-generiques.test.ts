/**
 * Aucun message d'erreur DB/tierce ne sort dans une réponse HTTP.
 *
 * Classe fermée par la PR #276 (« synthèse PDF — erreurs génériques ») puis
 * généralisée : `NextResponse.json({ error: error.message }, …)` renvoyait au
 * client le message Postgres brut (noms de tables/colonnes, contrainte violée,
 * détail PostgREST) — la structure interne de la base offerte à qui poste un
 * corps invalide. 139 sites étaient concernés, dans 99 routes.
 *
 * Le cliquet `pnpm check:api-error-leak` prouve MÉCANIQUEMENT l'absence de la
 * forme sur l'ensemble des routes (règle A) et verrouille les deux sources
 * d'erreurs applicatives renvoyées telles quelles (règle B). Ce fichier couvre ce
 * qu'un scan de forme ne peut pas voir : le COMPORTEMENT des routes où le message
 * portait un sens métier —
 *   1. la réponse ne contient pas le message Postgres,
 *   2. le log serveur, lui, le contient (`api_route.error`, §07/02),
 *   3. les libellés métier écrits par nous restent affichés (allowlist de codes).
 *
 * Oracle des points 1 et 2 : `SENTINELLE` est une chaîne qui n'existe que dans
 * l'erreur simulée. Si elle apparaît dans le corps de la réponse, la fuite est
 * rouverte ; si elle n'apparaît pas dans les logs, on a neutralisé sans tracer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/** Message Postgres réaliste : nom de table, de colonne et de contrainte. */
const SENTINELLE =
  'duplicate key value violates unique constraint "organisations_siret_key" — Key (siret)=(83179309400017) already exists.';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const next = (): Result => queue.shift() ?? { data: null, error: null };
  const chain: Record<string, unknown> = {
    push(r: Result) {
      queue.push(r);
      return chain;
    },
    __calls: calls,
  };
  for (const m of [
    'from',
    'select',
    'eq',
    'in',
    'gte',
    'lte',
    'neq',
    'order',
    'ilike',
    'limit',
    'range',
    'update',
    'insert',
    'delete',
  ]) {
    chain[m] = (...args: unknown[]) => {
      (calls[m] ??= []).push(args);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(next());
  chain.single = () => Promise.resolve(next());
  chain.rpc = (...args: unknown[]) => {
    (calls.rpc ??= []).push(args);
    return Promise.resolve(next());
  };
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
const mockCreateUser = vi.fn();
const mockSignIn = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: mockGetUser,
      getSession: mockGetSession,
      signInWithPassword: (...a: unknown[]) => mockSignIn(...a),
    },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (rls.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (...a: unknown[]) =>
      (admin.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (admin.rpc as (...x: unknown[]) => unknown)(...a),
    auth: { admin: { createUser: (...a: unknown[]) => mockCreateUser(...a) } },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string, organisationId = 'org-1', userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({
          user_role: role,
          organisation_id: organisationId,
        }),
      },
    },
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

let logSpy: ReturnType<typeof vi.spyOn>;
/** Le logger sérialise chaque event en JSON sur stdout (`console.log`). */
function logsEmis(): string {
  return logSpy.mock.calls.map((c) => String(c[0])).join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
  admin = makeChain();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ── La route signalée en revue #303 ─────────────────────────────────────────
describe('programmation/organisations/shadow — création traiteur shadow', () => {
  it('erreur DB → la réponse ne contient PAS le message Postgres, le log serveur si', async () => {
    setupAuth('agence');
    admin.push({
      data: null,
      error: { code: '23505', message: SENTINELLE },
    });
    const { POST } =
      await import('@/app/api/v1/programmation/organisations/shadow/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/organisations/shadow', {
        raison_sociale: 'ACME Traiteur SAS',
        nom_commercial: 'ACME',
      }),
    );

    expect(res.status).toBe(422);
    const corps = await res.text();
    expect(corps).not.toContain(SENTINELLE);
    expect(corps).not.toContain('organisations_siret_key');
    expect(corps).not.toContain('unique constraint');
    // Le message neutre reste exploitable par le modal de création shadow.
    expect(JSON.parse(corps)).toEqual({
      error: 'Enregistrement impossible (données invalides ou doublon)',
    });

    // …et l'erreur réelle est bien tracée côté serveur (sinon on a neutralisé aveugle).
    const logs = logsEmis();
    expect(logs).toContain('api_route.error');
    expect(logs).toContain('programmation.organisations.shadow.create');
    expect(logs).toContain('organisations_siret_key');
  });
});

// ── Libellés métier : conservés (allowlist de codes), jamais le reste ────────
describe('businessError — allowlist fermée de codes métier', () => {
  it('agence/shadow/siret : le libellé métier 22023 de la RPC reste affiché', async () => {
    setupAuth('agence');
    rls.push({
      data: null,
      error: { code: '22023', message: 'SIRET déjà renseigné' },
    });
    const { PATCH } =
      await import('@/app/api/v1/agence/shadow/[id]/siret/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/agence/shadow/org-1/siret', {
        siret: '83179309400017',
      }),
      { params: Promise.resolve({ id: 'org-1' }) },
    );
    expect(res.status).toBe(422);
    expect((await res.json()) as unknown).toEqual({
      error: 'SIRET déjà renseigné',
    });
  });

  it('agence/shadow/siret : une erreur HORS allowlist retombe sur un message neutre', async () => {
    setupAuth('agence');
    // 23505 (contrainte unique) n'est pas un code métier de la RPC : il ne doit
    // pas emprunter le chemin « libellé écrit par nous ».
    rls.push({ data: null, error: { code: '23505', message: SENTINELLE } });
    const { PATCH } =
      await import('@/app/api/v1/agence/shadow/[id]/siret/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/agence/shadow/org-1/siret', {
        siret: '83179309400017',
      }),
      { params: Promise.resolve({ id: 'org-1' }) },
    );
    expect(res.status).toBe(422);
    const corps = await res.text();
    expect(corps).not.toContain(SENTINELLE);
    expect(logsEmis()).toContain('organisations_siret_key');
  });

  it("agence/shadow/siret : une erreur SANS code ne passe pas non plus (le code 42501 d'un deny RLS non plus)", async () => {
    setupAuth('agence');
    rls.push({
      data: null,
      error: { code: '42501', message: 'permission denied for table lieux' },
    });
    const { PATCH } =
      await import('@/app/api/v1/agence/shadow/[id]/siret/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/agence/shadow/org-1/siret', {
        siret: '83179309400017',
      }),
      { params: Promise.resolve({ id: 'org-1' }) },
    );
    expect(await res.text()).not.toContain('permission denied');
  });
});

// ── Comptes Supabase Auth : cas métier préservé, message tiers jamais renvoyé ─
describe('authAccountError — création de compte', () => {
  it('signup : « email déjà utilisé » est dit à l’utilisateur sans citer GoTrue', async () => {
    rls.push({ data: null, error: null });
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: {
        code: 'email_exists',
        message:
          'AuthApiError: A user with this email address has already been registered (auth.users_email_partial_key)',
      },
    });
    const { authAccountError } = await import('@/lib/api-helpers.js');
    const res = authAccountError(
      {
        code: 'email_exists',
        message:
          'AuthApiError: A user with this email address has already been registered (auth.users_email_partial_key)',
      },
      'auth.signup.create_compte',
    );
    expect(res.status).toBe(422);
    const corps = await res.text();
    expect(JSON.parse(corps)).toEqual({
      error: 'Cette adresse email est déjà utilisée.',
    });
    expect(corps).not.toContain('AuthApiError');
    expect(corps).not.toContain('users_email_partial_key');
    expect(logsEmis()).toContain('users_email_partial_key');
  });

  it('un code GoTrue inconnu ne laisse filtrer aucun texte tiers', async () => {
    const { authAccountError } = await import('@/lib/api-helpers.js');
    const res = authAccountError(
      { code: 'unexpected_failure', message: SENTINELLE },
      'auth.signup.create_compte',
    );
    expect(await res.text()).not.toContain(SENTINELLE);
  });
});

// ── Login : libellé fixe, jamais le message GoTrue ──────────────────────────
describe('auth/login — 401', () => {
  it('identifiants invalides : libellé Savr, message GoTrue seulement dans les logs', async () => {
    mockSignIn.mockResolvedValue({
      data: null,
      error: { code: 'invalid_credentials', message: SENTINELLE },
    });
    const { POST } = await import('@/app/api/auth/login/route.js');
    const res = await POST(
      makeReq('POST', '/api/auth/login', {
        email: 'a@b.fr',
        mot_de_passe: 'x',
      }),
    );
    expect(res.status).toBe(401);
    const corps = await res.text();
    expect(JSON.parse(corps)).toEqual({
      error: 'Email ou mot de passe incorrect.',
    });
    expect(corps).not.toContain(SENTINELLE);
    expect(logsEmis()).toContain('auth.login_failed');
  });
});

// ── Erreurs applicatives renvoyées telles quelles (règle B du cliquet) ───────
describe('sources neutralisées à la construction', () => {
  it('LoaderError : une erreur DB devient « Erreur serveur », le détail va aux logs', async () => {
    const { loadEvolution } = await import('@/lib/dashboards/loaders.js');
    admin.push({ data: null, error: { code: '42703', message: SENTINELLE } });
    rls.push({ data: null, error: { code: '42703', message: SENTINELLE } });
    await expect(
      loadEvolution(
        admin as never,
        { userId: 'u1', role: 'traiteur_manager', organisationId: 'org-1' },
        { type: 'zero_dechet', from: null, to: null },
      ),
    ).rejects.toMatchObject({ message: 'Erreur serveur', status: 500 });
    expect(logsEmis()).toContain('organisations_siret_key');
  });

  it('RegenerateResult : le code DB_ERROR ne porte pas le message Postgres', async () => {
    const { regenerateCollecteDocument } =
      await import('@/lib/pdf/regenerate.js');
    admin.push({ data: null, error: { code: '42703', message: SENTINELLE } });
    const res = await regenerateCollecteDocument(
      admin as never,
      'collecte-1',
      'bordereau-zd',
      { userId: 'u1', role: 'admin_savr' },
    );
    expect(res).toMatchObject({ ok: false, code: 'DB_ERROR' });
    expect(JSON.stringify(res)).not.toContain(SENTINELLE);
    expect(logsEmis()).toContain('organisations_siret_key');
  });
});

// ── Vecteur INDIRECT : le message fabriqué en amont, relancé, puis rendu ─────
// Relevé en revue sécurité : `throw new Error(pgError.message)` dans `lib/` est la
// MÊME fuite, avec une indirection — `new Error(…)` EST une instance d'`Error`,
// donc le `catch (e) { … e.message }` du handler la renvoie telle quelle.
describe('exports — fuite par throw new Error(pgError.message)', () => {
  it('un filtre invalide ne révèle pas le type enum interne (le log, si)', async () => {
    setupAuth('traiteur_manager');
    // Ce que Postgres répond réellement sur `?statut=foo` : le schéma ET le nom du
    // type interne. C'est ce que la route renvoyait au client avant correction.
    const PG_ENUM =
      'invalid input value for enum plateforme.collecte_statut: "foo"';
    rls.push({ data: null, error: { code: '22P02', message: PG_ENUM } });
    const { GET } = await import('@/app/api/v1/exports/[entity]/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/exports/collectes?statut=foo'),
      { params: Promise.resolve({ entity: 'collectes' }) },
    );
    expect(res.status).toBe(500);
    const corps = await res.text();
    expect(corps).not.toContain('plateforme.collecte_statut');
    expect(corps).not.toContain('invalid input value');
    expect(logsEmis()).toContain('plateforme.collecte_statut');
  });

  it('un deny RLS ne nomme pas la table dans la réponse', async () => {
    setupAuth('traiteur_manager');
    rls.push({
      data: null,
      error: {
        code: '42501',
        message: 'permission denied for table collectes',
      },
    });
    const { GET } = await import('@/app/api/v1/exports/[entity]/route.js');
    const res = await GET(makeReq('GET', '/api/v1/exports/collectes'), {
      params: Promise.resolve({ entity: 'collectes' }),
    });
    expect(await res.text()).not.toContain('permission denied');
  });
});

// ── Le CODE reste l'oracle métier, même quand le message est neutralisé ──────
describe('erreurInterne — le message part, le code reste', () => {
  it('conserve le code pour que le handler garde son mapping (P0030 → 404)', async () => {
    const { erreurInterne } = await import('@/lib/api-helpers.js');
    const err = erreurInterne(
      { code: 'P0030', message: SENTINELLE },
      'attribution_ag.algo',
    );
    expect(err.message).toBe('Erreur serveur');
    expect(err.code).toBe('P0030');
    expect(logsEmis()).toContain('organisations_siret_key');
  });
});

// ── Le libellé neutre doit rester COMPRÉHENSIBLE dans son contexte ──────────
describe('authAccountError — libellé de repli contextuel', () => {
  it("changement de mot de passe : pas le libellé « doublon » d'une écriture", async () => {
    const { authAccountError } = await import('@/lib/api-helpers.js');
    const res = authAccountError(
      { code: 'unexpected_failure', message: SENTINELLE },
      'auth.update_password',
      'Modification du mot de passe impossible.',
    );
    const corps = await res.text();
    expect(JSON.parse(corps)).toEqual({
      error: 'Modification du mot de passe impossible.',
    });
    expect(corps).not.toContain('doublon');
    expect(corps).not.toContain(SENTINELLE);
  });

  it('« identique à l’ancien » n’est pas rendu comme « trop faible »', async () => {
    const { authAccountError } = await import('@/lib/api-helpers.js');
    const res = authAccountError(
      {
        code: 'same_password',
        message: 'New password should be different from the old password.',
      },
      'auth.update_password',
      'Modification du mot de passe impossible.',
    );
    expect((await res.json()) as unknown).toEqual({
      error: 'Le nouveau mot de passe doit être différent de l’ancien.',
    });
  });
});

// ── §15 : le repli de sérialisation ne fait pas entrer de PII dans les logs ──
describe('messageErreur — repli sans details/hint', () => {
  it('un objet sans `message` est sérialisé SANS details ni hint', async () => {
    const { messageErreur } = await import('@/lib/api-helpers.js');
    const rendu = messageErreur({
      code: '23505',
      details: 'Key (email)=(valentin@gosavr.io) already exists.',
      hint: 'indice interne',
    });
    expect(rendu).toContain('23505');
    expect(rendu).not.toContain('@gosavr.io');
    expect(rendu).not.toContain('indice interne');
  });
});

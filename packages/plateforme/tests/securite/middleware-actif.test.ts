/**
 * Cliquet — le middleware Next est réellement chargé, filtre par rôle, et
 * n'intercepte JAMAIS les appelants tiers (crons, webhooks, health).
 *
 * Jusqu'au 2026-09-11 le middleware vivait à la racine du package
 * (`packages/plateforme/middleware.ts`). Next 15 ne le cherche que dans
 * `path.join(pagesDir || appDir, '..')` = `src/` ici : il n'a jamais été chargé
 * (`middleware-manifest.json` vide), le filtrage par rôle n'a jamais tourné.
 *
 * Piège du déplacement : le matcher couvre toute l'app. Sans exclusion de `/api/*`,
 * chaque appel Vercel Cron (GET + Bearer CRON_SECRET, sans cookie de session)
 * serait redirigé en 307 vers /login — les crons cesseraient de tourner sans
 * erreur visible. Idem webhooks tiers (emails, logistique) et sondes Better Uptime.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PKG = resolve(__dirname, '../..');

// ─── Mock Supabase : session pilotée par test ────────────────────────────────
type FakeUser = { id: string; email_confirmed_at: string | null } | null;
const state: {
  user: FakeUser;
  claims: Record<string, unknown>;
  refreshed: boolean;
} = { user: null, claims: {}, refreshed: false };

function fakeJwt(claims: Record<string, unknown>): string {
  const b64u = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64u({ alg: 'ES256' })}.${b64u(claims)}.sig`;
}

const createServerClient = vi.fn(
  (
    _url: string,
    _key: string,
    opts: {
      cookies: {
        setAll: (
          c: Array<{ name: string; value: string; options: object }>,
        ) => void;
      };
    },
  ) => ({
    auth: {
      getUser: vi.fn(async () => {
        // Simule un refresh de token pendant la validation de session.
        if (state.refreshed) {
          opts.cookies.setAll([
            { name: 'sb-access', value: 'nouveau-jeton', options: {} },
          ]);
        }
        return { data: { user: state.user } };
      }),
      getSession: vi.fn(async () => ({
        data: {
          session: state.user ? { access_token: fakeJwt(state.claims) } : null,
        },
      })),
    },
  }),
);
vi.mock('@supabase/ssr', () => ({ createServerClient }));

const { middleware, config, getRolesForPath, isPublicPath } =
  await import('../../src/middleware.js');

const req = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, 'https://app.gosavr.io'), { headers });

function connecte(claims: Record<string, unknown>, confirme = true) {
  state.user = {
    id: 'u-1',
    email_confirmed_at: confirme ? '2026-01-01T00:00:00Z' : null,
  };
  state.claims = { app_domain: 'plateforme', ...claims };
}

const passe = (res: Response) =>
  expect(res.headers.get('x-middleware-next')).toBe('1');
const redirigeVers = (res: Response, pathname: string) => {
  expect(res.status).toBe(307);
  expect(new URL(res.headers.get('location')!).pathname).toBe(pathname);
};

beforeEach(() => {
  state.user = null;
  state.claims = {};
  state.refreshed = false;
  createServerClient.mockClear();
});

// ─── 1. Emplacement : le fichier est là où Next le cherche ───────────────────
describe('middleware — emplacement détecté par Next (src/)', () => {
  it('vit dans src/middleware.ts, pas à la racine du package', () => {
    // App Router sans pages/ → Next scanne path.join(appDir, "..") = src/.
    expect(existsSync(join(PKG, 'src/app'))).toBe(true);
    expect(existsSync(join(PKG, 'pages'))).toBe(false);
    expect(existsSync(join(PKG, 'src/pages'))).toBe(false);
    expect(existsSync(join(PKG, 'src/middleware.ts'))).toBe(true);
    expect(existsSync(join(PKG, 'middleware.ts'))).toBe(false);
  });
});

// ─── 2. Matcher (moteur de Next) ─────────────────────────────────────────────
const vercel = JSON.parse(readFileSync(join(PKG, 'vercel.json'), 'utf8')) as {
  crons: Array<{ path: string }>;
};

function routesApi(dir = join(PKG, 'src/app/api')): string[] {
  return readdirSync(dir).flatMap((nom) => {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) return routesApi(p);
    if (nom !== 'route.ts') return [];
    const seg = relative(join(PKG, 'src/app'), dir).split(sep);
    // [id] → valeur factice : on teste le chemin concret appelé.
    return ['/' + seg.map((s) => s.replace(/^\[.*\]$/, 'x')).join('/')];
  });
}

const matche = (url: string) => unstable_doesMiddlewareMatch({ config, url });

// Webhooks tiers dérivés de l'arborescence : un webhook ajouté demain est couvert.
const WEBHOOKS = routesApi().filter((p) => p.startsWith('/api/webhooks/'));

describe('middleware — matcher', () => {
  it('garde anti-vacuité : crons vercel.json et routes API énumérés', () => {
    expect(vercel.crons.length).toBeGreaterThanOrEqual(14);
    expect(routesApi().length).toBeGreaterThan(150);
  });

  it.each(vercel.crons.map((c) => c.path))(
    'cron Vercel %s : jamais intercepté (sinon 307 → /login)',
    (path) => {
      expect(matche(path)).toBe(false);
    },
  );

  it('garde anti-vacuité : les webhooks tiers sont énumérés', () => {
    expect(WEBHOOKS.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ...WEBHOOKS,
    '/api/health',
    '/api/health/full',
    '/api/health/logistique',
    '/api',
  ])('appelant tiers %s : jamais intercepté', (path) => {
    expect(matche(path)).toBe(false);
  });

  it('aucune route API (src/app/api/**/route.ts) n’est interceptée', () => {
    const interceptees = routesApi().filter(matche);
    expect(interceptees).toEqual([]);
  });

  it.each([
    '/',
    '/admin',
    '/admin/dashboard',
    '/admin/collectes/abc',
    '/traiteur',
    '/agence/collectes',
    '/gestionnaire/lieux/x',
    '/organisateur',
    '/registre',
    '/programmer/nouveau',
    '/brouillons',
    '/apiculture', // préfixe « api » sans slash : page applicative, filtrée
  ])('page applicative %s : interceptée', (path) => {
    expect(matche(path)).toBe(true);
  });
});

// ─── 3. Comportement ─────────────────────────────────────────────────────────
describe('middleware — comportement', () => {
  it('route admin sans session → 307 /login?next=…', async () => {
    const res = await middleware(req('/admin/dashboard'));
    redirigeVers(res, '/login');
    expect(new URL(res.headers.get('location')!).searchParams.get('next')).toBe(
      '/admin/dashboard',
    );
  });

  it('cron invoqué directement (GET + Bearer, sans cookie) → laissé passer, Supabase jamais appelé', async () => {
    for (const { path } of vercel.crons) {
      const res = await middleware(
        req(path, { authorization: 'Bearer secret-cron' }),
      );
      passe(res);
      expect(res.status).toBe(200);
    }
    for (const path of WEBHOOKS) {
      passe(await middleware(req(path)));
    }
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('callback d’impersonation sans session → pas de redirection (validé par son OTP)', async () => {
    const res = await middleware(
      req('/auth/impersonate-callback?token_hash=t&type=magiclink'),
    );
    passe(res);
  });

  it.each([
    ['admin_savr', '/admin/dashboard'],
    ['ops_savr', '/admin/collectes'],
    ['traiteur_manager', '/traiteur'],
    ['traiteur_commercial', '/registre'],
    ['agence', '/agence/collectes'],
    ['gestionnaire_lieux', '/gestionnaire'],
    ['client_organisateur', '/organisateur'],
    ['ops_savr', '/programmer/nouveau'],
    ['agence', '/brouillons'],
  ])('%s sur %s → autorisé', async (role, path) => {
    connecte({ user_role: role });
    passe(await middleware(req(path)));
  });

  it.each([
    ['traiteur_manager', '/admin/dashboard'],
    ['client_organisateur', '/programmer/nouveau'],
    ['agence', '/registre'],
    ['admin_savr', '/traiteur'],
    ['gestionnaire_lieux', '/agence'],
  ])('%s sur %s → 307 /403', async (role, path) => {
    connecte({ user_role: role });
    redirigeVers(await middleware(req(path)), '/403');
  });

  it('claim user_role absent sur route gatée → /403 (fail-closed)', async () => {
    connecte({});
    redirigeVers(await middleware(req('/admin')), '/403');
  });

  it('app_domain tms → /403', async () => {
    connecte({ user_role: 'admin_savr', app_domain: 'tms' });
    redirigeVers(await middleware(req('/admin')), '/403');
  });

  it('email non vérifié → /verify-email', async () => {
    connecte({ user_role: 'traiteur_manager' }, false);
    redirigeVers(await middleware(req('/programmer/nouveau')), '/verify-email');
  });

  it('token rafraîchi pendant la garde : cookie reposé aussi sur une redirection', async () => {
    connecte({ user_role: 'agence' });
    state.refreshed = true;
    const res = await middleware(req('/admin'));
    redirigeVers(res, '/403');
    expect(res.headers.get('set-cookie')).toContain('sb-access=nouveau-jeton');
  });

  it('token rafraîchi : transmis aux Server Components du même rendu', async () => {
    connecte({ user_role: 'agence' });
    state.refreshed = true;
    const res = await middleware(req('/agence'));
    passe(res);
    expect(res.headers.get('x-middleware-request-cookie')).toContain(
      'sb-access=nouveau-jeton',
    );
  });
});

describe('middleware — tables de routage', () => {
  it('getRolesForPath : préfixe exact ou segment, jamais sous-chaîne', () => {
    expect(getRolesForPath('/admin')).toContain('admin_savr');
    expect(getRolesForPath('/administration')).toBeNull();
    expect(getRolesForPath('/traiteurs')).toBeNull();
  });

  it('isPublicPath : /api et /auth publics, pas les espaces', () => {
    expect(isPublicPath(vercel.crons[0]!.path)).toBe(true);
    expect(isPublicPath('/auth/impersonate-callback')).toBe(true);
    expect(isPublicPath('/reset-password/confirm')).toBe(true);
    expect(isPublicPath('/apiculture')).toBe(false);
    expect(isPublicPath('/admin')).toBe(false);
    expect(isPublicPath('/')).toBe(false);
  });
});

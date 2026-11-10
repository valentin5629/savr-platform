/**
 * Code de vérification (lib/code-verification.ts : équipe Savr, et utilisateurs
 * d'une organisation qui l'exige) — points de contrôle hors middleware et hors
 * getVerifiedClaims :
 *  - gardes de page (`lib/page-auth.ts`), défense en profondeur du middleware ;
 *  - routes de santé qui lisent elles-mêmes le rôle (`api/health/*`) ;
 *  - l'écran du code (`app/code-verification/page.tsx`) : qui il accepte, où il
 *    renvoie, quel formulaire il affiche.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

// `redirect()` de Next lève : on reproduit ce comportement avec la cible.
class Redirection extends Error {
  constructor(readonly cible: string) {
    super(`redirect:${cible}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (cible: string) => {
    throw new Redirection(cible);
  },
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

type Facteur = { id: string; factor_type: string; status: string };
function connecte(
  role: string,
  aal: string,
  factors: Facteur[] = [],
  autresClaims: Record<string, unknown> = {},
) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'u-1', email: 'a@gosavr.io', factors } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({
          user_role: role,
          aal,
          organisation_id: 'org-1',
          ...autresClaims,
        }),
      },
    },
  });
}

// Organisation qui exige le code (VIPARIS, Val 2026-11-10) : claim du hook.
const VIPARIS = { code_verification_obligatoire: true };

async function cibleRedirection(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof Redirection) return e.cible;
    throw e;
  }
}

// Code demandé en production seulement (lib/code-verification.ts).
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VERCEL_ENV', 'production');
});
afterEach(() => vi.unstubAllEnvs());

describe('gardes de page', () => {
  it.each(['admin_savr', 'ops_savr'])(
    'requireStaffPage : %s sans code → écran du code',
    async (role) => {
      connecte(role, 'aal1');
      const { requireStaffPage } = await import('@/lib/page-auth.js');
      expect(await cibleRedirection(requireStaffPage())).toBe(
        '/code-verification',
      );
    },
  );

  it('requireStaffPage : admin avec code → page rendue', async () => {
    connecte('admin_savr', 'aal2');
    const { requireStaffPage } = await import('@/lib/page-auth.js');
    expect((await requireStaffPage()).role).toBe('admin_savr');
  });

  it('requirePageSession : admin sans code → écran du code', async () => {
    connecte('admin_savr', 'aal1');
    const { requirePageSession } = await import('@/lib/page-auth.js');
    expect(await cibleRedirection(requirePageSession(['admin_savr']))).toBe(
      '/code-verification',
    );
  });

  it('page Santé système (lit le rôle elle-même) : admin sans code → écran du code', async () => {
    connecte('admin_savr', 'aal1');
    const { default: Page } =
      await import('@/app/(admin)/admin/sante-systeme/page.js');
    expect(await cibleRedirection(Page())).toBe('/code-verification');
  });

  it('hors production : requireStaffPage laisse passer un admin sans code', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    connecte('admin_savr', 'aal1');
    const { requireStaffPage } = await import('@/lib/page-auth.js');
    expect((await requireStaffPage()).role).toBe('admin_savr');
  });

  it('requirePageSession : client sans code → page rendue', async () => {
    connecte('traiteur_manager', 'aal1');
    const { requirePageSession } = await import('@/lib/page-auth.js');
    expect((await requirePageSession(['traiteur_manager'])).role).toBe(
      'traiteur_manager',
    );
  });

  it('requirePageSession : client d’une organisation qui exige le code, sans code → écran du code', async () => {
    connecte('gestionnaire_lieux', 'aal1', [], VIPARIS);
    const { requirePageSession } = await import('@/lib/page-auth.js');
    expect(
      await cibleRedirection(requirePageSession(['gestionnaire_lieux'])),
    ).toBe('/code-verification');
  });

  it('requirePageSession : même client avec code → page rendue', async () => {
    connecte('gestionnaire_lieux', 'aal2', [], VIPARIS);
    const { requirePageSession } = await import('@/lib/page-auth.js');
    expect((await requirePageSession(['gestionnaire_lieux'])).role).toBe(
      'gestionnaire_lieux',
    );
  });
});

describe('routes de santé réservées à l’équipe Savr', () => {
  it('health/full : admin sans code → 401', async () => {
    connecte('admin_savr', 'aal1');
    const { GET } = await import('@/app/api/health/full/route.js');
    const res = await GET(new NextRequest('http://localhost/api/health/full'));
    expect(res.status).toBe(401);
  });

  it('health/logistique : admin sans code → 401', async () => {
    connecte('admin_savr', 'aal1');
    const { GET } = await import('@/app/api/health/logistique/route.js');
    const res = await GET(
      new NextRequest('http://localhost/api/health/logistique'),
    );
    expect(res.status).toBe(401);
  });
});

describe('écran du code de vérification', () => {
  async function page(next?: string) {
    const { default: Page } = await import('@/app/code-verification/page.js');
    return Page({ searchParams: Promise.resolve({ next }) });
  }
  // Props du formulaire rendu : <AuthPage><FormulaireCodeVerification …/></AuthPage>.
  async function formulaire(next?: string) {
    const el = (await page(next)) as {
      props: {
        children: {
          props: { mode: string; suite: string; equipeSavr: boolean };
        };
      };
    };
    return el.props.children.props;
  }

  it('sans session → /login', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await cibleRedirection(page('/admin'))).toBe('/login');
  });

  it('client → page demandée, jamais de code', async () => {
    connecte('agence', 'aal1');
    expect(await cibleRedirection(page('/agence'))).toBe('/agence');
  });

  it.each([
    ['client', 'agence'],
    ['admin hors production', 'admin_savr'],
  ])(
    '%s avec un next externe → /, jamais l’adresse externe',
    async (_cas, role) => {
      if (role === 'admin_savr') vi.stubEnv('VERCEL_ENV', 'preview');
      connecte(role, 'aal1');
      expect(await cibleRedirection(page('https://exemple.com/piege'))).toBe(
        '/',
      );
    },
  );

  it('hors production : admin sans code → page demandée, pas de QR code', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    connecte('admin_savr', 'aal1');
    expect(await cibleRedirection(page('/admin/collectes'))).toBe(
      '/admin/collectes',
    );
  });

  it('code déjà passé → page demandée', async () => {
    connecte('admin_savr', 'aal2');
    expect(await cibleRedirection(page('/admin/collectes'))).toBe(
      '/admin/collectes',
    );
  });

  it('admin sans code actif → activation (QR code)', async () => {
    connecte('admin_savr', 'aal1');
    expect(await formulaire('/admin')).toEqual({
      mode: 'activation',
      suite: '/admin',
      equipeSavr: true,
    });
  });

  it('client d’une organisation qui exige le code, sans code actif → activation, textes client', async () => {
    connecte('gestionnaire_lieux', 'aal1', [], VIPARIS);
    expect(await formulaire('/gestionnaire')).toEqual({
      mode: 'activation',
      suite: '/gestionnaire',
      equipeSavr: false,
    });
  });

  it('client d’une organisation qui exige le code, avec code actif → saisie', async () => {
    connecte(
      'gestionnaire_lieux',
      'aal1',
      [{ id: 'f-1', factor_type: 'totp', status: 'verified' }],
      VIPARIS,
    );
    expect((await formulaire('/gestionnaire')).mode).toBe('saisie');
  });

  it('client d’une organisation qui exige le code, session impersonée → page demandée', async () => {
    connecte('gestionnaire_lieux', 'aal1', [], {
      ...VIPARIS,
      impersonator_id: 'b2c3d4e5-0000-0000-0000-000000000001',
    });
    expect(await cibleRedirection(page('/gestionnaire'))).toBe('/gestionnaire');
  });

  it('admin avec code actif → saisie', async () => {
    connecte('admin_savr', 'aal1', [
      { id: 'f-1', factor_type: 'totp', status: 'verified' },
    ]);
    expect((await formulaire('/admin')).mode).toBe('saisie');
  });

  it.each([
    ['https://exemple.com/piege', '/'],
    ['//exemple.com', '/'],
    ['/code-verification?next=/admin', '/'],
    [undefined, '/'],
  ])(
    'next=%j → retour vers %j (jamais externe, jamais cet écran)',
    async (next, suite) => {
      connecte('admin_savr', 'aal1');
      expect((await formulaire(next)).suite).toBe(suite);
    },
  );
});

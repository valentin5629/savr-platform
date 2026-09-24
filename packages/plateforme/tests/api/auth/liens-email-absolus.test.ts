/**
 * Les liens d'email et les `redirectTo` sont ABSOLUS, toujours.
 *
 * Panne mesurée en dev le 2026-09-24 : douze endroits écrivaient
 * `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/chemin`. La variable manquait sur
 * l'environnement dev, si bien que le `redirect_to` envoyé à Supabase valait
 * `/api/auth/reset-password/confirm` — une adresse RELATIVE. Supabase la compare
 * à sa liste blanche (qui ne contient que des adresses absolues), n'y trouve
 * rien, et retombe SANS RIEN DIRE sur le Site URL du projet.
 *
 * Résultat : le lien « mot de passe oublié » consommait son jeton puis déposait
 * l'utilisateur sur l'écran de connexion, muet. Deux liens réels mesurés
 * portaient `redirect_to=https://dev.app.gosavr.io`, chemin effacé.
 *
 * Ces tests épinglent la règle : quelle que soit la configuration, jamais de
 * lien relatif.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockResetPasswordForEmail = vi.fn();
const mockGenerateLink = vi.fn();
const mockCreateUser = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { resetPasswordForEmail: mockResetPasswordForEmail },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ getAll: () => [] }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
      insert: () => ({
        select: () => ({ single: async () => ({ data: null, error: null }) }),
      }),
    }),
    auth: {
      admin: { createUser: mockCreateUser, generateLink: mockGenerateLink },
    },
  }),
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

const ENV_ORIGINE = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  vi.clearAllMocks();
  mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  if (ENV_ORIGINE === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = ENV_ORIGINE;
});

function reqSur(origine: string, body: unknown): NextRequest {
  return new NextRequest(`${origine}/api/auth/reset-password`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('M0.4 — les liens envoyés par email sont toujours absolus', () => {
  it("SANS NEXT_PUBLIC_APP_URL, le redirectTo reste absolu (c'est LE cas qui a cassé la prod dev)", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const { POST } = await import('@/app/api/auth/reset-password/route.js');
    await POST(
      reqSur('https://dev.app.gosavr.io', { email: 'marie@traiteur.fr' }),
    );

    expect(mockResetPasswordForEmail).toHaveBeenCalledTimes(1);
    const [, options] = mockResetPasswordForEmail.mock.calls[0] as [
      string,
      { redirectTo: string },
    ];
    // Avant le correctif, cette valeur était « /api/auth/reset-password/confirm ».
    expect(options.redirectTo).toBe(
      'https://dev.app.gosavr.io/api/auth/reset-password/confirm',
    );
    expect(options.redirectTo.startsWith('https://')).toBe(true);
  });

  it('AVEC NEXT_PUBLIC_APP_URL, le domaine canonique gagne sur celui de la requête', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.gosavr.io';
    const { POST } = await import('@/app/api/auth/reset-password/route.js');
    // Appel reçu par un alias de déploiement : l'email doit pointer vers le
    // domaine officiel, pas vers l'alias.
    await POST(
      reqSur('https://savr-platform-git-dev.vercel.app', {
        email: 'marie@traiteur.fr',
      }),
    );

    const [, options] = mockResetPasswordForEmail.mock.calls[0] as [
      string,
      { redirectTo: string },
    ];
    expect(options.redirectTo).toBe(
      'https://app.gosavr.io/api/auth/reset-password/confirm',
    );
  });

  it('une variable vide ou blanche est traitée comme absente, pas comme un domaine', async () => {
    process.env.NEXT_PUBLIC_APP_URL = '   ';
    const { POST } = await import('@/app/api/auth/reset-password/route.js');
    await POST(
      reqSur('https://dev.app.gosavr.io', { email: 'marie@traiteur.fr' }),
    );

    const [, options] = mockResetPasswordForEmail.mock.calls[0] as [
      string,
      { redirectTo: string },
    ];
    expect(options.redirectTo).toBe(
      'https://dev.app.gosavr.io/api/auth/reset-password/confirm',
    );
  });

  it('en local, le port est conservé', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const { POST } = await import('@/app/api/auth/reset-password/route.js');
    await POST(reqSur('http://localhost:3001', { email: 'marie@traiteur.fr' }));

    const [, options] = mockResetPasswordForEmail.mock.calls[0] as [
      string,
      { redirectTo: string },
    ];
    expect(options.redirectTo).toBe(
      'http://localhost:3001/api/auth/reset-password/confirm',
    );
  });
});

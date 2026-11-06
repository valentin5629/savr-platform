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
import { logger } from '@savr/shared/src/logger/index.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { NextRequest } from 'next/server';
import { _resetDemandesReinitialisation } from '@/lib/reset-password-rate-limit.js';

const mockGenerateLink = vi.fn();
// L'email « mot de passe oublié » part après la réponse (`after`) : les tâches
// sont gardées ici et attendues par le test.
const tachesApresReponse: Array<Promise<void>> = [];
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (tache: () => Promise<void>) => {
    tachesApresReponse.push(tache());
  },
}));
const mockCreateUser = vi.fn();

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
  tachesApresReponse.length = 0;
  _resetDemandesReinitialisation();
  mockGenerateLink.mockResolvedValue({
    data: {
      properties: { hashed_token: 'jeton-haché' },
      user: { id: 'u-1', email: 'marie@traiteur.fr' },
    },
    error: null,
  });
});

/** Lien du seul email « mot de passe oublié » parti, sans sa query (le jeton). */
async function lienReset(): Promise<string> {
  await Promise.all(tachesApresReponse);
  expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
  const [slug, , variables] = vi.mocked(sendEmail).mock.calls[0]!;
  expect(slug).toBe('reset_password');
  const lien = new URL(variables['lien_reset']!);
  return `${lien.origin}${lien.pathname}`;
}

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

const CHEMIN = '/api/auth/reset-password/confirm';

/** urlApplication sur une requête reçue à `origine`. */
async function urlSur(origine: string, chemin = CHEMIN): Promise<string> {
  const { urlApplication } = await import('@/lib/url-application.js');
  return urlApplication(reqSur(origine, {}), chemin);
}

describe('M0.4 — les liens envoyés par email sont toujours absolus', () => {
  it("SANS NEXT_PUBLIC_APP_URL, le lien reste absolu (c'est LE cas qui a cassé la prod dev)", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const url = await urlSur('https://dev.app.gosavr.io');
    // Avant le correctif, cette valeur était « /api/auth/reset-password/confirm ».
    expect(url).toBe(
      'https://dev.app.gosavr.io/api/auth/reset-password/confirm',
    );
  });

  it('AVEC NEXT_PUBLIC_APP_URL, le domaine canonique gagne sur celui de la requête', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.gosavr.io';
    // Appel reçu par un alias de déploiement : l'email doit pointer vers le
    // domaine officiel, pas vers l'alias.
    expect(await urlSur('https://savr-platform-git-dev.vercel.app')).toBe(
      'https://app.gosavr.io/api/auth/reset-password/confirm',
    );
  });

  it('une variable vide ou blanche est traitée comme absente, pas comme un domaine', async () => {
    process.env.NEXT_PUBLIC_APP_URL = '   ';
    expect(await urlSur('https://dev.app.gosavr.io')).toBe(
      'https://dev.app.gosavr.io/api/auth/reset-password/confirm',
    );
  });

  it('une variable MAL FORMÉE (sans schéma) ne fait pas lever : repli sur la requête', async () => {
    // `new URL('/x', 'app.gosavr.io')` lève : une base sans schéma n'est pas une
    // URL. Sans filet, une variable mal saisie ferait un 500.
    process.env.NEXT_PUBLIC_APP_URL = 'app.gosavr.io';
    const capture = vi.spyOn(logger, 'error').mockImplementation(() => {});
    expect(await urlSur('https://dev.app.gosavr.io')).toBe(
      'https://dev.app.gosavr.io/api/auth/reset-password/confirm',
    );
    capture.mockRestore();
  });

  it('le log de secours ne recopie JAMAIS la query (elle porte token_hash / jeton)', async () => {
    // Le filet ci-dessus trace pour qu'une variable mal saisie soit visible. Mais
    // deux appelants passent un secret vivant dans la query — `token_hash` du
    // signup, et `token_hash` + `jeton` de l'impersonation, qui ouvre une session
    // sous l'identité d'un autre. Le logger masque par CLÉ, pas par contenu : un
    // jeton noyé dans la valeur de « chemin » sortirait en clair.
    process.env.NEXT_PUBLIC_APP_URL = 'app.gosavr.io';
    const capture = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const { urlApplication } = await import('@/lib/url-application.js');

    const url = urlApplication(
      reqSur('https://dev.app.gosavr.io', {}),
      '/api/auth/verify-email?token_hash=pkce_secret_vivant&type=signup',
    );

    expect(url).toContain('token_hash=pkce_secret_vivant'); // le LIEN en a besoin
    expect(capture).toHaveBeenCalledTimes(1);
    const journalise = JSON.stringify(capture.mock.calls[0]);
    expect(journalise).not.toContain('pkce_secret_vivant');
    expect(journalise).not.toContain('token_hash');
    expect(journalise).toContain('/api/auth/verify-email');
    capture.mockRestore();
  });

  it('en local, le port est conservé', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(await urlSur('http://localhost:3001')).toBe(
      'http://localhost:3001/api/auth/reset-password/confirm',
    );
  });
});

// Le lien « mot de passe oublié » ouvre une session sur le compte : son domaine
// vient de la SEULE configuration, jamais de la requête (en-tête Host forgé).
describe('lien du mot de passe oublié : domaine de la configuration seule', () => {
  it('AVEC NEXT_PUBLIC_APP_URL : lien absolu sur le domaine canonique, même reçu par un alias', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.gosavr.io';
    const { POST } = await import('@/app/api/auth/reset-password/route.js');
    await POST(
      reqSur('https://savr-platform-git-dev.vercel.app', {
        email: 'marie@traiteur.fr',
      }),
    );
    expect(await lienReset()).toBe(
      'https://app.gosavr.io/api/auth/reset-password/confirm',
    );
  });

  it.each([
    ['absente', undefined],
    ['blanche', '   '],
    ['mal formée', 'app.gosavr.io'],
  ])(
    'variable %s : réponse 200, aucun lien fabriqué, aucun email',
    async (_cas, valeur) => {
      if (valeur === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = valeur;
      const capture = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const { POST } = await import('@/app/api/auth/reset-password/route.js');
      const res = await POST(
        reqSur('https://domaine-tiers.example', { email: 'marie@traiteur.fr' }),
      );
      await Promise.all(tachesApresReponse);

      expect(res.status).toBe(200);
      expect(mockGenerateLink).not.toHaveBeenCalled();
      expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
      capture.mockRestore();
    },
  );
});

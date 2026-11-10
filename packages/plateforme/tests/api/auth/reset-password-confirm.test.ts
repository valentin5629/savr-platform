/**
 * Parcours « mot de passe oublié » — maillon serveur.
 *
 * Depuis le 2026-11-06 (Val), la demande fabrique le lien par
 * `auth.admin.generateLink` et l'envoie par Resend (gabarit `reset_password`),
 * après la réponse. Le lien vise la route d'échange, jamais la page de saisie :
 * seule une route peut écrire les cookies de session. Ces tests épinglent la
 * demande (lien émis, adresse inconnue, plafond) et la route d'échange, pour le
 * nouveau lien (`token_hash`) comme pour l'ancien (`code`, flux PKCE).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { _resetDemandesReinitialisation } from '@/lib/reset-password-rate-limit.js';

const mockExchangeCodeForSession = vi.fn();
const mockVerifyOtp = vi.fn();
const mockGenerateLink = vi.fn();
const mockProfil = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
      verifyOtp: mockVerifyOtp,
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mockProfil }) }),
    }),
    auth: { admin: { generateLink: mockGenerateLink } },
  }),
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ statut: 'sent' }),
}));
// L'envoi se fait après la réponse (`after`) : les tâches sont attendues ici.
const tachesApresReponse: Array<Promise<void>> = [];
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (tache: () => Promise<void>) => {
    tachesApresReponse.push(tache());
  },
}));

function makeGet(query: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/auth/reset-password/confirm${query}`,
  );
}

function demande(email: string, ip = '203.0.113.7'): NextRequest {
  return new NextRequest('http://localhost/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}

async function demander(email: string, ip?: string) {
  const { POST } = await import('@/app/api/auth/reset-password/route.js');
  const res = await POST(demande(email, ip));
  await Promise.all(tachesApresReponse);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Le lien de l'email prend son domaine dans la seule configuration.
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.gosavr.io';
  tachesApresReponse.length = 0;
  _resetDemandesReinitialisation();
  mockExchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  mockVerifyOtp.mockResolvedValue({ data: {}, error: null });
  mockGenerateLink.mockResolvedValue({
    data: {
      properties: { hashed_token: 'jeton-haché' },
      user: { id: 'u-1', email: 'chef@traiteur.fr' },
    },
    error: null,
  });
  mockProfil.mockResolvedValue({ data: { prenom: 'Léa & Co' }, error: null });
});

describe('demande de réinitialisation', () => {
  it("adresse connue → un email reset_password, lien vers la route d'échange avec le jeton", async () => {
    const res = await demander('chef@traiteur.fr');

    expect(res.status).toBe(200);
    expect(mockGenerateLink).toHaveBeenCalledWith({
      type: 'recovery',
      email: 'chef@traiteur.fr',
    });
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
    const [slug, to, variables] = vi.mocked(sendEmail).mock.calls[0]!;
    expect(slug).toBe('reset_password');
    expect(to).toBe('chef@traiteur.fr');
    // Prénom échappé : le corps de l'email est du HTML.
    expect(variables['prenom']).toBe('Léa &amp; Co');
    const lien = new URL(variables['lien_reset']!);
    // Le `/api/` est le cœur du contrat : la page seule ne peut pas poser la session.
    expect(lien.pathname).toBe('/api/auth/reset-password/confirm');
    expect(lien.searchParams.get('token_hash')).toBe('jeton-haché');
    expect(lien.searchParams.get('type')).toBe('recovery');
  });

  it('adresse inconnue → même réponse 200, aucun email', async () => {
    mockGenerateLink.mockResolvedValue({
      data: { properties: null, user: null },
      error: { message: 'User not found', status: 404 },
    });
    const res = await demander('inconnu@traiteur.fr');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
  });

  it('au-delà de 3 demandes par heure pour une adresse → 200, aucun lien fabriqué', async () => {
    for (let i = 0; i < 3; i++) await demander('chef@traiteur.fr');
    const res = await demander('Chef@Traiteur.fr ');

    expect(res.status).toBe(200);
    expect(mockGenerateLink).toHaveBeenCalledTimes(3);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(3);
  });

  it('au-delà de 10 demandes par heure depuis une même adresse IP → aucun lien fabriqué', async () => {
    for (let i = 0; i < 11; i++)
      await demander(`p${i}@traiteur.fr`, '198.51.100.9');
    expect(mockGenerateLink).toHaveBeenCalledTimes(10);
  });

  it("une panne au moment de l'envoi ne remonte pas : la réponse reste 200", async () => {
    mockGenerateLink.mockRejectedValue(new Error('réseau'));
    const res = await demander('chef@traiteur.fr');
    expect(res.status).toBe(200);
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
  });

  it('email absent → 422, rien de fabriqué', async () => {
    const res = await demander('   ');
    expect(res.status).toBe(422);
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });
});

describe("route d'échange du lien envoyé par Resend (token_hash)", () => {
  it('jeton valide → verifyOtp recovery, puis le formulaire', async () => {
    const { GET } =
      await import('@/app/api/auth/reset-password/confirm/route.js');
    const res = await GET(makeGet('?token_hash=jeton-haché&type=recovery'));

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      token_hash: 'jeton-haché',
      type: 'recovery',
    });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(new URL(res.headers.get('location')!).pathname).toBe(
      '/reset-password/confirm',
    );
  });

  it('jeton refusé (expiré, déjà servi) → retour à la demande, jamais le formulaire', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {},
      error: { message: 'Token has expired or is invalid' },
    });
    const { GET } =
      await import('@/app/api/auth/reset-password/confirm/route.js');
    const res = await GET(makeGet('?token_hash=perime&type=recovery'));

    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/reset-password');
    expect(location.searchParams.get('error')).toBe('lien_invalide');
  });

  it("jeton d'un autre type (signup, magiclink) → refusé sans échange", async () => {
    const { GET } =
      await import('@/app/api/auth/reset-password/confirm/route.js');
    const res = await GET(makeGet('?token_hash=jeton&type=magiclink'));

    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(
      new URL(res.headers.get('location')!).searchParams.get('error'),
    ).toBe('lien_invalide');
  });
});

describe("route d'échange de l'ancien lien (code PKCE)", () => {
  it('code valide → session posée puis redirection vers le formulaire', async () => {
    const { GET } =
      await import('@/app/api/auth/reset-password/confirm/route.js');
    const res = await GET(makeGet('?code=code-valide'));

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('code-valide');
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe(
      '/reset-password/confirm',
    );
  });

  it('sans code → retour à la demande, motif affiché, aucun échange tenté', async () => {
    const { GET } =
      await import('@/app/api/auth/reset-password/confirm/route.js');
    const res = await GET(makeGet(''));

    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/reset-password');
    expect(location.searchParams.get('error')).toBe('lien_invalide');
  });

  it('échange refusé (lien expiré, déjà servi, autre navigateur) → retour à la demande, JAMAIS le formulaire', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { message: 'invalid flow state' },
    });
    const { GET } =
      await import('@/app/api/auth/reset-password/confirm/route.js');
    const res = await GET(makeGet('?code=code-perime'));

    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/reset-password');
    expect(location.searchParams.get('error')).toBe('lien_invalide');
    // Sans cette garde, l'utilisateur atteint un formulaire qui ne peut pas
    // aboutir : il saisit deux fois un mot de passe pour un 401 final.
    expect(location.pathname).not.toBe('/reset-password/confirm');
  });
});

// Code de vérification de l'équipe Savr (lib/code-verification.ts) : un compte
// qui a déjà un code passe par l'écran du code avant de choisir son nouveau mot
// de passe (`api/auth/update-password` refuse sans lui).
describe('lien de réinitialisation et code de vérification', () => {
  // Code demandé en production seulement (lib/code-verification.ts).
  beforeEach(() => vi.stubEnv('VERCEL_ENV', 'production'));
  afterEach(() => vi.unstubAllEnvs());

  const jeton = (claims: Record<string, unknown>) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  const session = (
    role: string,
    factors: Array<{ id: string; factor_type: string; status: string }>,
    autresClaims: Record<string, unknown> = {},
  ) => ({
    data: {
      session: {
        access_token: jeton({ user_role: role, aal: 'aal1', ...autresClaims }),
      },
      user: { id: 'u-1', factors },
    },
    error: null,
  });
  const ACTIF = { id: 'f-1', factor_type: 'totp', status: 'verified' };

  it('admin avec un code actif → écran du code, puis retour au formulaire', async () => {
    mockExchangeCodeForSession.mockResolvedValue(
      session('admin_savr', [ACTIF]),
    );
    const { GET } =
      await import('@/app/api/auth/reset-password/confirm/route.js');
    const res = await GET(makeGet('?code=code-valide'));
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/code-verification');
    expect(location.searchParams.get('next')).toBe('/reset-password/confirm');
  });

  it('nouveau lien (token_hash) : admin avec un code actif → écran du code aussi', async () => {
    mockVerifyOtp.mockResolvedValue(session('admin_savr', [ACTIF]));
    const { GET } =
      await import('@/app/api/auth/reset-password/confirm/route.js');
    const res = await GET(makeGet('?token_hash=jeton&type=recovery'));
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/code-verification');
    expect(location.searchParams.get('next')).toBe('/reset-password/confirm');
  });

  it('admin sans code actif (premier mot de passe, code réinitialisé) → formulaire directement', async () => {
    mockExchangeCodeForSession.mockResolvedValue(session('admin_savr', []));
    const { GET } =
      await import('@/app/api/auth/reset-password/confirm/route.js');
    const res = await GET(makeGet('?code=code-valide'));
    expect(new URL(res.headers.get('location')!).pathname).toBe(
      '/reset-password/confirm',
    );
  });

  it('hors production : admin avec code actif → formulaire directement', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    mockExchangeCodeForSession.mockResolvedValue(
      session('admin_savr', [ACTIF]),
    );
    const { GET } =
      await import('@/app/api/auth/reset-password/confirm/route.js');
    const res = await GET(makeGet('?code=code-valide'));
    expect(new URL(res.headers.get('location')!).pathname).toBe(
      '/reset-password/confirm',
    );
  });

  // Organisation qui exige le code (VIPARIS, Val 2026-11-10) : claim du hook.
  it('client d’une organisation qui exige le code, code actif → écran du code, puis retour au formulaire', async () => {
    mockVerifyOtp.mockResolvedValue(
      session('gestionnaire_lieux', [ACTIF], {
        code_verification_obligatoire: true,
      }),
    );
    const { GET } =
      await import('@/app/api/auth/reset-password/confirm/route.js');
    const res = await GET(makeGet('?token_hash=jeton&type=recovery'));
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/code-verification');
    expect(location.searchParams.get('next')).toBe('/reset-password/confirm');
  });

  it('client sans claim d’organisation → formulaire directement (aucun code pour lui)', async () => {
    mockExchangeCodeForSession.mockResolvedValue(
      session('traiteur_manager', [ACTIF]),
    );
    const { GET } =
      await import('@/app/api/auth/reset-password/confirm/route.js');
    const res = await GET(makeGet('?code=code-valide'));
    expect(new URL(res.headers.get('location')!).pathname).toBe(
      '/reset-password/confirm',
    );
  });
});

/**
 * Parcours « mot de passe oublié » — maillon serveur.
 *
 * Le lien de l'email de réinitialisation ne peut PAS viser directement la page de
 * saisie : `@supabase/ssr` impose le flux PKCE, donc GoTrue redirige avec un
 * `?code=` qu'il faut échanger contre une session, et seule une route peut écrire
 * les cookies. Ces tests épinglent les deux bouts de ce contrat — la cible du lien
 * émis, et le comportement de la route d'échange, y compris quand il échoue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockExchangeCodeForSession = vi.fn();
const mockResetPasswordForEmail = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
      resetPasswordForEmail: mockResetPasswordForEmail,
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeGet(query: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/auth/reset-password/confirm${query}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
});

describe('cible du lien de réinitialisation', () => {
  it("le lien émis vise la route d'échange, jamais la page de saisie seule", async () => {
    const { POST } = await import('@/app/api/auth/reset-password/route.js');
    const res = await POST(
      new NextRequest('http://localhost/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'chef@traiteur.fr' }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(200);
    expect(mockResetPasswordForEmail).toHaveBeenCalledTimes(1);
    const [email, options] = mockResetPasswordForEmail.mock.calls[0] as [
      string,
      { redirectTo: string },
    ];
    expect(email).toBe('chef@traiteur.fr');
    // Le `/api/` est le cœur du contrat : sans lui, la redirection tombe sur la
    // page, qui ne peut pas poser la session — le formulaire s'afficherait pour
    // finir en 401 à l'enregistrement.
    expect(new URL(options.redirectTo, 'http://localhost').pathname).toBe(
      '/api/auth/reset-password/confirm',
    );
  });
});

describe("route d'échange du code de réinitialisation", () => {
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

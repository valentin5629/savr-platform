/**
 * M0.6 — Montage du bandeau d'impersonation (BL-P1-AUTH-01).
 * Le bandeau ne s'affiche que si la session porte le claim `impersonator_id`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockGetSession = vi.fn();
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}));

import { ImpersonationBannerMount } from '@/components/ui/impersonation-banner-mount';

// Forge un access_token JWT (base64url, non paddé) avec les claims donnés.
function makeToken(claims: Record<string, unknown>): string {
  const b64url = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;
}

describe('M0.6 — bandeau impersonation (BL-P1-AUTH-01)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('M0.6 — affiche le bandeau quand le claim impersonator_id est présent', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: makeToken({
            impersonator_id: 'admin-1',
            email: 'cible@traiteur.fr',
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        },
      },
    });

    render(<ImpersonationBannerMount />);
    await waitFor(() =>
      expect(screen.getByText(/cible@traiteur\.fr/)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: /Quitter l'impersonation/i }),
    ).toBeInTheDocument();
  });

  it('M0.6 — n’affiche rien pour une session normale (pas de claim)', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: { access_token: makeToken({ user_role: 'traiteur_manager' }) },
      },
    });

    const { container } = render(<ImpersonationBannerMount />);
    // Laisse l'effet async se résoudre.
    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('M0.6 — onExit POST /api/auth/exit-impersonation', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: makeToken({
            impersonator_id: 'admin-1',
            email: 'cible@traiteur.fr',
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        },
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    // window.location.href assignable sous jsdom.
    const hrefSetter = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        set href(v: string) {
          hrefSetter(v);
        },
        get href() {
          return '';
        },
      },
    });

    render(<ImpersonationBannerMount />);
    const btn = await screen.findByRole('button', {
      name: /Quitter l'impersonation/i,
    });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/exit-impersonation',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});

/**
 * Test UI — page /auth/accept-invitation (finalisation d'un compte self-service).
 * Couvre : rendu du formulaire avec token, écran « Lien invalide » sans token,
 * soumission (POST accept-invitation avec le body attendu) + écran de succès.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import AcceptInvitationPage from '@/app/auth/accept-invitation/page.js';

const mockPush = vi.fn();
let currentSearch = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  currentSearch = '';
  global.fetch = mockFetch as unknown as typeof fetch;
});
afterEach(() => cleanup());

describe('accept-invitation page', () => {
  it('sans token_hash → écran « Lien invalide »', () => {
    currentSearch = '';
    render(<AcceptInvitationPage />);
    expect(screen.getByText('Lien invalide')).toBeTruthy();
  });

  it('avec token_hash → rend le formulaire de finalisation', () => {
    currentSearch = 'token_hash=abc&type=invite';
    render(<AcceptInvitationPage />);
    expect(screen.getByText('Finaliser votre compte')).toBeTruthy();
    expect(screen.getByText('Activer mon compte')).toBeTruthy();
  });

  it('soumission → POST accept-invitation avec le token + CGU, puis écran succès', async () => {
    currentSearch = 'token_hash=abc&type=invite';
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<AcceptInvitationPage />);

    const inputs = screen.getAllByRole('textbox'); // prénom, nom
    fireEvent.change(inputs[0]!, { target: { value: 'Jeanne' } });
    fireEvent.change(inputs[1]!, { target: { value: 'Martin' } });
    // input password (type=password n'est pas un 'textbox' role)
    const pwd = document.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    fireEvent.change(pwd, { target: { value: 'SavrTest2026!' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Activer mon compte'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/auth/accept-invitation',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"token_hash":"abc"'),
        }),
      );
    });
    const body = JSON.parse(
      (mockFetch.mock.calls[0]![1] as { body: string }).body,
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      token_hash: 'abc',
      prenom: 'Jeanne',
      nom: 'Martin',
      mot_de_passe: 'SavrTest2026!',
      acceptation_cgu: true,
    });
    await waitFor(() => expect(screen.getByText('Compte créé')).toBeTruthy());
  });

  it('erreur serveur → message affiché, pas d’écran succès', async () => {
    currentSearch = 'token_hash=abc&type=invite';
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Lien expiré' }),
    });
    render(<AcceptInvitationPage />);

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0]!, { target: { value: 'Jeanne' } });
    fireEvent.change(inputs[1]!, { target: { value: 'Martin' } });
    const pwd = document.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    fireEvent.change(pwd, { target: { value: 'SavrTest2026!' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Activer mon compte'));

    await waitFor(() => expect(screen.getByText('Lien expiré')).toBeTruthy());
    expect(screen.queryByText('Compte créé')).toBeNull();
  });
});

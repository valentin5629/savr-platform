/**
 * M0.6 — Lanceur d'impersonation admin (BL-P1-BOA-09, volet impersonation UI).
 * Réservé admin_savr ; select des utilisateurs + bouton → POST impersoner → navigation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockGetSession = vi.fn();
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({ auth: { getSession: mockGetSession } }),
}));

import { ImpersonationLauncher } from '@/components/ui/impersonation-launcher';

function makeToken(claims: Record<string, unknown>): string {
  const b64url = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;
}

function sessionWithRole(role: string, sub = 'admin-self') {
  return {
    data: { session: { access_token: makeToken({ user_role: role, sub }) } },
  };
}

const USERS = [
  {
    id: 'u-1',
    prenom: 'Marie',
    nom: 'Démo',
    email: 'manager.demo@savr-test.local',
    role: 'traiteur_manager',
    organisations: { raison_sociale: 'Traiteur Démo' },
  },
  {
    id: 'admin-self',
    prenom: 'Admin',
    nom: 'Savr',
    email: 'admin@savr-test.local',
    role: 'admin_savr',
    organisations: { raison_sociale: 'Savr' },
  },
];

describe('M0.6 — lanceur impersonation admin (BL-P1-BOA-09)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('M0.6 — masqué pour un rôle non-admin (ops_savr)', async () => {
    mockGetSession.mockResolvedValue(sessionWithRole('ops_savr'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<ImpersonationLauncher />);
    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    expect(container.querySelector('select')).toBeNull();
    // ops ne déclenche même pas le fetch de la liste
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('M0.6 — admin_savr : liste les utilisateurs (hors soi-même) + bouton', async () => {
    mockGetSession.mockResolvedValue(sessionWithRole('admin_savr'));
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: USERS }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<ImpersonationLauncher />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Impersoner/i }),
      ).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/users?actif=true');
    // la cible non-admin apparaît, l'admin lui-même est exclu
    expect(
      screen.getByRole('option', { name: /manager\.demo@savr-test\.local/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: /admin@savr-test\.local/ }),
    ).toBeNull();
  });

  it('M0.6 — sélection + Impersoner → POST impersoner puis navigation vers le lien', async () => {
    mockGetSession.mockResolvedValue(sessionWithRole('admin_savr'));
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/impersoner')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            lien_impersonation:
              '/auth/impersonate-callback?token_hash=x&type=magiclink&impersonator=admin-self',
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: USERS }) });
    });
    vi.stubGlobal('fetch', fetchMock);
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

    render(<ImpersonationLauncher />);
    const select = (await screen.findByLabelText(
      'Utilisateur à impersonner',
    )) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'u-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Impersoner/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/users/u-1/impersoner',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() =>
      expect(hrefSetter).toHaveBeenCalledWith(
        expect.stringContaining('/auth/impersonate-callback'),
      ),
    );
  });
});

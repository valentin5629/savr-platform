/**
 * M1.2 — Formulaire de programmation : mode « admin support » (§06.01 l.15,
 * `admin_savr` = programmation de support, tous périmètres).
 *
 * Régression corrigée : le bouton « Programmer une collecte » du back-office
 * pointait vers /admin/collectes/nouvelle (route inexistante → capturée par
 * [id] → 500 « Erreur serveur »). Il pointe désormais vers /programmer/nouveau,
 * et ce formulaire expose enfin un sélecteur d'organisation cible pour l'admin
 * (agence/gestionnaire l'avaient déjà, l'admin non).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

const mockGetSession = vi.fn();
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({ auth: { getSession: mockGetSession } }),
}));

import NouveauProgrammationPage from './page';

function makeToken(claims: Record<string, unknown>): string {
  const b64url = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;
}

// fetch router : types-evenements + liste traiteurs (le reste n'est pas sollicité
// à l'étape 1). Toute autre URL → 200 [] par défaut (dégradation gracieuse).
function installFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/programmation/types-evenements')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 't1', code: 'cocktail', libelle: 'Cocktail' },
          ]),
      } as Response);
    }
    if (url.includes('/programmation/organisations/traiteurs')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: 'org-kaspia',
              nom: 'Kaspia',
              raison_sociale: 'Kaspia SAS',
              siret: null,
            },
          ]),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  mockGetSession.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('M1.2 — programmation formulaire : mode admin support', () => {
  it("admin_savr voit le sélecteur d'organisation cible + les traiteurs", async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: { access_token: makeToken({ user_role: 'admin_savr' }) },
      },
    });
    installFetch();

    render(<NouveauProgrammationPage />);

    // Le libellé du sélecteur est spécifique à l'admin (programmation de support).
    expect(
      await screen.findByText('Traiteur (pour le compte de)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/la collecte sera créée au nom de ce traiteur/i),
    ).toBeInTheDocument();
    // Le traiteur chargé apparaît comme option sélectionnable.
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: 'Kaspia' }),
      ).toBeInTheDocument(),
    );
  });

  it('un traiteur (rôle non-programmateur-tiers) ne voit PAS le sélecteur', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: { access_token: makeToken({ user_role: 'traiteur_manager' }) },
      },
    });
    installFetch();

    render(<NouveauProgrammationPage />);

    // Attendre que le rôle soit lu (le type d'événement est chargé dans tous les cas).
    await screen.findByText("Informations sur l'événement");
    expect(
      screen.queryByText('Traiteur (pour le compte de)'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Traiteur opérant')).not.toBeInTheDocument();
  });
});

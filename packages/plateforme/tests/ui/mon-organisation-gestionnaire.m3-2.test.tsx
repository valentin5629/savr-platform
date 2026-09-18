/**
 * M3.2 — Page « Mon organisation » gestionnaire de lieux (§06.05 nav 8).
 * Régression E2E : l'onglet Profil s'affichait vide (route en 500, aucun état
 * d'erreur rendu).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from '@testing-library/react';

import MonOrganisationPage from '@/app/(gestionnaire)/gestionnaire/mon-organisation/page.js';
import { ATTENTE_UI } from '@/test-utils/attente-ui';

const PROFIL = {
  id: 'org-viparis',
  nom: 'Viparis',
  raison_sociale: 'Viparis SAS',
  siret: '12345678900011',
  adresse: null,
  email_principal: null,
  telephone: null,
  logo_url: null,
};

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('M3.2 / page Mon organisation gestionnaire', () => {
  it('M3.2/mon_organisation_profil_affiche', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(reponse(200, { data: PROFIL }))),
    );
    render(<MonOrganisationPage />);
    expect(await screen.findByText('Viparis SAS', {}, ATTENTE_UI)).toBeTruthy();
    expect(screen.getByText('12345678900011')).toBeTruthy();
  });

  it('M3.2/mon_organisation_erreur_affichee', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(reponse(500, { error: 'Erreur serveur' }))),
    );
    render(<MonOrganisationPage />);
    expect(
      (await screen.findByRole('alert', {}, ATTENTE_UI)).textContent,
    ).toMatch(/Impossible de charger/);
  });

  it('M3.2/mon_organisation_erreur_onglet_quitte_ignoree', async () => {
    // Profil répond en échec APRÈS le passage sur Factures : son erreur ne
    // doit pas s'afficher sur l'onglet Factures.
    let echouerProfil: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('/profil')
          ? new Promise<Response>((res) => {
              echouerProfil = res;
            })
          : Promise.resolve(reponse(200, { data: [] })),
      ),
    );
    render(<MonOrganisationPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Factures' }));
    expect(
      await screen.findByText('Aucune facture.', {}, ATTENTE_UI),
    ).toBeTruthy();
    echouerProfil(reponse(500, { error: 'Erreur serveur' }));
    // Laisse la promesse rejetée se propager (fetchData → catch → finally).
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Aucune facture.')).toBeTruthy();
  });
});

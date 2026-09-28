/**
 * Carte « Informations légales » partagée (agence, client organisateur,
 * traiteur, gestionnaire) — décision Val 2026-09-28 : modifiable par tous les rôles.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { InfosLegalesOrganisation } from '@/components/organisation/infos-legales-card.js';
import { NAV_CONFIG } from '@/lib/nav-config.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const URL_PROFIL = '/api/v1/agence/mon-organisation/profil';
const PROFIL = {
  id: 'org-arep',
  nom: 'Agence AREP',
  raison_sociale: 'AREP SARL',
  siret: null,
  adresse: null,
  email_principal: 'contact@arep.test',
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

describe('Informations légales — carte partagée', () => {
  it(
    'affiche les valeurs de l’organisation et les champs en lecture seule',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse(200, { data: PROFIL }))),
      );
      render(<InfosLegalesOrganisation urlProfil={URL_PROFIL} />);
      expect(
        await screen.findByDisplayValue('AREP SARL', {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(screen.getByText('Agence AREP')).toBeTruthy();
      expect(screen.getByText('contact@arep.test')).toBeTruthy();
      // Rien à enregistrer tant qu'aucun champ n'a changé.
      expect(
        (
          screen.getByRole('button', {
            name: 'Enregistrer',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'n’envoie que le champ modifié et confirme l’enregistrement',
    async () => {
      const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'PATCH'
            ? reponse(200, { data: { ...PROFIL, siret: '12345678900011' } })
            : reponse(200, { data: PROFIL }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      render(<InfosLegalesOrganisation urlProfil={URL_PROFIL} />);
      const champ = await screen.findByLabelText('SIRET', {}, ATTENTE_UI);
      fireEvent.change(champ, { target: { value: '12345678900011' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
      expect(
        (await screen.findByRole('status', {}, ATTENTE_UI)).textContent,
      ).toBe('Informations enregistrées.');
      const patch = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH');
      expect(patch?.[0]).toBe(URL_PROFIL);
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
        siret: '12345678900011',
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'affiche l’erreur renvoyée par le serveur',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init?: RequestInit) =>
          Promise.resolve(
            init?.method === 'PATCH'
              ? reponse(422, {
                  error: 'Valeur trop longue (500 caractères maximum)',
                })
              : reponse(200, { data: PROFIL }),
          ),
        ),
      );
      render(<InfosLegalesOrganisation urlProfil={URL_PROFIL} />);
      const champ = await screen.findByLabelText('Adresse', {}, ATTENTE_UI);
      fireEvent.change(champ, { target: { value: '1 rue Neuve' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
      expect(
        (await screen.findByRole('alert', {}, ATTENTE_UI)).textContent,
      ).toMatch(/Valeur trop longue/);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'chargement en échec : message d’erreur, pas de formulaire vide',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse(500, { error: 'x' }))),
      );
      render(<InfosLegalesOrganisation urlProfil={URL_PROFIL} />);
      expect(
        (await screen.findByRole('alert', {}, ATTENTE_UI)).textContent,
      ).toMatch(/Impossible de charger/);
      expect(screen.queryByRole('textbox')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

describe('Navigation — accès à ses informations pour tous les rôles', () => {
  it.each([
    ['client_organisateur', '/organisateur/mon-organisation'],
    ['client_organisateur', '/organisateur/mon-profil'],
    ['admin_savr', '/admin/mon-profil'],
  ] as const)('%s → %s', (role, href) => {
    const hrefs = NAV_CONFIG[role].flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain(href);
  });
});

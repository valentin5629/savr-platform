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
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

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
  it(
    'M3.2/mon_organisation_profil_affiche',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse(200, { data: PROFIL }))),
      );
      render(<MonOrganisationPage />);
      expect(
        await screen.findByText('Viparis SAS', {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(screen.getByText('12345678900011')).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/mon_organisation_champs_lecture_seule',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse(200, { data: PROFIL }))),
      );
      render(<MonOrganisationPage />);
      await screen.findByText('Viparis SAS', {}, ATTENTE_UI);
      // §06.05 §6 : seule l'adresse est un champ de saisie (+ l'upload logo).
      const champs = screen.getAllByRole('textbox');
      expect(champs).toHaveLength(1);
      expect(champs[0]?.id).toBe('org-adresse');
      expect(screen.getByText('Viparis')).toBeTruthy();
      expect(screen.getByText('Modification via le support Savr')).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/mon_organisation_adresse_enregistree',
    async () => {
      const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'PATCH'
            ? reponse(200, {
                data: { ...PROFIL, adresse: '2 place de la Porte Maillot' },
              })
            : reponse(200, { data: PROFIL }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      render(<MonOrganisationPage />);
      const champ = await screen.findByLabelText('Adresse', {}, ATTENTE_UI);
      const bouton = screen.getByRole('button', { name: 'Enregistrer' });
      // Rien à enregistrer tant que l'adresse n'a pas changé.
      expect((bouton as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(champ, {
        target: { value: '2 place de la Porte Maillot' },
      });
      fireEvent.click(bouton);
      expect(
        (await screen.findByRole('status', {}, ATTENTE_UI)).textContent,
      ).toBe('Adresse enregistrée.');
      const patch = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH');
      expect(patch?.[0]).toBe('/api/v1/gestionnaire/mon-organisation/profil');
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
        adresse: '2 place de la Porte Maillot',
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/mon_organisation_adresse_erreur_serveur_affichee',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init?: RequestInit) =>
          Promise.resolve(
            init?.method === 'PATCH'
              ? reponse(422, {
                  error: 'Adresse trop longue (500 caractères maximum)',
                })
              : reponse(200, { data: PROFIL }),
          ),
        ),
      );
      render(<MonOrganisationPage />);
      const champ = await screen.findByLabelText('Adresse', {}, ATTENTE_UI);
      fireEvent.change(champ, { target: { value: '1 rue Neuve' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
      expect(
        (await screen.findByRole('alert', {}, ATTENTE_UI)).textContent,
      ).toMatch(/Adresse trop longue/);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/mon_organisation_logo_upload_puis_enregistre',
    async () => {
      const CLE = 'savr-dev/logos/0b8e6f5c-2f1a-4c47-9d3e-6a1f2b3c4d5e.png';
      const fetchMock = vi.fn((url: string, init?: RequestInit) =>
        Promise.resolve(
          url.endsWith('/logo') && init?.method === 'POST'
            ? reponse(201, { logo_url: CLE })
            : init?.method === 'PATCH'
              ? reponse(200, { data: { ...PROFIL, logo_url: CLE } })
              : reponse(200, { data: PROFIL }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      render(<MonOrganisationPage />);
      const input = await screen.findByLabelText(
        'Ajouter un logo',
        {},
        ATTENTE_UI,
      );
      fireEvent.change(input, {
        target: {
          files: [
            new File([new Uint8Array([1])], 'l.png', { type: 'image/png' }),
          ],
        },
      });
      expect(
        (await screen.findByRole('status', {}, ATTENTE_UI)).textContent,
      ).toBe('Logo mis à jour.');
      const patch = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH');
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ logo_url: CLE });
      // Aperçu servi par le proxy de SA propre organisation ; libellé remplacé.
      expect(
        screen.getByAltText("Logo de l'organisation").getAttribute('src'),
      ).toMatch(/^\/api\/v1\/gestionnaire\/mon-organisation\/logo\?/);
      expect(screen.getByText('Remplacer le logo')).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/mon_organisation_logo_envoye_non_enregistre',
    async () => {
      const CLE = 'savr-dev/logos/0b8e6f5c-2f1a-4c47-9d3e-6a1f2b3c4d5e.png';
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init?: RequestInit) =>
          Promise.resolve(
            url.endsWith('/logo') && init?.method === 'POST'
              ? reponse(201, { logo_url: CLE })
              : init?.method === 'PATCH'
                ? reponse(422, { error: 'Enregistrement impossible' })
                : reponse(200, { data: PROFIL }),
          ),
        ),
      );
      render(<MonOrganisationPage />);
      const input = await screen.findByLabelText(
        'Ajouter un logo',
        {},
        ATTENTE_UI,
      );
      fireEvent.change(input, {
        target: {
          files: [
            new File([new Uint8Array([1])], 'l.png', { type: 'image/png' }),
          ],
        },
      });
      expect(
        (await screen.findByRole('alert', {}, ATTENTE_UI)).textContent,
      ).toMatch(/Logo envoyé mais non enregistré/);
      expect(screen.queryByRole('status')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/mon_organisation_logo_refuse_sans_patch',
    async () => {
      const fetchMock = vi.fn((url: string, init?: RequestInit) =>
        Promise.resolve(
          url.endsWith('/logo') && init?.method === 'POST'
            ? reponse(422, {
                error: 'Format non supporté (JPG ou PNG uniquement)',
              })
            : reponse(200, { data: PROFIL }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      render(<MonOrganisationPage />);
      const input = await screen.findByLabelText(
        'Ajouter un logo',
        {},
        ATTENTE_UI,
      );
      fireEvent.change(input, {
        target: { files: [new File(['x'], 'l.gif', { type: 'image/gif' })] },
      });
      expect(
        (await screen.findByRole('alert', {}, ATTENTE_UI)).textContent,
      ).toMatch(/Format non supporté/);
      expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(
        false,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/mon_organisation_factures_lignes_pdf_pennylane_prioritaire',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) =>
          Promise.resolve(
            url.endsWith('/factures')
              ? reponse(200, {
                  data: [
                    {
                      id: 'f1',
                      numero_facture: 'VIP-001',
                      statut: 'emise',
                      date_emission: '2026-06-01',
                      montant_ttc: 1200,
                      pdf_url_savr: 'https://savr.test/f1.pdf',
                      pdf_url_pennylane: 'https://pennylane.test/f1.pdf',
                    },
                  ],
                })
              : reponse(200, { data: PROFIL }),
          ),
        ),
      );
      render(<MonOrganisationPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Factures' }));
      expect(await screen.findByText('VIP-001', {}, ATTENTE_UI)).toBeTruthy();
      // §06.04 §6 fiche facture : pdf_url_pennylane si dispo, sinon pdf_url_savr.
      expect(
        screen.getByRole('link', { name: 'Télécharger' }).getAttribute('href'),
      ).toBe('https://pennylane.test/f1.pdf');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/mon_organisation_erreur_affichee',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse(500, { error: 'Erreur serveur' }))),
      );
      render(<MonOrganisationPage />);
      expect(
        (await screen.findByRole('alert', {}, ATTENTE_UI)).textContent,
      ).toMatch(/Impossible de charger/);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/mon_organisation_erreur_onglet_quitte_ignoree',
    async () => {
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
    },
    ATTENTE_CAS_MS,
  );
});

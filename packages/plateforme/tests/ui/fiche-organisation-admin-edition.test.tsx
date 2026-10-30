/**
 * Fiche organisation Admin — édition (Val 2026-10-30) : bouton « Modifier » des
 * informations légales (pré-rempli, PATCH de la fiche), ajout d'un domaine email
 * (vérifié d'emblée côté serveur) avec son statut affiché, ajout et modification
 * d'une entité de facturation.
 *
 * `params` : promesse déjà marquée résolue au sens de React 19 (cf.
 * tests/ui/logo-organisation-proxy.test.tsx pour le motif).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
vi.mock('@/lib/use-user-role', () => ({ useUserRole: () => 'admin_savr' }));

import ClientFichePage from '@/app/(admin)/admin/clients/[id]/page.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const params = (id: string) =>
  Object.assign(Promise.resolve({ id }), {
    status: 'fulfilled',
    value: { id },
  });

const ORG = {
  id: 'org-arep',
  nom: 'AREP',
  raison_sociale: 'AREP SARL',
  type: 'agence',
  siret: null,
  email_principal: 'contact@arep.fr',
  telephone: null,
  adresse: null,
  actif: true,
  logo_url: null,
  tarif_refacture_pax_zd: null,
  grille_tarifaire_zd_id: null,
  entites_facturation: [
    {
      id: 'ef-1',
      raison_sociale: 'AREP Facturation',
      siret: '12345678900012',
      siret_verification: 'verifie',
      tva_intracom: null,
      adresse_facturation: '1 rue X',
      code_postal: '75001',
      ville: 'Paris',
      email_facturation: null,
      contact_compta_nom: null,
      entite_par_defaut: true,
      actif: true,
    },
  ],
  organisations_domaines_email: [
    { id: 'd-1', domaine: 'arep.fr', verifie_at: null },
  ],
  users: [],
  packs_antgaspi: [],
  tarifs_negocie: [],
};

type Init = { method?: string; body?: string } | undefined;
const fetchMock = vi.fn((url: string, init?: Init) => {
  void url;
  void init;
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(ORG),
  } as Response);
});

const appels = (methode: string) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === methode);

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

async function ouvrir() {
  render(<ClientFichePage params={params('org-arep')} />);
  await screen.findByText('AREP SARL', undefined, ATTENTE_UI);
}

describe('Fiche organisation Admin — édition', () => {
  it(
    'Modifier les informations légales : formulaire pré-rempli, PATCH de la fiche',
    async () => {
      await ouvrir();
      fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
      const nom = await screen.findByLabelText(/^Nom/, undefined, ATTENTE_UI);
      expect((nom as HTMLInputElement).value).toBe('AREP');
      fireEvent.change(screen.getByLabelText(/^Téléphone/), {
        target: { value: '01 02 03 04 05' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
      await waitFor(() => expect(appels('PATCH')).toHaveLength(1), ATTENTE_UI);
      const [url, init] = appels('PATCH')[0]!;
      expect(url).toBe('/api/v1/admin/organisations/org-arep');
      expect(JSON.parse(init!.body!)).toMatchObject({
        nom: 'AREP',
        type: 'agence',
        email_principal: 'contact@arep.fr',
        telephone: '01 02 03 04 05',
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'Domaines : statut affiché, ajout par POST, vérification par PATCH',
    async () => {
      await ouvrir();
      expect(screen.getByText('@arep.fr')).toBeTruthy();
      expect(screen.getByText('Non vérifié')).toBeTruthy();

      fireEvent.change(screen.getByLabelText('Domaine à ajouter'), {
        target: { value: 'arep-groupe.fr' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: 'Ajouter le domaine' }),
      );
      await waitFor(() => expect(appels('POST')).toHaveLength(1), ATTENTE_UI);
      const [url, init] = appels('POST')[0]!;
      expect(url).toBe('/api/v1/admin/organisations/org-arep/domaines-email');
      expect(JSON.parse(init!.body!)).toEqual({ domaine: 'arep-groupe.fr' });

      fireEvent.click(
        screen.getByRole('button', { name: 'Marquer comme vérifié' }),
      );
      await waitFor(() => expect(appels('PATCH')).toHaveLength(1), ATTENTE_UI);
      expect(appels('PATCH')[0]![0]).toBe(
        '/api/v1/admin/organisations/org-arep/domaines-email/d-1',
      );
      expect(JSON.parse(appels('PATCH')[0]![1]!.body!)).toEqual({
        verifie: true,
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'Entités de facturation : modification par PATCH de l’entité, ajout par POST',
    async () => {
      await ouvrir();
      fireEvent.click(
        screen.getByRole('button', { name: 'Modifier AREP Facturation' }),
      );
      const ville = await screen.findByLabelText(
        /^Ville/,
        undefined,
        ATTENTE_UI,
      );
      expect((ville as HTMLInputElement).value).toBe('Paris');
      fireEvent.change(ville, { target: { value: 'Lyon' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
      await waitFor(() => expect(appels('PATCH')).toHaveLength(1), ATTENTE_UI);
      expect(appels('PATCH')[0]![0]).toBe(
        '/api/v1/admin/organisations/org-arep/entites-facturation/ef-1',
      );
      expect(JSON.parse(appels('PATCH')[0]![1]!.body!)).toMatchObject({
        ville: 'Lyon',
      });

      await waitFor(
        () => expect(screen.queryByLabelText(/^Ville/)).toBeNull(),
        ATTENTE_UI,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
      fireEvent.change(
        await screen.findByLabelText(/^Raison sociale/, undefined, ATTENTE_UI),
        {
          target: { value: 'AREP Bis' },
        },
      );
      fireEvent.change(screen.getByLabelText(/^SIRET/), {
        target: { value: '98765432100019' },
      });
      fireEvent.change(screen.getByLabelText(/^Adresse/), {
        target: { value: '2 rue Y' },
      });
      fireEvent.change(screen.getByLabelText(/^Code postal/), {
        target: { value: '69001' },
      });
      fireEvent.change(screen.getByLabelText(/^Ville/), {
        target: { value: 'Lyon' },
      });
      const ajouts = screen.getAllByRole('button', { name: 'Ajouter' });
      fireEvent.click(ajouts[ajouts.length - 1]!);
      await waitFor(() => expect(appels('POST')).toHaveLength(1), ATTENTE_UI);
      expect(appels('POST')[0]![0]).toBe(
        '/api/v1/admin/organisations/org-arep/entites-facturation',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'Client organisateur : ni ajout ni vérification de domaine',
    async () => {
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ...ORG, type: 'client_organisateur' }),
        } as Response),
      );
      await ouvrir();
      expect(screen.queryByLabelText('Domaine à ajouter')).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Marquer comme vérifié' }),
      ).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Retirer @arep.fr' }),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );
});

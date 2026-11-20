/**
 * Fiche lieu Admin, onglet « Informations », section « Adresse » : jusqu'à 3
 * adresses de livraison (Val 2026-11-19). Affichage des adresses enregistrées,
 * ajout, retrait, champs obligatoires d'une adresse entamée, et corps du PATCH.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { LieuModal } from '@/components/admin/lieu-modal';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const DETAIL = {
  nom: 'Carrousel du Louvre',
  nom_alternatif: null,
  adresse_acces: '99 rue de Rivoli',
  code_postal: '75001',
  ville: 'Paris',
  libelle_adresse_1: 'Entrée public',
  libelle_adresse_2: 'Livraison',
  adresse_acces_2: '1 avenue du Général Lemonnier',
  code_postal_2: '75001',
  ville_2: 'Paris',
  libelle_adresse_3: null,
  adresse_acces_3: null,
  code_postal_3: null,
  ville_3: null,
  region: 'idf',
  acces_office: null,
  stationnement: null,
  type_vehicule_max: 'fourgon',
  controle_acces_requis_default: false,
  capacite_maximum: null,
  volume_max_bacs: null,
  contraintes_horaires: null,
  acces_details: null,
  flux_autorises: null,
  photos_urls: null,
  actif: true,
  gestionnaire_organisation_id: null,
  commentaire_lieu: null,
  commentaires_internes: null,
  siren: null,
  email_gestionnaire: null,
  reference_citeo: false,
  code_site_viparis: null,
};

function routeFetch() {
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/api/v1/programmation/adresses'))
      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: 'ban-1',
            label: '12 Villa Wagram 75008 Paris',
            adresse: '12 Villa Wagram',
            codePostal: '75008',
            ville: 'Paris',
          },
        ],
      });
    if (url.includes('/api/v1/admin/organisations'))
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
    if (url.endsWith('/activite'))
      return Promise.resolve({
        ok: true,
        json: async () => ({
          traiteurs: [],
          historique: [],
          historique_tronque: false,
        }),
      });
    if (/\/api\/v1\/admin\/lieux\/[^/?]+$/.test(url) && method === 'GET')
      return Promise.resolve({ ok: true, json: async () => DETAIL });
    return Promise.resolve({ ok: true, json: async () => ({ id: 'lieu-1' }) });
  });
}

function corpsPatch(fetchMock: ReturnType<typeof routeFetch>) {
  const appel = fetchMock.mock.calls.find(
    ([, o]) => (o as RequestInit | undefined)?.method === 'PATCH',
  );
  return JSON.parse((appel![1] as RequestInit).body as string) as Record<
    string,
    unknown
  >;
}

async function ouvrir() {
  const fetchMock = routeFetch();
  vi.stubGlobal('fetch', fetchMock);
  render(
    <LieuModal open lieuId="lieu-42" onClose={vi.fn()} onSaved={vi.fn()} />,
  );
  await screen.findByTestId('adresse-livraison-2', undefined, ATTENTE_UI);
  return fetchMock;
}

describe('M1.1b / Fiche lieu Admin — adresses de livraison', () => {
  afterEach(() => vi.restoreAllMocks());

  it(
    'affiche l’adresse n° 2 enregistrée et le libellé de l’adresse n° 1',
    async () => {
      await ouvrir();
      expect(
        (
          screen.getByLabelText(/^Adresse accès livraison/, {
            selector: '#lm_adresse_acces_2',
          }) as HTMLInputElement
        ).value,
      ).toBe('1 avenue du Général Lemonnier');
      expect(
        (document.getElementById('lm_libelle_adresse_1') as HTMLInputElement)
          .value,
      ).toBe('Entrée public');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'ajoute une adresse n° 3 et l’envoie au PATCH ; plus de bouton au-delà de 3',
    async () => {
      const fetchMock = await ouvrir();
      fireEvent.click(
        screen.getByRole('button', {
          name: /Ajouter une adresse de livraison/,
        }),
      );
      expect(
        screen.queryByRole('button', {
          name: /Ajouter une adresse de livraison/,
        }),
      ).toBeNull();
      fireEvent.change(document.getElementById('lm_adresse_acces_3')!, {
        target: { value: '2 quai des Tuileries' },
      });
      fireEvent.change(document.getElementById('lm_code_postal_3')!, {
        target: { value: '75001' },
      });
      fireEvent.change(document.getElementById('lm_ville_3')!, {
        target: { value: 'Paris' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
      await waitFor(
        () => expect(corpsPatch(fetchMock)).toBeTruthy(),
        ATTENTE_UI,
      );
      expect(corpsPatch(fetchMock)).toMatchObject({
        libelle_adresse_1: 'Entrée public',
        libelle_adresse_2: 'Livraison',
        adresse_acces_2: '1 avenue du Général Lemonnier',
        adresse_acces_3: '2 quai des Tuileries',
        code_postal_3: '75001',
        ville_3: 'Paris',
        libelle_adresse_3: null,
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'retirer l’adresse n° 2 envoie un emplacement vide',
    async () => {
      const fetchMock = await ouvrir();
      fireEvent.click(
        screen.getByRole('button', { name: /Retirer l’adresse n° 2/ }),
      );
      expect(screen.queryByTestId('adresse-livraison-2')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
      await waitFor(
        () => expect(corpsPatch(fetchMock)).toBeTruthy(),
        ATTENTE_UI,
      );
      expect(corpsPatch(fetchMock)).toMatchObject({
        adresse_acces_2: null,
        code_postal_2: null,
        ville_2: null,
        libelle_adresse_2: null,
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'une adresse entamée doit être complète : pas d’envoi sans code postal ni ville',
    async () => {
      const fetchMock = await ouvrir();
      fireEvent.click(
        screen.getByRole('button', {
          name: /Ajouter une adresse de livraison/,
        }),
      );
      fireEvent.change(document.getElementById('lm_adresse_acces_3')!, {
        target: { value: '2 quai des Tuileries' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
      await waitFor(
        () =>
          expect(
            document.getElementById('lm_ville_3')!.getAttribute('aria-invalid'),
          ).toBe('true'),
        ATTENTE_UI,
      );
      expect(
        fetchMock.mock.calls.some(
          ([, o]) => (o as RequestInit | undefined)?.method === 'PATCH',
        ),
      ).toBe(false);
    },
    ATTENTE_CAS_MS,
  );

  // Suggestions d'adresse (Val 2026-11-19) : comme au formulaire « lieu
  // manuel », choisir une suggestion remplit l'adresse, le code postal et la
  // ville, pour l'adresse n° 1 comme pour les adresses n° 2 et n° 3.
  for (const champ of ['lm_adresse_acces', 'lm_adresse_acces_3'] as const) {
    it(
      `une suggestion choisie remplit adresse, code postal et ville (${champ})`,
      async () => {
        await ouvrir();
        if (champ === 'lm_adresse_acces_3')
          fireEvent.click(
            screen.getByRole('button', {
              name: /Ajouter une adresse de livraison/,
            }),
          );
        const suffixe = champ === 'lm_adresse_acces' ? '' : '_3';
        fireEvent.change(document.getElementById(champ)!, {
          target: { value: '12 villa wagram' },
        });
        const option = await screen.findByRole(
          'option',
          { name: '12 Villa Wagram 75008 Paris' },
          ATTENTE_UI,
        );
        fireEvent.mouseDown(option);
        expect((document.getElementById(champ) as HTMLInputElement).value).toBe(
          '12 Villa Wagram',
        );
        expect(
          (
            document.getElementById(
              `lm_code_postal${suffixe}`,
            ) as HTMLInputElement
          ).value,
        ).toBe('75008');
        expect(
          (document.getElementById(`lm_ville${suffixe}`) as HTMLInputElement)
            .value,
        ).toBe('Paris');
      },
      ATTENTE_CAS_MS,
    );
  }
});

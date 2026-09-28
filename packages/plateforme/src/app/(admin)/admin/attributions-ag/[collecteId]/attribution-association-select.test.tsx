/**
 * Écran Attribution AG — choix de l'association par liste déroulante (décision
 * Val 2026-09-17, remplace la recherche libre) : toutes les associations actives,
 * triées par distance au lieu de la collecte, suggestions de l'algo marquées.
 * Choisir hors suggestion top 1 = override → motif obligatoire (§06.09 §3) ;
 * sans suggestion (no_asso) → audit aucune-reco. Après validation, retour à la
 * file d'attribution de Collectes (il n'existe pas de page /admin/attributions-ag).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ collecteId: 'col-1' }),
  useRouter: () => ({ push, back: vi.fn() }),
}));

import AttributionDetailPage from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const ALGO = {
  associations: [
    {
      id: 'asso-top',
      nom: 'Asso Top',
      distance_km: 1.2,
      capacite_max_beneficiaires: 300,
      contact_email: 't@asso.test',
    },
  ],
  assoc_count: 1,
  transporteur: { id: 'tr-reco', nom: 'Transport Reco', type_tms: 'x' },
  transporteurs: [{ id: 'tr-reco', nom: 'Transport Reco', type_tms: 'x' }],
  branche: 'ag_marathon_nuit',
  is_idf: true,
  no_asso: false,
  no_prestataire: false,
  delai_minutes: 600,
  nb_pax: 150,
};

// Réponse de la route /associations : déjà triée par distance (côté serveur).
const ASSOCIATIONS = [
  {
    id: 'asso-top',
    nom: 'Asso Top',
    ville: 'Paris',
    capacite_max_beneficiaires: 300,
    habilitee_attestation_fiscale: true,
    distance_km: 1.2,
  },
  {
    id: 'asso-loin',
    nom: 'Asso Loin',
    ville: 'Rouen',
    capacite_max_beneficiaires: 80,
    habilitee_attestation_fiscale: false,
    distance_km: 111.5,
  },
  {
    id: 'asso-sans',
    nom: 'Asso Sans GPS',
    ville: 'Paris',
    capacite_max_beneficiaires: null,
    habilitee_attestation_fiscale: false,
    distance_km: null,
  },
];

function installFetch(
  algo: typeof ALGO = ALGO,
  associationsKo: () => boolean = () => false,
) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/col-1/associations') && associationsKo())
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: 'x' }),
      } as Response);
    const body = url.includes('/recommandation')
      ? { data: algo }
      : url.includes('/col-1/associations')
        ? { data: ASSOCIATIONS }
        : url.includes('/admin/transporteurs')
          ? {
              data: [
                {
                  id: 'tr-reco',
                  nom: 'Transport Reco',
                  type_tms: 'x',
                  ville: 'Paris',
                },
              ],
            }
          : url.includes('/valider') && init?.method === 'POST'
            ? { data: { attribution_id: 'att-1' } }
            : { data: [] };
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
    } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Combobox DS (liste portée dans document.body) : ouvre la liste de
// l'association et attend les 4 options (vide + 3 associations).
async function selectAssociation() {
  const declencheur = await screen.findByRole(
    'combobox',
    { name: 'Association' },
    ATTENTE_UI,
  );
  if (declencheur.getAttribute('aria-expanded') !== 'true')
    fireEvent.click(declencheur);
  await waitFor(
    () => expect(screen.getAllByRole('option')).toHaveLength(4),
    ATTENTE_UI,
  );
  return declencheur;
}

function libellesOptions() {
  return screen.getAllByRole('option').map((o) => o.textContent);
}

function choisirMotif(libelle: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Motif' }));
  fireEvent.click(screen.getByRole('option', { name: libelle }));
}

function corpsValider(fetchMock: ReturnType<typeof installFetch>) {
  const post = fetchMock.mock.calls.find(([u]) =>
    String(u).includes('/valider'),
  );
  return post
    ? (JSON.parse(String(post[1]!.body)) as Record<string, unknown>)
    : null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe('M2.3 / Attribution AG — liste déroulante association', () => {
  it(
    'liste toutes les associations dans l’ordre des distances, top 1 pré-sélectionné',
    async () => {
      installFetch();
      render(<AttributionDetailPage />);
      const select = await selectAssociation();

      expect(select).toHaveTextContent(
        'Asso Top · Paris · 1,2 km · cap. 300 · 2041-GE (suggérée)',
      );
      expect(libellesOptions()).toEqual([
        'Choisir une association…',
        'Asso Top · Paris · 1,2 km · cap. 300 · 2041-GE (suggérée)',
        'Asso Loin · Rouen · 111,5 km · cap. 80',
        'Asso Sans GPS · Paris · distance inconnue',
      ]);
      expect(screen.queryByText(/motif obligatoire/)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'arrivée depuis la fiche collecte (?association=) : association choisie présélectionnée, motif exigé si ≠ top 1',
    async () => {
      // Carte « Choisir » de la fiche collecte (décision Val 2026-09-29).
      window.history.pushState({}, '', '/?association=asso-loin');
      try {
        installFetch({
          ...ALGO,
          associations: [
            ...ALGO.associations,
            {
              id: 'asso-loin',
              nom: 'Asso Loin',
              distance_km: 111.5,
              capacite_max_beneficiaires: 80,
              contact_email: 'l@asso.test',
            },
          ],
          assoc_count: 2,
        });
        render(<AttributionDetailPage />);
        const select = await selectAssociation();
        expect(select).toHaveTextContent(/^Asso Loin/);
        // Choix ≠ top 1 de l'algo = override : les règles de l'écran s'appliquent.
        expect(screen.getByText(/motif obligatoire/)).toBeTruthy();
      } finally {
        window.history.pushState({}, '', '/');
      }
    },
    ATTENTE_CAS_MS,
  );

  it(
    '?association= inconnue de l’algo : repli sur le top 1',
    async () => {
      window.history.pushState({}, '', '/?association=asso-inconnue');
      try {
        installFetch();
        render(<AttributionDetailPage />);
        const select = await selectAssociation();
        expect(select).toHaveTextContent(/^Asso Top/);
      } finally {
        window.history.pushState({}, '', '/');
      }
    },
    ATTENTE_CAS_MS,
  );

  it(
    'association hors suggestion : motif obligatoire, puis POST avec cette association',
    async () => {
      const fetchMock = installFetch();
      render(<AttributionDetailPage />);
      await selectAssociation();
      fireEvent.click(
        screen.getByRole('option', {
          name: 'Asso Loin · Rouen · 111,5 km · cap. 80',
        }),
      );
      const valider = screen.getByRole('button', {
        name: "Valider l'attribution",
      }) as HTMLButtonElement;
      expect(screen.getByText(/motif obligatoire/)).toBeTruthy();
      expect(valider.disabled).toBe(true);

      choisirMotif('Association top 1 surchargée cette semaine');
      fireEvent.click(valider);

      await waitFor(() => {
        const sent = corpsValider(fetchMock);
        expect(sent?.association_id).toBe('asso-loin');
        expect(sent?.mode_validation).toBe('manuel_override');
        expect(sent?.aucune_reco).toBe(false);
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'aucune suggestion : choix dans la liste → audit aucune_reco',
    async () => {
      const fetchMock = installFetch({
        ...ALGO,
        associations: [],
        assoc_count: 0,
        no_asso: true,
      });
      render(<AttributionDetailPage />);
      const select = await selectAssociation();
      expect(select).toHaveTextContent('Choisir une association…');

      fireEvent.click(
        screen.getByRole('option', {
          name: 'Asso Sans GPS · Paris · distance inconnue',
        }),
      );
      fireEvent.click(
        screen.getByRole('button', { name: "Valider l'attribution" }),
      );

      await waitFor(() => {
        const sent = corpsValider(fetchMock);
        expect(sent?.association_id).toBe('asso-sans');
        expect(sent?.aucune_reco).toBe(true);
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'après validation, retour à la file d’attribution de Collectes',
    async () => {
      installFetch();
      render(<AttributionDetailPage />);
      await selectAssociation();
      fireEvent.click(
        screen.getByRole('button', { name: "Valider l'attribution" }),
      );

      await waitFor(
        () =>
          expect(push).toHaveBeenCalledWith(
            '/admin/collectes?chip=ag_attente_attribution',
          ),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );
  it(
    'échec du chargement des associations : suggestion toujours sélectionnée, message + Réessayer',
    async () => {
      let ko = true;
      installFetch(ALGO, () => ko);
      render(<AttributionDetailPage />);

      expect(
        await screen.findByText(
          'Impossible de charger la liste des associations.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      const select = screen.getByRole('combobox', { name: 'Association' });
      // Option de secours = suggestion de l'algo ; 2041-GE inconnu → non affirmé.
      // La sélection reste affichée même sans la liste chargée.
      expect(select).toHaveTextContent(
        'Asso Top · 1,2 km · cap. 300 (suggérée)',
      );
      fireEvent.click(select);
      expect(libellesOptions()).toEqual([
        'Choisir une association…',
        'Asso Top · 1,2 km · cap. 300 (suggérée)',
      ]);

      ko = false;
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      await selectAssociation();
      expect(
        screen.queryByText('Impossible de charger la liste des associations.'),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'après succès, le bouton Valider est désactivé (pas de second envoi)',
    async () => {
      installFetch();
      render(<AttributionDetailPage />);
      await selectAssociation();
      const valider = screen.getByRole('button', {
        name: "Valider l'attribution",
      }) as HTMLButtonElement;
      fireEvent.click(valider);
      await screen.findByText(/Attribution validée/, undefined, ATTENTE_UI);
      expect(
        (
          screen.getByRole('button', {
            name: "Valider l'attribution",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    },
    ATTENTE_CAS_MS,
  );
});

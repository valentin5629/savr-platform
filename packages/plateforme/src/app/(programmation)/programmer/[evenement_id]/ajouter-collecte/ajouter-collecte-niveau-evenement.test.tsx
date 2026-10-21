/**
 * M1.2 — « Ajouter une collecte » rouvre le formulaire avec le niveau événement
 * figé et pré-rempli : client, date de l'événement, type d'événement, lieu,
 * contacts, contrôle d'accès (§06.01 « Ajouter une collecte à un événement
 * existant », Workflow). Lecture seule : la page n'envoie aucun de ces champs,
 * la route d'ajout relit l'événement (contrôle d'accès compris).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

const back = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ evenement_id: 'evt-1' }),
  useRouter: () => ({ push: vi.fn(), back, refresh: vi.fn() }),
}));

import AjouterCollectePage from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const EVENEMENT = {
  id: 'evt-1',
  organisation_id: 'org-1',
  nom_evenement: 'Gala de printemps',
  nom_client_organisateur: 'Maison Dupont',
  date_evenement: '2030-01-15',
  type_evenement: 'Repas assis',
  contact_principal_nom: 'Paul Arnaud',
  contact_principal_telephone: '06 12 34 56 78',
  contact_secours_nom: 'Léa Martin',
  contact_secours_telephone: '07 98 76 54 32',
  controle_acces_requis: true,
  lieux: {
    nom: 'Salle A',
    adresse_acces: '1 rue Test',
    code_postal: '75012',
    ville: 'Paris',
  },
  collectes: [
    {
      type: 'zero_dechet',
      statut: 'programmee',
      date_collecte: '2030-01-15',
      heure_collecte: '23:00:00',
      pax: 300,
    },
  ],
};

function installFetch(evenement: object) {
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const json = (corps: unknown) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(corps),
      } as Response);
    if (url.endsWith('/programmation/evenements/evt-1')) return json(evenement);
    if (url.endsWith('/programmation/evenements/evt-1/collectes')) {
      return json({ collecte_id: 'col-nouvelle' });
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function blocEvenement(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: 'Événement' }, ATTENTE_UI);
}

/** Valeur affichée sous un libellé du bloc (`<dt>` → `<dd>`). */
function valeur(bloc: HTMLElement, libelle: string): HTMLElement {
  const dt = within(bloc).getByText(libelle, { selector: 'dt' });
  return dt.nextElementSibling as HTMLElement;
}

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

// Collecte ZD le 20 du mois suivant à 22:00 (toujours dans le futur).
function remplirEtAjouterZd() {
  const auj = new Date();
  const cible = new Date(auj.getFullYear(), auj.getMonth() + 1, 20);
  const mois = `${MOIS[cible.getMonth()]} ${cible.getFullYear()}`;
  fireEvent.click(screen.getByTestId('date-zd'));
  for (let i = 0; i < 3; i++) {
    const affiche = screen.getByRole('grid').getAttribute('aria-label') ?? '';
    if (affiche.toLowerCase() === mois) break;
    fireEvent.click(
      screen.getByRole('button', { name: 'Aller au mois suivant' }),
    );
  }
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(` 20 ${mois}$`) }),
  );
  fireEvent.click(screen.getByTestId('heure-zd'));
  fireEvent.click(screen.getByRole('option', { name: '22:00' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter la collecte' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  back.mockReset();
});

describe('M1.2 — ajouter une collecte : niveau événement figé et pré-rempli', () => {
  it(
    'affiche client, date et type d’événement, lieu, contacts et contrôle d’accès de l’événement',
    async () => {
      installFetch(EVENEMENT);
      render(<AjouterCollectePage />);
      const bloc = await blocEvenement();

      expect(valeur(bloc, 'Nom de l’événement')).toHaveTextContent(
        'Gala de printemps',
      );
      expect(valeur(bloc, 'Client')).toHaveTextContent('Maison Dupont');
      expect(valeur(bloc, 'Date de l’événement')).toHaveTextContent(
        '15 janvier 2030',
      );
      expect(valeur(bloc, 'Type d’événement')).toHaveTextContent('Repas assis');
      expect(valeur(bloc, 'Lieu')).toHaveTextContent(
        'Salle A — 1 rue Test, 75012 Paris',
      );
      const principal = valeur(bloc, 'Contact principal');
      expect(principal).toHaveTextContent('Paul Arnaud');
      expect(principal).toHaveTextContent('06 12 34 56 78');
      const secours = valeur(bloc, 'Contact de secours');
      expect(secours).toHaveTextContent('Léa Martin');
      expect(secours).toHaveTextContent('07 98 76 54 32');
      expect(valeur(bloc, 'Contrôle d’accès')).toHaveTextContent(
        'Plaque et nom du chauffeur requis',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'contrôle d’accès non exigé par l’événement : « Non requis »',
    async () => {
      installFetch({ ...EVENEMENT, controle_acces_requis: false });
      render(<AjouterCollectePage />);
      const bloc = await blocEvenement();

      expect(valeur(bloc, 'Contrôle d’accès')).toHaveTextContent('Non requis');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'figé : aucun champ de saisie dans le bloc, et la création n’envoie aucun champ de l’événement',
    async () => {
      const fetchMock = installFetch(EVENEMENT);
      render(<AjouterCollectePage />);
      const bloc = await blocEvenement();

      expect(
        within(bloc).queryAllByRole('textbox').length +
          within(bloc).queryAllByRole('checkbox').length +
          within(bloc).queryAllByRole('combobox').length,
      ).toBe(0);

      // Pax pré-rempli depuis la dernière collecte (300) : rien d'autre à saisir.
      expect(
        await screen.findByDisplayValue('300', undefined, ATTENTE_UI),
      ).toBe(screen.getByTestId('pax-zd'));
      remplirEtAjouterZd();

      await waitFor(() => expect(back).toHaveBeenCalledTimes(1), ATTENTE_UI);
      const creations = fetchMock.mock.calls
        .filter(([u]) => String(u).endsWith('/evenements/evt-1/collectes'))
        .map(([, init]) => JSON.parse(String(init?.body)) as object);
      expect(creations).toHaveLength(1);
      // Seuls les champs de la collecte partent ; le contrôle d'accès est
      // celui que la route lit sur l'événement.
      expect(Object.keys(creations[0]!).sort()).toEqual(
        ['date_collecte', 'heure_collecte', 'pax', 'type'].sort(),
      );
    },
    ATTENTE_CAS_MS,
  );
});

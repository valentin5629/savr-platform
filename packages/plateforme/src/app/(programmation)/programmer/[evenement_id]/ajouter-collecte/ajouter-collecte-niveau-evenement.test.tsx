/**
 * M1.2 — « Ajouter une collecte » rouvre le formulaire avec le niveau événement
 * figé : nom, client, date de l'événement, lieu, contrôle d'accès (§06.01
 * « Ajouter une collecte à un événement existant », Workflow). Lecture seule :
 * la page n'envoie aucun de ces champs, la route d'ajout relit l'événement
 * (contrôle d'accès compris).
 *
 * Refonte du formulaire, lot B2 (décision Val 2026-10-22) : le type
 * d'événement et les contacts ne sont plus au niveau événement. Ils se
 * saisissent dans la carte de la nouvelle collecte, avec ses convives,
 * pré-remplis avec ceux de la dernière collecte non annulée de l'événement
 * (la plus tardive par date, heure, puis création), modifiables ; la date
 * reste vide. La création envoie la carte complète.
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

const TYPES_EVENEMENTS = [
  { id: 'te-1', libelle: 'Repas assis' },
  { id: 'te-2', libelle: 'Cocktail' },
  { id: 'te-3', libelle: 'Buffet' },
];

const contacts = (principal: string, telephone: string) => ({
  contact_principal_nom: principal,
  contact_principal_telephone: telephone,
  contact_secours_nom: 'Léa Martin',
  contact_secours_telephone: '07 98 76 54 32',
});

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
      id: 'col-1',
      type: 'zero_dechet',
      statut: 'programmee',
      date_collecte: '2030-01-15',
      heure_collecte: '23:00:00',
      pax: 300,
      type_evenement_id: 'te-1',
      type_evenement: 'Repas assis',
      contacts: contacts('Paul Arnaud', '06 12 34 56 78'),
      informations_supplementaires: 'Quai B',
      created_at: '2026-10-01T08:00:00Z',
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
    if (url.endsWith('/programmation/types-evenements')) {
      return json(TYPES_EVENEMENTS);
    }
    if (url.endsWith('/programmation/evenements/evt-1')) return json(evenement);
    if (url.endsWith('/programmation/evenements/evt-1/collectes')) {
      return json({ collecte_id: 'col-nouvelle' });
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const creations = (fetchMock: ReturnType<typeof installFetch>) =>
  fetchMock.mock.calls
    .filter(([u]) => String(u).endsWith('/evenements/evt-1/collectes'))
    .map(
      ([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>,
    );

async function blocEvenement(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: 'Événement' }, ATTENTE_UI);
}

/** Valeur affichée sous un libellé du bloc (`<dt>` → `<dd>`). */
function valeur(bloc: HTMLElement, libelle: string): HTMLElement {
  const dt = within(bloc).getByText(libelle, { selector: 'dt' });
  return dt.nextElementSibling as HTMLElement;
}

const carte = () => screen.getByTestId('carte-zd-1');
const typeEvenement = () =>
  document.getElementById('type-evenement-zd-1') as HTMLElement;
const boutonAjouter = () =>
  screen.getByRole('button', { name: 'Ajouter la collecte' });

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

// Date et heure de la collecte ZD : le 20 du mois suivant à 22:00 (toujours
// dans le futur).
function remplirDateHeureZd() {
  const auj = new Date();
  const cible = new Date(auj.getFullYear(), auj.getMonth() + 1, 20);
  const mois = `${MOIS[cible.getMonth()]} ${cible.getFullYear()}`;
  fireEvent.click(screen.getByTestId('date-zd-1'));
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
  fireEvent.click(screen.getByTestId('heure-zd-1'));
  fireEvent.click(screen.getByRole('option', { name: '22:00' }));
  return `${cible.getFullYear()}-${String(cible.getMonth() + 1).padStart(2, '0')}-20`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  back.mockReset();
});

describe('M1.2 — ajouter une collecte : niveau événement figé et pré-rempli', () => {
  it(
    'affiche nom, client, date de l’événement, lieu et contrôle d’accès ; ni type d’événement ni contacts',
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
      expect(valeur(bloc, 'Lieu')).toHaveTextContent(
        'Salle A — 1 rue Test, 75012 Paris',
      );
      expect(valeur(bloc, 'Contrôle d’accès')).toHaveTextContent(
        'Plaque et nom du chauffeur requis',
      );
      // Type d'événement et contacts passent dans la carte de la collecte.
      for (const libelle of [
        'Type d’événement',
        'Contact principal',
        'Contact de secours',
      ]) {
        expect(
          within(bloc).queryByText(libelle, { selector: 'dt' }),
        ).toBeNull();
      }
      expect(within(bloc).queryByText(/Paul Arnaud|Léa Martin/)).toBeNull();
      expect(within(bloc).queryByText('Repas assis')).toBeNull();
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

      // Convives, type d'événement et contacts pré-remplis depuis la dernière
      // collecte : seules la date et l'heure restent à saisir.
      expect(
        await screen.findByDisplayValue('300', undefined, ATTENTE_UI),
      ).toBe(screen.getByTestId('pax-zd-1'));
      await waitFor(
        () => expect(typeEvenement()).toHaveTextContent('Repas assis'),
        ATTENTE_UI,
      );
      const date = remplirDateHeureZd();
      fireEvent.click(boutonAjouter());

      await waitFor(() => expect(back).toHaveBeenCalledTimes(1), ATTENTE_UI);
      const corps = creations(fetchMock);
      expect(corps).toHaveLength(1);
      // La carte complète, et rien du niveau événement : le contrôle d'accès
      // est celui que la route lit sur l'événement.
      expect(corps[0]).toEqual({
        type: 'zd',
        date_collecte: date,
        heure_collecte: '22:00',
        pax: 300,
        type_evenement_id: 'te-1',
        contact_principal_nom: 'Paul Arnaud',
        contact_principal_telephone: '06 12 34 56 78',
        contact_secours_nom: 'Léa Martin',
        contact_secours_telephone: '07 98 76 54 32',
        informations_supplementaires: null,
      });
    },
    ATTENTE_CAS_MS,
  );
});

describe('M1.2 — ajouter une collecte : carte pré-remplie depuis la dernière collecte non annulée', () => {
  // Dans le désordre. La dernière non annulée est la ZD du 11/01 à 22:00 créée
  // en dernier (« Cocktail », Claire Petit), à égalité de date et d'heure avec
  // l'AG « Buffet » créée avant ; l'AG annulée du 12/01 est plus tardive, mais
  // n'est jamais reprise.
  const COLLECTES = [
    {
      id: 'col-a',
      type: 'zero_dechet',
      statut: 'cloturee',
      date_collecte: '2030-01-10',
      heure_collecte: '22:00:00',
      pax: 900,
      type_evenement_id: 'te-1',
      contacts: contacts('Paul Arnaud', '06 12 34 56 78'),
      created_at: '2026-10-01T08:00:00Z',
    },
    {
      id: 'col-b',
      type: 'zero_dechet',
      statut: 'programmee',
      date_collecte: '2030-01-11',
      heure_collecte: '22:00:00',
      pax: 1200,
      type_evenement_id: 'te-2',
      contacts: contacts('Claire Petit', '06 00 00 00 02'),
      created_at: '2026-10-03T08:00:00Z',
    },
    {
      id: 'col-c',
      type: 'anti_gaspi',
      statut: 'annulee',
      date_collecte: '2030-01-12',
      heure_collecte: '22:00:00',
      pax: 50,
      type_evenement_id: 'te-1',
      contacts: contacts('Jean Annulé', '06 00 00 00 03'),
      created_at: '2026-10-04T08:00:00Z',
    },
    {
      id: 'col-d',
      type: 'anti_gaspi',
      statut: 'programmee',
      date_collecte: '2030-01-11',
      heure_collecte: '22:00:00',
      pax: 1100,
      type_evenement_id: 'te-3',
      contacts: contacts('Marc Buffet', '06 00 00 00 04'),
      created_at: '2026-10-02T08:00:00Z',
    },
  ];

  it(
    'convives, type d’événement et contacts de la dernière collecte non annulée (date, heure, puis création) ; date et heure vides',
    async () => {
      installFetch({ ...EVENEMENT, collectes: COLLECTES });
      render(<AjouterCollectePage />);

      expect(
        await screen.findByDisplayValue('1200', undefined, ATTENTE_UI),
      ).toBe(screen.getByTestId('pax-zd-1'));
      await waitFor(
        () => expect(typeEvenement()).toHaveTextContent('Cocktail'),
        ATTENTE_UI,
      );
      expect(
        within(carte()).getByText(/Claire Petit — 06 00 00 00 02/),
      ).toBeInTheDocument();
      expect(
        within(carte()).getByText(/Léa Martin — 07 98 76 54 32/),
      ).toBeInTheDocument();
      expect(within(carte()).queryByText(/Jean Annulé|Marc Buffet/)).toBeNull();
      // Les informations supplémentaires ne sont pas reprises.
      expect(
        within(carte()).getByRole('textbox', { name: /^Informations/ }),
      ).toHaveValue('');
      // Tout est pré-rempli sauf la date et l'heure : rien ne part encore.
      expect(boutonAjouter()).toBeDisabled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'les valeurs pré-remplies restent modifiables : le pax changé part dans la requête',
    async () => {
      const fetchMock = installFetch({ ...EVENEMENT, collectes: COLLECTES });
      render(<AjouterCollectePage />);

      const pax = await screen.findByDisplayValue(
        '1200',
        undefined,
        ATTENTE_UI,
      );
      fireEvent.change(pax, { target: { value: '450' } });
      remplirDateHeureZd();
      fireEvent.click(boutonAjouter());

      await waitFor(() => expect(back).toHaveBeenCalledTimes(1), ATTENTE_UI);
      expect(creations(fetchMock)).toEqual([
        expect.objectContaining({
          pax: 450,
          type_evenement_id: 'te-2',
          contact_principal_nom: 'Claire Petit',
        }),
      ]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'dernière collecte sans contact : le contact principal reste à choisir, la collecte ne peut pas être ajoutée',
    async () => {
      const fetchMock = installFetch({
        ...EVENEMENT,
        collectes: [{ ...EVENEMENT.collectes[0], contacts: null }],
      });
      render(<AjouterCollectePage />);

      await screen.findByDisplayValue('300', undefined, ATTENTE_UI);
      remplirDateHeureZd();

      expect(boutonAjouter()).toBeDisabled();
      expect(creations(fetchMock)).toEqual([]);
    },
    ATTENTE_CAS_MS,
  );
});

describe('M1.2/pax_par_collecte — ajouter une collecte : le pax', () => {
  it(
    'pré-rempli avec le pax de la dernière collecte de l’événement (par date puis heure), modifiable',
    async () => {
      installFetch({
        ...EVENEMENT,
        collectes: [
          // Dans le désordre : la dernière (par date puis heure) est l'AG du
          // 11/01 à 22:00, ni la première ni la dernière du tableau.
          {
            type: 'zero_dechet',
            statut: 'cloturee',
            pax: 300,
            date_collecte: '2030-01-11',
            heure_collecte: '08:00:00',
          },
          {
            type: 'anti_gaspi',
            statut: 'programmee',
            pax: 1200,
            date_collecte: '2030-01-11',
            heure_collecte: '22:00:00',
          },
          {
            type: 'zero_dechet',
            statut: 'cloturee',
            pax: 900,
            date_collecte: '2030-01-10',
            heure_collecte: '22:00:00',
          },
        ],
      });
      render(<AjouterCollectePage />);
      const champ = await screen.findByDisplayValue(
        '1200',
        undefined,
        ATTENTE_UI,
      );
      expect(champ).toBe(screen.getByTestId('pax-zd-1'));
    },
    ATTENTE_CAS_MS,
  );

  it(
    'jamais le pax d’une collecte annulée ni un pax inconnu (0) : la dernière collecte non annulée au pax connu',
    async () => {
      installFetch({
        ...EVENEMENT,
        collectes: [
          {
            type: 'zero_dechet',
            statut: 'cloturee',
            pax: 900,
            date_collecte: '2030-01-10',
            heure_collecte: '22:00:00',
          },
          // Plus tardives, mais annulée ou au pax inconnu (reprise Bubble).
          {
            type: 'anti_gaspi',
            statut: 'annulee',
            pax: 1200,
            date_collecte: '2030-01-11',
            heure_collecte: '22:00:00',
          },
          {
            type: 'zero_dechet',
            statut: 'programmee',
            pax: 0,
            date_collecte: '2030-01-11',
            heure_collecte: '23:00:00',
          },
        ],
      });
      render(<AjouterCollectePage />);
      const champ = await screen.findByDisplayValue(
        '900',
        undefined,
        ATTENTE_UI,
      );
      expect(champ).toBe(screen.getByTestId('pax-zd-1'));
    },
    ATTENTE_CAS_MS,
  );

  it(
    'sans pax saisi, la collecte ne peut pas être ajoutée',
    async () => {
      const fetchMock = installFetch({ ...EVENEMENT, collectes: [] });
      render(<AjouterCollectePage />);
      fireEvent.change(screen.getByTestId('pax-zd-1'), {
        target: { value: '' },
      });
      expect(boutonAjouter()).toBeDisabled();
      expect(creations(fetchMock)).toEqual([]);
    },
    ATTENTE_CAS_MS,
  );
});

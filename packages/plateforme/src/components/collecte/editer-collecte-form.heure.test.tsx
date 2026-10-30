/**
 * Édition d'une collecte — l'heure se choisit dans les créneaux de 15 min
 * (même TimePicker que le formulaire de programmation, CDC §06.01).
 * Épingle : aucun input time natif, heure actuelle affichée (même hors
 * grille, ex. donnée migrée), créneau choisi → PATCH `heure_collecte` `HH:MM:00`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';

import {
  EditerCollecteForm,
  type CollecteEditData,
} from '@/components/collecte/editer-collecte-form';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';

const COLLECTE: CollecteEditData = {
  id: 'col-1',
  type: 'zero_dechet',
  statut: 'programmee',
  date_collecte: '2099-06-15',
  heure_collecte: '10:10:00',
  pax: 80,
  controle_acces_requis: false,
  informations_supplementaires: null,
  type_evenement_id: null,
  contact_principal_nom: 'Jean',
  contact_principal_telephone: '0600000000',
  contact_secours_nom: null,
  contact_secours_telephone: null,
  lieu_nom: 'Pavillon Gabriel',
  evenement: {
    id: 'evt-1',
    nom_evenement: 'Soirée',
    nom_client_organisateur: 'Client',
    reference_affaire: null,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('EditerCollecteForm — heure de collecte', () => {
  it(
    'edition/heure_creneaux_15_min_patch_hh_mm_ss',
    async () => {
      const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
        if (url.includes('types-evenements')) return new Response('[]');
        return new Response('{}', { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);
      const onSaved = vi.fn();
      const { container } = render(
        <EditerCollecteForm
          collecte={COLLECTE}
          collecteEndpoint="/api/v1/traiteur/collectes/col-1"
          onSaved={onSaved}
        />,
      );
      expect(container.querySelector('input[type="time"]')).toBeNull();
      const trigger = container.querySelector<HTMLButtonElement>(
        '#edit-heure-collecte',
      )!;
      // Heure migrée hors grille : affichée telle quelle.
      expect(trigger).toHaveTextContent('10:10');

      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole('option', { name: '18:45' }));
      expect(trigger).toHaveTextContent('18:45');

      fireEvent.click(
        screen.getByRole('button', { name: 'Confirmer la modification' }),
      );
      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
      const patch = fetchMock.mock.calls.find(
        ([url]) => url === '/api/v1/traiteur/collectes/col-1',
      );
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
        heure_collecte: '18:45:00',
      });
    },
    ATTENTE_CAS_MS,
  );
});

// L'équipe Savr reçoit UN email par enregistrement (§06.02 n°19) : il part de la
// dernière des deux requêtes, qui doit donc savoir ce que l'autre a fait.
describe('M3.1 / EditerCollecteForm — un seul email par enregistrement', () => {
  function monter() {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('types-evenements')) return new Response('[]');
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();
    const { container } = render(
      <EditerCollecteForm
        collecte={COLLECTE}
        collecteEndpoint="/api/v1/traiteur/collectes/col-1"
        onSaved={onSaved}
      />,
    );
    const patchs = () =>
      fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'PATCH')
        .map(([url, init]) => [url, JSON.parse(String(init?.body))]);
    return { container, onSaved, patchs };
  }

  it(
    'M3.1/email_modification_un_seul_email — client final et heure : la requête collecte signale que l’événement vient d’être modifié',
    async () => {
      const { container, onSaved, patchs } = monter();
      fireEvent.change(container.querySelector('#edit-evt-client')!, {
        target: { value: 'Autre client' },
      });
      fireEvent.click(container.querySelector('#edit-heure-collecte')!);
      fireEvent.click(screen.getByRole('option', { name: '18:45' }));
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirmer la modification' }),
      );
      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
      expect(patchs()).toEqual([
        [
          '/api/v1/programmation/evenements/evt-1',
          { nom_client_organisateur: 'Autre client' },
        ],
        [
          '/api/v1/traiteur/collectes/col-1',
          { heure_collecte: '18:45:00', evenement_modifie: true },
        ],
      ]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/email_modification_un_seul_email — client final seul : la requête événement nomme la collecte, aucune requête collecte',
    async () => {
      const { container, onSaved, patchs } = monter();
      fireEvent.change(container.querySelector('#edit-evt-client')!, {
        target: { value: 'Autre client' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirmer la modification' }),
      );
      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
      expect(patchs()).toEqual([
        [
          '/api/v1/programmation/evenements/evt-1',
          { nom_client_organisateur: 'Autre client', collecte_id: 'col-1' },
        ],
      ]);
    },
    ATTENTE_CAS_MS,
  );

  // Pax porté par la collecte (décision Val 2026-10-20) : il se modifie sur la
  // collecte, jamais sur l'événement (dont le pax est calculé en base).
  it(
    'M1.2/pax_par_collecte — le pax part dans la requête collecte, jamais dans celle de l’événement',
    async () => {
      const { container, onSaved, patchs } = monter();
      const champ = container.querySelector<HTMLInputElement>('#edit-col-pax')!;
      expect(champ.value).toBe('80');
      expect(container.querySelector('#edit-evt-pax')).toBeNull();
      fireEvent.change(champ, { target: { value: '120' } });
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirmer la modification' }),
      );
      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
      expect(patchs()).toEqual([
        ['/api/v1/traiteur/collectes/col-1', { pax: 120 }],
      ]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/pax_par_collecte — collecte reprise de Bubble à pax 0 (inconnu) : les autres champs restent modifiables',
    async () => {
      const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
        if (url.includes('types-evenements')) return new Response('[]');
        return new Response('{}', { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);
      const onSaved = vi.fn();
      const { container } = render(
        <EditerCollecteForm
          collecte={{ ...COLLECTE, pax: 0 }}
          collecteEndpoint="/api/v1/traiteur/collectes/col-1"
          onSaved={onSaved}
        />,
      );
      fireEvent.click(container.querySelector('#edit-heure-collecte')!);
      fireEvent.click(screen.getByRole('option', { name: '18:45' }));
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirmer la modification' }),
      );
      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
      const patch = fetchMock.mock.calls.find(
        ([url]) => url === '/api/v1/traiteur/collectes/col-1',
      );
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
        heure_collecte: '18:45:00',
      });
    },
    ATTENTE_CAS_MS,
  );

  // Un cas par valeur : chacun part d'un formulaire neuf, sans message laissé
  // par le précédent.
  it.each(['', '0'])(
    'M1.2/pax_par_collecte — un pax vidé ou à 0 est refusé à l’écran, rien n’est envoyé — valeur « %s »',
    async (valeur) => {
      const { container, onSaved, patchs } = monter();
      fireEvent.change(container.querySelector('#edit-col-pax')!, {
        target: { value: valeur },
      });
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirmer la modification' }),
      );
      expect(
        await screen.findByText(
          /Nombre de convives : saisissez/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(onSaved).not.toHaveBeenCalled();
      expect(patchs()).toEqual([]);
    },
    ATTENTE_CAS_MS,
  );
});

// Type d'événement et contacts sur place : portés par CHAQUE collecte (refonte
// du formulaire, lot B1, décisions Val 2026-10-23). Ils se modifient dans la
// section « Collecte » et partent dans la requête de la collecte ; celle de
// l'événement ne porte plus que nom, client final et référence d'affaire.
describe('M1.2 / EditerCollecteForm — type d’événement et contacts de la collecte (lot B1)', () => {
  const TYPES = [
    { id: 't1', code: 'cocktail', libelle: 'Cocktail' },
    { id: 't2', code: 'diner', libelle: 'Dîner assis' },
  ];
  const AVEC_TYPE: CollecteEditData = {
    ...COLLECTE,
    type_evenement_id: 't1',
    contact_secours_nom: 'Léa',
    contact_secours_telephone: '0633333333',
  };

  async function monterB1(collecte: CollecteEditData = AVEC_TYPE) {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('types-evenements'))
        return new Response(JSON.stringify(TYPES));
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();
    const rendu = render(
      <EditerCollecteForm
        collecte={collecte}
        collecteEndpoint="/api/v1/traiteur/collectes/col-1"
        onSaved={onSaved}
      />,
    );
    const typeTrigger =
      rendu.container.querySelector<HTMLButtonElement>('#edit-col-type')!;
    // Référentiel chargé : le type de la collecte est affiché par son libellé.
    if (collecte.type_evenement_id)
      await waitFor(
        () => expect(typeTrigger).toHaveTextContent('Cocktail'),
        ATTENTE_UI,
      );
    const patchs = () =>
      fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'PATCH')
        .map(([url, init]) => [url, JSON.parse(String(init?.body))]);
    const saisir = (selecteur: string, valeur: string) =>
      fireEvent.change(rendu.container.querySelector(selecteur)!, {
        target: { value: valeur },
      });
    const confirmer = () =>
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirmer la modification' }),
      );
    return { ...rendu, onSaved, patchs, saisir, confirmer, typeTrigger };
  }

  it(
    'M1.2/type_contacts_par_collecte — type et contacts dans la section « Collecte », pré-remplis avec ceux de la collecte',
    async () => {
      const { container, typeTrigger } = await monterB1();
      const sectionCollecte = screen
        .getByRole('heading', { name: 'Collecte' })
        .closest('section')!;
      const sectionEvenement = screen
        .getByRole('heading', { name: 'Événement' })
        .closest('section')!;
      for (const id of [
        '#edit-col-type',
        '#edit-cp-nom',
        '#edit-cp-tel',
        '#edit-cs-nom',
        '#edit-cs-tel',
      ]) {
        expect(sectionCollecte.querySelector(id)).not.toBeNull();
        expect(sectionEvenement.querySelector(id)).toBeNull();
      }
      // Plus aucun champ de type au niveau de l'événement.
      expect(container.querySelector('#edit-evt-type')).toBeNull();
      expect(typeTrigger).toHaveTextContent('Cocktail');
      expect(container.querySelector('#edit-cp-nom')).toHaveValue('Jean');
      expect(container.querySelector('#edit-cp-tel')).toHaveValue('0600000000');
      expect(container.querySelector('#edit-cs-nom')).toHaveValue('Léa');
      expect(container.querySelector('#edit-cs-tel')).toHaveValue('0633333333');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/type_contacts_par_collecte — type et contacts partent dans la requête de la collecte, jamais dans celle de l’événement',
    async () => {
      const { onSaved, patchs, saisir, confirmer, typeTrigger } =
        await monterB1();
      // Un champ de l'événement change aussi : les deux requêtes partent.
      saisir('#edit-evt-client', 'Autre client');
      fireEvent.click(typeTrigger);
      fireEvent.click(screen.getByRole('option', { name: 'Dîner assis' }));
      saisir('#edit-cp-nom', 'Marie Durand');
      saisir('#edit-cp-tel', '0611223344');
      saisir('#edit-cs-nom', 'Louis Secours');
      saisir('#edit-cs-tel', '0699887766');
      confirmer();
      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
      expect(patchs()).toEqual([
        [
          '/api/v1/programmation/evenements/evt-1',
          { nom_client_organisateur: 'Autre client' },
        ],
        [
          '/api/v1/traiteur/collectes/col-1',
          {
            type_evenement_id: 't2',
            contact_principal_nom: 'Marie Durand',
            contact_principal_telephone: '0611223344',
            contact_secours_nom: 'Louis Secours',
            contact_secours_telephone: '0699887766',
            evenement_modifie: true,
          },
        ],
      ]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/type_contacts_par_collecte — un contact seul modifié : la seule requête est celle de la collecte, avec ce seul champ',
    async () => {
      const { onSaved, patchs, saisir, confirmer } = await monterB1();
      saisir('#edit-cp-tel', '0611223344');
      confirmer();
      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
      expect(patchs()).toEqual([
        [
          '/api/v1/traiteur/collectes/col-1',
          { contact_principal_telephone: '0611223344' },
        ],
      ]);
    },
    ATTENTE_CAS_MS,
  );

  // Contact de secours et client final obligatoires (décision Val 2026-10-30) :
  // les vider est refusé à l'écran, comme le contact principal.
  it.each([
    [
      'contact de secours vidé',
      '#edit-cs-nom',
      '',
      'Le contact de secours et son téléphone sont obligatoires.',
    ],
    [
      'téléphone de secours fait de blancs',
      '#edit-cs-tel',
      '   ',
      'Le contact de secours et son téléphone sont obligatoires.',
    ],
    [
      'client final vidé',
      '#edit-evt-client',
      '',
      'Le client final est obligatoire.',
    ],
  ])(
    'M1.2/type_contacts_par_collecte — %s : refusé à l’écran, rien n’est envoyé',
    async (_cas, champ, valeur, message) => {
      const { onSaved, patchs, saisir, confirmer } = await monterB1();
      saisir(champ, valeur);
      confirmer();
      expect(
        await screen.findByText(message, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(onSaved).not.toHaveBeenCalled();
      expect(patchs()).toEqual([]);
    },
    ATTENTE_CAS_MS,
  );

  // Un cas par champ vidé : chacun part d'un formulaire neuf.
  it.each([
    ['nom vidé', '#edit-cp-nom', ''],
    ['nom fait de blancs', '#edit-cp-nom', '   '],
    ['téléphone vidé', '#edit-cp-tel', ''],
  ])(
    'M1.2/type_contacts_par_collecte — contact principal %s : refusé à l’écran, rien n’est envoyé',
    async (_cas, champ, valeur) => {
      const { onSaved, patchs, saisir, confirmer } = await monterB1();
      saisir(champ, valeur);
      confirmer();
      expect(
        await screen.findByText(
          'Le contact principal et son téléphone sont obligatoires.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(onSaved).not.toHaveBeenCalled();
      expect(patchs()).toEqual([]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/type_contacts_par_collecte — collecte sans contact principal (reprise) non modifié : les autres champs restent modifiables',
    async () => {
      const { onSaved, patchs, saisir, confirmer } = await monterB1({
        ...AVEC_TYPE,
        contact_principal_nom: null,
        contact_principal_telephone: null,
      });
      saisir('#edit-evt-ref-affaire', 'AFF-9');
      confirmer();
      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
      expect(
        screen.queryByText(
          'Le contact principal et son téléphone sont obligatoires.',
        ),
      ).toBeNull();
      expect(patchs()).toEqual([
        [
          '/api/v1/programmation/evenements/evt-1',
          { reference_affaire: 'AFF-9', collecte_id: 'col-1' },
        ],
      ]);
    },
    ATTENTE_CAS_MS,
  );
});

// Urgence = ancien OU nouveau créneau à moins de 12h (décision Val 2026-10-09),
// la même règle que l'email à l'équipe Savr (lib/collectes/urgence-modification).
describe('M3.1 / EditerCollecteForm — avertissement d’urgence', () => {
  const AVERTISSEMENT = /moins de 12h avant la collecte/;

  async function monterA(maintenant: string) {
    // Seule l'horloge est figée : les minuteries restent réelles.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(maintenant) });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]')),
    );
    const rendu = render(
      <EditerCollecteForm
        collecte={COLLECTE}
        collecteEndpoint="/api/v1/traiteur/collectes/col-1"
      />,
    );
    // Laisse le chargement des types d'événement se résoudre avant les assertions.
    await act(async () => {});
    return rendu;
  }

  it('M3.1/email_modification_urgence_12h — collecte de ce matin repoussée au soir : l’avertissement reste affiché', async () => {
    // 08h00 à Paris le jour de la collecte, prévue à 10h10 : dans 2 h 10.
    const { container } = await monterA('2099-06-15T06:00:00Z');
    expect(screen.queryAllByText(AVERTISSEMENT)).not.toHaveLength(0);

    // Repoussée à 23h45 : le nouveau créneau est à 15 h 45, l'ancien reste proche.
    fireEvent.click(container.querySelector('#edit-heure-collecte')!);
    fireEvent.click(screen.getByRole('option', { name: '23:45' }));
    expect(screen.queryAllByText(AVERTISSEMENT)).not.toHaveLength(0);
  });

  it('M3.1/email_modification_urgence_12h — collecte de demain avancée à moins de 12h : l’avertissement apparaît', async () => {
    // 21h00 à Paris la veille : la collecte de 10h10 est dans 13 h 10.
    const { container } = await monterA('2099-06-14T19:00:00Z');
    expect(screen.queryAllByText(AVERTISSEMENT)).toHaveLength(0);

    // Avancée à 08h00 : le nouveau créneau est dans 11 h.
    fireEvent.click(container.querySelector('#edit-heure-collecte')!);
    fireEvent.click(screen.getByRole('option', { name: '08:00' }));
    expect(screen.queryAllByText(AVERTISSEMENT)).not.toHaveLength(0);
  });

  it('M3.1/email_modification_urgence_12h — collecte dans deux semaines, non déplacée : aucun avertissement', async () => {
    await monterA('2099-06-01T06:00:00Z');
    expect(screen.queryAllByText(AVERTISSEMENT)).toHaveLength(0);
  });
});

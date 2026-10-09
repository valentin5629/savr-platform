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
  controle_acces_requis: false,
  informations_supplementaires: null,
  lieu_nom: 'Pavillon Gabriel',
  evenement: {
    id: 'evt-1',
    nom_evenement: 'Soirée',
    pax: 80,
    type_evenement_id: null,
    nom_client_organisateur: 'Client',
    reference_affaire: null,
    contact_principal_nom: 'Jean',
    contact_principal_telephone: '0600000000',
    contact_secours_nom: null,
    contact_secours_telephone: null,
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
    'M3.1/email_modification_un_seul_email — pax et heure : la requête collecte signale que l’événement vient d’être modifié',
    async () => {
      const { container, onSaved, patchs } = monter();
      fireEvent.change(container.querySelector('#edit-evt-pax')!, {
        target: { value: '120' },
      });
      fireEvent.click(container.querySelector('#edit-heure-collecte')!);
      fireEvent.click(screen.getByRole('option', { name: '18:45' }));
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirmer la modification' }),
      );
      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
      expect(patchs()).toEqual([
        ['/api/v1/programmation/evenements/evt-1', { pax: 120 }],
        [
          '/api/v1/traiteur/collectes/col-1',
          { heure_collecte: '18:45:00', evenement_modifie: true },
        ],
      ]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/email_modification_un_seul_email — pax seul : la requête événement nomme la collecte, aucune requête collecte',
    async () => {
      const { container, onSaved, patchs } = monter();
      fireEvent.change(container.querySelector('#edit-evt-pax')!, {
        target: { value: '120' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirmer la modification' }),
      );
      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
      expect(patchs()).toEqual([
        [
          '/api/v1/programmation/evenements/evt-1',
          { pax: 120, collecte_id: 'col-1' },
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

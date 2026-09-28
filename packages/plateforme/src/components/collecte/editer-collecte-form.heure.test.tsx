/**
 * Édition d'une collecte — l'heure se choisit dans les créneaux de 15 min
 * (même TimePicker que le formulaire de programmation, CDC §06.01).
 * Épingle : aucun input time natif, heure actuelle affichée (même hors
 * grille, ex. donnée migrée), créneau choisi → PATCH `heure_collecte` `HH:MM:00`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
  notes_internes: null,
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
    notes_internes: null,
  },
};

afterEach(() => vi.unstubAllGlobals());

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

/**
 * Barre de filtres globale reprise sur tous les dashboards (revue E2E du
 * 2026-10-30) : composition selon les options du rôle, et paramètres envoyés.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';
import {
  DashboardFilterBar,
  type DashboardFilters,
} from './DashboardFilterBar';
import { ajouterFiltresGlobaux, optionsBarreValides } from './filtres-query';

function makeLocalStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  } as Storage;
}

beforeEach(() => vi.stubGlobal('localStorage', makeLocalStorage()));
afterEach(() => vi.unstubAllGlobals());

const lieux = [{ id: 'L1', nom: 'Grand Palais' }];
const types = [{ id: 't1', libelle: 'Gala' }];
const libelles = () =>
  screen
    .getByTestId('dashboard-filter-bar')
    .querySelectorAll('button[data-testid^="dashboard-filter-"]');

describe('Barre de filtres globale — composition par rôle', () => {
  it('traiteur / agence : Période, Lieux, Client organisateur, Type, Taille — sans Traiteurs (§06.04)', () => {
    render(
      <DashboardFilterBar
        storageKey="barre-traiteur"
        onChange={vi.fn()}
        parcOptions={{ lieux, types, clients: [{ id: 'Dior', nom: 'Dior' }] }}
      />,
    );
    const ids = [...libelles()].map((b) => b.getAttribute('data-testid'));
    expect(ids).toEqual([
      'dashboard-filter-periode',
      'dashboard-filter-lieux',
      'dashboard-filter-clients',
      'dashboard-filter-type',
      'dashboard-filter-taille',
    ]);
    expect(screen.getByTestId('dashboard-filter-clients')).toHaveTextContent(
      'Client organisateur',
    );
  });

  it('client organisateur, gestionnaire, Admin : Période, Lieux, Traiteurs, Type, Taille', () => {
    render(
      <DashboardFilterBar
        storageKey="barre-organisateur"
        onChange={vi.fn()}
        parcOptions={{ lieux, types, traiteurs: [{ id: 'T1', nom: 'Kaspia' }] }}
      />,
    );
    const ids = [...libelles()].map((b) => b.getAttribute('data-testid'));
    expect(ids).toEqual([
      'dashboard-filter-periode',
      'dashboard-filter-lieux',
      'dashboard-filter-traiteurs',
      'dashboard-filter-type',
      'dashboard-filter-taille',
    ]);
  });

  it(
    'cocher un client le transmet, et fait apparaître « Réinitialiser les filtres »',
    async () => {
      const onChange = vi.fn();
      render(
        <DashboardFilterBar
          storageKey="barre-client"
          onChange={onChange}
          parcOptions={{ lieux, types, clients: [{ id: 'Dior', nom: 'Dior' }] }}
        />,
      );
      expect(screen.queryByTestId('dashboard-filter-reinitialiser')).toBeNull();
      fireEvent.click(screen.getByTestId('dashboard-filter-clients'));
      const liste = await screen.findByRole(
        'list',
        { name: 'Client organisateur' },
        ATTENTE_UI,
      );
      fireEvent.click(within(liste).getByText('Dior'));
      const dernier = onChange.mock.calls.at(-1)![0] as DashboardFilters;
      expect(dernier.client_noms).toEqual(['Dior']);
      expect(
        screen.getByTestId('dashboard-filter-reinitialiser'),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});

describe('ajouterFiltresGlobaux / optionsBarreValides', () => {
  it('écrit chaque filtre posé sous le nom lu par les routes', () => {
    const qs = ajouterFiltresGlobaux(
      new URLSearchParams({ type: 'zero_dechet' }),
      {
        from: '2026-01-01',
        to: '2026-12-31',
        lieu_ids: ['L1'],
        traiteur_ids: [],
        client_noms: ['Dior', 'LVMH'],
        type_evenement_ids: ['t1'],
        taille_evenement_codes: ['M'],
      },
    );
    expect(qs.toString()).toBe(
      new URLSearchParams([
        ['type', 'zero_dechet'],
        ['lieu_ids[]', 'L1'],
        ['client_noms[]', 'Dior'],
        ['client_noms[]', 'LVMH'],
        ['type_evenement_ids[]', 't1'],
        ['taille_evenements[]', 'M'],
      ]).toString(),
    );
  });

  it('une réponse sans listes de lieux et de types donne des listes vides', () => {
    expect(optionsBarreValides({ lieux, types })).toEqual({ lieux, types });
    expect(optionsBarreValides(undefined)).toEqual({ lieux: [], types: [] });
    expect(optionsBarreValides({ kpi: {} })).toEqual({ lieux: [], types: [] });
  });
});

/**
 * R-UI-4b (D8, D9) — barres de dashboard bâties sur `FilterBar` :
 * « Réinitialiser les filtres » seulement quand un filtre diffère du défaut,
 * même carte que la barre des listes (décision Val 2026-11-01), encart benchmark
 * (`surface="encart"`), raccourcis de période standard et `Combobox titre`
 * dans l'assistant « Synthèse PDF ».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';
import { DashboardFilterBar } from './DashboardFilterBar';
import { BenchmarkFilterBar } from './BenchmarkFilterBar';
import { ExportSyntheseBloc } from './ExportSyntheseBloc';
import { periodeDerniers, raccourcisPeriode } from '@/lib/periodes-raccourcis';

// localStorage en mémoire, neuf à chaque cas (même idiome que les autres tests
// de dashboards). Sous Node 25 (poste local ; la CI est en Node 20), le
// `localStorage` global n'expose pas clear() : l'appeler ici faisait échouer
// les 6 cas avant leur première ligne.
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

beforeEach(() => {
  vi.stubGlobal('localStorage', makeLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DashboardFilterBar — même carte que la barre des listes', () => {
  it('carte blanche bordée comme la liste Événements, pas de pied sans compteur, reset masqué au défaut', () => {
    render(
      <DashboardFilterBar storageKey="r-ui-4b-carte" onChange={vi.fn()} />,
    );
    const barre = screen.getByTestId('dashboard-filter-bar');
    expect(barre.tagName).toBe('SECTION');
    expect(barre.className).toMatch(/bg-savr-white/);
    expect(barre.className).toMatch(/border-savr-neutral-200/);
    expect(screen.queryByTestId('dashboard-filter-bar-count')).toBeNull();
    expect(screen.queryByTestId('dashboard-filter-reinitialiser')).toBeNull();
  });

  it('`count` fourni → compteur en pied de la barre, dans la carte', () => {
    render(
      <DashboardFilterBar
        storageKey="r-ui-4b-count"
        onChange={vi.fn()}
        count={<span>3 collectes correspondent à votre sélection</span>}
      />,
    );
    const pied = screen.getByTestId('dashboard-filter-bar-count');
    expect(pied).toHaveTextContent(
      '3 collectes correspondent à votre sélection',
    );
    expect(screen.getByTestId('dashboard-filter-bar')).toContainElement(pied);
  });

  it('période ≠ 12 derniers mois → « Réinitialiser les filtres » apparaît, puis ramène au défaut et disparaît', () => {
    const onChange = vi.fn();
    render(
      <DashboardFilterBar storageKey="r-ui-4b-reset" onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId('dashboard-filter-periode'));
    fireEvent.click(screen.getByTestId('dashboard-filter-preset-30j'));
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    const reset = screen.getByTestId('dashboard-filter-reinitialiser');
    expect(reset).toHaveTextContent('Réinitialiser les filtres');
    fireEvent.click(reset);
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject(
      periodeDerniers(12, 'mois')!,
    );
    expect(screen.queryByTestId('dashboard-filter-reinitialiser')).toBeNull();
  });

  it('enfants sans `enfantsActifs` → reset affiché ; `enfantsActifs={false}` → masqué ; `toggle` rendu en en-tête', () => {
    const { rerender } = render(
      <DashboardFilterBar
        storageKey="r-ui-4b-enfants"
        onChange={vi.fn()}
        toggle={<span data-testid="segmente">ZD/AG</span>}
      >
        <span>Filtre du consommateur</span>
      </DashboardFilterBar>,
    );
    expect(
      screen.getByTestId('dashboard-filter-reinitialiser'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('segmente')).toBeInTheDocument();
    rerender(
      <DashboardFilterBar
        storageKey="r-ui-4b-enfants"
        onChange={vi.fn()}
        enfantsActifs={false}
      >
        <span>Filtre du consommateur</span>
      </DashboardFilterBar>,
    );
    expect(screen.queryByTestId('dashboard-filter-reinitialiser')).toBeNull();
  });
});

describe('BenchmarkFilterBar — FilterBar surface encart', () => {
  const options = {
    lieux: [{ id: 'l1', nom: 'Lieu Un' }],
    traiteurs: [],
    types: [{ id: 't1', libelle: 'Gala' }],
  };

  it(
    'héritage pur → pas de reset ; un lieu coché → reset visible, puis retour à l’héritage',
    async () => {
      const onChange = vi.fn();
      render(
        <BenchmarkFilterBar
          onChange={onChange}
          initialOptions={options}
          initialTypeEvenementIds={['t1']}
        />,
      );
      expect(screen.getByText('Comparer avec')).toBeInTheDocument();
      expect(screen.queryByTestId('benchmark-reinitialiser')).toBeNull();
      fireEvent.click(screen.getByTestId('benchmark-filter-lieux'));
      fireEvent.click(
        within(
          await screen.findByRole('list', { name: 'Lieux' }, ATTENTE_UI),
        ).getByRole('checkbox', { name: 'Lieu Un' }),
      );
      fireEvent.click(screen.getByTestId('benchmark-reinitialiser'));
      expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
        lieu_ids: [],
        type_evenement_ids: ['t1'],
      });
      expect(screen.queryByTestId('benchmark-reinitialiser')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

describe('ExportSyntheseBloc — raccourcis standard (D8) et Combobox titre (D9)', () => {
  const filtresDashboard = {
    ...periodeDerniers(12, 'mois')!,
    lieu_ids: [],
    traiteur_ids: [],
    type_evenement_ids: [],
    taille_evenement_codes: [],
  };

  function stubFiltres() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            clients: [{ id: 'c1', nom: 'Client Un' }],
            commerciaux: [],
          },
        }),
      })),
    );
  }

  it('étape Période : chips = liste standard + « Personnalisée », « Année civile » = 1er janv → 31 déc', () => {
    stubFiltres();
    render(<ExportSyntheseBloc filters={filtresDashboard} tab="zero_dechet" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Exporter une synthèse PDF' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Précédent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Précédent' }));
    const chips = within(
      screen.getByRole('group', { name: 'Raccourcis de période' }),
    ).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual([
      ...raccourcisPeriode().map((r) => r.libelle),
      'Personnalisée',
    ]);
    // Pré-rempli depuis le dashboard (12 derniers mois) : le chip se déduit.
    expect(
      screen.getByRole('button', { name: '12 derniers mois' }),
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Année civile' }));
    const annee = periodeDerniers(1, 'jours')!.to.slice(0, 4);
    const periode = screen.getByTestId('synthese-periode');
    expect(periode).toHaveAttribute('data-from', `${annee}-01-01`);
    expect(periode).toHaveAttribute('data-to', `${annee}-12-31`);
    expect(
      screen.getByRole('button', { name: 'Année civile' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it(
    'étape Filtres : « Client organisateur  Tous les clients ▾ » (Combobox titre multiple)',
    async () => {
      stubFiltres();
      render(
        <ExportSyntheseBloc filters={filtresDashboard} tab="zero_dechet" />,
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Exporter une synthèse PDF' }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Précédent' }));
      const clients = await screen.findByRole(
        'combobox',
        { name: 'Client organisateur' },
        ATTENTE_UI,
      );
      expect(clients).toHaveTextContent('Tous les clients');
      fireEvent.click(clients);
      fireEvent.click(
        await screen.findByRole('option', { name: 'Client Un' }, ATTENTE_UI),
      );
      await waitFor(
        () => expect(clients).toHaveTextContent('Client Un'),
        ATTENTE_UI,
      );
      expect(screen.queryByTestId('synthese-filtre-commerciaux')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

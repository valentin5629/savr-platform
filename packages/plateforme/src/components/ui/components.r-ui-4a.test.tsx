/**
 * R-UI-4a — listes paginées : `useFiltresUrl` (état des filtres miroir URL,
 * retour page 1, reset), `useListePaginee` (anti-réponse périmée, état Error,
 * Réessayer), `ListFooter`, `DataGrid` (`erreur`, `empty` par défaut,
 * `columnsToggle={false}` sur les petits blocs).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';

const navState = vi.hoisted(() => ({
  search: null as URLSearchParams | null,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => navState.search,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import {
  useFiltresUrl,
  texte,
  liste,
  entier,
  navigation,
} from '@/lib/hooks/use-filtres-url';
import { useListePaginee, ERREUR_LISTE } from '@/lib/hooks/use-liste-paginee';
import { ListFooter } from '@/components/ui/list-footer';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';

const SCHEMA = {
  q: texte(''),
  types: liste(),
  actif: liste(['true']),
  page: navigation(entier(1, 1)),
  tri: navigation(texte('nom')),
};

function Filtres() {
  const { valeurs, set, reset, actif } = useFiltresUrl(SCHEMA);
  return (
    <div>
      <output data-testid="etat">{JSON.stringify(valeurs)}</output>
      <output data-testid="actif">{String(actif)}</output>
      <button type="button" onClick={() => set({ q: 'pavillon' })}>
        q
      </button>
      <button type="button" onClick={() => set({ types: ['a', 'b'] })}>
        types
      </button>
      <button type="button" onClick={() => set({ page: 3 })}>
        page3
      </button>
      <button type="button" onClick={() => set({ tri: 'ville' })}>
        tri
      </button>
      <button type="button" onClick={() => set({ actif: [] })}>
        tous
      </button>
      <button type="button" onClick={reset}>
        reset
      </button>
    </div>
  );
}

function etat(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('etat').textContent ?? '{}');
}

describe('useFiltresUrl — état des filtres miroir dans l’URL', () => {
  beforeEach(() => {
    navState.search = null;
    window.history.replaceState(null, '', '/liste');
  });

  it('défauts hors contexte ; set() écrit l’URL (CSV, défauts omis) et remet page à 1', () => {
    render(<Filtres />);
    expect(etat()).toEqual({
      q: '',
      types: [],
      actif: ['true'],
      page: 1,
      tri: 'nom',
    });
    expect(screen.getByTestId('actif').textContent).toBe('false');
    fireEvent.click(screen.getByText('page3'));
    expect(etat().page).toBe(3);
    fireEvent.click(screen.getByText('types'));
    expect(etat()).toMatchObject({ types: ['a', 'b'], page: 1 });
    expect(screen.getByTestId('actif').textContent).toBe('true');
    expect(window.location.search).toBe('?types=a%2Cb');
    fireEvent.click(screen.getByText('tri'));
    expect(window.location.search).toBe('?types=a%2Cb&tri=ville');
  });

  it('lecture initiale depuis useSearchParams ; reset() garde la navigation (tri) et remet page à 1', () => {
    navState.search = new URLSearchParams('q=x&types=a&page=4&tri=ville');
    render(<Filtres />);
    expect(etat()).toEqual({
      q: 'x',
      types: ['a'],
      actif: ['true'],
      page: 4,
      tri: 'ville',
    });
    fireEvent.click(screen.getByText('reset'));
    expect(etat()).toEqual({
      q: '',
      types: [],
      actif: ['true'],
      page: 1,
      tri: 'ville',
    });
    expect(screen.getByTestId('actif').textContent).toBe('false');
    expect(window.location.search).toBe('?tri=ville');
  });

  it('entier borné : ?page=0 lu comme 1 (min) ; l’URL est écrite avec un état history nul (resynchro Next)', () => {
    navState.search = new URLSearchParams('page=0');
    const spy = vi.spyOn(window.history, 'replaceState');
    render(<Filtres />);
    expect(etat().page).toBe(1);
    fireEvent.click(screen.getByText('q'));
    expect(spy).toHaveBeenLastCalledWith(null, '', '/liste?q=pavillon');
    spy.mockRestore();
  });

  it('liste vide ≠ défaut non vide : « Tous » (actif=[]) est écrit explicitement et relu', () => {
    render(<Filtres />);
    fireEvent.click(screen.getByText('tous'));
    expect(window.location.search).toBe('?actif=');
    expect(screen.getByTestId('actif').textContent).toBe('true');
  });
});

function Liste({ url }: { url: string | null }) {
  const { data, total, loading, erreur, recharger } = useListePaginee<{
    id: string;
  }>(url);
  return (
    <div>
      <output data-testid="loading">{String(loading)}</output>
      <output data-testid="total">{total}</output>
      <output data-testid="ids">{data.map((d) => d.id).join(',')}</output>
      {erreur && <p role="alert">{erreur}</p>}
      <button type="button" onClick={recharger}>
        Réessayer
      </button>
    </div>
  );
}

describe('useListePaginee — chargement, anti-périmé, erreur', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    'charge data/total ; une réponse plus ancienne arrivée après est ignorée',
    async () => {
      const pending: Record<string, (r: unknown) => void> = {};
      fetchMock.mockImplementation(
        (u: string) =>
          new Promise((resolve) => {
            pending[u] = resolve;
          }),
      );
      const reponse = (ids: string[]) => ({
        ok: true,
        json: () =>
          Promise.resolve({ data: ids.map((id) => ({ id })), total: 99 }),
      });
      const { rerender } = render(<Liste url="/api?page=1" />);
      expect(screen.getByTestId('loading').textContent).toBe('true');
      rerender(<Liste url="/api?page=2" />);
      await waitFor(
        () => expect(pending['/api?page=2']).toBeDefined(),
        ATTENTE_UI,
      );
      // La page 2 répond d'abord, puis la page 1 (périmée) : la liste reste page 2.
      await act(async () => {
        pending['/api?page=2']!(reponse(['p2']));
      });
      await waitFor(
        () => expect(screen.getByTestId('ids').textContent).toBe('p2'),
        ATTENTE_UI,
      );
      await act(async () => {
        pending['/api?page=1']!(reponse(['p1']));
      });
      expect(screen.getByTestId('ids').textContent).toBe('p2');
      expect(screen.getByTestId('total').textContent).toBe('99');
      expect(screen.getByTestId('loading').textContent).toBe('false');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'réponse !ok → état Error (jamais une liste vide) ; Réessayer relance',
    async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
      render(<Liste url="/api" />);
      expect(
        await screen.findByRole('alert', undefined, ATTENTE_UI),
      ).toHaveTextContent(ERREUR_LISTE);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'a' }], total: 1 }),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      await waitFor(
        () => expect(screen.getByTestId('ids').textContent).toBe('a'),
        ATTENTE_UI,
      );
      expect(screen.queryByRole('alert')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'url nulle : aucun appel, pas de chargement ; chaîne → null vide la liste et baisse loading',
    async () => {
      const { rerender } = render(<Liste url={null} />);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByTestId('loading').textContent).toBe('false');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'a' }], total: 1 }),
      });
      rerender(<Liste url="/api" />);
      await waitFor(
        () => expect(screen.getByTestId('ids').textContent).toBe('a'),
        ATTENTE_UI,
      );
      rerender(<Liste url={null} />);
      expect(screen.getByTestId('loading').textContent).toBe('false');
      expect(screen.getByTestId('ids').textContent).toBe('');
      expect(screen.getByTestId('total').textContent).toBe('0');
    },
    ATTENTE_CAS_MS,
  );
});

describe('ListFooter — pagination commune', () => {
  it('une seule page sans choix de taille : rien ; sinon Pagination à droite', () => {
    const { container, rerender } = render(
      <ListFooter total={30} page={1} onPageChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
    const onPageChange = vi.fn();
    rerender(<ListFooter total={120} page={2} onPageChange={onPageChange} />);
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Page 4' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Page suivante' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    expect(nav.parentElement).toHaveClass('justify-end');
  });

  it('taille de page (registre) : Combobox « Par page » même sur une seule page', () => {
    const onTaille = vi.fn();
    render(
      <ListFooter
        total={10}
        page={1}
        onPageChange={vi.fn()}
        taillePage={25}
        taillesPage={[25, 50, 100]}
        onTaillePageChange={onTaille}
      />,
    );
    expect(
      screen.getByRole('combobox', { name: 'Lignes par page' }),
    ).toHaveTextContent('25');
  });
});

describe('DataGrid — états erreur / vide, menu Colonnes', () => {
  type Row = { id: string; nom: string };
  const columns: ColumnDef<Row, unknown>[] = [
    { id: 'nom', header: 'Nom', accessorFn: (r) => r.nom },
  ];

  it('erreur : AlertBar + Réessayer à la place du tableau', () => {
    const onRecharger = vi.fn();
    render(
      <DataGrid
        columns={columns}
        data={[{ id: '1', nom: 'A' }]}
        getRowId={(r) => r.id}
        erreur="Le chargement de la liste a échoué."
        onRecharger={onRecharger}
      />,
    );
    expect(
      screen.getByText('Le chargement de la liste a échoué.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: /Colonnes/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRecharger).toHaveBeenCalledTimes(1);
  });

  it('vide : « Aucun résultat. » par défaut ; menu Colonnes présent par défaut (décision Val 2026-09-28), columnsToggle={false} le retire', () => {
    const { rerender } = render(
      <DataGrid columns={columns} data={[]} getRowId={(r) => r.id} />,
    );
    expect(screen.getByText('Aucun résultat.')).toBeInTheDocument();
    rerender(
      <DataGrid
        columns={columns}
        data={[{ id: '1', nom: 'A' }]}
        getRowId={(r) => r.id}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Colonnes/ }),
    ).toBeInTheDocument();
    rerender(
      <DataGrid
        columns={columns}
        data={[{ id: '1', nom: 'A' }]}
        getRowId={(r) => r.id}
        columnsToggle={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /Colonnes/ })).toBeNull();
  });
});

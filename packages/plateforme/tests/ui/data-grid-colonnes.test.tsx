/**
 * DataGrid — menu « Colonnes » actif par défaut sur TOUS les tableaux
 * (décision Val 2026-09-28 : même format que la liste Collectes partout).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { ATTENTE_UI } from '@/test-utils/attente-ui';

interface Ligne {
  id: string;
  nom: string;
  ville: string;
}

const COLONNES: ColumnDef<Ligne, unknown>[] = [
  { id: 'nom', header: 'Nom', accessorFn: (l) => l.nom },
  { id: 'ville', header: 'Ville', accessorFn: (l) => l.ville },
  {
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    meta: { label: 'Actions', interactive: true },
    cell: () => <button type="button">Éditer</button>,
  },
];

const LIGNES: Ligne[] = [{ id: '1', nom: 'Salle Wagram', ville: 'Paris' }];

async function ouvrirMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: /Colonnes/ }), {
    key: 'Enter',
  });
  return screen.findByRole('menu', undefined, ATTENTE_UI);
}

describe('DataGrid — menu « Colonnes »', () => {
  it('présent par défaut, sans prop à passer', () => {
    render(
      <DataGrid columns={COLONNES} data={LIGNES} getRowId={(l) => l.id} />,
    );
    expect(
      screen.getByRole('button', { name: /Colonnes/ }),
    ).toBeInTheDocument();
  });

  it('masquer une colonne la retire du tableau ; la colonne Actions n’est pas proposée', async () => {
    render(
      <DataGrid columns={COLONNES} data={LIGNES} getRowId={(l) => l.id} />,
    );
    const menu = await ouvrirMenu();
    const items = within(menu).getAllByRole('menuitemcheckbox');
    expect(items.map((i) => i.textContent)).toEqual(['Nom', 'Ville']);

    fireEvent.click(
      within(menu).getByRole('menuitemcheckbox', { name: 'Ville' }),
    );
    // Menu ouvert = reste de la page masqué aux lecteurs d'écran (Radix) :
    // on le ferme avant de lire le tableau.
    fireEvent.keyDown(menu, { key: 'Escape' });
    const tableau = within(screen.getByRole('table'));
    expect(tableau.queryByRole('columnheader', { name: /Ville/ })).toBeNull();
    expect(tableau.queryByText('Paris')).toBeNull();
    expect(tableau.getByText('Salle Wagram')).toBeInTheDocument();
  });

  it('columnsToggle={false} retire le menu', () => {
    render(
      <DataGrid
        columns={COLONNES}
        data={LIGNES}
        getRowId={(l) => l.id}
        columnsToggle={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /Colonnes/ })).toBeNull();
  });
});

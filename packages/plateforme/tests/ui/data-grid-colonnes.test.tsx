/**
 * DataGrid — menu « Colonnes » actif par défaut sur TOUS les tableaux
 * (décision Val 2026-09-28 : même format que la liste Collectes partout).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { BoutonExportCsv } from '@/components/ui/bouton-export-csv';
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

  it('« Exporter CSV » se place juste à gauche de « Colonnes » (décision Val 2026-10-30)', () => {
    let clics = 0;
    render(
      <DataGrid
        columns={COLONNES}
        data={LIGNES}
        getRowId={(l) => l.id}
        toolbarActions={<BoutonExportCsv onClick={() => clics++} />}
      />,
    );
    const export_ = screen.getByRole('button', { name: 'Exporter CSV' });
    const colonnes = screen.getByRole('button', { name: /Colonnes/ });
    expect(export_.nextElementSibling).toBe(colonnes);
    expect(export_.querySelector('svg')).not.toBeNull();
    fireEvent.click(export_);
    expect(clics).toBe(1);
    // Même taille, 25 % sous le bouton standard sur ordinateur (Val
    // 2026-10-31) ; 44 px gardés sur mobile.
    for (const b of [export_, colonnes]) {
      expect(b.className).toMatch(/(^|\s)sm:h-\[30px\](\s|$)/);
      expect(b.className).toMatch(/(^|\s)h-11(\s|$)/);
      expect(b.className).not.toMatch(/(^|\s)sm:h-10(\s|$)/);
    }
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

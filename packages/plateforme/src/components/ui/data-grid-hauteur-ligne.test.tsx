/**
 * Hauteur de ligne constante des tableaux (décision Val 2026-10-30) : toute
 * ligne desktop fait 64 px, chaque cellule est bornée (une ligne, 16 rem,
 * 48 px de contenu) sans couper le contour de focus, et le texte complet
 * d'une cellule coupée s'affiche au survol.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';

interface Ligne {
  id: string;
  nom: string;
}

const COLONNES: ColumnDef<Ligne, unknown>[] = [
  { id: 'nom', header: 'Nom', cell: ({ row }) => row.original.nom },
  {
    id: 'action',
    header: 'Action',
    meta: { interactive: true },
    cell: () => <button type="button">Agir</button>,
  },
];

function rendre() {
  return render(
    <DataGrid
      columns={COLONNES}
      data={[{ id: '1', nom: 'Cabinet Thévenin & Roche' }]}
      getRowId={(r) => r.id}
      columnsToggle={false}
    />,
  );
}

describe('DataGrid — hauteur de ligne constante', () => {
  it('fixe la hauteur de chaque ligne du corps', () => {
    const { container } = rendre();
    const tr = container.querySelector('tbody tr');
    expect(tr?.className).toContain('h-16');
  });

  it('borne le contenu de chaque cellule sur une ligne, sans retour', () => {
    const { container } = rendre();
    const cellules = container.querySelectorAll('tbody td > div');
    expect(cellules).toHaveLength(2);
    for (const c of cellules) {
      expect(c.className).toContain('max-h-14');
      expect(c.className).toContain('max-w-[16rem]');
      expect(c.className).toContain('overflow-hidden');
      expect(c.className).toContain('[&_.flex-wrap]:flex-nowrap');
    }
  });

  it('laisse la place au contour de focus des contrôles (p-1 -m-1)', () => {
    rendre();
    const [bouton] = screen.getAllByRole('button', { name: 'Agir' });
    if (!bouton) throw new Error('bouton absent');
    const enveloppe = bouton.closest('td > div');
    expect(enveloppe?.className).toMatch(/(^|\s)p-1(\s|$)/);
    expect(enveloppe?.className).toMatch(/(^|\s)-m-1(\s|$)/);
  });

  it('pose le texte complet au survol quand la cellule est coupée', () => {
    const { container } = rendre();
    const cellule = container.querySelector<HTMLDivElement>('tbody td > div')!;
    Object.defineProperty(cellule, 'scrollWidth', { value: 400 });
    Object.defineProperty(cellule, 'clientWidth', { value: 256 });
    Object.defineProperty(cellule, 'innerText', {
      value: 'Cabinet Thévenin & Roche',
    });
    fireEvent.mouseEnter(cellule);
    expect(cellule.title).toBe('Cabinet Thévenin & Roche');
  });

  it('ne pose aucune infobulle quand rien n’est coupé', () => {
    const { container } = rendre();
    const cellule = container.querySelector<HTMLDivElement>('tbody td > div')!;
    fireEvent.mouseEnter(cellule);
    expect(cellule.title).toBe('');
  });
});

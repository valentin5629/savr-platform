// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/react';
import {
  CelluleVide,
  DataGrid,
  type ColumnDef,
} from '@/components/ui/data-grid';

// Carte mobile des listes (< 640 px, DS §8 « ligne → card verticale, champs
// clés visibles, secondaires en accordéon "Voir plus" »). jsdom n'applique pas
// les feuilles de style : la carte (`ul`) et le tableau sont tous deux dans le
// document, on lit ici la seule carte.

interface Ligne {
  id: string;
  a: string;
  b: string;
  c: string;
  d: string;
  e: string;
  f: string;
  g: string;
}

const LIGNE: Ligne = {
  id: 'l1',
  a: 'Alpha',
  b: 'Bravo',
  c: 'Charlie',
  d: 'Delta',
  e: 'Echo',
  f: 'Foxtrot',
  g: 'Golf',
};

function colonne(
  id: keyof Ligne,
  extra: Partial<ColumnDef<Ligne, unknown>> = {},
): ColumnDef<Ligne, unknown> {
  return {
    id,
    header: `Titre ${id.toUpperCase()}`,
    cell: ({ row }) => row.original[id],
    ...extra,
  };
}

function carte(
  columns: ColumnDef<Ligne, unknown>[],
  props: { onRowClick?: (l: Ligne) => void } = {},
) {
  const { container } = render(
    <DataGrid
      columns={columns}
      data={[LIGNE]}
      getRowId={(l) => l.id}
      {...props}
    />,
  );
  const li = container.querySelector<HTMLElement>('ul > li[data-carte-liste]');
  if (!li) throw new Error('carte mobile absente');
  return li;
}

const lignes = (li: HTMLElement, sorte: 'principale' | 'secondaire') =>
  [...li.querySelectorAll(`[data-carte-ligne="${sorte}"]`)].map(
    (l) => l.querySelector('dt')?.textContent,
  );

describe('DataGrid — carte mobile', () => {
  it('la première colonne fait le titre, sans étiquette visible', () => {
    const li = carte([colonne('a'), colonne('b')]);
    const titre = li.firstElementChild!.firstElementChild as HTMLElement;
    expect(titre.textContent).toContain('Alpha');
    // L'étiquette du titre reste lue par les lecteurs d'écran.
    expect(titre.querySelector('.sr-only')?.textContent).toContain('Titre A');
    expect(li.querySelector('dl')?.textContent).not.toContain('Alpha');
  });

  it("jusqu'à cinq colonnes après le titre : toutes visibles, pas de « Voir plus »", () => {
    const li = carte(
      (['a', 'b', 'c', 'd', 'e', 'f'] as const).map((id) => colonne(id)),
    );
    expect(lignes(li, 'principale')).toEqual([
      'Titre B',
      'Titre C',
      'Titre D',
      'Titre E',
      'Titre F',
    ]);
    expect(lignes(li, 'secondaire')).toEqual([]);
    expect(li.querySelector('[data-carte-voir-plus]')).toBeNull();
  });

  it('au-delà : quatre lignes clés, le reste replié sous « Voir plus »', () => {
    const onRowClick = vi.fn();
    const li = carte(
      (['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const).map((id) => colonne(id)),
      { onRowClick },
    );
    expect(lignes(li, 'principale')).toEqual([
      'Titre B',
      'Titre C',
      'Titre D',
      'Titre E',
    ]);
    expect(lignes(li, 'secondaire')).toEqual(['Titre F', 'Titre G']);
    const repliees = () =>
      [...li.querySelectorAll('[data-carte-ligne="secondaire"]')].map((l) =>
        l.classList.contains('hidden'),
      );
    expect(repliees()).toEqual([true, true]);

    const bouton = within(li).getByRole('button', { name: 'Voir plus' });
    expect(bouton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(bouton);
    expect(repliees()).toEqual([false, false]);
    expect(
      within(li)
        .getByRole('button', { name: 'Voir moins' })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    // Déplier une carte n'ouvre pas la fiche de la ligne.
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('place déclarée par la colonne : titre, pastille, principal, secondaire', () => {
    const li = carte([
      colonne('a', { meta: { carteMobile: 'pastille' } }),
      colonne('b', { meta: { carteMobile: 'titre' } }),
      colonne('c', { meta: { carteMobile: 'secondaire' } }),
      colonne('d'),
      colonne('e', { meta: { carteMobile: 'principal' } }),
    ]);
    const tete = li.firstElementChild as HTMLElement;
    expect(tete.firstElementChild?.textContent).toContain('Bravo');
    expect(tete.lastElementChild?.textContent).toContain('Alpha');
    expect(lignes(li, 'principale')).toEqual(['Titre D', 'Titre E']);
    expect(lignes(li, 'secondaire')).toEqual(['Titre C']);
  });

  it("la colonne d'actions va au pied, sans étiquette ; une colonne masquée sur mobile n'y est pas", () => {
    const li = carte([
      colonne('a'),
      colonne('b', { meta: { hideOnMobile: true } }),
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { label: 'Actions', interactive: true },
        cell: () => <button type="button">Agir</button>,
      },
    ]);
    const pied = li.querySelector<HTMLElement>('[data-carte-pied]')!;
    expect(within(pied).getByRole('button', { name: 'Agir' })).toBeTruthy();
    expect(li.querySelector('dl')).toBeNull();
    expect(li.textContent).not.toContain('Bravo');
  });

  it("un clic dans une pastille cliquable n'ouvre pas la fiche de la ligne", () => {
    const onRowClick = vi.fn();
    const li = carte(
      [
        colonne('a'),
        colonne('b', {
          meta: { carteMobile: 'pastille', interactive: true },
          cell: () => <button type="button">Basculer</button>,
        }),
        colonne('c', { meta: { carteMobile: 'pastille' } }),
      ],
      { onRowClick },
    );
    fireEvent.click(within(li).getByRole('button', { name: 'Basculer' }));
    expect(onRowClick).not.toHaveBeenCalled();
    // Témoin : une pastille ordinaire laisse le clic ouvrir la fiche.
    fireEvent.click(within(li).getByText('Charlie'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('une cellule vide est repérable par la feuille de style', () => {
    const li = carte([
      colonne('a'),
      colonne('b', { cell: () => <CelluleVide /> }),
    ]);
    expect(li.querySelector('dd > [data-cellule-vide]:only-child')).not.toBe(
      null,
    );
  });
});

describe('globals.css — règles téléphone', () => {
  const css = readFileSync(
    join(__dirname, '../../app/globals.css'),
    'utf8',
  ).replace(/\s+/g, ' ');

  it('une ligne de carte sans valeur est masquée', () => {
    expect(css).toContain(
      '[data-carte-ligne]:has(> dd:empty), [data-carte-ligne]:has(> dd > [data-cellule-vide]:only-child), [data-carte-ligne]:has(> dd > :only-child:empty) { display: none; }',
    );
  });

  it('sous 640 px, tout champ de saisie fait 16 px (pas de zoom automatique sur iPhone)', () => {
    expect(css).toContain(
      "@media (width < 40rem) { input:not( [type='checkbox'], [type='radio'], [type='range'], [type='button'], [type='submit'], [type='reset'], [type='file'], [type='hidden'] ), textarea, select { font-size: 1rem; } }",
    );
  });
});

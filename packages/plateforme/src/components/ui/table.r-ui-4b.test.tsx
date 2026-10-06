/**
 * R-UI-4b — primitive Table : sémantique ARIA (table / columnheader / cell)
 * et pied de tableau `TableFooter` (ajouté pour la ligne « Total » du
 * bordereau registre).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

describe('Table (DS) — R-UI-4b', () => {
  it('rend une table accessible avec en-têtes, cellules et pied', () => {
    render(
      <Table className="min-w-[420px]">
        <TableHeader>
          <TableRow>
            <TableHead>Flux</TableHead>
            <TableHead className="text-right">Poids</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Verre</TableCell>
            <TableCell className="text-right">12 kg</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
            <TableCell>12 kg</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    );

    const table = screen.getByRole('table');
    // className passé par l'appelant → fusionné, pas écrasé.
    expect(table).toHaveClass('min-w-[420px]', 'text-sm');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(
      within(table).getByRole('cell', { name: 'Verre' }),
    ).toBeInTheDocument();

    const tfoot = table.querySelector('tfoot');
    expect(tfoot).not.toBeNull();
    expect(tfoot).toHaveClass(
      'border-t',
      'border-savr-neutral-200',
      'font-medium',
    );
    expect(within(tfoot as HTMLElement).getByText('Total')).toBeInTheDocument();
  });
});

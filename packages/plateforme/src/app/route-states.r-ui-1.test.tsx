import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AdminError from './(admin)/error';
import AdminLoading from './(admin)/loading';
import TraiteurError from './(traiteur)/error';
import { MESSAGE_ERREUR_ROUTE } from '@/components/layout/route-states';
import { captureException } from '@savr/shared/src/alerting/sentry.js';

vi.mock('@savr/shared/src/alerting/sentry.js', () => ({
  captureException: vi.fn(),
}));

// R-UI-1 H3/H5 — `loading.tsx` / `error.tsx` des groupes de routes.
describe('R-UI-1 / états de route App Router', () => {
  it('error.tsx : role=alert, message générique (jamais error.message), « Réessayer » appelle reset', () => {
    const reset = vi.fn();
    const erreur = new Error('relation "collectes" does not exist');

    render(<AdminError error={erreur} reset={reset} />);

    const alerte = screen.getByRole('alert');
    expect(alerte).toHaveTextContent(MESSAGE_ERREUR_ROUTE);
    expect(
      screen.queryByText(/relation "collectes" does not exist/),
    ).not.toBeInTheDocument();
    expect(captureException).toHaveBeenCalledWith(erreur);

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('error.tsx des autres groupes : même composant', () => {
    expect(TraiteurError).toBe(AdminError);
  });

  it('loading.tsx : role=status aria-busy', () => {
    render(<AdminLoading />);
    const statut = screen.getByRole('status');
    expect(statut).toHaveAttribute('aria-busy', 'true');
    expect(statut).toHaveTextContent('Chargement…');
  });
});

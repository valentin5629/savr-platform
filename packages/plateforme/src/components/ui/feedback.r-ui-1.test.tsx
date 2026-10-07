/**
 * R-UI-1 — primitives de feedback : Toast monté (useToast sans provider
 * inoffensif), LoadingState, ErrorState, EmptyState inline.
 */
import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';
import { useToast } from '@/components/ui/toast';
import { renderAvecToasts } from '@/test-utils/toasts';
import { LoadingState } from '@/components/ui/loading-state';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';

function Declencheur() {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={() => toast({ title: 'Enregistré.', variant: 'success' })}
    >
      go
    </button>
  );
}

describe('R-UI-1 — feedback', () => {
  it('useToast hors provider : aucun effet, aucune exception', () => {
    render(<Declencheur />);
    fireEvent.click(screen.getByText('go'));
    expect(screen.queryByText('Enregistré.')).toBeNull();
  });

  it(
    'useToast sous ToastProvider : le message de succès s’affiche',
    async () => {
      renderAvecToasts(<Declencheur />);
      fireEvent.click(screen.getByText('go'));
      expect(
        await screen.findByText('Enregistré.', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it('LoadingState inline / bloc : role status, libellé, squelettes', () => {
    const { rerender } = render(<LoadingState />);
    expect(screen.getByRole('status')).toHaveTextContent('Chargement…');
    rerender(
      <LoadingState variant="bloc" lignes={4} label="Chargement des lieux…" />,
    );
    const s = screen.getByRole('status');
    expect(s).toHaveAttribute('aria-busy', 'true');
    expect(s).toHaveTextContent('Chargement des lieux…');
    expect(s.querySelectorAll('.animate-pulse')).toHaveLength(4);
  });

  it('ErrorState : role alert + Réessayer', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Le chargement a échoué." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Le chargement a échoué.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('EmptyState inline : une ligne neutre, sans icône ni action', () => {
    render(<EmptyState size="inline" title="Aucun membre." />);
    const p = screen.getByText('Aucun membre.');
    expect(p.tagName).toBe('P');
    expect(p.className).toContain('text-savr-neutral-500');
  });
});

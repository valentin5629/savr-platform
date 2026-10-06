'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { AlertBar } from '@/components/ui/alert-bar';
import { Button } from '@/components/ui/button';

// ErrorState — état Error unique (§10 §7, R-UI-1 H5) : message dans un
// `AlertBar err` + « Réessayer » optionnel. Avant : 3 listes seulement
// géraient l'erreur, chacune à sa façon. Utilisé par DataGrid (`erreur`),
// les `error.tsx` de route et les blocs qui chargent hors liste.
export interface ErrorStateProps {
  /** Message lisible (jamais le détail technique serveur). */
  message: React.ReactNode;
  onRetry?: () => void;
  /** Libellé du bouton (défaut « Réessayer »). */
  retryLabel?: string;
  className?: string;
  'data-testid'?: string;
}

function ErrorState({
  message,
  onRetry,
  retryLabel = 'Réessayer',
  className,
  'data-testid': testId,
}: ErrorStateProps) {
  return (
    <div className={cn('space-y-4', className)} data-testid={testId}>
      <AlertBar variant="err" role="alert">
        {message}
      </AlertBar>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

export { ErrorState };

'use client';

import * as React from 'react';
import { captureException } from '@savr/shared/src/alerting/sentry.js';
import { LoadingState } from '@/components/ui/loading-state';
import { ErrorState } from '@/components/ui/error-state';

// États de route App Router (§10 §7 « 5 états par écran », R-UI-1 H3/H5).
// Partagés par les `loading.tsx` / `error.tsx` des groupes authentifiés : ils
// s'affichent DANS le layout du groupe (AppShell, dont le <main> porte déjà le
// padding p-6), à la place de la page — d'où le conteneur `space-y-6` des pages.

/** Message unique : jamais `error.message` (détail technique serveur). */
export const MESSAGE_ERREUR_ROUTE =
  'Une erreur est survenue. Réessayez dans un instant.';

export function RouteLoading() {
  return (
    <div className="space-y-6">
      <LoadingState variant="bloc" lignes={5} />
    </div>
  );
}

export interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export function RouteError({ error, reset }: RouteErrorProps) {
  React.useEffect(() => {
    // Remontée Sentry (sink no-op sans DSN : tests, CI). Pas de `console` :
    // proscrit par le lint, et Next journalise déjà l'erreur en dev. Le
    // `digest` relie l'erreur client à la trace serveur quand elle vient d'un RSC.
    captureException(error);
  }, [error]);

  return (
    <div className="space-y-6">
      <ErrorState message={MESSAGE_ERREUR_ROUTE} onRetry={reset} />
    </div>
  );
}

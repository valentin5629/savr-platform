'use client';

import * as React from 'react';
import { captureException } from '@savr/shared/src/alerting/sentry.js';
import { SavrCroixChargement } from '@/components/layout/savr-croix-chargement';
import { ErrorState } from '@/components/ui/error-state';

// États de route App Router (§10 §7 « 5 états par écran », R-UI-1 H3/H5).
// Partagés par les `loading.tsx` / `error.tsx` des groupes authentifiés : ils
// s'affichent DANS le layout du groupe (AppShell, dont le <main> porte déjà le
// padding p-6), à la place de la page — d'où le conteneur `space-y-6` des pages.

/** Message unique : jamais `error.message` (détail technique serveur). */
export const MESSAGE_ERREUR_ROUTE =
  'Une erreur est survenue. Réessayez dans un instant.';

// Chargement de page = croix Savr seule, centrée dans la zone de contenu
// (Val 2026-10-31). Remplace les squelettes à cet endroit seulement, contre
// le §10 §7 « jamais spinner seul » (fiche DS_20261031_chargement-croix-savr) ;
// les chargements à l'intérieur d'une page gardent `LoadingState`.
export function RouteLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-3"
    >
      <SavrCroixChargement />
      <span className="text-sm text-savr-neutral-500">Chargement…</span>
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

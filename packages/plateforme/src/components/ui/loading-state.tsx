'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

// LoadingState — état Loading unique (§10 §7 « Skeleton, jamais spinner
// seul », R-UI-1 H3). Avant : « Chargement… » rendu 27 fois avec 4 recettes
// (6 sans couleur). Deux formes :
//  - `inline` (défaut) : libellé discret « Chargement… » à la place d'un
//    contenu court (bloc de carte, onglet) ;
//  - `bloc` : `lignes` squelettes pleine largeur (liste, tableau, panneau),
//    libellé réservé aux lecteurs d'écran.
// `role="status"` + `aria-live` : annoncé une fois, sans voler le focus.
export interface LoadingStateProps {
  variant?: 'inline' | 'bloc';
  /** Libellé (défaut « Chargement… »). */
  label?: string;
  /** Nombre de lignes squelettes en `bloc` (défaut 3). */
  lignes?: number;
  className?: string;
  'data-testid'?: string;
}

function LoadingState({
  variant = 'inline',
  label = 'Chargement…',
  lignes = 3,
  className,
  'data-testid': testId,
}: LoadingStateProps) {
  if (variant === 'bloc') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={cn('space-y-2', className)}
        data-testid={testId}
      >
        <span className="sr-only">{label}</span>
        {Array.from({ length: lignes }).map((_, i) => (
          <Skeleton key={i} aria-hidden className="h-10 w-full" />
        ))}
      </div>
    );
  }
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn('text-sm text-savr-neutral-500', className)}
      data-testid={testId}
    >
      {label}
    </p>
  );
}

export { LoadingState };

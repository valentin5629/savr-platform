'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  ETAPES_STATUT_COLLECTE,
  RANG_STATUT_COLLECTE,
  statutCollecteDisplay,
  type StatutCollecteAdmin,
} from '@/lib/statut-collecte-labels';

// Vue ADMIN du statut collecte (granularité complète). Les libellés/variants
// proviennent du module partagé statut-collecte-labels (source unique) ; ce
// composant n'ajoute que la timeline (étapes). `statut` = clé d'affichage Admin
// (`statutCollecteAdmin`) : « Créée » et « Programmée » y sont deux clés.
export type StatutCollecte = StatutCollecteAdmin;

// Position sur la timeline (0 = hors timeline : brouillon, annulée, rejetée…) —
// source unique `lib/statut-collecte-labels` (R-UI-2 C1).
const STEP = RANG_STATUT_COLLECTE;

// Conservé (export) pour rétro-compat d'éventuels consommateurs : label+variant
// dérivés du module partagé (vue admin) + step.
const STATUT_CONFIG = Object.fromEntries(
  (Object.keys(STEP) as StatutCollecteAdmin[]).map((s) => {
    const d = statutCollecteDisplay(s, 'admin');
    return [s, { label: d.label, variant: d.variant, step: STEP[s] }];
  }),
) as Record<
  StatutCollecteAdmin,
  {
    label: string;
    variant: React.ComponentProps<typeof Badge>['variant'];
    step: number;
  }
>;

const TIMELINE_STEPS: readonly StatutCollecteAdmin[] = ETAPES_STATUT_COLLECTE;

interface StatusCollecteProps {
  statut: StatutCollecte;
  showTimeline?: boolean;
  className?: string;
}

const StatusCollecte = React.forwardRef<HTMLDivElement, StatusCollecteProps>(
  ({ statut, showTimeline = false, className }, ref) => {
    const { label, variant } = statutCollecteDisplay(statut, 'admin');
    const currentStep = STEP[statut] ?? 0;
    return (
      <div ref={ref} className={cn('inline-flex flex-col gap-2', className)}>
        <Badge variant={variant}>{label}</Badge>
        {showTimeline && (
          <ol
            className="flex items-center gap-1"
            aria-label="Progression de la collecte"
          >
            {TIMELINE_STEPS.map((step) => {
              const isActive = STEP[step] <= currentStep && currentStep > 0;
              return (
                <li key={step} className="flex items-center gap-1">
                  <span
                    className={cn(
                      'h-2 w-6 rounded-savr-full transition-colors',
                      isActive ? 'bg-savr-primary-700' : 'bg-savr-neutral-200',
                    )}
                    aria-label={statutCollecteDisplay(step, 'admin').label}
                  />
                </li>
              );
            })}
          </ol>
        )}
      </div>
    );
  },
);
StatusCollecte.displayName = 'StatusCollecte';

export { StatusCollecte, STATUT_CONFIG };

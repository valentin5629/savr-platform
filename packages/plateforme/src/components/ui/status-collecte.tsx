'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  statutCollecteDisplay,
  type StatutCollecteDb,
} from '@/lib/statut-collecte-labels';

// Vue ADMIN du statut collecte (granularité complète). Les libellés/variants
// proviennent du module partagé statut-collecte-labels (source unique) ; ce
// composant n'ajoute que la timeline (étapes).
export type StatutCollecte = StatutCollecteDb;

// Position sur la timeline (0 = hors timeline : brouillon, annulée, rejetée…).
const STEP: Record<StatutCollecteDb, number> = {
  brouillon: 0,
  programmee: 1,
  validee: 2,
  en_cours: 3,
  realisee: 4,
  realisee_sans_collecte: 4,
  cloturee: 5,
  annulation_demandee: 0,
  annulee: 0,
  rejetee_par_prestataire: 0,
};

// Conservé (export) pour rétro-compat d'éventuels consommateurs : label+variant
// dérivés du module partagé (vue admin) + step.
const STATUT_CONFIG = Object.fromEntries(
  (Object.keys(STEP) as StatutCollecteDb[]).map((s) => {
    const d = statutCollecteDisplay(s, 'admin');
    return [s, { label: d.label, variant: d.variant, step: STEP[s] }];
  }),
) as Record<
  StatutCollecteDb,
  {
    label: string;
    variant: React.ComponentProps<typeof Badge>['variant'];
    step: number;
  }
>;

const TIMELINE_STEPS: StatutCollecteDb[] = [
  'programmee',
  'validee',
  'en_cours',
  'realisee',
  'cloturee',
];

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

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export type StatutCollecte =
  | 'programmee'
  | 'validee'
  | 'en_cours'
  | 'realisee'
  | 'realisee_sans_collecte'
  | 'cloturee'
  | 'rejetee_par_prestataire';

const STATUT_CONFIG: Record<
  StatutCollecte,
  {
    label: string;
    variant: React.ComponentProps<typeof Badge>['variant'];
    step: number;
  }
> = {
  programmee: { label: 'Programmée', variant: 'neutral', step: 1 },
  validee: { label: 'Validée', variant: 'primary', step: 2 },
  en_cours: { label: 'En cours', variant: 'info', step: 3 },
  realisee: { label: 'Réalisée', variant: 'success', step: 4 },
  realisee_sans_collecte: {
    label: 'Sans collecte',
    variant: 'warning',
    step: 4,
  },
  cloturee: { label: 'Clôturée', variant: 'neutral', step: 5 },
  rejetee_par_prestataire: { label: 'Rejetée', variant: 'error', step: 0 },
};

const TIMELINE_STEPS: StatutCollecte[] = [
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
    const config = STATUT_CONFIG[statut];
    return (
      <div ref={ref} className={cn('inline-flex flex-col gap-2', className)}>
        <Badge variant={config.variant}>{config.label}</Badge>
        {showTimeline && (
          <ol
            className="flex items-center gap-1"
            aria-label="Progression de la collecte"
          >
            {TIMELINE_STEPS.map((step) => {
              const stepConfig = STATUT_CONFIG[step];
              const isActive =
                stepConfig.step <= config.step && config.step > 0;
              return (
                <li key={step} className="flex items-center gap-1">
                  <span
                    className={cn(
                      'h-2 w-6 rounded-savr-full transition-colors',
                      isActive ? 'bg-savr-primary-700' : 'bg-savr-neutral-200',
                    )}
                    aria-label={stepConfig.label}
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

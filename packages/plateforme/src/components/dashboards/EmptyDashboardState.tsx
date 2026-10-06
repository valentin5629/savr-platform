'use client';

import { CalendarX2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

interface EmptyDashboardStateProps {
  className?: string;
}

// État vide des dashboards (§11 §8, message exact) — fine enveloppe de
// l'`EmptyState` du DS (R-UI-1 H4 : ex-recette parallèle). L'enveloppe porte le
// `data-testid` (EmptyState ne le relaie pas) ; le message reste une seule
// chaîne (lue d'un bloc par les tests e2e).
export function EmptyDashboardState({ className }: EmptyDashboardStateProps) {
  return (
    <div className={className} data-testid="empty-dashboard-state">
      <EmptyState
        icon={<CalendarX2 />}
        title="Aucune collecte sur la période sélectionnée. Ajustez les filtres ou programmez votre première collecte."
      />
    </div>
  );
}

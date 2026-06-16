'use client';

interface EmptyDashboardStateProps {
  className?: string;
}

export function EmptyDashboardState({ className }: EmptyDashboardStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-16 text-center text-muted-foreground ${className ?? ''}`}
      data-testid="empty-dashboard-state"
    >
      <p className="text-sm">
        Aucune collecte sur la période sélectionnée. Ajustez les filtres ou
        programmez votre première collecte.
      </p>
    </div>
  );
}

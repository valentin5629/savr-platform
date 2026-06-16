'use client';

import { useEffect, useState } from 'react';

export interface DashboardFilters {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

interface DashboardFilterBarProps {
  storageKey: string;
  onChange: (filters: DashboardFilters) => void;
  className?: string;
}

function defaultFilters(): DashboardFilters {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

/**
 * Barre de filtres période — persistance localStorage (sobriété B1, pas de table serveur).
 * Période par défaut : 30 derniers jours (§11 §8).
 */
export function DashboardFilterBar({
  storageKey,
  onChange,
  className,
}: DashboardFilterBarProps) {
  const [filters, setFilters] = useState<DashboardFilters>(defaultFilters);

  // Charger depuis localStorage au mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as DashboardFilters;
        if (parsed.from && parsed.to) {
          setFilters(parsed);
          onChange(parsed);
          return;
        }
      }
    } catch {
      // ignore
    }
    onChange(filters);
  }, [storageKey]);

  function apply(next: DashboardFilters) {
    setFilters(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
    onChange(next);
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-3 ${className ?? ''}`}
      data-testid="dashboard-filter-bar"
    >
      <label className="flex items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">Du</span>
        <input
          type="date"
          value={filters.from}
          max={filters.to}
          onChange={(e) => apply({ ...filters, from: e.target.value })}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">au</span>
        <input
          type="date"
          value={filters.to}
          min={filters.from}
          onChange={(e) => apply({ ...filters, to: e.target.value })}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
    </div>
  );
}

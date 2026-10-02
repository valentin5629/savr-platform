'use client';

/**
 * Page de test uniquement — monte les composants dashboard communs pour les smoke tests Playwright M3.5.
 * Non liée à la navigation. Sous /dev/* (route publique, hors gating /admin/*) :
 * composants purement présentationnels avec props codées en dur, aucune donnée sensible.
 */

import { useState } from 'react';
import {
  EmptyDashboardState,
  TonnageDisplay,
} from '@/components/dashboards/index.js';
import { ToggleTypeCollecte } from '@/components/collecte/toggle-type-collecte';
import type { CollecteType } from '@/components/dashboards/index.js';

export default function TestDashboardComponentsPage() {
  const [tab, setTab] = useState<CollecteType>('zero_dechet');

  return (
    <div className="space-y-8 p-8">
      <h1 className="text-lg font-bold">Test composants dashboard M3.5</h1>

      {/* TonnageDisplay */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">TonnageDisplay</h2>
        <div className="flex gap-4">
          <span data-testid="tonnage-999">
            <TonnageDisplay kg={999} />
          </span>
          <span data-testid="tonnage-1000">
            <TonnageDisplay kg={1000} />
          </span>
          <span data-testid="tonnage-2500">
            <TonnageDisplay kg={2500} />
          </span>
          <span data-testid="tonnage-null">
            <TonnageDisplay kg={null} />
          </span>
        </div>
      </section>

      {/* EmptyDashboardState */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">EmptyDashboardState</h2>
        <EmptyDashboardState />
      </section>

      {/* ToggleTypeCollecte */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">ToggleTypeCollecte</h2>
        <ToggleTypeCollecte value={tab} onChange={setTab} />
        <p className="mt-2 text-xs text-muted-foreground">
          Onglet actif : {tab}
        </p>
      </section>
    </div>
  );
}

'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { VueCollectes } from '@/lib/collectes/vue-temporelle';

/** Libellés des deux vues et nom de leur groupe (lecteurs d'écran). */
export interface LibellesVues {
  aVenir: string;
  passees: string;
  groupe: string;
}

const LIBELLES_COLLECTES: LibellesVues = {
  aVenir: 'Collectes à venir',
  passees: 'Collectes passées',
  groupe: 'Collectes à venir ou passées',
};

/** Page Événements du gestionnaire (décision Val 2026-10-20). */
export const LIBELLES_EVENEMENTS: LibellesVues = {
  aVenir: 'Événements à venir',
  passees: 'Événements passés',
  groupe: 'Événements à venir ou passés',
};

// Les deux vues des pages Collectes (mêmes libellés dans tous les espaces,
// décision Val 2026-10-19) et Événements, cf. lib/collectes/vue-temporelle.
// Tabs : changer de vue, pas filtrer (DS règle 6) ; se range dans
// `FilterBar.tabs`.
export function OngletsVueCollectes({
  value,
  onChange,
  libelles = LIBELLES_COLLECTES,
}: {
  value: VueCollectes;
  onChange: (vue: VueCollectes) => void;
  libelles?: LibellesVues;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as VueCollectes)}>
      <TabsList aria-label={libelles.groupe}>
        <TabsTrigger value="a_venir">{libelles.aVenir}</TabsTrigger>
        <TabsTrigger value="passees">{libelles.passees}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

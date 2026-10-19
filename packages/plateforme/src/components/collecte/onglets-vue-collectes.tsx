'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { VueCollectes } from '@/lib/collectes/vue-temporelle';

// Les deux vues de la page Collectes, mêmes libellés dans tous les espaces
// (décision Val 2026-10-19, cf. lib/collectes/vue-temporelle). Tabs : changer
// de vue, pas filtrer (DS règle 6) ; se range dans `FilterBar.tabs`.
export function OngletsVueCollectes({
  value,
  onChange,
}: {
  value: VueCollectes;
  onChange: (vue: VueCollectes) => void;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as VueCollectes)}>
      <TabsList aria-label="Collectes à venir ou passées">
        <TabsTrigger value="a_venir">Collectes à venir</TabsTrigger>
        <TabsTrigger value="passees">Collectes passées</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

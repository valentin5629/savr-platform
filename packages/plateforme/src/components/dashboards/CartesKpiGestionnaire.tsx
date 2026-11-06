'use client';

import type { CollecteType } from '@/components/collecte/toggle-type-collecte';
import {
  fmtDec,
  fmtInt,
  fmtMasse,
} from '@/components/dashboards/charts/cockpit/fmt';
import { KPI_DOT } from '@/components/dashboards/charts/cockpit/palette';
import { StatCard } from '@/components/ui/stat-card';
import { cn } from '@/lib/utils';
import { variationPct } from '@/lib/dashboards/cockpit-derive';
import type { KpisGestionnaire } from './useKpisGestionnaire.js';

interface CartesKpiGestionnaireProps {
  type: CollecteType;
  kpi: KpisGestionnaire;
  /** KPI de la période précédente équivalente ; absents = cartes sans variation. */
  kpiPrev: KpisGestionnaire | null;
  testId?: string;
}

/**
 * Bloc 1 du dashboard gestionnaire (§06.05) : la rangée des 4 cartes KPI du type
 * choisi. Source unique de leurs libellés, formats, couleurs et variations,
 * pour le dashboard et pour l'onglet Activité de la fiche traiteur.
 * Cartes NON cliquables (décision Val GO-VISUAL 2026-07-10).
 */
export function CartesKpiGestionnaire({
  type,
  kpi,
  kpiPrev,
  testId,
}: CartesKpiGestionnaireProps) {
  const nbCollectes = kpi.nb_collectes ?? 0;
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-4',
        type === 'zero_dechet' ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
      )}
      data-testid={testId}
    >
      {type === 'zero_dechet' ? (
        <>
          <StatCard
            label="Nombre de collectes"
            value={fmtInt(nbCollectes)}
            dotColor={KPI_DOT.navy}
            variationPct={variationPct(nbCollectes, kpiPrev?.nb_collectes ?? 0)}
          />
          <StatCard
            label="Tonnage collecté"
            value={fmtMasse(kpi.tonnage_kg ?? 0).value}
            unit={fmtMasse(kpi.tonnage_kg ?? 0).unit}
            dotColor={KPI_DOT.navy2}
            variationPct={variationPct(
              kpi.tonnage_kg ?? 0,
              kpiPrev?.tonnage_kg ?? 0,
            )}
          />
          <StatCard
            label="Taux de recyclage"
            value={
              kpi.taux_recyclage_pondere != null
                ? fmtDec(kpi.taux_recyclage_pondere, 1)
                : '—'
            }
            unit={kpi.taux_recyclage_pondere != null ? '%' : undefined}
            dotColor={KPI_DOT.green}
            variationPct={variationPct(
              kpi.taux_recyclage_pondere ?? 0,
              kpiPrev?.taux_recyclage_pondere ?? 0,
            )}
          />
          {/* kg/pax : pas de variation (sens « plus bas =
              mieux », §06.05 l.136). */}
          <StatCard
            label="kg/pax moyen"
            value={kpi.kg_par_pax != null ? fmtDec(kpi.kg_par_pax, 2) : '—'}
            unit={kpi.kg_par_pax != null ? 'kg/pax' : undefined}
            dotColor={KPI_DOT.navy3}
          />
        </>
      ) : (
        <>
          <StatCard
            label="Nombre de collectes"
            value={fmtInt(nbCollectes)}
            dotColor={KPI_DOT.navy}
            variationPct={variationPct(nbCollectes, kpiPrev?.nb_collectes ?? 0)}
          />
          <StatCard
            label="Repas donnés"
            value={fmtInt(kpi.nb_repas_donnes ?? 0)}
            dotColor={KPI_DOT.accent}
            variationPct={variationPct(
              kpi.nb_repas_donnes ?? 0,
              kpiPrev?.nb_repas_donnes ?? 0,
            )}
          />
          <StatCard
            label="Repas/pax moyen"
            value={
              kpi.repas_par_pax != null ? fmtDec(kpi.repas_par_pax, 2) : '—'
            }
            dotColor={KPI_DOT.navy3}
          />
        </>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import type { CollecteType } from '@/components/collecte/toggle-type-collecte';
import { previousWindow } from '@/lib/dashboards/cockpit-derive';
import type { DashboardFilters } from './DashboardFilterBar.js';

/**
 * KPI des 4 cartes du dashboard gestionnaire. La route ne sert que les champs du
 * type demandé (ZD ou AG) ; tous sont nuls pour une organisation sans lieu.
 */
export interface KpisGestionnaire {
  nb_collectes: number | null;
  tonnage_kg?: number | null;
  taux_recyclage_pondere?: number | null;
  kg_par_pax?: number | null;
  nb_repas_donnes?: number | null;
  pax_total?: number | null;
  repas_par_pax?: number | null;
}

interface ReponseDashboard {
  kpis?: KpisGestionnaire | null;
  kg_par_pax_par_flux?: Record<string, number>;
  pack?: unknown;
}

// Repli stable : un objet neuf à chaque rendu relancerait tout effet qui en dépend.
const AUCUN_FLUX: Record<string, number> = {};

interface KpisGestionnaireResult {
  kpi: KpisGestionnaire | null;
  /** KPI de la période précédente équivalente (variation des cartes, §06.05). */
  kpiPrev: KpisGestionnaire | null;
  /** kg/pax par flux de la période — même réponse que les KPI. */
  kgParPaxParFlux: Record<string, number>;
  /** Pack AG actif servi par la même réponse, tel que reçu. */
  pack: unknown;
  loading: boolean;
  /** Le dernier chargement a échoué (réseau ou réponse en erreur) : les KPI
   *  sont alors nuls, ce champ permet de ne pas le lire comme « aucune collecte ». */
  erreur: boolean;
}

/**
 * Chargement des KPI du dashboard gestionnaire (`/api/v1/gestionnaire/dashboard`)
 * pour la période et pour la période précédente équivalente, filtres parc
 * transmis comme `useEvolutionBlocs`. Partagé par le dashboard et par l'onglet
 * Activité de la fiche traiteur : les chiffres de l'un sont ceux de l'autre.
 */
export function useKpisGestionnaire(
  filters: DashboardFilters | null,
  type: CollecteType,
): KpisGestionnaireResult {
  const [courant, setCourant] = useState<ReponseDashboard | null>(null);
  const [kpiPrev, setKpiPrev] = useState<KpisGestionnaire | null>(null);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    if (!filters) return;
    let cancelled = false;
    setLoading(true);
    setErreur(false);
    const lire = (from: string, to: string): Promise<ReponseDashboard> => {
      const qs = new URLSearchParams({ from, to, type });
      (filters.lieu_ids ?? []).forEach((id) => qs.append('lieu_ids[]', id));
      (filters.traiteur_ids ?? []).forEach((id) =>
        qs.append('traiteur_ids[]', id),
      );
      (filters.type_evenement_ids ?? []).forEach((id) =>
        qs.append('type_evenement_ids[]', id),
      );
      (filters.taille_evenement_codes ?? []).forEach((c) =>
        qs.append('taille_evenements[]', c),
      );
      return fetch(`/api/v1/gestionnaire/dashboard?${qs}`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<{ data?: ReponseDashboard }>;
        })
        .then((j) => j.data ?? {});
    };
    const precedente = previousWindow(filters.from, filters.to);
    Promise.all([
      lire(filters.from, filters.to),
      // Période précédente non bloquante : son échec ne masque que les variations.
      precedente
        ? lire(precedente.from, precedente.to).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([data, avant]) => {
        if (cancelled) return;
        setCourant(data);
        setKpiPrev(avant?.kpis ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setErreur(true);
        setCourant(null);
        setKpiPrev(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters, type]);

  return {
    kpi: courant?.kpis ?? null,
    kpiPrev,
    kgParPaxParFlux: courant?.kg_par_pax_par_flux ?? AUCUN_FLUX,
    pack: courant?.pack ?? null,
    loading,
    erreur,
  };
}

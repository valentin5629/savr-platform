'use client';

import { useEffect, useState } from 'react';
import type { CollecteType } from '@/components/collecte/toggle-type-collecte';
import type { DashboardFilters } from './DashboardFilterBar.js';

export type EvolutionType = CollecteType;

/** Point de série ZD — un par bucket (jour/semaine/mois) : kg par flux + taux. */
export interface FluxSeriePoint {
  periode: string;
  biodechet: number;
  emballage: number;
  carton: number;
  verre: number;
  dechet_residuel: number;
  tonnage_total: number;
  taux_recyclage: number | null;
  /** Collectes du bucket (sparkline carte KPI). Absent des payloads anciens. */
  nb_collectes?: number;
  /** Pax distincts par événement du bucket (sparkline kg/pax). */
  pax?: number; /** CO₂ évité du bucket (0 si le loader ne le sélectionne pas). */
  co2_evite_kg?: number;
}

/** Point de série AG — repas donnés + pax + ratio par bucket. */
export interface RepasSeriePoint {
  periode: string;
  repas_donnes: number;
  pax: number;
  ratio: number | null;
  /** Collectes du bucket (sparkline carte KPI). */
  nb_collectes?: number; /** CO₂ évité du bucket (0 si le loader ne le sélectionne pas). */
  co2_evite_kg?: number;
}

interface EvolutionResult {
  granularite: 'jour' | 'semaine' | 'mois';
  zdSeries: FluxSeriePoint[];
  agSeries: RepasSeriePoint[];
  loading: boolean;
  /** Le dernier chargement a échoué (réseau ou réponse en erreur) : les séries
   *  sont alors vides, ce champ permet de ne pas le lire comme « aucune donnée ». */
  erreur: boolean;
}

/**
 * Hook partagé Bloc 2 / Bloc 4 — fetch /api/v1/dashboards/evolution pour l'onglet
 * actif (§11 « composants partagés »). Réutilisé par les dashboards traiteur /
 * agence / gestionnaire ; le périmètre est décidé côté serveur selon le rôle.
 * Les filtres parc (lieux/traiteurs/type/taille) sont transmis s'ils existent —
 * les rôles qui n'en ont pas (traiteur/agence, période seule) envoient juste from/to.
 */
export function useEvolutionBlocs(
  filters: DashboardFilters | null,
  tab: CollecteType,
): EvolutionResult {
  const [zdSeries, setZdSeries] = useState<FluxSeriePoint[]>([]);
  const [agSeries, setAgSeries] = useState<RepasSeriePoint[]>([]);
  const [granularite, setGranularite] = useState<'jour' | 'semaine' | 'mois'>(
    'mois',
  );
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    if (!filters) return;
    let cancelled = false;
    setLoading(true);
    setErreur(false);
    const qs = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      type: tab,
    });
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

    fetch(`/api/v1/dashboards/evolution?${qs}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(
        (j: {
          data?: {
            granularite?: 'jour' | 'semaine' | 'mois';
            series?: unknown[];
          };
        }) => {
          if (cancelled) return;
          const series = j.data?.series ?? [];
          if (j.data?.granularite) setGranularite(j.data.granularite);
          if (tab === 'zero_dechet') {
            setZdSeries(series as FluxSeriePoint[]);
          } else {
            setAgSeries(series as RepasSeriePoint[]);
          }
        },
      )
      .catch(() => {
        if (!cancelled) {
          setErreur(true);
          if (tab === 'zero_dechet') setZdSeries([]);
          else setAgSeries([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters, tab]);

  return { granularite, zdSeries, agSeries, loading, erreur };
}

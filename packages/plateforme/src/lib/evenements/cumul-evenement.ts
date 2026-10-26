// Cumul d'un événement pour son radar et ses rapports cumulés (décision Val
// 2026-10-26) : ce que l'écran et les PDF de la fiche événement lisent de la
// même façon.
//
//  - `lireEvenementVisible` : l'événement et ses collectes, SOUS L'IDENTITÉ du
//    demandeur (RLS evenements puis collectes), brouillons écartés comme dans
//    la liste et la fiche. C'est la seule preuve d'accès des routes cumulées.
//  - `kgParConviveEvenement` : point « Vous » du radar = pesées cumulées des
//    collectes ZD réalisées, divisées par les convives de l'événement (comme le
//    KPI « Pesée par pax » du bilan consolidé).
//  - `chargerBenchmarkEvenement` : ce point et le repère parc des filtres
//    réglés, lu par le même loader que la fiche collecte (même k-anonymat,
//    même garde de périmètre).

import type {
  UserAuthContext,
  createSupabaseServerClient,
} from '@/lib/api-auth.js';
import {
  chargerParcBenchmark,
  type BenchmarkFiche,
  type FiltresBenchmarkFiche,
  type FluxBenchmarkFiche,
} from '@/lib/collectes/benchmark-fiche.js';
import {
  collecteRealisee,
  un,
  type CollecteAConsolider,
} from '@/lib/evenements-gestionnaire.js';

type ClientSousRls = ReturnType<typeof createSupabaseServerClient>;

export type CollecteVisible = CollecteAConsolider & { id: string };

export interface EvenementVisible {
  id: string;
  pax: number | null;
  collectes: CollecteVisible[];
}

export type LectureEvenement =
  | { etat: 'ok'; evenement: EvenementVisible }
  | { etat: 'introuvable' }
  | { etat: 'erreur'; erreur: unknown };

/**
 * L'événement tel que le demandeur le voit. Introuvable = hors périmètre,
 * brouillon, ou inexistant, sans les distinguer (comme la fiche).
 */
export async function lireEvenementVisible(
  supabase: ClientSousRls,
  id: string,
): Promise<LectureEvenement> {
  const { data, error } = await supabase
    .from('evenements')
    .select(
      `id, pax,
       collectes(id, type, statut, date_collecte, taux_recyclage, co2_evite_kg,
         collecte_flux(poids_reel_kg, flux_dechets!flux_id(code))),
       hors_brouillon:collectes(id)`,
    )
    .eq('id', id)
    .not('date_evenement', 'is', null)
    .neq('hors_brouillon.statut', 'brouillon')
    .or('hors_brouillon.not.is.null,collectes.is.null')
    .maybeSingle();
  if (error) return { etat: 'erreur', erreur: error };
  if (!data) return { etat: 'introuvable' };
  const evt = data as unknown as {
    id: string;
    pax: number | null;
    collectes: CollecteVisible[] | null;
  };
  return {
    etat: 'ok',
    evenement: { id: evt.id, pax: evt.pax, collectes: evt.collectes ?? [] },
  };
}

/**
 * kg par convive de l'événement, par code de flux pesé sur une collecte ZD
 * réalisée. Vide sans convives (rien à comparer).
 */
export function kgParConviveEvenement(
  collectes: readonly CollecteAConsolider[],
  pax: number | null,
): Record<string, number> {
  if (!pax || pax <= 0) return {};
  const kg: Record<string, number> = {};
  for (const c of collectes) {
    if (c.type !== 'zero_dechet' || !collecteRealisee(c)) continue;
    for (const f of c.collecte_flux ?? []) {
      const code = un(f.flux_dechets)?.code;
      if (!code || f.poids_reel_kg == null) continue;
      kg[code] = (kg[code] ?? 0) + Number(f.poids_reel_kg);
    }
  }
  return Object.fromEntries(
    Object.entries(kg).map(([code, total]) => [code, total / pax]),
  );
}

/**
 * Radar de l'événement pour un jeu de filtres. `sans_radar` : aucune collecte
 * ZD réalisée ou convives inconnus — l'écran masque le bloc, le PDF refuse le
 * radar demandé.
 */
export async function chargerBenchmarkEvenement(
  supabase: ClientSousRls,
  ctx: UserAuthContext,
  evenement: EvenementVisible,
  filtres: FiltresBenchmarkFiche,
): Promise<BenchmarkFiche> {
  const ratios = kgParConviveEvenement(evenement.collectes, evenement.pax);
  if (Object.keys(ratios).length === 0) return { etat: 'sans_radar' };
  const parc = await chargerParcBenchmark(supabase, ctx, filtres);
  if (parc.etat !== 'ok') return parc;
  const flux: FluxBenchmarkFiche = {};
  for (const [code, ratio] of Object.entries(ratios)) {
    flux[code] = {
      ratio_user: ratio,
      benchmark_kg_pax: parc.parc[code] ?? null,
    };
  }
  return { etat: 'ok', flux };
}

// Bloc benchmark du rapport de recyclage §12 §1.2 (BL-P1-RPT-01) — résolution
// partagée par le batch J+1 (défaut = segment de la collecte) et la régénération
// (filtres choisis par le demandeur). Appelle la RPC service-role
// plateforme.f_rapport_benchmark_zd (5 jauges kg/pax + point rouge parc, k-anonymat ≥5)
// et produit : les jauges du payload PDF, la légende des filtres appliqués, et le
// snapshot `rapports_rse.filtres_benchmark` (reproductibilité PDF, §12 §1.2 l.69).

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

/** Filtres benchmark surchargeables (NULL/absent = segment propre de la collecte). */
export interface BenchmarkFilters {
  periode_debut?: string | null;
  periode_fin?: string | null;
  lieu_ids?: string[] | null;
  type_evenement_ids?: string[] | null;
  taille_evenement_codes?: string[] | null;
}

export interface BenchmarkFluxGauge {
  flux_nom: string;
  collecte_kg_pax: number | null;
  benchmark_kg_pax: number | null;
  nb_collectes_segment: number;
}

/** Snapshot persisté (`rapports_rse.filtres_benchmark`) + rendu du bloc benchmark. */
export interface RapportBenchmark {
  benchmark_flux: BenchmarkFluxGauge[];
  benchmark_legende: string;
  filtres_benchmark: {
    periode_debut: string | null;
    periode_fin: string | null;
    lieu_ids: string[] | null;
    type_evenement_ids: string[] | null;
    taille_evenement_codes: string[] | null;
  };
}

interface RapportBenchmarkRow {
  flux_id: string;
  flux_code: string;
  flux_nom: string;
  taille_evenement: string;
  collecte_kg_pax: number | null;
  benchmark_kg_pax: number | null;
  nb_collectes_segment: number;
}

/**
 * Résout le bloc benchmark d'une collecte ZD. `filters` absent/vide → segment propre
 * de la collecte (type d'événement + taille), utilisé par le batch auto. À la
 * régénération, le demandeur peut surcharger période/lieux/type/taille.
 */
export async function resolveRapportBenchmark(
  supabase: SupabaseClient,
  collecteId: string,
  filters?: BenchmarkFilters,
): Promise<RapportBenchmark> {
  const { data: benchRaw } = await supabase.rpc('f_rapport_benchmark_zd', {
    p_collecte_id: collecteId,
    p_periode_debut: filters?.periode_debut ?? null,
    p_periode_fin: filters?.periode_fin ?? null,
    p_lieu_ids: filters?.lieu_ids ?? null,
    p_type_evenement_ids: filters?.type_evenement_ids ?? null,
    p_taille_evenement_codes: filters?.taille_evenement_codes ?? null,
  });
  const rows = (benchRaw ?? []) as RapportBenchmarkRow[];

  const benchmark_flux: BenchmarkFluxGauge[] = rows.map((b) => ({
    flux_nom: b.flux_nom,
    collecte_kg_pax:
      b.collecte_kg_pax != null ? Number(b.collecte_kg_pax) : null,
    benchmark_kg_pax:
      b.benchmark_kg_pax != null ? Number(b.benchmark_kg_pax) : null,
    nb_collectes_segment: b.nb_collectes_segment ?? 0,
  }));

  // Bracket effectif : surcharge du demandeur, sinon celui résolu par la RPC.
  const bracket =
    filters?.taille_evenement_codes?.[0] ?? rows[0]?.taille_evenement ?? null;

  // Type d'événement effectif : surcharge, sinon celui de la collecte (pour légende +
  // snapshot). Résolu ici pour rester auto-suffisant (batch comme régénération).
  let typeIds = filters?.type_evenement_ids ?? null;
  let typeLibelle: string | null = null;
  if (!typeIds || typeIds.length === 0) {
    const { data: evt } = await supabase
      .from('collectes')
      .select(
        'evenement:evenement_id ( type_evenement_id, type_evenement:types_evenements ( libelle ) )',
      )
      .eq('id', collecteId)
      .maybeSingle();
    const e = (
      evt as {
        evenement?: {
          type_evenement_id?: string | null;
          type_evenement?: { libelle?: string | null } | null;
        } | null;
      } | null
    )?.evenement;
    typeIds = e?.type_evenement_id ? [e.type_evenement_id] : null;
    typeLibelle = e?.type_evenement?.libelle ?? null;
  }

  const filtres_benchmark = {
    periode_debut: filters?.periode_debut ?? null,
    periode_fin: filters?.periode_fin ?? null,
    lieu_ids: filters?.lieu_ids ?? null,
    type_evenement_ids: typeIds,
    taille_evenement_codes: bracket ? [bracket] : null,
  };

  const periodeTxt =
    filters?.periode_debut || filters?.periode_fin
      ? `${filters?.periode_debut ?? '…'} → ${filters?.periode_fin ?? '…'}`
      : 'toutes';
  const lieuxTxt = filters?.lieu_ids?.length
    ? `${filters.lieu_ids.length} sélectionné(s)`
    : 'tous';
  const typeTxt = filters?.type_evenement_ids?.length
    ? `${filters.type_evenement_ids.length} sélectionné(s)`
    : (typeLibelle ?? '—');
  const tailleTxt = bracket ?? '—';
  const benchmark_legende = `période : ${periodeTxt} · lieux : ${lieuxTxt} · type d'événement : ${typeTxt} · taille : ${tailleTxt}`;

  return { benchmark_flux, benchmark_legende, filtres_benchmark };
}

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

export type ModeValidation = 'manuel_top1' | 'manuel_override' | 'auto_accept';

export interface ValiderAttributionParams {
  collecteId: string;
  associationId: string;
  transporteurId: string;
  brancheAttribution: string;
  modeValidation: ModeValidation;
  validePar: string;
  motifOverride?: string;
  motifOverrideLibre?: string;
}

export interface ValiderAttributionResult {
  ok: boolean;
  attribution_id: string;
  outbox_id: string;
  pack_id: string | null;
}

export async function validerAttributionAg(
  params: ValiderAttributionParams,
): Promise<ValiderAttributionResult> {
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase.rpc('rpc_valider_attribution_ag', {
    p_collecte_id: params.collecteId,
    p_association_id: params.associationId,
    p_transporteur_id: params.transporteurId,
    p_branche_attribution: params.brancheAttribution,
    p_mode_validation: params.modeValidation,
    p_valide_par: params.validePar,
    p_motif_override: params.motifOverride ?? null,
    p_motif_override_libre: params.motifOverrideLibre ?? null,
  });

  if (error) {
    if (error.code === 'P0044')
      throw Object.assign(new Error('Attribution déjà existante'), {
        code: 'DUPLICATE',
      });
    if (error.code === 'P0043')
      throw Object.assign(new Error('Statut collecte invalide'), {
        code: 'INVALID_STATUS',
      });
    if (error.code === 'P0041')
      throw Object.assign(new Error('Motif override obligatoire'), {
        code: 'MISSING_MOTIF',
      });
    throw new Error(`rpc_valider_attribution_ag: ${error.message}`);
  }

  return data as ValiderAttributionResult;
}

/**
 * BL-P1-ALGO-03 — Journalise `attribution_manuelle_aucune_reco` (CDC §06.09 §2
 * « Cas aucune association éligible »). Appelé après une validation où l'algo
 * n'avait proposé AUCUNE association (recherche libre). Best-effort : un échec
 * d'audit ne doit pas faire échouer la validation déjà committée.
 */
export async function logAttributionAucuneReco(
  collecteId: string,
  attributionId: string,
  userId: string,
): Promise<void> {
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase.rpc('rpc_log_attribution_aucune_reco', {
    p_collecte_id: collecteId,
    p_attribution_id: attributionId,
    p_user_id: userId,
  });
  if (error) {
    console.error(
      '[attribution] log attribution_manuelle_aucune_reco KO',
      error.message,
    );
  }
}

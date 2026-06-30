import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

/**
 * BL-P1-ALGO-06 — Résultat d'évaluation auto-accept (CDC §06.09 §6).
 * auto_accepted=true : l'attribution a été validée automatiquement
 * (mode_validation='auto_accept', valide_par=NULL). Sinon `reason` indique
 * pourquoi on retombe en validation manuelle.
 */
export interface AutoAcceptResult {
  auto_accepted: boolean;
  reason: string;
  config_id?: string;
  attribution_id?: string;
}

/**
 * Évalue la configuration auto-accept pour une collecte AG et valide
 * automatiquement si une règle active correspond (cf. rpc_evaluer_auto_accept_ag).
 * Branche SINON : renvoie auto_accepted=false sans rien écrire.
 */
export async function evaluerAutoAcceptAg(
  collecteId: string,
): Promise<AutoAcceptResult> {
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase.rpc('rpc_evaluer_auto_accept_ag', {
    p_collecte_id: collecteId,
  });

  if (error) throw new Error(`rpc_evaluer_auto_accept_ag: ${error.message}`);

  return data as AutoAcceptResult;
}

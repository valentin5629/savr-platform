import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

export interface AssociationSuggestion {
  id: string;
  nom: string;
  distance_km: number;
  capacite_max_beneficiaires: number;
  contact_email: string;
  horaires_ok: boolean;
}

export interface TransporteurSuggestion {
  id: string;
  nom: string;
  type_tms: string;
}

export interface AlgoAttributionResult {
  associations: AssociationSuggestion[];
  assoc_count: number;
  transporteur: TransporteurSuggestion | null;
  branche: string;
  is_idf: boolean;
  no_asso: boolean;
  no_prestataire: boolean;
  delai_minutes: number;
  nb_pax: number;
}

export async function calculerAlgoAttributionAg(
  collecteId: string,
): Promise<AlgoAttributionResult> {
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase.rpc(
    'fn_calculer_algo_attribution_ag',
    {
      p_collecte_id: collecteId,
    },
  );

  if (error)
    throw new Error(`fn_calculer_algo_attribution_ag: ${error.message}`);

  return data as AlgoAttributionResult;
}

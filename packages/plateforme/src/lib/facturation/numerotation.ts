// Numérotation gapless des factures via f_attribuer_numero_facture (SELECT FOR UPDATE implicite).
// Appelée dans la transaction de validation Admin, AVANT le push Pennylane.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

export type SerieFacturation = 'FZD' | 'FAG' | 'FPK' | 'AV';

export async function attribuerNumeroFacture(
  supabase: SupabaseClient,
  serie: SerieFacturation,
  annee?: number,
): Promise<string> {
  const an = annee ?? new Date().getFullYear();
  const { data, error } = await supabase
    .rpc('f_attribuer_numero_facture', {
      p_serie: serie,
      p_annee: an,
    })
    .single();

  if (error) throw new Error(`Numérotation gapless échouée : ${error.message}`);
  return data as string;
}

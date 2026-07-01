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

  const numero = data as string;

  // §07/06 facture_numero_attribue — trace l'attribution gapless (déclencheur =
  // « Attribution numéro gapless », table sequences_facturation). Événement de
  // niveau séquence sans utilisateur (system) : user_id null. Best-effort — un
  // échec d'audit ne doit jamais casser la numérotation gapless (critique).
  try {
    await supabase.from('audit_log').insert({
      action: 'facture_numero_attribue',
      table_name: 'sequences_facturation',
      user_id: null,
      new_values: { serie, annee: an, numero },
    });
  } catch {
    /* best-effort : audit non bloquant */
  }

  return numero;
}

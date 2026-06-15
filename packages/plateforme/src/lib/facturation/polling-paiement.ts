// Polling paiement J+1 3h — vérifie le statut de paiement de toutes les factures 'emise'.
// Transition emise → payee si Pennylane retourne status='paid'.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import { getInvoice } from '../pennylane/client.js';

export interface PollingPaiementResult {
  checked: number;
  payee: number;
  errors: string[];
}

interface FactureEmise {
  id: string;
  pennylane_id: string;
}

export async function runPollingPaiement(
  supabase: SupabaseClient,
): Promise<PollingPaiementResult> {
  const result: PollingPaiementResult = { checked: 0, payee: 0, errors: [] };

  // Toutes les factures 'emise' avec un pennylane_id (Option B sans borne temporelle)
  const { data: factures, error: selErr } = await supabase
    .from('factures')
    .select('id, pennylane_id')
    .eq('statut', 'emise')
    .not('pennylane_id', 'is', null);

  if (selErr) {
    result.errors.push(`SELECT factures emises : ${selErr.message}`);
    return result;
  }
  if (!factures?.length) return result;

  for (const facture of factures as unknown as FactureEmise[]) {
    result.checked++;
    try {
      const r = await getInvoice(facture.pennylane_id);
      if (!r.ok) {
        result.errors.push(`facture ${facture.id}: ${r.message}`);
        continue;
      }

      if (r.invoice.status === 'paid') {
        await supabase
          .from('factures')
          .update({
            statut: 'payee',
            date_paiement: r.invoice.paid_at
              ? r.invoice.paid_at.split('T')[0]
              : new Date().toISOString().split('T')[0],
            updated_at: new Date().toISOString(),
          })
          .eq('id', facture.id)
          .eq('statut', 'emise'); // garde contre race condition

        result.payee++;
      }
    } catch (err) {
      result.errors.push(`facture ${facture.id}: ${String(err)}`);
    }
  }

  return result;
}

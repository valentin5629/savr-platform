// Cron Vercel — polling paiement Pennylane J+1 3h (M1.7).
// Déclenché quotidiennement à 3h00 (vercel.json).
// Vérifie statut des factures 'emise' → transition payee si paid.

import { runPollingPaiement } from '../../../../lib/facturation/polling-paiement.js';

import { withCronObservability } from '@/lib/cron-observabilite.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// §07/02 pennylane_polling = criticité moyenne → §07/03 « Job cron secondaire
// échoué » = canal info sur crash du run.
export const POST = withCronObservability(
  'pennylane_polling',
  async ({ supabase }) => {
    return await runPollingPaiement(supabase);
  },
  { canalOnFailure: 'info' },
);

// Cron Vercel — retry automatique des factures en_attente_pennylane (M1.7).
// Déclenché toutes les 30 min (vercel.json). Paliers : 5 min / 1h / 24h.

import { runPennylaneRetryWorker } from '../../../../lib/facturation/validation-admin.js';

import { withCronObservability } from '@/lib/cron-observabilite.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Pas d'alerte Slack sur le crash du run : l'échec FINAL par facture (retries
// Pennylane épuisés) émet DÉJÀ sendAlert(eleve) dans runPennylaneRetryWorker
// (anti-doublon §13).
export const POST = withCronObservability(
  'pennylane_retry',
  async ({ supabase }) => {
    return await runPennylaneRetryWorker(supabase);
  },
);

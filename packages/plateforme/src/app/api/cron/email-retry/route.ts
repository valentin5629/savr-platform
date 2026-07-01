// Cron Vercel — retry automatique des emails Resend en échec (R10b · BL-P1-API-05).
// Déclenché toutes les 5 min (vercel.json). Paliers : 5 min / 1h / 24h (tentative 2-4),
// dérivés de emails_envoyes.created_at. Échec final → statut='failed' + integrations_logs.

import { runEmailRetryWorker } from '@savr/shared/src/email/index.js';

import { withCronObservability } from '@/lib/cron-observabilite.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Non catalogué §07/02 → pas d'alerte Slack sur simple crash (job.cron.failed loggé).
export const POST = withCronObservability(
  'email_retry',
  async ({ supabase }) => {
    return await runEmailRetryWorker(supabase);
  },
);

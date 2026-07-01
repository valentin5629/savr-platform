import { processAttributionValidee } from '@/lib/attribution-ag/job.js';
import type { AttributionValideePayload } from '@/lib/attribution-ag/job.js';
import { withCronObservability } from '@/lib/cron-observabilite.js';

// POST /api/cron/process-attributions-ag
// Consomme les outbox_events attribution.validee en attente.
// Appelé par Vercel Cron (ou pg_cron en dev). Non catalogué §07/02 → pas de Slack.
export const POST = withCronObservability(
  'process_attributions_ag',
  async ({ supabase }) => {
    const processed: string[] = [];
    const errors: { id: string; error: string }[] = [];

    // Claim jusqu'à 10 events d'un coup (pattern lease/claim — §04 outbox)
    const claimedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { data: events, error: claimErr } = await supabase
      .from('outbox_events')
      .update({ status: 'processing', claimed_until: claimedUntil })
      .eq('status', 'pending')
      .eq('event_type', 'attribution.validee')
      .eq('consumer', 'attribution_job')
      .lte('attempts', 3)
      .select('id, payload, attempts')
      .limit(10);

    if (claimErr) throw claimErr;

    for (const ev of events ?? []) {
      try {
        await processAttributionValidee(
          ev.payload as AttributionValideePayload,
        );

        await supabase
          .from('outbox_events')
          .update({ status: 'done', processed_at: new Date().toISOString() })
          .eq('id', ev.id);

        processed.push(ev.id as string);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erreur inconnue';
        const newAttempts = ((ev.attempts as number) ?? 0) + 1;

        await supabase
          .from('outbox_events')
          .update({
            status: newAttempts >= 4 ? 'dlq' : 'pending',
            attempts: newAttempts,
            last_error: msg,
            claimed_until: null,
          })
          .eq('id', ev.id);

        errors.push({ id: ev.id as string, error: msg });
      }
    }

    return {
      processed,
      errors,
      total: (events ?? []).length,
      nb_traite: processed.length,
    };
  },
);

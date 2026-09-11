import { getNextRetryAt } from '@savr/adapters/src/outbox-worker.js';

import { processAttributionValidee } from '@/lib/attribution-ag/job.js';
import type { AttributionValideePayload } from '@/lib/attribution-ag/job.js';
import { withCronObservability } from '@/lib/cron-observabilite.js';

// Cron Vercel (GET, toutes les 5 min) — consomme les events outbox de la famille
// `attribution_job` (`attribution.validee` → emails association + transporteur).
//
// Famille isolée du worker logistique (migration 20260911150000) : claim dédié
// `fn_claim_outbox_attribution_batch`, head-of-line calculé dans la famille seule
// → un email en échec ne bloque jamais le dispatch de la collecte. Même pattern
// lease/claim que l'outbox logistique ; résultat via `fn_result_outbox` et même
// politique de retry (`getNextRetryAt` : 5 min / 1 h / 24 h puis `dead`).
// Non catalogué §07/02 → pas de canal Slack.
export const POST = withCronObservability(
  'process_attributions_ag',
  async ({ supabase }) => {
    const processed: string[] = [];
    const errors: { id: string; error: string }[] = [];

    const { data: events, error: claimErr } = await supabase.rpc(
      'fn_claim_outbox_attribution_batch',
      { p_limit: 10 },
    );
    // PostgrestError n'est pas une instance d'Error : on la convertit, sinon le
    // log job.cron.failed ne porte que « [object Object] ».
    if (claimErr) {
      throw Object.assign(new Error(claimErr.message), { code: claimErr.code });
    }

    const claimed = (events ?? []) as Array<{
      id: string;
      payload: AttributionValideePayload;
      attempts: number;
    }>;

    for (const ev of claimed) {
      try {
        await processAttributionValidee(ev.payload);
        await supabase.rpc('fn_result_outbox', {
          p_id: ev.id,
          p_statut: 'done',
        });
        processed.push(ev.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Sans palier restant → `dead` (last_error conservé, déblocable par les RPC
        // DLQ admin fn_admin_requeue/skip/resolve_outbox).
        const nextRetry = getNextRetryAt(ev.attempts);
        await supabase.rpc(
          'fn_result_outbox',
          nextRetry
            ? {
                p_id: ev.id,
                p_statut: 'failed',
                p_last_error: msg,
                p_next_retry_at: nextRetry.toISOString(),
              }
            : { p_id: ev.id, p_statut: 'dead', p_last_error: msg },
        );
        errors.push({ id: ev.id, error: msg });
      }
    }

    return {
      processed,
      errors,
      total: claimed.length,
      nb_traite: processed.length,
    };
  },
);

// Vercel Cron invoque en GET (avec `Authorization: Bearer $CRON_SECRET`) ; POST reste
// accepté pour les déclenchements manuels. Même handler, même garde fail-closed.
export const GET = POST;

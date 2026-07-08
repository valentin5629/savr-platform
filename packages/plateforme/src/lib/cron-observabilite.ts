// Observabilité des crons (R15 · BL-P1-OBS-02).
// =============================================================================
// Wrapper commun aux crons Vercel : garde CRON_SECRET harmonisée + émission des
// events techniques §07/02 (job.cron.started / .completed / .failed via le logger
// §07/01) + alerte Slack §07/03 sur échec des jobs CRITIQUES uniquement.
//
// Canal §07/03 (anti-fatigue) :
//   - eleve : « Job cron critique échoué » — mts1_polling, attestations_batch,
//             bordereaux_rapports_batch (criticité élevée §07/02 §2).
//   - info  : « Job cron secondaire échoué » — pennylane_polling (secondaire §2).
//   - (aucun) : les workers R10b/R13 hors liste §07/02 ne poussent pas de Slack
//               sur un simple crash (les alertes actionnables — DLQ outbox,
//               echec_final Pennylane, PDF mort — vivent DÉJÀ au niveau event,
//               anti-doublon §13 : ne PAS les redoubler ici).
// =============================================================================
import { NextResponse } from 'next/server';

import {
  logger,
  runWithTrace,
  getTraceId,
  extractOrCreateTraceId,
} from '@savr/shared/src/logger/index.js';
import { captureException } from '@savr/shared/src/alerting/sentry.js';
import { sendAlert, type SlackCanal } from '@savr/shared/src/alerting/slack.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

interface CronOptions {
  /** Canal Slack sur échec (§07/03). Absent = pas de push (jobs non critiques). */
  canalOnFailure?: SlackCanal;
}

/**
 * Garde d'authentification cron unifiée : `Authorization: Bearer <CRON_SECRET>`.
 * Harmonise les deux routes divergentes (process-attributions-ag sans null-check,
 * refresh-benchmark en `.replace`). Retourne une 401 si KO, `null` si OK.
 */
export function assertCronAuth(req: Request): NextResponse | null {
  const auth = req.headers.get('authorization');
  const cronSecret = process.env['CRON_SECRET'];
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

/**
 * Émet `job.cron.started` (§07/02 l.18 : payload obligatoire `job_name, trace_id`)
 * et renvoie l'horodatage de départ (ms). Le `trace_id` provient du contexte de
 * trace du run (posé par `withCronObservability`) via ALS ; `null` hors run tracé.
 */
export function emitCronStarted(jobName: string): number {
  logger.info(
    'job.cron.started',
    { job_name: jobName, trace_id: getTraceId() },
    { service: 'cron' },
  );
  return Date.now();
}

/** Émet `job.cron.completed` (§07/02) — succès (éventuellement partiel : errors[]). */
export function emitCronCompleted(
  jobName: string,
  startedAt: number,
  extra: Record<string, unknown> = {},
): void {
  logger.info(
    'job.cron.completed',
    { job_name: jobName, duree_ms: Date.now() - startedAt, ...extra },
    { service: 'cron' },
  );
}

/**
 * Émet `job.cron.failed` (§07/02) + Sentry + alerte Slack §07/03 si `canal` fourni.
 * Ne relance jamais : l'appelant décide du code HTTP.
 */
export async function emitCronFailed(
  jobName: string,
  err: unknown,
  opts: { etape?: string; canal?: SlackCanal } = {},
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const error_code = (err as { code?: string } | null)?.code ?? 'UNKNOWN';
  logger.error(
    'job.cron.failed',
    { job_name: jobName, error_code, etape: opts.etape ?? null, message },
    { service: 'cron' },
  );
  captureException(err instanceof Error ? err : new Error(message));
  if (opts.canal) {
    await sendAlert({
      canal: opts.canal,
      titre:
        opts.canal === 'eleve'
          ? 'Job cron critique échoué'
          : 'Job cron secondaire échoué',
      message: `Le job ${jobName} a échoué : ${message}`,
      metadata: { job_name: jobName, error_code, etape: opts.etape ?? '' },
    });
  }
}

/**
 * Enveloppe un handler de cron : garde CRON_SECRET → client service_role →
 * started → handler → completed | failed(+alerte). Le handler renvoie l'objet de
 * résultat (avec `nb_traite` optionnel) ; il PEUT throw pour signaler un échec
 * (→ job.cron.failed + alerte canal + 500).
 */
export function withCronObservability<T extends object>(
  jobName: string,
  handler: (args: { supabase: AdminClient; req: Request }) => Promise<T>,
  opts: CronOptions = {},
): (req: Request) => Promise<NextResponse> {
  return async (req: Request): Promise<NextResponse> => {
    const unauthorized = assertCronAuth(req);
    if (unauthorized) return unauthorized;

    // Contexte de trace du run : un `trace_id` par exécution de cron (honore un
    // header entrant, sinon généré). Tous les events du run — job.cron.* ET les
    // logs transitifs des adapters/clients appelés dans `handler` — le portent.
    const traceId = extractOrCreateTraceId((n) => req.headers.get(n));
    return runWithTrace(traceId, async () => {
      const supabase = createAdminSupabaseClient();
      const startedAt = emitCronStarted(jobName);
      try {
        const result = await handler({ supabase, req });
        const nb_traite = (result as { nb_traite?: number }).nb_traite ?? null;
        const errors = (result as { errors?: unknown[] }).errors;
        emitCronCompleted(jobName, startedAt, {
          nb_traite,
          ...(Array.isArray(errors) ? { nb_errors: errors.length } : {}),
        });
        return NextResponse.json({ ok: true, ...result });
      } catch (err) {
        await emitCronFailed(jobName, err, {
          etape: 'run',
          canal: opts.canalOnFailure,
        });
        return NextResponse.json({ error: String(err) }, { status: 500 });
      }
    });
  };
}

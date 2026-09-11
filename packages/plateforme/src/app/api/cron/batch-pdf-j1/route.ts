// Cron Vercel — batch J+1 6h génération PDF ZD (M1.6) + AG (M2.4).
// Déclenché quotidiennement à 6h00 (vercel.json).

import { NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  runWithTrace,
  extractOrCreateTraceId,
} from '@savr/shared/src/logger/index.js';

import { runBatchPdfJ1 } from '../../../../lib/pdf/batch-pdf-j1.js';
import { runBatchPdfJ1Ag } from '../../../../lib/pdf/batch-pdf-j1-ag.js';
import { runBatchSansExcedent } from '../../../../lib/pdf/batch-pdf-sans-excedent.js';
import {
  assertCronAuth,
  emitCronCompleted,
  emitCronFailed,
  emitCronStarted,
} from '@/lib/cron-observabilite.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Ce cron couvre DEUX job_names §07/02 de criticité élevée
// (bordereaux_rapports_batch = ZD, attestations_batch = AG) + le rapport sans-excédent
// (rapport_sans_excedent_batch), exécutés en parallèle. Chaque sous-batch est
// instrumenté séparément (started/completed|failed) pour que l'alerte eleve §07/03
// « Job cron critique échoué » soit attribuée au bon job.
export async function POST(request: Request): Promise<NextResponse> {
  const unauthorized = assertCronAuth(request);
  if (unauthorized) return unauthorized;

  // Ce cron n'utilise pas `withCronObservability` (3 job_names émis en parallèle) :
  // on pose donc explicitement le contexte de trace du run, partagé par les 3
  // sous-batchs (job.cron.started porte alors le même trace_id — §07/02 l.18).
  const traceId = extractOrCreateTraceId((n) => request.headers.get(n));
  return runWithTrace(traceId, () =>
    runBatchPdfJ1All(createAdminSupabaseClient()),
  );
}

// Les 3 sous-batchs rendent la main même en échec (errors[] par collecte) : c'est
// leur champ `fatal` qui distingue un échec GLOBAL (sélection KO, ou 0 document produit
// sur N collectes tentées) → job.cron.failed + alerte, exactement comme un rejet.
// Sans cette garde, une sélection cassée finissait en job.cron.completed (incident
// 2026-09-11 : 0 PDF pendant des mois, aucune alerte).
const SOUS_BATCHS = [
  { jobName: 'bordereaux_rapports_batch', cle: 'zd', run: runBatchPdfJ1 },
  { jobName: 'attestations_batch', cle: 'ag', run: runBatchPdfJ1Ag },
  // Rapport « Événement sans excédent alimentaire » (§12 §1.3-bis, R21b) — batch dédié
  // pour les collectes AG realisee_sans_collecte, sans embargo H+24 (décision Val).
  {
    jobName: 'rapport_sans_excedent_batch',
    cle: 'sans_excedent',
    run: runBatchSansExcedent,
  },
] as const;

async function runBatchPdfJ1All(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
): Promise<NextResponse> {
  const startedAt = SOUS_BATCHS.map((b) => emitCronStarted(b.jobName));
  const settled = await Promise.allSettled(
    SOUS_BATCHS.map((b) => b.run(supabase)),
  );

  let failed = false;
  const body: Record<string, unknown> = {};

  for (const [i, b] of SOUS_BATCHS.entries()) {
    const s = settled[i]!;

    if (s.status === 'rejected') {
      failed = true;
      body[b.cle] = null;
      await emitCronFailed(b.jobName, s.reason, {
        etape: 'run',
        canal: 'eleve',
      });
      continue;
    }

    body[b.cle] = s.value;
    const { fatal } = s.value;
    if (fatal) {
      failed = true;
      // `code` porté par l'Error → error_code de job.cron.failed (ex. PGRST201).
      await emitCronFailed(
        b.jobName,
        Object.assign(new Error(fatal.message), { code: fatal.code }),
        { etape: fatal.etape, canal: 'eleve' },
      );
    } else {
      // Échecs par collecte éventuels (déjà loggués en warn) → nb_errors, sans alerte.
      emitCronCompleted(b.jobName, startedAt[i]!, {
        nb_traite: s.value.enqueued,
        nb_errors: s.value.errors.length,
      });
    }
  }

  return NextResponse.json(
    { ok: !failed, ...body },
    { status: failed ? 500 : 200 },
  );
}

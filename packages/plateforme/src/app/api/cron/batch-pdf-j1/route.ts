// Cron Vercel — batch J+1 6h génération PDF ZD (M1.6) + AG (M2.4).
// Déclenché quotidiennement à 6h00 (vercel.json).

import { NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

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
// (bordereaux_rapports_batch = ZD, attestations_batch = AG) exécutés en parallèle.
// Chaque sous-batch est instrumenté séparément (started/completed|failed) pour que
// l'alerte eleve §07/03 « Job cron critique échoué » soit attribuée au bon job.
export async function POST(request: Request): Promise<NextResponse> {
  const unauthorized = assertCronAuth(request);
  if (unauthorized) return unauthorized;

  const supabase = createAdminSupabaseClient();

  const startedZd = emitCronStarted('bordereaux_rapports_batch');
  const startedAg = emitCronStarted('attestations_batch');
  // Rapport « Événement sans excédent alimentaire » (§12 §1.3-bis, R21b) — batch dédié
  // pour les collectes AG realisee_sans_collecte, sans embargo H+24 (décision Val).
  const startedSe = emitCronStarted('rapport_sans_excedent_batch');

  const [zdSettled, agSettled, seSettled] = await Promise.allSettled([
    runBatchPdfJ1(supabase),
    runBatchPdfJ1Ag(supabase),
    runBatchSansExcedent(supabase),
  ]);

  let failed = false;
  let zd: unknown = null;
  let ag: unknown = null;
  let sans_excedent: unknown = null;

  if (zdSettled.status === 'fulfilled') {
    zd = zdSettled.value;
    emitCronCompleted('bordereaux_rapports_batch', startedZd);
  } else {
    failed = true;
    await emitCronFailed('bordereaux_rapports_batch', zdSettled.reason, {
      etape: 'run',
      canal: 'eleve',
    });
  }

  if (agSettled.status === 'fulfilled') {
    ag = agSettled.value;
    emitCronCompleted('attestations_batch', startedAg);
  } else {
    failed = true;
    await emitCronFailed('attestations_batch', agSettled.reason, {
      etape: 'run',
      canal: 'eleve',
    });
  }

  if (seSettled.status === 'fulfilled') {
    sans_excedent = seSettled.value;
    emitCronCompleted('rapport_sans_excedent_batch', startedSe);
  } else {
    failed = true;
    await emitCronFailed('rapport_sans_excedent_batch', seSettled.reason, {
      etape: 'run',
      canal: 'eleve',
    });
  }

  return NextResponse.json(
    { ok: !failed, zd, ag, sans_excedent },
    { status: failed ? 500 : 200 },
  );
}

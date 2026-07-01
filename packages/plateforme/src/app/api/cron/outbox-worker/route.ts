// Cron Vercel — worker outbox MTS-1 (M1.5a).
// Appelé par Vercel Cron toutes les 15 min (vercel.json : crons).
// Auth : header Authorization Bearer == CRON_SECRET (Vercel injecte automatiquement).

import { runOutboxWorker } from '@savr/adapters/src/outbox-worker.js';

import { withCronObservability } from '@/lib/cron-observabilite.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Pas d'alerte Slack sur le crash du run : les alertes actionnables (DLQ critique,
// collecte imminente) sont émises AU NIVEAU EVENT dans runOutboxWorker (anti-doublon §13).
export const POST = withCronObservability(
  'outbox_worker',
  async ({ supabase }) => {
    return await runOutboxWorker(supabase);
  },
);

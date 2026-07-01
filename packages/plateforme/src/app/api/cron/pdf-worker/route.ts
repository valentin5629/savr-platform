// Cron Vercel — worker jobs_pdf (M1.6).
// Appelé toutes les 5 min (vercel.json). Claim → Railway → R2 → done/dead.

import { runPdfWorker } from '../../../../lib/pdf/pdf-worker.js';

import { withCronObservability } from '@/lib/cron-observabilite.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Pas d'alerte Slack sur le crash du run : l'échec DÉFINITIF d'un job PDF (retries
// épuisés) déclenche sendAlert(eleve) DANS runPdfWorker (§07/03 « PDF job échec »).
export const POST = withCronObservability(
  'pdf_worker',
  async ({ supabase }) => {
    return await runPdfWorker(supabase);
  },
);

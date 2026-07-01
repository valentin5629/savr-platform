// Cron Vercel — batch J+1 6h génération brouillons de facture (M1.7).
// Déclenché quotidiennement à 6h00 (vercel.json).

import { runBatchBrouillonsJ1 } from '../../../../lib/facturation/batch-brouillons.js';

import { withCronObservability } from '@/lib/cron-observabilite.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Non catalogué §07/02 → pas d'alerte Slack. Les erreurs PARTIELLES (result.errors[])
// sont un succès partiel (job.cron.completed avec nb_errors), pas un job.cron.failed.
export const POST = withCronObservability(
  'batch_brouillons_j1',
  async ({ supabase }) => {
    const result = await runBatchBrouillonsJ1(supabase);
    const nb_traite =
      result.zd_par_collecte + result.zd_mensuel + result.ag_par_collecte;
    return { ...result, nb_traite };
  },
);

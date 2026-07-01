// Cron Vercel — revalidation SIRET des entités `en_attente` (R13 · BL-P1-ONB-02).
// Déclenché toutes les 15 min (vercel.json). Paliers : 15 min / 1h / 24h (CDC §15 §2.6 l.73).
// 'verifie'/'echec' → file 'resolu' ; 3 paliers down → file 'epuise' + alerte Admin in-app.

import { runSiretRevalidationWorker } from '@savr/shared/src/siret/revalidation.js';

import { withCronObservability } from '@/lib/cron-observabilite.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Non catalogué §07/02 → pas d'alerte Slack ; INSEE down = alerte Admin in-app
// (dans le worker), pas Slack (anti-doublon §13 + chaîne API-tierce-HS séparée).
export const POST = withCronObservability(
  'siret_revalidation',
  async ({ supabase }) => {
    return await runSiretRevalidationWorker(supabase);
  },
);

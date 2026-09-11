// Cron Vercel — clôture automatique realisee → cloturee après embargo H+24 (RM-01).
// Déclenché toutes les heures (vercel.json). Débloque toute la chaîne post-clôture
// (batchs J+1 bordereau/rapport/attestation, triggers CO₂/taux, registre ZD).

import { withCronObservability } from '@/lib/cron-observabilite.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withCronObservability(
  'cloture_embargo',
  async ({ supabase }): Promise<{ nb_traite: number }> => {
    const { data, error } = await supabase.rpc('fn_cloturer_collectes_embargo');
    if (error)
      throw new Error(`fn_cloturer_collectes_embargo: ${error.message}`);
    return { nb_traite: (data as number | null) ?? 0 };
  },
);

// Vercel Cron invoque en GET (avec `Authorization: Bearer $CRON_SECRET`) ; POST reste
// accepté pour les déclenchements manuels. Même handler, même garde fail-closed.
export const GET = POST;

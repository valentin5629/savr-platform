import { withCronObservability } from '@/lib/cron-observabilite.js';

// GET /api/cron/refresh-benchmark — rafraîchit la vue matérialisée benchmark.
// Garde CRON_SECRET harmonisée (Bearer strict). Non catalogué §07/02 → pas de Slack.
export const GET = withCronObservability(
  'refresh_benchmark',
  async ({ supabase }) => {
    const { error } = await supabase.rpc('refresh_mv_benchmark');
    if (error) throw error;
    return { refreshed_at: new Date().toISOString() };
  },
);

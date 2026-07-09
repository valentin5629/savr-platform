// Cron Vercel — job « purge_logs » (BL-P2-33 / R22g, M0.9).
// Rotation des partitions integrations_logs / audit_log (année courante + suivante) +
// purge de rétention integrations_logs (2 ans, §04/§08) et integrations_inbox (7 j, §04
// l.2351). N'affecte JAMAIS audit_log (§07/02 l.55 — rétention légale 5 ans).
// Job de maintenance à criticité basse (§07/02) → pas de canal Slack : un échec est
// capté par job.cron.failed + Sentry (aucune alerte fonctionnelle à doubler, §13).

import { NextResponse } from 'next/server';

import { withCronObservability } from '@/lib/cron-observabilite.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withCronObservability(
  'purge_logs',
  async ({ supabase }): Promise<{ nb_traite: number; recap: unknown }> => {
    const { data, error } = await supabase.rpc('f_purge_logs');
    if (error) throw new Error(`f_purge_logs: ${error.message}`);
    const recap = data as {
      nb_partitions_supprimees?: number;
      inbox_supprimes?: number;
    } | null;
    const nb_traite =
      (recap?.nb_partitions_supprimees ?? 0) + (recap?.inbox_supprimes ?? 0);
    return { nb_traite, recap };
  },
);

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}

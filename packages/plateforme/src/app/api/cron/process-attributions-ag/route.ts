import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { processAttributionValidee } from '@/lib/attribution-ag/job.js';
import type { AttributionValideePayload } from '@/lib/attribution-ag/job.js';

// POST /api/cron/process-attributions-ag
// Consomme les outbox_events attribution.validee en attente.
// Appelé par Vercel Cron (ou pg_cron en dev).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const supabase = createAdminSupabaseClient();
  const processed: string[] = [];
  const errors: { id: string; error: string }[] = [];

  // Claim jusqu'à 10 events d'un coup (pattern lease/claim — §04 outbox)
  const claimedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { data: events, error: claimErr } = await supabase
    .from('outbox_events')
    .update({ status: 'processing', claimed_until: claimedUntil })
    .eq('status', 'pending')
    .eq('event_type', 'attribution.validee')
    .eq('consumer', 'attribution_job')
    .lte('attempts', 3)
    .select('id, payload, attempts')
    .limit(10);

  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }

  for (const ev of events ?? []) {
    try {
      await processAttributionValidee(ev.payload as AttributionValideePayload);

      await supabase
        .from('outbox_events')
        .update({ status: 'done', processed_at: new Date().toISOString() })
        .eq('id', ev.id);

      processed.push(ev.id as string);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      const newAttempts = ((ev.attempts as number) ?? 0) + 1;

      await supabase
        .from('outbox_events')
        .update({
          status: newAttempts >= 4 ? 'dlq' : 'pending',
          attempts: newAttempts,
          last_error: msg,
          claimed_until: null,
        })
        .eq('id', ev.id);

      errors.push({ id: ev.id as string, error: msg });
    }
  }

  return NextResponse.json({ processed, errors, total: (events ?? []).length });
}

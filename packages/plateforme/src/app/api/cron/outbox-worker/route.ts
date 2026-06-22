// Cron Vercel — worker outbox MTS-1 (M1.5a).
// Appelé par Vercel Cron toutes les 15 min (vercel.json : crons).
// Auth : header Authorization Bearer == CRON_SECRET (Vercel injecte automatiquement).

import { NextResponse } from 'next/server';

import { runOutboxWorker } from '@savr/adapters/src/outbox-worker.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  // Vercel Cron injecte Authorization: Bearer <CRON_SECRET>
  const auth = request.headers.get('authorization');
  const cronSecret = process.env['CRON_SECRET'];
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createAdminSupabaseClient();

  try {
    const result = await runOutboxWorker(supabase);
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        service: 'platform',
        event: 'outbox_worker.run',
        actor_id: null,
        actor_role: null,
        org_id: null,
        trace_id: null,
        payload: result,
      }),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        service: 'platform',
        event: 'outbox_worker.crash',
        actor_id: null,
        actor_role: null,
        org_id: null,
        trace_id: null,
        payload: { error: String(err) },
      }),
    );
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

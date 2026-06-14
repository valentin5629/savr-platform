// Cron Vercel — batch J+1 6h génération brouillons de facture (M1.7).
// Déclenché quotidiennement à 6h00 (vercel.json).

import { NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

import { runBatchBrouillonsJ1 } from '../../../../lib/facturation/batch-brouillons.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request): Promise<NextResponse> {
  const auth = request.headers.get('authorization');
  const cronSecret = process.env['CRON_SECRET'];
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createAdminSupabaseClient();

  try {
    const result = await runBatchBrouillonsJ1(supabase);
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        service: 'platform',
        event: 'batch_brouillons_j1.run',
        actor_id: null,
        actor_role: null,
        org_id: null,
        trace_id: null,
        payload: result,
      }),
    );
    if (result.errors.length > 0) {
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'warn',
          service: 'platform',
          event: 'batch_brouillons_j1.partial_errors',
          payload: { errors: result.errors },
        }),
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        service: 'platform',
        event: 'batch_brouillons_j1.fatal',
        payload: { message: String(err) },
      }),
    );
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Cron Vercel — batch J+1 6h génération PDF ZD (M1.6) + AG (M2.4).
// Déclenché quotidiennement à 6h00 (vercel.json).

import { NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

import { runBatchPdfJ1 } from '../../../../lib/pdf/batch-pdf-j1.js';
import { runBatchPdfJ1Ag } from '../../../../lib/pdf/batch-pdf-j1-ag.js';

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
    const [zdResult, agResult] = await Promise.all([
      runBatchPdfJ1(supabase),
      runBatchPdfJ1Ag(supabase),
    ]);
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        service: 'platform',
        event: 'batch_pdf_j1.run',
        actor_id: null,
        actor_role: null,
        org_id: null,
        trace_id: null,
        payload: { zd: zdResult, ag: agResult },
      }),
    );
    return NextResponse.json({ ok: true, zd: zdResult, ag: agResult });
  } catch (err) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        service: 'platform',
        event: 'batch_pdf_j1.crash',
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

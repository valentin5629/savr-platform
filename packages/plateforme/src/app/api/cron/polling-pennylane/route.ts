// Cron Vercel — polling paiement Pennylane J+1 3h (M1.7).
// Déclenché quotidiennement à 3h00 (vercel.json).
// Vérifie statut des factures 'emise' → transition payee si paid.

import { NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

import { runPollingPaiement } from '../../../../lib/facturation/polling-paiement.js';

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
    const result = await runPollingPaiement(supabase);
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        service: 'platform',
        event: 'polling_pennylane.run',
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
        event: 'polling_pennylane.fatal',
        payload: { message: String(err) },
      }),
    );
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

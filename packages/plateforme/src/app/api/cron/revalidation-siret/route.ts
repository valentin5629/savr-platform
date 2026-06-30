// Cron Vercel — revalidation SIRET des entités `en_attente` (R13 · BL-P1-ONB-02).
// Déclenché toutes les 15 min (vercel.json). Paliers : 15 min / 1h / 24h (CDC §15 §2.6 l.73).
// 'verifie'/'echec' → file 'resolu' ; 3 paliers down → file 'epuise' + alerte Admin in-app.

import { NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { runSiretRevalidationWorker } from '@savr/shared/src/siret/revalidation.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request): Promise<NextResponse> {
  const auth = request.headers.get('authorization');
  const cronSecret = process.env['CRON_SECRET'];
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createAdminSupabaseClient();

  try {
    const result = await runSiretRevalidationWorker(supabase);
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        service: 'platform',
        event: 'siret_revalidation.run',
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
        event: 'siret_revalidation.fatal',
        payload: { message: String(err) },
      }),
    );
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

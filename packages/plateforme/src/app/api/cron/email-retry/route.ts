// Cron Vercel — retry automatique des emails Resend en échec (R10b · BL-P1-API-05).
// Déclenché toutes les 5 min (vercel.json). Paliers : 5 min / 1h / 24h (tentative 2-4),
// dérivés de emails_envoyes.created_at. Échec final → statut='failed' + integrations_logs.

import { NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { runEmailRetryWorker } from '@savr/shared/src/email/index.js';

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
    const result = await runEmailRetryWorker(supabase);
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        service: 'platform',
        event: 'email_retry.run',
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
        event: 'email_retry.fatal',
        payload: { message: String(err) },
      }),
    );
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

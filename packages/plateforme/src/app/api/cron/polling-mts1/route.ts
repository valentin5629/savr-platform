// Cron Vercel — polling entrant MTS-1 (M1.5b).
// Appelé toutes les 15 min 24/7 (vercel.json : crons).
// Auth : header Authorization Bearer == CRON_SECRET (Vercel injecte automatiquement).

import { NextResponse } from 'next/server';

import {
  getLogistiqueProvider,
  type FenetreSync,
  type TypeTms,
} from '@savr/adapters/src/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  const auth = request.headers.get('authorization');
  const cronSecret = process.env['CRON_SECRET'];
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createAdminSupabaseClient();

  // Fenêtre glissante : now-2h → now+48h (corrections tardives + collectes futures)
  const maintenant = new Date();
  const fenetre: FenetreSync = {
    depuis: new Date(maintenant.getTime() - 2 * 60 * 60 * 1000),
    jusqu_a: new Date(maintenant.getTime() + 48 * 60 * 60 * 1000),
  };

  const { data: transporteurs } = await supabase
    .from('transporteurs')
    .select('id, type_tms, code_transporteur_mts1, prestataire_logistique_id');

  if (!transporteurs?.length) {
    return NextResponse.json({ ok: true, synced: 0 });
  }

  let synced = 0;
  const errors: string[] = [];

  for (const t of transporteurs) {
    try {
      const provider = getLogistiqueProvider(
        {
          id: t.id as string,
          type_tms: t.type_tms as TypeTms,
          code_transporteur_mts1: t.code_transporteur_mts1 as string | null,
          prestataire_logistique_id: t.prestataire_logistique_id as string,
        },
        supabase,
      );
      await provider.sync(fenetre);
      synced++;
    } catch (err) {
      errors.push(`${String(t.id)}: ${String(err)}`);
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'error',
          service: 'platform',
          event: 'polling_mts1.error',
          actor_id: null,
          actor_role: null,
          org_id: null,
          trace_id: null,
          payload: { transporteur_id: t.id, error: String(err) },
        }),
      );
    }
  }

  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      service: 'platform',
      event: 'polling_mts1.run',
      actor_id: null,
      actor_role: null,
      org_id: null,
      trace_id: null,
      payload: {
        synced,
        errors: errors.length,
        fenetre_depuis: fenetre.depuis.toISOString(),
        fenetre_jusqu_a: fenetre.jusqu_a.toISOString(),
      },
    }),
  );

  if (errors.length > 0) {
    return NextResponse.json({ ok: false, synced, errors }, { status: 500 });
  }
  return NextResponse.json({ ok: true, synced });
}

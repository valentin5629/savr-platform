// Cron Vercel — envoi du template 9 admin_pack_ag_etat (BL-P2-30 / R22e).
// Scanne les alertes in-app pack_ag_bas / pack_ag_epuise non encore notifiées
// (écrites par les triggers de débit) et envoie l'email à l'inbox admin.
// Non catalogué §07/02 → pas de Slack (alerte fonctionnelle, canal email + in-app).

import { NextResponse } from 'next/server';

import { withCronObservability } from '@/lib/cron-observabilite.js';
import { traiterAlertesPackEtat } from '@/lib/packs/notify-pack-etat.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withCronObservability(
  'notify_pack_etat',
  async ({ supabase }): Promise<{ nb_traite: number }> => {
    const { nb_traite } = await traiterAlertesPackEtat(supabase);
    return { nb_traite };
  },
);

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}

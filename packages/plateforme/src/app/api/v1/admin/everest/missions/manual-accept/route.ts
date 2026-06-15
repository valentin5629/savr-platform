// Failover Ops — acceptation manuelle mission Everest (M2.5, M14 W4).
// Rôle : ops_savr ou admin_savr uniquement.
// Déclenché quand Everest est down et que l'Ops a appelé A Toutes! par téléphone.

import { NextRequest, NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

import { requireStaff } from '@/lib/api-auth.js';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as Record<string, unknown>;
  const { collecte_id, contact_joint, heure_appel, commentaire } = body;

  if (!collecte_id || typeof collecte_id !== 'string') {
    return NextResponse.json({ error: 'collecte_id requis' }, { status: 400 });
  }

  const supabase = createAdminSupabaseClient();

  // Lookup mission Everest pour cette collecte
  const { data: mission } = await supabase
    .from('everest_missions')
    .select(
      'id, tournee_id, statut_everest, everest_mission_id, everest_service_id',
    )
    .eq('collecte_id', collecte_id)
    .maybeSingle();

  type MissionRow = {
    id: string;
    tournee_id: string;
    statut_everest: string;
    everest_mission_id: string | null;
    everest_service_id: number;
  };

  const manualPayload = {
    manual: true,
    contact_joint: contact_joint ?? null,
    heure_appel: heure_appel ?? null,
    commentaire: commentaire ?? null,
    ops_user_id: auth.ctx.userId,
  };

  if (mission) {
    const m = mission as unknown as MissionRow;
    await supabase
      .from('everest_missions')
      .update({
        statut_everest: 'created_manually',
        payload_latest_update: manualPayload,
        derniere_sync_at: new Date().toISOString(),
      })
      .eq('id', m.id);

    // Tracer dans audit_log
    await supabase.from('audit_log').insert({
      user_id: auth.ctx.userId,
      role: auth.ctx.role,
      action: 'UPDATE',
      table_name: 'everest_missions',
      record_id: m.id,
      new_values: {
        statut_everest: 'created_manually',
        ...manualPayload,
      },
    });
  } else {
    // Mission jamais créée (push n'a même pas créé la ligne) — lookup tournée
    const { data: tournee } = await supabase
      .from('collecte_tournees')
      .select('tournee_id')
      .eq('collecte_id', collecte_id)
      .limit(1)
      .maybeSingle();

    const tourneeId = (tournee as { tournee_id: string } | null)?.tournee_id;

    if (!tourneeId) {
      return NextResponse.json(
        { error: 'Aucune tournée Everest trouvée pour cette collecte' },
        { status: 404 },
      );
    }

    await supabase.from('everest_missions').insert({
      tournee_id: tourneeId,
      collecte_id,
      everest_service_id: 71, // service par défaut si inconnu
      statut_everest: 'created_manually',
      payload_latest_update: manualPayload,
      derniere_sync_at: new Date().toISOString(),
    });

    await supabase.from('audit_log').insert({
      user_id: auth.ctx.userId,
      role: auth.ctx.role,
      action: 'CREATE',
      table_name: 'everest_missions',
      new_values: { statut_everest: 'created_manually', ...manualPayload },
    });
  }

  // Passer statut_tms → 'acceptee' (trigger dérive collectes.statut = 'validee')
  const { data: collecte } = await supabase
    .from('collectes')
    .select('statut_tms')
    .eq('id', collecte_id)
    .maybeSingle();

  const statut_tms_actuel = (collecte as { statut_tms: string } | null)
    ?.statut_tms;
  if (statut_tms_actuel === 'attribuee_en_attente_acceptation') {
    await supabase
      .from('collectes')
      .update({ statut_tms: 'acceptee' })
      .eq('id', collecte_id);
  }

  return NextResponse.json({ ok: true });
}

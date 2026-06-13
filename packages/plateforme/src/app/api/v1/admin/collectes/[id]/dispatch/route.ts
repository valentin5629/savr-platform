import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

const STATUTS_TERMINAUX = [
  'realisee',
  'cloturee',
  'annulee',
  'realisee_sans_collecte',
];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { prestataire_logistique_id, motif_override_prestataire } = body;

  const supabase = createAdminSupabaseClient();
  const { data: collecte, error: fetchErr } = await supabase
    .from('collectes')
    .select(
      'id, statut, statut_tms, tms_reference, type, date_collecte, dirty_tms, prestataire_logistique_id',
    )
    .eq('id', id)
    .single();

  if (fetchErr?.code === 'PGRST116' || !collecte) {
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  }

  const c = collecte as {
    id: string;
    statut: string;
    statut_tms: string;
    tms_reference: string | null;
    type: string;
    date_collecte: string;
    dirty_tms: boolean;
    prestataire_logistique_id: string | null;
  };

  // 409 si statut terminal
  if (STATUTS_TERMINAUX.includes(c.statut)) {
    return NextResponse.json(
      {
        error: `Impossible de dispatcher une collecte au statut '${c.statut}'`,
      },
      { status: 409 },
    );
  }

  // Override prestataire : ops interdit, motif obligatoire
  if (
    prestataire_logistique_id &&
    prestataire_logistique_id !== c.prestataire_logistique_id
  ) {
    if (auth.ctx.role === 'ops_savr') {
      return NextResponse.json(
        { error: "L'override de prestataire est réservé aux admin Savr" },
        { status: 403 },
      );
    }
    if (
      !motif_override_prestataire ||
      String(motif_override_prestataire).length < 5
    ) {
      return NextResponse.json(
        {
          error:
            "motif_override_prestataire obligatoire (≥ 5 caractères) lors d'un override",
        },
        { status: 422 },
      );
    }
  }

  // Mise à jour collecte : reset dirty_tms + override si fourni
  const updatePayload: Record<string, unknown> = {
    dirty_tms: false,
    updated_at: new Date().toISOString(),
  };
  if (prestataire_logistique_id) {
    updatePayload.prestataire_logistique_id = prestataire_logistique_id;
  }
  if (motif_override_prestataire) {
    updatePayload.motif_override_prestataire = motif_override_prestataire;
  }

  const { error: updateErr } = await supabase
    .from('collectes')
    .update(updatePayload)
    .eq('id', id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Outbox : E1 si premier envoi, E2 si renvoi (garde-fou G4)
  const eventType = c.tms_reference ? 'collecte.modifiee' : 'collecte.creee';
  await supabase.from('outbox_events').insert({
    aggregate_type: 'collecte',
    aggregate_id: id,
    event_type: eventType,
    payload: {
      collecte_id: id,
      type: c.type,
      date_collecte: c.date_collecte,
      dispatch_manuel: true,
      ...(prestataire_logistique_id ? { prestataire_logistique_id } : {}),
    },
    consumer: 'adapter_mts1',
  });

  await supabase.from('audit_log').insert({
    table_name: 'collectes',
    record_id: id,
    action: 'DISPATCH',
    user_id: auth.ctx.userId,
    new_data: { event_type: eventType, ...updatePayload },
  });

  return NextResponse.json({ ok: true, event_type: eventType });
}

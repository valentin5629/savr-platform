import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

// PATCH /api/v1/admin/attributions-ag/[collecteId]/poids
// Saisie / correction du poids réel AG par Ops (§06.09 l.177/183).
// L'UPDATE déclenche trg_calc_volume_repas_realise (volume + audit poids_repas_saisi_ops)
// puis, sur changement de volume_repas_realise, trg_regenerer_attestation (nouvelle
// version 'brouillon' + re-enqueue jobs_pdf → l'attestation fiscale reste juste, RM-10).
//
// BL-P1-RM-10 : une CORRECTION d'un poids déjà saisi (valeur aberrante, §06.09 l.183)
// exige un motif (≥ 10 car.). La 1re saisie (poids null) ne l'exige pas (§06.09 l.177).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ collecteId: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { collecteId } = await params;

  let body: { poids_repas_kg: number; motif?: string };
  try {
    body = (await req.json()) as { poids_repas_kg: number; motif?: string };
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  if (typeof body.poids_repas_kg !== 'number' || body.poids_repas_kg <= 0) {
    return NextResponse.json(
      { error: 'poids_repas_kg invalide (doit être > 0)' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // État courant : distingue 1re saisie (poids null) d'une correction (poids déjà posé).
  const { data: avant, error: fetchErr } = await supabase
    .from('attributions_antgaspi')
    .select('id, poids_repas_kg, volume_repas_realise')
    .eq('collecte_id', collecteId)
    .single();

  if (fetchErr?.code === 'PGRST116' || !avant) {
    return NextResponse.json(
      { error: 'Attribution introuvable' },
      { status: 404 },
    );
  }

  const estCorrection =
    (avant as { poids_repas_kg: number | null }).poids_repas_kg != null;
  const motif = typeof body.motif === 'string' ? body.motif.trim() : '';
  if (estCorrection && motif.length < 10) {
    return NextResponse.json(
      {
        error:
          'Un motif d’au moins 10 caractères est requis pour corriger le volume (§06.09)',
      },
      { status: 422 },
    );
  }

  const { data, error } = await supabase
    .from('attributions_antgaspi')
    .update({ poids_repas_kg: body.poids_repas_kg })
    .eq('collecte_id', collecteId)
    .select('id, poids_repas_kg, volume_repas_realise')
    .single();

  if (error) {
    if (error.code === 'PGRST116')
      return NextResponse.json(
        { error: 'Attribution introuvable' },
        { status: 404 },
      );
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sur correction, tracer le MOTIF (le trigger DB audite déjà l'action
  // poids_repas_saisi_ops mais sans contexte requête → il ne porte pas le motif).
  if (estCorrection) {
    await supabase.from('audit_log').insert({
      table_name: 'attributions_antgaspi',
      record_id: (avant as { id: string }).id,
      action: 'poids_repas_saisi_ops',
      user_id: auth.ctx.userId,
      role: auth.ctx.role,
      motif,
      old_values: {
        poids_repas_kg: (avant as { poids_repas_kg: number | null })
          .poids_repas_kg,
        volume_repas_realise: (avant as { volume_repas_realise: number | null })
          .volume_repas_realise,
      },
      new_values: {
        poids_repas_kg: (data as { poids_repas_kg: number }).poids_repas_kg,
        volume_repas_realise: (data as { volume_repas_realise: number | null })
          .volume_repas_realise,
      },
    });
  }

  return NextResponse.json({ data });
}

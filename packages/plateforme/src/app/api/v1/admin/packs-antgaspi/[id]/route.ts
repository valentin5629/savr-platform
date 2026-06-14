import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

// Actions : ajuster_credits | annuler
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const { id } = await params;
  const { action, credits_initiaux, motif } = body as {
    action?: string;
    credits_initiaux?: number;
    motif?: string;
  };

  if (!action)
    return NextResponse.json(
      { error: 'action est obligatoire (ajuster_credits | annuler)' },
      { status: 422 },
    );
  if (!motif || motif.length < 10) {
    return NextResponse.json(
      { error: 'motif obligatoire (≥ 10 caractères)' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  const { data: pack, error: fetchError } = await supabase
    .from('packs_antgaspi')
    .select(
      'id, statut, credits_initiaux, credits_consommes, organisation_id, type_pack',
    )
    .eq('id', id)
    .single();

  if (fetchError || !pack)
    return NextResponse.json({ error: 'Pack non trouvé' }, { status: 404 });

  if (action === 'ajuster_credits') {
    if (!['actif', 'epuise'].includes(pack.statut as string)) {
      return NextResponse.json(
        { error: 'Ajustement possible uniquement sur un pack actif ou épuisé' },
        { status: 422 },
      );
    }
    if (credits_initiaux === undefined || credits_initiaux < 0) {
      return NextResponse.json(
        { error: 'credits_initiaux invalide (>= 0 requis)' },
        { status: 422 },
      );
    }

    const oldVal = pack.credits_initiaux;
    // Recalculer le statut après ajustement
    const newStatut =
      (credits_initiaux as number) <= (pack.credits_consommes as number)
        ? 'epuise'
        : 'actif';

    const { data: updated, error } = await supabase
      .from('packs_antgaspi')
      .update({ credits_initiaux, statut: newStatut })
      .eq('id', id)
      .select('id, credits_initiaux, credits_consommes, statut')
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 422 });

    try {
      await supabase.from('audit_log').insert({
        table_name: 'packs_antgaspi',
        record_id: id,
        action: 'ajustement_credits',
        user_id: auth.ctx.userId,
        old_values: { credits_initiaux: oldVal },
        new_values: { credits_initiaux, motif },
      });
    } catch {
      /* audit failure non-bloquante */
    }

    return NextResponse.json(updated);
  }

  if (action === 'annuler') {
    if (pack.statut !== 'actif') {
      return NextResponse.json(
        { error: 'Annulation possible uniquement sur un pack actif' },
        { status: 422 },
      );
    }

    const { data: updated, error } = await supabase
      .from('packs_antgaspi')
      .update({ statut: 'annule' })
      .eq('id', id)
      .select('id, statut, credits_consommes')
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 422 });

    try {
      await supabase.from('audit_log').insert({
        table_name: 'packs_antgaspi',
        record_id: id,
        action: 'annulation_pack',
        user_id: auth.ctx.userId,
        old_values: { statut: 'actif' },
        new_values: { statut: 'annule', motif },
      });
    } catch {
      /* audit failure non-bloquante */
    }

    return NextResponse.json(updated);
  }

  return NextResponse.json(
    { error: 'action inconnue (ajuster_credits | annuler)' },
    { status: 422 },
  );
}

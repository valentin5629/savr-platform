import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

// PATCH /api/v1/admin/attributions-ag/[collecteId]/poids
// Saisie du poids réel → déclenche trg_calc_volume_repas_realise
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ collecteId: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { collecteId } = await params;

  let body: { poids_repas_kg: number };
  try {
    body = (await req.json()) as { poids_repas_kg: number };
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

  return NextResponse.json({ data });
}

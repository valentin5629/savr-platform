import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

// POST /api/v1/admin/collectes/:id/annuler-credit
// Annule le crédit pack AG d'une collecte réalisée sans changer son statut (Bloc 6)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const { motif } = body as { motif?: string };
  if (!motif || motif.trim().length < 10) {
    return NextResponse.json(
      { error: 'motif obligatoire (≥ 10 caractères)' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.rpc('rpc_annuler_credit_collecte', {
    p_collecte_id: id,
    p_motif: motif.trim(),
  });

  if (error) {
    const code = error.code ?? '';
    if (code === 'P0001')
      return NextResponse.json({ error: error.message }, { status: 422 });
    if (code === 'P0002')
      return NextResponse.json(
        { error: 'Collecte non trouvée' },
        { status: 404 },
      );
    if (['P0003', 'P0004', 'P0005'].includes(code))
      return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

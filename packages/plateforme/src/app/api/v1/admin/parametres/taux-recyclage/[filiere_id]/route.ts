import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAdmin } from '@/lib/api-auth.js';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ filiere_id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { filiere_id } = await params;
  const idempotencyKey = req.headers.get('idempotency-key');

  const body = (await req.json()) as Record<string, unknown>;
  const { taux_captation, commentaire_modif } = body;

  if (taux_captation === undefined || taux_captation === null) {
    return NextResponse.json(
      { error: 'taux_captation est obligatoire' },
      { status: 422 },
    );
  }
  const taux = Number(taux_captation);
  if (isNaN(taux) || taux < 0 || taux > 1) {
    return NextResponse.json(
      { error: 'taux_captation doit être compris entre 0 et 1' },
      { status: 422 },
    );
  }
  if (!commentaire_modif || String(commentaire_modif).length < 5) {
    return NextResponse.json(
      { error: 'commentaire_modif est obligatoire (≥ 5 caractères)' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_taux_recyclage')
    .update({
      taux_captation: taux,
      commentaire_modif: String(commentaire_modif),
      modifie_par: auth.ctx.userId,
      modifie_le: new Date().toISOString(),
    })
    .eq('id', filiere_id)
    .select()
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json({ error: 'Filière introuvable' }, { status: 404 });
  }
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // History insérée par trigger DB (trg_history_taux_recyclage)
  void idempotencyKey; // utilisé pour dédup côté client si besoin
  return NextResponse.json(data);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filiere_id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { filiere_id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('parametres_taux_recyclage_history')
    .select('*')
    .eq('parametre_id', filiere_id)
    .order('created_at', { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

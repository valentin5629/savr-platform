import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';

// GET — facteur CO₂ évité par repas donné AG (1 ligne)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_facteurs_co2_ag')
    .select('id, cle, facteur_co2_evite_par_repas_kg, source_donnee, actif')
    .limit(1)
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json({ data: null });
  }
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}

// PUT — mise à jour du facteur AG (admin uniquement, commentaire obligatoire).
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as {
    id?: string;
    facteur_co2_evite_par_repas_kg?: number;
    commentaire_modif?: string;
  };

  if (!body.id || body.facteur_co2_evite_par_repas_kg === undefined) {
    return NextResponse.json(
      { error: 'id et facteur_co2_evite_par_repas_kg sont obligatoires' },
      { status: 422 },
    );
  }
  if (!body.commentaire_modif || body.commentaire_modif.trim().length < 5) {
    return NextResponse.json(
      { error: 'commentaire_modif est obligatoire (≥ 5 caractères)' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.rpc('rpc_maj_facteur_co2_ag', {
    p_auteur: auth.ctx.userId,
    p_commentaire: body.commentaire_modif,
    p_id: body.id,
    p_facteur: body.facteur_co2_evite_par_repas_kg,
  });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}

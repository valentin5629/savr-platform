import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';

// GET — composition du flux emballages par matériau (7 lignes)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_mix_emballages')
    .select(
      'id, code_materiau, nom_materiau, part_pct, fe_induit_kg_t, fe_evite_kg_t, source_donnee, actif',
    )
    .order('code_materiau');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

// PUT — mise à jour du mix (admin uniquement, commentaire obligatoire).
// La RPC applique le batch, valide Σ=100 et recalcule le FE emballage + history.
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as {
    mix?: { id: string; part_pct: number }[];
    commentaire_modif?: string;
  };

  if (!Array.isArray(body.mix) || body.mix.length === 0) {
    return NextResponse.json(
      { error: 'mix est obligatoire (tableau non vide)' },
      { status: 422 },
    );
  }
  if (!body.commentaire_modif || body.commentaire_modif.trim().length < 5) {
    return NextResponse.json(
      { error: 'commentaire_modif est obligatoire (≥ 5 caractères)' },
      { status: 422 },
    );
  }

  // Contrôle somme = 100 (feedback immédiat ; la RPC revalide côté DB).
  const total = body.mix.reduce((acc, m) => acc + Number(m.part_pct), 0);
  if (Math.abs(total - 100) > 0.05) {
    return NextResponse.json(
      {
        error: `La somme des parts doit être égale à 100 % (reçu ${total.toFixed(2)} %)`,
      },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.rpc('rpc_maj_mix_emballages', {
    p_auteur: auth.ctx.userId,
    p_commentaire: body.commentaire_modif,
    p_mix: body.mix,
  });

  if (error)
    return NextResponse.json(
      { error: 'Erreur mise à jour mix emballages', details: error.message },
      { status: 500 },
    );

  return NextResponse.json({ data });
}

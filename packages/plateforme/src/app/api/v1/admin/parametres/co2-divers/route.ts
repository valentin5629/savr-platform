import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';

// GET — paramètres CO₂ divers (clé-valeur : forfait collecte + équivalences)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_co2_divers')
    .select('id, cle, valeur, unite, description, source_donnee')
    .order('cle');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

// PUT — mise à jour des valeurs clé-valeur (admin uniquement, commentaire obligatoire).
// Audit via audit_log (auteur + motif) écrit par le trigger fn_audit_parametres_co2_divers.
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as {
    divers?: { id: string; valeur: number }[];
    commentaire_modif?: string;
  };

  if (!Array.isArray(body.divers) || body.divers.length === 0) {
    return NextResponse.json(
      { error: 'divers est obligatoire (tableau non vide {id, valeur})' },
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
  const { data, error } = await supabase.rpc('rpc_maj_co2_divers', {
    p_auteur: auth.ctx.userId,
    p_commentaire: body.commentaire_modif,
    p_divers: body.divers,
  });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}

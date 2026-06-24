import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';

// GET — facteurs CO₂ par flux ZD (lecture ops + admin)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_facteurs_co2')
    .select(
      'id, code_flux, nom_flux, fe_induit_kg_t, fe_evite_kg_t, energie_primaire_evitee_kwh_t, source_donnee, actif',
    )
    .order('code_flux');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

// PUT — mise à jour des facteurs (admin uniquement, commentaire obligatoire).
// Historique + auteur tracés par la RPC SECURITY DEFINER (R3 / divergence M2.4).
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as {
    facteurs?: {
      id: string;
      fe_induit_kg_t?: number;
      fe_evite_kg_t?: number;
      energie_primaire_evitee_kwh_t?: number;
      source_donnee?: string;
    }[];
    commentaire_modif?: string;
  };

  if (!Array.isArray(body.facteurs) || body.facteurs.length === 0) {
    return NextResponse.json(
      { error: 'facteurs est obligatoire (tableau non vide)' },
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
  const { data, error } = await supabase.rpc('rpc_maj_facteurs_co2', {
    p_auteur: auth.ctx.userId,
    p_commentaire: body.commentaire_modif,
    p_facteurs: body.facteurs,
  });

  if (error)
    return NextResponse.json(
      { error: 'Erreur mise à jour facteurs CO2', details: error.message },
      { status: 500 },
    );

  return NextResponse.json({ data });
}

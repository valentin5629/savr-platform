import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_facteurs_co2')
    .select('*')
    .order('code_flux');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as {
    facteurs: { id: string; facteur_co2_kg_par_kg: number }[];
  };
  if (!Array.isArray(body.facteurs) || body.facteurs.length === 0) {
    return NextResponse.json(
      { error: 'facteurs est obligatoire (tableau non vide)' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const results = await Promise.all(
    body.facteurs.map((f) =>
      supabase
        .from('parametres_facteurs_co2')
        .update({
          facteur_co2_kg_par_kg: f.facteur_co2_kg_par_kg,
          modifie_par: auth.ctx.userId,
          modifie_le: new Date().toISOString(),
        })
        .eq('id', f.id)
        .select()
        .single(),
    ),
  );

  const errors = results.filter((r) => r.error);
  if (errors.length > 0) {
    return NextResponse.json(
      {
        error: 'Erreur mise à jour facteurs CO2',
        details: errors.map((e) => e.error?.message),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: results.map((r) => r.data) });
}

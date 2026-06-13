import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_facteurs_co2_ag')
    .select('*')
    .limit(1)
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json({ data: null });
  }
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as {
    id: string;
    facteur_co2_kg_par_repas: number;
  };
  if (!body.id || body.facteur_co2_kg_par_repas === undefined) {
    return NextResponse.json(
      { error: 'id et facteur_co2_kg_par_repas sont obligatoires' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_facteurs_co2_ag')
    .update({
      facteur_co2_kg_par_repas: body.facteur_co2_kg_par_repas,
      modifie_par: auth.ctx.userId,
      modifie_le: new Date().toISOString(),
    })
    .eq('id', body.id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}

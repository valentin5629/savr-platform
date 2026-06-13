import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_co2_divers')
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

  const body = (await req.json()) as Record<string, unknown>;
  if (!body.id) {
    return NextResponse.json({ error: 'id est obligatoire' }, { status: 422 });
  }

  const ALLOWED_FIELDS = [
    'co2_kg_par_km_camion',
    'co2_kg_par_km_velo',
    'equivalent_arbre_kg_co2',
    'equivalent_douche_kg_co2',
  ];
  const updates = Object.fromEntries(
    Object.entries(body).filter(([k]) => ALLOWED_FIELDS.includes(k)),
  );

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_co2_divers')
    .update({
      ...updates,
      modifie_par: auth.ctx.userId,
      modifie_le: new Date().toISOString(),
    })
    .eq('id', body.id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('audit_log').insert({
    table_name: 'parametres_co2_divers',
    record_id: String(body.id),
    action: 'UPDATE',
    user_id: auth.ctx.userId,
    new_data: updates,
  });

  return NextResponse.json({ data });
}

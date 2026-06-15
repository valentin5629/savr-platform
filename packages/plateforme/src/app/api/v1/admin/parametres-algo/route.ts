import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAdmin, requireStaff } from '@/lib/api-auth.js';

// GET /api/v1/admin/parametres-algo — lecture (ops + admin)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_algo')
    .select('cle, valeur, type_valeur, description, updated_at')
    .order('cle');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// PATCH /api/v1/admin/parametres-algo — écriture admin uniquement
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  let body: { cle: string; valeur: unknown };
  try {
    body = (await req.json()) as { cle: string; valeur: unknown };
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  if (!body.cle || body.valeur === undefined) {
    return NextResponse.json(
      { error: 'cle et valeur obligatoires' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_algo')
    .update({ valeur: body.valeur, updated_at: new Date().toISOString() })
    .eq('cle', body.cle)
    .select('cle, valeur, type_valeur, updated_at')
    .single();

  if (error) {
    if (error.code === 'PGRST116')
      return NextResponse.json(
        { error: `Paramètre inconnu: ${body.cle}` },
        { status: 404 },
      );
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

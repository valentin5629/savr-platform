import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const actif = searchParams.get('actif');
  const type_tms = searchParams.get('type_tms');
  const q = searchParams.get('q');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('transporteurs')
    .select('*', { count: 'exact' })
    .order('nom')
    .range(offset, offset + limit - 1);

  if (actif !== null) query = query.eq('actif', actif === 'true');
  if (type_tms) query = query.eq('type_tms', type_tms);
  if (q) query = query.ilike('nom', `%${q}%`);

  const { data, error, count } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [], total: count ?? 0 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as Record<string, unknown>;
  const {
    nom,
    siren,
    adresse,
    code_postal,
    ville,
    types_vehicules,
    type_tms,
    contact_nom,
    contact_email,
    contact_telephone,
  } = body;

  if (
    !nom ||
    !siren ||
    !adresse ||
    !code_postal ||
    !ville ||
    !types_vehicules ||
    !type_tms ||
    !contact_nom ||
    !contact_email ||
    !contact_telephone
  ) {
    return NextResponse.json(
      { error: 'Champs obligatoires manquants' },
      { status: 422 },
    );
  }

  if (type_tms === 'mts1' && !body.code_transporteur_mts1) {
    return NextResponse.json(
      {
        error:
          'code_transporteur_mts1 est obligatoire pour les transporteurs MTS-1',
      },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('transporteurs')
    .insert({
      nom,
      siren,
      adresse,
      code_postal,
      ville,
      types_vehicules,
      type_tms,
      contact_nom,
      contact_email,
      contact_telephone,
      code_transporteur_mts1: body.code_transporteur_mts1 ?? null,
      tarif_par_course: body.tarif_par_course ?? null,
      commentaires_internes: body.commentaires_internes ?? null,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
    })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('audit_log').insert({
    table_name: 'transporteurs',
    record_id: (data as { id: string }).id,
    action: 'INSERT',
    user_id: auth.ctx.userId,
    new_data: data,
  });

  return NextResponse.json(data, { status: 201 });
}

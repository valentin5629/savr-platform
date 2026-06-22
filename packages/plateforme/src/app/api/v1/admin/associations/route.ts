import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const actif = searchParams.get('actif');
  const region = searchParams.get('region');
  const q = searchParams.get('q');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('associations')
    .select('*', { count: 'exact' })
    .order('nom')
    .range(offset, offset + limit - 1);

  if (actif !== null) query = query.eq('actif', actif === 'true');
  if (region) query = query.eq('region', region);
  if (q) query = query.or(`nom.ilike.%${q}%,ville.ilike.%${q}%`);

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
    adresse,
    region,
    ville,
    contact_email,
    description_rapport_impact,
  } = body;

  if (
    !nom ||
    !adresse ||
    !region ||
    !ville ||
    !contact_email ||
    !description_rapport_impact
  ) {
    return NextResponse.json(
      { error: 'Champs obligatoires manquants' },
      { status: 422 },
    );
  }

  if (
    typeof description_rapport_impact === 'string' &&
    description_rapport_impact.length < 30
  ) {
    return NextResponse.json(
      {
        error:
          'description_rapport_impact doit contenir au moins 30 caractères',
      },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('associations')
    .insert({
      nom,
      adresse,
      region,
      ville,
      contact_email,
      description_rapport_impact,
      capacite_max_beneficiaires: body.capacite_max_beneficiaires ?? null,
      types_aliments_acceptes: body.types_aliments_acceptes ?? null,
      horaires_ouverture: body.horaires_ouverture ?? null,
      contact_nom: body.contact_nom ?? null,
      contact_telephone: body.contact_telephone ?? null,
      habilitee_attestation_fiscale:
        body.habilitee_attestation_fiscale ?? false,
      commentaires_internes: body.commentaires_internes ?? null,
      id_point_collecte_mts1: body.id_point_collecte_mts1 ?? null,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
    })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('audit_log').insert({
    table_name: 'associations',
    record_id: (data as { id: string }).id,
    action: 'INSERT',
    user_id: auth.ctx.userId,
    new_values: data,
  });

  return NextResponse.json(data, { status: 201 });
}

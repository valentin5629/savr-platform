import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const organisation_id = searchParams.get('organisation_id');
  const lieu_id = searchParams.get('lieu_id');
  const q = searchParams.get('q');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('evenements')
    .select(
      `id, organisation_id, lieu_id, nom_evenement, date_evenement, pax,
       contact_principal_nom, contact_principal_telephone, created_at,
       organisations!organisation_id(raison_sociale),
       lieux!lieu_id(nom, ville)`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (organisation_id) query = query.eq('organisation_id', organisation_id);
  if (lieu_id) query = query.eq('lieu_id', lieu_id);
  if (q) query = query.ilike('nom_evenement', `%${q}%`);

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
    organisation_id,
    traiteur_operationnel_organisation_id,
    entite_facturation_id,
    lieu_id,
    type_evenement_id,
    pax,
    contact_principal_nom,
    contact_principal_telephone,
  } = body;

  if (
    !organisation_id ||
    !traiteur_operationnel_organisation_id ||
    !entite_facturation_id ||
    !lieu_id ||
    !type_evenement_id ||
    !pax ||
    !contact_principal_nom ||
    !contact_principal_telephone
  ) {
    return NextResponse.json(
      { error: 'Champs obligatoires manquants' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('evenements')
    .insert({
      organisation_id,
      traiteur_operationnel_organisation_id,
      entite_facturation_id,
      lieu_id,
      type_evenement_id,
      pax,
      contact_principal_nom,
      contact_principal_telephone,
      created_by: auth.ctx.userId,
      nom_evenement: body.nom_evenement ?? null,
      date_evenement: body.date_evenement ?? null,
      contact_secours_nom: body.contact_secours_nom ?? null,
      contact_secours_telephone: body.contact_secours_telephone ?? null,
      nom_client_organisateur: body.nom_client_organisateur ?? null,
      reference_affaire: body.reference_affaire ?? null,
      notes_internes: body.notes_internes ?? null,
    })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}

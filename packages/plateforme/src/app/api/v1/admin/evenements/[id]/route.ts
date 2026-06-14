import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('evenements')
    .select(
      `*, organisations!organisation_id(raison_sociale),
       lieux!lieu_id(nom, ville, adresse_acces),
       types_evenements!type_evenement_id(nom),
       collectes(id, type, statut, date_collecte, statut_tms)`,
    )
    .eq('id', id)
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json(
      { error: 'Événement introuvable' },
      { status: 404 },
    );
  }
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;

  const ALLOWED_FIELDS = [
    'nom_evenement',
    'date_evenement',
    'pax',
    'lieu_id',
    'type_evenement_id',
    'contact_principal_nom',
    'contact_principal_telephone',
    'contact_secours_nom',
    'contact_secours_telephone',
    'nom_client_organisateur',
    'logo_client_organisateur_url',
    'client_organisateur_organisation_id',
    'reference_affaire',
    'notes_internes',
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
    .from('evenements')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json(
      { error: 'Événement introuvable' },
      { status: 404 },
    );
  }
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

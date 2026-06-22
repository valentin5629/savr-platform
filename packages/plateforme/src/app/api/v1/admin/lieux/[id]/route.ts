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
    .from('lieux')
    .select('*')
    .eq('id', id)
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json({ error: 'Lieu introuvable' }, { status: 404 });
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
    'nom',
    'nom_alternatif',
    'adresse_acces',
    'code_postal',
    'ville',
    'region',
    'latitude',
    'longitude',
    'acces_details',
    'acces_office',
    'stationnement',
    'type_vehicule_max',
    'contraintes_horaires',
    'flux_autorises',
    'volume_max_bacs',
    'controle_acces_requis_default',
    'photos_urls',
    'commentaires_internes',
    'commentaire_lieu',
    'siren',
    'email_gestionnaire',
    'reference_citeo',
    'actif',
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
  const { data: before, error: fetchErr } = await supabase
    .from('lieux')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr?.code === 'PGRST116' || !before) {
    return NextResponse.json({ error: 'Lieu introuvable' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('lieux')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('audit_log').insert({
    table_name: 'lieux',
    record_id: id,
    action: 'UPDATE',
    user_id: auth.ctx.userId,
    old_values: before,
    new_values: data,
  });

  return NextResponse.json(data);
}

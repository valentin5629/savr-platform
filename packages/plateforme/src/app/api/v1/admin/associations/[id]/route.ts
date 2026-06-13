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
    .from('associations')
    .select('*')
    .eq('id', id)
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json(
      { error: 'Association introuvable' },
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

  // Champs editables par ops_savr
  const OPS_FIELDS = [
    'contact_nom',
    'contact_email',
    'contact_telephone',
    'horaires_ouverture',
    'description_rapport_impact',
    'capacite_max_beneficiaires',
    'types_aliments_acceptes',
    'commentaires_internes',
    'nom',
    'adresse',
    'ville',
    'region',
    'latitude',
    'longitude',
  ];
  // Champs admin-only
  const ADMIN_FIELDS = [
    'habilitee_attestation_fiscale',
    'id_point_collecte_mts1',
    'actif',
    'siren',
  ];

  const allowedFields =
    auth.ctx.role === 'admin_savr'
      ? [...OPS_FIELDS, ...ADMIN_FIELDS]
      : OPS_FIELDS;

  const updates = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowedFields.includes(k)),
  );

  // Ops ne peut pas modifier champs admin-only
  if (auth.ctx.role === 'ops_savr') {
    const blockedKeys = Object.keys(body).filter((k) =>
      ADMIN_FIELDS.includes(k),
    );
    if (blockedKeys.length > 0) {
      return NextResponse.json(
        { error: 'Champs réservés admin : ' + blockedKeys.join(', ') },
        { status: 403 },
      );
    }
  }

  if (
    updates.description_rapport_impact !== undefined &&
    typeof updates.description_rapport_impact === 'string' &&
    updates.description_rapport_impact.length < 30
  ) {
    return NextResponse.json(
      {
        error:
          'description_rapport_impact doit contenir au moins 30 caractères',
      },
      { status: 422 },
    );
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data: before, error: fetchErr } = await supabase
    .from('associations')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr?.code === 'PGRST116' || !before) {
    return NextResponse.json(
      { error: 'Association introuvable' },
      { status: 404 },
    );
  }

  const { data, error } = await supabase
    .from('associations')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('audit_log').insert({
    table_name: 'associations',
    record_id: id,
    action: 'UPDATE',
    user_id: auth.ctx.userId,
    old_data: before,
    new_data: data,
  });

  return NextResponse.json(data);
}

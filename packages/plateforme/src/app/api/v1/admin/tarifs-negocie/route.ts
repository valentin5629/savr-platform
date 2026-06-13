import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const organisation_id = searchParams.get('organisation_id');
  const gestionnaire_organisation_id = searchParams.get(
    'gestionnaire_organisation_id',
  );

  let query = supabase
    .from('tarifs_negocie')
    .select(
      'id, scope, organisation_id, gestionnaire_organisation_id, type_remise, remise_pct, valide_du, valide_jusqu_au, created_at',
    )
    .order('created_at', { ascending: false });

  if (organisation_id) query = query.eq('organisation_id', organisation_id);
  if (gestionnaire_organisation_id)
    query = query.eq(
      'gestionnaire_organisation_id',
      gestionnaire_organisation_id,
    );

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const {
    scope,
    organisation_id,
    gestionnaire_organisation_id,
    type_remise,
    remise_pct,
    valide_du,
  } = body as {
    scope?: string;
    organisation_id?: string;
    gestionnaire_organisation_id?: string;
    type_remise?: string;
    remise_pct?: number;
    valide_du?: string;
  };

  if (!scope || !type_remise || remise_pct === undefined || !valide_du) {
    return NextResponse.json(
      { error: 'scope, type_remise, remise_pct, valide_du sont obligatoires' },
      { status: 422 },
    );
  }
  if (scope === 'organisation' && !organisation_id) {
    return NextResponse.json(
      { error: 'organisation_id requis pour scope=organisation' },
      { status: 422 },
    );
  }
  if (scope === 'gestionnaire' && !gestionnaire_organisation_id) {
    return NextResponse.json(
      { error: 'gestionnaire_organisation_id requis pour scope=gestionnaire' },
      { status: 422 },
    );
  }
  if (remise_pct < 0 || remise_pct > 100) {
    return NextResponse.json(
      { error: 'remise_pct doit être entre 0 et 100' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('tarifs_negocie')
    .insert({
      scope,
      organisation_id,
      gestionnaire_organisation_id,
      type_remise,
      remise_pct,
      valide_du,
    })
    .select('*')
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 422 });

  try {
    await supabase.from('audit_log').insert({
      table_name: 'tarifs_negocie',
      record_id: data.id,
      action: 'creation_remise',
      user_id: auth.ctx.userId,
      new_values: { scope, organisation_id, remise_pct, valide_du },
    });
  } catch {
    /* audit failure non-bloquante */
  }

  return NextResponse.json(data, { status: 201 });
}

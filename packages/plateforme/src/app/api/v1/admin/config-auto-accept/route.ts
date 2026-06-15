import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAdmin } from '@/lib/api-auth.js';

// GET /api/v1/admin/config-auto-accept
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const organisation_id = searchParams.get('organisation_id');

  let query = supabase
    .from('config_auto_accept_ag')
    .select(
      `id, organisation_id, association_id, transporteur_id, auto_accept_actif,
       seuil_pax_min, seuil_pax_max, notes, created_at,
       organisations!organisation_id(raison_sociale),
       associations!association_id(nom),
       transporteurs!transporteur_id(nom)`,
    )
    .order('created_at', { ascending: false });

  if (organisation_id) query = query.eq('organisation_id', organisation_id);

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/v1/admin/config-auto-accept
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  if (!body.organisation_id) {
    return NextResponse.json(
      { error: 'organisation_id obligatoire' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('config_auto_accept_ag')
    .insert({
      organisation_id: body.organisation_id,
      association_id: body.association_id ?? null,
      transporteur_id: body.transporteur_id ?? null,
      auto_accept_actif: body.auto_accept_actif ?? false,
      seuil_pax_min: body.seuil_pax_min ?? null,
      seuil_pax_max: body.seuil_pax_max ?? null,
      notes: body.notes ?? null,
    })
    .select('id')
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}

// PATCH /api/v1/admin/config-auto-accept?id=…
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const id = new URL(req.url).searchParams.get('id');
  if (!id)
    return NextResponse.json({ error: 'id obligatoire' }, { status: 422 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const allowed = [
    'association_id',
    'transporteur_id',
    'auto_accept_actif',
    'seuil_pax_min',
    'seuil_pax_max',
    'notes',
  ];
  const update = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k)),
  );

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('config_auto_accept_ag')
    .update(update)
    .eq('id', id)
    .select('id, auto_accept_actif')
    .single();

  if (error) {
    if (error.code === 'PGRST116')
      return NextResponse.json(
        { error: 'Config introuvable' },
        { status: 404 },
      );
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

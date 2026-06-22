import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const actif = searchParams.get('actif');
  const ville = searchParams.get('ville');
  const q = searchParams.get('q');
  const worklist = searchParams.get('worklist');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('lieux')
    .select('*', { count: 'exact' })
    .order('nom')
    .range(offset, offset + limit - 1);

  if (actif !== null) query = query.eq('actif', actif === 'true');
  if (ville) query = query.ilike('ville', `%${ville}%`);
  if (q)
    query = query.or(
      `nom.ilike.%${q}%,ville.ilike.%${q}%,adresse_acces.ilike.%${q}%`,
    );

  const { data, error, count } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  if (worklist === 'modifs') {
    const { data: collectesOverrides } = await supabase
      .from('collectes')
      .select('lieu_overrides, evenements!inner(lieu_id)')
      .not('lieu_overrides', 'is', null);
    const lieuIdsAvecOverrides = new Set(
      (collectesOverrides ?? []).map(
        (c) => (c.evenements as unknown as { lieu_id: string }).lieu_id,
      ),
    );
    const filtered = (data ?? []).filter((l: { id: string }) =>
      lieuIdsAvecOverrides.has(l.id),
    );
    return NextResponse.json({ data: filtered, total: filtered.length });
  }

  return NextResponse.json({ data: data ?? [], total: count ?? 0 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as Record<string, unknown>;
  const { nom, adresse_acces, code_postal, ville, type_vehicule_max } = body;

  if (!nom || !adresse_acces || !code_postal || !ville || !type_vehicule_max) {
    return NextResponse.json(
      {
        error:
          'Champs obligatoires manquants : nom, adresse_acces, code_postal, ville, type_vehicule_max',
      },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('lieux')
    .insert({
      nom,
      adresse_acces,
      code_postal,
      ville,
      type_vehicule_max,
      region: body.region ?? null,
      acces_details: body.acces_details ?? null,
      acces_office: body.acces_office ?? null,
      stationnement: body.stationnement ?? null,
      flux_autorises: body.flux_autorises ?? null,
      volume_max_bacs: body.volume_max_bacs ?? null,
      controle_acces_requis_default:
        body.controle_acces_requis_default ?? false,
      commentaire_lieu: body.commentaire_lieu ?? null,
      siren: body.siren ?? null,
      email_gestionnaire: body.email_gestionnaire ?? null,
      reference_citeo: body.reference_citeo ?? false,
      actif: body.actif ?? false,
    })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('audit_log').insert({
    table_name: 'lieux',
    record_id: (data as { id: string }).id,
    action: 'INSERT',
    user_id: auth.ctx.userId,
    new_values: data,
  });

  return NextResponse.json(data, { status: 201 });
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateur } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateur(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';

  let query = supabase
    .from('lieux')
    .select(
      `id, nom, adresse_acces, code_postal, ville, acces_details,
       acces_office, stationnement, type_vehicule_max,
       controle_acces_requis_default, contraintes_horaires`,
    )
    .eq('actif', true)
    .order('nom')
    .limit(20);

  // Gestionnaire : filtré sur ses lieux uniquement
  if (auth.ctx.role === 'gestionnaire_lieux') {
    const { data: orgLieux } = await supabase
      .from('organisations_lieux')
      .select('lieu_id')
      .eq('organisation_id', auth.ctx.organisationId);

    const ids = (orgLieux ?? []).map((r: { lieu_id: string }) => r.lieu_id);
    if (ids.length === 0) return NextResponse.json([]);
    query = query.in('id', ids);
  }

  if (q) {
    query = query.or(
      `nom.ilike.%${q}%,adresse_acces.ilike.%${q}%,ville.ilike.%${q}%`,
    );
  }

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateur(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as Record<string, unknown>;
  const { nom, adresse_acces, code_postal, ville } = body;

  if (!nom || !adresse_acces || !code_postal || !ville) {
    return NextResponse.json(
      { error: 'Champs obligatoires : nom, adresse_acces, code_postal, ville' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('lieux')
    .insert({
      nom: String(nom),
      adresse_acces: String(adresse_acces),
      code_postal: String(code_postal),
      ville: String(ville),
      actif: false,
      stationnement: body.stationnement ?? null,
      type_vehicule_max: body.type_vehicule_max ?? 'camionnette',
      acces_office: body.acces_office ?? null,
      acces_details: body.acces_details ?? null,
      controle_acces_requis_default: false,
    })
    .select('id, nom, adresse_acces, code_postal, ville, actif')
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}

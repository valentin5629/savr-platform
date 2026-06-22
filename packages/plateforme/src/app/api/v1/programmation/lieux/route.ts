import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateur } from '@/lib/api-auth.js';
import { sanitizeOrTerm } from '@/lib/api-helpers.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateur(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const q = sanitizeOrTerm(searchParams.get('q') ?? ''); // C2 : neutralise l'injection .or

  // Scope org : correspond à la policy lieux_clients_select (module 0.4)
  // Lieux via organisations_lieux OU via événements de l'organisation
  // (Divergence M1_2_20260614 : nouveau traiteur sans lieux ni événements voit 0 résultats —
  //  à clarifier avec Val : faut-il rendre tous les lieux actifs visibles en autocomplete ?)
  const [{ data: orgLieux }, { data: evtLieux }] = await Promise.all([
    supabase
      .from('organisations_lieux')
      .select('lieu_id')
      .eq('organisation_id', auth.ctx.organisationId),
    supabase
      .from('evenements')
      .select('lieu_id')
      .eq('organisation_id', auth.ctx.organisationId)
      .not('lieu_id', 'is', null),
  ]);

  const uniqueIds = [
    ...new Set([
      ...(orgLieux ?? []).map((r: { lieu_id: string }) => r.lieu_id),
      ...(evtLieux ?? []).map(
        (r: { lieu_id: string | null }) => r.lieu_id as string,
      ),
    ]),
  ].filter(Boolean);

  if (uniqueIds.length === 0) return NextResponse.json([]);

  let query = supabase
    .from('lieux')
    .select(
      `id, nom, adresse_acces, code_postal, ville, acces_details,
       acces_office, stationnement, type_vehicule_max,
       controle_acces_requis_default, contraintes_horaires`,
    )
    .eq('actif', true)
    .in('id', uniqueIds)
    .order('nom')
    .limit(20);

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

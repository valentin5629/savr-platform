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
  // Toujours filtrer sur l'org du caller — jamais de param cross-org (service_role bypasse RLS)
  const orgId = auth.ctx.organisationId;

  let query = supabase
    .from('contacts_traiteurs')
    .select('id, prenom, nom, telephone, email, fonction')
    .eq('organisation_id', orgId)
    .eq('actif', true)
    .order('utilise_nb_fois', { ascending: false })
    .limit(20);

  if (q) {
    query = query.or(
      `prenom.ilike.%${q}%,nom.ilike.%${q}%,telephone.ilike.%${q}%`,
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
  const { prenom, nom, telephone } = body;

  if (!prenom || !nom || !telephone) {
    return NextResponse.json(
      { error: 'Champs obligatoires : prenom, nom, telephone' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('contacts_traiteurs')
    .upsert(
      {
        organisation_id: auth.ctx.organisationId,
        prenom: String(prenom),
        nom: String(nom),
        telephone: String(telephone),
        email: body.email ? String(body.email) : null,
        fonction: body.fonction ? String(body.fonction) : null,
        created_by: auth.ctx.userId,
      },
      { onConflict: 'organisation_id,telephone' },
    )
    .select('id, prenom, nom, telephone, email, fonction')
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}

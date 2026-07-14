import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateurOuAdmin } from '@/lib/api-auth.js';
import { sanitizeOrTerm } from '@/lib/api-helpers.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const q = sanitizeOrTerm(searchParams.get('q') ?? ''); // C2 : neutralise l'injection .or
  // Org du caller par défaut. Le param `organisation_id` (org cible) n'est honoré
  // QUE pour le staff (admin support, §06.01 l.15) — un rôle client ne peut jamais
  // élargir son scope via ce param (sinon fuite cross-org, service_role bypasse RLS).
  const orgId = auth.ctx.isAdmin
    ? searchParams.get('organisation_id')
    : auth.ctx.organisationId;
  if (!orgId) return NextResponse.json([]);

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
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as Record<string, unknown>;
  const { prenom, nom, telephone } = body;

  if (!prenom || !nom || !telephone) {
    return NextResponse.json(
      { error: 'Champs obligatoires : prenom, nom, telephone' },
      { status: 422 },
    );
  }

  // Org du contact créé : caller, ou org cible (staff-only) pour l'admin support.
  const orgId = auth.ctx.isAdmin
    ? body.organisation_id
      ? String(body.organisation_id)
      : null
    : auth.ctx.organisationId;
  if (!orgId) {
    return NextResponse.json(
      {
        error: 'organisation_id requis pour la programmation de support admin',
      },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('contacts_traiteurs')
    .upsert(
      {
        organisation_id: orgId,
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

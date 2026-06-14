import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateur } from '@/lib/api-auth.js';

// Création d'un traiteur shadow — réservé aux agences (R13)
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateur(req);
  if (auth.error) return auth.error;

  if (auth.ctx.role !== 'agence') {
    return NextResponse.json(
      { error: 'Réservé au rôle agence' },
      { status: 403 },
    );
  }

  const body = (await req.json()) as Record<string, unknown>;
  const { raison_sociale } = body;

  if (!raison_sociale) {
    return NextResponse.json(
      { error: 'Champ obligatoire : raison_sociale' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('organisations')
    .insert({
      raison_sociale: String(raison_sociale),
      nom_commercial: body.nom_commercial
        ? String(body.nom_commercial)
        : String(raison_sociale),
      type: 'traiteur',
      est_shadow: true,
      cree_par_organisation_id: auth.ctx.organisationId,
      siret: body.siret ? String(body.siret) : null,
      ville: body.ville ? String(body.ville) : null,
      actif: true,
    })
    .select('id, raison_sociale, nom_commercial, siret, est_shadow')
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}

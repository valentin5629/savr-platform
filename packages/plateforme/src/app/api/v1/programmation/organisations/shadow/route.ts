import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
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
  const { raison_sociale, nom_commercial } = body;

  if (!raison_sociale) {
    return NextResponse.json(
      { error: 'Champ obligatoire : raison_sociale' },
      { status: 422 },
    );
  }

  // nom_commercial requis, minimum 2 caractères (spec §06.01 shadow)
  const nomCommercial = nom_commercial ? String(nom_commercial) : null;
  if (!nomCommercial || nomCommercial.trim().length < 2) {
    return NextResponse.json(
      { error: 'Champ obligatoire : nom_commercial (2 caractères minimum)' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('organisations')
    .insert({
      raison_sociale: String(raison_sociale),
      nom_commercial: nomCommercial.trim(),
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

  // Notification Admin Savr pour revue manuelle (spec §06.01 shadow)
  const adminEmail = process.env.SAVR_ADMIN_EMAIL ?? 'admin@gosavr.io';
  void sendEmail(
    'traiteur_shadow_cree_revue',
    adminEmail,
    {
      nom_commercial: data.nom_commercial,
      raison_sociale: data.raison_sociale,
      agence_organisation_id: auth.ctx.organisationId,
    },
    { entityType: 'organisation', entityId: data.id },
  ).catch(() => undefined);

  return NextResponse.json(data, { status: 201 });
}

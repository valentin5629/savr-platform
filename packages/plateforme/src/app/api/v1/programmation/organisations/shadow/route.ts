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
  // « Nom commercial » du modal → colonne organisations.nom (NOT NULL).
  // organisations n'a ni colonne nom_commercial ni ville (source de vérité SIRET =
  // entites_facturation) → on ne persiste que les colonnes réelles.
  const { data, error } = await supabase
    .from('organisations')
    .insert({
      nom: nomCommercial.trim(),
      raison_sociale: String(raison_sociale),
      type: 'traiteur',
      est_shadow: true,
      cree_par_organisation_id: auth.ctx.organisationId,
      siret: body.siret ? String(body.siret) : null,
      actif: true,
    })
    .select('id, nom, raison_sociale, siret, est_shadow')
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Notification Admin in-app info-only (décision F3 — aucun email, catalogue
  // §06.02 inchangé). Dédupliquée via f_upsert_alerte_admin (service_role).
  await supabase
    .rpc('f_upsert_alerte_admin', {
      p_code: 'shadow_traiteur_cree',
      p_titre: 'Nouvelle fiche traiteur shadow créée',
      p_message: `La fiche traiteur shadow « ${data.raison_sociale}» a été créée par une agence (revue manuelle Admin).`,
      p_entity_type: 'organisations',
      p_entity_id: data.id,
    })
    .then(
      () => undefined,
      () => undefined,
    );

  return NextResponse.json(data, { status: 201 });
}

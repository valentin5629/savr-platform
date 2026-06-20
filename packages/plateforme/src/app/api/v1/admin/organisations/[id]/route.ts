import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data: org, error } = await supabase
    .from('organisations')
    .select(
      `
      id, raison_sociale, type, siret, email_principal, telephone, adresse, code_postal, ville,
      actif, logo_url, est_shadow, tarif_refacture_pax_zd, grille_tarifaire_zd_id,
      cree_par_organisation_id, created_at, updated_at,
      entites_facturation(id, raison_sociale, siret, siret_verification, tva_intracom, tva_verification, entite_par_defaut),
      organisations_domaines_email(domaine),
      users(id, prenom, nom, email, role, actif, derniere_connexion),
      packs_antgaspi(id, type_pack, credits_initiaux, credits_consommes, statut, mode_facturation, commentaires, created_at),
      tarifs_negocie(id, type_remise, remise_pct, valide_du, valide_jusqu_au, scope)
    `,
    )
    .eq('id', id)
    .single();

  if (error || !org) {
    return NextResponse.json(
      { error: 'Organisation non trouvée' },
      { status: 404 },
    );
  }

  return NextResponse.json(org);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const { id } = await params;

  // tarif_refacture_pax_zd = admin-only
  if ('tarif_refacture_pax_zd' in body && auth.ctx.role !== 'admin_savr') {
    return NextResponse.json(
      { error: 'Action réservée admin Savr' },
      { status: 403 },
    );
  }
  // grille_tarifaire_zd_id = admin-only
  if ('grille_tarifaire_zd_id' in body && auth.ctx.role !== 'admin_savr') {
    return NextResponse.json(
      { error: 'Action réservée admin Savr' },
      { status: 403 },
    );
  }

  // Champs non modifiables directement
  const { tarif_refacture_pax_zd, grille_tarifaire_zd_id, ...rest } = body;

  const updatePayload: Record<string, unknown> = { ...rest };

  if (auth.ctx.role === 'admin_savr') {
    if (tarif_refacture_pax_zd !== undefined) {
      const val = Number(tarif_refacture_pax_zd);
      if (isNaN(val) || val < 0) {
        return NextResponse.json(
          { error: 'tarif_refacture_pax_zd invalide (>= 0 requis)' },
          { status: 422 },
        );
      }
      updatePayload.tarif_refacture_pax_zd = Math.round(val * 100) / 100;
    }
    if (grille_tarifaire_zd_id !== undefined) {
      updatePayload.grille_tarifaire_zd_id = grille_tarifaire_zd_id;
    }
  }

  // Retirer les champs non éditables
  delete updatePayload.id;
  delete updatePayload.created_at;
  delete updatePayload.est_shadow;

  const supabase = createAdminSupabaseClient();
  const { data: org, error } = await supabase
    .from('organisations')
    .update(updatePayload)
    .eq('id', id)
    .select('id, raison_sociale, type, actif, tarif_refacture_pax_zd')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  if (!org) {
    return NextResponse.json(
      { error: 'Organisation non trouvée' },
      { status: 404 },
    );
  }

  return NextResponse.json(org);
}

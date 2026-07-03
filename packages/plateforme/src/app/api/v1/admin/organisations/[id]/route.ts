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

  // Colonnes/relations réelles (vérifiées contre savr-dev). L'ancien select
  // faisait planter la fiche organisation (écran blanc) sur 3 points :
  //  - `code_postal`/`ville` : colonnes INEXISTANTES sur `organisations` (400).
  //  - `tarifs_negocie` embed AMBIGU : 2 FK vers `organisations`
  //    (`organisation_id` + `gestionnaire_organisation_id`) → HTTP 300 PGRST201.
  //    Désambiguïsé sur `!organisation_id` (les remises propres à l'orga).
  //  - `tarifs_negocie.type_remise` : colonne INEXISTANTE, réelle = `activite`.
  // Vérifié : HTTP 200 (1 entité, 2 users, 1 pack, 1 remise pour Kaspia).
  const { data: org, error } = await supabase
    .from('organisations')
    .select(
      `
      id, raison_sociale, type, siret, email_principal, telephone, adresse,
      actif, logo_url, est_shadow, tarif_refacture_pax_zd, grille_tarifaire_zd_id,
      cree_par_organisation_id, created_at, updated_at,
      entites_facturation(id, raison_sociale, siret, siret_verification, tva_intracom, tva_verification, entite_par_defaut),
      organisations_domaines_email(domaine),
      users(id, prenom, nom, email, role, actif, derniere_connexion),
      packs_antgaspi(id, type_pack, credits_initiaux, credits_consommes, statut, mode_facturation, commentaires, created_at),
      tarifs_negocie!organisation_id(id, activite, remise_pct, valide_du, valide_jusqu_au, scope)
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

  // M8 : ALLOWLIST explicite des colonnes éditables. Avant, `...rest` recopiait
  // n'importe quelle clé du body dans l'UPDATE service_role (RLS off) → un staff
  // ops_savr pouvait écrire des colonnes système/sensibles (est_shadow,
  // cree_par_organisation_id, id, created_at…). On ne recopie que des champs
  // métier connus. tarif_refacture_pax_zd / grille_tarifaire_zd_id restent
  // admin-only (gérés séparément ci-dessous).
  // Colonnes réelles de plateforme.organisations éditables en back-office.
  // Exclues : id, est_shadow, cree_par_organisation_id, created_at, updated_at
  // (système) + tarif_refacture_pax_zd, grille_tarifaire_zd_id (admin-only,
  // gérés ci-dessous). NB : code_postal/ville n'existent PAS sur organisations.
  const EDITABLE_FIELDS = [
    'nom',
    'raison_sociale',
    'type',
    'siret',
    'email_principal',
    'telephone',
    'adresse',
    'logo_url',
    'notes_internes',
    'actif',
    'mode_facturation_zd',
  ];

  const updatePayload: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) updatePayload[field] = body[field];
  }

  if (auth.ctx.role === 'admin_savr') {
    if (body.tarif_refacture_pax_zd !== undefined) {
      const val = Number(body.tarif_refacture_pax_zd);
      if (isNaN(val) || val < 0) {
        return NextResponse.json(
          { error: 'tarif_refacture_pax_zd invalide (>= 0 requis)' },
          { status: 422 },
        );
      }
      updatePayload.tarif_refacture_pax_zd = Math.round(val * 100) / 100;
    }
    if (body.grille_tarifaire_zd_id !== undefined) {
      updatePayload.grille_tarifaire_zd_id = body.grille_tarifaire_zd_id;
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // §07/06 tarif_refacture_pax_zd_update — capture l'ancienne valeur AVANT l'UPDATE.
  // Seule mutation d'organisation auditée (§2) ; les autres champs (raison_sociale,
  // siret, adresse…) ne sont PAS au catalogue → pas d'audit.
  const tarifChange = updatePayload.tarif_refacture_pax_zd !== undefined;
  let ancienTarif: number | null = null;
  if (tarifChange) {
    const { data: prev } = await supabase
      .from('organisations')
      .select('tarif_refacture_pax_zd')
      .eq('id', id)
      .single();
    ancienTarif =
      (prev as { tarif_refacture_pax_zd: number | null } | null)
        ?.tarif_refacture_pax_zd ?? null;
  }

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

  if (tarifChange) {
    await supabase.from('audit_log').insert({
      action: 'tarif_refacture_pax_zd_update',
      table_name: 'organisations',
      record_id: id,
      user_id: auth.ctx.userId,
      old_values: { tarif_refacture_pax_zd: ancienTarif },
      new_values: {
        tarif_refacture_pax_zd: updatePayload.tarif_refacture_pax_zd,
      },
    });
  }

  return NextResponse.json(org);
}

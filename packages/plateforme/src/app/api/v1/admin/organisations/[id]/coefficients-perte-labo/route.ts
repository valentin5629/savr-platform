import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';
import { serverError, writeError } from '@/lib/api-helpers.js';

// Coefficient de perte labo par traiteur × année (CDC §08 §9bis).
// L'organisation est CONTEXTUELLE (fiche traiteur) → portée par le PATH
// `/admin/organisations/{id}/…`, jamais par le body (BL-P2-32). Écran réservé
// aux traiteurs (§06.06 §8 : onglet visible uniquement si `type='traiteur'`).

// GET §9bis.1 — liste antéchronologique des coefficients du traiteur.
// Lecture admin_savr + ops_savr. `annee_application = annee_reference + 1`
// (calculé côté serveur, non stocké).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id: organisation_id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('coefficients_perte_labo')
    .select(
      'id, organisation_id, annee_reference, coefficient_kg_couvert, source_commentaire, saisi_par, saisi_le, saisi_par_user:users!saisi_par(prenom, nom)',
    )
    .eq('organisation_id', organisation_id)
    .order('annee_reference', { ascending: false });

  if (error) return serverError(error, 'admin.coefficients_perte_labo.list');

  // `annee_application` dérivée (CDC §9bis.1 : « annee_reference + 1, calculé
  // côté serveur, non stocké »).
  const rows = (data ?? []).map((c) => ({
    ...c,
    annee_application: c.annee_reference + 1,
  }));

  return NextResponse.json({ data: rows });
}

// POST §9bis.2 — créer un coefficient pour le traiteur du path.
// Écriture admin_savr uniquement. Erreurs typées : 422 (org non traiteur /
// année hors borne / coefficient < 0), 404 (org inconnue), 409 (doublon année).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { id: organisation_id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const { annee_reference, coefficient_kg_couvert, source_commentaire } =
    body as {
      annee_reference?: number;
      coefficient_kg_couvert?: number;
      source_commentaire?: string;
    };

  if (annee_reference === undefined || coefficient_kg_couvert === undefined) {
    return NextResponse.json(
      {
        error: 'annee_reference, coefficient_kg_couvert sont obligatoires',
      },
      { status: 422 },
    );
  }
  if (
    !Number.isInteger(annee_reference) ||
    annee_reference < 2020 ||
    annee_reference > 2100
  ) {
    return NextResponse.json(
      { error: 'annee_reference invalide (2020-2100)' },
      { status: 422 },
    );
  }
  if (
    typeof coefficient_kg_couvert !== 'number' ||
    coefficient_kg_couvert < 0
  ) {
    return NextResponse.json(
      { error: 'coefficient_kg_couvert doit être >= 0' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Contrôle `type='traiteur'` (CDC §9bis.2 : « organisation_id doit pointer une
  // organisation type='traiteur', sinon 422 »). Org inconnue → 404.
  const { data: org } = await supabase
    .from('organisations')
    .select('id, type')
    .eq('id', organisation_id)
    .maybeSingle();

  if (!org) {
    return NextResponse.json(
      { error: 'Organisation introuvable' },
      { status: 404 },
    );
  }
  if (org.type !== 'traiteur') {
    return NextResponse.json(
      { error: 'Coefficient de perte labo réservé aux traiteurs' },
      { status: 422 },
    );
  }

  const { data, error } = await supabase
    .from('coefficients_perte_labo')
    .insert({
      organisation_id,
      annee_reference,
      coefficient_kg_couvert,
      source_commentaire,
      saisi_par: auth.ctx.userId,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        {
          error:
            'Un coefficient existe déjà pour cette organisation et cette année (utiliser la modification)',
        },
        { status: 409 },
      );
    }
    // 422 neutre sans fuite du détail Postgres (C1).
    return writeError(error, 'admin.coefficients_perte_labo.create');
  }

  try {
    await supabase.from('audit_log').insert({
      table_name: 'coefficients_perte_labo',
      record_id: data.id,
      action: 'creation_coefficient',
      user_id: auth.ctx.userId,
      new_values: { organisation_id, annee_reference, coefficient_kg_couvert },
    });
  } catch {
    /* audit failure non-bloquante */
  }

  return NextResponse.json(
    { ...data, annee_application: data.annee_reference + 1 },
    { status: 201 },
  );
}

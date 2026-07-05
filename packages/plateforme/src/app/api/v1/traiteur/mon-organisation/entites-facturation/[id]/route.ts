import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { verifySiret, isValidSiretFormat } from '@savr/shared/src/api/siret.js';
import { enqueueSiretRevalidation } from '@savr/shared/src/siret/revalidation.js';

// CDC §06.04 §6 (l.661) — modification / suppression d'une entité de facturation
// par le MANAGER (own-org, RLS ef_manager_write). Un changement de SIRET relance
// la vérification INSEE. La suppression est un SOFT-DELETE (actif=false) : la FK
// evenements.entite_facturation_id (NOT NULL) interdit le hard-delete.

const MANAGER_ROLE: ClientRole[] = ['traiteur_manager'];

const SELECT_COLS =
  'id, raison_sociale, siret, tva_intracom, adresse_facturation, code_postal, ' +
  'ville, pays, email_facturation, contact_compta_nom, siret_verification, ' +
  'tva_verification, entite_par_defaut, actif, created_at';

const EDITABLE = new Set([
  'raison_sociale',
  'tva_intracom',
  'adresse_facturation',
  'code_postal',
  'ville',
  'email_facturation',
  'contact_compta_nom',
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, MANAGER_ROLE);
  if (auth.error) return auth.error;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const admin = createAdminSupabaseClient();

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (EDITABLE.has(k)) patch[k] = v;
  }

  // Changement de SIRET → re-vérification (mêmes règles que l'ajout).
  let verdict: 'verifie' | 'echec' | 'down' | null = null;
  if (typeof body.siret === 'string') {
    const siret = body.siret.trim();
    if (!isValidSiretFormat(siret))
      return NextResponse.json(
        { error: 'SIRET invalide (14 chiffres attendus)' },
        { status: 422 },
      );
    // Doublon sur une AUTRE entité (service_role : cross-org invisible en RLS).
    const { data: doublon } = await admin
      .from('entites_facturation')
      .select('id')
      .eq('siret', siret)
      .neq('id', id)
      .maybeSingle();
    if (doublon)
      return NextResponse.json(
        { error: 'Ce SIRET est déjà rattaché à une entité de facturation.' },
        { status: 409 },
      );
    verdict = await verifySiret(siret);
    if (verdict === 'echec')
      return NextResponse.json(
        { error: 'SIRET inexistant ou entreprise inactive (INSEE).' },
        { status: 422 },
      );
    patch.siret = siret;
    patch.siret_verification = verdict === 'verifie' ? 'verifie' : 'en_attente';
    patch.siret_verifie_le =
      verdict === 'verifie' ? new Date().toISOString() : null;
  }

  // entite_par_defaut : un seul actif par org → dé-flag les autres d'abord.
  if (body.entite_par_defaut === true) {
    await supabase
      .from('entites_facturation')
      .update({ entite_par_defaut: false })
      .eq('organisation_id', auth.ctx.organisationId)
      .eq('entite_par_defaut', true);
    patch.entite_par_defaut = true;
  }

  if (Object.keys(patch).length === 0)
    return NextResponse.json(
      { error: 'Aucun champ éditable fourni' },
      { status: 400 },
    );

  // UPDATE via RLS (ef_manager_write) : own-org garanti par la base.
  const { data, error } = await supabase
    .from('entites_facturation')
    .update(patch)
    .eq('id', id)
    .select(SELECT_COLS)
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 422 });
  if (!data)
    return NextResponse.json(
      { error: 'Entité non trouvée ou hors de votre organisation' },
      { status: 404 },
    );

  if (verdict === 'down')
    await enqueueSiretRevalidation(admin, id).catch(() => null);

  return NextResponse.json({ data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, MANAGER_ROLE);
  if (auth.error) return auth.error;
  const { id } = await params;

  const supabase = createSupabaseServerClient();

  // Lecture own-org (RLS) pour garde métier : on ne supprime pas l'entité par
  // défaut (elle porte la facturation courante).
  const { data: cible } = await supabase
    .from('entites_facturation')
    .select('id, entite_par_defaut, actif')
    .eq('id', id)
    .maybeSingle();
  if (!cible)
    return NextResponse.json(
      { error: 'Entité non trouvée ou hors de votre organisation' },
      { status: 404 },
    );
  if ((cible as { entite_par_defaut: boolean }).entite_par_defaut)
    return NextResponse.json(
      {
        error:
          "L'entité de facturation par défaut ne peut pas être supprimée. Désignez-en une autre par défaut d'abord.",
      },
      { status: 409 },
    );

  // SOFT-DELETE : actif=false (la FK evenements.entite_facturation_id est NOT NULL,
  // un hard-delete casserait l'historique). RLS ef_manager_write garantit own-org.
  const { data, error } = await supabase
    .from('entites_facturation')
    .update({ actif: false })
    .eq('id', id)
    .select('id, actif')
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 422 });
  if (!data)
    return NextResponse.json(
      { error: 'Entité non trouvée ou hors de votre organisation' },
      { status: 404 },
    );

  return NextResponse.json({ data });
}

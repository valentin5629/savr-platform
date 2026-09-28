import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { writeError } from '@/lib/api-helpers.js';
import { parseCleLogo } from '@/lib/logo-key.js';
import {
  auditerInfosLegales,
  lireInfosLegalesAvant,
  lireProfilOrganisation,
  PROFIL_ORG_COLUMNS,
  validerInfosLegales,
} from '@/lib/organisation-infos-legales.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/mon-organisation/profil
// PATCH /api/v1/gestionnaire/mon-organisation/profil
// Profil de SA propre organisation (§06.05 nav 8 → réutilise §06.04 §6).
// Filtre explicite `id = organisationId` (défense en profondeur) : depuis
// 20260921090000 la RLS ne rend au gestionnaire que sa propre ligne (les traiteurs
// tiers passent par la vue v_traiteurs_gestionnaire), mais le filtre reste la
// garantie d'une ligne unique si une policy s'élargit.
// Colonnes = colonnes RÉELLES de plateforme.organisations.
// Champs éditables : §06.05 §6 Bloc Organisation (adresse, logo_url) + raison
// sociale et SIRET (décision Val 2026-09-28 — informations légales modifiables par
// tous les rôles ; le CDC les réservait à l'Admin). Nom en lecture seule
// (modification via support). Garde DB : trigger trg_block_org_gestionnaire_cols_update.

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  return lireProfilOrganisation(
    auth.ctx.organisationId,
    'gestionnaire.mon_organisation.profil.list',
  );
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  // Informations légales : validation commune (lib/organisation-infos-legales).
  const valide = validerInfosLegales(body);
  if ('error' in valide) return valide.error;
  const patch: Record<string, unknown> = { ...valide.patch };
  if ('logo_url' in body) patch.logo_url = body.logo_url;
  if (Object.keys(patch).length === 0)
    return NextResponse.json(
      { error: 'Aucun champ éditable fourni' },
      { status: 400 },
    );
  // logo_url = uniquement une clé produite par POST /logo (lib/logo-key.ts,
  // même garde que les lecteurs R2 et que le trigger trg_garde_format_logo).
  if ('logo_url' in patch && !parseCleLogo(patch.logo_url as string | null))
    return NextResponse.json({ error: 'Logo invalide' }, { status: 422 });

  // Anciennes valeurs des champs légaux, pour l'audit (§06.04 §6 l.660).
  const before = await lireInfosLegalesAvant(
    supabase,
    auth.ctx.organisationId,
    patch,
  );

  const { data, error } = await supabase
    .from('organisations')
    .update(patch)
    .eq('id', auth.ctx.organisationId)
    .select(PROFIL_ORG_COLUMNS)
    .maybeSingle();

  if (error)
    return writeError(error, 'gestionnaire.mon_organisation.profil.update');
  if (!data)
    return NextResponse.json(
      { error: 'Organisation non trouvée' },
      { status: 404 },
    );

  await auditerInfosLegales(
    before,
    patch,
    auth.ctx.organisationId,
    auth.ctx.userId,
  );
  return NextResponse.json({ data });
}

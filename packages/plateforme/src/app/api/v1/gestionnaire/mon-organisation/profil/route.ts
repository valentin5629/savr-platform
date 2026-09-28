import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError, writeError } from '@/lib/api-helpers.js';
import { parseCleLogo } from '@/lib/logo-key.js';
import {
  auditerInfosLegales,
  INFOS_LEGALES,
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

const PROFIL_COLUMNS =
  'id, nom, raison_sociale, siret, adresse, email_principal, telephone, logo_url';

const EDITABLE_FIELDS = new Set<string>([...INFOS_LEGALES, 'logo_url']);

const LONGUEUR_MAX = 500;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from('organisations')
    .select(PROFIL_COLUMNS)
    .eq('id', auth.ctx.organisationId)
    .maybeSingle();

  if (error)
    return serverError(error, 'gestionnaire.mon_organisation.profil.list');
  if (!data)
    return NextResponse.json(
      { error: 'Organisation non trouvée' },
      { status: 404 },
    );

  return NextResponse.json({ data });
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

  // Filtrer les champs non autorisés
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (EDITABLE_FIELDS.has(k)) patch[k] = v;
  }
  if (Object.keys(patch).length === 0)
    return NextResponse.json(
      { error: 'Aucun champ éditable fourni' },
      { status: 400 },
    );

  const LIBELLES: Record<(typeof INFOS_LEGALES)[number], string> = {
    raison_sociale: 'Raison sociale',
    siret: 'SIRET',
    adresse: 'Adresse',
  };
  for (const field of INFOS_LEGALES) {
    if (!(field in patch)) continue;
    const v = patch[field];
    if (typeof v !== 'string')
      return NextResponse.json(
        { error: `${LIBELLES[field]} invalide` },
        { status: 422 },
      );
    const valeur = v.trim();
    if (valeur.length > LONGUEUR_MAX)
      return NextResponse.json(
        { error: `${LIBELLES[field]} : ${LONGUEUR_MAX} caractères maximum` },
        { status: 422 },
      );
    patch[field] = valeur === '' ? null : valeur;
  }
  // logo_url = uniquement une clé produite par POST /logo (lib/logo-key.ts,
  // même garde que les lecteurs R2 et que le trigger trg_garde_format_logo).
  if ('logo_url' in patch && !parseCleLogo(patch.logo_url as string | null))
    return NextResponse.json({ error: 'Logo invalide' }, { status: 422 });

  // Anciennes valeurs des champs légaux, pour l'audit (§06.04 §6 l.660).
  const { data: before } = await supabase
    .from('organisations')
    .select('raison_sociale, siret, adresse')
    .eq('id', auth.ctx.organisationId)
    .maybeSingle();

  const { data, error } = await supabase
    .from('organisations')
    .update(patch)
    .eq('id', auth.ctx.organisationId)
    .select(PROFIL_COLUMNS)
    .maybeSingle();

  if (error)
    return writeError(error, 'gestionnaire.mon_organisation.profil.update');
  if (!data)
    return NextResponse.json(
      { error: 'Organisation non trouvée' },
      { status: 404 },
    );

  await auditerInfosLegales(
    before as Record<string, unknown> | null,
    patch,
    auth.ctx.organisationId,
    auth.ctx.userId,
  );
  return NextResponse.json({ data });
}

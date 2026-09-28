import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/api-auth.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { messageErreur, serverError, writeError } from '@/lib/api-helpers.js';

// Informations légales de SA propre organisation — lecture + édition partagées par
// les espaces clients (décision Val 2026-09-28 : modifiables par tous les rôles).
// Garde DB : policies UPDATE own-org + trigger trg_block_org_gestionnaire_cols_update
// (liste blanche par rôle, migration 20260928100000).

export const PROFIL_ORG_COLUMNS =
  'id, nom, raison_sociale, siret, adresse, email_principal, telephone, logo_url';

// Champs dont toute modification est auditée (CDC §06.04 §6 : « toute modification
// est loguée dans audit_log »).
export const INFOS_LEGALES = ['raison_sociale', 'siret', 'adresse'] as const;

const LONGUEUR_MAX = 500;

type ChampLegal = (typeof INFOS_LEGALES)[number];

const LIBELLES: Record<ChampLegal, string> = {
  raison_sociale: 'Raison sociale',
  siret: 'SIRET',
  adresse: 'Adresse',
};

type ClientSupabase = ReturnType<typeof createSupabaseServerClient>;

// Validation commune des informations légales présentes dans `body` (les autres
// clés sont ignorées) : chaîne ou null, espaces retirés, chaîne vide → null,
// 500 caractères maximum. Partagée par toutes les routes « Mon organisation ».
export function validerInfosLegales(
  body: Record<string, unknown>,
): { patch: Record<string, string | null> } | { error: NextResponse } {
  const patch: Record<string, string | null> = {};
  for (const field of INFOS_LEGALES) {
    if (!(field in body)) continue;
    const v = body[field];
    if (v !== null && typeof v !== 'string')
      return {
        error: NextResponse.json(
          { error: `${LIBELLES[field]} : valeur invalide` },
          { status: 422 },
        ),
      };
    const valeur = (v ?? '').trim();
    if (valeur.length > LONGUEUR_MAX)
      return {
        error: NextResponse.json(
          { error: `${LIBELLES[field]} : ${LONGUEUR_MAX} caractères maximum` },
          { status: 422 },
        ),
      };
    patch[field] = valeur === '' ? null : valeur;
  }
  return { patch };
}

// Anciennes valeurs des champs légaux, lues AVANT l'UPDATE pour l'audit. Rien à
// lire si le patch ne touche aucun champ légal (ex. logo seul).
export async function lireInfosLegalesAvant(
  supabase: ClientSupabase,
  organisationId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!INFOS_LEGALES.some((f) => f in patch)) return null;
  const { data, error } = await supabase
    .from('organisations')
    .select('raison_sociale, siret, adresse')
    .eq('id', organisationId)
    .maybeSingle();
  if (error)
    logger.error('organisation.infos_legales.lecture_avant_echec', {
      organisation_id: organisationId,
      error: messageErreur(error),
    });
  return (data as Record<string, unknown> | null) ?? null;
}

// Écrit une ligne audit_log par champ légal réellement modifié. service_role :
// audit_log est staff-only en lecture, l'INSERT passe par le client admin.
export async function auditerInfosLegales(
  before: Record<string, unknown> | null,
  patch: Record<string, unknown>,
  organisationId: string,
  userId: string,
): Promise<void> {
  const beforeVals = before ?? {};
  const admin = createAdminSupabaseClient();
  for (const field of INFOS_LEGALES) {
    if (!(field in patch)) continue;
    const oldVal = beforeVals[field] ?? null;
    const newVal = patch[field] ?? null;
    if (oldVal === newVal) continue;
    const { error } = await admin.from('audit_log').insert({
      action: 'organisation_infos_legales_update',
      table_name: 'organisations',
      record_id: organisationId,
      user_id: userId,
      old_values: { [field]: oldVal },
      new_values: { [field]: newVal },
    });
    // La modification est déjà écrite : l'échec d'audit ne l'annule pas, mais ne
    // doit pas passer sous silence.
    if (error)
      logger.error('organisation.infos_legales.audit_echec', {
        organisation_id: organisationId,
        champ: field,
        error: messageErreur(error),
      });
  }
}

export async function lireProfilOrganisation(
  organisationId: string,
  logCtx: string,
): Promise<NextResponse> {
  const supabase = createSupabaseServerClient();
  // Filtre `id` indispensable : l'agence voit aussi ses fiches shadow.
  const { data, error } = await supabase
    .from('organisations')
    .select(PROFIL_ORG_COLUMNS)
    .eq('id', organisationId)
    .maybeSingle();

  if (error) return serverError(error, logCtx);
  if (!data)
    return NextResponse.json(
      { error: 'Organisation non trouvée' },
      { status: 404 },
    );
  return NextResponse.json({ data });
}

// PATCH des seules informations légales (raison_sociale, siret, adresse).
export async function modifierInfosLegales(
  req: NextRequest,
  ctx: { userId: string; organisationId: string },
  logCtx: string,
): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const valide = validerInfosLegales(body);
  if ('error' in valide) return valide.error;
  const { patch } = valide;
  if (Object.keys(patch).length === 0)
    return NextResponse.json(
      { error: 'Aucun champ éditable fourni' },
      { status: 400 },
    );

  const supabase = createSupabaseServerClient();
  const before = await lireInfosLegalesAvant(
    supabase,
    ctx.organisationId,
    patch,
  );

  const { data, error } = await supabase
    .from('organisations')
    .update(patch)
    .eq('id', ctx.organisationId)
    .select(PROFIL_ORG_COLUMNS)
    .maybeSingle();

  if (error) return writeError(error, logCtx);
  if (!data)
    return NextResponse.json(
      { error: 'Organisation non trouvée' },
      { status: 404 },
    );

  await auditerInfosLegales(before, patch, ctx.organisationId, ctx.userId);
  return NextResponse.json({ data });
}

import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { writeError } from '@/lib/api-helpers.js';
import {
  auditerInfosLegales,
  lireInfosLegalesAvant,
  lireProfilOrganisation,
  PROFIL_ORG_COLUMNS,
  validerInfosLegales,
} from '@/lib/organisation-infos-legales.js';

// CDC §06.04 §6 « Mon organisation » (l.646-664).
// GET : lecture des informations légales de SA propre organisation (manager +
//       commercial — RLS org-scoped).
// PATCH : manager seul = informations légales + logo (l.660). Le commercial est
//       en lecture seule (tableau des droits l.652 ; Val 2026-10-30, retour sur
//       la décision du 2026-09-28). Garde DB : la policy org_commercial_update
//       est retirée (20261030140000).
//
// « SIREN » du CDC = colonne shadow `organisations.siret` (la source de vérité
// SIRET reste `entites_facturation` ; l'org.siret ne gate rien). L'édition des
// infos légales ne déclenche PAS de revalidation INSEE (seule l'entité de
// facturation est vérifiée, cf. route entites-facturation).
//
// AUDIT : toute modification des informations légales (raison_sociale, siret,
// adresse) est loguée dans `audit_log` (l.660), via service_role (audit_log est
// staff-only en lecture, l'INSERT passe par le client admin).

const READ_ROLES: ClientRole[] = ['traiteur_manager', 'traiteur_commercial'];
const WRITE_ROLES: ClientRole[] = ['traiteur_manager'];

// Champs éditables (manager) : informations légales (lib/organisation-infos-legales)
// + logo_url.
// Le « Contact principal facturation » du §6 (email qui reçoit les factures) n'a
// PAS de home org-level : sa colonne réelle est `entites_facturation.email_facturation`
// (par entité), éditée via la route entites-facturation. Les « coordonnées
// bancaires » du §6 sont NON implémentées (contradiction l.678↔l.701 + aucune
// colonne) — cf. _Divergences M3.1_20260705_facturation_params.

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, READ_ROLES);
  if (auth.error) return auth.error;
  return lireProfilOrganisation(
    auth.ctx.organisationId,
    'traiteur.mon_organisation.profil.list',
  );
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, WRITE_ROLES);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  // Informations légales : validation commune (lib/organisation-infos-legales) ;
  // logo : format garanti par le trigger trg_garde_format_logo.
  const valide = validerInfosLegales(body);
  if ('error' in valide) return valide.error;
  const patch: Record<string, unknown> = { ...valide.patch };
  if ('logo_url' in body) patch.logo_url = body.logo_url;
  if (Object.keys(patch).length === 0)
    return NextResponse.json(
      { error: 'Aucun champ éditable fourni' },
      { status: 400 },
    );

  const supabase = createSupabaseServerClient();
  const before = await lireInfosLegalesAvant(
    supabase,
    auth.ctx.organisationId,
    patch,
  );

  // UPDATE via le client RLS : la policy `org_manager_update` garantit le périmètre own-org (jamais l'org d'un
  // autre, même si le JWT était falsifié).
  const { data, error } = await supabase
    .from('organisations')
    .update(patch)
    .eq('id', auth.ctx.organisationId)
    .select(PROFIL_ORG_COLUMNS)
    .maybeSingle();

  if (error)
    return writeError(error, 'traiteur.mon_organisation.profil.update');
  if (!data)
    return NextResponse.json(
      { error: 'Organisation non trouvée' },
      { status: 404 },
    );

  // Audit des champs légaux réellement modifiés (l.660).
  await auditerInfosLegales(
    before,
    patch,
    auth.ctx.organisationId,
    auth.ctx.userId,
  );

  return NextResponse.json({ data });
}

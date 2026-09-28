import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { writeError, serverError } from '@/lib/api-helpers.js';
import {
  auditerInfosLegales,
  INFOS_LEGALES,
} from '@/lib/organisation-infos-legales.js';

// CDC §06.04 §6 « Mon organisation » (l.646-664).
// GET : lecture des informations légales de SA propre organisation (manager +
//       commercial — RLS org-scoped).
// PATCH : manager = informations légales + logo (l.660). Commercial = informations
//       légales seules (raison sociale, SIRET, adresse) — décision Val 2026-09-28,
//       écart au tableau des droits l.652 (commercial en lecture seule) ; le logo
//       reste manager only. Garde DB : policy org_commercial_update + liste blanche
//       du trigger trg_block_org_gestionnaire_cols_update (20260928100000).
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

// Champs éditables par le manager (colonnes RÉELLES de plateforme.organisations).
// Le « Contact principal facturation » du §6 (email qui reçoit les factures) n'a
// PAS de home org-level : sa colonne réelle est `entites_facturation.email_facturation`
// (par entité), éditée via la route entites-facturation. Les « coordonnées
// bancaires » du §6 sont NON implémentées (contradiction l.678↔l.701 + aucune
// colonne) — cf. _Divergences M3.1_20260705_facturation_params.
const EDITABLE_MANAGER = new Set<string>([...INFOS_LEGALES, 'logo_url']);
const EDITABLE_COMMERCIAL = new Set<string>(INFOS_LEGALES);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, READ_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('organisations')
    .select(
      'id, nom, raison_sociale, siret, adresse, email_principal, telephone, logo_url',
    )
    .eq('id', auth.ctx.organisationId)
    .maybeSingle();

  if (error) return serverError(error, 'traiteur.mon_organisation.profil.list');
  if (!data)
    return NextResponse.json(
      { error: 'Organisation non trouvée' },
      { status: 404 },
    );

  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, READ_ROLES);
  if (auth.error) return auth.error;
  const editable =
    auth.ctx.role === 'traiteur_manager'
      ? EDITABLE_MANAGER
      : EDITABLE_COMMERCIAL;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (editable.has(k)) patch[k] = v;
  }
  if (Object.keys(patch).length === 0)
    return NextResponse.json(
      { error: 'Aucun champ éditable fourni' },
      { status: 400 },
    );

  const supabase = createSupabaseServerClient();

  // Capture des anciennes valeurs des champs légaux AVANT l'UPDATE (pour l'audit).
  const { data: before } = await supabase
    .from('organisations')
    .select('raison_sociale, siret, adresse')
    .eq('id', auth.ctx.organisationId)
    .maybeSingle();

  // UPDATE via le client RLS : les policies `org_manager_update` /
  // `org_commercial_update` garantissent le périmètre own-org (jamais l'org d'un
  // autre, même si le JWT était falsifié).
  const { data, error } = await supabase
    .from('organisations')
    .update(patch)
    .eq('id', auth.ctx.organisationId)
    .select(
      'id, nom, raison_sociale, siret, adresse, email_principal, telephone, logo_url',
    )
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
    before as Record<string, unknown> | null,
    patch,
    auth.ctx.organisationId,
    auth.ctx.userId,
  );

  return NextResponse.json({ data });
}

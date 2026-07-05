import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

// CDC §06.04 §6 « Mon organisation » (l.646-664).
// GET : lecture des informations légales de SA propre organisation (manager +
//       commercial — RLS org-scoped).
// PATCH : édition MANAGER only (l.660 « modifiables par le manager »). Le
//       commercial est read-only sur Infos/Logo (l.652, tableau des droits).
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
const MANAGER_ROLE: ClientRole[] = ['traiteur_manager'];

// Champs éditables par le manager (colonnes RÉELLES de plateforme.organisations).
// Le « Contact principal facturation » du §6 (email qui reçoit les factures) n'a
// PAS de home org-level : sa colonne réelle est `entites_facturation.email_facturation`
// (par entité), éditée via la route entites-facturation. Les « coordonnées
// bancaires » du §6 sont NON implémentées (contradiction l.678↔l.701 + aucune
// colonne) — cf. _Divergences M3.1_20260705_facturation_params.
const EDITABLE_FIELDS = new Set([
  'raison_sociale',
  'siret',
  'adresse',
  'logo_url',
]);
// Champs « informations légales » dont toute modification est auditée (l.660).
const AUDITED_FIELDS = ['raison_sociale', 'siret', 'adresse'] as const;

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

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)
    return NextResponse.json(
      { error: 'Organisation non trouvée' },
      { status: 404 },
    );

  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, MANAGER_ROLE);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (EDITABLE_FIELDS.has(k)) patch[k] = v;
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

  // UPDATE via le client RLS : la policy `org_manager_update` garantit le
  // périmètre own-org (jamais l'org d'un autre, même si le JWT était falsifié).
  const { data, error } = await supabase
    .from('organisations')
    .update(patch)
    .eq('id', auth.ctx.organisationId)
    .select(
      'id, nom, raison_sociale, siret, adresse, email_principal, telephone, logo_url',
    )
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 422 });
  if (!data)
    return NextResponse.json(
      { error: 'Organisation non trouvée' },
      { status: 404 },
    );

  // Audit des champs légaux réellement modifiés (l.660). service_role : audit_log
  // est staff-only en lecture, l'INSERT passe par le client admin.
  const beforeVals = (before ?? {}) as Record<string, unknown>;
  const admin = createAdminSupabaseClient();
  for (const field of AUDITED_FIELDS) {
    if (!(field in patch)) continue;
    const oldVal = beforeVals[field] ?? null;
    const newVal = patch[field] ?? null;
    if (oldVal === newVal) continue;
    await admin.from('audit_log').insert({
      action: 'organisation_infos_legales_update',
      table_name: 'organisations',
      record_id: auth.ctx.organisationId,
      user_id: auth.ctx.userId,
      old_values: { [field]: oldVal },
      new_values: { [field]: newVal },
    });
  }

  return NextResponse.json({ data });
}

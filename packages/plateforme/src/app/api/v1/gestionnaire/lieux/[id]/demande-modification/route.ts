import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { readJsonBody, serverError } from '@/lib/api-helpers.js';
import { estUuid } from '@/lib/filtre-csv.js';
import {
  CODE_ALERTE_LIEU_MODIFICATION,
  ENTITE_ALERTE_LIEU,
  normaliserDemande,
} from '@/lib/lieux/demande-modification.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// POST /api/v1/gestionnaire/lieux/[id]/demande-modification
// « Demande de modification d'information » de la fiche lieu du gestionnaire
// (§06.05 §3 — arbitrage Val 2026-10-06). Le gestionnaire n'écrit JAMAIS le
// référentiel lieux (§04 : modifiable par l'Admin Savr uniquement ; écriture
// de `lieux` fermée à `authenticated`, migration 20260921210000). Cette route
// ne touche pas la table `lieux` : elle ouvre une alerte dans la file in-app
// de l'Admin, qui corrige la fiche depuis le back-office.
//
//  · alerte in-app seule (alertes_admin) : ni email, ni Slack (§07 Obs /03 §3) ;
//  · le lieu est d'abord lu avec la session de l'utilisateur (v_lieux_clients,
//    RLS lieux_clients_select) : un lieu qu'il ne lit pas répond 404, et rien
//    n'est écrit. L'écriture part ensuite en service-role, alertes_admin étant
//    fermée aux rôles clients ;
//  · le seul texte libre lu dans la requête est `texte`, borné et validé
//    (lib/lieux/demande-modification) ; il est affiché en texte brut par
//    l'écran Admin des alertes ;
//  · une demande OUVERTE par lieu : tant que l'Admin n'a pas résolu l'alerte,
//    une nouvelle demande est refusée (409) au lieu d'être perdue en silence
//    (f_upsert_alerte_admin n'insère pas de doublon ouvert) ;
//  · l'auteur est tracé dans audit_log (historique de la fiche lieu Admin),
//    alertes_admin ne portant pas de colonne auteur.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!estUuid(id))
    return NextResponse.json({ error: 'Lieu non trouvé' }, { status: 404 });

  const parsed = await readJsonBody<{ texte?: unknown }>(req);
  if ('error' in parsed) return parsed.error;
  const demande = normaliserDemande(parsed.data?.texte);
  if (!demande.ok)
    return NextResponse.json({ error: demande.erreur }, { status: 422 });

  const rls = createSupabaseServerClient();
  const { data: lieu, error: lieuErr } = await rls
    .from('v_lieux_clients')
    .select('id, nom')
    .eq('id', id)
    .maybeSingle();
  if (lieuErr)
    return serverError(lieuErr, 'gestionnaire.lieux.demande_modification.lieu');
  if (!lieu)
    return NextResponse.json({ error: 'Lieu non trouvé' }, { status: 404 });

  const admin = createAdminSupabaseClient();
  const { data: ouverte, error: ouverteErr } = await admin
    .from('alertes_admin')
    .select('id')
    .eq('code', CODE_ALERTE_LIEU_MODIFICATION)
    .eq('entity_type', ENTITE_ALERTE_LIEU)
    .eq('entity_id', id)
    .eq('statut', 'ouverte')
    .limit(1)
    .maybeSingle();
  if (ouverteErr)
    return serverError(
      ouverteErr,
      'gestionnaire.lieux.demande_modification.ouverte',
    );
  if (ouverte)
    return NextResponse.json(
      { error: 'Une demande est déjà en cours de traitement pour ce lieu.' },
      { status: 409 },
    );

  // Qui demande : lu avec la session (sa propre ligne, sa propre organisation).
  const [{ data: demandeur }, { data: organisation }] = await Promise.all([
    rls
      .from('users')
      .select('prenom, nom, email')
      .eq('id', auth.ctx.userId)
      .maybeSingle(),
    rls
      .from('organisations')
      .select('nom')
      .eq('id', auth.ctx.organisationId)
      .maybeSingle(),
  ]);
  const d = demandeur as {
    prenom: string | null;
    nom: string | null;
    email: string | null;
  } | null;
  const nomComplet = `${d?.prenom ?? ''} ${d?.nom ?? ''}`.trim();
  const identite =
    [nomComplet, d?.email].filter(Boolean).join(', ') ||
    'un utilisateur du gestionnaire';
  const orgNom = (organisation as { nom: string | null } | null)?.nom;

  const { error: alerteErr } = await admin.rpc('f_upsert_alerte_admin', {
    p_code: CODE_ALERTE_LIEU_MODIFICATION,
    p_titre: 'Modification d’un lieu demandée par son gestionnaire',
    p_message:
      `Lieu « ${(lieu as { nom: string | null }).nom ?? id} » — demande de ` +
      `${identite}${orgNom ? ` (${orgNom})` : ''} : ${demande.texte}`,
    p_entity_type: ENTITE_ALERTE_LIEU,
    p_entity_id: id,
  });
  if (alerteErr)
    return serverError(
      alerteErr,
      'gestionnaire.lieux.demande_modification.alerte',
    );

  // Trace d'auteur (historique de la fiche lieu Admin). L'alerte est déjà
  // posée : un échec ici est journalisé, il ne fait pas échouer la demande.
  // Session impersonée : user_id = identité assumée, impersonator_id = admin
  // réel (§09 §7) — écrit ici car l'INSERT part sous service_role.
  const { error: auditErr } = await admin.from('audit_log').insert({
    table_name: 'lieux',
    record_id: id,
    action: CODE_ALERTE_LIEU_MODIFICATION,
    user_id: auth.ctx.userId,
    role: auth.ctx.role,
    impersonator_id: auth.ctx.impersonatorId ?? null,
    new_values: { demande: demande.texte },
  });
  if (auditErr)
    logger.warn('gestionnaire.lieux.demande_modification.audit_echec', {
      lieu_id: id,
      code: auditErr.code,
    });

  return NextResponse.json({ data: { demandee: true } }, { status: 201 });
}

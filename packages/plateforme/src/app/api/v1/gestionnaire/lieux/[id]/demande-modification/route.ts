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
//  · une demande ouverte par lieu, AU MIEUX : la route lit s'il en existe une
//    et refuse alors la nouvelle (409). Cette lecture n'est pas verrouillée et
//    aucun index unique ne la double : deux envois au même instant peuvent
//    ouvrir deux alertes. Aucune n'est perdue — l'alerte est insérée telle
//    quelle (pas de f_upsert_alerte_admin, qui ignorerait la seconde en
//    silence), l'Admin les voit toutes les deux ;
//  · aucune donnée personnelle n'est recopiée : le message nomme le lieu et
//    l'ORGANISATION qui demande. L'auteur est tracé par audit_log.user_id (qui,
//    quand), que l'historique de la fiche lieu Admin résout à la lecture ; le
//    texte saisi n'est pas recopié dans audit_log, journal non modifiable.
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

  // Organisation qui demande : sa propre ligne, lue avec la session. Illisible
  // (erreur ou absence) : la demande part quand même, avec un libellé de repli.
  const { data: organisation, error: orgErr } = await rls
    .from('organisations')
    .select('nom')
    .eq('id', auth.ctx.organisationId)
    .maybeSingle();
  if (orgErr)
    logger.warn('gestionnaire.lieux.demande_modification.organisation_echec', {
      lieu_id: id,
      code: orgErr.code,
    });
  const demandeur =
    (organisation as { nom: string | null } | null)?.nom ?? 'son gestionnaire';

  const { error: alerteErr } = await admin.from('alertes_admin').insert({
    code: CODE_ALERTE_LIEU_MODIFICATION,
    titre: 'Modification d’un lieu demandée par son gestionnaire',
    message:
      `Lieu « ${(lieu as { nom: string | null }).nom ?? id} » — demande de ` +
      `${demandeur} : ${demande.texte}`,
    entity_type: ENTITE_ALERTE_LIEU,
    entity_id: id,
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
  });
  if (auditErr)
    logger.warn('gestionnaire.lieux.demande_modification.audit_echec', {
      lieu_id: id,
      code: auditErr.code,
    });

  return NextResponse.json({ data: { demandee: true } }, { status: 201 });
}

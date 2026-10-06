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
import { estLieuDuParc } from '@/lib/lieux/parc.js';
import {
  CODE_ALERTE_LIEU_MODIFICATION,
  ENTITE_ALERTE_LIEU,
  normaliserDemande,
} from '@/lib/lieux/demande-modification.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

const dejaEnCours = () =>
  NextResponse.json(
    { error: 'Une demande est déjà en cours de traitement pour ce lieu.' },
    { status: 409 },
  );

// POST /api/v1/gestionnaire/lieux/[id]/demande-modification
// « Demande de modification d'information » de la fiche lieu du gestionnaire
// (§06.05 §3 — arbitrage Val 2026-10-06). Le gestionnaire n'écrit jamais le
// référentiel lieux (§04) : cette route ne touche pas la table `lieux`, elle
// ouvre une alerte dans la file in-app de l'Admin (ni email, ni Slack).
//
//  · Lieux du PARC de l'organisation seulement (`organisations_lieux`, lu avec
//    la session) : hors parc, même 404 qu'un lieu inconnu, rien n'est écrit.
//    L'écriture part ensuite en service-role, alertes_admin étant fermée aux
//    rôles clients.
//  · Seul texte libre lu : `texte`, validé par lib/lieux/demande-modification
//    et placé entre guillemets après le préfixe écrit ici.
//  · Une demande OUVERTE par lieu : index unique partiel
//    `uniq_alerte_lieu_modification_ouverte` (migration 20261006231500), dont
//    la violation (23505) vaut « déjà en cours ». La lecture préalable donne la
//    même réponse sans écrire, et tient seule la règle sur un environnement où
//    la migration n'est pas encore appliquée. Insert direct : la fonction
//    f_upsert_alerte_admin ignorerait un doublon en silence.
//  · Aucune donnée personnelle recopiée par la route : le message nomme le
//    lieu et l'organisation ; l'auteur est tracé par audit_log (user_id), où
//    le texte saisi n'est pas recopié (journal non modifiable).
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
  const parc = await estLieuDuParc(rls, auth.ctx.organisationId, id);
  if (!parc.ok)
    return serverError(
      parc.error,
      'gestionnaire.lieux.demande_modification.parc',
    );
  if (!parc.duParc)
    return NextResponse.json({ error: 'Lieu non trouvé' }, { status: 404 });

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
  if (ouverte) return dejaEnCours();

  // Organisation qui demande : sa propre ligne, lue avec la session.
  const { data: organisation, error: orgErr } = await rls
    .from('organisations')
    .select('nom')
    .eq('id', auth.ctx.organisationId)
    .maybeSingle();
  if (orgErr)
    return serverError(
      orgErr,
      'gestionnaire.lieux.demande_modification.organisation',
    );
  const demandeur =
    (organisation as { nom: string | null } | null)?.nom ?? 'son gestionnaire';

  const { error: alerteErr } = await admin.from('alertes_admin').insert({
    code: CODE_ALERTE_LIEU_MODIFICATION,
    titre: 'Modification d’un lieu demandée par son gestionnaire',
    message:
      `Lieu « ${(lieu as { nom: string | null }).nom ?? id} » — demande de ` +
      `${demandeur} : « ${demande.texte} »`,
    entity_type: ENTITE_ALERTE_LIEU,
    entity_id: id,
  });
  // 23505 = index unique : une demande ouverte existe déjà pour ce lieu (envoi
  // simultané passé entre la lecture ci-dessus et cet insert).
  if (alerteErr?.code === '23505') return dejaEnCours();
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
      // Seule trace de l'auteur si l'écriture d'audit a échoué.
      user_id: auth.ctx.userId,
      code: auditErr.code,
    });

  return NextResponse.json({ data: { demandee: true } }, { status: 201 });
}

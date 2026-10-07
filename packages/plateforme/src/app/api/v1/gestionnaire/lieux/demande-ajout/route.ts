import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { readJsonBody, serverError } from '@/lib/api-helpers.js';
import {
  CODE_ALERTE_LIEU_AJOUT,
  ENTITE_ALERTE_LIEU_AJOUT,
  normaliserDemandeAjout,
} from '@/lib/lieux/demande-ajout.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// « Demander l'ajout d'un lieu » de la liste Lieux du gestionnaire (§06.05 §3
// « Ajout / retrait lieu » — arbitrages Val 2026-10-07). Le rattachement d'un
// lieu reste fait à la main par l'Admin : ces routes n'écrivent ni `lieux` ni
// `organisations_lieux`, la demande ouvre une alerte dans la file in-app de
// l'Admin (ni email, ni Slack).
//
//  · Aucun lieu n'existe encore : l'alerte est rattachée à l'organisation du
//    demandeur (celle de sa session, jamais une valeur du corps). Lecture et
//    écriture partent en service-role, alertes_admin étant fermée aux rôles
//    clients ; seul l'état « une demande est ouverte » en sort, jamais son
//    contenu.
//  · Une demande OUVERTE par organisation : index unique partiel
//    `uniq_alerte_lieu_ajout_ouverte` (migration 20261007113000), dont la
//    violation (23505) vaut « déjà en cours ». La lecture préalable donne la
//    même réponse sans écrire ; sur un environnement où la migration n'est pas
//    encore appliquée, elle est seule à s'y opposer et des envois simultanés
//    peuvent encore ouvrir plusieurs alertes. Insert direct : la fonction
//    f_upsert_alerte_admin ignorerait un doublon en silence.

type Admin = ReturnType<typeof createAdminSupabaseClient>;

const demandeOuverte = (admin: Admin, organisationId: string) =>
  admin
    .from('alertes_admin')
    .select('id')
    .eq('code', CODE_ALERTE_LIEU_AJOUT)
    .eq('entity_type', ENTITE_ALERTE_LIEU_AJOUT)
    .eq('entity_id', organisationId)
    .eq('statut', 'ouverte')
    .limit(1)
    .maybeSingle();

const dejaEnCours = () =>
  NextResponse.json(
    {
      error:
        'Une demande d’ajout est déjà en cours de traitement par l’équipe Savr.',
    },
    { status: 409 },
  );

// GET /api/v1/gestionnaire/lieux/demande-ajout
// État du bouton de la liste Lieux : une demande d'ajout est-elle ouverte pour
// l'organisation de la session ?
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const { data: ouverte, error } = await demandeOuverte(
    createAdminSupabaseClient(),
    auth.ctx.organisationId,
  );
  if (error) return serverError(error, 'gestionnaire.lieux.demande_ajout.etat');
  return NextResponse.json({ data: { en_cours: ouverte !== null } });
}

// POST /api/v1/gestionnaire/lieux/demande-ajout
//  · Trois champs lus : `nom` et `adresse` obligatoires, `precision`
//    facultative, validés par lib/lieux/demande-ajout et placés entre
//    guillemets dans le message écrit ici.
//  · Aucune donnée personnelle recopiée par la route : le message nomme
//    l'organisation ; l'auteur est tracé par audit_log (user_id), où les textes
//    saisis ne sont pas recopiés (journal non modifiable).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  const organisationId = auth.ctx.organisationId;

  const parsed = await readJsonBody<unknown>(req);
  if ('error' in parsed) return parsed.error;
  const demande = normaliserDemandeAjout(parsed.data);
  if (!demande.ok)
    return NextResponse.json({ error: demande.erreur }, { status: 422 });

  const admin = createAdminSupabaseClient();
  const { data: ouverte, error: ouverteErr } = await demandeOuverte(
    admin,
    organisationId,
  );
  if (ouverteErr)
    return serverError(ouverteErr, 'gestionnaire.lieux.demande_ajout.ouverte');
  if (ouverte) return dejaEnCours();

  // Organisation qui demande : sa propre ligne, lue avec la session.
  const { data: organisation, error: orgErr } =
    await createSupabaseServerClient()
      .from('organisations')
      .select('nom')
      .eq('id', organisationId)
      .maybeSingle();
  if (orgErr)
    return serverError(orgErr, 'gestionnaire.lieux.demande_ajout.organisation');
  const demandeur =
    (organisation as { nom: string | null } | null)?.nom ??
    'Un gestionnaire de lieux';

  const { error: alerteErr } = await admin.from('alertes_admin').insert({
    code: CODE_ALERTE_LIEU_AJOUT,
    titre: 'Ajout d’un lieu demandé par un gestionnaire',
    message:
      `${demandeur} demande l’ajout du lieu « ${demande.nom} », ` +
      `adresse « ${demande.adresse} »` +
      (demande.precision ? ` ; précision : « ${demande.precision} »` : ''),
    entity_type: ENTITE_ALERTE_LIEU_AJOUT,
    entity_id: organisationId,
  });
  // 23505 = index unique : une demande ouverte existe déjà pour l'organisation
  // (envoi simultané passé entre la lecture ci-dessus et cet insert).
  if (alerteErr?.code === '23505') return dejaEnCours();
  if (alerteErr)
    return serverError(alerteErr, 'gestionnaire.lieux.demande_ajout.alerte');

  // Trace d'auteur. L'alerte est déjà posée : un échec ici est journalisé, il
  // ne fait pas échouer la demande. Session impersonée : user_id = identité
  // assumée, impersonator_id = admin réel (§09 §7) — écrit ici car l'INSERT
  // part sous service_role.
  const { error: auditErr } = await admin.from('audit_log').insert({
    table_name: ENTITE_ALERTE_LIEU_AJOUT,
    record_id: organisationId,
    action: CODE_ALERTE_LIEU_AJOUT,
    user_id: auth.ctx.userId,
    role: auth.ctx.role,
    impersonator_id: auth.ctx.impersonatorId ?? null,
  });
  if (auditErr)
    logger.warn('gestionnaire.lieux.demande_ajout.audit_echec', {
      organisation_id: organisationId,
      // Seule trace de l'auteur si l'écriture d'audit a échoué.
      user_id: auth.ctx.userId,
      code: auditErr.code,
    });

  return NextResponse.json({ data: { demandee: true } }, { status: 201 });
}

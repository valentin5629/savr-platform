// Webhook entrant Everest — M2.5.
// Everest envoie POST application/x-www-form-urlencoded.
// Sécurisé par X-Webhook-Token (secret en Vault, non devinable — M14 D6).
// Pattern W2 (M14) adapté V1 Plateforme (tables plateforme.* au lieu de tms.*).
//
// Échec de lecture/écriture de l'état métier (everest_missions, collectes,
// lecture audit_log qui décide d'un rejet, marquage inbox) :
//   • alerte Ops in-app quand une collecte est identifiée (anomalie fonctionnelle,
//     JAMAIS Slack — CLAUDE.md §13) ;
//   • l'inbox N'EST PAS marquée `traite` → réponse 500 générique, pour qu'un rejeu
//     Everest du même event (même mission_id + event_type + occurred_at) retraite
//     l'event au lieu d'être pris pour un doublon ;
//   • les inserts `integrations_logs` restent best-effort (trace technique : leur
//     perte ne fausse aucun état métier).
//
// Mission courante (arbitrage Val 2026-09-17) : `everest_missions.collecte_id`
// n'est pas unique et une réattribution vers un autre transporteur n'annule pas
// la course A Toutes! en V1. Un event ne touche donc la collecte que si sa
// mission est la mission courante (cf. `lireCollecte`) ; sinon la mission est
// mise à jour, la collecte non, et un vélo encore actif est alerté (risque de
// double passage, M14 EC11). Chaque UPDATE `collectes` porte sa garde dans le
// WHERE : 0 ligne modifiée = un event concurrent est passé avant → no-op.

import { timingSafeEqual } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { fetchEverestMissionDetails } from '@savr/adapters/src/index.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { serverError, withApiTrace } from '@/lib/api-helpers.js';

type SupabaseAdmin = ReturnType<typeof createAdminSupabaseClient>;
type ErreurDb = { code?: string; message: string };

// Statuts Everest API → enum plateforme.statut_mission_everest (BL-P0-07).
// Le re-fetch est la vérité ; on borne la valeur au domaine de l'enum, sinon on
// retombe sur le statut opérationnel attendu du signal (completed).
const EVEREST_STATUS_ENUM = new Set([
  'created',
  'assigned',
  'in_progress',
  'completed',
  'completed_incomplete',
  'creation_failed',
  'failed',
  'cancelled',
  'cancelled_externally',
  'created_manually',
]);

function mapEverestStatut(apiStatus: string, fallback: string): string {
  return EVEREST_STATUS_ENUM.has(apiStatus) ? apiStatus : fallback;
}

// BL-P1-API-04 (d) — « course sans marchandise ». Libellés `mission_status`
// tranchés CLAUDE.md §7 (gate Everest levée 2026-06-15, mail Mathieu Lomazzi) :
// `Pas de commande` (rien à enlever) / `Client absent / Marchandise refusée`
// (récupérée mais non livrée). Lus du RE-FETCH (jamais du payload non signé,
// BL-P0-07). Une collecte AG sur l'un de ces statuts passe realisee_sans_collecte
// (§05, AG only). Le wire exact (event_type porteur, photo du lieu) reste à
// confirmer côté dev Everest → _Divergences/M2.5_R10a_20260629.md (type:ambigu).
const COURSE_VIDE_MISSION_STATUSES = new Set([
  'pas de commande',
  'client absent / marchandise refusée',
]);

function isCourseVide(missionStatus: string | null | undefined): boolean {
  if (!missionStatus) return false;
  const norm = missionStatus.trim().toLowerCase().replace(/\s+/g, ' ');
  return COURSE_VIDE_MISSION_STATUSES.has(norm);
}

// Statuts terminaux d'une collecte : jamais régressés par un webhook tardif.
const STATUTS_TERMINAUX_COLLECTE = new Set([
  'realisee',
  'realisee_sans_collecte',
  'cloturee',
  'annulee',
  'annulation_demandee',
]);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// C7 : comparaison du token webhook en temps constant (anti timing attack).
// timingSafeEqual exige des buffers de même longueur → on court-circuite si les
// longueurs diffèrent (la longueur du secret n'est pas sensible).
function tokenMatches(provided: string | null, expected: string): boolean {
  if (provided == null) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Statuts terminaux Everest : un webhook tardif ne rétrograde jamais le statut.
const TERMINAL_STATUTS = new Set([
  'completed',
  'completed_incomplete',
  'cancelled',
  'cancelled_externally',
  'failed',
]);

// ─── Échec de l'état métier ─────────────────────────────────────────────────────

/**
 * L'état métier porté par l'event n'a pas pu être lu ou écrit. Levée par
 * `echecEtatMetier`, rattrapée par `postHandler` qui répond 500 SANS marquer
 * l'inbox `traite`.
 */
class EtatMetierNonEcrit extends Error {
  constructor(
    readonly evenement: string,
    readonly erreurDb: ErreurDb,
  ) {
    super(`${evenement}: ${erreurDb.message}`);
    this.name = 'EtatMetierNonEcrit';
  }
}

/**
 * Alerte Ops in-app (dédupliquée par `f_upsert_alerte_admin` sur code + collecte
 * ouverte), puis levée. L'alerte est posée AVANT de lever : Everest peut ne
 * jamais rejouer l'event, elle reste alors le seul signal. Best-effort, comme
 * dans l'adapter Everest : une alerte perdue ne doit pas masquer l'erreur.
 */
async function echecEtatMetier(
  supabase: SupabaseAdmin,
  error: ErreurDb,
  echec: {
    evenement: string;
    collecteId: string;
    missionId: string;
    quoi: string;
  },
): Promise<never> {
  await supabase
    .rpc('f_upsert_alerte_admin', {
      p_code: 'everest_webhook_non_enregistre',
      p_titre: 'Événement A Toutes! non enregistré',
      p_message:
        `L'événement A Toutes! de la course ${echec.missionId} n'a pas pu être enregistré : ${echec.quoi} ` +
        `(${error.message}). L'état affiché de la collecte ne reflète pas le transporteur ; ` +
        `l'événement reste non traité et sera rejoué s'il est renvoyé.`,
      p_entity_type: 'collectes',
      p_entity_id: echec.collecteId,
    })
    .then(
      () => undefined,
      () => undefined,
    );
  throw new EtatMetierNonEcrit(echec.evenement, error);
}

/**
 * Alerte métier posée APRÈS une transition déjà écrite (aucun repas, rejet
 * prestataire). Un rejeu ne la reposerait pas (la transition est gardée par
 * l'état courant) : son échec ne justifie pas un 500. Explicitement best-effort,
 * mais tracé en erreur serveur pour ne pas disparaître en silence.
 */
async function alerteApresTransition(
  supabase: SupabaseAdmin,
  args: {
    p_code: string;
    p_titre: string;
    p_message: string;
    p_entity_type: 'collectes';
    p_entity_id: string;
  },
): Promise<void> {
  const { error } = await supabase.rpc('f_upsert_alerte_admin', args);
  if (error) {
    logger.error('webhooks.everest.alerte_non_posee', {
      code: args.p_code,
      collecte_id: args.p_entity_id,
      error_code: error.code ?? 'UNKNOWN',
    });
  }
}

async function postHandler(req: NextRequest): Promise<NextResponse> {
  const supabase = createAdminSupabaseClient();

  // ── 1. Validation token webhook ────────────────────────────────────────────
  const webhookToken =
    req.headers.get('x-webhook-token') ??
    new URL(req.url).searchParams.get('token');

  const expectedToken = process.env['EVEREST_WEBHOOK_TOKEN'];
  // Fail-closed en production : EVEREST_WEBHOOK_TOKEN doit être configuré.
  if (!expectedToken && process.env['NODE_ENV'] === 'production') {
    return NextResponse.json(
      { error: 'Webhook non configuré' },
      { status: 500 },
    );
  }
  if (expectedToken && !tokenMatches(webhookToken, expectedToken)) {
    // Best-effort : trace technique, le 401 est la réponse qui compte.
    await supabase.from('integrations_logs').insert({
      integration: 'everest',
      direction: 'entrant',
      methode: 'POST',
      endpoint: '/api/webhooks/everest',
      statut_http: 401,
      erreur: 'webhook_token_invalide',
    });
    return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  }

  // ── 2. Décodage payload form-urlencoded ────────────────────────────────────
  const text = await req.text();
  const params = new URLSearchParams(text);
  const missionId = params.get('mission_id') ?? '';
  const eventType = params.get('event_type') ?? '';
  const occurredAt = params.get('occurred_at') ?? new Date().toISOString();

  const payload: Record<string, string> = {};
  for (const [k, v] of params.entries()) payload[k] = v;

  // ── 3. Idempotence inbox ───────────────────────────────────────────────────
  const eventIdExterne = `${missionId}-${eventType}-${occurredAt}`;
  const { data: inboxRow, error: inboxErr } = await supabase
    .from('integrations_inbox')
    .insert({
      source: 'everest',
      event_type: eventType,
      event_id_externe: eventIdExterne,
      payload,
    })
    .select('id')
    .single();

  let inboxId: string;
  if (inboxErr) {
    if (inboxErr.code !== '23505') {
      return serverError(inboxErr, 'webhooks.everest.inbox_insert');
    }
    // Conflit unique : doublon SEULEMENT si le premier passage a abouti. Une
    // ligne restée `traite=false` = état métier non écrit au premier passage →
    // on la reprend. Deux livraisons simultanées du même event peuvent alors se
    // chevaucher : les transitions `collectes` sont gardées dans le WHERE, la
    // seconde modifie 0 ligne et n'alerte pas une seconde fois.
    const { data: existant, error: existantErr } = await supabase
      .from('integrations_inbox')
      .select('id, traite')
      .eq('source', 'everest')
      .eq('event_id_externe', eventIdExterne)
      .maybeSingle();
    if (existantErr || !existant) {
      return serverError(
        existantErr ?? inboxErr,
        'webhooks.everest.inbox_relecture',
      );
    }
    const ligne = existant as { id: string; traite: boolean };
    if (ligne.traite) {
      return NextResponse.json({ ok: true, deduplicated: true });
    }
    inboxId = ligne.id;
  } else {
    inboxId = (inboxRow as { id: string }).id;
  }

  // Best-effort : trace technique de réception.
  await supabase.from('integrations_logs').insert({
    integration: 'everest',
    direction: 'entrant',
    methode: 'POST',
    endpoint: '/api/webhooks/everest',
    statut_http: 200,
    correlation_id: missionId,
  });

  // ── 4. Lookup everest_missions par everest_mission_id ─────────────────────
  const { data: mission, error: missionErr } = await supabase
    .from('everest_missions')
    .select('id, tournee_id, collecte_id, statut_everest')
    .eq('everest_mission_id', missionId)
    .maybeSingle();

  if (missionErr) {
    // Mission non lue ≠ mission inconnue : aucune collecte identifiable pour
    // l'alerte in-app → erreur serveur, inbox non traitée (rejeu possible).
    return serverError(missionErr, 'webhooks.everest.mission_lecture');
  }

  if (!mission) {
    // Mission inconnue : on logge et on répond 200 (ne pas retenter Everest)
    const { error: inconnueErr } = await supabase
      .from('integrations_inbox')
      .update({
        traite: true,
        traite_at: new Date().toISOString(),
        erreur: 'mission_inconnue',
      })
      .eq('id', inboxId);
    if (inconnueErr) {
      return serverError(inconnueErr, 'webhooks.everest.inbox_traite');
    }
    return NextResponse.json({ ok: true, skipped: 'mission_inconnue' });
  }

  type MissionRow = {
    id: string;
    tournee_id: string;
    collecte_id: string;
    statut_everest: string;
  };
  const m = mission as unknown as MissionRow;

  let skipped: string | undefined;
  try {
    // Garde statuts terminaux : pas de régression (M14 W2 note floue #4)
    if (TERMINAL_STATUTS.has(m.statut_everest)) {
      const { error } = await supabase
        .from('everest_missions')
        .update({
          payload_latest_update: payload,
          derniere_sync_at: new Date().toISOString(),
        })
        .eq('id', m.id)
        .eq('everest_mission_id', missionId);
      if (error) {
        await echecEtatMetier(supabase, error, {
          evenement: 'mission_terminale_sync',
          collecteId: m.collecte_id,
          missionId,
          quoi: 'dernière synchronisation de la mission terminée',
        });
      }
      skipped = 'statut_terminal';
    } else {
      // ── 5. Switch event_type ────────────────────────────────────────────────
      await handleEventType(supabase, m, missionId, eventType, params, payload);
    }
  } catch (err) {
    if (!(err instanceof EtatMetierNonEcrit)) throw err;
    // Inbox laissée `traite=false` : le rejeu du même event la reprend (§3).
    // Le motif est posé best-effort pour le diagnostic Ops.
    await supabase
      .from('integrations_inbox')
      .update({ erreur: `etat_non_enregistre: ${err.evenement}` })
      .eq('id', inboxId);
    return serverError(err.erreurDb, `webhooks.everest.${err.evenement}`);
  }

  // ── 6. Marquer inbox traité ───────────────────────────────────────────────
  // État métier écrit mais inbox non marquée → 500 : le rejeu retraite l'event
  // et réécrit les mêmes valeurs (transitions décidées sur l'état relu).
  const { error: traiteErr } = await supabase
    .from('integrations_inbox')
    .update({ traite: true, traite_at: new Date().toISOString() })
    .eq('id', inboxId);
  if (traiteErr) {
    return serverError(traiteErr, 'webhooks.everest.inbox_traite');
  }

  return NextResponse.json(skipped ? { ok: true, skipped } : { ok: true });
}

async function handleEventType(
  supabase: SupabaseAdmin,
  mission: {
    id: string;
    tournee_id: string;
    collecte_id: string;
    statut_everest: string;
  },
  missionId: string,
  eventType: string,
  params: URLSearchParams,
  payload: Record<string, string>,
): Promise<void> {
  const now = new Date().toISOString();

  // Écriture de la mission : un refus (CHECK, blip PostgREST) lève. Gardée par
  // la référence de l'event : une réattribution A Toutes! → A Toutes! réécrit
  // la même ligne (unique par tournée) avec la NOUVELLE mission, qu'un event de
  // l'ancienne lu juste avant ne doit pas écraser (0 ligne = no-op).
  const majMission = async (
    updates: Record<string, unknown>,
    evenement: string,
  ): Promise<void> => {
    const { error } = await supabase
      .from('everest_missions')
      .update(updates)
      .eq('id', mission.id)
      .eq('everest_mission_id', missionId);
    if (error) {
      await echecEtatMetier(supabase, error, {
        evenement,
        collecteId: mission.collecte_id,
        missionId,
        quoi: `statut de la mission (${String(updates['statut_everest'] ?? 'synchronisation')})`,
      });
    }
  };

  switch (eventType) {
    case 'mission_dispatched': {
      // Acceptation nominale A Toutes! (M14 R_M14.1bis, adapté V1)
      // A Toutes! n'a pas de portail M03 — assignment coursier = acceptation.
      const updates: Record<string, unknown> = {
        statut_everest: 'assigned',
        derniere_sync_at: now,
        payload_latest_update: payload,
      };
      const coursierNom =
        params.get('coursier_nom') ?? params.get('driver_name');
      const coursierTel =
        params.get('coursier_telephone') ?? params.get('driver_phone');
      const vehiculeType =
        params.get('vehicule_type') ?? params.get('vehicle_type');
      if (coursierNom) updates['coursier_nom'] = coursierNom;
      if (coursierTel) updates['coursier_telephone'] = coursierTel;
      if (vehiculeType) updates['vehicule_type_everest'] = vehiculeType;

      await majMission(updates, 'mission_dispatched');

      const lue = await lireCollecte(supabase, mission, missionId);
      if (!lue) break;
      if (!lue.courante) {
        await signalerMissionHorsAttribution(
          supabase,
          mission,
          missionId,
          eventType,
          'un coursier est assigné',
        );
        break;
      }

      // Passer statut_tms → 'acceptee' si pas encore acceptée
      // (trigger fn_sync_statut_collecte_from_tms dérive collectes.statut)
      if (lue.etat.statut_tms === 'attribuee_en_attente_acceptation') {
        await ecritureCollecteGardee(
          supabase,
          supabase
            .from('collectes')
            .update({ statut_tms: 'acceptee' })
            .eq('id', mission.collecte_id)
            .eq('statut_tms', 'attribuee_en_attente_acceptation')
            .eq('prestataire_logistique_id', lue.prestataire)
            .select('id'),
          {
            evenement: 'collecte_acceptee',
            collecteId: mission.collecte_id,
            missionId,
            quoi: 'acceptation de la course (statut transporteur « acceptee »)',
          },
        );
      }
      break;
    }

    case 'mission_pickedup': {
      await majMission(
        {
          statut_everest: 'in_progress',
          derniere_sync_at: now,
          payload_latest_update: payload,
        },
        'mission_pickedup',
      );
      const lue = await lireCollecte(supabase, mission, missionId);
      if (lue && !lue.courante) {
        await signalerMissionHorsAttribution(
          supabase,
          mission,
          missionId,
          eventType,
          'le coursier a enlevé la marchandise',
        );
      }
      break;
    }

    case 'mission_finished':
    case 'mission_success': {
      // BL-P0-07 : webhook = SIGNAL. Le coût + la preuve + le statut sont la
      // vérité de l'API Everest, re-fetchée par id — JAMAIS lus du payload non
      // signé (CDC 08 - APIs §3 l.241/279 « ne jamais faire confiance au payload »).
      let detail: Awaited<
        ReturnType<typeof fetchEverestMissionDetails>
      > | null = null;
      try {
        detail = await fetchEverestMissionDetails(
          missionId,
          supabase,
          missionId,
        );
      } catch (err) {
        // Re-fetch indisponible (API down/timeout) : on ne persiste AUCUNE valeur
        // du payload. On enregistre le statut opérationnel du signal sans coût ni
        // preuve, et on lève une trace Ops pour réconciliation manuelle.
        // Best-effort : trace technique.
        await supabase.from('integrations_logs').insert({
          integration: 'everest',
          direction: 'sortant',
          methode: 'GET',
          endpoint: `/missions/${missionId}`,
          erreur: `refetch_failed: ${err instanceof Error ? err.message : String(err)}`,
          correlation_id: missionId,
        });
        await majMission(
          {
            statut_everest: 'completed',
            derniere_sync_at: now,
            payload_latest_update: payload,
          },
          'mission_terminee',
        );
        break;
      }

      const updates: Record<string, unknown> = {
        statut_everest: mapEverestStatut(detail.status, 'completed'),
        derniere_sync_at: now,
        payload_latest_update: payload,
      };
      if (detail.cout_ht !== null) updates['cout_everest_ht'] = detail.cout_ht;
      if (detail.preuve_url !== null)
        updates['preuve_course_url'] = detail.preuve_url;

      // BL-P1-API-04 (d) : course sans marchandise (mission_status re-fetché) →
      // realisee_sans_collecte (AG, §05). Le coût + la mobilisation restent dus
      // (facture tarif normal V1), d'où la persistance cout/preuve ci-dessous.
      // Sinon, M05 reste source de vérité du statut opérationnel — pas de mutation collectes.statut
      if (isCourseVide(detail.status)) {
        await transitionRealiseeSansCollecte(
          supabase,
          mission,
          missionId,
          eventType,
          detail,
          now,
        );
      }
      // Mission terminale écrite EN DERNIER : si l'écriture collecte échoue, la
      // mission n'est pas encore terminale et le rejeu ne bute pas sur la garde
      // « statuts terminaux » de postHandler.
      await majMission(updates, 'mission_terminee');
      break;
    }

    case 'mission_failed': {
      // BL-P1-API-04 (d) : re-fetch pour lire mission_status — une « course sans
      // marchandise » peut remonter en catégorie fail (hypothèse _PENDING §3).
      // Re-fetch indispo → on retombe sur le traitement d'échec nominal.
      let detail: Awaited<
        ReturnType<typeof fetchEverestMissionDetails>
      > | null = null;
      try {
        detail = await fetchEverestMissionDetails(
          missionId,
          supabase,
          missionId,
        );
      } catch {
        detail = null;
      }

      if (detail && isCourseVide(detail.status)) {
        // Pas un échec : course sans marchandise → realisee_sans_collecte (AG).
        // Mission terminale écrite EN DERNIER (rejeu possible, cf. mission_finished).
        await transitionRealiseeSansCollecte(
          supabase,
          mission,
          missionId,
          eventType,
          detail,
          now,
        );
        await majMission(
          {
            statut_everest: 'completed_incomplete',
            derniere_sync_at: now,
            payload_latest_update: payload,
          },
          'mission_terminee',
        );
        break;
      }

      // Échec réel.
      // Best-effort : trace technique (monitoring Admin) ; le signal Ops qui
      // compte est l'alerte in-app de rejeterSiPreAcceptation.
      await supabase.from('integrations_logs').insert({
        integration: 'everest',
        direction: 'entrant',
        methode: 'POST',
        endpoint: '/api/webhooks/everest',
        erreur: `mission_failed: mission_id=${String(params.get('mission_id'))}`,
        correlation_id: String(params.get('mission_id')),
      });
      // BL-P1-API-04 (c) : échec AVANT acceptation = rejet prestataire (webhook
      // async, §08 §3 l.276) → statut_tms=rejetee_par_prestataire + retour file.
      await rejeterSiPreAcceptation(
        supabase,
        mission,
        missionId,
        eventType,
        'échouée',
      );
      // Mission terminale écrite EN DERNIER (rejeu possible, cf. mission_finished).
      await majMission(
        {
          statut_everest: 'failed',
          derniere_sync_at: now,
          payload_latest_update: payload,
        },
        'mission_failed',
      );
      break;
    }

    case 'mission_cancelled': {
      // Vérifier si l'annulation a été initiée par Savr (traçage audit_log).
      // Lecture en échec = on ne sait pas qui a annulé : conclure « externe »
      // rejetterait à tort la collecte → échec, pas de décision.
      const { data: auditRow, error: auditErr } = await supabase
        .from('audit_log')
        .select('id')
        .eq('action', 'CANCEL')
        .contains('new_values', {
          everest_mission_id: params.get('mission_id'),
        })
        .limit(1)
        .maybeSingle();
      if (auditErr) {
        await echecEtatMetier(supabase, auditErr, {
          evenement: 'annulation_lecture_audit',
          collecteId: mission.collecte_id,
          missionId,
          quoi: "lecture de la trace d'annulation Savr",
        });
      }

      const estInitieSavr = !!auditRow;
      const nouveauStatut = estInitieSavr
        ? 'cancelled'
        : 'cancelled_externally';

      if (!estInitieSavr) {
        // Best-effort : trace technique de l'annulation externe ; le signal Ops
        // qui compte est l'alerte in-app de rejeterSiPreAcceptation.
        await supabase.from('integrations_logs').insert({
          integration: 'everest',
          direction: 'entrant',
          methode: 'POST',
          endpoint: '/api/webhooks/everest',
          erreur: `mission_cancelled_externally: mission_id=${String(params.get('mission_id'))}`,
          correlation_id: String(params.get('mission_id')),
        });
        // BL-P1-API-04 (c) : annulation externe AVANT acceptation = refus
        // transporteur (§08 §3 l.276) → rejetee_par_prestataire + retour file.
        await rejeterSiPreAcceptation(
          supabase,
          mission,
          missionId,
          eventType,
          'annulée par le prestataire',
        );
      }
      // Mission terminale écrite EN DERNIER (rejeu possible, cf. mission_finished).
      await majMission(
        {
          statut_everest: nouveauStatut,
          derniere_sync_at: now,
          payload_latest_update: payload,
        },
        'mission_cancelled',
      );
      break;
    }

    case 'mission_late': {
      // Alerte désactivée par défaut V1 (M14 A_M14_07, sobriété)
      await majMission(
        { payload_latest_update: payload, derniere_sync_at: now },
        'mission_late',
      );
      break;
    }

    default: {
      // event_type inconnu : loggé, pas d'alerte (M14 sobriété Bloc 3 A1)
      // Best-effort : trace technique.
      await supabase.from('integrations_logs').insert({
        integration: 'everest',
        direction: 'entrant',
        methode: 'POST',
        endpoint: '/api/webhooks/everest',
        erreur: `event_type_inconnu: ${eventType}`,
        correlation_id: String(params.get('mission_id')),
      });
      break;
    }
  }
}

// ─── Helpers transitions collecte (BL-P1-API-04 c+d) ────────────────────────────

type EtatCollecte = {
  type: string;
  statut: string;
  statut_tms: string;
  prestataire_logistique_id: string | null;
};

type CollecteLue =
  | { etat: EtatCollecte; courante: false }
  | { etat: EtatCollecte; courante: true; prestataire: string };

/**
 * État de la collecte de la mission, et « la mission de l'event est-elle la
 * mission courante de la collecte ? » (arbitrage Val 2026-09-17) :
 *   • la collecte est attribuée à un transporteur A Toutes!
 *     (`collectes.prestataire_logistique_id` → `transporteurs.type_tms`) ;
 *   • la tournée de la mission est liée à la collecte (`collecte_tournees`) ;
 *   • cette tournée porte la référence de CETTE mission
 *     (`tournees.external_ref_commande`, Interface logistique_provider V1).
 * Une lecture en échec lève : conclure « non courante » tairait un vrai refus,
 * conclure « courante » rejetterait une autre attribution.
 */
async function lireCollecte(
  supabase: SupabaseAdmin,
  mission: { tournee_id: string; collecte_id: string },
  missionId: string,
): Promise<CollecteLue | null> {
  const echecLecture = (error: ErreurDb, quoi: string): Promise<never> =>
    echecEtatMetier(supabase, error, {
      evenement: 'collecte_lecture',
      collecteId: mission.collecte_id,
      missionId,
      quoi,
    });

  const { data, error } = await supabase
    .from('collectes')
    .select('type, statut, statut_tms, prestataire_logistique_id')
    .eq('id', mission.collecte_id)
    .maybeSingle();
  if (error) await echecLecture(error, 'lecture du statut de la collecte');
  const etat = data as EtatCollecte | null;
  if (!etat) return null;

  const prestataire = etat.prestataire_logistique_id;
  if (!prestataire) return { etat, courante: false };

  const { data: transporteur, error: transporteurErr } = await supabase
    .from('transporteurs')
    .select('type_tms')
    .eq('prestataire_logistique_id', prestataire)
    .maybeSingle();
  if (transporteurErr)
    await echecLecture(transporteurErr, 'lecture du transporteur attribué');
  if ((transporteur as { type_tms: string } | null)?.type_tms !== 'a_toutes') {
    return { etat, courante: false };
  }

  const { data: lien, error: lienErr } = await supabase
    .from('collecte_tournees')
    .select('tournees!inner(external_ref_commande)')
    .eq('collecte_id', mission.collecte_id)
    .eq('tournee_id', mission.tournee_id)
    .maybeSingle();
  if (lienErr)
    await echecLecture(lienErr, 'lecture de la tournée de la collecte');
  // FK sortante `collecte_tournees.tournee_id` → embed OBJET, pas tableau.
  const reference = (
    lien as { tournees: { external_ref_commande: string | null } } | null
  )?.tournees.external_ref_commande;

  return reference === missionId
    ? { etat, courante: true, prestataire }
    : { etat, courante: false };
}

/**
 * UPDATE `collectes` dont la garde est dans le WHERE (statut attendu +
 * transporteur relu). Renvoie `false` sur 0 ligne modifiée : un event
 * concurrent, ou une réattribution, est passé entre la lecture et l'écriture
 * → no-op, sans alerte de transition.
 */
async function ecritureCollecteGardee(
  supabase: SupabaseAdmin,
  requete: PromiseLike<{ data: unknown[] | null; error: ErreurDb | null }>,
  echec: Parameters<typeof echecEtatMetier>[2],
): Promise<boolean> {
  const { data, error } = await requete;
  if (error) await echecEtatMetier(supabase, error, echec);
  return (data ?? []).length > 0;
}

/**
 * Event d'une mission qui n'est plus la mission courante de sa collecte : la
 * collecte n'est pas touchée. Trace technique best-effort ; si l'event annonce
 * un vélo actif, alerte Ops in-app (risque de double passage, M14 EC11) — son
 * échec lève (500, inbox non traitée) car elle est ici le seul signal.
 */
async function signalerMissionHorsAttribution(
  supabase: SupabaseAdmin,
  mission: { collecte_id: string },
  missionId: string,
  eventType: string,
  veloActif?: string,
): Promise<void> {
  await supabase.from('integrations_logs').insert({
    integration: 'everest',
    direction: 'entrant',
    methode: 'POST',
    endpoint: '/api/webhooks/everest',
    erreur: `mission_hors_attribution: mission_id=${missionId} event_type=${eventType} collecte=${mission.collecte_id}`,
    correlation_id: missionId,
  });
  if (!veloActif) return;

  const { error } = await supabase.rpc('f_upsert_alerte_admin', {
    p_code: 'everest_mission_hors_attribution',
    p_titre: 'Course A Toutes! active sur une collecte réattribuée',
    p_message:
      `A Toutes! signale que ${veloActif} sur la course ${missionId}, qui n'est plus la course attribuée ` +
      `à la collecte ${mission.collecte_id}. Risque de double passage : contacter A Toutes! pour annuler cette course.`,
    p_entity_type: 'collectes',
    p_entity_id: mission.collecte_id,
  });
  if (error) {
    await echecEtatMetier(supabase, error, {
      evenement: 'alerte_mission_hors_attribution',
      collecteId: mission.collecte_id,
      missionId,
      quoi: 'alerte « course active sur une collecte réattribuée »',
    });
  }
}

// (d) Course sans marchandise → realisee_sans_collecte. AG uniquement (§05 : la ZD
// a toujours des déchets). Motif chauffeur = libellé mission_status re-fetché ;
// photo du lieu = preuve re-fetchée si fournie, sinon NULL (Everest n'expose pas
// systématiquement de photo en V1 — colonne nullable). Alerte Ops in-app
// type=collecte_aucun_repas (Gherkin §08 l.332). Pas d'attestation, facture tarif
// normal V1 (§08 §1 l.103-107). Jamais de régression d'un statut terminal.
async function transitionRealiseeSansCollecte(
  supabase: SupabaseAdmin,
  mission: { id: string; tournee_id: string; collecte_id: string },
  missionId: string,
  eventType: string,
  detail: Awaited<ReturnType<typeof fetchEverestMissionDetails>>,
  now: string,
): Promise<void> {
  const lue = await lireCollecte(supabase, mission, missionId);
  if (!lue) return;
  if (!lue.courante) {
    await signalerMissionHorsAttribution(
      supabase,
      mission,
      missionId,
      eventType,
    );
    return;
  }

  if (lue.etat.type !== 'anti_gaspi') {
    // realisee_sans_collecte n'existe pas en ZD → on trace, on ne transitionne pas.
    // Best-effort : trace technique.
    await supabase.from('integrations_logs').insert({
      integration: 'everest',
      direction: 'entrant',
      methode: 'POST',
      endpoint: '/api/webhooks/everest',
      erreur: `course_vide_non_ag_ignoree: collecte=${mission.collecte_id} mission_status=${detail.status}`,
      correlation_id: missionId,
    });
    return;
  }

  if (STATUTS_TERMINAUX_COLLECTE.has(lue.etat.statut)) return;

  const modifiee = await ecritureCollecteGardee(
    supabase,
    supabase
      .from('collectes')
      .update({
        statut: 'realisee_sans_collecte',
        realisee_at: now,
        aucun_repas_motif: detail.status,
        aucun_repas_photo_url: detail.preuve_url ?? null,
      })
      .eq('id', mission.collecte_id)
      .eq('type', 'anti_gaspi')
      .not('statut', 'in', `(${[...STATUTS_TERMINAUX_COLLECTE].join(',')})`)
      .eq('prestataire_logistique_id', lue.prestataire)
      .select('id'),
    {
      evenement: 'collecte_realisee_sans_collecte',
      collecteId: mission.collecte_id,
      missionId,
      quoi: 'passage de la collecte en « réalisée sans collecte »',
    },
  );
  if (!modifiee) return;

  await alerteApresTransition(supabase, {
    p_code: 'collecte_aucun_repas',
    p_titre: 'Collecte AG sans repas (Everest)',
    p_message: `Course Everest sans marchandise — motif « ${detail.status} ». Collecte ${mission.collecte_id} → realisee_sans_collecte (facture tarif normal V1, pas d'attestation).`,
    p_entity_type: 'collectes',
    p_entity_id: mission.collecte_id,
  });
}

// (c) Rejet prestataire (webhook async Everest, §08 §3 l.276). Un échec / une
// annulation externe AVANT acceptation (statut_tms encore en attente) = refus du
// transporteur → statut_tms=rejetee_par_prestataire (le statut métier reste
// `programmee` : le trigger fn_sync ne dérive rien sur ce statut) + retour file
// (alerte Ops). Après acceptation (acceptee/en_cours), un échec est un incident,
// pas un rejet → on n'y touche pas.
async function rejeterSiPreAcceptation(
  supabase: SupabaseAdmin,
  mission: { id: string; tournee_id: string; collecte_id: string },
  missionId: string,
  eventType: string,
  motifCourt: string,
): Promise<void> {
  const lue = await lireCollecte(supabase, mission, missionId);
  if (!lue) return;
  if (!lue.courante) {
    await signalerMissionHorsAttribution(
      supabase,
      mission,
      missionId,
      eventType,
    );
    return;
  }
  if (lue.etat.statut_tms !== 'attribuee_en_attente_acceptation') return;

  const modifiee = await ecritureCollecteGardee(
    supabase,
    supabase
      .from('collectes')
      .update({ statut_tms: 'rejetee_par_prestataire' })
      .eq('id', mission.collecte_id)
      .eq('statut_tms', 'attribuee_en_attente_acceptation')
      .eq('prestataire_logistique_id', lue.prestataire)
      .select('id'),
    {
      evenement: 'collecte_rejetee',
      collecteId: mission.collecte_id,
      missionId,
      quoi: `rejet de la course ${motifCourt} avant acceptation (statut transporteur « rejetee_par_prestataire »)`,
    },
  );
  if (!modifiee) return;

  await alerteApresTransition(supabase, {
    p_code: 'collecte_rejetee_prestataire',
    p_titre: 'Course Everest rejetée par le prestataire',
    p_message: `Mission Everest ${motifCourt} avant acceptation (${missionId}) — collecte ${mission.collecte_id} repassée en file d'attente (rejetee_par_prestataire). Réattribuer (§08 §3).`,
    p_entity_type: 'collectes',
    p_entity_id: mission.collecte_id,
  });
}

export const POST = withApiTrace(postHandler);

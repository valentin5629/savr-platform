// Worker outbox — pattern lease/claim (M1.5a).
//
// Flux :
//   1. fn_reap_outbox_claims() — re-queue les claims expirés
//   2. fn_claim_outbox_batch() — TX courte de claim (SKIP LOCKED + visibilité txid),
//      UN event à la fois : chacun a son propre bail
//   3. Pour l'event réservé : appel adapter HORS TRANSACTION, borné par son échéance
//   4. fn_result_outbox() — TX de résultat (done/failed/dead)
//
// Alertes Slack :
//   - DLQ (attempts ≥ 4 → dead) → #savr-alerts-critique
//   - Anticipée (attempts ≥ 2 ET date_collecte < now+24h) → #savr-alerts-critique
//
// Sémantique `attempts` (§04 l.2328, gelé 2026-06-11 R2) : incrémenté AU CLAIM,
// AVANT tout HTTP (claim-before-POST : un crash laisse une trace, jamais de
// re-POST silencieux à attempts inchangé). La valeur lue au claim compte donc la
// tentative courante → palier = getNextRetryAt(attempts).
//
// A3 (concurrence claim/reaper) : depuis l'envoi immédiat au clic (décision Val
// 2026-10-12), PLUSIEURS passages peuvent tourner en même temps — le passage
// planifié (runOutboxWorker) et des passages ciblés par clic
// (runOutboxWorkerPourCollecte). Ce qui empêche la double exécution d'un ordre :
//   1. la réservation est atomique (FOR UPDATE SKIP LOCKED + statut 'processing') :
//      un ordre n'est rendu qu'à UN passage ;
//   2. le head-of-line bloque l'ordre suivant d'un MÊME agrégat tant que le
//      précédent n'est pas 'done' : jamais deux ordres d'une même collecte en vol.
//      Il ne lie pas deux agrégats : un ordre « lieu » (passage planifié) et un
//      ordre d'une collecte de ce lieu (clic) peuvent se chevaucher ;
//   3. le reaper ne re-queue qu'une réservation EXPIRÉE, et un passage ne parle
//      plus au prestataire quand la sienne approche de sa fin. Cette borne est
//      tenue DANS LE CODE (echeance-passage.ts) : pour un ordre réservé à T,
//      aucun appel au prestataire ne démarre après T + bail − 40 s, aucune
//      écriture de résultat n'est lancée après T + bail − 5 s (ce que cette
//      borne ne couvre pas est listé en tête de echeance-passage.ts).
//      `maxDuration = 60` (route cron et routes qui déclenchent l'envoi immédiat ;
//      cliquet : plateforme/tests/api/admin/envoi-immediat-routes.test.ts) ne
//      borne pas seul la durée de vie d'un passage. Sur un serveur local
//      (`next dev`, `next start`), il n'est pas appliqué. Sur Vercel, mesuré le
//      2026-10-12 sur des déploiements d'aperçu (Fluid Compute), avec une tâche
//      `after()` de 150 s sous `maxDuration = 60` :
//        - seule dans son processus, la tâche s'est arrêtée à 60 s ;
//        - avec une autre invocation en cours dans le même processus à cette
//          échéance, la plateforme a journalisé le dépassement et cessé
//          d'enregistrer les journaux de la tâche, mais son code a continué,
//          appels HTTP sortants compris : dernier appel reçu 100,5 s après le
//          départ de la tâche, plus aucun une fois l'autre invocation arrivée
//          à sa propre limite ;
//        - les deux routes d'envoi immédiat et les routes cron à 60 s, dont
//          celle de ce worker, étaient servies par la même instance.
//      Aucune tâche n'a été vue active au-delà de 120 s ; rien de mesuré ne
//      l'exclut. Non mesuré : la production, et le cas où l'autre invocation se
//      termine avant sa propre limite.
// Le passage planifié réserve UN ordre à la fois : réservés par dix sous un seul
// bail, les derniers commençaient bail expiré. SEUL le passage planifié lance le
// reaper : un clic ne libère jamais la réservation d'un autre passage.
//
// Limite connue : l'écriture du résultat (fn_result_outbox) n'est pas
// conditionnée en base à la réservation ; elle est bornée ici par l'horloge du
// passage (règle des 5 s ci-dessus).

import type { SupabaseClient } from '@supabase/supabase-js';

import { sendAlert } from '@savr/shared/src/alerting/slack.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { jourParis } from '@savr/shared/src/temps/index.js';

import {
  BAIL_RESERVATION_MS,
  avecEcheance,
  echeanceOrdre,
  limiteEcriture,
} from './echeance-passage.js';
import {
  CancelWindowClosedError,
  LogistiqueAmbiguousError,
  LogistiquePermanentError,
  LogistiqueTransientError,
  getLogistiqueProvider,
} from './index.js';
import type { Collecte, ConsumerTag, Lieu, Transporteur } from './index.js';
import { composerCommentaireTransporteur } from './infos-acces.js';
import { applyLieuOverrides } from './lieu-overrides.js';
import type { AdapterMts1 } from './mts1/adapter.js';

interface ClaimedEvent {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  consumer: string | null;
  attempts: number;
  requires_reconciliation: boolean;
}

interface CollecteRow {
  id: string;
  type: string;
  date_collecte: string;
  heure_collecte: string;
  nb_camions_demande: number;
  statut_tms: string;
  controle_acces_requis: boolean;
  informations_supplementaires: string | null;
  notes_internes: string | null;
  contact_principal_nom: string;
  contact_principal_telephone: string;
  contact_secours_nom: string | null;
  contact_secours_telephone: string | null;
  prestataire_logistique_id: string | null;
  type_vehicule_souhaite: string | null;
  traiteur_nom: string | null;
  pax: number | null;
  // AG uniquement (BL-P1-API-02) — association destinataire (point B), résolue
  // via attributions_antgaspi → associations : placeId favori MTS-1 + adresse
  // postale (adresse inline MTS-1 sans point favori, address_end Everest).
  association_id_point_collecte_mts1: string | null;
  association_adresse: string | null;
  association_contact_nom: string | null;
  association_contact_telephone: string | null;
  lieux: {
    id: string;
    nom: string;
    adresse_acces: string;
    code_postal: string;
    ville: string;
    latitude: number | null;
    longitude: number | null;
    acces_details: string | null;
    type_vehicule_max: string;
    contraintes_horaires: string | null;
    stationnement: string | null;
    acces_office: string | null;
    flux_autorises: string[] | null;
  };
}

interface TransporteurRow {
  id: string;
  type_tms: string;
  code_transporteur_mts1: string | null;
  prestataire_logistique_id: string;
}

export interface WorkerResult {
  reaped: number;
  claimed: number;
  done: number;
  failed: number;
  dead: number;
}

const RETRY_DELAYS_MS = [
  5 * 60 * 1000, // attempt 1 → retry dans 5 min
  60 * 60 * 1000, // attempt 2 → retry dans 1h
  24 * 60 * 60 * 1000, // attempt 3 → retry dans 24h
];

// Bail passé explicitement aux réservations : l'échéance des appels et le bail
// en base viennent ainsi de la même constante (echeance-passage.ts).
const BAIL = `${BAIL_RESERVATION_MS / 1000} seconds`;

/** Ordres traités au plus par passage planifié (un par réservation). */
const PASSAGE_PLANIFIE_MAX_ORDRES = 10;
/**
 * Passé ce délai, compté depuis le début du passage, on ne réserve plus de
 * nouvel ordre. Il ne borne pas le traitement de l'ordre en cours : c'est le
 * rôle de son échéance.
 */
const BUDGET_PASSAGE_MS = 40_000;

export async function runOutboxWorker(
  supabase: SupabaseClient,
): Promise<WorkerResult> {
  const result: WorkerResult = {
    reaped: 0,
    claimed: 0,
    done: 0,
    failed: 0,
    dead: 0,
  };

  // ── 1. Reaper : re-queue claims expirés ─────────────────────────────────────
  // Son erreur n'est pas ignorée : un reaper muet laisserait pour toujours en
  // 'processing' les ordres qu'un passage a laissés derrière lui.
  const { data: reaped, error: erreurReaper } = await supabase.rpc(
    'fn_reap_outbox_claims',
  );
  if (erreurReaper) {
    throw new Error(`fn_reap_outbox_claims : ${erreurReaper.message}`);
  }
  result.reaped = (reaped as number | null) ?? 0;

  // ── 2-3. Un ordre à la fois : réservation, puis traitement sous SON bail ─────
  const debut = Date.now();
  const traites = new Set<string>();
  for (let n = 0; n < PASSAGE_PLANIFIE_MAX_ORDRES; n++) {
    if (Date.now() - debut > BUDGET_PASSAGE_MS) break;

    const reserveA = Date.now();
    const { data: events, error } = await supabase.rpc(
      'fn_claim_outbox_batch',
      { p_limit: 1, p_lease_duration: BAIL },
    );
    // Réservation impossible : le dire, plutôt qu'un passage muet à zéro ordre.
    if (error) {
      throw new Error(`fn_claim_outbox_batch : ${error.message}`);
    }
    const event = ((events as ClaimedEvent[] | null) ?? [])[0];
    // Rien à réserver, ou un ordre déjà traité par CE passage : on s'arrête. Dans
    // ce second cas (inattendu : un ordre traité n'est plus réservable), l'ordre
    // vient d'être réservé de nouveau et n'est pas traité : il reste
    // 'processing', une tentative comptée, jusqu'au reaper.
    if (!event || traites.has(event.id)) break;
    traites.add(event.id);

    result.claimed++;
    await traiterEvent(supabase, event, result, reserveA);
  }

  return result;
}

// Traitement d'un ordre réservé : appel du prestataire HORS transaction, puis
// transaction de résultat. Commun au passage planifié et à l'envoi immédiat.
// `reserveA` = instant pris AVANT la requête de réservation : il fonde l'échéance
// des appels au prestataire et la limite d'écriture du résultat.
async function traiterEvent(
  supabase: SupabaseClient,
  event: ClaimedEvent,
  result: WorkerResult,
  reserveA: number,
): Promise<void> {
  // Bail presque écoulé : l'ordre ne nous appartient plus de façon sûre. On
  // n'écrit RIEN — ni succès, ni échec, ni alerte : le reaper le remettra en
  // file avec réconciliation obligatoire.
  // Le journal dit ce qui est écarté : un SUCCÈS écarté veut dire que l'ordre a
  // peut-être abouti chez le prestataire sans que la file le sache.
  const horsBail = (resultat: 'succes' | 'erreur', err?: unknown): boolean => {
    if (Date.now() < limiteEcriture(reserveA)) return false;
    logger.warn('outbox.passage_hors_bail', {
      event_id: event.id,
      aggregate_id: event.aggregate_id,
      event_type: event.event_type,
      resultat,
      ...(resultat === 'erreur' ? { erreur: String(err).slice(0, 200) } : {}),
    });
    return true;
  };

  try {
    const consumer = await avecEcheance(echeanceOrdre(reserveA), () =>
      processEvent(supabase, event),
    );
    if (horsBail('succes')) return;
    await markDone(supabase, event.id, consumer);
    result.done++;
  } catch (err) {
    if (horsBail('erreur', err)) return;
    const status = await handleError(supabase, event, err);
    if (status === 'dead') {
      result.dead++;
      await alertOutboxDead(event, err);
    } else {
      result.failed++;
      await maybeAlertEarlyCollecte(supabase, event);
    }
  }
}

// ─── Envoi immédiat des ordres d'UNE collecte (décision Val 2026-10-12) ──────
//
// Appelé juste après la mutation qui a écrit l'ordre dans la file (clic
// « Envoyer », validation d'une attribution) : réservation, appel du prestataire
// et résultat comme le passage planifié, bornés à une collecte. Le passage
// planifié reste le filet (reprises après erreur, ordre pas encore visible).
//
// Pas de reaper ici (invariant A3) : une réservation laissée par un passage
// mort n'est libérée que par le passage planifié. Là où il ne tourne pas (dev,
// local), l'ordre reste 'processing' et bloque les suivants de sa collecte.
//
// Le head-of-line ne rend qu'UN ordre à la fois par collecte : on rappelle la
// réservation après chaque ordre traité. Elle rend vide quand il n'en reste
// plus, ou quand l'ordre précédent n'est pas 'done' : la boucle s'arrête là.

/** Plafond d'ordres traités par appel : ceinture contre une boucle sans fin. */
const ENVOI_IMMEDIAT_MAX_ORDRES = 5;
/**
 * Seconde chance quand la première réservation est vide : l'ordre tout juste
 * écrit n'est pas réservable tant qu'une transaction plus ancienne est encore
 * ouverte (garde de visibilité txid). Une seule attente, puis le filet planifié.
 */
const ENVOI_IMMEDIAT_ATTENTE_VISIBILITE_MS = 1_000;

export async function runOutboxWorkerPourCollecte(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<WorkerResult> {
  const result: WorkerResult = {
    reaped: 0,
    claimed: 0,
    done: 0,
    failed: 0,
    dead: 0,
  };

  const debut = Date.now();
  for (let n = 0; n < ENVOI_IMMEDIAT_MAX_ORDRES; n++) {
    if (Date.now() - debut > BUDGET_PASSAGE_MS) break;

    let reserveA = Date.now();
    let claimed = await claimCollecte(supabase, collecteId);
    if (claimed.length === 0 && n === 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, ENVOI_IMMEDIAT_ATTENTE_VISIBILITE_MS),
      );
      reserveA = Date.now();
      claimed = await claimCollecte(supabase, collecteId);
    }
    if (claimed.length === 0) break;

    result.claimed += claimed.length;
    for (const event of claimed) {
      await traiterEvent(supabase, event, result, reserveA);
    }
  }

  return result;
}

async function claimCollecte(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<ClaimedEvent[]> {
  const { data, error } = await supabase.rpc('fn_claim_outbox_collecte', {
    p_collecte_id: collecteId,
    p_lease_duration: BAIL,
  });
  // Réservation impossible (fonction absente : migration pas encore appliquée ;
  // base injoignable) : le dire à l'appelant, qui le journalise. L'ordre reste
  // en file, le passage planifié l'enverra.
  if (error) {
    throw new Error(`fn_claim_outbox_collecte : ${error.message}`);
  }
  return (data as ClaimedEvent[] | null) ?? [];
}

// ─── Routing par event_type ───────────────────────────────────────────────────

async function processEvent(
  supabase: SupabaseClient,
  event: ClaimedEvent,
): Promise<ConsumerTag> {
  const { event_type, aggregate_id, aggregate_type } = event;

  if (aggregate_type === 'collecte') {
    const collecteId =
      (event.payload['collecte_id'] as string | undefined) ?? aggregate_id;
    const collecteRow = await fetchCollecte(supabase, collecteId);

    if (!collecteRow.prestataire_logistique_id) {
      // Pas de prestataire logistique → no-op succès (consumer noop_no_remote)
      return 'noop_no_remote';
    }

    const transporteurRow = await fetchTransporteur(
      supabase,
      collecteRow.prestataire_logistique_id,
    );
    const collecte = toCollecte(collecteRow);
    const transporteur = toTransporteur(transporteurRow);
    const provider = getLogistiqueProvider(transporteur, supabase);

    if (event_type === 'collecte.creee') {
      // E1 : dispatch rang 1..N. Tous les rangs partagent le même consumer
      // (même transporteur) → on retient le dernier (BL-P2-34).
      let consumer: ConsumerTag = 'noop_no_remote';
      for (let rang = 1; rang <= collecte.nb_camions_demande; rang++) {
        consumer = await (provider as AdapterMts1).dispatchCollecte(
          collecte,
          rang,
          { requiresReconciliation: event.requires_reconciliation },
        );
      }
      return consumer;
    }

    if (event_type === 'collecte.modifiee') {
      // A4 : propage requires_reconciliation (E2). Le PUT MTS-1 est idempotent ;
      // l'adapter s'en sert seulement pour confirmer que l'ordre existe encore
      // avant de ré-adresser sur reprise après timeout.
      return await (provider as AdapterMts1).updateCollecte(collecte, {
        requiresReconciliation: event.requires_reconciliation,
      });
    }

    if (event_type === 'collecte.annulee') {
      // A4 : propage requires_reconciliation (E3) — évite le faux « fenêtre
      // fermée » quand un DELETE timeout a en réalité abouti (404 idempotent).
      return await (provider as AdapterMts1).cancelCollecte(collecte, {
        requiresReconciliation: event.requires_reconciliation,
      });
    }

    // event_type collecte inconnu → no-op
    return 'noop_no_remote';
  }

  if (
    aggregate_type === 'lieu' &&
    event_type === 'lieu.champ_critique_modifie'
  ) {
    const lieuId =
      (event.payload['lieu_id'] as string | undefined) ?? aggregate_id;
    const lieu = await fetchLieu(supabase, lieuId);
    // Pour updateLieu, n'importe quel transporteur mts1 fait l'affaire : il ne
    // sert qu'à instancier le client MTS-1 (credentials au niveau du compte, pas
    // du transporteur). Le périmètre poussé, lui, est décidé par l'adapter, qui
    // restreint aux tournées du lieu effectivement dispatchées via MTS-1 —
    // `AdapterMts1.prestatairesMts1()`. Ce filtre n'est PAS optionnel : les
    // tournées Everest du même lieu portent elles aussi un
    // `external_ref_commande` (leur id de mission Everest).
    const { data: transporteurs, error: errTransporteurs } = await supabase
      .from('transporteurs')
      .select('id, type_tms, code_transporteur_mts1, prestataire_logistique_id')
      .eq('type_tms', 'mts1')
      .limit(1);

    // Cette lecture est la PREMIÈRE des trois du chemin E5 : sans ce throw, un
    // blip PostgREST la fait échouer avant les gardes de l'adapter, `data` vaut
    // null, et l'event est marqué `done` en `noop_no_remote` — « rien à pousser »
    // alors que la nouvelle adresse n'a atteint personne, sans retry ni alerte.
    // Même doctrine que `AdapterMts1.updateLieu` : Transient, donc les 3 paliers
    // du worker plutôt qu'un dead immédiat.
    if (errTransporteurs) {
      throw new LogistiqueTransientError(
        `E5 : référentiel transporteurs illisible — ${errTransporteurs.message}`,
      );
    }

    if (transporteurs?.length) {
      const provider = getLogistiqueProvider(
        toTransporteur(transporteurs[0] as TransporteurRow),
        supabase,
      );
      await provider.updateLieu(lieu);
      return 'adapter_mts1';
    }
    return 'noop_no_remote';
  }

  // event_type inconnu → no-op sans erreur
  return 'noop_no_remote';
}

// ─── Résultat TX ─────────────────────────────────────────────────────────────

// BL-P2-34 : on propage TOUJOURS le consumer effectif — sinon le COALESCE de
// fn_result_outbox conserve le 'adapter_mts1' posé à l'INSERT (no-op indistinguable
// d'un dispatch réel ; collecte AG routée Everest taguée mts1).
async function markDone(
  supabase: SupabaseClient,
  id: string,
  consumer: ConsumerTag,
): Promise<void> {
  await supabase.rpc('fn_result_outbox', {
    p_id: id,
    p_statut: 'done',
    p_consumer: consumer,
  });
}

async function handleError(
  supabase: SupabaseClient,
  event: ClaimedEvent,
  err: unknown,
): Promise<'failed' | 'dead'> {
  // `attempts` est incrémenté au claim (§04 l.2328) : il compte déjà la tentative
  // courante → le palier de retry se lit directement getNextRetryAt(attempts).
  const attempts = event.attempts;

  if (err instanceof CancelWindowClosedError) {
    // Fenêtre fermée — ne pas retenter, dead immédiat
    await supabase.rpc('fn_result_outbox', {
      p_id: event.id,
      p_statut: 'dead',
      p_last_error: err.message,
    });
    return 'dead';
  }

  if (err instanceof LogistiquePermanentError) {
    // 4xx — dead immédiat
    await supabase.rpc('fn_result_outbox', {
      p_id: event.id,
      p_statut: 'dead',
      p_last_error: err.message,
    });
    return 'dead';
  }

  if (err instanceof LogistiqueAmbiguousError) {
    // Timeout — retenter avec réconciliation obligatoire
    const nextRetry = getNextRetryAt(attempts);
    if (!nextRetry) {
      await supabase.rpc('fn_result_outbox', {
        p_id: event.id,
        p_statut: 'dead',
        p_last_error: err.message,
        p_requires_reconciliation: true,
      });
      return 'dead';
    }
    await supabase.rpc('fn_result_outbox', {
      p_id: event.id,
      p_statut: 'failed',
      p_last_error: err.message,
      p_next_retry_at: nextRetry.toISOString(),
      p_requires_reconciliation: true,
    });
    return 'failed';
  }

  // LogistiqueTransientError ou erreur inconnue — retry normal
  const nextRetry = getNextRetryAt(attempts);
  if (!nextRetry) {
    await supabase.rpc('fn_result_outbox', {
      p_id: event.id,
      p_statut: 'dead',
      p_last_error: String(err),
    });
    return 'dead';
  }

  await supabase.rpc('fn_result_outbox', {
    p_id: event.id,
    p_statut: 'failed',
    p_last_error: String(err),
    p_next_retry_at: nextRetry.toISOString(),
  });
  return 'failed';
}

/**
 * Politique de retry outbox (CDC §04 : 3 paliers 5 min / 1 h / 24 h, 4 tentatives).
 * `attempts` = compteur APRÈS le claim. `null` → plus de palier : passer en `dead`.
 * Exportée : le job `attribution_job` (cron process-attributions-ag) applique la même.
 */
export function getNextRetryAt(attempts: number): Date | null {
  const delayMs = RETRY_DELAYS_MS[attempts - 1];
  if (delayMs === undefined) return null;
  return new Date(Date.now() + delayMs);
}

// ─── Alertes ─────────────────────────────────────────────────────────────────

/**
 * Alerte DLQ (§07/03 l.24) — `outbox_events.statut = 'dead'` après épuisement des
 * paliers, **toutes familles de `consumer` confondues, `attribution_job` inclus**
 * (précisé CDC 2026-09-14) : l'isolation par famille ne doit pas créer de DLQ
 * silencieuse — un email d'attribution AG définitivement perdu = association ou
 * transporteur jamais prévenu.
 *
 * Exportée : le cron `process-attributions-ag` (seul autre consommateur de
 * l'outbox, famille `attribution_job`) émet la MÊME alerte via cette primitive
 * plutôt qu'une copie du message.
 */
export async function alertOutboxDead(
  event: Pick<ClaimedEvent, 'id' | 'event_type' | 'aggregate_id' | 'attempts'>,
  err: unknown,
): Promise<void> {
  await sendAlert({
    canal: 'critique',
    titre: `[DLQ] Outbox event mort — ${event.event_type}`,
    message: `aggregate_id=${event.aggregate_id} attempts=${event.attempts}`,
    metadata: { event_id: event.id, error: String(err) },
  });
}

async function maybeAlertEarlyCollecte(
  supabase: SupabaseClient,
  event: ClaimedEvent,
): Promise<void> {
  // Seuil §04 l.2337 : alerte anticipée dès attempts ≥ 2 (attempts compte la
  // tentative au claim — cf. §04 l.2328).
  if (event.attempts < 2) return;

  // Date de référence selon aggregate_type (§07/03, étendu aux events `lieu` le
  // 2026-09-16) : un E5 `lieu.champ_critique_modifie` en échec avant une collecte
  // du soir resterait sinon silencieux ~25 h (DLQ seule), camion à l'ancienne
  // adresse. Tout autre aggregate_type n'a pas de collecte de référence.
  const reference =
    event.aggregate_type === 'collecte'
      ? await fetchDateCollecte(supabase, event)
      : event.aggregate_type === 'lieu'
        ? await fetchProchaineCollecteDuLieu(supabase, event)
        : null;
  if (!reference) return;

  const dateCollecte = new Date(reference.date_collecte);
  const seuil = new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (dateCollecte > seuil) return;

  // Une seule alerte par event (la collecte la plus proche), même canal que le
  // cas collecte — jamais une alerte par collecte du lieu.
  const cible =
    event.aggregate_type === 'lieu'
      ? `lieu_id=${event.aggregate_id} collecte_id=${reference.id}`
      : `collecte_id=${reference.id}`;
  await sendAlert({
    canal: 'critique',
    titre: `[ALERTE] Collecte J-1 en échec d'envoi MTS-1`,
    message: `${cible} date=${reference.date_collecte} attempts=${event.attempts}`,
    metadata: { event_id: event.id, event_type: event.event_type },
  });
}

interface CollecteDeReference {
  id: string;
  date_collecte: string;
}

async function fetchDateCollecte(
  supabase: SupabaseClient,
  event: ClaimedEvent,
): Promise<CollecteDeReference | null> {
  const collecteId =
    (event.payload['collecte_id'] as string | undefined) ?? event.aggregate_id;
  const { data } = await supabase
    .from('collectes')
    .select('date_collecte')
    .eq('id', collecteId)
    .maybeSingle();
  if (!data) return null;
  return { id: collecteId, date_collecte: data.date_collecte as string };
}

// Statuts terminaux de la machine à états collecte (CLAUDE.md §3) + sorties
// annulee / rejetee_par_prestataire : plus rien à envoyer au transporteur.
const STATUTS_COLLECTE_TERMINAUX =
  '(realisee,realisee_sans_collecte,cloturee,annulee,rejetee_par_prestataire)';

/**
 * Plus proche collecte FUTURE NON TERMINALE du lieu (§07/03). Le lieu est porté
 * par l'événement parent (collectes n'a pas de lieu_id) → jointure
 * `evenements.lieu_id`, comme `AdapterMts1.updateLieu`.
 */
async function fetchProchaineCollecteDuLieu(
  supabase: SupabaseClient,
  event: ClaimedEvent,
): Promise<CollecteDeReference | null> {
  const lieuId =
    (event.payload['lieu_id'] as string | undefined) ?? event.aggregate_id;
  const { data } = await supabase
    .from('collectes')
    .select('id, date_collecte, evenements!inner(lieu_id)')
    .eq('evenements.lieu_id', lieuId)
    .gte('date_collecte', jourParis())
    .not('statut', 'in', STATUTS_COLLECTE_TERMINAUX)
    .order('date_collecte', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id as string, date_collecte: data.date_collecte as string };
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchCollecte(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<CollecteRow> {
  // Le lieu est porté par l'ÉVÉNEMENT parent ; les contacts, par LA collecte
  // (`collecte_contacts`, refonte Val 2026-10-22, C1–C2) : deux collectes d'un
  // même événement peuvent avoir des contacts différents. Une modification des
  // contacts au niveau de l'événement est recopiée sur ses collectes
  // (fn_modifier_evenement), donc un re-dispatch E2 propage bien les champs
  // édités (requirement B1, fix M1.5a 2026-06-26).
  const { data, error } = await supabase
    .from('collectes')
    .select(
      `
      id, type, date_collecte, heure_collecte, nb_camions_demande, pax,
      statut_tms, controle_acces_requis, informations_supplementaires, notes_internes,
      prestataire_logistique_id, lieu_overrides,
      contacts:collecte_contacts(
        contact_principal_nom, contact_principal_telephone,
        contact_secours_nom, contact_secours_telephone
      ),
      evenement:evenements!inner(
        traiteur:organisations!traiteur_operationnel_organisation_id(nom),
        lieux:lieux!lieu_id(id, nom, adresse_acces, code_postal, ville, latitude, longitude, acces_details, type_vehicule_max, contraintes_horaires, stationnement, acces_office, flux_autorises)
      )
    `,
    )
    .eq('id', collecteId)
    .single();

  if (error || !data) {
    throw new LogistiquePermanentError(`collecte introuvable : ${collecteId}`);
  }

  // Les deux embeds portent une FK SORTANTE (`collectes.evenement_id`,
  // `evenements.lieu_id`) : PostgREST renvoie un OBJET. Le déballage reste
  // défensif (Array.isArray) — il couvre les deux formes.
  type EvenementJoin = {
    traiteur: { nom: string | null } | { nom: string | null }[] | null;
    lieux: CollecteRow['lieux'] | CollecteRow['lieux'][];
  };
  type ContactsJoin = {
    contact_principal_nom: string;
    contact_principal_telephone: string;
    contact_secours_nom: string | null;
    contact_secours_telephone: string | null;
  };
  const raw = data as unknown as Omit<
    CollecteRow,
    | 'lieux'
    | 'traiteur_nom'
    | 'pax'
    | 'contact_principal_nom'
    | 'contact_principal_telephone'
    | 'contact_secours_nom'
    | 'contact_secours_telephone'
  > & {
    evenement: EvenementJoin | EvenementJoin[];
    contacts: ContactsJoin | ContactsJoin[] | null;
    lieu_overrides: Record<string, unknown> | null;
    pax: number | null;
  };

  const evt = Array.isArray(raw.evenement) ? raw.evenement[0]! : raw.evenement;
  // Relation 1–1 (la clé étrangère est aussi la clé primaire) : PostgREST rend
  // un objet ; le déballage reste défensif. Absente = jamais le contact d'une
  // autre collecte ni celui de l'événement : la commande ne part pas.
  const contacts = Array.isArray(raw.contacts)
    ? (raw.contacts[0] ?? null)
    : raw.contacts;
  if (!contacts) {
    throw new LogistiquePermanentError(
      `contacts de la collecte introuvables : ${collecteId}`,
    );
  }
  // Pax de LA collecte (décision Val 2026-10-20), jamais celui de l'événement :
  // c'est la somme des jours.
  const pax = raw.pax;
  const traiteur = Array.isArray(evt.traiteur) ? evt.traiteur[0] : evt.traiteur;
  const lieuOfficiel = Array.isArray(evt.lieux) ? evt.lieux[0]! : evt.lieux;
  // PROG-01/PROG-03 — l'adresse d'accès corrigée par collecte (lieu_overrides,
  // §06.01) doit parvenir au transporteur. Sans ce merge, le worker re-fetch le
  // lieu officiel et le camion se présente à la mauvaise adresse.
  const lieu = applyLieuOverrides(lieuOfficiel, raw.lieu_overrides);

  // BL-P1-API-02 — lieu de dépôt AG : l'association destinataire est attribuée
  // APRÈS la création de la collecte (§08 l.154), donc connue au moment où le
  // worker consomme `collecte.creee` émis par la cascade d'attribution (R5). On
  // résout son point favori MTS-1 (associations.id_point_collecte_mts1) ET son
  // adresse postale via la dernière attribution_antgaspi : c'est l'adresse de
  // livraison transmise au prestataire (décision Val 2026-10-01 — l'association
  // est choisie AVANT le prestataire). ZD = jamais d'association → NULL.
  const association =
    raw.type === 'anti_gaspi'
      ? await fetchAssociationDestinataire(supabase, raw.id)
      : null;

  // Véhicule souhaité par l'Admin (migration 20261001213000) : lu à part et
  // tolérant à l'ABSENCE de la colonne — le code peut être déployé avant la
  // migration sans transformer chaque event en « collecte introuvable » → dead.
  // Composé pour les N commandes identiques : « 1 par commande » (décision Val
  // 2026-10-01, N véhicules = N commandes).
  const typeVehiculeSouhaite = await lireTypeVehiculeSouhaite(supabase, raw.id);

  return {
    id: raw.id,
    type: raw.type,
    date_collecte: raw.date_collecte,
    heure_collecte: raw.heure_collecte,
    nb_camions_demande: raw.nb_camions_demande,
    statut_tms: raw.statut_tms,
    controle_acces_requis: raw.controle_acces_requis,
    // Commentaire au transporteur (format décidé par Val le 2026-10-15, C60-C62,
    // cf. infos-acces.ts) : le seul canal libre routé (`comment` / `notes`).
    // Composé ICI, donc une seule fois pour les deux adapters (garde-fou 2), et à
    // partir du lieu FUSIONNÉ — le lieu officiel retransmettrait précisément
    // l'erreur corrigée par #304. Les informations d'accès, le nom du contact de
    // secours (arbitrage Val 2026-09-14), le véhicule souhaité (décision Val
    // 2026-10-01) et le point B n'ont aucun champ natif MTS-1/Everest en V1.
    informations_supplementaires: composerCommentaireTransporteur({
      traiteurNom: traiteur?.nom,
      pax,
      lieu,
      informationsSupplementaires: raw.informations_supplementaires,
      contact: {
        nom: contacts.contact_principal_nom,
        telephone: contacts.contact_principal_telephone,
      },
      contactSecours: {
        nom: contacts.contact_secours_nom,
        telephone: contacts.contact_secours_telephone,
      },
      vehicule:
        raw.type === 'anti_gaspi'
          ? { type: typeVehiculeSouhaite, nombre: raw.nb_camions_demande }
          : null,
      livraison: association
        ? { instructionsAcces: association.instructions_acces }
        : null,
    }),
    traiteur_nom: traiteur?.nom ?? null,
    pax,
    notes_internes: raw.notes_internes,
    prestataire_logistique_id: raw.prestataire_logistique_id,
    type_vehicule_souhaite: typeVehiculeSouhaite,
    association_id_point_collecte_mts1:
      association?.id_point_collecte_mts1 ?? null,
    association_adresse: association
      ? `${association.adresse}, ${association.code_postal} ${association.ville}`
      : null,
    association_contact_nom: association?.contact_nom ?? null,
    association_contact_telephone: association?.contact_telephone ?? null,
    contact_principal_nom: contacts.contact_principal_nom,
    contact_principal_telephone: contacts.contact_principal_telephone,
    contact_secours_nom: contacts.contact_secours_nom,
    contact_secours_telephone: contacts.contact_secours_telephone,
    lieux: lieu,
  };
}

// `collectes.type_vehicule_souhaite` — null si non précisé OU si la colonne
// n'existe pas encore (42703 / PGRST204 : migration non appliquée) : tracé en
// warn, jamais bloquant — la commande part sans la ligne « Véhicule souhaité ».
async function lireTypeVehiculeSouhaite(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('collectes')
    .select('type_vehicule_souhaite')
    .eq('id', collecteId)
    .maybeSingle();
  if (error) {
    // Seule la colonne ABSENTE est tolérée (migration 20261001213000 pas encore
    // appliquée). Tout autre échec de lecture est un incident passager : Transient,
    // le worker retente — une commande MTS-1 partie sans la ligne véhicule ne se
    // corrige plus (le re-push E2 ne porte pas ce canal à l'identique).
    if (error.code === '42703' || error.code === 'PGRST204') {
      logger.warn('outbox.type_vehicule_souhaite_colonne_absente', {
        collecte_id: collecteId,
        error_code: error.code,
      });
      return null;
    }
    throw new LogistiqueTransientError(
      `lecture type_vehicule_souhaite ${collecteId} : ${error.message}`,
    );
  }
  return (
    (data as { type_vehicule_souhaite?: string | null } | null)
      ?.type_vehicule_souhaite ?? null
  );
}

// BL-P1-API-02 — association destinataire d'une collecte AG (point B) via son
// attribution (`collecte_id` UNIQUE → maybeSingle). Aucune attribution → null
// (l'adapter refuse) ; lecture en échec → Transient (jamais confondue avec
// « pas d'association », sinon un blip PostgREST tuerait l'event).
interface AssociationDestinataireRow {
  id_point_collecte_mts1: string | null;
  adresse: string;
  code_postal: string;
  ville: string;
  contact_nom: string | null;
  contact_telephone: string | null;
  instructions_acces: string | null;
}

async function fetchAssociationDestinataire(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<AssociationDestinataireRow | null> {
  const { data, error } = await supabase
    .from('attributions_antgaspi')
    .select(
      'associations:association_id(id_point_collecte_mts1, adresse, code_postal, ville, contact_nom, contact_telephone, instructions_acces)',
    )
    .eq('collecte_id', collecteId)
    .maybeSingle();

  if (error) {
    throw new LogistiqueTransientError(
      `lecture attribution AG ${collecteId} : ${error.message}`,
    );
  }
  if (!data) return null;
  const assoc = (data as { associations?: unknown }).associations;
  const row = Array.isArray(assoc) ? assoc[0] : assoc;
  return (row as AssociationDestinataireRow | null | undefined) ?? null;
}

async function fetchTransporteur(
  supabase: SupabaseClient,
  prestaId: string,
): Promise<TransporteurRow> {
  const { data, error } = await supabase
    .from('transporteurs')
    .select('id, type_tms, code_transporteur_mts1, prestataire_logistique_id')
    .eq('prestataire_logistique_id', prestaId)
    .single();

  if (error || !data) {
    throw new LogistiquePermanentError(
      `transporteur introuvable pour presta : ${prestaId}`,
    );
  }
  return data as TransporteurRow;
}

async function fetchLieu(
  supabase: SupabaseClient,
  lieuId: string,
): Promise<Lieu> {
  const { data, error } = await supabase
    .from('lieux')
    .select(
      'id, nom, adresse_acces, code_postal, ville, latitude, longitude, acces_details, type_vehicule_max, contraintes_horaires',
    )
    .eq('id', lieuId)
    .single();

  if (error || !data) {
    throw new LogistiquePermanentError(`lieu introuvable : ${lieuId}`);
  }
  return data as Lieu;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function toCollecte(row: CollecteRow): Collecte {
  return {
    id: row.id,
    type: row.type as 'zero_dechet' | 'anti_gaspi',
    date_collecte: row.date_collecte,
    heure_collecte: row.heure_collecte,
    nb_camions_demande: row.nb_camions_demande,
    statut_tms: row.statut_tms,
    controle_acces_requis: row.controle_acces_requis,
    informations_supplementaires: row.informations_supplementaires,
    notes_internes: row.notes_internes,
    traiteur_nom: row.traiteur_nom,
    pax: row.pax,
    type_vehicule_souhaite: row.type_vehicule_souhaite,
    contact_principal_nom: row.contact_principal_nom,
    contact_principal_telephone: row.contact_principal_telephone,
    contact_secours_nom: row.contact_secours_nom,
    contact_secours_telephone: row.contact_secours_telephone,
    association_id_point_collecte_mts1: row.association_id_point_collecte_mts1,
    association_adresse: row.association_adresse,
    association_contact_nom: row.association_contact_nom,
    association_contact_telephone: row.association_contact_telephone,
    lieu: row.lieux,
  };
}

function toTransporteur(row: TransporteurRow): Transporteur {
  return {
    id: row.id,
    type_tms: row.type_tms as 'mts1' | 'a_toutes' | 'autre',
    code_transporteur_mts1: row.code_transporteur_mts1,
    prestataire_logistique_id: row.prestataire_logistique_id,
  };
}

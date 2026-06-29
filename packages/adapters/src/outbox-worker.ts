// Worker outbox — pattern lease/claim (M1.5a).
//
// Flux :
//   1. fn_reap_outbox_claims() — re-queue les claims expirés
//   2. fn_claim_outbox_batch() — TX courte de claim (SKIP LOCKED + visibilité txid)
//   3. Pour chaque event : appel adapter MTS-1 HORS TRANSACTION
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
// A3 (concurrence claim/reaper) : aucune double-exécution concurrente possible
// dans ce déploiement — le lease (120 s) dépasse maxDuration de la route cron
// (60 s, cf. api/cron/outbox-worker/route.ts) et les invocations Vercel Cron ne se
// chevauchent pas (intervalle 15 min). Le reaper ne re-queue qu'un claim EXPIRÉ,
// donc tenu par un run mort. Si maxDuration venait à dépasser le lease, il faudrait
// un heartbeat de lease ou 1 event/run — invariant à préserver.

import type { SupabaseClient } from '@supabase/supabase-js';

import { sendAlert } from '@savr/shared/src/alerting/slack.js';

import {
  CancelWindowClosedError,
  LogistiqueAmbiguousError,
  LogistiquePermanentError,
  getLogistiqueProvider,
} from './index.js';
import type { Collecte, ConsumerTag, Lieu, Transporteur } from './index.js';
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
  const { data: reaped } = await supabase.rpc('fn_reap_outbox_claims');
  result.reaped = (reaped as number | null) ?? 0;

  // ── 2. Claim batch ──────────────────────────────────────────────────────────
  const { data: events } = await supabase.rpc('fn_claim_outbox_batch', {
    p_limit: 10,
  });

  const claimed = (events as ClaimedEvent[] | null) ?? [];
  result.claimed = claimed.length;

  // ── 3. Traitement séquentiel ─────────────────────────────────────────────────
  for (const event of claimed) {
    try {
      const consumer = await processEvent(supabase, event);
      await markDone(supabase, event.id, consumer);
      result.done++;
    } catch (err) {
      const status = await handleError(supabase, event, err);
      if (status === 'dead') {
        result.dead++;
        await alertDlq(event, err);
      } else {
        result.failed++;
        await maybeAlertEarlyCollecte(supabase, event);
      }
    }
  }

  return result;
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
    // Pour updateLieu, on utilise n'importe quel provider mts1 disponible
    // (le lieu peut être associé à plusieurs transporteurs — l'adapter
    //  filtre lui-même les collectes futures du lieu concerné)
    const { data: transporteurs } = await supabase
      .from('transporteurs')
      .select('id, type_tms, code_transporteur_mts1, prestataire_logistique_id')
      .eq('type_tms', 'mts1')
      .limit(1);

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

function getNextRetryAt(attempts: number): Date | null {
  const delayMs = RETRY_DELAYS_MS[attempts - 1];
  if (delayMs === undefined) return null;
  return new Date(Date.now() + delayMs);
}

// ─── Alertes ─────────────────────────────────────────────────────────────────

async function alertDlq(event: ClaimedEvent, err: unknown): Promise<void> {
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
  if (event.aggregate_type !== 'collecte') return;

  const collecteId =
    (event.payload['collecte_id'] as string | undefined) ?? event.aggregate_id;
  const { data } = await supabase
    .from('collectes')
    .select('date_collecte')
    .eq('id', collecteId)
    .maybeSingle();

  if (!data) return;

  const dateCollecte = new Date(data.date_collecte as string);
  const seuil = new Date(Date.now() + 24 * 60 * 60 * 1000);

  if (dateCollecte <= seuil) {
    await sendAlert({
      canal: 'critique',
      titre: `[ALERTE] Collecte J-1 en échec d'envoi MTS-1`,
      message: `collecte_id=${collecteId} date=${data.date_collecte} attempts=${event.attempts}`,
      metadata: { event_id: event.id, event_type: event.event_type },
    });
  }
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchCollecte(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<CollecteRow> {
  // Contacts + lieu sont portés par l'ÉVÉNEMENT parent (§06.04 l.375 « Pas de
  // duplication côté collectes » ; §08 l.411 contacts ← evenements.contact_*).
  // On les lit donc via la jointure evenements → un re-dispatch E2 propage bien
  // les champs événement édités (requirement B1, fix M1.5a 2026-06-26).
  const { data, error } = await supabase
    .from('collectes')
    .select(
      `
      id, type, date_collecte, heure_collecte, nb_camions_demande,
      statut_tms, controle_acces_requis, informations_supplementaires, notes_internes,
      prestataire_logistique_id,
      evenement:evenements!inner(
        contact_principal_nom, contact_principal_telephone,
        contact_secours_nom, contact_secours_telephone,
        lieux:lieux!lieu_id(id, nom, adresse_acces, code_postal, ville, latitude, longitude, acces_details, type_vehicule_max, contraintes_horaires)
      )
    `,
    )
    .eq('id', collecteId)
    .single();

  if (error || !data) {
    throw new LogistiquePermanentError(`collecte introuvable : ${collecteId}`);
  }

  // Supabase renvoie les relations !inner comme tableau — on prend [0].
  type EvenementJoin = {
    contact_principal_nom: string;
    contact_principal_telephone: string;
    contact_secours_nom: string | null;
    contact_secours_telephone: string | null;
    lieux: CollecteRow['lieux'] | CollecteRow['lieux'][];
  };
  const raw = data as unknown as Omit<
    CollecteRow,
    | 'lieux'
    | 'contact_principal_nom'
    | 'contact_principal_telephone'
    | 'contact_secours_nom'
    | 'contact_secours_telephone'
  > & { evenement: EvenementJoin | EvenementJoin[] };

  const evt = Array.isArray(raw.evenement) ? raw.evenement[0]! : raw.evenement;
  const lieu = Array.isArray(evt.lieux) ? evt.lieux[0]! : evt.lieux;

  return {
    id: raw.id,
    type: raw.type,
    date_collecte: raw.date_collecte,
    heure_collecte: raw.heure_collecte,
    nb_camions_demande: raw.nb_camions_demande,
    statut_tms: raw.statut_tms,
    controle_acces_requis: raw.controle_acces_requis,
    informations_supplementaires: raw.informations_supplementaires,
    notes_internes: raw.notes_internes,
    prestataire_logistique_id: raw.prestataire_logistique_id,
    contact_principal_nom: evt.contact_principal_nom,
    contact_principal_telephone: evt.contact_principal_telephone,
    contact_secours_nom: evt.contact_secours_nom,
    contact_secours_telephone: evt.contact_secours_telephone,
    lieux: lieu,
  };
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
    contact_principal_nom: row.contact_principal_nom,
    contact_principal_telephone: row.contact_principal_telephone,
    contact_secours_nom: row.contact_secours_nom,
    contact_secours_telephone: row.contact_secours_telephone,
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

// Webhook entrant Everest — M2.5.
// Everest envoie POST application/x-www-form-urlencoded.
// Sécurisé par X-Webhook-Token (secret en Vault, non devinable — M14 D6).
// Pattern W2 (M14) adapté V1 Plateforme (tables plateforme.* au lieu de tms.*).

import { timingSafeEqual } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { fetchEverestMissionDetails } from '@savr/adapters/src/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { serverError, withApiTrace } from '@/lib/api-helpers.js';

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

  if (inboxErr) {
    // Conflit unique → déjà traité
    if (inboxErr.code === '23505') {
      return NextResponse.json({ ok: true, deduplicated: true });
    }
    return serverError(inboxErr, 'webhooks.everest.inbox_insert');
  }

  const inboxId = (inboxRow as { id: string }).id;

  await supabase.from('integrations_logs').insert({
    integration: 'everest',
    direction: 'entrant',
    methode: 'POST',
    endpoint: '/api/webhooks/everest',
    statut_http: 200,
    correlation_id: missionId,
  });

  // ── 4. Lookup everest_missions par everest_mission_id ─────────────────────
  const { data: mission } = await supabase
    .from('everest_missions')
    .select('id, tournee_id, collecte_id, statut_everest')
    .eq('everest_mission_id', missionId)
    .maybeSingle();

  if (!mission) {
    // Mission inconnue : on logge et on répond 200 (ne pas retenter Everest)
    await supabase
      .from('integrations_inbox')
      .update({
        traite: true,
        traite_at: new Date().toISOString(),
        erreur: 'mission_inconnue',
      })
      .eq('id', inboxId);
    return NextResponse.json({ ok: true, skipped: 'mission_inconnue' });
  }

  type MissionRow = {
    id: string;
    tournee_id: string;
    collecte_id: string;
    statut_everest: string;
  };
  const m = mission as unknown as MissionRow;

  // Garde statuts terminaux : pas de régression (M14 W2 note floue #4)
  if (TERMINAL_STATUTS.has(m.statut_everest)) {
    await supabase
      .from('everest_missions')
      .update({
        payload_latest_update: payload,
        derniere_sync_at: new Date().toISOString(),
      })
      .eq('id', m.id);
    await supabase
      .from('integrations_inbox')
      .update({ traite: true, traite_at: new Date().toISOString() })
      .eq('id', inboxId);
    return NextResponse.json({ ok: true, skipped: 'statut_terminal' });
  }

  // ── 5. Switch event_type ──────────────────────────────────────────────────
  await handleEventType(supabase, m, missionId, eventType, params, payload);

  // ── 6. Marquer inbox traité ───────────────────────────────────────────────
  await supabase
    .from('integrations_inbox')
    .update({ traite: true, traite_at: new Date().toISOString() })
    .eq('id', inboxId);

  return NextResponse.json({ ok: true });
}

async function handleEventType(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
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

      await supabase
        .from('everest_missions')
        .update(updates)
        .eq('id', mission.id);

      // Passer statut_tms → 'acceptee' si pas encore acceptée
      // (trigger fn_sync_statut_collecte_from_tms dérive collectes.statut)
      const { data: collecte } = await supabase
        .from('collectes')
        .select('statut_tms')
        .eq('id', mission.collecte_id)
        .maybeSingle();

      const statut_tms_actuel = (collecte as { statut_tms: string } | null)
        ?.statut_tms;
      if (statut_tms_actuel === 'attribuee_en_attente_acceptation') {
        await supabase
          .from('collectes')
          .update({ statut_tms: 'acceptee' })
          .eq('id', mission.collecte_id);
      }
      break;
    }

    case 'mission_pickedup': {
      await supabase
        .from('everest_missions')
        .update({
          statut_everest: 'in_progress',
          derniere_sync_at: now,
          payload_latest_update: payload,
        })
        .eq('id', mission.id);
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
        await supabase.from('integrations_logs').insert({
          integration: 'everest',
          direction: 'sortant',
          methode: 'GET',
          endpoint: `/missions/${missionId}`,
          erreur: `refetch_failed: ${err instanceof Error ? err.message : String(err)}`,
          correlation_id: missionId,
        });
        await supabase
          .from('everest_missions')
          .update({
            statut_everest: 'completed',
            derniere_sync_at: now,
            payload_latest_update: payload,
          })
          .eq('id', mission.id);
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
      await supabase
        .from('everest_missions')
        .update(updates)
        .eq('id', mission.id);

      // BL-P1-API-04 (d) : course sans marchandise (mission_status re-fetché) →
      // realisee_sans_collecte (AG, §05). Le coût + la mobilisation restent dus
      // (facture tarif normal V1), d'où la persistance cout/preuve ci-dessus.
      if (isCourseVide(detail.status)) {
        await transitionRealiseeSansCollecte(
          supabase,
          mission,
          missionId,
          detail,
          now,
        );
      }
      // Sinon, M05 reste source de vérité du statut opérationnel — pas de mutation collectes.statut
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
        await supabase
          .from('everest_missions')
          .update({
            statut_everest: 'completed_incomplete',
            derniere_sync_at: now,
            payload_latest_update: payload,
          })
          .eq('id', mission.id);
        await transitionRealiseeSansCollecte(
          supabase,
          mission,
          missionId,
          detail,
          now,
        );
        break;
      }

      // Échec réel.
      await supabase
        .from('everest_missions')
        .update({
          statut_everest: 'failed',
          derniere_sync_at: now,
          payload_latest_update: payload,
        })
        .eq('id', mission.id);
      // Alerte Ops via integrations_logs (monitoring Admin)
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
      await rejeterSiPreAcceptation(supabase, mission, missionId, 'échouée');
      break;
    }

    case 'mission_cancelled': {
      // Vérifier si l'annulation a été initiée par Savr (traçage audit_log)
      const { data: auditRow } = await supabase
        .from('audit_log')
        .select('id')
        .eq('action', 'CANCEL')
        .contains('new_values', {
          everest_mission_id: params.get('mission_id'),
        })
        .limit(1)
        .maybeSingle();

      const estInitieSavr = !!auditRow;
      const nouveauStatut = estInitieSavr
        ? 'cancelled'
        : 'cancelled_externally';

      await supabase
        .from('everest_missions')
        .update({
          statut_everest: nouveauStatut,
          derniere_sync_at: now,
          payload_latest_update: payload,
        })
        .eq('id', mission.id);

      if (!estInitieSavr) {
        // Alerte critique : annulation externe non initiée par Savr
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
          'annulée par le prestataire',
        );
      }
      break;
    }

    case 'mission_late': {
      // Alerte désactivée par défaut V1 (M14 A_M14_07, sobriété)
      await supabase
        .from('everest_missions')
        .update({ payload_latest_update: payload, derniere_sync_at: now })
        .eq('id', mission.id);
      break;
    }

    default: {
      // event_type inconnu : loggé, pas d'alerte (M14 sobriété Bloc 3 A1)
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

async function fetchCollecteEtat(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  collecteId: string,
): Promise<{ type: string; statut: string; statut_tms: string } | null> {
  const { data } = await supabase
    .from('collectes')
    .select('type, statut, statut_tms')
    .eq('id', collecteId)
    .maybeSingle();
  return (
    (data as { type: string; statut: string; statut_tms: string } | null) ??
    null
  );
}

// (d) Course sans marchandise → realisee_sans_collecte. AG uniquement (§05 : la ZD
// a toujours des déchets). Motif chauffeur = libellé mission_status re-fetché ;
// photo du lieu = preuve re-fetchée si fournie, sinon NULL (Everest n'expose pas
// systématiquement de photo en V1 — colonne nullable). Alerte Ops in-app
// type=collecte_aucun_repas (Gherkin §08 l.332). Pas d'attestation, facture tarif
// normal V1 (§08 §1 l.103-107). Jamais de régression d'un statut terminal.
async function transitionRealiseeSansCollecte(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  mission: { id: string; collecte_id: string },
  missionId: string,
  detail: Awaited<ReturnType<typeof fetchEverestMissionDetails>>,
  now: string,
): Promise<void> {
  const etat = await fetchCollecteEtat(supabase, mission.collecte_id);
  if (!etat) return;

  if (etat.type !== 'anti_gaspi') {
    // realisee_sans_collecte n'existe pas en ZD → on trace, on ne transitionne pas.
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

  if (STATUTS_TERMINAUX_COLLECTE.has(etat.statut)) return;

  await supabase
    .from('collectes')
    .update({
      statut: 'realisee_sans_collecte',
      realisee_at: now,
      aucun_repas_motif: detail.status,
      aucun_repas_photo_url: detail.preuve_url ?? null,
    })
    .eq('id', mission.collecte_id);

  await supabase.rpc('f_upsert_alerte_admin', {
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
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  mission: { id: string; collecte_id: string },
  missionId: string,
  motifCourt: string,
): Promise<void> {
  const etat = await fetchCollecteEtat(supabase, mission.collecte_id);
  if (!etat) return;
  if (etat.statut_tms !== 'attribuee_en_attente_acceptation') return;

  await supabase
    .from('collectes')
    .update({ statut_tms: 'rejetee_par_prestataire' })
    .eq('id', mission.collecte_id);

  await supabase.rpc('f_upsert_alerte_admin', {
    p_code: 'collecte_rejetee_prestataire',
    p_titre: 'Course Everest rejetée par le prestataire',
    p_message: `Mission Everest ${motifCourt} avant acceptation (${missionId}) — collecte ${mission.collecte_id} repassée en file d'attente (rejetee_par_prestataire). Réattribuer (§08 §3).`,
    p_entity_type: 'collectes',
    p_entity_id: mission.collecte_id,
  });
}

export const POST = withApiTrace(postHandler);

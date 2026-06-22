// Webhook entrant Everest — M2.5.
// Everest envoie POST application/x-www-form-urlencoded.
// Sécurisé par X-Webhook-Token (secret en Vault, non devinable — M14 D6).
// Pattern W2 (M14) adapté V1 Plateforme (tables plateforme.* au lieu de tms.*).

import { timingSafeEqual } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { serverError } from '@/lib/api-helpers.js';

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

export async function POST(req: NextRequest): Promise<NextResponse> {
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
  await handleEventType(supabase, m, eventType, params, payload);

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
      const updates: Record<string, unknown> = {
        statut_everest: 'completed',
        derniere_sync_at: now,
        payload_latest_update: payload,
      };
      const cout = params.get('cost') ?? params.get('cout_ht');
      const preuveUrl = params.get('proof_url') ?? params.get('preuve_url');
      if (cout) updates['cout_everest_ht'] = parseFloat(cout);
      if (preuveUrl) updates['preuve_course_url'] = preuveUrl;
      await supabase
        .from('everest_missions')
        .update(updates)
        .eq('id', mission.id);
      // M05 reste source de vérité pour le statut opérationnel — pas de mutation collectes.statut
      break;
    }

    case 'mission_failed': {
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

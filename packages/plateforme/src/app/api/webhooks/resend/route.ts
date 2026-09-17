// Webhook entrant Resend — BL-P1-API-09 (M0.11).
// Resend signe ses webhooks via svix (headers svix-id/svix-timestamp/svix-signature,
// secret de signing Resend en Vault : RESEND_WEBHOOK_SECRET).
// CDC §08 §4 « Webhooks Resend » (l.551-558) :
//   • Signature svix absente/invalide → 401, aucune écriture.
//   • Dédup : même svix-id déjà appliqué → no-op idempotent (integrations_inbox).
//   • resend_id inconnu (aucune ligne emails_envoyes) → 200 (évite la boucle de retry
//     Resend) + anomalie tracée.
//   • bounce / echec sont terminaux : un event tardif ne régresse pas le statut.
//
// Échec de lecture/écriture (lecture emails_envoyes, MAJ statut, trace de l'anomalie
// « resend_id inconnu », marquage inbox) :
//   • réponse 500 générique, inbox NON marquée `traite` → Resend (svix) relance
//     l'event sur non-2xx et le rejeu le retraite au lieu de le prendre pour un
//     doublon (§4) ;
//   • pas d'alerte : le CDC §08 §4 n'en prévoit aucune pour ce webhook, et une
//     anomalie fonctionnelle n'irait jamais sur Slack (CLAUDE.md §13) ;
//   • les autres inserts `integrations_logs` restent best-effort (trace technique :
//     leur perte ne fausse aucun état), tracés en logger.error.

import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@savr/shared/src/logger/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { serverError, withApiTrace } from '@/lib/api-helpers.js';
import { verifySvixSignature } from '@/lib/webhooks/svix.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Statuts terminaux emails_envoyes : jamais régressés par un event Resend tardif (l.549).
const STATUTS_TERMINAUX = new Set(['bounced', 'failed']);

// Mapping event Resend → plateforme.email_statut_enum (queued/sent/delivered/bounced/failed).
// CDC §08 §4 ne nomme que delivered/bounced/complained pour la MAJ de statut.
// 'email.complained' (plainte spam) n'a pas de valeur dédiée en V1 → mappé sur 'bounced'
// (signal négatif terminal) ; la distinction est conservée dans integrations_logs.
// 'email.delivery_delayed' = délai TRANSITOIRE (Resend ré-essaie sa délivrance) → aucune
// mutation de statut (le résultat terminal arrive en event séparé : delivered/bounced).
function mapEventToStatut(type: string): 'delivered' | 'bounced' | null {
  switch (type) {
    case 'email.delivered':
      return 'delivered';
    case 'email.bounced':
    case 'email.complained':
      return 'bounced';
    default:
      return null;
  }
}

interface ResendEventData {
  email_id?: string;
  to?: string[];
  subject?: string;
  tags?: Array<{ name: string; value: string }>;
  bounce_type?: string;
}

interface ResendEvent {
  type: string;
  created_at?: string;
  data?: ResendEventData;
}

type SupabaseAdmin = ReturnType<typeof createAdminSupabaseClient>;
type ErreurDb = { code?: string; message: string };

async function traceLog(
  supabase: SupabaseAdmin,
  fields: Record<string, unknown>,
): Promise<ErreurDb | null> {
  const { error } = await supabase.from('integrations_logs').insert({
    integration: 'resend',
    direction: 'entrant',
    methode: 'POST',
    endpoint: '/api/webhooks/resend',
    ...fields,
  });
  return error;
}

/**
 * Lecture/écriture en échec : l'inbox reste `traite=false` (rejeu Resend), le motif
 * est posé best-effort pour le diagnostic, réponse 500 générique.
 */
async function echec(
  supabase: SupabaseAdmin,
  inboxId: string,
  error: ErreurDb,
  evenement: string,
): Promise<NextResponse> {
  await supabase
    .from('integrations_inbox')
    .update({ erreur: `non_enregistre: ${evenement}` })
    .eq('id', inboxId);
  return serverError(error, `webhooks.resend.${evenement}`);
}

async function marquerTraite(
  supabase: SupabaseAdmin,
  inboxId: string,
): Promise<ErreurDb | null> {
  const { error } = await supabase
    .from('integrations_inbox')
    .update({ traite: true, traite_at: new Date().toISOString() })
    .eq('id', inboxId);
  return error;
}

async function postHandler(req: NextRequest): Promise<NextResponse> {
  const supabase = createAdminSupabaseClient();

  // ── 1. Lecture brute (la signature porte sur le corps exact) ───────────────
  const rawBody = await req.text();
  const svixId = req.headers.get('svix-id') ?? '';
  const svixTimestamp = req.headers.get('svix-timestamp') ?? '';
  const svixSignature = req.headers.get('svix-signature') ?? '';

  // ── 2. Validation signature svix ───────────────────────────────────────────
  const secret = process.env['RESEND_WEBHOOK_SECRET'];
  // Fail-closed en production : le secret de signing doit être configuré.
  if (!secret && process.env['NODE_ENV'] === 'production') {
    return NextResponse.json(
      { error: 'Webhook non configuré' },
      { status: 500 },
    );
  }
  if (
    secret &&
    !verifySvixSignature(
      secret,
      { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      rawBody,
    )
  ) {
    // Best-effort : trace technique, le 401 est la réponse qui compte.
    await traceLog(supabase, {
      statut_http: 401,
      erreur: 'svix_signature_invalide',
      correlation_id: svixId || null,
    });
    return NextResponse.json({ error: 'Signature invalide' }, { status: 401 });
  }

  // ── 3. Parse JSON ──────────────────────────────────────────────────────────
  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return NextResponse.json({ error: 'Payload invalide' }, { status: 400 });
  }
  const data = event.data ?? {};
  const emailId = data.email_id ?? '';

  // ── 4. Dédup inbox (svix-id) ───────────────────────────────────────────────
  const { data: inboxRow, error: inboxErr } = await supabase
    .from('integrations_inbox')
    .insert({
      source: 'resend',
      event_type: event.type,
      event_id_externe: svixId,
      payload: event as unknown as Record<string, unknown>,
    })
    .select('id')
    .single();

  let inboxId: string;
  if (inboxErr) {
    if (inboxErr.code !== '23505') {
      return serverError(inboxErr, 'webhooks.resend.inbox_insert');
    }
    // Conflit unique : doublon SEULEMENT si le premier passage a abouti (l.558).
    // Une ligne restée `traite=false` = event non enregistré au premier passage →
    // on la reprend. Deux livraisons simultanées écrivent le même statut (décidé
    // sur l'état relu) : même résultat final.
    const { data: existant, error: existantErr } = await supabase
      .from('integrations_inbox')
      .select('id, traite')
      .eq('source', 'resend')
      .eq('event_id_externe', svixId)
      .maybeSingle();
    if (existantErr || !existant) {
      return serverError(
        existantErr ?? inboxErr,
        'webhooks.resend.inbox_relecture',
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

  // ── 5. Lien vers emails_envoyes via resend_id (= data.email_id) ─────────────
  const { data: emailRow, error: emailErr } = await supabase
    .from('emails_envoyes')
    .select('id, statut')
    .eq('resend_id', emailId)
    .maybeSingle();

  if (emailErr) {
    // Email non lu ≠ resend_id inconnu : jamais marqué traité.
    return echec(supabase, inboxId, emailErr, 'email_lecture');
  }

  if (!emailRow) {
    // resend_id inconnu → 200 (pas de boucle de retry Resend) + anomalie tracée (l.557).
    // La trace EST le signal exigé par le CDC : sa perte → 500, rejeu.
    const traceErr = await traceLog(supabase, {
      statut_http: 200,
      erreur: `resend_id_inconnu: ${emailId}`,
      correlation_id: svixId,
    });
    if (traceErr) {
      return echec(supabase, inboxId, traceErr, 'anomalie_resend_id_inconnu');
    }
    const traiteErr = await marquerTraite(supabase, inboxId);
    if (traiteErr) {
      return serverError(traiteErr, 'webhooks.resend.inbox_traite');
    }
    return NextResponse.json({ ok: true, skipped: 'resend_id_inconnu' });
  }

  const current = emailRow as { id: string; statut: string };
  const nouveauStatut = mapEventToStatut(event.type);

  // ── 6. MAJ statut (sans régresser un statut terminal) ──────────────────────
  if (nouveauStatut && !STATUTS_TERMINAUX.has(current.statut)) {
    const patch: Record<string, unknown> = { statut: nouveauStatut };
    if (nouveauStatut === 'delivered')
      patch['envoye_at'] = new Date().toISOString();
    const { error: statutErr } = await supabase
      .from('emails_envoyes')
      .update(patch)
      .eq('id', current.id);
    if (statutErr) {
      return echec(supabase, inboxId, statutErr, 'email_statut');
    }
  }

  // Trace systématique (audit délivrabilité + distinction complained).
  // Best-effort : le statut est écrit, la trace n'en décide pas.
  const traceErr = await traceLog(supabase, {
    statut_http: 200,
    correlation_id: svixId,
    erreur: event.type === 'email.complained' ? `complained: ${emailId}` : null,
  });
  if (traceErr) {
    logger.error('webhooks.resend.trace_non_ecrite', {
      event_type: event.type,
      error_code: traceErr.code ?? 'UNKNOWN',
    });
  }

  // ── 7. Marquer inbox traitée ───────────────────────────────────────────────
  // Statut écrit mais inbox non marquée → 500 : le rejeu réécrit le même statut.
  const traiteErr = await marquerTraite(supabase, inboxId);
  if (traiteErr) {
    return serverError(traiteErr, 'webhooks.resend.inbox_traite');
  }

  return NextResponse.json({
    ok: true,
    statut: nouveauStatut ?? current.statut,
  });
}

export const POST = withApiTrace(postHandler);

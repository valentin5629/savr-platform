export type SlackCanal = 'critique' | 'eleve' | 'info';

export interface SlackPayload {
  canal: SlackCanal;
  titre: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export type SlackSendFn = (payload: SlackPayload) => Promise<void>;

let _sendFn: SlackSendFn | null = null;

const SLACK_TIMEOUT_MS = 5_000;

export function setSlackSink(fn: SlackSendFn | null) {
  _sendFn = fn;
}

async function httpSend(payload: SlackPayload): Promise<void> {
  const webhookMap: Record<SlackCanal, string | undefined> = {
    critique: process.env.SLACK_WEBHOOK_CRITIQUE,
    eleve: process.env.SLACK_WEBHOOK_ELEVE,
    info: process.env.SLACK_WEBHOOK_INFO,
  };

  const url = webhookMap[payload.canal];
  if (!url) return;

  const body = {
    text: `*${payload.titre}*\n${payload.message}`,
    ...(payload.metadata
      ? {
          attachments: [
            {
              fields: Object.entries(payload.metadata).map(([k, v]) => ({
                title: k,
                value: String(v),
                short: true,
              })),
            },
          ],
        }
      : {}),
  };

  // Pas de throw : une alerte échouée ne doit pas faire crasher l'appelant.
  // Ça vaut aussi quand Slack est INJOIGNABLE (DNS, TLS, reset) : `fetch` rejette
  // au lieu de rendre `!res.ok`, et ce rejet interrompait le lot de l'appelant
  // (worker outbox : les events suivants du lot n'étaient pas traités). Le délai
  // borne le cas où Slack ne répond pas : sans lui, le lot attendrait au-delà du
  // bail `claimed_until` de ses events.
  let status: number | null = null;
  let erreur: string | null = null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });
    if (res.ok) return;
    status = res.status;
  } catch (err) {
    erreur = err instanceof Error ? err.name : 'unknown';
  }

  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      service: 'platform',
      event: 'slack.send_failed',
      actor_id: null,
      actor_role: null,
      org_id: null,
      trace_id: null,
      payload: { canal: payload.canal, status, erreur },
    }),
  );
}

export async function sendAlert(payload: SlackPayload): Promise<void> {
  if (_sendFn) {
    await _sendFn(payload);
  } else {
    await httpSend(payload);
  }
}

export type SlackCanal = 'critique' | 'eleve' | 'info';

export interface SlackPayload {
  canal: SlackCanal;
  titre: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export type SlackSendFn = (payload: SlackPayload) => Promise<void>;

let _sendFn: SlackSendFn | null = null;

export function setSlackSink(fn: SlackSendFn) {
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

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Pas de throw : une alerte échouée ne doit pas faire crasher l'app
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
        payload: { canal: payload.canal, status: res.status },
      }),
    );
  }
}

export async function sendAlert(payload: SlackPayload): Promise<void> {
  if (_sendFn) {
    await _sendFn(payload);
  } else {
    await httpSend(payload);
  }
}

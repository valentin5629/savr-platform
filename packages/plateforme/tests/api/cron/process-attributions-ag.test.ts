/**
 * Cron process-attributions-ag — consommateur de la famille outbox `attribution_job`.
 *
 * Régression 2026-09-11 : la route écrivait `status` (colonne réelle `statut`) et
 * la valeur `'dlq'` (hors enum outbox_statut_enum) par UPDATE direct → 500 à chaque
 * passage en prod (PGRST204), et l'erreur loggée n'était que « [object Object] ».
 * Elle passe désormais par le claim dédié (fn_claim_outbox_attribution_batch,
 * isolation testée en pgTAP : outbox_isolation_consumers.test.sql) et par
 * fn_result_outbox avec la politique de retry du worker logistique.
 *
 * Régression 2026-09-14 (§07/03 l.24) : l'isolation par famille de consumer avait
 * créé une DLQ SILENCIEUSE — la route passait un event en `dead` sans alerte Slack
 * (« non catalogué §07/02 »), alors que le catalogue d'alertes prescrit le canal
 * critique sur `statut = 'dead'` TOUTES familles confondues, `attribution_job`
 * inclus. Un email d'attribution AG définitivement perdu = association ou
 * transporteur jamais prévenu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({ rpc }),
}));
const processAttributionValidee = vi.fn();
vi.mock('@/lib/attribution-ag/job.js', () => ({
  processAttributionValidee: (...a: unknown[]) =>
    processAttributionValidee(...a),
}));

import { logger } from '@savr/shared/src/logger/index.js';
import {
  setSlackSink,
  type SlackPayload,
} from '@savr/shared/src/alerting/slack.js';

import { GET } from '../../../src/app/api/cron/process-attributions-ag/route.js';

const PAYLOAD = { collecte_id: 'col-1', attribution_id: 'attr-1' };

function appel(): Promise<Response> {
  return GET(
    new Request('http://localhost/api/cron/process-attributions-ag', {
      method: 'GET',
      headers: { authorization: 'Bearer test-secret' },
    }),
  );
}

/** Enchaîne les réponses rpc : claim d'abord, puis fn_result_outbox (void). */
function claimRenvoie(events: unknown[]): void {
  rpc.mockImplementation((nom: string) =>
    Promise.resolve(
      nom === 'fn_claim_outbox_attribution_batch'
        ? { data: events, error: null }
        : { data: null, error: null },
    ),
  );
}

/** Alertes Slack capturées sur le run (sink injecté, aucun HTTP). */
const alertes: SlackPayload[] = [];

const resultats = () =>
  rpc.mock.calls
    .filter((c) => c[0] === 'fn_result_outbox')
    .map((c) => c[1] as Record<string, unknown>);

describe('cron process-attributions-ag — famille outbox attribution_job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    alertes.length = 0;
    setSlackSink(async (p) => {
      alertes.push(p);
    });
    process.env['CRON_SECRET'] = 'test-secret';
  });
  afterEach(() => {
    setSlackSink(async () => undefined);
    delete process.env['CRON_SECRET'];
  });

  it("réclame via le claim DÉDIÉ (jamais d'UPDATE direct sur outbox_events)", async () => {
    claimRenvoie([]);
    const res = await appel();
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('fn_claim_outbox_attribution_batch', {
      p_limit: 10,
    });
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain(
      'fn_claim_outbox_batch',
    );
  });

  it('succès → job exécuté puis fn_result_outbox « done »', async () => {
    claimRenvoie([{ id: 'ev-1', payload: PAYLOAD, attempts: 1 }]);
    processAttributionValidee.mockResolvedValue(undefined);

    const body = (await (await appel()).json()) as { nb_traite: number };

    expect(processAttributionValidee).toHaveBeenCalledWith(PAYLOAD);
    expect(resultats()).toEqual([{ p_id: 'ev-1', p_statut: 'done' }]);
    expect(body.nb_traite).toBe(1);
  });

  it('échec avec paliers restants → « failed » + next_retry_at (5 min au 1er essai)', async () => {
    claimRenvoie([{ id: 'ev-2', payload: PAYLOAD, attempts: 1 }]);
    processAttributionValidee.mockRejectedValue(new Error('boom'));
    const avant = Date.now();

    await appel();

    const [r] = resultats();
    expect(r).toMatchObject({
      p_id: 'ev-2',
      p_statut: 'failed',
      p_last_error: 'boom',
    });
    const delai = new Date(r!['p_next_retry_at'] as string).getTime() - avant;
    expect(delai).toBeGreaterThanOrEqual(5 * 60 * 1000 - 1000);
    expect(delai).toBeLessThan(6 * 60 * 1000);
  });

  it('échec sans palier restant (4e essai) → « dead », jamais la valeur hors enum « dlq »', async () => {
    claimRenvoie([{ id: 'ev-3', payload: PAYLOAD, attempts: 4 }]);
    processAttributionValidee.mockRejectedValue(new Error('boom'));

    await appel();

    expect(resultats()).toEqual([
      { p_id: 'ev-3', p_statut: 'dead', p_last_error: 'boom' },
    ]);
  });

  it('« dead » sur la famille attribution_job → alerte Slack critique (§07/03 l.24, jamais de DLQ silencieuse)', async () => {
    claimRenvoie([
      {
        id: 'ev-4',
        event_type: 'attribution.validee',
        aggregate_id: 'col-1',
        payload: PAYLOAD,
        attempts: 4,
      },
    ]);
    processAttributionValidee.mockRejectedValue(new Error('resend HS'));

    await appel();

    // Forme produite par la primitive partagée `alertOutboxDead` (outbox-worker) :
    // le message est donc identique à celui de la famille logistique.
    expect(alertes).toEqual([
      {
        canal: 'critique',
        titre: '[DLQ] Outbox event mort — attribution.validee',
        message: 'aggregate_id=col-1 attempts=4',
        metadata: { event_id: 'ev-4', error: 'Error: resend HS' },
      },
    ]);
  });

  it("palier restant → aucune alerte Slack (l'alerte DLQ ne se déclenche qu'au `dead`)", async () => {
    claimRenvoie([
      {
        id: 'ev-5',
        event_type: 'attribution.validee',
        aggregate_id: 'col-1',
        payload: PAYLOAD,
        attempts: 1,
      },
    ]);
    processAttributionValidee.mockRejectedValue(new Error('boom'));

    await appel();

    expect(resultats()[0]).toMatchObject({ p_statut: 'failed' });
    expect(alertes).toEqual([]);
  });

  it('claim en erreur (PostgrestError) → 500 et message lisible, pas « [object Object] »', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST204', message: 'colonne introuvable' },
    });
    const logErr = vi.spyOn(logger, 'error');

    const res = await appel();

    expect(res.status).toBe(500);
    expect(logErr).toHaveBeenCalledWith(
      'job.cron.failed',
      expect.objectContaining({
        error_code: 'PGRST204',
        message: 'colonne introuvable',
      }),
      expect.anything(),
    );
    logErr.mockRestore();
  });
});

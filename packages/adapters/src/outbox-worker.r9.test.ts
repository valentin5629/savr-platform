// R9 / cluster C7 — VRAI chemin du worker outbox (BL-P1-OUTBOX-03 + BL-P2-34).
//
// G5 : on appelle le VRAI runOutboxWorker — on ne mocke NI runOutboxWorker, NI
// handleError, NI getNextRetryAt. Seules frontières mockées : le client Supabase
// (DB) et l'appel HTTP de l'adapter (spyOn). Les alertes Slack sont capturées via
// le sink injectable setSlackSink (pas de HTTP).
//
// Couvre :
//   - reaper appelé en tête de run (fn_reap_outbox_claims)
//   - alerte anticipée J-1 (attempts>=2 ET date_collecte < now+24h) → canal critique
//   - DLQ (retries épuisés → dead) → alerte canal critique [DLQ]
//   - consumer propagé à fn_result_outbox (no-op → 'noop_no_remote', manual → 'manual')

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  setSlackSink,
  type SlackPayload,
} from '@savr/shared/src/alerting/slack.js';

import { runOutboxWorker } from './outbox-worker.js';
import { AdapterMts1 } from './mts1/adapter.js';
import { LogistiqueTransientError } from './index.js';

interface RpcCall {
  name: string;
  args: Record<string, unknown> | undefined;
}

interface MockOpts {
  typeTms?: 'mts1' | 'a_toutes' | 'autre';
  prestataireLogistiqueId?: string | null;
  eventType?: 'collecte.creee' | 'collecte.modifiee' | 'collecte.annulee';
  attempts?: number;
  reapedCount?: number;
  dateCollecte?: string; // YYYY-MM-DD, lue par maybeAlertEarlyCollecte
}

const COLLECTE_ID = 'c0000000-0000-0000-0000-0000000000c1';
const PRESTA_ID = 'aa000000-0000-0000-0000-0000000000a1';

function makeSupabase(opts: MockOpts) {
  const rpcCalls: RpcCall[] = [];

  const claimedEvent = {
    id: 'evt-r9-001',
    aggregate_type: 'collecte',
    aggregate_id: COLLECTE_ID,
    event_type: opts.eventType ?? 'collecte.creee',
    payload: { collecte_id: COLLECTE_ID },
    consumer: 'adapter_mts1',
    attempts: opts.attempts ?? 1,
    requires_reconciliation: false,
  };

  const collecteRow = {
    id: COLLECTE_ID,
    type: 'anti_gaspi',
    date_collecte: opts.dateCollecte ?? '2026-07-20',
    heure_collecte: '22:00:00',
    nb_camions_demande: 1,
    statut_tms: 'non_envoye',
    controle_acces_requis: false,
    informations_supplementaires: null,
    notes_internes: null,
    prestataire_logistique_id:
      opts.prestataireLogistiqueId === undefined
        ? PRESTA_ID
        : opts.prestataireLogistiqueId,
    evenement: [
      {
        contact_principal_nom: 'Alice',
        contact_principal_telephone: '+33600000001',
        contact_secours_nom: null,
        contact_secours_telephone: null,
        lieux: [
          {
            id: 'lieu-001',
            nom: 'Lieu',
            adresse_acces: '1 rue Test',
            code_postal: '75001',
            ville: 'Paris',
            latitude: null,
            longitude: null,
            acces_details: null,
            type_vehicule_max: 'fourgon',
            contraintes_horaires: null,
          },
        ],
      },
    ],
  };

  const transporteurRow = {
    id: 'transp-001',
    type_tms: opts.typeTms ?? 'mts1',
    code_transporteur_mts1:
      (opts.typeTms ?? 'mts1') === 'mts1' ? 'STRIKE' : null,
    prestataire_logistique_id:
      opts.prestataireLogistiqueId === undefined
        ? PRESTA_ID
        : opts.prestataireLogistiqueId,
  };

  const makeTableQuery = (table: string) => {
    const q: Record<string, unknown> = {};
    q['select'] = vi.fn(() => q);
    q['eq'] = vi.fn(() => q);
    q['limit'] = vi.fn(() => q);
    q['single'] = vi.fn(async () => {
      if (table === 'collectes') return { data: collecteRow, error: null };
      if (table === 'transporteurs')
        return { data: transporteurRow, error: null };
      return { data: null, error: null };
    });
    // maybeAlertEarlyCollecte lit collectes.date_collecte via maybeSingle
    q['maybeSingle'] = vi.fn(async () => {
      if (table === 'collectes')
        return {
          data: { date_collecte: collecteRow.date_collecte },
          error: null,
        };
      return { data: null, error: null };
    });
    return q;
  };

  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (name === 'fn_reap_outbox_claims')
      return { data: opts.reapedCount ?? 0, error: null };
    if (name === 'fn_claim_outbox_batch')
      return { data: [claimedEvent], error: null };
    return { data: null, error: null };
  });

  const supabase = {
    rpc,
    from: vi.fn((table: string) => makeTableQuery(table)),
    _rpcCalls: rpcCalls,
  };

  return supabase as unknown as import('@supabase/supabase-js').SupabaseClient & {
    _rpcCalls: RpcCall[];
  };
}

function captureAlerts(): SlackPayload[] {
  const alerts: SlackPayload[] = [];
  setSlackSink(async (p) => {
    alerts.push(p);
  });
  return alerts;
}

describe('R9 / worker outbox — vrai chemin reaper / alertes / DLQ (BL-P1-OUTBOX-03)', () => {
  beforeEach(() => captureAlerts());
  afterEach(() => {
    vi.restoreAllMocks();
    setSlackSink(async () => {});
  });

  it('appelle le reaper (fn_reap_outbox_claims) en tête de run et remonte le compte', async () => {
    vi.spyOn(AdapterMts1.prototype, 'dispatchCollecte').mockResolvedValue(
      'adapter_mts1',
    );
    const supabase = makeSupabase({ reapedCount: 3 });
    const result = await runOutboxWorker(supabase);

    expect(supabase._rpcCalls[0]!.name).toBe('fn_reap_outbox_claims');
    expect(result.reaped).toBe(3);
  });

  it('alerte anticipée J-1 : attempts>=2 + collecte < now+24h → canal critique', async () => {
    const alerts = captureAlerts();
    // dispatch échoue (transient) → handleError → failed (palier 1h, pas dead)
    vi.spyOn(AdapterMts1.prototype, 'dispatchCollecte').mockRejectedValue(
      new LogistiqueTransientError('503 MTS-1'),
    );
    const demain = new Date(Date.now() + 12 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]!;
    const supabase = makeSupabase({ attempts: 2, dateCollecte: demain });

    const result = await runOutboxWorker(supabase);

    expect(result.failed).toBe(1);
    expect(result.dead).toBe(0);
    const critiques = alerts.filter((a) => a.canal === 'critique');
    expect(critiques.length).toBe(1);
    expect(critiques[0]!.titre).toContain('Collecte J-1');
  });

  it('DLQ : retries épuisés (attempts=4) → dead + alerte critique [DLQ]', async () => {
    const alerts = captureAlerts();
    vi.spyOn(AdapterMts1.prototype, 'dispatchCollecte').mockRejectedValue(
      new LogistiqueTransientError('503 MTS-1'),
    );
    // date lointaine → pas d'alerte anticipée, seule l'alerte DLQ doit partir
    const supabase = makeSupabase({ attempts: 4, dateCollecte: '2027-01-01' });

    const result = await runOutboxWorker(supabase);

    expect(result.dead).toBe(1);
    const dlq = alerts.filter(
      (a) => a.canal === 'critique' && a.titre.includes('[DLQ]'),
    );
    expect(dlq.length).toBe(1);
    // marque dead dans fn_result_outbox
    const resultCalls = supabase._rpcCalls.filter(
      (c) => c.name === 'fn_result_outbox',
    );
    expect(resultCalls.some((c) => c.args?.['p_statut'] === 'dead')).toBe(true);
  });
});

describe('R9 / worker outbox — consumer propagé à fn_result_outbox (BL-P2-34)', () => {
  beforeEach(() => captureAlerts());
  afterEach(() => {
    vi.restoreAllMocks();
    setSlackSink(async () => {});
  });

  it('no prestataire → no-op succès, consumer="noop_no_remote"', async () => {
    const supabase = makeSupabase({ prestataireLogistiqueId: null });
    const result = await runOutboxWorker(supabase);

    expect(result.done).toBe(1);
    const done = supabase._rpcCalls.find(
      (c) => c.name === 'fn_result_outbox' && c.args?.['p_statut'] === 'done',
    );
    expect(done?.args?.['p_consumer']).toBe('noop_no_remote');
  });

  it('type_tms=autre (manual) → consumer="manual"', async () => {
    const supabase = makeSupabase({
      typeTms: 'autre',
      prestataireLogistiqueId: PRESTA_ID,
    });
    const result = await runOutboxWorker(supabase);

    expect(result.done).toBe(1);
    const done = supabase._rpcCalls.find(
      (c) => c.name === 'fn_result_outbox' && c.args?.['p_statut'] === 'done',
    );
    expect(done?.args?.['p_consumer']).toBe('manual');
  });

  it('mts1 dispatch réel → consumer="adapter_mts1"', async () => {
    vi.spyOn(AdapterMts1.prototype, 'dispatchCollecte').mockResolvedValue(
      'adapter_mts1',
    );
    const supabase = makeSupabase({
      typeTms: 'mts1',
      prestataireLogistiqueId: PRESTA_ID,
    });
    await runOutboxWorker(supabase);

    const done = supabase._rpcCalls.find(
      (c) => c.name === 'fn_result_outbox' && c.args?.['p_statut'] === 'done',
    );
    expect(done?.args?.['p_consumer']).toBe('adapter_mts1');
  });
});

// E5 `lieu.champ_critique_modifie` — le worker ne marque plus l'event `done`
// quand il n'a rien pu propager.
//
// G5 : on appelle le VRAI `runOutboxWorker` — ni lui, ni `handleError`, ni
// `getNextRetryAt` ne sont mockés. Seule frontière mockée : le client Supabase.
//
// Le chemin E5 comporte trois lectures (`lieux`, `transporteurs` côté worker,
// puis `transporteurs` + `collectes` côté adapter). La lecture `transporteurs`
// du worker est la première à échouer sur un blip PostgREST : son `error` était
// ignoré, `data` valait null, et l'event partait en `done` / `noop_no_remote` —
// « rien à pousser » alors que la nouvelle adresse n'avait atteint personne, sans
// retry ni alerte. Les gardes de l'adapter, eux, n'étaient jamais atteints.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { setSlackSink } from '@savr/shared/src/alerting/slack.js';

import { runOutboxWorker } from './outbox-worker.js';

interface RpcCall {
  name: string;
  args: Record<string, unknown> | undefined;
}

const LIEU_ID = '11111111-1111-1111-1111-111111111111';

const LIEU_ROW = {
  id: LIEU_ID,
  nom: 'Pavillon Gabriel',
  adresse_acces: '5 Avenue Gabriel',
  code_postal: '75008',
  ville: 'Paris',
  latitude: null,
  longitude: null,
  acces_details: null,
  type_vehicule_max: 'camion_20m3',
  contraintes_horaires: null,
};

/**
 * @param transporteursEnErreur la lecture `transporteurs` du worker échoue.
 */
function makeSupabase(transporteursEnErreur: boolean) {
  const rpcCalls: RpcCall[] = [];

  const claimedEvent = {
    id: 'evt-e5-001',
    aggregate_type: 'lieu',
    aggregate_id: LIEU_ID,
    event_type: 'lieu.champ_critique_modifie',
    payload: { lieu_id: LIEU_ID },
    consumer: 'adapter_mts1',
    attempts: 1,
    requires_reconciliation: false,
  };

  const makeTableQuery = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q['select'] = vi.fn(chain);
    q['eq'] = vi.fn(chain);
    q['gte'] = vi.fn(chain);
    q['not'] = vi.fn(chain);
    q['limit'] = vi.fn(chain);
    q['insert'] = vi.fn(async () => ({ data: null, error: null }));
    q['single'] = vi.fn(async () =>
      table === 'lieux'
        ? { data: LIEU_ROW, error: null }
        : { data: null, error: null },
    );
    q['maybeSingle'] = vi.fn(async () => ({ data: null, error: null }));
    // Le worker lit `transporteurs` sans `.single()` → le builder est thenable.
    q['then'] = (resolve: (v: unknown) => void) => {
      if (table === 'transporteurs' && transporteursEnErreur) {
        return resolve({
          data: null,
          error: { message: 'connexion interrompue' },
        });
      }
      if (table === 'transporteurs') {
        return resolve({
          data: [
            {
              id: 'transp-001',
              type_tms: 'mts1',
              code_transporteur_mts1: 'STRIKE',
              prestataire_logistique_id: 'presta-strike',
            },
          ],
          error: null,
        });
      }
      // `collectes` : aucune collecte future sur ce lieu → l'adapter sort tôt.
      return resolve({ data: [], error: null });
    };
    return q;
  };

  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (name === 'fn_reap_outbox_claims') return { data: 0, error: null };
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

const resultatOutbox = (supabase: { _rpcCalls: RpcCall[] }) =>
  supabase._rpcCalls.find((c) => c.name === 'fn_result_outbox')?.args;

describe('E5 / worker outbox — une lecture en échec ne passe pas pour un no-op', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setSlackSink(async () => {});
  });

  it('erreur sur le référentiel transporteurs → failed avec palier de retry, jamais done', async () => {
    setSlackSink(async () => {});
    const supabase = makeSupabase(true);

    const result = await runOutboxWorker(supabase);

    expect(result.failed).toBe(1);
    expect(result.done).toBe(0);

    const args = resultatOutbox(supabase);
    expect(args?.['p_statut']).toBe('failed');
    // Un palier est armé : l'event sera rejoué, pas abandonné.
    expect(args?.['p_next_retry_at']).toEqual(expect.any(String));
    // `dead` immédiat serait le mauvais mode sur un blip réseau.
    expect(args?.['p_statut']).not.toBe('dead');
  });

  it('référentiel lisible → l’event est traité normalement', async () => {
    setSlackSink(async () => {});
    const supabase = makeSupabase(false);

    const result = await runOutboxWorker(supabase);

    expect(result.done).toBe(1);
    expect(result.failed).toBe(0);
    expect(resultatOutbox(supabase)?.['p_statut']).toBe('done');
  });
});

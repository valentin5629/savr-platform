// M1.5a — passage borné : le client MTS-1 ne DÉMARRE aucun appel après
// l'échéance de l'ordre en cours. Chemin réel forcé (fetch, aucun handler).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { avecEcheance } from '../echeance-passage.js';
import { LogistiqueTransientError } from '../index.js';
import { Mts1Client } from './client.js';
import { _setMts1Handlers } from './mock.js';

const fakeSupabase = {
  from: () => ({ insert: async () => ({ error: null }) }),
} as never;

function stubFetchOk(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => '{}',
    json: async () => ({}),
  }));
  vi.stubGlobal('fetch', fetchMock as never);
  return fetchMock;
}

describe('M1.5a / passage borné — client MTS-1', () => {
  beforeEach(() => {
    _setMts1Handlers(null);
    vi.stubEnv('MTS1_BASE_URL', 'https://mts1.test');
    vi.stubEnv('MTS1_API_KEY', 'k');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    _setMts1Handlers(null);
  });

  it('M1.5a/passage_borne_client_mts1 — échéance atteinte : aucune requête ne part, l’erreur est passagère et nomme l’appel', async () => {
    const fetchMock = stubFetchOk();
    const client = new Mts1Client(fakeSupabase);

    const appel = avecEcheance(Date.now() - 1, () =>
      client.deleteOrder('O-1', 'corr'),
    );

    await expect(appel).rejects.toBeInstanceOf(LogistiqueTransientError);
    await expect(appel).rejects.toThrow(
      'Échéance du passage atteinte : MTS-1 DELETE /v3/customerOrders/O-1 non démarré',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('échéance à venir, ou aucun passage en cours : la requête part', async () => {
    const fetchMock = stubFetchOk();
    const client = new Mts1Client(fakeSupabase);

    await avecEcheance(Date.now() + 60_000, () =>
      client.deleteOrder('O-1', 'corr'),
    );
    await client.deleteOrder('O-2', 'corr');

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://mts1.test/v3/customerOrders/O-1',
      'https://mts1.test/v3/customerOrders/O-2',
    ]);
  });
});

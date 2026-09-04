import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Mts1Client } from './client.js';
import { _setMts1Handlers } from './mock.js';

// Tests « wire » : ils forcent le chemin réel (fetch, handlers=null) et vérifient
// l'URL + méthode + body EXACTS envoyés à MTS-1. C'est le seul niveau qui aurait
// attrapé le 404 BAD_ROUTE sur l'ancienne route de dispatch — les mocks de
// handlers (adapter.m1-5a.test.ts) ne voient jamais l'URL.

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

describe('M1.5a / MTS-1 client — routes sortantes (wire)', () => {
  beforeEach(() => {
    _setMts1Handlers(null); // force le chemin réel (fetch)
    vi.stubEnv('MTS1_BASE_URL', 'https://mts1.test');
    vi.stubEnv('MTS1_API_KEY', 'k');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    _setMts1Handlers(null);
  });

  it('dispatchTour → POST /v3/dispatch/{tourId}/toCarrier (route V3 réelle, pas /v3/tours/{id}/dispatch)', async () => {
    const fetchMock = stubFetchOk();
    await new Mts1Client(fakeSupabase).dispatchTour('T-1', 'CA_49TWSU', 'corr');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; body: string },
    ];
    expect(url).toBe('https://mts1.test/v3/dispatch/T-1/toCarrier');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      carrierShareableCode: 'CA_49TWSU',
    });
  });

  it('addCustomerOrderToTour → PUT /v3/tours/addCustomerOrder { tourId, customerOrderId }', async () => {
    const fetchMock = stubFetchOk();
    await new Mts1Client(fakeSupabase).addCustomerOrderToTour(
      'T-1',
      'O-1',
      'corr',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; body: string },
    ];
    expect(url).toBe('https://mts1.test/v3/tours/addCustomerOrder');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({
      tourId: 'T-1',
      customerOrderId: 'O-1',
    });
  });

  it('postOrder → CreatedOrder.id lit `customerOrderId` de la réponse V3 (pas `id`)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 201,
        text: async () => '{}',
        json: async () => ({
          customerOrderId: 'O-XYZ',
          orderNumber: 'ref-1',
          customerOrderStatus: 'PLANNED',
        }),
      })) as never,
    );
    const created = await new Mts1Client(fakeSupabase).postOrder({
      orderNumber: 'ref-1',
    } as unknown as Parameters<Mts1Client['postOrder']>[0]);

    // La réponse V3 nomme l'id `customerOrderId` (pas `id`) — sans le mapping,
    // `created.id` serait `undefined` → external_ref_commande jamais persisté.
    expect(created.id).toBe('O-XYZ');
    expect(created.externalReference).toBe('ref-1');
  });
});

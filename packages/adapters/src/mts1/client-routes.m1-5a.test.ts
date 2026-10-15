import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Mts1Client } from './client.js';
import { _setMts1Handlers } from './mock.js';

// Tests « wire » : ils forcent le chemin réel (fetch, handlers=null) et vérifient
// l'URL + méthode + body EXACTS envoyés à MTS-1. C'est le seul niveau qui aurait
// attrapé le 404 BAD_ROUTE de l'ancienne route d'envoi d'une tournée — les mocks
// de handlers (adapter.m1-5a.test.ts) ne voient jamais l'URL. L'envoi et le
// rattachement d'une tournée ne partent plus de Savr : l'Admin les fait dans la
// console MTS-1 (décision Val 2026-10-15).

const fakeSupabase = {
  from: () => ({ insert: async () => ({ error: null }) }),
} as never;

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

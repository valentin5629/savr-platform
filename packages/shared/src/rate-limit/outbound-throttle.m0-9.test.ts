import { afterEach, describe, expect, it } from 'vitest';

import {
  throttleOutbound,
  honorRetryAfter,
  parseRetryAfter,
  _resetOutboundThrottle,
  _setOutboundThrottleEnabled,
} from './outbound-throttle.js';

afterEach(() => _resetOutboundThrottle());

// Horloge + sleep déterministes : aucun timer réel, on capture les durées d'attente.
function harness() {
  const sleeps: number[] = [];
  let t = 1_000_000;
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number): Promise<void> => {
      sleeps.push(ms);
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('M0.9 — throttle sortant défensif (BL-P2-33)', () => {
  it('parseRetryAfter : secondes valides > 0, sinon null', () => {
    expect(parseRetryAfter('60')).toBe(60);
    expect(parseRetryAfter(' 5 ')).toBe(5);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('abc')).toBeNull();
    expect(parseRetryAfter('0')).toBeNull();
    expect(parseRetryAfter('-3')).toBeNull();
  });

  it('1er appel : aucun sleep ; 2e appel rapproché : sleep de l’intervalle restant (Pennylane 500 ms)', async () => {
    const h = harness();
    await throttleOutbound('pennylane', h.now, h.sleep);
    expect(h.sleeps).toEqual([]);
    h.advance(200); // 200 ms < 500 ms
    await throttleOutbound('pennylane', h.now, h.sleep);
    expect(h.sleeps).toEqual([300]);
  });

  it('appels espacés au-delà de l’intervalle : aucun sleep (Resend 100 ms)', async () => {
    const h = harness();
    await throttleOutbound('resend', h.now, h.sleep);
    h.advance(100); // == intervalle Resend
    await throttleOutbound('resend', h.now, h.sleep);
    expect(h.sleeps).toEqual([]);
  });

  it('honorRetryAfter : le prochain appel attend jusqu’à l’échéance Retry-After', async () => {
    const h = harness();
    await throttleOutbound('pennylane', h.now, h.sleep);
    honorRetryAfter('pennylane', 60, h.now); // notBefore = now + 60 s
    h.advance(1_000); // 1 s plus tard
    await throttleOutbound('pennylane', h.now, h.sleep);
    expect(h.sleeps).toEqual([59_000]);
  });

  it('Retry-After ne s’applique qu’au tiers concerné (isolation par tiers)', async () => {
    const h = harness();
    await throttleOutbound('pennylane', h.now, h.sleep);
    honorRetryAfter('pennylane', 60, h.now);
    // resend n'est pas impacté
    await throttleOutbound('resend', h.now, h.sleep);
    expect(h.sleeps).toEqual([]);
  });

  it('_setOutboundThrottleEnabled(false) : neutralise toute attente', async () => {
    const h = harness();
    _setOutboundThrottleEnabled(false);
    await throttleOutbound('pennylane', h.now, h.sleep);
    honorRetryAfter('pennylane', 60, h.now);
    h.advance(1);
    await throttleOutbound('pennylane', h.now, h.sleep);
    expect(h.sleeps).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Mts1Client } from './client.js';
import { _setMts1Handlers } from './mock.js';
import {
  LogistiqueTransientError,
  LogistiquePermanentError,
} from '../index.js';

// Fake supabase pour log() (insert best-effort — doit résoudre, sinon log() propage).
const fakeSupabase = {
  from: () => ({ insert: async () => ({ error: null }) }),
} as never;

function stubFetchStatus(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => `body ${status}`,
      json: async () => ({}),
    })) as never,
  );
}

describe('M0.9 — MTS-1 429 transitoire (BL-P2-33)', () => {
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

  it('429 → LogistiqueTransientError (retenté par les paliers, jamais DLQ direct)', async () => {
    stubFetchStatus(429);
    const client = new Mts1Client(fakeSupabase);
    await expect(client.getTour('T-1')).rejects.toBeInstanceOf(
      LogistiqueTransientError,
    );
  });

  it('500 → LogistiqueTransientError (non-régression)', async () => {
    stubFetchStatus(500);
    const client = new Mts1Client(fakeSupabase);
    await expect(client.getTour('T-1')).rejects.toBeInstanceOf(
      LogistiqueTransientError,
    );
  });

  it('400 → LogistiquePermanentError (non-régression : 4xx non-429 reste terminal)', async () => {
    stubFetchStatus(400);
    const client = new Mts1Client(fakeSupabase);
    await expect(client.getTour('T-1')).rejects.toBeInstanceOf(
      LogistiquePermanentError,
    );
  });
});

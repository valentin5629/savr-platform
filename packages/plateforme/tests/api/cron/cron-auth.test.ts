/**
 * Tests d'auth des crons sensibles (BUG 3 — fail-closed).
 *
 * outbox-worker (POST sortants vers MTS-1) et polling-mts1 (consommation entrante)
 * utilisaient un pattern FAIL-OPEN : `if (cronSecret && auth !== ...)`. Si CRON_SECRET
 * était absent/vide, la garde était sautée → endpoint invocable sans auth.
 * Ces tests vérifient le pattern FAIL-CLOSED : avec CRON_SECRET défini, un appel
 * sans Bearer ou avec un mauvais Bearer renvoie 401.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Supabase mock minimal (utilisé seulement si la garde laisse passer).
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
  }),
}));
vi.mock('@savr/adapters/src/outbox-worker.js', () => ({
  runOutboxWorker: vi.fn().mockResolvedValue({ processed: 0 }),
}));
vi.mock('@savr/adapters/src/index.js', () => ({
  getLogistiqueProvider: vi.fn(),
}));

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron', { method: 'POST', headers });
}

const ROUTES = [
  { name: 'outbox-worker', path: '@/app/api/cron/outbox-worker/route.js' },
  { name: 'polling-mts1', path: '@/app/api/cron/polling-mts1/route.js' },
];

describe('crons sensibles — fail-closed (BUG 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['CRON_SECRET'] = 'test-secret';
  });
  afterEach(() => {
    delete process.env['CRON_SECRET'];
  });

  for (const { name, path } of ROUTES) {
    it(`${name} : 401 sans Authorization (CRON_SECRET défini)`, async () => {
      const { POST } = await import(path);
      const res = await POST(req());
      expect(res.status).toBe(401);
    });

    it(`${name} : 401 avec un mauvais Bearer`, async () => {
      const { POST } = await import(path);
      const res = await POST(req({ authorization: 'Bearer mauvais' }));
      expect(res.status).toBe(401);
    });

    it(`${name} : pas 401 avec le bon Bearer`, async () => {
      const { POST } = await import(path);
      const res = await POST(req({ authorization: 'Bearer test-secret' }));
      expect(res.status).not.toBe(401);
    });
  }

  it('outbox-worker : 401 même si CRON_SECRET absent (fail-closed, plus de fail-open)', async () => {
    delete process.env['CRON_SECRET'];
    const { POST } = await import('@/app/api/cron/outbox-worker/route.js');
    const res = await POST(req({ authorization: 'Bearer test-secret' }));
    expect(res.status).toBe(401);
  });

  it('polling-mts1 : 401 même si CRON_SECRET absent (fail-closed, plus de fail-open)', async () => {
    delete process.env['CRON_SECRET'];
    const { POST } = await import('@/app/api/cron/polling-mts1/route.js');
    const res = await POST(req({ authorization: 'Bearer test-secret' }));
    expect(res.status).toBe(401);
  });
});

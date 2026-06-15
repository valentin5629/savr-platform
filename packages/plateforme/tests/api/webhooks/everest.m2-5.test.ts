// Tests webhook Everest entrant — M2.5.
// Vérifie : dédup, token validation, event_type switch, statuts terminaux.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Mock Supabase ────────────────────────────────────────────────────────────

let mockInboxInsertResult: { data: unknown; error: unknown } = {
  data: { id: 'inbox-001' },
  error: null,
};
let mockMissionRow: unknown = null;
let mockCollecteRow: unknown = null;
let mockAuditRow: unknown = null;

const insertedRows: Record<string, unknown[]> = {};
const updatedRows: Record<string, unknown[]> = {};
const insertedLogs: unknown[] = [];

const makeQuery = (table: string) => {
  const q: Record<string, unknown> = {};

  q['select'] = vi.fn().mockReturnThis();
  q['eq'] = vi.fn().mockReturnThis();
  q['contains'] = vi.fn().mockReturnThis();
  q['limit'] = vi.fn().mockReturnThis();

  q['insert'] = vi.fn((data: unknown) => {
    if (!insertedRows[table]) insertedRows[table] = [];
    insertedRows[table]!.push(data);
    if (table === 'integrations_logs') insertedLogs.push(data);
    if (table === 'integrations_inbox') {
      return {
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(mockInboxInsertResult),
      };
    }
    return { eq: vi.fn().mockReturnThis() };
  });

  q['update'] = vi.fn((data: unknown) => {
    if (!updatedRows[table]) updatedRows[table] = [];
    updatedRows[table]!.push(data);
    return { eq: vi.fn().mockReturnThis() };
  });

  q['maybeSingle'] = vi.fn().mockImplementation(async () => {
    if (table === 'everest_missions')
      return { data: mockMissionRow, error: null };
    if (table === 'collectes') return { data: mockCollecteRow, error: null };
    if (table === 'audit_log') return { data: mockAuditRow, error: null };
    return { data: null, error: null };
  });

  q['single'] = vi
    .fn()
    .mockResolvedValue({ data: { id: 'inbox-001' }, error: null });

  return q;
};

const mockTables: Record<string, ReturnType<typeof makeQuery>> = {};

const mockSupabase = {
  from: vi.fn((table: string) => {
    if (!mockTables[table]) mockTables[table] = makeQuery(table);
    return mockTables[table];
  }),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabase,
}));

// ─── Import après les mocks ───────────────────────────────────────────────────

const { POST } = await import('@/app/api/webhooks/everest/route.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWebhookRequest(
  params: Record<string, string>,
  token?: string,
): NextRequest {
  const body = new URLSearchParams(params).toString();
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (token) headers['x-webhook-token'] = token;
  return new NextRequest('http://localhost/api/webhooks/everest', {
    method: 'POST',
    body,
    headers,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('M2.5 / webhook Everest — validation token', () => {
  beforeEach(() => {
    Object.keys(insertedRows).forEach((k) => delete insertedRows[k]);
    Object.keys(updatedRows).forEach((k) => delete updatedRows[k]);
    insertedLogs.length = 0;
    Object.keys(mockTables).forEach((k) => delete mockTables[k]);
    mockMissionRow = null;
    mockCollecteRow = null;
    mockAuditRow = null;
    mockInboxInsertResult = { data: { id: 'inbox-001' }, error: null };
    vi.stubEnv('EVEREST_WEBHOOK_TOKEN', 'secret-token-123');
  });

  it('token correct → 200', async () => {
    mockMissionRow = null;
    const req = makeWebhookRequest(
      {
        mission_id: 'EVR-001',
        event_type: 'mission_dispatched',
        occurred_at: '2026-07-20T22:05:00Z',
      },
      'secret-token-123',
    );
    const resp = await POST(req);
    expect(resp.status).toBe(200);
  });

  it('token incorrect → 401', async () => {
    const req = makeWebhookRequest(
      { mission_id: 'EVR-001', event_type: 'mission_dispatched' },
      'wrong-token',
    );
    const resp = await POST(req);
    expect(resp.status).toBe(401);
  });

  it('pas de token quand EVEREST_WEBHOOK_TOKEN absent → 200 (mode permissif)', async () => {
    vi.stubEnv('EVEREST_WEBHOOK_TOKEN', '');
    mockMissionRow = null;
    const req = makeWebhookRequest({
      mission_id: 'EVR-002',
      event_type: 'mission_dispatched',
    });
    const resp = await POST(req);
    expect(resp.status).toBe(200);
  });
});

describe('M2.5 / webhook Everest — déduplication inbox', () => {
  beforeEach(() => {
    Object.keys(insertedRows).forEach((k) => delete insertedRows[k]);
    Object.keys(updatedRows).forEach((k) => delete updatedRows[k]);
    Object.keys(mockTables).forEach((k) => delete mockTables[k]);
    mockMissionRow = null;
    vi.stubEnv('EVEREST_WEBHOOK_TOKEN', '');
  });

  it('conflit unique inbox (code 23505) → 200 deduplicated', async () => {
    mockInboxInsertResult = {
      data: null,
      error: { code: '23505', message: 'unique_violation' },
    };
    const req = makeWebhookRequest({
      mission_id: 'EVR-DUP',
      event_type: 'mission_dispatched',
      occurred_at: '2026-07-20T22:00:00Z',
    });
    const resp = await POST(req);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { deduplicated?: boolean };
    expect(body.deduplicated).toBe(true);
  });
});

describe('M2.5 / webhook Everest — event_type mission_dispatched', () => {
  beforeEach(() => {
    Object.keys(insertedRows).forEach((k) => delete insertedRows[k]);
    Object.keys(updatedRows).forEach((k) => delete updatedRows[k]);
    Object.keys(mockTables).forEach((k) => delete mockTables[k]);
    insertedLogs.length = 0;
    mockInboxInsertResult = { data: { id: 'inbox-001' }, error: null };
    vi.stubEnv('EVEREST_WEBHOOK_TOKEN', '');
    mockAuditRow = null;
  });

  it('mission_dispatched → statut_everest=assigned + statut_tms=acceptee', async () => {
    mockMissionRow = {
      id: 'em-001',
      tournee_id: 'tour-001',
      collecte_id: 'col-001',
      statut_everest: 'created',
    };
    mockCollecteRow = { statut_tms: 'attribuee_en_attente_acceptation' };

    const req = makeWebhookRequest({
      mission_id: 'EVR-001',
      event_type: 'mission_dispatched',
      occurred_at: '2026-07-20T22:05:00Z',
      coursier_nom: 'Jean Vélo',
      coursier_telephone: '+33700000001',
    });
    const resp = await POST(req);
    expect(resp.status).toBe(200);

    const missionUpdates = updatedRows['everest_missions'] ?? [];
    expect(
      missionUpdates.some(
        (u) => (u as { statut_everest?: string }).statut_everest === 'assigned',
      ),
    ).toBe(true);

    const collecteUpdates = updatedRows['collectes'] ?? [];
    expect(
      collecteUpdates.some(
        (u) => (u as { statut_tms?: string }).statut_tms === 'acceptee',
      ),
    ).toBe(true);
  });

  it('mission_dispatched — déjà acceptée → pas de double update statut_tms', async () => {
    mockMissionRow = {
      id: 'em-002',
      tournee_id: 'tour-002',
      collecte_id: 'col-002',
      statut_everest: 'created',
    };
    mockCollecteRow = { statut_tms: 'acceptee' };

    const req = makeWebhookRequest({
      mission_id: 'EVR-002',
      event_type: 'mission_dispatched',
      occurred_at: '2026-07-20T22:05:00Z',
    });
    await POST(req);

    const collecteUpdates = updatedRows['collectes'] ?? [];
    expect(
      collecteUpdates.some(
        (u) => (u as { statut_tms?: string }).statut_tms === 'acceptee',
      ),
    ).toBe(false);
  });
});

describe('M2.5 / webhook Everest — statuts terminaux', () => {
  beforeEach(() => {
    Object.keys(updatedRows).forEach((k) => delete updatedRows[k]);
    Object.keys(mockTables).forEach((k) => delete mockTables[k]);
    mockInboxInsertResult = { data: { id: 'inbox-001' }, error: null };
    vi.stubEnv('EVEREST_WEBHOOK_TOKEN', '');
    mockAuditRow = null;
  });

  it('webhook sur statut terminal completed → seul payload_latest_update mis à jour', async () => {
    mockMissionRow = {
      id: 'em-003',
      tournee_id: 'tour-003',
      collecte_id: 'col-003',
      statut_everest: 'completed',
    };

    const req = makeWebhookRequest({
      mission_id: 'EVR-003',
      event_type: 'mission_pickedup',
      occurred_at: '2026-07-20T23:00:00Z',
    });
    const resp = await POST(req);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { skipped?: string };
    expect(body.skipped).toBe('statut_terminal');

    // Pas de changement de statut
    const missionUpdates = updatedRows['everest_missions'] ?? [];
    expect(
      missionUpdates.some(
        (u) =>
          (u as { statut_everest?: string }).statut_everest === 'in_progress',
      ),
    ).toBe(false);
  });
});

describe('M2.5 / webhook Everest — mission inconnue', () => {
  beforeEach(() => {
    Object.keys(updatedRows).forEach((k) => delete updatedRows[k]);
    Object.keys(mockTables).forEach((k) => delete mockTables[k]);
    mockInboxInsertResult = { data: { id: 'inbox-001' }, error: null };
    vi.stubEnv('EVEREST_WEBHOOK_TOKEN', '');
    mockMissionRow = null;
  });

  it('mission_id inconnu → 200 skipped=mission_inconnue', async () => {
    const req = makeWebhookRequest({
      mission_id: 'EVR-UNKNOWN',
      event_type: 'mission_dispatched',
      occurred_at: '2026-07-20T22:00:00Z',
    });
    const resp = await POST(req);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { skipped?: string };
    expect(body.skipped).toBe('mission_inconnue');
  });
});

// Tests webhook Everest entrant — M2.5.
// Vérifie : dédup, token validation, event_type switch, statuts terminaux.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock EverestClient réutilisé (BL-P0-07) — même specifier que la route
// (@savr/adapters/src/index.js) → singleton de handlers partagé : le re-fetch
// getMission de la route passe par CE mock, jamais par une vraie API Everest.
import {
  setupEverestMock,
  _setEverestHandlers,
  type EverestMissionDetail,
} from '@savr/adapters/src/index.js';

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
const rpcCalls: Array<{ name: string; args: unknown }> = [];

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
  rpc: vi.fn(async (name: string, args?: unknown) => {
    rpcCalls.push({ name, args });
    return { data: null, error: null };
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

describe('M2.5 / webhook Everest — re-fetch API (BL-P0-07)', () => {
  let mockState: ReturnType<typeof setupEverestMock>;

  beforeEach(() => {
    Object.keys(insertedRows).forEach((k) => delete insertedRows[k]);
    Object.keys(updatedRows).forEach((k) => delete updatedRows[k]);
    insertedLogs.length = 0;
    Object.keys(mockTables).forEach((k) => delete mockTables[k]);
    mockInboxInsertResult = { data: { id: 'inbox-001' }, error: null };
    mockCollecteRow = null;
    mockAuditRow = null;
    vi.stubEnv('EVEREST_WEBHOOK_TOKEN', '');
    // Mission active (non terminale) → l'event est traité.
    mockMissionRow = {
      id: 'em-refetch',
      tournee_id: 'tour-refetch',
      collecte_id: 'col-refetch',
      statut_everest: 'in_progress',
    };
    mockState = setupEverestMock();
  });

  afterEach(() => {
    _setEverestHandlers(null);
  });

  it('mission_finished : coût + preuve persistés depuis l’API re-fetchée, JAMAIS depuis le payload', async () => {
    // L'API (vérité) renvoie un coût/preuve DIFFÉRENTS du payload non signé.
    const apiDetail: EverestMissionDetail = {
      mission_id: 'EVR-RF-1',
      status: 'completed',
      cout_ht: 42.5,
      preuve_url: 'https://everest.example/proof/API.pdf',
      coursier_nom: null,
      coursier_telephone: null,
      vehicule_type: null,
    };
    mockState.details.set('EVR-RF-1', apiDetail);

    const req = makeWebhookRequest({
      mission_id: 'EVR-RF-1',
      event_type: 'mission_finished',
      occurred_at: '2026-07-20T23:30:00Z',
      // Valeurs FRAUDULEUSES du payload — ne doivent JAMAIS être persistées.
      cost: '99.99',
      proof_url: 'https://attacker.example/PAYLOAD.pdf',
    });
    const resp = await POST(req);
    expect(resp.status).toBe(200);

    const missionUpdates = (updatedRows['everest_missions'] ?? []) as Array<
      Record<string, unknown>
    >;
    const withCout = missionUpdates.find((u) => 'cout_everest_ht' in u);
    expect(withCout).toBeDefined();
    // La valeur API est persistée…
    expect(withCout!['cout_everest_ht']).toBe(42.5);
    expect(withCout!['preuve_course_url']).toBe(
      'https://everest.example/proof/API.pdf',
    );
    // …et JAMAIS la valeur du payload (un code qui lit le payload rougit ici).
    expect(withCout!['cout_everest_ht']).not.toBe(99.99);
    expect(withCout!['preuve_course_url']).not.toBe(
      'https://attacker.example/PAYLOAD.pdf',
    );
  });

  it('mission_finished : re-fetch en échec → aucune valeur payload écrite + trace Ops', async () => {
    _setEverestHandlers(null);
    setupEverestMock({ getMissionFails: true });

    const req = makeWebhookRequest({
      mission_id: 'EVR-RF-2',
      event_type: 'mission_success',
      occurred_at: '2026-07-20T23:45:00Z',
      cost: '77.77',
      proof_url: 'https://attacker.example/PAYLOAD2.pdf',
    });
    const resp = await POST(req);
    expect(resp.status).toBe(200);

    const missionUpdates = (updatedRows['everest_missions'] ?? []) as Array<
      Record<string, unknown>
    >;
    // Statut opérationnel maj depuis le signal, mais AUCUN coût/preuve écrit.
    expect(missionUpdates.length).toBeGreaterThan(0);
    expect(missionUpdates.some((u) => 'cout_everest_ht' in u)).toBe(false);
    expect(missionUpdates.some((u) => 'preuve_course_url' in u)).toBe(false);
    // Trace Ops pour réconciliation manuelle.
    expect(
      insertedLogs.some((l) =>
        String((l as { erreur?: string }).erreur ?? '').includes(
          'refetch_failed',
        ),
      ),
    ).toBe(true);
  });
});

// ─── BL-P1-API-04 (d) course sans marchandise + (c) rejet ────────────────────────

describe('M2.5 / webhook Everest — course sans marchandise (BL-P1-API-04 d)', () => {
  let mockState: ReturnType<typeof setupEverestMock>;

  beforeEach(() => {
    Object.keys(insertedRows).forEach((k) => delete insertedRows[k]);
    Object.keys(updatedRows).forEach((k) => delete updatedRows[k]);
    insertedLogs.length = 0;
    rpcCalls.length = 0;
    Object.keys(mockTables).forEach((k) => delete mockTables[k]);
    mockInboxInsertResult = { data: { id: 'inbox-001' }, error: null };
    mockAuditRow = null;
    vi.stubEnv('EVEREST_WEBHOOK_TOKEN', '');
    mockMissionRow = {
      id: 'em-cv',
      tournee_id: 'tour-cv',
      collecte_id: 'col-cv',
      statut_everest: 'in_progress',
    };
    mockState = setupEverestMock();
  });

  afterEach(() => {
    _setEverestHandlers(null);
  });

  it('mission_status="Pas de commande" + collecte AG → realisee_sans_collecte + alerte Ops', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'en_cours',
      statut_tms: 'acceptee',
    };
    mockState.details.set('EVR-CV-1', {
      mission_id: 'EVR-CV-1',
      status: 'Pas de commande',
      cout_ht: 18.0,
      preuve_url: null,
      coursier_nom: null,
      coursier_telephone: null,
      vehicule_type: null,
    });

    const req = makeWebhookRequest({
      mission_id: 'EVR-CV-1',
      event_type: 'mission_finished',
      occurred_at: '2026-07-20T23:30:00Z',
    });
    const resp = await POST(req);
    expect(resp.status).toBe(200);

    const collecteUpdates = (updatedRows['collectes'] ?? []) as Array<
      Record<string, unknown>
    >;
    const rsc = collecteUpdates.find(
      (u) => u['statut'] === 'realisee_sans_collecte',
    );
    expect(rsc).toBeDefined();
    // Motif chauffeur = libellé mission_status ; photo NULL (Everest n'en fournit pas).
    expect(rsc!['aucun_repas_motif']).toBe('Pas de commande');
    expect(rsc!['aucun_repas_photo_url']).toBeNull();

    // Alerte Ops in-app type=collecte_aucun_repas (Gherkin §08 l.332).
    const alerte = rpcCalls.find(
      (c) =>
        c.name === 'f_upsert_alerte_admin' &&
        (c.args as { p_code?: string }).p_code === 'collecte_aucun_repas',
    );
    expect(alerte).toBeDefined();
  });

  it('mission_status="Client absent / Marchandise refusée" + collecte ZD → PAS de transition (AG only)', async () => {
    mockCollecteRow = {
      type: 'zero_dechet',
      statut: 'en_cours',
      statut_tms: 'acceptee',
    };
    mockState.details.set('EVR-CV-2', {
      mission_id: 'EVR-CV-2',
      status: 'Client absent / Marchandise refusée',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: null,
      coursier_telephone: null,
      vehicule_type: null,
    });

    const req = makeWebhookRequest({
      mission_id: 'EVR-CV-2',
      event_type: 'mission_success',
      occurred_at: '2026-07-20T23:35:00Z',
    });
    await POST(req);

    const collecteUpdates = (updatedRows['collectes'] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(
      collecteUpdates.some((u) => u['statut'] === 'realisee_sans_collecte'),
    ).toBe(false);
    // Trace technique de l'ignore non-AG.
    expect(
      insertedLogs.some((l) =>
        String((l as { erreur?: string }).erreur ?? '').includes(
          'course_vide_non_ag_ignoree',
        ),
      ),
    ).toBe(true);
  });

  it('collecte AG déjà cloturee → realisee_sans_collecte non régressé', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'cloturee',
      statut_tms: 'acceptee',
    };
    mockState.details.set('EVR-CV-3', {
      mission_id: 'EVR-CV-3',
      status: 'Pas de commande',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: null,
      coursier_telephone: null,
      vehicule_type: null,
    });

    const req = makeWebhookRequest({
      mission_id: 'EVR-CV-3',
      event_type: 'mission_finished',
      occurred_at: '2026-07-20T23:40:00Z',
    });
    await POST(req);

    const collecteUpdates = (updatedRows['collectes'] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(
      collecteUpdates.some((u) => u['statut'] === 'realisee_sans_collecte'),
    ).toBe(false);
  });
});

describe('M2.5 / webhook Everest — rejet async avant acceptation (BL-P1-API-04 c)', () => {
  beforeEach(() => {
    Object.keys(insertedRows).forEach((k) => delete insertedRows[k]);
    Object.keys(updatedRows).forEach((k) => delete updatedRows[k]);
    insertedLogs.length = 0;
    rpcCalls.length = 0;
    Object.keys(mockTables).forEach((k) => delete mockTables[k]);
    mockInboxInsertResult = { data: { id: 'inbox-001' }, error: null };
    mockAuditRow = null;
    vi.stubEnv('EVEREST_WEBHOOK_TOKEN', '');
    mockMissionRow = {
      id: 'em-rej',
      tournee_id: 'tour-rej',
      collecte_id: 'col-rej',
      statut_everest: 'created',
    };
    setupEverestMock(); // getMission par défaut → status='completed' (≠ course vide)
  });

  afterEach(() => {
    _setEverestHandlers(null);
  });

  it('mission_failed + statut_tms=attribuee_en_attente_acceptation → rejetee_par_prestataire + retour file', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'programmee',
      statut_tms: 'attribuee_en_attente_acceptation',
    };

    const req = makeWebhookRequest({
      mission_id: 'EVR-REJ-1',
      event_type: 'mission_failed',
      occurred_at: '2026-07-20T22:30:00Z',
    });
    const resp = await POST(req);
    expect(resp.status).toBe(200);

    const collecteUpdates = (updatedRows['collectes'] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(
      collecteUpdates.some(
        (u) => u['statut_tms'] === 'rejetee_par_prestataire',
      ),
    ).toBe(true);
    const alerte = rpcCalls.find(
      (c) =>
        c.name === 'f_upsert_alerte_admin' &&
        (c.args as { p_code?: string }).p_code ===
          'collecte_rejetee_prestataire',
    );
    expect(alerte).toBeDefined();
  });

  it('mission_failed + déjà acceptee → PAS de rejet (incident, pas un refus)', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'en_cours',
      statut_tms: 'acceptee',
    };

    const req = makeWebhookRequest({
      mission_id: 'EVR-REJ-2',
      event_type: 'mission_failed',
      occurred_at: '2026-07-20T22:35:00Z',
    });
    await POST(req);

    const collecteUpdates = (updatedRows['collectes'] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(
      collecteUpdates.some(
        (u) => u['statut_tms'] === 'rejetee_par_prestataire',
      ),
    ).toBe(false);
  });
});

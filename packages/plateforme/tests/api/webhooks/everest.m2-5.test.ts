// Tests webhook Everest entrant — M2.5.
// Vérifie : dédup, token validation, event_type switch, statuts terminaux.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

import { logger } from '@savr/shared/src/logger/index.js';

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

// Mission courante (arbitrage Val 2026-09-17). Par défaut la mission de l'event
// EST la mission courante : collecte attribuée à un transporteur A Toutes! et
// tournée portant la référence de l'event (`mockRefTournee` undefined).
const PRESTA_EVEREST = 'presta-a-toutes';
let lastMissionId = '';
let mockTransporteurRow: unknown = { type_tms: 'a_toutes' };
let mockRefTournee: string | null | undefined;
let mockLienAbsent = false;
let mockLienSurcharge: Record<string, unknown> = {};

// Lignes « en base » sur lesquelles les UPDATE évaluent LEURS filtres : une garde
// absente du WHERE modifie la ligne. Initialisées à la première lecture/écriture
// depuis mockCollecteRow / mockMissionRow ; `apresLectureCollecte` simule une
// écriture concurrente entre la lecture et l'UPDATE.
let collecteLive: Record<string, unknown> | null = null;
let missionLive: Record<string, unknown> | null = null;
let apresLectureCollecte: ((live: Record<string, unknown>) => void) | null =
  null;
let apresLectureMission: ((live: Record<string, unknown>) => void) | null =
  null;
const appliedRows: Record<string, Array<Record<string, unknown>>> = {};

function collecteEnBase(): Record<string, unknown> | null {
  if (!collecteLive && mockCollecteRow) {
    collecteLive = {
      id: (mockMissionRow as { collecte_id?: string } | null)?.collecte_id,
      prestataire_logistique_id: PRESTA_EVEREST,
      ...(mockCollecteRow as Record<string, unknown>),
    };
  }
  return collecteLive;
}

function missionEnBase(): Record<string, unknown> | null {
  if (!missionLive && mockMissionRow) {
    missionLive = {
      everest_mission_id: lastMissionId,
      ...(mockMissionRow as Record<string, unknown>),
    };
  }
  return missionLive;
}

const insertedRows: Record<string, unknown[]> = {};
const updatedRows: Record<string, unknown[]> = {};
const insertedLogs: unknown[] = [];
const rpcCalls: Array<{ name: string; args: unknown }> = [];

// Échecs injectables (écritures/lectures refusées : CHECK, blip PostgREST).
// Réinitialisés avant CHAQUE test (beforeEach racine ci-dessous).
type ErreurMock = { code?: string; message: string };
let updateErrors: Record<
  string,
  (data: Record<string, unknown>) => ErreurMock | null
> = {};
let readErrors: Record<string, ErreurMock> = {};
let rpcError: ErreurMock | null = null;
// Relecture de la ligne inbox existante sur conflit 23505.
let mockInboxExistant: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};

beforeEach(() => {
  updateErrors = {};
  readErrors = {};
  rpcError = null;
  mockInboxExistant = { data: null, error: null };
  mockTransporteurRow = { type_tms: 'a_toutes' };
  mockRefTournee = undefined;
  mockLienAbsent = false;
  mockLienSurcharge = {};
  collecteLive = null;
  missionLive = null;
  apresLectureCollecte = null;
  apresLectureMission = null;
  Object.keys(appliedRows).forEach((k) => delete appliedRows[k]);
});

// UPDATE chaînable (eq / not in / select), résolu à l'await. Sur `collectes` et
// `everest_missions`, les filtres sont évalués contre la ligne en base : 0 ligne
// qui matche → `data: []` et rien n'est appliqué.
type Filtre = (row: Record<string, unknown>) => boolean;
interface UpdateBuilder extends PromiseLike<{ data: unknown; error: unknown }> {
  eq: (col: string, val: unknown) => UpdateBuilder;
  not: (col: string, op: string, val: string) => UpdateBuilder;
  select: (cols?: string) => UpdateBuilder;
}

function makeUpdate(
  table: string,
  data: Record<string, unknown>,
): UpdateBuilder {
  const filtres: Filtre[] = [];
  const executer = (): { data: unknown; error: unknown } => {
    const error = updateErrors[table]?.(data) ?? null;
    if (error) return { data: null, error };
    const ligne =
      table === 'collectes'
        ? collecteEnBase()
        : table === 'everest_missions'
          ? missionEnBase()
          : undefined;
    if (ligne === undefined) return { data: null, error: null };
    if (!ligne || !filtres.every((f) => f(ligne))) return { data: [], error };
    Object.assign(ligne, data);
    (appliedRows[table] ??= []).push(data);
    return { data: [{ id: ligne['id'] }], error: null };
  };
  const b: UpdateBuilder = {
    eq: (col, val) => {
      filtres.push((r) => r[col] === val);
      return b;
    },
    not: (col, op, val) => {
      expect(op).toBe('in');
      const liste = val.replace(/[()]/g, '').split(',');
      filtres.push((r) => !liste.includes(String(r[col])));
      return b;
    },
    select: () => b,
    then: (onOk, onKo) => Promise.resolve(executer()).then(onOk, onKo),
  };
  return b;
}

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

  q['update'] = vi.fn((data: Record<string, unknown>) => {
    if (!updatedRows[table]) updatedRows[table] = [];
    updatedRows[table]!.push(data);
    return makeUpdate(table, data);
  });

  q['maybeSingle'] = vi.fn().mockImplementation(async () => {
    if (readErrors[table]) return { data: null, error: readErrors[table] };
    if (table === 'integrations_inbox') return mockInboxExistant;
    if (table === 'everest_missions') {
      const live = missionEnBase();
      const lue = live ? { ...live } : null;
      if (live) apresLectureMission?.(live);
      return { data: lue, error: null };
    }
    if (table === 'collectes') {
      const live = collecteEnBase();
      const lue = live ? { ...live } : null;
      if (live) apresLectureCollecte?.(live);
      return { data: lue, error: null };
    }
    if (table === 'transporteurs')
      return { data: mockTransporteurRow, error: null };
    if (table === 'collecte_tournees') {
      // Le lien « en base » appartient à la collecte et à la tournée de la
      // mission (sauf surcharge) ; les filtres eq de la lecture sont évalués.
      const mission = mockMissionRow as {
        collecte_id?: string;
        tournee_id?: string;
      } | null;
      const lien: Record<string, unknown> = {
        collecte_id: mission?.collecte_id,
        tournee_id: mission?.tournee_id,
        ...mockLienSurcharge,
      };
      const eqCalls = (q['eq'] as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, unknown]
      >;
      const matche = eqCalls.every(([col, val]) => lien[col] === val);
      return {
        data:
          mockLienAbsent || !matche
            ? null
            : {
                tournees: {
                  external_ref_commande:
                    mockRefTournee === undefined
                      ? lastMissionId
                      : mockRefTournee,
                },
              },
        error: null,
      };
    }
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
    return { data: null, error: rpcError };
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
  lastMissionId = params['mission_id'] ?? '';
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

  it('conflit unique inbox (code 23505) sur un event déjà traité → 200 deduplicated', async () => {
    mockInboxInsertResult = {
      data: null,
      error: { code: '23505', message: 'unique_violation' },
    };
    mockInboxExistant = {
      data: { id: 'inbox-001', traite: true },
      error: null,
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

  it('mission_failed + statut_tms=attribuee_en_attente_acceptation → statut_tms ET statut rejetee_par_prestataire + alerte', async () => {
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
    // §08 §3 : le statut métier suit (visibilité dashboard, décision Val
    // 2026-06-15) — le trigger fn_sync ne le dérive pas.
    expect(collecteLive?.['statut']).toBe('rejetee_par_prestataire');
    expect(collecteLive?.['statut_tms']).toBe('rejetee_par_prestataire');
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

// ─── Échec d'écriture/lecture de l'état métier (erreurs Supabase lues) ──────────
// Une écriture refusée (CHECK, blip PostgREST) ne doit JAMAIS passer inaperçue :
// alerte Ops in-app, 500, inbox NON marquée `traite` → le rejeu reste possible.

const ERREUR_CHECK: ErreurMock = {
  code: '23514',
  message: 'new row violates check constraint',
};

function inboxMarqueeTraitee(): boolean {
  return (
    (updatedRows['integrations_inbox'] ?? []) as Array<Record<string, unknown>>
  ).some((u) => u['traite'] === true);
}

function alerteNonEnregistre(collecteId: string): unknown {
  return rpcCalls.find(
    (c) =>
      c.name === 'f_upsert_alerte_admin' &&
      (c.args as { p_code?: string }).p_code ===
        'everest_webhook_non_enregistre' &&
      (c.args as { p_entity_id?: string }).p_entity_id === collecteId,
  );
}

function missionEcriteAvec(statut: string): boolean {
  return (
    (updatedRows['everest_missions'] ?? []) as Array<Record<string, unknown>>
  ).some((u) => u['statut_everest'] === statut);
}

describe('M2.5 / webhook Everest — échec d’écriture de l’état métier', () => {
  let mockState: ReturnType<typeof setupEverestMock>;

  beforeEach(() => {
    Object.keys(insertedRows).forEach((k) => delete insertedRows[k]);
    Object.keys(updatedRows).forEach((k) => delete updatedRows[k]);
    insertedLogs.length = 0;
    rpcCalls.length = 0;
    Object.keys(mockTables).forEach((k) => delete mockTables[k]);
    mockInboxInsertResult = { data: { id: 'inbox-001' }, error: null };
    mockAuditRow = null;
    mockCollecteRow = null;
    vi.stubEnv('EVEREST_WEBHOOK_TOKEN', '');
    mockMissionRow = {
      id: 'em-err',
      tournee_id: 'tour-err',
      collecte_id: 'col-err',
      statut_everest: 'created',
    };
    mockState = setupEverestMock();
  });

  afterEach(() => {
    _setEverestHandlers(null);
    vi.restoreAllMocks();
  });

  it('UPDATE everest_missions refusé → 500 + alerte Ops in-app + inbox NON traitée (motif posé)', async () => {
    updateErrors['everest_missions'] = () => ERREUR_CHECK;

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-ERR-1',
        event_type: 'mission_pickedup',
        occurred_at: '2026-07-20T23:00:00Z',
      }),
    );

    expect(resp.status).toBe(500);
    // Jamais le détail Postgres au client.
    expect(JSON.stringify(await resp.json())).not.toContain('check constraint');
    expect(alerteNonEnregistre('col-err')).toBeDefined();
    expect(inboxMarqueeTraitee()).toBe(false);
    expect(
      (
        (updatedRows['integrations_inbox'] ?? []) as Array<
          Record<string, unknown>
        >
      ).some((u) =>
        String(u['erreur'] ?? '').startsWith('etat_non_enregistre'),
      ),
    ).toBe(true);
  });

  it('UPDATE everest_missions refusé sur mission terminale → 500 + inbox NON traitée', async () => {
    mockMissionRow = {
      id: 'em-err',
      tournee_id: 'tour-err',
      collecte_id: 'col-err',
      statut_everest: 'completed',
    };
    updateErrors['everest_missions'] = () => ERREUR_CHECK;

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-ERR-T',
        event_type: 'mission_late',
        occurred_at: '2026-07-20T23:00:00Z',
      }),
    );

    expect(resp.status).toBe(500);
    expect(alerteNonEnregistre('col-err')).toBeDefined();
    expect(inboxMarqueeTraitee()).toBe(false);
  });

  it('mission_dispatched : UPDATE collectes.statut_tms=acceptee refusé → 500 + alerte + inbox NON traitée', async () => {
    mockCollecteRow = { statut_tms: 'attribuee_en_attente_acceptation' };
    updateErrors['collectes'] = (d) =>
      d['statut_tms'] === 'acceptee' ? ERREUR_CHECK : null;

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-ERR-2',
        event_type: 'mission_dispatched',
        occurred_at: '2026-07-20T22:05:00Z',
      }),
    );

    expect(resp.status).toBe(500);
    expect(alerteNonEnregistre('col-err')).toBeDefined();
    expect(inboxMarqueeTraitee()).toBe(false);
  });

  it('mission_dispatched : lecture collecte en échec → 500, jamais « déjà acceptée » par défaut', async () => {
    readErrors['collectes'] = { message: 'fetch failed' };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-ERR-3',
        event_type: 'mission_dispatched',
        occurred_at: '2026-07-20T22:05:00Z',
      }),
    );

    expect(resp.status).toBe(500);
    expect(alerteNonEnregistre('col-err')).toBeDefined();
    expect(inboxMarqueeTraitee()).toBe(false);
  });

  it('mission_failed : UPDATE statut_tms=rejetee_par_prestataire refusé → 500, mission PAS encore passée failed (rejeu possible)', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'programmee',
      statut_tms: 'attribuee_en_attente_acceptation',
    };
    updateErrors['collectes'] = (d) =>
      d['statut_tms'] === 'rejetee_par_prestataire' ? ERREUR_CHECK : null;

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-ERR-4',
        event_type: 'mission_failed',
        occurred_at: '2026-07-20T22:30:00Z',
      }),
    );

    expect(resp.status).toBe(500);
    expect(alerteNonEnregistre('col-err')).toBeDefined();
    expect(inboxMarqueeTraitee()).toBe(false);
    // Mission terminale écrite en dernier : sinon le rejeu buterait sur la
    // garde statut terminal et la collecte ne serait jamais rejetée.
    expect(missionEcriteAvec('failed')).toBe(false);
    // Pas d'alerte « rejetée » sur une transition non écrite.
    expect(
      rpcCalls.some(
        (c) =>
          (c.args as { p_code?: string }).p_code ===
          'collecte_rejetee_prestataire',
      ),
    ).toBe(false);
  });

  it('mission_cancelled externe : UPDATE rejet refusé → 500, mission PAS encore passée cancelled_externally', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'programmee',
      statut_tms: 'attribuee_en_attente_acceptation',
    };
    updateErrors['collectes'] = () => ERREUR_CHECK;

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-ERR-4B',
        event_type: 'mission_cancelled',
        occurred_at: '2026-07-20T22:30:00Z',
      }),
    );

    expect(resp.status).toBe(500);
    expect(inboxMarqueeTraitee()).toBe(false);
    expect(missionEcriteAvec('cancelled_externally')).toBe(false);
  });

  it('course sans marchandise : UPDATE realisee_sans_collecte refusé → 500, mission PAS encore passée terminale', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'en_cours',
      statut_tms: 'acceptee',
    };
    mockState.details.set('EVR-ERR-5', {
      mission_id: 'EVR-ERR-5',
      status: 'Pas de commande',
      cout_ht: 18.0,
      preuve_url: null,
      coursier_nom: null,
      coursier_telephone: null,
      vehicule_type: null,
    });
    updateErrors['collectes'] = (d) =>
      d['statut'] === 'realisee_sans_collecte' ? ERREUR_CHECK : null;

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-ERR-5',
        event_type: 'mission_finished',
        occurred_at: '2026-07-20T23:30:00Z',
      }),
    );

    expect(resp.status).toBe(500);
    expect(alerteNonEnregistre('col-err')).toBeDefined();
    expect(inboxMarqueeTraitee()).toBe(false);
    expect(missionEcriteAvec('completed')).toBe(false);
    expect(
      rpcCalls.some(
        (c) =>
          (c.args as { p_code?: string }).p_code === 'collecte_aucun_repas',
      ),
    ).toBe(false);
  });

  it('lecture de l’état collecte (rejet/course vide) en échec → 500 + inbox NON traitée', async () => {
    readErrors['collectes'] = { message: 'fetch failed' };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-ERR-6',
        event_type: 'mission_failed',
        occurred_at: '2026-07-20T22:30:00Z',
      }),
    );

    expect(resp.status).toBe(500);
    expect(alerteNonEnregistre('col-err')).toBeDefined();
    expect(inboxMarqueeTraitee()).toBe(false);
  });

  it('mission_cancelled : lecture audit_log en échec → 500, jamais conclue « annulation externe »', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'programmee',
      statut_tms: 'attribuee_en_attente_acceptation',
    };
    readErrors['audit_log'] = { message: 'fetch failed' };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-ERR-7',
        event_type: 'mission_cancelled',
        occurred_at: '2026-07-20T22:40:00Z',
      }),
    );

    expect(resp.status).toBe(500);
    expect(alerteNonEnregistre('col-err')).toBeDefined();
    expect(inboxMarqueeTraitee()).toBe(false);
    expect(missionEcriteAvec('cancelled_externally')).toBe(false);
    expect(
      ((updatedRows['collectes'] ?? []) as Array<Record<string, unknown>>).some(
        (u) => u['statut_tms'] === 'rejetee_par_prestataire',
      ),
    ).toBe(false);
  });

  it('lecture everest_missions en échec → 500, jamais « mission inconnue » traitée', async () => {
    readErrors['everest_missions'] = { message: 'fetch failed' };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-ERR-8',
        event_type: 'mission_pickedup',
        occurred_at: '2026-07-20T23:00:00Z',
      }),
    );

    expect(resp.status).toBe(500);
    expect(inboxMarqueeTraitee()).toBe(false);
  });

  it('UPDATE inbox traite refusé après écriture métier → 500 (rejeu sans effet, mais signalé)', async () => {
    updateErrors['integrations_inbox'] = (d) =>
      d['traite'] === true ? { message: 'fetch failed' } : null;

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-ERR-9',
        event_type: 'mission_pickedup',
        occurred_at: '2026-07-20T23:00:00Z',
      }),
    );

    expect(missionEcriteAvec('in_progress')).toBe(true);
    expect(resp.status).toBe(500);
  });

  it('mission inconnue : UPDATE inbox traite refusé → 500', async () => {
    mockMissionRow = null;
    updateErrors['integrations_inbox'] = () => ({ message: 'fetch failed' });

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-ERR-10',
        event_type: 'mission_pickedup',
        occurred_at: '2026-07-20T23:00:00Z',
      }),
    );

    expect(resp.status).toBe(500);
  });

  it('alerte « aucun repas » non posée après transition écrite → 200 (best-effort) mais tracée en erreur serveur', async () => {
    const logErr = vi.spyOn(logger, 'error');
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'en_cours',
      statut_tms: 'acceptee',
    };
    mockState.details.set('EVR-ERR-11', {
      mission_id: 'EVR-ERR-11',
      status: 'Pas de commande',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: null,
      coursier_telephone: null,
      vehicule_type: null,
    });
    rpcError = { message: 'fetch failed' };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-ERR-11',
        event_type: 'mission_finished',
        occurred_at: '2026-07-20T23:30:00Z',
      }),
    );

    expect(resp.status).toBe(200);
    expect(inboxMarqueeTraitee()).toBe(true);
    expect(logErr).toHaveBeenCalledWith(
      'webhooks.everest.alerte_non_posee',
      expect.objectContaining({ code: 'collecte_aucun_repas' }),
    );
  });
});

describe('M2.5 / webhook Everest — rejeu d’un event non traité', () => {
  beforeEach(() => {
    Object.keys(insertedRows).forEach((k) => delete insertedRows[k]);
    Object.keys(updatedRows).forEach((k) => delete updatedRows[k]);
    insertedLogs.length = 0;
    rpcCalls.length = 0;
    Object.keys(mockTables).forEach((k) => delete mockTables[k]);
    mockAuditRow = null;
    mockCollecteRow = null;
    vi.stubEnv('EVEREST_WEBHOOK_TOKEN', '');
    mockMissionRow = {
      id: 'em-rejeu',
      tournee_id: 'tour-rejeu',
      collecte_id: 'col-rejeu',
      statut_everest: 'assigned',
    };
    mockInboxInsertResult = {
      data: null,
      error: { code: '23505', message: 'unique_violation' },
    };
  });

  it('conflit 23505 sur une ligne inbox traite=false → event RETRAITÉ et ligne existante marquée traitée', async () => {
    mockInboxExistant = {
      data: { id: 'inbox-existante', traite: false },
      error: null,
    };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-REJEU-1',
        event_type: 'mission_pickedup',
        occurred_at: '2026-07-20T23:00:00Z',
      }),
    );

    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { deduplicated?: boolean };
    expect(body.deduplicated).toBeUndefined();
    expect(missionEcriteAvec('in_progress')).toBe(true);
    expect(inboxMarqueeTraitee()).toBe(true);
    const eqInbox = mockTables['integrations_inbox']!['eq'] as ReturnType<
      typeof vi.fn
    >;
    expect(eqInbox).toHaveBeenCalledWith(
      'event_id_externe',
      'EVR-REJEU-1-mission_pickedup-2026-07-20T23:00:00Z',
    );
  });

  it('conflit 23505 et relecture inbox en échec → 500, aucun traitement, erreur de RELECTURE loggée', async () => {
    const logErr = vi.spyOn(logger, 'error');
    readErrors['integrations_inbox'] = { message: 'fetch failed' };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-REJEU-2',
        event_type: 'mission_pickedup',
        occurred_at: '2026-07-20T23:00:00Z',
      }),
    );

    expect(resp.status).toBe(500);
    expect(missionEcriteAvec('in_progress')).toBe(false);
    // L'erreur diagnostiquée est celle de la relecture, pas le 23505 attendu.
    expect(logErr).toHaveBeenCalledWith(
      'api_route.error',
      expect.objectContaining({
        route: 'webhooks.everest.inbox_relecture',
        error: 'fetch failed',
      }),
    );
    logErr.mockRestore();
  });
});

// ─── Mission courante + gardes dans le WHERE (arbitrage Val 2026-09-17) ─────────
// Un event ne touche la collecte que si sa mission est la mission courante :
// collecte attribuée à un transporteur A Toutes! ET tournée liée portant la
// référence de l'event. Sinon : mission à jour, collecte intacte, trace ; alerte
// Ops si un vélo est encore actif (dispatched / pickedup). Chaque UPDATE
// `collectes` porte sa garde : 0 ligne modifiée = no-op, sans alerte.

function traceHorsAttribution(missionId: string): boolean {
  return insertedLogs.some((l) =>
    String((l as { erreur?: string }).erreur ?? '').startsWith(
      `mission_hors_attribution: mission_id=${missionId}`,
    ),
  );
}

function alertePosee(code: string): boolean {
  return rpcCalls.some(
    (c) =>
      c.name === 'f_upsert_alerte_admin' &&
      (c.args as { p_code?: string }).p_code === code,
  );
}

function collecteAppliquee(): Array<Record<string, unknown>> {
  return appliedRows['collectes'] ?? [];
}

describe('M2.5 / webhook Everest — event d’une mission qui n’est plus la mission courante', () => {
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
      id: 'em-old',
      tournee_id: 'tour-old',
      collecte_id: 'col-reattr',
      statut_everest: 'created',
    };
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'programmee',
      statut_tms: 'attribuee_en_attente_acceptation',
    };
    mockState = setupEverestMock();
  });

  afterEach(() => {
    _setEverestHandlers(null);
  });

  it('mission_failed après réattribution à Marathon → collecte NON rejetée, mission failed, trace, pas d’alerte', async () => {
    mockTransporteurRow = { type_tms: 'mts1' };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-OLD-1',
        event_type: 'mission_failed',
        occurred_at: '2026-07-20T22:30:00Z',
      }),
    );

    expect(resp.status).toBe(200);
    expect(updatedRows['collectes'] ?? []).toEqual([]);
    expect(collecteLive?.['statut_tms']).toBe(
      'attribuee_en_attente_acceptation',
    );
    expect(missionEcriteAvec('failed')).toBe(true);
    expect(traceHorsAttribution('EVR-OLD-1')).toBe(true);
    expect(alertePosee('collecte_rejetee_prestataire')).toBe(false);
    expect(alertePosee('everest_mission_hors_attribution')).toBe(false);
    expect(inboxMarqueeTraitee()).toBe(true);
  });

  it('mission_cancelled externe : la tournée porte la référence d’une AUTRE mission → collecte NON rejetée', async () => {
    mockRefTournee = 'EVR-NOUVELLE';

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-OLD-2',
        event_type: 'mission_cancelled',
        occurred_at: '2026-07-20T22:40:00Z',
      }),
    );

    expect(resp.status).toBe(200);
    expect(updatedRows['collectes'] ?? []).toEqual([]);
    expect(missionEcriteAvec('cancelled_externally')).toBe(true);
    expect(traceHorsAttribution('EVR-OLD-2')).toBe(true);
    expect(alertePosee('collecte_rejetee_prestataire')).toBe(false);
  });

  it('mission_failed : tournée non liée à la collecte → collecte NON rejetée', async () => {
    mockLienAbsent = true;

    await POST(
      makeWebhookRequest({
        mission_id: 'EVR-OLD-3',
        event_type: 'mission_failed',
        occurred_at: '2026-07-20T22:30:00Z',
      }),
    );

    expect(updatedRows['collectes'] ?? []).toEqual([]);
    expect(traceHorsAttribution('EVR-OLD-3')).toBe(true);
  });

  it('mission_failed : collecte sans transporteur attribué → collecte NON rejetée', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'programmee',
      statut_tms: 'attribuee_en_attente_acceptation',
      prestataire_logistique_id: null,
    };

    await POST(
      makeWebhookRequest({
        mission_id: 'EVR-OLD-4',
        event_type: 'mission_failed',
        occurred_at: '2026-07-20T22:30:00Z',
      }),
    );

    expect(updatedRows['collectes'] ?? []).toEqual([]);
    expect(traceHorsAttribution('EVR-OLD-4')).toBe(true);
  });

  it('mission_dispatched après réattribution → collecte NON acceptée, mission assigned, alerte « course active »', async () => {
    mockTransporteurRow = { type_tms: 'mts1' };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-OLD-5',
        event_type: 'mission_dispatched',
        occurred_at: '2026-07-20T22:05:00Z',
      }),
    );

    expect(resp.status).toBe(200);
    expect(updatedRows['collectes'] ?? []).toEqual([]);
    expect(missionEcriteAvec('assigned')).toBe(true);
    const alerte = rpcCalls.find(
      (c) =>
        (c.args as { p_code?: string }).p_code ===
        'everest_mission_hors_attribution',
    );
    expect(alerte?.args).toMatchObject({
      p_entity_type: 'collectes',
      p_entity_id: 'col-reattr',
    });
    expect(inboxMarqueeTraitee()).toBe(true);
  });

  it('mission_pickedup d’une ancienne mission → alerte « course active », collecte intacte', async () => {
    mockRefTournee = 'EVR-NOUVELLE';
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'validee',
      statut_tms: 'acceptee',
    };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-OLD-6',
        event_type: 'mission_pickedup',
        occurred_at: '2026-07-20T23:00:00Z',
      }),
    );

    expect(resp.status).toBe(200);
    expect(missionEcriteAvec('in_progress')).toBe(true);
    expect(alertePosee('everest_mission_hors_attribution')).toBe(true);
    expect(updatedRows['collectes'] ?? []).toEqual([]);
  });

  it('mission_pickedup de la mission courante → aucune alerte « course active »', async () => {
    await POST(
      makeWebhookRequest({
        mission_id: 'EVR-COUR-1',
        event_type: 'mission_pickedup',
        occurred_at: '2026-07-20T23:00:00Z',
      }),
    );

    expect(alertePosee('everest_mission_hors_attribution')).toBe(false);
    expect(traceHorsAttribution('EVR-COUR-1')).toBe(false);
  });

  it('alerte « course active » non posée → 500, inbox NON traitée (seul signal, rejeu)', async () => {
    mockTransporteurRow = { type_tms: 'mts1' };
    rpcError = { message: 'fetch failed' };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-OLD-7',
        event_type: 'mission_dispatched',
        occurred_at: '2026-07-20T22:05:00Z',
      }),
    );

    expect(resp.status).toBe(500);
    expect(inboxMarqueeTraitee()).toBe(false);
  });

  it('course sans marchandise d’une ancienne mission → PAS de realisee_sans_collecte, trace', async () => {
    mockTransporteurRow = { type_tms: 'mts1' };
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'validee',
      statut_tms: 'acceptee',
    };
    mockState.details.set('EVR-OLD-8', {
      mission_id: 'EVR-OLD-8',
      status: 'Pas de commande',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: null,
      coursier_telephone: null,
      vehicule_type: null,
    });

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-OLD-8',
        event_type: 'mission_finished',
        occurred_at: '2026-07-20T23:30:00Z',
      }),
    );

    expect(resp.status).toBe(200);
    expect(updatedRows['collectes'] ?? []).toEqual([]);
    expect(collecteLive?.['statut']).toBe('validee');
    expect(traceHorsAttribution('EVR-OLD-8')).toBe(true);
    expect(alertePosee('collecte_aucun_repas')).toBe(false);
  });

  it.each([
    ['d’une autre collecte', { collecte_id: 'col-autre' }],
    ['d’une autre tournée', { tournee_id: 'tour-autre' }],
  ])(
    'mission_failed : seul lien trouvé = celui %s → collecte NON rejetée',
    async (_libelle, surcharge) => {
      mockLienSurcharge = surcharge;

      await POST(
        makeWebhookRequest({
          mission_id: 'EVR-OLD-10',
          event_type: 'mission_failed',
          occurred_at: '2026-07-20T22:30:00Z',
        }),
      );

      expect(updatedRows['collectes'] ?? []).toEqual([]);
      expect(traceHorsAttribution('EVR-OLD-10')).toBe(true);
    },
  );

  it('tournée liée SANS référence (commit adapter pas encore passé) → 500, inbox NON traitée, aucune décision', async () => {
    mockRefTournee = null;

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-SANS-REF',
        event_type: 'mission_dispatched',
        occurred_at: '2026-07-20T22:05:00Z',
      }),
    );

    expect(resp.status).toBe(500);
    expect(inboxMarqueeTraitee()).toBe(false);
    expect(updatedRows['collectes'] ?? []).toEqual([]);
    expect(alertePosee('everest_mission_hors_attribution')).toBe(false);
    expect(traceHorsAttribution('EVR-SANS-REF')).toBe(false);
    expect(alerteNonEnregistre('col-reattr')).toBeDefined();
  });

  it.each([
    ['transporteurs', 'lecture du transporteur attribué'],
    ['collecte_tournees', 'lecture de la tournée de la collecte'],
  ])(
    'lecture %s en échec → 500, inbox NON traitée, jamais de décision',
    async (table) => {
      readErrors[table] = { message: 'fetch failed' };

      const resp = await POST(
        makeWebhookRequest({
          mission_id: 'EVR-OLD-9',
          event_type: 'mission_failed',
          occurred_at: '2026-07-20T22:30:00Z',
        }),
      );

      expect(resp.status).toBe(500);
      expect(inboxMarqueeTraitee()).toBe(false);
      expect(updatedRows['collectes'] ?? []).toEqual([]);
      expect(missionEcriteAvec('failed')).toBe(false);
      expect(traceHorsAttribution('EVR-OLD-9')).toBe(false);
    },
  );
});

describe('M2.5 / webhook Everest — gardes dans le WHERE (écritures concurrentes)', () => {
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
      id: 'em-conc',
      tournee_id: 'tour-conc',
      collecte_id: 'col-conc',
      statut_everest: 'created',
    };
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'programmee',
      statut_tms: 'attribuee_en_attente_acceptation',
    };
    mockState = setupEverestMock();
  });

  afterEach(() => {
    _setEverestHandlers(null);
  });

  it('mission_failed : acceptée entre la lecture et l’UPDATE → 0 ligne, pas de rejet ni d’alerte, 200', async () => {
    apresLectureCollecte = (live) => {
      live['statut_tms'] = 'acceptee';
    };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-CONC-1',
        event_type: 'mission_failed',
        occurred_at: '2026-07-20T22:30:00Z',
      }),
    );

    expect(resp.status).toBe(200);
    expect(collecteAppliquee()).toEqual([]);
    expect(collecteLive?.['statut_tms']).toBe('acceptee');
    expect(alertePosee('collecte_rejetee_prestataire')).toBe(false);
    expect(inboxMarqueeTraitee()).toBe(true);
  });

  it('mission_failed : réattribuée à un autre transporteur entre la lecture et l’UPDATE → 0 ligne, pas de rejet', async () => {
    apresLectureCollecte = (live) => {
      live['prestataire_logistique_id'] = 'presta-marathon';
    };

    await POST(
      makeWebhookRequest({
        mission_id: 'EVR-CONC-2',
        event_type: 'mission_failed',
        occurred_at: '2026-07-20T22:30:00Z',
      }),
    );

    expect(collecteAppliquee()).toEqual([]);
    expect(collecteLive?.['statut_tms']).toBe(
      'attribuee_en_attente_acceptation',
    );
    expect(alertePosee('collecte_rejetee_prestataire')).toBe(false);
  });

  it('mission_cancelled externe : collecte annulée entre la lecture et l’UPDATE → 0 ligne, jamais « rejetee »', async () => {
    apresLectureCollecte = (live) => {
      live['statut'] = 'annulee';
    };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-CONC-5',
        event_type: 'mission_cancelled',
        occurred_at: '2026-07-20T22:30:00Z',
      }),
    );

    expect(resp.status).toBe(200);
    expect(collecteAppliquee()).toEqual([]);
    expect(collecteLive?.['statut']).toBe('annulee');
    expect(alertePosee('collecte_rejetee_prestataire')).toBe(false);
  });

  it('mission_dispatched : rejetée entre la lecture et l’UPDATE → 0 ligne, jamais « acceptee »', async () => {
    apresLectureCollecte = (live) => {
      live['statut_tms'] = 'rejetee_par_prestataire';
    };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-CONC-3',
        event_type: 'mission_dispatched',
        occurred_at: '2026-07-20T22:05:00Z',
      }),
    );

    expect(resp.status).toBe(200);
    expect(collecteAppliquee()).toEqual([]);
    expect(collecteLive?.['statut_tms']).toBe('rejetee_par_prestataire');
  });

  it('mission_dispatched : réattribuée entre la lecture et l’UPDATE → 0 ligne, jamais « acceptee »', async () => {
    apresLectureCollecte = (live) => {
      live['prestataire_logistique_id'] = 'presta-marathon';
    };

    await POST(
      makeWebhookRequest({
        mission_id: 'EVR-CONC-4',
        event_type: 'mission_dispatched',
        occurred_at: '2026-07-20T22:05:00Z',
      }),
    );

    expect(collecteAppliquee()).toEqual([]);
    expect(collecteLive?.['statut_tms']).toBe(
      'attribuee_en_attente_acceptation',
    );
  });

  it('mission_dispatched nominal → la garde laisse passer (1 ligne, acceptee)', async () => {
    await POST(
      makeWebhookRequest({
        mission_id: 'EVR-CONC-5',
        event_type: 'mission_dispatched',
        occurred_at: '2026-07-20T22:05:00Z',
      }),
    );

    expect(collecteAppliquee()).toEqual([{ statut_tms: 'acceptee' }]);
    expect(collecteLive?.['statut_tms']).toBe('acceptee');
  });

  it('course sans marchandise : clôturée entre la lecture et l’UPDATE → 0 ligne, pas de régression ni d’alerte', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'en_cours',
      statut_tms: 'acceptee',
    };
    apresLectureCollecte = (live) => {
      live['statut'] = 'cloturee';
    };
    mockState.details.set('EVR-CONC-6', {
      mission_id: 'EVR-CONC-6',
      status: 'Pas de commande',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: null,
      coursier_telephone: null,
      vehicule_type: null,
    });

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-CONC-6',
        event_type: 'mission_finished',
        occurred_at: '2026-07-20T23:30:00Z',
      }),
    );

    expect(resp.status).toBe(200);
    expect(collecteAppliquee()).toEqual([]);
    expect(collecteLive?.['statut']).toBe('cloturee');
    expect(alertePosee('collecte_aucun_repas')).toBe(false);
  });

  it('course sans marchandise : réattribuée entre la lecture et l’UPDATE → 0 ligne, pas de realisee_sans_collecte', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'en_cours',
      statut_tms: 'acceptee',
    };
    apresLectureCollecte = (live) => {
      live['prestataire_logistique_id'] = 'presta-marathon';
    };
    mockState.details.set('EVR-CONC-7', {
      mission_id: 'EVR-CONC-7',
      status: 'Pas de commande',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: null,
      coursier_telephone: null,
      vehicule_type: null,
    });

    await POST(
      makeWebhookRequest({
        mission_id: 'EVR-CONC-7',
        event_type: 'mission_finished',
        occurred_at: '2026-07-20T23:30:00Z',
      }),
    );

    expect(collecteAppliquee()).toEqual([]);
    expect(collecteLive?.['statut']).toBe('en_cours');
  });

  it('course sans marchandise : type changé entre la lecture et l’UPDATE → 0 ligne (AG only)', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'en_cours',
      statut_tms: 'acceptee',
    };
    apresLectureCollecte = (live) => {
      live['type'] = 'zero_dechet';
    };
    mockState.details.set('EVR-CONC-TYPE', {
      mission_id: 'EVR-CONC-TYPE',
      status: 'Pas de commande',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: null,
      coursier_telephone: null,
      vehicule_type: null,
    });

    await POST(
      makeWebhookRequest({
        mission_id: 'EVR-CONC-TYPE',
        event_type: 'mission_finished',
        occurred_at: '2026-07-20T23:30:00Z',
      }),
    );

    expect(collecteAppliquee()).toEqual([]);
    expect(collecteLive?.['statut']).toBe('en_cours');
    expect(alertePosee('collecte_aucun_repas')).toBe(false);
  });

  it('mission terminale réécrite par un re-dispatch pendant l’event → la synchronisation de l’ancienne n’écrase pas la nouvelle', async () => {
    mockMissionRow = {
      id: 'em-conc',
      tournee_id: 'tour-conc',
      collecte_id: 'col-conc',
      statut_everest: 'failed',
    };
    apresLectureMission = (live) => {
      live['everest_mission_id'] = 'EVR-NOUVELLE';
      live['statut_everest'] = 'created';
      live['payload_latest_update'] = { nouvelle: true };
    };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-CONC-TERM',
        event_type: 'mission_late',
        occurred_at: '2026-07-20T23:00:00Z',
      }),
    );

    expect(resp.status).toBe(200);
    expect(appliedRows['everest_missions'] ?? []).toEqual([]);
    expect(missionLive?.['payload_latest_update']).toEqual({ nouvelle: true });
  });

  it('mission réécrite par une réattribution A Toutes! → A Toutes! pendant l’event → l’ancienne n’écrase pas la nouvelle', async () => {
    // La ligne `everest_missions` est unique par tournée : le re-dispatch la
    // réécrit avec la nouvelle mission entre la lecture et l'écriture de l'event.
    apresLectureMission = (live) => {
      live['everest_mission_id'] = 'EVR-NOUVELLE';
      live['statut_everest'] = 'created';
    };

    const resp = await POST(
      makeWebhookRequest({
        mission_id: 'EVR-CONC-8',
        event_type: 'mission_failed',
        occurred_at: '2026-07-20T22:30:00Z',
      }),
    );

    expect(resp.status).toBe(200);
    expect(appliedRows['everest_missions'] ?? []).toEqual([]);
    expect(missionLive).toMatchObject({
      everest_mission_id: 'EVR-NOUVELLE',
      statut_everest: 'created',
    });
  });
});

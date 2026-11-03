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
  _getEverestHandlers,
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
// Filtres `eq` posés sur chaque UPDATE, par table : prouve la garde du WHERE
// pour les tables sans ligne « en base » (tournees).
const updateFiltres: Record<string, Array<[string, unknown]>> = {};

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
// Lectures de liste (collecte à plusieurs courses) : références portées par les
// tournées de la collecte (défaut : la seule mission de l'event) et les autres
// missions « en base » ; résultat rendu par chaque fonction SQL appelée.
let mockRefsTourneesCollecte: Array<string | null> | null = null;
let mockAutresMissions: Array<{
  everest_mission_id: string;
  statut_everest: string;
}> = [];
let rpcResultats: Record<string, unknown> = {};
// Erreur injectée sur la seule lecture de LISTE d'une table (pas sur maybeSingle).
let readErrorsListe: Record<string, ErreurMock> = {};

beforeEach(() => {
  updateErrors = {};
  readErrors = {};
  rpcError = null;
  mockInboxExistant = { data: null, error: null };
  mockRefsTourneesCollecte = null;
  mockAutresMissions = [];
  rpcResultats = {};
  readErrorsListe = {};
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
  in: (col: string, vals: unknown[]) => UpdateBuilder;
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
      (updateFiltres[table] ??= []).push([col, val]);
      return b;
    },
    in: (col, vals) => {
      filtres.push((r) => vals.includes(r[col]));
      (updateFiltres[table] ??= []).push([col, vals]);
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
  q['in'] = vi.fn().mockReturnThis();
  // Lecture de liste (attendue sans maybeSingle) : courses d'une collecte.
  q['then'] = (
    onOk: (v: { data: unknown; error: unknown }) => unknown,
    onKo?: (e: unknown) => unknown,
  ) => {
    const lire = (): { data: unknown; error: unknown } => {
      const erreur = readErrorsListe[table] ?? readErrors[table];
      if (erreur) return { data: null, error: erreur };
      if (table === 'collecte_tournees') {
        const refs = mockRefsTourneesCollecte ?? [lastMissionId];
        return {
          data: refs.map((r) => ({ tournees: { external_ref_commande: r } })),
          error: null,
        };
      }
      if (table === 'everest_missions') {
        const inCalls = (q['in'] as ReturnType<typeof vi.fn>).mock
          .calls as Array<[string, string[]]>;
        const voulues = inCalls.at(-1)?.[1] ?? [];
        return {
          data: mockAutresMissions.filter((m) =>
            voulues.includes(m.everest_mission_id),
          ),
          error: null,
        };
      }
      return { data: [], error: null };
    };
    return Promise.resolve(lire()).then(onOk, onKo);
  };

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
    return { data: rpcResultats[name] ?? null, error: rpcError };
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
  lastMissionId = params['ref'] ?? '';
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
        ref: 'EVR-001',
        event: 'mission_dispatched',
        date: '1784585100',
      },
      'secret-token-123',
    );
    const resp = await POST(req);
    expect(resp.status).toBe(200);
  });

  it('token incorrect → 401', async () => {
    const req = makeWebhookRequest(
      { ref: 'EVR-001', event: 'mission_dispatched' },
      'wrong-token',
    );
    const resp = await POST(req);
    expect(resp.status).toBe(401);
  });

  it('pas de token quand EVEREST_WEBHOOK_TOKEN absent → 200 (mode permissif)', async () => {
    vi.stubEnv('EVEREST_WEBHOOK_TOKEN', '');
    mockMissionRow = null;
    const req = makeWebhookRequest({
      ref: 'EVR-002',
      event: 'mission_dispatched',
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
      ref: 'EVR-DUP',
      event: 'mission_dispatched',
      date: '1784584800',
    });
    const resp = await POST(req);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { deduplicated?: boolean };
    expect(body.deduplicated).toBe(true);
  });
});

describe('M2.5 / webhook Everest — event_type mission_dispatched', () => {
  // mission_dispatched relit la mission sur l'API Everest (coursier) : le mock
  // est OBLIGATOIRE ici, sinon le test appelle le vrai serveur A Toutes!.
  let mockState: ReturnType<typeof setupEverestMock>;

  beforeEach(() => {
    Object.keys(insertedRows).forEach((k) => delete insertedRows[k]);
    Object.keys(updatedRows).forEach((k) => delete updatedRows[k]);
    Object.keys(mockTables).forEach((k) => delete mockTables[k]);
    insertedLogs.length = 0;
    mockInboxInsertResult = { data: { id: 'inbox-001' }, error: null };
    vi.stubEnv('EVEREST_WEBHOOK_TOKEN', '');
    mockAuditRow = null;
    rpcCalls.length = 0;
    updateErrors = {};
    mockState = setupEverestMock();
  });

  afterEach(() => {
    _setEverestHandlers(null);
    vi.restoreAllMocks();
  });

  it('M2.5/everest_notification_champs_swagger — ref, event, date et agent_name (swagger Everest) : clé d’idempotence ref-event-date, coursier de la mission = agent_name', async () => {
    mockMissionRow = {
      id: 'em-001',
      tournee_id: 'tour-001',
      collecte_id: 'col-001',
      statut_everest: 'created',
    };
    mockCollecteRow = { statut_tms: 'attribuee_en_attente_acceptation' };

    // Corps tel qu'Everest l'envoie (form-urlencoded, noms du swagger 1.291.1).
    const resp = await POST(
      makeWebhookRequest({
        event: 'mission_dispatched',
        ref: 'EVR-001',
        date: '1784585100',
        status: 'Assignée',
        status_slug: 'assigned',
        client_ref: 'tour-001',
        agent_name: 'Jean Vélo',
      }),
    );
    expect(resp.status).toBe(200);

    expect(insertedRows['integrations_inbox']).toEqual([
      expect.objectContaining({
        event_type: 'mission_dispatched',
        event_id_externe: 'EVR-001-mission_dispatched-1784585100',
      }),
    ]);
    expect(updatedRows['everest_missions'] ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statut_everest: 'assigned',
          coursier_nom: 'Jean Vélo',
        }),
      ]),
    );
  });

  it('M2.5/everest_notification_date_vide — date vide : la clé d’idempotence prend l’heure de réception, jamais « ref-event- »', async () => {
    mockMissionRow = {
      id: 'em-001',
      tournee_id: 'tour-001',
      collecte_id: 'col-001',
      statut_everest: 'created',
    };
    mockCollecteRow = { statut_tms: 'attribuee_en_attente_acceptation' };

    const resp = await POST(
      makeWebhookRequest({
        event: 'mission_dispatched',
        ref: 'EVR-001',
        date: '',
      }),
    );
    expect(resp.status).toBe(200);

    const [ligne] = (insertedRows['integrations_inbox'] ?? []) as Array<{
      event_id_externe: string;
    }>;
    expect(ligne?.event_id_externe).toMatch(
      /^EVR-001-mission_dispatched-\d{4}-\d{2}-\d{2}T/,
    );
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
      ref: 'EVR-001',
      event: 'mission_dispatched',
      date: '1784585100',
      agent_name: 'Jean Vélo',
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

  it('mission_dispatched — coursier relu sur l’API Everest → tournees.chauffeur_nom / chauffeur_telephone, garde WHERE sur la mission, JAMAIS depuis le payload', async () => {
    mockMissionRow = {
      id: 'em-001',
      tournee_id: 'tour-001',
      collecte_id: 'col-001',
      statut_everest: 'created',
    };
    mockCollecteRow = { statut_tms: 'attribuee_en_attente_acceptation' };
    mockState.details.set('EVR-001', {
      mission_id: 'EVR-001',
      status: 'assigned',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: 'Jean Vélo',
      coursier_telephone: '+33700000001',
      vehicule_type: null,
    });
    delete updateFiltres['tournees'];

    const resp = await POST(
      makeWebhookRequest({
        ref: 'EVR-001',
        event: 'mission_dispatched',
        date: '1784585100',
        // Valeurs du payload non signé : ne doivent JAMAIS atteindre la tournée.
        agent_name: 'Attaquant Payload',
      }),
    );
    expect(resp.status).toBe(200);

    // Le couple nom + téléphone de l'API, écrit ensemble, rien d'autre.
    expect(updatedRows['tournees'] ?? []).toEqual([
      { chauffeur_nom: 'Jean Vélo', chauffeur_telephone: '+33700000001' },
    ]);
    // Garde du WHERE : la tournée de la mission ET qui porte encore cette mission.
    expect(updateFiltres['tournees']).toEqual(
      expect.arrayContaining([
        ['id', 'tour-001'],
        ['external_ref_commande', 'EVR-001'],
      ]),
    );
  });

  it('mission_dispatched — API Everest sans coursier (ou téléphone seul) → la tournée n’est pas touchée (saisie Admin conservée)', async () => {
    mockMissionRow = {
      id: 'em-001',
      tournee_id: 'tour-001',
      collecte_id: 'col-001',
      statut_everest: 'created',
    };
    mockCollecteRow = { statut_tms: 'attribuee_en_attente_acceptation' };
    mockState.details.set('EVR-001', {
      mission_id: 'EVR-001',
      status: 'assigned',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: null,
      coursier_telephone: '+33700000001',
      vehicule_type: null,
    });

    await POST(
      makeWebhookRequest({
        ref: 'EVR-001',
        event: 'mission_dispatched',
        date: '1784585100',
        agent_name: 'Jean Vélo',
      }),
    );
    expect(updatedRows['tournees'] ?? []).toEqual([]);
  });

  it('mission_dispatched — re-fetch Everest en échec → rien d’écrit sur la tournée (payload ignoré), mission quand même assigned, 200', async () => {
    mockMissionRow = {
      id: 'em-001',
      tournee_id: 'tour-001',
      collecte_id: 'col-001',
      statut_everest: 'created',
    };
    mockCollecteRow = { statut_tms: 'attribuee_en_attente_acceptation' };
    setupEverestMock({ getMissionFails: true });
    const erreurs = vi.spyOn(logger, 'error');

    const resp = await POST(
      makeWebhookRequest({
        ref: 'EVR-001',
        event: 'mission_dispatched',
        date: '1784585100',
        agent_name: 'Jean Vélo',
      }),
    );
    expect(resp.status).toBe(200);
    expect(updatedRows['tournees'] ?? []).toEqual([]);
    expect(
      (updatedRows['everest_missions'] ?? []).some(
        (u) => (u as { statut_everest?: string }).statut_everest === 'assigned',
      ),
    ).toBe(true);
    expect(
      erreurs.mock.calls.some(
        ([evt]) => evt === 'webhooks.everest.coursier_refetch_failed',
      ),
    ).toBe(true);
  });

  it('mission_dispatched — API sans téléphone → seul le nom est écrit (le téléphone, peut-être saisi par l’Admin, n’est pas touché — même règle que MTS-1)', async () => {
    mockMissionRow = {
      id: 'em-001',
      tournee_id: 'tour-001',
      collecte_id: 'col-001',
      statut_everest: 'created',
    };
    mockCollecteRow = { statut_tms: 'attribuee_en_attente_acceptation' };
    mockState.details.set('EVR-001', {
      mission_id: 'EVR-001',
      status: 'assigned',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: 'Jean Vélo',
      coursier_telephone: null,
      vehicule_type: null,
    });

    await POST(
      makeWebhookRequest({
        ref: 'EVR-001',
        event: 'mission_dispatched',
        date: '1784585100',
      }),
    );
    expect(updatedRows['tournees'] ?? []).toEqual([
      { chauffeur_nom: 'Jean Vélo' },
    ]);
  });

  it('mission_dispatched — coursier écrit → l’email récap « infos d’accès » est réévalué (fn_infos_acces_marquer_si_complet sur la collecte)', async () => {
    mockMissionRow = {
      id: 'em-001',
      tournee_id: 'tour-001',
      collecte_id: 'col-001',
      statut_everest: 'created',
    };
    mockCollecteRow = { statut_tms: 'attribuee_en_attente_acceptation' };
    mockState.details.set('EVR-001', {
      mission_id: 'EVR-001',
      status: 'assigned',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: 'Jean Vélo',
      coursier_telephone: '+33700000001',
      vehicule_type: null,
    });

    await POST(
      makeWebhookRequest({
        ref: 'EVR-001',
        event: 'mission_dispatched',
        date: '1784585100',
      }),
    );
    const evaluation = rpcCalls.find(
      (c) => c.name === 'fn_infos_acces_marquer_si_complet',
    );
    expect(evaluation?.args).toEqual({ p_collecte_id: 'col-001' });
  });

  it('mission_dispatched — UPDATE tournees refusé → 200, tracé coursier_non_propage, pas de réévaluation email', async () => {
    mockMissionRow = {
      id: 'em-001',
      tournee_id: 'tour-001',
      collecte_id: 'col-001',
      statut_everest: 'created',
    };
    mockCollecteRow = { statut_tms: 'attribuee_en_attente_acceptation' };
    mockState.details.set('EVR-001', {
      mission_id: 'EVR-001',
      status: 'assigned',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: 'Jean Vélo',
      coursier_telephone: '+33700000001',
      vehicule_type: null,
    });
    updateErrors['tournees'] = () => ({
      code: '23514',
      message: 'new row violates check constraint',
    });
    const erreurs = vi.spyOn(logger, 'error');

    const resp = await POST(
      makeWebhookRequest({
        ref: 'EVR-001',
        event: 'mission_dispatched',
        date: '1784585100',
      }),
    );
    expect(resp.status).toBe(200);
    expect(
      erreurs.mock.calls.some(
        ([evt, ctx]) =>
          evt === 'webhooks.everest.coursier_non_propage' &&
          (ctx as { error_code?: string }).error_code === '23514',
      ),
    ).toBe(true);
    expect(
      rpcCalls.some((c) => c.name === 'fn_infos_acces_marquer_si_complet'),
    ).toBe(false);
  });

  it('mission_dispatched — collecte déjà annulée côté Savr → ni coursier écrit, ni email récap, ni appel API (annulation pas encore parvenue à Everest)', async () => {
    mockMissionRow = {
      id: 'em-001',
      tournee_id: 'tour-001',
      collecte_id: 'col-001',
      statut_everest: 'created',
    };
    mockCollecteRow = { statut: 'annulee', statut_tms: 'annulee_par_traiteur' };
    const handlers = _getEverestHandlers()!;
    const getMission = vi.fn(handlers.getMission);
    _setEverestHandlers({ ...handlers, getMission });
    mockState.details.set('EVR-001', {
      mission_id: 'EVR-001',
      status: 'assigned',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: 'Jean Vélo',
      coursier_telephone: '+33700000001',
      vehicule_type: null,
    });

    const resp = await POST(
      makeWebhookRequest({
        ref: 'EVR-001',
        event: 'mission_dispatched',
        date: '1784585100',
      }),
    );
    expect(resp.status).toBe(200);
    expect(updatedRows['tournees'] ?? []).toEqual([]);
    expect(getMission).not.toHaveBeenCalled();
    expect(
      rpcCalls.some((c) => c.name === 'fn_infos_acces_marquer_si_complet'),
    ).toBe(false);
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
      ref: 'EVR-002',
      event: 'mission_dispatched',
      date: '1784585100',
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
      ref: 'EVR-003',
      event: 'mission_pickedup',
      date: '1784588400',
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
      ref: 'EVR-UNKNOWN',
      event: 'mission_dispatched',
      date: '1784584800',
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
      ref: 'EVR-RF-1',
      event: 'mission_finished',
      date: '1784590200',
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

  it('mission_finished : re-fetch en échec → aucune valeur payload écrite, trace Ops, 500 et mission NON terminale (la fin de course ferme la tournée : rejeu)', async () => {
    _setEverestHandlers(null);
    setupEverestMock({ getMissionFails: true });

    const req = makeWebhookRequest({
      ref: 'EVR-RF-2',
      event: 'mission_success',
      date: '1784591100',
      cost: '77.77',
      proof_url: 'https://attacker.example/PAYLOAD2.pdf',
    });
    const resp = await POST(req);
    expect(resp.status).toBe(500);

    const missionUpdates = (updatedRows['everest_missions'] ?? []) as Array<
      Record<string, unknown>
    >;
    // Rien de décidé : ni statut terminal, ni coût/preuve du payload.
    expect(missionUpdates.some((u) => 'statut_everest' in u)).toBe(false);
    expect(updatedRows['tournees'] ?? []).toEqual([]);
    expect(missionUpdates.some((u) => 'cout_everest_ht' in u)).toBe(false);
    expect(missionUpdates.some((u) => 'preuve_course_url' in u)).toBe(false);
    // Trace Ops pour réconciliation manuelle, sur la route de relecture réelle.
    expect(insertedLogs).toContainEqual(
      expect.objectContaining({
        integration: 'everest',
        methode: 'POST',
        endpoint: '/missions/get',
        correlation_id: 'EVR-RF-2',
        erreur: expect.stringContaining('refetch_failed'),
      }),
    );
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
      ref: 'EVR-CV-1',
      event: 'mission_finished',
      date: '1784590200',
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
      ref: 'EVR-CV-2',
      event: 'mission_success',
      date: '1784590500',
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
      ref: 'EVR-CV-3',
      event: 'mission_finished',
      date: '1784590800',
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
      ref: 'EVR-REJ-1',
      event: 'mission_failed',
      date: '1784586600',
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

  it('mission_failed + déjà acceptee → PAS de rejet direct : tournée annulée puis agrégation de la collecte (même règle que MTS-1)', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'en_cours',
      statut_tms: 'acceptee',
    };

    const req = makeWebhookRequest({
      ref: 'EVR-REJ-2',
      event: 'mission_failed',
      date: '1784586900',
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
    expect(updatedRows['tournees'] ?? []).toContainEqual({ statut: 'annulee' });
    expect(
      rpcCalls.some((c) => c.name === 'fn_agreger_terminal_collecte'),
    ).toBe(true);
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
        ref: 'EVR-ERR-1',
        event: 'mission_pickedup',
        date: '1784588400',
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
        ref: 'EVR-ERR-T',
        event: 'mission_late',
        date: '1784588400',
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
        ref: 'EVR-ERR-2',
        event: 'mission_dispatched',
        date: '1784585100',
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
        ref: 'EVR-ERR-3',
        event: 'mission_dispatched',
        date: '1784585100',
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
        ref: 'EVR-ERR-4',
        event: 'mission_failed',
        date: '1784586600',
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
        ref: 'EVR-ERR-4B',
        event: 'mission_cancelled',
        date: '1784586600',
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
        ref: 'EVR-ERR-5',
        event: 'mission_finished',
        date: '1784590200',
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
        ref: 'EVR-ERR-6',
        event: 'mission_failed',
        date: '1784586600',
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
        ref: 'EVR-ERR-7',
        event: 'mission_cancelled',
        date: '1784587200',
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
        ref: 'EVR-ERR-8',
        event: 'mission_pickedup',
        date: '1784588400',
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
        ref: 'EVR-ERR-9',
        event: 'mission_pickedup',
        date: '1784588400',
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
        ref: 'EVR-ERR-10',
        event: 'mission_pickedup',
        date: '1784588400',
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
        ref: 'EVR-ERR-11',
        event: 'mission_finished',
        date: '1784590200',
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
        ref: 'EVR-REJEU-1',
        event: 'mission_pickedup',
        date: '1784588400',
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
      'EVR-REJEU-1-mission_pickedup-1784588400',
    );
  });

  it('conflit 23505 et relecture inbox en échec → 500, aucun traitement, erreur de RELECTURE loggée', async () => {
    const logErr = vi.spyOn(logger, 'error');
    readErrors['integrations_inbox'] = { message: 'fetch failed' };

    const resp = await POST(
      makeWebhookRequest({
        ref: 'EVR-REJEU-2',
        event: 'mission_pickedup',
        date: '1784588400',
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
        ref: 'EVR-OLD-1',
        event: 'mission_failed',
        date: '1784586600',
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
        ref: 'EVR-OLD-2',
        event: 'mission_cancelled',
        date: '1784587200',
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
        ref: 'EVR-OLD-3',
        event: 'mission_failed',
        date: '1784586600',
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
        ref: 'EVR-OLD-4',
        event: 'mission_failed',
        date: '1784586600',
      }),
    );

    expect(updatedRows['collectes'] ?? []).toEqual([]);
    expect(traceHorsAttribution('EVR-OLD-4')).toBe(true);
  });

  it('mission_dispatched après réattribution, coursier présent sur l’API → aucune écriture sur la tournée ni appel API (garde mission courante AVANT la propagation)', async () => {
    mockTransporteurRow = { type_tms: 'mts1' };
    // Espion sur la relecture : une mission hors attribution ne déclenche
    // aucun appel à l'API Everest.
    const handlers = _getEverestHandlers()!;
    const getMission = vi.fn(handlers.getMission);
    _setEverestHandlers({ ...handlers, getMission });
    mockState.details.set('EVR-OLD-6', {
      mission_id: 'EVR-OLD-6',
      status: 'assigned',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: 'Jean Vélo',
      coursier_telephone: '+33700000001',
      vehicule_type: null,
    });

    const resp = await POST(
      makeWebhookRequest({
        ref: 'EVR-OLD-6',
        event: 'mission_dispatched',
        date: '1784585100',
        agent_name: 'Jean Vélo',
      }),
    );
    expect(resp.status).toBe(200);
    expect(updatedRows['tournees'] ?? []).toEqual([]);
    expect(getMission).not.toHaveBeenCalled();
    expect(traceHorsAttribution('EVR-OLD-6')).toBe(true);
  });

  it('mission_dispatched après réattribution → collecte NON acceptée, mission assigned, alerte « course active »', async () => {
    mockTransporteurRow = { type_tms: 'mts1' };

    const resp = await POST(
      makeWebhookRequest({
        ref: 'EVR-OLD-5',
        event: 'mission_dispatched',
        date: '1784585100',
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
        ref: 'EVR-OLD-6',
        event: 'mission_pickedup',
        date: '1784588400',
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
        ref: 'EVR-COUR-1',
        event: 'mission_pickedup',
        date: '1784588400',
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
        ref: 'EVR-OLD-7',
        event: 'mission_dispatched',
        date: '1784585100',
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
        ref: 'EVR-OLD-8',
        event: 'mission_finished',
        date: '1784590200',
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
          ref: 'EVR-OLD-10',
          event: 'mission_failed',
          date: '1784586600',
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
        ref: 'EVR-SANS-REF',
        event: 'mission_dispatched',
        date: '1784585100',
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
          ref: 'EVR-OLD-9',
          event: 'mission_failed',
          date: '1784586600',
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
        ref: 'EVR-CONC-1',
        event: 'mission_failed',
        date: '1784586600',
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
        ref: 'EVR-CONC-2',
        event: 'mission_failed',
        date: '1784586600',
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
        ref: 'EVR-CONC-5',
        event: 'mission_cancelled',
        date: '1784586600',
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
        ref: 'EVR-CONC-3',
        event: 'mission_dispatched',
        date: '1784585100',
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
        ref: 'EVR-CONC-4',
        event: 'mission_dispatched',
        date: '1784585100',
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
        ref: 'EVR-CONC-5',
        event: 'mission_dispatched',
        date: '1784585100',
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
        ref: 'EVR-CONC-6',
        event: 'mission_finished',
        date: '1784590200',
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
        ref: 'EVR-CONC-7',
        event: 'mission_finished',
        date: '1784590200',
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
        ref: 'EVR-CONC-TYPE',
        event: 'mission_finished',
        date: '1784590200',
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
        ref: 'EVR-CONC-TERM',
        event: 'mission_late',
        date: '1784588400',
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
        ref: 'EVR-CONC-8',
        event: 'mission_failed',
        date: '1784586600',
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

// ─── Notification réelle A Toutes! : event `mission_status` ────────────────────
// Mesuré le 2026-11-03 sur le compte de test : `event` vaut TOUJOURS
// `mission_status`, l'étape est dans `status_slug`. La route relit la mission et
// choisit le traitement sur la catégorie de l'étape relue (jamais sur le payload).

describe('M2.5 / webhook Everest — notification réelle `mission_status`', () => {
  let mockState: ReturnType<typeof setupEverestMock>;

  function detail(
    etape: EverestMissionDetail['etape'],
    surcharge: Partial<EverestMissionDetail> = {},
  ): EverestMissionDetail {
    return {
      mission_id: 'EVR-MS',
      status: 'Colis remis',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: null,
      coursier_telephone: null,
      vehicule_type: null,
      statut_code: null,
      etape,
      ...surcharge,
    };
  }

  // Forme réelle reçue le 2026-11-03 (champs utiles), étape au choix.
  function notification(statusSlug: string): NextRequest {
    return makeWebhookRequest({
      ref: 'EVR-MS',
      event: 'mission_status',
      date: '1793707186',
      status: statusSlug,
      status_slug: statusSlug,
      agent_name: 'Coursier Payload',
      service_id: '71',
    });
  }

  function collecteEcriteAvec(champ: string, valeur: string): boolean {
    return (
      (updatedRows['collectes'] ?? []) as Array<Record<string, unknown>>
    ).some((u) => u[champ] === valeur);
  }

  beforeEach(() => {
    Object.keys(insertedRows).forEach((k) => delete insertedRows[k]);
    Object.keys(updatedRows).forEach((k) => delete updatedRows[k]);
    Object.keys(mockTables).forEach((k) => delete mockTables[k]);
    delete updateFiltres['tournees'];
    delete updateFiltres['collectes'];
    insertedLogs.length = 0;
    rpcCalls.length = 0;
    mockInboxInsertResult = { data: { id: 'inbox-001' }, error: null };
    mockAuditRow = null;
    vi.stubEnv('EVEREST_WEBHOOK_TOKEN', '');
    mockMissionRow = {
      id: 'em-ms',
      tournee_id: 'tour-ms',
      collecte_id: 'col-ms',
      statut_everest: 'created',
    };
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'programmee',
      statut_tms: 'attribuee_en_attente_acceptation',
      nb_camions_demande: 1,
    };
    mockState = setupEverestMock();
  });

  afterEach(() => {
    _setEverestHandlers(null);
    vi.restoreAllMocks();
  });

  it('M2.5/everest_mission_status_inconnu_avant — `mission_status` n’est plus rangé en « event_type_inconnu »', async () => {
    mockState.details.set('EVR-MS', detail(null));
    const resp = await POST(notification('nouvelle-mission'));
    expect(resp.status).toBe(200);
    expect(
      insertedLogs.some((l) =>
        String((l as { erreur?: string }).erreur ?? '').startsWith(
          'event_type_inconnu',
        ),
      ),
    ).toBe(false);
    expect(inboxMarqueeTraitee()).toBe(true);
  });

  it('étape sans catégorie (mission créée) → mission synchronisée seulement, collecte intacte', async () => {
    mockState.details.set('EVR-MS', detail(null));
    await POST(notification('nouvelle-mission'));
    expect(missionEcriteAvec('assigned')).toBe(false);
    expect(updatedRows['collectes'] ?? []).toEqual([]);
    expect(
      (updatedRows['everest_missions'] ?? []).some(
        (u) => (u as Record<string, unknown>)['derniere_sync_at'] !== undefined,
      ),
    ).toBe(true);
  });

  it('« Mission Affectée » (mission-acceptee, affectee) → mission assigned + collecte acceptee', async () => {
    mockState.details.set('EVR-MS', detail('affectee'));
    const resp = await POST(notification('mission-acceptee'));
    expect(resp.status).toBe(200);
    expect(missionEcriteAvec('assigned')).toBe(true);
    expect(collecteEcriteAvec('statut_tms', 'acceptee')).toBe(true);
  });

  it('« Mission Affectée » : coursier de la mission = nom relu sur l’API, jamais agent_name du payload', async () => {
    mockState.details.set(
      'EVR-MS',
      detail('affectee', { coursier_nom: 'Coursier API' }),
    );
    await POST(notification('mission-acceptee'));
    const ecrits = (
      (updatedRows['everest_missions'] ?? []) as Array<Record<string, unknown>>
    )
      .map((u) => u['coursier_nom'])
      .filter((v) => v !== undefined);
    expect(ecrits).toEqual(['Coursier API']);
  });

  it('« Colis récupéré » (enlevee) → mission in_progress, collecte acceptee puis en_cours (garde programmee/validee)', async () => {
    mockState.details.set('EVR-MS', detail('enlevee'));
    await POST(notification('mission-en-cours-de-livraison'));
    expect(missionEcriteAvec('in_progress')).toBe(true);
    expect(collecteEcriteAvec('statut_tms', 'acceptee')).toBe(true);
    expect(collecteEcriteAvec('statut', 'en_cours')).toBe(true);
    expect(updateFiltres['collectes']).toContainEqual([
      'statut',
      ['programmee', 'validee'],
    ]);
  });

  it('« Colis récupéré » sur une collecte déjà réalisée → jamais de retour en_cours', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'realisee',
      statut_tms: 'acceptee',
      nb_camions_demande: 1,
    };
    mockState.details.set('EVR-MS', detail('enlevee'));
    await POST(notification('mission-en-cours-de-livraison'));
    // La tentative porte sa garde ; aucune ligne ne la satisfait.
    expect(appliedRows['collectes'] ?? []).not.toContainEqual({
      statut: 'en_cours',
    });
  });

  it('« Colis remis » (reussie) → tournée terminee (garde sur la mission), agrégation, mission completed écrite en dernier', async () => {
    rpcResultats['fn_agreger_terminal_collecte'] = 'realisee';
    mockState.details.set('EVR-MS', detail('reussie'));
    const resp = await POST(notification('livraison-terminee'));
    expect(resp.status).toBe(200);
    expect(updatedRows['tournees'] ?? []).toContainEqual({
      statut: 'terminee',
    });
    expect(updateFiltres['tournees']).toEqual(
      expect.arrayContaining([
        ['id', 'tour-ms'],
        ['external_ref_commande', 'EVR-MS'],
      ]),
    );
    expect(rpcCalls).toContainEqual({
      name: 'fn_agreger_terminal_collecte',
      args: { p_collecte_id: 'col-ms' },
    });
    expect(collecteEcriteAvec('statut_tms', 'acceptee')).toBe(true);
    const missions = (updatedRows['everest_missions'] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(missions.at(-1)?.['statut_everest']).toBe('completed');
  });

  it('« Colis remis » : agrégation en échec → 500, inbox NON traitée, mission PAS encore terminale (rejeu possible)', async () => {
    rpcError = { message: 'agrégation refusée' };
    mockState.details.set('EVR-MS', detail('reussie'));
    const resp = await POST(notification('livraison-terminee'));
    expect(resp.status).toBe(500);
    expect(inboxMarqueeTraitee()).toBe(false);
    expect(missionEcriteAvec('completed')).toBe(false);
  });

  it('« Rien à récupérer » (pas-de-commande) + AG → realisee_sans_collecte, motif = libellé relu', async () => {
    mockState.details.set(
      'EVR-MS',
      detail('echouee', {
        status: 'Rien à récupérer',
        statut_code: 'pas-de-commande',
      }),
    );
    await POST(notification('pas-de-commande'));
    const ecrites = (updatedRows['collectes'] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(ecrites).toContainEqual(
      expect.objectContaining({
        statut: 'realisee_sans_collecte',
        aucun_repas_motif: 'Rien à récupérer',
      }),
    );
    expect(missionEcriteAvec('completed_incomplete')).toBe(true);
  });

  it('« Client Absent » (client-absent-marchandise-refusee, sans catégorie) + AG → realisee_sans_collecte', async () => {
    mockState.details.set(
      'EVR-MS',
      detail(null, {
        status: 'Client Absent',
        statut_code: 'client-absent-marchandise-refusee',
      }),
    );
    await POST(notification('client-absent-marchandise-refusee'));
    expect(collecteEcriteAvec('statut', 'realisee_sans_collecte')).toBe(true);
  });

  it('« Retour au départ » (echouee) avant acceptation → rejetee_par_prestataire', async () => {
    mockState.details.set(
      'EVR-MS',
      detail('echouee', { status: 'Retour au départ' }),
    );
    await POST(notification('retour-au-depart'));
    expect(collecteEcriteAvec('statut', 'rejetee_par_prestataire')).toBe(true);
  });

  it('échec d’une course après acceptation, les autres réussies → tournée annulee + alerte « partiellement servie »', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'en_cours',
      statut_tms: 'acceptee',
      nb_camions_demande: 2,
    };
    rpcResultats['fn_agreger_terminal_collecte'] = 'realisee';
    mockState.details.set(
      'EVR-MS',
      detail('echouee', { status: 'Retour au départ' }),
    );
    await POST(notification('retour-au-depart'));
    expect(updatedRows['tournees'] ?? []).toContainEqual({ statut: 'annulee' });
    expect(alertePosee('collecte_partiellement_servie')).toBe(true);
    expect(collecteEcriteAvec('statut', 'rejetee_par_prestataire')).toBe(false);
  });

  it('« Annulé » (annulee) sans trace d’annulation Savr → annulation externe avant acceptation = rejet', async () => {
    mockState.details.set('EVR-MS', detail('annulee', { status: 'Annulé' }));
    await POST(notification('annule'));
    expect(missionEcriteAvec('cancelled_externally')).toBe(true);
    expect(collecteEcriteAvec('statut', 'rejetee_par_prestataire')).toBe(true);
  });

  it('relecture de la course en échec → 500, alerte in-app, inbox NON traitée, rien décidé', async () => {
    _setEverestHandlers(null);
    mockState = setupEverestMock({ getMissionFails: true });
    const resp = await POST(notification('livraison-terminee'));
    expect(resp.status).toBe(500);
    expect(alerteNonEnregistre('col-ms')).toBeDefined();
    expect(inboxMarqueeTraitee()).toBe(false);
    expect(updatedRows['collectes'] ?? []).toEqual([]);
    expect(updatedRows['tournees'] ?? []).toEqual([]);
  });

  it('une seule relecture de la mission par notification, quel que soit le traitement choisi', async () => {
    const handlers = _getEverestHandlers()!;
    let relectures = 0;
    _setEverestHandlers({
      ...handlers,
      getMission: async (id) => {
        relectures += 1;
        return handlers.getMission(id);
      },
    });
    const cas: Array<[EverestMissionDetail['etape'], string]> = [
      ['affectee', 'mission-acceptee'],
      ['enlevee', 'mission-en-cours-de-livraison'],
      ['reussie', 'livraison-terminee'],
      ['echouee', 'retour-au-depart'],
      [null, 'livreur-present-arrivee'],
    ];
    for (const [etape, slug] of cas) {
      relectures = 0;
      missionLive = null;
      collecteLive = null;
      mockState.details.set(
        'EVR-MS',
        detail(etape, { coursier_nom: 'Coursier API' }),
      );
      await POST(notification(slug));
      expect(relectures, slug).toBe(1);
    }
  });

  it('coursier relu à chaque étape (ici « Livreur présent (départ) ») → écrit sur la tournée, jamais celui du payload', async () => {
    mockState.details.set(
      'EVR-MS',
      detail('enlevee', {
        coursier_nom: 'Gladstone Emane',
        coursier_telephone: '+33700000002',
      }),
    );
    await POST(notification('commande-pas-prete-attente'));
    expect(updatedRows['tournees'] ?? []).toContainEqual({
      chauffeur_nom: 'Gladstone Emane',
      chauffeur_telephone: '+33700000002',
    });
  });

  it('coursier : collecte annulée côté Savr → rien d’écrit sur la tournée', async () => {
    mockCollecteRow = {
      type: 'anti_gaspi',
      statut: 'annulee',
      statut_tms: 'attribuee_en_attente_acceptation',
      nb_camions_demande: 1,
    };
    mockState.details.set(
      'EVR-MS',
      detail(null, { coursier_nom: 'Gladstone Emane' }),
    );
    await POST(notification('livreur-present-arrivee'));
    expect(updatedRows['tournees'] ?? []).toEqual([]);
  });

  describe('collecte à deux vélos (Val 2026-11-03 : acceptée quand tous les vélos sont affectés)', () => {
    beforeEach(() => {
      mockCollecteRow = {
        type: 'anti_gaspi',
        statut: 'programmee',
        statut_tms: 'attribuee_en_attente_acceptation',
        nb_camions_demande: 2,
      };
      mockRefsTourneesCollecte = ['EVR-MS', 'EVR-AUTRE'];
    });

    it('l’autre course n’a pas de coursier → collecte NON acceptée', async () => {
      mockAutresMissions = [
        { everest_mission_id: 'EVR-AUTRE', statut_everest: 'created' },
      ];
      mockState.details.set('EVR-MS', detail('affectee'));
      await POST(notification('mission-acceptee'));
      expect(missionEcriteAvec('assigned')).toBe(true);
      expect(collecteEcriteAvec('statut_tms', 'acceptee')).toBe(false);
    });

    it('l’autre course est déjà affectée → collecte acceptee', async () => {
      mockAutresMissions = [
        { everest_mission_id: 'EVR-AUTRE', statut_everest: 'assigned' },
      ];
      mockState.details.set('EVR-MS', detail('affectee'));
      await POST(notification('mission-acceptee'));
      expect(collecteEcriteAvec('statut_tms', 'acceptee')).toBe(true);
    });

    it('tournée sans référence de course (pas encore créée chez A Toutes!) → pas acceptée', async () => {
      mockRefsTourneesCollecte = ['EVR-MS', null];
      mockState.details.set('EVR-MS', detail('affectee'));
      await POST(notification('mission-acceptee'));
      expect(collecteEcriteAvec('statut_tms', 'acceptee')).toBe(false);
    });

    it('lecture des courses de la collecte en échec → 500, jamais « acceptee » par défaut', async () => {
      // Seule la lecture de liste échoue : la garde « mission courante » passe.
      readErrorsListe['collecte_tournees'] = { message: 'lecture refusée' };
      mockState.details.set('EVR-MS', detail('affectee'));
      const resp = await POST(notification('mission-acceptee'));
      expect(resp.status).toBe(500);
      expect(collecteEcriteAvec('statut_tms', 'acceptee')).toBe(false);
      expect(alerteNonEnregistre('col-ms')).toBeDefined();
    });

    it('vélo A enlevé (collecte en_cours, pas encore acceptée), vélo B échoue sans coursier → incident : tournée B annulee + agrégation, jamais de rejet', async () => {
      mockCollecteRow = {
        type: 'anti_gaspi',
        statut: 'en_cours',
        statut_tms: 'attribuee_en_attente_acceptation',
        nb_camions_demande: 2,
      };
      // L'autre course n'a pas de coursier : seul le statut en_cours décide.
      mockAutresMissions = [
        { everest_mission_id: 'EVR-AUTRE', statut_everest: 'created' },
      ];
      mockState.details.set(
        'EVR-MS',
        detail('echouee', { status: 'Retour au départ' }),
      );
      await POST(notification('retour-au-depart'));
      expect(updatedRows['tournees'] ?? []).toContainEqual({
        statut: 'annulee',
      });
      expect(
        rpcCalls.some((c) => c.name === 'fn_agreger_terminal_collecte'),
      ).toBe(true);
      expect(collecteEcriteAvec('statut', 'rejetee_par_prestataire')).toBe(
        false,
      );
    });

    it('vélo A livré (collecte encore programmee), vélo B annulé hors Savr sans coursier → incident, pas de rejet de toute la collecte (Val 2026-11-03)', async () => {
      mockAutresMissions = [
        { everest_mission_id: 'EVR-AUTRE', statut_everest: 'completed' },
      ];
      mockState.details.set('EVR-MS', detail('annulee', { status: 'Annulé' }));
      await POST(notification('annule'));
      expect(updatedRows['tournees'] ?? []).toContainEqual({
        statut: 'annulee',
      });
      expect(collecteEcriteAvec('statut', 'rejetee_par_prestataire')).toBe(
        false,
      );
      expect(missionEcriteAvec('cancelled_externally')).toBe(true);
    });

    it('aucune course de la collecte n’a de coursier, une échoue → refus : collecte rejetee_par_prestataire', async () => {
      mockAutresMissions = [
        { everest_mission_id: 'EVR-AUTRE', statut_everest: 'created' },
      ];
      mockState.details.set(
        'EVR-MS',
        detail('echouee', { status: 'Retour au départ' }),
      );
      await POST(notification('retour-au-depart'));
      expect(collecteEcriteAvec('statut', 'rejetee_par_prestataire')).toBe(
        true,
      );
    });
  });
});

/**
 * M1.2 — Édition des champs ÉVÉNEMENT + COLLECTE par TOUS les rôles programmateurs.
 * Décision produit Val 2026-06-26 (§06.04 l.444, §05 §4, §09).
 * Couvre : PATCH événement unifié (manager/commercial/agence/gestionnaire),
 * champs verrouillés (lieu_id), fenêtre f_collecte_editable, périmètre d'écriture
 * (commercial=créateur, cloisonnement org), édition collecte gestionnaire (route
 * ajoutée), refus champs système.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const next = (): Result => queue.shift() ?? { data: null, error: null };

  const chain: Record<string, unknown> = {
    __queue: queue,
    __calls: calls,
    push(r: Result) {
      queue.push(r);
      return chain;
    },
  };
  for (const m of [
    'from',
    'select',
    'eq',
    'in',
    'gte',
    'lte',
    'neq',
    'order',
    'update',
    'insert',
  ]) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(next());
  chain.single = () => Promise.resolve(next());
  chain.rpc = (...args: unknown[]) => {
    record('rpc', args);
    return Promise.resolve(next());
  };
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & {
    push(r: Result): unknown;
    __calls: Record<string, unknown[][]>;
  };
}

let rls = makeChain();
let admin = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (rls.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string, organisationId = 'org-1', userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({
          user_role: role,
          organisation_id: organisationId,
        }),
      },
    },
    error: null,
  });
}
function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
  admin = makeChain();
});

// Queue le chemin nominal d'un PATCH événement réussi.
function queueEventOk(
  evt: { organisation_id?: string; created_by?: string },
  editable = true,
) {
  rls.push({
    data: { id: 'e1', organisation_id: 'org-1', created_by: 'user-1', ...evt },
    error: null,
  }); // maybeSingle event
  rls.push({ data: editable, error: null }); // rpc f_collecte_editable
  admin.push({ data: { id: 'e1' }, error: null }); // before select
  admin.push({ data: { id: 'e1', pax: 300 }, error: null }); // rpc fn_modifier_evenement
  admin.push({ data: null, error: null }); // audit insert
}

async function patchEvent(body: unknown) {
  const { PATCH } =
    await import('@/app/api/v1/programmation/evenements/[id]/route.js');
  return PATCH(makeReq('PATCH', '/api/v1/programmation/evenements/e1', body), {
    params: Promise.resolve({ id: 'e1' }),
  });
}

// ── Édition ÉVÉNEMENT : les 4 rôles programmateurs ──────────────────────────
describe('M1.2 / édition événement — 4 rôles programmateurs', () => {
  const ROLES: Array<
    [string, { organisation_id?: string; created_by?: string }]
  > = [
    ['traiteur_manager', { organisation_id: 'org-1' }],
    ['traiteur_commercial', { created_by: 'user-1', organisation_id: 'org-1' }],
    ['agence', { organisation_id: 'org-1' }],
    ['gestionnaire_lieux', { organisation_id: 'org-1' }],
  ];

  for (const [role, evt] of ROLES) {
    it(`M1.2 — édition événement par ${role} : 200 + fn_modifier_evenement (E2 par collecte)`, async () => {
      setupAuth(role, 'org-1', 'user-1');
      queueEventOk(evt);
      const res = await patchEvent({
        contact_principal_nom: 'Bob',
        contact_principal_telephone: '+33611111111',
        pax: 300,
      });
      expect(res.status).toBe(200);
      const rpcCalls = admin.__calls.rpc ?? [];
      const call = rpcCalls.find(([fn]) => fn === 'fn_modifier_evenement');
      expect(call).toBeTruthy();
      const args = call![1] as { p_champs_modifies: string[] };
      expect(args.p_champs_modifies).toContain('pax');
      expect(args.p_champs_modifies).toContain('contact_principal_nom');
    });
  }
});

describe('M1.2 / édition événement — gardes', () => {
  it('M1.2 — édition événement champ verrouillé lieu_id → 422', async () => {
    setupAuth('traiteur_manager');
    const res = await patchEvent({ lieu_id: 'autre-lieu' });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { champs_verrouilles?: string[] };
    expect(json.champs_verrouilles).toContain('lieu_id');
  });

  it('M1.2 — édition événement hors fenêtre (f_collecte_editable=false) → 422', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueEventOk({ organisation_id: 'org-1' }, false);
    const res = await patchEvent({ pax: 250 });
    expect(res.status).toBe(422);
  });

  it('M1.2 — édition événement commercial non-créateur → 403', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'paul');
    rls.push({
      data: { id: 'e1', organisation_id: 'org-1', created_by: 'marie' },
      error: null,
    });
    const res = await patchEvent({ pax: 250 });
    expect(res.status).toBe(403);
  });

  it('M1.2 — édition événement cloisonnement cross-org (autre org) → 403', async () => {
    setupAuth('agence', 'org-1', 'user-1');
    rls.push({
      data: { id: 'e1', organisation_id: 'org-AUTRE', created_by: 'x' },
      error: null,
    });
    const res = await patchEvent({ pax: 250 });
    expect(res.status).toBe(403);
  });

  it('M1.2 — édition événement aucun champ modifiable → 422', async () => {
    setupAuth('traiteur_manager');
    const res = await patchEvent({ statut: 'cloturee', co2_net_kg: 5 });
    expect(res.status).toBe(422);
  });
});

// ── Édition COLLECTE gestionnaire (route ajoutée) ────────────────────────────
async function patchGestionnaireCollecte(body: unknown) {
  const { PATCH } =
    await import('@/app/api/v1/gestionnaire/collectes/[id]/route.js');
  return PATCH(makeReq('PATCH', '/api/v1/gestionnaire/collectes/c1', body), {
    params: Promise.resolve({ id: 'c1' }),
  });
}

describe('M1.2 / édition collecte gestionnaire', () => {
  it('M1.2 — édition collecte gestionnaire : 200 + fn_modifier_collecte', async () => {
    setupAuth('gestionnaire_lieux', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c1',
        statut: 'validee',
        statut_tms: 'acceptee',
        date_collecte: '2030-12-31',
        heure_collecte: '10:00:00',
        evenement: { organisation_id: 'org-1' },
      },
      error: null,
    });
    admin.push({ data: { id: 'c1' }, error: null }); // before
    admin.push({ data: { id: 'c1' }, error: null }); // rpc fn_modifier_collecte
    admin.push({ data: null, error: null }); // (reacceptation update — date non modifiée ici, pas appelé) / audit
    admin.push({ data: null, error: null }); // audit insert
    const res = await patchGestionnaireCollecte({
      informations_supplementaires: 'Accès par la cour',
    });
    expect(res.status).toBe(200);
    const rpcCalls = admin.__calls.rpc ?? [];
    expect(rpcCalls.some(([fn]) => fn === 'fn_modifier_collecte')).toBe(true);
    // Audit_log écrit (§05 l.330) — assertion explicite (pas de mock complaisant).
    const fromCalls = admin.__calls.from ?? [];
    expect(fromCalls.some(([t]) => t === 'audit_log')).toBe(true);
  });

  it('M1.2 — édition collecte gestionnaire réacceptation prestataire (date + statut_tms=acceptee)', async () => {
    setupAuth('gestionnaire_lieux', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c1',
        statut: 'validee',
        statut_tms: 'acceptee',
        date_collecte: '2030-12-31',
        heure_collecte: '10:00:00',
        evenement: { organisation_id: 'org-1' },
      },
      error: null,
    });
    admin.push({ data: { id: 'c1' }, error: null }); // before
    admin.push({ data: { id: 'c1' }, error: null }); // rpc fn_modifier_collecte
    admin.push({ data: null, error: null }); // update statut_tms (réacceptation)
    admin.push({ data: null, error: null }); // audit insert
    const res = await patchGestionnaireCollecte({
      date_collecte: '2031-01-15',
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      flags: { reacceptation_requise: boolean };
    };
    expect(json.flags.reacceptation_requise).toBe(true);
    // fn_modifier_collecte reçoit statut='programmee' (la collecte n'est plus acceptée).
    const rpcCalls = admin.__calls.rpc ?? [];
    const modif = rpcCalls.find(([fn]) => fn === 'fn_modifier_collecte');
    expect(
      (modif![1] as { p_updates: { statut?: string } }).p_updates.statut,
    ).toBe('programmee');
    // statut_tms repassé en attente d'acceptation.
    const updateCalls = admin.__calls.update ?? [];
    expect(
      updateCalls.some(
        ([u]) =>
          (u as { statut_tms?: string }).statut_tms ===
          'attribuee_en_attente_acceptation',
      ),
    ).toBe(true);
  });

  it('M1.2 — édition collecte gestionnaire champ verrouillé lieu_id → 422', async () => {
    setupAuth('gestionnaire_lieux');
    const res = await patchGestionnaireCollecte({ lieu_id: 'autre' });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { champs_verrouilles?: string[] };
    expect(json.champs_verrouilles).toContain('lieu_id');
  });

  it('M1.2 — édition collecte gestionnaire cloisonnement cross-org → 403', async () => {
    setupAuth('gestionnaire_lieux', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        date_collecte: '2030-12-31',
        heure_collecte: '10:00:00',
        evenement: { organisation_id: 'org-AUTRE' },
      },
      error: null,
    });
    const res = await patchGestionnaireCollecte({ notes_internes: 'x' });
    expect(res.status).toBe(403);
  });

  it('M1.2 — édition collecte gestionnaire hors fenêtre (en_cours) → 422', async () => {
    setupAuth('gestionnaire_lieux', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c1',
        statut: 'en_cours',
        statut_tms: 'acceptee',
        date_collecte: '2030-12-31',
        heure_collecte: '10:00:00',
        evenement: { organisation_id: 'org-1' },
      },
      error: null,
    });
    const res = await patchGestionnaireCollecte({ notes_internes: 'x' });
    expect(res.status).toBe(422);
  });
});

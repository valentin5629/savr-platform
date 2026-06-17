/**
 * M3.1 — Tests Vitest API : Espace client traiteur.
 * Couvre : édition collecte (gate statut, champs verrouillés, push E2, autorisation),
 * annulation directe/demandée, invitation collaborateur, renouvellement pack,
 * badge "en attente de facturation" (F3), factures lecture seule, benchmark
 * traiteur_ids rejeté côté serveur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock thenable chain (résout une file de résultats) ──────────────────────
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
    'ilike',
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
  // thenable : `await chain` résout le prochain résultat de la file
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
const mockSendEmail = vi.fn().mockResolvedValue(undefined);

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
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

// ── Badge "en attente de facturation" (F3) ──────────────────────────────────
describe('M3.1 / marge-attente-facturation', () => {
  it('M3.1/marge_badge_attente_facturation_partielle — 2 sur 5 sans facture emise', async () => {
    setupAuth('traiteur_manager');
    rls.push({
      data: [
        { id: 'c1', factures_collectes: [{ factures: { statut: 'emise' } }] },
        { id: 'c2', factures_collectes: [{ factures: { statut: 'emise' } }] },
        { id: 'c3', factures_collectes: [{ factures: { statut: 'payee' } }] },
        { id: 'c4', factures_collectes: [] },
        {
          id: 'c5',
          factures_collectes: [{ factures: { statut: 'brouillon' } }],
        },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/traiteur/marge-attente-facturation/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/traiteur/marge-attente-facturation'),
    );
    const json = (await res.json()) as { data: { nb_en_attente: number } };
    expect(json.data.nb_en_attente).toBe(2);
  });

  it('M3.1/marge_badge_zero_quand_tout_facture — badge masqué', async () => {
    setupAuth('traiteur_manager');
    rls.push({
      data: [
        { id: 'c1', factures_collectes: [{ factures: { statut: 'emise' } }] },
        { id: 'c2', factures_collectes: [{ factures: { statut: 'payee' } }] },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/traiteur/marge-attente-facturation/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/traiteur/marge-attente-facturation'),
    );
    const json = (await res.json()) as { data: { nb_en_attente: number } };
    expect(json.data.nb_en_attente).toBe(0);
  });
});

// ── Liste collectes ─────────────────────────────────────────────────────────
describe('M3.1 / collectes liste', () => {
  it('M3.1/liste_collectes_filtre_type_et_tiers — eq type + flag programmee_par_tiers', async () => {
    setupAuth('traiteur_commercial', 'org-kaspia');
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'zero_dechet',
          statut: 'cloturee',
          evenements: {
            organisation_id: 'org-wpm',
            traiteur_operationnel_organisation_id: 'org-kaspia',
          },
        },
      ],
      error: null,
    });
    const { GET } = await import('@/app/api/v1/traiteur/collectes/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/traiteur/collectes?type=zero_dechet'),
    );
    const json = (await res.json()) as {
      data: Array<{ programmee_par_tiers: boolean }>;
    };
    expect(json.data[0]?.programmee_par_tiers).toBe(true);
    const eqCalls = rls.__calls.eq ?? [];
    expect(
      eqCalls.some(([col, val]) => col === 'type' && val === 'zero_dechet'),
    ).toBe(true);
  });
});

// ── Édition collecte ────────────────────────────────────────────────────────
describe('M3.1 / édition collecte', () => {
  it('M3.1/champs_verrouilles_type_lieu_traiteur — 422 sur type/lieu_id', async () => {
    setupAuth('traiteur_commercial');
    const { PATCH } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/collectes/c1', { lieu_id: 'autre' }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { champs_verrouilles: string[] };
    expect(json.champs_verrouilles).toContain('lieu_id');
  });

  it('M3.1/edition_refusee_statut_en_cours — 422 hors programmee/validee', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c1',
        statut: 'en_cours',
        statut_tms: 'acceptee',
        date_collecte: '2030-01-01',
        heure_collecte: '10:00:00',
        evenement: { created_by: 'user-1', organisation_id: 'org-1' },
      },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/collectes/c1', {
        notes_internes: 'x',
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(422);
  });

  it('M3.1/edition_champ_non_impactant_push_silencieux — 200 + fn_modifier_collecte (E2)', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c1',
        statut: 'validee',
        statut_tms: 'acceptee',
        date_collecte: '2030-12-31',
        heure_collecte: '10:00:00',
        evenement: { created_by: 'user-1', organisation_id: 'org-1' },
      },
      error: null,
    });
    admin.push({ data: { id: 'c1' }, error: null }); // before select
    admin.push({ data: { id: 'c1', notes_internes: 'x' }, error: null }); // rpc fn_modifier
    admin.push({ data: null, error: null }); // audit insert
    const { PATCH } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/collectes/c1', {
        notes_internes: 'x',
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(200);
    const rpcCalls = admin.__calls.rpc ?? [];
    expect(rpcCalls.some(([fn]) => fn === 'fn_modifier_collecte')).toBe(true);
    const json = (await res.json()) as { flags: { priorite_urgence: boolean } };
    expect(json.flags.priorite_urgence).toBe(false);
  });

  it('M3.1/edition_commercial_autre_collecte_deny — 403 si pas créateur', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'paul');
    rls.push({
      data: {
        id: 'c1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        date_collecte: '2030-12-31',
        heure_collecte: '10:00:00',
        evenement: { created_by: 'marie', organisation_id: 'org-1' },
      },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/collectes/c1', {
        notes_internes: 'x',
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(403);
  });
});

// ── Annulation ──────────────────────────────────────────────────────────────
describe('M3.1 / annulation', () => {
  it('M3.1/annulation_directe_collecte_programmee — statut annulee', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c1',
        statut: 'programmee',
        statut_tms: 'attribuee_en_attente_acceptation',
        date_collecte: '2030-12-31',
        tms_reference: 'TMS-1',
        evenement: {
          created_by: 'user-1',
          organisation_id: 'org-1',
          nom_evenement: 'Gala',
          organisation: { nom: 'Kaspia' },
        },
      },
      error: null,
    });
    admin.push({ data: null, error: null }); // rpc fn_modifier (statut annulee)
    const { POST } =
      await import('@/app/api/v1/traiteur/collectes/[id]/annulation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/collectes/c1/annulation', {
        motif: '',
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    const json = (await res.json()) as { data: { statut: string } };
    expect(json.data.statut).toBe('annulee');
    expect(mockSendEmail).toHaveBeenCalled();
  });

  it('M3.1/demande_annulation_collecte_validee — statut annulation_demandee', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c2',
        statut: 'validee',
        statut_tms: 'acceptee',
        date_collecte: '2030-12-31',
        tms_reference: 'TMS-2',
        evenement: {
          created_by: 'user-9',
          organisation_id: 'org-1',
          nom_evenement: 'Gala',
          organisation: { nom: 'Kaspia' },
        },
      },
      error: null,
    });
    admin.push({ data: null, error: null });
    const { POST } =
      await import('@/app/api/v1/traiteur/collectes/[id]/annulation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/collectes/c2/annulation', {
        motif: 'doublon',
      }),
      { params: Promise.resolve({ id: 'c2' }) },
    );
    const json = (await res.json()) as { data: { statut: string } };
    expect(json.data.statut).toBe('annulation_demandee');
  });

  it('M3.1/annulation_depuis_cloturee_impossible — 422', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c3',
        statut: 'cloturee',
        statut_tms: 'cloturee',
        date_collecte: '2030-12-31',
        tms_reference: 'TMS-3',
        evenement: {
          created_by: 'user-1',
          organisation_id: 'org-1',
          nom_evenement: 'Gala',
          organisation: { nom: 'Kaspia' },
        },
      },
      error: null,
    });
    const { POST } =
      await import('@/app/api/v1/traiteur/collectes/[id]/annulation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/collectes/c3/annulation', {}),
      { params: Promise.resolve({ id: 'c3' }) },
    );
    expect(res.status).toBe(422);
  });
});

// ── Invitation collaborateur ────────────────────────────────────────────────
describe('M3.1 / invitation collaborateur', () => {
  it('M3.1/invitation_collaborateur_flux_complet — 201 email envoyé', async () => {
    setupAuth('traiteur_manager', 'org-kaspia');
    admin.push({ data: null, error: null }); // users lookup → pas de doublon
    admin.push({ data: { nom: 'Kaspia' }, error: null }); // org
    const { POST } =
      await import('@/app/api/v1/traiteur/equipe/invitation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/equipe/invitation', {
        email: 'jeanne@exemple-perso.fr',
        prenom: 'Jeanne',
      }),
    );
    expect(res.status).toBe(201);
    expect(mockSendEmail).toHaveBeenCalledWith(
      'invitation_utilisateur',
      'jeanne@exemple-perso.fr',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('M3.1/invitation_email_deja_membre_refusee — 409', async () => {
    setupAuth('traiteur_manager', 'org-kaspia');
    admin.push({ data: { id: 'u-existant' }, error: null }); // doublon
    const { POST } =
      await import('@/app/api/v1/traiteur/equipe/invitation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/equipe/invitation', {
        email: 'paul@kaspia.fr',
      }),
    );
    expect(res.status).toBe(409);
  });

  it('M3.1/invitation_commercial_interdite — 403 (manager only)', async () => {
    setupAuth('traiteur_commercial', 'org-kaspia');
    const { POST } =
      await import('@/app/api/v1/traiteur/equipe/invitation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/equipe/invitation', {
        email: 'x@y.fr',
      }),
    );
    expect(res.status).toBe(403);
  });
});

// ── Renouvellement pack ─────────────────────────────────────────────────────
describe('M3.1 / renouvellement pack', () => {
  it('M3.1/demande_renouvellement_pack — 201 email admin', async () => {
    setupAuth('traiteur_commercial', 'org-kaspia');
    admin.push({ data: { nom: 'Kaspia' }, error: null });
    const { POST } =
      await import('@/app/api/v1/traiteur/pack-ag/renouvellement/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/pack-ag/renouvellement', {
        pack_souhaite: 'Pack 20',
      }),
    );
    expect(res.status).toBe(201);
    expect(mockSendEmail).toHaveBeenCalledWith(
      'admin_demande_renouvellement_pack',
      expect.any(String),
      expect.any(Object),
    );
  });
});

// ── Benchmark : filtre traiteur_ids rejeté côté serveur ─────────────────────
describe('M3.1 / benchmark garde traiteur_ids', () => {
  it('M3.1/benchmark_filtre_traiteur_ids_rejete_cote_serveur — 403 rôle traiteur', async () => {
    setupAuth('traiteur_manager', 'org-kaspia');
    const { GET } = await import('@/app/api/v1/dashboards/benchmark/route.js');
    const res = await GET(
      makeReq(
        'GET',
        '/api/v1/dashboards/benchmark?bracket=M&traiteur_ids=org-x',
      ),
    );
    expect(res.status).toBe(403);
  });
});

// ── Factures lecture seule ──────────────────────────────────────────────────
describe('M3.1 / factures lecture seule', () => {
  it('M3.1/factures_commercial_lecture_seule — exclut brouillon', async () => {
    setupAuth('traiteur_commercial', 'org-kaspia');
    rls.push({ data: [{ id: 'f1', statut: 'emise' }], error: null });
    const { GET } = await import('@/app/api/v1/traiteur/factures/route.js');
    const res = await GET(makeReq('GET', '/api/v1/traiteur/factures'));
    expect(res.status).toBe(200);
    const neqCalls = rls.__calls.neq ?? [];
    expect(
      neqCalls.some(([col, val]) => col === 'statut' && val === 'brouillon'),
    ).toBe(true);
  });
});

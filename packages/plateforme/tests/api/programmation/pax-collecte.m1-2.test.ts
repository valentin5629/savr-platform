/**
 * Pax porté par la collecte (décision Val 2026-10-20) — routes de création et
 * de modification. Mocks repris de heure-collecte-format.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';

const mockRpc = vi.fn();
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
  rpc: mockRpc,
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));

vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/tarif-zd.js', () => ({
  calculer_tarif_zd: vi
    .fn()
    .mockResolvedValue({ montant_ht: 120, montant_brut_ht: 120 }),
  TarifZdError: class extends Error {},
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) =>
      (mockSupabaseChain.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) =>
      (mockSupabaseChain.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(
  role: string,
  organisationId = 'org-traiteur-1',
  userId = 'user-1',
): void {
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

function resetChain(): void {
  vi.clearAllMocks();
  for (const m of [
    'from',
    'select',
    'insert',
    'update',
    'delete',
    'in',
    'eq',
    'is',
    'limit',
  ] as const) {
    mockSupabaseChain[m].mockReturnThis();
  }
}

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

// Pax porté par la collecte (décision Val 2026-10-20) : il se saisit avec la date
// de chaque collecte (étape 3), se modifie sur la collecte, et n'est plus un
// champ de l'événement. Chaque refus vérifie le 422 ET l'absence d'écriture.

async function refusPax(res: NextResponse): Promise<void> {
  expect(res.status).toBe(422);
  const body = (await res.json()) as { champs_invalides?: string[] };
  expect(body.champs_invalides).toEqual(['pax']);
  expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
}

const INVALIDES: unknown[] = [0, -3, 12.5, 100_001, '80', null, undefined];

const CORPS_PROGRAMMATION = {
  type_evenement_id: 'type-1',
  lieu_id: 'lieu-1',
  contact_principal_nom: 'Jean Martin',
  contact_principal_telephone: '0612345678',
  nom_evenement: 'Gala 2030',
  nom_client_organisateur: 'Traiteur Dupont',
  controle_acces_requis: false,
  confirmer: true,
};

describe('M1.2/pax_par_collecte — création', () => {
  beforeEach(resetChain);

  for (const pax of INVALIDES) {
    it(`POST /programmation/evenements : refuse un pax de collecte ${JSON.stringify(pax)} en 422`, async () => {
      setupAuth('traiteur_commercial');
      const { POST } =
        await import('@/app/api/v1/programmation/evenements/route.js');
      const res = await POST(
        makeReq('POST', '/api/v1/programmation/evenements', {
          ...CORPS_PROGRAMMATION,
          collectes: [
            {
              type: 'zd',
              date_collecte: '2030-01-15',
              heure_collecte: '22:00',
              ...(pax === undefined ? {} : { pax }),
            },
          ],
        }),
      );
      await refusPax(res);
    });

    it(`POST /programmation/evenements/[id]/collectes : refuse ${JSON.stringify(pax)} en 422`, async () => {
      setupAuth('traiteur_manager');
      const { POST } =
        await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
      const res = await POST(
        makeReq('POST', '/api/v1/programmation/evenements/evt-1/collectes', {
          type: 'zd',
          date_collecte: '2030-01-15',
          heure_collecte: '22:00',
          ...(pax === undefined ? {} : { pax }),
        }),
        { params: Promise.resolve({ id: 'evt-1' }) },
      );
      await refusPax(res);
    });
  }

  it('POST /programmation/evenements : chaque collecte part avec son pax ; l’événement est créé à 0, calculé ensuite par la base', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'entite-1' },
      error: null,
    });
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-1', nom_evenement: 'Gala 2030' },
      error: null,
    });
    mockRpc
      .mockResolvedValueOnce({ data: 'col-zd-1', error: null })
      .mockResolvedValueOnce({ data: 'col-ag-1', error: null });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', {
        ...CORPS_PROGRAMMATION,
        collectes: [
          {
            type: 'zd',
            date_collecte: '2030-01-15',
            heure_collecte: '22:00',
            pax: 1800,
          },
          {
            type: 'ag',
            date_collecte: '2030-01-16',
            heure_collecte: '22:00',
            pax: 1200,
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    // Pax de l'événement provisoire (0) : le déclencheur le calcule depuis les
    // collectes (règle du jour, prouvée par supabase/tests/collectes_pax.test.sql).
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ pax: 0 }),
    );
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_creer_collecte',
      expect.objectContaining({ p_type: 'zd', p_pax: 1800 }),
    );
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_creer_collecte',
      expect.objectContaining({ p_type: 'ag', p_pax: 1200 }),
    );
  });

  it('POST /programmation/evenements (brouillon) : chaque collecte est écrite avec son pax', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'entite-1' },
      error: null,
    });
    mockSingle
      .mockResolvedValueOnce({
        data: { id: 'evt-2', nom_evenement: null },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: 'brouillon-1' }, error: null });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', {
        ...CORPS_PROGRAMMATION,
        confirmer: false,
        collectes: [
          {
            type: 'zd',
            date_collecte: '2030-01-15',
            heure_collecte: '22:00',
            pax: 650,
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ statut: 'brouillon', pax: 650 }),
    );
  });

  it('POST /programmation/evenements/[id]/collectes : la collecte ajoutée part avec son pax', async () => {
    setupAuth('traiteur_commercial', 'org-traiteur-1');
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-1', organisation_id: 'org-traiteur-1' },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: 'new-collecte-1', error: null }); // fn_creer_collecte

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements/evt-1/collectes', {
        type: 'zd',
        date_collecte: '2030-02-01',
        heure_collecte: '10:00',
        pax: 420,
      }),
      { params: Promise.resolve({ id: 'evt-1' }) },
    );
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_creer_collecte',
      expect.objectContaining({ p_pax: 420 }),
    );
  });
});

describe('M1.2/pax_par_collecte — modification', () => {
  beforeEach(resetChain);

  it('PATCH /programmation/evenements/[id] : le pax est refusé (il se modifie sur la collecte)', async () => {
    setupAuth('traiteur_manager');
    const { PATCH } =
      await import('@/app/api/v1/programmation/evenements/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/programmation/evenements/evt-1', { pax: 500 }),
      { params: Promise.resolve({ id: 'evt-1' }) },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { champs_verrouilles?: string[] };
    expect(body.champs_verrouilles).toEqual(['pax']);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('PATCH /admin/evenements/[id] : le pax est refusé, même accompagné d’un autre champ', async () => {
    setupAuth('admin_savr');
    const { PATCH } =
      await import('@/app/api/v1/admin/evenements/[id]/route.js');
    for (const corps of [
      { pax: 500 },
      { pax: 500, contact_principal_nom: 'Bob' },
    ]) {
      const res = await PATCH(
        makeReq('PATCH', '/api/v1/admin/evenements/evt-1', corps),
        { params: Promise.resolve({ id: 'evt-1' }) },
      );
      expect(res.status).toBe(422);
      const body = (await res.json()) as { champs_verrouilles?: string[] };
      expect(body.champs_verrouilles).toEqual(['pax']);
    }
    expect(mockRpc).not.toHaveBeenCalled();
  });

  const ROUTES = [
    {
      espace: 'traiteur',
      role: 'traiteur_manager',
      charger: () => import('@/app/api/v1/traiteur/collectes/[id]/route.js'),
    },
    {
      espace: 'gestionnaire',
      role: 'gestionnaire_lieux',
      charger: () =>
        import('@/app/api/v1/gestionnaire/collectes/[id]/route.js'),
    },
    {
      espace: 'agence',
      role: 'agence',
      charger: () => import('@/app/api/v1/agence/collectes/[id]/route.js'),
    },
  ] as const;

  for (const { espace, role, charger } of ROUTES) {
    for (const pax of [0, 12.5, 100_001, '80', null]) {
      it(`PATCH /${espace}/collectes/[id] : refuse un pax ${JSON.stringify(pax)} en 422`, async () => {
        setupAuth(role);
        const { PATCH } = await charger();
        const res = await PATCH(
          makeReq('PATCH', `/api/v1/${espace}/collectes/col-1`, { pax }),
          { params: Promise.resolve({ id: 'col-1' }) },
        );
        await refusPax(res);
      });
    }
  }
});

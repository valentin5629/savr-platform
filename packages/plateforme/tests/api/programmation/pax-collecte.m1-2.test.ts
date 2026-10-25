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
  mockSupabaseChain.from.mockImplementation((table: string) =>
    table === 'types_evenements' ? lectureTypesEvenements() : mockSupabaseChain,
  );
  for (const m of [
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

// Cartes du formulaire (refonte, lot B2) : chaque collecte porte aussi son type
// d'événement et ses contacts. Les corps de refus sont complets hors pax, pour
// que le 422 ne puisse venir que du pax. Le type est vérifié dans le
// référentiel en une lecture attendue sans terminal (`.in().eq('actif')`).
const TYPE_EVT = '11111111-1111-4111-8111-111111111111';
const CARTE = {
  type_evenement_id: TYPE_EVT,
  contact_principal_nom: 'Jean Martin',
  contact_principal_telephone: '0612345678',
};

interface LectureTypes {
  select: () => LectureTypes;
  in: (col: string, ids: string[]) => LectureTypes;
  eq: (col: string, valeur: unknown) => LectureTypes;
  then: (
    ok: (r: { data: { id: string }[]; error: null }) => unknown,
    ko?: (e: unknown) => unknown,
  ) => Promise<unknown>;
}

function lectureTypesEvenements(): LectureTypes {
  let lignes = [{ id: TYPE_EVT, actif: true }];
  const q: LectureTypes = {
    select: () => q,
    in: (_col, ids) => {
      lignes = lignes.filter((l) => ids.includes(l.id));
      return q;
    },
    eq: (_col, valeur) => {
      lignes = lignes.filter((l) => l.actif === valeur);
      return q;
    },
    then: (ok, ko) =>
      Promise.resolve({
        data: lignes.map(({ id }) => ({ id })),
        error: null as null,
      }).then(ok, ko),
  };
  return q;
}

/** Cartes transmises à fn_enregistrer_programmation (premier appel). */
function cartesEnregistrees(): Record<string, unknown>[] {
  const appel = mockRpc.mock.calls.find(
    ([fn]) => fn === 'fn_enregistrer_programmation',
  );
  expect(appel, 'fn_enregistrer_programmation jamais appelée').toBeDefined();
  return (appel?.[1] as { p_collectes: Record<string, unknown>[] }).p_collectes;
}

const CORPS_PROGRAMMATION = {
  lieu_id: 'lieu-1',
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
              date_collecte: '2097-01-15',
              heure_collecte: '22:00',
              ...CARTE,
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
          date_collecte: '2097-01-15',
          heure_collecte: '22:00',
          ...CARTE,
          ...(pax === undefined ? {} : { pax }),
        }),
        { params: Promise.resolve({ id: 'evt-1' }) },
      );
      await refusPax(res);
    });
  }

  it('POST /programmation/evenements : chaque carte part avec son pax ; l’événement n’en reçoit aucun, la base le calcule', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'entite-1' },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({
      data: { evenement_id: 'evt-1', collecte_ids: ['col-zd-1', 'col-ag-1'] },
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', {
        ...CORPS_PROGRAMMATION,
        collectes: [
          {
            type: 'zd',
            date_collecte: '2097-01-15',
            heure_collecte: '22:00',
            pax: 1800,
            ...CARTE,
          },
          {
            type: 'ag',
            date_collecte: '2097-01-16',
            heure_collecte: '22:00',
            pax: 1200,
            ...CARTE,
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(
      cartesEnregistrees().map(({ type, pax }) => ({ type, pax })),
    ).toEqual([
      { type: 'zd', pax: 1800 },
      { type: 'ag', pax: 1200 },
    ]);
    // Aucun pax au niveau de l'événement : fn_enregistrer_programmation le crée
    // à 0 et le déclencheur le calcule depuis les collectes (règle du jour,
    // prouvée par supabase/tests/collectes_pax.test.sql).
    const appel = mockRpc.mock.calls.find(
      ([fn]) => fn === 'fn_enregistrer_programmation',
    );
    expect(appel?.[1]).toHaveProperty('p_evenement');
    expect(appel?.[1].p_evenement).not.toHaveProperty('pax');
    // Ni INSERT direct, ni création collecte par collecte depuis la route.
    expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalledWith(
      'fn_creer_collecte',
      expect.anything(),
    );
  });

  it('POST /programmation/evenements (brouillon) : chaque collecte est écrite avec son pax', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'entite-1' },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({
      data: { evenement_id: 'evt-2', collecte_ids: ['brouillon-1'] },
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', {
        ...CORPS_PROGRAMMATION,
        confirmer: false,
        collectes: [
          {
            type: 'zd',
            date_collecte: '2097-01-15',
            heure_collecte: '22:00',
            pax: 650,
            ...CARTE,
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    // Brouillon : la même RPC, sans confirmation (fn_creer_collecte_carte écrit
    // la collecte en brouillon avec son pax).
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_enregistrer_programmation',
      expect.objectContaining({ p_confirmer: false }),
    );
    expect(cartesEnregistrees()).toEqual([
      expect.objectContaining({ type: 'zd', pax: 650 }),
    ]);
  });

  it('POST /programmation/evenements/[id]/collectes : la collecte ajoutée part avec son pax', async () => {
    setupAuth('traiteur_commercial', 'org-traiteur-1');
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-1', organisation_id: 'org-traiteur-1' },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: 'new-collecte-1', error: null }); // fn_creer_collecte_carte

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements/evt-1/collectes', {
        type: 'zd',
        date_collecte: '2097-02-01',
        heure_collecte: '10:00',
        pax: 420,
        ...CARTE,
      }),
      { params: Promise.resolve({ id: 'evt-1' }) },
    );
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_creer_collecte_carte',
      expect.objectContaining({
        p_carte: expect.objectContaining({ pax: 420 }),
      }),
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

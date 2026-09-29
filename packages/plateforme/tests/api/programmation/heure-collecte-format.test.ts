/**
 * Format d'entrée de `collectes.heure_collecte` sur les SEPT routes qui l'écrivent
 * (3 créations, 4 modifications).
 *
 * La colonne est `time NOT NULL` ; les routes ne vérifiaient que la présence du
 * champ, si bien qu'une valeur malformée (ou vide en modification) échouait au
 * cast `::time` / sur le NOT NULL et remontait en 500. Chaque cas vérifie le 422
 * ET l'absence d'écriture (aucune RPC, aucun INSERT) : « refusé » et non
 * « refusé après avoir écrit ».
 *
 * La grille de 15 min n'est PAS imposée côté serveur (contrainte de saisie du
 * TimePicker) : une heure historique hors grille (10:10) reste acceptée — la
 * contre-épreuve le prouve.
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

async function refusHeure(res: NextResponse): Promise<void> {
  expect(res.status).toBe(422);
  const body = (await res.json()) as { champs_invalides?: string[] };
  expect(body.champs_invalides).toEqual(['heure_collecte']);
  expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
}

const INVALIDES_CREATION: unknown[] = [
  'abc',
  '25:00',
  '8h',
  '08:60',
  '8:00',
  900,
];
// En modification, vider le champ est aussi un refus (colonne NOT NULL).
const INVALIDES_MODIFICATION: unknown[] = [...INVALIDES_CREATION, '', null];

describe('heure_collecte — routes de création', () => {
  beforeEach(resetChain);

  for (const heure of INVALIDES_CREATION) {
    it(`POST /programmation/evenements : refuse ${JSON.stringify(heure)} en 422`, async () => {
      setupAuth('traiteur_commercial');
      const { POST } =
        await import('@/app/api/v1/programmation/evenements/route.js');
      const res = await POST(
        makeReq('POST', '/api/v1/programmation/evenements', {
          pax: 80,
          type_evenement_id: 'type-1',
          lieu_id: 'lieu-1',
          contact_principal_nom: 'Jean Martin',
          contact_principal_telephone: '0612345678',
          nom_client_organisateur: 'Traiteur Dupont',
          controle_acces_requis: false,
          collectes: [
            { type: 'zd', date_collecte: '2030-01-15', heure_collecte: heure },
          ],
          confirmer: true,
        }),
      );
      await refusHeure(res);
    });

    it(`POST /programmation/evenements/[id]/collectes : refuse ${JSON.stringify(heure)} en 422`, async () => {
      setupAuth('traiteur_manager');
      const { POST } =
        await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
      const res = await POST(
        makeReq('POST', '/api/v1/programmation/evenements/evt-1/collectes', {
          type: 'zd',
          date_collecte: '2030-01-15',
          heure_collecte: heure,
        }),
        { params: Promise.resolve({ id: 'evt-1' }) },
      );
      await refusHeure(res);
    });

    it(`POST /admin/collectes : refuse ${JSON.stringify(heure)} en 422`, async () => {
      setupAuth('admin_savr');
      const { POST } = await import('@/app/api/v1/admin/collectes/route.js');
      const res = await POST(
        makeReq('POST', '/api/v1/admin/collectes', {
          evenement_id: 'evt-1',
          type: 'zero_dechet',
          date_collecte: '2030-01-15',
          heure_collecte: heure,
        }),
      );
      await refusHeure(res);
    });
  }
});

describe('heure_collecte — routes de modification', () => {
  beforeEach(resetChain);

  // Import explicite (et non construit) pour que le bundler de test le résolve.
  const ROUTES = [
    {
      espace: 'admin',
      role: 'admin_savr',
      charger: () => import('@/app/api/v1/admin/collectes/[id]/route.js'),
    },
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
    for (const heure of INVALIDES_MODIFICATION) {
      it(`PATCH /${espace}/collectes/[id] : refuse ${JSON.stringify(heure)} en 422`, async () => {
        setupAuth(role);
        const { PATCH } = await charger();
        const res = await PATCH(
          makeReq('PATCH', `/api/v1/${espace}/collectes/col-1`, {
            heure_collecte: heure,
          }),
          { params: Promise.resolve({ id: 'col-1' }) },
        );
        await refusHeure(res);
      });
    }
  }

  // Contre-épreuve : une heure historique HORS GRILLE passe jusqu'à la RPC.
  it('PATCH /admin/collectes/[id] : une heure hors grille de 15 min (10:10:00) est acceptée', async () => {
    setupAuth('admin_savr');
    mockSingle.mockResolvedValueOnce({
      data: { id: 'col-1', statut: 'programmee', heure_collecte: '09:00:00' },
      error: null,
    }); // `before` de l'audit
    mockRpc.mockResolvedValueOnce({
      data: { id: 'col-1', statut: 'programmee' },
      error: null,
    }); // fn_modifier_collecte

    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/collectes/col-1', {
        heure_collecte: '10:10:00',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_modifier_collecte',
      expect.objectContaining({
        p_updates: expect.objectContaining({ heure_collecte: '10:10:00' }),
      }),
    );
  });
});

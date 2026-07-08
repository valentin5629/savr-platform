/**
 * M0.6 — BL-P2-31 : Idempotence serveur des endpoints Admin Paramètres.
 * CDC §08 §9 (taux) / §9ter.6 (CO2) : `Idempotency-Key` OBLIGATOIRE sur PUT
 * (422 si absente) + dédup 24h via `integrations_logs` (« si déjà reçu dans les
 * 24h → renvoie le résultat précédent », sans ré-exécuter la mutation → aucune
 * 2ᵉ ligne d'historique).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockRpc = vi.fn();
const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
  rpc: mockRpc,
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(role: string) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

function makeReq(
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
  });
}

const TAUX =
  '@/app/api/v1/admin/parametres/taux-recyclage/[filiere_id]/route.js';
const FACTEURS = '@/app/api/v1/admin/parametres/facteurs-co2/route.js';
const MIX = '@/app/api/v1/admin/parametres/mix-emballages/route.js';
const DIVERS = '@/app/api/v1/admin/parametres/co2-divers/route.js';
const AG = '@/app/api/v1/admin/parametres/facteurs-co2-ag/route.js';
const KEY = { 'idempotency-key': 'k-typed' };

describe('M0.6 — Idempotence endpoints Admin Paramètres (BL-P2-31)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M0.6 — taux PUT sans Idempotency-Key → 422 (pas de mutation)', async () => {
    setupAuth('admin_savr');
    const { PUT } = await import(TAUX);
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/taux-recyclage/fil-1', {
        taux_captation: 0.8,
        commentaire_modif: 'Maj ADEME 2026',
      }),
      { params: Promise.resolve({ filiere_id: 'fil-1' }) },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Idempotency-Key');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('M0.6 — taux PUT 1er appel : mutation exécutée + réponse tracée pour rejeu', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({ data: null }); // pas de rejeu
    mockRpc.mockResolvedValueOnce({
      data: { id: 'fil-1', taux_captation: 0.8 },
      error: null,
    });
    const { PUT } = await import(TAUX);
    const res = await PUT(
      makeReq(
        'PUT',
        '/api/v1/admin/parametres/taux-recyclage/fil-1',
        { taux_captation: 0.8, commentaire_modif: 'Maj ADEME 2026' },
        { 'idempotency-key': 'key-abc' },
      ),
      { params: Promise.resolve({ filiere_id: 'fil-1' }) },
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    // Trace idempotence enregistrée dans integrations_logs (correlation_id = clé).
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        // Scope de dédup par filière (revue sécu R22a).
        integration: 'admin_taux_recyclage:fil-1',
        correlation_id: 'key-abc',
        direction: 'entrant',
      }),
    );
  });

  it('M0.6 — taux PUT rejoué (même clé < 24h) → résultat précédent, RPC NON ré-exécutée', async () => {
    setupAuth('admin_savr');
    // integrations_logs renvoie une réponse déjà enregistrée pour cette clé.
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: {
        statut_http: 200,
        payload_out: { id: 'fil-1', taux_captation: 0.8 },
      },
    });
    const { PUT } = await import(TAUX);
    const res = await PUT(
      makeReq(
        'PUT',
        '/api/v1/admin/parametres/taux-recyclage/fil-1',
        { taux_captation: 0.99, commentaire_modif: 'Rejoué avec autre valeur' },
        { 'idempotency-key': 'key-abc' },
      ),
      { params: Promise.resolve({ filiere_id: 'fil-1' }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { taux_captation: number };
    // La valeur rejouée = celle du 1er appel (0.8), pas le body du 2ᵉ (0.99).
    expect(body.taux_captation).toBe(0.8);
    // Aucune ré-exécution de la RPC → aucune 2ᵉ ligne d'historique.
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('M0.6 — CO2 facteurs PUT sans Idempotency-Key → 422', async () => {
    setupAuth('admin_savr');
    const { PUT } = await import(FACTEURS);
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/facteurs-co2', {
        facteurs: [{ id: 'f-1', fe_induit_kg_t: 10 }],
        commentaire_modif: 'Maj facteurs',
      }),
    );
    expect(res.status).toBe(422);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('M0.6 — CO2 mix PUT rejoué (même clé) → résultat précédent, RPC NON ré-exécutée', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: { statut_http: 200, payload_out: { data: [{ id: 'm-1' }] } },
    });
    const { PUT } = await import(MIX);
    const res = await PUT(
      makeReq(
        'PUT',
        '/api/v1/admin/parametres/mix-emballages',
        {
          mix: [{ id: 'm-1', part_pct: 100 }],
          commentaire_modif: 'Rejoué mix',
        },
        { 'idempotency-key': 'key-mix' },
      ),
    );
    expect(res.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('M0.6 — Erreurs typées endpoints CO2 (BL-P2-31, CDC §9ter.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseChain.maybeSingle.mockResolvedValue({ data: null }); // pas de rejeu
  });

  it('M0.6 — facteurs-co2 PUT FE < 0 → 422 (typé, pas 500)', async () => {
    setupAuth('admin_savr');
    const { PUT } = await import(FACTEURS);
    const res = await PUT(
      makeReq(
        'PUT',
        '/api/v1/admin/parametres/facteurs-co2',
        {
          facteurs: [{ id: 'f-1', fe_induit_kg_t: -5 }],
          commentaire_modif: 'FE négatif',
        },
        KEY,
      ),
    );
    expect(res.status).toBe(422);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('M0.6 — co2-divers PUT valeur ≤ 0 → 422 (pas d’acceptation silencieuse)', async () => {
    setupAuth('admin_savr');
    const { PUT } = await import(DIVERS);
    const res = await PUT(
      makeReq(
        'PUT',
        '/api/v1/admin/parametres/co2-divers',
        {
          divers: [{ id: 'd-1', valeur: 0 }],
          commentaire_modif: 'Valeur nulle',
        },
        KEY,
      ),
    );
    expect(res.status).toBe(422);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('M0.6 — facteurs-co2-ag PUT facteur < 0 → 422', async () => {
    setupAuth('admin_savr');
    const { PUT } = await import(AG);
    const res = await PUT(
      makeReq(
        'PUT',
        '/api/v1/admin/parametres/facteurs-co2-ag',
        {
          id: 'ag-1',
          facteur_co2_evite_par_repas_kg: -1,
          commentaire_modif: 'Facteur négatif',
        },
        KEY,
      ),
    );
    expect(res.status).toBe(422);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('M0.6 — taux PUT filière inconnue (RPC P0002) → 404 typé', async () => {
    setupAuth('admin_savr');
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'filière introuvable' },
    });
    const { PUT } = await import(TAUX);
    const res = await PUT(
      makeReq(
        'PUT',
        '/api/v1/admin/parametres/taux-recyclage/fil-x',
        { taux_captation: 0.8, commentaire_modif: 'Maj filière' },
        KEY,
      ),
      { params: Promise.resolve({ filiere_id: 'fil-x' }) },
    );
    expect(res.status).toBe(404);
  });

  it('M0.6 — facteurs-co2-ag PUT id inconnu (RPC P0002) → 404 typé', async () => {
    setupAuth('admin_savr');
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'introuvable' },
    });
    const { PUT } = await import(AG);
    const res = await PUT(
      makeReq(
        'PUT',
        '/api/v1/admin/parametres/facteurs-co2-ag',
        {
          id: 'ag-inconnu',
          facteur_co2_evite_par_repas_kg: 2.5,
          commentaire_modif: 'Maj facteur',
        },
        KEY,
      ),
    );
    expect(res.status).toBe(404);
  });
});

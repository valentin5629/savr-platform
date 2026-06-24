/**
 * M2.4 — BL-P0-06 — Routes paramètres CO₂ (4 écrans) alignées sur les VRAIES
 * colonnes + RPC SECURITY DEFINER d'audit (divergence M2.4_20260624, Option A).
 *
 * Ces tests vérouillent le contrat colonne-DB : la charge envoyée à la RPC nomme
 * les colonnes réelles (fe_induit_kg_t, fe_evite_kg_t, facteur_co2_evite_par_repas_kg,
 * cle/valeur). Un retour aux colonnes fantômes (facteur_co2_kg_par_kg / _par_repas /
 * modifie_par / co2-divers « wide ») ferait ROUGIR l'assertion de payload.
 * L'oracle « pas de 500 ET historique tracé » est le test pgTAP
 * supabase/tests/M2_4__co2_params_rpc.test.sql (triggers réels).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockRpc = vi.fn();
const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn(),
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

function setupAuth(role: string, userId = 'admin-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: [], error: null });
});

// ---------------------------------------------------------------------------
describe('M2.4 / Paramètres CO₂ / facteurs-co2', () => {
  it('M2.4 / facteurs-co2 / PUT → rpc_maj_facteurs_co2 avec colonnes réelles', async () => {
    setupAuth('admin_savr', 'admin-1');
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/facteurs-co2/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/facteurs-co2', {
        facteurs: [{ id: 'f-1', fe_induit_kg_t: 10, fe_evite_kg_t: 300 }],
        commentaire_modif: 'Maj ADEME 2026',
      }),
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'rpc_maj_facteurs_co2',
      expect.objectContaining({
        p_auteur: 'admin-1',
        p_commentaire: 'Maj ADEME 2026',
        p_facteurs: [
          expect.objectContaining({ fe_induit_kg_t: 10, fe_evite_kg_t: 300 }),
        ],
      }),
    );
    // Aucune colonne fantôme dans la charge.
    const payload = JSON.stringify(mockRpc.mock.calls[0]?.[1]);
    expect(payload).not.toContain('facteur_co2_kg_par_kg');
    expect(payload).not.toContain('modifie_par');
  });

  it('M2.4 / facteurs-co2 / PUT → 422 sans commentaire_modif', async () => {
    setupAuth('admin_savr');
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/facteurs-co2/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/facteurs-co2', {
        facteurs: [{ id: 'f-1', fe_induit_kg_t: 10 }],
      }),
    );
    expect(res.status).toBe(422);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('M2.4 / facteurs-co2 / PUT → 403 si ops_savr', async () => {
    setupAuth('ops_savr');
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/facteurs-co2/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/facteurs-co2', {
        facteurs: [{ id: 'f-1', fe_induit_kg_t: 10 }],
        commentaire_modif: 'tentative ops',
      }),
    );
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('M2.4 / facteurs-co2 / GET → 200 lecture ops', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.order.mockResolvedValueOnce({
      data: [{ id: 'f-1', code_flux: 'verre', fe_induit_kg_t: 10 }],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/parametres/facteurs-co2/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/admin/parametres/facteurs-co2'),
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('M2.4 / Paramètres CO₂ / facteurs-co2-ag', () => {
  it('M2.4 / facteurs-co2-ag / PUT → rpc_maj_facteur_co2_ag (facteur_co2_evite_par_repas_kg)', async () => {
    setupAuth('admin_savr', 'admin-1');
    mockRpc.mockResolvedValueOnce({ data: { id: 'ag-1' }, error: null });
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/facteurs-co2-ag/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/facteurs-co2-ag', {
        id: 'ag-1',
        facteur_co2_evite_par_repas_kg: 2.7,
        commentaire_modif: 'Maj facteur FAO',
      }),
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'rpc_maj_facteur_co2_ag',
      expect.objectContaining({
        p_auteur: 'admin-1',
        p_id: 'ag-1',
        p_facteur: 2.7,
        p_commentaire: 'Maj facteur FAO',
      }),
    );
    const payload = JSON.stringify(mockRpc.mock.calls[0]?.[1]);
    expect(payload).not.toContain('facteur_co2_kg_par_repas');
  });

  it('M2.4 / facteurs-co2-ag / PUT → 422 sans commentaire_modif', async () => {
    setupAuth('admin_savr');
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/facteurs-co2-ag/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/facteurs-co2-ag', {
        id: 'ag-1',
        facteur_co2_evite_par_repas_kg: 2.7,
      }),
    );
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
describe('M2.4 / Paramètres CO₂ / mix-emballages', () => {
  it('M2.4 / mix-emballages / PUT → rpc_maj_mix_emballages (part_pct)', async () => {
    setupAuth('admin_savr', 'admin-1');
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/mix-emballages/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/mix-emballages', {
        mix: [
          { id: 'm-1', part_pct: 60 },
          { id: 'm-2', part_pct: 40 },
        ],
        commentaire_modif: 'Maj mix 2026',
      }),
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'rpc_maj_mix_emballages',
      expect.objectContaining({
        p_auteur: 'admin-1',
        p_commentaire: 'Maj mix 2026',
      }),
    );
  });

  it('M2.4 / mix-emballages / PUT → 422 si somme ≠ 100', async () => {
    setupAuth('admin_savr');
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/mix-emballages/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/mix-emballages', {
        mix: [
          { id: 'm-1', part_pct: 30 },
          { id: 'm-2', part_pct: 50 },
        ],
        commentaire_modif: 'Maj mix 2026',
      }),
    );
    expect(res.status).toBe(422);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('M2.4 / mix-emballages / PUT → 422 sans commentaire_modif', async () => {
    setupAuth('admin_savr');
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/mix-emballages/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/mix-emballages', {
        mix: [{ id: 'm-1', part_pct: 100 }],
      }),
    );
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
describe('M2.4 / Paramètres CO₂ / co2-divers', () => {
  it('M2.4 / co2-divers / PUT → rpc_maj_co2_divers (key-value cle/valeur)', async () => {
    setupAuth('admin_savr', 'admin-1');
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/co2-divers/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/co2-divers', {
        divers: [{ id: 'd-1', valeur: 0.42 }],
        commentaire_modif: 'Maj forfait collecte',
      }),
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'rpc_maj_co2_divers',
      expect.objectContaining({
        p_auteur: 'admin-1',
        p_divers: [expect.objectContaining({ valeur: 0.42 })],
      }),
    );
    // Pas d'écriture « wide » (colonnes co2_kg_par_km_*) ni modifie_par.
    const payload = JSON.stringify(mockRpc.mock.calls[0]?.[1]);
    expect(payload).not.toContain('co2_kg_par_km');
    expect(payload).not.toContain('modifie_par');
  });

  it('M2.4 / co2-divers / PUT → 422 sans commentaire_modif', async () => {
    setupAuth('admin_savr');
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/co2-divers/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/co2-divers', {
        divers: [{ id: 'd-1', valeur: 0.42 }],
      }),
    );
    expect(res.status).toBe(422);
  });

  it('M2.4 / co2-divers / GET → 200 liste clé-valeur (écran §9.3 monté)', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.order.mockResolvedValueOnce({
      data: [
        {
          id: 'd-1',
          cle: 'fe_camion_benne_kg_km',
          valeur: 0.9,
          unite: 'kgCO2e/km',
        },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/parametres/co2-divers/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/admin/parametres/co2-divers'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });
});

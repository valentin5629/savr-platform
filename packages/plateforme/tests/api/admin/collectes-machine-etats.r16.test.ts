/**
 * R16a — Machine à états collecte, couche route (BL-P1-RM-02/05/09 + RM-01 cron).
 * - M1.4 : PATCH /admin/collectes gère les gardes fn_modifier_collecte (RM-02/05) ;
 *          POST /admin/collectes/[id]/incident (flux incident RM-09).
 * - M1.8 : cron cloture-embargo appelle fn_cloturer_collectes_embargo (RM-01).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));

const mockSendEmail = vi.fn().mockResolvedValue(undefined);
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
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

function setupAuth(role: string, userId = 'user-1'): void {
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
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

// ── RM-02 / RM-05 : gardes fn_modifier_collecte via PATCH /admin/collectes ────
describe('M1.4 / machine à états / gardes nb_camions (RM-02/05)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.4/RM-05 — réduction N < 1h : 409 + alerte Ops créée', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'col-1', statut: 'programmee' },
      error: null,
    });
    // 1er rpc = fn_modifier_collecte → erreur fenêtre fermée ; 2e = f_upsert_alerte_admin.
    mockSupabaseChain.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'REDUCTION_CANCEL_WINDOW_CLOSED: ...' },
      })
      .mockResolvedValueOnce({ data: null, error: null });

    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/collectes/col-1', {
        nb_camions_demande: 1,
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );

    expect(res.status).toBe(409);
    // f_upsert_alerte_admin appelée (2e rpc) avec le code d'alerte Ops.
    expect(mockSupabaseChain.rpc).toHaveBeenCalledWith(
      'f_upsert_alerte_admin',
      expect.objectContaining({ p_code: 'reduction_camions_bloquee' }),
    );
  });

  it('M1.4/RM-02 — nb_camions sur statut terminal : 409 sans alerte', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'col-1', statut: 'realisee' },
      error: null,
    });
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'NB_CAMIONS_STATUT_TERMINAL: ...' },
    });

    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/collectes/col-1', {
        nb_camions_demande: 5,
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );

    expect(res.status).toBe(409);
    // Aucune alerte Ops (seul fn_modifier_collecte appelé, pas f_upsert_alerte_admin).
    expect(mockSupabaseChain.rpc).toHaveBeenCalledTimes(1);
  });
});

// ── RM-09 : flux incident ────────────────────────────────────────────────────
describe('M1.4 / machine à états / flux incident (RM-09)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.4/RM-09 — incident prestataire : annulee + email + 200', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'col-1',
        statut: 'validee',
        type: 'anti_gaspi',
        date_collecte: '2026-07-01',
        evenements: { created_by: 'user-prog', lieux: { nom: 'Lieu X' } },
      },
      error: null,
    });
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: { id: 'col-1', statut: 'annulee' },
      error: null,
    });
    // Résolution du programmeur (evenements.created_by → users) pour la notif client.
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: { email: 'prog@savr-test.local', prenom: 'Prog' },
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/incident/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/incident', {
        incident_imputable_a: 'prestataire',
        motif_incident: 'Prestataire non présenté',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );

    expect(res.status).toBe(200);
    // fn_modifier_collecte appelée avec statut=annulee + champs incident.
    expect(mockSupabaseChain.rpc).toHaveBeenCalledWith(
      'fn_modifier_collecte',
      expect.objectContaining({
        p_updates: expect.objectContaining({
          statut: 'annulee',
          incident_imputable_a: 'prestataire',
        }),
      }),
    );
    // Alerte Admin envoyée via le template §06.02 item 10.
    expect(mockSendEmail).toHaveBeenCalledWith(
      'admin_incident_collecte',
      expect.any(String),
      expect.objectContaining({ imputable_a: 'prestataire' }),
    );
    // Notification client (§05 §4bis l.347) : programmeur informé via annulation_collecte.
    expect(mockSendEmail).toHaveBeenCalledWith(
      'annulation_collecte',
      'prog@savr-test.local',
      expect.objectContaining({
        prenom: 'Prog',
        motif: expect.stringContaining('ne vous sera pas facturé'),
      }),
    );
  });

  it('M1.4/RM-09 — motif < 10 caractères : 422', async () => {
    setupAuth('admin_savr');
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/incident/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/incident', {
        incident_imputable_a: 'prestataire',
        motif_incident: 'court',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(422);
  });

  it('M1.4/RM-09 — incident_imputable_a invalide : 422', async () => {
    setupAuth('admin_savr');
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/incident/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/incident', {
        incident_imputable_a: 'martien',
        motif_incident: 'Motif suffisamment long',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(422);
  });
});

// ── RM-01 : cron clôture embargo H+24 ────────────────────────────────────────
describe('M1.8 / clôture embargo H+24 (RM-01)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.8/RM-01 — cron appelle fn_cloturer_collectes_embargo et renvoie nb_traite', async () => {
    process.env['CRON_SECRET'] = 'test-secret';
    mockSupabaseChain.rpc.mockResolvedValueOnce({ data: 3, error: null });

    const { POST } = await import('@/app/api/cron/cloture-embargo/route.js');
    const req = new NextRequest('http://localhost/api/cron/cloture-embargo', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret' },
    });
    const res = await POST(req);
    const json = (await res.json()) as { ok: boolean; nb_traite: number };

    expect(res.status).toBe(200);
    expect(json.nb_traite).toBe(3);
    expect(mockSupabaseChain.rpc).toHaveBeenCalledWith(
      'fn_cloturer_collectes_embargo',
    );
  });

  it('M1.8/RM-01 — 401 sans CRON_SECRET valide', async () => {
    process.env['CRON_SECRET'] = 'test-secret';
    const { POST } = await import('@/app/api/cron/cloture-embargo/route.js');
    const req = new NextRequest('http://localhost/api/cron/cloture-embargo', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

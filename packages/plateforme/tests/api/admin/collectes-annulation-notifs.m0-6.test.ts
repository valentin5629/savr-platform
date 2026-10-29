/**
 * Follow-up R22f (BL-P2-22) — Notifications d'annulation sur la validation Admin.
 * §05 machine à états (annulation en 2 temps) : la bascule finale
 * annulation_demandee → annulee se fait via le PATCH générique admin/collectes/[id]
 * (statut forcé). §06.02 : à ce moment on émet tpl 5 (annulation_collecte, au
 * programmeur), tpl 22 (admin_collecte_annulee) et tpl 21 (collecte_modifiee_tiers,
 * branche annulation) si le donneur d'ordre est un tiers non-shadow.
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

// Les helpers tpl 21/22 sont testés en isolation (traiteur-operationnel.m0-7).
// Ici on vérifie le CÂBLAGE : la route les invoque avec les bons arguments.
const mockNotifierAdminAnnulation = vi.fn().mockResolvedValue(undefined);
const mockNotifierTraiteurOperationnel = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/notifications/traiteur-operationnel.js', async (original) => ({
  ...(await original<
    typeof import('@/lib/notifications/traiteur-operationnel.js')
  >()),
  notifierAdminAnnulation: (...args: unknown[]) =>
    mockNotifierAdminAnnulation(...args),
  notifierTraiteurOperationnel: (...args: unknown[]) =>
    mockNotifierTraiteurOperationnel(...args),
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

function setupAuth(role: string, userId = 'admin-1'): void {
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

// Les notifications sont best-effort (void ...().catch()) → elles s'exécutent après
// le retour de la route. Un tick macro laisse la file de microtâches se vider.
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('M0.6 — notifications annulation (validation Admin → annulee)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('BL-P2-22 — bascule annulation_demandee → annulee : tpl 5 (programmeur) + tpl 22 (Admin) (sans tpl 21)', async () => {
    setupAuth('admin_savr');
    // before (select *) : statut annulation_demandee (≠ annulee).
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'col-1',
        statut: 'annulation_demandee',
        date_collecte: '2026-07-15',
        heure_collecte: '20:00:00',
        annulation_demandee_at: '2026-07-15T08:00:00+00:00',
        annulee_cote_savr_motif: 'Événement reporté',
      },
      error: null,
    });
    // fn_modifier_collecte → statut annulee.
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: { id: 'col-1', statut: 'annulee' },
      error: null,
    });
    // Bloc best-effort : 1) contexte événement, 2) programmeur.
    mockSupabaseChain.maybeSingle
      .mockResolvedValueOnce({
        data: {
          evenements: {
            created_by: 'user-prog',
            organisation_id: 'org-agence',
            lieux: { nom: 'Salle Wagram' },
            organisations: { nom: 'Agence Événements' },
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { email: 'prog@savr-test.local', prenom: 'Paul' },
        error: null,
      });

    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/collectes/col-1', {
        statut: 'annulee',
        motif: 'Validation de la demande d’annulation du traiteur',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(200);
    await flush();

    // tpl 5 → programmeur (evenements.created_by résolu en email).
    expect(mockSendEmail).toHaveBeenCalledWith(
      'annulation_collecte',
      'prog@savr-test.local',
      // Motif du client, jamais le texte saisi par l'Admin pour forcer le
      // statut (revue des emails, Val 2026-10-29).
      expect.objectContaining({
        prenom: 'Paul',
        lieu_nom: 'Salle Wagram',
        motif: 'Événement reporté',
      }),
    );
    // tpl 22 → Admin, avec l'acteur (admin) et le contexte résolu.
    expect(mockNotifierAdminAnnulation).toHaveBeenCalledWith(
      mockSupabaseChain,
      expect.objectContaining({
        collecteId: 'col-1',
        dateCollecte: '2026-07-15',
        lieuNom: 'Salle Wagram',
        acteurUserId: 'admin-1',
        acteurRole: 'admin_savr',
        motif: 'Événement reporté',
        // Le délai se juge à la demande du client (Val 2026-10-15).
        statutAvant: 'annulation_demandee',
        annulationDemandeeAt: '2026-07-15T08:00:00+00:00',
      }),
    );
    // Le programmateur ne reçoit pas en plus « Collecte annulée » par un tiers
    // (tpl 21) : la confirmation suffit (Val 2026-10-29).
    expect(mockNotifierTraiteurOperationnel).not.toHaveBeenCalled();
  });

  it('incident sur une demande d’annulation : l’alerte Admin reçoit le statut quitté et l’heure de la demande (Val 2026-10-15)', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'col-1',
        statut: 'annulation_demandee',
        type: 'anti_gaspi',
        date_collecte: '2026-07-20',
        heure_collecte: '18:00:00',
        annulation_demandee_at: '2026-07-20T08:00:00+00:00',
        evenements: { created_by: 'user-prog', lieux: { nom: 'Lieu X' } },
      },
      error: null,
    });
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: { id: 'col-1', statut: 'annulee' },
      error: null,
    });
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: { email: 'prog@savr-test.local', prenom: 'Prog' },
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/incident/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/incident', {
        incident_imputable_a: 'client',
        motif_incident: 'Annulation demandée par le client',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(200);
    await flush();

    expect(mockNotifierAdminAnnulation).toHaveBeenCalledWith(
      mockSupabaseChain,
      expect.objectContaining({
        collecteId: 'col-1',
        statutAvant: 'annulation_demandee',
        annulationDemandeeAt: '2026-07-20T08:00:00+00:00',
      }),
    );
  });

  it('BL-P2-22 — édition de routine (pas de transition → annulee) : aucune notification', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'col-1', statut: 'validee', date_collecte: '2026-07-15' },
      error: null,
    });
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: { id: 'col-1', statut: 'validee', notes_internes: 'RAS' },
      error: null,
    });

    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/collectes/col-1', {
        notes_internes: 'RAS',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(200);
    await flush();

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockNotifierAdminAnnulation).not.toHaveBeenCalled();
    expect(mockNotifierTraiteurOperationnel).not.toHaveBeenCalled();
  });
});

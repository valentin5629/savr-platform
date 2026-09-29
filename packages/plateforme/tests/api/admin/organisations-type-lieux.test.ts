/**
 * PATCH /admin/organisations/[id] — une organisation qui gère des lieux
 * (organisations_lieux) ne quitte pas le type `gestionnaire_lieux`.
 * CDC §04 organisations_lieux ; arbitrage Val 2026-09-29 (option C4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// organisations : UPDATE … select … single
const orgChain = {
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn(),
};
// organisations_lieux : select(count, head) … eq → { count, error }
const lieuxEq = vi.fn();
const lieuxChain = { select: vi.fn(() => ({ eq: lieuxEq })) };
const from = vi.fn((table: string) =>
  table === 'organisations_lieux' ? lieuxChain : orgChain,
);

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({ from }),
}));

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
  const payload = Buffer.from(
    JSON.stringify({ user_role: role, organisation_id: null }),
  ).toString('base64url');
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-staff-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: `header.${payload}.sig` } },
    error: null,
  });
}

async function patch(body: Record<string, unknown>) {
  const { PATCH } =
    await import('@/app/api/v1/admin/organisations/[id]/route.js');
  return PATCH(
    new NextRequest('http://localhost/api/v1/admin/organisations/org-1', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: 'org-1' }) },
  );
}

describe('Organisations / type — lieux rattachés', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgChain.single.mockReset();
    lieuxEq.mockReset();
    setupAuth('admin_savr');
  });

  it('422 si l’organisation gère des lieux et passe en traiteur, sans UPDATE', async () => {
    lieuxEq.mockResolvedValueOnce({ count: 2, error: null });
    const res = await patch({ type: 'traiteur' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      champs_invalides: string[];
    };
    expect(body.champs_invalides).toEqual(['type']);
    expect(body.error).toContain('2 lieu(x)');
    expect(lieuxEq).toHaveBeenCalledWith('organisation_id', 'org-1');
    expect(orgChain.update).not.toHaveBeenCalled();
  });

  it('200 si l’organisation ne gère aucun lieu', async () => {
    lieuxEq.mockResolvedValueOnce({ count: 0, error: null });
    orgChain.single.mockResolvedValueOnce({
      data: { id: 'org-1', type: 'traiteur', actif: true },
      error: null,
    });
    const res = await patch({ type: 'traiteur' });
    expect(res.status).toBe(200);
    expect(orgChain.update).toHaveBeenCalledWith({ type: 'traiteur' });
  });

  it('rester gestionnaire_lieux : aucun décompte, UPDATE direct', async () => {
    orgChain.single.mockResolvedValueOnce({
      data: { id: 'org-1', type: 'gestionnaire_lieux', actif: true },
      error: null,
    });
    const res = await patch({ type: 'gestionnaire_lieux', nom: 'Viparis' });
    expect(res.status).toBe(200);
    expect(from).not.toHaveBeenCalledWith('organisations_lieux');
  });

  it('sans champ type : aucun décompte', async () => {
    orgChain.single.mockResolvedValueOnce({
      data: { id: 'org-1', actif: true },
      error: null,
    });
    const res = await patch({ nom: 'Renommée' });
    expect(res.status).toBe(200);
    expect(from).not.toHaveBeenCalledWith('organisations_lieux');
  });

  it('décompte en échec : 500, jamais d’UPDATE (fail-closed)', async () => {
    lieuxEq.mockResolvedValueOnce({
      count: null,
      error: { code: '08006', message: 'connexion' },
    });
    const res = await patch({ type: 'agence' });
    expect(res.status).toBe(500);
    expect(orgChain.update).not.toHaveBeenCalled();
  });
});

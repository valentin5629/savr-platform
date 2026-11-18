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
// organisations_domaines_email : select(count, head) … eq → { count, error }
const domEq = vi.fn();
const domChain = { select: vi.fn(() => ({ eq: domEq })) };
// users : membres de l'organisation, select … eq → { data, error }
const usersEq = vi.fn();
const usersChain = { select: vi.fn(() => ({ eq: usersEq })) };
// audit_log : insert → { error }
const auditInsert = vi.fn();
const from = vi.fn((table: string) =>
  table === 'organisations_lieux'
    ? lieuxChain
    : table === 'organisations_domaines_email'
      ? domChain
      : table === 'users'
        ? usersChain
        : table === 'audit_log'
          ? { insert: auditInsert }
          : orgChain,
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
    JSON.stringify({ aal: 'aal2', user_role: role, organisation_id: null }),
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
    domEq.mockReset();
    usersEq.mockReset();
    usersEq.mockResolvedValue({ data: [], error: null });
    auditInsert.mockReset();
    auditInsert.mockResolvedValue({ error: null });
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

  it('422 passage en client organisateur tant qu’un domaine est rattaché, sans UPDATE', async () => {
    lieuxEq.mockResolvedValueOnce({ count: 0, error: null });
    domEq.mockResolvedValueOnce({ count: 1, error: null });
    const res = await patch({ type: 'client_organisateur' });
    expect(res.status).toBe(422);
    expect(domEq).toHaveBeenCalledWith('organisation_id', 'org-1');
    expect(orgChain.update).not.toHaveBeenCalled();
  });

  it('passage en client organisateur sans domaine : UPDATE', async () => {
    lieuxEq.mockResolvedValueOnce({ count: 0, error: null });
    domEq.mockResolvedValueOnce({ count: 0, error: null });
    orgChain.single.mockResolvedValueOnce({
      data: { id: 'org-1', type: 'client_organisateur', actif: true },
      error: null,
    });
    const res = await patch({ type: 'client_organisateur' });
    expect(res.status).toBe(200);
    expect(orgChain.update).toHaveBeenCalledWith({
      type: 'client_organisateur',
    });
  });
});

// Changement de type : la base réécrit les rôles que le nouveau type n'admet plus
// (trg_organisations_type_reecrit_roles, arbitrage Val 2026-11-18) ; la route
// trace chaque réécriture (§07/06 user_role_modifie).
describe('Organisations / type — rôles des utilisateurs réécrits et tracés', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgChain.single.mockReset();
    lieuxEq.mockReset();
    domEq.mockReset();
    usersEq.mockReset();
    auditInsert.mockReset();
    auditInsert.mockResolvedValue({ error: null });
    setupAuth('admin_savr');
  });

  it('traiteur → agence : une trace user_role_modifie par compte réécrit, l’équipe Savr exclue', async () => {
    lieuxEq.mockResolvedValueOnce({ count: 0, error: null });
    usersEq.mockResolvedValueOnce({
      data: [
        {
          id: 'u-mgr',
          role: 'traiteur_manager',
          organisations: { type: 'traiteur' },
        },
        {
          id: 'u-com',
          role: 'traiteur_commercial',
          organisations: { type: 'traiteur' },
        },
        { id: 'u-ops', role: 'ops_savr', organisations: { type: 'traiteur' } },
      ],
      error: null,
    });
    orgChain.single.mockResolvedValueOnce({
      data: { id: 'org-1', type: 'agence', actif: true },
      error: null,
    });
    const res = await patch({ type: 'agence' });
    expect(res.status).toBe(200);
    expect(usersEq).toHaveBeenCalledWith('organisation_id', 'org-1');
    expect(auditInsert).toHaveBeenCalledTimes(1);
    const lignes = auditInsert.mock.calls[0]![0] as {
      action: string;
      record_id: string;
      user_id: string;
      motif: string;
      old_values: { role: string };
      new_values: { role: string };
    }[];
    expect(lignes.map((l) => l.record_id)).toEqual(['u-mgr', 'u-com']);
    for (const l of lignes) {
      expect(l.action).toBe('user_role_modifie');
      expect(l.user_id).toBe('user-staff-1');
      expect(l.new_values).toEqual({ role: 'agence' });
      expect(l.motif).toContain('Agence');
      expect(l.motif.length).toBeGreaterThanOrEqual(10);
    }
    expect(lignes.map((l) => l.old_values.role)).toEqual([
      'traiteur_manager',
      'traiteur_commercial',
    ]);
  });

  it('agence → traiteur : le compte agence devient traiteur_manager', async () => {
    lieuxEq.mockResolvedValueOnce({ count: 0, error: null });
    usersEq.mockResolvedValueOnce({
      data: [
        { id: 'u-agc', role: 'agence', organisations: { type: 'agence' } },
      ],
      error: null,
    });
    orgChain.single.mockResolvedValueOnce({
      data: { id: 'org-1', type: 'traiteur', actif: true },
      error: null,
    });
    const res = await patch({ type: 'traiteur' });
    expect(res.status).toBe(200);
    const lignes = auditInsert.mock.calls[0]![0] as {
      new_values: { role: string };
    }[];
    expect(lignes).toHaveLength(1);
    expect(lignes[0]!.new_values).toEqual({ role: 'traiteur_manager' });
  });

  it('type renvoyé à l’identique : aucune trace (le déclencheur ne part pas)', async () => {
    lieuxEq.mockResolvedValueOnce({ count: 0, error: null });
    usersEq.mockResolvedValueOnce({
      data: [
        // compte ancien hors de son type : la base ne le réécrit pas ici
        {
          id: 'u-ecart',
          role: 'traiteur_commercial',
          organisations: { type: 'agence' },
        },
      ],
      error: null,
    });
    orgChain.single.mockResolvedValueOnce({
      data: { id: 'org-1', type: 'agence', actif: true },
      error: null,
    });
    const res = await patch({ type: 'agence' });
    expect(res.status).toBe(200);
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it('UPDATE refusé par la base : aucune trace', async () => {
    lieuxEq.mockResolvedValueOnce({ count: 0, error: null });
    usersEq.mockResolvedValueOnce({
      data: [
        {
          id: 'u-mgr',
          role: 'traiteur_manager',
          organisations: { type: 'traiteur' },
        },
      ],
      error: null,
    });
    orgChain.single.mockResolvedValueOnce({
      data: null,
      error: { code: '22P02', message: 'valeur invalide' },
    });
    const res = await patch({ type: 'agence' });
    expect(res.status).toBe(422);
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it('lecture des membres en échec : 500, jamais d’UPDATE', async () => {
    lieuxEq.mockResolvedValueOnce({ count: 0, error: null });
    usersEq.mockResolvedValueOnce({
      data: null,
      error: { code: '08006', message: 'connexion' },
    });
    const res = await patch({ type: 'agence' });
    expect(res.status).toBe(500);
    expect(orgChain.update).not.toHaveBeenCalled();
  });
});

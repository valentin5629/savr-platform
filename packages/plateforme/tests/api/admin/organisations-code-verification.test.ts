/**
 * PATCH /admin/organisations/[id] — case « code de vérification exigé »
 * (lib/code-verification.ts ; VIPARIS, décision Val 2026-11-10, à la place du
 * SAML). Épinglé : admin_savr seul, vrai ou faux seulement, changement tracé
 * dans audit_log (ancienne et nouvelle valeur), rien tracé sans changement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { logger } from '@savr/shared/src/logger/index.js';

// organisations : select … eq … single (valeur avant) puis update … select … single
const orgChain = {
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn(),
};
const auditInsert = vi.fn();
const from = vi.fn((table: string) =>
  table === 'audit_log' ? { insert: auditInsert } : orgChain,
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

describe('Organisations / code de vérification exigé', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgChain.single.mockReset();
    auditInsert.mockResolvedValue({ data: null, error: null });
    setupAuth('admin_savr');
  });

  it('admin_savr coche la case : enregistrée, changement tracé dans audit_log', async () => {
    orgChain.single
      .mockResolvedValueOnce({
        data: { code_verification_obligatoire: false },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'org-1', code_verification_obligatoire: true },
        error: null,
      });
    const res = await patch({ code_verification_obligatoire: true });
    expect(res.status).toBe(200);
    expect(orgChain.update).toHaveBeenCalledWith({
      code_verification_obligatoire: true,
    });
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'code_verification_organisation',
        table_name: 'organisations',
        record_id: 'org-1',
        user_id: 'user-staff-1',
        role: 'admin_savr',
        old_values: { code_verification_obligatoire: false },
        new_values: { code_verification_obligatoire: true },
      }),
    );
  });

  it('admin_savr décoche la case : tracé aussi', async () => {
    orgChain.single
      .mockResolvedValueOnce({
        data: { code_verification_obligatoire: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'org-1', code_verification_obligatoire: false },
        error: null,
      });
    expect((await patch({ code_verification_obligatoire: false })).status).toBe(
      200,
    );
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        old_values: { code_verification_obligatoire: true },
        new_values: { code_verification_obligatoire: false },
      }),
    );
  });

  it('valeur inchangée : enregistrée, rien tracé', async () => {
    orgChain.single
      .mockResolvedValueOnce({
        data: { code_verification_obligatoire: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'org-1', code_verification_obligatoire: true },
        error: null,
      });
    expect((await patch({ code_verification_obligatoire: true })).status).toBe(
      200,
    );
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it('trace audit_log en échec : enregistrement conservé (200), échec journalisé', async () => {
    const erreurLog = vi.spyOn(logger, 'error').mockImplementation(() => {});
    auditInsert.mockResolvedValue({ data: null, error: { code: 'XX000' } });
    orgChain.single
      .mockResolvedValueOnce({
        data: { code_verification_obligatoire: false },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'org-1', code_verification_obligatoire: true },
        error: null,
      });
    expect((await patch({ code_verification_obligatoire: true })).status).toBe(
      200,
    );
    expect(erreurLog).toHaveBeenCalledWith(
      'admin.organisations.code_verification.audit_echec',
      expect.objectContaining({ organisation_id: 'org-1', code: 'XX000' }),
    );
    erreurLog.mockRestore();
  });

  it('ops_savr → 403, rien écrit', async () => {
    setupAuth('ops_savr');
    const res = await patch({ code_verification_obligatoire: true });
    expect(res.status).toBe(403);
    expect(orgChain.update).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it.each([['true'], [1], [null], [{}]])(
    'valeur %j (pas un booléen) → 422, rien écrit',
    async (valeur) => {
      const res = await patch({ code_verification_obligatoire: valeur });
      expect(res.status).toBe(422);
      expect(orgChain.update).not.toHaveBeenCalled();
    },
  );
});

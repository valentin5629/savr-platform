/**
 * Tests API admin — validation/refus d'une demande de suppression RGPD (M0.4 / BL-P0-09).
 *
 * Couvre le pivot du workflow Admin 48h (§15 §3.3 l.101) :
 *   · action=valider → rpc fn_anonymize_user(p_user_id, p_justification, p_acteur, p_demande_id)
 *                      + ban/anonymisation Auth best-effort ;
 *   · action=refuser → UPDATE statut='refusee' ;
 *   · garde 409 (demande déjà traitée) / 404 (inconnue) / 400 (action invalide).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let updateCalls: Array<{ table: string; payload: Record<string, unknown> }> =
  [];
let banCalls: unknown[][] = [];
let selectResult: Result = { data: null, error: null };

const mockClient = {
  from: (table: string) => ({
    select: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve(selectResult) }),
    }),
    update: (payload: Record<string, unknown>) => {
      updateCalls.push({ table, payload });
      return { eq: () => Promise.resolve({ error: null }) };
    },
  }),
  rpc: (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    return Promise.resolve({ error: null });
  },
  auth: {
    admin: {
      updateUserById: (...a: unknown[]) => {
        banCalls.push(a);
        return Promise.resolve({ error: null });
      },
    },
  },
};

vi.mock('@/lib/api-auth.js', () => ({
  requireAdmin: vi.fn(async () => ({
    ctx: { userId: 'admin-1', role: 'admin_savr', organisationId: null },
  })),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockClient,
}));

function makeReq(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/v1/admin/demandes-suppression/d-1',
    {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}
const ctx = { params: Promise.resolve({ id: 'd-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls = [];
  updateCalls = [];
  banCalls = [];
  selectResult = { data: null, error: null };
});

describe('M0.4 — RGPD admin validation suppression (BL-P0-09)', () => {
  it('valider → appelle fn_anonymize_user avec les bons paramètres + ban Auth', async () => {
    selectResult = {
      data: { id: 'd-1', user_id: 'u-victim', statut: 'en_attente' },
      error: null,
    };
    const { PATCH } =
      await import('@/app/api/v1/admin/demandes-suppression/[id]/route.js');
    const res = await PATCH(
      makeReq({ action: 'valider', justification: 'RGPD ok' }),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.fn).toBe('fn_anonymize_user');
    expect(rpcCalls[0]?.args).toMatchObject({
      p_user_id: 'u-victim',
      p_acteur: 'admin-1',
      p_demande_id: 'd-1',
      p_justification: 'RGPD ok',
    });
    // anonymisation Auth best-effort déclenchée
    expect(banCalls).toHaveLength(1);
  });

  it('refuser → UPDATE statut=refusee sans anonymisation', async () => {
    selectResult = {
      data: { id: 'd-1', user_id: 'u-victim', statut: 'en_attente' },
      error: null,
    };
    const { PATCH } =
      await import('@/app/api/v1/admin/demandes-suppression/[id]/route.js');
    const res = await PATCH(makeReq({ action: 'refuser' }), ctx);

    expect(res.status).toBe(200);
    expect(rpcCalls).toHaveLength(0);
    const upd = updateCalls.find((c) => c.table === 'demandes_suppression');
    expect(upd?.payload.statut).toBe('refusee');
    expect(upd?.payload.traitee_par).toBe('admin-1');
  });

  it('demande déjà traitée → 409 (aucune anonymisation)', async () => {
    selectResult = {
      data: { id: 'd-1', user_id: 'u-victim', statut: 'validee' },
      error: null,
    };
    const { PATCH } =
      await import('@/app/api/v1/admin/demandes-suppression/[id]/route.js');
    const res = await PATCH(makeReq({ action: 'valider' }), ctx);
    expect(res.status).toBe(409);
    expect(rpcCalls).toHaveLength(0);
  });

  it('demande inconnue → 404', async () => {
    selectResult = { data: null, error: null };
    const { PATCH } =
      await import('@/app/api/v1/admin/demandes-suppression/[id]/route.js');
    const res = await PATCH(makeReq({ action: 'valider' }), ctx);
    expect(res.status).toBe(404);
  });

  it('action invalide → 400', async () => {
    const { PATCH } =
      await import('@/app/api/v1/admin/demandes-suppression/[id]/route.js');
    const res = await PATCH(makeReq({ action: 'supprimer-tout' }), ctx);
    expect(res.status).toBe(400);
  });
});

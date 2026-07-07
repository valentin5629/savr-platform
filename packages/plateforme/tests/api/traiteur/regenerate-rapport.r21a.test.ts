/**
 * R21a — Régénération rapport RSE par le traiteur (RPT-04, décision Val 2026-07-07)
 * + « rapport RSE » d'une collecte AG = attestation standalone (BL-P2-18 (3), option a).
 *
 * Cloisonnement : cross-org → 403 (test P1 bloquant §12 §1.2 l.92). Mock keyé par table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeClient() {
  const results: Record<string, Result> = {};
  function chain(table: string): Record<string, unknown> {
    const res = (): Result => results[table] ?? { data: null, error: null };
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => Promise.resolve(res()),
      single: () => Promise.resolve(res()),
      then: (resolve: (v: Result) => unknown) => resolve(res()),
    };
    return c;
  }
  return { from: (t: string) => chain(t), results };
}

let rls = makeClient();
let admin = makeClient();
const mockRequireUser = vi.fn();
const mockRegen = vi.fn();
const mockPresigned = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => rls,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@/lib/pdf/regenerate.js', () => ({
  regenerateCollecteDocument: (...a: unknown[]) => mockRegen(...a),
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getPresignedUrl: (...a: unknown[]) => mockPresigned(...a),
}));

function postReq(): NextRequest {
  return new NextRequest('http://localhost/x', { method: 'POST' });
}
function getReq(): NextRequest {
  return new NextRequest('http://localhost/x');
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  mockRequireUser.mockResolvedValue({
    ctx: { userId: 'mgr-1', role: 'traiteur_manager', organisationId: 'org-1' },
  });
  mockRegen.mockResolvedValue({
    ok: true,
    jobId: 'job-9',
    type: 'rapport-recyclage-zd',
  });
  mockPresigned.mockResolvedValue('https://r2/att.pdf');
});

async function regen(id = 'c1', type = 'rapport-recyclage-zd') {
  const { POST } =
    await import('@/app/api/v1/traiteur/collectes/[id]/documents/[type]/regenerate/route.js');
  return POST(postReq(), {
    params: Promise.resolve({ id, type }),
  });
}

describe('M1.6 / régénération rapport traiteur (RPT-04)', () => {
  it('manager + collecte visible → 202 + délégué au pipeline commun', async () => {
    rls.results.collectes = { data: { id: 'c1' }, error: null };
    const res = await regen();
    expect(res.status).toBe(202);
    expect(mockRegen).toHaveBeenCalledTimes(1);
  });

  it('cross-org (collecte existe mais hors périmètre RLS) → 403, aucune régénération', async () => {
    rls.results.collectes = { data: null, error: null }; // invisible
    admin.results.collectes = { data: { id: 'c1' }, error: null }; // existe
    const res = await regen();
    expect(res.status).toBe(403);
    expect(mockRegen).not.toHaveBeenCalled();
  });

  it('collecte inexistante → 404', async () => {
    rls.results.collectes = { data: null, error: null };
    admin.results.collectes = { data: null, error: null };
    const res = await regen();
    expect(res.status).toBe(404);
    expect(mockRegen).not.toHaveBeenCalled();
  });

  it('rôle commercial → 403 (régénération réservée au manager, §12 §1.2 l.92)', async () => {
    mockRequireUser.mockResolvedValue({
      error: new Response(null, { status: 403 }),
    });
    const res = await regen();
    expect(res.status).toBe(403);
  });

  it('regeneration_bordereau_et_attestation_interdites_traiteur : type bordereau/attestation → 403, rapport RSE → 202', async () => {
    rls.results.collectes = { data: { id: 'c1' }, error: null };
    // Bordereau ZD réservé Admin (§12 §1.1 l.37) — refusé avant tout appel pipeline.
    const bord = await regen('c1', 'bordereau-zd');
    expect(bord.status).toBe(403);
    // Attestation AG réservée Admin (§12 §1.3 l.161).
    const att = await regen('c1', 'attestation-don');
    expect(att.status).toBe(403);
    expect(mockRegen).not.toHaveBeenCalled();
    // Le rapport RSE §1.2 lui reste accessible.
    const rse = await regen('c1', 'rapport-recyclage-zd');
    expect(rse.status).toBe(202);
    expect(mockRegen).toHaveBeenCalledTimes(1);
  });
});

describe('M2.4 / rapport RSE AG = attestation standalone (option a Val)', () => {
  async function download(id = 'c1') {
    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/rapport-rse/download/route.js');
    return GET(getReq(), { params: Promise.resolve({ id }) });
  }

  it('collecte AG → sert l’attestation (URL pré-signée depuis attestations_don)', async () => {
    rls.results.collectes = {
      data: { id: 'c1', type: 'anti_gaspi' },
      error: null,
    };
    admin.results.attestations_don = {
      data: {
        id: 'a1',
        eligible_at: '2020-01-01T00:00:00Z',
        pdf_url: 'att-key.pdf',
      },
      error: null,
    };
    const res = await download();
    expect(res.status).toBe(200);
    expect(mockPresigned).toHaveBeenCalledWith('att-key.pdf', 900);
  });

  it('attestation AG sous embargo H+24 → 425', async () => {
    rls.results.collectes = {
      data: { id: 'c1', type: 'anti_gaspi' },
      error: null,
    };
    admin.results.attestations_don = {
      data: {
        id: 'a1',
        eligible_at: '2999-01-01T00:00:00Z',
        pdf_url: 'att-key.pdf',
      },
      error: null,
    };
    const res = await download();
    expect(res.status).toBe(425);
    expect(mockPresigned).not.toHaveBeenCalled();
  });
});

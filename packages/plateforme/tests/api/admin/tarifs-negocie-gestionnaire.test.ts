/**
 * POST /api/v1/admin/tarifs-negocie — remise scope gestionnaire (§05 résolution
 * du prix, §04 tarifs_negocie : lieu_id optionnel, null = tous les lieux du
 * gestionnaire). Garde : le négociateur est un gestionnaire de lieux et un lieu
 * précis lui est rattaché (sinon la remise ne s'appliquerait jamais).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let inserts: Array<{ table: string; row: Row }> = [];

function builder(table: string) {
  let rows = [...(tables[table] ?? [])];
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] === val);
      return b;
    },
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    insert: (row: Row) => {
      inserts.push({ table, row });
      const ib: Record<string, unknown> = {
        select: () => ib,
        single: () =>
          Promise.resolve({ data: { id: 'rem-new', ...row }, error: null }),
        then: (onF: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(onF),
      };
      return ib;
    },
  };
  return b;
}

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({ from: (t: string) => builder(t) }),
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

function setupAdmin() {
  const jwt = `h.${Buffer.from(JSON.stringify({ user_role: 'admin_savr' })).toString('base64url')}.s`;
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: jwt } },
    error: null,
  });
}

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/admin/tarifs-negocie', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const BASE = {
  scope: 'gestionnaire',
  gestionnaire_organisation_id: 'org-viparis',
  activite: 'zd',
  remise_pct: 0.1,
  valide_du: '2026-09-17',
};

describe('POST tarifs-negocie — scope gestionnaire', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAdmin();
    inserts = [];
    tables = {
      organisations: [
        { id: 'org-viparis', type: 'gestionnaire_lieux' },
        { id: 'org-kaspia', type: 'traiteur' },
      ],
      organisations_lieux: [
        { id: 'ol-1', organisation_id: 'org-viparis', lieu_id: 'lieu-pv' },
      ],
    };
  });

  it('201 : tous les lieux du gestionnaire → lieu_id null inséré', async () => {
    const { POST } = await import('@/app/api/v1/admin/tarifs-negocie/route.js');
    const res = await POST(post(BASE));
    expect(res.status).toBe(201);
    const ins = inserts.find((i) => i.table === 'tarifs_negocie');
    expect(ins?.row).toMatchObject({
      scope: 'gestionnaire',
      gestionnaire_organisation_id: 'org-viparis',
      lieu_id: null,
      remise_pct: 0.1,
    });
  });

  it('201 : lieu précis rattaché au gestionnaire → lieu_id inséré', async () => {
    const { POST } = await import('@/app/api/v1/admin/tarifs-negocie/route.js');
    const res = await POST(post({ ...BASE, lieu_id: 'lieu-pv' }));
    expect(res.status).toBe(201);
    expect(inserts.find((i) => i.table === 'tarifs_negocie')?.row.lieu_id).toBe(
      'lieu-pv',
    );
  });

  it("422 : lieu non rattaché au gestionnaire → rien n'est inséré", async () => {
    const { POST } = await import('@/app/api/v1/admin/tarifs-negocie/route.js');
    const res = await POST(post({ ...BASE, lieu_id: 'lieu-autre' }));
    expect(res.status).toBe(422);
    expect(inserts.some((i) => i.table === 'tarifs_negocie')).toBe(false);
  });

  it("422 : organisation négociatrice qui n'est pas un gestionnaire de lieux", async () => {
    const { POST } = await import('@/app/api/v1/admin/tarifs-negocie/route.js');
    const res = await POST(
      post({ ...BASE, gestionnaire_organisation_id: 'org-kaspia' }),
    );
    expect(res.status).toBe(422);
    expect(inserts.some((i) => i.table === 'tarifs_negocie')).toBe(false);
  });

  it('422 : lieu_id en scope organisation (ignoré par le calcul du prix)', async () => {
    const { POST } = await import('@/app/api/v1/admin/tarifs-negocie/route.js');
    const res = await POST(
      post({
        scope: 'organisation',
        organisation_id: 'org-kaspia',
        lieu_id: 'lieu-pv',
        activite: 'zd',
        remise_pct: 0.1,
        valide_du: '2026-09-17',
      }),
    );
    expect(res.status).toBe(422);
    expect(inserts.some((i) => i.table === 'tarifs_negocie')).toBe(false);
  });
});

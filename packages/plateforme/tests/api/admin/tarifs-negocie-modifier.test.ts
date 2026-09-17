/**
 * POST /api/v1/admin/tarifs-negocie/[id]/modifier — §06.06 « Remises négociées » :
 * modification = fermeture de la ligne active + création d'une nouvelle ligne,
 * jamais de modification rétroactive. L'ancienne est close la veille de la date
 * d'effet (aucun jour où les deux s'appliquent).
 *
 * Le fake tient un état en mémoire et applique réellement les filtres eq/is :
 * la garde « encore ouverte » et le rollback sont observés sur les lignes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let echecInsertRemise = false;

function builder(table: string) {
  let filtres: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  const lignes = () =>
    (tables[table] ?? []).filter((r) => filtres.every((f) => f(r)));
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (col: string, val: unknown) => {
      filtres.push((r) => r[col] === val);
      return b;
    },
    is: (col: string, val: unknown) => {
      filtres.push((r) => r[col] === val);
      return b;
    },
    update: (p: Row) => {
      patch = p;
      return b;
    },
    maybeSingle: () => {
      const rs = lignes();
      if (patch) for (const r of rs) Object.assign(r, patch);
      return Promise.resolve({ data: rs[0] ?? null, error: null });
    },
    then: (onF: (v: unknown) => unknown) => {
      const rs = lignes();
      if (patch) for (const r of rs) Object.assign(r, patch);
      return Promise.resolve({ data: rs, error: null }).then(onF);
    },
    in: (col: string, vals: unknown[]) => {
      filtres.push((r) => vals.includes(r[col]));
      return b;
    },
    insert: (payload: Row | Row[]) => {
      const lignes = (Array.isArray(payload) ? payload : [payload]).map(
        (row, i) => ({ id: `new-${(tables[table] ?? []).length + i}`, ...row }),
      );
      const ib: Record<string, unknown> = {
        select: () => ib,
        then: (onF: (v: unknown) => unknown) => {
          if (table === 'tarifs_negocie' && echecInsertRemise)
            return Promise.resolve({
              data: null,
              error: { code: '23514' },
            }).then(onF);
          (tables[table] ??= []).push(...lignes);
          return Promise.resolve({ data: lignes, error: null }).then(onF);
        },
      };
      return ib;
    },
  };
  filtres = [];
  return b;
}

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({ from: (t: string) => builder(t) }),
}));
vi.mock('@savr/shared/src/temps/index.js', async (orig) => ({
  ...(await orig<typeof import('@savr/shared/src/temps/index.js')>()),
  jourParis: () => '2026-09-17',
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

function setupRole(role: string) {
  const jwt = `h.${Buffer.from(JSON.stringify({ user_role: role })).toString('base64url')}.s`;
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: jwt } },
    error: null,
  });
}

const ID = '11111111-1111-4111-8111-111111111111';
const LIEU_PV = '22222222-2222-4222-8222-222222222222';
const LIEU_AUTRE = '33333333-3333-4333-8333-333333333333';
const LIEU_PN = '44444444-4444-4444-8444-444444444444';

function req(
  body: unknown,
  id = ID,
): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new NextRequest(
      `http://localhost/api/v1/admin/tarifs-negocie/${id}/modifier`,
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      },
    ),
    { params: Promise.resolve({ id }) },
  ];
}

const remises = () => tables.tarifs_negocie ?? [];
const ancienne = () => remises().find((r) => r.id === ID)!;

describe('POST tarifs-negocie/[id]/modifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupRole('admin_savr');
    echecInsertRemise = false;
    tables = {
      tarifs_negocie: [
        {
          id: ID,
          scope: 'gestionnaire',
          organisation_id: null,
          gestionnaire_organisation_id: 'org-viparis',
          lieu_id: null,
          activite: 'zd',
          remise_pct: 0.05,
          valide_du: '2025-01-01',
          valide_jusqu_au: null,
          commentaires: 'Accord 2025',
        },
      ],
      organisations_lieux: [
        { id: 'ol-1', organisation_id: 'org-viparis', lieu_id: LIEU_PV },
        { id: 'ol-2', organisation_id: 'org-viparis', lieu_id: LIEU_PN },
      ],
      audit_log: [],
    };
  });

  it('201 : ancienne close la veille de la date d’effet, nouvelle ligne (même porteur/activité) créée', async () => {
    const { POST } =
      await import('@/app/api/v1/admin/tarifs-negocie/[id]/modifier/route.js');
    const res = await POST(
      ...req({ remise_pct: 0.1, valide_du: '2026-09-17', lieu_id: LIEU_PV }),
    );
    expect(res.status).toBe(201);
    expect(ancienne().valide_jusqu_au).toBe('2026-09-16');
    expect(ancienne().remise_pct).toBe(0.05); // jamais réécrite
    const nouvelles = remises().filter((r) => r.id !== ID);
    expect(nouvelles).toHaveLength(1);
    expect(nouvelles[0]).toMatchObject({
      scope: 'gestionnaire',
      gestionnaire_organisation_id: 'org-viparis',
      organisation_id: null,
      activite: 'zd',
      lieu_id: LIEU_PV,
      remise_pct: 0.1,
      valide_du: '2026-09-17',
      commentaires: 'Accord 2025',
    });
    expect(nouvelles[0]?.valide_jusqu_au ?? null).toBeNull(); // active
    expect(
      tables.audit_log!.some((a) => a.action === 'modification_remise'),
    ).toBe(true);
  });

  it('422 : date d’effet dans le passé (jamais rétroactif) → rien ne change', async () => {
    const { POST } =
      await import('@/app/api/v1/admin/tarifs-negocie/[id]/modifier/route.js');
    const res = await POST(
      ...req({ remise_pct: 0.1, valide_du: '2026-09-16' }),
    );
    expect(res.status).toBe(422);
    expect(ancienne().valide_jusqu_au).toBeNull();
    expect(remises()).toHaveLength(1);
  });

  it('porteur, scope et activité du corps ignorés : repris de la ligne existante', async () => {
    const { POST } =
      await import('@/app/api/v1/admin/tarifs-negocie/[id]/modifier/route.js');
    const res = await POST(
      ...req({
        remise_pct: 0.1,
        valide_du: '2026-09-17',
        scope: 'organisation',
        organisation_id: 'org-pirate',
        gestionnaire_organisation_id: 'org-pirate',
        activite: 'ag',
      }),
    );
    expect(res.status).toBe(201);
    const nouvelle = remises().find((r) => r.id !== ID);
    expect(nouvelle).toMatchObject({
      scope: 'gestionnaire',
      organisation_id: null,
      gestionnaire_organisation_id: 'org-viparis',
      activite: 'zd',
    });
  });

  it('422 : date d’effet antérieure au début d’une remise future → rien ne change', async () => {
    ancienne().valide_du = '2026-10-01';
    const { POST } =
      await import('@/app/api/v1/admin/tarifs-negocie/[id]/modifier/route.js');
    const res = await POST(
      ...req({ remise_pct: 0.1, valide_du: '2026-09-20' }),
    );
    expect(res.status).toBe(422);
    expect(ancienne().valide_jusqu_au).toBeNull();
    expect(remises()).toHaveLength(1);
  });

  it('201 : « tous les lieux » remplacée par 2 lieux cochés → ancienne close, 2 nouvelles lignes', async () => {
    const { POST } =
      await import('@/app/api/v1/admin/tarifs-negocie/[id]/modifier/route.js');
    const res = await POST(
      ...req({
        remise_pct: 0.1,
        valide_du: '2026-09-17',
        lieu_ids: [LIEU_PV, LIEU_PN],
      }),
    );
    expect(res.status).toBe(201);
    expect(ancienne().valide_jusqu_au).toBe('2026-09-16');
    const nouvelles = remises().filter((r) => r.id !== ID);
    expect(nouvelles.map((r) => r.lieu_id).sort()).toEqual(
      [LIEU_PV, LIEU_PN].sort(),
    );
    for (const r of nouvelles)
      expect(r).toMatchObject({ remise_pct: 0.1, scope: 'gestionnaire' });
  });

  it('lieux absents du corps → lieu de la remise conservé', async () => {
    ancienne().lieu_id = LIEU_PV;
    const { POST } =
      await import('@/app/api/v1/admin/tarifs-negocie/[id]/modifier/route.js');
    const res = await POST(
      ...req({ remise_pct: 0.1, valide_du: '2026-09-17' }),
    );
    expect(res.status).toBe(201);
    const nouvelles = remises().filter((r) => r.id !== ID);
    expect(nouvelles).toHaveLength(1);
    expect(nouvelles[0]?.lieu_id).toBe(LIEU_PV);
  });

  it('409 : remise déjà fermée → rien ne change', async () => {
    ancienne().valide_jusqu_au = '2026-01-01';
    const { POST } =
      await import('@/app/api/v1/admin/tarifs-negocie/[id]/modifier/route.js');
    const res = await POST(
      ...req({ remise_pct: 0.1, valide_du: '2026-09-17' }),
    );
    expect(res.status).toBe(409);
    expect(remises()).toHaveLength(1);
  });

  it('422 : lieu non rattaché au gestionnaire → rien ne change', async () => {
    const { POST } =
      await import('@/app/api/v1/admin/tarifs-negocie/[id]/modifier/route.js');
    const res = await POST(
      ...req({ remise_pct: 0.1, valide_du: '2026-09-17', lieu_id: LIEU_AUTRE }),
    );
    expect(res.status).toBe(422);
    expect(ancienne().valide_jusqu_au).toBeNull();
    expect(remises()).toHaveLength(1);
  });

  it('échec de création de la nouvelle ligne → fermeture annulée (remise toujours active)', async () => {
    echecInsertRemise = true;
    const { POST } =
      await import('@/app/api/v1/admin/tarifs-negocie/[id]/modifier/route.js');
    const res = await POST(
      ...req({ remise_pct: 0.1, valide_du: '2026-09-17' }),
    );
    expect(res.status).toBe(422);
    expect(ancienne().valide_jusqu_au).toBeNull();
    expect(remises()).toHaveLength(1);
  });

  it('403 : ops ne peut pas modifier', async () => {
    setupRole('ops_savr');
    const { POST } =
      await import('@/app/api/v1/admin/tarifs-negocie/[id]/modifier/route.js');
    const res = await POST(
      ...req({ remise_pct: 0.1, valide_du: '2026-09-17' }),
    );
    expect(res.status).toBe(403);
    expect(ancienne().valide_jusqu_au).toBeNull();
  });
});

/**
 * Régression — /admin/dashboard/revenus-organisations.
 * Verrouille le fix : le statut de facturation est porté par `factures`
 * (jointure `factures!inner(statut)`), JAMAIS par `factures_collectes`
 * (qui n'a pas de colonne `statut`) ; et le revenu = statuts envoyee/payee/en_retard
 * (jamais `emise`, valeur legacy hors flux Pennylane actif).
 * Auparavant la route filtrait `.in('statut', ['emise','payee'])` sur
 * factures_collectes → 500 silencieux, bloc « Revenus par organisation » vide.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown; count?: number };

function makeChain() {
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) =>
    (calls[name] ??= []).push(args);
  let result: Result = { data: [], error: null, count: 0 };
  const chain: Record<string, unknown> = {
    __calls: calls,
    setResult(r: Result) {
      result = r;
      return chain;
    },
  };
  for (const m of ['from', 'select', 'in', 'gte', 'lte', 'range']) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  chain.then = (resolve: (r: Result) => unknown) => resolve(result);
  return chain as Record<string, unknown> & {
    __calls: Record<string, unknown[][]>;
    setResult(r: Result): unknown;
  };
}

let admin = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'u1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}
function makeReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  admin = makeChain();
});

describe('admin/revenus-organisations', () => {
  it('revenus/statut_filtre_sur_factures_pas_factures_collectes — jointure factures!inner(statut)', async () => {
    setupAuth('admin_savr');
    admin.setResult({
      data: [
        {
          montant_ht: 150,
          collectes: {
            evenements: {
              organisation_id: 'org-1',
              organisations: { id: 'org-1', raison_sociale: 'Kardamome SAS' },
            },
          },
        },
      ],
      error: null,
      count: 1,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard/revenus-organisations'),
    );
    expect(res.status).toBe(200);

    // Le SELECT joint factures!inner(statut) et ne sélectionne PAS statut sur factures_collectes
    const selectArg = String(admin.__calls.select?.[0]?.[0] ?? '');
    expect(selectArg).toContain('factures!inner(statut)');
    expect(/factures_collectes/.test(selectArg)).toBe(false); // pas de .from imbriqué
    // Le filtre porte sur factures.statut, pas sur statut nu
    const inArgs = admin.__calls.in ?? [];
    expect(inArgs.some((a) => a[0] === 'factures.statut')).toBe(true);
    expect(inArgs.some((a) => a[0] === 'statut')).toBe(false);
  });

  it('revenus/statuts_revenu_envoyee_payee_en_retard — jamais emise/brouillon', async () => {
    setupAuth('admin_savr');
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    await GET(makeReq('/api/v1/admin/dashboard/revenus-organisations'));
    const statutFilter = (admin.__calls.in ?? []).find(
      (a) => a[0] === 'factures.statut',
    )?.[1] as string[] | undefined;
    expect(statutFilter).toEqual(['envoyee', 'payee', 'en_retard']);
    expect(statutFilter).not.toContain('emise');
    expect(statutFilter).not.toContain('brouillon');
  });

  it('revenus/agregation_par_organisation — somme montant_ht groupée + triée', async () => {
    setupAuth('ops_savr');
    admin.setResult({
      data: [
        {
          montant_ht: 100,
          collectes: {
            evenements: {
              organisation_id: 'org-1',
              organisations: { id: 'org-1', raison_sociale: 'A' },
            },
          },
        },
        {
          montant_ht: 50,
          collectes: {
            evenements: {
              organisation_id: 'org-1',
              organisations: { id: 'org-1', raison_sociale: 'A' },
            },
          },
        },
        {
          montant_ht: 300,
          collectes: {
            evenements: {
              organisation_id: 'org-2',
              organisations: { id: 'org-2', raison_sociale: 'B' },
            },
          },
        },
      ],
      error: null,
      count: 3,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard/revenus-organisations'),
    );
    const json = (await res.json()) as {
      data: Array<{ organisation_id: string; total_ht: number }>;
    };
    // org-2 (300) avant org-1 (150), tri décroissant
    expect(json.data[0]).toMatchObject({
      organisation_id: 'org-2',
      total_ht: 300,
    });
    expect(json.data[1]).toMatchObject({
      organisation_id: 'org-1',
      total_ht: 150,
    });
  });

  it('revenus/imputation_organisation_programmatrice — agrégé sur evenements.organisation_id (CDC §06.06 P1)', async () => {
    setupAuth('admin_savr');
    // Deux lignes du même événement → imputées à l'organisation PROGRAMMATRICE
    // (evenements.organisation_id), pas au traiteur opérationnel ni au lieu.
    admin.setResult({
      data: [
        {
          montant_ht: 200,
          collectes: {
            evenements: {
              organisation_id: 'org-programmatrice',
              organisations: {
                id: 'org-programmatrice',
                raison_sociale: 'Agence Prog',
              },
            },
          },
        },
      ],
      error: null,
      count: 1,
    });
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard/revenus-organisations'),
    );
    const json = (await res.json()) as {
      data: Array<{ organisation_id: string }>;
    };
    // Le SELECT impute via evenements.organisation_id (pas traiteur_operationnel)
    const selectArg = String(admin.__calls.select?.[0]?.[0] ?? '');
    expect(selectArg).toContain('evenements!inner');
    expect(selectArg).toContain('organisation_id');
    expect(selectArg).not.toContain('traiteur_operationnel_organisation_id');
    expect(json.data[0]?.organisation_id).toBe('org-programmatrice');
  });

  it('revenus/filtre_par_date_collecte_pas_emission — gte/lte sur collectes.date_collecte (CDC P2)', async () => {
    setupAuth('admin_savr');
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    await GET(
      makeReq(
        '/api/v1/admin/dashboard/revenus-organisations?from=2026-01-01&to=2026-03-31',
      ),
    );
    const gteArgs = admin.__calls.gte ?? [];
    const lteArgs = admin.__calls.lte ?? [];
    // Filtre porté par la date de COLLECTE, jamais par une date d'émission facture
    expect(gteArgs.some((a) => a[0] === 'collectes.date_collecte')).toBe(true);
    expect(lteArgs.some((a) => a[0] === 'collectes.date_collecte')).toBe(true);
    expect(gteArgs.some((a) => String(a[0]).includes('emission'))).toBe(false);
  });

  it('revenus/auth_guard_non_staff_403 — rôle client bloqué', async () => {
    setupAuth('traiteur_manager');
    const { GET } =
      await import('@/app/api/v1/admin/dashboard/revenus-organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard/revenus-organisations'),
    );
    expect(res.status).toBe(403);
  });
});

/**
 * M2.4 — BL-P1-RPT-02 : service du rapport « Événement sans excédent » côté traiteur.
 * Pour une collecte AG realisee_sans_collecte (pas d'attestation), le download et la
 * disponibilité doivent pointer sur rapports_rse (sans embargo H+24), PAS sur
 * attestations_don. L'AG cloturee (attestation) et le ZD (recyclage) restent inchangés.
 *
 * Mock keyé par TABLE (robuste à l'ordre des lectures Promise.all).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeClient() {
  const results: Record<string, Result> = {};
  const calls: string[] = [];
  function chain(table: string): Record<string, unknown> {
    const res = (): Result => results[table] ?? { data: null, error: null };
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      is: () => c,
      in: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => Promise.resolve(res()),
      single: () => Promise.resolve(res()),
      then: (resolve: (v: Result) => unknown) => resolve(res()),
    };
    return c;
  }
  const api = {
    schema: () => api,
    from: (table: string) => {
      calls.push(table);
      return chain(table);
    },
    results,
    calls,
  };
  return api;
}

let rls = makeClient();
let admin = makeClient();
const mockRequireUser = vi.fn();
const mockPresigned = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => rls,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@savr/shared/src/email/index.js', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getPresignedUrl: (...a: unknown[]) => mockPresigned(...a),
}));

function makeReq(): NextRequest {
  return new NextRequest('http://localhost/api/v1/traiteur/collectes/c1');
}

const PAST = '2020-01-01T00:00:00Z';

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  mockRequireUser.mockResolvedValue({
    ctx: {
      userId: 'user-1',
      role: 'traiteur_manager',
      organisationId: 'org-1',
    },
  });
  mockPresigned.mockResolvedValue('https://r2.example/presigned.pdf');
});

describe('M2.4 / download rapport sans-excédent (BL-P1-RPT-02)', () => {
  async function download() {
    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/rapport-rse/download/route.js');
    return GET(makeReq(), { params: Promise.resolve({ id: 'c1' }) });
  }

  it('AG realisee_sans_collecte → sert rapports_rse (sans embargo), 200 + URL', async () => {
    rls.results.collectes = {
      data: { id: 'c1', type: 'anti_gaspi', statut: 'realisee_sans_collecte' },
      error: null,
    };
    admin.results.rapports_rse = {
      data: {
        id: 'r1',
        disponible_a: PAST,
        genere_at: '2020-01-02T00:00:00Z',
        pdf_url: 'rapports/se-r1.pdf',
      },
      error: null,
    };
    // Aucune attestation n'existe pour une collecte sans-excédent : si le code la lisait,
    // il renverrait 404. Le test prouve qu'il passe par la branche rapports_rse.
    admin.results.attestations_don = { data: null, error: null };

    const res = await download();
    expect(res.status).toBe(200);
    expect(mockPresigned).toHaveBeenCalledWith('rapports/se-r1.pdf', 900);
  });

  it('AG cloturee → sert toujours l’attestation (régression BL-P2-18)', async () => {
    rls.results.collectes = {
      data: { id: 'c1', type: 'anti_gaspi', statut: 'cloturee' },
      error: null,
    };
    admin.results.attestations_don = {
      data: { id: 'a1', eligible_at: PAST, pdf_url: 'rapports/att-a1.pdf' },
      error: null,
    };
    const res = await download();
    expect(res.status).toBe(200);
    expect(mockPresigned).toHaveBeenCalledWith('rapports/att-a1.pdf', 900);
  });

  it('collecte cross-org (invisible RLS) → 404 SANS présignature (0 fuite inter-org)', async () => {
    // La lecture RLS-scopée ne voit pas la collecte d'une autre org → 404 avant toute
    // lecture service-role du rapport. Aucune URL présignée émise.
    rls.results.collectes = { data: null, error: null };
    admin.results.rapports_rse = {
      data: {
        id: 'r1',
        disponible_a: PAST,
        genere_at: '2020-01-02T00:00:00Z',
        pdf_url: 'rapports/se-r1.pdf',
      },
      error: null,
    };
    const res = await download();
    expect(res.status).toBe(404);
    expect(mockPresigned).not.toHaveBeenCalled();
  });

  it('AG realisee_sans_collecte sans PDF encore généré → 202 (génération en cours)', async () => {
    rls.results.collectes = {
      data: { id: 'c1', type: 'anti_gaspi', statut: 'realisee_sans_collecte' },
      error: null,
    };
    admin.results.rapports_rse = {
      data: {
        id: 'r1',
        disponible_a: PAST,
        genere_at: null,
        pdf_url: null,
      },
      error: null,
    };
    const res = await download();
    expect(res.status).toBe(202);
    expect(mockPresigned).not.toHaveBeenCalled();
  });
});

describe('M2.4 / fiche collecte GET — disponibilité sans-excédent (BL-P1-RPT-02)', () => {
  async function get() {
    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    return GET(makeReq(), { params: Promise.resolve({ id: 'c1' }) });
  }

  it('AG realisee_sans_collecte → rapport_rse_disponible lu depuis rapports_rse', async () => {
    rls.results.collectes = {
      data: {
        id: 'c1',
        type: 'anti_gaspi',
        statut: 'realisee_sans_collecte',
        evenement: {},
      },
      error: null,
    };
    admin.results.rapports_rse = {
      data: { disponible_a: PAST, genere_at: '2020-01-02T00:00:00Z' },
      error: null,
    };
    // Pas d'attestation → si le code lisait l'attestation (ancien comportement),
    // rapport_rse_disponible serait false.
    admin.results.attestations_don = { data: null, error: null };

    const res = await get();
    const { data } = (await res.json()) as {
      data: { rapport_rse_disponible: boolean };
    };
    expect(data.rapport_rse_disponible).toBe(true);
  });

  it('AG cloturee → rapport_rse_disponible lu depuis l’attestation (inchangé)', async () => {
    rls.results.collectes = {
      data: {
        id: 'c1',
        type: 'anti_gaspi',
        statut: 'cloturee',
        evenement: {},
      },
      error: null,
    };
    admin.results.attestations_don = {
      data: { eligible_at: PAST, pdf_url: 'k.pdf' },
      error: null,
    };
    admin.results.rapports_rse = { data: null, error: null };

    const res = await get();
    const { data } = (await res.json()) as {
      data: { rapport_rse_disponible: boolean };
    };
    expect(data.rapport_rse_disponible).toBe(true);
  });
});

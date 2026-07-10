/**
 * R23b-2 — Route POST /api/v1/traiteur/rapports-rse/export-zip (BL-P3-06).
 * ZIP groupé des rapports RSE d'une sélection : cloisonnement RLS, plafond 50,
 * embargo H+24 respecté. Titrés « M0.8-XX » → `pnpm test:module M0.8`.
 * Mock keyé par TABLE (comme sans-excedent-download.m2-4).
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
      in: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => Promise.resolve(res()),
      then: (resolve: (v: Result) => unknown) => resolve(res()),
    };
    return c;
  }
  const api = {
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
const mockGetObjectBytes = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => rls,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getObjectBytes: (...a: unknown[]) => mockGetObjectBytes(...a),
}));

const PAST = '2020-01-01T00:00:00Z';
const FUTURE = '2999-01-01T00:00:00Z';

function makeReq(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/v1/traiteur/rapports-rse/export-zip',
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

async function post(body: unknown) {
  const { POST } =
    await import('@/app/api/v1/traiteur/rapports-rse/export-zip/route.js');
  return POST(makeReq(body));
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  mockRequireUser.mockResolvedValue({
    ctx: { userId: 'u1', role: 'traiteur_manager', organisationId: 'org-1' },
  });
  mockGetObjectBytes.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
});

describe('M0.8-50 — export ZIP RSE : sélection vide → 422 (BL-P3-06)', () => {
  it('rejette sans lire aucun fichier', async () => {
    const res = await post({ collecte_ids: [] });
    expect(res.status).toBe(422);
    expect(mockGetObjectBytes).not.toHaveBeenCalled();
  });
});

describe('M0.8-51 — export ZIP RSE : au-delà de 50 → 422', () => {
  it('borne la sélection à 50 (§06.04 l.903)', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `c${i}`);
    const res = await post({ collecte_ids: ids });
    expect(res.status).toBe(422);
    expect(mockGetObjectBytes).not.toHaveBeenCalled();
  });
});

describe('M0.8-52 — export ZIP RSE : cross-org (RLS ne voit rien) → 422, 0 lecture', () => {
  it('ne lit aucun rapport si aucune collecte visible (0 fuite inter-org)', async () => {
    rls.results.collectes = { data: [], error: null };
    const res = await post({ collecte_ids: ['c1', 'c2'] });
    expect(res.status).toBe(422);
    expect(mockGetObjectBytes).not.toHaveBeenCalled();
  });
});

describe('M0.8-53 — export ZIP RSE : rapports disponibles → 200 application/zip', () => {
  it('assemble un ZIP des PDFs résolus', async () => {
    rls.results.collectes = {
      data: [
        {
          id: 'c1',
          type: 'zero_dechet',
          statut: 'cloturee',
          date_collecte: '2026-06-01',
          tms_reference: null,
        },
      ],
      error: null,
    };
    admin.results.rapports_rse = {
      data: { disponible_a: PAST, genere_at: PAST, pdf_url: 'rapports/r1.pdf' },
      error: null,
    };
    const res = await post({ collecte_ids: ['c1'] });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    expect(mockGetObjectBytes).toHaveBeenCalledWith('rapports/r1.pdf');
  });
});

describe('M0.8-54 — export ZIP RSE : tout sous embargo H+24 → 422 (aucun fichier)', () => {
  it('skippe les rapports embargués et refuse un ZIP vide', async () => {
    rls.results.collectes = {
      data: [
        {
          id: 'c1',
          type: 'zero_dechet',
          statut: 'cloturee',
          date_collecte: '2026-06-01',
          tms_reference: null,
        },
      ],
      error: null,
    };
    admin.results.rapports_rse = {
      data: {
        disponible_a: FUTURE,
        genere_at: PAST,
        pdf_url: 'rapports/r1.pdf',
      },
      error: null,
    };
    const res = await post({ collecte_ids: ['c1'] });
    expect(res.status).toBe(422);
    expect(mockGetObjectBytes).not.toHaveBeenCalled();
  });
});

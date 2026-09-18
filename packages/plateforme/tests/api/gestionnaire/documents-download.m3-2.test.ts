/**
 * M3.2 — Téléchargement des documents par le gestionnaire de lieux (§06.05 Bloc
 * documents + « accès à tous les rapports … des collectes tenues sur ses lieux »).
 * Route /api/v1/gestionnaire/documents/:type/:id/download (type rapport |
 * attestation) : select exact, pdf_url = clé R2 présignée, embargo H+24 → 425,
 * hors périmètre (RLS) → 404, rôle non gestionnaire → 403.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const next = (): Result => queue.shift() ?? { data: null, error: null };

  const chain: Record<string, unknown> = {
    __queue: queue,
    __calls: calls,
    push(r: Result) {
      queue.push(r);
      return chain;
    },
  };
  for (const m of [
    'from',
    'select',
    'eq',
    'in',
    'gte',
    'lte',
    'neq',
    'order',
  ]) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(next());
  chain.single = () => Promise.resolve(next());
  chain.rpc = (...args: unknown[]) => {
    record('rpc', args);
    return Promise.resolve(next());
  };
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & {
    push(r: Result): unknown;
    __calls: Record<string, unknown[][]>;
  };
}

let rls = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockPresign = vi.fn().mockResolvedValue('https://r2.example/signed');

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (rls.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getPresignedUrl: (...a: unknown[]) => mockPresign(...a),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(role: string, organisationId = 'org-a', userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({
          user_role: role,
          organisation_id: organisationId,
        }),
      },
    },
    error: null,
  });
}
function makeReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
  mockPresign.mockResolvedValue('https://r2.example/signed');
});

async function callDownload(type: string, id: string) {
  const { GET } =
    await import('@/app/api/v1/gestionnaire/documents/[type]/[id]/download/route.js');
  return GET(makeReq(`/api/v1/gestionnaire/documents/${type}/${id}/download`), {
    params: Promise.resolve({ type, id }),
  });
}

describe('M3.2 / documents download', () => {
  it('M3.2/document_download_rapport_ok — select exact + clé R2 présignée', async () => {
    setupAuth('gestionnaire_lieux', 'org-g');
    rls.push({
      data: {
        id: 'r1',
        disponible_a: '2020-01-01T00:00:00Z',
        genere_at: '2020-01-02T00:00:00Z',
        pdf_url: 'rapports/r1.pdf',
      },
      error: null,
    });
    const res = await callDownload('rapport', 'r1');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url?: string }).url).toBe(
      'https://r2.example/signed',
    );
    expect(rls.__calls.from).toEqual([['rapports_rse']]);
    expect(rls.__calls.select).toEqual([
      ['id, disponible_a, genere_at, pdf_url'],
    ]);
    expect(rls.__calls.eq).toEqual([['id', 'r1']]);
    expect(mockPresign).toHaveBeenCalledWith('rapports/r1.pdf', 900);
  });

  it('M3.2/document_download_attestation_ok — select exact + clé R2 présignée', async () => {
    setupAuth('gestionnaire_lieux', 'org-g');
    rls.push({
      data: {
        id: 'a1',
        genere_at: '2020-01-02T00:00:00Z',
        pdf_url: 'attestations/a1.pdf',
      },
      error: null,
    });
    const res = await callDownload('attestation', 'a1');
    expect(res.status).toBe(200);
    expect(rls.__calls.from).toEqual([['attestations_don']]);
    expect(rls.__calls.select).toEqual([['id, genere_at, pdf_url']]);
    expect(mockPresign).toHaveBeenCalledWith('attestations/a1.pdf', 900);
  });

  it('M3.2/document_embargo_h24_refuse — 425 si disponible_a dans le futur', async () => {
    setupAuth('gestionnaire_lieux', 'org-g');
    rls.push({
      data: {
        id: 'r1',
        disponible_a: '2999-01-01T00:00:00Z',
        genere_at: '2020-01-02T00:00:00Z',
        pdf_url: 'rapports/r1.pdf',
      },
      error: null,
    });
    const res = await callDownload('rapport', 'r1');
    expect(res.status).toBe(425);
    expect(((await res.json()) as { disponible_a?: string }).disponible_a).toBe(
      '2999-01-01T00:00:00Z',
    );
    expect(mockPresign).not.toHaveBeenCalled();
  });

  it('M3.2/document_hors_perimetre_404 — ligne non visible (RLS) → 404', async () => {
    setupAuth('gestionnaire_lieux', 'org-g');
    rls.push({ data: null, error: null });
    const res = await callDownload('attestation', 'a-autre-lieu');
    expect(res.status).toBe(404);
    expect(mockPresign).not.toHaveBeenCalled();
  });

  it('M3.2/document_non_genere_202 — genere_at NULL → 202 sans URL', async () => {
    setupAuth('gestionnaire_lieux', 'org-g');
    rls.push({
      data: { id: 'a1', genere_at: null, pdf_url: null },
      error: null,
    });
    const res = await callDownload('attestation', 'a1');
    expect(res.status).toBe(202);
    expect(mockPresign).not.toHaveBeenCalled();
  });

  it('M3.2/document_type_inconnu_400 — bordereau/facture non servis ici', async () => {
    setupAuth('gestionnaire_lieux', 'org-g');
    const res = await callDownload('bordereau', 'b1');
    expect(res.status).toBe(400);
    expect(rls.__calls.from).toBeUndefined();
  });

  it('M3.2/document_role_non_gestionnaire_403 — client_organisateur bloqué', async () => {
    setupAuth('client_organisateur', 'org-o');
    const res = await callDownload('rapport', 'r1');
    expect(res.status).toBe(403);
    expect(rls.__calls.from).toBeUndefined();
  });
});

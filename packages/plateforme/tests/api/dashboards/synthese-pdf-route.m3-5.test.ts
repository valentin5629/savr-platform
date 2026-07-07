/**
 * M3.5 — Route POST /api/v1/dashboards/synthese-pdf (Bloc 8 export synthèse,
 * BL-P1-PARITE-02). Génération SYNCHRONE : la route rend via Railway le
 * type_document 'synthese-dashboard', dépose un objet R2 éphémère et renvoie une
 * URL pré-signée 1h. Couvre le contrat (type_document, upload R2, presign, réponse),
 * la garde d'auth (rôle), le clamp de borne future et la propagation d'erreur.
 * Le snapshot (agrégation/scoping) est testé à part (synthese-snapshot.m3.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const generatePdf = vi.fn();
const uploadPdf = vi.fn();
const getPresignedUrl = vi.fn();
const buildSyntheseSnapshot = vi.fn();
const orgMaybeSingle = vi.fn();
let authResult: unknown;

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: vi.fn(async () => authResult),
  createSupabaseServerClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: orgMaybeSingle }) }),
    }),
  }),
}));
vi.mock('@/lib/dashboards/synthese-snapshot.js', () => ({
  buildSyntheseSnapshot: (...a: unknown[]) => buildSyntheseSnapshot(...a),
}));
vi.mock('@/lib/pdf/railway-client.js', () => ({
  generatePdf: (...a: unknown[]) => generatePdf(...a),
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  uploadPdf: (...a: unknown[]) => uploadPdf(...a),
  getPresignedUrl: (...a: unknown[]) => getPresignedUrl(...a),
}));

const SNAPSHOT = {
  organisation_nom: 'Traiteur SA',
  nb_collectes: 2,
  detail: [],
};

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/dashboards/synthese-pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callPost(req: NextRequest) {
  const { POST } =
    await import('@/app/api/v1/dashboards/synthese-pdf/route.js');
  return POST(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  authResult = {
    ctx: { userId: 'u1', role: 'traiteur_manager', organisationId: 'org-1' },
  };
  orgMaybeSingle.mockResolvedValue({
    data: { nom: 'Traiteur SA' },
    error: null,
  });
  buildSyntheseSnapshot.mockResolvedValue(SNAPSHOT);
  generatePdf.mockResolvedValue({ pdfBuffer: Buffer.from('%PDF-1.4') });
  uploadPdf.mockResolvedValue('rapports/synthese/org-1/abc.pdf');
  getPresignedUrl.mockResolvedValue('https://r2.example/signed?token=x');
});

describe('M3.5 / route synthèse PDF — génération synchrone', () => {
  it('rend synthese-dashboard, dépose sur R2 et renvoie une URL pré-signée 1h', async () => {
    const res = await callPost(
      post({ from: '2026-01-01', to: '2026-06-30', types: ['zero_dechet'] }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { url: string; expires_in: number };
    expect(json.url).toBe('https://r2.example/signed?token=x');
    expect(json.expires_in).toBe(3600);

    // Contrat renderer : type_document 'synthese-dashboard' + snapshot en payload.
    expect(generatePdf).toHaveBeenCalledWith('synthese-dashboard', SNAPSHOT);
    // Objet R2 éphémère sous préfixe synthese/<org>/ (pas d'archivage DB).
    expect(uploadPdf).toHaveBeenCalledWith(
      'rapports',
      expect.stringMatching(/^synthese\/org-1\//),
      expect.any(Buffer),
    );
    expect(getPresignedUrl).toHaveBeenCalledWith(
      'rapports/synthese/org-1/abc.pdf',
      3600,
    );
    // Type figé propagé au snapshot.
    expect(buildSyntheseSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        role: 'traiteur_manager',
        organisationId: 'org-1',
      }),
      expect.objectContaining({ types: ['zero_dechet'] }),
      expect.anything(),
    );
  });

  it('rôle non autorisé → 403, aucun rendu', async () => {
    authResult = {
      error: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    };
    const res = await callPost(post({ from: '2026-01-01', to: '2026-06-30' }));
    expect(res.status).toBe(403);
    expect(generatePdf).not.toHaveBeenCalled();
  });

  it('borne future interdite : `to` ramené à aujourd’hui (§1.6)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await callPost(post({ from: '2026-01-01', to: '2999-01-01' }));
    const params = buildSyntheseSnapshot.mock.calls[0]?.[2] as { to: string };
    expect(params.to).toBe(today);
  });

  it('échec du renderer Railway → 502', async () => {
    generatePdf.mockRejectedValue(new Error('Railway PDF 500'));
    const res = await callPost(post({ from: '2026-01-01', to: '2026-06-30' }));
    expect(res.status).toBe(502);
  });

  it('filtres Client organisateur + Commercial propagés au snapshot (§1.6 étape 2)', async () => {
    await callPost(
      post({
        from: '2026-01-01',
        to: '2026-06-30',
        types: ['zero_dechet'],
        client_organisateur_ids: ['cli-1', 'cli-2'],
        commercial_ids: ['com-1'],
      }),
    );
    const params = buildSyntheseSnapshot.mock.calls[0]?.[2] as {
      clientOrgaIds: string[];
      commercialIds: string[];
    };
    expect(params.clientOrgaIds).toEqual(['cli-1', 'cli-2']);
    expect(params.commercialIds).toEqual(['com-1']);
  });
});

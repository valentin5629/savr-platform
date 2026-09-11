/**
 * M3.5 — Route POST /api/v1/dashboards/synthese-pdf (Bloc 8 export synthèse,
 * BL-P1-PARITE-02). Génération SYNCHRONE : la route rend via Railway le
 * type_document 'synthese-dashboard', dépose un objet R2 éphémère et renvoie une
 * URL pré-signée 1h. Couvre le contrat (type_document, upload R2, presign, réponse),
 * la garde d'auth (rôle), le clamp de borne future et les erreurs (message
 * générique au client, détail en log serveur, seule la ref Railway propagée).
 * Le snapshot (agrégation/scoping) est testé à part (synthese-snapshot.m3.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const generatePdf = vi.fn();
const uploadPdf = vi.fn();
const getPresignedUrl = vi.fn();
const getObjectBytes = vi.fn();
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
  getObjectBytes: (...a: unknown[]) => getObjectBytes(...a),
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
    data: { nom: 'Traiteur SA', logo_url: 'logos-savr/logos/org1.png' },
    error: null,
  });
  buildSyntheseSnapshot.mockResolvedValue(SNAPSHOT);
  generatePdf.mockResolvedValue({ pdfBuffer: Buffer.from('%PDF-1.4') });
  uploadPdf.mockResolvedValue('rapports/synthese/org-1/abc.pdf');
  getPresignedUrl.mockResolvedValue('https://r2.example/signed?token=x');
  getObjectBytes.mockResolvedValue(Buffer.from([1, 2, 3]));
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

    // Contrat renderer : type_document 'synthese-dashboard' + snapshot en payload,
    // enrichi du logo de l'org inliné en data URI (BL-P3-05, §1.6 l.283).
    expect(getObjectBytes).toHaveBeenCalledWith('logos-savr/logos/org1.png');
    expect(generatePdf).toHaveBeenCalledWith('synthese-dashboard', {
      ...SNAPSHOT,
      logo_data_uri: `data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`,
    });
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

// Les messages internes (PostgREST, variables d'env du client Railway, SDK R2,
// corps du renderer) ne quittent jamais le serveur : réponse générique, détail
// dans le log `api_route.error` (§07/02).
describe('M3.5 / route synthèse PDF — erreurs sans fuite de détail interne', () => {
  const GENERIQUE = 'La génération a échoué. Réessayez.';
  const REF = '0b9c6f2e-3d4a-4f1b-9e8c-7a6b5c4d3e2f';
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  function loggedEntries(): {
    level: string;
    event: string;
    org_id: string | null;
    actor_role: string | null;
    payload: Record<string, unknown>;
  }[] {
    return logSpy.mock.calls.map((c) => JSON.parse(c[0] as string));
  }

  async function expectGenericBody(
    res: NextResponse,
    status: number,
    secrets: string[],
  ): Promise<Record<string, unknown>> {
    expect(res.status).toBe(status);
    const text = await res.text();
    for (const s of secrets) expect(text).not.toContain(s);
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body['error']).toBe(GENERIQUE);
    return body;
  }

  it('agrégation KO (message PostgREST) → 500 générique, détail loggé', async () => {
    const detail =
      'column collectes.poids_interne does not exist (relation "plateforme.collecte_flux")';
    buildSyntheseSnapshot.mockRejectedValue(new Error(detail));
    const res = await callPost(post({ from: '2026-01-01', to: '2026-06-30' }));
    const body = await expectGenericBody(res, 500, [
      'poids_interne',
      'collecte_flux',
      'column',
    ]);
    expect(Object.keys(body)).toEqual(['error']);
    expect(generatePdf).not.toHaveBeenCalled();

    const [entry] = loggedEntries();
    expect(entry).toMatchObject({
      level: 'error',
      event: 'api_route.error',
      org_id: 'org-1',
      actor_role: 'traiteur_manager',
      payload: {
        route: '/api/v1/dashboards/synthese-pdf',
        error_code: 'synthese_agregation_failed',
        message: detail,
      },
    });
  });

  it.each([
    ['RAILWAY_PDF_SECRET manquant', 'variable d’env du client Railway'],
    ['RAILWAY_PDF_URL manquant', 'variable d’env du client Railway'],
    [
      'Railway PDF 500: Error: Protocol error (Page.printToPDF): Target closed at /app/node_modules/puppeteer-core',
      'corps texte d’un renderer non durci',
    ],
  ])('rendu KO « %s » (%s) → 502 générique, sans ref', async (detail) => {
    generatePdf.mockRejectedValue(new Error(detail));
    const res = await callPost(post({ from: '2026-01-01', to: '2026-06-30' }));
    const body = await expectGenericBody(res, 502, [
      'RAILWAY',
      'Railway',
      'puppeteer',
      'Protocol',
    ]);
    expect(Object.keys(body)).toEqual(['error']);
    expect(uploadPdf).not.toHaveBeenCalled();

    const [entry] = loggedEntries();
    expect(entry?.event).toBe('api_route.error');
    expect(entry?.payload).toMatchObject({
      error_code: 'synthese_rendu_failed',
      message: detail,
    });
    expect(entry?.payload).not.toHaveProperty('ref');
  });

  it('upload R2 KO (message SDK) → 502 générique', async () => {
    uploadPdf.mockRejectedValue(
      new Error(
        'R2 upload failed 403: <Error><Code>AccessDenied</Code><BucketName>savr-rapports</BucketName></Error>',
      ),
    );
    const res = await callPost(post({ from: '2026-01-01', to: '2026-06-30' }));
    await expectGenericBody(res, 502, ['AccessDenied', 'savr-rapports', 'R2']);
    expect(getPresignedUrl).not.toHaveBeenCalled();
    expect(loggedEntries()[0]?.payload['message']).toContain('AccessDenied');
  });

  it('URL pré-signée KO → 502 générique', async () => {
    getPresignedUrl.mockRejectedValue(
      new Error('Resolved credential object is not valid'),
    );
    const res = await callPost(post({ from: '2026-01-01', to: '2026-06-30' }));
    await expectGenericBody(res, 502, ['credential']);
  });

  it('renderer durci {error, ref} → 502 générique + ref propagée (support)', async () => {
    generatePdf.mockRejectedValue(
      new Error(`Railway PDF 500: {"error":"render_error","ref":"${REF}"}`),
    );
    const res = await callPost(post({ from: '2026-01-01', to: '2026-06-30' }));
    const body = await expectGenericBody(res, 502, ['render_error', 'Railway']);
    expect(body).toEqual({ error: GENERIQUE, ref: REF });
    expect(loggedEntries()[0]?.payload).toMatchObject({
      error_code: 'synthese_rendu_failed',
      ref: REF,
    });
  });

  it('ref non-UUID dans le corps Railway → ignorée (jamais recopiée)', async () => {
    generatePdf.mockRejectedValue(
      new Error(
        'Railway PDF 500: {"error":"render_error","ref":"RAILWAY_PDF_SECRET=abc"}',
      ),
    );
    const res = await callPost(post({ from: '2026-01-01', to: '2026-06-30' }));
    const body = await expectGenericBody(res, 502, ['RAILWAY_PDF_SECRET']);
    expect(Object.keys(body)).toEqual(['error']);
  });
});

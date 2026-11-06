/**
 * M1.6 — Rapport de recyclage ZD fabriqué au clic depuis l'onglet Documents de la
 * fiche collecte Admin (décision Val 2026-10-16) : POST
 * /api/v1/admin/collectes/[id]/rapport-rse, avec ou sans le radar de comparaison.
 *
 * Filtres envoyés par l'écran (radar de l'onglet) : utilisés tels quels. Sans
 * filtres, le radar compare au segment de la collecte. Il est calculé par la
 * fonction de l'écran, sous l'identité de l'appelant (k-anonymat compris) : ce
 * PDF est celui que le client télécharge.
 *
 * + les anciennes voies du rapport ZD stocké (régénération, téléchargement d'un
 *   fichier) le refusent ; GET …/documents dit s'il est téléchargeable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeClient() {
  const results: Record<string, Result> = {};
  const lues: string[] = [];
  function chain(table: string): Record<string, unknown> {
    const res = (): Result => results[table] ?? { data: null, error: null };
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      is: () => c,
      like: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => Promise.resolve(res()),
      single: () => Promise.resolve(res()),
      then: (resolve: (v: Result) => unknown) => resolve(res()),
    };
    return c;
  }
  const from = (t: string) => {
    lues.push(t);
    return chain(t);
  };
  return { from, schema: () => ({ from }), results, lues };
}

let rls = makeClient();
let admin = makeClient();
const mockRequireStaff = vi.fn();
const mockPayload = vi.fn();
const mockPdf = vi.fn();
const mockRadar = vi.fn();
const mockRegen = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireStaff: (...a: unknown[]) => mockRequireStaff(...a),
  createSupabaseServerClient: () => rls,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@/lib/pdf/payload-rapport.js', () => ({
  construirePayloadRapport: (...a: unknown[]) => mockPayload(...a),
}));
vi.mock('@/lib/pdf/railway-client.js', () => ({
  generatePdf: (...a: unknown[]) => mockPdf(...a),
}));
vi.mock('@/lib/pdf/regenerate.js', () => ({
  regenerateCollecteDocument: (...a: unknown[]) => mockRegen(...a),
}));
// Le calcul du radar est simulé ; les filtres par défaut (filtresRadarParDefaut)
// et leur lecture (lireFiltresRadar) restent les vrais.
vi.mock('@/lib/pdf/rapport-radar.js', async (orig) => ({
  ...(await orig<typeof import('@/lib/pdf/rapport-radar.js')>()),
  construireRadarRapport: (...a: unknown[]) => mockRadar(...a),
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getPresignedUrl: () => Promise.resolve('https://r2/x'),
}));

const TYPE_ID = '11111111-1111-4111-8111-111111111111';
const RADAR = {
  benchmark_flux: [
    {
      flux_code: 'biodechet',
      flux_nom: 'Biodéchets',
      collecte_kg_pax: 0.21,
      benchmark_kg_pax: 0.24,
    },
  ],
  benchmark_legende: 'période 13/10/2024 → 13/10/2026 · lieux : tous',
  filtres_benchmark: {
    periode_debut: '2024-10-13',
    periode_fin: '2026-10-13',
    lieu_ids: null,
    type_evenement_ids: [TYPE_ID],
    taille_evenement_codes: ['M'],
  },
};

function post(corps?: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/x',
    corps === undefined
      ? { method: 'POST' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: typeof corps === 'string' ? corps : JSON.stringify(corps),
        },
  );
}

async function rapport(corps?: unknown) {
  const { POST } =
    await import('@/app/api/v1/admin/collectes/[id]/rapport-rse/route.js');
  return POST(post(corps), { params: Promise.resolve({ id: 'c1' }) });
}

/**
 * Collecte ZD de 600 convives (taille M), type connu, rapport sorti d'embargo.
 * Le type d'événement (lot B1, décision Val 2026-10-23) et la taille (lot C1,
 * C4 du 2026-10-20) sont ceux de LA collecte ; piège : l'événement porte le type
 * de sa collecte n°1, qui diffère, et 1 500 convives sur deux soirées (XL).
 */
const TYPE_COLLECTE_N1 = '22222222-2222-4222-8222-222222222222';
function collecteDisponible() {
  admin.results.collectes = {
    data: {
      id: 'c1',
      type: 'zero_dechet',
      type_evenement_id: TYPE_ID,
      pax: 600,
      evenements: { pax: 1500, type_evenement_id: TYPE_COLLECTE_N1 },
    },
    error: null,
  };
  admin.results.rapports_rse = {
    data: { disponible_a: '2020-01-01T00:00:00Z' },
    error: null,
  };
}

const payloadRendu = () => mockPdf.mock.calls[0]![1] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  mockRequireStaff.mockResolvedValue({
    ctx: { userId: 'admin-1', role: 'admin_savr', organisationId: null },
  });
  mockPayload.mockImplementation(async () => ({
    ok: true,
    payload: {
      nom_evenement: 'Gala',
      options: { benchmark: false },
      bordereau: { date_collecte: '28/09/2026' },
    },
    dateCollecte: '28/09/2026',
  }));
  mockPdf.mockResolvedValue({ pdfBuffer: Buffer.from('%PDF admin') });
  mockRadar.mockResolvedValue({ etat: 'ok', radar: RADAR });
  mockRegen.mockResolvedValue({ ok: true, jobId: 'j', type: 'bordereau-zd' });
});

describe('M1.6 / rapport fabriqué au clic par l’Admin — avec ou sans radar', () => {
  it('sans radar → le PDF, sans lire le parc ; rien n’est écrit sur le rapport', async () => {
    collecteDisponible();
    const res = await rapport({ options: { benchmark: false } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(mockRadar).not.toHaveBeenCalled();
    expect(payloadRendu().options).toEqual({ benchmark: false });
    expect(mockPayload).toHaveBeenCalledWith(admin, rls, 'c1');
  });

  it('radar coché sans filtres (aucun radar à l’écran) → segment de la collecte, calculé sous l’identité de l’appelant', async () => {
    collecteDisponible();
    const res = await rapport({ options: { benchmark: true } });
    expect(res.status).toBe(200);
    const [client, ctx, id, filtres] = mockRadar.mock.calls[0]!;
    // Client de la session (RLS), jamais le service-role : le k-anonymat de la
    // fonction du parc s'applique à l'Admin comme aux clients.
    expect(client).toBe(rls);
    expect(client).not.toBe(admin);
    expect(ctx).toMatchObject({ userId: 'admin-1', role: 'admin_savr' });
    expect(id).toBe('c1');
    expect(filtres).toEqual({
      lieu_ids: [],
      type_evenement_ids: [TYPE_ID],
      taille_evenement_codes: ['M'],
    });
    expect(payloadRendu()).toMatchObject({
      options: { benchmark: true },
      benchmark_flux: RADAR.benchmark_flux,
    });
  });

  it('filtres du radar de l’onglet → utilisés tels quels, validés comme ceux des clients', async () => {
    collecteDisponible();
    await rapport({
      options: { benchmark: true },
      benchmark_filters: { taille_evenement_codes: ['XL'] },
    });
    expect(mockRadar.mock.calls[0]![3]).toEqual({
      lieu_ids: [],
      type_evenement_ids: [],
      taille_evenement_codes: ['XL'],
    });
    const invalide = await rapport({
      options: { benchmark: true },
      benchmark_filters: { lieu_ids: ['pas-un-uuid'] },
    });
    expect(invalide.status).toBe(422);
  });

  it('collecte sans type ni convives connus (0) → filtres vides (le calcul dira s’il y a de quoi comparer)', async () => {
    collecteDisponible();
    admin.results.collectes = {
      data: {
        id: 'c1',
        type: 'zero_dechet',
        type_evenement_id: null,
        pax: 0,
        evenements: [{ pax: 400 }],
      },
      error: null,
    };
    await rapport({ options: { benchmark: true } });
    expect(mockRadar.mock.calls[0]![3]).toEqual({
      lieu_ids: [],
      type_evenement_ids: [],
      taille_evenement_codes: [],
    });
  });

  it('embargo, collecte AG, rapport absent → refusés avant toute fabrication', async () => {
    collecteDisponible();
    admin.results.rapports_rse = {
      data: { disponible_a: '2999-01-01T00:00:00Z' },
      error: null,
    };
    expect((await rapport()).status).toBe(425);

    collecteDisponible();
    admin.results.collectes = {
      data: { id: 'c1', type: 'anti_gaspi' },
      error: null,
    };
    expect((await rapport()).status).toBe(409);

    collecteDisponible();
    admin.results.rapports_rse = { data: null, error: null };
    expect((await rapport()).status).toBe(404);

    admin.results.collectes = { data: null, error: null };
    expect((await rapport()).status).toBe(404);
    expect(mockPdf).not.toHaveBeenCalled();
  });

  it('lecture en échec → 500 générique ; rien à comparer → 422 dit en clair', async () => {
    collecteDisponible();
    admin.results.rapports_rse = {
      data: null,
      error: { message: 'relation "rapports_rse" does not exist' },
    };
    const panne = await rapport({ options: { benchmark: true } });
    expect(panne.status).toBe(500);
    expect(await panne.json()).toEqual({ error: 'Erreur serveur' });

    collecteDisponible();
    mockRadar.mockResolvedValueOnce({
      etat: 'ok',
      radar: {
        ...RADAR,
        benchmark_flux: RADAR.benchmark_flux.map((g) => ({
          ...g,
          collecte_kg_pax: null,
        })),
      },
    });
    const vide = await rapport({ options: { benchmark: true } });
    expect(vide.status).toBe(422);
    expect(await vide.json()).toEqual({
      error: 'La comparaison au parc n’est pas disponible pour cette collecte.',
    });
    expect(mockPdf).not.toHaveBeenCalled();
  });

  it('rôle non staff : refus de requireStaff relayé tel quel, rien n’est lu', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireStaff.mockResolvedValue({
      error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }),
    });
    const res = await rapport({ options: { benchmark: true } });
    expect(res.status).toBe(403);
    expect(admin.lues).toEqual([]);
    expect(mockRadar).not.toHaveBeenCalled();
    expect(mockPdf).not.toHaveBeenCalled();
  });
});

describe('M1.6 / rapport ZD : les anciennes voies du fichier stocké le refusent', () => {
  it('régénération Admin d’un rapport ZD → 409, rien n’est mis en file ; les autres documents restent régénérables', async () => {
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/documents/[type]/regenerate/route.js');
    // Réponse réelle du pipeline pour ce type (cf. collectes-documents.m0-6).
    mockRegen.mockResolvedValueOnce({
      ok: false,
      code: 'NO_DOCUMENT',
      message: 'type_document non régénérable : rapport-recyclage-zd',
    });
    const res = await POST(post({ options: { benchmark: true } }), {
      params: Promise.resolve({ id: 'c1', type: 'rapport-recyclage-zd' }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'type_document non régénérable : rapport-recyclage-zd',
    });
    expect(mockRadar).not.toHaveBeenCalled();
    // Plus de 5e argument « version » : le pipeline ne connaît plus le radar.
    expect(mockRegen.mock.calls[0]).toHaveLength(4);
  });

  it('téléchargement Admin du fichier stocké d’un rapport ZD → 409 vers l’onglet Documents', async () => {
    const { GET } =
      await import('@/app/api/v1/admin/rapports-rse/[id]/download/route.js');
    admin.results.rapports_rse = {
      data: {
        id: 'r1',
        collecte_id: 'c1',
        disponible_a: '2020-01-01T00:00:00Z',
        genere_at: '2020-01-01T06:00:00Z',
        pdf_url: 'savr-dev/rapports/r1/ancien.pdf',
      },
      error: null,
    };
    admin.results.collectes = { data: { type: 'zero_dechet' }, error: null };
    const res = await GET(new NextRequest('http://localhost/x'), {
      params: Promise.resolve({ id: 'r1' }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error:
        'Le rapport de recyclage se télécharge depuis l’onglet Documents de la collecte.',
    });
  });
});

describe('M1.6 / GET admin/collectes/[id]/documents — rapport téléchargeable', () => {
  async function documents() {
    const { GET } =
      await import('@/app/api/v1/admin/collectes/[id]/documents/route.js');
    const res = await GET(new NextRequest('http://localhost/x'), {
      params: Promise.resolve({ id: 'c1' }),
    });
    return (await res.json()) as { rapport: Record<string, unknown> | null };
  }
  const ligne = (disponible_a: string, genere_at: string | null) => ({
    data: { id: 'r1', version: 1, disponible_a, genere_at },
    error: null,
  });

  it('ZD : fin d’embargo = téléchargeable, sans PDF préalable ; avant = non', async () => {
    admin.results.collectes = { data: { type: 'zero_dechet' }, error: null };
    admin.results.rapports_rse = ligne('2020-01-01T00:00:00Z', null);
    expect((await documents()).rapport).toMatchObject({
      id: 'r1',
      disponible: true,
    });
    admin.results.rapports_rse = ligne('2999-01-01T00:00:00Z', null);
    expect((await documents()).rapport).toMatchObject({ disponible: false });
  });

  it('AG sans excédent : fichier stocké, téléchargeable une fois fabriqué ; aucun rapport → null', async () => {
    admin.results.collectes = { data: { type: 'anti_gaspi' }, error: null };
    admin.results.rapports_rse = ligne('2020-01-01T00:00:00Z', null);
    expect((await documents()).rapport).toMatchObject({ disponible: false });
    admin.results.rapports_rse = ligne(
      '2020-01-01T00:00:00Z',
      '2020-01-01T00:00:00Z',
    );
    expect((await documents()).rapport).toMatchObject({ disponible: true });
    admin.results.rapports_rse = { data: null, error: null };
    expect((await documents()).rapport).toBeNull();
  });
});

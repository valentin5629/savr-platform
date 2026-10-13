/**
 * M1.6 — Régénération du rapport de recyclage par l'Admin : choix de la version,
 * avec ou sans le radar de comparaison (décision Val 2026-10-13).
 *
 * L'Admin n'a pas de barre de filtres : le radar reprend les filtres figés du
 * rapport en vigueur, sinon le segment de la collecte. Il est calculé par la
 * fonction de l'écran, sous l'identité de l'appelant (k-anonymat compris) : ce
 * PDF est celui que le client télécharge.
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
const mockRegen = vi.fn();
const mockRadar = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireStaff: (...a: unknown[]) => mockRequireStaff(...a),
  createSupabaseServerClient: () => rls,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@/lib/pdf/regenerate.js', () => ({
  regenerateCollecteDocument: (...a: unknown[]) => mockRegen(...a),
}));
// Le calcul du radar est simulé ; le choix des filtres par défaut
// (filtresRadarParDefaut) et leur lecture (lireFiltresRadar) restent les vrais.
vi.mock('@/lib/pdf/rapport-radar.js', async (orig) => ({
  ...(await orig<typeof import('@/lib/pdf/rapport-radar.js')>()),
  construireRadarRapport: (...a: unknown[]) => mockRadar(...a),
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getPresignedUrl: () => Promise.resolve('https://r2/x'),
}));

const TYPE_ID = '11111111-1111-4111-8111-111111111111';
const LIEU_ID = '22222222-2222-4222-8222-222222222222';
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

async function regen(type = 'rapport-recyclage-zd', corps?: unknown) {
  const { POST } =
    await import('@/app/api/v1/admin/collectes/[id]/documents/[type]/regenerate/route.js');
  return POST(
    new NextRequest(
      'http://localhost/x',
      corps === undefined
        ? { method: 'POST' }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: typeof corps === 'string' ? corps : JSON.stringify(corps),
          },
    ),
    { params: Promise.resolve({ id: 'c1', type }) },
  );
}

/** Collecte de 600 convives (taille M), type d'événement connu, rapport sans radar. */
function collecteSansRadar() {
  admin.results.rapports_rse = {
    data: { filtres_benchmark: null },
    error: null,
  };
  admin.results.collectes = {
    data: { evenements: { pax: 600, type_evenement_id: TYPE_ID } },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  mockRequireStaff.mockResolvedValue({
    ctx: { userId: 'admin-1', role: 'admin_savr', organisationId: null },
  });
  mockRegen.mockResolvedValue({
    ok: true,
    jobId: 'job-9',
    type: 'rapport-recyclage-zd',
  });
  mockRadar.mockResolvedValue({ etat: 'ok', radar: RADAR });
});

describe('M1.6 / régénération Admin du rapport de recyclage — choix de la version (avec ou sans radar)', () => {
  it('sans corps → reproduction du dernier rendu : aucune version, le parc n’est pas lu', async () => {
    const res = await regen();
    expect(res.status).toBe(202);
    expect(mockRadar).not.toHaveBeenCalled();
    expect(mockRegen).toHaveBeenCalledWith(
      admin,
      'c1',
      'rapport-recyclage-zd',
      { userId: 'admin-1', role: 'admin_savr' },
      undefined,
    );
  });

  it('radar décoché → version sans radar, le parc n’est pas lu', async () => {
    const res = await regen('rapport-recyclage-zd', {
      options: { benchmark: false },
    });
    expect(res.status).toBe(202);
    expect(mockRadar).not.toHaveBeenCalled();
    expect(mockRegen.mock.calls[0]![4]).toEqual({ avecRadar: false });
  });

  it('radar coché, rapport sans radar → segment de la collecte (type + taille, tous lieux), calculé sous l’identité de l’appelant', async () => {
    collecteSansRadar();
    const res = await regen('rapport-recyclage-zd', {
      options: { benchmark: true },
    });
    expect(res.status).toBe(202);
    expect(mockRadar).toHaveBeenCalledTimes(1);
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
    expect(mockRegen.mock.calls[0]![4]).toEqual({
      avecRadar: true,
      radar: RADAR,
    });
  });

  it('radar coché, rapport déjà avec radar → les filtres figés par le client sont conservés', async () => {
    collecteSansRadar();
    admin.results.rapports_rse = {
      data: {
        filtres_benchmark: {
          periode_debut: '2024-10-01',
          periode_fin: '2026-10-01',
          lieu_ids: [LIEU_ID],
          type_evenement_ids: null,
          taille_evenement_codes: ['S', 'M'],
        },
      },
      error: null,
    };
    await regen('rapport-recyclage-zd', { options: { benchmark: true } });
    expect(mockRadar.mock.calls[0]![3]).toEqual({
      lieu_ids: [LIEU_ID],
      type_evenement_ids: [],
      taille_evenement_codes: ['S', 'M'],
    });
    // Les filtres figés suffisent : l'événement n'est pas relu.
    expect(admin.lues).not.toContain('collectes');
  });

  it('snapshot d’époque sans forme reconnue (« {} ») → segment de la collecte, jamais « Tous » par défaut', async () => {
    collecteSansRadar();
    admin.results.rapports_rse = {
      data: { filtres_benchmark: {} },
      error: null,
    };
    await regen('rapport-recyclage-zd', { options: { benchmark: true } });
    expect(mockRadar.mock.calls[0]![3]).toEqual({
      lieu_ids: [],
      type_evenement_ids: [TYPE_ID],
      taille_evenement_codes: ['M'],
    });
  });

  it('événement sans type ni convives → filtres vides (le calcul dira s’il y a de quoi comparer)', async () => {
    admin.results.collectes = {
      data: { evenements: [{ pax: null, type_evenement_id: null }] },
      error: null,
    };
    await regen('rapport-recyclage-zd', { options: { benchmark: true } });
    expect(mockRadar.mock.calls[0]![3]).toEqual({
      lieu_ids: [],
      type_evenement_ids: [],
      taille_evenement_codes: [],
    });
  });

  it('filtres fournis dans le corps → utilisés tels quels, validés comme ceux des clients', async () => {
    collecteSansRadar();
    await regen('rapport-recyclage-zd', {
      options: { benchmark: true },
      benchmark_filters: { taille_evenement_codes: ['XL'] },
    });
    expect(mockRadar.mock.calls[0]![3]).toEqual({
      lieu_ids: [],
      type_evenement_ids: [],
      taille_evenement_codes: ['XL'],
    });
    expect(admin.lues).toEqual([]);

    const invalide = await regen('rapport-recyclage-zd', {
      options: { benchmark: true },
      benchmark_filters: { lieu_ids: ['pas-un-uuid'] },
    });
    expect(invalide.status).toBe(422);
  });

  it('rien à comparer ou lecture en échec → refus clair, rien n’est régénéré', async () => {
    collecteSansRadar();
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
    const vide = await regen('rapport-recyclage-zd', {
      options: { benchmark: true },
    });
    expect(vide.status).toBe(422);
    expect(await vide.json()).toEqual({
      error: 'La comparaison au parc n’est pas disponible pour cette collecte.',
    });

    // Filtres par défaut illisibles : 500 générique, pas un radar sur « Tous ».
    admin.results.rapports_rse = {
      data: null,
      error: { message: 'relation "rapports_rse" does not exist' },
    };
    const panne = await regen('rapport-recyclage-zd', {
      options: { benchmark: true },
    });
    expect(panne.status).toBe(500);
    expect(await panne.json()).toEqual({ error: 'Erreur serveur' });

    const corpsInvalide = await regen('rapport-recyclage-zd', {
      options: { benchmark: 'oui' },
    });
    expect(corpsInvalide.status).toBe(422);
    expect((await regen('rapport-recyclage-zd', '{pas du json')).status).toBe(
      400,
    );

    expect(mockRegen).not.toHaveBeenCalled();
  });

  it('autres documents : le corps est ignoré, aucune version, le parc n’est pas lu', async () => {
    for (const type of [
      'bordereau-zd',
      'attestation-don',
      'rapport-evenement-sans-excedent',
    ]) {
      mockRegen.mockClear();
      const res = await regen(type, { options: { benchmark: true } });
      expect(res.status).toBe(202);
      expect(mockRegen.mock.calls[0]![2]).toBe(type);
      expect(mockRegen.mock.calls[0]![4]).toBeUndefined();
    }
    expect(mockRadar).not.toHaveBeenCalled();
    expect(admin.lues).toEqual([]);
  });

  it('rôle non staff : refus de requireStaff relayé tel quel, rien n’est lu', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireStaff.mockResolvedValue({
      error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }),
    });
    const res = await regen('rapport-recyclage-zd', {
      options: { benchmark: true },
    });
    expect(res.status).toBe(403);
    expect(mockRadar).not.toHaveBeenCalled();
    expect(mockRegen).not.toHaveBeenCalled();
  });
});

describe('M1.6 / GET admin/collectes/[id]/documents — version en vigueur du rapport', () => {
  async function documents() {
    const { GET } =
      await import('@/app/api/v1/admin/collectes/[id]/documents/route.js');
    const res = await GET(new NextRequest('http://localhost/x'), {
      params: Promise.resolve({ id: 'c1' }),
    });
    return (await res.json()) as { rapport: Record<string, unknown> | null };
  }
  const ligne = (filtres_benchmark: unknown) => ({
    data: { id: 'r1', version: 2, genere_at: '2026-10-13', filtres_benchmark },
    error: null,
  });

  it('filtres figés → avec_radar vrai ; NULL → faux ; les filtres eux-mêmes ne sortent pas', async () => {
    admin.results.rapports_rse = ligne({ taille_evenement_codes: ['M'] });
    const avec = await documents();
    expect(avec.rapport).toMatchObject({ id: 'r1', avec_radar: true });
    expect(avec.rapport).not.toHaveProperty('filtres_benchmark');

    admin.results.rapports_rse = ligne(null);
    expect((await documents()).rapport).toMatchObject({ avec_radar: false });
  });

  it('aucun rapport → null', async () => {
    expect((await documents()).rapport).toBeNull();
  });
});

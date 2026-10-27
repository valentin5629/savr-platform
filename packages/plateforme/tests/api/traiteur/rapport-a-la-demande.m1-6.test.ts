/**
 * Rapport de recyclage ZD fabriqué AU CLIC depuis la fiche client (décision Val
 * 2026-10-16) — routes POST /api/v1/{traiteur,agence,gestionnaire}/collectes/[id]/rapport-rse,
 * logique commune `repondreRapportClient`. Plus aucun rapport n'est fabriqué
 * automatiquement : chaque téléchargement fabrique le rapport selon le choix de
 * celui qui clique (avec ou sans radar), rien n'est stocké.
 * + « Rapport de don » d'une collecte AG : fichier stocké, servi par la route GET
 *   …/rapport-rse/download (BL-P2-18 (3), option a).
 *
 * Cloisonnement : cross-org → 403 (test P1 bloquant §12 §1.2). Mock keyé par table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeClient() {
  const results: Record<string, Result> = {};
  const majs: { table: string; valeurs: unknown }[] = [];
  function chain(table: string): Record<string, unknown> {
    const res = (): Result => results[table] ?? { data: null, error: null };
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      is: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => Promise.resolve(res()),
      single: () => Promise.resolve(res()),
      update: (valeurs: unknown) => {
        majs.push({ table, valeurs });
        return c;
      },
      then: (resolve: (v: Result) => unknown) => resolve(res()),
    };
    return c;
  }
  return { from: (t: string) => chain(t), results, majs };
}

let rls = makeClient();
let admin = makeClient();
const mockRequireUser = vi.fn();
const mockPayload = vi.fn();
const mockPdf = vi.fn();
const mockRadar = vi.fn();
const mockPresigned = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
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
// Le radar est calculé sous l'identité du demandeur ; la lecture des filtres
// (lireFiltresRadar) reste la vraie.
vi.mock('@/lib/pdf/rapport-radar.js', async (orig) => ({
  ...(await orig<typeof import('@/lib/pdf/rapport-radar.js')>()),
  construireRadarRapport: (...a: unknown[]) => mockRadar(...a),
}));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getPresignedUrl: (...a: unknown[]) => mockPresigned(...a),
}));

function postReq(corps?: unknown): NextRequest {
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

type Espace = 'traiteur' | 'agence' | 'gestionnaire';

async function rapport(
  corps?: unknown,
  espace: Espace = 'traiteur',
  id = 'c1',
) {
  const { POST } =
    espace === 'traiteur'
      ? await import('@/app/api/v1/traiteur/collectes/[id]/rapport-rse/route.js')
      : espace === 'agence'
        ? await import('@/app/api/v1/agence/collectes/[id]/rapport-rse/route.js')
        : await import('@/app/api/v1/gestionnaire/collectes/[id]/rapport-rse/route.js');
  return POST(postReq(corps), { params: Promise.resolve({ id }) });
}

const PDF = Buffer.from('%PDF-1.7 rapport');
const PAYLOAD = () => ({
  nom_evenement: 'Gala',
  options: { benchmark: false },
  bordereau: { date_collecte: '28/09/2026' },
});

/** Collecte ZD visible, rapport sorti d'embargo, jamais téléchargé par un client. */
function rapportDisponible() {
  rls.results.collectes = {
    data: { id: 'c1', type: 'zero_dechet' },
    error: null,
  };
  rls.results.rapports_rse = {
    data: {
      id: 'r1',
      disponible_a: '2020-01-01T00:00:00Z',
      consulte_par_user_at: null,
    },
    error: null,
  };
}

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
    type_evenement_ids: null,
    taille_evenement_codes: ['M'],
  },
};
const TYPE_ID = '11111111-1111-4111-8111-111111111111';

/** Données envoyées au rendu (2e argument de generatePdf). */
const payloadRendu = () => mockPdf.mock.calls[0]![1] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  mockRequireUser.mockResolvedValue({
    ctx: { userId: 'mgr-1', role: 'traiteur_manager', organisationId: 'org-1' },
  });
  mockPayload.mockImplementation(async () => ({
    ok: true,
    payload: PAYLOAD(),
  }));
  mockPdf.mockResolvedValue({ pdfBuffer: PDF });
  mockRadar.mockResolvedValue({ etat: 'ok', radar: RADAR });
  mockPresigned.mockResolvedValue('https://r2/att.pdf');
});

describe('M1.6 / rapport de recyclage fabriqué au clic — accès (RPT-04)', () => {
  it('collecte visible, embargo levé → le PDF lui-même, en pièce jointe, fabriqué sur les données lues en service-role', async () => {
    rapportDisponible();
    const res = await rapport({ options: { benchmark: false } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="rapport-recyclage-2026-09-28.pdf"',
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    // Données mesurées lues en service-role, une fois l'accès établi.
    expect(mockPayload).toHaveBeenCalledWith(admin, 'c1');
    expect(mockPdf.mock.calls[0]![0]).toBe('rapport-recyclage-zd');
  });

  it('cross-org (collecte existe mais hors périmètre RLS) → 403, rien n’est fabriqué', async () => {
    rls.results.collectes = { data: null, error: null };
    admin.results.collectes = { data: { id: 'c1' }, error: null };
    expect((await rapport()).status).toBe(403);
    expect(mockPayload).not.toHaveBeenCalled();
    expect(mockPdf).not.toHaveBeenCalled();
  });

  it('collecte inexistante → 404', async () => {
    rls.results.collectes = { data: null, error: null };
    admin.results.collectes = { data: null, error: null };
    expect((await rapport()).status).toBe(404);
    expect(mockPdf).not.toHaveBeenCalled();
  });

  it('rôles : chaque espace n’ouvre la route qu’à ses rôles, refus de requireUser relayé tel quel', async () => {
    rapportDisponible();
    for (const [espace, roles] of [
      ['traiteur', ['traiteur_manager', 'traiteur_commercial']],
      ['agence', ['agence']],
      ['gestionnaire', ['gestionnaire_lieux']],
    ] as const) {
      mockRequireUser.mockClear();
      expect((await rapport(undefined, espace)).status).toBe(200);
      expect(mockRequireUser.mock.calls[0]![1]).toEqual(roles);
    }
    mockPdf.mockClear();
    mockRequireUser.mockResolvedValue({
      error: new Response(null, { status: 403 }),
    });
    expect((await rapport(undefined, 'agence')).status).toBe(403);
    expect(mockPdf).not.toHaveBeenCalled();
  });

  it('collecte AG → 409 : pas de rapport de recyclage, rien n’est fabriqué', async () => {
    rapportDisponible();
    rls.results.collectes = {
      data: { id: 'c1', type: 'anti_gaspi' },
      error: null,
    };
    const res = await rapport();
    expect(res.status).toBe(409);
    expect(mockPdf).not.toHaveBeenCalled();
  });

  it('droit = celui du téléchargement : rapport illisible sous la RLS du demandeur → 404, embargo → 425, dit en clair', async () => {
    rapportDisponible();
    rls.results.rapports_rse = { data: null, error: null };
    const absent = await rapport();
    expect(absent.status).toBe(404);
    expect(await absent.json()).toEqual({
      error: 'Le rapport n’est pas encore disponible.',
    });

    rls.results.rapports_rse = {
      data: { id: 'r1', disponible_a: '2999-01-01T00:00:00Z' },
      error: null,
    };
    const embargo = await rapport();
    expect(embargo.status).toBe(425);
    expect(await embargo.json()).toMatchObject({
      disponible_a: '2999-01-01T00:00:00Z',
    });
    expect(mockPdf).not.toHaveBeenCalled();
  });

  it('lecture en échec (collecte ou rapport) → 500 générique, sans fabrication ni détail Postgres', async () => {
    rapportDisponible();
    rls.results.rapports_rse = {
      data: null,
      error: { message: 'relation "rapports_rse" does not exist' },
    };
    const res = await rapport();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Erreur serveur' });

    rapportDisponible();
    rls.results.collectes = {
      data: null,
      error: { message: 'permission denied for table collectes' },
    };
    const res2 = await rapport();
    expect(res2.status).toBe(500);
    expect(await res2.json()).toEqual({ error: 'Erreur serveur' });
    expect(mockPdf).not.toHaveBeenCalled();
  });

  it('données incomplètes → 409 dit en clair ; rendu en échec → 502 au message neutre (aucun détail du service de rendu)', async () => {
    rapportDisponible();
    mockPayload.mockResolvedValueOnce({ ok: false, code: 'INCOMPLET' });
    const incomplet = await rapport();
    expect(incomplet.status).toBe(409);
    expect(mockPdf).not.toHaveBeenCalled();

    mockPdf.mockRejectedValueOnce(new Error('Railway PDF 500: stack trace'));
    const panne = await rapport();
    expect(panne.status).toBe(502);
    expect(await panne.json()).toEqual({
      error: 'La fabrication du rapport a échoué. Réessayez dans un instant.',
    });
  });

  it('premier téléchargement par un client → « Rapport consulté » (consulte_par_user_at) ; jamais réécrit ensuite, jamais sur un échec', async () => {
    rapportDisponible();
    await rapport();
    expect(admin.majs).toHaveLength(1);
    expect(admin.majs[0]!.table).toBe('rapports_rse');
    expect(admin.majs[0]!.valeurs).toHaveProperty('consulte_par_user_at');
    // Rien n'est écrit sous la RLS du demandeur.
    expect(rls.majs).toEqual([]);

    admin.majs.length = 0;
    rls.results.rapports_rse = {
      data: {
        id: 'r1',
        disponible_a: '2020-01-01T00:00:00Z',
        consulte_par_user_at: '2026-10-01T08:00:00Z',
      },
      error: null,
    };
    await rapport();
    expect(admin.majs).toEqual([]);

    rapportDisponible();
    mockPdf.mockRejectedValueOnce(new Error('timeout'));
    await rapport();
    expect(admin.majs).toEqual([]);
  });
});

describe('M1.6 / rapport fabriqué au clic — avec ou sans radar, au choix de celui qui télécharge', () => {
  beforeEach(() => rapportDisponible());

  it('sans corps ou sans « options » → rapport sans radar, le parc n’est pas lu', async () => {
    for (const corps of [undefined, {}, { benchmark_filters: {} }]) {
      mockPdf.mockClear();
      expect((await rapport(corps)).status).toBe(200);
      expect(payloadRendu().options).toEqual({ benchmark: false });
      expect(payloadRendu()).not.toHaveProperty('benchmark_flux');
    }
    expect(mockRadar).not.toHaveBeenCalled();
  });

  it('radar décoché → rapport sans radar, le parc n’est pas lu', async () => {
    await rapport({
      options: { benchmark: false },
      benchmark_filters: { type_evenement_ids: [TYPE_ID] },
    });
    expect(payloadRendu().options).toEqual({ benchmark: false });
    expect(mockRadar).not.toHaveBeenCalled();
  });

  it('radar coché → radar calculé sous l’identité du demandeur avec les filtres de la fiche, imprimé dans le PDF, pour les 3 espaces', async () => {
    for (const espace of ['traiteur', 'agence', 'gestionnaire'] as const) {
      mockRadar.mockClear();
      mockPdf.mockClear();
      const ctx = { userId: 'u', role: 'agence', organisationId: 'o' };
      mockRequireUser.mockResolvedValue({ ctx });
      const res = await rapport(
        {
          options: { benchmark: true },
          benchmark_filters: {
            type_evenement_ids: [TYPE_ID],
            taille_evenement_codes: ['M'],
          },
        },
        espace,
      );
      expect(res.status).toBe(200);
      const [client, ctxRadar, id, filtres] = mockRadar.mock.calls[0]!;
      // Client de la session (RLS), jamais le service-role.
      expect(client).toBe(rls);
      expect(client).not.toBe(admin);
      expect(ctxRadar).toBe(ctx);
      expect(id).toBe('c1');
      expect(filtres).toEqual({
        lieu_ids: [],
        type_evenement_ids: [TYPE_ID],
        taille_evenement_codes: ['M'],
      });
      expect(payloadRendu()).toMatchObject({
        options: { benchmark: true },
        benchmark_flux: RADAR.benchmark_flux,
        benchmark_legende: RADAR.benchmark_legende,
      });
    }
  });

  it('rien n’est stocké : aucune écriture du choix sur le rapport (chacun fabrique le sien)', async () => {
    await rapport({ options: { benchmark: true } });
    expect(
      admin.majs.some(
        (m) =>
          (m.valeurs as Record<string, unknown>).filtres_benchmark !==
          undefined,
      ),
    ).toBe(false);
  });

  it('corps mal formé → 400 ou 422, rien n’est fabriqué', async () => {
    expect((await rapport('{pas du json')).status).toBe(400);
    expect((await rapport([1, 2])).status).toBe(400);
    expect((await rapport({ options: { benchmark: 'oui' } })).status).toBe(422);
    expect((await rapport({ options: null })).status).toBe(422);
    expect(
      (
        await rapport({
          options: { benchmark: true },
          benchmark_filters: { lieu_ids: ['pas-un-uuid'] },
        })
      ).status,
    ).toBe(422);
    expect(mockPdf).not.toHaveBeenCalled();
  });

  it('radar refusé par les gardes de l’écran → même refus, rien n’est fabriqué', async () => {
    mockRadar.mockResolvedValueOnce({ etat: 'sans_radar' });
    expect((await rapport({ options: { benchmark: true } })).status).toBe(422);

    mockRadar.mockResolvedValueOnce({
      etat: 'filtre_interdit',
      motif: 'perimetre',
    });
    const interdit = await rapport({ options: { benchmark: true } });
    expect(interdit.status).toBe(403);
    expect(await interdit.json()).toEqual({
      error:
        'Filtre lieu_ids ou traiteur_ids hors du périmètre du gestionnaire (§06.05)',
    });

    mockRadar.mockResolvedValueOnce({
      etat: 'erreur',
      erreur: { message: 'function f_benchmark_kg_pax_zd does not exist' },
    });
    const erreur = await rapport({ options: { benchmark: true } });
    expect(erreur.status).toBe(500);
    expect(await erreur.json()).toEqual({ error: 'Erreur serveur' });

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
});

describe('M2.4 / rapport RSE AG = attestation standalone (option a Val)', () => {
  async function download(id = 'c1') {
    const { GET } =
      await import('@/app/api/v1/traiteur/collectes/[id]/rapport-rse/download/route.js');
    return GET(new NextRequest('http://localhost/x'), {
      params: Promise.resolve({ id }),
    });
  }

  it('collecte AG → sert l’attestation (URL pré-signée depuis attestations_don)', async () => {
    rls.results.collectes = {
      data: { id: 'c1', type: 'anti_gaspi' },
      error: null,
    };
    rls.results.attestations_don = {
      data: {
        id: 'a1',
        numero: 'ATT-DON-2026-00007',
        eligible_at: '2020-01-01T00:00:00Z',
        pdf_url: 'att-key.pdf',
      },
      error: null,
    };
    const res = await download();
    expect(res.status).toBe(200);
    expect(mockPresigned).toHaveBeenCalledWith(
      'att-key.pdf',
      900,
      'rapport-de-don-ATT-DON-2026-00007.pdf',
    );
  });

  it('attestation AG sous embargo H+24 → 425', async () => {
    rls.results.collectes = {
      data: { id: 'c1', type: 'anti_gaspi' },
      error: null,
    };
    rls.results.attestations_don = {
      data: {
        id: 'a1',
        eligible_at: '2999-01-01T00:00:00Z',
        pdf_url: 'att-key.pdf',
      },
      error: null,
    };
    const res = await download();
    expect(res.status).toBe(425);
    expect(mockPresigned).not.toHaveBeenCalled();
  });

  it('collecte ZD → 409 : le rapport de recyclage se télécharge depuis la fiche (fabriqué au clic), aucune URL de fichier stocké', async () => {
    rls.results.collectes = {
      data: { id: 'c1', type: 'zero_dechet' },
      error: null,
    };
    rls.results.rapports_rse = {
      data: {
        id: 'r1',
        disponible_a: '2020-01-01T00:00:00Z',
        genere_at: '2020-01-01T06:00:00Z',
        pdf_url: 'savr-dev/rapports/r1/ancien.pdf',
      },
      error: null,
    };
    const res = await download();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error:
        'Le rapport de recyclage se télécharge depuis la fiche de la collecte.',
    });
    expect(mockPresigned).not.toHaveBeenCalled();
  });
});

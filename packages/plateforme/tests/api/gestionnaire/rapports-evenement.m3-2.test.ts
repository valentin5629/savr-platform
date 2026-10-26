/**
 * Rapports CUMULÉS sur un événement et radar du bilan consolidé (décision Val
 * 2026-10-26) — routes du gestionnaire de lieux :
 *   POST …/evenements/[id]/rapport-rse     (ZD, radar au choix)
 *   POST …/evenements/[id]/rapport-de-don  (AG, récapitulatif sans valeur fiscale)
 *   GET  …/evenements/[id]/benchmark       (radar de l'écran)
 *
 * Accès = l'événement lu SOUS L'IDENTITÉ du demandeur (client RLS) ; seules les
 * collectes qu'il voit, réalisées, sont relues en service-role. Mock keyé par
 * table, appels `.in()` enregistrés.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeClient() {
  const results: Record<string, Result> = {};
  const inAppels: { table: string; col: string; valeurs: unknown }[] = [];
  const filtres: { table: string; methode: string; args: unknown[] }[] = [];
  const selects: { table: string; texte: string }[] = [];
  function chain(table: string): Record<string, unknown> {
    const res = (): Result => results[table] ?? { data: null, error: null };
    const c: Record<string, unknown> = {};
    for (const m of ['eq', 'not', 'neq', 'or', 'order', 'limit'])
      c[m] = (...args: unknown[]) => {
        filtres.push({ table, methode: m, args });
        return c;
      };
    c.select = (texte: string) => {
      selects.push({ table, texte });
      return c;
    };
    c.in = (col: string, valeurs: unknown) => {
      inAppels.push({ table, col, valeurs });
      return c;
    };
    c.maybeSingle = () => Promise.resolve(res());
    c.then = (resolve: (v: Result) => unknown) => resolve(res());
    return c;
  }
  return { from: (t: string) => chain(t), results, inAppels, filtres, selects };
}

let rls = makeClient();
let admin = makeClient();
const mockRequireUser = vi.fn();
const mockPdf = vi.fn();
const mockParc = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  createSupabaseServerClient: () => rls,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('@/lib/pdf/railway-client.js', () => ({
  generatePdf: (...a: unknown[]) => mockPdf(...a),
}));
// Le repère parc (loader des dashboards) est simulé ; le reste du module est réel.
vi.mock('@/lib/collectes/benchmark-fiche.js', async (orig) => ({
  ...(await orig<typeof import('@/lib/collectes/benchmark-fiche.js')>()),
  chargerParcBenchmark: (...a: unknown[]) => mockParc(...a),
}));

const EVT = '11111111-1111-4111-8111-111111111111';
const CTX = {
  userId: 'u1',
  organisationId: 'org-g',
  role: 'gestionnaire_lieux',
};
const PDF = Buffer.from('%PDF-1.7 cumul');

function postReq(corps?: unknown): NextRequest {
  return new NextRequest('http://localhost/x', {
    method: 'POST',
    ...(corps === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corps),
        }),
  });
}

async function rapport(
  type: 'rapport-rse' | 'rapport-de-don',
  corps?: unknown,
  id = EVT,
) {
  const { POST } =
    type === 'rapport-rse'
      ? await import('@/app/api/v1/gestionnaire/evenements/[id]/rapport-rse/route.js')
      : await import('@/app/api/v1/gestionnaire/evenements/[id]/rapport-de-don/route.js');
  return POST(postReq(corps), { params: Promise.resolve({ id }) });
}

async function benchmark(qs = '', id = EVT) {
  const { GET } =
    await import('@/app/api/v1/gestionnaire/evenements/[id]/benchmark/route.js');
  return GET(new NextRequest(`http://localhost/x${qs}`), {
    params: Promise.resolve({ id }),
  });
}

/**
 * Ce que le gestionnaire voit : 2 ZD de 500 convives (1 clôturée, 1 validée),
 * 2 AG réalisées, 1 AG annulée. `evenements.pax` = 1000 (les deux soirées ZD) :
 * le radar ne doit PAS diviser par lui (cumul partiel).
 */
function evenementVisible(paxZ1: number | null = 500) {
  rls.results.evenements = {
    data: {
      id: EVT,
      pax: 1000,
      collectes: [
        {
          id: 'z1',
          type: 'zero_dechet',
          statut: 'cloturee',
          pax: paxZ1,
          collecte_flux: [
            { poids_reel_kg: 100, flux_dechets: { code: 'biodechet' } },
            { poids_reel_kg: 50, flux_dechets: { code: 'verre' } },
          ],
        },
        { id: 'z2', type: 'zero_dechet', statut: 'validee', pax: 500 },
        { id: 'a1', type: 'anti_gaspi', statut: 'cloturee' },
        { id: 'a2', type: 'anti_gaspi', statut: 'realisee_sans_collecte' },
        { id: 'a3', type: 'anti_gaspi', statut: 'annulee' },
      ],
    },
    error: null,
  };
}

function evenementAdmin() {
  admin.results.evenements = {
    data: {
      pax: 500,
      nom_evenement: 'Gala',
      date_evenement: '2026-10-14',
      nom_client_organisateur: 'Maison Lumière',
      logo_client_organisateur_url: null,
      organisations: {
        nom: 'Traiteur Dupont',
        type: 'traiteur',
        logo_url: null,
      },
      traiteur_operationnel: null,
      client_organisateur: null,
      lieux: {
        nom: 'Pavillon',
        adresse_acces: '1 rue',
        code_postal: '75008',
        ville: 'Paris',
      },
    },
    error: null,
  };
}

function collectesZdAdmin() {
  admin.results.collectes = {
    data: [
      {
        id: 'z1',
        type: 'zero_dechet',
        statut: 'cloturee',
        date_collecte: '2026-10-14',
        heure_collecte: '18:00',
        pax: 450,
        taux_recyclage: 70,
        co2_evite_kg: 100,
        co2_induit_kg: 10,
        co2_net_kg: -90,
        energie_primaire_evitee_kwh: 1000,
        co2_facteurs_snapshot: {
          equivalences: { km_voiture: 0.2, foyer_kwh: 500 },
        },
        collecte_flux: [
          {
            poids_reel_kg: 100,
            flux_dechets: { code: 'biodechet', nom: 'Biodéchets' },
          },
          { poids_reel_kg: 50, flux_dechets: { code: 'verre', nom: 'Verre' } },
        ],
        bordereaux_savr: [
          { numero: 'BSAV-1', version: 1 },
          { numero: 'BSAV-2', version: 2 },
        ],
      },
    ],
    error: null,
  };
}

/** Collectes AG relues SOUS L'IDENTITÉ du demandeur (vue du gestionnaire). */
function collectesAgVisibles(
  pdfUrl: string | null = 'attestations/a.pdf',
  eligibleAt = '2020-01-01T00:00:00Z',
) {
  rls.results.collectes = {
    data: [
      {
        id: 'a2',
        type: 'anti_gaspi',
        statut: 'realisee_sans_collecte',
        date_collecte: '2026-10-15',
        heure_collecte: null,
        co2_evite_kg: 0,
        attributions_lues: [],
        attestations_don: [],
      },
      {
        id: 'a1',
        type: 'anti_gaspi',
        statut: 'cloturee',
        date_collecte: '2026-10-14',
        heure_collecte: null,
        co2_evite_kg: 250,
        // Forme de v_attributions_gestionnaire : association à plat.
        attributions_lues: {
          volume_repas_realise: 100,
          association_id: 'as1',
          association_nom: 'Les Restos du Cœur',
          association_ville: 'Paris',
        },
        attestations_don: [
          {
            numero: 'ATT-DON-2026-00001',
            version: 1,
            pdf_url: pdfUrl,
            eligible_at: eligibleAt,
          },
        ],
      },
    ],
    error: null,
  };
}

const payloadEnvoye = () =>
  mockPdf.mock.calls[0]![1] as Record<string, unknown> & {
    collectes: Record<string, unknown>[];
  };

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeClient();
  admin = makeClient();
  mockRequireUser.mockResolvedValue({ ctx: CTX });
  mockPdf.mockResolvedValue({ pdfBuffer: PDF });
  mockParc.mockResolvedValue({
    etat: 'ok',
    parc: { biodechet: 0.25, verre: 0.08 },
  });
  rls.results.flux_dechets = {
    data: [
      { code: 'biodechet', nom: 'Biodéchets', ordre_affichage: 1 },
      { code: 'verre', nom: 'Verre', ordre_affichage: 4 },
      { code: 'carton', nom: 'Carton', ordre_affichage: 3 },
    ],
    error: null,
  };
});

describe('M3.2 — accès aux routes cumulées', () => {
  it('EVT/api_role_refuse — rôle refusé : la réponse de requireUser, rien lu', async () => {
    const refus = new Response(null, { status: 403 });
    mockRequireUser.mockResolvedValue({ error: refus });
    expect((await rapport('rapport-rse')).status).toBe(403);
    expect(mockRequireUser.mock.calls[0]![1]).toEqual(['gestionnaire_lieux']);
  });

  it('EVT/api_hors_perimetre_404 — événement hors périmètre ou brouillon (rien sous la RLS) → 404, aucune lecture service-role, aucun PDF', async () => {
    evenementAdmin();
    collectesZdAdmin();
    const res = await rapport('rapport-rse');
    expect(res.status).toBe(404);
    expect(admin.inAppels).toHaveLength(0);
    expect(mockPdf).not.toHaveBeenCalled();
    expect((await benchmark()).status).toBe(404);
  });

  it('EVT/api_id_mal_forme — identifiant mal formé → 404 sans requête', async () => {
    expect((await rapport('rapport-de-don', undefined, 'abc')).status).toBe(
      404,
    );
  });
});

describe('M3.2 — lecture de l’événement sous la RLS', () => {
  it('EVT/api_filtres_anti_brouillon — l’événement est lu par son identifiant, daté, brouillons écartés comme la fiche', async () => {
    evenementVisible();
    evenementAdmin();
    collectesZdAdmin();
    await rapport('rapport-rse');
    const surEvenement = rls.filtres
      .filter((f) => f.table === 'evenements')
      .map((f) => [f.methode, ...f.args]);
    expect(surEvenement).toEqual(
      expect.arrayContaining([
        ['eq', 'id', EVT],
        ['not', 'date_evenement', 'is', null],
        ['neq', 'hors_brouillon.statut', 'brouillon'],
        ['or', 'hors_brouillon.not.is.null,collectes.is.null'],
      ]),
    );
  });
});

describe('M3.2 — rapport de recyclage cumulé (ZD)', () => {
  it('EVT/api_zd_cumul_collectes_visibles — relit en service-role les SEULES collectes ZD réalisées visibles, et fabrique le PDF cumulé', async () => {
    evenementVisible();
    evenementAdmin();
    collectesZdAdmin();
    const res = await rapport('rapport-rse', { options: { benchmark: false } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="rapport-recyclage-evenement-2026-10-14.pdf"',
    );
    expect(admin.inAppels).toEqual([
      { table: 'collectes', col: 'id', valeurs: ['z1'] },
    ]);
    expect(mockPdf.mock.calls[0]![0]).toBe('rapport-recyclage-evenement');
    const p = payloadEnvoye();
    expect(p).toMatchObject({
      client_nom: 'Maison Lumière',
      date_evenement: '14/10/2026',
      nb_pax: 500,
      poids_total_kg: 150,
      taux_recyclage: 70,
      co2_evite_kg: 100,
      co2_induit_kg: 10,
      co2_net_kg: -90,
      energie_primaire_evitee_kwh: 1000,
      equivalences: { km_voiture: 500, foyer: 2 },
      options: { benchmark: false },
      // Couverture : 2 collectes ZD dont 1 réalisée, type nommé (événement mixte).
      couverture:
        'Cumul de 1 collecte réalisée, sur 2 collectes Zéro Déchet de l’événement.',
    });
    expect(p.collectes).toEqual([
      {
        date_collecte: '14/10/2026',
        nb_pax: 450,
        poids_kg: 150,
        taux_recyclage: 70,
        co2_evite_kg: 100,
        bordereau_numero: 'BSAV-2',
      },
    ]);
    expect(p).not.toHaveProperty('benchmark_flux');
  });

  it('EVT/api_zd_sans_resultat_409 — aucune collecte ZD réalisée → 409, aucun PDF', async () => {
    evenementVisible();
    (rls.results.evenements!.data as { collectes: unknown[] }).collectes = [
      { id: 'z2', type: 'zero_dechet', statut: 'validee' },
    ];
    const res = await rapport('rapport-rse');
    expect(res.status).toBe(409);
    expect(mockPdf).not.toHaveBeenCalled();
  });

  it('EVT/api_zd_relecture_sans_resultat — collecte qui n’a plus de résultat à la relecture : pas imprimée (409 si c’était la seule)', async () => {
    evenementVisible();
    evenementAdmin();
    collectesZdAdmin();
    (admin.results.collectes!.data as { statut: string }[])[0]!.statut =
      'realisee';
    expect((await rapport('rapport-rse')).status).toBe(409);
  });

  it('EVT/api_zd_refiltre_type — une ligne relue d’un autre type n’est jamais cumulée', async () => {
    evenementVisible();
    evenementAdmin();
    collectesZdAdmin();
    (admin.results.collectes!.data as { type: string }[])[0]!.type =
      'anti_gaspi';
    expect((await rapport('rapport-rse')).status).toBe(409);
    expect(mockPdf).not.toHaveBeenCalled();
  });

  it('EVT/api_zd_radar_filtres — avec radar : kg par convive de l’événement face au parc des filtres envoyés, sous l’identité du demandeur', async () => {
    evenementVisible();
    evenementAdmin();
    collectesZdAdmin();
    const lieu = '22222222-2222-4222-8222-222222222222';
    const res = await rapport('rapport-rse', {
      options: { benchmark: true },
      benchmark_filters: {
        lieu_ids: [lieu],
        type_evenement_ids: [],
        taille_evenement_codes: ['M'],
      },
    });
    expect(res.status).toBe(200);
    expect(mockParc.mock.calls[0]![0]).toBe(rls);
    expect(mockParc.mock.calls[0]![2]).toEqual({
      tailleCodes: ['M'],
      typeIds: null,
      lieuIds: [lieu],
      traiteurIds: null,
    });
    const p = payloadEnvoye();
    expect(p.options).toEqual({ benchmark: true });
    // 100 kg / 500 convives de l'événement ; 50 / 500.
    expect(p.benchmark_flux).toEqual([
      {
        flux_code: 'biodechet',
        flux_nom: 'Biodéchets',
        collecte_kg_pax: 0.2,
        benchmark_kg_pax: 0.25,
      },
      {
        flux_code: 'verre',
        flux_nom: 'Verre',
        collecte_kg_pax: 0.1,
        benchmark_kg_pax: 0.08,
      },
    ]);
    expect(p.benchmark_legende).toContain('lieux : 1 sélectionné');
  });

  it('EVT/api_zd_radar_sans_convives_422 — radar demandé sans convives connus → 422 « cet événement », aucun PDF', async () => {
    evenementVisible(null);
    const res = await rapport('rapport-rse', { options: { benchmark: true } });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(
      'La comparaison au parc n’est pas disponible pour cet événement.',
    );
    expect(mockPdf).not.toHaveBeenCalled();
  });

  it('EVT/api_zd_radar_filtre_hors_perimetre — filtre hors périmètre du gestionnaire → 403, aucun PDF', async () => {
    evenementVisible();
    mockParc.mockResolvedValue({ etat: 'filtre_interdit', motif: 'perimetre' });
    const res = await rapport('rapport-rse', { options: { benchmark: true } });
    expect(res.status).toBe(403);
    expect(mockPdf).not.toHaveBeenCalled();
  });

  it('EVT/api_rendu_echec_502 — échec du rendu → 502', async () => {
    evenementVisible();
    evenementAdmin();
    collectesZdAdmin();
    mockPdf.mockRejectedValue(new Error('timeout'));
    expect((await rapport('rapport-rse')).status).toBe(502);
  });
});

describe('M3.2 — rapport de don cumulé (AG)', () => {
  it('EVT/api_ag_recapitulatif — récapitulatif : sans excédent à 0 repas, numéro des attestations émises, associations cumulées', async () => {
    evenementVisible();
    evenementAdmin();
    collectesAgVisibles();
    const res = await rapport('rapport-de-don', {
      options: { benchmark: false },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="rapport-de-don-evenement-2026-10-14.pdf"',
    );
    // L'annulée n'est jamais relue.
    // Relues sous l'identité du demandeur, par la vue du gestionnaire ;
    // l'annulée n'est jamais relue ; rien en service-role sur les collectes.
    expect(rls.inAppels).toEqual([
      { table: 'collectes', col: 'id', valeurs: ['a1', 'a2'] },
    ]);
    expect(admin.inAppels).toEqual([]);
    expect(rls.selects.find((x) => x.table === 'collectes')?.texte).toContain(
      'attributions_lues:v_attributions_gestionnaire(',
    );
    expect(mockPdf.mock.calls[0]![0]).toBe('rapport-don-evenement');
    const p = payloadEnvoye();
    expect(p).toMatchObject({
      repas_donnes: 100,
      co2_evite_kg: 250,
      associations: [{ nom: 'Les Restos du Cœur', ville: 'Paris', repas: 100 }],
      couverture:
        'Cumul des 2 collectes réalisées, sur 3 collectes Anti-Gaspi de l’événement.',
    });
    // Ordre chronologique.
    expect(p.collectes).toEqual([
      {
        date_collecte: '14/10/2026',
        sans_excedent: false,
        association_nom: 'Les Restos du Cœur',
        repas: 100,
        attestation_numero: 'ATT-DON-2026-00001',
      },
      {
        date_collecte: '15/10/2026',
        sans_excedent: true,
        association_nom: null,
        repas: 0,
        attestation_numero: null,
      },
    ]);
  });

  it('EVT/api_ag_attestation_embargo — attestation pas encore téléchargeable (aucun PDF, ou PDF sous embargo) : son numéro n’est pas imprimé', async () => {
    evenementVisible();
    evenementAdmin();
    collectesAgVisibles(null);
    await rapport('rapport-de-don');
    expect(payloadEnvoye().collectes[0]!.attestation_numero).toBeNull();

    mockPdf.mockClear();
    collectesAgVisibles('attestations/a.pdf', '2999-01-01T00:00:00Z');
    await rapport('rapport-de-don');
    expect(payloadEnvoye().collectes[0]!.attestation_numero).toBeNull();
  });

  it('EVT/api_ag_jamais_de_radar — jamais de radar sur le rapport de don', async () => {
    evenementVisible();
    const res = await rapport('rapport-de-don', {
      options: { benchmark: true },
    });
    expect(res.status).toBe(422);
    expect(mockParc).not.toHaveBeenCalled();
  });
});

describe('M3.2 — lecture AG par rôle (fabrication commune)', () => {
  it('EVT/api_ag_select_par_role — alias attributions_lues sur la vue (gestionnaire) ou la table (autres rôles)', async () => {
    const { selectAg } = await import('@/lib/pdf/rapports-evenement.js');
    expect(selectAg('gestionnaire_lieux')).toContain(
      'attributions_lues:v_attributions_gestionnaire(',
    );
    for (const role of ['traiteur_manager', 'traiteur_commercial', 'agence']) {
      const texte = selectAg(role);
      expect(texte).toContain('attributions_lues:attributions_antgaspi(');
      expect(texte).not.toContain('v_attributions_gestionnaire');
    }
  });
});

describe('M3.2 — radar du bilan consolidé (écran)', () => {
  it('EVT/api_benchmark_ecran — kg par convive des collectes ZD réalisées (pas evenements.pax, cumul partiel) et repère parc des filtres de l’URL', async () => {
    evenementVisible();
    // Une collecte ZD réalisée à 0 convive (inconnu) sort des deux sommes.
    (rls.results.evenements!.data as { collectes: unknown[] }).collectes.push({
      id: 'z3',
      type: 'zero_dechet',
      statut: 'cloturee',
      pax: 0,
      collecte_flux: [
        { poids_reel_kg: 900, flux_dechets: { code: 'biodechet' } },
      ],
    });
    const res = await benchmark('?taille_evenement_codes=M,L&lieu_ids=x');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        flux: {
          biodechet: { ratio_user: 0.2, benchmark_kg_pax: 0.25 },
          verre: { ratio_user: 0.1, benchmark_kg_pax: 0.08 },
        },
      },
    });
    expect(mockParc.mock.calls[0]![2]).toMatchObject({
      tailleCodes: ['M', 'L'],
      lieuIds: ['x'],
    });
  });

  it('EVT/api_benchmark_sans_radar — sans collecte ZD réalisée ou sans convives : data null (bloc masqué), parc jamais lu', async () => {
    evenementVisible(0);
    expect(await (await benchmark()).json()).toEqual({ data: null });
    expect(mockParc).not.toHaveBeenCalled();
  });

  it('EVT/api_benchmark_filtre_hors_perimetre — filtre hors périmètre → 403', async () => {
    evenementVisible();
    mockParc.mockResolvedValue({ etat: 'filtre_interdit', motif: 'perimetre' });
    expect((await benchmark()).status).toBe(403);
  });
});

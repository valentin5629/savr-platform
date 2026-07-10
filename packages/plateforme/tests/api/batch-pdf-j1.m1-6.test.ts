/**
 * M1.6 — Tests batch J+1 6h (sélection collectes → enqueue jobs_pdf)
 * Scénarios P1 : nominal, skip pesées vides, escalade R9 > 48h, idempotence, embargo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

// BL-P3-05 : le logo (clé R2 de la cascade) est inliné en data URI via getObjectBytes.
const getObjectBytes = vi.fn().mockResolvedValue(Buffer.from([1, 2, 3]));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getObjectBytes: (...a: unknown[]) => getObjectBytes(...a),
}));

import { runBatchPdfJ1 } from '../../src/lib/pdf/batch-pdf-j1.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCollecte(overrides: Record<string, unknown> = {}) {
  return {
    id: 'col-1',
    evenement_id: 'ev-1',
    realisee_at: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
    taux_recyclage: 72.5,
    co2_evite_kg: 45.2,
    co2_induit_kg: 3.1,
    co2_net_kg: 42.1,
    energie_primaire_evitee_kwh: 120,
    co2_facteurs_snapshot: { version_parametres_at: 'ADEME 2024' },
    nb_camions_demande: 1,
    evenements: {
      id: 'ev-1',
      nom_evenement: 'Gala Kaspia',
      date_evenement: '2026-06-13',
      pax: 250,
      organisation_id: 'org-1',
      traiteur_operationnel_organisation_id: null,
      organisations: {
        raison_sociale: 'Kaspia SAS',
        siret: '12345678900001',
        adresse: '12 rue de la Paix, 75001 Paris',
        email_principal: 'contact@kaspia.fr',
      },
      lieux: {
        nom: 'Grand Palais',
        adresse_acces: '3 avenue du Général Eisenhower',
        code_postal: '75008',
        ville: 'Paris',
      },
    },
    prestataire_logistique_id: 'presta-1',
    ...overrides,
  };
}

/**
 * Mock Supabase avec chaîne thenable.
 * Toutes les queries consomment séquentiellement responses[] :
 *  - await from().select().eq()…  → then() → next()
 *  - from().insert().select().single() → single() → next()
 *  - rpc(…).single() → next()
 *  - schema('shared').from('prestataires')…single() → single() → next()
 */
function makeSupabase(responses: Array<Record<string, unknown>>) {
  let idx = 0;
  const next = () => ({
    data: null,
    error: null,
    count: null,
    ...responses[idx++],
  });

  const chain: Record<string, unknown> = {
    then(
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) {
      return Promise.resolve(next()).then(onFulfilled, onRejected);
    },
    single: vi.fn(() => Promise.resolve(next())),
    maybeSingle: vi.fn(() => Promise.resolve(next())),
  };
  for (const m of [
    'select',
    'insert',
    'update',
    'eq',
    'in',
    'not',
    'is',
    'or',
    'lte',
    'gte',
    'order',
    'limit',
    'range',
  ]) {
    chain[m] = vi.fn(() => chain);
  }

  const rpcResult = { single: vi.fn(() => Promise.resolve(next())) };
  const rpc = vi.fn(() => rpcResult);

  return {
    from: vi.fn(() => chain),
    rpc,
    _chain: chain,
    // .schema('shared').from('prestataires') consomme la même séquence responses[].
    schema: vi.fn(() => ({ from: vi.fn(() => chain) })),
  };
}

beforeEach(() => vi.clearAllMocks());

// ── Tests ──────────────────────────────────────────────────────────────────

describe('M1.6 / BatchPdfJ1 / Nominal', () => {
  it('R-PDF1 : collecte ZD cloturee avec flux → 2 jobs enqueués (bordereau + rapport)', async () => {
    const collecte = makeCollecte();
    const sb = makeSupabase([
      { data: [collecte], error: null }, // select collectes
      { data: [], error: null }, // select bordereaux existants
      { count: 3, error: null }, // count collecte_flux
      {
        data: [
          {
            flux_id: 'f1',
            poids_reel_kg: 12,
            nb_bacs: 3,
            equivalent_roll: null,
            flux: { nom: 'Biodéchets' },
          },
        ],
      }, // select flux (BL-P2-16 : nb_bacs / equivalent_roll)
      { data: 'BSAV-2026-00001', error: null }, // rpc numero
      {
        data: { nom: 'Strike Transport', siret: '98765432100011' },
      }, // shared.prestataires (transporteur)
      {
        data: {
          evenement: {
            type_evenement_id: 't1',
            type_evenement: { libelle: 'Gala' },
          },
        },
      }, // helper resolveRapportBenchmark : fetch type d'événement (légende/snapshot)
      { data: { id: 'bord-new' }, error: null }, // insert bordereaux_savr
      { data: { id: 'rse-new' }, error: null }, // insert rapports_rse
      { data: null, error: null }, // insert job bordereau
      { data: null, error: null }, // insert job rapport
    ]);

    const result = await runBatchPdfJ1(sb as never);

    expect(result.enqueued).toBe(1);
    expect(result.skipped_no_flux).toBe(0);
    expect(result.errors).toHaveLength(0);

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const types = insertCalls
      .map((c) => c[0].type_document)
      .filter(Boolean) as string[];
    expect(types).toContain('bordereau-zd');
    expect(types).toContain('rapport-recyclage-zd');

    // BL-P1-RPT-01 : le batch appelle le benchmark (5 jauges) et la moyenne parc.
    const rpcNames = (sb.rpc as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(rpcNames).toContain('f_rapport_benchmark_zd');
    expect(rpcNames).toContain('f_taux_recyclage_moyen_parc');

    // BL-P1-RPT-01 : snapshot filtres_benchmark non vide (reproductibilité §1.2 l.69).
    const rseInsert = insertCalls.find(
      (c) => c[0].filtres_benchmark !== undefined,
    )?.[0];
    expect(rseInsert).toBeDefined();
    const fb = rseInsert!.filtres_benchmark as {
      type_evenement_ids: string[] | null;
    };
    expect(fb.type_evenement_ids).toEqual(['t1']);

    // BL-P2-16 : le payload bordereau porte l'équivalent bacs.
    const bordJob = insertCalls.find(
      (c) => c[0].type_document === 'bordereau-zd',
    )?.[0];
    const bordFlux = (bordJob!.payload as { flux: Array<{ nb_bacs: number }> })
      .flux;
    expect(bordFlux[0]!.nb_bacs).toBe(3);
  });
});

describe('M1.6 / BatchPdfJ1 / Skip pesées vides', () => {
  it('R-PDF3 : 0 ligne collecte_flux → skip, aucun job créé', async () => {
    const collecte = makeCollecte({
      realisee_at: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
    });
    const sb = makeSupabase([
      { data: [collecte], error: null },
      { data: [], error: null },
      { count: 0, error: null },
    ]);

    const result = await runBatchPdfJ1(sb as never);
    expect(result.skipped_no_flux).toBe(1);
    expect(result.enqueued).toBe(0);
    expect(result.escalated_r9).toBe(0);
  });
});

describe('M1.6 / BatchPdfJ1 / Escalade R9', () => {
  it('R-PDF4 : collecte skippée depuis > 48h → alerte Admin créée', async () => {
    const collecte = makeCollecte({
      realisee_at: new Date(Date.now() - 50 * 3600 * 1000).toISOString(),
    });
    const sb = makeSupabase([
      { data: [collecte], error: null },
      { data: [], error: null },
      { count: 0, error: null },
      { data: null, error: null }, // rpc f_upsert_alerte_admin
    ]);

    const result = await runBatchPdfJ1(sb as never);
    expect(result.skipped_no_flux).toBe(1);
    expect(result.escalated_r9).toBe(1);
    expect(sb.rpc).toHaveBeenCalledWith(
      'f_upsert_alerte_admin',
      expect.objectContaining({
        p_code: 'bordereau_pesees_manquantes_48h',
        p_entity_id: 'col-1',
      }),
    );
  });
});

describe('M1.6 / BatchPdfJ1 / Idempotence', () => {
  it('collecte déjà traitée (bordereau emis) → already_done incrémenté, rien enqueué', async () => {
    const collecte = makeCollecte();
    const sb = makeSupabase([
      { data: [collecte], error: null },
      { data: [{ collecte_id: 'col-1', statut: 'emis' }], error: null },
    ]);

    const result = await runBatchPdfJ1(sb as never);
    expect(result.already_done).toBe(1);
    expect(result.enqueued).toBe(0);
  });
});

describe('M1.6 / BatchPdfJ1 / Embargo', () => {
  it('R-PDF2 : disponible_a = realisee_at + 24h (vérifié sur insert rapports_rse)', async () => {
    const realiseeAt = new Date(Date.now() - 26 * 3600 * 1000);
    const collecte = makeCollecte({ realisee_at: realiseeAt.toISOString() });
    const sb = makeSupabase([
      { data: [collecte], error: null },
      { data: [], error: null },
      { count: 2, error: null },
      {
        data: [
          { flux_id: 'f1', poids_reel_kg: 10, flux: { nom: 'Biodéchets' } },
        ],
      },
      { data: 'BSAV-2026-00002', error: null },
      {
        data: { nom: 'Strike Transport', siret: '98765432100011' },
      }, // shared.prestataires (transporteur)
      {
        data: {
          evenement: {
            type_evenement_id: 't1',
            type_evenement: { libelle: 'Gala' },
          },
        },
      }, // helper resolveRapportBenchmark : fetch type d'événement
      { data: { id: 'bord-x' }, error: null },
      { data: { id: 'rse-x' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);

    await runBatchPdfJ1(sb as never);

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const rseInsert = insertCalls.find(
      (c) => c[0].disponible_a !== undefined,
    )?.[0];

    expect(rseInsert).toBeDefined();
    const disponibleA = new Date(rseInsert!.disponible_a as string);
    const expected = new Date(realiseeAt.getTime() + 24 * 3600 * 1000);
    expect(Math.abs(disponibleA.getTime() - expected.getTime())).toBeLessThan(
      5000,
    );
  });

  it('E1 : la génération est gatée par realisee_at + 24h <= now() (filtre .lte sur la sélection)', async () => {
    // La requête renvoie [] (collecte encore sous embargo → exclue par le filtre) :
    // aucun document figé, aucun job. Le filtre embargo doit être posé côté requête.
    const sb = makeSupabase([{ data: [], error: null }]);

    const before = Date.now();
    const result = await runBatchPdfJ1(sb as never);
    const after = Date.now();

    expect(result.enqueued).toBe(0);

    const lteCalls = (sb._chain.lte as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, string]>;
    const embargoFilter = lteCalls.find((c) => c[0] === 'realisee_at');
    expect(embargoFilter).toBeDefined();
    // Seuil ≈ now() - 24h (à la fenêtre d'exécution près).
    const seuil = new Date(embargoFilter![1]).getTime();
    expect(seuil).toBeGreaterThanOrEqual(before - 24 * 3600 * 1000 - 1000);
    expect(seuil).toBeLessThanOrEqual(after - 24 * 3600 * 1000 + 1000);
  });
});

describe('M1.6 / BatchPdfJ1 / Logo cascade §1.2 (BL-P2-19)', () => {
  it('programmateur agence → logo agence posé dans le payload rapport (prime sur traiteur)', async () => {
    // §1.2 l.86-90 : l'agence programmatrice prime. Le batch alimente désormais
    // rapportPayload.logo_url (auparavant absent → fallback « Savr » systématique).
    const collecte = makeCollecte({
      evenements: {
        id: 'ev-1',
        nom_evenement: 'Gala Kaspia',
        date_evenement: '2026-06-13',
        pax: 250,
        organisation_id: 'org-agence',
        traiteur_operationnel_organisation_id: 'org-traiteur',
        client_organisateur_organisation_id: null,
        logo_client_organisateur_url: null,
        organisations: {
          raison_sociale: 'Agence Événement',
          siret: '11111111100001',
          adresse: '1 rue',
          email_principal: 'a@agence.fr',
          type: 'agence',
          logo_url: 'https://cdn/agence-logo.png',
        },
        traiteur_operationnel: {
          raison_sociale: 'Traiteur Op',
          siret: '22222222200002',
          adresse: '2 rue',
          logo_url: 'https://cdn/traiteur-logo.png',
        },
        client_organisateur: null,
        lieux: {
          nom: 'Grand Palais',
          adresse_acces: '3 avenue',
          code_postal: '75008',
          ville: 'Paris',
        },
      },
    });
    const sb = makeSupabase([
      { data: [collecte], error: null }, // select collectes
      { data: [], error: null }, // bordereaux existants
      { count: 2, error: null }, // count collecte_flux
      {
        data: [
          { flux_id: 'f1', poids_reel_kg: 10, flux: { nom: 'Biodéchets' } },
        ],
      }, // flux
      { data: 'BSAV-2026-00010', error: null }, // rpc numero
      {
        data: { nom: 'Strike Transport', siret: '98765432100011' },
      }, // shared.prestataires
      {
        data: {
          evenement: {
            type_evenement_id: 't1',
            type_evenement: { libelle: 'Gala' },
          },
        },
      }, // resolveRapportBenchmark : type d'événement
      { data: { id: 'bord-logo' }, error: null }, // insert bordereaux_savr
      { data: { id: 'rse-logo' }, error: null }, // insert rapports_rse
      { data: null, error: null }, // job bordereau
      { data: null, error: null }, // job rapport
    ]);

    await runBatchPdfJ1(sb as never);

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const rapJob = insertCalls.find(
      (c) => c[0].type_document === 'rapport-recyclage-zd',
    )?.[0];
    expect(rapJob).toBeDefined();
    // BL-P3-05 : le logo agence (gagnant de la cascade) est inliné en data URI
    // (le renderer n'affiche pas une clé R2 brute) — la clé agence est bien celle
    // téléchargée (prime sur le traiteur).
    expect(getObjectBytes).toHaveBeenCalledWith('https://cdn/agence-logo.png');
    expect((rapJob!.payload as { logo_url?: string }).logo_url).toMatch(
      /^data:image\/png;base64,/,
    );
  });
});

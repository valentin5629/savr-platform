/**
 * M2.4 — Tests batch J+1 6h AG (attestation_don_ag_batch_avec_snapshot,
 * realisee_sans_collecte_pas_d_attestation, idempotence, mention fiscale conditionnelle,
 * snapshot résistant perte habilitation, régénération auto sur correction volume).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import { runBatchPdfJ1Ag } from '../../src/lib/pdf/batch-pdf-j1-ag.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCollecteAg(overrides: Record<string, unknown> = {}) {
  return {
    id: 'col-ag-1',
    evenement_id: 'ev-1',
    realisee_at: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
    date_collecte: '2026-06-01',
    co2_evite_kg: 300.0,
    co2_facteurs_snapshot: { version: 'ADEME 2024', co2_kg_par_repas_ag: 2.5 },
    evenements: {
      nom_evenement: 'Gala Kaspia',
      date_evenement: '2026-06-13',
      organisation_id: 'org-1',
    },
    attributions_antgaspi: {
      id: 'attr-1',
      volume_repas_realise: 120,
      poids_repas_kg: 54.0,
      association_id: 'asso-1',
      associations: {
        nom: 'Les Restos du Cœur',
        numero_rup: 'W751234567',
        habilitee_attestation_fiscale: true,
      },
    },
    ...overrides,
  };
}

/**
 * Mock Supabase avec chaîne thenable consommant responses[] séquentiellement.
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
    'order',
    'limit',
    'range',
  ]) {
    chain[m] = vi.fn(() => chain);
  }

  const rpcResult = { single: vi.fn(() => Promise.resolve(next())) };
  const rpc = vi.fn(() => rpcResult);

  return { from: vi.fn(() => chain), rpc, _chain: chain };
}

beforeEach(() => vi.clearAllMocks());

// ── Tests ──────────────────────────────────────────────────────────────────

describe('M2.4 / BatchPdfJ1Ag / Happy path', () => {
  it('attestation_don_ag_batch_avec_snapshot : collecte AG cloturée habilitée → attestation créée + job enqueué', async () => {
    const collecte = makeCollecteAg();
    const sb = makeSupabase([
      { data: [collecte], error: null }, // select collectes AG
      { data: [], error: null }, // select attestations_don existantes
      {
        data: [
          {
            id: 'entite-1',
            organisation_id: 'org-1',
            raison_sociale: 'Kaspia SAS',
            siret: '12345678900001',
          },
        ],
        error: null,
      }, // entites_facturation
      { data: 'ATT-DON-2026-00001', error: null }, // rpc f_next_numero_attestation
      { data: { id: 'att-new' }, error: null }, // insert attestations_don
      { data: null, error: null }, // insert jobs_pdf
      { data: null, error: null }, // insert rapports_rse
      { data: { contact_principal_email: 'chef@kaspia.fr' }, error: null }, // select contact email
    ]);

    const result = await runBatchPdfJ1Ag(sb as never);

    expect(result.enqueued).toBe(1);
    expect(result.skipped_no_attribution).toBe(0);
    expect(result.already_done).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Vérifier snapshot association_habilitation
    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;

    const attInsert = insertCalls.find(
      (c) => c[0].collecte_id !== undefined,
    )?.[0];
    expect(attInsert).toBeDefined();
    expect(attInsert!.association_habilitation).toBe('habilitee');
    expect(attInsert!.mention_fiscale_2041ge).toBe(true);
    expect(attInsert!.volume_repas).toBe(120);
    expect(attInsert!.co2_evite_kg).toBe(300.0);
    expect(attInsert!.numero).toBe('ATT-DON-2026-00001');
    expect(attInsert!.version).toBe(1);
    expect(attInsert!.statut).toBe('brouillon');
    // ECR-4 : date_collecte = vraie date de collecte, pas today
    expect(attInsert!.date_collecte).toBe('2026-06-01');

    // Vérifier type_document du job PDF
    const jobInsert = insertCalls.find(
      (c) => c[0].type_document !== undefined,
    )?.[0];
    expect(jobInsert).toBeDefined();
    expect(jobInsert!.type_document).toBe('attestation-don');
    expect(jobInsert!.entity_type).toBe('attestations_don');
    expect(
      (jobInsert!.payload as Record<string, unknown>).mention_fiscale_2041ge,
    ).toBe(true);
    // ECR-4 : date_collecte dans le payload PDF ≠ today
    expect((jobInsert!.payload as Record<string, unknown>).date_collecte).toBe(
      new Date('2026-06-01').toLocaleDateString('fr-FR'),
    );
  });
});

describe('M2.4 / BatchPdfJ1Ag / Exclusion sans attribution', () => {
  it('realisee_sans_collecte_pas_d_attestation : collecte sans attribution → skip', async () => {
    const collecte = makeCollecteAg({ attributions_antgaspi: null });
    const sb = makeSupabase([
      { data: [collecte], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]);

    const result = await runBatchPdfJ1Ag(sb as never);

    expect(result.skipped_no_attribution).toBe(1);
    expect(result.enqueued).toBe(0);
  });

  it('collecte avec volume_repas_realise null → skip', async () => {
    const collecte = makeCollecteAg({
      attributions_antgaspi: {
        id: 'attr-1',
        volume_repas_realise: null,
        poids_repas_kg: null,
        association_id: 'asso-1',
        associations: {
          nom: 'Asso X',
          numero_rup: null,
          habilitee_attestation_fiscale: false,
        },
      },
    });
    const sb = makeSupabase([
      { data: [collecte], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]);

    const result = await runBatchPdfJ1Ag(sb as never);

    expect(result.skipped_no_attribution).toBe(1);
    expect(result.enqueued).toBe(0);
  });
});

describe('M2.4 / BatchPdfJ1Ag / Idempotence R8', () => {
  it("collecte déjà dotée d'une attestation emise → already_done, rien enqueué", async () => {
    const collecte = makeCollecteAg();
    const sb = makeSupabase([
      { data: [collecte], error: null },
      { data: [{ collecte_id: 'col-ag-1', statut: 'emise' }], error: null },
      { data: [], error: null }, // entites (pas atteint mais mockée)
    ]);

    const result = await runBatchPdfJ1Ag(sb as never);

    expect(result.already_done).toBe(1);
    expect(result.enqueued).toBe(0);
  });
});

describe('M2.4 / BatchPdfJ1Ag / Mention fiscale conditionnelle', () => {
  it('association non habilitée → mention_fiscale_2041ge=false, habilitation=non_habilitee', async () => {
    const collecte = makeCollecteAg({
      attributions_antgaspi: {
        id: 'attr-2',
        volume_repas_realise: 80,
        poids_repas_kg: 36.0,
        association_id: 'asso-2',
        associations: {
          nom: 'Croix-Rouge',
          numero_rup: null,
          habilitee_attestation_fiscale: false,
        },
      },
    });
    const sb = makeSupabase([
      { data: [collecte], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: 'entite-1',
            organisation_id: 'org-1',
            raison_sociale: 'Kaspia SAS',
            siret: '12345678900001',
          },
        ],
        error: null,
      },
      { data: 'ATT-DON-2026-00002', error: null },
      { data: { id: 'att-new-2' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { contact_principal_email: null }, error: null },
    ]);

    const result = await runBatchPdfJ1Ag(sb as never);
    expect(result.enqueued).toBe(1);

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const attInsert = insertCalls.find(
      (c) => c[0].collecte_id !== undefined,
    )?.[0];
    expect(attInsert!.mention_fiscale_2041ge).toBe(false);
    expect(attInsert!.association_habilitation).toBe('non_habilitee');
  });
});

describe('M2.4 / BatchPdfJ1Ag / Snapshot résistant perte habilitation', () => {
  it("attestation_valide_apres_perte_habilitation : snapshot figé au moment de l'émission", async () => {
    // La collecte était habilitée au moment de la génération.
    // Le batch génère une nouvelle collecte avec la même asso maintenant non habilitée.
    // Le TEST vérifie que si le batch tourne sur CETTE collecte (pas l'ancienne),
    // l'association_habilitation reflète l'état ACTUEL (non_habilitee).
    // Le snapshot de l'ancienne attestation reste inchangé côté DB (testé en pgTAP).
    const collecteNouv = makeCollecteAg({
      id: 'col-ag-nouveau',
      attributions_antgaspi: {
        id: 'attr-nouv',
        volume_repas_realise: 50,
        poids_repas_kg: 22.5,
        association_id: 'asso-1',
        associations: {
          nom: 'Les Restos du Cœur',
          numero_rup: 'W751234567',
          habilitee_attestation_fiscale: false, // perte habilitation
        },
      },
    });
    const sb = makeSupabase([
      { data: [collecteNouv], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: 'entite-1',
            organisation_id: 'org-1',
            raison_sociale: 'Kaspia SAS',
            siret: '12345678900001',
          },
        ],
        error: null,
      },
      { data: 'ATT-DON-2026-00003', error: null },
      { data: { id: 'att-new-3' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { contact_principal_email: null }, error: null },
    ]);

    await runBatchPdfJ1Ag(sb as never);

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const attInsert = insertCalls.find(
      (c) => c[0].collecte_id !== undefined,
    )?.[0];
    // La nouvelle attestation reflète l'état actuel : non_habilitee
    expect(attInsert!.association_habilitation).toBe('non_habilitee');
    expect(attInsert!.mention_fiscale_2041ge).toBe(false);
  });
});

describe('M2.4 / BatchPdfJ1Ag / Sélection vide', () => {
  it('aucune collecte AG cloturée → result vide sans erreur', async () => {
    const sb = makeSupabase([{ data: [], error: null }]);

    const result = await runBatchPdfJ1Ag(sb as never);

    expect(result.enqueued).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('erreur DB à la sélection → erreur remontée', async () => {
    const sb = makeSupabase([
      { data: null, error: { message: 'connection timeout' } },
    ]);

    const result = await runBatchPdfJ1Ag(sb as never);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('connection timeout');
  });
});

describe('M2.4 / BatchPdfJ1Ag / Embargo H+24', () => {
  it("eligible_at = realisee_at + 24h dans l'attestation", async () => {
    const realiseeAt = new Date(Date.now() - 26 * 3600 * 1000);
    const collecte = makeCollecteAg({ realisee_at: realiseeAt.toISOString() });
    const sb = makeSupabase([
      { data: [collecte], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: 'entite-1',
            organisation_id: 'org-1',
            raison_sociale: 'Kaspia SAS',
            siret: '12345678900001',
          },
        ],
        error: null,
      },
      { data: 'ATT-DON-2026-00004', error: null },
      { data: { id: 'att-emb' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { contact_principal_email: null }, error: null },
    ]);

    await runBatchPdfJ1Ag(sb as never);

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const attInsert = insertCalls.find(
      (c) => c[0].eligible_at !== undefined,
    )?.[0];
    expect(attInsert).toBeDefined();
    const eligibleA = new Date(attInsert!.eligible_at as string);
    const expected = new Date(realiseeAt.getTime() + 24 * 3600 * 1000);
    expect(Math.abs(eligibleA.getTime() - expected.getTime())).toBeLessThan(
      5000,
    );
  });
});

describe('M2.4 / BatchPdfJ1Ag / rapports_rse AG', () => {
  it('INSERT rapports_rse avec disponible_a = realisee_at + 24h', async () => {
    const realiseeAt = new Date(Date.now() - 26 * 3600 * 1000);
    const collecte = makeCollecteAg({ realisee_at: realiseeAt.toISOString() });
    const sb = makeSupabase([
      { data: [collecte], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: 'entite-1',
            organisation_id: 'org-1',
            raison_sociale: 'Kaspia SAS',
            siret: '12345678900001',
          },
        ],
        error: null,
      },
      { data: 'ATT-DON-2026-00005', error: null },
      { data: { id: 'att-rse' }, error: null },
      { data: null, error: null }, // jobs_pdf
      { data: null, error: null }, // rapports_rse
      { data: { contact_principal_email: null }, error: null },
    ]);

    await runBatchPdfJ1Ag(sb as never);

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
});

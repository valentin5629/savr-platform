/**
 * E2E intégration AG — cycle attribution → attestation don.
 * Chaîne M2.3 (validation attribution) → M2.4 (batch J+1 attestation).
 * 4 scénarios : nominal habilitée, non habilitée, skip sans attribution, idempotence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

// Mock supabase admin pour validerAttributionAg (utilise createAdminSupabaseClient en interne)
const mockRpcValidation = vi.fn();
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({ rpc: mockRpcValidation }),
}));

import { validerAttributionAg } from '../src/lib/attribution-ag/validation.js';
import { runBatchPdfJ1Ag } from '../src/lib/pdf/batch-pdf-j1-ag.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSupabaseBatch(responses: Array<Record<string, unknown>>) {
  let idx = 0;
  const next = (): Record<string, unknown> => ({
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
    'gte',
    'lte',
  ]) {
    chain[m] = vi.fn(() => chain);
  }

  const rpcResult = { single: vi.fn(() => Promise.resolve(next())) };
  const rpc = vi.fn(() => rpcResult);

  return { from: vi.fn(() => chain), rpc, _chain: chain };
}

function makeCollecteAg(overrides: Record<string, unknown> = {}) {
  return {
    id: 'col-ag-e2e-001',
    evenement_id: 'ev-e2e-001',
    realisee_at: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
    co2_evite_kg: 300.0,
    co2_facteurs_snapshot: { version: 'ADEME 2024', co2_kg_par_repas_ag: 2.5 },
    evenements: {
      nom_evenement: 'Gala Kaspia E2E',
      date_evenement: '2026-06-13',
      organisation_id: 'org-e2e-001',
    },
    attributions_antgaspi: {
      id: 'attr-e2e-001',
      volume_repas_realise: 120,
      poids_repas_kg: 54.0,
      association_id: 'asso-e2e-001',
      associations: {
        nom: 'Les Restos du Cœur',
        numero_rup: 'W751234567',
        habilitee_attestation_fiscale: true,
      },
    },
    ...overrides,
  };
}

// ── Scénario 1 : cycle nominal AG habilitée ───────────────────────────────────

describe('E2E / AG / scenario-nominal-habilite', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it('attribution top1 validée → attestation avec mention_fiscale=true', async () => {
    // ── Étape A : validation attribution M2.3 ──────────────────────────────
    mockRpcValidation.mockResolvedValueOnce({
      data: {
        ok: true,
        attribution_id: 'attr-e2e-001',
        outbox_id: 'out-e2e-001',
        pack_id: 'pack-001',
      },
      error: null,
    });

    const validationResult = await validerAttributionAg({
      collecteId: 'col-ag-e2e-001',
      associationId: 'asso-e2e-001',
      transporteurId: 'transp-e2e-001',
      brancheAttribution: 'ag_marathon_nuit',
      modeValidation: 'manuel_top1',
      validePar: 'user-admin-e2e',
    });

    expect(validationResult.ok).toBe(true);
    expect(validationResult.attribution_id).toBe('attr-e2e-001');
    expect(validationResult.outbox_id).toBe('out-e2e-001');
    expect(mockRpcValidation).toHaveBeenCalledWith(
      'rpc_valider_attribution_ag',
      {
        p_collecte_id: 'col-ag-e2e-001',
        p_association_id: 'asso-e2e-001',
        p_transporteur_id: 'transp-e2e-001',
        p_branche_attribution: 'ag_marathon_nuit',
        p_mode_validation: 'manuel_top1',
        p_valide_par: 'user-admin-e2e',
        p_motif_override: null,
        p_motif_override_libre: null,
      },
    );

    // ── Étape B : batch J+1 M2.4 → attestation habilitée ──────────────────
    const sb = makeSupabaseBatch([
      { data: [makeCollecteAg()], error: null }, // select collectes AG
      { data: [], error: null }, // select attestations existantes
      {
        data: [
          {
            id: 'ef-e2e-001',
            organisation_id: 'org-e2e-001',
            raison_sociale: 'Kaspia SAS',
            siret: '12345678900001',
          },
        ],
        error: null,
      }, // entites_facturation
      { data: 'ATT-DON-2026-00001', error: null }, // rpc f_next_numero_attestation
      { data: { id: 'att-e2e-001' }, error: null }, // insert attestations_don
      { data: null, error: null }, // insert jobs_pdf
      { data: null, error: null }, // insert rapports_rse
      { data: { contact_principal_email: 'chef@kaspia.fr' }, error: null }, // contact email
    ]);

    const batchResult = await runBatchPdfJ1Ag(sb as never);

    expect(batchResult.enqueued).toBe(1);
    expect(batchResult.skipped_no_attribution).toBe(0);
    expect(batchResult.already_done).toBe(0);
    expect(batchResult.errors).toHaveLength(0);

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const attInsert = insertCalls.find(
      (c) => c[0].collecte_id !== undefined,
    )?.[0];
    expect(attInsert).toBeDefined();
    expect(attInsert!.mention_fiscale_2041ge).toBe(true);
    expect(attInsert!.association_habilitation).toBe('habilitee');
    expect(attInsert!.volume_repas).toBe(120);
    expect(attInsert!.numero).toBe('ATT-DON-2026-00001');
    expect(attInsert!.version).toBe(1);
    expect(attInsert!.statut).toBe('en_attente');
  });
});

// ── Scénario 2 : association non habilitée → mention_fiscale=false ────────────

describe('E2E / AG / scenario-non-habilite', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it('attribution validée association non habilitée → mention_fiscale=false', async () => {
    // ── Étape A : validation attribution M2.3 (mode override car choix hors top1) ──
    mockRpcValidation.mockResolvedValueOnce({
      data: {
        ok: true,
        attribution_id: 'attr-e2e-002',
        outbox_id: 'out-e2e-002',
        pack_id: null,
      },
      error: null,
    });

    const validationResult = await validerAttributionAg({
      collecteId: 'col-ag-e2e-002',
      associationId: 'asso-e2e-002',
      transporteurId: 'transp-e2e-001',
      brancheAttribution: 'ag_everest_velo',
      modeValidation: 'manuel_override',
      validePar: 'user-admin-e2e',
      motifOverride: 'CAPACITE_INSUFFISANTE',
      motifOverrideLibre: 'Association préférée du client',
    });

    expect(validationResult.ok).toBe(true);
    expect(mockRpcValidation).toHaveBeenCalledWith(
      'rpc_valider_attribution_ag',
      expect.objectContaining({
        p_mode_validation: 'manuel_override',
        p_motif_override: 'CAPACITE_INSUFFISANTE',
      }),
    );

    // ── Étape B : batch J+1 M2.4 → attestation non habilitée ──────────────
    const collecteSansHabilitation = makeCollecteAg({
      id: 'col-ag-e2e-002',
      attributions_antgaspi: {
        id: 'attr-e2e-002',
        volume_repas_realise: 80,
        poids_repas_kg: 36.0,
        association_id: 'asso-e2e-002',
        associations: {
          nom: 'Croix-Rouge',
          numero_rup: null,
          habilitee_attestation_fiscale: false,
        },
      },
    });

    const sb = makeSupabaseBatch([
      { data: [collecteSansHabilitation], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: 'ef-e2e-001',
            organisation_id: 'org-e2e-001',
            raison_sociale: 'Kaspia SAS',
            siret: '12345678900001',
          },
        ],
        error: null,
      },
      { data: 'ATT-DON-2026-00002', error: null },
      { data: { id: 'att-e2e-002' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { contact_principal_email: null }, error: null },
    ]);

    const batchResult = await runBatchPdfJ1Ag(sb as never);

    expect(batchResult.enqueued).toBe(1);
    expect(batchResult.errors).toHaveLength(0);

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const attInsert = insertCalls.find(
      (c) => c[0].collecte_id !== undefined,
    )?.[0];
    expect(attInsert!.mention_fiscale_2041ge).toBe(false);
    expect(attInsert!.association_habilitation).toBe('non_habilitee');
  });
});

// ── Scénario 3 : collecte sans attribution → skip batch ──────────────────────

describe('E2E / AG / scenario-skip-sans-attribution', () => {
  beforeEach(() => vi.clearAllMocks());

  it('collecte cloturée sans attribution_antgaspi → skipped_no_attribution=1', async () => {
    const collecteSansAttribution = makeCollecteAg({
      attributions_antgaspi: null,
    });

    const sb = makeSupabaseBatch([
      { data: [collecteSansAttribution], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]);

    const result = await runBatchPdfJ1Ag(sb as never);

    expect(result.skipped_no_attribution).toBe(1);
    expect(result.enqueued).toBe(0);
    expect(result.errors).toHaveLength(0);

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(insertCalls).toHaveLength(0);
  });
});

// ── Scénario 4 : idempotence — attestation déjà émise ────────────────────────

describe('E2E / AG / scenario-idempotence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deuxième run batch sur collecte déjà attestée → already_done=1 sans insert', async () => {
    // Simule que la validation a déjà eu lieu (batch déjà tourné)
    const sb = makeSupabaseBatch([
      { data: [makeCollecteAg()], error: null },
      {
        data: [{ collecte_id: 'col-ag-e2e-001', statut: 'emise' }],
        error: null,
      }, // attestation existante
      { data: [], error: null },
    ]);

    const result = await runBatchPdfJ1Ag(sb as never);

    expect(result.already_done).toBe(1);
    expect(result.enqueued).toBe(0);
    expect(result.errors).toHaveLength(0);

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(insertCalls).toHaveLength(0);
  });
});

// ── Scénario 5 : erreur RPC validation → exception typée ─────────────────────

describe('E2E / AG / scenario-erreurs-validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rpc_valider_attribution_ag DUPLICATE (P0044) → throw DUPLICATE', async () => {
    mockRpcValidation.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0044', message: 'Attribution déjà existante' },
    });

    await expect(
      validerAttributionAg({
        collecteId: 'col-ag-e2e-001',
        associationId: 'asso-e2e-001',
        transporteurId: 'transp-e2e-001',
        brancheAttribution: 'ag_marathon_nuit',
        modeValidation: 'manuel_top1',
        validePar: 'user-admin-e2e',
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE' });
  });

  it('rpc_valider_attribution_ag statut invalide (P0043) → throw INVALID_STATUS', async () => {
    mockRpcValidation.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0043', message: 'Statut collecte invalide' },
    });

    await expect(
      validerAttributionAg({
        collecteId: 'col-ag-e2e-001',
        associationId: 'asso-e2e-001',
        transporteurId: 'transp-e2e-001',
        brancheAttribution: 'ag_marathon_nuit',
        modeValidation: 'manuel_top1',
        validePar: 'user-admin-e2e',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });
});

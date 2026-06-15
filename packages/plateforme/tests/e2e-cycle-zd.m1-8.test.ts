/**
 * M1.8 — Gate E2E cycle ZD : adapter sync → batch PDF → brouillon → facturation.
 * 4 scénarios couvrant le cycle nominal et les variantes critiques.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import { runBatchPdfJ1 } from '../src/lib/pdf/batch-pdf-j1.js';
import { runBatchBrouillonsJ1 } from '../src/lib/facturation/batch-brouillons.js';
import { validerFacture } from '../src/lib/facturation/validation-admin.js';
import { setupPennylaneMock } from '../src/lib/pennylane/mock.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSupabase(responses: Array<Record<string, unknown>>) {
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
    'neq',
    'order',
    'limit',
    'range',
    'gte',
    'lte',
    'lte',
  ]) {
    chain[m] = vi.fn(() => chain);
  }

  const rpcSingle = vi.fn(() => Promise.resolve(next()));
  const rpc = vi.fn(() => ({ single: rpcSingle, then: chain.then }));

  return {
    from: vi.fn(() => chain),
    rpc,
    _chain: chain,
    _rpcSingle: rpcSingle,
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeCollectePdf(overrides: Record<string, unknown> = {}) {
  return {
    id: 'col-m18-zd-001',
    evenement_id: 'ev-m18-001',
    realisee_at: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
    cloturee_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
    taux_recyclage: 72.5,
    co2_evite_kg: 45.2,
    co2_induit_kg: 3.1,
    co2_net_kg: 42.1,
    co2_net_kwh: 120,
    co2_facteurs_snapshot: { version: 'ADEME 2024' },
    nb_camions_demande: 1,
    evenements: {
      id: 'ev-m18-001',
      nom_evenement: 'Gala M1.8 Test',
      date_evenement: '2026-07-15',
      nb_pax: 250,
      organisation_id: 'org-m18-001',
      traiteur_operationnel_organisation_id: null,
      contact_principal_email: 'contact@test-m18.fr',
      organisations: {
        raison_sociale: 'Kaspia SAS',
        siret: '12345678900001',
        adresse: '12 rue de la Paix, 75001 Paris',
      },
      traiteur_operationnel: null,
      lieux: {
        nom: 'Grand Palais',
        adresse_acces: '3 avenue du Général Eisenhower',
        code_postal: '75008',
        ville: 'Paris',
      },
    },
    collecte_tournees: [
      {
        tournees: {
          transporteur_id: 'trans-001',
          transporteurs: { nom: 'Strike Transport', siret: '98765432100011' },
        },
      },
    ],
    ...overrides,
  };
}

const COLLECTE_ZD_CLOTUREE_BROUILLON = {
  id: 'col-m18-zd-001',
  type: 'zero_dechet',
  statut: 'cloturee',
  annulee_cote_savr: false,
  pack_antgaspi_id: null,
  evenements: {
    id: 'ev-m18-001',
    organisation_id: 'org-m18-001',
    nb_pax: 250,
    date_evenement: '2026-07-15',
    organisations: {
      mode_facturation_zd: 'par_collecte',
      grille_tarifaire_zd_id: null,
      entites_facturation: [
        { id: 'ef-m18-001', siret_verification: 'verifie' },
      ],
    },
  },
};

const FACTURE_BROUILLON_M18 = {
  id: 'fac-m18-001',
  type: 'zero_dechet',
  mode_facturation: 'par_collecte',
  statut: 'brouillon',
  numero_facture: null,
  montant_ht: 590,
  taux_tva: 20,
  montant_tva: 118,
  montant_ttc: 708,
  devise: 'EUR',
  organisation_id: 'org-m18-001',
  entite_facturation_id: 'ef-m18-001',
  notes: null,
  periode_debut: null,
  periode_fin: null,
  pennylane_statut: null,
  factures_collectes: [
    {
      id: 'fc-m18-001',
      designation: 'Collecte ZD',
      libelle_ligne: 'Collecte Zéro Déchet — 250 pax',
      quantite: 1,
      montant_ligne_ht: 590,
      taux_tva: 20,
      collectes: { evenements: { reference_affaire: 'REF-2026-M18' } },
    },
  ],
  entites_facturation: {
    id: 'ef-m18-001',
    raison_sociale: 'Kaspia SAS',
    siret: '12345678900001',
    tva_intracom: 'FR12345678900',
    adresse_facturation: '12 rue de la Paix',
    code_postal: '75001',
    ville: 'Paris',
    pays: 'FR',
    pennylane_customer_id: 'pl-cust-m18',
    siret_verification: 'verifie',
    tva_verification: 'verifie',
    conditions_paiement_jours: 30,
  },
};

// ─── Scénario 1 : cycle ZD nominal ───────────────────────────────────────────

describe('M1.8 / E2E / scenario-nominal', () => {
  let teardown: () => void;

  beforeEach(() => {
    teardown = setupPennylaneMock({
      create: 'success',
      finalize: 'success',
      sendEmail: 'success',
    });
  });

  afterEach(() => {
    teardown();
    vi.clearAllMocks();
  });

  it('cycle nominal : collecte ZD cloturee → batch PDF 2 jobs + brouillon → valider → emise FZD-2026-00001', async () => {
    // ── Étape A : batch PDF J+1 ──────────────────────────────────────────────
    const sbPdf = makeSupabase([
      { data: [makeCollectePdf()], error: null }, // select collectes
      { data: [], error: null }, // select bordereaux existants
      { count: 1, error: null }, // count collecte_flux (> 0)
      { data: [{ flux_id: 'f1', poids_kg: 100, flux: { nom: 'Biodéchets' } }] }, // flux details
      { data: 'BSAV-2026-00001', error: null }, // rpc f_next_numero_bordereau (single)
      { data: { id: 'bord-new' }, error: null }, // insert bordereaux_savr (single)
      { data: { id: 'rse-new' }, error: null }, // insert rapports_rse (single)
      { data: null, error: null }, // insert job bordereau (then)
      { data: null, error: null }, // insert job rapport (then)
    ]);

    const pdfResult = await runBatchPdfJ1(sbPdf as never);
    expect(pdfResult.enqueued).toBe(1);
    expect(pdfResult.errors).toHaveLength(0);

    const insertCalls = (sbPdf._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const types = insertCalls
      .map((c) => c[0].type_document)
      .filter(Boolean) as string[];
    expect(types).toContain('bordereau-zd');
    expect(types).toContain('rapport-recyclage-zd');

    // ── Étape B : batch brouillons J+1 ──────────────────────────────────────
    const sbBrouillons = makeSupabase([
      { data: [COLLECTE_ZD_CLOTUREE_BROUILLON], error: null }, // select collectes
      { data: [], error: null }, // select factures_collectes dejaIds
      { data: [], error: null }, // tarifs_negocie (no remises)
      { data: null, error: null }, // insert factures_collectes
    ]);
    // Évite les erreurs de séquençage sur les appels .single() de calculer_tarif_zd
    (sbBrouillons._chain.single as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { id: 'fac-m18-new', prix_base_ht: 590, prix_par_couvert_ht: null },
      error: null,
    });

    const brouillonsResult = await runBatchBrouillonsJ1(sbBrouillons as never);
    expect(brouillonsResult.errors).toHaveLength(0);
    expect(brouillonsResult.zd_par_collecte).toBe(1);

    // ── Étape C : validation Admin → emise ──────────────────────────────────
    const sbValider = makeSupabase([
      { data: FACTURE_BROUILLON_M18, error: null }, // load facture
      { data: null, error: null }, // update en_attente_pennylane
      { data: null, error: null }, // update pennylane_id
      { data: null, error: null }, // update emise
    ]);
    sbValider._rpcSingle.mockResolvedValueOnce({
      data: 'FZD-2026-00001',
      error: null,
    });

    const validerResult = await validerFacture(
      sbValider as never,
      'fac-m18-001',
    );
    expect(validerResult.ok).toBe(true);
    expect(validerResult.statut).toBe('emise');
    expect(validerResult.numero_facture).toBe('FZD-2026-00001');
  });
});

// ─── Scénario 4 : pesées incomplètes skip batch ───────────────────────────────

describe('M1.8 / E2E / variante-pesees-incompletes-skip-batch', () => {
  afterEach(() => vi.clearAllMocks());

  it('batch PDF collecte_flux vide >48h → skipped_no_flux=1 escalated_r9=1 alerte bordereau_pesees_manquantes_48h', async () => {
    const collecte = makeCollectePdf({
      cloturee_at: new Date(Date.now() - 50 * 3600 * 1000).toISOString(),
    });
    const sb = makeSupabase([
      { data: [collecte], error: null }, // select collectes
      { data: [], error: null }, // select bordereaux existants
      { count: 0, error: null }, // count collecte_flux = 0 → skip
    ]);

    const result = await runBatchPdfJ1(sb as never);

    expect(result.skipped_no_flux).toBe(1);
    expect(result.escalated_r9).toBe(1);
    expect(result.enqueued).toBe(0);
    expect(sb.rpc).toHaveBeenCalledWith(
      'f_upsert_alerte_admin',
      expect.objectContaining({
        p_code: 'bordereau_pesees_manquantes_48h',
        p_entity_id: 'col-m18-zd-001',
      }),
    );
  });
});

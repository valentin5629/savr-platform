/**
 * M1.7 — Tests facturation Pennylane
 * Couvre : validation Admin (3 appels), retry, polling paiement, avoir, batch brouillons.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  setupPennylaneMock,
  _setPennylaneHandlers,
} from '../../src/lib/pennylane/mock.js';

import { runBatchBrouillonsJ1 } from '../../src/lib/facturation/batch-brouillons.js';
import { runPollingPaiement } from '../../src/lib/facturation/polling-paiement.js';
import {
  validerFacture,
  renvoyerFacture,
  runPennylaneRetryWorker,
} from '../../src/lib/facturation/validation-admin.js';
import { creerAvoir } from '../../src/lib/facturation/avoirs.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

const FACTURE_BROUILLON = {
  id: 'fac-001',
  type: 'zero_dechet',
  mode_facturation: 'par_collecte',
  statut: 'brouillon',
  numero_facture: null,
  montant_ht: 590,
  taux_tva: 20,
  montant_tva: 118,
  montant_ttc: 708,
  devise: 'EUR',
  organisation_id: 'org-001',
  entite_facturation_id: 'ef-001',
  notes: null,
  periode_debut: null,
  periode_fin: null,
  pennylane_statut: null,
  factures_collectes: [
    {
      id: 'fc-001',
      designation: 'Collecte ZD',
      libelle_ligne: 'Collecte Zéro Déchet — 250 pax',
      quantite: 1,
      montant_ligne_ht: 590,
      taux_tva: 20,
      collectes: { evenements: { reference_affaire: 'REF-2026-001' } },
    },
  ],
  entites_facturation: {
    id: 'ef-001',
    raison_sociale: 'Kaspia SAS',
    siret: '12345678900001',
    tva_intracom: 'FR12345678900',
    adresse_facturation: '12 rue de la Paix',
    code_postal: '75001',
    ville: 'Paris',
    pays: 'FR',
    pennylane_customer_id: 'pl-cust-abc',
    siret_verification: 'verifie',
    tva_verification: 'verifie',
    conditions_paiement_jours: 30,
  },
};

const FACTURE_ATTENTE = {
  ...FACTURE_BROUILLON,
  statut: 'en_attente_pennylane',
  numero_facture: 'FZD-2026-00001',
  pennylane_statut: 'retry_1',
  pennylane_id: null,
  derniere_tentative_pennylane_at: new Date(
    Date.now() - 10 * 60 * 1000,
  ).toISOString(),
};

// ─── validerFacture ───────────────────────────────────────────────────────────

describe('M1.7 / validerFacture / Succès nominal', () => {
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

  it('R-F1 : valider brouillon → statut emise, numéro attribué, 3 appels Pennylane', async () => {
    const sb = makeSupabase([
      { data: FACTURE_BROUILLON, error: null }, // load facture
      { data: null, error: null }, // update en_attente_pennylane
      { data: null, error: null }, // update pennylane_id
      { data: null, error: null }, // update emise
    ]);
    // rpc f_attribuer_numero_facture
    sb._rpcSingle.mockResolvedValueOnce({
      data: 'FZD-2026-00001',
      error: null,
    });

    const result = await validerFacture(sb as never, 'fac-001');

    expect(result.ok).toBe(true);
    expect(result.statut).toBe('emise');
    expect(result.numero_facture).toBe('FZD-2026-00001');
    expect(result.pennylane_id).toBeDefined();
    expect(result.pdf_url_pennylane).toBeDefined();
  });

  it('R-F5 : numéro déjà attribué après 4xx précédent → pas de nouvel appel RPC', async () => {
    const facture = {
      ...FACTURE_BROUILLON,
      numero_facture: 'FZD-2026-00001',
    };
    const sb = makeSupabase([
      { data: facture, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);

    const result = await validerFacture(sb as never, 'fac-001');

    expect(result.ok).toBe(true);
    // Le RPC ne doit pas être appelé (numéro déjà là)
    expect(sb.rpc).not.toHaveBeenCalledWith(
      'f_attribuer_numero_facture',
      expect.anything(),
    );
    expect(result.numero_facture).toBe('FZD-2026-00001');
  });
});

describe('M1.7 / validerFacture / Gate SIRET non vérifié', () => {
  afterEach(() => vi.clearAllMocks());

  it('R-F2 : SIRET non_verifie → retour brouillon, aucun appel Pennylane', async () => {
    const facture = {
      ...FACTURE_BROUILLON,
      entites_facturation: {
        ...FACTURE_BROUILLON.entites_facturation,
        siret_verification: 'non_verifie',
      },
    };
    const sb = makeSupabase([{ data: facture, error: null }]);
    _setPennylaneHandlers(null);
    const spy = vi.fn();
    _setPennylaneHandlers({
      createInvoice: spy,
      finalizeInvoice: vi.fn(),
      sendEmail: vi.fn(),
      getInvoice: vi.fn(),
      getCustomers: vi.fn(),
      getInvoices: vi.fn(),
      createDraft: vi.fn(),
    });

    const result = await validerFacture(sb as never, 'fac-001');

    expect(result.ok).toBe(false);
    expect(result.statut).toBe('brouillon');
    expect(spy).not.toHaveBeenCalled();
    _setPennylaneHandlers(null);
  });
});

describe('M1.7 / validerFacture / Erreur 4xx Pennylane', () => {
  let teardown: () => void;

  beforeEach(() => {
    teardown = setupPennylaneMock({ create: 'error_4xx' });
  });

  afterEach(() => {
    teardown();
    vi.clearAllMocks();
  });

  it('R-F3 : 4xx create → retour brouillon, numéro conservé, erreur_synchro enregistrée', async () => {
    const sb = makeSupabase([
      { data: FACTURE_BROUILLON, error: null },
      { data: null, error: null }, // update en_attente_pennylane
      { data: null, error: null }, // update brouillon + erreur
    ]);
    sb._rpcSingle.mockResolvedValueOnce({
      data: 'FZD-2026-00001',
      error: null,
    });

    const result = await validerFacture(sb as never, 'fac-001');

    expect(result.ok).toBe(false);
    expect(result.statut).toBe('brouillon');
    expect(result.numero_facture).toBe('FZD-2026-00001'); // conservé

    const updateCalls = (sb._chain.update as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const lastUpdate = updateCalls[updateCalls.length - 1]![0];
    expect(lastUpdate.statut).toBe('brouillon');
    expect(lastUpdate.pennylane_statut).toBe('echec_4xx');
    expect(lastUpdate.erreur_synchro).toBeDefined();
  });
});

describe('M1.7 / validerFacture / Erreur 5xx Pennylane', () => {
  let teardown: () => void;

  beforeEach(() => {
    teardown = setupPennylaneMock({ create: 'error_500' });
  });

  afterEach(() => {
    teardown();
    vi.clearAllMocks();
  });

  it('R-F4 : 5xx create → statut en_attente_pennylane, pennylane_statut=retry_1', async () => {
    const sb = makeSupabase([
      { data: FACTURE_BROUILLON, error: null },
      { data: null, error: null }, // update en_attente_pennylane
      { data: null, error: null }, // update retry_1
    ]);
    sb._rpcSingle.mockResolvedValueOnce({
      data: 'FZD-2026-00001',
      error: null,
    });

    const result = await validerFacture(sb as never, 'fac-001');

    expect(result.ok).toBe(false);
    expect(result.statut).toBe('en_attente_pennylane');

    const updateCalls = (sb._chain.update as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const lastUpdate = updateCalls[updateCalls.length - 1]![0];
    expect(lastUpdate.pennylane_statut).toBe('retry_1');
  });
});

describe('M1.7 / validerFacture / Finalize fail', () => {
  let teardown: () => void;

  beforeEach(() => {
    teardown = setupPennylaneMock({ create: 'success', finalize: 'error_500' });
  });

  afterEach(() => {
    teardown();
    vi.clearAllMocks();
  });

  it('R-F6 : finalize 5xx → en_attente_pennylane, pennylane_id sauvegardé', async () => {
    const sb = makeSupabase([
      { data: FACTURE_BROUILLON, error: null },
      { data: null, error: null }, // update en_attente
      { data: null, error: null }, // update pennylane_id
      { data: null, error: null }, // update retry_1
    ]);
    sb._rpcSingle.mockResolvedValueOnce({
      data: 'FZD-2026-00001',
      error: null,
    });

    const result = await validerFacture(sb as never, 'fac-001');

    expect(result.ok).toBe(false);
    expect(result.statut).toBe('en_attente_pennylane');
    expect(result.pennylane_id).toBeDefined();
  });
});

// ─── renvoyerFacture ──────────────────────────────────────────────────────────

describe('M1.7 / renvoyerFacture', () => {
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

  it('R-F7 : renvoyer remet en brouillon puis valide → emise', async () => {
    const sb = makeSupabase([
      { data: null, error: null }, // update brouillon
      { data: FACTURE_BROUILLON, error: null }, // load facture (dans validerFacture)
      { data: null, error: null }, // update en_attente
      { data: null, error: null }, // update pennylane_id
      { data: null, error: null }, // update emise
    ]);
    sb._rpcSingle.mockResolvedValueOnce({
      data: 'FZD-2026-00001',
      error: null,
    });

    const result = await renvoyerFacture(sb as never, 'fac-001');
    expect(result.ok).toBe(true);
    expect(result.statut).toBe('emise');
  });
});

// ─── runPennylaneRetryWorker ──────────────────────────────────────────────────

describe('M1.7 / RetryWorker / DLQ après 3 tentatives', () => {
  let teardown: () => void;

  beforeEach(() => {
    teardown = setupPennylaneMock({ create: 'error_500' });
  });

  afterEach(() => {
    teardown();
    vi.clearAllMocks();
  });

  it('R-F8 : facture retry_3 → escalade echec_final + alerte Admin', async () => {
    const facture = {
      ...FACTURE_ATTENTE,
      pennylane_statut: 'retry_3',
      derniere_tentative_pennylane_at: new Date(
        Date.now() - 25 * 3600 * 1000,
      ).toISOString(),
    };
    const sb = makeSupabase([
      { data: [facture], error: null }, // select factures retry
      { data: null, error: null }, // update brouillon (renvoyerFacture)
      { data: FACTURE_BROUILLON, error: null }, // load facture
      { data: null, error: null }, // update en_attente
      { data: null, error: null }, // update retry
      { data: null, error: null }, // update echec_final
      { data: null, error: null }, // rpc f_upsert_alerte_admin
    ]);
    sb._rpcSingle
      .mockResolvedValueOnce({ data: 'FZD-2026-00001', error: null }) // numero
      .mockResolvedValueOnce({ data: null, error: null }); // alerte

    const result = await runPennylaneRetryWorker(sb as never);

    expect(result.dlq).toBe(1);
    expect(sb.rpc).toHaveBeenCalledWith(
      'f_upsert_alerte_admin',
      expect.objectContaining({ p_code: 'pennylane_echec_final' }),
    );
  });
});

// ─── runPollingPaiement ────────────────────────────────────────────────────────

describe('M1.7 / PollingPaiement / Transition payee', () => {
  let teardown: () => void;

  beforeEach(() => {
    teardown = setupPennylaneMock({ getInvoice: 'paid' });
  });

  afterEach(() => {
    teardown();
    vi.clearAllMocks();
  });

  it('R-F9 : facture emise + Pennylane status=paid → transition payee', async () => {
    const sb = makeSupabase([
      { data: [{ id: 'fac-001', pennylane_id: 'pl-inv-001' }], error: null },
      { data: null, error: null }, // update payee
    ]);

    const result = await runPollingPaiement(sb as never);

    expect(result.checked).toBe(1);
    expect(result.payee).toBe(1);
    expect(result.errors).toHaveLength(0);

    const updateCalls = (sb._chain.update as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    expect(updateCalls[0]![0].statut).toBe('payee');
    expect(updateCalls[0]![0].date_paiement).toBeDefined();
  });
});

describe('M1.7 / PollingPaiement / Facture non payée', () => {
  let teardown: () => void;

  beforeEach(() => {
    teardown = setupPennylaneMock({ getInvoice: 'outstanding' });
  });

  afterEach(() => {
    teardown();
    vi.clearAllMocks();
  });

  it('R-F10 : status=outstanding → checked incrémenté, aucune transition', async () => {
    const sb = makeSupabase([
      { data: [{ id: 'fac-001', pennylane_id: 'pl-inv-001' }], error: null },
    ]);

    const result = await runPollingPaiement(sb as never);
    expect(result.checked).toBe(1);
    expect(result.payee).toBe(0);
    // Pas d'appel update
    expect(
      (sb._chain.update as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(0);
  });
});

describe('M1.7 / PollingPaiement / Aucune facture emise', () => {
  afterEach(() => vi.clearAllMocks());

  it('R-F11 : 0 factures emises → result vide, aucun appel GET', async () => {
    _setPennylaneHandlers(null);
    const getInvoiceSpy = vi.fn();
    _setPennylaneHandlers({
      createInvoice: vi.fn(),
      finalizeInvoice: vi.fn(),
      sendEmail: vi.fn(),
      getInvoice: getInvoiceSpy,
      getCustomers: vi.fn(),
      getInvoices: vi.fn(),
      createDraft: vi.fn(),
    });

    const sb = makeSupabase([{ data: [], error: null }]);
    const result = await runPollingPaiement(sb as never);

    expect(result.checked).toBe(0);
    expect(getInvoiceSpy).not.toHaveBeenCalled();
    _setPennylaneHandlers(null);
  });
});

// ─── creerAvoir ───────────────────────────────────────────────────────────────

const FACTURE_EMISE = {
  id: 'fac-emise-001',
  type: 'zero_dechet',
  statut: 'emise',
  montant_ht: 590,
  taux_tva: 20,
  montant_tva: 118,
  montant_ttc: 708,
  devise: 'EUR',
  organisation_id: 'org-001',
  entite_facturation_id: 'ef-001',
  pennylane_id: 'pl-inv-123',
  factures_collectes: [
    {
      id: 'fc-001',
      collecte_id: 'col-001',
      designation: 'Collecte ZD',
      libelle_ligne: 'Collecte Zéro Déchet',
      quantite: 1,
      montant_ligne_ht: 590,
      taux_tva: 20,
      tarif_applique_id: 'tar-001',
      tarif_applique_source: 'zd_grille',
      tarif_detail: null,
    },
  ],
  entites_facturation: {
    pennylane_customer_id: 'pl-cust-abc',
    raison_sociale: 'Kaspia SAS',
    siret: '12345678900001',
    tva_intracom: null,
    conditions_paiement_jours: 30,
  },
};

describe('M1.7 / creerAvoir / Succès sur facture emise', () => {
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

  it('R-AV1 : avoir sur facture emise → avoir créé, facture origine annulee, push Pennylane', async () => {
    const sb = makeSupabase([
      { data: FACTURE_EMISE, error: null }, // load facture
      { data: { id: 'av-001' }, error: null }, // insert avoir (single)
      { data: null, error: null }, // insert lignes avoir
      { data: null, error: null }, // update facture origine annulee
      { data: null, error: null }, // update en_attente_pennylane
      { data: null, error: null }, // update pennylane_id
      { data: null, error: null }, // update emise
    ]);
    sb._rpcSingle.mockResolvedValueOnce({ data: 'AV-2026-00001', error: null });

    const result = await creerAvoir(
      sb as never,
      'fac-emise-001',
      'Annulation client',
    );

    expect(result.ok).toBe(true);
    expect(result.numero_avoir).toBe('AV-2026-00001');
    expect(result.avoir_id).toBeDefined();

    // Facture origine passée en annulee
    const updateCalls = (sb._chain.update as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const annuleeUpdate = updateCalls.find((c) => c[0].statut === 'annulee');
    expect(annuleeUpdate).toBeDefined();
  });
});

describe('M1.7 / creerAvoir / Statut invalide', () => {
  afterEach(() => vi.clearAllMocks());

  it('R-AV2 : avoir sur facture brouillon → erreur immédiate, aucun push Pennylane', async () => {
    const facture = { ...FACTURE_EMISE, statut: 'brouillon' };
    const sb = makeSupabase([{ data: facture, error: null }]);

    _setPennylaneHandlers(null);
    const createSpy = vi.fn();
    _setPennylaneHandlers({
      createInvoice: createSpy,
      finalizeInvoice: vi.fn(),
      sendEmail: vi.fn(),
      getInvoice: vi.fn(),
      getCustomers: vi.fn(),
      getInvoices: vi.fn(),
      createDraft: vi.fn(),
    });

    const result = await creerAvoir(sb as never, 'fac-emise-001', 'Annulation');

    expect(result.ok).toBe(false);
    expect(result.erreur).toContain('brouillon');
    expect(createSpy).not.toHaveBeenCalled();
    _setPennylaneHandlers(null);
  });
});

// ─── runBatchBrouillonsJ1 ────────────────────────────────────────────────────

const COLLECTE_ZD_CLOTUREE = {
  id: 'col-zd-001',
  type: 'zero_dechet',
  statut: 'cloturee',
  annulee_cote_savr: false,
  pack_antgaspi_id: null,
  evenements: {
    id: 'ev-001',
    organisation_id: 'org-001',
    nb_pax: 250,
    date_evenement: '2026-06-10',
    organisations: {
      mode_facturation_zd: 'par_collecte',
      grille_tarifaire_zd_id: 'grille-001',
      entites_facturation: [{ id: 'ef-001', siret_verification: 'verifie' }],
    },
  },
};

describe('M1.7 / BatchBrouillons / ZD par_collecte', () => {
  afterEach(() => vi.clearAllMocks());

  it('R-BB1 : collecte ZD cloturee SIRET verifie → 1 brouillon ZD créé', async () => {
    const sb = makeSupabase([
      { data: [COLLECTE_ZD_CLOTUREE], error: null }, // select collectes
      { data: [], error: null }, // select factures_collectes (dejaIds)
      // calculer_tarif_zd appels Supabase :
      {
        data: {
          montant_ht: 590,
          montant_brut_ht: 650,
          tarif_id: 'tar-1',
          remise_pct_cumulee: 0,
        },
        error: null,
      },
      { data: { id: 'fac-new' }, error: null }, // insert facture
      { data: null, error: null }, // insert facture_collecte
    ]);
    // Mock calculer_tarif_zd via rpc (used inside tarif-zd.ts)
    sb._rpcSingle.mockResolvedValue({
      data: {
        montant_ht: 590,
        montant_brut_ht: 590,
        tarif_id: 'tar-1',
        remise_pct_cumulee: 0,
      },
      error: null,
    });
    (sb._chain.single as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { id: 'fac-new' },
      error: null,
    });

    const result = await runBatchBrouillonsJ1(sb as never);

    expect(result.errors).toHaveLength(0);
    expect(result.skipped_siret).toBe(0);
  });
});

describe('M1.7 / BatchBrouillons / Skip SIRET non_verifie', () => {
  afterEach(() => vi.clearAllMocks());

  it('R-BB2 : SIRET non_verifie → collecte skippée', async () => {
    const collecte = {
      ...COLLECTE_ZD_CLOTUREE,
      evenements: {
        ...COLLECTE_ZD_CLOTUREE.evenements,
        organisations: {
          ...COLLECTE_ZD_CLOTUREE.evenements.organisations,
          entites_facturation: [
            { id: 'ef-001', siret_verification: 'en_attente' },
          ],
        },
      },
    };
    const sb = makeSupabase([
      { data: [collecte], error: null },
      { data: [], error: null },
    ]);

    const result = await runBatchBrouillonsJ1(sb as never);
    expect(result.skipped_siret).toBe(1);
  });
});

describe('M1.7 / BatchBrouillons / Idempotence', () => {
  afterEach(() => vi.clearAllMocks());

  it('R-BB3 : collecte déjà dans factures_collectes → non retraitée', async () => {
    const sb = makeSupabase([
      { data: [COLLECTE_ZD_CLOTUREE], error: null },
      { data: [{ collecte_id: 'col-zd-001' }], error: null }, // déjà facturée
    ]);

    const result = await runBatchBrouillonsJ1(sb as never);
    // Aucune insertion
    expect(
      (sb._chain.insert as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe('M1.7 / BatchBrouillons / Aucune collecte', () => {
  afterEach(() => vi.clearAllMocks());

  it('R-BB4 : 0 collectes → résultat vide sans erreur', async () => {
    const sb = makeSupabase([{ data: [], error: null }]);
    const result = await runBatchBrouillonsJ1(sb as never);

    expect(result.zd_par_collecte).toBe(0);
    expect(result.zd_mensuel).toBe(0);
    expect(result.ag_par_collecte).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe('M1.7 / BatchBrouillons / Filtre annulee_cote_savr', () => {
  afterEach(() => vi.clearAllMocks());

  it('R-BB5 : requête collectes applique .eq(annulee_cote_savr, false)', async () => {
    const sb = makeSupabase([{ data: [], error: null }]);

    await runBatchBrouillonsJ1(sb as never);

    const eqCalls = (sb._chain.eq as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, unknown]>;
    expect(
      eqCalls.some((c) => c[0] === 'annulee_cote_savr' && c[1] === false),
    ).toBe(true);
  });
});

const COLLECTE_ZD_MENSUELLE = {
  id: 'col-zd-mensuel-001',
  type: 'zero_dechet',
  statut: 'cloturee',
  annulee_cote_savr: false,
  pack_antgaspi_id: null,
  evenements: {
    id: 'ev-mensuel-001',
    organisation_id: 'org-mensuel-001',
    nb_pax: 200,
    date_evenement: '2026-06-05',
    organisations: {
      mode_facturation_zd: 'mensuelle',
      grille_tarifaire_zd_id: 'grille-001',
      entites_facturation: [{ id: 'ef-001', siret_verification: 'verifie' }],
    },
  },
};

describe('M1.7 / BatchBrouillons / ZD mensuel — brouillon existant ajout ligne', () => {
  afterEach(() => vi.clearAllMocks());

  it('R-BB6 : brouillon mensuel existant → ligne ajoutée, totaux recalculés, pas de nouvel INSERT facture', async () => {
    const existingBrouillon = {
      id: 'brouillon-mensuel-001',
      montant_ht: 590,
      montant_tva: 118,
      montant_ttc: 708,
    };

    // calculer_tarif_zd consomme 4 calls :
    //   single() × 3 (organisations, grilles_tarifaires_zd, tarifs_zero_dechet)
    //   then() × 1 (tarifs_negocie — pas de .single())
    // creerOuAjouterBrouillonMensuel :
    //   maybySingle (overridden) + insert fc (then) + update (then)
    const sb = makeSupabase([
      { data: [COLLECTE_ZD_MENSUELLE], error: null }, // [0] select collectes
      { data: [], error: null }, // [1] select dejaFactures
      // calculer_tarif_zd internals :
      { data: null, error: null }, // [2] organisations.single() → orgGrilleId=null
      { data: { id: 'grille-001' }, error: null }, // [3] grilles_tarifaires_zd.single() (défaut)
      {
        data: { id: 'tar-1', prix_base_ht: 590, prix_par_couvert_ht: null },
        error: null,
      }, // [4] tarifs_zero_dechet.single()
      { data: [], error: null }, // [5] tarifs_negocie select (then() path)
      // mensuel :
      { data: null, error: null }, // [6] insert factures_collectes
      { data: null, error: null }, // [7] update factures totaux
    ]);
    // maybeSingle retourne le brouillon existant (ne consomme pas la queue)
    (sb._chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: existingBrouillon,
      error: null,
    });

    const result = await runBatchBrouillonsJ1(sb as never);

    expect(result.zd_mensuel).toBe(1);
    expect(result.errors).toHaveLength(0);

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    // Aucun INSERT dans factures (brouillon existant réutilisé)
    const insertFacture = insertCalls.find(
      (c) =>
        c[0].type === 'zero_dechet' && c[0].mode_facturation === 'mensuelle',
    );
    expect(insertFacture).toBeUndefined();
    // Un INSERT dans factures_collectes
    const insertLigne = insertCalls.find(
      (c) => c[0].facture_id === 'brouillon-mensuel-001',
    );
    expect(insertLigne).toBeDefined();

    // Update totaux appelé
    const updateCalls = (sb._chain.update as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const updateTotaux = updateCalls.find((c) => c[0].montant_ht !== undefined);
    expect(updateTotaux).toBeDefined();
    expect((updateTotaux![0] as { montant_ht: number }).montant_ht).toBe(1180); // 590+590
  });
});

describe('M1.7 / creerAvoir / Succès sur facture payee', () => {
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

  it('R-AV3 : avoir sur facture payee → avoir créé, origine annulee, push Pennylane', async () => {
    const facturePayee = { ...FACTURE_EMISE, statut: 'payee' };
    const sb = makeSupabase([
      { data: facturePayee, error: null }, // load facture
      { data: { id: 'av-002' }, error: null }, // insert avoir (single)
      { data: null, error: null }, // insert lignes avoir
      { data: null, error: null }, // update facture origine annulee
      { data: null, error: null }, // update en_attente_pennylane
      { data: null, error: null }, // update pennylane_id
      { data: null, error: null }, // update emise
    ]);
    sb._rpcSingle.mockResolvedValueOnce({ data: 'AV-2026-00002', error: null });

    const result = await creerAvoir(
      sb as never,
      'fac-emise-001',
      'Remboursement',
    );

    expect(result.ok).toBe(true);
    expect(result.numero_avoir).toBe('AV-2026-00002');

    const updateCalls = (sb._chain.update as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const annuleeUpdate = updateCalls.find((c) => c[0].statut === 'annulee');
    expect(annuleeUpdate).toBeDefined();
  });
});

describe('M1.7 / creerAvoir / Double annulation refusée', () => {
  afterEach(() => vi.clearAllMocks());

  it('R-AV4 : avoir sur facture annulee → erreur immédiate', async () => {
    const factureAnnulee = { ...FACTURE_EMISE, statut: 'annulee' };
    const sb = makeSupabase([{ data: factureAnnulee, error: null }]);
    _setPennylaneHandlers(null);
    const createSpy = vi.fn();
    _setPennylaneHandlers({
      createInvoice: createSpy,
      finalizeInvoice: vi.fn(),
      sendEmail: vi.fn(),
      getInvoice: vi.fn(),
      getCustomers: vi.fn(),
      getInvoices: vi.fn(),
      createDraft: vi.fn(),
    });

    const result = await creerAvoir(sb as never, 'fac-emise-001', 'Erreur');

    expect(result.ok).toBe(false);
    expect(result.erreur).toContain('annulee');
    expect(createSpy).not.toHaveBeenCalled();
    _setPennylaneHandlers(null);
  });
});

// ─── Batch AG ─────────────────────────────────────────────────────────────────

const COLLECTE_AG_CLOTUREE = {
  id: 'col-ag-001',
  type: 'anti_gaspi',
  statut: 'cloturee',
  annulee_cote_savr: false,
  pack_antgaspi_id: null,
  evenements: {
    id: 'ev-ag-001',
    organisation_id: 'org-ag-001',
    nb_pax: 100,
    date_evenement: '2026-06-10',
    organisations: {
      mode_facturation_zd: null,
      grille_tarifaire_zd_id: null,
      entites_facturation: [{ id: 'ef-ag-001', siret_verification: 'verifie' }],
    },
  },
};

describe('M1.7 / BatchBrouillons / AG hors pack', () => {
  afterEach(() => vi.clearAllMocks());

  it('R-BB7 : collecte AG cloturee hors pack → brouillon FAG créé (montant 590 HT)', async () => {
    const sb = makeSupabase([
      { data: [COLLECTE_AG_CLOTUREE], error: null }, // select collectes
      { data: [], error: null }, // select dejaFactures
      { data: { id: 'fac-ag-001' }, error: null }, // insert facture (single)
      { data: null, error: null }, // insert facture_collecte
    ]);
    (sb._chain.single as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { id: 'fac-ag-001' },
      error: null,
    });

    const result = await runBatchBrouillonsJ1(sb as never);

    expect(result.ag_par_collecte).toBe(1);
    expect(result.errors).toHaveLength(0);

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const insertFac = insertCalls.find(
      (c) => c[0].type === 'collecte_antigaspi',
    );
    expect(insertFac).toBeDefined();
    expect((insertFac![0] as { montant_ht: number }).montant_ht).toBe(590);
  });
});

describe('M1.7 / BatchBrouillons / ZD mensuel — première création', () => {
  afterEach(() => vi.clearAllMocks());

  it('R-BB8 : aucun brouillon mensuel existant → nouveau brouillon mensuel créé avec ligne', async () => {
    const sb = makeSupabase([
      { data: [COLLECTE_ZD_MENSUELLE], error: null }, // [0] select collectes
      { data: [], error: null }, // [1] select dejaFactures
      // calculer_tarif_zd internals :
      { data: null, error: null }, // [2] organisations.single()
      { data: { id: 'grille-001' }, error: null }, // [3] grilles_tarifaires_zd.single()
      {
        data: { id: 'tar-1', prix_base_ht: 590, prix_par_couvert_ht: null },
        error: null,
      }, // [4] tarifs_zero_dechet.single()
      { data: [], error: null }, // [5] tarifs_negocie (then path)
      // creerOuAjouterBrouillonMensuel — aucun brouillon existant :
      { data: { id: 'fac-mens-new' }, error: null }, // [6] insert facture (single)
      { data: null, error: null }, // [7] insert factures_collectes
    ]);
    // maybeSingle retourne null → pas de brouillon existant
    (sb._chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: null,
      error: null,
    });
    // single() pour insert facture
    (sb._chain.single as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { id: 'fac-mens-new' },
      error: null,
    });

    const result = await runBatchBrouillonsJ1(sb as never);

    expect(result.zd_mensuel).toBe(1);
    expect(result.errors).toHaveLength(0);

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const insertFac = insertCalls.find(
      (c) =>
        c[0].type === 'zero_dechet' && c[0].mode_facturation === 'mensuelle',
    );
    expect(insertFac).toBeDefined();
    expect((insertFac![0] as { periode_debut: string }).periode_debut).toMatch(
      /^\d{4}-\d{2}-01$/,
    );
  });
});

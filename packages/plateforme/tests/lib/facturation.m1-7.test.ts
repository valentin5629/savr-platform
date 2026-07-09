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
import {
  pastillePennylane2h,
  tempsEcouleFr,
  estEnRetard,
  PASTILLE_2H_MS,
} from '../../src/lib/facturation/facture-ui.js';
import {
  setSlackSink,
  type SlackPayload,
} from '@savr/shared/src/alerting/slack.js';

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
    'upsert',
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

describe('M0.9 — Pennylane 429 retryable (BL-P2-33)', () => {
  let teardown: () => void;

  beforeEach(() => {
    teardown = setupPennylaneMock({ create: 'error_429' });
  });

  afterEach(() => {
    teardown();
    vi.clearAllMocks();
  });

  it('BL-P2-33 : 429 create → en_attente_pennylane / retry_1 (jamais echec_4xx terminal)', async () => {
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
    // 429 = rate-limit → retryable (VOLET 3), pas de bascule brouillon/echec_4xx.
    expect(result.statut).toBe('en_attente_pennylane');
    const updateCalls = (sb._chain.update as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const lastUpdate = updateCalls[updateCalls.length - 1]![0];
    expect(lastUpdate.statut).toBe('en_attente_pennylane');
    expect(lastUpdate.pennylane_statut).toBe('retry_1');
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

  it('R-AV1 : avoir sur facture emise → avoir créé + passé à emise, push Pennylane', async () => {
    // M9 : l'origine n'est plus annulée par le code de creerAvoir mais par le
    // trigger trg_avoir_annule_origine quand l'avoir atteint 'emise' (couvre
    // aussi la reprise). L'annulation de l'origine est vérifiée en pgTAP
    // (avoir_annule_origine.test.sql) ; ici on prouve le chemin de succès.
    const sb = makeSupabase([
      { data: FACTURE_EMISE, error: null }, // load facture
      { data: { id: 'av-001' }, error: null }, // insert avoir (single)
      { data: null, error: null }, // insert lignes avoir
      { data: null, error: null }, // update en_attente_pennylane (numéro tardif)
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

    // L'avoir atteint 'emise' (déclencheur de l'annulation d'origine côté DB).
    const updateCalls = (sb._chain.update as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const emiseUpdate = updateCalls.find((c) => c[0].statut === 'emise');
    expect(emiseUpdate).toBeDefined();
    // Le numéro est attribué et persisté (au plus tard, avant le push).
    const numeroUpdate = updateCalls.find(
      (c) => c[0].numero_facture === 'AV-2026-00001',
    );
    expect(numeroUpdate).toBeDefined();
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
    pax: 250,
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

describe('Lot B / M4 — exclusion "déjà facturée" ignore annulee + avoir', () => {
  afterEach(() => vi.clearAllMocks());

  it('R-BB-M4 : la requête "déjà facturées" filtre statut≠annulee ET type≠avoir', async () => {
    const sb = makeSupabase([
      { data: [COLLECTE_ZD_CLOTUREE], error: null }, // select collectes
      { data: [], error: null }, // dejasFC : aucune facture ACTIVE → re-facturable
      {
        data: {
          montant_ht: 590,
          montant_brut_ht: 590,
          tarif_id: 'tar-1',
          remise_pct_cumulee: 0,
        },
        error: null,
      },
      { data: { id: 'fac-new' }, error: null },
      { data: null, error: null },
    ]);
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

    await runBatchBrouillonsJ1(sb as never);

    // Garde anti-régression : sans ces filtres, une collecte dont la facture a été
    // annulée par un avoir resterait exclue (ancien `.not('facture_id','is',null)`).
    const neqCalls = (sb._chain.neq as ReturnType<typeof vi.fn>).mock.calls;
    expect(neqCalls).toContainEqual(['factures.statut', 'annulee']);
    expect(neqCalls).toContainEqual(['factures.type', 'avoir']);
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
    pax: 200,
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

  it('R-AV3 : avoir sur facture payee → avoir créé + passé à emise, push Pennylane', async () => {
    const facturePayee = { ...FACTURE_EMISE, statut: 'payee' };
    const sb = makeSupabase([
      { data: facturePayee, error: null }, // load facture
      { data: { id: 'av-002' }, error: null }, // insert avoir (single)
      { data: null, error: null }, // insert lignes avoir
      { data: null, error: null }, // update en_attente_pennylane (numéro tardif)
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

    // M9 : avoir passé à 'emise' (l'origine est annulée par trigger côté DB).
    const updateCalls = (sb._chain.update as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const emiseUpdate = updateCalls.find((c) => c[0].statut === 'emise');
    expect(emiseUpdate).toBeDefined();
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
    pax: 100,
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
    // BL-P1-FACT-03 : le montant vient désormais du référentiel (tarif unitaire
    // tarifs_packs_ag = 590) − remises AG, plus de 590 en dur. Mock séquencé :
    const sb = makeSupabase([
      { data: [COLLECTE_AG_CLOTUREE], error: null }, // [0] select collectes (then)
      { data: [], error: null }, // [1] select dejaFactures (then)
      { data: { id: 'tarif-u', prix_unitaire_ht: 590 }, error: null }, // [2] tarifs_packs_ag.single()
      { data: [], error: null }, // [3] tarifs_negocie (then) — aucune remise
      { data: { id: 'fac-ag-001' }, error: null }, // [4] insert facture (single)
      { data: null, error: null }, // [5] insert facture_collecte (then)
    ]);

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
    // tarif_applique_source vient du résolveur (plus de littéral 'ag_unitaire')
    const insertFc = insertCalls.find(
      (c) => c[0].tarif_applique_source === 'ag_unitaire',
    );
    expect(insertFc).toBeDefined();
  });

  it('R-BB7b : AG realisee_sans_collecte (hors pack) → facturée au tarif normal + statut inclus dans le batch (§05 §4)', async () => {
    const collecteSansCollecte = {
      ...COLLECTE_AG_CLOTUREE,
      id: 'col-ag-rsc',
      statut: 'realisee_sans_collecte',
    };
    const sb = makeSupabase([
      { data: [collecteSansCollecte], error: null }, // [0] select collectes
      { data: [], error: null }, // [1] dejaFactures
      { data: { id: 'tarif-u', prix_unitaire_ht: 590 }, error: null }, // [2] tarifs_packs_ag
      { data: [], error: null }, // [3] tarifs_negocie
      { data: { id: 'fac-ag-rsc' }, error: null }, // [4] insert facture
      { data: null, error: null }, // [5] insert facture_collecte
    ]);

    const result = await runBatchBrouillonsJ1(sb as never);

    expect(result.ag_par_collecte).toBe(1);
    expect(result.errors).toHaveLength(0);
    // Le filtre de statut du batch inclut bien realisee_sans_collecte.
    const inCalls = (sb._chain.in as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, string[]]>;
    const statutFilter = inCalls.find((c) => c[0] === 'statut');
    expect(statutFilter?.[1]).toContain('realisee_sans_collecte');
    expect(statutFilter?.[1]).toContain('cloturee');
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

// ─── FACT-06 / FACT-07 / FACT-08 (R8) ──────────────────────────────────────────

const PL_INVOICE = {
  id: 'PL-INV-1',
  number: 'FZD-2026-00001',
  status: 'outstanding' as const,
  total_amount: '590.00',
  currency: 'EUR',
  issued_at: '2026-06-25',
  due_at: '2026-07-25',
  customer_id: 'PL-CUST-NEW',
  source_id: 'fac-001',
  file_url: 'https://pennylane/pdf',
};

describe('M1.7 / validerFacture / FACT-06 — client Pennylane Factur-X', () => {
  afterEach(() => {
    _setPennylaneHandlers(null);
    vi.clearAllMocks();
  });

  it('M1.7 FACT-06 : entité sans pennylane_customer_id → createCustomer (adresse complète) + id persisté + facture référence le client', async () => {
    const factureSansClient = {
      ...FACTURE_BROUILLON,
      entites_facturation: {
        ...FACTURE_BROUILLON.entites_facturation,
        pennylane_customer_id: null,
      },
    };
    const captured: {
      customer?: Record<string, unknown>;
      invoice?: Record<string, unknown>;
    } = {};
    _setPennylaneHandlers({
      createCustomer: vi.fn(async (p: Record<string, unknown>) => {
        captured.customer = p;
        return {
          ok: true as const,
          customer: {
            id: 'PL-CUST-NEW',
            name: 'Kaspia SAS',
            billing_email: '',
            vat_number: '',
            siret: '',
            payment_conditions: '',
            source_id: 'ef-001',
          },
        };
      }),
      createInvoice: vi.fn(async (p: Record<string, unknown>) => {
        captured.invoice = p;
        return {
          ok: true as const,
          invoice: { ...PL_INVOICE, status: 'draft' as const },
        };
      }),
      finalizeInvoice: vi.fn(async () => ({
        ok: true as const,
        invoice: PL_INVOICE,
      })),
      sendEmail: vi.fn(async () => ({ ok: true as const })),
      getInvoice: vi.fn(),
      getCustomers: vi.fn(),
      getInvoices: vi.fn(),
      createDraft: vi.fn(),
    });
    const sb = makeSupabase([
      { data: factureSansClient, error: null }, // [0] load facture
      { data: null, error: null }, // [1] update en_attente
      { data: null, error: null }, // [2] update entites_facturation (pennylane_customer_id)
      { data: null, error: null }, // [3] update pennylane_id
      { data: null, error: null }, // [4] update emise
    ]);
    sb._rpcSingle.mockResolvedValueOnce({
      data: 'FZD-2026-00001',
      error: null,
    });

    const result = await validerFacture(sb as never, 'fac-001');

    expect(result.ok).toBe(true);
    // Le client est créé avec l'adresse complète (Factur-X).
    expect(captured.customer).toBeDefined();
    expect(captured.customer!.address).toBe('12 rue de la Paix');
    expect(captured.customer!.postal_code).toBe('75001');
    expect(captured.customer!.city).toBe('Paris');
    // L'id retourné est persisté sur l'entité de facturation.
    const updateCalls = (sb._chain.update as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    expect(
      updateCalls.find((c) => c[0].pennylane_customer_id === 'PL-CUST-NEW'),
    ).toBeDefined();
    // Le payload facture référence le client + porte l'adresse.
    const cust = captured.invoice!.customer as Record<string, unknown>;
    expect(cust.id).toBe('PL-CUST-NEW');
    expect(cust.address).toBe('12 rue de la Paix');
  });
});

describe('M1.7 / RetryWorker / FACT-07 — alerte Slack échec final', () => {
  let teardown: () => void;
  let slackCalls: SlackPayload[];

  beforeEach(() => {
    teardown = setupPennylaneMock({ create: 'error_500' });
    slackCalls = [];
    setSlackSink(async (p) => {
      slackCalls.push(p);
    });
  });

  afterEach(() => {
    teardown();
    setSlackSink(async () => {});
    vi.clearAllMocks();
  });

  it('M1.7 FACT-07 : 3 paliers Pennylane épuisés → alerte Slack #savr-alerts-eleve', async () => {
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
      .mockResolvedValueOnce({ data: null, error: null }); // alerte in-app

    const result = await runPennylaneRetryWorker(sb as never);

    expect(result.dlq).toBe(1);
    expect(slackCalls).toHaveLength(1);
    expect(slackCalls[0]!.canal).toBe('eleve');
    expect(slackCalls[0]!.message).toContain(facture.id);
  });
});

describe('M1.7 / creerAvoir / FACT-08 — payload Pennylane credit_note', () => {
  afterEach(() => {
    _setPennylaneHandlers(null);
    vi.clearAllMocks();
  });

  it('M1.7 FACT-08 : payload avoir = type credit_note (jamais is_credit_note)', async () => {
    const captured: { avoir?: Record<string, unknown> } = {};
    _setPennylaneHandlers({
      createInvoice: vi.fn(async (p: Record<string, unknown>) => {
        captured.avoir = p;
        return {
          ok: true as const,
          invoice: { ...PL_INVOICE, source_id: 'av-001' },
        };
      }),
      finalizeInvoice: vi.fn(async () => ({
        ok: true as const,
        invoice: { ...PL_INVOICE, source_id: 'av-001' },
      })),
      sendEmail: vi.fn(async () => ({ ok: true as const })),
      getInvoice: vi.fn(),
      getCustomers: vi.fn(),
      getInvoices: vi.fn(),
      createDraft: vi.fn(),
    });
    const sb = makeSupabase([
      { data: FACTURE_EMISE, error: null }, // load facture
      { data: { id: 'av-001' }, error: null }, // insert avoir (single)
      { data: null, error: null }, // insert lignes avoir
      { data: null, error: null }, // update en_attente_pennylane
      { data: null, error: null }, // update pennylane_id
      { data: null, error: null }, // update emise
    ]);
    sb._rpcSingle.mockResolvedValueOnce({ data: 'AV-2026-00001', error: null });

    const result = await creerAvoir(sb as never, 'fac-emise-001', 'Annulation');

    expect(result.ok).toBe(true);
    expect(captured.avoir).toBeDefined();
    expect(captured.avoir!.type).toBe('credit_note');
    expect(captured.avoir!.is_credit_note).toBeUndefined();
  });
});

// ─── R22b — Copie de travail PDF Savr (BL-P2-01) ─────────────────────────────

describe('M1.7 / R22b — copie de travail PDF Savr (BL-P2-01)', () => {
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

  it('fact-col-pdf-savr : émission → enfile un jobs_pdf type=facture, entity=factures', async () => {
    const sb = makeSupabase([
      { data: FACTURE_BROUILLON, error: null }, // load
      { data: null, error: null }, // update en_attente
      { data: null, error: null }, // update pennylane_id
      { data: null, error: null }, // update emise
    ]);
    sb._rpcSingle.mockResolvedValueOnce({
      data: 'FZD-2026-00001',
      error: null,
    });

    const result = await validerFacture(sb as never, 'fac-001', 'user-admin');

    expect(result.ok).toBe(true);
    expect(result.statut).toBe('emise');
    // Enfilage vers le worker PDF (entity_type='factures' → écrit pdf_url_savr).
    expect(sb.from).toHaveBeenCalledWith('jobs_pdf');
    expect(sb._chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        type_document: 'facture',
        entity_type: 'factures',
        entity_id: 'fac-001',
        statut: 'pending',
      }),
      expect.objectContaining({
        onConflict: 'entity_type,entity_id,type_document',
      }),
    );
    // Le payload = copie de travail (numéro + lignes + totaux figés).
    const upsertCalls = (
      sb._chain.upsert as unknown as {
        mock: { calls: Array<[Record<string, unknown>]> };
      }
    ).mock.calls;
    const firstCall = upsertCalls[0];
    expect(firstCall).toBeDefined();
    const payload = firstCall![0].payload as Record<string, unknown>;
    expect(payload.numero).toBe('FZD-2026-00001');
    expect(payload.total_ttc).toBe(708);
    expect((payload.lignes as unknown[]).length).toBe(1);
  });

  it('4xx Pennylane (retour brouillon) → AUCUN enqueue facture (jamais de copie sur échec)', async () => {
    teardown();
    teardown = setupPennylaneMock({ create: 'error_4xx' });
    const sb = makeSupabase([
      { data: FACTURE_BROUILLON, error: null }, // load
      { data: null, error: null }, // update en_attente
      { data: null, error: null }, // update 4xx → brouillon
    ]);
    sb._rpcSingle.mockResolvedValueOnce({
      data: 'FZD-2026-00002',
      error: null,
    });

    const result = await validerFacture(sb as never, 'fac-001', 'user-admin');

    expect(result.ok).toBe(false);
    expect(result.statut).toBe('brouillon');
    expect(sb._chain.upsert).not.toHaveBeenCalled();
  });
});

// ─── R22b — Helpers SLA facture (pastille / bandeau / en retard) ─────────────

describe('M1.7 / R22b — helpers SLA facture (BL-P2-01/02)', () => {
  const T0 = Date.parse('2026-07-08T12:00:00.000Z');

  it('fact-pastille-orange-2h : borne stricte > 2h (2h00 → non, 2h01 → oui)', () => {
    const a2h00 = new Date(T0 - PASTILLE_2H_MS).toISOString();
    const b2h01 = new Date(T0 - PASTILLE_2H_MS - 60_000).toISOString();
    expect(pastillePennylane2h('en_attente_pennylane', a2h00, T0)).toBe(false);
    expect(pastillePennylane2h('en_attente_pennylane', b2h01, T0)).toBe(true);
    // Autre statut ou aucune tentative → jamais de pastille.
    expect(pastillePennylane2h('emise', b2h01, T0)).toBe(false);
    expect(pastillePennylane2h('en_attente_pennylane', null, T0)).toBe(false);
  });

  it('fact-bandeau-en-attente : « dernier essai il y a X min / X h »', () => {
    expect(tempsEcouleFr(new Date(T0 - 10 * 60_000).toISOString(), T0)).toBe(
      'il y a 10 min',
    );
    expect(tempsEcouleFr(new Date(T0 - 3 * 3_600_000).toISOString(), T0)).toBe(
      'il y a 3 h',
    );
    expect(
      tempsEcouleFr(new Date(T0 - (3_600_000 + 5 * 60_000)).toISOString(), T0),
    ).toBe('il y a 1 h 5 min');
    expect(tempsEcouleFr(null, T0)).toBe('—');
  });

  it('fact-suivi-en-retard : emise + échéance < aujourd’hui (borne stricte jour)', () => {
    // T0 = 2026-07-08. Échéance du jour → PAS en retard ; hier → en retard.
    expect(estEnRetard('emise', '2026-07-08', T0)).toBe(false);
    expect(estEnRetard('emise', '2026-07-07', T0)).toBe(true);
    // Non emise → jamais « en retard », même échéance dépassée.
    expect(estEnRetard('brouillon', '2026-07-01', T0)).toBe(false);
    expect(estEnRetard('payee', '2026-07-01', T0)).toBe(false);
  });
});

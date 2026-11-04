/**
 * M2.4 — Tests batch J+1 6h AG (attestation_don_ag_batch_avec_snapshot,
 * realisee_sans_collecte_pas_d_attestation, idempotence, mention fiscale conditionnelle,
 * snapshot résistant perte habilitation, régénération auto sur correction volume).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

// Inline du logo : pas de lecture R2 en test, la clé est rendue lisible.
vi.mock('../../src/lib/pdf/logo-inline.js', () => ({
  makeLogoResolver: () => async (cle: string | null | undefined) =>
    cle ? `data:${cle}` : null,
}));

import { runBatchPdfJ1Ag } from '../../src/lib/pdf/batch-pdf-j1-ag.js';
import { logger } from '@savr/shared/src/logger/index.js';

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
      programmeur: { prenom: 'Julie', organisation_id: 'org-1' },
    },
    attributions_antgaspi: {
      id: 'attr-1',
      volume_repas_realise: 120,
      poids_repas_kg: 54.0,
      association_id: 'asso-1',
      associations: {
        nom: 'Les Restos du Cœur',
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

  return { from: vi.fn(() => chain), rpc, _chain: chain };
}

beforeEach(() => vi.clearAllMocks());

// ── Tests ──────────────────────────────────────────────────────────────────

describe('M2.4 / BatchPdfJ1Ag / SIRET donateur non vérifié (décision Val 2026-09-28)', () => {
  const casBloquants: Array<[string, Record<string, unknown>[]]> = [
    [
      'entité SIRET en_attente',
      [
        {
          id: 'entite-1',
          organisation_id: 'org-1',
          raison_sociale: 'Agence AREP',
          siret: '',
          siret_verification: 'en_attente',
        },
      ],
    ],
    [
      'SIRET renseigné mais en échec INSEE',
      [
        {
          id: 'entite-1',
          organisation_id: 'org-1',
          raison_sociale: 'Agence AREP',
          siret: '12345678900001',
          siret_verification: 'echec',
        },
      ],
    ],
    ['aucune entité de facturation', []],
    [
      'statut verifie mais SIRET vide (incohérence de données)',
      [
        {
          id: 'entite-1',
          organisation_id: 'org-1',
          raison_sociale: 'Agence AREP',
          siret: '',
          siret_verification: 'verifie',
        },
      ],
    ],
  ];

  for (const [cas, entites] of casBloquants) {
    it(`${cas} → attestation différée, AUCUN numéro consommé, alerte Ops in-app`, async () => {
      const sb = makeSupabase([
        { data: [makeCollecteAg()], error: null }, // select collectes AG
        { data: [], error: null }, // attestations existantes
        { data: entites, error: null }, // entites_facturation
      ]);

      const result = await runBatchPdfJ1Ag(sb as never);

      expect(result.skipped_siret_donateur).toBe(1);
      expect(result.enqueued).toBe(0);
      expect(result.errors).toHaveLength(0);
      // Pas de fatal : un report n'est pas un échec du job.
      expect(result.fatal).toBeUndefined();

      const rpcCalls = sb.rpc.mock.calls as unknown as Array<
        [string, Record<string, unknown>]
      >;
      // Le numéro ATT-DON gapless n'est JAMAIS alloué pour une attestation différée.
      expect(rpcCalls.map((c) => c[0])).not.toContain(
        'f_next_numero_attestation',
      );
      expect(rpcCalls).toContainEqual([
        'f_upsert_alerte_admin',
        expect.objectContaining({
          p_code: 'attestation_ag_siret_donateur_manquant',
          p_entity_type: 'collectes',
          p_entity_id: 'col-ag-1',
        }),
      ]);
      // Aucune écriture : ni attestation, ni job PDF, ni rapport RSE.
      expect(sb._chain.insert).not.toHaveBeenCalled();
    });
  }
});

describe('M2.4 / BatchPdfJ1Ag / alerte SIRET donateur — cycle de vie', () => {
  it('alerte non posée (RPC en échec) → journalisée, jamais un échec du job', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const sb = makeSupabase([
      { data: [makeCollecteAg()], error: null },
      { data: [], error: null },
      { data: [], error: null }, // aucune entité
    ]);
    sb.rpc.mockImplementation((() =>
      Promise.resolve({
        data: null,
        error: { code: '42501', message: 'permission denied' },
      })) as never);

    const result = await runBatchPdfJ1Ag(sb as never);

    expect(result.skipped_siret_donateur).toBe(1);
    expect(result.fatal).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      'attestation_ag.alerte_non_posee',
      expect.objectContaining({
        collecte_id: 'col-ag-1',
        error_code: '42501',
      }),
    );
    spy.mockRestore();
  });

  it('attestation émise → l’alerte SIRET donateur ouverte de CETTE collecte est résolue', async () => {
    const sb = makeSupabase([
      { data: [makeCollecteAg()], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: 'entite-1',
            organisation_id: 'org-1',
            raison_sociale: 'Kaspia SAS',
            siret: '12345678900001',
            siret_verification: 'verifie',
          },
        ],
        error: null,
      },
      { data: { id: 'att-new' }, error: null },
      { data: 'ATT-DON-2026-00002', error: null },
      { data: [{ id: 'att-new' }], error: null }, // numéro posé sur la ligne
    ]);

    const result = await runBatchPdfJ1Ag(sb as never);
    expect(result.enqueued).toBe(1);

    expect(sb._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ statut: 'resolue' }),
    );
    const eqs = (sb._chain.eq as ReturnType<typeof vi.fn>).mock.calls;
    expect(eqs).toContainEqual([
      'code',
      'attestation_ag_siret_donateur_manquant',
    ]);
    expect(eqs).toContainEqual(['entity_type', 'collectes']);
    expect(eqs).toContainEqual(['entity_id', 'col-ag-1']);
    expect(eqs).toContainEqual(['statut', 'ouverte']);
  });

  it('attestation différée → aucune résolution d’alerte', async () => {
    const sb = makeSupabase([
      { data: [makeCollecteAg()], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]);
    await runBatchPdfJ1Ag(sb as never);
    expect(sb._chain.update).not.toHaveBeenCalled();
  });
});

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
            siret_verification: 'verifie',
          },
        ],
        error: null,
      }, // entites_facturation
      { data: { id: 'att-new' }, error: null }, // insert attestations_don
      { data: 'ATT-DON-2026-00001', error: null }, // rpc f_next_numero_attestation
      { data: [{ id: 'att-new' }], error: null }, // numéro posé sur la ligne
      { data: null, error: null }, // insert jobs_pdf
      { data: { email_principal: 'chef@kaspia.fr' }, error: null }, // select email organisation programmatrice
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
    // Ligne créée sans numéro, numéro posé ensuite (numéro gapless jamais
    // tiré pour une ligne qu'une autre fabrication aurait déjà créée).
    expect(attInsert!.numero).toBeNull();
    const updates = (sb._chain.update as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    expect(updates[0]![0]).toEqual({ numero: 'ATT-DON-2026-00001' });
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
      new Date('2026-06-01').toLocaleDateString('fr-FR', {
        timeZone: 'Europe/Paris',
      }),
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
  it('attestation encore en brouillon (rendu en attente ou en échec) → aucun numéro ATT-DON tiré, rien recréé', async () => {
    const sb = makeSupabase([
      { data: [makeCollecteAg()], error: null },
      {
        data: [
          {
            id: 'att-b',
            collecte_id: 'col-ag-1',
            statut: 'brouillon',
            version: 1,
            numero: 'ATT-DON-2026-00070',
            volume_repas: 120,
          },
        ],
        error: null,
      },
    ]);

    const result = await runBatchPdfJ1Ag(sb as never);

    expect(result.already_done).toBe(1);
    expect(result.enqueued).toBe(0);
    expect(sb.rpc).not.toHaveBeenCalled();
    expect(sb._chain.insert).not.toHaveBeenCalled();
  });

  it("collecte déjà dotée d'une attestation emise → already_done, rien enqueué", async () => {
    const collecte = makeCollecteAg();
    const sb = makeSupabase([
      { data: [collecte], error: null },
      {
        data: [
          {
            id: 'att-e',
            collecte_id: 'col-ag-1',
            statut: 'emise',
            version: 1,
            numero: 'ATT-DON-2026-00071',
            volume_repas: 120,
          },
        ],
        error: null,
      },
      { data: [], error: null }, // entites (pas atteint mais mockée)
    ]);

    const result = await runBatchPdfJ1Ag(sb as never);

    expect(result.already_done).toBe(1);
    expect(result.enqueued).toBe(0);
  });
});

// Val 2026-11-04 : fabrication toutes les 15 min et juste après la saisie
// Admin. Une correction de poids tombée pendant un rendu n'est jamais perdue,
// et deux fabrications simultanées ne brûlent pas de numéro gapless.
describe('M2.4 / BatchPdfJ1Ag / Corrections et fabrications simultanées', () => {
  const entite = {
    data: [
      {
        id: 'entite-1',
        organisation_id: 'org-1',
        raison_sociale: 'Kaspia SAS',
        siret: '12345678900001',
        siret_verification: 'verifie',
      },
    ],
    error: null,
  };
  const att = (o: Record<string, unknown>) => ({
    id: 'att-1',
    collecte_id: 'col-ag-1',
    statut: 'emise',
    version: 1,
    numero: 'ATT-DON-2026-00090',
    volume_repas: 120,
    ...o,
  });
  const updates = (sb: ReturnType<typeof makeSupabase>) =>
    (sb._chain.update as ReturnType<typeof vi.fn>).mock.calls as Array<
      [Record<string, unknown>]
    >;

  it('attestation créée à l’instant par une autre fabrication (23505) → aucun numéro ATT-DON tiré', async () => {
    const sb = makeSupabase([
      { data: [makeCollecteAg()], error: null },
      { data: [], error: null },
      entite,
      { data: null, error: { code: '23505', message: 'duplicate' } },
    ]);
    const result = await runBatchPdfJ1Ag(sb as never);
    expect(sb.rpc).not.toHaveBeenCalled();
    expect(result.already_done).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('brouillon numéroté, poids corrigé pendant que son rendu attend → rendu et ligne prennent les nouveaux repas', async () => {
    const collecte = makeCollecteAg({ co2_evite_kg: 500 });
    collecte.attributions_antgaspi.volume_repas_realise = 200;
    collecte.attributions_antgaspi.poids_repas_kg = 90;
    const sb = makeSupabase([
      { data: [collecte], error: null },
      { data: [att({ statut: 'brouillon', volume_repas: 120 })], error: null },
      {
        data: [
          {
            id: 'job-1',
            payload: { numero: 'ATT-DON-2026-00090', volume_repas: 120 },
          },
        ],
        error: null,
      },
      { data: null, error: null }, // update payload
      { data: null, error: null }, // update attestation
    ]);
    const result = await runBatchPdfJ1Ag(sb as never);
    expect(result.refaits).toBe(1);
    expect(sb.rpc).not.toHaveBeenCalled();
    expect(sb._chain.insert).not.toHaveBeenCalled();
    expect(updates(sb)[0]![0].payload).toMatchObject({
      numero: 'ATT-DON-2026-00090',
      volume_repas: 200,
      poids_kg: 90,
      co2_evite_kg: 500,
    });
    expect(updates(sb)[1]![0]).toMatchObject({
      volume_repas: 200,
      nb_repas: 200,
      poids_kg: 90,
    });
  });

  it('brouillon, rendu en cours (rien en attente) → rien touché, repris au passage suivant', async () => {
    const collecte = makeCollecteAg();
    collecte.attributions_antgaspi.volume_repas_realise = 200;
    const sb = makeSupabase([
      { data: [collecte], error: null },
      { data: [att({ statut: 'brouillon', volume_repas: 120 })], error: null },
      { data: [], error: null }, // aucun rendu en attente ou en échec
    ]);
    const result = await runBatchPdfJ1Ag(sb as never);
    expect(result.refaits).toBe(0);
    expect(sb._chain.update).not.toHaveBeenCalled();
  });

  it('attestation émise dont les repas ne suivent plus le poids → nouvelle version, l’ancienne corrigée', async () => {
    const collecte = makeCollecteAg();
    collecte.attributions_antgaspi.volume_repas_realise = 200;
    const sb = makeSupabase([
      { data: [collecte], error: null },
      { data: [att({ volume_repas: 120 })], error: null },
      entite,
      { data: { id: 'att-2' }, error: null }, // insert v2
      { data: 'ATT-DON-2026-00091', error: null }, // rpc numéro
      { data: [{ id: 'att-2' }], error: null }, // numéro posé
      { data: null, error: null }, // ancienne → corrigee
      { data: null, error: null }, // audit
      { data: null, error: null }, // job
    ]);
    const result = await runBatchPdfJ1Ag(sb as never);
    expect(result.enqueued).toBe(1);
    const inserts = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    expect(inserts[0]![0]).toMatchObject({ version: 2, volume_repas: 200 });
    expect(updates(sb)[1]![0]).toEqual({ statut: 'corrigee' });
  });

  it('attestation émise à jour → rien n’est refait', async () => {
    const sb = makeSupabase([
      { data: [makeCollecteAg()], error: null },
      { data: [att({ volume_repas: 120 })], error: null },
    ]);
    const result = await runBatchPdfJ1Ag(sb as never);
    expect(result.already_done).toBe(1);
    expect(sb.rpc).not.toHaveBeenCalled();
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
            siret_verification: 'verifie',
          },
        ],
        error: null,
      },
      { data: { id: 'att-new-2' }, error: null },
      { data: 'ATT-DON-2026-00002', error: null },
      { data: [{ id: 'att-new-2' }], error: null }, // numéro posé sur la ligne
      { data: null, error: null },
      { data: null, error: null },
      { data: { email_principal: null }, error: null },
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
            siret_verification: 'verifie',
          },
        ],
        error: null,
      },
      { data: { id: 'att-new-3' }, error: null },
      { data: 'ATT-DON-2026-00003', error: null },
      { data: [{ id: 'att-new-3' }], error: null }, // numéro posé sur la ligne
      { data: null, error: null },
      { data: null, error: null },
      { data: { email_principal: null }, error: null },
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

  it('sélection : collectes AG réalisées ou clôturées, sans seuil sur realisee_at (Val 2026-11-04)', async () => {
    const sb = makeSupabase([{ data: [], error: null }]);
    await runBatchPdfJ1Ag(sb as never);
    const inCalls = (sb._chain.in as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, unknown]>;
    expect(inCalls).toContainEqual(['statut', ['realisee', 'cloturee']]);
    const lteCalls = (sb._chain.lte as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, string]>;
    expect(lteCalls.find((c) => c[0] === 'realisee_at')).toBeUndefined();
  });

  it('collecteId : la sélection est restreinte à cette collecte', async () => {
    const sb = makeSupabase([{ data: [], error: null }]);
    await runBatchPdfJ1Ag(sb as never, { collecteId: 'col-ag-9' });
    const eqCalls = (sb._chain.eq as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, unknown]>;
    expect(eqCalls).toContainEqual(['id', 'col-ag-9']);
  });

  it('erreur DB à la sélection → erreur remontée', async () => {
    const sb = makeSupabase([
      { data: null, error: { message: 'connection timeout' } },
    ]);

    const result = await runBatchPdfJ1Ag(sb as never);

    expect(result.errors).toHaveLength(1);
    // Message de la base journalisé, jamais recopié (check-api-error-leak).
    expect(result.errors[0]).toContain('échec de lecture');
    expect(result.errors[0]).not.toContain('connection timeout');
  });
});

describe('M2.4 / BatchPdfJ1Ag / Sans embargo (Val 2026-11-04)', () => {
  it('eligible_at = maintenant : le rapport de don est visible dès son émission', async () => {
    const collecte = makeCollecteAg({
      realisee_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
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
            siret_verification: 'verifie',
          },
        ],
        error: null,
      },
      { data: { id: 'att-emb' }, error: null },
      { data: 'ATT-DON-2026-00004', error: null },
      { data: [{ id: 'att-emb' }], error: null }, // numéro posé sur la ligne
      { data: null, error: null },
      { data: null, error: null },
    ]);

    const before = Date.now();
    const result = await runBatchPdfJ1Ag(sb as never);

    expect(result.enqueued).toBe(1);
    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const attInsert = insertCalls.find(
      (c) => c[0].eligible_at !== undefined,
    )?.[0];
    const eligibleA = new Date(attInsert!.eligible_at as string).getTime();
    expect(eligibleA).toBeGreaterThanOrEqual(before - 1000);
    expect(eligibleA).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('n’envoie plus l’email « rapport de don disponible » (parti à la clôture, à 48 h)', async () => {
    const { sendEmail } = await import('@savr/shared/src/email/index.js');
    const sb = makeSupabase([
      { data: [makeCollecteAg()], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: 'entite-1',
            organisation_id: 'org-1',
            raison_sociale: 'Kaspia SAS',
            siret: '12345678900001',
            siret_verification: 'verifie',
          },
        ],
        error: null,
      },
      { data: { id: 'att-sans-email' }, error: null },
      { data: 'ATT-DON-2026-00006', error: null },
      { data: [{ id: 'att-sans-email' }], error: null }, // numéro posé sur la ligne
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const result = await runBatchPdfJ1Ag(sb as never);
    expect(result.enqueued).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

// Une collecte AG avec excédents n'a qu'un document : l'attestation, affichée
// « Rapport de don » (décision Val 2026-10-09). Le batch ne crée plus de ligne
// rapports_rse pour elle ; la disponibilité est portée par l'attestation.
describe('M2.4 / BatchPdfJ1Ag / pas de rapports_rse pour une collecte AG', () => {
  it('aucune ligne rapports_rse ; l’attestation porte sa date de disponibilité', async () => {
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
            siret_verification: 'verifie',
          },
        ],
        error: null,
      },
      { data: { id: 'att-rse' }, error: null },
      { data: 'ATT-DON-2026-00005', error: null },
      { data: [{ id: 'att-rse' }], error: null }, // numéro posé sur la ligne
      { data: null, error: null }, // jobs_pdf
      { data: { email_principal: null }, error: null },
    ]);

    const result = await runBatchPdfJ1Ag(sb as never);

    expect(result.enqueued).toBe(1);
    const tables = (sb.from as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    expect(tables).toContain('attestations_don');
    expect(tables).not.toContain('rapports_rse');

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    expect(insertCalls.some((c) => c[0].disponible_a !== undefined)).toBe(
      false,
    );
    const attestation = insertCalls.find(
      (c) => c[0].eligible_at !== undefined,
    )?.[0];
    expect(attestation).toBeDefined();
  });
});

/** Texte de la requête de sélection des collectes (1er `.select` embarquant `evenements`). */
function selectionCollectes(sb: { _chain: Record<string, unknown> }): string {
  const calls = (sb._chain['select'] as ReturnType<typeof vi.fn>).mock.calls;
  return (
    calls.map((c) => String(c[0])).find((s) => s.includes('evenements')) ?? ''
  );
}

// §04 associations.numero_rup (arbitrage Val 2026-09-14, divergence M2.4
// `numero-rup-source`) : la colonne source existe désormais (migration
// 20260914180000). Le batch la LIT — elle doit donc figurer dans le select, et
// n'y figurer que sous des noms de colonnes réels (une colonne inexistante fait
// échouer TOUTE la requête → aucune attestation générée, régression 2026-09-11).
describe('M2.4 / BatchPdfJ1Ag / requête de sélection', () => {
  it('sélectionne `numero_rup` (source de l’instantané) sur `associations`', async () => {
    const sb = makeSupabase([{ data: [], error: null }]);
    await runBatchPdfJ1Ag(sb as never);
    const sel = selectionCollectes(sb);
    expect(sel).not.toBe('');
    expect(sel).toMatch(
      /associations\s*\(\s*nom, adresse, habilitee_attestation_fiscale, numero_rup\s*\)/,
    );
  });
});

// Instantané du n° RUP — §04 (`attestations_don.association_numero_rup` figé à
// l'émission) + §06.06 §5 (mention Cerfa 2041-GE affichée seulement si renseigné).
describe('M2.4 / BatchPdfJ1Ag / instantané association_numero_rup', () => {
  beforeEach(() => vi.clearAllMocks());

  /** Joue le batch pour une asso donnée et renvoie l'INSERT attestation + le job PDF. */
  async function runAvecAsso(associations: Record<string, unknown>) {
    const collecte = makeCollecteAg();
    (collecte.attributions_antgaspi as Record<string, unknown>).associations =
      associations;

    const sb = makeSupabase([
      { data: [collecte], error: null }, // select collectes AG
      { data: [], error: null }, // attestations_don existantes
      {
        data: [
          {
            id: 'entite-1',
            organisation_id: 'org-1',
            raison_sociale: 'Kaspia SAS',
            siret: '12345678900001',
            siret_verification: 'verifie',
          },
        ],
        error: null,
      }, // entites_facturation
      { data: { id: 'att-new' }, error: null }, // insert attestations_don
      { data: 'ATT-DON-2026-00042', error: null }, // rpc numéro
      { data: [{ id: 'att-new' }], error: null }, // numéro posé sur la ligne
      { data: null, error: null }, // insert jobs_pdf
      { data: { email_principal: 'chef@kaspia.fr' }, error: null },
    ]);

    const result = await runBatchPdfJ1Ag(sb as never);
    expect(result.errors).toHaveLength(0);

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const attInsert = insertCalls.find(
      (c) => c[0].collecte_id !== undefined,
    )![0];
    const jobPayload = insertCalls.find(
      (c) => c[0].type_document !== undefined,
    )![0].payload as Record<string, unknown>;
    return { attInsert, jobPayload };
  }

  it('association AVEC n° RUP : instantané figé + mention transmise au Cerfa', async () => {
    const { attInsert, jobPayload } = await runAvecAsso({
      nom: 'Les Restos du Cœur',
      adresse: '42 rue du Don, Paris',
      habilitee_attestation_fiscale: true,
      numero_rup: 'W751234567',
    });
    expect(attInsert.association_numero_rup).toBe('W751234567');
    expect(jobPayload.association_numero_rup).toBe('W751234567');
  });

  it('association SANS n° RUP : instantané NULL, émission sans mention', async () => {
    const { attInsert, jobPayload } = await runAvecAsso({
      nom: 'Croix-Rouge',
      adresse: '1 place de la Croix, Lyon',
      habilitee_attestation_fiscale: true,
      numero_rup: null,
    });
    expect(attInsert.association_numero_rup).toBeNull();
    expect(jobPayload.association_numero_rup).toBeNull();
  });
});

// Scénario §06.02 envoi_attestation_don_disponible_batch_ag (divergence M2.4,
// tranché Val 2026-09-14) : destinataire = organisations.email_principal de
// l'organisation programmatrice ; evenements.contact_principal_email n'existe
// pas en V1 (G7 column-db) → jamais lu.
describe('attestation de don — logo du client (Val 2026-10-30)', () => {
  function sbPour(collecte: unknown) {
    return makeSupabase([
      { data: [collecte], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: 'entite-1',
            organisation_id: 'org-1',
            raison_sociale: 'Kaspia SAS',
            siret: '12345678900001',
            siret_verification: 'verifie',
          },
        ],
        error: null,
      },
      { data: { id: 'att-new' }, error: null },
      { data: 'ATT-DON-2026-00001', error: null },
      { data: [{ id: 'att-new' }], error: null }, // numéro posé sur la ligne
      { data: null, error: null },
      { data: { email_principal: 'chef@kaspia.fr' }, error: null },
    ]);
  }
  function payloadJob(sb: ReturnType<typeof makeSupabase>) {
    const calls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    return calls.find((c) => c[0].type_document !== undefined)![0]
      .payload as Record<string, unknown>;
  }
  const base = makeCollecteAg();

  it('logo déposé sur l’événement → imprimé, devant celui du compte client', async () => {
    const sb = sbPour({
      ...base,
      evenements: {
        ...base.evenements,
        logo_client_organisateur_url: 'cle-deposee',
        organisations: { type: 'traiteur', logo_url: 'cle-traiteur' },
        traiteur_operationnel: null,
        client_organisateur: { logo_url: 'cle-compte-client' },
      },
    });
    await runBatchPdfJ1Ag(sb as never);
    expect(payloadJob(sb).logo_client_url).toBe('data:cle-deposee');
  });

  it('seul le traiteur a un logo → aucun logo client (le traiteur ne prend pas la place)', async () => {
    const sb = sbPour({
      ...base,
      evenements: {
        ...base.evenements,
        logo_client_organisateur_url: null,
        organisations: { type: 'traiteur', logo_url: 'cle-traiteur' },
        traiteur_operationnel: null,
        client_organisateur: null,
      },
    });
    await runBatchPdfJ1Ag(sb as never);
    expect(payloadJob(sb).logo_client_url).toBeNull();
  });

  it('sélectionne les logos de l’événement dans la lecture des collectes', () => {
    const src = readFileSync(
      fileURLToPath(
        new URL('../../src/lib/pdf/batch-pdf-j1-ag.ts', import.meta.url),
      ),
      'utf8',
    );
    expect(src).toContain('${SELECT_LOGOS_EVENEMENT}');
  });
});

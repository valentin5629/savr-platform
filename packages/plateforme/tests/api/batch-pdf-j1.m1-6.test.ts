/**
 * M1.6 — Tests batch J+1 6h (sélection collectes → enqueue jobs_pdf)
 * Scénarios P1 : nominal, skip pesées vides, escalade R9 > 48h, idempotence, embargo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

// BL-P3-05 : le logo (clé R2 de la cascade) est inliné en data URI via getObjectBytes.
const getObjectBytes = vi.fn().mockResolvedValue(Buffer.from([1, 2, 3]));
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getObjectBytes: (...a: unknown[]) => getObjectBytes(...a),
}));

import { sendEmail } from '@savr/shared/src/email/index.js';
import { runBatchPdfJ1 } from '../../src/lib/pdf/batch-pdf-j1.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCollecte(overrides: Record<string, unknown> = {}) {
  return {
    id: 'col-1',
    evenement_id: 'ev-1',
    realisee_at: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
    date_collecte: '2026-06-13',
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
      // Programmeur (evenements.created_by → users) : variable `prenom` de l'email.
      programmeur: { prenom: 'Léa', organisation_id: 'org-1' },
      organisations: {
        raison_sociale: 'Kaspia SAS',
        siret: '12345678900001',
        adresse: '12 rue de la Paix, 75001 Paris',
        email_principal: 'contact@kaspia.fr',
        type: 'traiteur',
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

beforeEach(() => {
  vi.clearAllMocks();
  // Clés de logo bornées au bucket applicatif (lib/logo-key.ts).
  vi.stubEnv('R2_BUCKET_NAME', 'savr-dev');
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('M1.6 / BatchPdfJ1 / Nominal', () => {
  it('R-PDF1 : collecte ZD cloturee avec flux → bordereau mis en file ; le rapport naît sans PDF, fabriqué au clic (décision Val 2026-10-16)', async () => {
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
      { data: { id: 'bord-new' }, error: null }, // insert bordereaux_savr
      { data: { id: 'rse-new' }, error: null }, // insert rapports_rse
      { data: null, error: null }, // insert job bordereau
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
    // Plus de rapport fabriqué automatiquement : seul le bordereau part au rendu.
    expect(types).toEqual(['bordereau-zd']);

    // La ligne rapports_rse est posée (fin d'embargo = rapport téléchargeable) ;
    // le batch ne lit rien du parc et ne fige aucun filtre de comparaison.
    const rpcNames = (sb.rpc as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(rpcNames).toEqual(['f_next_numero_bordereau']);
    const rseInsert = insertCalls.find(
      (c) => c[0].genere_par === 'automatique',
    )?.[0];
    expect(rseInsert).toBeDefined();
    expect(rseInsert).not.toHaveProperty('filtres_benchmark');
    expect(rseInsert).not.toHaveProperty('genere_at');

    // BL-P2-16 : le payload bordereau porte l'équivalent bacs.
    const bordJob = insertCalls.find(
      (c) => c[0].type_document === 'bordereau-zd',
    )?.[0];
    const bordFlux = (bordJob!.payload as { flux: Array<{ nb_bacs: number }> })
      .flux;
    expect(bordFlux[0]!.nb_bacs).toBe(3);
  });
});

// Lot C2 (décision Val Q5 du 2026-10-24) : le bordereau imprime les convives de
// LA collecte, jamais ceux de l'événement (tous jours et toutes collectes).
describe('M1.6 / BatchPdfJ1 / Convives de la collecte', () => {
  async function payloadBordereau(collecte: Record<string, unknown>) {
    const sb = makeSupabase([
      { data: [collecte], error: null }, // select collectes
      { data: [], error: null }, // select bordereaux existants
      { count: 1, error: null }, // count collecte_flux
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
      }, // select flux
      { data: 'BSAV-2026-00001', error: null }, // rpc numero
      { data: { nom: 'Strike Transport', siret: '98765432100011' } }, // prestataire
      { data: { id: 'bord-new' }, error: null }, // insert bordereaux_savr
      { data: { id: 'rse-new' }, error: null }, // insert rapports_rse
      { data: null, error: null }, // insert job bordereau
    ]);
    await runBatchPdfJ1(sb as never);
    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const select = String(
      (sb._chain.select as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    );
    const job = insertCalls.find(
      (c) => c[0].type_document === 'bordereau-zd',
    )?.[0];
    return { payload: job!.payload as Record<string, unknown>, select };
  }
  const evenement900 = {
    ...(makeCollecte().evenements as Record<string, unknown>),
    pax: 900,
  };

  it('bordereau : nb_pax = convives de LA collecte (300), pas ceux de l’événement (900)', async () => {
    const { payload, select } = await payloadBordereau(
      makeCollecte({ pax: 300, evenements: evenement900 }),
    );
    expect(payload.nb_pax).toBe(300);
    const [colonnesCollecte, embedEvenement] = select.split('evenements (');
    expect(colonnesCollecte).toMatch(/\bpax\b/);
    expect(embedEvenement).not.toMatch(/\bpax\b/);
  });

  it('bordereau : collecte à 0 convive (inconnu, reprise Bubble) → nb_pax null, mention omise', async () => {
    const { payload } = await payloadBordereau(
      makeCollecte({ pax: 0, evenements: evenement900 }),
    );
    expect(payload.nb_pax).toBeNull();
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

// Val 2026-11-04 : le bordereau sort dès que les pesées sont là, sans embargo.
describe('M1.6 / BatchPdfJ1 / Sans embargo (Val 2026-11-04)', () => {
  it('rapports_rse.disponible_a = maintenant, quelle que soit l’heure de réalisation', async () => {
    const collecte = makeCollecte({
      realisee_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
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
      { data: { nom: 'Strike Transport', siret: '98765432100011' } },
      { data: { id: 'bord-x' }, error: null },
      { data: { id: 'rse-x' }, error: null },
      { data: null, error: null },
    ]);

    const before = Date.now();
    const result = await runBatchPdfJ1(sb as never);

    expect(result.enqueued).toBe(1);
    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const rseInsert = insertCalls.find(
      (c) => c[0].disponible_a !== undefined,
    )?.[0];
    const disponibleA = new Date(rseInsert!.disponible_a as string).getTime();
    expect(disponibleA).toBeGreaterThanOrEqual(before - 1000);
    expect(disponibleA).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('sélection : collectes réalisées ou clôturées, sans seuil sur realisee_at', async () => {
    const sb = makeSupabase([{ data: [], error: null }]);
    await runBatchPdfJ1(sb as never);

    const inCalls = (sb._chain.in as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, unknown]>;
    expect(inCalls).toContainEqual(['statut', ['realisee', 'cloturee']]);
    const lteCalls = (sb._chain.lte as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, string]>;
    expect(lteCalls.find((c) => c[0] === 'realisee_at')).toBeUndefined();
  });

  it('collecteId : la sélection est restreinte à cette collecte', async () => {
    const sb = makeSupabase([{ data: [], error: null }]);
    await runBatchPdfJ1(sb as never, { collecteId: 'col-9' });
    const eqCalls = (sb._chain.eq as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, unknown]>;
    expect(eqCalls).toContainEqual(['id', 'col-9']);
  });

  it('n’envoie plus l’email « rapport disponible » (parti à la clôture, à 48 h)', async () => {
    const sb = makeSupabase([
      { data: [makeCollecte()], error: null },
      { data: [], error: null },
      { count: 1, error: null },
      { data: [{ flux_id: 'f1', poids_reel_kg: 10, flux: { nom: 'Verre' } }] },
      { data: 'BSAV-2026-00003', error: null },
      { data: { nom: 'Strike Transport', siret: '98765432100011' } },
      { data: { id: 'bord-y' }, error: null },
      { data: { id: 'rse-y' }, error: null },
      { data: null, error: null },
    ]);
    const result = await runBatchPdfJ1(sb as never);
    expect(result.enqueued).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

// Val 2026-11-04 : une pesée corrigée refait le bordereau émis (même numéro,
// version suivante), avant comme après la clôture quand l'Admin la saisit.
describe('M1.6 / BatchPdfJ1 / Bordereau refait sur pesées corrigées', () => {
  const emis = {
    id: 'bord-1',
    collecte_id: 'col-1',
    statut: 'emis',
    version: 1,
    detail_flux: [
      { nom: 'Verre', poids_kg: 10, nb_bacs: null, equivalent_roll: null },
    ],
  };
  const dernierRendu = {
    payload: { numero: 'BSAV-2026-00009', date_emission: '01/11/2026' },
  };

  it('collecte réalisée, pesée changée → rendu remis en file avec les nouvelles pesées, version 2', async () => {
    const sb = makeSupabase([
      { data: [makeCollecte({ statut: 'realisee' })], error: null },
      { data: [emis], error: null },
      { data: [{ flux_id: 'f1', poids_reel_kg: 25, flux: { nom: 'Verre' } }] },
      { data: dernierRendu, error: null }, // dernier job (maybeSingle)
      { data: null, error: null }, // insert job
      { data: null, error: null }, // update bordereau
    ]);

    const result = await runBatchPdfJ1(sb as never);

    expect(result.refaits).toBe(1);
    expect(result.enqueued).toBe(0);
    const insert = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Record<string, unknown>;
    expect(insert.type_document).toBe('bordereau-zd');
    expect(insert.entity_id).toBe('bord-1');
    const payload = insert.payload as Record<string, unknown>;
    expect(payload.numero).toBe('BSAV-2026-00009');
    expect(payload.poids_total_kg).toBe(25);
    expect(payload.regenere_le).toBeDefined();
    const update = (sb._chain.update as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Record<string, unknown>;
    expect(update).toMatchObject({ poids_total_kg: 25, version: 2 });
  });

  it('pesées inchangées → rien n’est refait', async () => {
    const sb = makeSupabase([
      { data: [makeCollecte({ statut: 'realisee' })], error: null },
      { data: [emis], error: null },
      { data: [{ flux_id: 'f1', poids_reel_kg: 10, flux: { nom: 'Verre' } }] },
    ]);
    const result = await runBatchPdfJ1(sb as never);
    expect(result.refaits).toBe(0);
    expect(sb._chain.insert).not.toHaveBeenCalled();
    expect(sb._chain.update).not.toHaveBeenCalled();
  });

  it('collecte clôturée, passage planifié → pas revue (MTS-1 ne corrige plus)', async () => {
    const sb = makeSupabase([
      { data: [makeCollecte({ statut: 'cloturee' })], error: null },
      { data: [emis], error: null },
    ]);
    const result = await runBatchPdfJ1(sb as never);
    expect(result.refaits).toBe(0);
    expect(result.already_done).toBe(1);
    expect(sb._chain.insert).not.toHaveBeenCalled();
  });

  it('collecte clôturée nommée (saisie Admin) → revue et refaite', async () => {
    const sb = makeSupabase([
      { data: [makeCollecte({ statut: 'cloturee' })], error: null },
      { data: [emis], error: null },
      { data: [{ flux_id: 'f1', poids_reel_kg: 30, flux: { nom: 'Verre' } }] },
      { data: dernierRendu, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const result = await runBatchPdfJ1(sb as never, { collecteId: 'col-1' });
    expect(result.refaits).toBe(1);
  });

  it('un rendu attend déjà dans la file → il prend les nouvelles pesées', async () => {
    const sb = makeSupabase([
      { data: [makeCollecte({ statut: 'realisee' })], error: null },
      { data: [emis], error: null },
      { data: [{ flux_id: 'f1', poids_reel_kg: 25, flux: { nom: 'Verre' } }] },
      { data: dernierRendu, error: null },
      { data: null, error: { code: '23505', message: 'duplicate' } }, // insert
      { data: [{ id: 'job-attente' }], error: null }, // update payload du job
      { data: null, error: null }, // update bordereau
    ]);
    const result = await runBatchPdfJ1(sb as never);
    expect(result.refaits).toBe(1);
    const updates = (sb._chain.update as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    expect(
      (updates[0]![0].payload as Record<string, unknown>).poids_total_kg,
    ).toBe(25);
    expect(updates[1]![0]).toMatchObject({ version: 2 });
  });

  it('rendu en cours (rien en attente à reprendre) → bordereau laissé tel quel, repris au passage suivant', async () => {
    const sb = makeSupabase([
      { data: [makeCollecte({ statut: 'realisee' })], error: null },
      { data: [emis], error: null },
      { data: [{ flux_id: 'f1', poids_reel_kg: 25, flux: { nom: 'Verre' } }] },
      { data: dernierRendu, error: null },
      { data: null, error: { code: '23505', message: 'duplicate' } },
      { data: [], error: null },
    ]);
    const result = await runBatchPdfJ1(sb as never);
    expect(result.refaits).toBe(0);
    expect(sb._chain.update).toHaveBeenCalledTimes(1);
  });
});

/** Texte de la requête de sélection des collectes (1er `.select` embarquant `evenements`). */
function selectionCollectes(sb: { _chain: Record<string, unknown> }): string {
  const calls = (sb._chain['select'] as ReturnType<typeof vi.fn>).mock.calls;
  return (
    calls.map((c) => String(c[0])).find((s) => s.includes('evenements')) ?? ''
  );
}

describe('M1.6 / BatchPdfJ1 / requête de sélection', () => {
  it("embed programmateur qualifié par sa FK — jamais d'embed `organisations(...)` ambigu", async () => {
    const sb = makeSupabase([{ data: [], error: null }]);
    await runBatchPdfJ1(sb as never);
    const sel = selectionCollectes(sb);
    expect(sel).not.toBe('');
    expect(sel).toContain('organisations!organisation_id');
    expect(sel).not.toMatch(/\borganisations\s*\(/);
  });
});

describe('M1.6 / BatchPdfJ1 / Date d’intervention (§12 §1.1, §04 bordereaux_savr.date_collecte)', () => {
  // Relevé savr-dev 2026-10-02 : collecte ZD du 10/09 clôturée, batch exécuté le 01/10
  // → bordereau ET rapport affichaient « Intervention le 01/10/2026 » (jour du batch) et
  // bordereaux_savr.date_collecte portait le jour d'émission. La date d'intervention est
  // `collectes.date_collecte`, jamais la date du jour : on fige l'horloge à un jour
  // DIFFÉRENT de la collecte pour que le test distingue les deux.
  const JOUR_BATCH = new Date('2026-10-01T04:00:00.000Z'); // 06:00 Paris (été)

  afterEach(() => {
    vi.useRealTimers();
  });

  it('bordereau : date_collecte = date de la collecte, date_emission = jour du batch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(JOUR_BATCH);

    const collecte = makeCollecte({
      date_collecte: '2026-09-10',
      realisee_at: '2026-09-11T02:00:00.000Z',
      evenements: {
        ...makeCollecte().evenements,
        // Événement du 09/09, intervention la nuit suivante : la mention
        // « Intervention le … » n'apparaît que si les deux dates diffèrent.
        date_evenement: '2026-09-09',
      },
    });
    const sb = makeSupabase([
      { data: [collecte], error: null }, // select collectes
      { data: [], error: null }, // bordereaux existants
      { count: 1, error: null }, // count collecte_flux
      {
        data: [
          { flux_id: 'f1', poids_reel_kg: 10, flux: { nom: 'Biodéchets' } },
        ],
      }, // flux
      { data: 'BSAV-2026-00042', error: null }, // rpc numero
      {
        data: { nom: 'Strike Transport', siret: '98765432100011' },
      }, // shared.prestataires
      { data: { id: 'bord-date' }, error: null }, // insert bordereaux_savr
      { data: { id: 'rse-date' }, error: null }, // insert rapports_rse
      { data: null, error: null }, // job bordereau
    ]);

    const result = await runBatchPdfJ1(sb as never);
    expect(result.enqueued).toBe(1);
    expect(result.errors).toHaveLength(0);

    // La sélection doit demander la colonne (sinon undefined → '' silencieux).
    const selectArgs = (sb._chain.select as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    expect(selectArgs).toMatch(/\bdate_collecte\b/);

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;

    // Ligne bordereaux_savr (document réglementaire, snapshot) : DATE « YYYY-MM-DD ».
    const bordRow = insertCalls.find(
      (c) => c[0].numero === 'BSAV-2026-00042',
    )?.[0];
    expect(bordRow).toBeDefined();
    expect(bordRow!.date_collecte).toBe('2026-09-10');
    expect(bordRow!.date_emission).toBe('2026-10-01');

    // Payload bordereau (rendu Railway) : « JJ/MM/AAAA ».
    const bordJob = insertCalls.find(
      (c) => c[0].type_document === 'bordereau-zd',
    )?.[0];
    const bordPayload = bordJob!.payload as Record<string, string>;
    expect(bordPayload.date_collecte).toBe('10/09/2026');
    expect(bordPayload.date_evenement).toBe('09/09/2026');
    expect(bordPayload.date_emission).toBe('01/10/2026');
  });
});

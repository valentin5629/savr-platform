/**
 * M2.4 — Batch « Événement sans excédent alimentaire » (§12 §1.3-bis, BL-P1-RPT-02).
 * Décision Val 2026-07-07 : batch dédié nightly, SANS embargo H+24
 * (disponible_a = genere_at). Génère une ligne rapports_rse standard + job PDF
 * type_document 'rapport-evenement-sans-excedent' pour les collectes AG
 * realisee_sans_collecte. Idempotent (skip si rapports_rse existe).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { runBatchSansExcedent } from '../../src/lib/pdf/batch-pdf-sans-excedent.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCollecteSansExcedent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'col-se-1',
    evenement_id: 'ev-1',
    controle_acces_requis: false,
    aucun_repas_motif: 'Client absent / Marchandise refusée',
    evenements: {
      nom_evenement: 'Cocktail Élysée',
      date_evenement: '2026-07-01',
      pax: 200,
      nom_client_organisateur: 'Mairie de Paris',
      organisation_id: 'org-traiteur-1',
      traiteur_operationnel_organisation_id: null,
      client_organisateur_organisation_id: null,
      logo_client_organisateur_url: null,
      organisations: {
        raison_sociale: 'Traiteur Deluxe',
        type: 'traiteur',
        logo_url: null,
      },
      traiteur_operationnel: null,
      client_organisateur: null,
      lieux: {
        nom: 'Palais',
        adresse_acces: '55 rue du Faubourg',
        code_postal: '75008',
        ville: 'Paris',
      },
    },
    ...overrides,
  };
}

const TOURNEE_OK = [
  {
    rang: 1,
    tournee: {
      heure_debut_reelle: '2026-07-01T20:30:00.000Z',
      chauffeur_nom: 'Jean Vélo',
      plaque_immatriculation: 'AB-123-CD',
    },
  },
];

/** Mock Supabase — chaîne thenable consommant responses[] séquentiellement. */
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

  return { from: vi.fn(() => chain), _chain: chain };
}

function insertCalls(sb: ReturnType<typeof makeSupabase>) {
  return (sb._chain.insert as ReturnType<typeof vi.fn>).mock.calls as Array<
    [Record<string, unknown>]
  >;
}
function rapportsRseInsert(sb: ReturnType<typeof makeSupabase>) {
  return insertCalls(sb).find((c) => c[0].disponible_a !== undefined)?.[0];
}
function jobInsert(sb: ReturnType<typeof makeSupabase>) {
  return insertCalls(sb).find((c) => c[0].type_document !== undefined)?.[0];
}

// Séquence happy path (1 collecte) : [0] collectes, [1] rapports_rse existants,
// [2] collecte_tournees, [3] factures_collectes, [4] insert rapports_rse (single),
// [5] insert jobs_pdf.
function happyResponses(
  collecte: Record<string, unknown>,
  opts: {
    tournee?: unknown[];
    factures?: unknown[];
  } = {},
) {
  return [
    { data: [collecte], error: null },
    { data: [], error: null },
    { data: opts.tournee ?? TOURNEE_OK, error: null },
    { data: opts.factures ?? [], error: null },
    { data: { id: 'rap-se-1' }, error: null },
    { data: null, error: null },
  ];
}

beforeEach(() => vi.clearAllMocks());

// ── Tests ──────────────────────────────────────────────────────────────────

describe('M2.4 / batch sans-excédent — génération (BL-P1-RPT-02)', () => {
  it('collecte AG realisee_sans_collecte → 1 rapport rapports_rse + job PDF sans-excédent', async () => {
    const sb = makeSupabase(happyResponses(makeCollecteSansExcedent()));

    const result = await runBatchSansExcedent(sb as never);

    expect(result.enqueued).toBe(1);
    expect(result.already_done).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Ligne rapports_rse standard : pas de colonne discriminante de type.
    const rse = rapportsRseInsert(sb);
    expect(rse).toBeDefined();
    expect(rse!.collecte_id).toBe('col-se-1');
    expect(rse!.evenement_id).toBe('ev-1');
    expect(rse!.genere_par).toBe('automatique');
    expect(rse!.type).toBeUndefined();
    expect(rse!.statut).toBeUndefined();

    // Job PDF : nouveau type_document + entity_type rapports_rse (worker générique).
    const job = jobInsert(sb);
    expect(job).toBeDefined();
    expect(job!.type_document).toBe('rapport-evenement-sans-excedent');
    expect(job!.entity_type).toBe('rapports_rse');
    expect(job!.entity_id).toBe('rap-se-1');
    const payload = job!.payload as Record<string, unknown>;
    expect(payload.nom_evenement).toBe('Cocktail Élysée');
    expect(payload.chauffeur_nom).toBe('Jean Vélo');
    expect(payload.motif).toBe('Client absent / Marchandise refusée');
    expect(payload.client_organisateur_nom).toBe('Mairie de Paris');
  });

  it('pas d’embargo H+24 : disponible_a ≈ now (pas realisee_at+24h) + aucun filtre .lte(realisee_at)', async () => {
    const sb = makeSupabase(happyResponses(makeCollecteSansExcedent()));

    const before = Date.now();
    await runBatchSansExcedent(sb as never);
    const after = Date.now();

    const rse = rapportsRseInsert(sb);
    const disponibleA = new Date(rse!.disponible_a as string).getTime();
    expect(disponibleA).toBeGreaterThanOrEqual(before - 1000);
    expect(disponibleA).toBeLessThanOrEqual(after + 1000);

    // Aucune garde d'embargo entrante : le batch ne filtre jamais sur realisee_at.
    const lteCalls = (sb._chain.lte as ReturnType<typeof vi.fn>).mock.calls;
    expect(lteCalls).toHaveLength(0);
  });

  it('plaque masquée si controle_acces_requis=false, présente si true (§1.3-bis)', async () => {
    const sbSans = makeSupabase(
      happyResponses(
        makeCollecteSansExcedent({ controle_acces_requis: false }),
      ),
    );
    await runBatchSansExcedent(sbSans as never);
    const payloadSans = jobInsert(sbSans)!.payload as Record<string, unknown>;
    expect(payloadSans.plaque_immatriculation).toBeNull();

    const sbAvec = makeSupabase(
      happyResponses(makeCollecteSansExcedent({ controle_acces_requis: true })),
    );
    await runBatchSansExcedent(sbAvec as never);
    const payloadAvec = jobInsert(sbAvec)!.payload as Record<string, unknown>;
    expect(payloadAvec.plaque_immatriculation).toBe('AB-123-CD');
  });

  it('présentation chauffeur = heure_debut_reelle formatée FR', async () => {
    const sb = makeSupabase(happyResponses(makeCollecteSansExcedent()));
    await runBatchSansExcedent(sb as never);
    const payload = jobInsert(sb)!.payload as Record<string, unknown>;
    // Formatage FR jj/mm/aaaa hh:mm (fuseau local du runner) — on vérifie la présence.
    expect(String(payload.presentation_datetime)).toMatch(
      /\d{2}\/\d{2}\/\d{4}/,
    );
  });

  it('référence facture incluse si émise, ignorée si brouillon', async () => {
    const sbEmise = makeSupabase(
      happyResponses(makeCollecteSansExcedent(), {
        factures: [
          { facture: { numero_facture: 'FAC-2026-00042', statut: 'emise' } },
        ],
      }),
    );
    await runBatchSansExcedent(sbEmise as never);
    expect(
      (jobInsert(sbEmise)!.payload as Record<string, unknown>)
        .reference_facture,
    ).toBe('FAC-2026-00042');

    const sbBrouillon = makeSupabase(
      happyResponses(makeCollecteSansExcedent(), {
        factures: [{ facture: { numero_facture: null, statut: 'brouillon' } }],
      }),
    );
    await runBatchSansExcedent(sbBrouillon as never);
    expect(
      (jobInsert(sbBrouillon)!.payload as Record<string, unknown>)
        .reference_facture,
    ).toBeNull();
  });
});

describe('M2.4 / batch sans-excédent — cascade logo §1.2 (BL-P2-19 cohérence AG)', () => {
  it('programmateur agence → logo agence posé dans le payload', async () => {
    const collecte = makeCollecteSansExcedent({
      evenements: {
        nom_evenement: 'Cocktail Élysée',
        date_evenement: '2026-07-01',
        pax: 200,
        nom_client_organisateur: null,
        organisation_id: 'org-agence',
        traiteur_operationnel_organisation_id: 'org-traiteur',
        client_organisateur_organisation_id: null,
        logo_client_organisateur_url: null,
        organisations: {
          raison_sociale: 'Agence Événement',
          type: 'agence',
          logo_url: 'https://cdn/agence-logo.png',
        },
        traiteur_operationnel: {
          raison_sociale: 'Traiteur Op',
          logo_url: 'https://cdn/traiteur-logo.png',
        },
        client_organisateur: null,
        lieux: {
          nom: 'Palais',
          adresse_acces: '55 rue',
          code_postal: '75008',
          ville: 'Paris',
        },
      },
    });
    const sb = makeSupabase(happyResponses(collecte));
    await runBatchSansExcedent(sb as never);
    const payload = jobInsert(sb)!.payload as Record<string, unknown>;
    // Agence prime sur le traiteur opérationnel (§1.2 l.86-90).
    expect(payload.logo_url).toBe('https://cdn/agence-logo.png');
  });
});

describe('M2.4 / batch sans-excédent — idempotence & sélection', () => {
  it('rapport rapports_rse déjà présent → already_done, rien enqueué', async () => {
    const sb = makeSupabase([
      { data: [makeCollecteSansExcedent()], error: null },
      { data: [{ collecte_id: 'col-se-1' }], error: null },
    ]);

    const result = await runBatchSansExcedent(sb as never);
    expect(result.already_done).toBe(1);
    expect(result.enqueued).toBe(0);
  });

  it('aucune collecte sans-excédent → result vide sans erreur', async () => {
    const sb = makeSupabase([{ data: [], error: null }]);
    const result = await runBatchSansExcedent(sb as never);
    expect(result.enqueued).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('erreur DB à la sélection → erreur remontée', async () => {
    const sb = makeSupabase([
      { data: null, error: { message: 'connection timeout' } },
    ]);
    const result = await runBatchSansExcedent(sb as never);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('connection timeout');
  });
});

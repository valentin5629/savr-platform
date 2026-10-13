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
import { logger } from '@savr/shared/src/logger/index.js';
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
      programmeur: { prenom: 'Léa' },
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

    // BL-P1-RPT-01 : le rapport automatique est la version SANS radar. Le batch
    // ne lit donc rien du parc, et le rapport naît sans filtres de comparaison
    // figés (filtres_benchmark absent de l'insert → NULL en base).
    const rpcNames = (sb.rpc as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(rpcNames).toEqual(['f_next_numero_bordereau']);
    const rseInsert = insertCalls.find(
      (c) => c[0].genere_par === 'automatique',
    )?.[0];
    expect(rseInsert).toBeDefined();
    expect(rseInsert).not.toHaveProperty('filtres_benchmark');
    const rapPayload = insertCalls.find(
      (c) => c[0].type_document === 'rapport-recyclage-zd',
    )![0].payload as Record<string, unknown>;
    expect(rapPayload.options).toEqual({ benchmark: false });
    expect(rapPayload).not.toHaveProperty('benchmark_flux');
    expect(rapPayload).not.toHaveProperty('benchmark_legende');
    expect(rapPayload).not.toHaveProperty('comparaison_savr');

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
  /** Collecte programmée par une agence, traiteur opérationnel distinct, deux logos. */
  async function jobRapportAgenceEtTraiteur() {
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
          logo_url: 'savr-dev/logos/a9e1c2d3-4b5c-4d6e-8f70-81a2b3c4d5e6.png',
        },
        traiteur_operationnel: {
          raison_sociale: 'Traiteur Op',
          siret: '22222222200002',
          adresse: '2 rue',
          logo_url: 'savr-dev/logos/b8f2d3e4-5c6d-4e7f-9a81-92b3c4d5e6f7.png',
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
    return rapJob!;
  }

  it('programmateur agence → logo agence posé dans le payload rapport (prime sur traiteur)', async () => {
    // §1.2 l.86-90 : l'agence programmatrice prime dans l'emplacement « client ».
    const rapJob = await jobRapportAgenceEtTraiteur();
    // BL-P3-05 : le logo agence (gagnant de la cascade) est inliné en data URI
    // (le renderer n'affiche pas une clé R2 brute) — la clé agence est bien celle
    // téléchargée (prime sur le traiteur).
    expect(getObjectBytes).toHaveBeenCalledWith(
      'savr-dev/logos/a9e1c2d3-4b5c-4d6e-8f70-81a2b3c4d5e6.png',
    );
    // Gabarit @3 : le logo de l'agence occupe l'emplacement « client » du bandeau.
    const logos = rapJob!.payload as {
      logo_client_url?: string;
      logo_traiteur_url?: string;
    };
    expect(logos.logo_client_url).toMatch(/^data:image\/png;base64,/);
    // Deux logos légers : le traiteur garde son emplacement.
    expect(logos.logo_traiteur_url).toMatch(/^data:image\/png;base64,/);
    expect(rapJob!.payload).not.toHaveProperty('logo_url');
  });

  it('deux logos lourds → le traiteur cède sa place : le payload reste sous les 2 Mo acceptés par le renderer', async () => {
    // 900 Ko chacun : sous le plafond unitaire (1 Mo), mais 2,4 Mo de base64 à deux
    // → le rendu répondrait 413 et le rapport ne serait jamais généré.
    getObjectBytes.mockResolvedValue(Buffer.alloc(900_000, 7));
    try {
      const rapJob = await jobRapportAgenceEtTraiteur();
      const payload = rapJob.payload as {
        logo_client_url?: string;
        logo_traiteur_url?: string;
      };
      expect(payload.logo_client_url).toMatch(/^data:image\/png;base64,/);
      expect(payload.logo_traiteur_url).toBeUndefined();
      expect(
        JSON.stringify({ type: 'rapport-recyclage-zd', data: payload }).length,
      ).toBeLessThan(2 * 1024 * 1024);
    } finally {
      getObjectBytes.mockResolvedValue(Buffer.from([1, 2, 3]));
    }
  });
});

// Gabarit @3 : ce que le batch fige pour la page 1 du rapport.
describe('M1.6 / BatchPdfJ1 / payload du rapport @3', () => {
  async function payloads(evenements: Record<string, unknown>) {
    const base = makeCollecte();
    const collecte = makeCollecte({
      caps_appliques: { verre: 0.95, carton: 0.85 },
      evenements: { ...base.evenements, ...evenements },
    });
    const sb = makeSupabase([
      { data: [collecte], error: null }, // select collectes
      { data: [], error: null }, // select bordereaux existants
      { count: 2, error: null }, // count collecte_flux
      {
        data: [
          {
            flux_id: 'f1',
            poids_reel_kg: 12,
            nb_bacs: 3,
            equivalent_roll: null,
            flux: { nom: 'Biodéchets', code: 'biodechet' },
          },
          {
            flux_id: 'f5',
            poids_reel_kg: 4,
            nb_bacs: 1,
            equivalent_roll: null,
            flux: { nom: 'Déchet résiduel', code: 'dechet_residuel' },
          },
        ],
      }, // select flux
      { data: 'BSAV-2026-00001', error: null }, // rpc numero
      { data: { nom: 'Strike Transport', siret: '98765432100011' } }, // prestataire
      { data: { id: 'bord-new' }, error: null }, // insert bordereaux_savr
      { data: { id: 'rse-new' }, error: null }, // insert rapports_rse
      { data: null, error: null }, // job bordereau
      { data: null, error: null }, // job rapport
    ]);
    await runBatchPdfJ1(sb as never);
    const inserts = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    return {
      rapport: inserts.find(
        (c) => c[0].type_document === 'rapport-recyclage-zd',
      )![0].payload as Record<string, unknown>,
      bordereau: inserts.find((c) => c[0].detail_flux !== undefined)![0],
      select: selectionCollectes(sb),
    };
  }

  it('client saisi à la programmation, traiteur au nom commercial, flux avec leur code, taux de captation figés', async () => {
    const { rapport, select } = await payloads({
      nom_client_organisateur: '  Groupe Lumière ',
      client_organisateur: { nom: 'Lumière SAS', logo_url: null },
      organisations: {
        nom: 'Kaspia Réceptions',
        raison_sociale: 'Kaspia SAS',
        type: 'traiteur',
      },
    });
    expect(rapport.client_nom).toBe('Groupe Lumière');
    expect(rapport.nom_evenement).toBe('Gala Kaspia');
    expect(rapport.traiteur_nom).toBe('Kaspia Réceptions');
    expect(rapport.date_evenement).toBe('13/06/2026');
    expect(rapport.flux).toEqual([
      {
        nom: 'Biodéchets',
        code: 'biodechet',
        poids_kg: 12,
        nb_bacs: 3,
        equivalent_roll: null,
      },
      {
        nom: 'Déchet résiduel',
        code: 'dechet_residuel',
        poids_kg: 4,
        nb_bacs: 1,
        equivalent_roll: null,
      },
    ]);
    expect(rapport.caps_appliques).toEqual({ verre: 0.95, carton: 0.85 });
    // Champs retirés du rapport : ni version brute des facteurs, ni repas bœuf.
    expect(rapport).not.toHaveProperty('co2_facteurs_version');
    expect(rapport).not.toHaveProperty('date_collecte');
    // Les colonnes lues existent dans la requête de sélection.
    expect(select).toContain('nom_client_organisateur');
    expect(select).toContain('caps_appliques');
  });

  it('sans nom saisi : nom du compte client ; sans client du tout : champ absent (le gabarit affiche l’événement)', async () => {
    const compte = await payloads({
      nom_client_organisateur: null,
      client_organisateur: { nom: 'Lumière SAS', logo_url: null },
    });
    expect(compte.rapport.client_nom).toBe('Lumière SAS');
    const aucun = await payloads({
      nom_client_organisateur: '   ',
      client_organisateur: null,
    });
    expect(aucun.rapport.client_nom).toBeUndefined();
  });

  it('le snapshot du bordereau ne change pas de forme : pas de code de flux dans detail_flux ni dans le bordereau embarqué', async () => {
    const { rapport, bordereau } = await payloads({});
    const sansCode = [
      { nom: 'Biodéchets', poids_kg: 12, nb_bacs: 3, equivalent_roll: null },
      {
        nom: 'Déchet résiduel',
        poids_kg: 4,
        nb_bacs: 1,
        equivalent_roll: null,
      },
    ];
    expect(bordereau.detail_flux).toEqual(sansCode);
    expect((rapport.bordereau as { flux: unknown }).flux).toEqual(sansCode);
  });
});

/** Texte de la requête de sélection des collectes (1er `.select` embarquant `evenements`). */
function selectionCollectes(sb: { _chain: Record<string, unknown> }): string {
  const calls = (sb._chain['select'] as ReturnType<typeof vi.fn>).mock.calls;
  return (
    calls.map((c) => String(c[0])).find((s) => s.includes('evenements')) ?? ''
  );
}

// Régression (2026-09-11) : `evenements` porte 3 FK vers `organisations` (programmateur,
// traiteur opérationnel, client organisateur). Un embed `organisations(...)` non qualifié
// est ambigu → PostgREST rejette la requête et le batch n'enqueue RIEN, sans lever. Un
// mock répond quoi qu'on lui demande : seul le texte de la sélection peut l'épingler.
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

// Régression (2026-09-11) : l'email « disponible » était envoyé en `void sendEmail(...)` SANS
// `.catch` → un template absent (savr-dev : `rapport_disponible` jamais seedé) produisait un
// rejet non géré qui tuait le processus au 1er document, privant toutes les collectes
// suivantes du leur. L'email doit rester best-effort : batch complet + trace §07/01.
describe('M1.6 / BatchPdfJ1 / email best-effort', () => {
  it("un échec d'envoi de « rapport_disponible » ne fait pas tomber le batch et est tracé", async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(
      new Error('Template email introuvable : rapport_disponible'),
    );
    const logErr = vi.spyOn(logger, 'error');
    const collecte = makeCollecte();
    const sb = makeSupabase([
      { data: [collecte], error: null },
      { data: [], error: null },
      { count: 3, error: null },
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
      },
      { data: 'BSAV-2026-00001', error: null },
      { data: { nom: 'Strike Transport', siret: '98765432100011' } },
      { data: { id: 'bord-new' }, error: null },
      { data: { id: 'rse-new' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);

    const result = await runBatchPdfJ1(sb as never);
    await new Promise((r) => setImmediate(r)); // laisse le rejet de l'email se propager

    expect(result.enqueued).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(sendEmail).toHaveBeenCalledWith(
      'rapport_disponible',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
    );
    expect(logErr).toHaveBeenCalledWith(
      'api.external.failed',
      expect.objectContaining({
        service: 'resend',
        template: 'rapport_disponible',
      }),
    );
    logErr.mockRestore();
  });
});

// §06.02 §6 — divergence M1.6 tranchée Val 2026-09-14 : le template `rapport_disponible`
// (ex `bordereau_disponible`, migration 20261002100000) déclare EXACTEMENT prenom,
// date_collecte, lieu_nom, poids_total, co2_evite, taux_recyclage, lien_rapport ;
// sendEmail refuse l'envoi (MISSING_VARIABLE) dès qu'une variable déclarée manque.
describe('M1.6 / BatchPdfJ1 / email rapport_disponible (§06.02 §6)', () => {
  const VARIABLES_CDC = [
    'co2_evite',
    'date_collecte',
    'lien_rapport',
    'lieu_nom',
    'poids_total',
    'prenom',
    'taux_recyclage',
  ];

  function reponsesNominales(collecte: Record<string, unknown>) {
    return [
      { data: [collecte], error: null }, // select collectes
      { data: [], error: null }, // select bordereaux existants
      { count: 2, error: null }, // count collecte_flux
      {
        data: [
          {
            flux_id: 'f1',
            poids_reel_kg: 12,
            nb_bacs: 3,
            equivalent_roll: null,
            flux: { nom: 'Biodéchets' },
          },
          {
            flux_id: 'f2',
            poids_reel_kg: 0.5,
            nb_bacs: 1,
            equivalent_roll: null,
            flux: { nom: 'Verre' },
          },
        ],
      }, // select flux
      { data: 'BSAV-2026-00001', error: null }, // rpc numero
      { data: { nom: 'Strike Transport', siret: '98765432100011' } }, // prestataire
      { data: { id: 'bord-new' }, error: null }, // insert bordereaux_savr
      { data: { id: 'rse-new' }, error: null }, // insert rapports_rse
      { data: null, error: null }, // insert job bordereau
      { data: null, error: null }, // insert job rapport
    ];
  }

  it('envoi_rapport_disponible_apres_batch_j1 : slug rapport_disponible, destinataire organisations.email_principal, exactement les variables du §06.02 §6', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test.local');
    const collecte = makeCollecte();
    const sb = makeSupabase(reponsesNominales(collecte));

    const result = await runBatchPdfJ1(sb as never);
    expect(result.enqueued).toBe(1);
    expect(result.errors).toHaveLength(0);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [slug, to, variables, options] = vi.mocked(sendEmail).mock
      .calls[0] as [string, string, Record<string, string>, unknown];
    expect(slug).toBe('rapport_disponible');
    expect(to).toBe('contact@kaspia.fr');
    expect(options).toEqual({ entityType: 'collectes', entityId: 'col-1' });

    // Exactement la liste du template — ni plus (nom_evenement / date_evenement
    // de l'ancien payload), ni moins (MISSING_VARIABLE = refus d'envoi).
    expect(Object.keys(variables).sort()).toEqual(VARIABLES_CDC);
    expect(variables).toEqual({
      prenom: 'Léa',
      date_collecte: '13/06/2026',
      lieu_nom: 'Grand Palais',
      // Nombres nus, format FR : le corps du template porte les unités.
      poids_total: '12,5',
      co2_evite: '45,2',
      taux_recyclage: '72,5',
      lien_rapport: 'https://app.test.local/traiteur/collectes/col-1',
    });
    for (const v of Object.values(variables)) expect(typeof v).toBe('string');
  });

  it('lien_rapport pointe la fiche collecte de l’espace du programmeur (agence → /agence/collectes/<id>) ; prénom inconnu → chaîne vide, jamais absent', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test.local');
    const base = makeCollecte();
    const ev = base.evenements as Record<string, unknown>;
    const collecte = makeCollecte({
      evenements: {
        ...ev,
        programmeur: null,
        organisations: {
          ...(ev.organisations as Record<string, unknown>),
          type: 'agence',
        },
      },
    });
    const sb = makeSupabase(reponsesNominales(collecte));

    await runBatchPdfJ1(sb as never);

    const variables = vi.mocked(sendEmail).mock.calls[0]![2] as Record<
      string,
      string
    >;
    expect(variables.lien_rapport).toBe(
      'https://app.test.local/agence/collectes/col-1',
    );
    expect(variables.prenom).toBe('');
    expect(Object.keys(variables).sort()).toEqual(VARIABLES_CDC);
  });

  it('la sélection charge date_collecte et le programmeur (users!created_by) nécessaires aux variables', async () => {
    const sb = makeSupabase([{ data: [], error: null }]);
    await runBatchPdfJ1(sb as never);
    const sel = selectionCollectes(sb);
    expect(sel).toContain('date_collecte');
    expect(sel).toContain('programmeur:users!created_by');
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

  it('bordereau + rapport : date_collecte = date de la collecte, date_emission = jour du batch', async () => {
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
      { data: null, error: null }, // job rapport
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

    // Payload rapport : même date d'intervention, et le bordereau embarqué aussi.
    const rapJob = insertCalls.find(
      (c) => c[0].type_document === 'rapport-recyclage-zd',
    )?.[0];
    // Payload rapport : la page 1 porte la date de l'événement ; la date
    // d'intervention vit dans le bordereau embarqué (page 2).
    const rapPayload = rapJob!.payload as {
      date_evenement: string;
      bordereau: { date_collecte: string };
    };
    expect(rapPayload.date_evenement).toBe('09/09/2026');
    expect(rapPayload.bordereau.date_collecte).toBe('10/09/2026');
  });
});

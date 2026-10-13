/**
 * M1.6 — Radar du rapport de recyclage (gabarit @3) : `construireRadarRapport`
 * reprend les chiffres du radar de l'écran (`chargerBenchmarkFiche`, sous
 * l'identité du demandeur) et en tire les lignes du PDF, la légende des filtres
 * et le snapshot `rapports_rse.filtres_benchmark`. + `buildEquivalences`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFiche = vi.fn();
vi.mock('@/lib/collectes/benchmark-fiche.js', () => ({
  chargerBenchmarkFiche: (...a: unknown[]) => mockFiche(...a),
}));

import {
  construireRadarRapport,
  lireFiltresRadar,
} from '@/lib/pdf/rapport-radar.js';
import { buildEquivalences } from '@/lib/pdf/batch-pdf-j1.js';

type Res = { data: unknown; error: unknown };

function makeSupabase(tables: Record<string, Res>) {
  const lues: string[] = [];
  const inArgs: unknown[][] = [];
  const from = (table: string) => {
    lues.push(table);
    const res = tables[table] ?? { data: [], error: null };
    const chain: Record<string, unknown> = {
      select: () => chain,
      order: () => chain,
      in: (...a: unknown[]) => {
        inArgs.push(a);
        return chain;
      },
      then: (resolve: (v: Res) => unknown) => resolve(res),
    };
    return chain;
  };
  return { supabase: { from } as never, lues, inArgs };
}

const ctx = {
  userId: 'u1',
  role: 'traiteur_manager' as const,
  organisationId: 'o1',
};
const T1 = '11111111-1111-4111-8111-111111111111';
const L1 = '22222222-2222-4222-8222-222222222222';
const L2 = '33333333-3333-4333-8333-333333333333';
const FLUX = {
  data: [
    { code: 'biodechet', nom: 'Biodéchets', ordre_affichage: 1 },
    { code: 'emballage', nom: 'Emballages', ordre_affichage: 2 },
    { code: 'carton', nom: 'Cartons', ordre_affichage: 3 },
    { code: 'verre', nom: 'Verre', ordre_affichage: 4 },
    { code: 'dechet_residuel', nom: 'Déchet résiduel', ordre_affichage: 5 },
  ],
  error: null,
};
const AUCUN = {
  lieu_ids: [],
  type_evenement_ids: [],
  taille_evenement_codes: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T08:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('M1.6 / construireRadarRapport — mêmes chiffres que le radar de l’écran', () => {
  it('lignes du PDF dans l’ordre du référentiel, avec le nom du flux ; un flux sans pesée n’y figure pas', async () => {
    mockFiche.mockResolvedValue({
      etat: 'ok',
      flux: {
        verre: { ratio_user: '0.129', benchmark_kg_pax: 0.09 },
        biodechet: { ratio_user: 0.2057, benchmark_kg_pax: 0.2364 },
        // Repère parc masqué (k-anonymat) : la ligne reste, sans repère.
        carton: { ratio_user: 0.0755, benchmark_kg_pax: null },
      },
    });
    const { supabase } = makeSupabase({ flux_dechets: FLUX });
    const r = await construireRadarRapport(supabase, ctx, 'c1', AUCUN);
    expect(r.etat).toBe('ok');
    if (r.etat !== 'ok') return;
    expect(r.radar.benchmark_flux).toEqual([
      {
        flux_code: 'biodechet',
        flux_nom: 'Biodéchets',
        collecte_kg_pax: 0.2057,
        benchmark_kg_pax: 0.2364,
      },
      {
        flux_code: 'carton',
        flux_nom: 'Cartons',
        collecte_kg_pax: 0.0755,
        benchmark_kg_pax: null,
      },
      {
        flux_code: 'verre',
        flux_nom: 'Verre',
        collecte_kg_pax: 0.129, // numeric PostgREST (texte) converti
        benchmark_kg_pax: 0.09,
      },
    ]);
  });

  it('le parc est lu par la fonction de l’écran, avec le client et le contexte du demandeur ; jamais de filtre traiteurs', async () => {
    mockFiche.mockResolvedValue({ etat: 'ok', flux: {} });
    const { supabase } = makeSupabase({
      flux_dechets: FLUX,
      types_evenements: { data: [{ id: T1, libelle: 'Gala' }], error: null },
    });
    await construireRadarRapport(supabase, ctx, 'c1', {
      lieu_ids: [L1],
      type_evenement_ids: [T1],
      taille_evenement_codes: ['M'],
    });
    expect(mockFiche).toHaveBeenCalledWith(supabase, ctx, 'c1', {
      tailleCodes: ['M'],
      typeIds: [T1],
      lieuIds: [L1],
      traiteurIds: null,
    });
  });

  it('sans filtre : « Tous » partout (null transmis, comme l’écran), légende et snapshot le disent', async () => {
    mockFiche.mockResolvedValue({ etat: 'ok', flux: {} });
    const { supabase, lues } = makeSupabase({ flux_dechets: FLUX });
    const r = await construireRadarRapport(supabase, ctx, 'c1', AUCUN);
    expect(mockFiche.mock.calls[0]![3]).toEqual({
      tailleCodes: null,
      typeIds: null,
      lieuIds: null,
      traiteurIds: null,
    });
    if (r.etat !== 'ok') throw new Error('attendu ok');
    // Période fixe de 24 mois glissants, dates au format français.
    expect(r.radar.benchmark_legende).toBe(
      "période 13/10/2024 → 13/10/2026 · lieux : tous · type d'événement : tous · taille : toutes",
    );
    expect(r.radar.filtres_benchmark).toEqual({
      periode_debut: '2024-10-13',
      periode_fin: '2026-10-13',
      lieu_ids: null,
      type_evenement_ids: null,
      taille_evenement_codes: null,
    });
    // Aucun type filtré : la table des types n'est pas lue.
    expect(lues).toEqual(['flux_dechets']);
  });

  it('avec filtres : libellés des types, tailles en clair, nombre de lieux ; snapshot = filtres appliqués', async () => {
    mockFiche.mockResolvedValue({ etat: 'ok', flux: {} });
    const { supabase, inArgs } = makeSupabase({
      flux_dechets: FLUX,
      types_evenements: {
        data: [{ id: T1, libelle: 'Cocktail dînatoire' }],
        error: null,
      },
    });
    const r = await construireRadarRapport(supabase, ctx, 'c1', {
      lieu_ids: [L1, L2],
      type_evenement_ids: [T1],
      taille_evenement_codes: ['M', 'XL'],
    });
    if (r.etat !== 'ok') throw new Error('attendu ok');
    expect(r.radar.benchmark_legende).toBe(
      "période 13/10/2024 → 13/10/2026 · lieux : 2 sélectionnés · type d'événement : Cocktail dînatoire · taille : M (500 à 749 convives), XL (1 000 convives et plus)",
    );
    expect(inArgs).toEqual([['id', [T1]]]);
    expect(r.radar.filtres_benchmark).toMatchObject({
      lieu_ids: [L1, L2],
      type_evenement_ids: [T1],
      taille_evenement_codes: ['M', 'XL'],
    });
  });

  it('type filtré au libellé illisible → la légende dit combien sont appliqués, jamais « tous »', async () => {
    mockFiche.mockResolvedValue({ etat: 'ok', flux: {} });
    const { supabase } = makeSupabase({
      flux_dechets: FLUX,
      // Un seul libellé lisible sur deux types filtrés.
      types_evenements: {
        data: [{ id: T1, libelle: 'Gala' }],
        error: null,
      },
    });
    const r = await construireRadarRapport(supabase, ctx, 'c1', {
      lieu_ids: [L1],
      type_evenement_ids: [T1, L2],
      taille_evenement_codes: [],
    });
    if (r.etat !== 'ok') throw new Error('attendu ok');
    expect(r.radar.benchmark_legende).toContain(
      "lieux : 1 sélectionné · type d'événement : 2 sélectionnés · taille : toutes",
    );
    expect(r.radar.benchmark_legende).not.toContain('tous');
  });

  it('refus des gardes de l’écran relayés tels quels, sans lire le référentiel', async () => {
    for (const refus of [
      { etat: 'sans_radar' },
      { etat: 'introuvable' },
      { etat: 'filtre_interdit', motif: 'perimetre' },
      { etat: 'erreur', erreur: new Error('boom') },
    ]) {
      mockFiche.mockResolvedValueOnce(refus);
      const { supabase, lues } = makeSupabase({ flux_dechets: FLUX });
      expect(await construireRadarRapport(supabase, ctx, 'c1', AUCUN)).toEqual(
        refus,
      );
      expect(lues).toEqual([]);
    }
  });

  it('lecture du référentiel en échec → erreur (jamais « aucun flux », qui sortirait un rapport sans radar)', async () => {
    mockFiche.mockResolvedValue({
      etat: 'ok',
      flux: { verre: { ratio_user: 0.1, benchmark_kg_pax: 0.09 } },
    });
    const panne = { message: 'timeout' };
    const flux = makeSupabase({ flux_dechets: { data: null, error: panne } });
    expect(
      await construireRadarRapport(flux.supabase, ctx, 'c1', AUCUN),
    ).toEqual({ etat: 'erreur', erreur: panne });
    const types = makeSupabase({
      flux_dechets: FLUX,
      types_evenements: { data: null, error: panne },
    });
    expect(
      await construireRadarRapport(types.supabase, ctx, 'c1', {
        ...AUCUN,
        type_evenement_ids: [T1],
      }),
    ).toEqual({ etat: 'erreur', erreur: panne });
  });
});

describe('M1.6 / lireFiltresRadar — filtres reçus de la fiche', () => {
  it('absent → « Tous » ; valeurs valides lues et dédoublonnées', () => {
    expect(lireFiltresRadar(undefined)).toEqual(AUCUN);
    expect(lireFiltresRadar(null)).toEqual(AUCUN);
    expect(lireFiltresRadar({})).toEqual(AUCUN);
    expect(
      lireFiltresRadar({
        lieu_ids: [L1, L1],
        type_evenement_ids: [T1],
        taille_evenement_codes: ['XS', 'XL'],
        // Champ inconnu ignoré : le filtre traiteurs n'existe pas sur une fiche.
        traiteur_ids: ['x'],
      }),
    ).toEqual({
      lieu_ids: [L1],
      type_evenement_ids: [T1],
      taille_evenement_codes: ['XS', 'XL'],
    });
  });

  it('valeur hors format → null (422 côté route)', () => {
    for (const brut of [
      'tous',
      [T1],
      { lieu_ids: 'x' },
      { lieu_ids: ['pas-un-uuid'] },
      { type_evenement_ids: [42] },
      { taille_evenement_codes: ['XXL'] },
      // Nom hérité de Object.prototype : ne doit pas passer pour un code de taille.
      { taille_evenement_codes: ['toString'] },
      { lieu_ids: Array.from({ length: 101 }, () => L1) },
    ]) {
      expect([JSON.stringify(brut), lireFiltresRadar(brut)]).toEqual([
        JSON.stringify(brut),
        null,
      ]);
    }
  });
});

describe('M1.6 / buildEquivalences (§12 §1.2)', () => {
  const snapshot = {
    equivalences: { km_voiture: 0.218, repas_boeuf: 7, foyer_kwh: 4500 },
  };

  it('convertit les FACTEURS figés en comptes (km voiture, foyers) ; plus de repas bœuf', () => {
    expect(buildEquivalences(300, 9000, snapshot)).toEqual({
      km_voiture: 1376,
      foyer: 2,
    });
  });

  it('retourne undefined sans CO₂ évité ou sans snapshot ; null par équivalence sans facteur', () => {
    expect(buildEquivalences(null, 9000, snapshot)).toBeUndefined();
    expect(buildEquivalences(300, 9000, null)).toBeUndefined();
    expect(buildEquivalences(300, 9000, {})).toBeUndefined();
    expect(buildEquivalences(300, null, { equivalences: {} })).toEqual({
      km_voiture: null,
      foyer: null,
    });
  });
});

/**
 * M1.3 — Tests calculer_tarif_zd()
 * Couvre les 20 scénarios du manifest M1.3.json :
 * 5 paliers × 2 bornes + remise simple + remise cumulative + org NULL
 * + org sans grille + 3 erreurs PAX_INVALIDE + 1 erreur GRILLE_INTROUVABLE
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculer_tarif_zd, TarifZdError } from '@/lib/tarif-zd.js';
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const GRILLE_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const DATE = new Date('2026-06-15T00:00:00Z');

/** Paliers corrects de la grille Standard V1 (spec §05 §1) */
const PALIERS = [
  {
    id: 'tarif-1',
    pax_min: 1,
    pax_max: 250,
    prix_base_ht: 450,
    prix_par_couvert_ht: 0,
  },
  {
    id: 'tarif-2',
    pax_min: 251,
    pax_max: 500,
    prix_base_ht: 600,
    prix_par_couvert_ht: 0,
  },
  {
    id: 'tarif-3',
    pax_min: 501,
    pax_max: 750,
    prix_base_ht: 800,
    prix_par_couvert_ht: 0,
  },
  {
    id: 'tarif-4',
    pax_min: 751,
    pax_max: 1000,
    prix_base_ht: 1000,
    prix_par_couvert_ht: 0,
  },
  {
    id: 'tarif-5',
    pax_min: 1001,
    pax_max: null,
    prix_base_ht: 0,
    prix_par_couvert_ht: 1,
  },
];

function tarifPour(pax: number) {
  return PALIERS.find(
    (p) => p.pax_min <= pax && (p.pax_max === null || p.pax_max >= pax),
  )!;
}

// ── Fabrique de mock Supabase ─────────────────────────────────────────────────

type MockConfig = {
  /** grille_tarifaire_zd_id de l'organisation (null = pas de grille perso) */
  orgGrilleId?: string | null;
  /** la grille est-elle trouvée active ? */
  grilleActive?: boolean;
  /** palier à retourner (null = aucun → TARIF_INTROUVABLE) */
  tarifData?: (typeof PALIERS)[0] | null;
  /** remises à appliquer */
  remises?: Array<{ remise_pct: number }>;
};

function buildMockSupabase(cfg: MockConfig): SupabaseClient {
  const {
    orgGrilleId = null,
    grilleActive = true,
    tarifData = null,
    remises = [],
  } = cfg;

  // Chaque appel .from(table) est routé vers un sous-mock dédié
  const mockFrom = vi.fn().mockImplementation((table: string) => {
    if (table === 'organisations') {
      return buildChain({ grille_tarifaire_zd_id: orgGrilleId });
    }
    if (table === 'grilles_tarifaires_zd') {
      return buildChain(grilleActive ? { id: GRILLE_ID } : null);
    }
    if (table === 'tarifs_zero_dechet') {
      return buildChain(tarifData);
    }
    if (table === 'tarifs_negocie') {
      return buildListChain(remises);
    }
    return buildChain(null);
  });

  return { from: mockFrom } as unknown as SupabaseClient;
}

/** Mock d'une chaîne qui résout en { data: single, error: null } */
function buildChain(data: unknown) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  };
  return chain;
}

/** Mock d'une chaîne qui résout en { data: array, error: null } */
function buildListChain(data: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    or: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

/** Construit le mock pour un test de palier nominal (org NULL, grille défaut) */
function mockPalier(pax: number): SupabaseClient {
  return buildMockSupabase({
    orgGrilleId: null,
    grilleActive: true,
    tarifData: tarifPour(pax),
    remises: [],
  });
}

// ── Tests paliers ─────────────────────────────────────────────────────────────

describe('M1.3/tarif-zd', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.3/tarif-zd — palier 1 : 1 pax (borne basse)', async () => {
    const result = await calculer_tarif_zd(1, null, DATE, mockPalier(1));
    expect(result.montant_brut_ht).toBe(450);
    expect(result.montant_ht).toBe(450);
    expect(result.tarif_id).toBe('tarif-1');
    expect(result.remise_pct_cumulee).toBe(0);
  });

  it('M1.3/tarif-zd — palier 1 : 100 pax (milieu)', async () => {
    const result = await calculer_tarif_zd(100, null, DATE, mockPalier(100));
    expect(result.montant_brut_ht).toBe(450);
    expect(result.montant_ht).toBe(450);
    expect(result.tarif_id).toBe('tarif-1');
  });

  it('M1.3/tarif-zd — palier 1 : 250 pax (borne haute)', async () => {
    const result = await calculer_tarif_zd(250, null, DATE, mockPalier(250));
    expect(result.montant_brut_ht).toBe(450);
    expect(result.montant_ht).toBe(450);
    expect(result.tarif_id).toBe('tarif-1');
  });

  it('M1.3/tarif-zd — palier 2 : 251 pax (borne basse)', async () => {
    const result = await calculer_tarif_zd(251, null, DATE, mockPalier(251));
    expect(result.montant_brut_ht).toBe(600);
    expect(result.montant_ht).toBe(600);
    expect(result.tarif_id).toBe('tarif-2');
  });

  it('M1.3/tarif-zd — palier 2 : 400 pax (milieu)', async () => {
    const result = await calculer_tarif_zd(400, null, DATE, mockPalier(400));
    expect(result.montant_brut_ht).toBe(600);
    expect(result.montant_ht).toBe(600);
    expect(result.tarif_id).toBe('tarif-2');
  });

  it('M1.3/tarif-zd — palier 2 : 500 pax (borne haute)', async () => {
    const result = await calculer_tarif_zd(500, null, DATE, mockPalier(500));
    expect(result.montant_brut_ht).toBe(600);
    expect(result.montant_ht).toBe(600);
    expect(result.tarif_id).toBe('tarif-2');
  });

  it('M1.3/tarif-zd — palier 3 : 501 pax (borne basse)', async () => {
    const result = await calculer_tarif_zd(501, null, DATE, mockPalier(501));
    expect(result.montant_brut_ht).toBe(800);
    expect(result.montant_ht).toBe(800);
    expect(result.tarif_id).toBe('tarif-3');
  });

  it('M1.3/tarif-zd — palier 3 : 750 pax (borne haute)', async () => {
    const result = await calculer_tarif_zd(750, null, DATE, mockPalier(750));
    expect(result.montant_brut_ht).toBe(800);
    expect(result.montant_ht).toBe(800);
    expect(result.tarif_id).toBe('tarif-3');
  });

  it('M1.3/tarif-zd — palier 4 : 751 pax (borne basse)', async () => {
    const result = await calculer_tarif_zd(751, null, DATE, mockPalier(751));
    expect(result.montant_brut_ht).toBe(1000);
    expect(result.montant_ht).toBe(1000);
    expect(result.tarif_id).toBe('tarif-4');
  });

  it('M1.3/tarif-zd — palier 4 : 1000 pax (borne haute)', async () => {
    const result = await calculer_tarif_zd(1000, null, DATE, mockPalier(1000));
    expect(result.montant_brut_ht).toBe(1000);
    expect(result.montant_ht).toBe(1000);
    expect(result.tarif_id).toBe('tarif-4');
  });

  it('M1.3/tarif-zd — palier 5 : 1001 pax (borne basse >1000)', async () => {
    const result = await calculer_tarif_zd(1001, null, DATE, mockPalier(1001));
    expect(result.montant_brut_ht).toBe(1001);
    expect(result.montant_ht).toBe(1001);
    expect(result.tarif_id).toBe('tarif-5');
  });

  it('M1.3/tarif-zd — palier 5 : 2000 pax (affine 1€/pax)', async () => {
    const result = await calculer_tarif_zd(2000, null, DATE, mockPalier(2000));
    expect(result.montant_brut_ht).toBe(2000);
    expect(result.montant_ht).toBe(2000);
    expect(result.tarif_id).toBe('tarif-5');
  });

  // ── Remises ────────────────────────────────────────────────────────────────

  it('M1.3/tarif-zd — remise organisation : montant brut × (1 - remise_pct)', async () => {
    const supabase = buildMockSupabase({
      orgGrilleId: GRILLE_ID,
      grilleActive: true,
      tarifData: tarifPour(300), // palier 2 → 600€
      remises: [{ remise_pct: 0.1 }], // 10% de remise
    });
    const result = await calculer_tarif_zd(300, ORG_ID, DATE, supabase);
    expect(result.montant_brut_ht).toBe(600);
    expect(result.montant_ht).toBe(540); // 600 × 0.9
    expect(result.remise_pct_cumulee).toBeCloseTo(0.1);
  });

  it('M1.3/tarif-zd — remise cumulative : Π(1 - remise_pct)', async () => {
    const supabase = buildMockSupabase({
      orgGrilleId: GRILLE_ID,
      grilleActive: true,
      tarifData: tarifPour(300), // palier 2 → 600€
      remises: [{ remise_pct: 0.1 }, { remise_pct: 0.05 }], // 10% + 5%
    });
    const result = await calculer_tarif_zd(300, ORG_ID, DATE, supabase);
    // Multiplicatif : 600 × 0.9 × 0.95 = 513€
    expect(result.montant_brut_ht).toBe(600);
    expect(result.montant_ht).toBe(513);
    expect(result.remise_pct_cumulee).toBeCloseTo(0.145); // 1 - 0.9×0.95 = 1 - 0.855
  });

  // ── Organisation NULL / sans grille ─────────────────────────────────────────

  it('M1.3/tarif-zd — organisation NULL : utilise grille défaut', async () => {
    // organisationId=null → pas de lookup org, va directement à la grille défaut
    const supabase = buildMockSupabase({
      grilleActive: true,
      tarifData: tarifPour(100),
      remises: [],
    });
    const result = await calculer_tarif_zd(100, null, DATE, supabase);
    expect(result.montant_brut_ht).toBe(450);
    expect(result.grille_id).toBe(GRILLE_ID);
  });

  it('M1.3/tarif-zd — organisation sans grille assignée : utilise grille défaut', async () => {
    // L'org existe mais n'a pas de grille perso (grille_tarifaire_zd_id = null)
    const supabase = buildMockSupabase({
      orgGrilleId: null, // org sans grille perso
      grilleActive: true,
      tarifData: tarifPour(100),
      remises: [],
    });
    const result = await calculer_tarif_zd(100, ORG_ID, DATE, supabase);
    expect(result.montant_brut_ht).toBe(450);
    expect(result.grille_id).toBe(GRILLE_ID);
  });

  // ── Erreurs ───────────────────────────────────────────────────────────────

  it('M1.3/tarif-zd — erreur PAX_INVALIDE : pax = 0', async () => {
    const supabase = buildMockSupabase({ tarifData: null });
    await expect(calculer_tarif_zd(0, null, DATE, supabase)).rejects.toThrow(
      TarifZdError,
    );
    await expect(
      calculer_tarif_zd(0, null, DATE, supabase),
    ).rejects.toMatchObject({
      code: 'PAX_INVALIDE',
    });
  });

  it('M1.3/tarif-zd — erreur PAX_INVALIDE : pax = -1', async () => {
    const supabase = buildMockSupabase({ tarifData: null });
    await expect(
      calculer_tarif_zd(-1, null, DATE, supabase),
    ).rejects.toMatchObject({
      code: 'PAX_INVALIDE',
    });
  });

  it('M1.3/tarif-zd — erreur PAX_INVALIDE : pax non entier (1.5)', async () => {
    const supabase = buildMockSupabase({ tarifData: null });
    await expect(
      calculer_tarif_zd(1.5, null, DATE, supabase),
    ).rejects.toMatchObject({
      code: 'PAX_INVALIDE',
    });
  });

  it('M1.3/tarif-zd — erreur GRILLE_INTROUVABLE : aucune grille active', async () => {
    const supabase = buildMockSupabase({
      orgGrilleId: null,
      grilleActive: false, // la grille défaut ne renvoie rien
      tarifData: null,
    });
    await expect(
      calculer_tarif_zd(100, null, DATE, supabase),
    ).rejects.toMatchObject({
      code: 'GRILLE_INTROUVABLE',
    });
  });
});

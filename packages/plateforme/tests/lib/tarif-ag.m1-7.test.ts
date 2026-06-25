/**
 * R8 / BL-P1-FACT-02 & FACT-03 — Résolution du tarif AG à la facturation.
 * Oracles montant : le 590 € en dur est supprimé ; PU pack par_collecte = prix du
 * pack, hors-pack = unitaire (590) − remises AG. Source : 06.08 §5.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import { calculer_tarif_ag } from '../../src/lib/facturation/tarif-ag.js';

interface FakeOpts {
  pack?: {
    mode_facturation: string;
    prix_unitaire_ht: number | null;
    montant_total_ht: number | null;
    credits_initiaux: number | null;
  } | null;
  tarifUnitaire?: { id: string; prix_unitaire_ht: number } | null;
  remises?: Array<{ remise_pct: number }>;
}

// Fake supabase « table-aware » : déterministe, pas de séquence fragile.
function fakeSb(opts: FakeOpts): SupabaseClient {
  return {
    from(table: string) {
      const result =
        table === 'packs_antgaspi'
          ? { data: opts.pack ?? null, error: null }
          : table === 'tarifs_packs_ag'
            ? { data: opts.tarifUnitaire ?? null, error: null }
            : table === 'tarifs_negocie'
              ? { data: opts.remises ?? [], error: null }
              : { data: null, error: null };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        lte: () => builder,
        or: () => builder,
        single: () => Promise.resolve(result),
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(onF, onR),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const DATE = new Date('2026-06-20');

describe('M1.7 / FACT-02 — tarif AG pack par_collecte', () => {
  it('M1.7 FACT-02 : collecte Pack 30 par_collecte → PU = prix unitaire du pack (460 €, pas 590)', async () => {
    const r = await calculer_tarif_ag(
      fakeSb({
        pack: {
          mode_facturation: 'par_collecte',
          prix_unitaire_ht: 460,
          montant_total_ht: 13800,
          credits_initiaux: 30,
        },
      }),
      { packAntgaspiId: 'pack-30', organisationId: 'org-1', date: DATE },
    );
    expect(r.skip).toBe(false);
    if (r.skip) return;
    expect(r.montant_ht).toBe(460);
    expect(r.montant_ht).not.toBe(590);
    expect(r.source).toBe('ag_pack_par_collecte');
    // enum DB valide (zd_grille|ag_unitaire|libre) : base hors barème → 'libre'
    expect(r.tarif_applique_source).toBe('libre');
    expect(r.tarif_applique_id).toBeNull();
  });

  it('M1.7 FACT-02 : pack personnalise par_collecte → PU = montant_total_ht / credits_initiaux', async () => {
    const r = await calculer_tarif_ag(
      fakeSb({
        pack: {
          mode_facturation: 'par_collecte',
          prix_unitaire_ht: null,
          montant_total_ht: 12000,
          credits_initiaux: 20,
        },
      }),
      { packAntgaspiId: 'pack-perso', organisationId: 'org-1', date: DATE },
    );
    expect(r.skip).toBe(false);
    if (r.skip) return;
    expect(r.montant_ht).toBe(600);
  });

  it('M1.7 FACT-02 : pack globale_achat → skip (facturé au pack FPK, aucune ligne collecte)', async () => {
    const r = await calculer_tarif_ag(
      fakeSb({
        pack: {
          mode_facturation: 'globale_achat',
          prix_unitaire_ht: 460,
          montant_total_ht: 13800,
          credits_initiaux: 30,
        },
      }),
      { packAntgaspiId: 'pack-glob', organisationId: 'org-1', date: DATE },
    );
    expect(r.skip).toBe(true);
  });
});

describe('M1.7 / FACT-03 — tarif AG hors pack', () => {
  it('M1.7 FACT-03 : AG hors pack sans remise → PU = tarif unitaire 590 € (lu du référentiel)', async () => {
    const r = await calculer_tarif_ag(
      fakeSb({
        pack: null,
        tarifUnitaire: { id: 'tarif-unit', prix_unitaire_ht: 590 },
        remises: [],
      }),
      { packAntgaspiId: null, organisationId: 'org-1', date: DATE },
    );
    expect(r.skip).toBe(false);
    if (r.skip) return;
    expect(r.montant_ht).toBe(590);
    expect(r.source).toBe('ag_unitaire');
    expect(r.tarif_applique_source).toBe('ag_unitaire');
    expect(r.tarif_applique_id).toBe('tarif-unit');
    expect(r.remise_pct_cumulee).toBe(0);
  });

  it('M1.7 FACT-03 : AG hors pack avec remise négociée 10 % → PU réduit à 531 €', async () => {
    const r = await calculer_tarif_ag(
      fakeSb({
        pack: null,
        tarifUnitaire: { id: 'tarif-unit', prix_unitaire_ht: 590 },
        remises: [{ remise_pct: 0.1 }],
      }),
      { packAntgaspiId: null, organisationId: 'org-1', date: DATE },
    );
    expect(r.skip).toBe(false);
    if (r.skip) return;
    expect(r.montant_ht).toBe(531);
    expect(r.remise_pct_cumulee).toBe(0.1);
  });

  it('M1.7 FACT-03 : remises AG cumulées multiplicativement (10 % puis 5 % → 504,45 €)', async () => {
    const r = await calculer_tarif_ag(
      fakeSb({
        pack: null,
        tarifUnitaire: { id: 'tarif-unit', prix_unitaire_ht: 590 },
        remises: [{ remise_pct: 0.1 }, { remise_pct: 0.05 }],
      }),
      { packAntgaspiId: null, organisationId: 'org-1', date: DATE },
    );
    expect(r.skip).toBe(false);
    if (r.skip) return;
    expect(r.montant_ht).toBe(504.45);
  });
});

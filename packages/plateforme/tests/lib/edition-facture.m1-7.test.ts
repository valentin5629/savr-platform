/**
 * R8 / BL-P1-FACT-01 & FACT-05 — Édition d'une facture brouillon.
 * Oracles : override PU figé + audit_log, totaux recalculés, gate brouillon,
 * ligne libre exige désignation OU collecte.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  recomputeFactureTotaux,
  modifierLigne,
  ajouterLigne,
  supprimerLigne,
} from '../../src/lib/facturation/edition-facture.js';

interface FakeOpts {
  factureStatut?: string;
  oldLigne?: Record<string, unknown> | null;
  lignes?: Array<Record<string, unknown>>;
}

interface Recorded {
  update: Array<{ table: string; payload: Record<string, unknown> }>;
  insert: Array<{ table: string; payload: Record<string, unknown> }>;
  delete: number;
}

function recordingSb(opts: FakeOpts): {
  sb: SupabaseClient;
  calls: Recorded;
} {
  const calls: Recorded = { update: [], insert: [], delete: 0 };

  function builder(table: string): Record<string, unknown> {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      single: () => {
        if (table === 'factures') {
          return Promise.resolve({
            data: opts.factureStatut
              ? { id: 'f1', statut: opts.factureStatut }
              : null,
            error: null,
          });
        }
        if (table === 'factures_collectes') {
          return Promise.resolve({ data: opts.oldLigne ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      insert: (payload: Record<string, unknown>) => {
        calls.insert.push({ table, payload });
        return {
          ...b,
          then: (f: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(f),
        };
      },
      update: (payload: Record<string, unknown>) => {
        calls.update.push({ table, payload });
        return b;
      },
      delete: () => {
        calls.delete++;
        return b;
      },
      then: (f: (v: unknown) => unknown) => {
        if (table === 'factures_collectes') {
          return Promise.resolve({ data: opts.lignes ?? [], error: null }).then(
            f,
          );
        }
        return Promise.resolve({ data: null, error: null }).then(f);
      },
    };
    return b;
  }

  return {
    sb: { from: (t: string) => builder(t) } as unknown as SupabaseClient,
    calls,
  };
}

describe('M1.7 / Édition facture (FACT-01/05)', () => {
  it('M1.7 FACT-05 : override PU d’une ligne brouillon → montant figé + audit_log + totaux recalculés', async () => {
    const { sb, calls } = recordingSb({
      factureStatut: 'brouillon',
      oldLigne: { montant_ligne_ht: 590, tarif_detail: null },
      lignes: [{ quantite: 1, taux_tva: 20, montant_ligne_ht: 700 }],
    });

    const res = await modifierLigne(
      sb,
      'f1',
      'l1',
      { montant_ligne_ht: 700 },
      'user-1',
    );
    expect(res.ok).toBe(true);

    // audit_log tracé : qui / ancien / nouveau
    const audit = calls.insert.find((c) => c.table === 'audit_log');
    expect(audit).toBeDefined();
    expect(audit!.payload.action).toBe('override_pu_facture');
    expect(audit!.payload.user_id).toBe('user-1');
    expect(
      (audit!.payload.old_values as Record<string, unknown>).montant_ligne_ht,
    ).toBe(590);
    expect(
      (audit!.payload.new_values as Record<string, unknown>).montant_ligne_ht,
    ).toBe(700);

    // ligne figée : montant_ligne_ht + override flag dans tarif_detail
    const ligneUpd = calls.update.find((c) => c.table === 'factures_collectes');
    expect(ligneUpd!.payload.montant_ligne_ht).toBe(700);
    expect(
      (ligneUpd!.payload.tarif_detail as Record<string, unknown>)
        .override_admin,
    ).toBe(true);

    // totaux recalculés sur la facture
    const facUpd = calls.update.find(
      (c) => c.table === 'factures' && c.payload.montant_ht !== undefined,
    );
    expect(facUpd!.payload.montant_ht).toBe(700);
    expect(facUpd!.payload.montant_tva).toBe(140);
    expect(facUpd!.payload.montant_ttc).toBe(840);
  });

  it('M1.7 FACT-01 : édition d’une facture non-brouillon refusée (figement à l’émission)', async () => {
    const { sb, calls } = recordingSb({ factureStatut: 'emise' });
    const res = await modifierLigne(
      sb,
      'f1',
      'l1',
      { montant_ligne_ht: 700 },
      'user-1',
    );
    expect(res.ok).toBe(false);
    expect(res.statut).toBe(409);
    // aucune écriture
    expect(calls.update).toHaveLength(0);
    expect(calls.insert).toHaveLength(0);
  });

  it('M1.7 FACT-01 : ajout d’une ligne libre sans désignation ni collecte → 422', async () => {
    const { sb, calls } = recordingSb({ factureStatut: 'brouillon' });
    const res = await ajouterLigne(sb, 'f1', { montant_ligne_ht: 100 });
    expect(res.ok).toBe(false);
    expect(res.statut).toBe(422);
    expect(calls.insert).toHaveLength(0);
  });

  it('M1.7 FACT-01 : ajout d’une ligne libre valide → insérée + totaux recalculés', async () => {
    const { sb, calls } = recordingSb({
      factureStatut: 'brouillon',
      lignes: [{ quantite: 1, taux_tva: 20, montant_ligne_ht: 250 }],
    });
    const res = await ajouterLigne(sb, 'f1', {
      designation: 'Frais divers',
      montant_ligne_ht: 250,
    });
    expect(res.ok).toBe(true);
    const ins = calls.insert.find((c) => c.table === 'factures_collectes');
    expect(ins!.payload.designation).toBe('Frais divers');
    const facUpd = calls.update.find(
      (c) => c.table === 'factures' && c.payload.montant_ht !== undefined,
    );
    expect(facUpd!.payload.montant_ht).toBe(250);
  });

  it('M1.7 FACT-01 : recompute totaux = somme des lignes (quantité × PU, TVA par ligne)', async () => {
    const { sb } = recordingSb({
      lignes: [
        { quantite: 1, taux_tva: 20, montant_ligne_ht: 430 },
        { quantite: 2, taux_tva: 20, montant_ligne_ht: 100 },
      ],
    });
    const totaux = await recomputeFactureTotaux(sb, 'f1');
    expect(totaux.montant_ht).toBe(630);
    expect(totaux.montant_tva).toBe(126);
    expect(totaux.montant_ttc).toBe(756);
  });

  it('M1.7 FACT-01 : suppression d’une ligne brouillon → supprimée + totaux recalculés', async () => {
    const { sb, calls } = recordingSb({
      factureStatut: 'brouillon',
      lignes: [{ quantite: 1, taux_tva: 20, montant_ligne_ht: 200 }],
    });
    const res = await supprimerLigne(sb, 'f1', 'l1');
    expect(res.ok).toBe(true);
    expect(calls.delete).toBe(1);
    const facUpd = calls.update.find(
      (c) => c.table === 'factures' && c.payload.montant_ht !== undefined,
    );
    expect(facUpd!.payload.montant_ht).toBe(200);
  });
});

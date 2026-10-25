/**
 * Lot C2 — brouillons de facture du batch J+1 au pax et à la date de LA
 * collecte (décisions Val C2 du 2026-10-20 et Q4 du 2026-10-24).
 *
 * Chaque collecte ZD est facturée sur son propre pax ; la date qui choisit la
 * grille, le tarif AG et les remises en vigueur est celle de la collecte, comme
 * l'email récapitulatif. Les fixtures font différer la collecte de son
 * événement : un événement de deux soirées (900 convives, première date le
 * 2026-06-30) dont la collecte facturée a 300 convives le 2026-07-01.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const tarifs = vi.hoisted(() => ({
  zd: vi.fn(async () => ({
    montant_ht: 412,
    montant_brut_ht: 412,
    grille_id: 'g1',
    tarif_id: 't1',
    remise_pct_cumulee: 0,
  })),
  ag: vi.fn(async () => ({
    skip: false as const,
    montant_ht: 590,
    montant_brut_ht: 590,
    source: 'unitaire',
    tarif_applique_source: 'ag_unitaire',
    tarif_applique_id: 'tu1',
    remise_pct_cumulee: 0,
    tarif_detail: {},
  })),
}));
vi.mock('@/lib/tarif-zd.js', () => ({ calculer_tarif_zd: tarifs.zd }));
vi.mock('@/lib/facturation/tarif-ag.js', () => ({
  calculer_tarif_ag: tarifs.ag,
}));

import { runBatchBrouillonsJ1 } from '@/lib/facturation/batch-brouillons.js';
import { jourParis } from '@savr/shared/src/temps/index.js';

const EVENEMENT = {
  id: 'ev-2-soirees',
  organisation_id: 'org-1',
  lieu_id: 'lieu-1',
  // Valeurs de l'événement : celles que le batch NE doit PAS lire.
  pax: 900,
  date_evenement: '2026-06-30',
  organisations: {
    mode_facturation_zd: 'par_collecte',
    grille_tarifaire_zd_id: null,
    entites_facturation: [{ id: 'ef-1', siret_verification: 'verifie' }],
  },
};

function collecte(
  id: string,
  type: string,
  surcharge: Record<string, unknown> = {},
) {
  return {
    id,
    type,
    statut: 'cloturee',
    annulee_cote_savr: false,
    pack_antgaspi_id: null,
    pax: 300,
    date_collecte: '2026-07-01',
    evenements: EVENEMENT,
    ...surcharge,
  };
}

/** Base factice : la sélection rend `lignes`, toute autre lecture est vide. */
function base(lignes: unknown[]) {
  const selects: string[] = [];
  const from = (table: string) => {
    const resultat =
      table === 'collectes'
        ? { data: lignes, error: null }
        : { data: [], error: null };
    const c: Record<string, unknown> = {
      select: (cols?: string) => {
        if (table === 'collectes' && cols) selects.push(cols);
        return c;
      },
      single: () => Promise.resolve({ data: { id: 'fac-1' }, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve(resultat).then(ok),
    };
    for (const m of ['insert', 'update', 'eq', 'neq', 'in']) c[m] = () => c;
    return c;
  };
  return { sb: { from } as never, selects };
}

beforeEach(() => vi.clearAllMocks());

describe('M1.7 / BatchBrouillons / pax et date de la collecte (lot C2)', () => {
  it('ZD : tarif calculé sur le pax de LA collecte (300) et sa date (2026-07-01), pas sur ceux de l’événement', async () => {
    const { sb, selects } = base([collecte('zd-soiree-2', 'zero_dechet')]);
    const r = await runBatchBrouillonsJ1(sb);

    expect(r.errors).toEqual([]);
    expect(r.zd_par_collecte).toBe(1);
    expect(tarifs.zd).toHaveBeenCalledTimes(1);
    const [pax, organisationId, date, , lieuId] = tarifs.zd.mock
      .calls[0] as unknown as [number, string, Date, unknown, string];
    expect(pax).toBe(300);
    expect(organisationId).toBe('org-1');
    expect(lieuId).toBe('lieu-1');
    expect(jourParis(date)).toBe('2026-07-01');

    // Pax et date demandés sur la collecte, plus dans l'embed de l'événement.
    const [colonnesCollecte, embedEvenement] = selects[0]!.split('evenements');
    expect(colonnesCollecte).toMatch(/\bpax\b/);
    expect(colonnesCollecte).toMatch(/\bdate_collecte\b/);
    expect(embedEvenement).not.toMatch(/\bpax\b/);
    expect(embedEvenement).not.toMatch(/\bdate_evenement\b/);
  });

  it('ZD : deux collectes du même événement facturées chacune sur son pax (650 et 400)', async () => {
    const { sb } = base([
      collecte('zd-soiree-1', 'zero_dechet', {
        pax: 650,
        date_collecte: '2026-06-30',
      }),
      collecte('zd-soiree-2', 'zero_dechet', { pax: 400 }),
    ]);
    await runBatchBrouillonsJ1(sb);

    expect(
      tarifs.zd.mock.calls.map((c) => {
        const [pax, , date] = c as unknown as [number, string, Date];
        return [pax, jourParis(date)];
      }),
    ).toEqual([
      [650, '2026-06-30'],
      [400, '2026-07-01'],
    ]);
  });

  it('ZD : collecte à 0 convive (inconnu, reprise Bubble) → passée telle quelle au calcul, qui la refuse ; pas de repli sur l’événement', async () => {
    tarifs.zd.mockRejectedValueOnce(new Error('PAX_INVALIDE'));
    const { sb } = base([collecte('zd-bubble', 'zero_dechet', { pax: 0 })]);
    const r = await runBatchBrouillonsJ1(sb);

    expect((tarifs.zd.mock.calls[0] as unknown as [number])[0]).toBe(0);
    expect(r.zd_par_collecte).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('zd-bubble');
  });

  it('AG : tarif unitaire et remises à la date de LA collecte (2026-07-01)', async () => {
    const { sb } = base([collecte('ag-soiree-2', 'anti_gaspi')]);
    const r = await runBatchBrouillonsJ1(sb);

    expect(r.ag_par_collecte).toBe(1);
    const [, params] = tarifs.ag.mock.calls[0] as unknown as [
      unknown,
      { date: Date; organisationId: string },
    ];
    expect(jourParis(params.date)).toBe('2026-07-01');
    expect(params.organisationId).toBe('org-1');
  });
});

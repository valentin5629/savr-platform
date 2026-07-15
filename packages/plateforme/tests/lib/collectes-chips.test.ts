/**
 * Prédicats des chips de la liste Collectes (lib/collectes-chips).
 * Focus : les chips `non_transmises_zd` / `non_transmises_ag` sont le MIROIR EXACT
 * des cartes-actions « Non transmises ZD/AG » du Dashboard Admin (Bloc 1, §11 §1.1)
 * = cibles de clic. Leur prédicat DOIT rester identique à celui du compteur dans
 * `api/v1/admin/dashboard/kpi/route.ts` : type + statut_tms='non_envoye' +
 * tms_reference IS NULL + statut IN (programmee, validee).
 */
import { describe, it, expect } from 'vitest';
import { applyChipPredicate, type ChipQuery } from '@/lib/collectes-chips';

type Call = [string, ...unknown[]];

function recorder(): { q: ChipQuery; calls: Call[] } {
  const calls: Call[] = [];
  const q: ChipQuery = {
    eq: (c, v) => (calls.push(['eq', c, v]), q),
    is: (c, v) => (calls.push(['is', c, v]), q),
    in: (c, v) => (calls.push(['in', c, v]), q),
    not: (c, op, v) => (calls.push(['not', c, op, v]), q),
    gte: (c, v) => (calls.push(['gte', c, v]), q),
    lte: (c, v) => (calls.push(['lte', c, v]), q),
  };
  return { q, calls };
}

const NOW = new Date('2026-07-15T10:00:00.000Z');

describe('collectes-chips / non_transmises ZD·AG = miroir KPI Bloc 1', () => {
  it.each([
    ['non_transmises_zd', 'zero_dechet'],
    ['non_transmises_ag', 'anti_gaspi'],
  ])('chip %s applique le prédicat exact du compteur', (chip, type) => {
    const { q, calls } = recorder();
    applyChipPredicate(q, chip, NOW);

    // Enum réel (jamais les littéraux 'zd'/'ag' — cf. BL-P0-05).
    expect(calls).toContainEqual(['eq', 'type', type]);
    expect(calls).toContainEqual(['eq', 'statut_tms', 'non_envoye']);
    expect(calls).toContainEqual(['is', 'tms_reference', null]);
    expect(calls).toContainEqual(['in', 'statut', ['programmee', 'validee']]);
  });

  it('les deux chips filtrent des types disjoints (ZD ≠ AG)', () => {
    const zd = recorder();
    applyChipPredicate(zd.q, 'non_transmises_zd', NOW);
    const ag = recorder();
    applyChipPredicate(ag.q, 'non_transmises_ag', NOW);
    expect(zd.calls).toContainEqual(['eq', 'type', 'zero_dechet']);
    expect(zd.calls).not.toContainEqual(['eq', 'type', 'anti_gaspi']);
    expect(ag.calls).toContainEqual(['eq', 'type', 'anti_gaspi']);
    expect(ag.calls).not.toContainEqual(['eq', 'type', 'zero_dechet']);
  });
});

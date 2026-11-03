/**
 * Prédicats des chips de la liste Collectes (lib/collectes-chips).
 * Focus : les chips `non_transmises_zd` / `non_transmises_ag` sont le MIROIR EXACT
 * des cartes-actions « Non transmises ZD/AG » du Dashboard Admin (Bloc 1, §11 §1.1)
 * = cibles de clic. Leur prédicat DOIT rester identique à celui du compteur dans
 * `api/v1/admin/dashboard/kpi/route.ts` : type + statut_tms='non_envoye' +
 * tms_reference IS NULL + statut IN (programmee, validee), OU collecte
 * rejetée par son prestataire (`FILTRE_A_DISPATCHER`).
 */
import { describe, it, expect } from 'vitest';
import {
  FILTRE_A_DISPATCHER,
  applyChipPredicate,
  estADispatcher,
  type ChipQuery,
} from '@/lib/collectes-chips';

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
    or: (f) => (calls.push(['or', f]), q),
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
    expect(calls).toContainEqual(['or', FILTRE_A_DISPATCHER]);
  });

  it('« à dispatcher » = jamais envoyée OU rejetée par le prestataire (Val 2026-11-03)', () => {
    expect(FILTRE_A_DISPATCHER).toBe(
      'and(statut_tms.eq.non_envoye,tms_reference.is.null,statut.in.(programmee,validee)),' +
        'statut.eq.rejetee_par_prestataire',
    );
    const base = { statut_tms: 'non_envoye', tms_reference: null };
    expect(estADispatcher({ ...base, statut: 'programmee' })).toBe(true);
    expect(estADispatcher({ ...base, statut: 'validee' })).toBe(true);
    expect(
      estADispatcher({
        statut: 'rejetee_par_prestataire',
        statut_tms: 'rejetee_par_prestataire',
        tms_reference: 'CO-1',
      }),
    ).toBe(true);
    // Un camion refusé sur une collecte validée n'est pas un rejet.
    expect(
      estADispatcher({
        statut: 'validee',
        statut_tms: 'rejetee_par_prestataire',
        tms_reference: 'CO-1',
      }),
    ).toBe(false);
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

describe('collectes-chips / collectes_48h_non_validees = miroir KPI carte fusionnée', () => {
  it('applique le prédicat exact du compteur (ZD+AG, 48h, statut_tms non validé)', () => {
    const { q, calls } = recorder();
    applyChipPredicate(q, 'collectes_48h_non_validees', NOW);

    // ZD + AG confondus, fenêtre 48 h, collectes encore actives.
    expect(calls).toContainEqual(['in', 'type', ['zero_dechet', 'anti_gaspi']]);
    expect(calls).toContainEqual(['gte', 'date_collecte', '2026-07-15']);
    expect(calls).toContainEqual(['lte', 'date_collecte', '2026-07-17']);
    expect(calls).toContainEqual(['in', 'statut', ['programmee', 'validee']]);

    // « non validée par le prestataire » = statut_tms NOT IN (acceptee, en_attente_execution),
    // ce qui inclut mécaniquement les non transmises (non_envoye) — identique au KPI.
    const notCall = calls.find((c) => c[0] === 'not' && c[1] === 'statut_tms');
    expect(notCall).toBeDefined();
    const excluded = String(notCall![3]);
    expect(excluded).toContain('acceptee');
    expect(excluded).toContain('en_attente_execution');
    expect(excluded).not.toContain('non_envoye');
  });
});

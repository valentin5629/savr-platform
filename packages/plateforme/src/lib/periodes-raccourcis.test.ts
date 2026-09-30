/**
 * Raccourcis de période des filtres de date (décision Val 2026-09-30) : calcul
 * en jours parisiens, calendrier pur.
 */
import { describe, it, expect } from 'vitest';

import {
  decalerMois,
  periodeDerniers,
  raccourciDe,
  raccourcisPeriode,
} from './periodes-raccourcis';

describe('periodes-raccourcis', () => {
  it('decalerMois ramène au dernier jour du mois cible', () => {
    expect(decalerMois('2026-03-31', -1)).toBe('2026-02-28');
    expect(decalerMois('2024-03-31', -1)).toBe('2024-02-29');
    expect(decalerMois('2026-01-31', -2)).toBe('2025-11-30');
    expect(decalerMois('2026-01-15', -12)).toBe('2025-01-15');
  });

  it('periodeDerniers : jours / semaines / mois, aujourd’hui inclus ou non', () => {
    const midi = new Date('2026-09-30T10:00:00Z');
    expect(periodeDerniers(30, 'jours', true, midi)).toEqual({
      from: '2026-08-31',
      to: '2026-09-30',
    });
    expect(periodeDerniers(2, 'semaines', false, midi)).toEqual({
      from: '2026-09-15',
      to: '2026-09-29',
    });
    expect(periodeDerniers(12, 'mois', true, midi)).toEqual({
      from: '2025-09-30',
      to: '2026-09-30',
    });
  });

  it('periodeDerniers refuse un nombre non entier ou < 1', () => {
    for (const n of [0, -3, 1.5, Number.NaN]) {
      expect(periodeDerniers(n, 'jours')).toBeNull();
    }
  });

  it('aujourd’hui = jour à Paris, pas celui du poste', () => {
    // 23 h 30 UTC le 30/09 = 1 h 30 le 01/10 à Paris.
    const p = periodeDerniers(
      7,
      'jours',
      true,
      new Date('2026-09-30T23:30:00Z'),
    );
    expect(p?.to).toBe('2026-10-01');
  });

  it('liste standard CDC : 7 j, 30 j, trimestre, 12 mois, année civile', () => {
    const r = raccourcisPeriode(new Date('2026-09-30T10:00:00Z'));
    expect(r.map((x) => x.libelle)).toEqual([
      '7 derniers jours',
      '30 derniers jours',
      'Trimestre en cours',
      '12 derniers mois',
      'Année civile',
    ]);
    expect(r.find((x) => x.cle === 'trimestre')?.periode).toEqual({
      from: '2026-07-01',
      to: '2026-09-30',
    });
    expect(r.find((x) => x.cle === 'civile')?.periode).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(raccourciDe({ from: '2026-09-23', to: '2026-09-30' }, r)?.cle).toBe(
      '7j',
    );
  });
});

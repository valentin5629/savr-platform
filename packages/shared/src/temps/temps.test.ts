/**
 * Fuseau métier unique : les helpers donnent le MÊME résultat quel que soit le
 * fuseau du process (UTC sur Vercel/Railway/CI, Europe/Paris sur un poste de dev).
 * Les cas qui piègent : l'heure tardive (le jour UTC est la veille du jour Paris)
 * et le changement d'heure (UTC+2 l'été, UTC+1 l'hiver).
 */
import { describe, it, expect } from 'vitest';

import {
  FUSEAU_SAVR,
  jourParis,
  jourParisDecale,
  formatDateParis,
  formatHeureParis,
  formatDateHeureParis,
} from './index.js';

describe('temps — jourParis', () => {
  it('été : 22h30 UTC = 00h30 Paris le LENDEMAIN (le piège toISOString)', () => {
    const t = new Date('2026-07-14T22:30:00Z');
    // eslint-disable-next-line no-restricted-syntax -- on montre ici le bug que jourParis corrige
    expect(t.toISOString().slice(0, 10)).toBe('2026-07-14'); // ce que faisait le code
    expect(jourParis(t)).toBe('2026-07-15'); // le vrai jour à Paris
  });

  it('hiver : 23h30 UTC = 00h30 Paris le lendemain', () => {
    expect(jourParis(new Date('2026-01-14T23:30:00Z'))).toBe('2026-01-15');
  });

  it('même instant, même jour en journée', () => {
    expect(jourParis(new Date('2026-07-14T10:00:00Z'))).toBe('2026-07-14');
    expect(jourParis(new Date('2026-01-14T10:00:00Z'))).toBe('2026-01-14');
  });

  it('bascule heure d’été (29/03/2026) et d’hiver (25/10/2026)', () => {
    expect(jourParis(new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-29'); // +1 → 00h30
    expect(jourParis(new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-25'); // +2 → 01h30
  });

  it('une chaîne « YYYY-MM-DD » est un jour, pas un instant : rendue telle quelle', () => {
    expect(jourParis('2026-07-14')).toBe('2026-07-14');
  });

  it('entrée vide ou invalide → chaîne vide, jamais d’exception', () => {
    expect(jourParis(null)).toBe('');
    expect(jourParis('pas une date')).toBe('');
  });

  it('sans argument : le jour courant à Paris', () => {
    expect(jourParis()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('jourParisDecale franchit les mois et les années', () => {
    expect(jourParisDecale(-1, new Date('2026-01-01T12:00:00Z'))).toBe(
      '2025-12-31',
    );
    expect(jourParisDecale(1, new Date('2026-02-28T12:00:00Z'))).toBe(
      '2026-03-01',
    );
  });
});

describe('temps — formatage', () => {
  it('affiche l’heure de Paris, pas UTC', () => {
    const t = new Date('2026-07-14T22:30:00Z');
    expect(formatDateParis(t)).toBe('15/07/2026');
    expect(formatHeureParis(t)).toBe('00:30');
    expect(formatDateHeureParis(t)).toBe('15/07/2026 00:30');
  });

  it('hiver : décalage +1', () => {
    expect(formatHeureParis(new Date('2026-01-14T22:30:00Z'))).toBe('23:30');
  });

  it('date pure : aucun décalage appliqué', () => {
    expect(formatDateParis('2026-07-14')).toBe('14/07/2026');
  });

  it('vide → chaîne vide ; non parsable → valeur brute', () => {
    expect(formatDateParis(null)).toBe('');
    expect(formatDateHeureParis('')).toBe('');
    expect(formatDateParis('inconnu')).toBe('inconnu');
  });

  it('le fuseau métier est Europe/Paris', () => {
    expect(FUSEAU_SAVR).toBe('Europe/Paris');
  });
});

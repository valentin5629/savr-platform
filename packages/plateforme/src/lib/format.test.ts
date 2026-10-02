/**
 * R-UI-0 (B6/B7) — formatteurs FR de `lib/format.ts` : virgule décimale,
 * espace fine insécable (U+202F) de groupement via Intl fr-FR, espace insécable
 * (U+00A0) avant l'unité.
 */
import { describe, expect, it } from 'vitest';
import { fmtDec, fmtEuro, fmtInt, fmtKg, fmtPct } from './format';

const FINE = '\u202f';
const NBSP = '\u00a0';

describe('R-UI-0 — lib/format : nombres affichés en français', () => {
  it('fmtInt arrondit et groupe les milliers', () => {
    expect(fmtInt(18700)).toBe(`18${FINE}700`);
    expect(fmtInt(12.6)).toBe('13');
    expect(fmtInt(0)).toBe('0');
  });

  it('fmtDec : virgule décimale, nombre de décimales imposé', () => {
    expect(fmtDec(48.55)).toBe('48,6');
    expect(fmtDec(48, 1)).toBe('48,0');
    expect(fmtDec(1234.5, 2)).toBe(`1${FINE}234,50`);
  });

  it('fmtEuro : 2 décimales et « € » après une espace insécable (CDC §05 « 1 234,56 € »)', () => {
    expect(fmtEuro(1234.5)).toBe(`1${FINE}234,50${NBSP}€`);
    expect(fmtEuro(0)).toBe(`0,00${NBSP}€`);
    expect(fmtEuro(-5)).toBe(`-5,00${NBSP}€`);
    expect(fmtEuro(100, 0)).toBe(`100${NBSP}€`);
  });

  it('fmtPct et fmtKg : unité après une espace insécable, sans point décimal anglais', () => {
    expect(fmtPct(12.5)).toBe(`12,5${NBSP}%`);
    expect(fmtPct(100, 2)).toBe(`100,00${NBSP}%`);
    expect(fmtKg(12345)).toBe(`12${FINE}345${NBSP}kg`);
    expect(fmtKg(0, 1)).toBe(`0,0${NBSP}kg`);
    expect(fmtKg(45, 1)).toBe(`45,0${NBSP}kg`);
    expect(fmtPct(12.5)).not.toContain('.');
  });
});

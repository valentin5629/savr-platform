import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_MAX,
  lirePagination,
  nombreDePages,
  parseLimit,
  parsePage,
} from './pagination';

// R-UI-4a (E2) — lecture tolérante de `page` / `limit` : jamais d'erreur ni de
// range négatif, plafond sur `limit`.
describe('lib/pagination', () => {
  it('parsePage : absent, NaN, 0 ou négatif → 1 ; entier ≥ 1 conservé', () => {
    expect(parsePage(new URLSearchParams())).toBe(1);
    expect(parsePage(new URLSearchParams('page=abc'))).toBe(1);
    expect(parsePage(new URLSearchParams('page=0'))).toBe(1);
    expect(parsePage(new URLSearchParams('page=-3'))).toBe(1);
    expect(parsePage(new URLSearchParams('page=7'))).toBe(7);
  });

  it('parseLimit : défaut 50, plafond 100, invalide → défaut', () => {
    expect(parseLimit(new URLSearchParams())).toBe(DEFAULT_PAGE_SIZE);
    expect(parseLimit(new URLSearchParams('limit=25'))).toBe(25);
    expect(parseLimit(new URLSearchParams('limit=1000'))).toBe(PAGE_SIZE_MAX);
    expect(parseLimit(new URLSearchParams('limit=0'))).toBe(DEFAULT_PAGE_SIZE);
    expect(parseLimit(new URLSearchParams('limit=x'), 25)).toBe(25);
  });

  it('lirePagination : intervalle de .range() cohérent', () => {
    expect(lirePagination(new URLSearchParams('page=3&limit=20'))).toEqual({
      page: 3,
      limit: 20,
      from: 40,
      to: 59,
    });
    expect(lirePagination(new URLSearchParams())).toEqual({
      page: 1,
      limit: 50,
      from: 0,
      to: 49,
    });
  });

  it('nombreDePages : ≥ 1, arrondi au-dessus', () => {
    expect(nombreDePages(0)).toBe(1);
    expect(nombreDePages(50)).toBe(1);
    expect(nombreDePages(51)).toBe(2);
    expect(nombreDePages(101, 25)).toBe(5);
  });
});

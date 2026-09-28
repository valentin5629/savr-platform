import { describe, it, expect } from 'vitest';
import { periodeBenchmark } from './periode-benchmark.js';

describe('periodeBenchmark — période fixe du repère parc', () => {
  it('couvre les 24 derniers mois glissants (jour Paris)', () => {
    const now = new Date('2026-09-28T10:00:00Z');
    expect(periodeBenchmark(now)).toEqual({
      debut: '2024-09-28',
      fin: '2026-09-28',
    });
  });

  it('29 février → 28 février deux ans plus tôt (la fenêtre ne perd pas de jour)', () => {
    expect(periodeBenchmark(new Date('2028-02-29T10:00:00Z')).debut).toBe(
      '2026-02-28',
    );
  });

  it('raisonne sur le jour de Paris, quel que soit le fuseau du process', () => {
    // 30/03/2026 00:30 à Paris = 29/03 22:30 UTC.
    expect(periodeBenchmark(new Date('2026-03-29T22:30:00Z'))).toEqual({
      debut: '2024-03-30',
      fin: '2026-03-30',
    });
  });
});

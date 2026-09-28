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
});

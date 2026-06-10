import { describe, it, expect } from 'vitest';
import { libelleTypeCollecte } from './index';

describe('libelleTypeCollecte', () => {
  it('mappe ag', () => expect(libelleTypeCollecte('ag')).toBe('Anti-Gaspi'));
  it('mappe zd', () => expect(libelleTypeCollecte('zd')).toBe('Zéro Déchet'));
});

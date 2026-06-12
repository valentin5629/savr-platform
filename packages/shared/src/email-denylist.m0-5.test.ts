import { describe, it, expect } from 'vitest';
import { isDisposableEmail } from './email-denylist.js';

describe('isDisposableEmail', () => {
  it('détecte un domaine jetable connu', () => {
    expect(isDisposableEmail('0-180.com')).toBe(true);
  });

  it('accepte un domaine pro légitime', () => {
    expect(isDisposableEmail('dalloyau.fr')).toBe(false);
  });

  it('est insensible à la casse', () => {
    expect(isDisposableEmail('0-180.COM')).toBe(true);
  });

  it('retourne false pour un domaine inconnu', () => {
    expect(isDisposableEmail('gosavr.io')).toBe(false);
  });
});

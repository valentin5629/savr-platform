import { describe, it, expect, afterEach } from 'vitest';
import { verifySiret, _setInseeMock } from './siret.js';

afterEach(() => _setInseeMock(null));

describe('verifySiret (mock INSEE)', () => {
  it('retourne verifie quand le mock dit verifie', async () => {
    _setInseeMock(() => 'verifie');
    expect(await verifySiret('12345678901234')).toBe('verifie');
  });

  it('retourne echec pour un SIRET inconnu', async () => {
    _setInseeMock(() => 'echec');
    expect(await verifySiret('00000000000000')).toBe('echec');
  });

  it('retourne down quand INSEE est indisponible', async () => {
    _setInseeMock(() => 'down');
    expect(await verifySiret('12345678901234')).toBe('down');
  });
});

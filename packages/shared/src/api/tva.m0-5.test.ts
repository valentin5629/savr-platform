import { describe, it, expect, afterEach } from 'vitest';
import { verifyTva, _setViesMock } from './tva.js';

afterEach(() => _setViesMock(null));

describe('verifyTva (mock VIES)', () => {
  it('retourne non_applicable pour TVA vide', async () => {
    expect(await verifyTva(null)).toBe('non_applicable');
    expect(await verifyTva('')).toBe('non_applicable');
  });

  it('retourne verifie quand le mock dit verifie', async () => {
    _setViesMock(() => 'verifie');
    expect(await verifyTva('FR12345678901')).toBe('verifie');
  });

  it('retourne echec pour TVA invalide', async () => {
    _setViesMock(() => 'echec');
    expect(await verifyTva('FRINVALID')).toBe('echec');
  });

  it('retourne down si VIES indisponible — jamais bloquant', async () => {
    _setViesMock(() => 'down');
    expect(await verifyTva('FR12345678901')).toBe('down');
  });
});

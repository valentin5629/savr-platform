import { afterEach, describe, expect, it } from 'vitest';

import { verifySiret } from '../../api/siret.js';
import { verifyTva } from '../../api/tva.js';
import {
  clearInseViesMocks,
  mockInseeVerify,
  mockViesVerify,
} from './insee-vies.js';

afterEach(() => {
  clearInseViesMocks();
});

describe('M0.11 / INSEE — états mock', () => {
  it('M0.11 / INSEE — état verifie retourne verifie', async () => {
    mockInseeVerify('12345678901234', 'verifie');
    expect(await verifySiret('12345678901234')).toBe('verifie');
  });

  it('M0.11 / INSEE — état echec retourne echec', async () => {
    mockInseeVerify('00000000000000', 'echec');
    expect(await verifySiret('00000000000000')).toBe('echec');
  });

  it("M0.11 / INSEE — état down = inscription non bloquée (retourne 'down', pas d'exception)", async () => {
    mockInseeVerify('99999999999999', 'down');
    const result = await verifySiret('99999999999999');

    expect(result).toBe('down');
    // Règle métier : 'down' ne bloque pas l'inscription (dégradation gracieuse)
    // L'adapter utilise 'down' pour enqueuer une vérification async INSEE
  });

  it('M0.11 / INSEE — SIRET non configuré dans le mock retourne down (fallback)', async () => {
    mockInseeVerify('12345678901234', 'verifie');
    // Un SIRET différent → non dans le map → fallback 'down'
    expect(await verifySiret('99999999900000')).toBe('down');
  });
});

describe('M0.11 / VIES — états mock', () => {
  it('M0.11 / VIES — état verifie retourne verifie', async () => {
    mockViesVerify('FR12345678901', 'verifie');
    expect(await verifyTva('FR12345678901')).toBe('verifie');
  });

  it('M0.11 / VIES — état echec retourne echec', async () => {
    mockViesVerify('FR00000000000', 'echec');
    expect(await verifyTva('FR00000000000')).toBe('echec');
  });

  it('M0.11 / VIES — état down = flux non bloqué (VIES jamais bloquant)', async () => {
    mockViesVerify('FR99999999999', 'down');
    const result = await verifyTva('FR99999999999');

    expect(result).toBe('down');
    // Règle métier : VIES jamais bloquant — alerte Admin in-app seule
  });

  it('M0.11 / VIES — TVA nulle retourne non_applicable (avant même le mock)', async () => {
    mockViesVerify('FR12345678901', 'verifie');
    expect(await verifyTva(null)).toBe('non_applicable');
    expect(await verifyTva('')).toBe('non_applicable');
  });

  it('M0.11 / VIES — TVA non configurée dans le mock retourne down (fallback)', async () => {
    mockViesVerify('FR12345678901', 'verifie');
    expect(await verifyTva('FR00000000000')).toBe('down');
  });
});

describe('M0.11 / INSEE/VIES — teardown', () => {
  it('M0.11 / INSEE/VIES — restore() individuel réinitialise le mock INSEE', async () => {
    const restore = mockInseeVerify('12345678901234', 'verifie');
    expect(await verifySiret('12345678901234')).toBe('verifie');

    restore();
    // Sans mock actif, verifySiret() appellerait l'API réelle (pas de token en test → down)
    expect(await verifySiret('12345678901234')).toBe('down');
  });

  it('M0.11 / INSEE/VIES — clearInseViesMocks() réinitialise les deux mocks simultanément', async () => {
    mockInseeVerify('12345678901234', 'verifie');
    mockViesVerify('FR12345678901', 'verifie');

    clearInseViesMocks();

    expect(await verifySiret('12345678901234')).toBe('down');
    expect(await verifyTva('FR12345678901')).toBe('down');
  });
});

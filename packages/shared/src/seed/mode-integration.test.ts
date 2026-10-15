// Mode d'intégration des prestataires seedés : A Toutes! = Everest, comme en production
// (relevé 2026-10-14 : le seed le posait à « mts1 » pour tous).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { modeIntegrationSeed } from './codes-mts1.js';

describe('seed / mode d’intégration des prestataires', () => {
  it('A Toutes! passe par Everest', () => {
    expect(modeIntegrationSeed('ATOUTES')).toBe('everest');
  });

  it('les trois transporteurs MTS-1 restent en mts1', () => {
    for (const code of ['STRIKE', 'MARATHON', 'TRANSNOR']) {
      expect(modeIntegrationSeed(code)).toBe('mts1');
    }
  });

  it('seed_demo pose le mode par modeIntegrationSeed, sans « mts1 » en dur', () => {
    const source = readFileSync(path.join(__dirname, 'demo.ts'), 'utf8');
    expect(source).toContain('mode_integration: modeIntegrationSeed(code)');
    expect(source).not.toMatch(/mode_integration:\s*'mts1'/);
  });
});

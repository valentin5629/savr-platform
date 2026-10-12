// Codes transporteurs MTS-1 du jeu de données : lus dans l'environnement, jamais
// écrits dans le dépôt (décision Val 2026-10-12).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { codeMts1Seed } from './codes-mts1.js';

describe('seed / codes transporteurs MTS-1', () => {
  it('la variable du transporteur donne son code, espaces retirés', () => {
    const env = {
      SEED_MTS1_CODE_STRIKE: '  CODE-STRIKE-TEST ',
      SEED_MTS1_CODE_MARATHON: 'CODE-MARATHON-TEST',
      SEED_MTS1_CODE_TRANSNORMANDIE: 'CODE-TRANSNOR-TEST',
    };
    expect(codeMts1Seed('strike', env)).toBe('CODE-STRIKE-TEST');
    expect(codeMts1Seed('marathon', env)).toBe('CODE-MARATHON-TEST');
    expect(codeMts1Seed('transnormandie', env)).toBe('CODE-TRANSNOR-TEST');
  });

  it("sans variable, ou variable vide : la valeur inventée d'origine reste", () => {
    expect(codeMts1Seed('strike', {})).toBe('STRIKE-MTS1');
    expect(codeMts1Seed('marathon', { SEED_MTS1_CODE_MARATHON: '' })).toBe(
      'MARATHON-MTS1',
    );
    expect(
      codeMts1Seed('transnormandie', { SEED_MTS1_CODE_TRANSNORMANDIE: '   ' }),
    ).toBe('TRANSNOR-MTS1');
  });

  it('une variable ne sert que son transporteur : celle de Strike ne change pas le code de Marathon', () => {
    const env = { SEED_MTS1_CODE_STRIKE: 'CODE-STRIKE-TEST' };
    expect(codeMts1Seed('marathon', env)).toBe('MARATHON-MTS1');
  });

  it.each(['minimal.ts', 'demo.ts'])(
    '%s pose les trois transporteurs par codeMts1Seed, sans code écrit en dur',
    (fichier) => {
      const source = readFileSync(path.join(__dirname, fichier), 'utf8');
      expect(source).toContain("codeMts1Seed('strike')");
      expect(source).toContain("codeMts1Seed('marathon')");
      expect(source).toContain("codeMts1Seed('transnormandie')");
      expect(source).not.toMatch(/'(STRIKE|MARATHON|TRANSNOR)-MTS1'/);
    },
  );
});

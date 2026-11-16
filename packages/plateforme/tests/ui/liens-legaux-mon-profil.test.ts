import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Liens « Mentions légales · Confidentialité » en bas de « Mon profil »
// (Val 2026-11-16) : seul accès dans l'app depuis leur retrait du menu du
// compte (accès facile exigé par la LCEN et le RGPD). Chaque page qui rend
// « Mon profil » doit les monter juste après le panneau du compte.
const PAGES = [
  '(traiteur)/traiteur/parametres/page.tsx',
  '(agence)/agence/parametres/page.tsx',
  '(gestionnaire)/gestionnaire/parametres/page.tsx',
  '(client-organisateur)/organisateur/parametres/page.tsx',
  '(admin)/admin/mon-profil/page.tsx',
];

describe('« Mon profil » de chaque espace : liens légaux en bas', () => {
  it.each(PAGES)(
    '%s monte <LiensLegaux nouvelOnglet> après le panneau du compte',
    (page) => {
      const source = readFileSync(
        resolve(__dirname, '../../src/app', page),
        'utf8',
      );
      const panneau = source.search(/<RgpdComptePanel\b/);
      const liens = source.search(/<LiensLegaux\b[^>]*\bnouvelOnglet\b/);
      expect(panneau).toBeGreaterThan(-1);
      expect(liens).toBeGreaterThan(panneau);
    },
  );
});

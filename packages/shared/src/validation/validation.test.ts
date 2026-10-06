/**
 * R-UI-5 F9 — formats de saisie partagés. Chaque ancienne regex est rejouée
 * ici comme oracle : le prédicat partagé doit rendre EXACTEMENT le même verdict
 * qu'elle sur tout le corpus (aucune saisie acceptée avant ne devient refusée,
 * et inversement).
 */
import { describe, expect, it } from 'vitest';
import {
  estEmail,
  estSiren,
  estSiret,
  estTelephoneFr,
  REGEX_EMAIL,
  REGEX_SIREN,
  REGEX_SIRET,
  REGEX_TELEPHONE_FR,
} from './index.js';
import { isValidSiretFormat } from '../api/siret.js';

// Copies figées des regex remplacées (avant R-UI-5), une par site.
const ANCIENNES = {
  // components/admin/{lieu,transporteur,association}-modal.tsx,
  // api/v1/admin/associations/route.ts, api/v1/admin/associations/[id]/route.ts
  siren: /^\d{9}$/,
  // packages/shared/src/api/siret.ts
  siretShared: /^\d{14}$/,
  // api/v1/agence/shadow/[id]/siret/route.ts, lib/siret-organisation.ts
  siretPlateforme: /^[0-9]{14}$/,
  // lib/identite-signup.ts
  email: /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/,
  telephone:
    /^(?:(?:\+|00)33[\s.-]?(?:\(0\)[\s.-]?)?|0)[1-9](?:[\s.-]?\d{2}){4}$/,
};

const CORPUS_CHIFFRES = [
  '',
  '123456789',
  '12345678',
  '1234567890',
  ' 123456789',
  '123456789 ',
  '123 456 789',
  '12345678a',
  '123456789\n',
  '١٢٣٤٥٦٧٨٩', // chiffres arabo-indiens : `\d` ne les reconnaît pas
  '１２３４５６７８９', // chiffres pleine chasse
  '12345678901234',
  '1234567890123',
  '123456789012345',
  ' 12345678901234',
  '12345678901234 ',
  '123 456 789 01234',
  '1234567890123a',
  '12345678901234\n',
  '-12345678901234',
];

const CORPUS_EMAIL = [
  'a@b.fr',
  'prenom.nom@savr.co.uk',
  'x+tag@sous.domaine.io',
  'a@b',
  'a b@c.fr',
  '@b.fr',
  'a@.fr',
  'a@b..fr',
  'a@b.fr.',
  'a@@b.fr',
  ' a@b.fr',
  '',
];

const CORPUS_TELEPHONE = [
  '0123456789',
  '01 23 45 67 89',
  '01.23.45.67.89',
  '01-23-45-67-89',
  '+33 1 23 45 67 89',
  '+33123456789',
  '0033 1 23 45 67 89',
  '+33 (0)1 23 45 67 89',
  '0023456789',
  '012345678',
  '01234567890',
  '+44 1 23 45 67 89',
  '01  23 45 67 89',
  '1234567890',
  ' 0123456789',
  '',
];

describe('R-UI-5 F9 — validation partagée : SIREN', () => {
  it('accepte 9 chiffres ASCII exactement', () => {
    expect(estSiren('123456789')).toBe(true);
    expect(estSiren('000000000')).toBe(true);
  });

  it('refuse le reste, sans trim implicite', () => {
    for (const v of [
      '',
      '12345678',
      '1234567890',
      ' 123456789',
      '123 456 789',
      '12345678a',
      '123456789\n',
      '１２３４５６７８９',
    ])
      expect(estSiren(v), JSON.stringify(v)).toBe(false);
  });

  it('même verdict que l’ancienne regex sur tout le corpus', () => {
    for (const v of CORPUS_CHIFFRES)
      expect(estSiren(v), JSON.stringify(v)).toBe(ANCIENNES.siren.test(v));
    expect(REGEX_SIREN.source).toBe(ANCIENNES.siren.source);
  });
});

describe('R-UI-5 F9 — validation partagée : SIRET', () => {
  it('accepte 14 chiffres ASCII exactement', () => {
    expect(estSiret('12345678901234')).toBe(true);
  });

  it('refuse le reste, sans trim ni retrait de blancs implicite', () => {
    for (const v of [
      '',
      '1234567890123',
      '123456789012345',
      ' 12345678901234',
      '123 456 789 01234',
      '1234567890123a',
      '12345678901234\n',
    ])
      expect(estSiret(v), JSON.stringify(v)).toBe(false);
  });

  it('même verdict que les deux anciennes graphies (`\\d` et `[0-9]`)', () => {
    for (const v of CORPUS_CHIFFRES) {
      expect(estSiret(v), JSON.stringify(v)).toBe(
        ANCIENNES.siretShared.test(v),
      );
      expect(estSiret(v), JSON.stringify(v)).toBe(
        ANCIENNES.siretPlateforme.test(v),
      );
    }
    expect(REGEX_SIRET.source).toBe(ANCIENNES.siretShared.source);
  });

  it('isValidSiretFormat garde son trim des bords (sémantique inchangée)', () => {
    expect(isValidSiretFormat(' 12345678901234 ')).toBe(true);
    expect(isValidSiretFormat('123 456 789 01234')).toBe(false);
    for (const v of CORPUS_CHIFFRES)
      expect(isValidSiretFormat(v), JSON.stringify(v)).toBe(
        ANCIENNES.siretShared.test(v.trim()),
      );
  });
});

describe('R-UI-5 F9 — validation partagée : email', () => {
  it('accepte local@domaine.tld, refuse sans TLD / espace / @ manquant', () => {
    expect(estEmail('a@b.fr')).toBe(true);
    expect(estEmail('prenom.nom@savr.co.uk')).toBe(true);
    for (const v of ['a@b', 'a b@c.fr', '@b.fr', 'a@.fr', 'a@b..fr', ''])
      expect(estEmail(v), JSON.stringify(v)).toBe(false);
  });

  it('même verdict que l’ancienne regex sur tout le corpus', () => {
    for (const v of CORPUS_EMAIL)
      expect(estEmail(v), JSON.stringify(v)).toBe(ANCIENNES.email.test(v));
    expect(REGEX_EMAIL.source).toBe(ANCIENNES.email.source);
  });
});

describe('R-UI-5 F9 — validation partagée : téléphone FR', () => {
  it('accepte national et international, séparateurs usuels', () => {
    for (const v of [
      '0123456789',
      '01 23 45 67 89',
      '01.23.45.67.89',
      '+33 1 23 45 67 89',
      '0033 1 23 45 67 89',
      '+33 (0)1 23 45 67 89',
    ])
      expect(estTelephoneFr(v), JSON.stringify(v)).toBe(true);
  });

  it('refuse 0 suivi de 0, longueur fausse, indicatif étranger', () => {
    for (const v of [
      '0023456789',
      '012345678',
      '+44 1 23 45 67 89',
      '1234567890',
    ])
      expect(estTelephoneFr(v), JSON.stringify(v)).toBe(false);
  });

  it('même verdict que l’ancienne regex sur tout le corpus', () => {
    for (const v of CORPUS_TELEPHONE)
      expect(estTelephoneFr(v), JSON.stringify(v)).toBe(
        ANCIENNES.telephone.test(v),
      );
    expect(REGEX_TELEPHONE_FR.source).toBe(ANCIENNES.telephone.source);
  });
});

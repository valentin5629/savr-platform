/**
 * Code de vérification de l'équipe Savr — règle unique (décision Val 2026-11-04).
 * Obligatoire pour `admin_savr` et `ops_savr`, jamais pour un client ; refus dès
 * que le claim `aal` n'est pas exactement `aal2`.
 */
import { describe, expect, it } from 'vitest';

import {
  codeVerificationManquant,
  exigeCodeVerification,
  facteursTotp,
  normaliserCode,
} from './code-verification';

const CLIENTS = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
  'gestionnaire_lieux',
  'client_organisateur',
];

describe('exigeCodeVerification', () => {
  it.each(['admin_savr', 'ops_savr'])('%s : code obligatoire', (role) => {
    expect(exigeCodeVerification(role)).toBe(true);
  });

  it.each(CLIENTS)('%s : aucun code', (role) => {
    expect(exigeCodeVerification(role)).toBe(false);
  });

  it.each([undefined, null, '', 'admin_tms'])(
    'rôle %s : aucun code (le refus de rôle est ailleurs)',
    (role) => {
      expect(exigeCodeVerification(role)).toBe(false);
    },
  );
});

describe('codeVerificationManquant', () => {
  it.each([['aal1'], [undefined], [null], [''], ['AAL2'], [2], [{}]])(
    'admin_savr avec aal=%s : code manquant (fail-closed)',
    (aal) => {
      expect(codeVerificationManquant('admin_savr', aal)).toBe(true);
    },
  );

  it('admin_savr et ops_savr avec aal2 : code passé', () => {
    expect(codeVerificationManquant('admin_savr', 'aal2')).toBe(false);
    expect(codeVerificationManquant('ops_savr', 'aal2')).toBe(false);
  });

  it.each(CLIENTS)('%s en aal1 : rien de manquant', (role) => {
    expect(codeVerificationManquant(role, 'aal1')).toBe(false);
  });
});

describe('facteursTotp', () => {
  it('sépare les codes actifs des activations en cours, ignore les autres types', () => {
    const r = facteursTotp([
      { id: 'a', factor_type: 'totp', status: 'verified' },
      { id: 'b', factor_type: 'totp', status: 'unverified' },
      { id: 'c', factor_type: 'phone', status: 'verified' },
    ]);
    expect(r.verifies.map((f) => f.id)).toEqual(['a']);
    expect(r.enAttente.map((f) => f.id)).toEqual(['b']);
  });

  it('sans facteur (champ absent) : listes vides', () => {
    expect(facteursTotp(undefined)).toEqual({ verifies: [], enAttente: [] });
  });
});

describe('normaliserCode', () => {
  it.each([
    ['123456', '123456'],
    ['123 456', '123456'],
    [' 012345 ', '012345'],
  ])('%j → %j', (saisie, attendu) => {
    expect(normaliserCode(saisie)).toBe(attendu);
  });

  it.each([['12345'], ['1234567'], ['abcdef'], ['12345a'], [123456], [null]])(
    '%j → refusé',
    (saisie) => {
      expect(normaliserCode(saisie)).toBeNull();
    },
  );
});

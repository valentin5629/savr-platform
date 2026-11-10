/**
 * Code de vérification — règle unique. En production seulement ; obligatoire
 * pour `admin_savr` et `ops_savr` (Val 2026-11-04) et pour les utilisateurs d'une
 * organisation qui l'exige, hors session impersonée (VIPARIS, Val 2026-11-10) ;
 * refus dès que le claim `aal` n'est pas exactement `aal2`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  codeVerificationActif,
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

// Utilisateur d'une organisation qui exige le code (VIPARIS, Val 2026-11-10) :
// claim posé par le hook du jeton (migration 20261110200000).
const VIPARIS = {
  user_role: 'gestionnaire_lieux',
  code_verification_obligatoire: true,
};

// Le code n'est demandé qu'en production (Val 2026-11-04) : les cas de la
// règle sont joués en production simulée, le hors-production à part.
beforeEach(() => vi.stubEnv('VERCEL_ENV', 'production'));
afterEach(() => vi.unstubAllEnvs());

describe('codeVerificationActif — production seulement', () => {
  it.each([
    ['VERCEL_ENV', 'production'],
    ['NEXT_PUBLIC_VERCEL_ENV', 'production'],
  ])('%s=%s → actif', (variable, valeur) => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv(variable, valeur);
    expect(codeVerificationActif()).toBe(true);
  });

  it.each([['preview'], ['development'], ['']])(
    'VERCEL_ENV=%j sans NEXT_PUBLIC_VERCEL_ENV=production → inactif',
    (valeur) => {
      vi.stubEnv('VERCEL_ENV', valeur);
      expect(codeVerificationActif()).toBe(false);
    },
  );

  it('hors production : aucun code, même pour admin_savr ou une organisation qui l’exige', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(exigeCodeVerification({ user_role: 'admin_savr' })).toBe(false);
    expect(
      codeVerificationManquant({ user_role: 'admin_savr', aal: 'aal1' }),
    ).toBe(false);
    expect(codeVerificationManquant({ user_role: 'ops_savr' })).toBe(false);
    expect(codeVerificationManquant({ ...VIPARIS, aal: 'aal1' })).toBe(false);
  });
});

describe('exigeCodeVerification', () => {
  it.each(['admin_savr', 'ops_savr'])('%s : code obligatoire', (role) => {
    expect(exigeCodeVerification({ user_role: role })).toBe(true);
  });

  it.each(CLIENTS)('%s sans claim d’organisation : aucun code', (role) => {
    expect(exigeCodeVerification({ user_role: role })).toBe(false);
  });

  it.each(CLIENTS)(
    '%s d’une organisation qui l’exige : code obligatoire',
    (role) => {
      expect(
        exigeCodeVerification({
          user_role: role,
          code_verification_obligatoire: true,
        }),
      ).toBe(true);
    },
  );

  it.each([[false], ['true'], [1], [null], [{}]])(
    'claim d’organisation à %j : aucun code (seul true exige)',
    (valeur) => {
      expect(
        exigeCodeVerification({
          user_role: 'gestionnaire_lieux',
          code_verification_obligatoire: valeur,
        }),
      ).toBe(false);
    },
  );

  it('organisation qui l’exige, session impersonée : aucun code (l’Admin a passé le sien)', () => {
    expect(
      exigeCodeVerification({
        ...VIPARIS,
        impersonator_id: 'b2c3d4e5-0000-0000-0000-000000000001',
      }),
    ).toBe(false);
  });

  it('organisation qui l’exige, impersonator_id vide : code obligatoire', () => {
    expect(exigeCodeVerification({ ...VIPARIS, impersonator_id: '' })).toBe(
      true,
    );
  });

  it('équipe Savr impersonée : code toujours obligatoire (règle du 2026-11-04 inchangée)', () => {
    expect(
      exigeCodeVerification({
        user_role: 'ops_savr',
        impersonator_id: 'b2c3d4e5-0000-0000-0000-000000000001',
      }),
    ).toBe(true);
  });

  it.each([undefined, null, '', 'admin_tms', 42])(
    'rôle %s sans claim d’organisation : aucun code (le refus de rôle est ailleurs)',
    (role) => {
      expect(exigeCodeVerification({ user_role: role })).toBe(false);
    },
  );

  it('jeton vide : aucun code', () => {
    expect(exigeCodeVerification({})).toBe(false);
  });
});

describe('codeVerificationManquant', () => {
  it.each([['aal1'], [undefined], [null], [''], ['AAL2'], [2], [{}]])(
    'admin_savr avec aal=%s : code manquant (fail-closed)',
    (aal) => {
      expect(codeVerificationManquant({ user_role: 'admin_savr', aal })).toBe(
        true,
      );
    },
  );

  it.each([['aal1'], [undefined], ['AAL2']])(
    'organisation qui l’exige avec aal=%s : code manquant',
    (aal) => {
      expect(codeVerificationManquant({ ...VIPARIS, aal })).toBe(true);
    },
  );

  it('admin_savr, ops_savr et organisation qui l’exige avec aal2 : code passé', () => {
    expect(
      codeVerificationManquant({ user_role: 'admin_savr', aal: 'aal2' }),
    ).toBe(false);
    expect(
      codeVerificationManquant({ user_role: 'ops_savr', aal: 'aal2' }),
    ).toBe(false);
    expect(codeVerificationManquant({ ...VIPARIS, aal: 'aal2' })).toBe(false);
  });

  it.each(CLIENTS)(
    '%s sans claim d’organisation en aal1 : rien de manquant',
    (role) => {
      expect(codeVerificationManquant({ user_role: role, aal: 'aal1' })).toBe(
        false,
      );
    },
  );
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

import { describe, expect, it } from 'vitest';
import { LIBELLE_ROLE, ROLES_STAFF, isStaff, libelleRole } from './roles';
import { LIBELLE_ROLE as LIBELLE_ROLE_SOURCE } from './libelles/role';

// Ancien test inline, recopié à l'identique comme oracle d'équivalence.
const ancienTestStaff = (role: unknown): boolean =>
  role === 'admin_savr' || role === 'ops_savr';

describe('lib/roles — isStaff', () => {
  it('vrai pour admin_savr et ops_savr', () => {
    expect(isStaff('admin_savr')).toBe(true);
    expect(isStaff('ops_savr')).toBe(true);
  });

  it('faux pour tous les rôles clients', () => {
    for (const role of [
      'traiteur_manager',
      'traiteur_commercial',
      'agence',
      'gestionnaire_lieux',
      'client_organisateur',
    ]) {
      expect(isStaff(role)).toBe(false);
    }
  });

  it('strictement équivalent au test inline, valeurs limites comprises', () => {
    const cas: unknown[] = [
      undefined,
      null,
      '',
      'ADMIN_SAVR',
      ' admin_savr',
      'admin_savr ',
      'authenticated',
      '__proto__',
      'toString',
      0,
      {},
      ...ROLES_STAFF,
      'traiteur_manager',
    ];
    for (const v of cas) {
      expect(isStaff(v as string | null | undefined)).toBe(ancienTestStaff(v));
    }
  });

  it('ROLES_STAFF = admin puis ops', () => {
    expect([...ROLES_STAFF]).toEqual(['admin_savr', 'ops_savr']);
  });
});

describe('lib/roles — libellés réexportés (pas de copie)', () => {
  it('même objet que la source lib/libelles/role', () => {
    expect(LIBELLE_ROLE).toBe(LIBELLE_ROLE_SOURCE);
    expect(libelleRole('ops_savr')).toBe('Ops Savr');
    expect(libelleRole(undefined)).toBe('—');
  });
});

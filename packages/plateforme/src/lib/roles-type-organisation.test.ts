import { describe, it, expect } from 'vitest';
import {
  ROLES_PAR_TYPE_ORGANISATION,
  roleApresChangementDeType,
  roleCompatibleAvecType,
} from './roles-type-organisation';

const ROLES = [
  'admin_savr',
  'ops_savr',
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
  'gestionnaire_lieux',
  'client_organisateur',
];
const TYPES = [
  'traiteur',
  'agence',
  'gestionnaire_lieux',
  'client_organisateur',
];

describe('rôle ↔ type d’organisation (CDC §09 §2, revue sécurité 2026-11-18)', () => {
  it('chaque rôle client n’est admis que dans son type — même table que la base (pgTAP cas 1)', () => {
    const admis = ROLES.filter(
      (r) => r !== 'admin_savr' && r !== 'ops_savr',
    ).flatMap((r) =>
      TYPES.filter((t) => roleCompatibleAvecType(r, t)).map((t) => `${r}/${t}`),
    );
    expect(admis.sort()).toEqual([
      'agence/agence',
      'client_organisateur/client_organisateur',
      'gestionnaire_lieux/gestionnaire_lieux',
      'traiteur_commercial/traiteur',
      'traiteur_manager/traiteur',
    ]);
  });

  it('l’équipe Savr est admise dans tout type (organisation interne « Savr »)', () => {
    for (const t of TYPES) {
      expect(roleCompatibleAvecType('admin_savr', t)).toBe(true);
      expect(roleCompatibleAvecType('ops_savr', t)).toBe(true);
    }
  });

  it('un rôle client n’est jamais admis quand le type est inconnu', () => {
    expect(roleCompatibleAvecType('traiteur_manager', null)).toBe(false);
    expect(roleCompatibleAvecType('agence', undefined)).toBe(false);
    expect(roleCompatibleAvecType('agence', 'type_inconnu')).toBe(false);
  });

  it('changement de type : traiteur → traiteur_manager, sinon le rôle du même nom, toujours admis', () => {
    expect(roleApresChangementDeType('traiteur')).toBe('traiteur_manager');
    expect(roleApresChangementDeType('agence')).toBe('agence');
    expect(roleApresChangementDeType('gestionnaire_lieux')).toBe(
      'gestionnaire_lieux',
    );
    expect(roleApresChangementDeType('client_organisateur')).toBe(
      'client_organisateur',
    );
    for (const t of Object.keys(ROLES_PAR_TYPE_ORGANISATION)) {
      expect(roleCompatibleAvecType(roleApresChangementDeType(t), t)).toBe(
        true,
      );
    }
  });
});

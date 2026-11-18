/**
 * Rôle d'un utilisateur ↔ type de son organisation (revue sécurité 2026-11-18).
 *
 * CDC §09 §2 « Profils utilisateurs » et §05 §8 « Logique de rattachement » :
 * un rôle client n'existe que dans une organisation de son type. L'équipe Savr
 * (admin_savr, ops_savr) n'est pas contrôlée : son organisation de rattachement
 * est l'organisation interne « Savr » (contournement tracé M0.7 / M0.7b).
 *
 * Même règle en base, pour tout appelant : déclencheur
 * `trg_users_role_suit_type_organisation` et fonction
 * `plateforme.f_role_compatible_type_organisation` (migration 20261118200000).
 * Les routes la vérifient d'abord pour rendre un 422 lisible.
 */

import { libelleRole } from '@/lib/libelles/role';
import { libelleTypeOrganisation } from '@/lib/libelles/organisation';

export const ROLES_PAR_TYPE_ORGANISATION: Readonly<
  Record<string, readonly string[]>
> = {
  traiteur: ['traiteur_manager', 'traiteur_commercial'],
  agence: ['agence'],
  gestionnaire_lieux: ['gestionnaire_lieux'],
  client_organisateur: ['client_organisateur'],
};

const ROLES_EQUIPE_SAVR: readonly string[] = ['admin_savr', 'ops_savr'];

/** Vrai pour admin_savr et ops_savr. */
export function estRoleEquipeSavr(role: string): boolean {
  return ROLES_EQUIPE_SAVR.includes(role);
}

/**
 * Vrai si le rôle est admis dans une organisation de ce type. L'équipe Savr
 * l'est partout ; un rôle client ne l'est que dans son type, et jamais quand le
 * type est inconnu (organisation introuvable).
 */
export function roleCompatibleAvecType(
  role: string,
  type: string | null | undefined,
): boolean {
  if (estRoleEquipeSavr(role)) return true;
  if (!type) return false;
  return ROLES_PAR_TYPE_ORGANISATION[type]?.includes(role) ?? false;
}

/** Message du refus (422) d'un rôle hors du type de son organisation. */
export function messageRoleHorsType(
  role: string,
  type: string | null | undefined,
): string {
  const possibles = (type && ROLES_PAR_TYPE_ORGANISATION[type]) || [];
  return (
    `Le rôle « ${libelleRole(role)} » ne correspond pas au type de l’organisation ` +
    `(${libelleTypeOrganisation(type)}).` +
    (possibles.length > 0
      ? ` Rôle(s) possible(s) : ${possibles.map(libelleRole).join(', ')}.`
      : '')
  );
}

/**
 * Rôle que prend un utilisateur quand son organisation change de type et que
 * son rôle n'y est plus admis (arbitrage Val 2026-11-18) : traiteur →
 * traiteur_manager, sinon le rôle du même nom. Miroir de
 * `fn_organisations_type_reecrit_roles` en base.
 */
export function roleApresChangementDeType(type: string): string {
  return type === 'traiteur' ? 'traiteur_manager' : type;
}

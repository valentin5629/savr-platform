/**
 * Rôles utilisateur — source unique des TYPES et du test « staff » (R-UI-2 C7).
 *
 * `Role` = enum DB `plateforme.user_role` (types générés, import de type seul :
 * effacé à la compilation). Module PUR (aucun import serveur/client) : importé
 * par le middleware (Edge runtime) via `lib/routes.ts`.
 *
 * Les libellés FR restent dans `lib/libelles/role.ts` (source unique), simplement
 * réexportés ici.
 */
import type { Database } from '@savr/shared/src/database.types.js';

export { LIBELLE_ROLE, libelleRole } from './libelles/role';

/** Tous les rôles de la Plateforme (enum DB `user_role`). */
export type Role = Database['plateforme']['Enums']['user_role'];

/** Rôles internes Savr (back-office). */
export type StaffRole = Extract<Role, 'admin_savr' | 'ops_savr'>;

/** Rôles clients (rattachés à une organisation). */
export type ClientRole = Exclude<Role, StaffRole>;

/**
 * Rôles qui possèdent une navigation propre (`NAV_CONFIG`). `ops_savr` n'en a
 * pas : il partage la nav du back-office, rendue avec `role="admin_savr"`.
 */
export type NavRole = Exclude<Role, 'ops_savr'>;

/** Liste fermée des rôles staff (ordre historique : admin, puis ops). */
export const ROLES_STAFF = [
  'admin_savr',
  'ops_savr',
] as const satisfies readonly StaffRole[];

/**
 * Vrai si le rôle est un rôle staff (`admin_savr` ou `ops_savr`). Strictement
 * équivalent à `role === 'admin_savr' || role === 'ops_savr'` : `undefined`,
 * `null`, `''` et toute autre chaîne → faux.
 */
export function isStaff(role: string | null | undefined): role is StaffRole {
  return role === 'admin_savr' || role === 'ops_savr';
}

/**
 * Libellés FR des rôles utilisateur (enum `user_role`) — R-UI-0 B2.
 * Une seule graphie par rôle (fin des « Gestionnaire lieux » / « Gestionnaire de
 * lieux » concurrents). Fallback = valeur brute.
 */
import type { Database } from '@savr/shared/src/database.types.js';

export const LIBELLE_ROLE: Record<string, string> = {
  admin_savr: 'Admin Savr',
  ops_savr: 'Ops Savr',
  traiteur_manager: 'Traiteur (manager)',
  traiteur_commercial: 'Traiteur (commercial)',
  agence: 'Agence',
  gestionnaire_lieux: 'Gestionnaire de lieux',
  client_organisateur: 'Client organisateur',
} satisfies Record<Database['plateforme']['Enums']['user_role'], string>;

export function libelleRole(role: string | null | undefined): string {
  if (!role) return '—';
  return LIBELLE_ROLE[role] ?? role;
}

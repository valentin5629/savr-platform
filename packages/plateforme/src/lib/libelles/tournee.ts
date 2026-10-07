/**
 * Libellés FR du statut d'une tournée (enum `tournee_statut`) — R-UI-0 B2.
 */
import type { Database } from '@savr/shared/src/database.types.js';

export const LIBELLE_STATUT_TOURNEE: Record<string, string> = {
  planifiee: 'Planifiée',
  en_cours: 'En cours',
  terminee: 'Terminée',
  annulee: 'Annulée',
} satisfies Record<Database['plateforme']['Enums']['tournee_statut'], string>;

export function libelleStatutTournee(
  statut: string | null | undefined,
): string {
  if (!statut) return '—';
  return LIBELLE_STATUT_TOURNEE[statut] ?? statut;
}

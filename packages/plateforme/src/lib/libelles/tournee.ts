/**
 * Libellés FR du statut d'une tournée (enum `tournee_statut`) — R-UI-0 B2.
 */

export const LIBELLE_STATUT_TOURNEE: Record<string, string> = {
  planifiee: 'Planifiée',
  en_cours: 'En cours',
  terminee: 'Terminée',
  annulee: 'Annulée',
};

export function libelleStatutTournee(
  statut: string | null | undefined,
): string {
  if (!statut) return '—';
  return LIBELLE_STATUT_TOURNEE[statut] ?? statut;
}

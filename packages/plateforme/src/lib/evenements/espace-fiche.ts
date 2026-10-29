// Rôles qui ont la fiche Événement (décision Val 2026-10-29) et l'espace de
// fiche collecte client qu'elle emprunte. Admin et client organisateur : lot
// suivant (fiche collecte Admin au clic, fiche sans détail collecte).
import type { ClientRole } from '@/lib/api-auth';
import type { EspaceClient } from '@/lib/collectes/fiche-client-types';

export const ROLES_FICHE_EVENEMENT: ClientRole[] = [
  'gestionnaire_lieux',
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
];

export function espaceFicheDuRole(role: string): EspaceClient {
  if (role === 'gestionnaire_lieux') return 'gestionnaire';
  if (role === 'agence') return 'agence';
  return 'traiteur';
}

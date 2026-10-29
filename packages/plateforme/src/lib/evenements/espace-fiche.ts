// Espace de la fiche Événement d'un rôle (décision Val 2026-10-29 : la fiche
// est commune à tous les rôles). Gestionnaire, traiteur, agence : leur espace
// de fiche collecte client ; staff : 'admin' ; client organisateur :
// 'organisateur' (cartes de collecte légères, cf. fiche-evenement.ts).
import { isStaff as estRoleStaff } from '@/lib/roles';
import type { EspaceFiche } from './fiche-evenement';

export function espaceFicheDuRole(role: string): EspaceFiche | null {
  if (estRoleStaff(role)) return 'admin';
  switch (role) {
    case 'gestionnaire_lieux':
      return 'gestionnaire';
    case 'agence':
      return 'agence';
    case 'traiteur_manager':
    case 'traiteur_commercial':
      return 'traiteur';
    case 'client_organisateur':
      return 'organisateur';
    default:
      return null;
  }
}

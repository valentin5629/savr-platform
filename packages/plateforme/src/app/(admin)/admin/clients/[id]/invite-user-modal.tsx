'use client';

/**
 * Modale « Ajouter un utilisateur » de la fiche organisation Admin
 * (BL-P1-BOA-09, §06.06 §8). Variante scopée : contrairement à la modale
 * générique des Paramètres (`settings/users/invite-user-modal.tsx`, qui fait
 * choisir l'organisation), ici l'organisation est CELLE de la fiche
 * (`organisationId` fixe, pas de sélecteur). Réutilise le même provisioning
 * direct `POST /api/v1/admin/users` (compte créé + email d'invitation côté
 * serveur, `requireStaff`). Rôles proposés = ceux du type d'organisation
 * (les rôles internes Savr admin_savr/ops_savr ne se rattachent pas à une org
 * cliente). Composant commun `InviterUtilisateurModal` (R-UI-5, G5).
 */

import * as React from 'react';
import { InviterUtilisateurModal } from '@/components/organisation/inviter-utilisateur-modal';

// Rôles proposables selon le type d'organisation cliente.
export function rolesForOrgType(type: string): string[] {
  switch (type) {
    case 'traiteur':
      return ['traiteur_manager', 'traiteur_commercial'];
    case 'agence':
      return ['agence'];
    case 'gestionnaire_lieux':
      return ['gestionnaire_lieux'];
    case 'client_organisateur':
      return ['client_organisateur'];
    default:
      return [
        'traiteur_manager',
        'traiteur_commercial',
        'agence',
        'gestionnaire_lieux',
        'client_organisateur',
      ];
  }
}

export function ClientInviteUserModal({
  organisationId,
  orgType,
  onClose,
  onCreated,
}: {
  organisationId: string;
  orgType: string;
  onClose: () => void;
  onCreated: () => void;
}): React.ReactElement {
  const roles = rolesForOrgType(orgType);
  return (
    // organisation_id imposé = celle de la fiche (jamais choisi par l'UI).
    <InviterUtilisateurModal
      titre="Ajouter un utilisateur"
      roles={roles}
      roleInitial={roles[0] ?? 'agence'}
      organisationId={organisationId}
      idPrefix="invite"
      formId="invite-user-form"
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}

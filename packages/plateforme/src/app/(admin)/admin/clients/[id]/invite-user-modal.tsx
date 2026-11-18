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
 * cliente), lus dans la même table que la garde serveur
 * (`lib/roles-type-organisation.ts`). Composant commun `InviterUtilisateurModal`
 * (R-UI-5, G5).
 */

import * as React from 'react';
import { InviterUtilisateurModal } from '@/components/organisation/inviter-utilisateur-modal';
import { ROLES_PAR_TYPE_ORGANISATION } from '@/lib/roles-type-organisation';

// Rôles proposables selon le type d'organisation cliente ; type inconnu : tous
// les rôles clients (le serveur refuse ensuite un rôle hors du type).
export function rolesForOrgType(type: string): string[] {
  return [
    ...(ROLES_PAR_TYPE_ORGANISATION[type] ??
      Object.values(ROLES_PAR_TYPE_ORGANISATION).flat()),
  ];
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

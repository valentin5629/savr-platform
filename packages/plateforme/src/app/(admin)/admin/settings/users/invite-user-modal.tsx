'use client';

/**
 * Modale d'invitation d'un membre (BL-P1-BOA-09, §06.06 §8 « Inviter un nouvel
 * utilisateur »). Provisioning direct unique (décision Val 2026-07-01) : POST
 * /api/v1/admin/users crée le compte immédiatement (rôle + organisation imposés)
 * et envoie le lien d'activation côté serveur. L'`admin_savr` ne peut être créé
 * que par un admin_savr (le serveur ré-applique la garde ; option masquée ici).
 *
 * Variante « organisation à choisir » du composant commun
 * `InviterUtilisateurModal` (R-UI-5, G5) — la fiche organisation
 * (`clients/[id]/invite-user-modal.tsx`) en est la variante scopée.
 */

import * as React from 'react';
import { type AutocompleteOption } from '@/components/ui/autocomplete';
import { InviterUtilisateurModal } from '@/components/organisation/inviter-utilisateur-modal';

const ROLE_OPTIONS: { value: string; adminOnly?: boolean }[] = [
  { value: 'admin_savr', adminOnly: true },
  { value: 'ops_savr' },
  { value: 'traiteur_manager' },
  { value: 'traiteur_commercial' },
  { value: 'agence' },
  { value: 'gestionnaire_lieux' },
  { value: 'client_organisateur' },
];

export function InviteUserModal({
  onClose,
  onCreated,
  canInviteAdmin,
}: {
  onClose: () => void;
  onCreated: () => void;
  /** Vrai si le rôle réel courant est admin_savr (peut créer un admin_savr). */
  canInviteAdmin: boolean;
}): React.ReactElement {
  // Cache client de toutes les organisations (~80) — filtrage local.
  const orgsCache = React.useRef<AutocompleteOption[] | null>(null);
  const fetchOrgs = React.useCallback(
    async (q: string): Promise<AutocompleteOption[]> => {
      if (!orgsCache.current) {
        const all: AutocompleteOption[] = [];
        for (let page = 1; page <= 20; page++) {
          const res = await fetch(`/api/v1/admin/organisations?page=${page}`);
          if (!res.ok) break;
          const json = (await res.json()) as {
            data: { id: string; raison_sociale: string }[];
            limit: number;
          };
          all.push(
            ...json.data.map((o) => ({ id: o.id, label: o.raison_sociale })),
          );
          if (json.data.length < (json.limit ?? 50)) break;
        }
        orgsCache.current = all;
      }
      const needle = q.toLowerCase();
      return orgsCache.current
        .filter((o) => o.label.toLowerCase().includes(needle))
        .slice(0, 20);
    },
    [],
  );

  const roles = ROLE_OPTIONS.filter((r) => !r.adminOnly || canInviteAdmin).map(
    (r) => r.value,
  );

  return (
    <InviterUtilisateurModal
      titre="Inviter un membre"
      roles={roles}
      roleInitial="ops_savr"
      rechercherOrganisations={fetchOrgs}
      idPrefix="invite-membre"
      formId="invite-membre-form"
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}

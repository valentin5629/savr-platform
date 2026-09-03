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
 * cliente). Habillage Design System (Modal + form-kit + AlertBar).
 */

import * as React from 'react';
import { Modal } from '@/components/ui/modal';
import { AlertBar } from '@/components/ui/alert-bar';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

const ROLE_LABELS: Record<string, string> = {
  traiteur_manager: 'Traiteur (manager)',
  traiteur_commercial: 'Traiteur (commercial)',
  agence: 'Agence',
  gestionnaire_lieux: 'Gestionnaire de lieux',
  client_organisateur: 'Client organisateur',
};

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
  const [prenom, setPrenom] = React.useState('');
  const [nom, setNom] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState(roles[0] ?? 'agence');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // organisation_id imposé = celle de la fiche (jamais choisi par l'UI).
        body: JSON.stringify({
          prenom,
          nom,
          email,
          role,
          organisation_id: organisationId,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? "Erreur lors de l'invitation");
        return;
      }
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Ajouter un utilisateur"
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={onClose}
          >
            Annuler
          </Button>
          <Button type="submit" form="invite-user-form" disabled={saving}>
            {saving ? 'Invitation…' : 'Inviter'}
          </Button>
        </>
      }
    >
      {error && (
        <AlertBar variant="err" className="mb-4">
          {error}
        </AlertBar>
      )}
      <form
        id="invite-user-form"
        onSubmit={(e) => void submit(e)}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Prénom" htmlFor="invite-prenom" required>
            <Input
              id="invite-prenom"
              value={prenom}
              onChange={(e) => setPrenom(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Nom" htmlFor="invite-nom" required>
            <Input
              id="invite-nom"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              required
            />
          </FormField>
        </div>
        <FormField label="Email" htmlFor="invite-email" required>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </FormField>
        <FormField label="Rôle" htmlFor="invite-role">
          <Select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r] ?? r}
              </option>
            ))}
          </Select>
        </FormField>
      </form>
    </Modal>
  );
}

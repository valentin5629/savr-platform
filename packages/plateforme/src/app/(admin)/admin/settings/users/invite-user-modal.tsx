'use client';

/**
 * Modale d'invitation d'un membre (BL-P1-BOA-09, §06.06 §8 « Inviter un nouvel
 * utilisateur »). Provisioning direct unique (décision Val 2026-07-01) : POST
 * /api/v1/admin/users crée le compte immédiatement (rôle + organisation imposés)
 * et envoie le lien d'activation côté serveur. L'`admin_savr` ne peut être créé
 * que par un admin_savr (le serveur ré-applique la garde ; option masquée ici).
 *
 * Habillage Design System (R-UI-0 B5) : `Modal` (role="dialog", focus trap,
 * Échap, clic overlay) + `AlertBar` — même structure que la variante scopée
 * `clients/[id]/invite-user-modal.tsx`.
 */

import * as React from 'react';
import { Modal } from '@/components/ui/modal';
import { AlertBar } from '@/components/ui/alert-bar';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import {
  Autocomplete,
  type AutocompleteOption,
} from '@/components/ui/autocomplete';
import { libelleRole } from '@/lib/libelles/role';

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
  const [prenom, setPrenom] = React.useState('');
  const [nom, setNom] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('ops_savr');
  const [org, setOrg] = React.useState<AutocompleteOption | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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

  const roleOptions = ROLE_OPTIONS.filter(
    (r) => !r.adminOnly || canInviteAdmin,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!org) {
      setError('Sélectionnez une organisation.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prenom,
          nom,
          email,
          role,
          organisation_id: org.id,
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
      title="Inviter un membre"
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
          <Button
            type="submit"
            form="invite-membre-form"
            loading={saving}
            loadingText="Invitation…"
          >
            Inviter
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
        id="invite-membre-form"
        onSubmit={(e) => void submit(e)}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Prénom" htmlFor="invite-membre-prenom" required>
            <Input
              id="invite-membre-prenom"
              value={prenom}
              aria-label="Prénom"
              onChange={(e) => setPrenom(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Nom" htmlFor="invite-membre-nom" required>
            <Input
              id="invite-membre-nom"
              value={nom}
              aria-label="Nom"
              onChange={(e) => setNom(e.target.value)}
              required
            />
          </FormField>
        </div>

        <FormField label="Email" htmlFor="invite-membre-email" required>
          <Input
            id="invite-membre-email"
            type="email"
            value={email}
            aria-label="Email"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </FormField>

        <FormField label="Rôle" htmlFor="invite-membre-role">
          <Combobox
            id="invite-membre-role"
            aria-label="Rôle"
            icon={null}
            options={roleOptions.map((r) => ({
              value: r.value,
              label: libelleRole(r.value),
            }))}
            value={role}
            onChange={setRole}
          />
        </FormField>

        <FormField label="Organisation" htmlFor="invite-organisation" required>
          <Autocomplete
            id="invite-organisation"
            aria-label="Organisation"
            placeholder="Rechercher une organisation…"
            fetchOptions={fetchOrgs}
            selected={org}
            onChange={setOrg}
          />
        </FormField>
      </form>
    </Modal>
  );
}

'use client';

/**
 * Modale d'invitation d'un membre (BL-P1-BOA-09, §06.06 §8 « Inviter un nouvel
 * utilisateur »). Provisioning direct unique (décision Val 2026-07-01) : POST
 * /api/v1/admin/users crée le compte immédiatement (rôle + organisation imposés)
 * et envoie le lien d'activation côté serveur. L'`admin_savr` ne peut être créé
 * que par un admin_savr (le serveur ré-applique la garde ; option masquée ici).
 */

import * as React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Autocomplete,
  type AutocompleteOption,
} from '@/components/ui/autocomplete';

const ROLE_OPTIONS: { value: string; label: string; adminOnly?: boolean }[] = [
  { value: 'admin_savr', label: 'Admin Savr', adminOnly: true },
  { value: 'ops_savr', label: 'Ops Savr' },
  { value: 'traiteur_manager', label: 'Traiteur (manager)' },
  { value: 'traiteur_commercial', label: 'Traiteur (commercial)' },
  { value: 'agence', label: 'Agence' },
  { value: 'gestionnaire_lieux', label: 'Gestionnaire lieux' },
  { value: 'client_organisateur', label: 'Client organisateur' },
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Inviter un membre</h2>
          <button
            type="button"
            aria-label="Fermer"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-2 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Prénom</label>
              <input
                value={prenom}
                aria-label="Prénom"
                onChange={(e) => setPrenom(e.target.value)}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Nom</label>
              <input
                value={nom}
                aria-label="Nom"
                onChange={(e) => setNom(e.target.value)}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={email}
              aria-label="Email"
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Rôle</label>
            <select
              aria-label="Rôle"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            >
              {roleOptions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Organisation
            </label>
            <Autocomplete
              aria-label="Organisation"
              placeholder="Rechercher une organisation…"
              fetchOptions={fetchOrgs}
              selected={org}
              onChange={setOrg}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={onClose}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Invitation…' : 'Inviter'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

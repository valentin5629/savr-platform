'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { LieuOption } from '@/components/programmation/lieu-combobox';

// Formulaire lieu manuel inline (quick-add « lieu hors référentiel » §06.01).
// Extrait dans son propre fichier (pas exporté depuis la page) : Next.js App Router
// interdit les exports nommés arbitraires dans un `page.tsx` (échec `next build`).
export function LieuManuelForm({
  onSave,
  onCancel,
  organisationId,
}: {
  onSave: (lieu: LieuOption) => void;
  onCancel: () => void;
  // Admin support : org cible transmise pour le libellé de la notification (staff-only).
  organisationId?: string;
}) {
  const [form, setForm] = useState({
    nom: '',
    adresse_acces: '',
    code_postal: '',
    ville: '',
    stationnement: '',
    type_vehicule_max: '',
    acces_office: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/programmation/lieux', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          // Champs optionnels : ne jamais envoyer '' (invalide pour un enum Postgres)
          stationnement: form.stationnement || undefined,
          type_vehicule_max: form.type_vehicule_max || undefined,
          acces_office: form.acces_office || undefined,
          organisation_id: organisationId || undefined,
        }),
      });
      const data = (await res.json()) as LieuOption & { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Erreur');
        return;
      }
      onSave(data);
    } finally {
      setLoading(false);
    }
  };

  const valid =
    form.nom.trim() !== '' &&
    form.adresse_acces.trim() !== '' &&
    form.code_postal.trim() !== '' &&
    form.ville.trim() !== '';

  return (
    <div className="space-y-3">
      {(['nom', 'adresse_acces', 'code_postal', 'ville'] as const).map(
        (field) => (
          <input
            key={field}
            placeholder={
              {
                nom: 'Nom du lieu *',
                adresse_acces: "Adresse d'accès livraison *",
                code_postal: 'Code postal *',
                ville: 'Ville *',
              }[field]
            }
            value={form[field]}
            onChange={(e) =>
              setForm((p) => ({ ...p, [field]: e.target.value }))
            }
            className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500"
          />
        ),
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Select
          aria-label="Type de véhicule max"
          value={form.type_vehicule_max}
          onChange={(e) =>
            setForm((p) => ({ ...p, type_vehicule_max: e.target.value }))
          }
        >
          <option value="">Véhicule max (optionnel)</option>
          <option value="velo_cargo">Vélo cargo</option>
          <option value="camionnette">Camionnette</option>
          <option value="fourgon">Fourgon</option>
          <option value="vul">VUL</option>
          <option value="poids_lourd">Poids lourd</option>
        </Select>
        <Select
          aria-label="Stationnement"
          value={form.stationnement}
          onChange={(e) =>
            setForm((p) => ({ ...p, stationnement: e.target.value }))
          }
        >
          <option value="">Stationnement (optionnel)</option>
          <option value="facile">Facile</option>
          <option value="difficile">Difficile</option>
          <option value="tres_difficile">Très difficile</option>
        </Select>
        <Select
          aria-label="Accès office"
          value={form.acces_office}
          onChange={(e) =>
            setForm((p) => ({ ...p, acces_office: e.target.value }))
          }
        >
          <option value="">Accès office (optionnel)</option>
          <option value="facile">Facile</option>
          <option value="difficile">Difficile</option>
          <option value="tres_difficile">Très difficile</option>
        </Select>
      </div>
      {error && <p className="text-sm text-savr-error">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Annuler
        </Button>
        <Button onClick={() => void handleSave()} disabled={!valid || loading}>
          Ajouter ce lieu
        </Button>
      </div>
    </div>
  );
}

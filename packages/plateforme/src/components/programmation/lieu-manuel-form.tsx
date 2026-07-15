'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-error';
import { Label } from '@/components/ui/label';
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

  const CHAMPS = {
    nom: { label: 'Nom du lieu', placeholder: 'Ex : Salle Wagram' },
    adresse_acces: {
      label: "Adresse d'accès livraison",
      placeholder: 'Ex : 39 av de Wagram',
    },
    code_postal: { label: 'Code postal', placeholder: '75017' },
    ville: { label: 'Ville', placeholder: 'Paris' },
  } as const;

  return (
    <div className="space-y-4">
      {(['nom', 'adresse_acces', 'code_postal', 'ville'] as const).map(
        (field) => (
          <FormField
            key={field}
            label={CHAMPS[field].label}
            htmlFor={`lieu-${field}`}
            required
          >
            <Input
              id={`lieu-${field}`}
              placeholder={CHAMPS[field].placeholder}
              value={form[field]}
              onChange={(e) =>
                setForm((p) => ({ ...p, [field]: e.target.value }))
              }
            />
          </FormField>
        ),
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="lieu-vehicule">Type de véhicule max</Label>
          <Select
            id="lieu-vehicule"
            value={form.type_vehicule_max}
            onChange={(e) =>
              setForm((p) => ({ ...p, type_vehicule_max: e.target.value }))
            }
          >
            <option value="">Optionnel</option>
            <option value="velo_cargo">Vélo cargo</option>
            <option value="camionnette">Camionnette</option>
            <option value="fourgon">Fourgon</option>
            <option value="vul">VUL</option>
            <option value="poids_lourd">Poids lourd</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lieu-stationnement">Stationnement</Label>
          <Select
            id="lieu-stationnement"
            value={form.stationnement}
            onChange={(e) =>
              setForm((p) => ({ ...p, stationnement: e.target.value }))
            }
          >
            <option value="">Optionnel</option>
            <option value="facile">Facile</option>
            <option value="difficile">Difficile</option>
            <option value="tres_difficile">Très difficile</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lieu-office">Accès office</Label>
          <Select
            id="lieu-office"
            value={form.acces_office}
            onChange={(e) =>
              setForm((p) => ({ ...p, acces_office: e.target.value }))
            }
          >
            <option value="">Optionnel</option>
            <option value="facile">Facile</option>
            <option value="difficile">Difficile</option>
            <option value="tres_difficile">Très difficile</option>
          </Select>
        </div>
      </div>
      {error && <FormError>{error}</FormError>}
      <div className="flex gap-2 justify-end pt-1">
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

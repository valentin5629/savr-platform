'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-error';
import type { LieuOption } from '@/components/programmation/lieu-combobox';
import { AdresseAutocompleteInput } from '@/components/programmation/adresse-autocomplete-input';
import { FormActions } from '@/components/ui/form-actions';

// Formulaire lieu manuel inline (quick-add « lieu hors référentiel » §06.01).
// Type de véhicule max, stationnement et accès office n'y sont plus demandés
// (décision Val 2026-10-16) : l'équipe Savr les renseigne dans la fiche lieu Admin.
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
            {field === 'adresse_acces' ? (
              // Suggestions BAN : choisir une adresse remplit aussi CP + ville.
              <AdresseAutocompleteInput
                id={`lieu-${field}`}
                placeholder={CHAMPS[field].placeholder}
                value={form.adresse_acces}
                onChange={(adresse_acces) =>
                  setForm((p) => ({ ...p, adresse_acces }))
                }
                onSelect={(s) =>
                  setForm((p) => ({
                    ...p,
                    adresse_acces: s.adresse,
                    code_postal: s.codePostal,
                    ville: s.ville,
                  }))
                }
              />
            ) : (
              <Input
                id={`lieu-${field}`}
                required
                placeholder={CHAMPS[field].placeholder}
                value={form[field]}
                onChange={(e) =>
                  setForm((p) => ({ ...p, [field]: e.target.value }))
                }
              />
            )}
          </FormField>
        ),
      )}
      {error && <FormError>{error}</FormError>}
      <FormActions
        cancel={{ label: 'Annuler', onClick: onCancel }}
        submit={{
          label: 'Ajouter ce lieu',
          onClick: () => void handleSave(),
          disabled: !valid || loading,
        }}
        className="pt-1"
      />
    </div>
  );
}

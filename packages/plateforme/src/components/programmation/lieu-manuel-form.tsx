'use client';

import { useState } from 'react';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-error';
import type { LieuOption } from '@/components/programmation/lieu-combobox';
import { AdresseAutocompleteInput } from '@/components/programmation/adresse-autocomplete-input';
import { FormActions } from '@/components/ui/form-actions';

const OPTIONS_VEHICULE = [
  { value: '', label: 'Optionnel' },
  { value: 'velo_cargo', label: 'Vélo cargo' },
  { value: 'camionnette', label: 'Camionnette' },
  { value: 'fourgon', label: 'Fourgon' },
  { value: 'vul', label: 'VUL' },
  { value: 'poids_lourd', label: 'Poids lourd' },
];

const OPTIONS_DIFFICULTE = [
  { value: '', label: 'Optionnel' },
  { value: 'facile', label: 'Facile' },
  { value: 'difficile', label: 'Difficile' },
  { value: 'tres_difficile', label: 'Très difficile' },
];

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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <FormField label="Type de véhicule max" htmlFor="lieu-vehicule">
          <Combobox
            id="lieu-vehicule"
            icon={null}
            placeholder="Optionnel"
            options={OPTIONS_VEHICULE}
            value={form.type_vehicule_max}
            onChange={(v) => setForm((p) => ({ ...p, type_vehicule_max: v }))}
          />
        </FormField>
        <FormField label="Stationnement" htmlFor="lieu-stationnement">
          <Combobox
            id="lieu-stationnement"
            icon={null}
            placeholder="Optionnel"
            options={OPTIONS_DIFFICULTE}
            value={form.stationnement}
            onChange={(v) => setForm((p) => ({ ...p, stationnement: v }))}
          />
        </FormField>
        <FormField label="Accès office" htmlFor="lieu-office">
          <Combobox
            id="lieu-office"
            icon={null}
            placeholder="Optionnel"
            options={OPTIONS_DIFFICULTE}
            value={form.acces_office}
            onChange={(v) => setForm((p) => ({ ...p, acces_office: v }))}
          />
        </FormField>
      </div>
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

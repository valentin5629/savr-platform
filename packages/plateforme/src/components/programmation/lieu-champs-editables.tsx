'use client';

import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import type { LieuOption } from './lieu-combobox';
import { Text } from '@/components/ui/text';

// PROG-01 (CDC §06.01 l.104-114) : à la sélection d'un lieu, ses champs s'affichent
// pré-remplis et ÉDITABLES. Toute valeur modifiée est stockée dans
// collectes.lieu_overrides (le référentiel lieu n'est PAS mis à jour). Les champs
// admin/ops-only (commentaire_lieu, siren, email_gestionnaire, reference_citeo) ne sont
// jamais exposés. Stationnement, accès office, type de véhicule max, contraintes
// horaires et flux acceptés sont retirés du formulaire, pour tous les rôles (décision
// Val 2026-10-16) : ils restent dans le référentiel lieu, renseignés par l'équipe Savr.

export interface LieuEdits {
  adresse_acces: string;
  code_postal: string;
  ville: string;
  acces_details: string;
}

export function lieuToEdits(lieu: LieuOption): LieuEdits {
  return {
    adresse_acces: lieu.adresse_acces ?? '',
    code_postal: lieu.code_postal ?? '',
    ville: lieu.ville ?? '',
    acces_details: lieu.acces_details ?? '',
  };
}

/** Diff des éditions vs valeurs de référence du lieu → override (clés modifiées seules). */
export function computeLieuOverrides(
  base: LieuEdits,
  edits: LieuEdits,
): Record<string, string> {
  const overrides: Record<string, string> = {};
  (Object.keys(edits) as (keyof LieuEdits)[]).forEach((k) => {
    if (edits[k] !== base[k]) overrides[k] = edits[k];
  });
  return overrides;
}

export function LieuChampsEditables({
  edits,
  onChange,
}: {
  edits: LieuEdits;
  onChange: (e: LieuEdits) => void;
}) {
  const set = (k: keyof LieuEdits, v: string) => onChange({ ...edits, [k]: v });

  return (
    <div className="rounded-savr-md border border-savr-neutral-200 bg-savr-neutral-50 p-4 space-y-4">
      <Text tone="soft">
        Champs du lieu (modifiables pour cette collecte uniquement — le
        référentiel n'est pas mis à jour).
      </Text>

      <FormField label="Adresse d'accès livraison" htmlFor="edit-adresse">
        <Input
          id="edit-adresse"
          value={edits.adresse_acces}
          onChange={(e) => set('adresse_acces', e.target.value)}
        />
      </FormField>

      <FormGrid>
        <FormField label="Code postal" htmlFor="edit-cp">
          <Input
            id="edit-cp"
            value={edits.code_postal}
            onChange={(e) => set('code_postal', e.target.value)}
          />
        </FormField>
        <FormField label="Ville" htmlFor="edit-ville">
          <Input
            id="edit-ville"
            value={edits.ville}
            onChange={(e) => set('ville', e.target.value)}
          />
        </FormField>
      </FormGrid>

      <FormField label="Détails d'accès" htmlFor="edit-acces-details">
        <Input
          id="edit-acces-details"
          value={edits.acces_details}
          onChange={(e) => set('acces_details', e.target.value)}
          placeholder="Ex : quai N°2, sonner interphone B"
        />
      </FormField>
    </div>
  );
}

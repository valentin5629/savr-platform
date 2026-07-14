'use client';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { Label } from '@/components/ui/label';
import type { LieuOption } from './lieu-combobox';

// PROG-01 (CDC §06.01 l.104-114) : à la sélection d'un lieu, tous les champs du lieu
// SAUF le nom s'affichent pré-remplis et ÉDITABLES. Toute valeur modifiée est stockée
// dans collectes.lieu_overrides (le référentiel lieu n'est PAS mis à jour). Les champs
// admin/ops-only (commentaire_lieu, siren, email_gestionnaire, reference_citeo) ne sont
// jamais exposés. `flux acceptés` = colonne lieux.flux_autorises (text[]) : éditée ici en
// liste séparée par des virgules, l'override est stocké comme tableau.

const DIFFICULTE = [
  { v: 'facile', l: 'Facile' },
  { v: 'difficile', l: 'Difficile' },
  { v: 'tres_difficile', l: 'Très difficile' },
];
const VEHICULES = [
  { v: 'velo_cargo', l: 'Vélo cargo' },
  { v: 'camionnette', l: 'Camionnette' },
  { v: 'fourgon', l: 'Fourgon' },
  { v: 'vul', l: 'VUL' },
  { v: 'poids_lourd', l: 'Poids lourd' },
];

export interface LieuEdits {
  adresse_acces: string;
  code_postal: string;
  ville: string;
  acces_details: string;
  stationnement: string;
  type_vehicule_max: string;
  acces_office: string;
  contraintes_horaires: string;
  // flux acceptés (lieux.flux_autorises text[]) — saisis en liste séparée par virgules.
  flux_autorises: string;
}

export function lieuToEdits(lieu: LieuOption): LieuEdits {
  return {
    adresse_acces: lieu.adresse_acces ?? '',
    code_postal: lieu.code_postal ?? '',
    ville: lieu.ville ?? '',
    acces_details: lieu.acces_details ?? '',
    stationnement: lieu.stationnement ?? '',
    type_vehicule_max: lieu.type_vehicule_max ?? '',
    acces_office: lieu.acces_office ?? '',
    contraintes_horaires: lieu.contraintes_horaires ?? '',
    flux_autorises: (lieu.flux_autorises ?? []).join(', '),
  };
}

/**
 * Diff des éditions vs valeurs de référence du lieu → override (clés modifiées seules).
 * `flux_autorises` est re-sérialisé en tableau (colonne DB text[]) ; les autres champs
 * restent des chaînes.
 */
export function computeLieuOverrides(
  base: LieuEdits,
  edits: LieuEdits,
): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  (Object.keys(edits) as (keyof LieuEdits)[]).forEach((k) => {
    if (edits[k] === base[k]) return;
    overrides[k] =
      k === 'flux_autorises'
        ? edits[k]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : edits[k];
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
      <p className="text-sm text-savr-neutral-600">
        Champs du lieu (modifiables pour cette collecte uniquement — le
        référentiel n'est pas mis à jour).
      </p>

      <FormField label="Adresse d'accès livraison" htmlFor="edit-adresse">
        <Input
          id="edit-adresse"
          value={edits.adresse_acces}
          onChange={(e) => set('adresse_acces', e.target.value)}
        />
      </FormField>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
      </div>

      <FormField label="Détails d'accès" htmlFor="edit-acces-details">
        <Input
          id="edit-acces-details"
          value={edits.acces_details}
          onChange={(e) => set('acces_details', e.target.value)}
          placeholder="Ex : quai N°2, sonner interphone B"
        />
      </FormField>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="edit-stationnement">Stationnement</Label>
          <Select
            id="edit-stationnement"
            value={edits.stationnement}
            onChange={(e) => set('stationnement', e.target.value)}
          >
            <option value="">Non renseigné</option>
            {DIFFICULTE.map((d) => (
              <option key={d.v} value={d.v}>
                {d.l}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-office">Accès office</Label>
          <Select
            id="edit-office"
            value={edits.acces_office}
            onChange={(e) => set('acces_office', e.target.value)}
          >
            <option value="">Non renseigné</option>
            {DIFFICULTE.map((d) => (
              <option key={d.v} value={d.v}>
                {d.l}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-vehicule">Type de véhicule max</Label>
        <Select
          id="edit-vehicule"
          value={edits.type_vehicule_max}
          onChange={(e) => set('type_vehicule_max', e.target.value)}
        >
          <option value="">Non renseigné</option>
          {VEHICULES.map((v) => (
            <option key={v.v} value={v.v}>
              {v.l}
            </option>
          ))}
        </Select>
      </div>

      <FormField label="Contraintes horaires" htmlFor="edit-horaires">
        <Input
          id="edit-horaires"
          value={edits.contraintes_horaires}
          onChange={(e) => set('contraintes_horaires', e.target.value)}
          placeholder="Ex : livraison avant 9h uniquement"
        />
      </FormField>

      <FormField label="Flux acceptés" htmlFor="edit-flux">
        <Input
          id="edit-flux"
          value={edits.flux_autorises}
          onChange={(e) => set('flux_autorises', e.target.value)}
          placeholder="Ex : biodéchets, carton, verre (séparés par des virgules)"
        />
      </FormField>
    </div>
  );
}

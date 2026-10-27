'use client';

import { Minus, Plus } from 'lucide-react';
import { Combobox } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

// Besoin véhicule saisi avant l'envoi au prestataire (décision Val
// 2026-10-01) : type souhaité + nombre de véhicules. Attribution AG et choix
// du prestataire d'une ZD (décision Val 2026-10-27).

// Enum plateforme.type_vehicule (lieux.type_vehicule_max, tournees.type_vehicule,
// collectes.type_vehicule_souhaite).
export const TYPES_VEHICULE_OPTIONS: { value: string; label: string }[] = [
  { value: 'velo_cargo', label: 'Vélo cargo' },
  { value: 'camionnette', label: 'Camionnette' },
  { value: 'fourgon', label: 'Fourgon' },
  { value: 'vul', label: 'VUL' },
  { value: 'poids_lourd', label: 'Poids lourd' },
];

export const NB_VEHICULES_MAX = 20;

/** Nombre saisi valide : entier de 1 à 20. */
export function nbVehiculesValide(saisie: string): boolean {
  const n = Number(saisie);
  return Number.isInteger(n) && n >= 1 && n <= NB_VEHICULES_MAX;
}

export function ChampsBesoinVehicule({
  typeVehicule,
  onTypeVehicule,
  nbVehicules,
  onNbVehicules,
}: {
  typeVehicule: string;
  onTypeVehicule: (v: string) => void;
  nbVehicules: string;
  onNbVehicules: (v: string) => void;
}) {
  const nb = Number(nbVehicules);
  const ok = nbVehiculesValide(nbVehicules);
  const changer = (delta: number) => {
    const base = Number.isInteger(nb) ? nb : 1;
    onNbVehicules(
      String(Math.min(NB_VEHICULES_MAX, Math.max(1, base + delta))),
    );
  };
  return (
    <FormGrid>
      <FormField
        label="Type de véhicule souhaité"
        htmlFor="type-vehicule-select"
      >
        <Combobox
          id="type-vehicule-select"
          icon={null}
          searchable={false}
          placeholder="Non précisé"
          options={[
            { value: '', label: 'Non précisé' },
            ...TYPES_VEHICULE_OPTIONS,
          ]}
          value={typeVehicule}
          onChange={onTypeVehicule}
        />
      </FormField>
      <FormField label="Nombre de véhicules" htmlFor="nb-vehicules">
        <div className="flex h-10 items-center overflow-hidden rounded-savr-md border border-savr-neutral-300 bg-savr-white">
          <IconButton
            aria-label="Retirer un véhicule"
            disabled={ok && nb <= 1}
            variant="stepper"
            className="border-r border-savr-neutral-200"
            onClick={() => changer(-1)}
          >
            <Minus className="h-4 w-4" />
          </IconButton>
          <input
            id="nb-vehicules"
            type="text"
            inputMode="numeric"
            value={nbVehicules}
            onChange={(e) => onNbVehicules(e.target.value)}
            aria-invalid={!ok}
            aria-describedby="nb-vehicules-aide"
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-center text-sm font-bold text-savr-neutral-900 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-savr-primary-500"
          />
          <IconButton
            aria-label="Ajouter un véhicule"
            disabled={ok && nb >= NB_VEHICULES_MAX}
            variant="stepper"
            className="border-l border-savr-neutral-200"
            onClick={() => changer(1)}
          >
            <Plus className="h-4 w-4" />
          </IconButton>
        </div>
        <p
          id="nb-vehicules-aide"
          className={cn(
            'mt-1 text-xs',
            ok ? 'text-savr-neutral-500' : 'text-savr-error-strong',
          )}
        >
          {ok
            ? `Entier entre 1 et ${NB_VEHICULES_MAX} : 1 commande par véhicule chez le prestataire.`
            : `Nombre invalide : entier entre 1 et ${NB_VEHICULES_MAX}.`}
        </p>
      </FormField>
    </FormGrid>
  );
}

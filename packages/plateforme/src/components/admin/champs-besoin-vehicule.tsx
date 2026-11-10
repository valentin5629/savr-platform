'use client';

import { MinusIcon, PlusIcon } from '@/components/ui/icones';
import { Combobox } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import { IconButton } from '@/components/ui/icon-button';
import { VEHICULE_LABEL } from '@/lib/lieux-labels';

// Besoin véhicule saisi avant l'envoi au prestataire (décision Val
// 2026-10-01) : type souhaité + nombre de véhicules. Attribution AG et choix
// du prestataire d'une ZD (décision Val 2026-10-27).

// Véhicules proposés (décision Val 2026-11-10), valeurs de l'enum
// plateforme.type_vehicule. Une collecte qui porte un ancien type le garde
// dans le menu tant qu'il n'est pas changé.
const TYPES_VEHICULE_OPTIONS: { value: string; label: string }[] = [
  'velo_cargo',
  'camion_frigo',
  'camion_16m3',
  'camion_20m3',
].map((value) => ({ value, label: VEHICULE_LABEL[value] ?? value }));

function optionsVehicule(actuel: string) {
  const ancien =
    actuel && !TYPES_VEHICULE_OPTIONS.some((o) => o.value === actuel)
      ? [{ value: actuel, label: VEHICULE_LABEL[actuel] ?? actuel }]
      : [];
  return [
    { value: '', label: 'Non précisé' },
    ...TYPES_VEHICULE_OPTIONS,
    ...ancien,
  ];
}

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
          options={optionsVehicule(typeVehicule)}
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
            <MinusIcon className="h-4 w-4" />
          </IconButton>
          <input
            id="nb-vehicules"
            type="text"
            inputMode="numeric"
            value={nbVehicules}
            onChange={(e) => onNbVehicules(e.target.value)}
            aria-invalid={!ok}
            aria-describedby={ok ? undefined : 'nb-vehicules-aide'}
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-center text-sm font-bold text-savr-neutral-900 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-savr-primary-500"
          />
          <IconButton
            aria-label="Ajouter un véhicule"
            disabled={ok && nb >= NB_VEHICULES_MAX}
            variant="stepper"
            className="border-l border-savr-neutral-200"
            onClick={() => changer(1)}
          >
            <PlusIcon className="h-4 w-4" />
          </IconButton>
        </div>
        {/* Aide retirée (décision Val 2026-10-27) ; reste l'erreur. */}
        {!ok && (
          <p
            id="nb-vehicules-aide"
            className="mt-1 text-xs text-savr-error-strong"
          >
            Nombre invalide : entier entre 1 et {NB_VEHICULES_MAX}.
          </p>
        )}
      </FormField>
    </FormGrid>
  );
}

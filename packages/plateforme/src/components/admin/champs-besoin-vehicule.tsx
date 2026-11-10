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

// Véhicules proposés selon le type de collecte (décision Val 2026-11-10),
// valeurs de l'enum plateforme.type_vehicule. Une collecte qui porte un autre
// type le garde dans le menu tant qu'il n'est pas changé.
const TYPES_VEHICULE_PAR_COLLECTE: Record<
  'anti_gaspi' | 'zero_dechet',
  string[]
> = {
  anti_gaspi: ['velo_cargo', 'camionnette_frigo', 'camion_frigo'],
  zero_dechet: [
    'camion_16m3_simple',
    'camion_16m3_double',
    'camion_20m3_simple',
    'camion_20m3_double',
  ],
};

function optionsVehicule(
  typeCollecte: 'anti_gaspi' | 'zero_dechet',
  actuel: string,
) {
  const proposes = TYPES_VEHICULE_PAR_COLLECTE[typeCollecte];
  const valeurs =
    actuel && !proposes.includes(actuel) ? [...proposes, actuel] : proposes;
  return [
    { value: '', label: 'Non précisé' },
    ...valeurs.map((value) => ({
      value,
      label: VEHICULE_LABEL[value] ?? value,
    })),
  ];
}

export const NB_VEHICULES_MAX = 20;

/** Nombre saisi valide : entier de 1 à 20. */
export function nbVehiculesValide(saisie: string): boolean {
  const n = Number(saisie);
  return Number.isInteger(n) && n >= 1 && n <= NB_VEHICULES_MAX;
}

export function ChampsBesoinVehicule({
  typeCollecte,
  typeVehicule,
  onTypeVehicule,
  nbVehicules,
  onNbVehicules,
}: {
  typeCollecte: 'anti_gaspi' | 'zero_dechet';
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
          options={optionsVehicule(typeCollecte, typeVehicule)}
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

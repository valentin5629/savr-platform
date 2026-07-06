'use client';

import { MultiSelectFilter, type MultiOption } from './MultiSelectFilter.js';
import { TAILLE_OPTIONS } from './taille-options.js';

// Valeurs des 4 filtres « parc » communs (§06.05 §1) — hors Période (gérée par la
// barre parente). Réutilisé par la barre globale du dashboard ET la liste Événements.
export interface ParcFilterValue {
  lieu_ids: string[];
  traiteur_ids: string[];
  type_evenement_ids: string[];
  taille_evenement_codes: string[];
}

export interface ParcFilterOptions {
  lieux: MultiOption[];
  traiteurs: MultiOption[];
  /** Types d'événement (référentiel) au format { id, libelle }. */
  types: { id: string; libelle: string }[];
}

interface ParcMultiSelectsProps {
  value: ParcFilterValue;
  options: ParcFilterOptions;
  onChange: (patch: Partial<ParcFilterValue>) => void;
  /** Préfixe des data-testid (ex : « dash-filter » → dash-filter-lieux). */
  testidPrefix?: string;
}

/**
 * 4 multi-selects « parc » (Lieux / Traiteurs / Type d'événement / Taille) — §06.05 §1.
 * Composant présentationnel pur : aucune fetch, aucun état, aucune écriture.
 */
export function ParcMultiSelects({
  value,
  options,
  onChange,
  testidPrefix = 'parc-filter',
}: ParcMultiSelectsProps) {
  const typeOptions: MultiOption[] = options.types.map((t) => ({
    id: t.id,
    nom: t.libelle,
  }));

  return (
    <>
      <MultiSelectFilter
        label="Lieux"
        options={options.lieux}
        selected={value.lieu_ids}
        onChange={(ids) => onChange({ lieu_ids: ids })}
        testid={`${testidPrefix}-lieux`}
      />
      <MultiSelectFilter
        label="Traiteurs"
        options={options.traiteurs}
        selected={value.traiteur_ids}
        onChange={(ids) => onChange({ traiteur_ids: ids })}
        testid={`${testidPrefix}-traiteurs`}
      />
      <MultiSelectFilter
        label="Type d'événement"
        options={typeOptions}
        selected={value.type_evenement_ids}
        onChange={(ids) => onChange({ type_evenement_ids: ids })}
        testid={`${testidPrefix}-type`}
      />
      <MultiSelectFilter
        label="Taille d'événement"
        options={TAILLE_OPTIONS}
        selected={value.taille_evenement_codes}
        onChange={(ids) => onChange({ taille_evenement_codes: ids })}
        testid={`${testidPrefix}-taille`}
      />
    </>
  );
}

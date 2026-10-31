'use client';

import {
  FiltreCoches,
  type OptionFiltre,
} from '@/components/ui/filtre-en-ligne';
import { TAILLE_OPTIONS } from './taille-options.js';

// Valeurs des filtres de la barre globale des dashboards, hors Période (gérée
// par la barre parente).
export interface ParcFilterValue {
  lieu_ids: string[];
  traiteur_ids: string[];
  /** Noms de client organisateur (traiteur, agence — §06.04). */
  client_noms: string[];
  type_evenement_ids: string[];
  taille_evenement_codes: string[];
}

/**
 * Options de la barre. Chaque rôle n'en reçoit que les siennes : `traiteurs`
 * (gestionnaire, client organisateur, Dashboard Client Admin) ou `clients`
 * (traiteur, agence, §06.04 : pas de filtre Traiteurs, c'est lui seul). Un
 * filtre sans options fournies n'est pas affiché.
 */
export interface ParcFilterOptions {
  lieux: OptionFiltre[];
  traiteurs?: OptionFiltre[];
  clients?: OptionFiltre[];
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
 * Filtres à cocher de la barre globale, au format en ligne (à placer dans une
 * `BarreFiltres`) : Lieux, puis Client organisateur (traiteur, agence) ou
 * Traiteurs (§06.05 §1), puis Type et Taille d'événement.
 * Composant présentationnel pur : aucune fetch, aucun état, aucune écriture.
 */
export function ParcMultiSelects({
  value,
  options,
  onChange,
  testidPrefix = 'parc-filter',
}: ParcMultiSelectsProps) {
  const typeOptions: OptionFiltre[] = options.types.map((t) => ({
    id: t.id,
    nom: t.libelle,
  }));

  return (
    <>
      <FiltreCoches
        label="Lieux"
        options={options.lieux}
        selected={value.lieu_ids}
        onChange={(ids) => onChange({ lieu_ids: ids })}
        testid={`${testidPrefix}-lieux`}
      />
      {options.clients && (
        <FiltreCoches
          label="Client organisateur"
          options={options.clients}
          selected={value.client_noms}
          onChange={(ids) => onChange({ client_noms: ids })}
          testid={`${testidPrefix}-clients`}
        />
      )}
      {options.traiteurs && (
        <FiltreCoches
          label="Traiteurs"
          options={options.traiteurs}
          selected={value.traiteur_ids}
          onChange={(ids) => onChange({ traiteur_ids: ids })}
          testid={`${testidPrefix}-traiteurs`}
        />
      )}
      <FiltreCoches
        label="Type d'événement"
        options={typeOptions}
        selected={value.type_evenement_ids}
        onChange={(ids) => onChange({ type_evenement_ids: ids })}
        testid={`${testidPrefix}-type`}
      />
      <FiltreCoches
        label="Taille d'événement"
        options={TAILLE_OPTIONS}
        selected={value.taille_evenement_codes}
        onChange={(ids) => onChange({ taille_evenement_codes: ids })}
        testid={`${testidPrefix}-taille`}
      />
    </>
  );
}

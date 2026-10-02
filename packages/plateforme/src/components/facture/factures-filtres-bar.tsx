'use client';

import { DateRangePicker } from '@/components/ui/date-range-picker';
import { compteurResultats } from '@/lib/compteur-resultats';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches } from '@/components/ui/filtre-en-ligne';
import { liste, texte, type ValeursFiltres } from '@/lib/hooks/use-filtres-url';
import type { Database } from '@savr/shared/src/database.types.js';

type Enums = Database['plateforme']['Enums'];

// FacturesFiltresBar — barre de filtres des listes Factures de « Mon
// organisation » (R-UI-4b, D10 : parité entre rôles). Reprend À L'IDENTIQUE la
// barre du traiteur (`traiteur/mon-organisation/mon-organisation-client.tsx`,
// §06.04 §6 l.690) : « Période » en premier, Statut et Type à choix multiple,
// case « Tous » = sélection vide (décision Val 2026-09-30), compteur et
// « Réinitialiser les filtres » en pied (D5). Mêmes clés d'URL que la route
// traiteur (`statuts`, `types`, `date_debut`, `date_fin`).
//
// Les routes factures gestionnaire et agence n'acceptent pas (encore) ces
// filtres en liste : `filtrerFactures` applique les mêmes critères côté client
// sur les factures chargées — même résultat, à brancher sur la route dès
// qu'elle lira `listeCsv` (reliquat R-UI-4b). La barre traiteur n'est pas
// encore branchée sur ce composant (fichier tenu par un autre chantier).

/** Schéma `useFiltresUrl` : mêmes clés que la route `traiteur/factures`. */
export const FILTRES_FACTURES = {
  statuts: liste(),
  types: liste(),
  date_debut: texte(''),
  date_fin: texte(''),
};
export type FiltresFactures = ValeursFiltres<typeof FILTRES_FACTURES>;

// Valeurs = enums réels plateforme.facture_statut / facture_type (brouillon
// exclu par les routes ; « En retard » est un badge dérivé de date_echeance,
// pas un statut stocké → non filtrable).
export const STATUTS_FACTURE_OPTIONS = [
  { id: 'en_attente_pennylane', nom: 'En attente' },
  { id: 'emise', nom: 'Émise' },
  { id: 'payee', nom: 'Payée' },
  { id: 'annulee', nom: 'Annulée' },
] satisfies { id: Enums['facture_statut']; nom: string }[];

export const TYPES_FACTURE_OPTIONS = [
  { id: 'zero_dechet', nom: 'ZD' },
  { id: 'collecte_antigaspi', nom: 'AG' },
  { id: 'achat_pack_antigaspi', nom: 'Pack' },
  { id: 'avoir', nom: 'Avoir' },
] satisfies { id: Enums['facture_type']; nom: string }[];

interface FactureFiltrable {
  statut: string;
  /** Absent quand la route ne le renvoie pas (gestionnaire) : critère ignoré. */
  type?: string | null;
  date_emission: string | null;
}

/**
 * Filtrage côté client, mêmes critères que la route traiteur : statut ∈
 * `statuts`, type ∈ `types`, `date_emission` dans [date_debut, date_fin]
 * (dates ISO, comparaison lexicale ; une facture sans date d'émission est
 * écartée dès qu'une borne est posée, comme `gte`/`lte` en SQL).
 */
export function filtrerFactures<T extends FactureFiltrable>(
  factures: readonly T[],
  f: FiltresFactures,
): T[] {
  return factures.filter((x) => {
    if (f.statuts.length > 0 && !f.statuts.includes(x.statut)) return false;
    if (f.types.length > 0 && x.type !== undefined) {
      if (x.type === null || !f.types.includes(x.type)) return false;
    }
    if (f.date_debut || f.date_fin) {
      if (!x.date_emission) return false;
      if (f.date_debut && x.date_emission < f.date_debut) return false;
      if (f.date_fin && x.date_emission > f.date_fin) return false;
    }
    return true;
  });
}

interface Props {
  value: FiltresFactures;
  /** `set` de `useFiltresUrl(FILTRES_FACTURES)`. */
  set: (patch: Partial<FiltresFactures>) => void;
  actif: boolean;
  onReset: () => void;
  /** Nombre de factures affichées (compteur du pied, D5). */
  count: number;
  /** Filtre Type masqué quand la route ne renvoie pas `type` (gestionnaire). */
  filtres?: { type?: boolean };
  className?: string;
}

export function FacturesFiltresBar({
  value: f,
  set,
  actif,
  onReset,
  count,
  filtres,
  className,
}: Props) {
  return (
    <FilterBar
      className={className}
      data-testid="factures-filtres"
      count={compteurResultats(count, 'facture', 'factures')}
      actif={actif}
      onReset={onReset}
    >
      {/* « Période » en premier (décision Val 2026-09-30). */}
      <DateRangePicker
        titre="Période"
        id="factures-periode"
        data-testid="factures-periode"
        value={{ from: f.date_debut, to: f.date_fin }}
        onChange={(p) => set({ date_debut: p.from, date_fin: p.to })}
      />
      <FiltreCoches
        label="Statut"
        testid="factures-statut"
        options={STATUTS_FACTURE_OPTIONS}
        selected={f.statuts}
        onChange={(ids) => set({ statuts: ids })}
      />
      {(filtres?.type ?? true) && (
        <FiltreCoches
          label="Type"
          testid="factures-type"
          options={TYPES_FACTURE_OPTIONS}
          selected={f.types}
          onChange={(ids) => set({ types: ids })}
        />
      )}
    </FilterBar>
  );
}

'use client';

import { useMemo } from 'react';
import {
  FiltreCoches,
  type OptionFiltre,
} from '@/components/ui/filtre-en-ligne';

export interface OrganisationOption {
  id: string;
  /** Nom NOT NULL — colonne canonique de l'autocomplete (§06.06 §2). */
  nom: string;
  /** Raison sociale nullable — fallback = nom. */
  raison_sociale: string | null;
  type: string;
}

function orgLabel(o: OrganisationOption): string {
  return o.raison_sociale ?? o.nom;
}

interface OrganisationSelectorProps {
  organisations: OrganisationOption[];
  /** ids sélectionnés ; tableau vide = « Toutes les organisations ». */
  selected: string[];
  onChange: (ids: string[]) => void;
}

// Un filtre par type, dans l'ordre §06.06 §2. Valeur sans case cochée :
// « Tous / Toutes » si rien n'est coché nulle part (= toutes les
// organisations), « Aucun / Aucune » dès qu'un autre type a une sélection
// (le périmètre est l'union des organisations cochées).
const FILTRES = [
  { type: 'traiteur', titre: 'Traiteur', tous: 'Tous', aucun: 'Aucun' },
  { type: 'agence', titre: 'Agence', tous: 'Toutes', aucun: 'Aucune' },
  {
    type: 'gestionnaire_lieux',
    titre: 'Gestionnaire de lieux',
    tous: 'Tous',
    aucun: 'Aucun',
  },
] as const;

/**
 * Sélecteur d'organisations du Dashboard Client (§06.06 §2) : 3 filtres en
 * ligne « Traiteur / Agence / Gestionnaire de lieux » (listes à cocher, DS §10
 * règle 7, décision Val 2026-09-30), posés dans la barre du dashboard après
 * « Période ». Recherche dans chaque liste au-delà de 7 organisations.
 * Composant de filtrage, aucune écriture.
 */
export function OrganisationSelector({
  organisations,
  selected,
  onChange,
}: OrganisationSelectorProps) {
  const typeParId = useMemo(
    () => new Map(organisations.map((o) => [o.id, o.type])),
    [organisations],
  );
  const optionsParType = useMemo(() => {
    const parType = new Map<string, OptionFiltre[]>();
    const tries = [...organisations].sort((a, b) =>
      orgLabel(a).localeCompare(orgLabel(b)),
    );
    for (const o of tries) {
      const liste = parType.get(o.type) ?? [];
      liste.push({ id: o.id, nom: orgLabel(o) });
      parType.set(o.type, liste);
    }
    return parType;
  }, [organisations]);

  // Toutes les organisations cochées = « Toutes les organisations » (vide).
  function changer(ids: string[]): void {
    const toutes =
      organisations.length > 0 &&
      organisations.every((o) => ids.includes(o.id));
    onChange(toutes ? [] : ids);
  }

  return (
    <>
      {FILTRES.map(({ type, titre, tous, aucun }) => {
        const idsType = (optionsParType.get(type) ?? []).map((o) => o.id);
        const autres = selected.filter((id) => typeParId.get(id) !== type);
        return (
          <FiltreCoches
            key={type}
            label={titre}
            testid={`org-filtre-${type}`}
            options={optionsParType.get(type) ?? []}
            selected={selected.filter((id) => typeParId.get(id) === type)}
            libelleVide={selected.length === 0 ? tous : aucun}
            libelleTous={tous}
            // « Tous » d'un type : coché sans aucune sélection (toutes les
            // organisations) ou quand toutes celles du type sont cochées ;
            // le cocher ajoute tout le type à la sélection des autres types.
            tous={{
              coche:
                selected.length === 0 ||
                (idsType.length > 0 &&
                  idsType.every((id) => selected.includes(id))),
              onSelect: () =>
                changer(autres.length === 0 ? [] : [...autres, ...idsType]),
            }}
            onChange={(ids) => changer([...autres, ...ids])}
          />
        );
      })}
    </>
  );
}

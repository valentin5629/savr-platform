'use client';

import { useEffect, useState } from 'react';

/**
 * Délai unique des saisies qui déclenchent une recherche serveur (R-UI-7, J5) :
 * champ loupe des listes (`FiltreRecherche`), autocomplétions (adresse, SIRET),
 * recherche de lieu et de contact du formulaire de programmation.
 */
export const DELAI_DEBOUNCE_MS = 300;

/** Valeur stabilisée : ne change qu'après `delai` ms sans nouvelle saisie. */
export function useDebounce<T>(
  valeur: T,
  delai: number = DELAI_DEBOUNCE_MS,
): T {
  const [stable, setStable] = useState(valeur);
  useEffect(() => {
    const minuteur = setTimeout(() => setStable(valeur), delai);
    return () => clearTimeout(minuteur);
  }, [valeur, delai]);
  return stable;
}

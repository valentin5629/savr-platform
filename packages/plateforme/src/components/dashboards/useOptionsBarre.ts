'use client';

import { useEffect, useState } from 'react';
import type { ParcFilterOptions } from './ParcMultiSelects.js';
import { optionsBarreValides } from './filtres-query.js';

/**
 * Options de la barre de filtres d'un dashboard, lues à `url` (relues quand
 * l'URL change : Admin, selon les organisations choisies). `undefined` tant que
 * rien n'est arrivé (la barre montre la Période seule) ; listes vides si la
 * route échoue (la barre retire alors les valeurs mémorisées). Une réponse
 * arrivée après un changement d'URL est ignorée.
 */
export function useOptionsBarre(url: string): ParcFilterOptions | undefined {
  const [options, setOptions] = useState<ParcFilterOptions | undefined>(
    undefined,
  );
  useEffect(() => {
    let perimee = false;
    fetch(url, { credentials: 'include' })
      .then((r) => r.json())
      .then((j: { data?: unknown }) => {
        if (!perimee) setOptions(optionsBarreValides(j.data));
      })
      .catch(() => {
        if (!perimee) setOptions(optionsBarreValides(undefined));
      });
    return () => {
      perimee = true;
    };
  }, [url]);
  return options;
}

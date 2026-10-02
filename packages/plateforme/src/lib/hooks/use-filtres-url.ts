'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';

// useFiltresUrl — état des filtres d'une liste, miroir dans l'URL (R-UI-4a,
// D6). Avant : aucun hook, 5 façons de faire, 7 écrans perdaient leurs
// filtres au rechargement.
//
// Principe : l'état React est la source de vérité ; il est initialisé depuis
// l'URL au montage et recopié dans l'URL (`history.replaceState`, sans
// rechargement ni aller-retour serveur) à chaque changement. Une valeur égale
// à son défaut n'apparaît pas dans l'URL. Convention de liste UNIQUE : CSV
// (`types=a,b`), la même que les routes API (`lib/filtre-csv`).
//
// Deux familles de champs :
//  - filtres : comptés dans `actif`, remis au défaut par `reset()` ;
//  - navigation (`page`, `tri`, `ordre`…) : hors `actif`, conservés par
//    `reset()` sauf `page` qui revient à 1. Tout changement de filtre remet
//    aussi `page` à 1 (retour page 1 systématique, cf. E3).

type ChampTexte = { type: 'texte'; defaut: string; navigation?: boolean };
type ChampListe = { type: 'liste'; defaut?: string[]; navigation?: boolean };
type ChampEntier = {
  type: 'entier';
  defaut: number;
  /** Borne basse (ex. `page` ≥ 1) : une valeur d'URL en dessous est ramenée au défaut. */
  min?: number;
  navigation?: boolean;
};
export type ChampFiltre = ChampTexte | ChampListe | ChampEntier;
export type SchemaFiltres = Record<string, ChampFiltre>;

export type ValeursFiltres<S extends SchemaFiltres> = {
  [K in keyof S]: S[K] extends ChampTexte
    ? string
    : S[K] extends ChampListe
      ? string[]
      : number;
};

export const texte = (defaut = ''): ChampTexte => ({ type: 'texte', defaut });
export const liste = (defaut: string[] = []): ChampListe => ({
  type: 'liste',
  defaut,
});
export const entier = (defaut: number, min?: number): ChampEntier => ({
  type: 'entier',
  defaut,
  min,
});
/** Champ de navigation (page, tri, ordre) : hors `actif`, conservé au reset. */
export const navigation = <C extends ChampFiltre>(champ: C): C => ({
  ...champ,
  navigation: true,
});

function defautDe(champ: ChampFiltre): string | string[] | number {
  if (champ.type === 'liste') return champ.defaut ?? [];
  return champ.defaut;
}

function lire<S extends SchemaFiltres>(
  schema: S,
  params: URLSearchParams,
): ValeursFiltres<S> {
  const out: Record<string, unknown> = {};
  for (const [cle, champ] of Object.entries(schema)) {
    const brut = params.get(cle);
    if (brut === null) {
      out[cle] = defautDe(champ);
    } else if (champ.type === 'liste') {
      out[cle] = brut
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    } else if (champ.type === 'entier') {
      const n = parseInt(brut, 10);
      out[cle] =
        Number.isFinite(n) && (champ.min === undefined || n >= champ.min)
          ? n
          : champ.defaut;
    } else {
      out[cle] = brut;
    }
  }
  return out as ValeursFiltres<S>;
}

function egalDefaut(champ: ChampFiltre, valeur: unknown): boolean {
  const defaut = defautDe(champ);
  if (Array.isArray(defaut)) {
    const v = valeur as string[];
    return v.length === defaut.length && v.every((x, i) => x === defaut[i]);
  }
  return valeur === defaut;
}

function ecrire<S extends SchemaFiltres>(
  schema: S,
  valeurs: ValeursFiltres<S>,
  base: URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const [cle, champ] of Object.entries(schema)) {
    const v = valeurs[cle];
    if (egalDefaut(champ, v)) params.delete(cle);
    else params.set(cle, Array.isArray(v) ? v.join(',') : String(v));
  }
  return params;
}

export interface FiltresUrl<S extends SchemaFiltres> {
  valeurs: ValeursFiltres<S>;
  /** Fusionne ; tout changement hors `page` remet `page` à 1 (si le schéma en a une). */
  set: (patch: Partial<ValeursFiltres<S>>) => void;
  /** Remet les filtres (hors navigation) au défaut, `page` à 1. */
  reset: () => void;
  /** Au moins un filtre (hors navigation) hors de son défaut. */
  actif: boolean;
}

export function useFiltresUrl<S extends SchemaFiltres>(
  schema: S,
): FiltresUrl<S> {
  // `useSearchParams` est nul hors App Router (tests sans contexte) : on part
  // alors des défauts (pas de lecture de `window.location`, dont l'URL survit
  // d'un test à l'autre).
  const searchParams = useSearchParams();
  const initiaux = React.useMemo(
    () => lire(schema, searchParams ?? new URLSearchParams()),
    // Lecture au montage seulement : l'état React fait foi ensuite.
    [],
  );
  const [valeurs, setValeurs] = React.useState<ValeursFiltres<S>>(initiaux);
  const premierRendu = React.useRef(true);

  React.useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false;
      return;
    }
    if (typeof window === 'undefined') return;
    const params = ecrire(
      schema,
      valeurs,
      new URLSearchParams(window.location.search),
    );
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    // `null`, jamais `window.history.state` : Next.js (App Router) ignore un
    // `replaceState` dont l'état porte déjà `__NA` et ne resynchroniserait pas
    // `useSearchParams` ; avec `null` il recopie son état interne et met à jour
    // ses hooks, sans aller-retour serveur.
    window.history.replaceState(null, '', url);
    // `schema` est une constante de module chez les appelants.
  }, [valeurs]);

  const set = React.useCallback(
    (patch: Partial<ValeursFiltres<S>>) => {
      setValeurs((prev) => {
        const next = { ...prev, ...patch } as ValeursFiltres<S>;
        if ('page' in schema && !('page' in patch)) {
          (next as Record<string, unknown>).page = 1;
        }
        return next;
      });
    },
    [schema],
  );

  const reset = React.useCallback(() => {
    setValeurs((prev) => {
      const next = { ...prev } as Record<string, unknown>;
      for (const [cle, champ] of Object.entries(schema)) {
        if (!champ.navigation || cle === 'page') next[cle] = defautDe(champ);
      }
      return next as ValeursFiltres<S>;
    });
  }, [schema]);

  const actif = Object.entries(schema).some(
    ([cle, champ]) => !champ.navigation && !egalDefaut(champ, valeurs[cle]),
  );

  return { valeurs, set, reset, actif };
}

'use client';

import * as React from 'react';

// useListePaginee — chargement d'une liste paginée côté serveur (R-UI-4a, E3).
// Avant : page, total, chargement, garde anti-réponse périmée (`derniereRequete`
// ×7, `generation` ×4, `cancelled` ×2) et état d'erreur recodés dans 9 pages,
// dont une sans aucune garde et aucune ne gérant l'erreur.
//
// L'appelant construit l'URL (filtres + `page` + `tri`/`ordre`, cf.
// `useFiltresUrl`) ; le hook recharge à chaque changement d'URL, ignore toute
// réponse plus ancienne que la dernière demande, expose `erreur` + `recharger`
// (état Error §10 §7, distinct de la liste vide). `url` nul = pas d'appel.

export interface ReponseListe<T> {
  data: T[];
  total: number;
}

export interface ListePaginee<T> {
  data: T[];
  total: number;
  loading: boolean;
  erreur: string | null;
  /** Relance la dernière requête (bouton « Réessayer », après une mutation). */
  recharger: () => void;
}

export const ERREUR_LISTE = 'Le chargement de la liste a échoué.';

export function useListePaginee<T>(
  url: string | null,
  options?: {
    /** Extraction de `{ data, total }` depuis le JSON (défaut : tel quel). */
    extraire?: (json: unknown) => ReponseListe<T>;
    /** Options `fetch` (en-têtes…). */
    init?: RequestInit;
    /** Message de l'état Error (défaut `ERREUR_LISTE`). */
    messageErreur?: string;
  },
): ListePaginee<T> {
  const [data, setData] = React.useState<T[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(url !== null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [tentative, setTentative] = React.useState(0);
  const derniereRequete = React.useRef(0);
  const extraire = options?.extraire;
  const init = options?.init;
  const messageErreur = options?.messageErreur ?? ERREUR_LISTE;

  React.useEffect(() => {
    if (url === null) return;
    const numero = ++derniereRequete.current;
    setLoading(true);
    setErreur(null);
    void (async () => {
      try {
        const res = await fetch(url, init);
        if (!res.ok) throw new Error(String(res.status));
        const json: unknown = await res.json();
        if (numero !== derniereRequete.current) return;
        const r = extraire
          ? extraire(json)
          : (json as Partial<ReponseListe<T>>);
        setData(r.data ?? []);
        setTotal(r.total ?? r.data?.length ?? 0);
      } catch {
        if (numero !== derniereRequete.current) return;
        setErreur(messageErreur);
      } finally {
        if (numero === derniereRequete.current) setLoading(false);
      }
    })();
    return () => {
      // Une requête dépassée ne doit plus écrire : on avance le compteur.
      if (numero === derniereRequete.current) derniereRequete.current++;
    };
    // `extraire` / `init` / `messageErreur` : constantes chez les appelants.
  }, [url, tentative]);

  const recharger = React.useCallback(() => setTentative((t) => t + 1), []);

  return { data, total, loading, erreur, recharger };
}

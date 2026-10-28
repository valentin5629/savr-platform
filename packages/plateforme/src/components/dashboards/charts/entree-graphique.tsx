'use client';

import * as React from 'react';

// Entrée des graphiques des dashboards (Val 2026-10-28) : chaque graphique se
// construit une seule fois par ouverture de page, quand il apparaît à l'écran.
// Un rechargement des données (filtre, période) ne rejoue pas l'animation.
// Hors <EntreeGraphiques> (fiches, modales), aucun graphique ne s'anime.
//
// Le graphique pose `classe` et `ref` sur un conteneur, et `data-entree` sur
// les éléments animés (keyframes dans globals.css). `--entree-delai` décale un
// élément dans une série (barres l'une après l'autre).

const GraphiquesDejaAnimes = React.createContext<Set<string> | null>(null);

export function EntreeGraphiques({ children }: { children: React.ReactNode }) {
  const [dejaAnimes] = React.useState(() => new Set<string>());
  return (
    <GraphiquesDejaAnimes.Provider value={dejaAnimes}>
      {children}
    </GraphiquesDejaAnimes.Provider>
  );
}

// --transition-duration-savr-chart (600 ms) + décalage maximal d'une série.
const DUREE_MS = 600;
const DECALAGE_MAX_MS = 240;

type Etat = 'aucune' | 'attente' | 'en_cours';

/**
 * `cle` identifie le graphique dans la page : un graphique déjà animé ne
 * s'anime plus, même démonté puis remonté par un rechargement des données.
 */
export function useEntreeGraphique<T extends Element>(cle: string) {
  const dejaAnimes = React.useContext(GraphiquesDejaAnimes);
  // Ref par callback : le conteneur peut n'apparaître qu'après un chargement
  // ou un état vide ; l'observation commence quand il existe.
  const [el, ref] = React.useState<T | null>(null);
  const [etat, setEtat] = React.useState<Etat>(() =>
    dejaAnimes && !dejaAnimes.has(cle) ? 'attente' : 'aucune',
  );

  React.useEffect(() => {
    if (etat !== 'attente' || !el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setEtat('aucune');
      return;
    }
    const observateur = new IntersectionObserver(
      (entrees) => {
        if (!entrees.some((e) => e.isIntersecting)) return;
        observateur.disconnect();
        dejaAnimes?.add(cle);
        setEtat('en_cours');
      },
      { threshold: 0.25 },
    );
    observateur.observe(el);
    return () => observateur.disconnect();
  }, [etat, el, cle, dejaAnimes]);

  // Animation finie : la classe est retirée, les données qui changent ensuite
  // s'affichent sans rejouer l'entrée.
  React.useEffect(() => {
    if (etat !== 'en_cours') return;
    const minuteur = setTimeout(
      () => setEtat('aucune'),
      DUREE_MS + DECALAGE_MAX_MS + 100,
    );
    return () => clearTimeout(minuteur);
  }, [etat]);

  const classe =
    etat === 'attente'
      ? 'savr-entree savr-entree--attente'
      : etat === 'en_cours'
        ? 'savr-entree'
        : undefined;
  return { ref, classe, actif: classe !== undefined, phase: etat };
}

export type PhaseEntree = Etat;

function mouvementReduit(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Chiffre qui monte de 0 à `cible` pendant l'entrée du graphique (même durée
 * que les barres). En attente il vaut 0 ; hors entrée, ou si le système
 * demande moins d'animations, il vaut directement `cible`.
 */
export function useCompteur(cible: number, phase: PhaseEntree): number {
  const [anime, setAnime] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (phase !== 'en_cours' || mouvementReduit()) return;
    let image = 0;
    const debut = performance.now();
    const pas = (t: number) => {
      const k = Math.min(1, (t - debut) / DUREE_MS);
      // Démarre vite, ralentit à l'arrivée (ease-out cubique).
      setAnime(cible * (1 - (1 - k) ** 3));
      if (k < 1) image = requestAnimationFrame(pas);
      else setAnime(null);
    };
    image = requestAnimationFrame(pas);
    return () => {
      cancelAnimationFrame(image);
      setAnime(null);
    };
  }, [cible, phase]);

  if (phase === 'attente' && !mouvementReduit()) return 0;
  return anime ?? cible;
}

/** Décalage de l'élément `i` sur `n` : la série entière tient en 240 ms. */
export function delaiEntree(i: number, n: number): React.CSSProperties {
  const pas = n > 1 ? DECALAGE_MAX_MS / (n - 1) : 0;
  return {
    '--entree-delai': `${Math.round(i * pas)}ms`,
  } as React.CSSProperties;
}

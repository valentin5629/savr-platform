'use client';

import * as React from 'react';

// Emplacement du titre de page dans la barre du haut (Val 2026-11-03). Le cadre
// de l'application fournit l'élément ; `PageHero` y place son titre. Hors du
// cadre (page publique, test d'une page seule), la valeur reste `undefined` et
// `PageHero` garde son bandeau dans la page.
const BarreTitreContext = React.createContext<HTMLElement | null | undefined>(
  undefined,
);

const BarreTitreProvider = BarreTitreContext.Provider;

function useBarreTitre(): HTMLElement | null | undefined {
  return React.useContext(BarreTitreContext);
}

export { BarreTitreProvider, useBarreTitre };

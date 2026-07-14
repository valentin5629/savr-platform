'use client';

import * as React from 'react';

/**
 * Contexte de teinte du logo Savr.
 *
 * Le logo de la plateforme est orange par défaut et passe au vert dès qu'une
 * partie « Zéro Déchet » (ZD) est sélectionnée. Deux signaux l'alimentent :
 *   1. la navigation (route intrinsèquement ZD — cf. {@link isZdSectionPath}),
 *      résolue directement dans la Sidebar via `usePathname` ;
 *   2. la sélection dans un formulaire (ex : type de collecte ZD coché), qui
 *      remonte ici via {@link useSignalZdSelection}.
 *
 * Le Provider est posé dans `AppShell`, qui enveloppe à la fois la Sidebar
 * (consommatrice) et le contenu de page (émetteur) — ce qui permet à un
 * formulaire enfoui dans l'arbre de teinter le logo sans prop-drilling.
 */
interface LogoZdContextValue {
  /** Vrai tant qu'une partie ZD est sélectionnée dans la page courante. */
  zdSelected: boolean;
  setZdSelected: (value: boolean) => void;
}

const NOOP: LogoZdContextValue = {
  zdSelected: false,
  setZdSelected: () => {},
};

const LogoZdContext = React.createContext<LogoZdContextValue | null>(null);

export function LogoZdProvider({ children }: { children: React.ReactNode }) {
  const [zdSelected, setZdSelected] = React.useState(false);
  const value = React.useMemo(
    () => ({ zdSelected, setZdSelected }),
    [zdSelected],
  );
  return (
    <LogoZdContext.Provider value={value}>{children}</LogoZdContext.Provider>
  );
}

/**
 * Lit l'état de teinte ZD du logo. Renvoie un no-op stable si aucun Provider
 * n'est présent (ex : composant monté hors `AppShell` dans un test).
 */
export function useLogoZd(): LogoZdContextValue {
  return React.useContext(LogoZdContext) ?? NOOP;
}

/**
 * Signale que le logo doit passer au vert tant que `active` est vrai (ex : type
 * de collecte ZD coché). Repasse à l'orange au démontage — donc en quittant le
 * formulaire ou en désélectionnant le ZD.
 */
export function useSignalZdSelection(active: boolean): void {
  const { setZdSelected } = useLogoZd();
  React.useEffect(() => {
    setZdSelected(active);
    return () => setZdSelected(false);
  }, [active, setZdSelected]);
}

/**
 * Sections dont l'URL est intrinsèquement ZD → logo vert par navigation.
 * V1 : le Registre réglementaire est ZD-only (§06.03). À étendre ici si de
 * nouvelles sections purement ZD apparaissent.
 */
export function isZdSectionPath(pathname: string): boolean {
  return pathname === '/registre' || pathname.startsWith('/registre/');
}

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { initiales } from '@/components/dashboards/charts/cockpit/fmt';
import type { IdentiteSession } from '@/lib/identite-session';

/**
 * Identité de la session, posée par l'AppShell pour le bandeau de page (logo de
 * l'organisation en haut à droite, Val 2026-11-01). `null` hors AppShell.
 */
const IdentiteContext = React.createContext<IdentiteSession | null>(null);

const IdentiteProvider = IdentiteContext.Provider;

function useIdentiteSession(): IdentiteSession | null {
  return React.useContext(IdentiteContext);
}

// Logo de l'organisation sur une tuile blanche, ENTIER (object-contain, jamais
// rogné) ; initiales si l'organisation n'a pas de logo ou s'il ne charge pas.
// Le nom de l'organisation est donné au survol et aux lecteurs d'écran.
function LogoOrganisation({
  identite,
  className,
}: {
  identite: IdentiteSession;
  className?: string;
}) {
  const [logoKo, setLogoKo] = React.useState(false);
  const logo = identite.logoSrc && !logoKo ? identite.logoSrc : null;
  const nom = identite.organisation ?? identite.utilisateur;
  return (
    <span
      data-testid="logo-organisation"
      role="img"
      aria-label={nom}
      title={nom}
      className={cn(
        // 40 px de haut : le bandeau garde sa hauteur (py-5 + 40 = 80 px).
        'flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-savr-md bg-savr-white p-1 text-sm font-semibold text-savr-primary-800',
        className,
      )}
    >
      {logo ? (
        <img
          src={logo}
          alt=""
          className="h-full w-full object-contain"
          onError={() => setLogoKo(true)}
        />
      ) : (
        <span aria-hidden="true">{initiales(nom)}</span>
      )}
    </span>
  );
}

export { IdentiteProvider, useIdentiteSession, LogoOrganisation };

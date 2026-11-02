'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  LogoOrganisation,
  useIdentiteSession,
} from '@/components/layout/logo-organisation';

// PageHero — bandeau pâle d'en-tête de toute page (décisions Val 2026-11-01 :
// variante B2, qui remplace l'aplat primary-700, puis aucun texte sous le
// titre). Fond primary-100, titre Archivo 800 tracking serré (-0.02em, levier
// #7) en primary-800, icône primary-700, actions à droite (bouton principal
// `accent`, badges de statut). Le bandeau porte le <h1> de la page (un seul).
interface PageHeroProps {
  title: React.ReactNode;
  /** Contenu à gauche du titre (icône, bouton retour…), teinté primary-700. */
  icon?: React.ReactNode;
  /** Actions alignées à droite (CTA, badges de statut). */
  actions?: React.ReactNode;
  className?: string;
}

const PageHero = React.forwardRef<HTMLDivElement, PageHeroProps>(
  ({ title, icon, actions, className }, ref) => {
    // Logo de l'organisation en haut à droite, après les actions (Val
    // 2026-11-01) : espaces clients seulement, absent hors AppShell.
    const identite = useIdentiteSession();
    // Organisation illisible : pas de tuile (jamais les initiales de l'email).
    const logo =
      identite?.logoAffichable && identite.organisation ? identite : null;
    return (
      <header
        ref={ref}
        className={cn(
          // Hauteur minimale = bandeau avec un bouton (py-5 + bouton md 44 px
          // mobile / 40 px desktop) : tous les bandeaux ont la même hauteur, avec
          // ou sans action (Val 2026-11-01).
          'flex min-h-21 flex-wrap items-center gap-x-4 gap-y-3 rounded-savr-md bg-savr-primary-100 px-6 py-5 text-savr-primary-800 sm:min-h-20',
          className,
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          {/* shrink-0 : l'icône ne s'écrase pas quand le titre passe à la ligne. */}
          {icon && (
            <span className="flex shrink-0 text-savr-primary-700">{icon}</span>
          )}
          <h1 className="min-w-0 text-2xl font-extrabold tracking-[-0.02em] break-words text-savr-primary-800 sm:truncate">
            {title}
          </h1>
        </div>
        {(actions || logo) && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {actions}
            {logo && <LogoOrganisation identite={logo} className="ml-2" />}
          </div>
        )}
      </header>
    );
  },
);
PageHero.displayName = 'PageHero';

export { PageHero };

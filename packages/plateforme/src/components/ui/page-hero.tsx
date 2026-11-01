'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// PageHero — bandeau pâle d'en-tête d'écran (décision Val 2026-11-01, variante
// B2 : remplace l'aplat primary-700). Fond primary-100, titre Archivo 800
// tracking serré (-0.02em, levier #7) en primary-800, sous-titre neutral-600,
// icône primary-700, actions à droite (bouton principal `accent`). Porté par
// chaque écran du menu ; le bandeau porte le <h1> de la page (un seul par écran).
interface PageHeroProps {
  title: React.ReactNode;
  /** Ligne secondaire (compteur, méta) — rendue en neutral-600. */
  subtitle?: React.ReactNode;
  /** Contenu à gauche du titre (icône, bouton retour…), teinté primary-700. */
  icon?: React.ReactNode;
  /** Actions alignées à droite (CTA, badges de statut). */
  actions?: React.ReactNode;
  className?: string;
}

const PageHero = React.forwardRef<HTMLDivElement, PageHeroProps>(
  ({ title, subtitle, icon, actions, className }, ref) => (
    <header
      ref={ref}
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-3 rounded-savr-md bg-savr-primary-100 px-6 py-5 text-savr-primary-800',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* shrink-0 : l'icône ne s'écrase pas quand le sous-titre passe à la ligne. */}
        {icon && (
          <span className="flex shrink-0 text-savr-primary-700">{icon}</span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-[-0.02em] break-words text-savr-primary-800 sm:truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 text-sm text-savr-neutral-600">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  ),
);
PageHero.displayName = 'PageHero';

export { PageHero };

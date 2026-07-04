'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// PageHero — bandeau d'écran (levier #2 Design System §10 : « aplat primary-700,
// texte blanc »). Titre Nunito 800 tracking serré (-0.02em, levier #7), sous-titre
// primary-200, slot d'actions aligné à droite. Le bandeau porte le <h1> de la page
// (un seul par écran).
interface PageHeroProps {
  title: string;
  /** Ligne secondaire (compteur, méta) — rendue en primary-200. */
  subtitle?: React.ReactNode;
  /** Contenu à gauche du titre (icône, bouton retour…). Non teinté par le hero. */
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
        'flex flex-wrap items-center gap-x-4 gap-y-3 rounded-savr-md bg-savr-primary-700 px-6 py-5 text-savr-white shadow-savr-sm',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold tracking-[-0.02em] text-savr-white">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 text-sm text-savr-primary-200">{subtitle}</p>
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

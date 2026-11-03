'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useBarreTitre } from '@/components/layout/barre-titre-context';

// PageHero — titre de toute page. Dans le cadre de l'application, le titre et
// son icône vont dans la barre bleu ciel du haut (Val 2026-11-03) : plus de
// bandeau dans la page, les actions éventuelles restent en tête du contenu,
// alignées à droite. Hors du cadre, bandeau pâle d'avant (Val 2026-11-01) :
// fond primary-100, titre Archivo 800 tracking serré (-0.02em) en primary-800,
// icône primary-700, actions à droite. Un seul <h1> par page.
interface PageHeroProps {
  title: React.ReactNode;
  /** Contenu à gauche du titre (icône, bouton retour…), teinté primary-700. */
  icon?: React.ReactNode;
  /** Actions alignées à droite (CTA, badges de statut). */
  actions?: React.ReactNode;
  className?: string;
}

function Titre({
  title,
  icon,
  className,
}: Pick<PageHeroProps, 'title' | 'icon'> & { className: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {/* shrink-0 : l'icône ne s'écrase pas quand le titre passe à la ligne. */}
      {icon && (
        <span className="flex shrink-0 text-savr-primary-700">{icon}</span>
      )}
      <h1
        className={cn(
          'min-w-0 font-extrabold tracking-[-0.02em] text-savr-primary-800',
          className,
        )}
      >
        {title}
      </h1>
    </div>
  );
}

const PageHero = React.forwardRef<HTMLDivElement, PageHeroProps>(
  ({ title, icon, actions, className }, ref) => {
    const barre = useBarreTitre();

    // Dans le cadre : titre dans la barre du haut. Avant que la barre soit
    // montée (premier rendu serveur), le titre reste lisible par les lecteurs
    // d'écran, sans s'afficher.
    if (barre !== undefined) {
      return (
        <>
          {barre ? (
            createPortal(
              <Titre title={title} icon={icon} className="truncate text-xl" />,
              barre,
            )
          ) : (
            <h1 className="sr-only">{title}</h1>
          )}
          {actions && (
            <div
              ref={ref}
              data-testid="actions-page"
              className={cn(
                'flex flex-wrap items-center justify-end gap-2',
                className,
              )}
            >
              {actions}
            </div>
          )}
        </>
      );
    }

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
        <Titre
          title={title}
          icon={icon}
          className="text-2xl break-words sm:truncate"
        />
        {actions && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </header>
    );
  },
);
PageHero.displayName = 'PageHero';

export { PageHero };

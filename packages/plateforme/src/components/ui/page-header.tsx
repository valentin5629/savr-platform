'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Heading, type HeadingSize, type HeadingTone } from './heading';
import { Text } from './text';

// PageHeader — en-tête d'écran sobre (R-UI-6b, I1) : titre h1 + description
// optionnelle, icône à gauche, actions à droite. Alternative au bandeau navy
// `PageHero` pour les écrans non-liste (dashboards, profil, paramètres) ; le
// choix « PageHero partout ou PageHeader » = arbitrage Q3, ouvert : ce
// composant reproduit les recettes actuelles (`text-2xl font-bold
// text-savr-primary-800` ×23, `…neutral-900` ×8) sans en changer le rendu.
interface PageHeaderProps {
  title: React.ReactNode;
  /** Ligne secondaire sous le titre (recette `text-sm text-savr-neutral-500`). */
  description?: React.ReactNode;
  /** Icône ou bouton retour à gauche du titre. */
  icon?: React.ReactNode;
  /** Actions alignées à droite (CTA, badges). */
  actions?: React.ReactNode;
  /** Couleur du titre : `primary` (espaces client) ou `neutral` (Admin). */
  tone?: Extract<HeadingTone, 'primary' | 'neutral'>;
  size?: Extract<HeadingSize, 'xl' | '2xl'>;
  weight?: 'semibold' | 'bold';
  className?: string;
}

const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  (
    {
      title,
      description,
      icon,
      actions,
      tone = 'primary',
      size = '2xl',
      weight = 'bold',
      className,
    },
    ref,
  ) => (
    <header
      ref={ref}
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-3',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <Heading level={1} tone={tone} size={size} weight={weight}>
            {title}
          </Heading>
          {description && <Text variant="muted">{description}</Text>}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  ),
);
PageHeader.displayName = 'PageHeader';

export { PageHeader };

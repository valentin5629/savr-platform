import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/lib/routes';

// Liens « Mentions légales · Confidentialité », discrets (Val 2026-11-16) :
// petit texte gris, sur une ligne, en bas des écrans d'authentification et de
// l'onglet « Mon profil ». Le minimum légal (LCEN art. 6-III, RGPD art. 12-13)
// est un accès facile, pas un affichage visible : plus d'entrée dans le menu
// du compte. `nouvelOnglet` : depuis l'app, on ne quitte pas l'écran en cours.
export function LiensLegaux({
  className,
  nouvelOnglet = false,
}: {
  className?: string;
  nouvelOnglet?: boolean;
}) {
  const cible = nouvelOnglet
    ? ({ target: '_blank', rel: 'noopener' } as const)
    : {};
  // `neutral-600` : contraste AA (DS §10) même sur le dégradé des écrans
  // d'auth. `-my-3 py-3` : zone tactile 44 px sans décaler la ligne (même
  // recette que `TextLink touch`).
  const lien =
    'inline-block -my-3 py-3 underline-offset-4 hover:text-savr-neutral-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500';
  return (
    <p className={cn('text-xs text-savr-neutral-600', className)}>
      <Link href={ROUTES.mentionsLegales} className={lien} {...cible}>
        Mentions légales
      </Link>
      <span aria-hidden="true"> · </span>
      <Link href={ROUTES.confidentialite} className={lien} {...cible}>
        Confidentialité
      </Link>
    </p>
  );
}

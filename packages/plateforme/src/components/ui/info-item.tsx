import * as React from 'react';
import { cn } from '@/lib/utils';
import { textClasses } from '@/components/ui/text';

// InfoItem — paire libellé / valeur en lecture seule (R-UI-5, F5 ; ex-`InfoItem`
// de `collecte/fiche-blocs`, `Champ` de gestionnaire/lieux/[id], `Field` de
// registre/[id] et les `<dt>`/`<dd>` écrits à la main des fiches). Rendu
// `<div><dt/><dd/></div>` : à placer dans un `<dl>` (le `<div>` de groupe est
// autorisé par HTML), qui porte la grille et la taille de texte.
//
// Les variantes = recettes relevées dans le code (iso-rendu, aucune n'est
// redessinée) :
//   - `default` : libellé gris, valeur medium (fiches collecte, client, admin) ;
//   - `texte`   : libellé gris, valeur en paragraphe (présentation, consignes) ;
//   - `hint`    : libellé xs gris, valeur au ton du conteneur (camions) ;
//   - `overline`: libellé en sur-titre majuscules, valeur neutral-900 en ligne
//                 (badges, puces) — fiche lieu gestionnaire ;
//   - `caps`    : libellé xs majuscules sans graisse, valeur sm — registre.
export type InfoItemVariant =
  | 'default'
  | 'texte'
  | 'hint'
  | 'overline'
  | 'caps';

const LIBELLE: Record<InfoItemVariant, string> = {
  default: 'text-savr-neutral-500',
  texte: 'text-savr-neutral-500',
  hint: textClasses({ variant: 'hint' }),
  overline: textClasses({ variant: 'overline' }),
  caps: 'text-xs uppercase text-savr-neutral-500',
};
const VALEUR: Record<InfoItemVariant, string> = {
  default: 'font-medium',
  texte: 'leading-relaxed text-savr-neutral-700',
  hint: '',
  overline: 'mt-0.5 flex flex-wrap items-center gap-1 text-savr-neutral-900',
  caps: 'text-sm',
};

export interface InfoItemProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'children'
> {
  label: React.ReactNode;
  children: React.ReactNode;
  variant?: InfoItemVariant;
  /** Occupe les 2 colonnes d'une grille `sm:grid-cols-2` (dès `sm`). */
  pleineLargeur?: boolean;
  /** Classes ajoutées à la valeur (`<dd>`) : `mt-1`, `font-mono`, `flex …`. */
  valueClassName?: string;
}

export function InfoItem({
  label,
  children,
  variant = 'default',
  pleineLargeur = false,
  valueClassName,
  className,
  ...props
}: InfoItemProps) {
  return (
    <div
      className={cn(pleineLargeur && 'sm:col-span-2', className) || undefined}
      {...props}
    >
      <dt className={LIBELLE[variant]}>{label}</dt>
      <dd className={cn(VALEUR[variant], valueClassName) || undefined}>
        {children}
      </dd>
    </div>
  );
}

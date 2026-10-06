import * as React from 'react';
import { cn } from '@/lib/utils';

// Heading — titres h1/h2/h3 de l'app (R-UI-6b, I1/I2). Un seul endroit porte
// les recettes de taille / graisse / couleur relevées dans le code ; les
// valeurs par défaut sont les recettes majoritaires de chaque niveau, les
// autres recettes se déclarent par props (iso-rendu : rien n'est redessiné ;
// Q3 tranché b le 2026-10-06 : titre de page = PageHero (listes) ou PageHeader). Le letter-spacing
// serré des titres (-0.02em, levier #7) vient de la règle globale h1/h2/h3 de
// globals.css.
type HeadingLevel = 1 | 2 | 3;
export type HeadingSize = 'inherit' | 'sm' | 'base' | 'lg' | 'xl' | '2xl';
export type HeadingWeight = 'medium' | 'semibold' | 'bold' | 'extrabold';
export type HeadingTone =
  | 'inherit'
  | 'neutral' // neutral-900 (défaut)
  | 'strong' // neutral-800
  | 'muted' // neutral-700
  | 'faint' // neutral-500
  | 'primary' // primary-800 (titres d'écran des espaces client)
  | 'primary-deep' // primary-950
  | 'white';

const SIZE: Record<HeadingSize, string> = {
  inherit: '',
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
};
const WEIGHT: Record<HeadingWeight, string> = {
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
  extrabold: 'font-extrabold',
};
const TONE: Record<HeadingTone, string> = {
  inherit: '',
  neutral: 'text-savr-neutral-900',
  strong: 'text-savr-neutral-800',
  muted: 'text-savr-neutral-700',
  faint: 'text-savr-neutral-500',
  primary: 'text-savr-primary-800',
  'primary-deep': 'text-savr-primary-950',
  white: 'text-savr-white',
};
const DEFAULTS: Record<
  HeadingLevel,
  { size: HeadingSize; weight: HeadingWeight }
> = {
  1: { size: '2xl', weight: 'bold' },
  2: { size: 'lg', weight: 'semibold' },
  3: { size: 'base', weight: 'semibold' },
};

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  level: HeadingLevel;
  size?: HeadingSize;
  weight?: HeadingWeight;
  tone?: HeadingTone;
  /** Interlettrage serré explicite (`tracking-[-0.02em]`). */
  tight?: boolean;
  /** Majuscules espacées (sur-titre de section). */
  overline?: boolean;
}

/** Classes d'un titre pour un niveau et des options donnés (exportée pour PageHeader / tests). */
export function headingClasses({
  level,
  size,
  weight,
  tone = 'neutral',
  tight,
  overline,
}: Pick<
  HeadingProps,
  'level' | 'size' | 'weight' | 'tone' | 'tight' | 'overline'
>): string {
  const d = DEFAULTS[level];
  return cn(
    SIZE[size ?? d.size],
    WEIGHT[weight ?? d.weight],
    TONE[tone],
    tight && 'tracking-[-0.02em]',
    overline && 'uppercase tracking-wide',
  );
}

const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  (
    { level, size, weight, tone, tight, overline, className, ...props },
    ref,
  ) => {
    const Tag = `h${level}` as 'h1' | 'h2' | 'h3';
    return (
      <Tag
        ref={ref}
        className={cn(
          headingClasses({ level, size, weight, tone, tight, overline }),
          className,
        )}
        {...props}
      />
    );
  },
);
Heading.displayName = 'Heading';

export { Heading };

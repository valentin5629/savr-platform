import * as React from 'react';
import { cn } from '@/lib/utils';

// Text — texte courant de l'app (R-UI-6b, A6/A8/A9, arbitrage Q10 option (a)
// « composant »). Un seul endroit porte les recettes « taille + gris
// neutre » relevées dans le code (290 occurrences, 3 gris
// concurrents 400/500/600 pour le même rôle) et les tailles arbitraires 11 px /
// 13 px (arbitrage Q9 : centralisées telles quelles, pas arrondies).
// Les variantes = recettes majoritaires actuelles (iso-rendu) ; `size` / `tone`
// les surchargent pour les recettes minoritaires, en attendant l'arbitrage.
export type TextVariant = 'body' | 'muted' | 'hint' | 'faint' | 'overline';
export type TextSize = '3xs' | '2xs' | 'xs' | 'xs-plus' | 'sm' | 'base';
export type TextTone =
  | 'inherit'
  | 'faint' // neutral-400
  | 'muted' // neutral-500
  | 'soft' // neutral-600
  | 'body' // neutral-700
  | 'strong' // neutral-800
  | 'ink'; // neutral-900
type TextElement = 'p' | 'span' | 'div' | 'dt' | 'dd' | 'li';

const VARIANT: Record<TextVariant, { size: TextSize; tone: TextTone }> = {
  body: { size: 'sm', tone: 'body' },
  muted: { size: 'sm', tone: 'muted' }, // ×73 : text-sm text-savr-neutral-500
  hint: { size: 'xs', tone: 'muted' }, // ×53 : text-xs text-savr-neutral-500
  faint: { size: 'xs', tone: 'faint' }, // ×10 : text-xs text-savr-neutral-400
  overline: { size: 'xs', tone: 'muted' },
};
const SIZE: Record<TextSize, string> = {
  '3xs': 'text-[10px]',
  '2xs': 'text-[11px]',
  xs: 'text-xs',
  'xs-plus': 'text-[13px]',
  sm: 'text-sm',
  base: 'text-base',
};
const TONE: Record<TextTone, string> = {
  inherit: '',
  faint: 'text-savr-neutral-400',
  muted: 'text-savr-neutral-500',
  soft: 'text-savr-neutral-600',
  body: 'text-savr-neutral-700',
  strong: 'text-savr-neutral-800',
  ink: 'text-savr-neutral-900',
};

export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  as?: TextElement;
  variant?: TextVariant;
  size?: TextSize;
  tone?: TextTone;
}

/** Classes d'un texte courant (exportée pour les composants composés / tests). */
export function textClasses({
  variant = 'muted',
  size,
  tone,
}: Pick<TextProps, 'variant' | 'size' | 'tone'>): string {
  const v = VARIANT[variant];
  return cn(
    SIZE[size ?? v.size],
    TONE[tone ?? v.tone],
    variant === 'overline' && 'font-semibold uppercase tracking-wide',
  );
}

const Text = React.forwardRef<HTMLElement, TextProps>(
  ({ as = 'p', variant, size, tone, className, ...props }, ref) => {
    const Tag = as as React.ElementType;
    return (
      <Tag
        ref={ref}
        className={cn(textClasses({ variant, size, tone }), className)}
        {...props}
      />
    );
  },
);
Text.displayName = 'Text';

export { Text };

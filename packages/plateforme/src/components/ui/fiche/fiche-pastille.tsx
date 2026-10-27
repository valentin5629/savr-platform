import * as React from 'react';
import { cn } from '@/lib/utils';

// Pastille de statut du grand en-tête (variante B, décision Val 2026-10-27) :
// point de couleur + libellé, à droite du titre. Le ton suit l'avancement :
// sable (au départ / neutre), bleu, orange (en cours), vert (fait / actif),
// rouge (hors parcours : annulée, rejetée).
export type TonPastille = 'sable' | 'bleu' | 'orange' | 'vert' | 'rouge';

const TONS: Record<TonPastille, { fond: string; point: string }> = {
  sable: {
    fond: 'bg-savr-sable-100 text-savr-neutral-700',
    point: 'bg-savr-neutral-400',
  },
  bleu: {
    fond: 'bg-savr-primary-50 text-savr-primary-700',
    point: 'bg-savr-primary-700',
  },
  orange: {
    fond: 'bg-savr-accent-50 text-savr-accent-800',
    point: 'bg-savr-accent-500',
  },
  vert: {
    fond: 'bg-savr-success-subtle text-savr-success-strong',
    point: 'bg-savr-success',
  },
  rouge: {
    fond: 'bg-savr-error-subtle text-savr-error-strong',
    point: 'bg-savr-error',
  },
};

export function FichePastille({
  ton,
  children,
  className,
  ...props
}: { ton: TonPastille } & React.HTMLAttributes<HTMLSpanElement>) {
  const { fond, point } = TONS[ton];
  return (
    <span
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-2.5 rounded-savr-full px-4 text-sm font-semibold',
        fond,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 rounded-savr-full', point)}
      />
      {children}
    </span>
  );
}

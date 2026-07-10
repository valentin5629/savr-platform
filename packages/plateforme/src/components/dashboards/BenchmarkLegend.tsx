'use client';

import { Tooltip } from '@/components/ui/tooltip';

// Légende couleur des jauges benchmark (BL-P3-02) — rend visible à l'écran le
// barème documenté dans BenchmarkGauge (§06.05) : vert ≤100 %, orange 100-130 %,
// rouge >130 %, gris = benchmark masqué (k-anonymat < 5). Un tooltip explicite la
// lecture et la règle d'anonymat. Composant partagé traiteur/gestionnaire/agence.
const ITEMS: { color: string; label: string }[] = [
  { color: 'bg-green-500', label: '≤ 100 % du parc' },
  { color: 'bg-amber-500', label: '100–130 %' },
  { color: 'bg-red-500', label: '> 130 %' },
  { color: 'bg-savr-neutral-300', label: 'Données insuffisantes' },
];

const TOOLTIP_BENCHMARK =
  'Votre kg/pax est comparé au parc Savr sur le même segment (flux × type × taille). ' +
  'Vert : vous êtes au niveau ou sous la médiane du parc ; orange : légèrement au-dessus ; ' +
  'rouge : nettement au-dessus. Gris : benchmark masqué car moins de 5 organisations ' +
  'dans le segment (anonymat).';

export function BenchmarkLegend() {
  return (
    <div
      data-testid="benchmark-legende"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-savr-neutral-600"
    >
      {ITEMS.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${it.color}`}
            aria-hidden
          />
          {it.label}
        </span>
      ))}
      <Tooltip content={TOOLTIP_BENCHMARK}>
        <span
          role="note"
          tabIndex={0}
          aria-label={TOOLTIP_BENCHMARK}
          className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-savr-neutral-400 text-[10px] leading-none text-savr-neutral-500"
        >
          ?
        </span>
      </Tooltip>
    </div>
  );
}

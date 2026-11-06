import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/*
 * Échelles custom `savr-*` déclarées dans `@theme` (src/app/globals.css).
 * Sans cette déclaration, twMerge ne les reconnaît pas : `cn('rounded-savr-md',
 * 'rounded-savr-lg')` garde les deux classes et c'est l'ordre du CSS compilé qui
 * tranche (md gagne) — toute surcharge `className` sur un composant DS est inerte.
 * Les couleurs `*-savr-*` n'ont pas besoin d'être listées (le groupe couleur de
 * twMerge accepte toute valeur). Tenu en phase avec globals.css par
 * tests/lib/cn.test.ts.
 */
const SAVR_RADIUS = [
  'savr-sm',
  'savr-md',
  'savr-lg',
  'savr-xl',
  'savr-2xl',
  'savr-full',
];
const SAVR_SHADOW = ['savr-none', 'savr-sm', 'savr-md', 'savr-lg', 'savr-xl'];
const SAVR_DURATION = ['savr-fast', 'savr-base', 'savr-slow', 'savr-chart'];
const SAVR_CONTAINER = ['savr-content', 'savr-wide', 'savr-prose'];
// Tailles de texte ajoutées à l'échelle (§3.2, Val 2026-10-28). `3xs` et `md`
// sont déjà reconnues comme tailles par twMerge ; `kpi` serait prise pour une
// couleur et écraserait (ou serait écrasée par) un `text-savr-*`.
const SAVR_TEXT = ['3xs', 'md', 'kpi'];

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      borderRadius: SAVR_RADIUS,
    },
    classGroups: {
      'font-size': [{ text: SAVR_TEXT }],
      shadow: [{ shadow: SAVR_SHADOW }],
      // Tailwind 4 : --transition-duration-savr-* → duration-savr-* (R-UI-6a).
      duration: [{ duration: SAVR_DURATION }],
      // Tailwind 4 : les tokens --container-* alimentent max-w, w et min-w.
      'max-w': [{ 'max-w': SAVR_CONTAINER }],
      w: [{ w: SAVR_CONTAINER }],
      'min-w': [{ 'min-w': SAVR_CONTAINER }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

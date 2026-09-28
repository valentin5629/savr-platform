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
const SAVR_RADIUS = ['savr-sm', 'savr-md', 'savr-lg', 'savr-xl', 'savr-full'];
const SAVR_SHADOW = ['savr-none', 'savr-sm', 'savr-md', 'savr-lg'];
const SAVR_SPACING = [
  'savr-1',
  'savr-2',
  'savr-3',
  'savr-4',
  'savr-6',
  'savr-8',
  'savr-12',
  'savr-16',
];
const SAVR_CONTAINER = ['savr-content', 'savr-wide', 'savr-prose'];

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      borderRadius: SAVR_RADIUS,
      spacing: SAVR_SPACING,
    },
    classGroups: {
      shadow: [{ shadow: SAVR_SHADOW }],
      'max-w': [{ 'max-w': SAVR_CONTAINER }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

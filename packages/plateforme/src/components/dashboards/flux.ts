/**
 * Référentiel des 5 flux ZD (libellé + ordre + couleur) : source unique
 * `lib/libelles/flux.ts` (R-UI-2 C12), ré-exportée ici pour les dashboards.
 * Ce module ne garde que les couleurs des séries hors flux (courbes, AG).
 */
export { FLUX_ZD, FLUX_ZD_CODES, type FluxZd } from '@/lib/libelles/flux';

/** Couleur de la courbe « taux de recyclage » (axe secondaire Bloc 2 ZD) — DS §2.4. */
export const TAUX_RECYCLAGE_COLOR = 'var(--color-savr-dataviz-2)'; // accent-500 (série 2)

/** Bloc 2 AG — AG = orange, ligne ratio = navy (DS §2.4 « AG = orange, ZD = navy »). */
export const REPAS_COLOR = 'var(--color-savr-dataviz-2)'; // accent-500
export const RATIO_COLOR = 'var(--color-savr-dataviz-1)'; // primary-700

/**
 * Référentiel partagé des 5 flux ZD (§04 flux_dechets, liste fermée V1) +
 * palette de graphes (Bloc 2 barres empilées, Bloc 4 donut — §11 Dashboards).
 *
 * Source unique : évite les 4 copies inline de FLUX_ZD (traiteur / agence /
 * gestionnaire / dashboard-client) et fige la couleur par flux pour que barres,
 * donut et légendes restent cohérents entre les 3 rôles (« 1 dashboard, 3 contextes »).
 */
export interface FluxZd {
  code: string;
  label: string;
  /** Couleur figée du flux (barres empilées + donut). */
  color: string;
}

// Couleurs = palette data-viz figée du Design System §2.4 (catégoriel, dashboards),
// DÉRIVÉE des tokens `--color-savr-dataviz-1..6` de globals.css (R-UI-6a) :
// 1 navy · 2 orange · 3 navy-500 · 4 vert · 5 navy-400 · 6 orange-600.
// Pas de gris pur (§2.3). Ordre = empilement des barres (bas → haut) et parts du donut.
export const FLUX_ZD: FluxZd[] = [
  {
    code: 'biodechet',
    label: 'Biodéchets',
    color: 'var(--color-savr-dataviz-4)',
  },
  {
    code: 'emballage',
    label: 'Emballages',
    color: 'var(--color-savr-dataviz-3)',
  },
  { code: 'carton', label: 'Cartons', color: 'var(--color-savr-dataviz-6)' },
  { code: 'verre', label: 'Verre', color: 'var(--color-savr-dataviz-5)' },
  {
    code: 'dechet_residuel',
    label: 'Déchet résiduel',
    color: 'var(--color-savr-dataviz-1)',
  },
];

export const FLUX_ZD_CODES = FLUX_ZD.map((f) => f.code);

/** Couleur de la courbe « taux de recyclage » (axe secondaire Bloc 2 ZD) — DS §2.4. */
export const TAUX_RECYCLAGE_COLOR = 'var(--color-savr-dataviz-2)'; // accent-500 (série 2)

/** Bloc 2 AG — AG = orange, ligne ratio = navy (DS §2.4 « AG = orange, ZD = navy »). */
export const REPAS_COLOR = 'var(--color-savr-dataviz-2)'; // accent-500
export const RATIO_COLOR = 'var(--color-savr-dataviz-1)'; // primary-700

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

// Couleurs = palette data-viz figée du Design System §2.4 (catégoriel, dashboards).
// 6 couleurs de marque : #223870 · #FF9B00 · #3F5599 · #16A34A · #6379B6 · #D97F00.
// Pas de gris pur (§2.3). Ordre = empilement des barres (bas → haut) et parts du donut.
export const FLUX_ZD: FluxZd[] = [
  { code: 'biodechet', label: 'Biodéchets', color: '#16A34A' },
  { code: 'emballage', label: 'Emballages', color: '#3F5599' },
  { code: 'carton', label: 'Cartons', color: '#D97F00' },
  { code: 'verre', label: 'Verre', color: '#6379B6' },
  { code: 'dechet_residuel', label: 'Déchet résiduel', color: '#223870' },
];

export const FLUX_ZD_CODES = FLUX_ZD.map((f) => f.code);

/** Couleur de la courbe « taux de recyclage » (axe secondaire Bloc 2 ZD) — DS §2.4. */
export const TAUX_RECYCLAGE_COLOR = '#FF9B00'; // accent-500 (série 2)

/** Bloc 2 AG — AG = orange, ligne ratio = navy (DS §2.4 « AG = orange, ZD = navy »). */
export const REPAS_COLOR = '#FF9B00'; // accent-500
export const RATIO_COLOR = '#223870'; // primary-700

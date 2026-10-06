/**
 * Référentiel des 5 flux ZD V1 (§04 `flux_dechets`, liste fermée, seed figé) —
 * source unique (R-UI-2 C12) : code, libellé, ordre d'affichage et couleur de
 * graphe. Consommé par les dashboards, le registre (écran + CSV + API), la
 * synthèse PDF, la fiche collecte Admin et les loaders.
 *
 * Libellés = colonne `nom` du seed `flux_dechets` (§04 Data Model) : « Carton »
 * au singulier comme au CDC.
 */

export interface FluxZd {
  code: FluxZdCode;
  label: string;
  /** Couleur figée du flux (barres empilées + donut). */
  color: string;
}

/**
 * Ordre d'affichage des flux (= `flux_dechets.ordre_affichage`) : badges,
 * colonnes CSV, empilement des barres (bas → haut) et parts du donut.
 */
export const FLUX_ZD_CODES = [
  'biodechet',
  'emballage',
  'carton',
  'verre',
  'dechet_residuel',
] as const;

export type FluxZdCode = (typeof FLUX_ZD_CODES)[number];

export const LIBELLE_FLUX: Record<FluxZdCode, string> = {
  biodechet: 'Biodéchets',
  emballage: 'Emballages',
  carton: 'Carton',
  verre: 'Verre',
  dechet_residuel: 'Déchet résiduel',
};

// Couleurs = palette data-viz figée du Design System §2.4 (catégoriel, dashboards),
// DÉRIVÉE des tokens `--color-savr-dataviz-1..6` de globals.css (R-UI-6a) :
// 1 navy · 2 orange · 3 navy-500 · 4 vert · 5 navy-400 · 6 orange-600.
// Pas de gris pur (§2.3).
export const COULEUR_FLUX: Record<FluxZdCode, string> = {
  biodechet: 'var(--color-savr-dataviz-4)',
  emballage: 'var(--color-savr-dataviz-3)',
  carton: 'var(--color-savr-dataviz-6)',
  verre: 'var(--color-savr-dataviz-5)',
  dechet_residuel: 'var(--color-savr-dataviz-1)',
};

/** Les 5 flux dans l'ordre d'affichage, avec libellé et couleur. */
export const FLUX_ZD: FluxZd[] = FLUX_ZD_CODES.map((code) => ({
  code,
  label: LIBELLE_FLUX[code],
  color: COULEUR_FLUX[code],
}));

/** Code de flux ZD V1 connu (garde de type). */
export function estFluxZd(code: string): code is FluxZdCode {
  return (FLUX_ZD_CODES as readonly string[]).includes(code);
}

/** Libellé d'un flux : absent → « — », code inconnu → valeur brute. */
export function libelleFlux(code: string | null | undefined): string {
  if (!code) return '—';
  return estFluxZd(code) ? LIBELLE_FLUX[code] : code;
}

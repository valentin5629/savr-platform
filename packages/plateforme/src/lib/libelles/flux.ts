/**
 * Référentiel des 5 flux ZD V1 (§04 `flux_dechets`, liste fermée, seed figé) —
 * source unique (R-UI-2 C12) : code, libellé, ordre d'affichage et couleur de
 * graphe. Consommé par les dashboards, le registre (écran + CSV + API), la
 * synthèse PDF, la fiche collecte Admin et les loaders.
 *
 * Libellés = colonne `nom` du seed `flux_dechets` en base (« Cartons »), affichée
 * aussi par le CSV Pesées, les bordereaux PDF et les e-mails. Le CDC §04 écrit
 * « Carton » : divergence D45 en attente d'arbitrage Val — une seule ligne à
 * changer ici (+ seed) après décision.
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
  carton: 'Cartons',
  verre: 'Verre',
  dechet_residuel: 'Déchet résiduel',
};

// Couleurs figées par flux (décision Val 2026-10-30), tokens `--color-savr-flux-*`
// de globals.css : emballages jaune doré, biodéchets vert, verre bleu marine,
// cartons marron, déchet résiduel (DIB) gris. Le rapport de recyclage PDF reprend
// les mêmes codes (FLUX_REF du pdf-renderer).
export const COULEUR_FLUX: Record<FluxZdCode, string> = {
  biodechet: 'var(--color-savr-flux-biodechet)',
  emballage: 'var(--color-savr-flux-emballage)',
  carton: 'var(--color-savr-flux-carton)',
  verre: 'var(--color-savr-flux-verre)',
  dechet_residuel: 'var(--color-savr-flux-residuel)',
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

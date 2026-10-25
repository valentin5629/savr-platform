/**
 * Convives imprimés sur un PDF (bordereau ZD, rapport de recyclage, rapport
 * « sans excédent ») : ceux de LA collecte, jamais ceux de l'événement
 * (décision Val Q5 du 2026-10-24). 0 = inconnu (reprise Bubble) → null : le
 * gabarit omet la mention, ou affiche « — ».
 */
export function convivesImprimes(
  pax: number | null | undefined,
): number | null {
  return typeof pax === 'number' && pax > 0 ? pax : null;
}

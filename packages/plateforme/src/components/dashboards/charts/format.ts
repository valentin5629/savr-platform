import { formatJour } from '@savr/shared/src/temps/index.js';

import type { Granularite } from './types.js';

/** Étiquette d'axe X selon la granularité (§06.04 Bloc 2). */
export function formatPeriode(periode: string, g: Granularite): string {
  const jour = periode.slice(0, 10);
  // Valeur date-seule : formatJour la rend sans jamais construire d'instant ici.
  return g === 'mois'
    ? formatJour(jour, { month: 'short', year: '2-digit' })
    : formatJour(jour, { day: '2-digit', month: '2-digit' });
}

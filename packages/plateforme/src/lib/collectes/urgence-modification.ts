import { instantParis } from '@savr/shared/src/temps/index.js';

/** Un créneau de collecte : jour « AAAA-MM-JJ » et heure murale parisienne. */
interface Creneau {
  date: string;
  heure: string | null | undefined;
}

const DOUZE_HEURES_MS = 12 * 3600 * 1000;

// Heure murale parisienne : le trigger SQL qui débite le crédit du pack ancre le
// seuil 12h en Europe/Paris — l'API et l'écran doivent tomber au même instant.
const proche = (c: Creneau, maintenant: number): boolean =>
  instantParis(c.date, c.heure || '00:00:00').getTime() - maintenant <
  DOUZE_HEURES_MS;

/**
 * Modification urgente (§05 « Modification d'une collecte à venir ») : l'ancien
 * OU le nouveau créneau est à moins de 12 h (décision Val 2026-10-09). Une
 * collecte lointaine rapprochée à dans 3 heures est urgente, comme une collecte
 * de ce soir repoussée à la semaine prochaine.
 *
 * Module sans dépendance serveur : l'écran d'édition (avertissement), la route
 * (drapeau d'audit) et l'email à l'équipe Savr appliquent la même règle.
 */
export function modificationUrgente(
  ancien: Creneau,
  nouveau: Creneau,
  maintenant: number = Date.now(),
): boolean {
  return proche(ancien, maintenant) || proche(nouveau, maintenant);
}

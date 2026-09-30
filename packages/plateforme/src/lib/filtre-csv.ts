// Filtres à choix multiple des listes (décision Val 2026-09-30, divergence
// M0.8_20260930_filtres-choix-multiple-tous) : les valeurs cochées arrivent en
// paramètre CSV au pluriel (`types=a,b`), prioritaire sur le paramètre à valeur
// unique conservé pour les appelants et liens existants (`type=a`). Chaque
// valeur est validée (liste blanche d'enum ou UUID) AVANT `.in()` : une valeur
// invalide est écartée en silence.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const estUuid = (v: string): boolean => UUID.test(v);

/** Validateur « valeur d'enum » : liste blanche. */
export const parmi =
  (autorisees: readonly string[]) =>
  (v: string): boolean =>
    autorisees.includes(v);

/**
 * Filtre à deux valeurs (Actifs / Inactifs, Disponible / Manquant), resté à
 * valeur unique côté API : la valeur cochée seule, sinon null — aucune ou les
 * deux cochées = « Tous », aucun paramètre envoyé.
 */
export function valeurUnique(ids: readonly string[]): string | null {
  return ids.length === 1 ? (ids[0] ?? null) : null;
}

/** Liste CSV d'un paramètre, restreinte aux valeurs acceptées par `valide`. */
export function listeCsv(
  brut: string | null,
  valide: (v: string) => boolean,
): string[] {
  return (brut ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v && valide(v));
}

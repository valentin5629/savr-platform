// Filtres à choix multiple des listes (décision Val 2026-09-30, divergence
// M0.8_20260930_filtres-choix-multiple-tous) : les valeurs cochées arrivent en
// paramètre CSV au pluriel (`types=a,b`) ; à défaut, l'ancien paramètre à
// valeur unique (`type=a`) est lu comme une liste d'un élément :
// `listeCsv(sp.get('types') ?? sp.get('type'), …)`. Chaque valeur est validée
// (liste blanche d'enum ou UUID) AVANT `.in()` : une valeur invalide est
// écartée en silence.

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

/**
 * Liste `in.(…)` de textes LIBRES (noms saisis à la main), pour
 * `query.filter(colonne, 'in', inTextes(noms))`. Chaque valeur est citée, `\`
 * et `"` échappés : le `.in()` de postgrest-js ajoute les guillemets sans
 * échapper ceux de la valeur, et un nom portant un guillemet ET une virgule
 * (« Agence "Les Halles", Paris ») ne retrouvait alors aucune ligne.
 */
export function inTextes(valeurs: readonly string[]): string {
  return `(${valeurs.map((v) => `"${v.replace(/[\\"]/g, '\\$&')}"`).join(',')})`;
}

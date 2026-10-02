// Pagination des listes serveur — source unique (R-UI-4a, E2).
//
// Avant : `const limit = 50` recopié dans 9 routes et `total > 50` /
// `Math.ceil(total / 50)` dans 7 pages ; aucune route n'acceptait `limit`.
// Ici : une taille par défaut, un plafond, et la lecture tolérante de `page` /
// `limit` (NaN, négatif, trop grand → valeur sûre, jamais d'erreur).

export const DEFAULT_PAGE_SIZE = 50;
export const PAGE_SIZE_MAX = 100;
/** Au-delà, l'offset dépasse ce que PostgREST sérialise (`Range: 5e+21-…` → 500) : page vide plutôt qu'une erreur. */
export const PAGE_MAX = 1_000_000;

/** Numéro de page demandé : entier dans [1, PAGE_MAX] (défaut 1 si absent ou invalide). */
export function parsePage(searchParams: URLSearchParams): number {
  const n = parseInt(searchParams.get('page') ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, PAGE_MAX) : 1;
}

/**
 * Taille de page demandée : entier borné à [1, max] (défaut `defaut` si
 * absent ou invalide). Les routes passent `DEFAULT_PAGE_SIZE` sauf raison
 * (registre : 25).
 */
export function parseLimit(
  searchParams: URLSearchParams,
  defaut = DEFAULT_PAGE_SIZE,
  max = PAGE_SIZE_MAX,
): number {
  const n = parseInt(searchParams.get('limit') ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return defaut;
  return Math.min(n, max);
}

/** `page` + `limit` lus d'un coup, avec l'intervalle `[from, to]` de `.range()`. */
export function lirePagination(
  searchParams: URLSearchParams,
  defaut = DEFAULT_PAGE_SIZE,
): { page: number; limit: number; from: number; to: number } {
  const page = parsePage(searchParams);
  const limit = parseLimit(searchParams, defaut);
  const from = (page - 1) * limit;
  return { page, limit, from, to: from + limit - 1 };
}

/** Nombre de pages d'un total (≥ 1). */
export function nombreDePages(
  total: number,
  limit = DEFAULT_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, limit)));
}

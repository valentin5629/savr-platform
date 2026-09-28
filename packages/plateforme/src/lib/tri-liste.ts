// Tri serveur des listes paginées (Data Table, décision Val 2026-09-28).
// Trier dans le navigateur la seule page chargée donnerait un ordre faux sur
// l'ensemble : la page envoie `tri` (colonne) + `ordre` (asc|desc) et la route
// ordonne AVANT `.range()`.
//
// `tri` part dans `.order()` : il n'est accepté que s'il figure dans la liste
// blanche de la route, sinon le tri par défaut s'applique (jamais d'erreur,
// jamais de colonne arbitraire).

export interface Tri {
  colonne: string;
  ascendant: boolean;
}

export function lireTri(
  searchParams: URLSearchParams,
  colonnesTriables: readonly string[],
  defaut: Tri,
): Tri {
  const demande = searchParams.get('tri');
  if (!demande || !colonnesTriables.includes(demande)) return defaut;
  const ordre = searchParams.get('ordre');
  return {
    colonne: demande,
    ascendant: ordre === 'asc' || (ordre !== 'desc' && defaut.ascendant),
  };
}

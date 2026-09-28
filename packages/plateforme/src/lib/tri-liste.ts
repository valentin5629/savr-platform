// Tri serveur des listes paginées (Data Table, décision Val 2026-09-28).
// Trier dans le navigateur la seule page chargée donnerait un ordre faux sur
// l'ensemble : la page envoie `tri` (clé) + `ordre` (asc|desc) et la route
// ordonne AVANT `.range()`.
//
// `tris` = liste blanche de la route : clé du paramètre `tri` → colonnes SQL,
// dans l'ordre. Seules ces colonnes partent dans `.order()`, jamais la valeur
// reçue. Une clé inconnue (ou héritée : `toString`, `__proto__`… refusées par
// `Object.hasOwn`) → tri par défaut, jamais d'erreur. `ordre` absent ou
// invalide → sens par défaut.

export interface Tri {
  colonnes: readonly string[];
  ascendant: boolean;
}

export function lireTri<Cle extends string>(
  searchParams: URLSearchParams,
  tris: Record<Cle, readonly string[]>,
  defaut: { tri: NoInfer<Cle>; ascendant: boolean },
): Tri {
  const demande = searchParams.get('tri') ?? '';
  if (!Object.hasOwn(tris, demande)) {
    return { colonnes: tris[defaut.tri], ascendant: defaut.ascendant };
  }
  const ordre = searchParams.get('ordre');
  return {
    colonnes: tris[demande as Cle],
    ascendant: ordre === 'asc' || (ordre !== 'desc' && defaut.ascendant),
  };
}

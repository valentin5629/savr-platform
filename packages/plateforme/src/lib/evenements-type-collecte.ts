// Filtre « Type de collecte » de la liste Événements gestionnaire (§06.05 §2),
// à choix multiple sur une PARTITION (arbitrage Val F1 du 2026-10-01, divergence
// M0.8_20260930_filtres-choix-multiple-tous) : chaque événement tombe dans une
// seule catégorie selon les types de ses collectes. Les anciennes options
// « Avec ZD / Avec AG / ZD et AG » se recouvraient (un événement ZD+AG était
// dans les trois) : impossible à cocher ensemble sans contresens.

export const TYPES_COLLECTE_EVENEMENT = [
  'zd_seul',
  'ag_seul',
  'zd_et_ag',
] as const;
export type TypeCollecteEvenement = (typeof TYPES_COLLECTE_EVENEMENT)[number];

// Anciennes valeurs à choix unique (`?type_collecte=…` des liens existants)
// → catégories équivalentes de la partition.
const ANCIENNES_VALEURS = new Map<string, TypeCollecteEvenement[]>([
  ['avec_zd', ['zd_seul', 'zd_et_ag']],
  ['avec_ag', ['ag_seul', 'zd_et_ag']],
  ['zd_et_ag', ['zd_et_ag']],
]);

const estTypeCollecteEvenement = (v: string): v is TypeCollecteEvenement =>
  (TYPES_COLLECTE_EVENEMENT as readonly string[]).includes(v);

/**
 * Catégories demandées : `types_collecte[]` (liste blanche), sinon l'ancien
 * `type_collecte` à valeur unique. Liste vide = « Tous » (aucun filtre).
 */
export function lireTypesCollecte(
  sp: URLSearchParams,
): TypeCollecteEvenement[] {
  const liste = sp.getAll('types_collecte[]').filter(estTypeCollecteEvenement);
  if (liste.length > 0) return liste;
  return ANCIENNES_VALEURS.get(sp.get('type_collecte') ?? '') ?? [];
}

/**
 * Vrai si un événement (présence de collectes ZD / AG) passe le filtre. Un
 * événement sans collecte ZD ni AG n'appartient à aucune catégorie : il ne
 * sort qu'avec « Tous ».
 */
export function passeTypesCollecte(
  filtre: readonly TypeCollecteEvenement[],
  avecZd: boolean,
  avecAg: boolean,
): boolean {
  if (filtre.length === 0) return true;
  const categorie: TypeCollecteEvenement | null =
    avecZd && avecAg
      ? 'zd_et_ag'
      : avecZd
        ? 'zd_seul'
        : avecAg
          ? 'ag_seul'
          : null;
  return categorie !== null && filtre.includes(categorie);
}

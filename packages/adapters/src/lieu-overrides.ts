// Fusion « lieu officiel × lieu_overrides » — concept de domaine partagé, et non
// une responsabilité dupliquée par adapter (garde-fou 2 : l'adapter MTS-1, Everest
// et le TMS natif V2 doivent voir la MÊME adresse ; le drift par adapter a déjà
// été vécu sur `dirty_tms`, #196).
//
// Deux chemins consomment cette fusion, et ils doivent rester d'accord :
//   - émission E1/E2 (outbox-worker) — l'adresse transmise au dispatch ;
//   - propagation E5 (adapter MTS-1 `updateLieu`) — une édition Admin du lieu
//     officiel ne doit re-propager QUE les champs non surchargés
//     (§05 R_lieu_modif_pending point 4 : le snapshot d'une collecte qui porte
//     un override est figé sur ces champs-là).

/**
 * Champs du lieu qu'un override de collecte peut légitimement remplacer (§06.01).
 *
 * Allowlist EXPLICITE, et non un test `key in lieu` : `in` remonte la chaîne de
 * prototypes, donc `'constructor' in lieu` et `'__proto__' in lieu` valent true —
 * il ne borne rien. Comme `lieu_overrides` est un jsonb libre (pas de schéma, pas
 * de CHECK, pas de validation de clés sur les routes qui l'écrivent), seule une
 * liste fermée tient.
 *
 * Exclus volontairement :
 *  - `nom` et `id` : identité du lieu. Le §06.01 fige le nom (« identifiant
 *    lieu ») ; un override d'`id` serait un pivot vers le lieu d'une autre
 *    organisation le jour où un chemin du dispatch s'en sert dans une requête.
 *  - `latitude`/`longitude` : dérivées du géocodage, jamais saisies au formulaire.
 *
 * Périmètre exact : l'INTERSECTION des champs que le formulaire offre à l'édition
 * par collecte (`LieuEdits`, lieu-champs-editables.tsx) et de ceux que porte
 * l'interface `Lieu` des adapters. Depuis l'arbitrage Val 2026-09-15 (agrégation
 * des infos d'accès dans le champ libre), `Lieu` porte aussi `stationnement`,
 * `acces_office` et `flux_autorises` : l'intersection est donc désormais la
 * PARITÉ avec `LieuEdits`, les 9 champs éditables par collecte. Élargir l'un sans
 * l'autre ne sert à rien — un champ absent de `Lieu` n'est pas surchargeable, un
 * champ absent d'ici n'est pas fusionné.
 *
 * La liste reste plus large que ce que les adapters V1 portent dans un champ
 * NATIF (seuls `adresse_acces`, `code_postal` et `ville` composent l'adresse sur
 * le fil ; les 6 informations d'accès passent par le champ libre, cf.
 * infos-acces.ts) : le garde-fou 2 exige la même sémantique de fusion pour
 * l'adapter V1 et le TMS V2, et un miroir des consommateurs actuels garantirait
 * le drift au premier ajouté.
 *
 * ⚠ Aucun lien structurel ne maintient cette liste synchronisée avec `LieuEdits`
 * (packages distincts). Tout champ ajouté au formulaire ET à `Lieu` doit être
 * ajouté ici, sinon il sera saisi, stocké, audité — et jamais transmis.
 */
export const CHAMPS_LIEU_SURCHARGEABLES = [
  'adresse_acces',
  'code_postal',
  'ville',
  'acces_details',
  'contraintes_horaires',
  'type_vehicule_max',
  'stationnement',
  'acces_office',
  'flux_autorises',
] as const;

export type ChampLieuSurchargeable =
  (typeof CHAMPS_LIEU_SURCHARGEABLES)[number];

/**
 * Champs qui composent l'adresse réellement poussée au transporteur (E1 comme E5).
 * Sous-ensemble de l'allowlist : le reste du lieu ne touche pas l'adresse.
 */
export const CHAMPS_ADRESSE_TMS = [
  'adresse_acces',
  'code_postal',
  'ville',
] as const satisfies readonly ChampLieuSurchargeable[];

/**
 * Vrai si `champ` est effectivement surchargé par cette collecte, au sens EXACT
 * où `applyLieuOverrides` substituerait la valeur.
 *
 * Un seul prédicat pour les deux usages : ce que la propagation E5 considère
 * comme figé est exactement ce que la fusion substitue. Deux conditions écrites
 * séparément dériveraient au premier ajustement (un `null` traité comme une
 * surcharge d'un côté et ignoré de l'autre re-propagerait l'adresse officielle
 * sur une collecte corrigée — précisément le bug que ce module ferme).
 */
export function lieuChampSurcharge(
  overrides: Record<string, unknown> | null | undefined,
  champ: ChampLieuSurchargeable,
): boolean {
  // `hasOwn` et pas un simple accès : une lecture nue traverse la chaîne de
  // prototypes, donc un `Object.prototype.ville` posé ailleurs dans le process
  // serait transmis alors que l'override ne porte pas la clé.
  if (!overrides || !Object.hasOwn(overrides, champ)) return false;
  const value = overrides[champ];
  return value !== null && value !== undefined;
}

// PROG-01/PROG-03 — surcharge du lieu officiel par les valeurs saisies dans
// lieu_overrides. Le lieu officiel est la base ; on n'itère que sur l'allowlist,
// jamais sur les clés de l'override. Une valeur nulle est ignorée : un null ne
// doit jamais écraser une valeur de référence, sinon une saisie partielle vide
// l'adresse au lieu de la corriger.
export function applyLieuOverrides<T extends object>(
  lieu: T,
  overrides: Record<string, unknown> | null | undefined,
): T {
  if (!overrides) return lieu;
  const merged: T = { ...lieu };
  for (const champ of CHAMPS_LIEU_SURCHARGEABLES) {
    if (!lieuChampSurcharge(overrides, champ)) continue;
    (merged as unknown as Record<string, unknown>)[champ] = overrides[champ];
  }
  return merged;
}

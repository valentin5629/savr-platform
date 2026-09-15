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
 * l'interface `Lieu` des adapters. Ce n'est donc PAS la parité avec le formulaire :
 * `stationnement`, `acces_office` et `flux_autorises` y sont éditables mais
 * n'existent pas dans `Lieu`, ils ne peuvent pas être fusionnés ici — écart connu,
 * en attente d'arbitrage sur le périmètre des API MTS-1/Everest.
 *
 * La liste est volontairement plus large que ce que les adapters V1 transmettent
 * réellement (seuls `adresse_acces`, `code_postal` et `ville` atteignent le wire) :
 * le garde-fou 2 exige la même sémantique de fusion pour l'adapter V1 et le TMS V2,
 * et un miroir des consommateurs actuels garantirait le drift au premier ajouté.
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
 * Plafond de longueur d'une valeur surchargée, à la LECTURE (filet, #308 suite).
 *
 * Les bornes par champ sont posées à l'ÉCRITURE par `validerLieuOverrides`
 * (packages/plateforme/src/lib/programmation/lieu-override.ts, #308) : 200 pour
 * `adresse_acces`, 16 pour `code_postal`, 1000 pour `acces_details`, etc. Ce
 * plafond unique ne les redit pas — six nombres recopiés d'un package à l'autre
 * dériveraient au premier ajustement. Il vaut la PLUS GRANDE d'entre elles, si
 * bien qu'aucune valeur passée par une route ne le touche jamais.
 *
 * Il n'existe que pour le chemin qui échappe aux routes : `authenticated` porte
 * un `GRANT UPDATE` sur `plateforme.collectes` et la policy `col_update_client`
 * laisse un traiteur modifier sa propre collecte non terminale en PostgREST
 * direct — et `fetchCollecte` relit `lieu_overrides` sur la ligne au moment de
 * consommer l'event, pas dans le payload. Fermer ce GRANT relève de l'arbitrage
 * Val (CLAUDE.md §12 pt 2bis, cf. « Reste ouvert » de #308) ; en attendant, une
 * valeur démesurée écrite par là n'atteint pas le transporteur.
 */
export const LONGUEUR_MAX_SURCHARGE_LUE = 1000;

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

  // Garde de TYPE, et pas seulement de clé (#308 suite). `lieu_overrides` est un
  // jsonb libre : une valeur non textuelle passait l'allowlist et finissait
  // interpolée dans l'adresse envoyée au transporteur — `{"adresse_acces":
  // {"a": 1}}` donnait `"[object Object], 75008 Paris"`, un tableau `"x,y, …"`,
  // un nombre `"42, …"`, un objet à `toString` maison sa propre valeur. Aucune
  // injection (le corps part en JSON.stringify), mais un camion envoyé nulle
  // part, de nuit.
  //
  // #308 refuse désormais ces valeurs à l'ÉCRITURE sur les deux routes ; cette
  // garde-ci tient le chemin qui les contourne (PostgREST direct sous le GRANT
  // UPDATE d'`authenticated`, cf. LONGUEUR_MAX_SURCHARGE_LUE), et vaut règle de
  // fusion pour tout futur appelant.
  //
  // Une valeur invalide n'est PAS une surcharge : la fusion retombe sur le lieu
  // officiel — une adresse valide vaut mieux qu'un artefact de coercition. Et
  // comme ce prédicat est aussi celui du figeage E5, le champ redevient
  // propageable : une édition Admin du lieu officiel RÉPARE la collecte au lieu
  // de laisser la valeur poubelle en place.
  //
  // `trim()` : une chaîne d'espaces n'est pas une correction d'adresse, et la
  // logique existante refuse déjà qu'un override VIDE écrase une valeur de
  // référence — un `"   "` est le même cas, écrit autrement.
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    value.length <= LONGUEUR_MAX_SURCHARGE_LUE
  );
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
  // Copie SYSTÉMATIQUE, y compris sans override. Rendre l'entrée telle quelle
  // dans ce cas est inoffensif tant que les deux appelants lisent seulement,
  // mais un appelant futur qui muterait le résultat corromprait alors le lieu
  // partagé pour toutes les collectes de la boucle E5 — donc potentiellement
  // entre organisations. Le `{ ...lieu }` inconditionnel supprime la classe.
  const merged: T = { ...lieu };
  if (!overrides) return merged;
  for (const champ of CHAMPS_LIEU_SURCHARGEABLES) {
    if (!lieuChampSurcharge(overrides, champ)) continue;
    (merged as unknown as Record<string, unknown>)[champ] = overrides[champ];
  }
  return merged;
}

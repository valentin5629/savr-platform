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
 * Champs dont la colonne `plateforme.lieux` est un `text[]`, donc dont l'override
 * est un TABLEAU de chaînes et non une chaîne.
 *
 * Ensemble explicite plutôt qu'un `Array.isArray(value)` opportuniste : la forme
 * attendue doit dépendre du CHAMP, jamais de ce que la donnée se trouve porter —
 * sinon un tableau écrit par erreur sur `ville` redeviendrait une surcharge
 * valide et repartirait en « a,b » dans l'adresse (le cas que #312 ferme).
 */
const CHAMPS_LIEU_LISTE = new Set<ChampLieuSurchargeable>(['flux_autorises']);

/**
 * Plafond de CARDINALITÉ d'une valeur liste, à la lecture.
 *
 * Même raison d'être que `LONGUEUR_MAX_SURCHARGE_LUE` et même dimensionnement :
 * il vaut plus que la borne d'écriture (#308 : 20 items), si bien qu'aucune
 * valeur passée par une route ne le touche jamais. Sans lui, un tableau de
 * 10 000 entrées serait relu tel quel par `fetchCollecte` : rien de démesuré
 * n'atteignait le transporteur (le canal libre plafonne à 1000 car.), mais le
 * worker chargeait le tableau entier en mémoire.
 */
export const MAX_ENTREES_SURCHARGE_LUE = 50;

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
 * Ce plafond, comme `MAX_ENTREES_SURCHARGE_LUE`, visait d'abord le chemin qui
 * échappait aux routes : `authenticated` portait un `GRANT UPDATE` table-level
 * sur `plateforme.collectes`, et `fetchCollecte` relit `lieu_overrides` sur la
 * LIGNE au moment de consommer l'event, pas dans le payload de l'event.
 * **#318 a fermé ce chemin** (REVOKE UPDATE + INSERT sans re-GRANT) et posé un
 * CHECK en base miroir de l'allowlist d'écriture. Les deux plafonds restent
 * néanmoins la dernière ligne : ils couvrent les lignes écrites AVANT ces
 * bornes, tout futur ré-octroi du privilège, et les écrivains qui ne passent
 * pas par les routes (migrations, seed, import Bubble, service_role). Une garde
 * de fusion ne coûte rien et ne dépend d'aucun état de la base.
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
  // #308 refuse désormais ces valeurs à l'ÉCRITURE sur les deux routes, et #318
  // en base (CHECK + REVOKE UPDATE/INSERT à `authenticated`). Cette garde-ci
  // reste la dernière ligne — lignes antérieures à ces bornes, écrivains hors
  // routes, futur ré-octroi du privilège (cf. LONGUEUR_MAX_SURCHARGE_LUE) — et
  // vaut règle de fusion pour tout futur appelant.
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
  //
  // Corollaire assumé : un champ OPTIONNEL vidé au formulaire (`""`) ne vaut
  // plus « efface pour cette collecte » mais « non renseigné », comme `null` —
  // et comme la normalisation que #308 applique déjà aux trois selects. Sans
  // effet observable en V1 (ni `acces_details` ni `contraintes_horaires` n'est
  // lu par un adapter), mais la sémantique vaut pour la fusion V2.
  // `flux_autorises` est une LISTE, pas une chaîne : la colonne `lieux` est un
  // `text[]` et la validation d'entrée (#308, `liste_texte` 20 items × 64 car.)
  // la stocke en tableau. Lui appliquer la règle « chaîne » ci-dessous écartait
  // silencieusement TOUT override légitime de ce champ — saisi, stocké, audité,
  // et jamais transmis, très exactement le défaut que l'agrégation du canal
  // libre répare. Conflit sémantique révélé au merge de #312 (garde de type) et
  // de l'élargissement de l'allowlist à 9 champs : les deux sont corrects pris
  // séparément.
  if (CHAMPS_LIEU_LISTE.has(champ)) {
    // Tableau vide = « non renseigné », jamais « efface pour cette collecte » —
    // même sémantique que la chaîne vide juste en dessous. Une seule entrée
    // invalide disqualifie l'override entier : transmettre une liste amputée
    // serait pire qu'un repli sur le référentiel, le chauffeur ne pouvant pas
    // deviner qu'il en manque.
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.length <= MAX_ENTREES_SURCHARGE_LUE &&
      value.every(surchargeTexteValide)
    );
  }

  return surchargeTexteValide(value);
}

/**
 * Règle de validité d'une valeur TEXTUELLE surchargée — extraite pour être
 * appliquée telle quelle à chaque entrée d'un champ liste.
 */
function surchargeTexteValide(value: unknown): boolean {
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

  // `{ ...lieu }` est SUPERFICIEL : une valeur tableau du lieu OFFICIEL reste
  // partagée avec l'appelant, et donc — dans la boucle E5, où un même lieu sert
  // toutes ses collectes — entre organisations. La copie de la valeur surchargée
  // plus bas ne couvre que les collectes QUI surchargent ; le cas le plus
  // fréquent est justement l'autre. On copie donc les champs liste d'entrée de
  // jeu, pour que la promesse « jamais l'entrée par référence » vaille des deux
  // côtés, override ou pas.
  for (const champ of CHAMPS_LIEU_LISTE) {
    const officielle = (merged as unknown as Record<string, unknown>)[champ];
    if (Array.isArray(officielle)) {
      (merged as unknown as Record<string, unknown>)[champ] = [...officielle];
    }
  }

  if (!overrides) return merged;
  for (const champ of CHAMPS_LIEU_SURCHARGEABLES) {
    if (!lieuChampSurcharge(overrides, champ)) continue;
    // Copie du TABLEAU, pas sa référence — même raison que ci-dessus, côté
    // override cette fois. Les 8 autres champs sont des chaînes, immuables : le
    // cas n'existait pas avant l'entrée d'un champ liste dans l'allowlist.
    const valeur = overrides[champ];
    (merged as unknown as Record<string, unknown>)[champ] = Array.isArray(
      valeur,
    )
      ? [...valeur]
      : valeur;
  }
  return merged;
}

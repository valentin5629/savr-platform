// Constantes partagées de la liste Collectes gestionnaire (§06.05).
//
// La taille de page vit ici, et non dans la route, pour deux raisons :
//
// 1. Next.js App Router n'autorise dans un `route.ts` que les handlers HTTP et
//    ses propres options réservées. Un `export const PAGE_SIZE` y fait échouer
//    `next build` (« does not match the required types of a Next.js Route ») —
//    et `tsc --noEmit` ne le voit pas, seule la compilation Next le contrôle.
// 2. La route fenêtre avec cette valeur pendant que l'écran calcule son nombre
//    de pages avec. Si les deux divergeaient, l'écran annoncerait un nombre de
//    pages que le serveur ne sert pas et des collectes deviendraient
//    inatteignables sans rien pour le signaler — la troncature silencieuse que
//    ce module contribue justement à supprimer (relevé en revue).

import { estUuid, listeCsv } from '@/lib/filtre-csv';

/** Collectes par page de la liste gestionnaire (décision Val 2026-09-22). */
export const COLLECTES_PAGE_SIZE = 50;

// Brackets « Taille d'événement » (§06.05 l.115) traduits en prédicats PostgREST
// sur `evenements.pax`. Table de CONSTANTES : la valeur reçue du client sert de
// clé, elle n'est jamais interpolée dans la chaîne `.or()`.
//
// Les clés héritées (`toString`, `constructor`, `__proto__`, `valueOf`…) sont
// fermées par DEUX gardes indépendantes — il faut défaire les deux pour rouvrir
// quoi que ce soit, et c'est mesuré : annuler la seule `Map` laisse la sonde
// `collectes_route_taille_cle_heritee_rejetee` au VERT.
//   • `Map` plutôt qu'objet littéral : pas de chaîne de prototypes, donc
//     `?taille_evenements[]=toString` rend `undefined` là où `OBJ['toString']`
//     rendrait la fonction native. Son apport PROPRE est ailleurs : elle protège
//     d'une pollution réelle de `Object.prototype` par une dépendance tierce, qui
//     pourrait y poser une *chaîne* — le seul cas où la garde de type céderait.
//   • `typeof pred === 'string'` (plus bas) : rejette tout ce qui n'est pas une
//     chaîne. Mesuré sur un objet littéral : les 12 clés héritées rendent des
//     `function`/`object`, aucune n'est une chaîne — donc toutes écartées.
//
// ⚠ `pax` NULL compte **XS**, parce que le dashboard du même espace calcule
// `tailleBracket(pax ?? 0)`. Sans `pax.is.null` ici, le même filtre donnerait deux
// périmètres différents selon l'écran qu'on regarde.
//
// ⚠ Ces prédicats doivent rester **en SQL** : la liste est paginée, un filtrage
// après `.range()` filtrerait une PAGE au lieu de l'ensemble et laisserait
// `total` à sa valeur non filtrée.
const PREDICAT_TAILLE = new Map<string, string>([
  ['XS', 'pax.is.null,pax.lt.250'],
  ['S', 'and(pax.gte.250,pax.lt.500)'],
  ['M', 'and(pax.gte.500,pax.lt.750)'],
  ['L', 'and(pax.gte.750,pax.lt.1000)'],
  ['XL', 'pax.gte.1000'],
]);

/**
 * Filtres Lieu, Traiteur, Type et Taille d'événement de la liste Collectes du
 * gestionnaire. Lus par la route de la liste ET par son export CSV, pour que le
 * fichier contienne exactement les lignes de la liste (§12 §2 « l'export
 * respecte les filtres actifs »).
 *
 * Lieu et Traiteur sont à choix multiple (Design System §5.5 règle 7, décision
 * Val 2026-09-30) : `lieu_ids` / `traiteur_ids` en CSV ; les anciens `lieu_id` /
 * `traiteur_id` à valeur unique restent lus comme une liste d'un élément. Type
 * et Taille d'événement arrivent en paramètre répété (`x[]`), noms propagés par
 * le drill-down des Top listes du dashboard (§06.05 l.209).
 *
 * `aucunResultat` : un filtre a été demandé et AUCUNE de ses valeurs n'est
 * lisible (identifiant mal formé, code de taille hors XS…XL). Ignorer le filtre
 * rendrait un périmètre plus large que celui annoncé ; la réponse honnête est
 * une liste vide, sans jamais atteindre PostgREST.
 */
export function lireFiltresCollectesGestionnaire(sp: URLSearchParams) {
  const lieuxDemandes = listeCsv(
    sp.get('lieu_ids') ?? sp.get('lieu_id'),
    Boolean,
  );
  const traiteursDemandes = listeCsv(
    sp.get('traiteur_ids') ?? sp.get('traiteur_id'),
    Boolean,
  );
  const lieuIds = lieuxDemandes.filter(estUuid);
  const traiteurIds = traiteursDemandes.filter(estUuid);
  const taillesDemandees = sp.getAll('taille_evenements[]');
  const predicatsTaille = taillesDemandees
    .map((code) => PREDICAT_TAILLE.get(code))
    .filter((pred): pred is string => typeof pred === 'string');
  return {
    lieuIds,
    traiteurIds,
    typeEvtIds: sp.getAll('type_evenement_ids[]'),
    predicatsTaille,
    aucunResultat:
      (taillesDemandees.length > 0 && predicatsTaille.length === 0) ||
      (lieuxDemandes.length > 0 && lieuIds.length === 0) ||
      (traiteursDemandes.length > 0 && traiteurIds.length === 0),
  };
}

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

/** Collectes par page de la liste gestionnaire (décision Val 2026-09-22). */
export const COLLECTES_PAGE_SIZE = 50;

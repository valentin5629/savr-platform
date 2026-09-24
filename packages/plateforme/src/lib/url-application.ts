// Construction des URL ABSOLUES que l'application place dans ses emails et dans
// les `redirectTo` envoyés à Supabase Auth.
//
// POURQUOI CE FICHIER EXISTE (panne mesurée en dev, 2026-09-24)
// -------------------------------------------------------------
// Douze endroits écrivaient `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/chemin`.
// Quand la variable manque — ce qui était le cas sur l'environnement dev de
// Vercel — cette expression ne vaut PAS une chaîne vide inoffensive : elle vaut
// `/chemin`, une URL RELATIVE. Et une URL relative dans un email est toujours
// morte.
//
// Le parcours « mot de passe oublié » en est mort en silence : Supabase compare
// le `redirect_to` reçu à sa liste blanche (qui ne contient que des URL
// absolues), n'y trouve rien, et retombe **sans rien dire** sur le Site URL du
// projet. L'utilisateur atterrissait donc sur la racine puis sur l'écran de
// connexion, sans le moindre message — et le jeton, lui, était consommé. Deux
// mesures sur des liens réels ont montré `redirect_to=https://dev.app.gosavr.io`,
// chemin effacé.
//
// Le `?? ''` est le cœur du défaut : il transforme une configuration absente en
// lien silencieusement faux, au lieu d'une erreur. On ne produit plus jamais
// d'URL relative ici.
//
// L'ORIGINE DE LA REQUÊTE COMME SOURCE
// ------------------------------------
// Une route API connaît le domaine par lequel on l'appelle. C'est plus fiable
// qu'une variable d'environnement à tenir à jour dans trois environnements, et
// c'est correct par construction en local comme en préproduction.
//
// `NEXT_PUBLIC_APP_URL` reste PRIORITAIRE quand elle est définie : elle permet de
// forcer le domaine canonique (utile si l'app est atteinte par un alias de
// déploiement alors que les emails doivent pointer vers le domaine officiel).
//
// Sur l'origine dérivée : Vercel ne sert que les domaines attachés au projet —
// une requête portant un `Host` arbitraire n'atteint pas le déploiement. Et pour
// les `redirectTo`, Supabase revalide de toute façon l'URL contre sa liste
// blanche. Le repli est donc borné des deux côtés.

import type { NextRequest } from 'next/server';

/**
 * URL absolue d'un chemin de l'application, pour un email ou un `redirectTo`.
 *
 * @param req    la requête en cours (fournit le domaine par lequel on est appelé)
 * @param chemin chemin absolu commençant par `/` (ex. `/api/auth/verify-email`)
 */
export function urlApplication(req: NextRequest, chemin: string): string {
  const canonique = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const base = canonique && canonique !== '' ? canonique : req.nextUrl.origin;
  return new URL(chemin, base).toString();
}

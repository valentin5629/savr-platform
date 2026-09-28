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
// L'ORIGINE DE LA REQUÊTE COMME REPLI
// -----------------------------------
// `NEXT_PUBLIC_APP_URL` est la source PRIORITAIRE : c'est elle qui fixe le
// domaine canonique, et elle seule est correcte quand l'app est atteinte par un
// alias de déploiement alors que les emails doivent pointer vers le domaine
// officiel. Le repli sur l'origine de la requête sert à ne JAMAIS produire de
// lien relatif, pas à remplacer la configuration.
//
// ⚠ Le repli ne dispense pas de configurer. Mesuré le 2026-09-27 sur les trois
// instances GoTrue : seul le `site_url` tolère un sous-chemin ; toute entrée
// d'`additional_redirect_urls` doit correspondre EXACTEMENT, sauf joker `/**`.
// Une origine dérivée qui n'est pas le `site_url` du projet — l'alias
// `*.vercel.app` d'un déploiement preview, par exemple — est donc REJETÉE par
// Supabase, qui retombe en silence sur le `site_url`. Sur un environnement de
// preview, `NEXT_PUBLIC_APP_URL` reste nécessaire.
//
// CE QUI BORNE L'ORIGINE DÉRIVÉE, exactement
// ------------------------------------------
// Elle vient de l'en-tête `Host`, que le client écrit. Ce qui empêche un
// `Host: evil.com` d'aboutir est une propriété de L'HÉBERGEUR, mesurée le
// 2026-09-27 : Vercel route sur le `Host` et refuse tout domaine non attaché au
// projet (`404` + `x-vercel-error: DEPLOYMENT_NOT_FOUND`) — la requête n'atteint
// jamais la fonction. `X-Forwarded-Host` n'est pas un contournement : Next 15
// construit l'origine depuis `req.headers.host`, pas depuis cet en-tête.
//
// Ne pas écrire que le repli est « borné des deux côtés ». Pour les `redirectTo`
// passés à Supabase, oui : sa liste blanche revalide. Mais le lien de
// vérification du signup (`api/auth/signup`) est construit ici puis envoyé par
// Resend, SANS repasser par Supabase : celui-là n'a que la borne de l'hébergeur.
// Un lien porteur de jeton ajouté hors Vercel n'aurait plus aucune borne.

import type { NextRequest } from 'next/server';
import { logger } from '@savr/shared/src/logger/index.js';

/**
 * URL absolue d'un chemin de l'application, pour un email ou un `redirectTo`.
 *
 * @param req    la requête en cours (fournit le domaine par lequel on est appelé)
 * @param chemin chemin absolu commençant par `/` (ex. `/api/auth/verify-email`)
 */
export function urlApplication(req: NextRequest, chemin: string): string {
  const canonique = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (canonique) {
    try {
      return new URL(chemin, canonique).toString();
    } catch {
      // `new URL(chemin, 'app.gosavr.io')` LÈVE : une base sans schéma n'est pas
      // une URL. Sans ce filet, une variable mal saisie ferait un 500 sur les
      // sept routes — dont « mot de passe oublié ». Or tout ce fichier existe
      // parce que cette variable était mal configurée : on ne va pas transformer
      // la même erreur en panne plus dure. On trace et on prend l'origine réelle.
      logger.error('url_application.variable_mal_formee', {
        valeur: canonique,
        // ⚠ JAMAIS la query. Deux des appelants y mettent un secret vivant :
        // `token_hash` (signup) et `token_hash` + `jeton` d'impersonation, ce
        // dernier ouvrant une session sous l'identité d'un autre utilisateur.
        // La sanitisation du logger travaille par CLÉ (`SENSITIVE_KEYS`) et ne
        // regarde pas la valeur : sous la clé « chemin », un jeton noyé dans
        // l'URL sortirait en clair dans les journaux. Le chemin nu suffit
        // largement à diagnostiquer une variable mal saisie.
        chemin: chemin.split('?')[0],
      });
    }
  }
  return new URL(chemin, req.nextUrl.origin).toString();
}

/**
 * Variante sans requête, pour les contextes sans `NextRequest` sous la main
 * (cron, triggers DB relayés en best-effort — ex. `notify-pack-etat.ts`,
 * notifications traiteur). Sans requête, il n'y a pas d'origine de repli :
 * `NEXT_PUBLIC_APP_URL` est alors la SEULE source possible du domaine.
 *
 * On TRACE, on ne LÈVE PAS : ces envois sont best-effort (souvent lancés en
 * `void notifier...(...)`), une exception ici ferait perdre tout le reste du
 * contenu de l'email pour une variable d'environnement mal configurée. Le
 * lien résultant (`chemin` nu, relatif) est inutilisable, mais le reste de
 * l'email — date, lieu, flux — reste utile, et l'erreur est visible dans les
 * logs pour être corrigée côté configuration.
 */
export function urlCanonique(chemin: string): string {
  const canonique = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!canonique) {
    logger.error('url_application.variable_absente_hors_requete', {
      chemin: chemin.split('?')[0],
    });
    return chemin;
  }
  try {
    return new URL(chemin, canonique).toString();
  } catch {
    logger.error('url_application.variable_mal_formee_hors_requete', {
      valeur: canonique,
      chemin: chemin.split('?')[0],
    });
    return chemin;
  }
}

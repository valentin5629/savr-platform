<!-- Créé le 2026-11-04 (questionnaire sécurité VIPARIS, exigence IAM1). Lire AVANT de toucher à l'authentification, aux gardes d'API ou de page, ou d'ajouter une route qui lit elle-même le rôle dans le jeton. -->

# Code de vérification de l'équipe Savr (TOTP)

## Décision

Décision Val du 2026-11-04 : un code à 6 chiffres, donné par une application d'authentification (Google Authenticator, Microsoft Authenticator…), est **obligatoire pour l'équipe Savr** (`admin_savr`, `ops_savr`). Aucun code pour les clients, ni obligatoire ni facultatif. Pas de SMS (payant chez Supabase). Le CDC §15 prévoyait la double authentification en V1.1 : avancée par cette décision, fiche `_Divergences/` du 2026-11-04.

Fréquence : **une fois par session**. Le code est demandé à la connexion sur un nouvel appareil, après une déconnexion ou à la fin des 30 jours de la session (`[auth.sessions].timebox` de `supabase/config.toml`), jamais à chaque page.

## Fonctionnement

Supabase Auth porte le niveau atteint dans le claim `aal` du jeton : `aal1` après le mot de passe, `aal2` après le code. Ce niveau survit au rafraîchissement du jeton, d'où « une fois par session ».

Règle unique : `packages/plateforme/src/lib/code-verification.ts` (`exigeCodeVerification`, `codeVerificationManquant`). Elle est tenue côté serveur, en trois points :

| Point de contrôle                                                                                                                                                                      | Effet pour l'équipe Savr sans code                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/middleware.ts` (toute page hors pages publiques)                                                                                                                                  | redirection vers `/code-verification?next=<page demandée>` |
| `getVerifiedClaims` (`src/lib/api-auth.ts`), sur lequel reposent `requireStaff`, `requireAdmin`, `requireAnyUser`, `requireUser`, `requireProgrammateurOuAdmin`, `requireRegistreUser` | `null`, donc 401 sur toute route d'API gardée              |
| `requireStaffPage` / `requirePageSession` (`src/lib/page-auth.ts`), page `admin/sante-systeme`, `api/health/full`, `api/health/logistique`, `api/auth/update-password`                 | redirection vers l'écran du code, ou refus                 |

**Toute nouvelle route ou page qui lit elle-même le rôle dans le jeton** (sans passer par ces gardes) doit appeler `codeVerificationManquant(role, claims.aal)`.

L'écran du code et ses deux routes (`api/auth/code-verification/activation` et `/verification`) lisent la session sans passer par `getVerifiedClaims`, qui la refuserait (`lib/auth/session-code-verification.ts`), et refusent tout rôle hors équipe Savr.

Tests : `src/lib/code-verification.test.ts`, `tests/securite/middleware-actif.test.ts` (describe « code de vérification »), `tests/api/auth/get-verified-claims.test.ts`, `tests/securite/code-verification-pages.test.ts`, `tests/api/auth/code-verification.test.ts`, `tests/ui/code-verification.test.tsx`, `tests/api/admin/users-code-verification.test.ts`, `tests/ui/utilisateurs-savr-code-verification.test.tsx`. Les sessions de l'équipe Savr simulées dans les autres tests portent `aal: 'aal2'` (état normal après le code).

## Parcours

- **Première connexion** après la livraison : mot de passe, puis écran « Activez votre code de vérification » (QR code et clé à recopier), puis premier code. Le code n'est actif qu'après cette première saisie réussie.
- **Connexions suivantes** : mot de passe, puis code du moment.
- **Mot de passe oublié** : un compte qui a déjà un code passe par l'écran du code avant de choisir son nouveau mot de passe (`api/auth/reset-password/confirm`, puis `api/auth/update-password` refuse sans code). Un lien reçu par email ne suffit donc pas à changer le mot de passe dans l'application ; il suffit en revanche à obtenir une session sans code, que la base accepte (voir « Limites connues »).
- **Invitation** d'un nouveau membre : il choisit son mot de passe (lien d'invitation), puis active son code à sa première connexion.
- **Impersonation** : la session prise est celle du client, sans code. L'administrateur doit avoir passé son code pour la lancer ; il le ressaisit en revenant sur son compte (nouvelle session).

Journal (§07/01) : `auth.code_verification_activation_demandee`, `auth.code_verification_ok`, `auth.code_verification_echec` (avec l'IP), `auth.code_verification_reinitialise`. Log seul : aucune alerte ajoutée (l'alerte « bruteforce » reste sur `auth.login_failed`). Erreurs techniques : `auth.code_verification_activation_echec`, `auth.code_verification_reinitialisation_echec`, `auth.code_verification_reinitialise.audit_echec`.

## Téléphone perdu ou changé

1. **Par un autre administrateur** (procédure normale) : Paramètres → Utilisateurs Savr → ligne du membre → « Réinitialiser » dans la colonne « Code de vérification » (colonne montrée au seul `admin_savr`). Route : `DELETE /api/v1/admin/users/[id]/code-verification` (`admin_savr` avec code, jamais sur son propre compte). Ses facteurs TOTP sont retirés ; à sa prochaine connexion, il active un nouveau code. Trace : une ligne `audit_log` (`action = 'code_verification_reinitialise'`, `user_id` = l'administrateur, `record_id` = le compte réinitialisé, `new_values` = `{facteurs_retires}`, sans donnée personnelle) ; aucune ligne si le membre n'avait ni code ni activation en cours. Ses sessions déjà ouvertes ne sont pas fermées : si le téléphone perdu ou volé porte lui-même une session ouverte de la plateforme, fermer aussi les sessions du compte depuis la console Supabase (geste de Val, libellé de la console non vérifié).
2. **Sans autre administrateur** (le seul administrateur a perdu son téléphone) : geste manuel de Val dans la console Supabase du projet (`savr-prod` ou `savr-dev`), Authentication → Users → le compte, retrait des facteurs MFA. Libellé exact de la console non vérifié au 2026-11-04. Cette voie n'écrit rien dans `audit_log` (seul le journal d'authentification de Supabase la trace).

## Comptes VIPARIS (non construit)

Décision Val : code pour les comptes VIPARIS seulement s'ils le choisissent à la place du SAML, réponse attendue. Pour l'ajouter : étendre `exigeCodeVerification` à leur organisation (le claim `organisation_id` est déjà dans chaque jeton), puis adapter le texte de l'écran du code (aujourd'hui « comptes de l'équipe Savr ») et le refus de réinitialisation d'un compte client. Les trois points de contrôle n'ont pas à changer.

## Limites connues (au 2026-11-04)

- **La base de données ne lit pas le niveau du code : le code protège l'application, pas la base.** Aucune policy RLS ne teste `aal` (mesuré sur `savr-dev` le 2026-11-04 : 176 policies, dont 24 passent par `plateforme.f_is_staff()` et 84 testent le rôle de l'équipe Savr directement), ni les fonctions de la base appelables par un utilisateur connecté (par exemple `f_benchmark_lieux_parc`, `f_benchmark_traiteurs_parc`, `f_mes_acces_compte`, `GRANT EXECUTE … TO authenticated` dans les migrations). Or une session sans code (`aal1`) d'un compte de l'équipe Savr existe dès que le mot de passe est saisi, et aussi dès qu'un lien « mot de passe oublié » est ouvert : l'application pose les cookies de session avant l'écran du code, et le navigateur peut les lire (`httpOnly: false`, réglage par défaut de `@supabase/ssr` 0.12.0, non modifié ici). Une personne qui a **le mot de passe, ou seulement l'accès à la boîte mail**, d'un membre de l'équipe Savr peut donc s'arrêter à l'écran du code, recopier le jeton, et lire ou écrire directement auprès de l'API Supabase (avec la clé publique) tout ce que la base accorde à l'équipe Savr, sans jamais saisir le code. Le fermer en base (policy restrictive `aal = aal2` pour l'équipe Savr sur chaque table, recommandation de Supabase, et contrôle équivalent dans les fonctions appelables) touche aux policies RLS : lot à part, décision Val. Storage et Realtime ne sont pas utilisés (aucune référence dans les migrations ni dans le code).
- **Première activation** : tant qu'un membre n'a pas activé son code, une personne qui connaîtrait son mot de passe, ou aurait accès à sa boîte mail (lien « mot de passe oublié », accepté tant qu'aucun code n'est actif), pourrait activer son propre code à sa place. La même fenêtre se rouvre après chaque réinitialisation par un autre administrateur. Chaque membre doit donc se connecter et activer son code dès la livraison. Après l'activation, l'application refuse une seconde activation ; côté Supabase Auth, l'ajout d'un facteur à un compte qui en a déjà un exige le code (comportement de son code source, non mesuré ici).
- **Réglages des projets hébergés non mesurés** : l'activation du TOTP (activé par défaut d'après la documentation Supabase) et la durée de session de 30 jours (`[auth.sessions].timebox`) se règlent au tableau de bord Supabase de chaque projet ; `supabase/config.toml` ne gouverne que l'instance locale. À vérifier sur `savr-dev` et `savr-prod`.
- **Essais répétés de codes** : l'application ne freine pas elle-même la saisie de codes et aucune alerte ne porte sur `auth.code_verification_echec`. Supabase Auth limite les essais par adresse IP ; passant par la plateforme, il voit l'adresse de sortie de Vercel, commune à tous (non mesuré).
- **Impersonation d'un membre de l'équipe Savr** (comportement antérieur à ce lot) : si ce membre n'a pas encore de code, l'administrateur qui l'impersone peut activer le code à sa place.
- **Lien d'invitation** : `api/auth/invitation` pose le mot de passe par le client de service sans regarder les facteurs ; cas étroit (un lien encore valable sur un compte qui a déjà activé son code).
- **Comptes de démonstration** de `savr-dev` (un `admin_savr`, trois `ops_savr` au 2026-11-04) : chacun devra activer un code à sa prochaine connexion.

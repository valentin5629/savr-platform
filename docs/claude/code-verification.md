<!-- Créé le 2026-11-04 (questionnaire sécurité VIPARIS, exigence IAM1). Lire AVANT de toucher à l'authentification, aux gardes d'API ou de page, d'ajouter une route qui lit elle-même le rôle dans le jeton, ou de créer une table, une fonction SECURITY DEFINER ou une vue security_invoker = false (section « En base »). -->

# Code de vérification de l'équipe Savr (TOTP)

## Décision

Décision Val du 2026-11-04 : un code à 6 chiffres, donné par une application d'authentification (Google Authenticator, Microsoft Authenticator…), est **obligatoire pour l'équipe Savr** (`admin_savr`, `ops_savr`). Aucun code pour les clients, ni obligatoire ni facultatif. Pas de SMS (payant chez Supabase). Le CDC §15 prévoyait la double authentification en V1.1 : avancée par cette décision, fiche `_Divergences/` du 2026-11-04.

**En production seulement** (Val 2026-11-04, pour ne pas le saisir sans cesse pendant le développement) : sur `app.gosavr.io`. Sur les aperçus Vercel, `dev.app.gosavr.io`, en local et en CI, aucun code n'est demandé. Détection : `codeVerificationActif()`, vrai si `VERCEL_ENV` (lue à l'exécution) ou `NEXT_PUBLIC_VERCEL_ENV` (figée au build, donc aussi dans le middleware Edge) vaut `production`. Preuve que la production le demande bien : à la première connexion Admin sur `app.gosavr.io` après le déploiement, l'écran du code doit apparaître ; sinon, aucune des deux variables n'est vue et le code est coupé en production.

Fréquence : **une fois par session**. Le code est demandé à la connexion sur un nouvel appareil, après une déconnexion ou à la fin des 30 jours de la session (`[auth.sessions].timebox` de `supabase/config.toml`), jamais à chaque page.

## Fonctionnement

Supabase Auth porte le niveau atteint dans le claim `aal` du jeton : `aal1` après le mot de passe, `aal2` après le code. Ce niveau survit au rafraîchissement du jeton, d'où « une fois par session ».

Règle unique : `packages/plateforme/src/lib/code-verification.ts` (`codeVerificationActif`, `exigeCodeVerification`, `codeVerificationManquant`). En production, elle est tenue côté serveur, en trois points :

| Point de contrôle                                                                                                                                                                      | Effet pour l'équipe Savr sans code                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/middleware.ts` (toute page hors pages publiques)                                                                                                                                  | redirection vers `/code-verification?next=<page demandée>` |
| `getVerifiedClaims` (`src/lib/api-auth.ts`), sur lequel reposent `requireStaff`, `requireAdmin`, `requireAnyUser`, `requireUser`, `requireProgrammateurOuAdmin`, `requireRegistreUser` | `null`, donc 401 sur toute route d'API gardée              |
| `requireStaffPage` / `requirePageSession` (`src/lib/page-auth.ts`), page `admin/sante-systeme`, `api/health/full`, `api/health/logistique`, `api/auth/update-password`                 | redirection vers l'écran du code, ou refus                 |

**Toute nouvelle route ou page qui lit elle-même le rôle dans le jeton** (sans passer par ces gardes) doit appeler `codeVerificationManquant(role, claims.aal)`.

L'écran du code et ses deux routes (`api/auth/code-verification/activation` et `/verification`) lisent la session sans passer par `getVerifiedClaims`, qui la refuserait (`lib/auth/session-code-verification.ts`), et refusent tout rôle hors équipe Savr (et tout compte hors production).

Tests : `src/lib/code-verification.test.ts`, `tests/securite/middleware-actif.test.ts` (describe « code de vérification »), `tests/api/auth/get-verified-claims.test.ts`, `tests/securite/code-verification-pages.test.ts`, `tests/api/auth/code-verification.test.ts`, `tests/ui/code-verification.test.tsx`, `tests/api/admin/users-code-verification.test.ts`, `tests/ui/utilisateurs-savr-code-verification.test.tsx`. Les tests du code simulent la production (`vi.stubEnv('VERCEL_ENV', 'production')`) et jouent aussi le hors-production. Les sessions de l'équipe Savr simulées dans les autres tests portent `aal: 'aal2'` (état normal après le code en production ; sans effet hors production). La base : `supabase/tests/SECU__code_verification_base.test.sql`.

## En base (2026-11-04)

Décision Val du 2026-11-04 : la base refuse aussi une session de l'équipe Savr sans code. Migration `supabase/migrations/20261104200000_plateforme_code_verification_base.sql`.

Règle unique : `plateforme.f_code_verification_ok()`. Elle est fausse, et seulement alors, pour un jeton `admin_savr` ou `ops_savr` dont `aal` n'est pas `aal2` et dont le compte a un **code activé** (facteur vérifié dans `auth.mfa_factors`). Sans code activé, rien ne change : c'est le cas sur dev, en local, sur les aperçus et en CI, où l'application ne demande pas le code, et en production avant la première connexion d'un membre (même fenêtre que « Première activation », plus bas). `plateforme.f_code_verification_active()` (`SECURITY DEFINER`, seule à lire `auth.mfa_factors`) n'est appelée que pour une session de l'équipe Savr sans code.

Elle est posée en trois endroits :

| Où                                                                                                                               | Effet pour une session de l'équipe Savr sans code, compte au code activé                       |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Policy **restrictive** `code_verification_equipe_savr` sur chaque table de `plateforme` et `shared` (`FOR ALL TO authenticated`) | aucune ligne lue, modifiée ou supprimée ; toute création refusée (`42501`)                     |
| Début des fonctions `SECURITY DEFINER` appelables par `authenticated`                                                            | plpgsql : refus `42501` « Code de vérification requis » ; sql : false, NULL, 0 ou aucune ligne |
| `WHERE` des vues `security_invoker = false` lisibles par `authenticated`                                                         | vue vide                                                                                       |

**Toute nouvelle table** de `plateforme` ou `shared` reçoit la policy, dans la migration qui la crée :

```sql
CREATE POLICY code_verification_equipe_savr ON plateforme.<table>
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (plateforme.f_code_verification_ok())
  WITH CHECK (plateforme.f_code_verification_ok());
```

Toute nouvelle fonction `SECURITY DEFINER` ouverte à `authenticated`, et toute vue `security_invoker = false` qu'il peut lire, appelle `plateforme.f_code_verification_ok()`. Le cliquet `supabase/tests/SECU__code_verification_base.test.sql` (assertions 12, 14, 15) rougit sinon. Jamais de `(SELECT plateforme.f_code_verification_ok())` dans une policy : la sous-requête fait lever « infinite recursion detected in policy » sur `collectes` (chemin collectes → evenements → collectes).

Une session sans code ne peut pas désactiver le code de son compte pour échapper à la règle : Supabase Auth refuse sous `aal1` le retrait d'un facteur vérifié (422 « AAL2 required to unenroll verified factor ») et l'ajout d'un second facteur (403 « AAL2 required to enroll a new factor ») ; mesuré sur GoTrue v2.189.0 (image de la pile locale) le 2026-11-04, version des projets hébergés non lue.

Un test qui simule une session de l'équipe Savr n'a rien à changer tant qu'il ne crée pas de facteur vérifié pour son compte : la règle ne mord qu'avec un code activé.

Coût mesuré (20 000 lignes lues, base de test, 2026-11-04) : 2 à 3 µs par ligne pour un client ou une session avec code ; environ 27 µs par ligne pour une session de l'équipe Savr sans code activé (dev, local).

Mesure par l'API (PostgREST jetable, même base, avant et après la migration) : un jeton `admin_savr` sans code, d'un compte au code activé, lisait les organisations, appelait `f_benchmark_traiteurs_parc` et modifiait une association ; après : liste vide, 403 « Code de vérification requis », 0 ligne modifiée ; avec le code, identique à avant.

**Avant d'appliquer la migration à un projet**, retirer les facteurs d'essai des comptes de l'équipe Savr qui ne passent jamais par l'écran du code (dev : l'application ne le demande pas), sans quoi ces comptes ne lisent plus rien en base.

## Parcours

- **Première connexion** après la livraison : mot de passe, puis écran « Activez votre code de vérification » (QR code et clé à recopier), puis premier code. Le code n'est actif qu'après cette première saisie réussie.
- **Connexions suivantes** : mot de passe, puis code du moment.
- **Mot de passe oublié** : un compte qui a déjà un code passe par l'écran du code avant de choisir son nouveau mot de passe (`api/auth/reset-password/confirm`, puis `api/auth/update-password` refuse sans code). Un lien reçu par email ne suffit donc ni à changer le mot de passe dans l'application, ni à lire ou écrire en base (voir « En base »).
- **Invitation** d'un nouveau membre : il choisit son mot de passe (lien d'invitation), puis active son code à sa première connexion.
- **Impersonation** : la session prise est celle du client, sans code. L'administrateur doit avoir passé son code pour la lancer ; il le ressaisit en revenant sur son compte (nouvelle session).

Journal (§07/01) : `auth.code_verification_activation_demandee`, `auth.code_verification_ok`, `auth.code_verification_echec` (avec l'IP), `auth.code_verification_reinitialise`. Log seul : aucune alerte ajoutée (l'alerte « bruteforce » reste sur `auth.login_failed`). Erreurs techniques : `auth.code_verification_activation_echec`, `auth.code_verification_reinitialisation_echec`, `auth.code_verification_reinitialise.audit_echec`.

## Téléphone perdu ou changé

1. **Par un autre administrateur** (procédure normale) : Paramètres → Utilisateurs Savr → ligne du membre → « Réinitialiser » dans la colonne « Code de vérification » (colonne montrée au seul `admin_savr`). Route : `DELETE /api/v1/admin/users/[id]/code-verification` (`admin_savr`, avec code en production, jamais sur son propre compte ; utilisable aussi hors production pour retirer un facteur d'essai). Ses facteurs TOTP sont retirés ; à sa prochaine connexion, il active un nouveau code. Trace : une ligne `audit_log` (`action = 'code_verification_reinitialise'`, `user_id` = l'administrateur, `record_id` = le compte réinitialisé, `new_values` = `{facteurs_retires}`, sans donnée personnelle) ; aucune ligne si le membre n'avait ni code ni activation en cours. Ses sessions déjà ouvertes ne sont pas fermées : si le téléphone perdu ou volé porte lui-même une session ouverte de la plateforme, fermer aussi les sessions du compte depuis la console Supabase (geste de Val, libellé de la console non vérifié).
2. **Sans autre administrateur** (le seul administrateur a perdu son téléphone) : geste manuel de Val dans la console Supabase du projet (`savr-prod` ou `savr-dev`), Authentication → Users → le compte, retrait des facteurs MFA. Libellé exact de la console non vérifié au 2026-11-04. Cette voie n'écrit rien dans `audit_log` (seul le journal d'authentification de Supabase la trace).

## Comptes VIPARIS (non construit)

Décision Val : code pour les comptes VIPARIS seulement s'ils le choisissent à la place du SAML, réponse attendue. Pour l'ajouter : étendre `exigeCodeVerification` à leur organisation (le claim `organisation_id` est déjà dans chaque jeton), puis adapter le texte de l'écran du code (aujourd'hui « comptes de l'équipe Savr ») et le refus de réinitialisation d'un compte client. Les trois points de contrôle n'ont pas à changer.

## Limites connues (au 2026-11-04)

- **Ce que la base ne couvre pas** : l'API d'authentification de Supabase elle-même (une session sans code y lit encore son propre compte, la liste de ses facteurs par exemple), le `service_role` (contourne la RLS, réservé au serveur) et les comptes qui n'ont pas encore activé leur code (fenêtre « Première activation »). Storage et Realtime ne sont pas utilisés (aucune référence dans les migrations ni dans le code). Les cookies de session restent lisibles par le navigateur (`httpOnly: false`, réglage par défaut de `@supabase/ssr` 0.12.0) ; une session sans code ainsi copiée n'ouvre plus rien en base.
- **Première activation** : tant qu'un membre n'a pas activé son code, une personne qui connaîtrait son mot de passe, ou aurait accès à sa boîte mail (lien « mot de passe oublié », accepté tant qu'aucun code n'est actif), pourrait activer son propre code à sa place. La même fenêtre se rouvre après chaque réinitialisation par un autre administrateur. Chaque membre doit donc se connecter et activer son code dès la livraison. Après l'activation, l'application refuse une seconde activation ; côté Supabase Auth, l'ajout d'un facteur à un compte qui en a déjà un exige le code (mesuré le 2026-11-04 sur GoTrue v2.189.0 : 403 « AAL2 required to enroll a new factor »). Pendant cette fenêtre, la base laisse aussi passer une session sans code (règle « code activé », section « En base »).
- **Réglages des projets hébergés non mesurés** : l'activation du TOTP (activé par défaut d'après la documentation Supabase) et la durée de session de 30 jours (`[auth.sessions].timebox`) se règlent au tableau de bord Supabase de chaque projet ; `supabase/config.toml` ne gouverne que l'instance locale. À vérifier sur `savr-dev` et `savr-prod`.
- **Essais répétés de codes** : l'application ne freine pas elle-même la saisie de codes et aucune alerte ne porte sur `auth.code_verification_echec`. Supabase Auth limite les essais par adresse IP ; passant par la plateforme, il voit l'adresse de sortie de Vercel, commune à tous (non mesuré).
- **Impersonation d'un membre de l'équipe Savr** (comportement antérieur à ce lot) : si ce membre n'a pas encore de code, l'administrateur qui l'impersone peut activer le code à sa place.
- **Lien d'invitation** : `api/auth/invitation` pose le mot de passe par le client de service sans regarder les facteurs ; cas étroit (un lien encore valable sur un compte qui a déjà activé son code).
- **Code coupé en production sans signal si Vercel ne fournit aucune des deux variables** (`VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_ENV`) : elles dépendent vraisemblablement du même réglage Vercel (exposition des variables système, non mesuré). La preuve à la première connexion Admin sur `app.gosavr.io` ne mesure qu'une fois et ne verrait pas une régression ultérieure (réglage changé). Signal continu possible, non fait : exposer l'état dans `api/health/full` et le surveiller (Better Uptime).
- **Hors production, aucun code** : les comptes de l'équipe Savr sur `savr-dev` (aperçus, `dev.app.gosavr.io`) n'ont pas de second facteur. Un compte qui en a activé un pendant un essai le garde ; Supabase Auth pourrait alors refuser un changement de mot de passe sans le code (non mesuré) et, une fois la migration de la section « En base » appliquée, la base ne lui rend plus aucune donnée : retirer ce facteur (bouton « Réinitialiser » par un autre administrateur, ou console Supabase). Mesuré sur `savr-dev` le 2026-11-04 : le compte `admin_savr` a un facteur TOTP vérifié, resté des essais.
- **Comptes de démonstration** de `savr-dev` (un `admin_savr`, trois `ops_savr` au 2026-11-04) : aucun code demandé (hors production).

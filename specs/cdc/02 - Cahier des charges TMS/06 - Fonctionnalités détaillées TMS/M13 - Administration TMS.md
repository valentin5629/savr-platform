# M13 — Administration TMS

**Persona principal** : Admin TMS (Val + Louis backup V1)
**Contexte d'usage** : web responsive (desktop bureau prioritaire, mobile dépannage), usage hebdomadaire (paramétrage, users), ponctuel (incident intégration, secrets, RGPD). Pluriquotidien pour dashboard monitoring en cas de migration/incident.

---

## 1. Objectif métier

M13 est la **tour de contrôle Admin TMS**. Il centralise tout ce qui n'a pas trouvé sa place dans un module métier :

- **Paramétrage runtime** des ~50 paramètres `m0X_*` éditables sans redéploiement (table `parametres_tms` §04)
- **Gestion des users TMS** (Ops Savr + Admin TMS) : création, désactivation, rôles, reset MFA, impersonation pour support
- **Audit log** consultable et filtrable (5 ans rétention, immutable)
- **Secrets API** sensibles (Pennylane, Everest, Strike webhook, Marathon webhook, Bridge) stockés dans Supabase Vault et rotated depuis M13
- **Monitoring intégrations** (`integrations_logs`) avec replay manuel des events en échec final
- **Wizard onboarding prestataire** orchestrant création prestataire (M06) + first manager (M03) + activation portail + magic link
- **Édition criticité codes alertes M11** (override seed → runtime) sans redéploiement

**Ce que M13 remplace** :
- Les `INSERT` SQL manuels pour créer/désactiver un user
- Les `UPDATE parametres_tms SET valeur = ...` faits à la main par Val
- Les secrets stockés en clair dans `parametres_tms` ( Slack dégagé V1 — revue sobriété 2026-04-25 A6)
- L'absence de visibilité Admin sur les events Plateforme/Everest perdus
- Le manque de wizard d'onboarding prestataire (chaque création = process artisanal en 5+ étapes manuelles)

**Ce que M13 ne couvre pas V1** :
- **CRUD prestataires** : reste dans M06 (M13 propose seulement le wizard d'onboarding qui appelle M06)
- **CRUD grilles tarifaires** : reste dans M07 (M13 navigue vers M07)
- **Dashboard alerting** : reste dans M11 (M13 navigue vers M11)
- **Workflow déverrouillage facturation** : reste dans M08 (M13 navigue vers M08)
- **Dashboard métier financier** : reste dans M07 (M13 navigue vers M07)
- **Granularité de droits Admin** : V1 = Val + Louis = tous droits, pas de RBAC sub-admin (V1.1+ si 3ème admin recruté)
- **Pseudonymisation users RGPD** : V1 = soft delete uniquement, pseudonymisation différée → V1.1 (D7)

**KPI cibles V1** :
- **0** modification SQL manuelle hors M13 sur `parametres_tms`, `users_tms`, secrets
- **100%** des onboardings prestataires passent par le wizard E7
- **< 5 min** délai détection → action Admin sur un event Plateforme en `echec_final`
- **100%** des édits de paramètres `m0X_*` tracés en `audit_logs`

---

## 2. Personas et contexte d'usage

### Admin TMS (Val + Louis backup)

- **Identité** : 2 personnes V1 (Val CEO/CTO + Louis backup). Pas de granularité interne (D7 §03).
- **Rôle système** : `admin_tms` (cf. §09 Auth). MFA TOTP obligatoire à la **1ère connexion sur un device** (D11). Sessions 30j glissantes après device trusted (D10).
- **Auth** : SSO Google `@gosavr.io` + MFA TOTP au 1er login device. Devices trusted (max 3 par user, D14).
- **Accès** : web `tms.gosavr.io/admin/*` (sous-route mono-domaine, gating middleware Next.js + RLS Supabase, désactivable IP-restrict V1.1 si besoin sur le path `/admin/*`). *(propagation §11 2026-04-27 — alignement sous-route, conflit 1 tranché option a Val)*
- **Périmètre RLS** : tous schémas `tms.*`, `shared.*`. Lecture/écriture totale sauf `audit_logs` (read-only, immutable D5).
- **Usage** :
  - **Hebdomadaire** : ajustement paramètres `m0X_*`, revue `integrations_logs`, créa/désa users
  - **Mensuel** : revue audit log filtré (compliance), rotation secrets si politique (90j sur Pennylane/Everest)
  - **Ponctuel** : wizard onboarding nouveau prestataire (~1/trim), impersonation pour support (~1/sem), replay event échec final (~1/mois), reset MFA user (rare)

### Ops Savr (lecture limitée)

- **Identité** : équipe ops Savr (4-8 personnes V1).
- **Rôle système** : `ops_savr` (cf. §09).
- **Auth** : SSO Google + session 30j glissantes device trusted, **pas de MFA TOTP requis** (cf. §09 V1).
- **Périmètre M13** : lecture seule sur paramètres `parametres_tms` où `'ops_savr' = ANY(modifiable_par)`, lecture seule sur `audit_logs`, lecture seule sur `integrations_logs`. **Aucun accès** : users, secrets, codes alertes, wizard onboarding, impersonation.
- **Usage M13** : très ponctuel. La majorité du quotidien Ops vit dans M02 (dispatch), M11 (alerting), M07 (pilotage), M08 (facturation).

### Manager prestataire / Chauffeur

**Hors périmètre M13.** Aucun accès.

---

## 3. Architecture des écrans

```
M13 Admin TMS
├── E1 — Dashboard admin (home)              [admin_tms uniquement]
├── E2 — Paramètres système                  [admin_tms full / ops_savr lecture limitée]
├── E3 — Gestion users TMS                   [admin_tms uniquement]
│   ├── E3.a — Liste users
│   ├── E3.b — Détail user (édition + reset MFA + désactivation)
│   ├── E3.c — Création user (modale)
│   └── E3.d — Devices trusted (sous-onglet détail user)
├── E4 — Audit log                           [admin_tms full / ops_savr lecture seule]
├── E5 — Secrets API                         [admin_tms uniquement]
├── E6 — Monitoring intégrations             [admin_tms full / ops_savr lecture seule]
│   ├── E6.a — Liste events
│   ├── E6.b — Détail event + replay
│   ├── E6.c — Collectes orphelines à réconcilier (QO#10 M02 — V1, cf. §4) *(collision numérotation corrigée 2026-06-07)*
│   └── E6.d — Dashboard inbox dédup (V1.1 — V1 = pas d'écran)
├── E7 — Wizard onboarding prestataire       [admin_tms uniquement]  *(4 étapes — grille bloquante réactivée revue sobriété §05 2026-05-01 D2 ; archi réalignée, tranché Val 2026-06-07 test-scenarios F1)*
│   ├── E7.1 — Étape 1 : Identité prestataire (M06)
│   ├── E7.2 — Étape 2 : Grille tarifaire initiale (M07) *(bloquante non skippable — D2 2026-05-01)*
│   ├── E7.3 — Étape 3 : First manager + magic link (M03)
│   └── E7.4 — Étape 4 : Récap + activation
├── E8 — Codes alertes (override criticité)  [admin_tms uniquement]
└── E9 — Impersonation (modale globale)      [admin_tms uniquement]

Hors périmètre M13 (navigation vers modules existants) :
├── → M06 Référentiel prestataires
├── → M07 Pilotage financier (grilles + dashboard)
├── → M08 Facturation prestataires
└── → M11 Dashboard alerting
```

**Layout global** : sidebar gauche persistante (E1-E8 + liens vers M06/M07/M08/M11), zone principale, bandeau supérieur user connecté + impersonation (si active) + lien "Documentation".

---

## 4. Écran par écran

### E1 — Dashboard admin

**Layout** : 4 cards résumé en haut, 2 sections en bas.

**Cards résumé** (lecture seule, refresh 60s) :
- **Paramètres modifiés 7j** : compteur édits `parametres_tms` last 7d. Click → E4 audit filtré `table_name=parametres_tms` derniers 7j.
- **Events échec final 24h** : compteur `integrations_logs WHERE statut='echec_final' AND created_at >= now()-1d`. Click → E6 filtré.
- **Users actifs / total** : `count(*) FILTER (WHERE statut='actif')` / `count(*)` sur `users_tms`. Click → E3.
- **Devices trusted total** : `count(*) FROM users_tms_devices_trusted WHERE actif=true`. Click → E3 sous-onglet devices.

**Section "Liens rapides modules métier"** :
- Cartes navigantes : M06 Référentiel prestataires, M07 Pilotage financier, M08 Facturation, M11 Alerting.

**Lien "Activité Admin récente →"** *(sobriété M13 B3 2026-04-30)* :
- Bouton unique "Voir activité Admin récente →" → ouvre E4 Audit log préfiltré `acteur=admin_tms, range=7j`. E4 gère le rendu complet.
- Le stream embarqué 20 dernières actions est dégagé : composant custom supprimé, query `JOIN users_tms` sur `audit_logs` supprimée de E1.

> **Motif** : E4 existe et couvre déjà ce besoin avec plus de filtres. Économise 1 composant stream custom + 1 query JOIN au chargement de E1.

**RLS** : `admin_tms` uniquement.

**Tables lues** : `parametres_tms`, `users_tms`, `users_tms_devices_trusted`, `integrations_logs`.

---

### E2 — Paramètres système

**Layout** : tableau filtrable + édition modale par ligne.

**Note paramètres `m05_*` (propagation §12 D9 2026-04-27 ; révisé revue sobriété 2026-06-04 B3)** : 15 paramètres `m05_*` au total — les ex-booléens `m05_force_update_active` + `m05_force_update_strict` sont fusionnés en un enum unique `m05_force_update_mode` (`off|soft|hard`). Cf. [[M05 - App mobile chauffeur#12. Paramètres configurables (M13)]] et §04 niveau 5 addendum 2026-04-27 pour la liste exhaustive.

**Note paramètre racine `migration_mode_active` (propagation §13 2026-04-27)** : paramètre boolean racine (hors namespace) destiné à activer/désactiver le mode migration MTS-1 → TMS Savr (J0 → J+30). Édition réservée `admin_tms` (Val), audit obligatoire `M13_MIGRATION_MODE_TOGGLE` enrichi (raison libre obligatoire pour désactivation). Friction UI sur désactivation : modale confirmation + saisie texte `DESACTIVER MIGRATION` requise (EC11 §13). Cf. [[13 - Migration MTS-1#13.4 Mode migration (paramètre + filtre + bandeau)]].

**Filtres haut de page** :
- Namespace (dropdown) : `facturation`, `attribution`, `zones`, `stock`, `alertes`, `mobile`, `auth`, `intégrations`, `m03_*`, `m04_*`, `m05_*`, `m07_*`, `m08_*`, `m10_*`, `m11_*`, `m13_*`.

> **Note namespace `attribution` (audit cohérence A1 2026-05-09)** : ce namespace ne contient plus que **1 paramètre** modifiable TMS (`province_tri_secondaire_code`). Les 9 autres paramètres (`regle_ag_*`, `a_toutes_indisponible*`, `everest_codes_postaux`) ont migré côté Plateforme dans `parametres_algo` (source de vérité unique V1, V2 à reétudier). M13 affiche ces paramètres en **lecture seule** dans une sous-section dédiée "Paramètres attribution AG IDF (source Plateforme)" avec bouton "Modifier dans Back-office Plateforme" (lien externe app.gosavr.io). Pas d'édition possible côté TMS.
- Recherche texte sur `cle` ou `libelle`.
- Toggle "Modifiables par moi uniquement" (filtre `current_user.role IN modifiable_par[]`).

**Colonnes tableau** :
- Namespace · Clé · Libellé · Valeur actuelle · Unité · Type · Modifiable par · Dernière maj (date + user) · Actions.
- **Badge `[hot reload]`** si `requires_redeploy = false` (cf. D6/D12).
- **Badge `[redéploiement requis]`** rouge si `requires_redeploy = true` → édition possible mais alerte explicite avant save.

**Action "Modifier valeur"** (admin_tms uniquement, ou ops_savr si `'ops_savr' = ANY(modifiable_par)`) :
- Modale : libellé + description + champ valeur typé (`number`/`integer` = input numérique avec `valeur_min`/`valeur_max` enforced ; `boolean` = toggle ; `string` = textarea ; `json` = éditeur JSON avec validation schema ; `date` = datepicker).
- Champ commentaire **obligatoire** (motif édition, audité).
- Bouton "Enregistrer" → trigger DB met à jour `parametres_tms.valeur` + `derniere_maj_par_user_id` + `updated_at` + INSERT `audit_logs`.
- Si `requires_redeploy = true` → message d'alerte explicite : *"Ce paramètre nécessite un redéploiement de l'app pour être pris en compte par les clients déjà connectés. Confirmes-tu ?"*

**Action "Voir historique valeurs"** (lien sur ligne) :
- Sous-modale : timeline lecture seule depuis `audit_logs WHERE table_name='parametres_tms' AND row_id=<param_id> ORDER BY created_at DESC`.
- Affichage : date · acteur · before/after `diff` · commentaire.

**RLS** : lecture tous staff TMS (admin_tms + ops_savr) ; écriture conditionnée à `current_user.role` ∈ `parametres_tms.modifiable_par[]` (policy déjà §09 ligne 1218-1238).

**Tables mutées** : `parametres_tms` (UPDATE), `audit_logs` (INSERT trigger).

---

### E3 — Gestion users TMS

#### E3.a — Liste users

**Layout** : tableau + filtres + bouton "+ Créer user".

**Filtres** :
- Statut : `actif` / `desactive` / `tous`.
- Rôles : checkboxes multi (`admin_tms`, `ops_savr`, `manager_prestataire`, `chauffeur`).
- Prestataire (dropdown, si rôle prestataire ou chauffeur).
- Recherche texte sur nom/email.

**Colonnes** :
- Nom · Email · Rôles (badges) · Prestataire (si applicable) · Statut · MFA actif · Dernière connexion · Devices trusted count · Actions (Voir détail · Désactiver/Réactiver).

**Pagination** : 50 lignes/page.

**RLS** : `admin_tms` uniquement.

#### E3.b — Détail user

**Layout** : header user + 4 onglets (Identité, Rôles & accès, Devices, Audit).

**Onglet Identité** :
- Champs lecture seule : email (créé via Edge Function, jamais éditable), date création, dernière connexion.
- Champs éditables : nom, prénom, téléphone (si renseigné), prestataire_id (si rôle prestataire).
- Bouton "Modifier" → modale édition + commentaire obligatoire → audité.

**Onglet Rôles & accès** :
- Liste rôles cochés/décochés (validation server-side : combinaisons interdites refusées, cf. §09 ligne 478).
- Statut : Actif / Désactivé (toggle + raison obligatoire si désactivation).
- Bouton "Reset MFA TOTP" (admin_tms uniquement, si user porte un rôle MFA-required) → confirmation forte → INSERT `audit_logs` `acteur_meta = {action:'reset_mfa', target_user_id}` → user concerné est forcé à reconfigurer MFA au prochain login.
- **Bouton "Forcer rotation password" (refondu revue sobriété §05 2026-05-01 B1)** : Admin TMS uniquement. **Action V1** : invalide toutes les sessions actives du user cible (`auth_sessions_tms.revoked_at = now()`) + envoie un magic link reset password (TTL 30 min) à l'email du user. Au prochain accès, l'user doit cliquer le magic link pour définir un nouveau password. supprimé V1 (colonne supprimée). Confirmation forte + commentaire optionnel + audit log `action=PASSWORD_FORCE_ROTATION` + `acteur_meta = {target_user_id, motif}`.
- **Pas de bouton "Supprimer définitivement"** V1 (D7 : soft delete uniquement).

**Onglet Devices trusted** :
- Liste devices : User-agent · IP de 1ère reconnaissance · Date 1ère reconnaissance · Dernière activité · Actif (oui/non).
- Bouton "Révoquer ce device" (admin_tms ou self) → device sort de la liste trusted, prochaine connexion = MDP + MFA (si admin_tms cible).
- Bouton "Révoquer tous mes devices" (self) → logout sur tous les devices.
- Cap V1 = 3 devices trusted simultanés par user (D14). Si tentative d'ajout d'un 4ème → message *"Tu as atteint la limite de 3 devices. Révoque-en un avant de te connecter sur un nouveau."*.

**Onglet Audit** *(sobriété M13 C1 2026-04-30)* :
- Bouton "Voir logs de cet user →" → ouvre E4 préfiltré `acteur=<user_id> OR row_id=<user_id>`. Pas de composant audit embarqué dans E3.b.
> **Motif** : duplication partielle de E4. Économise 1 composant UI + 1 query embarquée. Accès en 1 clic depuis E3.b.

**RLS** : `admin_tms` uniquement (sauf onglet Devices accessible en self pour `ops_savr` également).

#### E3.c — Création user (modale)

**Champs** :
- Type d'user (radio) : `Staff Savr (Admin TMS / Ops Savr)` / `Manager prestataire` / `Chauffeur`.
- Email (obligatoire, validation format + unicité).
- Nom + prénom.
- Téléphone (obligatoire si chauffeur, optionnel sinon).
- Rôles (checkboxes selon type) : si Staff → `admin_tms` et/ou `ops_savr`. Si Manager → `manager_prestataire` (1 seul). Si Chauffeur → `chauffeur` (1 seul, M05).
- Prestataire (obligatoire si Manager ou Chauffeur, dropdown depuis `shared.prestataires WHERE statut='actif'`).
- Bouton "Créer + envoyer magic link initial".

**Workflow back** (simplifié revue sobriété §05 2026-05-01 B1) :
1. Edge Function `upsert_user_tms` : valide combinaisons rôles (rejet 400 si interdit, cf. §09 ligne 478), valide prestataire_id si applicable, INSERT `users_tms` avec `statut='en_attente_premiere_connexion'` ( supprimé V1, colonne supprimée). INSERT `auth.users` Supabase **sans password initial**.
2. Génère magic link via Supabase Auth (TTL 30 min) **pour tous les rôles V1** (manager, chauffeur, ops, admin) — uniformisé B1, plus de chemin "password initial fourni Admin".
3. Envoie email d'activation via template (template_key `user_first_login`, géré dans M11 templates) — message "Définir mon mot de passe" + lien magic link, **aucun password en clair transmis**.
4. Trigger DB `INSERT audit_logs`.

**Alerte M11** émise si erreur SMTP : `m13_user_creation_email_failed` (warning).

**RLS** : `admin_tms` uniquement.

---

### E4 — Audit log

**Layout** : tableau paginé + filtres + export CSV.

**Filtres** :
- Période (date range, default 7 derniers jours, max range V1 = 90 jours pour perf, au-delà = export CSV).
- Acteur (multi-select users_tms ou type `webhook`/`cron`/`migration`/`systeme`). Filtre additionnel "Source webhook" (`plateforme`/`everest`/...) lit `acteur_meta.source` jsonb (revue sobriété §04 2026-04-30 D2 — fusion `webhook_plateforme` + `webhook_everest` → `webhook`, détail dans `acteur_meta.source`).
- Table (multi-select : `tournees`, `pesees`, `parametres_tms`, `users_tms`, `factures_prestataires`, etc.).
- Action (`insert` / `update` / `delete` / `soft_delete` / `restore`).
- Recherche texte sur `commentaire`.
- Recherche par `row_id` (UUID copy-pasted).

**Colonnes** :
- Date · Acteur (user ou système) · Table · Action · Row ID (lien) · Commentaire (tronqué) · Actions (Voir diff).

**Action "Voir diff"** :
- Modale plein écran : before / after en split JSON syntaxisé. Champs modifiés highlightés. Champs inchangés masqués.
- Bouton "Voir contexte" : si `request_id` non null → liste des autres `audit_logs` partageant le même `request_id` (mutations groupées) + `integrations_logs` correspondant.
- Bouton "Voir ressource actuelle" → ouvre l'écran métier de la ressource (M02 collecte, M04 tournée, etc.).

**Export CSV** :
- Bouton "Exporter résultats filtrés".
- Limite V1 : 10 000 lignes par export. Au-delà → message *"Affine les filtres ou contacte un dev pour export Postgres direct"*.
- Format CSV : `created_at, acteur, table, action, row_id, commentaire, diff_json` (diff sérialisé en string).

**RLS** : `admin_tms` lecture tout · `ops_savr` lecture tout · pas d'écriture (immutable D5).

**Performance cibles** : query paginée < 500ms sur range 7j, < 2s sur range 90j (index BRIN sur `created_at` + index par `table_name, row_id, created_at DESC`). Partition mensuelle déjà spec §04.

---

### E5 — Secrets API

**Layout** : tableau read + actions, pas d'édition inline.

**Colonnes** :
- Nom secret (ex: `pennylane_api_token`, `everest_client_secret`, `strike_webhook_signing_key`, `marathon_webhook_signing_key`, `bridge_api_token`)
- Service (badge : Pennylane / Everest / Strike / Marathon / Bridge)
- Type (token / webhook URL / signing key)
- Valeur masquée (`••••••••12ab` — 4 derniers chars uniquement)
- Dernière rotation (date + user)
- Expire le (si applicable, ex. token Pennylane 90j)
- Actions : Voir (révéler 30s) · Rotater · Tester

**Action "Voir" (reveal 30s)** :
- Confirmation modale : *"Le secret va être révélé en clair pendant 30 secondes. Cette action est auditée."*
- Edge Function `reveal_secret(secret_id)` : retourne valeur en clair, JWT 30s, INSERT `audit_logs` `acteur_meta = {action:'secret_reveal', secret_name}`.
- Reveal V1 = simple display (pas de copy auto). Au bout de 30s, masquage UI.

**Action "Rotater"** :
- Modale : champ "Nouvelle valeur" (paste depuis Pennylane/Everest UI).
- Bouton "Tester avant validation" → Edge Function tente une requête de test (ex. `GET /me` Pennylane, `POST /availabilities` Everest, ping Bridge).
- Si test OK → bouton "Valider rotation" → Edge Function `rotate_secret` : UPDATE Vault + INSERT `audit_logs` action `SECRET_ROTATED` (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 `m13_secret_rotated` info retirée du catalogue, audit_logs reste source de vérité).
- Si test KO → warning, bouton "Forcer rotation quand même" (audité).

**Action "Tester"** :
- Lance le test sans rotation (vérification connectivité).

**Secrets V1 listés** :
| Nom | Service | Type | Expire | Source actuelle (à migrer) |
|-----|---------|------|--------|----------------------------|
| `pennylane_api_token_v2` | Pennylane | Bearer token | 90j (rotation manuelle) | `.env` — à migrer Vault |
| `everest_client_id` | Everest | Client ID | jamais | `.env` |
| `everest_client_secret` | Everest | Client secret | sur demande Everest | `.env` |
| `strike_webhook_signing_key` | Strike | HMAC signing key | rotation 12 mois | À créer (M01 utilise déjà HMAC) |
| | | | | |
| `bridge_api_token` | Bridge | Bearer token | 90j | `.env` |

**Architecture technique** :
- Stockage : **Supabase Vault** (table `vault.secrets` chiffrée). 1 ligne par secret avec `name`, `secret` (chiffré), `description`, `created_at`, `updated_at`.
- Accès en clair : **uniquement** via Edge Function authentifiée + role `admin_tms` (vérifié par `auth.user_has_role('admin_tms')` côté EF). Front ne reçoit jamais le secret en clair sauf via le reveal 30s.
- Métadonnées (dernière rotation, expire le, dernière utilisation) : table parallèle `tms.secrets_metadata` (lisible RLS, jointure par `secret_name`).
- Audit : chaque reveal, rotation, test = INSERT `audit_logs` avec `acteur_meta` détaillé.

**RLS** : table `tms.secrets_metadata` lisible `admin_tms` only. Vault `secrets` accessible uniquement via Edge Function (jamais directement via PostgREST côté client).

---

### E6 — Monitoring intégrations

#### E6.a — Liste events

**Layout** : tableau paginé + filtres + actions bulk.

**Filtres** :
- Période (default 24h).
- System : `plateforme` / `everest` / `autre` / tous.
- Direction : `entrant` / `sortant` / tous.
- Type event (multi-select sur `type_event` distinct).
- Statut : `succes` / `echec_retry` / `echec_final` / `duplique` / tous.
- Recherche par `event_id` (UUID).
- Recherche par `ressource_id` (UUID, ex. tournée concernée).

**Colonnes** :
- Date · System · Direction · Type · Statut (badge couleur) · Tentative # · Code HTTP · Ressource (lien vers écran métier) · Latence ms · Actions.

**Compteurs en haut** :
- Total events 24h
- Échecs finaux 24h (rouge si > 0)
- Latence p95 24h
- Top 3 endpoints en erreur 24h

**Propagation M14 (2026-04-25 + sobriété 2026-04-30)** : tab Everest dans E6 (granularité **call API**, vs `/everest` métier qui compte des **missions**, cf. clarification scope sobriété 2026-04-30 C_M14_01) :

- **Section santé API** : lit la **vue dérivée `tms.vue_prestataires_everest_status`** (revue sobriété §04 2026-04-30 A3 — colonnes `last_everest_ping_at/status` supprimées V1, info dérivée de `integrations_logs(system='everest', type_event='m14_ping')`) du prestataire A Toutes! + bouton "Test connexion Everest" (déclenche M14 W8). Bandeau "incident actif" si `m14_everest_auth_failed` ou `m14_everest_timeout` non-acquittés.
- **Section latence** *(sobriété M13 B2 2026-04-30)* : **p95 global 24h** sur tous les appels Everest (`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)` sur `integrations_logs WHERE system='everest' AND direction='outbound' AND created_at >= now()-1d`). Les p50/p99 et la ventilation par endpoint sont dégagés V1 — disponibles via Supabase Studio si investigation fine nécessaire.
- **Section taux d'erreurs** : taux 2xx/4xx/5xx par endpoint 7j + taux retry effectifs + taux échec final (post-retry).
- **Section audit webhooks 7j** (absorbé ex-M14 E3, sobriété 2026-04-30 A_M14_05) : table lecture seule des webhooks Everest reçus 7j (timestamp, event_type, signature OK/KO, mission_id, client_ref, statut traitement, action TMS, retry count, dernière erreur). Filtres event_type + statut signature. Action "Voir payload" (modal JSON). KPIs synthétiques : total webhooks reçus 7j, taux signature invalide, taux event_type inconnu. **Pas de bouton "Replay"** (sobriété 2026-04-30 A_M14_04 — Admin replay via SQL direct sur Supabase Studio si cas exceptionnel).
- **Section cache `everest_coverage_cache`** : taille cache + bouton "Invalider cache complet" (Admin). **Hit rate cache 7j retiré** (sobriété 2026-04-30 A_M14_06 — métrique de tuning sans valeur opérationnelle V1, à reconsidérer V1.1).
- **Section paramètres** : raccourci vers M13 E2 namespace `m14` (5 paramètres après suppression `m14_dashboard_polling_ms` sobriété 2026-04-30 A_M14_01).

Page métier `/everest` (M14 E1, E2, E4) accessible Ops + Admin pour le drilldown métier (liste missions, détail, failover E4). E3 indépendant supprimé (absorbé ici). M13 E6 reste réservé au monitoring système et à l'audit webhooks lecture seule.

#### E6.b — Détail event + replay

**Layout** : modale ou page dédiée.

**Sections** :
- **Identification** : event_id, type, system, direction, statut, occurred_at, tentative_num.
- **Requête** : URL, http_method, payload (JSON syntaxisé, PII masqués selon règles §04).
- **Réponse** : http_status, reponse (JSON), duree_ms.
- **Tentatives précédentes** : si `tentative_num > 1`, liste des lignes `integrations_logs` partageant `event_id` *(clé d'idempotence = `body.event_id`, ex-mention "idempotency-key" corrigée 2026-06-07 F2 — header supprimé du contrat)*.
- **Audit corrélé** : si `request_id` non null, liens vers `audit_logs WHERE request_id = <X>`.

**Action "Replay manuel"** (uniquement si `statut='echec_final'`) :
- Confirmation modale : *"Cet event sera retraité comme s'il venait d'arriver. Si l'event est entrant et déjà partiellement traité, des effets duplicata sont possibles. La table inbox protège contre ça via event_id, mais le replay réinjecte le payload complet. Confirme."*
- Edge Function `replay_event(event_id)` :
  - Si direction `entrant` : récupère payload depuis `integrations_logs`, repush vers handler interne (passe par `integrations_inbox` qui dédup si déjà traité).
  - Si direction `sortant` : repush vers URL externe (Plateforme/Everest) avec **`body.event_id` original conservé** (la dédup inbox destinataire protège du double traitement), nouvelle ligne `integrations_logs` **`tentative_num = 1`** (nouvelle chaîne de tentatives) + `acteur_meta = {action:'manual_replay', original_log_id}` *(tranché Val 2026-06-07 test-scenarios F2 — ex-"tentative_num incrémenté" corrigé, aligné W6.c)*.
- INSERT `audit_logs` action `EVENT_MANUAL_REPLAY` (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 `m13_event_manual_replay` info retirée du catalogue, audit_logs reste source de vérité).

**Action "Marquer comme résolu manuellement"** (sans replay, si Admin a corrigé hors-bande) :
- Update `integrations_logs.statut` → `succes_manuel`.
- Audit-log obligatoire avec commentaire.

**RLS** : `admin_tms` lecture + replay · `ops_savr` lecture seule, **pas de replay** (D9).

**Tables mutées** : `integrations_logs` (INSERT pour replay), `audit_logs` (INSERT trigger).

---

#### E6.c — Collectes orphelines à réconcilier (QO#10 M02 — collectes manuelles)

**Contexte** : une collecte créée manuellement par l'Admin TMS pendant une panne Plateforme (M02 §7.3, `origine='manuelle_tms'`, `plateforme_collecte_id IS NULL`) doit être réconciliée avec la collecte Plateforme correspondante quand le webhook E1 finit par arriver — sinon doublon.

**Layout** : liste dédiée (onglet de E6 ou écran propre).

**Contenu** :
- Liste des `collectes_tms WHERE origine='manuelle_tms' AND plateforme_collecte_id IS NULL` (orphelines en attente).
- Pour chaque orpheline, **suggestion auto de match** avec les collectes reçues par webhook E1 non encore appariées : critère `(plateforme_lieu_id identique, heure_collecte ±30 min, plateforme_traiteur_id identique, nb_pax ±10%)`.

**Actions Admin TMS** :
- **Fusionner** : la collecte manuelle adopte `plateforme_collecte_id` / `plateforme_evenement_id` / `plateforme_programmateur_id` de la collecte webhook ; la ligne webhook en doublon est marquée rejetée (event DLQ `succes_manuel`, pas de seconde collecte active). Le dispatch déjà fait sur la collecte manuelle est préservé. Audit log obligatoire.
- **Garder manuelle (ignorer)** : si aucun match (collecte réellement hors Plateforme), l'orpheline reste telle quelle ; sortie de la liste après acquittement.

**RLS** : `admin_tms` lecture + fusion · `ops_savr` lecture seule.

**Tables mutées** : `collectes_tms` (UPDATE ids Plateforme), `integrations_inbox`/`integrations_logs` (marquage doublon), `audit_logs`.

---

### E7 — Wizard onboarding prestataire

**Pourquoi un wizard** : créer un prestataire actif end-to-end (Strike, Marathon, A Toutes!) demande :
1. Création `shared.prestataires` (M06)
2. Création first user `manager_prestataire` (M03)
3. Activation portail self-service (flag `prestataire.portail_actif = true`)
4. Envoi magic link initial au manager

Sans wizard, ces étapes sont éclatées sur 2 modules → risque d'oubli (manager créé mais portail désactivé → magic link invalide). Wizard E7 = check-list garantie. **Refondu revue sobriété §05 2026-05-01 D2** : la **grille tarifaire devient obligatoire à l'activation prestataire** (E7.3 step 4 **bloquant**). Sans grille active publiée → activation `actif` refusée par trigger DB `trg_prestataire_grille_obligatoire` (RAISE EXCEPTION). Plus d'alerte post-activation, plus de fenêtre temporelle entre activation et création grille.

> **Motif sobriété B4 (2026-04-30)** : E7.2 formulaire multi-type grille retiré. Dupliquer l'UI grille (forfait fixe / km / vacations paliers / matricielle zone / matricielle zone×type) dans un wizard est coûteux et redondant avec M07. La valeur du wizard est l'orchestration (portail + manager + activation), pas la saisie de grille.

#### E7.1 — Étape 1 : Identité prestataire

**Champs** (alignés M06) :
- Nom · SIRET · Code Strike/Marathon/Everest si applicable · Email contact · Téléphone · Adresse · Coords GPS entrepôt · Type de prestation (collecte / transport / les deux) · Rayon d'intervention km.
- Bouton "Suivant" → INSERT `shared.prestataires` `statut='en_onboarding'` + `audit_logs`.

#### E7.2 — Étape 2 : Grille tarifaire initiale (RÉACTIVÉE bloquante revue sobriété §05 2026-05-01 D2)

**Refondu D2** : étape **bloquante** non skippable. L'activation prestataire (E7.4) refuse la transition `en_onboarding → actif` tant qu'aucune grille active n'est publiée pour ce prestataire (trigger DB `trg_prestataire_grille_obligatoire`).

**Champs** : INSERT `tms.grilles_tarifaires_prestataires` :
- `formule_id` (sélection parmi les 5 formules `vacations_paliers`, `grille_matricielle_zone_type_course`, `grille_matricielle_zone`, `forfait_km`, `forfait_fixe`)
- `type_vehicule_id` (NULL = grille générique tous véhicules, ou sélection spécifique)
- `date_debut_validite` (default = `today + 1 jour`, anti-rétroactivité R2.8)
- `parametres_formule` JSONB (selon formule choisie : paliers, cellules, tarifs, etc.)
- `statut = 'actif'`

**Bouton "Suivant"** : disponible uniquement si grille validée. Validation côté Edge Function (cohérence formule_id ↔ parametres_formule + non-chevauchement EXCLUDE USING gist).

**Cas particulier "grille à formaliser plus tard"** : Admin peut créer une grille minimale avec `forfait_fixe = 0€` + `date_debut_validite` = today + 1, marquage interne `placeholder = true` (à formaliser ultérieurement avant la première tournée). Ne casse pas le workflow d'attribution M12 ni le calcul M07.

#### E7.3 — Étape 3 : First manager + magic link *(ex-E7.2 ; renuméroté revue sobriété §05 2026-05-01 D2)*

**Champs** :
- Nom + prénom manager · Email · Téléphone · Activation portail self-service (toggle, default ON pour Strike/Marathon/A Toutes!, OFF pour province).
- Si toggle OFF → étape skipped, prestataire géré uniquement via Ops Savr (M02, pas de portail).
- Si toggle ON → INSERT `users_tms` rôle `manager_prestataire` `statut='en_attente_premiere_connexion'`, génère magic link, envoie email (template `manager_first_login` M11).

#### E7.4 — Étape 4 : Récap + activation *(ex-E7.3 ; renuméroté revue sobriété §05 2026-05-01 D2)*

**Affichage** :
- Récap des 3 étapes précédentes.
- Liste check-list :
  - [✓] Prestataire créé (`shared.prestataires.id`)
  - [✓] **Grille tarifaire active publiée** (refondu revue sobriété §05 2026-05-01 D2 — bloquant, ex-`m13_prestataire_sans_grille_post_onboarding`)
  - [✓ ou ⏭ skipped] First manager + magic link envoyé
- Bouton "Activer le prestataire" → UPDATE `shared.prestataires.statut` `en_onboarding` → `actif` + INSERT `audit_logs` action `prestataire_activation`. **Trigger DB `trg_prestataire_grille_obligatoire`** vérifie présence grille active : RAISE EXCEPTION si absente. → **Supprimée V1 (revue sobriété §05 2026-05-01 D2)**, cas impossible par construction.

**Workflow technique global E7** :
- Toutes les opérations sont wrappées dans une **transaction** côté Edge Function `wizard_onboarding_prestataire`.
- Si une étape échoue (ex. SMTP down sur magic link) → rollback complet ou ré-essai possible avec état persisté en `wizard_onboarding_prestataire_state` (table temporaire scope V1 = simple, V1 = pas d'état persisté, on demande à Admin de recommencer si crash).

**RLS** : `admin_tms` uniquement.

---

### E8 — Codes alertes (lecture catalogue)

> **Dégagée Bloc 6 C3 (revue sobriété 2026-04-28)** — table `alertes_codes_overrides` supprimée V1. E8 devient **lecture seule** du catalogue `alertes_catalogue`. Criticité figée par seed. L'override runtime était redondant avec la possibilité de modifier directement `alertes_catalogue.criticite_par_defaut` en admin Supabase Studio (accès Val/Louis). W8 et Edge Function `upsert_alerte_code_override` retirées.

**Layout** : tableau lecture seule.

**Colonnes** :
- Code canonique · Module source (M01-M12) · Libellé · **Criticité** (seed uniquement) · Scope (admin / ops / manager) · Auto-résolvable · Activé.










**RLS** : lecture `alertes_catalogue` = tous staff (policy existante M11).

**Tables mutées** : aucune (écran lecture).

---

### E9 — Impersonation (modale globale)

**Pourquoi** : support utilisateur. Val/Louis veulent "voir l'app comme la voit un manager Strike" pour debug rapide.

**Déclenchement** :
- Depuis E3.b détail user → bouton "Se connecter en tant que cet user" (admin_tms uniquement, target user `actif` uniquement).

**Workflow** :
1. Modale confirmation : *"Tu vas démarrer une session impersonation en tant que [nom user]. Toutes tes actions seront tracées sous ton user réel + flag impersonation. Sortie possible via bandeau supérieur. Confirmer ?"* + champ commentaire obligatoire (motif support).
2. Edge Function `impersonation_start(target_user_id, motif)` :
   - Génère JWT spécial avec claims `impersonator_user_id = current_user.id`, `effective_user_id = target_user_id`, `roles = target_user.roles`, `prestataire_id = target_user.prestataire_id`, `exp = now() + 60 min`.
   - INSERT `audit_logs` `acteur_user_id = current_user.id`, `acteur_meta = {action:'impersonation_start', target_user_id, motif}`. (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 `m13_impersonation_started` info retirée du catalogue, audit_logs reste source de vérité.)
   - Notif self-service au target user via email + push s'il a une session active : *"Un Admin a démarré une session de support sur ton compte. Motif : [motif]."* (notif directe Resend, plus passée par M11).
3. Front change l'état "session impersonation active", affiche **bandeau orange persistant** en haut : *"⚠ Session impersonation : tu es connecté comme [target nom]. [Sortir]"*. Bandeau visible sur toutes les pages M03/M05/M11/etc. (D13).
4. **Toutes les mutations** faites pendant la session sont tracées avec `audit_logs.acteur_user_id = impersonator (Val)` ET `audit_logs.acteur_meta.impersonation_target_id = target user` (D15). Permet la traçabilité réelle "qui a fait quoi" même en impersonation.

**Sortie impersonation** :
- Bouton "Sortir" du bandeau ou expiration JWT 60 min auto.
- Edge Function `impersonation_stop` : invalide JWT, INSERT `audit_logs` action `impersonation_stop` + durée session.
- Notif au target user *"La session de support sur ton compte est terminée."*.

**Garde-fous** :
- Pas d'impersonation possible vers un autre `admin_tms` (rejet 400).
- Pas d'impersonation vers un user `desactive`.
- Pas d'impersonation cascadée (Val impersonate manager X → manager X ne peut pas relancer une impersonation depuis sa session).
- Pas d'accès aux secrets E5 ni à la modale rotation pendant impersonation (même si Val impersonate Louis admin_tms, ce qui est interdit de toute façon).

**RLS** : `admin_tms` uniquement.

**Tables mutées** : `audit_logs` (INSERT manuel + via triggers), `tms.impersonation_sessions` (nouvelle table de tracking, INSERT/UPDATE).

**Architecture table `tms.impersonation_sessions`** :
| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid PK | |
| `impersonator_user_id` | uuid FK users_tms | Qui démarre |
| `target_user_id` | uuid FK users_tms | Cible |
| `motif` | text NOT NULL | Justification support |
| `started_at` | timestamptz NOT NULL | |
| `ended_at` | timestamptz | NULL = active |
| `end_reason` | text | `manual_stop` / `auto_expiration` / `forced_logout` |

**Index** : `(impersonator_user_id, started_at DESC)`, `(target_user_id, started_at DESC)`.

---

## 5. Workflows détaillés

### W1 — Édition d'un paramètre `m0X_*`

**Acteur** : `admin_tms` (ou `ops_savr` si autorisé via `modifiable_par[]`).

```
1. Navigue E2 Paramètres
2. Filtre par namespace ou recherche
3. Click "Modifier" sur ligne
4. Modale : nouvelle valeur (validation type + min/max client + server)
5. Saisit commentaire obligatoire (>10 chars)
6. Click "Enregistrer"
7. Front POST → Edge Function `update_parametre(id, valeur, commentaire)`
8. EF vérifie role ∈ modifiable_par[] (sinon 403)
9. EF UPDATE parametres_tms SET valeur=$1, derniere_maj_par_user_id=$2, updated_at=now() WHERE id=$3
10. Trigger DB INSERT audit_logs (action='update', diff={before,after}, commentaire)
11. EF retourne 200 + nouvelle valeur
12. Si requires_redeploy=true → toast "Paramètre enregistré. Un redéploiement est nécessaire pour les clients déjà connectés."
13. Si requires_redeploy=false → toast "Paramètre enregistré. Prise en compte sous 60s (cache Edge)."
```

**Alertes émises** :
- Aucune en cas de succès.
- `m13_parametre_edition_validation_echec` warning si validation server-side échoue (ex. valeur hors min/max).

### W2 — Création user staff Savr

```
1. E3.c modale création
2. Type = Staff Savr, rôles = [admin_tms] ou [ops_savr] ou [admin_tms, ops_savr]
3. Email + nom + prénom
4. Click "Créer + envoyer magic link"
5. Front POST → EF `upsert_user_tms(email, nom, prenom, roles, prestataire_id=null)`
6. EF valide combinaisons rôles (rejet 400 si manager_prestataire+admin_tms ou autre interdit)
7. EF INSERT users_tms (statut='en_attente_premiere_connexion', mfa_active=false)
8. EF appelle Supabase Auth pour générer magic link
9. EF envoie email template `staff_first_login` (template M11)
10. Trigger audit_logs
11. Si SMTP fail → alerte m13_user_creation_email_failed warning + toast Admin "Email non envoyé, ré-essaie ou copie le lien manuellement"
12. UI ajoute la ligne au tableau E3.a
```

**État user après W2** : `en_attente_premiere_connexion`.

**Premier login user** :
- Click magic link email → Auth Supabase callback → user créé dans Auth → si role admin_tms → flow MFA setup obligatoire (D11) → user crée TOTP → device marqué trusted → statut → `actif`.

### W3 — Désactivation user

```
1. E3.b détail user → onglet Rôles & accès → toggle Statut OFF
2. Modale : raison désactivation obligatoire (>20 chars)
3. EF `deactivate_user(id, raison)` :
   a. UPDATE users_tms SET statut='desactive', desactivee_at=now(), desactivee_par_user_id=current_user.id, raison_desactivation=$raison
   b. Révoque toutes sessions actives (DELETE auth.sessions WHERE user_id=$id)
   c. Révoque tous devices trusted (UPDATE users_tms_devices_trusted SET actif=false)
   d. Audit-log
4. UI bascule statut, badges grisés
```

**Effets cascade** :
- User ne peut plus se logger.
- Si manager_prestataire et seul manager du prestataire → alerte `m13_prestataire_sans_manager_actif` warning vers Ops + Admin.
- FK conservées intactes (audit_logs, tournees.created_by, etc.) — D7 soft delete.

### W4 — Reset MFA TOTP d'un user

**Cas d'usage** : user a perdu son téléphone TOTP, ne peut plus se connecter.

```
1. User contacte Val/Louis (canal externe)
2. Admin va E3.b → onglet Rôles & accès → bouton "Reset MFA TOTP"
3. Modale double confirmation : "Cette action invalide le TOTP actuel. L'user devra reconfigurer un nouveau TOTP au prochain login. Confirme."
4. Champ commentaire obligatoire
5. EF `reset_mfa_user(target_user_id, commentaire)` :
   a. DELETE auth.mfa_factors WHERE user_id=$target_user_id
   b. UPDATE users_tms SET mfa_active=false WHERE id=$target_user_id
   c. INSERT audit_logs acteur_meta={action:'reset_mfa', target_user_id, commentaire}
   d. Notif email à target user "Ton MFA a été réinitialisé par un Admin"
6. Target user à son prochain login → forcé à reconfigurer MFA
```

### W5 — Rotation d'un secret

```
1. E5 → ligne secret → action "Rotater"
2. Admin colle nouvelle valeur (depuis Pennylane/Everest UI externe)
3. Click "Tester avant validation"
4. EF `test_secret(secret_name, new_value)` lance requête de test (sans persistance)
   - Si OK → bouton "Valider rotation" activé
   - Si KO → message erreur + bouton "Forcer quand même"
5. Click "Valider rotation"
6. EF `rotate_secret(secret_name, new_value, commentaire)` :
   a. UPDATE vault.secrets SET secret=$new_value WHERE name=$secret_name
   b. UPSERT tms.secrets_metadata SET derniere_rotation_at=now(), derniere_rotation_par_user_id=current_user.id
   c. INSERT audit_logs acteur_meta={action:'secret_rotate', secret_name, commentaire} (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 m13_secret_rotated info retirée du catalogue, audit_logs reste source de vérité)
7. UI met à jour la ligne avec nouvelle date rotation et masque
```

### W6 — Replay d'un event en échec final

```
1. E6.a → filtre statut=echec_final → click ligne
2. E6.b détail event
3. Admin lit payload, vérifie si la cause de l'échec a été corrigée
4. Click "Replay manuel"
5. Modale confirmation + commentaire
6. EF `replay_event(log_id, commentaire)` :
   a. SELECT integrations_logs WHERE id=$log_id
   b. Si direction=entrant :
      - Construit le webhook artificiellement avec event_id original (passe par integrations_inbox dédup)
      - Re-pousse dans le handler interne approprié
   c. Si direction=sortant :
      - Re-POST vers URL d'origine avec payload original, body.event_id original conservé *(tranché Val 2026-06-07 F2 — ex-"nouveau Idempotency-Key" corrigé : header supprimé du contrat §08, dédup = body.event_id ; la dédup inbox destinataire protège du double traitement)*
      - INSERT integrations_logs nouvelle ligne tentative_num=1 (nouvelle chaîne), acteur_meta={action:'manual_replay', original_log_id}
   d. INSERT audit_logs action `EVENT_MANUAL_REPLAY` (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 m13_event_manual_replay info retirée du catalogue, audit_logs reste source de vérité)
7. UI rafraîchit, nouvelle ligne avec statut résultant
```

### W7 — Wizard onboarding prestataire (E7)

```
1. E1 ou E7 démarrer → wizard (4 étapes — refondu revue sobriété §05 2026-05-01 D2 grille bloquante)
2. Étape 1 (E7.1) : champs identité prestataire
   → INSERT shared.prestataires statut='en_onboarding' + audit
3. Étape 2 (E7.2) : grille tarifaire initiale (**bloquant**, revue sobriété §05 2026-05-01 D2)
   → INSERT tms.grilles_tarifaires_prestataires statut='actif' + audit
4. Étape 3 (E7.3) : first manager (skippable si province no portail)
   → si OK INSERT users_tms manager_prestataire + magic link + audit
5. Étape 4 (E7.4) : récap + activation
   → UPDATE shared.prestataires statut='actif' (trigger trg_prestataire_grille_obligatoire vérifie grille présente, RAISE EXCEPTION si absente) + audit
→ **Supprimé revue sobriété §05 2026-05-01 D2** (cas impossible par construction)
6. Toast "Prestataire activé. Grille tarifaire active publiée."
```

**Atomicité** : V1 = pas de transaction unique. Chaque étape commit indépendamment. Si crash sur étape 2 (par ex. SMTP) → l'admin reprend manuellement (prestataire est déjà créé étape 1, statut `en_onboarding`).

### W8 — Override criticité code alerte

> **Dégagée Bloc 6 C3 (revue sobriété 2026-04-28)** — table `alertes_codes_overrides` supprimée, Edge Function `upsert_alerte_code_override` retirée. E8 = lecture seule V1.






### W9 — Impersonation start/stop

Cf. E9 ci-dessus.

### W10 — Devices trusted : ajout, listing, révocation

**Ajout (auto, pas via M13)** :
- À la 1ère connexion réussie sur un device (device_fingerprint = hash(user-agent + IP class C + device cookie persistent), validation MFA pour admin_tms) → INSERT `users_tms_devices_trusted`.
- Si user a déjà 3 devices actifs → connexion bloquée avec message dédié.

**Listing (E3.b onglet Devices)** : tous les devices trusted du user, actif/inactif.

**Révocation** :
- Self : E3.b onglet Devices → "Révoquer ce device" ou "Révoquer tous mes devices".
- Admin sur autre user : E3.b user cible → onglet Devices → "Révoquer ce device".
- Effet : UPDATE `users_tms_devices_trusted.actif=false`. Prochaine connexion sur ce device = re-MFA (si admin_tms) ou re-MDP simple (si ops_savr).

### W11 — Alerte m13_session_expirée_proche

> **Dégagée sobriété M13 A1 (2026-04-30)** — Sessions 30j glissantes, 2 admins V1. Probabilité d'expiration silencieuse nulle en pratique. L'admin se reconnecte quand la session expire. Template `admin_session_expiring` non créé V1. QO3 clôturée : décision = V1.1 si durée session réduite ou 3ème admin recruté.

### W12 — Cron rotation secrets approchant expiration

**Cron quotidien** : `m13_secrets_expiration_cron`
- Scanne `tms.secrets_metadata` où `expire_le < now() + interval '7 days'`.
- Émet alerte warning `m13_secret_expiration_imminente` (scope admin) avec lien E5 ligne concernée.

---

## 6. Règles métier appliquées

| Règle | Source | Description |
|-------|--------|-------------|
| R_M13.1 | M13 W1 | Toute édition de `parametres_tms` exige un commentaire ≥ 10 chars. Audit-log obligatoire. |
| R_M13.2 | M13 W2/W3 | Désactivation user = soft delete uniquement V1 (`statut='desactive'`). Pas de pseudonymisation/hard delete V1. |
| R_M13.3 | M13 W2 | Combinaisons rôles interdites (cf. §09 ligne 478) : `manager_prestataire+ops_savr`, `manager_prestataire+admin_tms`, `chauffeur+toute autre role`. Validation Edge Function `upsert_user_tms`. |
| R_M13.4 | M13 W4 | Reset MFA TOTP exige commentaire ≥ 20 chars + audit-log + notif email cible. |
| R_M13.5 | M13 W5 | Rotation secret exige test pré-validation (sauf "Forcer quand même" qui exige commentaire long). |
| R_M13.6 | M13 W6 | Replay manuel d'event entrant passe obligatoirement par `integrations_inbox` pour respecter dédup `event_id`. |
| R_M13.7 | M13 W7 | Wizard onboarding peut s'interrompre entre étapes : prestataire reste `en_onboarding` jusqu'à étape 4 explicite. |
| R_M13.9 | M13 W9 | Impersonation interdite vers `admin_tms` cible et vers user `desactive`. Pas d'impersonation cascadée. |
| R_M13.10 | M13 W9/D15 | Mutations sous impersonation = `audit_logs.acteur_user_id` = impersonator réel + `acteur_meta.impersonation_target_id` = cible. **Jamais** acteur_user_id = cible. |
| R_M13.11 | M13 W10/D14 | Cap 3 devices trusted simultanés actifs par user. Révocation manuelle pour ajouter un 4ème. |
| R_M13.12 | M13 D10 | Session 30j glissantes pour `admin_tms` et `ops_savr`. Glissante = renouvelée à chaque activité, expire après 30j d'inactivité. |
| R_M13.13 | M13 D10 | **Pas de re-MFA pour actions sensibles** (D10 explicit). Risque assumé : laptop compromis = 30j d'accès admin sans frein supplémentaire. Compensé par device trusted révocable + audit-log exhaustif. |
| R_M13.15 | M13 W12 | Secrets avec `expire_le` non null sont scannés quotidiennement, alerte warning à J-7. |
| R_M13.16 | E5 | Reveal secret = JWT 30s + audit obligatoire. Pas de copy auto, pas de cache front. |
| R_M13.17 | E2 | Édition d'un paramètre `requires_redeploy=true` exige confirmation explicite "Je sais que ça nécessite un redéploiement". |
| R_M13.18 | E4 | `audit_logs` strictement immutable : aucune UPDATE/DELETE même `admin_tms`. Seule exception : DROP de partition > 5 ans (DBA-level). |
| R_M13.19 | E2/D6 | Cache 60s côté Edge Function pour lectures `parametres_tms` côté apps clientes. Param critique = `requires_redeploy=true` lu uniquement au démarrage app. |
| R_M13.20 | M13 W3 | Désactivation du seul `manager_prestataire` actif d'un prestataire émet alerte `m13_prestataire_sans_manager_actif` warning. |

---

## 7. Edge cases

| EC | Scénario | Comportement attendu |
|----|----------|----------------------|
| EC1 | Admin tente d'éditer un paramètre dont son rôle n'est pas dans `modifiable_par[]` | EF retourne 403 avant UPDATE. Toast "Tu n'as pas les droits sur ce paramètre." |
| EC2 | Admin crée un user avec email déjà existant dans `users_tms` (statut désactivé) | EF rejette 409 "Email déjà utilisé. Réactive l'user existant ou utilise un autre email." Pas de réactivation auto par création (D7 V1). |
| EC3 | Admin tente de créer un user avec combinaison rôles interdite | EF retourne 400 "Combinaison de rôles non autorisée : [détail]." |
| | | **Dégagé sobriété M13 A2 (2026-04-30)** — 2 admins V1, collision quasi-impossible. Last-write-wins assumé (cohérent M02 sobriété 2026-04-29). Audit-log permet de voir qui a écrasé quoi si collision hypothétique. |
| EC5 | Magic link envoyé étape 3 wizard mais SMTP fail | Alerte warning `m13_user_creation_email_failed`. Wizard affiche bouton "Copier le magic link manuellement" (link valide 24h). Admin envoie hors-bande. |
| EC6 | Replay event entrant déjà traité (event_id présent dans inbox `traite`) | EF retourne 200 OK sans effet (dédup natif inbox). Toast "Cet event a déjà été traité avec succès. Aucune action effectuée." |
| EC7 | Replay event sortant vers Plateforme/Everest mais service down | Nouvelle ligne `integrations_logs` avec `statut='echec_retry'`, retry policy canonique **3 paliers (5 min / 1h / 24h, §08 Bloc B B1)** *(corrigé 2026-06-07 test-scenarios F3 — ex-"5min/30min/2h/6h/24h" stale)*. Admin notifié si nouveau `echec_final`. |
| EC8 | Reveal secret expire (30s écoulées) | Front masque automatiquement, message "Reveal expiré, ré-active si besoin (audité)". |
| EC9 | Admin tente impersonation vers admin_tms | EF retourne 400 "Impersonation interdite vers un autre Admin TMS." (R_M13.9) |
| EC10 | Admin tente impersonation pendant qu'une session impersonation est déjà active | EF retourne 409 "Tu as déjà une session d'impersonation active. Sors-en avant d'en démarrer une nouvelle." |
| EC11 | User fait sa 4ème connexion sur un device tandis qu'il a déjà 3 devices trusted actifs | Login refusé avec message dédié + lien E3.b self → "Révoque un device pour te connecter sur celui-ci." |
| EC13 | Admin désactive un user qui est actuellement en session impersonation comme target | Sessions impersonation forcées en `end_reason='forced_logout'`. Admin impersonator notifié. |
| EC14 | Edition `parametres_tms` entry où `valeur_min`/`valeur_max` violés | Validation client + server. Server retourne 400. UI montre erreur sous le champ. |
| EC16 | Cron `m13_secrets_expiration_cron` ne tourne pas 24h | Pas d'alerte sur l'absence de cron lui-même V1 (monitoring infra hors scope M13). À traiter dans observabilité globale §07/V1.1. |
| EC17 | Wizard onboarding crash entre étapes | Prestataire en `statut='en_onboarding'` reste visible dans M06 avec badge "Onboarding en cours". Admin reprend manuellement (pas de reprise automatique wizard V1). Cleanup cron quotidien : prestataires `en_onboarding` depuis > 7j → alerte warning `m13_onboarding_inacheve_7j`. |
| EC18 | User révoque tous ses devices trusted alors qu'il est connecté sur l'un d'eux | Sa session courante reste valide (pas de logout immédiat). Mais sa prochaine reconnexion sur ce device = re-MFA. UX cohérente "déconnexion complète sur prochain login". |

---

## 8. États et transitions

### États `users_tms.statut`

```
en_attente_premiere_connexion → actif
                              → desactive (rare, si admin annule avant 1ère connexion user)

actif → desactive (W3, soft delete)

*(sobriété M13 D2 2026-04-30 — réactivation hors scope V1, créer nouveau user)*
desactive → desactive (terminal V1)
```

### États `shared.prestataires.statut` (impacté par wizard E7)

```
[création] → en_onboarding (étape 1 wizard)
en_onboarding → actif (étape 4 wizard)
en_onboarding → en_onboarding (étapes 2/3 skippées)
en_onboarding → archive (cron > 7j inacheve, V1.1)
actif → en_fin_de_contrat (M06 W workflow fin contrat — hors M13)
actif → archive (M06)
```

### États `tms.impersonation_sessions.end_reason`

```
[NULL = active]
manual_stop : Admin clique "Sortir" du bandeau
auto_expiration : JWT 60min écoulé
forced_logout : Target user a été désactivé pendant la session
```

### États codes alertes M11 vu de M13 E8

> **Retiré sobriété M13 A3 (2026-04-30)** — Table `alertes_codes_overrides` supprimée Bloc 6 C3 2026-04-28. E8 = lecture seule du seed. Aucun état override à tracker.

---

## 9. Notifications

| Notification | Acteur | Canal | Trigger | Template |
|--------------|--------|-------|---------|----------|
| User staff créé | Admin → user staff | Email | W2 magic link | `staff_first_login` |
| User manager créé | Admin → manager | Email | W7 étape 3 magic link | `manager_first_login` |
| Reset MFA effectué | Admin → user cible | Email | W4 | `mfa_reset_notification` |
| Impersonation démarrée | Admin → user cible | Email + push si session active | W9 start | `impersonation_started` |
| Impersonation terminée | Admin → user cible | Email + push | W9 stop | `impersonation_ended` |
| User désactivé | Admin → user cible | Email | W3 | `user_deactivated` |
| Secret rotation | Aucune notif user (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 `m13_secret_rotated` info dégagée, trace via `tms.audit_logs` action `SECRET_ROTATED`) | audit_logs | W5 | n/a |
| Secret expiration imminente | Aucune notif user | Alerte M11 warning admin | W12 cron | n/a |

**Pas de SMS V1** (canaux email + push + alertes M11 dashboard suffisants pour le scope admin).

---

## 10. Performance cibles

- **E1 dashboard** : load < 1s (4 cards en parallèle, queries indexées).
- **E2 paramètres** : tableau ~50 lignes, load < 500ms (table petite, pagination cosmétique seulement).
- **E3.a liste users** : pagination 50/page, load < 800ms même pour 200+ users (V1 ≤ 30 users staff Savr + ~50 managers + ~100 chauffeurs).
- **E4 audit log** : range 7j load < 800ms ; range 30j < 2s ; range 90j < 5s ; range > 90j → bouton export CSV uniquement.
- **E5 secrets** : load < 500ms (≤ 10 secrets V1).
- **E6 monitoring** : 24h range load < 1.5s ; agrégats en haut < 800ms (cached materialized view 60s).
- **E7 wizard** : chaque étape < 500ms (1 INSERT par étape, 4 étapes V1 — réaligné D2 2026-05-01, tranché Val 2026-06-07 F1).
- **E8 codes alertes** : tableau ~50 lignes, load < 500ms.
- **E9 impersonation start** : < 1s (génération JWT + insert audit + envoi email).

**Cache stratégie** :
- Cache 60s côté Edge Function pour `parametres_tms` lectures par les apps clientes (D6).
- Pas de cache front M13 lui-même (Admin veut voir l'état réel).
- Materialized view rafraîchie 60s pour agrégats E6 dashboard.

---

## 11. Décisions structurantes prises

| # | Décision | Alternatives écartées | Implications |
|---|----------|------------------------|--------------|
| D1 | M13 = hub navigation pour CRUD métier (M06/M07/M08/M11) + écrans propres pour transverse (params, users, audit, secrets, monitoring intégrations, codes alertes, wizard onboarding, impersonation). | a) Hub pure (limite valeur Admin) ; b) Écrans propres dupliqués (duplication coûteuse). | Cohérence DRY avec modules métier. M13 reste lean. Wizard E7 = la valeur ajoutée d'orchestration. |
| D3 | CRUD complet users + impersonation V1 avec bandeau persistant + JWT 60min + audit double acteur. | a) CRUD seul sans impersonation (lacune support) ; b) Création + désactivation seulement (incohérent avec besoin reset MFA). | Fournit support 1ère ligne sans toucher Supabase Auth direct. Risque maîtrisé via R_M13.10 + R_M13.9. |
| D4 | Secrets API dans **Supabase Vault**, accès via Edge Function `reveal_secret` / `rotate_secret` / `test_secret`. Métadonnées (rotation, expire) dans `tms.secrets_metadata`. Reveal = JWT 30s. | b) `parametres_tms.is_secret=true` (RLS-only protection, fuite client-side possible) ; c) Hybride (complexité inutile). | Sécurité native Vault + audit explicit + pas de fuite vers PostgREST. (Slack dégagé V1 — revue sobriété 2026-04-25 A6). |
| D5 | `audit_logs` strictement read-only/immutable. Pas d'annotation post-hoc V1. Champ `commentaire` renseigné à la mutation source uniquement. | b) Annotations table séparée (complexité pour valeur incertaine). | Cohérent avec §04 partition mensuelle et obligation 5 ans. Annotations = V1.1 si besoin métier émerge. |
| D6 | Cache 60s côté Edge Function pour `parametres_tms` lus par apps clientes. Param critical = `requires_redeploy=true`, lu uniquement au démarrage app. | a) Hot reload total (perf) ; c) Realtime push (overengineering V1). | Compromis perf/cohérence acceptable sur 100% des params identifiés. |
| D7 | Soft delete user V1 (`statut='desactive'`). Pas de pseudonymisation différée V1. Pas de hard delete V1. | b) Pseudonymisation J+30 (V1.1) ; c) Hard delete + user système (perte traçabilité). | Audit log légal 5 ans préservé. RGPD compliance via process manuel V1 (rare). |
| D8 | **Révisé revue sobriété §05 2026-05-01 D2 (réaligné tranché Val 2026-06-07 F1)** : Wizard onboarding prestataire E7 = **4 étapes** (identité, **grille tarifaire bloquante non skippable**, manager, activation). Trigger DB `trg_prestataire_grille_obligatoire` refuse l'activation sans grille active. Manager skippable si province no portail. supprimée (cas impossible par construction). | b) Pas de wizard, manuel séquentiel (oubli garanti) ; . | Garantit cohérence onboarding (~1/trim). Atomicité non-transactionnelle V1, reprise manuelle si crash. |
| D9 | Monitoring intégrations E6 = liste paginée + filtres + replay manuel events `echec_final`. Replay = `admin_tms` only. | a) Liste sans replay (ops bloqués sur events perdus) ; c) Dashboard agrégé (V1.1). | Replay = besoin opérationnel récurrent. Dashboard agrégé en haut (compteurs simples) suffit V1. |
| D10 | Session 30j glissantes pour `admin_tms` et `ops_savr` après device trusted. **Pas de re-MFA pour actions sensibles**. | a) Session 8h absolue (friction quotidienne) ; b) 8h glissantes (toujours friction) ; c) 24h + re-MFA actions sensibles (alternative reco initiale). | **Risque assumé conscient** : laptop compromis = 30j d'accès admin sans frein supplémentaire. Compensé par device trusted révocable + audit-log exhaustif. À reconsidérer V2 si incident sécu ou recrutement 3ème admin. |
| D11 | MFA TOTP obligatoire à la 1ère connexion sur un device pour `admin_tms`. Devices trusted ensuite (cap 3, R_M13.11). Pas de MFA pour `ops_savr` V1 (cohérent §09 V1). | a) MFA à chaque login admin (UX dégradée) ; b) Pas de MFA admin (sécu insuffisante). | Standard SaaS. Reset MFA par autre admin via W4. |
| D12 | Paramètres `parametres_tms` portent un flag `requires_redeploy` (boolean, default false). Param critique = pris en compte uniquement au démarrage app. | Pas de flag (impose hot reload partout, irréaliste pour certains params). | Souplesse cas par cas. Liste à seeder en propagation (params d'auth, structure DB-related, etc.). |
| D13 | Bandeau orange persistant en haut de toutes les pages M03/M05/etc. quand session impersonation active. Visible jusqu'à sortie. | Pas de bandeau (risque oubli session admin → confusion). | UX standard (cf. Stripe, Linear, Notion). |
| D14 | Cap 3 devices trusted simultanés actifs par user. Révocation manuelle pour ajouter un 4ème (R_M13.11). | a) Cap 1 (friction smartphone+laptop+backup) ; b) Cap illimité (accumulation devices abandonnés = surface attaque). | Compromis raisonnable. Révocation E3.b. |
| D15 | Mutations sous impersonation = `audit_logs.acteur_user_id` = impersonator réel (Val/Louis) + `acteur_meta.impersonation_target_id` = cible. Jamais l'inverse. | acteur=cible (perte traçabilité réelle). | Conformité auditable + responsabilité claire. R_M13.10. |

---

## 12. Questions ouvertes

| QO | Question | Responsable | Échéance |
|----|----------|-------------|----------|
| QO1 | Faut-il ajouter en V1 une vue "compte de rôles utilisés" (combien de users avec rôle X) en E1 dashboard pour anticiper recrutement ? | Val | Avant handoff |
| QO2 | Liste exhaustive des paramètres à marquer `requires_redeploy=true` (D12). Proposition initiale : `m05_geofence_rayon_metres`, `m05_queue_offline_max_size_mb`, `auth.session_duree_jours_par_role` (ex-`m05_session_duree_jours` — revue sobriété §05 2026-05-01 C2) — à valider. | Val + frère | Pré-handoff |
| | | **Clôturée sobriété M13 A1 2026-04-30** : W11 dégagée V1. Réactiver V1.1 si besoin. | — |
| QO4 | Templates email M11 à créer : `staff_first_login`, `manager_first_login`, `mfa_reset_notification`, `impersonation_started`, `impersonation_ended`, `user_deactivated`. Inclure dans seed M11. | Frère | Phase dev |
| QO5 | Politique IP-restrict `tms.gosavr.io/admin/*` V1 ou V1.1 ? (allowlist IP fixe Val/Louis vs accès libre auth-only — gating sur path `/admin/*` via middleware Next.js, pas sous-domaine) | Val | Décision sécu *(propagation §11 2026-04-27 — alignement sous-route)* |
| QO6 | Notif email obligatoire sur reveal secret (en plus de l'audit-log) ? Pour double accusé de réception. | Val | Décision sécu |
| QO7 | Faut-il versionner `parametres_tms.valeur` dans une table dédiée pour rollback rapide V1 (pas seulement audit-log) ? | Val | V1.1 si pas V1 |
| QO8 | Wizard E7 : ajouter étape optionnelle "configuration types_véhicules" pour Strike/Marathon (pré-seed flotte) ou laisser dans M06 manuel post-onboarding ? | Val + Louis | Pré-handoff |

---

## 13. Paramètres `m13_*` créés

**Paramètres seedés dans `parametres_tms`** *(sobriété B1 2026-04-30 — 17 → 3)* :

> Seuls les paramètres susceptibles d'être modifiés en prod sans redéploiement sont seedés dans `parametres_tms`. Les valeurs fixes de sécurité et les seuils UI invariants sont hardcodés comme constantes dans le code (EF ou composant) — ils ne doivent pas être éditables via E2 (risque de modifier un paramètre de sécurité par accident).

*Namespace `auth`* (seedés `parametres_tms`) :
- → **Supprimé revue sobriété §05 2026-05-01 C2** — fusionné dans `parametres_tms.auth.session_duree_jours_par_role` JSONB, clés `admin_tms` + `ops_savr`. Source de vérité §09.
- → **Renommé `auth.session_glissante` revue sobriété §05 2026-05-01 C2** (boolean global toutes rôles V1, default true). Namespace migré `m13_*` → `auth.*`.
- `m13_device_trusted_max_per_user` : 3 (R_M13.11, D14)

*Retirés du seed — hardcodés comme constantes code :*
- : `true` → constante §09 (`admin_tms` = MFA toujours, D11)
- : `false` → constante §09 (D11, V1 cohérent §09)
- : retiré — W11 dégagée A1 2026-04-30
- : V1.1 (QO5) — pas de seed V1
- : `10000` → `MAX_EXPORT_ROWS = 10_000` constante EF
- : `7` → constante composant UI E4
- : `90` → constante composant UI E4
- : `30` → `SECRET_REVEAL_TTL_SECONDS = 30` constante EF (**sécurité — ne pas exposer en param éditable**)
- : `7` → `SECRET_EXPIRY_ALERT_DAYS = 7` constante cron W12
- : `60` → `IMPERSONATION_JWT_TTL_MINUTES = 60` constante EF (**sécurité — ne pas exposer en param éditable**)
- : `7` → `ONBOARDING_STALE_DAYS = 7` constante cron EC17
- : `10` → `PARAM_COMMENT_MIN_CHARS = 10` constante EF W1
- : `20` → `DEACTIVATION_REASON_MIN_CHARS = 20` constante EF W3
- : `20` → `MFA_RESET_COMMENT_MIN_CHARS = 20` constante EF W4

**Solde paramètres `m13_*` seedés** : **1** (device_trusted_max_per_user) vs 17 initiaux. + migrés dans namespace `auth` (revue sobriété §05 2026-05-01 C2).

**Namespace `requires_redeploy` flags** : à ajouter en colonne sur `parametres_tms` (cf. D12), pas un namespace.

---

## 14. Codes alertes M11 émises par M13

> **Normatif (R_M11.1)** : tous les triggers M13 utilisent `tms.alerte_emit(code, ...)` avec codes canoniques catalogue.

| Code canonique | Criticité | Trigger M13 | Scope | Auto-résolution |
|----------------|-----------|-------------|-------|------------------|
| `m13_user_creation_email_failed` | warning | EC5/W2 SMTP fail | admin | Non (email envoyé hors-bande) |
| `m13_prestataire_sans_manager_actif` | warning | W3 désactivation seul manager (R_M13.20) | ops + admin | Auto à création nouveau manager |
| `m13_secret_expiration_imminente` | warning | W12 cron J-7 | admin uniquement | Auto à rotation |
| `m13_onboarding_inacheve_7j` | warning | EC17 cron quotidien | admin | Auto à activation prestataire ou archive |
| `m13_impersonation_session_longue` | warning | Cron : session impersonation > 30 min active | admin | Auto à stop |
| `m13_parametre_edition_validation_echec` | warning | W1 validation server-side échoue (rare) | admin | Aucune (one-shot) |

**Codes ex-`info` retirés du catalogue M11 — Bloc 3 sobriété 2026-04-25 (A1)** :
- `m13_secret_rotated` → trace via `tms.audit_logs` action `SECRET_ROTATED` (W5 step 6c)
- `m13_event_manual_replay` → trace via `tms.audit_logs` action `EVENT_MANUAL_REPLAY` (W6 step 6d)
- `m13_impersonation_started` → trace via `tms.audit_logs` action `impersonation_start` (W9 step 2) — déjà obligatoire pour audit gouvernance

**Scope admin uniquement** (R_M11.8) : codes `m13_secret_expiration_imminente`, `m13_impersonation_session_longue` (warning) ne sont visibles que par les admin_tms dans M11 dashboard (filtrage scope role).

---

## 15. Tables data model M13 nouvelles ou modifiées

### Tables nouvelles (à propager §04)

#### `tms.users_tms_devices_trusted`

Tracking des devices reconnus par user pour skip MFA admin (D11/D14).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `user_id` | uuid | FK `users_tms(id)`, NOT NULL | |
| `device_fingerprint` | text | NOT NULL | Hash SHA-256(user-agent + IP class C + cookie persistent) |
| `user_agent` | text | NOT NULL | Affichage E3.b |
| `ip_premiere_reconnaissance` | inet | NOT NULL | |
| `created_at` | timestamptz | NOT NULL, default `now()` | 1ère reconnaissance (post-MFA pour admin) |
| `derniere_activite_at` | timestamptz | NOT NULL | Maj à chaque login |
| `actif` | boolean | NOT NULL, default true | Révocation = false |
| `revoque_at` | timestamptz | | NULL si actif |
| `revoque_par_user_id` | uuid | FK `users_tms(id)` | self ou admin |

**Index** : `(user_id, actif)`, `(device_fingerprint)`, `(user_id, derniere_activite_at DESC)`.

**RLS** : self (lecture+update) ; `admin_tms` (lecture+update tous les users).

**Contrainte** : `count(*) FILTER (actif=true) ≤ 3 PER user_id` (enforced via trigger BEFORE INSERT/UPDATE, pas constraint native PG).

#### `tms.alertes_codes_overrides`

> **Dégagée Bloc 6 C3 (revue sobriété 2026-04-28)** — table supprimée V1. Voir D2 ci-dessus. Policies RLS retirées (§09 mis à jour). `alerte_emit` ne consulte plus cette table.



#### `tms.secrets_metadata`

Métadonnées des secrets stockés dans Vault (D4).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `secret_name` | text | PK | Cohérent avec `vault.secrets.name` |
| `service` | text | NOT NULL | Enum `pennylane`/`everest`/`strike`/`marathon`/`bridge`/`autre` ( dégagé revue sobriété 2026-04-25 A6) |
| `type_secret` | text | NOT NULL | Enum `bearer_token`/`webhook_url`/`signing_key`/`client_id`/`client_secret` |
| `description` | text | | UI affichage E5 |
| `expire_le` | timestamptz | | NULL si no expiration. Sinon scan W12. |
| `derniere_rotation_at` | timestamptz | | |
| `derniere_rotation_par_user_id` | uuid | FK `users_tms(id)` | |
| `derniere_utilisation_at` | timestamptz | | Maj par EF lors d'usage (best-effort, non bloquant) |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |

**RLS** : `admin_tms` uniquement (read+write).

#### `tms.impersonation_sessions`

Tracking sessions impersonation (D15, E9).

(Cf. spec dans §4 E9 ci-dessus.)

### Tables modifiées (propagation)

#### `tms.parametres_tms` (existante §04 niveau 5)

Ajout colonne :
- `requires_redeploy` boolean NOT NULL default false (D12)
- `deprecated` boolean NOT NULL default false (EC15 — utilité conservée pour futurs paramètres legacy ; ex usage `m11_slack_webhook_url` dégagé revue sobriété 2026-04-25 A6)

#### `tms.users_tms` (existante §04 niveau 1)

Ajout colonnes :
- `desactivee_at` timestamptz nullable
- `desactivee_par_user_id` uuid FK `users_tms(id)` nullable
- `raison_desactivation` text nullable (R_M13.20 trigger source)
- `mfa_active` boolean NOT NULL default false (W4 reset)

(À aligner avec ce qui existe peut-être déjà — vérifier en propagation.)

#### `tms.alertes_codes_seed` (existante M11)

Pas de modification structure. (Table override retirée Bloc 6 C3 — criticité figée seed dans `alertes_catalogue.criticite_par_defaut`.)

---

## 16. Liens

- [[01 - Vision et objectifs TMS]]
- [[03 - Périmètre fonctionnel TMS]] — §03 M13 macro
- [[04 - Data Model TMS]] — niveau 5 admin/audit, à propager 4 tables nouvelles + colonnes
- [[05 - Règles métier TMS]] — R_M13.1 à R_M13.20 à intégrer
- [[07 - Architecture technique TMS]] — Edge Functions M13 (`update_parametre`, `upsert_user_tms`, `deactivate_user`, `reset_mfa_user`, `rotate_secret`, `test_secret`, `reveal_secret`, `replay_event`, `wizard_onboarding_prestataire`, (retirée Bloc 6 C3), `impersonation_start`, `impersonation_stop`)
- [[08 - Contrat API Plateforme-TMS]] — pas d'impact direct M13 V1 (M13 = admin TMS-only)
- [[09 - Authentification et permissions TMS]] — addendum M13 : RLS sur `users_tms_devices_trusted`, (retirée Bloc 6 C3), `secrets_metadata`, `impersonation_sessions` + politique session 30j glissantes + device trusted
- [[15 - Sécurité et conformité TMS]] — addendum M13 : Vault secrets, impersonation tracking, audit log immutable, MFA admin
- [[M01 - Réception ordres de collecte]] — paramètres `m01_*`
- [[M02 - Dispatch Ops Savr]] — paramètres `m02_*`
- [[M03 - Portail prestataire self-service]] — création first manager via E7
- [[M04 - Gestion des tournées]] — paramètres `m04_*`
- [[M05 - App mobile chauffeur]] — paramètres `m05_*` (geofence, queue offline, etc.)
- [[M06 - Référentiel prestataires]] — création prestataire via E7
- [[M07 - Pilotage financier logistique]] — création grille via E7
- [[M08 - Facturation prestataires]] — déverrouillage facture, audit log
- [[M10 - Gestion exutoires Veolia]] — paramètres `m10_*`
- [[M11 - Alerting transverse]] — codes alertes catalogue, override criticité E8
- [[M12 - Attribution transporteur]] — paramètres `m12_*` (cache Everest)

---

## 17. Propagations à effectuer (Principe 0 + 0 bis)

### Principe 0 — Propagation interne CDC TMS

| Fichier | Modification |
|---------|--------------|
| §04 niveau 5 `parametres_tms` | Ajouter colonnes `requires_redeploy`, `deprecated`. (Slack dégagé V1 — revue sobriété 2026-04-25 A6). |
| §04 niveau 5 nouvelles tables | INSÉRER specs `users_tms_devices_trusted`, (retirée Bloc 6 C3), `secrets_metadata`, `impersonation_sessions`. |
| §04 niveau 1 `users_tms` | Ajouter colonnes `desactivee_at`, `desactivee_par_user_id`, `raison_desactivation`, `mfa_active`. |
| §04 niveau 5 `audit_logs` | Mention explicite : tables `users_tms_devices_trusted`, (retirée Bloc 6 C3), `secrets_metadata`, `impersonation_sessions` ajoutées à liste tables surveillées. |
| §05 Règles métier TMS | Ajouter R_M13.1 à R_M13.20. |
| §03 Périmètre fonctionnel TMS | M13 : statut "À démarrer" → "V1 rédigée 2026-04-25". Compléter contenu (E1-E9 + Vault secrets + impersonation + wizard E7). |
| §07 Architecture technique TMS | Ajouter section "Edge Functions M13" (12 EF listées en §16 liens). |
| §09 Auth et permissions TMS | Addendum M13 : RLS 4 nouvelles tables + politique session 30j glissantes + device trusted policy + helper SQL `auth.is_impersonating()` returning boolean. |
| §15 Sécurité et conformité | Addendum M13 : Vault secrets, impersonation tracing, MFA admin policy, devices trusted cap 3. |
| §00 Index TMS | Marquer §06 M13 V1 rédigée 2026-04-25. Ajouter section "Propagations 2026-04-25 (M13)". |
| Dossier 06 `00 - Index.md` | Corriger statut M03 (V1 rédigée 2026-04-24, bug détecté avant cette session). Ajouter M13 V1 rédigée 2026-04-25. Mettre à jour entête. |
| M11 § alertes seed | Ajouter 10 codes alertes `m13_*` au catalogue seed. |
| M11 §05 R_M11.X | Mention scope `manager_prestataire_scope='admin'` pour codes secrets/impersonation/replay (visibilité admin only). |

### Principe 0 bis — Cross-CDC vers Plateforme

Entités cross-CDC potentiellement impactées par M13 :
- `users` Plateforme vs `users_tms` TMS : rien d'impacté V1, M13 ne crée pas de users Plateforme. **Aligné.**
- `audit_logs` : la Plateforme a sa propre table audit_logs §04 Plateforme. Pas de fusion V1. **Aligné** (écart conscient documenté §04 Plateforme + §04 TMS).
- Secrets API Pennylane : la Plateforme utilise aussi Pennylane (export factures clients). Question : où vit `pennylane_api_token` ? Probablement 2 tokens distincts (Plateforme = gestion clients, TMS = gestion fournisseurs). **À vérifier en propagation cross-CDC** — alignement nécessaire si même token.
- Alertes M11 : le catalogue M11 vit côté TMS uniquement. Plateforme a son propre système d'alerting. **Aligné** (écart conscient).

**Action propagation cross-CDC** : vérifier si Pennylane utilise 1 ou 2 API tokens distincts entre Plateforme et TMS. Si 1 unique → secret partagé, mécanique de gestion à concerter. Si 2 distincts → écart documenté, M13 gère son secret TMS uniquement.

---

## 18. État final post-rédaction (à valider en propagation)

- 9 écrans (E1-E9) + 4 sous-écrans (E3.a-d, E6.a-c, E7.1-4)
- 12 workflows (W1-W12)
- 18 edge cases (EC1-EC18)
- 20 règles métier (R_M13.1-R_M13.20)
- 15 décisions structurantes (D1-D15)
- 8 questions ouvertes (QO1-QO8)
- **1** paramètre `m13_*` seedé (`m13_device_trusted_max_per_user` — sobriété B1 2026-04-30 + migration namespace `auth` ; corrigé 2026-06-07 test-scenarios)
- **6** codes alertes `m13_*` actifs catalogue M11 (cf. §14 ; corrigé 2026-06-07)
- **3** tables nouvelles à créer (`alertes_codes_overrides` retirée Bloc 6 C3)
- 2 tables modifiées (colonnes ajoutées)
- **11** Edge Functions à dev par Claude Code (`upsert_alerte_code_override` retirée ; corrigé 2026-06-07)

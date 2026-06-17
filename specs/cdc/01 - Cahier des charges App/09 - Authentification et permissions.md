# 09 - Authentification et permissions

**Statut** : Draft V1 — mise à jour architecturale 2026-04-23 (atelier tech avec frère)
**Dernière mise à jour** : 2026-06-11 (**Audit RLS V1 post-35 patchs (skill `cdc-audit-rls`), arbitrages Val** — §3quater ajouté : A-1 `audit_log` (policy SQL + append-only strict, y compris admin) · A-2 `entites_facturation` (lecture org-scoped clients, écriture staff — l'ex-classement « financière interne admin-only » rendait le sélecteur d'entité §06.01 mort) · A-3 `sequences_facturation` + `jobs_pdf` consolidées · A-4 `organisations`/`lieux` chemin `client_organisateur`. Corrections §3 : B-1 `packs_antgaspi` écriture **staff** (matrice étendue fait foi, conflit tranché Val) · B-3a `bordereaux_savr`/`attestations_don` SELECT `client_organisateur` ajouté (alignement `f_fichier_visible`) · B-4 résidu `prestataires_logistiques` retiré des référentiels ouverts · B-5 `tournees` SQL explicite · C-1 `aa_select` restreint staff+programmateur+traiteur opérationnel (client_organisateur et gestionnaire exclus, tranché Val) · B-2 garde brouillons tiers ajoutée à `f_collecte_visible` (chemin lieu). Bloc D : +12 pgTAP. / Antérieure : 2026-06-07 (test-scenarios §09 RLS transverse lot ⑪ — F1 policy UPDATE `collecte_flux` admin+ops (pesées) · F2 règle staff canonique + helper `f_is_staff()` · F3 `f_collecte_editable` étendue UPDATE manager+agence · F4 `users` SELECT org-wide traiteur_commercial · pgTAP Bloc D complété / Antérieure même jour : test-scenarios §06.05 lot ⑤ — F5 matrice `users` gestionnaire_lieux org-wide · F6 `factures` + `shared.fichiers` SELECT self gestionnaire · F3 prédicat `evenements` brouillons tiers exclus · F4 `f_collecte_editable` sur UPDATE gestionnaire · 5 tests pgTAP ajoutés Bloc D)

---

## ⚠ Addendum architectural 2026-04-23 — Users disjoints et RLS cross-schema

Suite à la décision de **1 projet Supabase unique avec 3 schémas** (`plateforme.*` + `tms.*` + `shared.*`), les règles d'authentification prennent **2 contraintes strictes** :

### Users disjoints Plateforme / TMS

- Un email donné ne peut être utilisateur **que d'une seule application** : soit la Plateforme, soit le TMS, jamais les deux.
- La table `auth.users` Supabase est unique mais chaque user porte un claim JWT `app_domain` (`plateforme` ou `tms`) provisionné à l'inscription/création.
- Un chauffeur TMS ne peut **jamais** loguer sur `app.gosavr.io` et vice-versa (check `app_domain` au niveau middleware front + RLS deny au niveau DB).
- Cas d'équipe Ops Savr qui a besoin des 2 apps : **2 comptes distincts** (ex: `val+plateforme@gosavr.io` et `val+tms@gosavr.io`) ou 1 seul compte avec claim `app_domain = both` (V1.1).

### RLS cross-schema deny par défaut

- Aucune policy Plateforme n'autorise la lecture/écriture sur `tms.*` et inversement.
- Chaque schéma déclare ses policies sur ses propres tables uniquement.
- Les tentatives de `SELECT * FROM tms.collectes_tms` par un user Plateforme → retournent 0 lignes (pas d'erreur, juste vide).
- Les tests **pgTAP** bloquants CI valident le cloisonnement (1 test allow + 1 test deny par policy). **Couverture V1 (sobriété 2026-06-03 B2)** : périmètre critique obligatoire = tables financières/traçabilité (`factures`, `bordereaux_savr`, `attestations_don`, `collectes`, `evenements`), cross-schema (`shared.prestataires`, `plateforme.lieux`, `shared.fichiers`) et `audit_log`. Couverture **100% des policies promue V1.1** (objectif maintenu, non bloquant au lancement). Rationale : tester chaque policy de chaque table de référentiel dès V1 alourdit le build pour un risque faible — les fuites de cloisonnement à fort impact (facturation, RGPD, cross-org) sont couvertes dès V1.
- Seule exception au cloisonnement : schéma `shared.*` (table `fichiers`) accessible via policies explicites depuis les 2 côtés.

### Benchmarks RLS grandes tables

- **Objectif V1 (non bloquant go-live, sobriété 2026-06-03 A2)** : benchmark pgTAP indicatif sur `plateforme.audit_log` et équivalent TMS avec 100k rows simulés, cible p95 < 200ms. Au lancement les volumes réels sont très en deçà de 100k → le benchmark sert d'objectif de design, pas de gate de mise en prod. Promu en **seuil bloquant V1.1** une fois les volumes de prod connus.
- Policies lisent les claims JWT enrichis (`role`, `organisation_id`, `app_domain`) — pas de sous-requête coûteuse (contrainte de design conservée, c'est elle qui garantit la tenue à la charge, pas le benchmark).

---

## ⚠ Addendum 2026-04-23 (seconde salve M01) — Policies cross-schema prestataires & lieux

Issu de la seconde salve M01 ([[../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées TMS/M01 - Réception ordres de collecte]]). Nouvelles policies cross-schema introduites pour supporter les retournements prestataires (D14) et lieux (D16).

### Point de bascule pour `ops_savr`

Le rôle `ops_savr` peut désormais exister **simultanément** côté Plateforme et TMS avec le **même email** (même entry `auth.users`, 2 profils distincts `plateforme.users` + `tms.users_tms`). Le claim JWT `app_domain` est recalculé à chaque login/refresh selon le sous-domaine (`app.gosavr.io` vs `tms.gosavr.io`). Les autres rôles restent strictement disjoints (un manager prestataire TMS ne peut pas loguer sur la Plateforme, etc.). La gestion double profil Ops est manuelle V1 (pas de sync automatique).

### `shared.prestataires` — policies (détail [[../02 - Cahier des charges TMS/09 - Authentification et permissions TMS#Policies RLS cross-schema (seconde salve M01)]])

- **Lecture** : `app_domain() = 'plateforme'` + rôle `admin_savr` ou `ops_savr` → autorisée (full row).
- **Écriture** : **refusée** depuis `app_domain() = 'plateforme'` quels que soient les rôles. Une modification d'identité prestataire doit passer côté TMS (M06 Référentiel prestataires).
- **Impact applicatif Plateforme** : le module de gestion prestataires V1 côté Plateforme (si existant) devient read-only ou est retiré de l'UI Admin Savr. Toutes les opérations d'identité passent par `tms.gosavr.io` M06.

### `plateforme.lieux` — policies (détail [[../02 - Cahier des charges TMS/09 - Authentification et permissions TMS#Policies RLS cross-schema (seconde salve M01)]])

- **Lecture** : `app_domain() = 'tms'` + rôle `admin_tms` ou `ops_savr` → autorisée **sauf** sur les 4 colonnes admin/ops only Savr (`commentaire_lieu`, `siren`, `email_gestionnaire`, `reference_citeo` — ajout 2026-05-08, voir [[05 - Règles métier#R_lieux_admin_only_fields]]).
- **Écriture cross-schema** : limitée aux 2 colonnes logistiques partagées (`acces_details`, `acces_office`) via `GRANT UPDATE` column-level Postgres. Toutes les autres colonnes restent write Plateforme uniquement (rôles `admin_savr`, `ops_savr` Plateforme). **Refonte 2026-04-28 (audit cohérence A2)** : ex-4 colonnes addendum (`code_acces`, `parking`, `contact_ops_logistique`, `instructions_chauffeur`) supprimées et fusionnées sur les colonnes existantes Plateforme. Suppression simultanée de `lieux.contact_*` (relogés sur `evenements.contact_principal_*` + `contact_secours_*`).
- **Impact applicatif Plateforme** : `acces_details` + `acces_office` deviennent des colonnes RW partagées (Admin Savr UI commercial + Ops/Admin TMS UI terrain). Toute mise à jour est tracée dans `audit_log` standard pour distinguer l'auteur. Pas d'UI Plateforme à cacher (les colonnes existaient déjà côté Admin Savr — aucune régression).
- **Champs admin/ops only Plateforme** *(ajout 2026-05-08)* : 4 colonnes (`commentaire_lieu`, `siren`, `email_gestionnaire`, `reference_citeo`) **strictement réservées** à `admin_savr` + `ops_savr` Plateforme en lecture comme en écriture. `app_domain() = 'tms'` n'a **aucun accès** (ni SELECT ni UPDATE). Voir `R_lieux_admin_only_fields` §05 pour le détail des GRANT et la vue publique `v_lieux_public`.

### `plateforme.transporteurs` — policies *(ajout 2026-05-08 — révisé 2026-06-07 F3, tranché Val)*

- **Levé 2026-06-07 (F3)** : `transporteurs.siren` est en SELECT + UPDATE pour `admin_savr` **et** `ops_savr` (alignement sur la ligne matrice « Lieux / Transporteurs : lecture / écriture / désactivation : ops Oui », qui fait foi).
- **Levé 2026-06-07 (F3)** : `ops_savr` peut désactiver un transporteur (`actif=false`). Aucun trigger/policy de restriction.

### Tests pgTAP bloquants CI — nouveaux (révision 2026-04-28 + 2026-05-08)

- `prestataires_plateforme_write_denied` : `admin_savr` INSERT/UPDATE sur `shared.prestataires` → doit échouer.
- `prestataires_read_ok_both_domains` : `admin_savr` ET `admin_tms` SELECT `shared.prestataires` → OK.
- `lieux_tms_write_only_2_logistic_cols` : `admin_tms` UPDATE colonnes non logistiques de `plateforme.lieux` → doit échouer (privilege error). Liste autorisée : `acces_details`, `acces_office` uniquement.
- `lieux_plateforme_full_write_preserved` : `admin_savr` UPDATE toutes colonnes `plateforme.lieux` → OK (comportement historique).
- **`lieux_admin_only_fields_hidden_from_clients`** *(ajout 2026-05-08, révisé 2026-06-12)* : un user `traiteur_*` / `agence_*` / `gestionnaire_*` / `client_organisateur_*` SELECT `plateforme.lieux.commentaire_lieu` (ou `siren`/`email_gestionnaire`/`reference_citeo`) → doit échouer. **Implémentation V1 obligatoire (décision Val 2026-06-12 — restriction effective au go-live)** : vue `v_lieux_clients` SECURITY DEFINER exposant uniquement les colonnes non-sensibles ; `GRANT SELECT ON plateforme.lieux` aux rôles clients révoqué, remplacé par `GRANT SELECT ON plateforme.v_lieux_clients`. *(Contrainte PostgreSQL : `REVOKE SELECT (colonne)` sans effet si `GRANT SELECT` table-level déjà accordé — la vue est le seul mécanisme standard.)* **Test P1 bloquant CI.**
- **`lieux_admin_only_fields_hidden_from_tms`** *(ajout 2026-05-08, révisé 2026-06-12)* : un user `admin_tms` ou `ops_savr` `app_domain='tms'` SELECT `commentaire_lieu`/`siren`/`email_gestionnaire`/`reference_citeo` → doit échouer. **V1 obligatoire — même vue `v_lieux_clients`.** **Test P1 bloquant CI.**
- *(retiré 2026-06-07 F3 — `ops_savr` peut éditer le SIREN transporteur)*
- *(retiré 2026-06-07 F3 — `ops_savr` peut désactiver un transporteur)*

Ces tests pgTAP cross-schema sont dans le **périmètre critique V1 bloquant** (cf. couverture ciblée B2 ci-dessus, addendum §Users disjoints) — ils touchent `shared.prestataires` et `plateforme.lieux`. Couverture 100% des policies promue V1.1 (cf. §15 Sécurité).

---

## 1. Authentification

### Stack

- **Supabase Auth** (built-in, email + password V1)
- **SSO SAML anticipé dans l'archi V1** : les claims JWT sont pensés pour être provisionnés par un IdP externe (Okta, Azure AD, Google Workspace) sans refonte data. `auth.providers` extensible côté Supabase (activable en V2 au besoin d'un gros client comme Sodexo/Compass, sans migration).
- Pas de 2FA V1 (ajoutée V2 pour profils Admin Savr et Manager, priorité time-to-market V1)
- **Claim JWT `app_domain`** ajouté V1 (retournement atelier 2026-04-23) pour cloisonner users Plateforme vs TMS dans la même table `auth.users`.

### Règles de mot de passe

- 10 caractères minimum
- 1 majuscule + 1 chiffre + 1 caractère spécial obligatoires
- Pas de reset sans accès email (lien magique signé par Supabase)
- **Session JWT : 1 heure** d'expiration confirmé (Val). Refresh token valide 30 jours. Pas de session plus courte pour Admin en V1.

### Email de vérification

Obligatoire à l'inscription. Un compte non vérifié ne peut pas programmer de collecte (bloqué au niveau middleware).

### Récupération de mot de passe

- Lien magique envoyé par email, valide 1 heure
- Rate limit : 3 demandes max par heure par email

---

## 2. Modèle de rôles

### Profils utilisateurs

Enum `users.role` (stocké en DB, lu à chaque session) :

| Rôle                                          | Description                                                                       | Périmètre data par défaut                                                                                                                                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin_savr`                                  | Équipe Savr (Val, Louis — direction + tech)                                       | Tout + impersonation + écritures sensibles (Paramètres, fusion org, hard delete, override prestataire AG, édition tarif refacturé)                                                                                                                         |
| `ops_savr` *(extension périmètre 2026-05-07)* | Équipe Ops Savr (gestion opérationnelle quotidienne du back-office)               | Tout en lecture + actions opérationnelles ; **pas** d'écriture sur §9 Paramètres, **pas** d'impersonation, **pas** de fusion org/hard delete, **pas** d'override prestataire AG, **pas** d'édition tarif refacturé                                         |
| `traiteur_manager`                            | Admin d'une organisation traiteur                                                 | `organisation_id = user.organisation_id` (y compris collectes des commerciaux rattachés)                                                                                                                                                                   |
| `traiteur_commercial`                         | Commercial d'une organisation traiteur                                            | **Lecture** : `organisation_id = user.organisation_id` (toute l'orga, comme le manager). **Écriture** : `created_by = user.id` (ses propres collectes uniquement). Pas de gestion des utilisateurs ni d'édition des paramètres org *(révision 2026-05-29)* |
| `agence`                                      | Agence événementielle organisatrice                                               | `organisation_id = user.organisation_id`                                                                                                                                                                                                                   |
| `gestionnaire_lieux`                          | Gestionnaire de lieux (Sodexo, Compass, Viparis, etc. **+ lieux autonomes mono-site**, ex-`lieu_independant` fusionné — sobriété 2026-06-03 D1) | Lieux liés via `organisations_lieux` (un lieu autonome = un gestionnaire avec une seule ligne `organisations_lieux`)                                                                                                                                       |
| `client_organisateur`                         | Client Organisateur (entreprise ou marque) rattachée à un ou plusieurs événements | Événements où `evenements.client_organisateur_organisation_id = user.organisation_id` — lecture seule                                                                                                                                                      |

Rôle retiré : `gestionnaire_lieux_commandeur` (besoin métier initial couvert par la table `tarifs_negocie`, ex `tarifs_zd_par_gestionnaire`, cf. `04 - Data Model`). **Mise à jour 2026-05-07** : le rôle `gestionnaire_lieux` standard peut désormais programmer en V1 (sur ses propres lieux, avec un traiteur du référentiel). Pas de nouveau rôle créé — extension du périmètre du rôle existant. Idem pour `agence` (extension transactionnelle complète : programmation + facturation + pack AG + workflow shadow traiteur).

### Attribution des rôles

- À l'inscription self-service : rôle déterminé par la présence ou non d'un domaine email reconnu **et le `type_profil` choisi** (aligné [[05 - Règles métier]] §8 étape 1 — correction 2026-06-10, challenge onboarding : l'ancienne ligne « création agence/gestionnaire_lieux par Admin uniquement » était périmée depuis l'extension self-service 2026-05-07)
  - Domaine reconnu (orga existante) → rôle par défaut selon `organisations.type` : `traiteur_commercial` / `agence` / `gestionnaire_lieux`
  - Domaine non reconnu → création de sa propre orga, rôle manager selon `type_profil` : `traiteur_manager` / `agence` / `gestionnaire_lieux`
- Passage `traiteur_commercial` → `traiteur_manager` : demande adressée à l'Admin Savr (pas de self-upgrade)
- **`client_organisateur` : jamais self-service** (absent de l'enum `type_profil`) — création par l'**Admin Savr uniquement** via le back-office §06.06 (CRUD users/orgas), email de bienvenue standard à la création du compte. *(Précisé 2026-06-10, challenge onboarding.)*
- **`admin_savr`** : création manuelle (seed + Admin existant), jamais self-service.

> **Invariant V1 — 1 user = 1 organisation (tranché Val 2026-06-10)** : `users.organisation_id` est singulier, le claim JWT aussi ; **aucune table N-N `users ↔ organisations`** (ne pas en créer). Multi-orga = email distinct par orga. Cf. [[04 - Data Model#Table : `users`]].

> **Garde-fou anti-usurpation (validé revue dev senior (frère) 2026-06-08)** : la clé « domaine reconnu → `traiteur_commercial` » **exclut les domaines email publics et jetables**. Un domaine public (gmail, outlook, etc.) ne rattache jamais automatiquement à une orga existante (création d'une orga isolée) ; un domaine jetable est refusé. Détail + denylist : [[15 - Sécurité et conformité]] §2.6.

---

## 3. Matrice RLS (Row Level Security) Supabase

Principe : chaque table sensible a une policy qui filtre les lignes visibles selon le rôle et l'ID user.

> **Règle staff canonique (F2 test-scenarios §09 lot ⑪, tranché Val 2026-06-07)** : partout où une matrice ci-dessous indique `admin_savr ALL` sans ligne `ops_savr`, la lecture est **staff** — le prédicat SELECT canonique est `auth.jwt()->>'role' IN ('admin_savr','ops_savr')`, centralisé dans le helper :
>
> ```sql
> CREATE FUNCTION plateforme.f_is_staff() RETURNS boolean
> LANGUAGE sql STABLE AS $$ SELECT auth.jwt()->>'role' IN ('admin_savr','ops_savr') $$;
> ```
>
> Pour les **écritures**, la [[#Matrice étendue `ops_savr` — back-office Plateforme|matrice étendue ops_savr]] fait foi : `ops_savr` est inclus dans les policies d'écriture opérationnelles, **sauf** la liste admin-only (override prestataire AG, édition ligne/montant facture, avoirs, SIREN/habilitation/désactivation associations, `tarif_refacture_pax_zd`, promotion `admin_savr`, hard delete, impersonation, Paramètres §9, `config_auto_accept_ag`). Les matrices §3 ne sont pas réécrites ligne à ligne — cette règle s'applique en lecture transverse. pgTAP : `staff_ops_read_surface_ok` + `ops_admin_only_writes_denied`.

### Table `organisations`

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | ALL | ALL | ALL |
| traiteur_manager | `id = auth.jwt()->>'organisation_id'` | — | `id = auth.jwt()->>'organisation_id'` | — |
| traiteur_commercial | `id = auth.jwt()->>'organisation_id'` | — | — | — |
| agence | `id = auth.jwt()->>'organisation_id' OR (est_shadow=true AND cree_par_organisation_id = auth.jwt()->>'organisation_id')` *(extension 2026-05-07 — visibilité fiches shadow créées par l'agence)* | `est_shadow=true AND type='traiteur' AND cree_par_organisation_id = auth.jwt()->>'organisation_id'` *(création de fiches shadow uniquement, jamais de création d'organisation non-shadow par un user)* | `id = auth.jwt()->>'organisation_id'` (pas de droit sur les fiches shadow créées — l'Admin gère leur cycle de vie) | — |
| gestionnaire_lieux | `id = auth.jwt()->>'organisation_id'` | — | `id = auth.jwt()->>'organisation_id'` | — |
| **client_organisateur** *(ajout 2026-06-11, audit RLS A-4 — seul rôle absent de la matrice : page profil/orga morte)* | `id = auth.jwt()->>'organisation_id'` (lecture seule) | — | — | — |

> **Note 2026-05-07** : SELECT limité au référentiel "actif" (filtre `est_shadow=false` côté UI/queries) pour les autocompletes de programmation. La fiche shadow n'est visible que par son créateur (agence) et l'Admin. Promotion shadow → client réel par Admin Savr (`UPDATE organisations SET est_shadow=false, cree_par_organisation_id=NULL WHERE id=...`).
>
> **Note F5 lot ⑨ (2026-06-07, tranché Val)** : la lecture du référentiel traiteurs par `agence` + `gestionnaire_lieux` (combobox « Traiteur opérant » §06.01, nom du traiteur opérationnel sur la fiche collecte §06.11) passe par la **vue whitelist `v_referentiel_traiteurs`** (`id`, `nom`, `raison_sociale` ; `type='traiteur' AND est_shadow=false` ; SECURITY DEFINER — cf. [[04 - Data Model]]). La matrice SELECT ci-dessus reste inchangée (aucun élargissement du SELECT direct). Exclusion registre agence câblée dans `v_registre_dechets` (prédicat rôle ≠ 'agence', F6 même session). pgTAP : `referentiel_traiteurs_whitelist_ok` + `registre_agence_denied` (P1).
>
> **Note F2 (décision test-scenarios §06.11 lot ⑨ 2026-06-07, tranché Val)** : la complétion du SIRET d'une fiche shadow par l'agence créatrice passe par la RPC **`f_completer_siret_shadow(org_id, siret)`** (SECURITY DEFINER) — l'UPDATE RLS direct sur les fiches shadow reste interdit (matrice ci-dessus inchangée). Gardes : `est_shadow=true`, `cree_par_organisation_id = org appelant`, rôle `agence`, écrasement interdit si `siret` déjà renseigné, format 14 chiffres. Cf. §06.11 + §04 notes shadow.

### Table `users`

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | ALL | ALL | ALL (soft) |
| traiteur_manager | `organisation_id = auth.jwt()->>'organisation_id'` | `organisation_id = auth.jwt()->>'organisation_id'` (invitation commerciaux) | `organisation_id = auth.jwt()->>'organisation_id'` | — |
| **gestionnaire_lieux** *(décision F5 test-scenarios §06.05 2026-06-07 — BLOQUANT soldé)* | `organisation_id = auth.jwt()->>'organisation_id'` | `organisation_id = auth.jwt()->>'organisation_id'` (invitation collègues — §06.05 §6, template 17) | `organisation_id = auth.jwt()->>'organisation_id'` (désactivation collègues ; garde UI : pas d'auto-désactivation) | — |
| **traiteur_commercial** *(décision F4 test-scenarios §09 lot ⑪ 2026-06-07, tranché Val)* | `organisation_id = auth.jwt()->>'organisation_id'` (lecture org-wide — sert le Bloc 7 Top 5 commerciaux §11 ; exposition email/téléphone des collègues assumée) | — | `id = auth.uid()` (son propre profil uniquement) | — |
| **agence** *(décision F1 test-scenarios §06.11 lot ⑨ 2026-06-07, tranché Val — inverse reco)* | `id = auth.uid()` (self only — **pas** d'alignement manager : Bloc 7 Top 5 commerciaux et bloc « Mon organisation > Utilisateurs » retirés V1 côté agence, cf. §06.11 différence forcée #8 ; gestion users agence = Admin only ; ne pas re-proposer l'org-wide) | — | `id = auth.uid()` (son propre profil) | — |
| autres | `id = auth.uid()` | — | `id = auth.uid()` (son propre profil) | — |

> **Note F5 (2026-06-07)** : gestionnaire_lieux était classé « autres » (self only) alors que §06.05 §6 Bloc Utilisateurs promet invitation + désactivation à tout user gestionnaire (pas de distinction manager V1) — les deux actions étaient mortes au niveau RLS. Aligné sur traiteur_manager. pgTAP : `users_gestionnaire_org_wide_ok` / `users_gestionnaire_cross_org_denied`.

### Table `evenements`

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | ALL | ALL | ALL |
| traiteur_manager | `organisation_id = auth.jwt()->>'organisation_id'` | `organisation_id = auth.jwt()->>'organisation_id'` | `organisation_id = auth.jwt()->>'organisation_id' AND f_collecte_editable(evenements.id)` (y compris collectes créées par commerciaux de l'orga ; garde fenêtre d'édition ajoutée — décision F3 test-scenarios §09 lot ⑪ 2026-06-07, cohérence 4 rôles clients, le forçage post-réalisation reste staff via back-office) | `organisation_id = auth.jwt()->>'organisation_id'` (soft) |
| traiteur_commercial | `organisation_id = auth.jwt()->>'organisation_id'` *(révision 2026-05-29 — lecture org-wide alignée manager, ex `created_by = auth.uid()`)* | `true` | `created_by = auth.uid() AND f_collecte_editable(evenements.id)` *(écriture limitée à ses propres créations. Fenêtre d'édition = fonction canonique unique `f_collecte_editable`, définie [[05 - Règles métier#Modification d'une collecte à venir (refonte 2026-05-04)]] — sobriété 2026-06-03 C2, ex-`EXISTS … statut IN (…)` inliné. Corrigé Sujet 2 2026-05-26 : `evenements.statut` supprimé (D2 2026-05-25) + `validee_pre_prestation` valeur fantôme.)* | — |
| agence | `organisation_id = auth.jwt()->>'organisation_id'` | `organisation_id = auth.jwt()->>'organisation_id'` (programmation libre, périmètre lieu + traiteur ouvert) | `organisation_id = auth.jwt()->>'organisation_id' AND f_collecte_editable(evenements.id)` *(garde fenêtre d'édition ajoutée — décision F3 test-scenarios §09 lot ⑪ 2026-06-07)* | — |
| gestionnaire_lieux | `(lieu_id IN (SELECT lieu_id FROM organisations_lieux WHERE organisation_id = auth.jwt()->>'organisation_id') AND date_evenement IS NOT NULL) OR organisation_id = auth.jwt()->>'organisation_id'` *(décision F3 test-scenarios §06.05 2026-06-07 — les brouillons tiers, `date_evenement` NULL depuis lot ① F1, sont exclus de la visibilité par lieu : anti-fuite d'intention commerciale ; ses propres brouillons restent visibles)* | `organisation_id = auth.jwt()->>'organisation_id' AND lieu_id IN (SELECT lieu_id FROM organisations_lieux WHERE organisation_id = auth.jwt()->>'organisation_id') AND traiteur_operationnel_organisation_id IN (SELECT id FROM organisations WHERE type='traiteur' AND est_shadow=false)` (programmation restreinte à ses lieux + traiteur référencé non-shadow — extension 2026-05-07) | `organisation_id = auth.jwt()->>'organisation_id' AND f_collecte_editable(evenements.id)` *(décision F4 test-scenarios §06.05 2026-06-07 — fenêtre d'édition canonique ajoutée, §06.05 « workflow d'édition identique au traiteur » ; sur ses propres événements programmés uniquement, pas sur ceux des traiteurs intervenants)* | — |
| **traiteur_manager** *(extension 2026-05-07 — visibilité traiteur opérationnel)* | OU `traiteur_operationnel_organisation_id = auth.jwt()->>'organisation_id'` (collectes programmées par tiers chez ce traiteur) | — | UPDATE limité aux événements `organisation_id = self` (modification des propres programmations seulement, pas de droit sur les programmations tierces) | — |
| **traiteur_commercial** *(extension 2026-05-07, élargie 2026-05-29)* | SELECT déjà org-wide (`organisation_id = self`) + OU `traiteur_operationnel_organisation_id = auth.jwt()->>'organisation_id'` (collectes programmées par tiers chez son traiteur opérationnel) | — | — | — |
| client_organisateur | `client_organisateur_organisation_id = auth.jwt()->>'organisation_id'` | — | — | — |

### Table `collectes`

Policy héritée de `evenements` via `evenement_id`. Même logique de filtrage. **Précision 2026-05-07** : la jointure passe par `evenements.organisation_id` (programmateur) ET `evenements.traiteur_operationnel_organisation_id` (traiteur opérationnel) pour les rôles traiteur. Les autres rôles (agence, gestionnaire_lieux) n'utilisent que `organisation_id`. Le rôle `traiteur` voit toutes les collectes où il est opérationnel, peu importe le programmateur.

> **Restriction DELETE 2026-06-07 (test scenarios §06.04 F5, arbitrage Val)** : la policy DELETE `collectes` est limitée à `statut = 'brouillon'` pour les rôles traiteur (créateur ou manager) — une collecte poussée TMS ne peut être que **annulée** (statut `annulee` → E3 `DELETE /collectes/:id` systématique vers TMS si `statut_tms ≠ non_envoye`, tous acteurs : traiteur, Ops, Admin). pgTAP : `test_collectes_delete_brouillon_only` (allow brouillon créateur, deny programmee+ manager et commercial). Cf. §06.04 policy ÉCRITURE + §05 §Annulation.

### Table `factures`

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | ALL | ALL | — (pas de suppression, uniquement avoirs) |
| traiteur_manager | `organisation_id = auth.jwt()->>'organisation_id'` | — | — | — |
| traiteur_commercial | `organisation_id = auth.jwt()->>'organisation_id'` (toutes les factures de l'orga, lecture seule) *(révision 2026-05-29 — lecture alignée manager ; option C levée : vue liste Mon organisation > Facturation accessible en lecture seule au commercial, + bouton "Télécharger la facture" sur fiche collecte)* | — | — | — |
| agence | `organisation_id = auth.jwt()->>'organisation_id'` | — | — | — |
| gestionnaire_lieux | `organisation_id = auth.jwt()->>'organisation_id'` *(décision F6 test-scenarios §06.05 2026-06-07 — BLOQUANT soldé : la matrice était restée au deny pré-extension transactionnelle 2026-05-07, rendant la section « Mon organisation > Facturation » §06.05 morte. Ses propres factures Savr uniquement ; les factures des traiteurs restent invisibles même si la collecte s'est tenue sur ses lieux)* | — | — | — |
| client_organisateur | — (pas d'accès factures V1) | — | — | — |

> **Masquage colonnes sensibles (décision F5 test-scenarios §06.08 2026-06-07)** : `factures.marge_logistique` (marge Savr, écrite par le trigger cross-schema `fn_recalc_marge_tournee`) + `erreur_synchro*` ne doivent **jamais** être lisibles par les rôles clients — la RLS row-level ne masquant pas une colonne, les rôles clients (manager, commercial, agence, gestionnaire_lieux) lisent via la **vue whitelist `v_factures_client`** (`SECURITY INVOKER` — s'exécute avec les droits de l'appelant, **⚠ nécessite une policy SELECT explicite sur `plateforme.factures`** pour les rôles `traiteur_manager`, `traiteur_commercial`, `agence`, `gestionnaire_lieux`, restreinte à `organisation_id = (auth.jwt()->>'organisation_id')::uuid` — SANS cette policy, RLS DENY ALL rend la vue vide pour tous les rôles clients ; bug détecté M3.5 2026-06-16, policy `fac_client_select` ajoutée migration M3.5) ; le SELECT direct sur `plateforme.factures` est limité staff (`admin_savr`/`ops_savr`). pgTAP : `test_factures_marge_invisible_clients` (deny SELECT table direct manager + vue sans colonne) + **`test_factures_vue_client_non_vide_manager`** (exercer `v_factures_client` sous `traiteur_manager` → liste non vide, pas d'erreur RLS) — P1 bloquants CI. Cf. [[04 - Data Model#Table : `factures`]].

### Table `bordereaux_savr`

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | ALL (auto) | ALL (régénération) | — |
| traiteur_manager | via FK collecte → evenement → organisation | — | — | — |
| traiteur_commercial | via FK collecte → evenement → organisation *(révision 2026-05-29 — lecture org-wide, ex `created_by`)* | — | — | — |
| agence | via FK collecte → evenement → organisation | — | — | — |
| gestionnaire_lieux | via FK collecte → evenement → lieu → organisations_lieux | — | — | — |
| **client_organisateur** *(ajout 2026-06-11, audit RLS B-3 — option a tranchée Val)* | via FK collecte → evenement → `client_organisateur_organisation_id = auth.jwt()->>'organisation_id'` (lecture seule) | — | — | — |

> **Note B-3 (2026-06-11)** : avant cet ajout, la ligne était deny pour `client_organisateur` alors que `f_fichier_visible` (§3ter C1) lui donnait déjà le **PDF** via `f_collecte_visible` — incohérence ligne/fichier. Tranché Val (option a) : le client organisateur lit la ligne ET le fichier de ses événements. `f_fichier_visible` inchangée. pgTAP : `bordereaux_client_orga_own_event_ok` / `attestations_client_orga_cross_org_denied`.

### Table `attestations_don`

Même logique que `bordereaux_savr` (y compris la ligne `client_organisateur`, B-3a 2026-06-11).

### Table `packs_antgaspi` *(extension 2026-05-07)*

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | ALL | ALL | — |
| **ops_savr** *(conflit tranché Val 2026-06-11, audit RLS — la matrice étendue fait foi)* | ALL | ALL | ALL | — |
| traiteur_manager | `organisation_id = auth.jwt()->>'organisation_id'` | — | — | — |
| **agence** *(2026-05-07)* | `organisation_id = auth.jwt()->>'organisation_id'` | — | — | — |
| **gestionnaire_lieux** *(2026-05-07)* | `organisation_id = auth.jwt()->>'organisation_id'` | — | — | — |
| autres | — | — | — | — |

> **Note 2026-05-07, révisée 2026-06-11 (audit RLS, tranché Val)** : l'écriture pack (créer / ajuster crédits / annuler, motif obligatoire) est **staff** (`admin_savr` + `ops_savr`) — alignement sur la matrice étendue ops_savr (« Packs AG : Oui », confirmée F2 2026-06-07), qui fait foi pour les écritures. L'ancienne mention « admin only » de cette note était le conflit B-1 de l'audit RLS 2026-06-11. Lecture étendue aux 3 types programmateurs car le pack actif détermine la possibilité de programmer une AG. pgTAP : `packs_ag_write_ops_ok` / `packs_ag_write_client_denied`.

### Table `lieux`

| Rôle       | SELECT                                                                                                                                                                                                      | INSERT | UPDATE | DELETE |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | ------ |
| admin_savr | ALL                                                                                                                                                                                                         | ALL    | ALL    | ALL    |
| autres     | `id IN (SELECT lieu_id FROM organisations_lieux WHERE organisation_id = auth.jwt()->>'organisation_id')` OR `id IN (SELECT lieu_id FROM evenements WHERE organisation_id = auth.jwt()->>'organisation_id')` | —      | —      | —      |

### Tables référentiel (`associations`, `transporteurs`, `flux_dechets`, `types_evenements`, `contacts_traiteurs`)

> ⚠ **`prestataires_logistiques` retirée de cette ligne (audit RLS 2026-06-11, B-4)** : la table est migrée vers `shared.prestataires` (2026-04-23) dont le SELECT est **`admin_savr`/`ops_savr` uniquement** (addendum cross-schema en tête de ce document). L'ancienne mention ici ouvrait par erreur la lecture du réseau logistique Savr à tous les rôles clients. pgTAP : `prestataires_client_roles_denied`.

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | ALL | ALL | ALL |
| traiteur_manager / traiteur_commercial | ALL référentiels + `contacts_traiteurs` limité à `organisation_id = auth.jwt()->>'organisation_id'` | `contacts_traiteurs` (organisation_id = sien) | `contacts_traiteurs` (organisation_id = sien) | — (soft seulement) |
| autres | ALL référentiels (lecture) | — | — | — |

### Table `tournees`

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | ALL | ALL | ALL (soft) |
| autres | lecture via jointure `collecte_tournees` → `tournees` filtrée par leur périmètre *(refonte multi-camions 2026-05-25, ex `collectes.tournee_id`)* (ex: un traiteur voit les tournées de ses collectes — N tournées possibles en multi-camions — mais pas les autres collectes qui les composent) | — | — | — |

**SQL explicite (audit RLS 2026-06-11, B-5 — la formulation narrative n'était pas transposable sans interprétation)** :

```sql
ALTER TABLE plateforme.tournees ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_select ON plateforme.tournees FOR SELECT
  USING (plateforme.f_is_staff() OR EXISTS (
    SELECT 1 FROM plateforme.collecte_tournees ct
    WHERE ct.tournee_id = tournees.id
      AND plateforme.f_collecte_visible(ct.collecte_id)));
-- INSERT/UPDATE/DELETE : SERVICE_ROLE (adapter MTS-1 / cron poll) + admin_savr (matrice ci-dessus).
```

### Table `collecte_tournees`

**Nouvelle table V1 (refonte multi-camions 2026-05-25)** — table de liaison N↔N collectes/tournées.

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | ALL | ALL | ALL (soft) |
| autres | lecture des lignes dont la `collecte_id` est dans leur périmètre (RLS dérivée de `collectes` : un traiteur/gestionnaire voit les liaisons de ses propres collectes) | — | — | — |

Écriture réservée au système (webhook `tournee-upsert` via service role). Aucun rôle applicatif n'insère/modifie directement.

### Table `tarifs_negocie` *(renommée 2026-04-28, ex `tarifs_zd_par_gestionnaire` ; refonte tarification 2026-05-26 — ne porte plus que des remises %)*

> **Refonte 2026-05-26** : `tarifs_negocie` ne contient plus de prix absolu — uniquement des **remises %** (`remise_pct`) cumulables sur la base (catalogue `grilles_tarifaires_zd`). Scope `organisation` (bénéficiaire) ou `gestionnaire` (négociateur, ex Viparis). Saisie Admin contrôlée. Le prix résolu (`base × Π(1 − remise_pct)`) est calculé en backend, non affiché au formulaire (Sujet 5), restitué sur la facture. **RLS de la base `grilles_tarifaires_zd` + `tarifs_zero_dechet` + `tarifs_packs_ag` : traitée audit RLS V1 2026-06-05 → §3ter A5** (lecture authentifiée, écriture admin only).

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | ALL | ALL | ALL |
| gestionnaire_lieux | `scope = 'gestionnaire' AND gestionnaire_organisation_id = auth.jwt()->>'organisation_id'` (lecture seule des remises qu'il a négociées) | — | — | — |
| autres | — | — | — | — |

**Lecture indirecte (bénéficiaire)** : les organisations bénéficiaires (`scope = 'organisation'`, traiteur/agence/gestionnaire programmateur) n'accèdent pas directement à la table — la remise leur est restituée via le détail de facture (`factures_collectes.tarif_detail` jsonb, figé). Cohérent avec le tarif non affiché au formulaire.

### Tables financières internes (`courses_logistiques`, `entites_facturation` Savr)

> **Section vidée (audit RLS 2026-06-11)** : `courses_logistiques` = vue `v_courses_logistiques` **V2 non créée V1** (cf. §04) ; `entites_facturation` n'est **pas** une table interne Savr — elle porte les entités de facturation de **toutes** les organisations clientes, le deny total rendait le sélecteur d'entité §06.01 et « Mon organisation » morts. **Policy corrigée → [[#Q2 — `entites_facturation`|§3quater Q2]]** (lecture org-scoped clients, écriture staff).

### Table `parametres_taux_recyclage` *(ajout 2026-05-06)*

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | ALL | ALL | — (suppression interdite V1, bascule via `actif=false`) |
| ops_savr | ALL | — | — | — |
| autres | — | — | — | — |

**Justification écriture admin_savr only** : impact direct sur le calcul du Taux de recyclage figé sur les futures collectes clôturées + audit réglementaire requis. Restreint Val + Louis.

**Lecture indirecte** : tous les rôles lecteurs de `collectes` accèdent au snapshot via `collectes.caps_appliques jsonb` (figé à la clôture, jamais réécrit).

### Table `parametres_taux_recyclage_history` *(ajout 2026-05-06 — audit trail)*

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | — *(insertion via trigger DB uniquement)* | — | — |
| ops_savr | ALL | — | — | — |
| autres | — | — | — | — |

**Insertion** : interdite à tous via API. Le trigger DB `AFTER UPDATE` sur `parametres_taux_recyclage` insère automatiquement avec `modifie_par = auth.uid()`. Pas de modification a posteriori (immuable).

### Tables Facteurs CO₂ *(ajout 2026-06-04, Sujet 3)*

Même politique que `parametres_taux_recyclage` (écriture `admin_savr`, lecture `ops_savr`, lecture indirecte des autres rôles via le snapshot `collectes.co2_facteurs_snapshot` figé à la clôture).

`parametres_facteurs_co2`, `parametres_mix_emballages` et `parametres_facteurs_co2_ag` *(AG, ajout 2026-06-04 bis)* :

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | ALL | ALL | — (bascule via `actif=false`) |
| ops_savr | ALL | — | — | — |
| autres | — | — | — | — |

`parametres_facteurs_co2_history`, `parametres_mix_emballages_history` et `parametres_facteurs_co2_ag_history` :

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | — *(trigger DB uniquement)* | — | — |
| ops_savr | ALL | — | — | — |
| autres | — | — | — | — |

`parametres_co2_divers` (forfait collecte + équivalences) :

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | ALL | ALL | — |
| ops_savr | ALL | — | — | — |
| autres | — | — | — | — |

**Notes** : (1) la ligne `emballage` de `parametres_facteurs_co2` est maintenue par le trigger `fn_recompute_emballage_fe` — l'API rejette l'écriture directe de ses `fe_induit`/`fe_evite` (cf. §08 9ter.1). (2) `parametres_co2_divers` est audité via `audit_log` (pas de table history dédiée). (3) Lecture indirecte tous rôles : grandeurs CO₂ figées sur `collectes` (`co2_*`, `energie_primaire_evitee_kwh`, `co2_facteurs_snapshot`) selon RLS habituelle `collectes`, sans accès aux tables de référence.

### Table `coefficients_perte_labo` *(ajout 2026-05-22)*

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| admin_savr | ALL | ALL | ALL | — (pas de hard delete V1, correction via UPDATE) |
| ops_savr | ALL | — | — | — |
| autres (`gestionnaire_lieux`, traiteur) | — | — | — | — |

**Justification écriture admin_savr only** : le coefficient est communiqué par le traiteur puis saisi par Savr ; il alimente une estimation affichée au gestionnaire de lieux. Saisie réservée Admin (§06.06). `ops_savr` lecture seule.

**Lecture indirecte par le gestionnaire de lieux** : le rôle `gestionnaire_lieux` n'a **aucun accès direct** à la table. L'estimation `pax × coefficient` est calculée par une **fonction PostgreSQL SECURITY DEFINER** (ex: `f_dechets_labo_estimes(p_evenement_id uuid) RETURNS numeric`) qui lit `coefficients_perte_labo` avec les droits du propriétaire, vérifie que l'événement appartient bien au périmètre du gestionnaire (jointure `organisations_lieux`), et ne retourne **que la valeur kg** — jamais le coefficient brut du traiteur. Même principe pour la colonne de la liste Événements (calcul serveur). Cf. [[05 - Règles métier#R_dechets_labo_estimes]] et [[06 - Fonctionnalités détaillées/05 - Espace client gestionnaire de lieux]].

### Table `integrations_logs`

Admin Savr uniquement.

### Matrice étendue `ops_savr` — back-office Plateforme *(ajout 2026-05-07)*

> **Source de vérité unique des permissions `ops_savr` (sobriété 2026-06-03 C1).** Cette matrice fait foi. Les mentions `ops_savr` dispersées dans [[06 - Fonctionnalités détaillées/06 - Back-office Admin Savr]] (Oui/Non par écran) ne sont que des rappels de contexte UI — **en cas d'écart, c'est cette matrice qui prévaut**. Toute évolution des droits `ops_savr` se fait ici en premier, puis se reflète côté §06.06. Ne jamais redéfinir un droit `ops_savr` ailleurs sans le porter ici.

Synthèse des permissions Ops Savr appliquées au back-office (détail écran par écran : [[06 - Fonctionnalités détaillées/06 - Back-office Admin Savr]] §Principe + §Permissions par section — subordonné à cette matrice).

**Principe général** :
- `ops_savr` a la même surface de **lecture** que `admin_savr` (toutes tables back-office).
- `ops_savr` peut effectuer la majorité des **écritures opérationnelles** (modifier collectes, valider factures, normaliser lieux, gérer users hors hard delete, modifier associations hors SIREN/habilitation).
- `ops_savr` est **bloqué** sur les écritures structurelles ou sensibles (cf. tableau ci-dessous).

| Domaine | Action | `admin_savr` | `ops_savr` |
|---------|--------|--------------|------------|
| **Collectes** | Lecture | Oui | Oui |
| | Modifier infos / pesées / photos | Oui | Oui |
| | Renvoyer S7 (sans override prestataire) | Oui | Oui |
| | Override prestataire AG avec motif | **Oui** | **Non** (403) |
| | Annuler crédit collecte AG | Oui | Oui |
| | Forcer changement statut | Oui | Oui |
| **Factures** | Lecture | Oui | Oui |
| | Valider + envoyer Pennylane | Oui | Oui |
| | *(purgé 2026-06-07 — résidu : pas de relance côté Savr V1, relances Pennylane, décision 2026-04-28, cf. §06.06 §4)* | — | — |
| | Éditer ligne / montant | **Oui** | **Non** |
| | Annuler / Générer avoir | **Oui** | **Non** |
| **Associations** | Lecture | Oui | Oui |
| | Modifier contacts / horaires / capacité / description | Oui | Oui |
| | Modifier SIREN | **Oui** | **Non** |
| | Modifier habilitation 2041-GE | **Oui** | **Non** |
| | Désactiver (`actif=false`) | **Oui** | **Non** |
| **Lieux / Transporteurs** | Lecture / écriture / désactivation | Oui | Oui (V1, à raffiner V2) |
| **Organisations** | Lecture | Oui | Oui |
| | Modifier infos générales (logo, contacts) | Oui | Oui |
| | Modifier `tarif_refacture_pax_zd` | **Oui** | **Non** |
| | *(retiré V1 — F6 2026-06-07, fusion = script SQL hors UI, cf. §06.06 §8)* | — | — |
| **Users** | Créer / inviter / suspendre | Oui | Oui |
| | Changer rôle (sauf promotion `admin_savr`) | Oui | Oui |
| | Promouvoir un user en `admin_savr` | **Oui** | **Non** |
| | Hard delete | **Oui** | **Non** |
| | Impersonation | **Oui** | **Non** |
| **Packs AG** | Lecture | Oui | Oui |
| | Créer / ajuster crédits / annuler le pack (motif obligatoire) | Oui | Oui *(confirmé Val 2026-06-07 F2 — cette matrice fait foi, §06.06 §8 aligné ; « annuler le pack » explicité)* |
| **Paramètres §9** | Lecture (vue read-only avec bandeau) | Oui | Oui |
| | Toute écriture (tarifs, algo, intégrations, taux recyclage, users Savr, facteurs ADEME, templates emails, référentiels, configuration) | **Oui** | **Non** |
| **Audit log** | Lecture | Oui | Oui |
| | Écriture | — (trigger DB) | — |

**Implémentation** :
- Middleware `requireRole(['admin_savr', 'ops_savr'])` sur les routes back-office généralistes.
- Middleware `requireRole(['admin_savr'])` sur les routes/champs sensibles listés ci-dessus (override AG, tarif refacturé, fusion, impersonation, paramètres, hard delete).
- Côté UI : les composants admin-only sont masqués pour `ops_savr` (toggle, bouton, champ) ou affichés en grisé avec tooltip "Action réservée admin Savr".

**V2 envisagé** : permissions granulaires configurables par admin (matrice par module, checkbox UI). V1 = matrice figée en code.

---

## 3ter. Policies RLS complémentaires — Audit RLS V1 (2026-06-05)

> **Origine** : audit RLS skill `cdc-audit-rls` sur le périmètre **V1 (Plateforme seule, `plateforme.*` + `shared.fichiers`)**. Le croisement §04 ↔ §09 a révélé des tables du data model **non couvertes** par la matrice §3. Cette section les dote toutes d'une policy explicite. Source de vérité RLS pour ces tables = **ici**. Le schéma `tms.*` n'existe pas en V1 → policies cross-schema TMS↔Plateforme hors périmètre (cible V2).

### Helper de visibilité collecte (source unique)

Plusieurs tables filles (`collecte_flux`, `attributions_antgaspi`, `factures_collectes`, `rapports_rse`) doivent répliquer **exactement** la logique de visibilité de `collectes` (§3 tables `evenements`/`collectes`). Pour éviter la duplication et la dérive, on centralise dans une fonction `SECURITY DEFINER` :

```sql
CREATE FUNCTION plateforme.f_collecte_visible(p_collecte_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1
    FROM plateforme.collectes c
    JOIN plateforme.evenements e ON e.id = c.evenement_id
    WHERE c.id = p_collecte_id
      AND (
        auth.jwt()->>'role' IN ('admin_savr','ops_savr')
        OR e.organisation_id = auth.jwt()->>'organisation_id'
        OR e.traiteur_operationnel_organisation_id = auth.jwt()->>'organisation_id'
        OR e.client_organisateur_organisation_id = auth.jwt()->>'organisation_id'
        OR (e.date_evenement IS NOT NULL  -- garde brouillons tiers (ajout 2026-06-11, audit RLS B-2 — miroir F3 lot ⑤)
            AND e.lieu_id IN (SELECT lieu_id FROM plateforme.organisations_lieux
                              WHERE organisation_id = auth.jwt()->>'organisation_id'))
      )
  );
$$;
```

> Le prédicat est volontairement le **miroir** de la policy SELECT `collectes` (§3). Toute évolution de la visibilité collecte se fait dans cette fonction **et** dans la policy `collectes`, jamais dans les tables filles.
>
> **B-2 (audit RLS 2026-06-11)** : la garde `date_evenement IS NOT NULL` du chemin lieu réplique l'anti-fuite brouillons tiers de la policy `evenements` (F3 lot ⑤) — sans elle, un gestionnaire lisait via les tables filles (pesées, fichiers) une intention commerciale exclue de la policy `evenements`. **Cette fonction est l'unique source du prédicat de visibilité collecte** ; la note 2026-05-07 sous la table `collectes` (§3, « agence/gestionnaire n'utilisent que organisation_id ») est **subordonnée à cette fonction** en cas d'écart. pgTAP : `collecte_flux_brouillon_tiers_denied`.

### A1 — `organisations_lieux`

**BLOQUANT.** Table de jointure utilisée dans les sous-requêtes RLS de `evenements`, `lieux`, `collectes` (gestionnaire). **RLS activée sans policy = deny total → toutes les sous-requêtes dépendantes renvoient vide** (bug silencieux). Policy explicite obligatoire :

```sql
ALTER TABLE plateforme.organisations_lieux ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_lieux_admin ON plateforme.organisations_lieux
  FOR ALL USING (auth.jwt()->>'role' IN ('admin_savr','ops_savr'))
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr'); -- création réservée Admin (cf. created_by §04)
CREATE POLICY org_lieux_self_select ON plateforme.organisations_lieux
  FOR SELECT USING (organisation_id = auth.jwt()->>'organisation_id');
```

> Les fonctions `SECURITY DEFINER` (ex. `f_collecte_visible`, `f_dechets_labo_estimes`) lisent `organisations_lieux` avec les droits du propriétaire et ne sont donc pas affectées ; mais les sous-requêtes inline des policies `evenements`/`lieux` (§3) **le sont** → la policy `org_lieux_self_select` est indispensable.

### A2 — `outbox_events`

**BLOQUANT — table à créer §04 (garde-fou 4).** Table du pattern transactional outbox (events sortants E1/E2/E3/E5). Écrite par trigger / lue par l'adapter MTS-1, **tous deux en `SERVICE_ROLE` (bypass RLS)**. Aucun rôle applicatif ne doit y accéder, sauf Admin en lecture pour le debug.

```sql
ALTER TABLE plateforme.outbox_events ENABLE ROW LEVEL SECURITY;
-- aucune policy app → deny total ; l'adapter et le trigger écrivent en SERVICE_ROLE.
CREATE POLICY outbox_admin_read ON plateforme.outbox_events
  FOR SELECT USING (auth.jwt()->>'role' = 'admin_savr');
```

### A2bis — `email_templates` + `emails_envoyes` *(ajout 2026-06-07 — F1 session test-scenarios §06.02)*

Tables du pipeline email Resend (§08 §4), spécifiées §06.02/§08 mais absentes de l'audit du 2026-06-05. `emails_envoyes` contient des **PII** (`destinataire_email`). Même patron que `outbox_events` : écriture `SERVICE_ROLE` seule (Edge Function `send-email`, webhook `/webhooks/resend/events`, seed/migrations), lecture Admin debug, deny tout autre rôle.

```sql
ALTER TABLE plateforme.email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_templates_admin_read ON plateforme.email_templates
  FOR SELECT USING (auth.jwt()->>'role' = 'admin_savr');
-- INSERT/UPDATE/DELETE : aucun rôle app (SERVICE_ROLE uniquement — édition V1 par migration, sobriété A1 2026-06-03).

ALTER TABLE plateforme.emails_envoyes ENABLE ROW LEVEL SECURITY;
CREATE POLICY emails_envoyes_admin_read ON plateforme.emails_envoyes
  FOR SELECT USING (auth.jwt()->>'role' = 'admin_savr');
-- INSERT/UPDATE : SERVICE_ROLE uniquement (envoi + MAJ statut webhook). DELETE : aucun (historique).
```

**pgTAP** : ≥ 1 test deny + 1 test allow par table sous `authenticated` (cf. `tests/06.02-templates-emails-scenarios.md` cat. 4).

### A3 — `integrations_inbox`

Table système (dédup idempotence). Écrite en `SERVICE_ROLE` à la réception des events/webhooks MTS-1. Deny total aux rôles applicatifs.

```sql
ALTER TABLE plateforme.integrations_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY inbox_admin_read ON plateforme.integrations_inbox
  FOR SELECT USING (auth.jwt()->>'role' IN ('admin_savr','ops_savr'));
-- INSERT/UPDATE/DELETE : aucun rôle app (SERVICE_ROLE uniquement).
```

> Idem `integrations_logs` (§3 « Admin Savr uniquement ») : lecture Admin/Ops, écriture SERVICE_ROLE.

### A4 — `factures_collectes`

**BLOQUANT — contient `tarif_detail` (base + remises négociées figées).** Jointure N-N facture↔collecte. Sans policy : soit deny (casse la lecture facture client), soit fuite des remises négociées cross-org. Visibilité dérivée de `factures`.

```sql
ALTER TABLE plateforme.factures_collectes ENABLE ROW LEVEL SECURITY;
CREATE POLICY fc_select ON plateforme.factures_collectes FOR SELECT
  USING (
    auth.jwt()->>'role' IN ('admin_savr','ops_savr')
    OR EXISTS (SELECT 1 FROM plateforme.factures f
               WHERE f.id = factures_collectes.facture_id
                 AND f.organisation_id = auth.jwt()->>'organisation_id')
  );
-- INSERT/UPDATE/DELETE : admin_savr only (génération facture).
CREATE POLICY fc_write_admin ON plateforme.factures_collectes
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');
```

> Cohérent avec la lecture facture du commercial alignée manager (révision 2026-05-29) : le commercial voit les `factures_collectes` de l'orga via la FK `factures`.

### A5 — `grilles_tarifaires_zd` + `tarifs_zero_dechet` + `tarifs_packs_ag`

Catalogue tarifaire. Base de calcul du prix. Lecture **authentifiée** (le moteur de tarif résout `base × Π(1−remises)` côté backend ; aucune donnée sensible par orga dans la grille publique), **écriture `admin_savr` only**.

```sql
ALTER TABLE plateforme.grilles_tarifaires_zd ENABLE ROW LEVEL SECURITY;
ALTER TABLE plateforme.tarifs_zero_dechet   ENABLE ROW LEVEL SECURITY;
ALTER TABLE plateforme.tarifs_packs_ag      ENABLE ROW LEVEL SECURITY;
-- même politique pour les 3 :
CREATE POLICY tarif_cat_read  ON plateforme.<table> FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY tarif_cat_write ON plateforme.<table> FOR ALL
  USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');
```

> Le prix résolu n'est jamais affiché au formulaire (Sujet 5) — c'est une règle UI, pas RLS. La grille reste lisible (référentiel partagé). Le **détail négocié** (remises par orga) vit dans `tarifs_negocie` (§3, déjà restreint) et `factures_collectes.tarif_detail` (A4).

### A6/A7 — `collecte_flux` + `attributions_antgaspi`

Tables filles de collecte. Visibilité = celle de la collecte parente. Écriture système (webhook clôture / algo) en `SERVICE_ROLE`.

```sql
ALTER TABLE plateforme.collecte_flux         ENABLE ROW LEVEL SECURITY;
ALTER TABLE plateforme.attributions_antgaspi ENABLE ROW LEVEL SECURITY;
CREATE POLICY cf_select ON plateforme.collecte_flux FOR SELECT
  USING (plateforme.f_collecte_visible(collecte_id));
-- F1 test-scenarios §09 lot ⑪ (tranché Val 2026-06-07) : édition manuelle des pesées par flux
-- (§06.06 fiche collecte Bloc 2 + matrice étendue « Modifier pesées : Ops Oui ») = policy UPDATE
-- explicite admin + ops. INSERT reste SERVICE_ROLE (5 flux auto-créés à la création de la collecte ZD).
CREATE POLICY cf_update_staff ON plateforme.collecte_flux FOR UPDATE
  USING (auth.jwt()->>'role' IN ('admin_savr','ops_savr'))
  WITH CHECK (auth.jwt()->>'role' IN ('admin_savr','ops_savr'));
-- C-1 (audit RLS 2026-06-11, tranché Val) : aa_select N'UTILISE PAS f_collecte_visible.
-- attributions_antgaspi contient des données opérationnelles internes (confirmation_transporteur,
-- ranking algo, références MTS-1/Everest) : client_organisateur et gestionnaire_lieux (chemin lieu)
-- sont EXCLUS. Visibilité = staff + programmateur + traiteur opérationnel uniquement.
-- Le client/gestionnaire ne voit que les agrégats figés sur `collectes` (repas donnés, association).
CREATE POLICY aa_select ON plateforme.attributions_antgaspi FOR SELECT
  USING (
    plateforme.f_is_staff()
    OR EXISTS (SELECT 1 FROM plateforme.collectes c
               JOIN plateforme.evenements e ON e.id = c.evenement_id
               WHERE c.id = attributions_antgaspi.collecte_id
                 AND (e.organisation_id = auth.jwt()->>'organisation_id'
                   OR e.traiteur_operationnel_organisation_id = auth.jwt()->>'organisation_id')));
-- INSERT/UPDATE : admin_savr (override AG + saisie poids) + ops_savr (saisie poids_repas_kg V1) + SERVICE_ROLE (algo).
-- Pas d'écriture cliente. (F1 test-scenarios §06.09 2026-06-07 — ops_savr saisit manuellement le poids depuis photos pesées)
CREATE POLICY aa_write_admin ON plateforme.attributions_antgaspi FOR ALL
  USING (auth.jwt()->>'role' = 'admin_savr') WITH CHECK (auth.jwt()->>'role' = 'admin_savr');
-- ops_savr : UPDATE limité aux colonnes poids/volume uniquement (colonne-level via vue ou applicatif)
-- V1 : contrôle applicatif côté API (ops_savr ne peut modifier que poids_repas_kg + volume_repas_realise)
CREATE POLICY aa_write_ops_poids ON plateforme.attributions_antgaspi FOR UPDATE
  USING (auth.jwt()->>'role' = 'ops_savr') WITH CHECK (auth.jwt()->>'role' = 'ops_savr');
-- pgTAP : test_a6a7_ops_can_update_poids_repas_kg (P1 bloquant CI)
```

### A8 — `rapports_rse`

Org-scoped via événement. Lecture par l'organisation de l'événement (l'embargo H+24 `disponible_a` est un contrôle **applicatif**, pas RLS). Écriture système (batch J+1) + Admin (régénération).

> **Régénération manuelle traiteur_manager (tranché 2026-06-07, F3 test-scenarios lot ⑫)** : la régénération §12 §1.2 ouverte au manager passe par une **Edge Function SERVICE_ROLE** qui contrôle applicativement le périmètre du demandeur (mêmes 4 chemins org que `rr_select`) avant d'écrire. La policy `rr_write_admin` ci-dessous reste **inchangée** — aucune écriture client directe. pgTAP/Vitest P1 bloquant CI : `test_rapports_rse_regen_cross_org_denied` (manager org B tente la régénération d'un rapport org A → 403, ligne intacte).

```sql
ALTER TABLE plateforme.rapports_rse ENABLE ROW LEVEL SECURITY;
CREATE POLICY rr_select ON plateforme.rapports_rse FOR SELECT
  USING (
    auth.jwt()->>'role' IN ('admin_savr','ops_savr')
    OR EXISTS (SELECT 1 FROM plateforme.evenements e
               WHERE e.id = rapports_rse.evenement_id
                 AND ( e.organisation_id = auth.jwt()->>'organisation_id'
                    OR e.traiteur_operationnel_organisation_id = auth.jwt()->>'organisation_id'
                    OR e.client_organisateur_organisation_id = auth.jwt()->>'organisation_id'
                    OR e.lieu_id IN (SELECT lieu_id FROM plateforme.organisations_lieux
                                     WHERE organisation_id = auth.jwt()->>'organisation_id') ))
  );
CREATE POLICY rr_write_admin ON plateforme.rapports_rse FOR ALL
  USING (auth.jwt()->>'role' = 'admin_savr') WITH CHECK (auth.jwt()->>'role' = 'admin_savr');
```

### A9 — `parametres_algo` *(RLS déjà spécifiée §04 — report ici pour consolidation)*

La policy existe inline au [[04 - Data Model]] (table `parametres_algo`, admin W / ops R) mais manquait à la matrice §09. Reportée pour source unique :

```sql
ALTER TABLE plateforme.parametres_algo ENABLE ROW LEVEL SECURITY;
CREATE POLICY pa_read  ON plateforme.parametres_algo FOR SELECT
  USING (auth.jwt()->>'role' IN ('admin_savr','ops_savr'));
CREATE POLICY pa_write ON plateforme.parametres_algo FOR ALL
  USING (auth.jwt()->>'role' = 'admin_savr') WITH CHECK (auth.jwt()->>'role' = 'admin_savr');
```

### A9bis — `config_auto_accept_ag` *(nouvelle — F1 test-scenarios §06.09, tranché Val 2026-06-07)*

Table de configuration auto-accept AG. Lecture et écriture `admin_savr` uniquement — les règles auto-accept sont une décision d'exploitation sensible, pas exposée aux rôles Ops.

```sql
ALTER TABLE plateforme.config_auto_accept_ag ENABLE ROW LEVEL SECURITY;
CREATE POLICY caa_admin ON plateforme.config_auto_accept_ag FOR ALL
  USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');
```

pgTAP : `test_m09bis_config_auto_accept_ag_ops_deny` — ops_savr tente SELECT → 0 lignes.

### A10 — `exports_registre` + `documents_generaux_savr`

`exports_registre` : trace d'audit des exports — chaque user voit **ses propres** exports + Admin/Ops voient tout. `documents_generaux_savr` : documents statiques publics (méthodo, CGV) — lecture **tous authentifiés** sur `actif=true`, écriture Admin.

```sql
ALTER TABLE plateforme.exports_registre ENABLE ROW LEVEL SECURITY;
CREATE POLICY er_select ON plateforme.exports_registre FOR SELECT
  USING (auth.jwt()->>'role' IN ('admin_savr','ops_savr')
         OR user_id = auth.uid());
CREATE POLICY er_insert ON plateforme.exports_registre FOR INSERT
  WITH CHECK (user_id = auth.uid()
              AND organisation_id = auth.jwt()->>'organisation_id'); -- trace propre périmètre

ALTER TABLE plateforme.documents_generaux_savr ENABLE ROW LEVEL SECURITY;
CREATE POLICY dg_read  ON plateforme.documents_generaux_savr FOR SELECT
  USING (actif = true OR auth.jwt()->>'role' IN ('admin_savr','ops_savr'));
CREATE POLICY dg_write ON plateforme.documents_generaux_savr FOR ALL
  USING (auth.jwt()->>'role' = 'admin_savr') WITH CHECK (auth.jwt()->>'role' = 'admin_savr');
```

### C1 — `shared.fichiers`

**BLOQUANT — fuite cross-org de PDF/photos.** Table polymorphe (`entity_type`/`entity_id`, pas de FK). **Aucune policy RLS au §04** : le contrôle d'accès repose aujourd'hui **uniquement** sur les URLs pré-signées générées côté API Routes. Si un user requête `shared.fichiers` directement (ou si une route oublie le check), il lit les bordereaux/photos/attestations de **n'importe quelle orga**. Risque RGPD + secret commercial. Policy basée sur l'ownership de l'entité propriétaire :

```sql
CREATE FUNCTION shared.f_fichier_visible(p_entity_type text, p_entity_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE p_entity_type
    WHEN 'plateforme.collectes'       THEN plateforme.f_collecte_visible(p_entity_id)
    WHEN 'plateforme.bordereaux_savr' THEN plateforme.f_collecte_visible(
           (SELECT collecte_id FROM plateforme.bordereaux_savr WHERE id = p_entity_id))
    WHEN 'plateforme.attestations_don' THEN plateforme.f_collecte_visible(
           (SELECT collecte_id FROM plateforme.attestations_don WHERE id = p_entity_id))
    WHEN 'plateforme.rapports_rse'    THEN EXISTS (
           SELECT 1 FROM plateforme.rapports_rse r
           WHERE r.id = p_entity_id /* visibilité déléguée à la policy rapports_rse via jointure event */
             AND EXISTS (SELECT 1 FROM plateforme.evenements e WHERE e.id = r.evenement_id
                         AND (e.organisation_id = auth.jwt()->>'organisation_id'
                           OR e.traiteur_operationnel_organisation_id = auth.jwt()->>'organisation_id'
                           OR e.client_organisateur_organisation_id = auth.jwt()->>'organisation_id')))
    WHEN 'plateforme.organisations'   THEN p_entity_id = auth.jwt()->>'organisation_id' -- logos (affichage client-side = sa propre orga ; l'embed PDF côté serveur passe en SERVICE_ROLE)
    WHEN 'plateforme.lieux'           THEN p_entity_id IN (
           SELECT lieu_id FROM plateforme.organisations_lieux WHERE organisation_id = auth.jwt()->>'organisation_id'
           UNION SELECT lieu_id FROM plateforme.evenements WHERE organisation_id = auth.jwt()->>'organisation_id')
    WHEN 'plateforme.evenements'      THEN EXISTS ( -- logo client organisateur uploadé à la programmation
           SELECT 1 FROM plateforme.evenements e WHERE e.id = p_entity_id
             AND ( e.organisation_id = auth.jwt()->>'organisation_id'
                OR e.traiteur_operationnel_organisation_id = auth.jwt()->>'organisation_id'
                OR e.client_organisateur_organisation_id = auth.jwt()->>'organisation_id'
                OR e.lieu_id IN (SELECT lieu_id FROM plateforme.organisations_lieux
                                 WHERE organisation_id = auth.jwt()->>'organisation_id') ))
    WHEN 'plateforme.factures'        THEN EXISTS ( -- copie PDF Savr (pdf_url_savr) : scope STRICT = RLS table factures
           SELECT 1 FROM plateforme.factures f WHERE f.id = p_entity_id
             AND f.organisation_id = auth.jwt()->>'organisation_id'
             AND auth.jwt()->>'role' IN ('traiteur_manager','traiteur_commercial','agence','gestionnaire_lieux'))
           -- gestionnaire_lieux ajouté décision F6 test-scenarios §06.05 2026-06-07 (miroir §3 factures : ses propres factures
           -- uniquement, organisation_id = self — les factures des traiteurs sur ses lieux restent invisibles).
           -- client_organisateur : AUCUN accès aux PDF de factures (miroir §3 table factures)
    WHEN 'plateforme.documents_generaux_savr' THEN EXISTS ( -- CGV / méthodo / politique conf. = public
           SELECT 1 FROM plateforme.documents_generaux_savr d WHERE d.id = p_entity_id AND d.actif = true)
    ELSE false END;
$$;

ALTER TABLE shared.fichiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY fichiers_select ON shared.fichiers FOR SELECT
  USING (deleted_at IS NULL
         AND ( auth.jwt()->>'role' IN ('admin_savr','ops_savr')
            OR shared.f_fichier_visible(entity_type, entity_id) ));
-- INSERT/UPDATE/DELETE : SERVICE_ROLE (generate-pdf.ts, uploads) + admin_savr.
```

> ✅ **Liste exhaustive validée Val 2026-06-05** : **9 `entity_type` Plateforme V1** = `collectes` (photos + photo « aucun repas »), `bordereaux_savr`, `attestations_don`, `rapports_rse`, `organisations` (logos), `lieux` (photos), `evenements` (logo client organisateur), `factures` (copie PDF Savr `pdf_url_savr`, **scope strict = RLS table `factures`** : admin/ops + traiteur/agence/gestionnaire org-scoped *(gestionnaire ajouté décision F6 2026-06-07 — ses propres factures Savr)*, **jamais** client organisateur), `documents_generaux_savr` (CGV/méthodo/politique conf. = **public** `actif=true`). Tout `entity_type` non listé → `false` (deny par défaut, fail-safe). Exclus V1 : `briefs_evenement` (Module 19 non créé V1) + `tms.*` (`tms.pesees`/`tms.chauffeurs` inexistants V1). Fondement : §07 « toute référence de fichier est enregistrée dans `shared.fichiers` » → tous les `pdf_url`/`logo_url`/`photos_urls` ont une ligne.

### B1 — `collectes` : SQL INSERT explicite *(levée d'ambiguïté)*

La policy `collectes` est « héritée de `evenements` via `evenement_id` » (§3) — non transposable telle quelle en SQL. Préciser pour le dev, en particulier le `WITH CHECK` INSERT commercial :

```sql
-- SELECT : miroir de f_collecte_visible (cf. supra).
-- INSERT (traiteur_commercial/manager/agence/gestionnaire) :
CREATE POLICY collectes_insert ON plateforme.collectes FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM plateforme.evenements e
                      WHERE e.id = evenement_id
                        AND e.organisation_id = auth.jwt()->>'organisation_id'));
-- UPDATE commercial : created_by = auth.uid() AND f_collecte_editable(evenement_id) (cf. §05).
```

---

## 3quater. Policies RLS complémentaires — Audit RLS V1 post-35 patchs (2026-06-11)

> **Origine** : audit RLS skill `cdc-audit-rls` re-passé après les 35 patchs data model du 11/06 (dont dissolution `shared.audit_logs`) et les tables intégrées au §04 après l'audit du 05/06 (`audit_log`, `sequences_facturation`, `jobs_pdf`). Arbitrages Val 2026-06-11.

### Q1 — `plateforme.audit_log` *(BLOQUANT — zone n°1 de l'audit : table issue de la dissolution `shared.audit_logs`)*

Le §04 décrivait la RLS en texte ; aucune policy SQL n'existait au §09 (table intégrée le 07/06, postérieure à l'audit du 05/06). **Append-only strict : UPDATE et DELETE bloqués pour TOUS les rôles, y compris `admin_savr`.**

```sql
ALTER TABLE plateforme.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY al_select_staff ON plateforme.audit_log
  FOR SELECT USING (plateforme.f_is_staff());
-- INSERT : aucun rôle applicatif (triggers DB / fonctions SECURITY DEFINER / SERVICE_ROLE seuls).
-- UPDATE / DELETE : AUCUNE policy pour AUCUN rôle, y compris admin_savr (append-only, immuable).
-- Défense en profondeur (le deny RLS ne suffit pas si une policy ALL est ajoutée par erreur plus tard) :
REVOKE UPDATE, DELETE ON plateforme.audit_log FROM authenticated, anon;
```

> La vue `v_audit_global` (UNION `plateforme.audit_log` + `tms.audit_logs`, §6) = **V2 uniquement** — `tms.audit_logs` n'existe pas en V1, **ne pas créer la vue en V1**.

### Q2 — `entites_facturation` *(BLOQUANT — l'ex-classement §3 « Tables financières internes, admin only » était un résidu pré-extension transactionnelle)*

Contradiction avec §04 : chaque organisation porte ses entités (créées à l'onboarding), sélectionnées au formulaire de programmation (§06.01) et affichées dans « Mon organisation ». Le deny total rendait ces features mortes pour tous les rôles clients. La ligne « entites_facturation Savr » du §3 est **remplacée** par :

```sql
ALTER TABLE plateforme.entites_facturation ENABLE ROW LEVEL SECURITY;
CREATE POLICY ef_staff ON plateforme.entites_facturation
  FOR ALL USING (plateforme.f_is_staff())
  WITH CHECK (auth.jwt()->>'role' IN ('admin_savr','ops_savr'));
CREATE POLICY ef_select_own_org ON plateforme.entites_facturation
  FOR SELECT USING (organisation_id = auth.jwt()->>'organisation_id');
-- Écriture clients : FERMÉE V1 (création entité par défaut = flow onboarding SERVICE_ROLE ;
-- ajout/édition d'entités = Admin §06.06). Ouverture self-service manager = décision V1.1 si besoin.
-- Colonnes système (siret_verification, siret_verifie_le, tva_verification, tva_verifiee_le,
-- pennylane_customer_id) : écrites par SERVICE_ROLE seul (job INSEE/VIES, synchro Pennylane).
```

### Q3 — `sequences_facturation` + `jobs_pdf` *(consolidation — RLS spécifiées §04, absentes du §09)*

```sql
ALTER TABLE plateforme.sequences_facturation ENABLE ROW LEVEL SECURITY;
CREATE POLICY sf_admin_read ON plateforme.sequences_facturation
  FOR SELECT USING (auth.jwt()->>'role' = 'admin_savr');
-- Écriture : SERVICE_ROLE seul (fonction de validation, verrou FOR UPDATE).
-- Aucun rôle applicatif, même admin_savr : un UPDATE manuel casse la numérotation gapless fiscale.

ALTER TABLE plateforme.jobs_pdf ENABLE ROW LEVEL SECURITY;
CREATE POLICY jp_admin_read ON plateforme.jobs_pdf
  FOR SELECT USING (auth.jwt()->>'role' = 'admin_savr');
-- Écriture : SERVICE_ROLE seul (worker Railway + batchs J+1 + régénération manuelle via Edge Function).
```

### Q4 — `lieux` : chemin `client_organisateur` *(complément A-4)*

La policy « autres » du §3 passe par `evenements.organisation_id` — le `client_organisateur` (rattaché via `client_organisateur_organisation_id`) ne résolvait pas le lieu de son propre événement. Ajout au prédicat SELECT « autres » :

```sql
OR id IN (SELECT lieu_id FROM plateforme.evenements
          WHERE client_organisateur_organisation_id = auth.jwt()->>'organisation_id'
            AND date_evenement IS NOT NULL)
```

### Bloc D — Tests pgTAP à ajouter *(périmètre critique V1)*

S'ajoutent aux tests cross-schema de l'addendum 2026-04-28/05-08. Les deux premiers sont **bloquants go-live** (impact cross-org / RGPD direct) :

```
org_lieux_self_select_ok            organisations_lieux    gestionnaire_lieux    SELECT  OK   (sa ligne, org A)
org_lieux_cross_org_denied          organisations_lieux    gestionnaire_lieux    SELECT  FAIL (org B)
fichiers_cross_org_photo_denied     shared.fichiers        agence                SELECT  FAIL (collecte org B)        ← BLOQUANT
fichiers_own_bordereau_ok           shared.fichiers        traiteur_manager      SELECT  OK   (bordereau de sa collecte) ← BLOQUANT
outbox_denied_all_app_roles         outbox_events          traiteur_manager      SELECT  FAIL
inbox_write_denied_app              integrations_inbox     ops_savr              INSERT  FAIL
factures_collectes_cross_org_denied factures_collectes     traiteur_manager      SELECT  FAIL (facture org B)
collecte_flux_cross_org_denied      collecte_flux          traiteur_commercial   SELECT  FAIL (collecte org B)
attributions_ag_cross_org_denied    attributions_antgaspi  agence                SELECT  FAIL (collecte org B)
tarifs_zd_write_admin_only          tarifs_zero_dechet     ops_savr              UPDATE  FAIL
rapports_rse_cross_org_denied       rapports_rse           traiteur_manager      SELECT  FAIL (event org B)
tournee_siblings_not_exposed        collecte_tournees      traiteur_manager      SELECT  FAIL (collecte sibling autre org, multi-camions)
documents_generaux_read_authenticated documents_generaux_savr  client_organisateur SELECT OK (actif=true)
fichiers_facture_cross_org_denied   shared.fichiers        traiteur_manager      SELECT  FAIL (entity_type=plateforme.factures, facture org B)
fichiers_facture_gestionnaire_self_ok shared.fichiers      gestionnaire_lieux    SELECT  OK   (entity_type=plateforme.factures, SA facture — décision F6 2026-06-07)
fichiers_facture_traiteur_sur_lieu_denied shared.fichiers   gestionnaire_lieux    SELECT  FAIL (entity_type=plateforme.factures, facture traiteur même si lieu visible — pgTAP scindé F6)
users_gestionnaire_org_wide_ok      users                  gestionnaire_lieux    UPDATE  OK   (désactivation collègue même org — décision F5 2026-06-07)
users_gestionnaire_cross_org_denied users                  gestionnaire_lieux    UPDATE  FAIL (user org B)
evenements_brouillon_tiers_denied   evenements             gestionnaire_lieux    SELECT  FAIL (brouillon date_evenement NULL d'un traiteur sur son lieu — décision F3 2026-06-07)
fichiers_doc_general_public_ok      shared.fichiers        client_organisateur   SELECT  OK   (entity_type=plateforme.documents_generaux_savr, actif=true)
cf_update_staff_ok                  collecte_flux          ops_savr              UPDATE  OK   (poids_reel_kg — décision F1 lot ⑪ 2026-06-07)
cf_update_client_denied             collecte_flux          traiteur_manager      UPDATE  FAIL (pesée de sa propre collecte — écriture staff only)
staff_ops_read_surface_ok           evenements/factures/…  ops_savr              SELECT  OK   (règle staff canonique F2 lot ⑪)
ops_admin_only_writes_denied        config_auto_accept_ag  ops_savr              UPDATE  FAIL (liste admin-only F2 lot ⑪)
evenements_update_manager_fenetre_denied evenements        traiteur_manager      UPDATE  FAIL (événement 100 % réalisé/clôturé — garde F3 lot ⑪)
evenements_update_agence_fenetre_denied  evenements        agence                UPDATE  FAIL (idem — garde F3 lot ⑪)
users_commercial_org_read_ok        users                  traiteur_commercial   SELECT  OK   (collègues même org — décision F4 lot ⑪)
users_commercial_cross_org_denied   users                  traiteur_commercial   SELECT  FAIL (user org B)
users_commercial_update_collegue_denied users              traiteur_commercial   UPDATE  FAIL (profil d'un collègue — UPDATE reste self only)
audit_log_update_denied_admin       audit_log              admin_savr            UPDATE  FAIL (append-only strict — audit RLS 2026-06-11) ← BLOQUANT
audit_log_delete_denied_admin       audit_log              admin_savr            DELETE  FAIL ← BLOQUANT
audit_log_insert_denied_app         audit_log              admin_savr            INSERT  FAIL (trigger/SERVICE_ROLE only)
audit_log_select_client_denied      audit_log              traiteur_manager      SELECT  FAIL
audit_log_select_ops_ok             audit_log              ops_savr              SELECT  OK
history_update_denied_admin         parametres_taux_recyclage_history  admin_savr UPDATE FAIL (patron répliqué sur les 4 tables _history CO₂/mix/AG)
sequences_fact_write_denied_admin   sequences_facturation  admin_savr            UPDATE  FAIL (gapless fiscal — SERVICE_ROLE seul)
jobs_pdf_denied_clients             jobs_pdf               traiteur_manager      SELECT  FAIL
entites_fact_own_org_ok             entites_facturation    traiteur_manager      SELECT  OK   (entité de son orga — Q2 2026-06-11)
entites_fact_cross_org_denied       entites_facturation    traiteur_manager      SELECT  FAIL (entité org B)
entites_fact_write_client_denied    entites_facturation    traiteur_manager      INSERT  FAIL (écriture staff only V1)
org_self_read_client_orga_ok        organisations          client_organisateur   SELECT  OK   (sa propre orga — A-4)
prestataires_client_roles_denied    shared.prestataires    traiteur_manager      SELECT  FAIL (B-4 — SELECT admin/ops seul)
attributions_ag_client_orga_denied  attributions_antgaspi  client_organisateur   SELECT  FAIL (C-1 — collecte de SON événement, deny quand même)
attributions_ag_gestionnaire_denied attributions_antgaspi  gestionnaire_lieux    SELECT  FAIL (C-1 — collecte sur SON lieu, deny quand même)
bordereaux_client_orga_own_event_ok bordereaux_savr        client_organisateur   SELECT  OK   (B-3a)
attestations_client_orga_cross_org_denied attestations_don client_organisateur   SELECT  FAIL (événement d'un autre client)
packs_ag_write_ops_ok               packs_antgaspi         ops_savr              INSERT  OK   (B-1 tranché Val — matrice étendue fait foi)
packs_ag_write_client_denied        packs_antgaspi         traiteur_manager      INSERT  FAIL
emails_envoyes_ops_denied           emails_envoyes         ops_savr              SELECT  FAIL (PII — admin_savr seul)
collecte_flux_brouillon_tiers_denied collecte_flux         gestionnaire_lieux    SELECT  FAIL (collecte d'un brouillon tiers sur son lieu — garde B-2)
tournees_collecte_perimetree_ok     tournees               traiteur_manager      SELECT  OK   (tournée d'une de ses collectes — B-5)
```

---

## 4. Claim JWT

À l'authentification, Supabase génère un JWT enrichi par un trigger custom contenant :

```json
{
  "sub": "user-uuid",
  "email": "...",
  "role": "traiteur_manager",
  "organisation_id": "org-uuid",
  "organisation_type": "traiteur | agence | gestionnaire_lieux",
  "exp": 1234567890
}
```

Les policies RLS lisent ces claims via `auth.jwt()->>'claim_name'`.

---

## 5. Middlewares applicatifs

En complément du RLS (qui protège la DB), le frontend et les Edge Functions appliquent des middlewares de permission :

- **Middleware `requireRole(['admin_savr'])`** : bloque les routes back-office Admin
- **Middleware `requireVerifiedEmail`** : bloque la programmation de collecte si email non vérifié
- **Middleware `requireCompletedOrganisation`** : bloque la programmation si SIRET/TVA/CGV non renseignés
- **Middleware `requireValidatedOrganisation`** : bloque l'envoi Pennylane si orga non validée Admin

---

## 6. Audit trail

**Routage (tranché Val 2026-06-09)** : l'audit suit le **schéma de la table écrite**, pas l'acteur. Le back-office App écrit dans `plateforme.audit_log` **uniquement** ; `tms.audit_logs` est le journal logistique/cross-domaine (TMS V2 + migration), jamais écrit par l'App. *(`shared.audit_logs` n'existe pas — audit canonique 2026-06-11 = 2 journaux séparés.)* Les écritures TMS sur des tables `plateforme.*` (ex. `lieux.acces_details`/`acces_office`) sont auditées dans `plateforme.audit_log` par le trigger plateforme (acteur snapshotté). Timeline globale App+TMS si besoin = vue lecture `v_audit_global` (`UNION`), pas un point d'écriture commun — **V2 uniquement, ne pas créer en V1** (`tms.audit_logs` inexistante V1 ; audit RLS 2026-06-11).

Chaque table critique (`collectes`, `factures`, `bordereaux_savr`, `users`, `organisations`, `tournees`) a des colonnes :
- `created_at`, `created_by`
- `updated_at`, `updated_by`
- `deleted_at`, `deleted_by` (pour soft-delete)

Tables sensibles (factures, bordereaux, attestations) : log complet des modifications dans `audit_log` (jsonb avant/après, user, timestamp, IP, user-agent).

---

## 7. Impersonation Admin Savr

Un Admin Savr peut "se mettre à la place" d'un utilisateur pour debug ou support :
- Bouton "Impersonate" sur le profil user dans le back-office
- Génère un JWT signé avec `role = user.role` + `organisation_id = user.organisation_id` + `impersonator_id = admin.id`
- Un bandeau rouge permanent signale la session impersonation dans l'UI
- Toutes les actions effectuées sont loggées dans `audit_log` avec `user_id = user.id` ET `impersonator_id = admin.id`
- Fin de session : retour auto au compte Admin après 1h ou bouton "Quitter l'impersonation"

---

## 8. Suppression de comptes

Deux niveaux possibles, dans cet ordre :

**Niveau 1 — Soft delete (défaut)** :
- Demande user via paramètres compte **OU** déclenchée par Admin Savr depuis back-office
- Validation Admin Savr sous 48h (délai de grâce)
- `deleted_at` renseigné, user bloqué login, données conservées
- Factures / bordereaux / événements conservés (obligations comptables 10 ans, réglementaires 3 ans)

**Niveau 2 — Hard delete / anonymisation PII (RGPD)** :
- Possible sur demande explicite user (droit à l'oubli RGPD) **OU** décision Admin Savr
- Anonymisation : email remplacé par `anonymized+{{user_id}}@gosavr.io`, nom/prénom/téléphone remplacés par `Anonymisé`, photo supprimée
- Données business conservées (événements, collectes, factures) mais FK user conservée sur l'enregistrement anonymisé
- Action irréversible, loggée dans `audit_log` avec justification obligatoire
- **Implémentation V1 (sobriété 2026-06-03 B1)** : pas de feature UI dédiée. L'anonymisation s'exécute via un **script SQL paramétré documenté** (fonction `fn_anonymize_user(p_user_id uuid, p_justification text)`) lancé par un `admin_savr` (Supabase SQL editor ou CLI). Le script applique l'anonymisation ci-dessus dans une transaction + insère l'entrée `audit_log`. Événement rare (quelques cas/an) → l'investissement d'une UI complète (écran, double confirmation, workflow) n'est pas justifié V1. Le SLA RGPD (1 mois) est tenu : la demande arrive par le support, l'Admin lance le script. **UI dédiée reportée V1.1** si le volume de demandes le justifie. Le soft delete (niveau 1) reste, lui, en self-service UI.

---

## Décisions prises

- **Supabase Auth** pour V1 (email + password). 2FA reportée V2.
- **Session JWT 1h** confirmée (pas de session plus courte pour Admin en V1), refresh 30j
- **6 rôles V1** *(sobriété 2026-06-03 D1 — `lieu_independant` fusionné dans `gestionnaire_lieux`)* : admin_savr, traiteur_manager, traiteur_commercial, agence, gestionnaire_lieux (inclut les lieux autonomes mono-site), **client_organisateur** (nouveau)
- **Rôle `gestionnaire_lieux_commandeur` retiré** (remplacé par table `tarifs_negocie`, ex `tarifs_zd_par_gestionnaire`)
- **Rôle `lieu_independant` retiré — fusionné dans `gestionnaire_lieux` (sobriété 2026-06-03 D1)** : le §04 Data Model ne le portait déjà pas (`organisations.type` et `users.role` sans `lieu_independant`) ; le rôle n'avait aucun comportement RLS distinct (toujours rangé dans « autres ») et son dashboard §11 §6 était « identique au gestionnaire, scopé à 1 lieu ». Un lieu autonome mono-site = un `gestionnaire_lieux` avec une seule ligne `organisations_lieux`. Incohérence levée (son dashboard offrait « Programmer » sans policy INSERT). Migration Bubble : toute org typée « lieu indépendant » → `gestionnaire_lieux`. Propagé : §11, §16, §06.03, §06.06, §08, §05, §00 Index.
- **traiteur_commercial — lecture alignée Manager (révision 2026-05-29)** : SELECT org-wide sur `evenements`, `collectes`, `factures`, `bordereaux_savr` (`organisation_id = self`) + dashboards/benchmarks + Bloc 7 Top 5 commerciaux. **Écriture** restreinte à ses propres créations (`created_by = auth.uid()`). **Pas** de gestion des utilisateurs ( **révisé F4 lot ⑪ 2026-06-07 : SELECT `users` org-wide en lecture, UPDATE reste self only — aucune invitation/désactivation**) ni d'édition des paramètres org (UPDATE `organisations` reste manager only). Option C (factures fiche-only) levée. Propagé : [[02 - Personas et cas d'usage]], [[11 - Dashboards]], [[06 - Fonctionnalités détaillées/04 - Espace client traiteur]]
- **SSO SAML anticipé dans l'archi V1** : claims JWT provisionnables par IdP externe, activation V2 sans migration
- **Impersonation Admin Savr** : bandeau rouge UI, logs `audit_log` avec `impersonator_id`
- **Suppression comptes 2 niveaux** : soft delete (défaut, 48h validation Admin) + hard delete / anonymisation PII sur demande user ou Admin
- **RLS activé sur toutes les tables sensibles** (enforcement DB-level)
- **Extension transactionnelle agence + gestionnaire_lieux (2026-05-07)** : INSERT/UPDATE `evenements` + `collectes` ouvert aux 2 rôles. Périmètre agence = ouvert. Périmètre gestionnaire = fermé via `organisations_lieux` + filtre traiteur opérationnel non-shadow. Pas de nouveau rôle créé (extension périmètre des rôles existants).
- **Visibilité étendue côté traiteur (2026-05-07)** : `traiteur_manager` et `traiteur_commercial` voient les collectes où leur orga est `traiteur_operationnel_organisation_id`, peu importe le programmateur. Pas de droit d'écriture sur ces collectes (sauf annulation via workflow standard).
- **Policies fiches shadow (2026-05-07)** : INSERT `organisations` `est_shadow=true type='traiteur'` ouvert au rôle `agence` uniquement (pas gestionnaire). Cycle de vie shadow géré par Admin Savr (promotion / fusion / suppression).
- **Lecture pack AG ouverte aux 3 types (2026-05-07)** : SELECT `packs_antgaspi` `organisation_id = self` pour traiteur_manager + agence + gestionnaire_lieux. INSERT reste Admin only (négociation commerciale).
- **Middlewares applicatifs** en complément pour règles métier (compliance orga, email vérifié)
- **JWT enrichi** avec claims custom (role, organisation_id, organisation_type, impersonator_id)
- **Audit trail** systématique sur tables critiques + tournees
- **Lot ⑪ RLS transverse (test-scenarios 2026-06-07, 4 décisions Val)** : F1 policy `cf_update_staff` sur `collecte_flux` (édition pesées admin+ops, INSERT reste SERVICE_ROLE) ; F2 règle staff canonique (SELECT `admin_savr ALL` ⇒ staff via `f_is_staff()`, écritures = matrice étendue fait foi) ; F3 garde `f_collecte_editable` étendue aux UPDATE `evenements` de traiteur_manager + agence (cohérence 4 rôles clients) ; F4 `users` SELECT org-wide pour traiteur_commercial (Bloc 7 Top 5 §11 servi en direct, exposition email/téléphone collègues assumée, UPDATE reste self).

## Questions ouvertes

_Aucune — les 2 QO de l'audit RLS V1 (2026-06-05) ont été soldées le même jour (validation Val) :_

- **FERMÉE 2026-06-05** : 9 types validés (§3ter C1, note sous la fonction). `factures` scopé strict = RLS table `factures` (jamais gestionnaire/client organisateur), `documents_generaux_savr` public. 2 tests pgTAP ajoutés.
- **FERMÉE 2026-06-05** : V1 = **polling** (décision Val actée, relevé adapter §9). §08 §3bis corrigé (3bis.1/3bis.3/3bis.7/3bis.12) → aucun endpoint entrant exposé, surface d'attaque entrante nulle, dédup `integrations_inbox` conservée. **Réconcilié 2026-06-06 (session MTS-1)** : modèle hand-off (`delegate` → create order + create tour + `dispatch tour` + validate) et base URLs (`api.mts-1.com` → host data `*.mytroopers.io` + auth `gateway.*.mytroopers.com`) du §3bis alignés sur le relevé as-built. Aucun impact RLS ni enum/colonne.

## Liens

- [[04 - Data Model]] (toutes les tables)
- [[05 - Règles métier]] (sections 8 Onboarding, 9 Notifications, 11 Dashboards, 12 Suppression)
- [[15 - Sécurité et conformité]]

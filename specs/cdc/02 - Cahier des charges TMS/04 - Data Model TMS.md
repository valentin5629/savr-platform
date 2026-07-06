# Data Model TMS

**Objectif** : spécifier le schéma Supabase du Savr TMS (tms.gosavr.io) — **schéma PostgreSQL `tms.*` isolé** par RLS cross-schema dans le projet Supabase unique partagé avec la Plateforme Savr, communicant via API (voir [[08 - Contrat API Plateforme-TMS]]).

> ⚠ **Addendum 2026-05-01 — Propagation revue sobriété §08 Bloc A** : 2 tables `tms.*` exposées en lecture directe cross-schema vers la Plateforme via vues côté `plateforme.*` (en remplacement des webhooks supprimés) :
> - `tms.tournees` → vue `plateforme.v_courses_logistiques` (remplace ex-webhook S6 `course-cout-calculee`). Trigger DB cross-schema `plateforme.fn_recalc_marge_tournee()` recalcule la marge sur UPDATE de `cout_final_ht`/`push_s6_version` *(noms corrigés audit cohérence 2026-05-26 A2 — ex `cout_total_centimes`/`version_paiement` n'existent pas sur la table)*.
> - `tms.stocks_rolls_traiteurs` → vue `plateforme.v_stocks_rolls` (remplace ex-webhook S8 `traiteur-stock-rolls-update`). **Pas de joint `organisations_lieux`** côté vue (rolls aux traiteurs uniquement).
>
> Conséquences §04 TMS : toutes les mentions "push S6", "push S8", "webhook course-cout-calculee", "webhook traiteur-stock-rolls-update" dans le détail des tables/triggers ci-dessous sont **obsolètes V1** (conservées en strikethrough mental pour traçabilité historique). La colonne `tournees.push_s6_version` reste lue par la vue Plateforme pour reporting "marge ajustée" mais n'est plus consommée par un push HTTP.


---

## ⚠ Addendum 2026-04-30 (revue de sobriété §04 noyau structurel) — 6 simplifications Bloc A

Issu de la revue de sobriété §04 conduite 2026-04-30 (skill `cdc-review-sobriete`). Périmètre : noyau structurel (Niveaux 1-6, RLS, index, décisions) hors addenda M-* déjà revus individuellement.

**Bloc A — Suppressions V1 acceptées par Val 2026-04-30** :

1. **A1 — `users_tms.locale`** : retiré V1 (préparation i18n inutile, Savr opère en France). À réintroduire le jour où i18n devient un chantier réel.
2. **A2 — `grilles_tarifaires_prestataires.devise`** : retirée V1 (préparation i18n inutile, tous les prestataires français). ALTER TABLE le jour d'un prestataire étranger.
3. **A3 — `shared.prestataires.last_everest_ping_at` + `last_everest_ping_status`** : retirées V1 (duplication avec `tms.integrations_logs(system='everest', type_event='m14_ping')`). Affichage UI fiche prestataire (M06) + dashboard santé API (M13) → **vue dérivée `tms.vue_prestataires_everest_status`** spécifiée Niveau 1.
4. **A4 — `users_tms.notifications_canaux jsonb`** : retirée V1 (V1 = push obligatoire chauffeur PWA M05, pas de SMS/email TMS V1). Hardcoded `{push: true}` côté applicatif.
5. **A5 — Table `tms.factures_prestataires_lignes`** : **supprimée V1** (l'audit visuel des lignes est couvert par `factures_prestataires.pdf_url` + `pdf_extraction_json`). Toute la logique `factures_prestataires_lignes.*` retirée : RLS, trigger cohérence `SUM`, surveillance `audit_logs`, périmètre verrouillage M08. Réintroduction V1.1 si rapprochement ligne-à-ligne devient nécessaire.
6. **A6 — `tournees.everest_mission_id` + `collectes_tms.everest_mission_id`** : colonnes miroir retirées V1 (triple stockage). Source de vérité unique = `tms.everest_missions(everest_mission_id UNIQUE, tournee_id, collecte_tms_id)`. Lookup via JOIN sur `everest_missions` (index dédiés sur `tournee_id` + `collecte_tms_id` couvrent la perf). Trigger `trg_m14_cascade_cancel` ajusté pour lookup `everest_missions` au lieu de lecture directe.

**Propagation effectuée** : §04 (cette section + tables impactées), §05 R_M14.2, §06 M04/M06/M08/M13/M14, §07 §08 §09, `00 - Index TMS`, `03 - Périmètre fonctionnel TMS`.

**Bloc B — Simplifications acceptées par Val 2026-04-30** :

7. **B1 — `factures_prestataires` : 4 paires `*_par_user_id` retirées V1** : `valide_par_user_id`, `regle_par_user_id`, `exporte_par_user_id`, `deverrouillee_par_user_id` supprimées (les `*_at` correspondants sont conservés pour filtres SQL). Traçabilité acteur garantie par `tms.audit_logs.acteur_user_id` (capture automatique sur chaque UPDATE). **Garde RLS W9 ajustée** : `WITH CHECK (auth.user_has_role('admin_tms') AND motif_deverrouillage IS NOT NULL AND char_length(motif_deverrouillage) >= 30)` — on retire la condition `deverrouillee_par_user_id = auth.uid()` (la trace acteur passe par audit_logs). Trigger `trg_m08_deverrouiller` ne require plus `deverrouillee_par_user_id NOT NULL` mais conserve la garde `motif_deverrouillage NOT NULL`.
8. **B2 — `incidents.resolu_par_user_id` + `resolu_at` retirés V1** : `resolu boolean` + `commentaire_resolution` conservés. Acteur+timestamp via `audit_logs` (action `INCIDENT_RESOLU`).
9. **B3 — `audit_logs` tables surveillées V1 réduites** : retrait de `types_vehicules`, `types_contenants`, `formules_catalogue` (mutations admin rares + `parametres_tms` couvre déjà le tracking config). Liste V1 passe de 17 à 14 tables. Réintroduction immédiate possible si besoin réglementaire.

**Propagation Bloc B** : §04 (cette section + factures + incidents + audit_logs surveillées), §05 R3.6, §06 M08 (W3/W5/W7/W8 + colonnes), §09 (section 12 RLS + trigger + tests pgTAP).

**Bloc C — Caduc** : C1 (everest_mission_id triple-stocké) et C2 (last_everest_ping_*) absorbés par le Bloc A (A6 + A3). Aucune action supplémentaire.

**Bloc D — Enums et états réduits acceptés par Val 2026-04-30** :

10. **D1 — `incidents.gravite` enum 3→2** : valeur `info` retirée V1 (aucun comportement applicatif distinct de `warning` côté UI Ops). Valeurs V1 : `warning`, `critical`. Default = `warning`. Migration : tout incident historique en `info` est UPDATE en `warning` (downgrade impossible : `info < warning` sémantiquement, donc upgrade neutre vers le seuil minimum). À reconsidérer V2 si volume `warning` pollue l'inbox Ops.
11. **D2 — `audit_logs.acteur_type` enum 6→5** : fusion `webhook_plateforme` + `webhook_everest` → `webhook`. Détail source dans `acteur_meta jsonb` champ `source` (valeurs `plateforme`, `everest`, etc.). Valeurs V1 : `user`, `systeme`, `webhook`, `cron`, `migration`. Migration : tout `audit_logs.acteur_type IN ('webhook_plateforme', 'webhook_everest')` est UPDATE en `'webhook'` avec `acteur_meta = jsonb_set(acteur_meta, '{source}', to_jsonb(replace(acteur_type, 'webhook_', '')))`.
12. **D3 — `factures_prestataires.type_contestation` enum→text libre** : aucun comportement applicatif distinct par valeur (sert au reporting/filtrage). UI E6 M08 garde une dropdown préremplie avec les 5 valeurs historiques (`ecart_montant`, `erreur_periode`, `erreur_prestataire`, `erreur_doublon`, `autre`) + saisie libre possible. CHECK constraint retiré côté DB.
13. **D4 — `factures_prestataires_lignes.type_ligne` enum** : **caduc** (table supprimée par A5).

**Propagation Bloc D** : §04 (cette section + incidents + audit_logs + factures), §05 R3.5 (mention type_contestation), §06 M08 (E6 dropdown + §11.1 colonnes + §11.3 enum addendum), §08 contrat API (incidents.gravite enum aligné), §09 §11 §13 (cohérence acteur_type).

---

## ⚠ Addendum 2026-04-27 (propagation §13) — Migration MTS-1

Issu de la rédaction de [[13 - Migration MTS-1]] (V1 rédigée 2026-04-27, 10 décisions D1-D10 tranchées). 1 paramètre racine + 2 colonnes ajoutées + 1 trigger DB + 1 fonction SQL helper + 1 ligne SQL ajoutée à `m13_cleanup_legacy`.

### 1. Paramètre racine `parametres_tms.migration_mode_active`

| Clé | Type | Default | Description |
|---|---|---|---|
| `migration_mode_active` | boolean | false | Active le mode migration (bandeau header, marquage `factures_prestataires.migration_test = true`, filtre Pennylane, audit `contexte = 'migration_test'`). À activer par Val à J0 via M13 E2, désactiver à J+30. |

**RLS** : update réservée `admin_tms` (existante `parametres_tms_admin_only`). Audit obligatoire `M13_MIGRATION_MODE_TOGGLE` via fonction `tms.audit_param_update`.

### 2. `factures_prestataires` — 1 nouvelle colonne `migration_test`

```sql
ALTER TABLE tms.factures_prestataires
ADD COLUMN migration_test boolean NOT NULL DEFAULT false;

CREATE INDEX idx_factures_prestataires_migration_test
ON tms.factures_prestataires (migration_test)
WHERE migration_test = true;
```

**Sémantique** : à `true` si la facture a été créée pendant `migration_mode_active = true`. Figé à la création (pas recalculé à la désactivation du mode migration).

**Effet runtime** :
- Filtre automatique dans la fonction `tms.m08_exporter_pennylane` : `WHERE migration_test = false`
- Toujours visible dans M08 E1-E9 (pas de filtre UI implicite)

### 3. `tms.audit_logs` — 1 nouvelle colonne `contexte`

```sql
ALTER TABLE tms.audit_logs
ADD COLUMN contexte text NULL CHECK (contexte IS NULL OR contexte = 'migration_test'); -- prédicat corrigé 2026-06-11 (audit data model) : l'ex-CHECK « IN ('migration_test', NULL) » renvoyait NULL (= accepté) pour TOUTE valeur ≠ 'migration_test' → ne rejetait rien
```

**Sémantique** : à `'migration_test'` si l'action s'est produite pendant `migration_mode_active = true`. Permet filtrage post-bascule des actions de la fenêtre migration.

**Effet runtime** : helper SQL `tms.is_migration_active() RETURNS boolean` lu par les triggers d'audit. Si actif, set `contexte = 'migration_test'` automatiquement à l'INSERT.

### 4. Helper SQL `tms.is_migration_active()`

```sql
CREATE OR REPLACE FUNCTION tms.is_migration_active()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT valeur::boolean FROM tms.parametres_tms WHERE cle = 'migration_mode_active' LIMIT 1),
    false
  );
$$;
```

**Cache** : 60s côté Edge (pattern existant M13 D6).

### 5. Trigger DB `trg_factures_migration_flag` (BEFORE INSERT sur `factures_prestataires`)

```sql
CREATE OR REPLACE FUNCTION tms.fn_factures_migration_flag()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.migration_test := tms.is_migration_active();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_factures_migration_flag
BEFORE INSERT ON tms.factures_prestataires
FOR EACH ROW
EXECUTE FUNCTION tms.fn_factures_migration_flag();
```

### 6. Modification fonction `tms.m13_cleanup_legacy` (cron quotidien existant M13)

Ajout 1 ligne SQL dans la fonction existante (cf. M13 D9 cron paramètres) :

```sql
-- Auto-résolution alertes critical de la fenêtre migration à J+30 (R_§13.8)
-- Statut canonique 'resolue' (enum alerte_statut 3 valeurs R_M11.11) ; distinction "auto" portée par resolue_source = 'auto' (enum alerte_resolution_source).
-- Corrigé revue sobriété §05 2026-06-04 : 'resolue_auto'→'resolue', 'active'→'ouverte', resolution_source/'auto_migration_cleanup'→resolue_source/'auto' (nom + enum réels du schéma).
UPDATE tms.alertes
SET statut = 'resolue', resolue_at = NOW(), resolue_source = 'auto'
WHERE contexte = 'migration_test'
  AND statut IN ('ouverte', 'snoozee')
  AND criticite = 'critical'
  AND emise_at < NOW() - INTERVAL '30 days';
```

### 7. `tms.alertes` — addendum colonne `contexte` (alignement audit_logs)

Pour cohérence avec `audit_logs.contexte`, la table `tms.alertes` reçoit la même colonne :

```sql
ALTER TABLE tms.alertes
ADD COLUMN contexte text NULL CHECK (contexte IS NULL OR contexte = 'migration_test'); -- prédicat corrigé 2026-06-11 (audit data model) : l'ex-CHECK « IN ('migration_test', NULL) » renvoyait NULL (= accepté) pour TOUTE valeur ≠ 'migration_test' → ne rejetait rien
```

**Sémantique** : remplie automatiquement par la fonction `tms.alerte_emit` qui lit `tms.is_migration_active()` à l'émission. Permet le filtrage R_§13.8.

### 8. Synthèse propagation §13

| Élément | Type | Cible |
|---|---|---|
| `parametres_tms.migration_mode_active` | Paramètre racine boolean default false | Niveau 5 paramètres |
| `factures_prestataires.migration_test` | Colonne boolean default false + index partiel | Niveau 3 facturation |
| `audit_logs.contexte` | Colonne text nullable + CHECK | tms.audit_logs |
| `alertes.contexte` | Colonne text nullable + CHECK | Niveau 5 alerting |
| `tms.is_migration_active()` | Fonction SQL helper STABLE | Schema tms |
| `tms.fn_factures_migration_flag()` + `trg_factures_migration_flag` | Trigger BEFORE INSERT | Schema tms |
| `tms.m13_cleanup_legacy` | +1 ligne SQL auto-résolution | Schema tms (modification fonction existante) |

---

## ⚠ Addendum 2026-04-25 (propagation M13) — Administration TMS

Issu de la rédaction de [[06 - Fonctionnalités détaillées TMS/M13 - Administration TMS]] (V1 rédigée 2026-04-25, 15 décisions D1-D15 tranchées). 4 tables nouvelles + 2 tables modifiées + deprecation 1 paramètre.

### 1. Nouvelles tables (Niveau 5 - Admin et audit + Niveau 1 - Identité)

#### `tms.users_tms_devices_trusted` (Niveau 1)

Tracking devices reconnus par user pour skip MFA `admin_tms` (D11/D14 M13). Cap **3 devices actifs simultanés** par user (R_M13.11).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `user_id` | uuid | FK `users_tms(id)`, NOT NULL | |
| `device_fingerprint` | text | NOT NULL | Hash SHA-256(user-agent + IP class C + cookie persistent) |
| `user_agent` | text | NOT NULL | Affichage M13 E3.b onglet Devices |
| `ip_premiere_reconnaissance` | inet | NOT NULL | |
| `created_at` | timestamptz | NOT NULL, default `now()` | 1ère reconnaissance (post-MFA pour admin) |
| `derniere_activite_at` | timestamptz | NOT NULL | Maj à chaque login sur device |
| `actif` | boolean | NOT NULL, default true | Révocation = false |
| `revoque_at` | timestamptz | nullable | NULL si actif |
| `revoque_par_user_id` | uuid | FK `users_tms(id)`, nullable | Self ou admin |

**Index** : `(user_id, actif)`, `(device_fingerprint)`, `(user_id, derniere_activite_at DESC)`.

**RLS** :
- Self : SELECT + UPDATE (révocation propre uniquement) limité à ses propres lignes (`user_id = auth.uid()`)
- `admin_tms` : SELECT + UPDATE tous users
- `ops_savr` non self : pas d'accès

**Trigger BEFORE INSERT/UPDATE** : si `actif = true`, vérifier `count(*) FILTER (actif=true) WHERE user_id = NEW.user_id ≤ 3`. Si dépassé → raise exception (R_M13.11). Géré applicatif côté login flow également.

**Surveillance audit_logs** : ajoutée à liste tables surveillées (Niveau 5).

---

#### `tms.alertes_codes_overrides` (Niveau 5)

**Dégagée Bloc 6 sobriété 2026-04-28 (C3)**. Override criticité runtime supprimé — Admin TMS modifie directement `alertes_catalogue.criticite_par_defaut` (E4 catalogue M11). 3ème niveau d'override (catalogue défaut → appelant → runtime) = ambiguïté debug. Simplifié à 2 niveaux : catalogue défaut → override appelant (`p_criticite_override` dans `alerte_emit`). La fonction `tms.alerte_emit` ne consulte plus `alertes_codes_overrides`. **Propagation M13** : E8 codes alertes override retiré, W2 upsert_alerte_code_override retirée, Edge Function `upsert_alerte_code_override` retirée.


| `derniere_maj_par_user_id` | uuid | FK `users_tms(id)`, NOT NULL | |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |

**Index** : PK suffit (volumétrie ≤ 50 lignes V1).

**RLS** :
- `admin_tms` : SELECT + INSERT + UPDATE
- `ops_savr`, `manager_prestataire`, `chauffeur` : SELECT seulement (lecture pour comprendre criticité affichée)

**Trigger AFTER INSERT/UPDATE** : INSERT `audit_logs` (table surveillée).

 **Retiré Bloc 6 sobriété 2026-04-28 C3** : `alerte_emit` utilise directement `alertes_catalogue.criticite_par_defaut` (éventuellement overridé par `p_criticite_override` de l'appelant). 1 lookup en moins dans la fonction hot path.

---

#### `tms.secrets_metadata` (Niveau 5)

Métadonnées des secrets stockés dans **Supabase Vault** (D4 M13). Le secret en clair vit dans `vault.secrets` (chiffré nativement). Cette table porte les métadonnées exposables côté UI Admin TMS.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `secret_name` | text | PK | Cohérent avec `vault.secrets.name` |
| `service` | text | NOT NULL, CHECK IN ('pennylane','everest','strike','marathon','bridge','autre') | |
| `type_secret` | text | NOT NULL, CHECK IN ('bearer_token','webhook_url','signing_key','client_id','client_secret') | |
| `description` | text | nullable | UI E5 affichage |
| `expire_le` | timestamptz | nullable | NULL si pas d'expiration. Sinon scan cron W12 M13 (J-7). |
| `derniere_rotation_at` | timestamptz | nullable | |
| `derniere_rotation_par_user_id` | uuid | FK `users_tms(id)`, nullable | |
| `derniere_utilisation_at` | timestamptz | nullable | Maj best-effort par EF lors d'usage du secret |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |

**Index** : `(expire_le) WHERE expire_le IS NOT NULL`, `(service)`.

**RLS** : `admin_tms` uniquement (SELECT + UPDATE). Aucun autre rôle.

**Surveillance audit_logs** : oui.

**Seed V1** (à insérer après migration secrets vers Vault) :

| secret_name | service | type_secret | expire_le |
|-------------|---------|-------------|-----------|
| `pennylane_api_token_v2` | pennylane | bearer_token | now() + 90 days |
| `everest_client_id` | everest | client_id | NULL |
| `everest_client_secret` | everest | client_secret | NULL |
| `strike_webhook_signing_key` | strike | signing_key | now() + 12 months |
| | | | | *(hors seed V1 — sobriété M13 D1 2026-04-30)* |
| `bridge_api_token` | bridge | bearer_token | now() + 90 days |

---

#### `tms.impersonation_sessions` (Niveau 5)

Tracking des sessions d'impersonation (D15 M13). 1 ligne par session, `ended_at IS NULL` = active.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `impersonator_user_id` | uuid | FK `users_tms(id)`, NOT NULL | Qui démarre |
| `target_user_id` | uuid | FK `users_tms(id)`, NOT NULL | Cible (≠ impersonator, vérifié trigger) |
| `motif` | text | NOT NULL, CHECK length ≥ 20 | Justification support (audit) |
| `started_at` | timestamptz | NOT NULL, default `now()` | |
| `ended_at` | timestamptz | nullable | NULL = active |
| `end_reason` | text | nullable, CHECK IN ('manual_stop','auto_expiration','forced_logout') | |
| `created_at` | timestamptz | NOT NULL, default `now()` | |

**Index** : `(impersonator_user_id, started_at DESC)`, `(target_user_id, started_at DESC)`, `(ended_at) WHERE ended_at IS NULL` (sessions actives).

**Contraintes** :
- Trigger BEFORE INSERT : `impersonator_user_id ≠ target_user_id`
- Trigger BEFORE INSERT : target user n'a pas le rôle `admin_tms` (R_M13.9)
- Trigger BEFORE INSERT : target user `statut = 'actif'` (R_M13.9)
- Trigger BEFORE INSERT : impersonator n'a pas de session active (`SELECT 1 FROM impersonation_sessions WHERE impersonator_user_id = NEW.impersonator_user_id AND ended_at IS NULL` → reject EC10)

**RLS** : `admin_tms` SELECT toutes lignes ; pas d'INSERT/UPDATE direct (uniquement via Edge Function `impersonation_start` / `impersonation_stop`).

**Helper SQL** : `auth.is_impersonating()` returns boolean. Lit le JWT claim `impersonator_user_id` (présent uniquement pendant session impersonation). Utilisé par les triggers d'audit pour distinguer mutations sous impersonation (cf. R_M13.10 + addendum §09).

**Surveillance audit_logs** : oui (start + stop tracés).

### 2. Tables modifiées

#### `tms.parametres_tms` (Niveau 5 existante)

Ajout 2 colonnes :

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `requires_redeploy` | boolean | NOT NULL, default false | Si true, valeur prise en compte au démarrage app uniquement (D6/D12 M13). UI E2 affiche badge rouge. |
| `deprecated` | boolean | NOT NULL, default false | Si true, paramètre legacy non éditable (EC15). UI affiche grisé + redirection. |

**Note revue de sobriété 2026-04-25 (A6)** : — Slack dégagé entièrement V1, plus aucun paramètre `m11_slack_*` ni secret Vault `slack_webhook_alerting` à créer. La colonne `deprecated` reste utile pour d'autres futurs paramètres legacy.

#### `tms.users_tms` (Niveau 1 existante)

Ajout 4 colonnes :

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `desactivee_at` | timestamptz | nullable | Set à `now()` lors W3 désactivation. NULL si actif. |
| `desactivee_par_user_id` | uuid | FK `users_tms(id)`, nullable | |
| `raison_desactivation` | text | nullable, CHECK length ≥ 20 si non null | Audit (R_M13.20) |
| `mfa_active` | boolean | NOT NULL, default false | True après 1ère configuration TOTP réussie. Reset par W4 → false. |

(Si `users_tms` a déjà certaines de ces colonnes, à fusionner en propagation pgTAP.)

### 3. Paramètres `m13_*` à seeder dans `parametres_tms`

À INSERT après migration tables :

*(Sobriété M13 B1 2026-04-30 — 17 → 3 paramètres seedés. Les constantes de sécurité et seuils UI invariants sont hardcodés dans le code.)*

*Namespace `auth`* (seedés `parametres_tms`) :
- → **Fusionné dans `auth.session_duree_jours_par_role` JSON (revue sobriété §05 2026-05-01 C2)** — clés `admin_tms` et `ops_savr` (default 30). Source de vérité §09.
- → **Renommé `auth.session_glissante` (revue sobriété §05 2026-05-01 C2)** — boolean global toutes rôles V1 (default true).
- **`auth.session_duree_jours_par_role`** = `{"chauffeur": 30, "manager_prestataire": 30, "ops_savr": 30, "admin_tms": 30}` (JSONB, modifiable `admin_tms`, paramètre unique remplaçant `m05_session_duree_jours` + `m13_session_duree_jours` — source de vérité §09 Authentification)
- **`auth.session_glissante`** = `true` (boolean, modifiable `admin_tms`, ex-`m13_session_glissante`)
- `m13_device_trusted_max_per_user` = 3 (R_M13.11, D14)

*Non seedés — hardcodés constantes code :*
- = `true` → constante §09
- = `false` → constante §09
- → V1.1 (QO5)
- = `10000` → `MAX_EXPORT_ROWS` constante EF
- = `7` → constante UI E4
- = `90` → constante UI E4
- = `30` → `SECRET_REVEAL_TTL_SECONDS` constante EF (sécurité)
- = `7` → `SECRET_EXPIRY_ALERT_DAYS` constante cron W12
- = `60` → `IMPERSONATION_JWT_TTL_MINUTES` constante EF (sécurité)
- = `7` → `ONBOARDING_STALE_DAYS` constante cron EC17
- = `10` → constante EF W1
- = `20` → constante EF W3
- = `20` → constante EF W4

### 4. Tables surveillées par `audit_logs` (mise à jour)

Ajouter à la liste section "Tables surveillées V1" du Niveau 5 :
- `users_tms_devices_trusted`
- `secrets_metadata`
- `impersonation_sessions`

### 5. Edge Functions M13 à dev (référence §07)

12 EF nécessaires côté Supabase Edge Runtime :
- `update_parametre(id, valeur, commentaire)`
- `upsert_user_tms(email, nom, prenom, roles, prestataire_id?)`
- `deactivate_user(user_id, raison)`
- `reset_mfa_user(target_user_id, commentaire)`
- `rotate_secret(secret_name, new_value, commentaire)`
- `test_secret(secret_name, new_value)`
- `reveal_secret(secret_name)` → JWT 30s
- `replay_event(integrations_log_id, commentaire)`
- `wizard_onboarding_prestataire(payload)` (multi-step, état persisté optionnel)
- `upsert_alerte_code_override(code, criticite_override, commentaire)`
- `impersonation_start(target_user_id, motif)`
- `impersonation_stop(reason)`

Toutes audit-loggées + RLS-respectful + role-checked.

### 6. Stratégie cache `parametres_tms` (D6)

Côté Edge Functions exposant des params aux apps clientes (M03 portail, M05 mobile, M11 dashboard) :
- Cache 60s en mémoire (Map keyed by `<namespace>:<cle>`).
- Invalidation manuelle via webhook interne lors UPDATE param (V1.1) ou wait 60s naturelle (V1).
- Param `requires_redeploy=true` : pas mis en cache, lu uniquement au boot app (M05 par ex. lit `m05_geofence_rayon_metres` au démarrage tournée, pas en runtime).

---

## ⚠ Addendum 2026-04-25 (propagation M14) — Intégration Everest

Issu de la rédaction de [[06 - Fonctionnalités détaillées TMS/M14 - Intégration Everest]] (V1 rédigée 2026-04-25, 10 décisions D1-D10). Impacts data model :

### 1. `everest_missions` — élargissement enum `statut_everest` + 4 colonnes failover

L'enum `statut_everest` existant (`created`, `assigned`, `in_progress`, `completed`, `cancelled`, `failed`) est élargi avec 4 valeurs pour gérer les états d'incident et failover Ops :

| Valeur ajoutée | Quand | Workflow |
|----------------|-------|----------|
| `creation_failed` | Push création échec post-retry W1 | Statut transitoire en attente W4 acceptation manuelle Ops |
| `created_manually` | W4 acceptation manuelle Ops après appel téléphone A Toutes! | Reprend cycle normal `assigned` → `in_progress` → `completed` (via M05 + webhooks) |
| `completed_incomplete` | W5 notification course incomplète AG OK (Everest a accusé réception) | Terminal, équivalent `completed` mais sémantique distincte pour rapprochement M08 |
| `cancelled_externally` | W2 webhook `mission_cancelled` reçu mais sans audit_log TMS-initiated | Terminal, requiert investigation Ops (alerte critical) |

**Enum complet propagé** : `created`, `assigned`, `in_progress`, `completed`, `completed_incomplete`, `cancelled`, `cancelled_externally`, `failed`, `creation_failed`, `created_manually` (10 valeurs).

**4 colonnes ajoutées** sur `tms.everest_missions` pour tracer le failover manuel W4 :

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `manual_acceptance_at` | timestamptz | nullable | Horodatage W4 acceptation manuelle Ops |
| `manual_acceptance_by_user_id` | uuid | FK `users_tms(id)`, nullable | Ops qui a saisi |
| `manual_acceptance_contact` | text | nullable | Contact A Toutes! joint au téléphone (texte libre obligatoire si `created_manually`) |
| `manual_acceptance_commentaire` | text | nullable | Note Ops (optionnel) |

**Index ajouté** : `(statut_everest, derniere_sync_at DESC) WHERE statut_everest IN ('creation_failed','cancelled_externally','failed')` pour dashboard E1 alertes.

**CHECK constraint ajouté** : `((statut_everest = 'created_manually') = (manual_acceptance_at IS NOT NULL AND manual_acceptance_by_user_id IS NOT NULL AND manual_acceptance_contact IS NOT NULL))` — cohérence statut/colonnes manual.

**Cardinalité `collecte_tms_id` (généralisation multi-vélo 2026-05-29)** : `collecte_tms_id` n'a **pas** de contrainte d'unicité seule. En **multi-vélo AG** (D8bis M04), une collecte servie par N vélos = N tournées sœurs = **N missions Everest** avec le même `collecte_tms_id` (et `tournee_id` distinct par mission). Seul `everest_mission_id` est UNIQUE. L'index existant `(collecte_tms_id)` (cf. A6) reste un index non-unique de lookup. La distinction de chaque mission se fait par `tournee_id` (= `client_ref` Everest, idempotence push W1 keyée `(tournee_id, service_id)`). Aucune migration de schéma requise (la structure supportait déjà N lignes).

### 2. `collectes_tms` — 2 1 nouvelle colonne (`everest_service_id_target`) — **`everest_mission_id` retirée V1 revue sobriété §04 2026-04-30 A6**

> **Revue sobriété §04 2026-04-30 A6** : la colonne miroir `collectes_tms.everest_mission_id` est **retirée V1**. Source de vérité unique = `tms.everest_missions(everest_mission_id UNIQUE, collecte_tms_id)`. Lookup via JOIN sur `everest_missions WHERE collecte_tms_id = ?` (index dédié). Idem pour `tournees.everest_mission_id` (cf. A6).

`everest_service_id_target` reste posé par M12 lors de l'attribution (single source of truth pour le choix vélo standard 71 / express 75 / camion 91), pour que M14 W1 ne re-calcule plus la fenêtre last-minute (sobriété 2026-04-30 B_M14_02).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `everest_service_id_target` | smallint | nullable, CHECK `IN (71, 75, 91)` quand non-NULL | Posé par M12 attribution. 71 = vélo standard AG, 75 = vélo express last-minute (M12 D2 a tranché `heure_collecte - now() < 1h30`), 91 = camion backup Marathon (M12 R1.6). NULL si Strike/Marathon hors backup. Lu par M14 W1 étape 2. (Sobriété 2026-04-30 B_M14_02 — single source of truth) |


### 3. `secrets_metadata` — 2 secrets seed M14 (Vault)

Ajouts au catalogue secrets (déjà géré par M13 D4 Vault + Edge Function `reveal_secret`) :

| Slug | Description | Géré par | Rotation |
|------|-------------|----------|----------|
| `everest_access_token` (optionnel V1.1) | Cache Bearer token cross-process. Lazy refresh sur 401 (W6). V1 : cache mémoire process Next.js suffit. À activer V1.1 si TTL < 1h (Q3). | Edge Function lazy | Auto sur 401 |
| `everest_webhook_token` | Token secret partagé pour validation webhook entrant Everest (filet sécurité par défaut, M14 D6). À upgrader vers HMAC si Everest l'expose (Q2). | Admin TMS via M13 E5 | Manuelle (rotation annuelle recommandée §15) |

`everest_client_id` + `everest_client_secret` déjà spec §04 ligne 98-99 dans table `secrets_metadata`.

### 4. `parametres_tms` — namespace `m14` (5 paramètres seed)

| Clé | Type | Default | `modifiable_par` | Description |
|-----|------|---------|------------------|-------------|
| `m14_api_base_url` | text | `https://a-toute.everst.io/api` | `admin_tms` | URL base API Everest |
| `m14_api_timeout_ms` | integer | 5000 | `admin_tms` | Timeout appels Everest |
| `m14_api_retry_count` | integer | 1 | `admin_tms` | Nb retries (W1, W3, W5, W8) |
| `m14_api_retry_delay_ms` | integer | 30000 | `admin_tms` | Délai entre retries |
| `m14_webhook_token_required` | boolean | true | `admin_tms` | Exige token header webhook entrant (D6 filet par défaut). Désactivable temporairement pour migration HMAC. |

**Note sobriété 2026-04-30 A_M14_01** : paramètre `m14_dashboard_polling_ms` (default 60000) supprimé. Le dashboard E1 utilise un refresh manuel + revalidation au focus tab (Tanstack Query default), pas de polling configurable. Volume V1 = 5-10 missions/jour ne justifie pas un polling.

### 5. Trigger DB cascade annulation `trg_m14_cascade_cancel`

Trigger `AFTER UPDATE on tms.collectes_tms` qui enqueue **un job `m14_cancel_mission` par mission Everest active** (worker Next.js) quand :
- `OLD.statut_dispatch IS DISTINCT FROM NEW.statut_dispatch`
- `NEW.statut_dispatch IN ('rejetee_par_prestataire','annulee_par_traiteur')`
- **Existence d'au moins une mission Everest active** *(lookup corrigé multi-camions/multi-vélo 2026-05-29 : `collectes_tms.tournee_id` retiré V1 → jointure via `collecte_tournees` ; cas multi-vélo : N missions vélo pour 1 collecte)* :
  ```sql
  -- itère sur TOUTES les missions actives de la collecte (Val arbitrage 3, 2026-05-29)
  FOR m IN
    SELECT em.everest_mission_id, em.tournee_id, em.collecte_tms_id
    FROM tms.everest_missions em
    WHERE (
        em.collecte_tms_id = NEW.id                                   -- missions vélo (1 par tournée sœur)
        OR em.tournee_id IN (SELECT ct.tournee_id                     -- missions camion des tournées de la collecte
                             FROM tms.collecte_tournees ct
                             WHERE ct.collecte_tms_id = NEW.id)
    )
    AND em.statut_everest NOT IN ('cancelled','cancelled_externally','completed','completed_incomplete','failed','creation_failed')
  LOOP
    PERFORM pg_notify('m14_cancel_queue',
      json_build_object('everest_mission_id', m.everest_mission_id, 'collecte_id', NEW.id,
                        'tournee_id', m.tournee_id, 'cause', NEW.statut_dispatch)::text);
  END LOOP;
  ```

**Implémentation** : un `pg_notify('m14_cancel_queue', …)` par mission active, consumé par worker Next.js. *(Multi-vélo : N notifications = N annulations de courses A Toutes!.)*

**Idempotence** : worker check `everest_missions.statut_everest IN ('cancelled','completed','completed_incomplete','failed','cancelled_externally')` avant appel API (par `everest_mission_id` du payload).

### 6. Fonctions SQL helper M14

- `tms.m14_lookup_mission_by_collecte(collecte_id uuid)` returns **`SETOF tms.everest_missions`** *(passé de `%ROWTYPE` à `SETOF` — généralisation multi-vélo 2026-05-29 : une collecte vélo peut avoir N missions actives)* — utilisé par `trg_m14_cascade_cancel` pour énumérer les missions à annuler, et par W2 pour résoudre la/les mission(s) depuis la collecte. **Appelants attendant une mission unique** (cas non multi-vélo) : prendre la 1re ligne ou filtrer sur `tournee_id`. retiré V1.

### 7. Synthèse propagation M14

- **Tables modifiées** : `tms.everest_missions` (4 colonnes ajoutées + enum élargi 10 valeurs + 1 CHECK), `tms.collectes_tms` (1 colonne : `everest_service_id_target` ajoutée sobriété 2026-04-30 B_M14_02 — `everest_mission_id` **retirée V1 revue sobriété §04 2026-04-30 A6**, idem `tournees.everest_mission_id`), `tms.secrets_metadata` (2 secrets seed), `tms.parametres_tms` (5 paramètres seed namespace `m14` après suppression `m14_dashboard_polling_ms` sobriété 2026-04-30 A_M14_01).
- **Triggers DB ajoutés** : `trg_m14_cascade_cancel` AFTER UPDATE on `collectes_tms`.
- **Fonctions SQL ajoutées** : `tms.m14_lookup_mission_by_collecte`.
- **Codes alertes M11 catalogue** : +9 codes `m14_*` actifs V1 + 1 code `m14_everest_mission_late` désactivé par défaut (sobriété 2026-04-30 A_M14_07). Cf. propagation M11 + M14 §9.

---

## ⚠ Addendum 2026-04-24 (propagation M03) — Portail prestataire self-service

Issu de la rédaction de [[06 - Fonctionnalités détaillées TMS/M03 - Portail prestataire self-service]] (V1 rédigée 2026-04-24, 16 décisions D1-D16 tranchées). 3 impacts data model.

### 1. `types_vehicules` — 4 nouvelles colonnes (self-service manager + validation Ops différée)

Ajouts pour supporter la création d'un type véhicule par un `manager_prestataire` (D11 M03) avec traçabilité du créateur et flag de validation Ops (merge possible a posteriori via nouvelle fonction SQL).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `frigorifique` | boolean | NOT NULL, default `false` | Équipement frigo du type (utilisé par M12 matching flux périssables). Distinct du `categorie` (catégorie = camion/fourgon/vélo, frigo = option) |
| `hayon` | boolean | NOT NULL, default `false` | Équipement hayon élévateur (utilisé par M04 dispatch si lieu a quai bas) |
| `valide_ops` | boolean | NOT NULL, default `true` | `true` = type validé Ops (seed + types créés par Ops/Admin). `false` = type créé par manager en attente validation Ops. Utilisable immédiatement mais identifié pour revue |
| `cree_par` | uuid | FK `users_tms(id)`, nullable | NULL pour seed (pas d'utilisateur créateur). Pointe sur le `manager_prestataire` ou `ops_savr`/`admin_tms` qui a créé le type |

**Contrainte CHECK** : pas de contrainte supplémentaire. `valide_ops` reste informative (pas de blocage fonctionnel).

**Index** : `(valide_ops) WHERE valide_ops = false` pour scan rapide "types à valider Ops".

**Workflow** :
1. Manager M03 crée un type via E8 → INSERT avec `valide_ops=false`, `cree_par=manager_id`
2. Email auto à Ops Savr "Nouveau type véhicule créé par [prestataire] : [libellé], à revoir"
3. Ops action (3 options) :
   - **Valider** : `UPDATE types_vehicules SET valide_ops=true WHERE id=:id`
   - **Merger avec type existant** : appel fonction SQL `merger_type_vehicule(type_a_id, type_b_id)` (voir §3)
   - **Désactiver sans merge** : `UPDATE types_vehicules SET statut='archive' WHERE id=:id`

### 2. Seed V1 `types_vehicules` — alignement avec décision M03 Q11

Remplace le seed précédent (4 types génériques) par le seed validé par Val 2026-04-24 :

| `code` | `libelle` | `categorie` | `volume_m3_standard` | `hayon` | `frigorifique` |
|--------|-----------|-------------|----------------------|---------|----------------|
| `camion_20m3_hayon` | Camion 20m³ hayon | `camion` | 20 | true | false |
| `camion_16m3` | Camion 16m³ | `camion` | 16 | false | false |
| `camion_6m3` | Camion 6m³ | `camion` | 6 | false | false |
| `velo_cargo_frigo` | Vélo cargo frigo | `velo` | 1.5 | false | true |

Tous seedés avec `valide_ops=true`, `cree_par=NULL`, `statut='actif'`.

**Migration** : si seed précédent déjà en base (4 types `camion_20m3`, `fourgon_16m3`, `camion_frigo`, `velo_cargo`), script migration :
- `camion_20m3` → rename code `camion_20m3_hayon`, libellé "Camion 20m³ hayon", hayon=true
- `fourgon_16m3` → rename code `camion_16m3`, libellé "Camion 16m³"
- `camion_frigo` → archive (remplacé par `velo_cargo_frigo` + possibilité de le recréer si besoin réel)
- `velo_cargo` → rename code `velo_cargo_frigo`, libellé "Vélo cargo frigo", frigorifique=true
- Ajout `camion_6m3`

### 3. Nouvelle fonction SQL `tms.merger_type_vehicule(type_a_id uuid, type_b_id uuid)`

Pour que Ops Savr puisse fusionner 2 types quand un manager en crée un quasi-doublon (cohérence décision D11 M03 option c).

**Signature** : `tms.merger_type_vehicule(type_a_id uuid, type_b_id uuid) RETURNS integer`

**Retour** : nombre de véhicules réaffectés.

**Algorithme** :

```sql
CREATE OR REPLACE FUNCTION tms.merger_type_vehicule(type_a_id uuid, type_b_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  nb_remapped integer;
BEGIN
  -- Vérifications métier
  IF type_a_id = type_b_id THEN
    RAISE EXCEPTION 'Cannot merge a type with itself';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM tms.types_vehicules WHERE id = type_b_id AND statut = 'actif') THEN
    RAISE EXCEPTION 'Target type (type_b) must exist and be active';
  END IF;
  
  -- Remap des véhicules du type A vers le type B
  UPDATE tms.vehicules 
  SET type_vehicule_id = type_b_id, updated_at = now()
  WHERE type_vehicule_id = type_a_id;
  
  GET DIAGNOSTICS nb_remapped = ROW_COUNT;
  
  -- Remap des lignes grilles tarifaires (si elles pointent sur type_vehicule_id)
  UPDATE tms.grilles_tarifaires_prestataires
  SET type_vehicule_id = type_b_id, updated_at = now()
  WHERE type_vehicule_id = type_a_id;
  
  -- Archive le type A
  UPDATE tms.types_vehicules
  SET statut = 'archive', updated_at = now()
  WHERE id = type_a_id;
  
  -- Audit log
  INSERT INTO tms.audit_logs (acteur_user_id, table_name, row_id, action, diff, created_at) -- colonne corrigée 2026-06-11 (audit data model) : la table définit acteur_user_id, pas acteur_id
  VALUES (
    auth.uid(), 
    'types_vehicules', 
    type_a_id, 
    'MERGE_TO', 
    jsonb_build_object('merged_into', type_b_id, 'nb_vehicules_remapped', nb_remapped),
    now()
  );
  
  RETURN nb_remapped;
END;
$$;
```

**Permissions** : `GRANT EXECUTE` à rôle `ops_savr` + `admin_tms` uniquement.

**Idempotence** : si fonction rappelée après un merge déjà exécuté, `type_a` déjà archivé → `UPDATE vehicules WHERE type_vehicule_id = type_a_id` remap 0 lignes, pas d'erreur.

**Edge case** : si `type_a` référencé par un `grilles_tarifaires_prestataires` mais `type_b` n'a pas de grille équivalente pour le même prestataire → à traiter manuellement par Admin TMS avant merge.

---

## ⚠ Addendum 2026-04-24 (propagation M05) — App mobile chauffeur PWA offline-first

Issu de la rédaction de [[06 - Fonctionnalités détaillées TMS/M05 - App mobile chauffeur]] (V1 rédigée 2026-04-24, 20 décisions structurantes tranchées). 5 impacts data model.

### 1. `pesees` — 4 nouvelles colonnes (offline sync + source + override motif + photos multiples)

Ajouts pour supporter l'offline-first (idempotency), tracer la source de la pesée (chauffeur direct, AG sans collecte), motiver l'override de tare (D8), et accepter plusieurs photos par pesée (pre-spec §03 M05).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `idempotency_key` | uuid | UNIQUE, NOT NULL — **pas de default** (revue adversariale 2026-07-06 RC-M05-02 : un default `gen_random_uuid()` masque tout oubli de propagation et tue silencieusement la dédup) | Clé générée côté PWA avant stockage queue IndexedDB, propagée telle quelle par le serveur. Dédup via `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` + 200 idempotent (W11 M05) |
| `source` | text | NOT NULL, default `chauffeur` | Enum 2 valeurs (revue sobriété 2026-04-29 — `presume_non_pese` retiré avec suppression `flux_prevus` + R_M05.18) : `chauffeur` (saisie terrain directe), `ag_sans_collecte` (AG « aucun repas » E5 M05 → poids 0) |
| `tare_override_motif` | text | nullable | Obligatoire si `tare_kg` diverge de `types_contenants.tare_kg * nb_contenants` (D8). Audit `action=PESEE_TARE_OVERRIDE` |
| `photos` | text[] | default `{}` | **Champ unique (décision 2026-06-06 — fusion ex-`photo_url` singulier + ex-`photos_urls` array, dualité legacy supprimée ; aligné sur `incidents.photos` et payload S5)**. Max 5 photos par pesée (paramètre `m05_photo_max_par_pesee`). Toujours array même si 1 photo. |

**Contrainte (CHECK)** : `source IN ('chauffeur','ag_sans_collecte')` (revue sobriété 2026-04-29 — enum 3→2 valeurs).

**Contrainte (CHECK)** : si tare saisie ≠ tare snapshot attendue → `tare_override_motif IS NOT NULL AND length(tare_override_motif) >= 10`.

**Index** : `(idempotency_key)` UNIQUE (obligatoire pour dédup retry), `(source, created_at DESC)` (reporting réels vs AG sans collecte).

**Compat flux (durci 2026-06-11, audit data model)** : valeur canonique AG = **`don_alimentaire`**, seule valeur **écrite** (M05 + tout INSERT applicatif). `repas` = alias legacy **en lecture/migration uniquement** — le script de migration MTS-1 normalise `repas` → `don_alimentaire` à l'import ; après migration, aucune ligne `repas` ne doit subsister (CHECK d'écriture n'accepte que `don_alimentaire`). Motif : deux valeurs pour la même sémantique splittaient les agrégats `SUM(poids_net_kg) GROUP BY flux` (S5, exports, alertes pesées) en deux lignes. Tant que la migration n'est pas purgée, toute agrégation par flux doit traiter les deux valeurs comme un seul flux.

### 2. `types_contenants` — seed `sans_contenant` ajouté

Nouveau contenant virtuel pour pesée sac direct (D7 override Val) : poids brut = poids net, tare = 0.

| Code | Libelle | Categorie | Tare_kg | Flux_compatibles |
|------|---------|-----------|---------|------------------|
| `sans_contenant` | "Sans contenant (sac direct)" | `autre` | 0 | `biodechet`, `emballage`, `carton`, `verre`, `dechet_residuel`, `don_alimentaire`, `repas` |

Affichage UI M05 : picto sac + libellé court "Sans contenant". Présélection contexte E6 si pesée sur sac plastique direct.

Règle M05 : si `sans_contenant` + poids brut = 0 → confirmation 2 clics UI (C12 M05).

### 3. `incidents` — enrichissement enum `type_incident` + 2 nouvelles colonnes

Alignement avec les catégories de signalement rapide M05 E9 (D18).

**Enrichissement enum `type_incident`** : ajout `client_absent`, `probleme_tri`. Renommage cosmétique `acces_lieu_refuse` → `acces_refuse` (alias temporaire conservé en lecture jusqu'à migration V1.1). **Suppression revue sobriété M05 E9 2026-04-30** : `lieu_ferme` (fusionné dans `acces_refuse`), `bacs_vides` (couvert par pesée 0 kg ZD ou clôture « Aucun repas » AG), `bacs_non_conformes` (renommé `probleme_tri`), `panne_vehicule` (gestion hors app — appel direct Ops). **Suppression `pas_excedents` (décision 2026-06-06)** : le cas AG « pas d'excédents » n'est plus un signalement incident (S9) — il passe par le bouton de clôture « Aucun repas à collecter » E5 → `realisee_sans_collecte` → S5 (chemin unique, cf. décision 4).

**Suppression revue sobriété §08 Bloc D 2026-05-01 (D1+D2 étendu Val)** : `retard_chauffeur`, `absence_contenant`, `materiel_casse`, `erreur_pesee`, `blessure`, `accident_route`, `chauffeur_indisponible`. Justification : (a) cas de fréquence quasi-nulle V1 ; (b) Hors-M05 Ops uniquement ; (c) `blessure`/`materiel_casse`/`erreur_pesee` rentrent dans `autre` + description libre ; (d) `accident_route`/`chauffeur_indisponible` fusionnés en gestion hors app (appel direct Ops).

**Enum final V1 (post-décision 2026-06-06) : 5 valeurs** : `acces_refuse` (couvre lieu fermé), `client_absent`, `probleme_tri` (mauvais tri → passage déchet résiduel), `autre`, `client_annule_avant_arrivee`. Total : 5 valeurs (ex-6 post-Bloc D : `pas_excedents` retiré ; avant Bloc D : 13, ex-16).

**Nouvelles colonnes** :

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `photos` | text[] | default `{}` | **Renommé revue sobriété §08 Bloc B 2026-05-01 B2** (ex-`photos_urls`). Max 5 photos par signalement. |
| `appels_effectues` | jsonb | default `[]` | Trace des clics tel: M05 E5/E9 (D18). Format : `[{"destinataire": "traiteur"|"ops", "created_at": "2026-04-24T..."}]` |

**Index** : GIN `(appels_effectues)` si besoin reporting "taux d'appels par incident" (V1.1).

### 4. Nouvelle table `tms.auth_sessions_tms` (device binding chauffeur)

Support D12 (1 seul device actif) + D13 (session 30 jours rolling) + C5 (déconnexion forcée Admin).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `chauffeur_id` | uuid | FK `tms.chauffeurs(id)`, NOT NULL | |
| `device_fingerprint` | text | NOT NULL | Hash SHA-256 (`user_agent + screen_resolution + timezone + installed_fonts`). Pas d'IP (varie 4G/WiFi) |
| `user_agent_snapshot` | text | | Debug / forensic |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `last_seen_at` | timestamptz | NOT NULL, default `now()` | Touché à chaque requête PWA authentifiée (rolling window) |
| `expires_at` | timestamptz | NOT NULL | Par défaut `created_at + auth.session_duree_jours_par_role->>chauffeur::int * interval '1 day'` (revue sobriété §05 2026-05-01 C2 — paramètre unifié, default 30j, ex-`m05_session_duree_jours`) |
| `revoked_at` | timestamptz | | Non null si invalidation explicite (C5 Admin TMS ou D12 nouveau device) |
| `revoked_reason` | text | | `new_device_login`, `admin_force_logout`, `expiration`, `user_logout` |
| `revoked_by_user_id` | uuid | FK `users_tms(id)` nullable | Si Admin TMS force logout |

**Index** : `(chauffeur_id) WHERE revoked_at IS NULL` (lookup session active), `(expires_at) WHERE revoked_at IS NULL` (purge pg_cron).

**Contrainte (UNIQUE partielle)** : `(chauffeur_id) WHERE revoked_at IS NULL` — 1 seule session active par chauffeur (D12 garanti côté DB).

**RLS** : chauffeur ne voit que ses propres sessions (`chauffeur_id = auth.user_chauffeur_id()` — correctif audit RLS 2026-06-05, ex-`auth.uid()` erroné car `auth.uid()`=`users_tms.id`≠`chauffeurs.id`). Admin TMS voit toutes les sessions (audit, force logout). Ops Savr lecture seule. INSERT/UPDATE = service_role uniquement (flow magic link + cron). Bloc policy formel : §09 A3 §20.

**Trigger insertion** : avant INSERT d'une nouvelle session active, UPDATE `revoked_at=now()`, `revoked_reason='new_device_login'` sur les sessions actives existantes du même `chauffeur_id` (cohérence D12 invalidation auto).

**Job pg_cron** : toutes les heures, UPDATE `revoked_at=now()`, `revoked_reason='expiration'` WHERE `expires_at < now()` AND `revoked_at IS NULL`.

### 5. DLQ queue offline → réutilisation `integrations_logs`

Les items DLQ (5 retries consécutifs échoués côté PWA, W11 M05) sont tracés dans `integrations_logs` existant (niveau 6) avec :
- `type_event = 'pesee_dlq' | 'signature_dlq' | 'incident_dlq'`
- `statut = 'echec_final'`
- `ressource_id = pesees.id | incidents.id | ...`
- `payload_brut = payload original queue PWA` (pour rejouabilité manuelle Admin)

**Alerte M11** : job pg_cron scanne `integrations_logs` par `statut='echec_final'` AND `type_event LIKE '%_dlq'` → alerte `warning` si > 0 items DLQ récents (seuil paramétrable).

**Pas de nouvelle table DLQ dédiée** : `integrations_logs` couvre déjà le cas, évite duplication.

### 6. RGPD purge 30 jours géolocalisation

Job pg_cron quotidien (3h matin) :
- `UPDATE tournees SET cloture_gps = NULL WHERE cloture_gps IS NOT NULL AND created_at < now() - interval '30 days'`
- `UPDATE collectes_tms SET arrivee_gps = NULL, depart_gps = NULL WHERE created_at < now() - interval '30 days'`

Paramètre `m05_rgpd_purge_geoloc_jours` (défaut 30) dans `parametres_tms`.

Photos et signatures conservées selon règles Plateforme (archivage 6 ans obligations légales).

### 7. Impact paramètres TMS (namespace `m05`)

Ajout dans `parametres_tms.parametres` (JSONB) — 13 clés (cf. [[06 - Fonctionnalités détaillées TMS/M05 - App mobile chauffeur#12. Paramètres configurables (M13)]]) :

`m05_geofence_rayon_metres` (300), `m05_queue_offline_max_tournees` (3), `m05_queue_offline_max_photos` (150), `m05_queue_offline_max_size_mb` (300), → **migré dans `auth.session_duree_jours_par_role->>'chauffeur'` revue sobriété §05 2026-05-01 C2**, `m05_magic_link_ttl_min` (15), `m05_photo_qualite_jpeg` (80), `m05_photo_max_par_pesee` (5), `m05_seuils_pesees_kg_min_max_par_flux` (JSONB — alerte côté Ops uniquement, AUCUN affichage côté chauffeur, revue sobriété M05 E6 2026-04-30), `m05_push_cap_par_heure_par_collecte` (1), → **supprimé revue sobriété §05 2026-05-01 A4** (widget M11 retiré, audit_log `M05_ARRIVEE_GEOLOC_FALLBACK` exploité SQL ad-hoc Admin TMS suffit V1), → **supprimé 2026-06-11 (audit data model — doublon du paramètre canonique `m04_seuil_inactivite_tournee_heures` (8), namespace m04, consommé par le cron `cron_m04_alerte_inactivite_tournee` M11 §11.6 ; deux clés pour le même seuil = drift garanti)**, `m05_ops_numero_telephone`, **`m05_force_update_mode` (`off` — enum `off|soft|hard`, revue sobriété 2026-06-04 B3 : fusion des ex-booléens `m05_force_update_active` + `m05_force_update_strict` ; `off`=pas de forçage, `soft`=toast non-bloquant + grace 24h, `hard`=modal bloquant urgence sécurité)**, → **supprimé (audit sobriété 2026-05-09 B2, résidu purgé 2026-06-11) : source unique = `plateforme.parametres_algo.poids_par_repas_kg` (0.45), lu cross-schema par le TMS V2 — cf. addendum M12 §5**, (supprimé revue sobriété M05 E6 2026-04-30 — pas de présélection contenant), `m05_rgpd_purge_geoloc_jours` (30).

### 8. Table `tms.chauffeurs_geolocalisation` (référencée §14 + §15, ajout spec §04 propagation §12 2026-04-27)

Référencée dans [[14 - Scalabilité TMS]] (volumétrie ~8M lignes/an purgées rolling 30j) et [[15 - Sécurité et conformité TMS]] §15.4.1 (RGPD géoloc) mais absente du §04 jusqu'à présent. Ajoutée ici pour combler le trou et formaliser le schéma.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `chauffeur_id` | uuid | FK `tms.chauffeurs(id)`, NOT NULL | Lien vers profil chauffeur |
| `tournee_id` | uuid | FK `tournees(id)`, nullable | Tournée en cours si renseignée (NULL si capture hors mission) |
| `captured_at` | timestamptz | NOT NULL, default `now()` | Timestamp capture GPS côté PWA |
| `latitude` | numeric(9,6) | NOT NULL | WGS84 |
| `longitude` | numeric(9,6) | NOT NULL | WGS84 |
| `accuracy_m` | integer | | Précision GPS en mètres (navigator.geolocation API) |
| `source` | text | NOT NULL, default `pwa_chauffeur` | Enum `pwa_chauffeur`, `pwa_chauffeur_fallback` (J'arrive manuel sans GPS), `tournee_cloture` |
| `created_at` | timestamptz | NOT NULL, default `now()` | |

**Index** : `(chauffeur_id, captured_at DESC)`, BRIN `(captured_at)` pour purge.

**RLS** (bloc policy formel ajouté §09 A3 §21 — audit RLS 2026-06-05) :
- Chauffeur → voit + INSERT ses propres positions uniquement (`chauffeur_id = auth.user_chauffeur_id()` — correctif audit RLS 2026-06-05, ex-`auth.uid()` erroné : `auth.uid()`=`users_tms.id`≠`chauffeurs.id`)
- Ops Savr / Admin TMS → voit tout (dispatch + monitoring)
- Manager prestataire → voit positions des chauffeurs de son `prestataire_id`
- UPDATE/DELETE : aucun rôle applicatif (purge rolling 30j via cron service_role)

**Purge** : pg_cron quotidien 3h matin → `DELETE FROM tms.chauffeurs_geolocalisation WHERE captured_at < now() - interval '30 days'` (paramètre `m05_rgpd_purge_geoloc_jours`, R_M05.13).

**Cohérence §12 D6 2026-04-27** : pas de bouton de révocation in-app. Consentement chauffeur via CGU. Pour révoquer : contact manager prestataire qui désactive le compte (cf. §15.4.1 ligne 66 propagation 2026-04-27).

**Volumétrie** : ~8M lignes glissantes V1 (~1,6 Go), ~10 Go V2. Cf. [[14 - Scalabilité TMS]] §14.3 + triggers d'upgrade `pg_partman` partitionnement par jour si > 500 collectes/jour.

---

## ⚠ Addendum 2026-04-24 (propagation M07) — Pilotage financier logistique

Issu de la rédaction de [[06 - Fonctionnalités détaillées TMS/M07 - Pilotage financier logistique]] (V1 rédigée 2026-04-24). 4 impacts data model :

### 1. `tournees` — colonnes ajustement + figement + versioning push (simplifié sobriété 2026-04-30)

Ajouts pour porter l'ajustement manuel, le figement post-clôture, le verrouillage par facture M08 et le versioning du recalcul marge cross-schema (`push_s6_version`, ex-versioning push S6). **Sobriété 2026-04-30** : suppression colonnes liées au workflow validation Admin TMS (A3), simplification enum `statut_financier` (D1), `cout_final_ht` non GENERATED (B5).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `cout_ajuste_ht` | numeric(10,2) | nullable | Ajustement manuel Ops/Admin (décision D2 M07 2026-04-24). NULL = pas d'ajustement. Trace audit via `ajustements_couts_log` |
| `motif_ajustement` | text | | Motif obligatoire min 30 chars si `cout_ajuste_ht IS NOT NULL` (check constraint) |
| `ajuste_par_user_id` | uuid | FK `users_tms(id)`, nullable | Auteur ajustement (Ops Savr ou Admin TMS) |
| `ajuste_at` | timestamptz | | Timestamp ajustement |
| `cout_final_ht` | numeric(10,2) | nullable | **Mise à jour par trigger explicite** (sobriété B5 2026-04-30 — plus GENERATED). Valeur = `cout_ajuste_ht` si `statut_financier = 'ajuste'`, sinon `cout_calcule_ht`. Exposée à la Plateforme via vue cross-schema `plateforme.v_courses_logistiques` (ex-webhook S6 supprimé A2 2026-05-01) ; son UPDATE déclenche `plateforme.fn_recalc_marge_tournee` |
| `cout_final_verrouille` | boolean | NOT NULL, default false | Passe à true si facture M08 rapprochant cette tournée est `valide`. Bloque ajustement ultérieur (déverrouillage via W9 M08 Admin TMS uniquement). **Flag boolean unique** (sobriété C2 2026-04-30) — plus de redondance avec un statut `verrouille_facture` |
| `verrouillee_par_facture_id` | uuid | FK `factures_prestataires(id)`, nullable | Facture M08 qui a verrouillé cette tournée (ajout propagation M08 2026-04-24 R_M08.4). Reset NULL si déverrouillage W9 |
| `statut_financier` | text | NOT NULL, default `calcule` | **Enum 2 valeurs** (sobriété D1 2026-04-30 puis revue sobriété §05 2026-05-01 D2) : `calcule`, `ajuste`. supprimé V1 (revue sobriété §05 2026-05-01 D2 — cas impossible par construction grâce à grille obligatoire à création prestataire R_M06.X + trigger DB anti-expiration sans successeur). Distinct de `statut` (statut opérationnel tournée). |
| `cout_calculated_at` | timestamptz | | Timestamp calcul automatique M07 W1 |
| `push_s6_version` | integer | NOT NULL, default 0 | Compteur de recalculs marge (v1 = calcul initial, v+1 = post-ajustement). Incrémenté par le trigger M07 W1 / l'ajustement W2 ; son UPDATE déclenche le recalcul marge cross-schema. Nom conservé pour compat (ex-versioning push S6, webhook supprimé A2 2026-05-01) |

**Index ajoutés** :
- `(cout_final_verrouille) WHERE cout_final_verrouille = true` — vue M08 verrouillages
- `(ajuste_par_user_id, ajuste_at DESC) WHERE ajuste_par_user_id IS NOT NULL` — reporting par Ops (digest quotidien N3)
- `(heure_reelle_fin DESC, prestataire_id)` — dashboard M07 E1

**Contraintes ajoutées** :
- CHECK `(cout_ajuste_ht IS NULL) = (motif_ajustement IS NULL)` (couplage)
- CHECK `motif_ajustement IS NULL OR char_length(motif_ajustement) >= 30`
- CHECK `cout_ajuste_ht IS NULL OR cout_ajuste_ht > 0` (pas de négatif)
- CHECK `statut_financier IN ('calcule','ajuste')` — sobriété D1 2026-04-30 + revue sobriété §05 2026-05-01 D2 (`cout_manquant` retiré V1, cas impossible par construction)
- CHECK `(cout_ajuste_ht IS NULL AND statut_financier = 'calcule') OR (cout_ajuste_ht IS NOT NULL AND statut_financier = 'ajuste')` — cohérence ajustement/statut (simplifié post-D2)

**Règle d'immutabilité `cout_calcule_ht`** (décision D1 2026-04-24) : une fois posé par trigger W1, `cout_calcule_ht` est **immuable**. Toute correction passe par `cout_ajuste_ht`. Implémentation trigger BEFORE UPDATE qui rejette la modification de `cout_calcule_ht` si `OLD.cout_calcule_ht IS NOT NULL` ET `NEW.cout_calcule_ht != OLD.cout_calcule_ht`. Exception : recalcul par ré-trigger si cas edge EC5 (double clôture avec grille identique).

**Effet sur `statut` tournée** (champ existant, refondu revue sobriété §05 2026-05-01 D2) : → **Retiré V1**. Le statut tournée reste l'enum opérationnel `planifiee/acceptee/en_cours/terminee/annulee` (5 valeurs). Le cas "grille absente à clôture" devient impossible par construction (R_M06.X grille obligatoire à création prestataire + trigger DB anti-expiration sans successeur). Si tentative de clôture sans grille (bug) → exception SQL bloquante (pas un état métier).

### 2. Nouvelle table `tms.ajustements_couts_log`

Append-only. Une ligne par ajustement (insertion, modification, refus). Conserve l'historique intégral. Rétention 3 ans (RGPD audit financier).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `tournee_id` | uuid | FK `tournees(id)`, NOT NULL | |
| `action` | text | NOT NULL | Enum simplifié (sobriété A3 2026-04-30) : `ajustement_cree`, `ajustement_modifie`. , , supprimées (workflow validation supprimé). |
| `cout_calcule_ht_snapshot` | numeric(10,2) | NOT NULL | Snapshot du `cout_calcule_ht` au moment de l'action (référence) |
| `cout_ajuste_ht_avant` | numeric(10,2) | | NULL si création, sinon valeur précédente |
| `cout_ajuste_ht_apres` | numeric(10,2) | NOT NULL | Nouvelle valeur (toujours présente — pas de reset puisqu'il n'y a plus de refus) |
| `ecart_pourcent` | numeric(5,2) | | Calculé au moment de l'action |
| `motif` | text | NOT NULL | Motif de l'action (≥ 30 chars) |
| `acteur_user_id` | uuid | FK `users_tms(id)`, NOT NULL | Auteur de l'action (Ops Savr ou Admin TMS) |
| `acteur_roles_snapshot` | text[] | NOT NULL | Snapshot des rôles à l'action |
| `created_at` | timestamptz | NOT NULL, default `now()` | |

**Index** : `(tournee_id, created_at DESC)`, `(acteur_user_id, created_at DESC)`, `(action, created_at DESC)`.

**RLS** : `ops_savr` + `admin_tms` lecture. Insert via trigger DB uniquement (pas d'INSERT direct UI — garantit l'intégrité append-only).

**Contrainte** : aucun UPDATE ni DELETE autorisé (trigger BEFORE UPDATE/DELETE `RAISE EXCEPTION`). Append-only strict.

### 3. `formules_catalogue` — schema flag `tarif_sans_collecte_applicable`

Ajout dans `schema_parametres` JSON Schema des formules `vacations_paliers` et `grille_matricielle_zone` (décision D4 M07 2026-04-24) :

```json
{
  "properties": {
    "tarif_sans_collecte_applicable": {
      "type": "boolean",
      "default": false,
      "description": "Si true, tournée avec toutes collectes 'realisee_sans_collecte' → coût 0€ (cas A Toutes! camion). Si false (défaut), vacation facturée normalement."
    }
  }
}
```

**Nota** : la formule `grille_matricielle_zone_type_course` (A Toutes! vélo) gère nativement ce cas via `type_course = incomplete` (tarif réduit ~50%). Pas de flag nécessaire.

**Seed V1** :
- `vacations_paliers` (Strike, Marathon, province) : `tarif_sans_collecte_applicable = false`
- `grille_matricielle_zone` (A Toutes! camion) : `tarif_sans_collecte_applicable = false` (vacation facturée si chauffeur mobilisé)
- `grille_matricielle_zone_type_course` (A Toutes! vélo) : N/A (géré par `type_course`)

### 4. `parametres_tms` — namespace `m07` (2 paramètres — +1 grilles réelles 2026-06-07, simplifié sobriété 2026-04-30)

| Clé | Type | Valeur seed V1 | Modifiable par |
|-----|------|----------------|----------------|
| `m07.delai_annulation_sans_facturation_minutes` | integer | `180` | `admin_tms` |
| `m07.atoutes_express_seuil_minutes` | integer | `90` | `admin_tms` |

`m07.delai_annulation_sans_facturation_minutes` : seuil annulation uniforme tous prestataires (R2.7 §05 authoritative). Default `180` (3h, sobriété C3 2026-04-30 ex-`60`).
`m07.atoutes_express_seuil_minutes` : détermination du mode `express` vs `programme` de la grille A Toutes! (R2.3 §05, 3e dimension — grilles réelles + arbitrage Val 2026-06-07). Express si délai attribution → heure planifiée < seuil. **Seed `90` (confirmé Val 2026-06-07 : express = course commandée moins de 1 h 30 avant la collecte — cohérent avec le libellé grille « Express >1.5h »).**

### 5. Nouvelle fonction SQL `tms.m07_compute(grille_id uuid, tournee_id uuid) RETURNS (cout_ht numeric, detail jsonb)`

Dispatch par `formules_catalogue.code` sur 5 sous-fonctions :
- `tms.m07_compute_vacations_paliers(grille_id, tournee_id)`
- `tms.m07_compute_grille_matricielle_zone_type_course(grille_id, tournee_id)`
- `tms.m07_compute_grille_matricielle_zone(grille_id, tournee_id)`
- `tms.m07_compute_forfait_km(grille_id, tournee_id)`
- `tms.m07_compute_forfait_fixe(grille_id, tournee_id)`

Ajout d'une 6ᵉ formule = (1) INSERT `formules_catalogue`, (2) déploiement `tms.m07_compute_<code>`, (3) mise à jour dispatch `tms.m07_compute`. Couplage DB ↔ code assumé (migration + code). À défaut d'implémentation : **exception SQL bloquante** (revue sobriété §05 2026-05-01 D2 — `cout_manquant` supprimé V1, le mismatch DB/code = bug déploiement à corriger immédiatement, pas un état métier à monitorer).

**Validation DB au seed — TRANCHÉE (arbitrage Val 2026-06-06, floue #5 cdc-test-scenarios M07)** : trigger `trg_formules_catalogue_impl_check`.

```sql
CREATE OR REPLACE FUNCTION tms.fn_formules_catalogue_impl_check()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regprocedure(format('tms.m07_compute_%s(uuid, uuid)', NEW.code)) IS NULL THEN
    RAISE EXCEPTION 'INVARIANT_VIOLATION: fonction tms.m07_compute_% absente pour formule %. Déployer l''implémentation avant de seeder le catalogue.', NEW.code, NEW.code;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_formules_catalogue_impl_check
  AFTER INSERT OR UPDATE OF code ON tms.formules_catalogue
  FOR EACH ROW
  EXECUTE FUNCTION tms.fn_formules_catalogue_impl_check();
```

Le mismatch DB seed ↔ code échoue **au seed/déploiement** (INSERT refusé), pas en prod à la clôture. L'exception runtime de `m07_compute` (cf. trigger §7 step 5) reste le filet de sécurité de dernier recours. Ordre de migration : déployer les fonctions `m07_compute_*` **avant** le seed `formules_catalogue`.

### 6. Impact cross-schema Plateforme

> *(Obsolète V1 — revue sobriété §08 Bloc A 2026-05-01 A2 ; corrigé audit cohérence inter-CDC 2026-06-04)* : il n'y a **plus de table `plateforme.courses_logistiques`** ni de colonnes à y ajouter. Le coût est exposé en lecture via la vue **`plateforme.v_courses_logistiques`** (SELECT direct depuis `tms.tournees ⋈ tms.collecte_tournees`). Le trigger `plateforme.fn_recalc_marge_tournee()` se déclenche sur UPDATE de `tms.tournees.cout_final_ht` / `push_s6_version` (la colonne `version_paiement` n'existe pas sur la table — c'est un **alias de vue** de `push_s6_version`, exposé en lecture reporting). Contrat de colonnes figé : [[../01 - Cahier des charges App/04 - Data Model#Vue : `v_courses_logistiques`]].

### 7. Nouveau trigger SQL `tms.trg_m07_calc_cost` (propagation A6 2026-04-25)

Trigger `AFTER UPDATE OF statut ON tournees` qui orchestre M07 W1 (calcul coût synchrone à la clôture). Sans ce trigger, les tournées passent à `terminee` sans calcul → `cout_calcule_ht=NULL` → blocage M08 rapprochement (R_M08.x match exact impossible) + recalcul marge cross-schema Plateforme jamais déclenché.

**Spec déclarative** : invoqué exclusivement par la transition `OLD.statut IN ('en_cours','acceptee') AND NEW.statut='terminee'`. Pas de lock applicatif (concurrence gérée par PostgreSQL row-level lock sur `tournees`).

```sql
CREATE OR REPLACE FUNCTION tms.fn_m07_calc_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tms, shared, public
AS $$
DECLARE
  v_grille_id uuid;
  v_compute_result record;     -- (cout_ht numeric, detail jsonb)
  v_nb_collectes  integer;
  v_cout_reparti_centimes integer;
BEGIN
  -- 0. Sortie immédiate si la transition n'est pas une clôture
  IF NEW.statut <> 'terminee'
     OR OLD.statut NOT IN ('en_cours', 'acceptee') THEN
    RETURN NEW;
  END IF;

  -- 1. Idempotence : si déjà calculé (recalcul interdit hors EC5), STOP silencieux
  IF NEW.cout_calcule_ht IS NOT NULL AND NEW.cout_calculated_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 2. Précheck horaires (W1 step 2) — refondu revue sobriété §05 2026-05-01 D2 : statut_financier inchangé (cout_manquant supprimé)
  -- Si horaires manquants → alerte critique + skip calcul, mais statut financier reste 'calcule' avec cout_calcule_ht=NULL en attente
  IF NEW.heure_reelle_debut IS NULL OR NEW.heure_reelle_fin IS NULL THEN
    PERFORM tms.alerte_emit('m07_horaires_manquants', 'tournee', NEW.id,
      jsonb_build_object('heure_reelle_debut', NEW.heure_reelle_debut,
                         'heure_reelle_fin', NEW.heure_reelle_fin));
    -- Pas d'UPDATE statut_financier (reste 'calcule' default avec cout_calcule_ht NULL)
    -- Ops doit corriger horaires côté M02/M04 puis trigger recalcul
    RETURN NEW;
  END IF;

  -- 3. Précheck durée nulle (warning non bloquant — coût=0)
  IF EXTRACT(EPOCH FROM (NEW.heure_reelle_fin - NEW.heure_reelle_debut)) <= 0 THEN
    PERFORM tms.alerte_emit('m07_duree_nulle', 'tournee', NEW.id, '{}'::jsonb);
    UPDATE tms.tournees
       SET cout_calcule_ht    = 0,
           cout_detail        = jsonb_build_object('raison', 'duree_nulle'),
           cout_calculated_at = now(),
           statut_financier   = 'calcule',
           push_s6_version    = 1
     WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  -- 4. Lookup grille (fallback si non dérivée au dispatch)
  v_grille_id := NEW.grille_tarifaire_id;
  IF v_grille_id IS NULL THEN
    SELECT g.id INTO v_grille_id
      FROM tms.grilles_tarifaires_prestataires g
      JOIN tms.vehicules v ON v.id = NEW.vehicule_id
     WHERE g.prestataire_id = NEW.prestataire_id
       AND (g.type_vehicule_id = v.type_vehicule_id OR g.type_vehicule_id IS NULL)
       AND g.date_debut_validite <= NEW.date_planifiee
       AND (g.date_fin_validite IS NULL OR g.date_fin_validite >= NEW.date_planifiee)
       AND g.statut = 'actif'
     ORDER BY g.type_vehicule_id NULLS LAST, g.date_debut_validite DESC
     LIMIT 1;
  END IF;

  IF v_grille_id IS NULL THEN
    -- Refondu revue sobriété §05 2026-05-01 D2 : cas impossible par construction
    -- (R_M06.X grille obligatoire à création prestataire + trigger anti-expiration sans successeur)
    -- Si on arrive ici, c'est un bug → exception bloquante
    RAISE EXCEPTION 'INVARIANT_VIOLATION: grille tarifaire manquante pour prestataire % à la date %. R_M06.X devrait empêcher ce cas. Vérifier integrité base.',
      NEW.prestataire_id, NEW.date_planifiee
    USING HINT = 'Audit: SELECT * FROM tms.grilles_tarifaires_prestataires WHERE prestataire_id = ... AND statut = ''actif''';
  END IF;

  -- 5. Exécution formule via dispatcher (revue sobriété §05 2026-05-01 D2 : feature_not_supported devient bug bloquant)
  BEGIN
    v_compute_result := tms.m07_compute(v_grille_id, NEW.id);
  EXCEPTION
    WHEN feature_not_supported THEN
      -- Refondu revue sobriété §05 2026-05-01 D2 : si une grille référence un code formule sans implémentation, c'est un bug déploiement
      -- (mismatch DB seed vs code) — exception bloquante au lieu de cout_manquant
      RAISE EXCEPTION 'INVARIANT_VIOLATION: formule % non implémentée pour grille %. Mismatch DB seed vs code. SQLERRM: %',
        (SELECT formule_id FROM tms.grilles_tarifaires_prestataires WHERE id = v_grille_id),
        v_grille_id, SQLERRM
      USING HINT = 'Vérifier que tms.m07_compute_<code_formule> existe et que formules_catalogue.code matche';
  END;

  -- 6. Stockage résultat sur tournee — sobriété B5 2026-04-30 : cout_final_ht écrit explicitement (plus GENERATED)
  UPDATE tms.tournees
     SET grille_tarifaire_id = v_grille_id,
         cout_calcule_ht     = v_compute_result.cout_ht,
         cout_final_ht       = v_compute_result.cout_ht,    -- = cout_calcule_ht car pas d'ajustement à ce stade
         cout_detail         = v_compute_result.detail,
         cout_calculated_at  = now(),
         statut_financier    = 'calcule',
         push_s6_version     = COALESCE(push_s6_version, 0) + 1
   WHERE id = NEW.id;

  -- 7. Répartition coût par collecte de la tournée (égale, dernière reçoit le reste)
  --    Propagation multi-camions 2026-05-25 : écriture sur la liaison `collecte_tournees`
  --    (plus sur `collectes_tms.cout_reparti_centimes` retiré). Une collecte multi-camions
  --    reçoit une part PAR tournée ; son coût logistique total = SUM des parts de ses tournées.
  --    `v_nb_collectes` = nombre de collectes DE CETTE tournée (lignes de liaison).
  SELECT count(*) INTO v_nb_collectes
    FROM tms.collecte_tournees
   WHERE tournee_id = NEW.id;

  IF v_nb_collectes > 0 THEN
    v_cout_reparti_centimes := FLOOR(v_compute_result.cout_ht * 100 / v_nb_collectes)::integer;

    UPDATE tms.collecte_tournees ct
       SET cout_reparti_centimes = v_cout_reparti_centimes
     WHERE ct.tournee_id = NEW.id
       AND ct.id IN (
         SELECT ct2.id
           FROM tms.collecte_tournees ct2
           JOIN tms.collectes_tms c ON c.id = ct2.collecte_tms_id
          WHERE ct2.tournee_id = NEW.id
          ORDER BY c.heure_collecte ASC, ct2.id ASC
          LIMIT (v_nb_collectes - 1)
       );

    -- Dernière collecte de la tournée reçoit le reste (anti-rounding error)
    UPDATE tms.collecte_tournees ct
       SET cout_reparti_centimes = ROUND(v_compute_result.cout_ht * 100)::integer
                                   - (v_cout_reparti_centimes * (v_nb_collectes - 1))
     WHERE ct.tournee_id = NEW.id
       AND ct.id = (
         SELECT ct2.id
           FROM tms.collecte_tournees ct2
           JOIN tms.collectes_tms c ON c.id = ct2.collecte_tms_id
          WHERE ct2.tournee_id = NEW.id
          ORDER BY c.heure_collecte DESC, ct2.id DESC
          LIMIT 1
       );
  END IF;

  -- 8. Recalcul marge Plateforme cross-schema (revue sobriété §08 Bloc A 2026-05-01 A2)
  --    Remplace ex-émission webhook S6 outbox. Plus de retry/DLQ — appel synchrone DB.
  --    La fonction lit cout_calcule_ht via vue plateforme.v_courses_logistiques.
  PERFORM plateforme.fn_recalc_marge_tournee(NEW.id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_m07_calc_cost
  AFTER UPDATE OF statut ON tms.tournees
  FOR EACH ROW
  WHEN (OLD.statut IS DISTINCT FROM NEW.statut)
  EXECUTE FUNCTION tms.fn_m07_calc_cost();
```

**Trigger compagnon `trg_m07_recalc_on_horaires` (arbitrage Val 2026-06-06 — floue #1 BLOQUANTE résolue, cdc-test-scenarios M07)** :

`trg_m07_calc_cost` n'écoute que `statut`. Quand une tournée passe à `terminee` sans `heure_reelle_debut`/`heure_reelle_fin` (cas clôture forcée M04 W9 ou saisie incomplète), le précheck step 2 émet `m07_horaires_manquants` (critical) et laisse `cout_calcule_ht NULL`. Une correction ultérieure des horaires par Ops **ne modifie pas `statut`** → `trg_m07_calc_cost` ne se redéclenche jamais → le coût resterait NULL indéfiniment (blocage rapprochement M08). Ce trigger compagnon ferme le trou de façon déterministe, sans dépendre d'un appel applicatif.

```sql
CREATE OR REPLACE FUNCTION tms.fn_m07_recalc_on_horaires()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tms, shared, public
AS $$
BEGIN
  -- Ne recalcule que si la tournée est clôturée, sans coût posé, et que les
  -- deux horaires sont désormais renseignés (la correction a complété l'info).
  IF NEW.statut = 'terminee'
     AND NEW.cout_calcule_ht IS NULL
     AND NEW.heure_reelle_debut IS NOT NULL
     AND NEW.heure_reelle_fin   IS NOT NULL THEN
    PERFORM tms.fn_m07_compute_and_store(NEW.id);                       -- coeur de calcul factorisé (steps 3→8)
    PERFORM tms.alerte_resolve('m07_horaires_manquants', 'tournee', NEW.id); -- résout l'alerte critique
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_m07_recalc_on_horaires
  AFTER UPDATE OF heure_reelle_debut, heure_reelle_fin ON tms.tournees
  FOR EACH ROW
  EXECUTE FUNCTION tms.fn_m07_recalc_on_horaires();
```

**Refactor associé** : le coeur de calcul (lookup grille → `tms.m07_compute` → stockage `tournees` → répartition `collecte_tournees` → `plateforme.fn_recalc_marge_tournee`, soit les steps 3→8 de `fn_m07_calc_cost`) est factorisé dans `tms.fn_m07_compute_and_store(tournee_id uuid)`, appelée par **les deux** triggers. Elle reste idempotente (no-op si `cout_calcule_ht` déjà posé). **Garde anti-boucle** : le trigger ne s'active que tant que `cout_calcule_ht IS NULL` ; le premier calcul réussi pose `cout_calcule_ht` et éteint toute ré-exécution. La durée nulle (`cout_calcule_ht = 0`, non NULL) n'est donc pas re-déclenchée.

**Sécurité (SECURITY DEFINER)** : le trigger doit pouvoir UPDATE `tournees`, INSERT `integrations_logs`, INSERT `alertes` même si la transaction d'origine vient d'un Manager prestataire (M03) ou Chauffeur (M05). Les RLS write-system-only sur `integrations_logs` et `alertes` exigent SECURITY DEFINER. `search_path` figé pour éviter SQL injection via path search.

**Garde-fous** :
- Sortie immédiate si pas une transition de clôture (limite l'overhead sur autres UPDATE).
- Idempotence : deuxième passage avec `cout_calcule_ht IS NOT NULL` = no-op silencieux. Évite double calcul si UPDATE atomique relancé.
- **Cas d'erreur (refondu revue sobriété §05 2026-05-01 D2)** :
  - **horaires manquants** : alerte M11 `m07_horaires_manquants` critical, statut tournée reste `terminee`, statut financier reste `calcule` avec `cout_calcule_ht NULL`. **Recalcul auto à la correction des horaires par le trigger compagnon `trg_m07_recalc_on_horaires`** (arbitrage Val 2026-06-06 — sans ce trigger, le coût resterait NULL car `trg_m07_calc_cost` n'écoute que `statut`) : dès que `heure_reelle_debut` ET `heure_reelle_fin` sont renseignées, `fn_m07_compute_and_store` est rejouée et l'alerte est résolue. Tournée jamais bloquée.
  - **durée nulle** : alerte M11 `m07_duree_nulle` warning, `cout_calcule_ht=0`, statut financier `calcule`. Tournée pas bloquée.
 - → **Refondus en exceptions SQL bloquantes V1 (revue sobriété §05 2026-05-01 D2)** : ces cas étaient des `cout_manquant` jusqu'à présent, mais sont désormais impossibles par construction (R_M06.X grille obligatoire à création prestataire + trigger anti-expiration + dispatch formule validé au déploiement). Si déclenchés en prod = bug, surface par exception SQL (pas alerte M11).
- **Recalcul marge = appel synchrone cross-schema** `plateforme.fn_recalc_marge_tournee(NEW.id)` (step 8 ci-dessus, revue sobriété §08 Bloc A 2026-05-01 A2). **Plus de pattern outbox `integrations_logs` S6, plus de retry/DLQ, plus de HTTP** — tout en DB sur la même instance Supabase. *(propagation S6 2026-06-04 — ex-mention "outbox retry 1h/24h" supprimée, contredisait step 8.)*
- `push_s6_version` incrémenté ici (v1) — les ajustements W2 incrémenteront v2, v3, etc. Le compteur sert au reporting "marge ajustée" côté Plateforme (lu via vue cross-schema), pas à une idempotence webhook (W3 supprimé sobriété A3 2026-04-30).

**Code alerte requis (à seeder dans M11 §11.2 — propagation A6 vers A5)** :
- `m07_horaires_manquants` (critical, M07) : précheck step 2 KO → manque heure_reelle_debut/fin

Cf. §15 sécurité TMS pour les **8 tests pgTAP attendus** (transitions valides/invalides, idempotence, cas d'erreur, RLS).

---

## ⚠ Addendum 2026-04-24 (propagation M08) — Facturation prestataires + revue sobriété 2026-04-30

Issu de la rédaction de [[06 - Fonctionnalités détaillées TMS/M08 - Facturation prestataires]] (V1 rédigée 2026-04-24, **revue de sobriété 2026-04-30** — 16 simplifications appliquées). Impacts data model :

### 1. Colonnes ajoutées à `factures_prestataires`

Cf. section détaillée **Table : `factures_prestataires`** plus bas dans ce document — les colonnes M08 ont été intégrées directement dans la table de référence pour éviter la duplication.

Colonnes ajoutées : `source_upload` (enum 2 valeurs post-revue B4), `facture_corrigee_id` (self-ref D8), `remplacee_par_facture_id` (self-ref inverse), `type_contestation`, `conteste_par_user_id`, `conteste_at`, **`conteste_apres_validation` boolean (revue sobriété 2026-04-30 D1 — flag distinguant W6 Ops vs W9 Admin)**, `motif_validation_ecart` (W5 R_M08.3), `reference_reglement`, `commentaire_reglement`, `exporte_pennylane_at` (D10), `action_deverrouillage`, `motif_deverrouillage`, `deverrouillee_at` (W9 R_M08.5). **4 colonnes `*_par_user_id` retirées V1 revue sobriété §04 2026-04-30 B1** : `valide_par_user_id`, `regle_par_user_id`, `exporte_par_user_id`, `deverrouillee_par_user_id` — traçabilité acteur via `tms.audit_logs.acteur_user_id` (capture auto sur UPDATE).

Colonnes retirées V1 :
- `seuil_tolerance_ht`, `seuil_tolerance_pourcent` (D4 zéro tolérance, 2026-04-24)
- (revue sobriété 2026-04-30 B3 — V1 = virement par défaut, modalité atypique tracée dans `commentaire_reglement` libre)

Enum `statut_rapprochement` refondu : ajout `rapprochement_manuel_requis`, `remplacee_par_avoir`. Retrait `ecart_important` (fusion `ecart_detecte` D5, 2026-04-24). **Retrait `rejetee_pour_correction`** (revue sobriété 2026-04-30 D1 — fusionné dans `conteste` + flag `conteste_apres_validation` boolean). **Retrait `rapproche_ok`** (revue sobriété §05 2026-05-01 D1 — fusionné dans `valide` direct, match exact zéro tolérance auto-validé sans étape Ops intermédiaire). Enum final **7 valeurs** : `en_attente`, `ecart_detecte`, `rapprochement_manuel_requis`, `valide`, `regle`, `conteste`, `remplacee_par_avoir`.

Enum `source_upload` refondu (revue sobriété 2026-04-30 B4) : 3 valeurs → 2 valeurs (`manager_m03`, `ops_manuel`). Valeur `ops_rectification` supprimée — info portée par `facture_corrigee_id IS NOT NULL`.

### 2. Colonne ajoutée à `tournees`

- `verrouillee_par_facture_id uuid FK factures_prestataires(id) nullable` — facture M08 qui a verrouillé (R_M08.4). Reset NULL si W9 déverrouillage.

### 3. Nouvelle table `tms.exports_pennylane_log` **Supprimée revue sobriété 2026-04-30 B2**

Table dédiée supprimée V1. Trace des exports Pennylane via `tms.audit_logs` action `M08_EXPORT_PENNYLANE` (export normal) et `M08_EXPORT_PENNYLANE_ANNULEE` (compensation W9 EC19).

**Schéma payload audit_logs** (canonique — cf. M08 §11.5) :

```jsonc
// action = 'M08_EXPORT_PENNYLANE'
{
  "periode_export": "2026-04-01",
  "facture_ids": ["uuid1", "uuid2"],
  "nb_factures": 12,
  "total_ht": 24580.50,
  "total_tva": 4916.10,
  "total_ttc": 29496.60,
  "csv_url": "https://r2.../exports/2026-04.csv"
}

// action = 'M08_EXPORT_PENNYLANE_ANNULEE'
{
  "facture_id": "uuid",
  "motif_deverrouillage": "...",
  "export_origine_audit_id": "uuid"
}
```

**Vue SQL** `tms.v_m08_exports_pennylane` (alimentation E9 Section 3 Historique) — cf. M08 §11.5 pour SQL complet.

**Index** : sur `tms.audit_logs(action, created_at DESC)` partial WHERE action IN ('M08_EXPORT_PENNYLANE', 'M08_EXPORT_PENNYLANE_ANNULEE').

**RLS** : héritée de `tms.audit_logs` (lecture Ops + Admin TMS via policies existantes ; INSERT acteurs autorisés via fonction `tms.audit_log_emit` standard).

**Rétention** : 5 ans (alignée rétention `tms.audit_logs` Registre transport + obligations compta, §15 TMS).

### 4. `parametres_tms` — namespace `m08` (6 paramètres post-revue sobriété §05 2026-05-01 A1, ex-8)

| Clé | Type | Valeur seed V1 | Modifiable par |
|-----|------|----------------|----------------|
| `m08.ocr_timeout_secondes` | integer | `30` | `admin_tms` |
| `m08.ocr_confiance_min_blocage_pourcent` | numeric | `0` | `admin_tms` |
| `m08.seuil_alerte_validation_manuelle_ht` | numeric | `100` | `admin_tms` |
| `m08.seuil_alerte_contestation_anciennete_jours` | integer | `60` | `admin_tms` |
| `m08.max_taille_pdf_mo` | integer | `10` | `admin_tms` |
| `m08.pennylane_csv_encoding` | text | `UTF-8-BOM` | `admin_tms` |

### 5. Fonctions SQL M08

- `tms.m08_rapprocher(facture_id uuid)` : rapprochement synchrone (invoquée par `trg_m08_rapprocher` AFTER INSERT + bouton `Re-rapprocher` E2 M08)
- `tms.m08_verrouiller_tournees(facture_id uuid)` : trigger `trg_m08_verrouiller` BEFORE UPDATE `statut_rapprochement = 'valide'`
- `tms.m08_deverrouiller_tournees(facture_id uuid)` : trigger `trg_m08_deverrouiller` W9 — requires `motif_deverrouillage NOT NULL AND char_length(motif_deverrouillage) >= 30` (revue sobriété §04 2026-04-30 B1 — `deverrouillee_par_user_id NOT NULL` retiré V1, acteur tracé via `audit_logs.acteur_user_id`)

**Validation DB** : trigger refuse UPDATE `statut_rapprochement` vers `valide` si `action_deverrouillage IS NOT NULL` sauf si reset explicite. Trigger refuse UPDATE `regle_at` si `statut_rapprochement != 'valide'`.

### 6. Impact cross-schema Plateforme

Aucun impact V1. M08 est 100% interne TMS (pas d'endpoint API V1, pas de FK cross-schema). V2 envisagé : webhook Pennylane → Plateforme → TMS si mutualisation du pipeline paiement.

---

## ⚠ Addendum 2026-04-24 (propagation M12) — Moteur de suggestion d'attribution

Issu de la rédaction de [[06 - Fonctionnalités détaillées TMS/M12 - Attribution transporteur]] (V1 rédigée 2026-04-24). 5 impacts data model :

### 1. `collectes_tms` — 4 colonnes suggestion (revue sobriété 2026-04-29 — `refusee_par_prestataire_id` supprimée ; purge dette F3 2026-06-07)

Ajouts pour porter la suggestion M12 :

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `suggestion_prestataire_id` | uuid | FK `shared.prestataires(id)`, nullable | Prestataire suggéré par M12 (propagation M12 2026-04-24) |
| `suggestion_branche_r1_code` | text | nullable | Enum **9 valeurs (F1 tranché 2026-06-07)** : `zd_idf_strike`, `ag_velo_programme`, `ag_velo_express`, `ag_marathon_volume`, `ag_marathon_volume_backup_camion`, `ag_marathon_nuit`, `ag_velo_fallback_marathon`, `ag_province_proximite`, `aucun_prestataire` (`ag_velo_fallback_marathon` ajouté — audit A3 2026-05-09, manquait à l'enum ; `ag_marathon_volume_backup_camion` canonique cross-CDC = enum App `branche_attribution`, ex-`ag_camion_backup` retiré) |
| `suggestion_detail` | jsonb | NOT NULL, default `'{}'::jsonb` | Détail du calcul : `{ distance_km, service_everest_id, couverture_verifiee_at, prestataires_candidats_count, prestataires_exclus, branche_conditions_matched, parametres_snapshot }` ( supprimé revue sobriété 2026-04-29, purge F3 2026-06-07) |
| `suggestion_calculee_at` | timestamptz | nullable | Horodatage dernière exécution M12 (propagation M12) |

**Index ajoutés** :
- `(suggestion_prestataire_id, statut_dispatch) WHERE statut_dispatch = 'a_attribuer'`
- `(suggestion_branche_r1_code) WHERE statut_dispatch = 'a_attribuer'`

> **Trigger T1 (F5 tranché Val 2026-06-07)** : le trigger AFTER INSERT qui appelle `tms.m12_suggest` porte la clause **`WHEN (NEW.statut_dispatch = 'a_attribuer' AND NEW.origine <> 'migration')`** — les INSERT migration MTS-1 et collectes hors dispatch ne déclenchent pas M12 (pas d'alertes critical parasites, log propre).

### 2. Nouvelle table `tms.suggestions_attribution_log`

Append-only. Une ligne par exécution M12. Base de toutes les métriques M13 dashboard M12. Rétention 2 ans.

Cf. spec complète §06 M12 §4.2.

| Colonne clé | Type | Utilité |
|-------------|------|---------|
| `collecte_id` | uuid FK | Collecte visée |
| `trigger_source` | text | `T1_creation` / `T2_refus` / `T3_re_confirmation` (T4_ops_manuel + T5_bulk_recompute supprimés revue sobriété 2026-04-29 — Re-suggérer + bulk supprimés) |
| `prestataire_id` | uuid FK `shared.prestataires` | NULL si `aucun_prestataire` |
| `branche_r1_code` | text | Même enum que `collectes_tms.suggestion_branche_r1_code` |
| `detail` | jsonb | Snapshot complet calcul |
| `duree_calcul_ms` | integer | Pour monitoring perf |
| `cree_le` | timestamptz | Index chronologique |

> **Colonnes supprimées (revue sobriété 2026-04-29)** :
> - `prestataires_exclus uuid[]` (ex-debug auto-relance) — auto-relance W3 supprimée
> - `override_by_ops_user_id uuid` — audit override supprimé V1
> - `override_motif text` — motif override supprimé V1
> - `override_vers_prestataire_id uuid` — traçabilité override supprimée V1

**RLS** : read `admin_tms` + `ops_savr`, write système uniquement.

### 3. Nouvelle table `tms.everest_coverage_cache` — **Supprimée (audit cohérence A4 2026-05-09, purge F3 2026-06-07)**

> **Ne pas créer cette table.** Couverture Everest = check local `lieu.code_postal[:2] IN plateforme.parametres_algo.everest_codes_postaux` (seed `['75','92','93']`), zéro appel API dans l'attribution. Cf. M12 §4.3/§4.8.


| Colonne clé | Type | Utilité |
|-------------|------|---------|
| `plateforme_lieu_id` | uuid UNIQUE | Clé lookup |
| `is_handled` | boolean | Réponse Everest |
| `zone_code` | text nullable | Si renvoyé par Everest |
| `verifie_le` | timestamptz | Horodatage appel |
| `expires_at` | timestamptz | = verifie_le + 7 jours |
| `invalide_manuellement` | boolean | Bouton M13 |
| `invalide_par_user_id` | uuid FK | Qui a invalidé |

Cf. spec complète §06 M12 §4.3.

### 4. `shared.prestataires` — 1 nouvelle colonne `nb_collectes_6_mois_cache`

| Colonne | Type | Description |
|---------|------|-------------|
| `nb_collectes_6_mois_cache` | integer | NOT NULL default 0. Cache pour tri province multi-candidats (reco C5 M12). Incrément par trigger **uniquement sur transition ENTRANTE dans le pipeline** (`OLD.statut_dispatch NOT IN (...) AND NEW.statut_dispatch IN ('attribuee_en_attente_acceptation','acceptee','en_attente_execution')` — pas de double comptage par transition interne, F6 tranché 2026-06-07, précise A1 2026-04-25). Purge = **recalcul complet quotidien** par cron (UPDATE … SET cache = COUNT(*) sur 6 mois glissants — idempotent) |

**Index ajouté** : `(type_prestation, statut, nb_collectes_6_mois_cache)` pour lookup province performant.

**Impact cross-schema** : colonne ajoutée à la table `shared.prestataires` — propagation à consigner également côté [[../01 - Cahier des charges App/04 - Data Model]].

**Contrainte d'immutabilité du champ `code`** (décision Q1 2026-04-24) : `shared.prestataires.code` est **immuable post-création**. Implémentation par trigger `BEFORE UPDATE` qui rejette toute modification du champ avec `RAISE EXCEPTION 'shared.prestataires.code immuable. Renommage = soft delete + recréation avec nouveau code.'`. Justification : le code est la clé de résolution dans `resolve_prestataire_by_code()` utilisée par toutes les branches R1 (Strike, Marathon, A Toutes!). Toute modification casserait rétroactivement les références dans les paramètres JSON et `suggestions_attribution_log.detail.prestataires_exclus`. Renommage opérationnel = workflow M06 "soft delete + recréation". Valable `strike`, `marathon`, `a_toutes` et tous codes prestataires province.

### 5. `parametres_tms.attribution` — paramètres résiduels (refonte audit cohérence A1+A4 2026-05-09)

> **Refonte 2026-05-09** : la majorité des paramètres d'attribution AG IDF (`regle_ag_*`, `a_toutes_indisponible*`, `everest_codes_postaux`) **migrent côté Plateforme** dans `plateforme.parametres_algo` (source de vérité unique V1, V2 à reétudier au cutover). Le TMS V2 lira ces paramètres en cache local rafraîchi par webhook (canal à figer §08 V2). Reste 1 paramètre TMS-only : `province_tri_secondaire_code`. Suppression de `fallback_everest_down_supposer_couvert` (sans objet — vérification couverture locale, pas d'appel API).

| Clé | Type | Valeur seed V1 | Source de vérité | Modifiable par |
|-----|------|----------------|-----------------|----------------|
| `province_tri_secondaire_code` | string | `nb_collectes_6_mois_asc` | TMS | `admin_tms` |
| `regle_zd_prestataire_prioritaire_code` | string | `strike` | TMS | `admin_tms` |

> **F2 tranché Val 2026-06-07 (test-scenarios M12)** : `regle_zd_prestataire_prioritaire_code` ajouté au seed — il était utilisé par R1.1 + pseudo-code M12 §4.6 sans exister au data model. String simple V1 (pas de liste ordonnée), `admin_tms` seul (cohérent D11 ; la mention "éditable Ops Savr" de R1.1 est corrigée). Le résiduel TMS-only passe à **2 paramètres**.

**Paramètres migrés Plateforme (lecture seule TMS V2)** : `regle_ag_seuil_pax_velo`, `regle_ag_plage_velo_debut`, `regle_ag_plage_velo_fin`, `regle_ag_seuil_h2_minutes`, `a_toutes_indisponible`, `everest_codes_postaux`, `poids_par_repas_kg` (audit sobriété 2026-05-09 B2 — remplace doublon `m05_equivalent_repas_kg` côté `parametres_tms`). Voir [[../01 - Cahier des charges App/04 - Data Model#Table parametres_algo|`plateforme.parametres_algo`]].

> **Paramètres supprimés** :
> - `max_auto_relances_cascade` (revue sobriété 2026-04-29) — auto-relance W3 supprimée
> - `fallback_everest_down_supposer_couvert` (audit cohérence A4 2026-05-09) — vérification couverture locale, pas d'appel API
> - `regle_ag_plage_camion_fin` (audit cohérence A2 2026-05-09) — camion partage la plage vélo
> - `a_toutes_indisponible_raison` / `_declaree_le` / `_declaree_par` (audit sobriété 2026-05-09 B1) — métadonnées lues depuis `audit_log` central côté Plateforme (filtre `action = "parametres_algo_update"`, `details.cle = 'a_toutes_indisponible'`)
> - `m05_equivalent_repas_kg` (audit sobriété 2026-05-09 B2) — V2 supprimé côté `parametres_tms`, lecture cross-schema `plateforme.parametres_algo.poids_par_repas_kg`

### 6. Fonction SQL `tms.m12_enrich_override` — **Supprimée (revue sobriété 2026-04-29)**

L'audit override (motif + prestataire choisi vs suggéré) a été retiré V1. La table `suggestions_attribution_log` reste write-system-only via INSERT à la création de la suggestion (T1/T2/T3) — pas d'enrichissement ultérieur côté Ops. Audit basique conservé via `audit_logs` global INSERT au moment de l'attribution (W1 étape 6 M02).

---

## ⚠ Addendum 2026-04-24 (propagation M11) — Alerting transverse

Issu de la rédaction de [[06 - Fonctionnalités détaillées TMS/M11 - Alerting transverse]] (V1 rédigée 2026-04-24, 13 décisions D1-D13 tranchées). 6 impacts data model.

### 1. Nouveaux types enum

```sql
CREATE TYPE alerte_criticite AS ENUM ('warning', 'critical');
CREATE TYPE alerte_statut    AS ENUM ('ouverte', 'snoozee', 'resolue');  -- Bloc 6 sobriété 2026-04-28 B2+D2 : `ackee` retiré (metadata sur `ouverte` via ackee_par_user_id/ackee_at)
CREATE TYPE alerte_resolution_source AS ENUM ('manuel', 'auto');
```

**Note Bloc 3 sobriété 2026-04-25** : `info` retiré de `alerte_criticite` (A1), `expiree` retiré de `alerte_statut` (A7), `expiration` retiré de `alerte_resolution_source` (devenu inutile sans statut `expiree`). Events ex-`info` désormais tracés dans `tms.audit_logs` ou `tms.integrations_logs` selon module — voir M11 §13 propagations.

### 2. Nouvelle table `tms.alertes_catalogue` (D2 catalogue configurable)

PK `code text`. Source de vérité des codes d'alerte émissibles. Admin TMS configure criticité par défaut, destinataires, canaux, activation, sans redéploiement.

| Colonne | Type | Description |
|---------|------|-------------|
| `code` | text PK | Ex `m07_cout_manquant` |
| `titre_par_defaut` | text NOT NULL | Libellé affiché si pas override à l'émission |
| `description` | text | Doc interne |
| `criticite_par_defaut` | `alerte_criticite` NOT NULL | Override possible à l'émission |
| `destinataires_par_defaut` | jsonb NOT NULL default `{"roles": ["ops_savr"], "users": [], "manager_prestataire_scope": "none"}` | Routage V1 par rôle + user_ids + scope manager |
| | | — **Dégagée Bloc 4 sobriété 2026-04-25 (A11)** : matrice canal/criticité figée hardcodée V1 (`warning` → in-app, `critical` → in-app + email Resend). Plus d'override par-code. Réintroduire si besoin override V1.1+. |
| `module_origine` | text NOT NULL | `M01` \| ... \| `M14` \| `transverse` |
| `active` | boolean NOT NULL default true | Toggle Admin W9 |
| `desactive_par_user_id` / `desactive_at` / `desactive_motif` | — | Trace désactivation |
| `supprime_at` / `supprime_par_user_id` | — | Soft delete |
| `cree_at` / `mis_a_jour_at` | timestamptz | Standard |

**Index** : `(active) WHERE active = true`, `(module_origine)`.

**Seed V1** : 40+ codes canoniques (cf. [[06 - Fonctionnalités détaillées TMS/M11 - Alerting transverse#11.7 Catalogue canonique V1 (seed)]]). Migration initiale peuple toutes les alertes émises par M01-M08 + M12 + transverses.

### 3. Nouvelle table `tms.alertes`

Log de toutes les alertes émises avec dédup, cycle de vie ack/snooze/résolution, destinataires snapshotés.

| Colonne clé | Type | Description |
|-------------|------|-------------|
| `id` | uuid PK | — |
| `code` | text FK `tms.alertes_catalogue(code)` NOT NULL | — |
| `criticite` | `alerte_criticite` NOT NULL | Snapshot au moment émission (immuable R_M11.2) |
| `titre` | text NOT NULL | Libellé contextualisé |
| `entity_type` | text | `tournee` \| `facture_prestataire` \| `collecte_tms` \| `prestataire` \| `chauffeur` \| NULL *(`test` retiré Bloc 4 A5 — résidu §04 corrigé 2026-06-07, aligné M11 §11.3)* |
| `entity_id` | uuid | Polymorphe, FK non contrainte (EC14) |
| `payload` | jsonb NOT NULL default `'{}'` | Data métier |
| `dedup_key` | text GENERATED ALWAYS AS (`code \|\| ':' \|\| COALESCE(entity_type, '') \|\| ':' \|\| COALESCE(entity_id::text, '')`) STORED | Expression explicitée 2026-06-07 (F3 scénarios M11) — l'INSERT W1 ne fournit pas la colonne |
| `occurrences` | integer NOT NULL default 1 | Counter debounce |
| `derniere_occurrence_at` | timestamptz NOT NULL | MAJ par W1 dédup |
| `statut` | `alerte_statut` NOT NULL default `ouverte` | — |
| `destinataires_user_ids` | uuid[] NOT NULL default `{}` | Snapshot W2 |
| `emise_at` | timestamptz NOT NULL default now() | — |
| `ackee_par_user_id` / `ackee_at` | — | W4 |
| `snoozee_jusqu_a` / `snoozee_par_user_id` / `snoozee_motif` | — | W5 |
| `resolue_par_user_id` / `resolue_at` / `resolue_source` / `resolue_raison` / `resolue_motif` | — | W6/W7 |

**Contraintes CHECK** : cohérence `statut` ↔ colonnes associées (ack → `ackee_*` NOT NULL, snoozee → `snoozee_*` NOT NULL, resolue → `resolue_*` NOT NULL).

**Index** :
- `(dedup_key) WHERE statut IN ('ouverte', 'snoozee')` — lookup dédup W1 (Bloc 6 B2 : `ackee` retiré)
- `(criticite, statut) WHERE statut IN ('ouverte', 'snoozee')` — dashboard KPI header (Bloc 6 B2)
- `(criticite, emise_at) WHERE statut = 'ouverte' AND ackee_at IS NULL` — filtre "non ackées" (Bloc 6 B2 nouvel index)
- GIN `(destinataires_user_ids)` — lookup "alertes pour moi"
- `(entity_type, entity_id) WHERE entity_type IS NOT NULL` — drill-down fiche
- `(emise_at DESC)`, `(code, emise_at DESC)`

### 4. Nouvelle table `tms.alertes_evenements_log`

**Dégagée Bloc 6 sobriété 2026-04-28 (C1)**. Timeline cycle de vie fusionnée dans `tms.audit_logs` (`table_name='alertes'`, `row_id=alerte_id`, `action` = `M11_ACK`/`M11_SNOOZE`/`M11_UNSNOOZE`/`M11_RESOLVE_MANUEL`/`M11_RESOLVE_AUTO` — *colonne corrigée 2026-06-11 : `audit_logs` porte `table_name`, pas `entity_type`*). Avantage : -1 table, -1 set RLS, purge via `tms.audit_logs` existante. E2 drawer TMS lit `tms.audit_logs WHERE table_name='alertes' AND row_id=alerte.id ORDER BY created_at`.

### 4bis. Nouvelle table `tms.alertes_archive_critical` (B3 revue sobriété §05 2026-05-01)

Archive append-only des alertes `critical` purgées par `m11_purger_archives` (cf. R_M11.10). Remplace l'ancien trigger AFTER DELETE qui copiait dans `tms.audit_logs` (anti-pattern : trigger sur opération destructive + couplage audit_logs/alertes incorrect).

```sql
CREATE TABLE tms.alertes_archive_critical (
  -- snapshot complet de tms.alertes au moment de la purge
  id uuid PRIMARY KEY,
  code text NOT NULL,
  criticite text NOT NULL CHECK (criticite = 'critical'),  -- table dédiée critical only
  emise_at timestamptz NOT NULL,
  resolue_at timestamptz NOT NULL,
  entity_type text,
  entity_id uuid,
  dedup_key text,
  occurrences integer NOT NULL DEFAULT 1,
  ackee_par_user_id uuid,
  ackee_at timestamptz,
  resolue_par_user_id uuid,
  resolue_source text,
  resolue_raison text,
  contexte text,  -- alignement audit_logs.contexte
  archive_at timestamptz NOT NULL DEFAULT now(),  -- date de l'archivage (pas la résolution)
  -- pas de FK : la table source peut être purgée
  -- pas d'UPDATE/DELETE possible (RLS deny + revoke GRANT)
);

CREATE INDEX ON tms.alertes_archive_critical (resolue_at DESC);
CREATE INDEX ON tms.alertes_archive_critical (code, resolue_at DESC);
CREATE INDEX ON tms.alertes_archive_critical (entity_type, entity_id) WHERE entity_type IS NOT NULL;
```

**RLS** : SELECT autorisé `admin_tms` uniquement. Aucun INSERT/UPDATE/DELETE direct (l'INSERT se fait exclusivement via le cron `m11_purger_archives` étape 1, en SECURITY DEFINER).

**Workflow purge** (cf. M11 §6.3 + R_M11.10) :
1. Étape 1 : `INSERT INTO tms.alertes_archive_critical (id, code, criticite, ...) SELECT id, code, criticite, ... FROM tms.alertes WHERE criticite='critical' AND statut='resolue' AND resolue_at < now() - interval '3 years';`
2. Étape 2 : `DELETE FROM tms.alertes WHERE statut='resolue' AND resolue_at < now() - interval '3 years';`

**Volume cible** : ~10-50 alertes critical/an × 3 ans = quelques centaines de lignes archivées au max après quelques années. Stockage négligeable.

**Avantage vs ancien trigger AFTER DELETE → audit_logs** : (1) pas de trigger sur opération destructive (perf bulk + debug propre), (2) séparation des préoccupations (audit_logs = mutations métier, alertes_archive_critical = snapshot historique des alertes critical purgées), (3) requête historique simple (`SELECT * FROM alertes_archive_critical WHERE code = 'X' AND resolue_at > date` au lieu d'aller fouiller dans `audit_logs.contexte`).

### 5. 8 nouveaux paramètres `parametres_tms.m11_*` (post revue sobriété 2026-04-25 — 4 paramètres dégagés A6+A8)

| Clé | Valeur seed V1 | Modifiable par |
|-----|----------------|----------------|
| `m11.debounce_seconds` | `300` | `admin_tms` |
| `m11.retention_annees` | `3` | `admin_tms` |
| `m11.snooze_motif_min_car_critical` | `10` | `admin_tms` |
| `m11.email_batch_latence_cible_seconds` | `60` | `admin_tms` |

**Paramètres dégagés revue sobriété 2026-04-25** : `m11.flood_seuil_occurrences` (A8) ; `m11_slack_active` / `m11_slack_webhook_url` / `m11_slack_criticite_min` (A6) ; `m11.expiration_info_jours` (Bloc 3 A1+A7) ; `m11.test_nettoyage_minutes` + `m11.rate_limit_test_par_heure` (Bloc 4 A5 — RPC `m11_emit_test` + cron + dépendance Vercel KV rate limit dégagés V1). **Dégagé 2026-06-07 (F4 scénarios M11)** : `m11.snooze_durees_autorisees` — durées {1h, 4h, 24h} hardcodées dans la RPC `m11_snooze` (source unique, EC6 garanti).

### 6. 8 nouvelles fonctions SQL + 5 crons pg_cron

**Fonctions SQL** (cf. [[06 - Fonctionnalités détaillées TMS/M11 - Alerting transverse#11.5 Fonctions SQL]] spec complète) :

- `tms.alerte_emit(code, entity_type, entity_id, payload, criticite_override, titre_override, destinataires_extra) RETURNS uuid` — point d'entrée unique D13
- `tms.alerte_resoudre_auto(code, entity_type, entity_id, raison) RETURNS integer`
- `tms.m11_ack(alerte_id) RETURNS void`
- `tms.m11_snooze(alerte_id, duree_heures, motif) RETURNS void`
- `tms.m11_resoudre_manuel(alerte_id, motif) RETURNS void`
- `tms.m11_resoudre_destinataires(catalogue_row, extras) RETURNS uuid[]`
- `tms.m11_notifier(alerte_id) RETURNS void`
- — **dégagée Bloc 4 sobriété 2026-04-25 (A5)**

Toutes SECURITY DEFINER, owner `service_role`.

**Crons pg_cron** (cf. §11.6 M11) :

| Nom | Fréquence | Action |
|-----|-----------|--------|
| `m11_unsnoozer` | 5 min | `snoozee` → `ouverte` si `jusqu_a < now()` |
| `m11_purger_archives` | mensuel (1er 4h) | **Étape 1 (B3 2026-05-01)** : INSERT INTO `tms.alertes_archive_critical` SELECT * WHERE `criticite='critical' AND statut='resolue' AND resolue_at < now - 3 years` (table dédiée append-only). **Étape 2** : Hard DELETE résolues > 3 ans (toutes criticités). supprimé V1. |

**Crons dégagés revue sobriété 2026-04-25** :
- A8 `m11_flood_watcher` (était : 2 min, scan `occurrences > 100` + émission méta `m11_flood_suspect`)
- Bloc 3 A1+A7 `m11_expirer_info` (était : quotidien 3h, `info ouverte > 30j` → `expiree`. Plus de criticité `info` ni statut `expiree` V1.)
- Bloc 4 A5 `m11_nettoyer_tests` (était : 15 min, auto-résolution alertes `entity_type='test'`. RPC `m11_emit_test` + dépendance Vercel KV rate limit dégagés V1, validation par pgTAP CI.)

**Impact émetteurs** : tous les triggers DB et services Node existants qui "alertaient" ad-hoc (logs, INSERT table spécifique, email direct) basculent sur `tms.alerte_emit(code, ...)`. Cf. §13.6 M11 — unification nommage codes alertes dans M01-M08 + M12 (action complémentaire à ce propagation data model).

### 7. `parametres_tms` — namespace `m02` (alerte acceptation sans réponse — nouveau 2026-06-03, arbitrage Val, révise D4 M02)

| Clé | Valeur seed V1 | Modifiable par | Rôle |
|-----|----------------|----------------|------|
| `m02_alerte_acceptation_seuil_proximite_heures` | `48` | `admin_tms` | Frontière collecte « proche » vs « lointaine » : si `heure_collecte − now() ≤ 48h` → collecte proche |
| `m02_alerte_acceptation_delai_proche_heures` | `3` | `admin_tms` | Délai max sans réponse prestataire avant alerte, pour une collecte **proche** (≤ 48h) |
| `m02_alerte_acceptation_delai_lointaine_heures` | `48` | `admin_tms` | Délai max sans réponse prestataire avant alerte, pour une collecte **lointaine** (> 48h) |

Cron associé `cron_m02_alerte_acceptation` (15 min) : scanne les collectes `statut_dispatch='attribuee_en_attente_acceptation'`, compare `now() − attribuee_at` au seuil applicable (selon proximité de `heure_collecte`), émet `tms.alerte_emit('m02_acceptation_sans_reponse', warning, collecte_id)` si dépassé et pas d'alerte active. Auto-résolution dès sortie du statut `attribuee_en_attente_acceptation`. Cf. M02 W6 + §05 R1.4. **Pas un SLA système** (aucune bascule de statut, aucune escalade auto, aucun auto-accept — ceux-ci restent supprimés depuis la sobriété 2026-04-29).

---

## ⚠ Addendum 2026-04-25 (propagation M10) — Gestion exutoires Veolia

Issu de la rédaction de [[06 - Fonctionnalités détaillées TMS/M10 - Gestion exutoires Veolia]] (V1 rédigée 2026-04-25, 13 décisions D1-D13 tranchées). 4 impacts data model TMS, 0 impact Plateforme.

> **Refonte revue sobriété 2026-04-30 (V3 sobre)** : suppression dualité `realise`/`confirme_at`, suppression confirmation chauffeur M05, suppression cron escalade gradient + auto-confirmation J+7, statut réduit à 3 valeurs, fusion alertes saturation. Section ci-dessous réécrite — versions v1/v2 conservées en historique via comparaison git.

### 1. `stocks_bacs_entrepot` — 2 nouvelles colonnes (capacité + seuil saturation)

Ajouts pour supporter la jauge dashboard E8 + le seuil saturation absolu R5.3 reformulée (D2/D3/D7).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `capacite_max` | integer | NOT NULL, default 0 | Capacité physique max (nb bacs) du couple `(flux, type_contenant_id)` à l'entrepôt. Sert au calcul de la jauge dashboard E8 (`quantite_pleine / capacite_max × 100`). `0` = couple non paramétré → jauge non affichée (cf. EC15) |
| `seuil_saturation_pleins` | integer | NOT NULL, default 0 | Seuil absolu en bacs pleins déclenchant `m10_bac_satur` (criticité dynamique — warning à 85%, critical au-delà du seuil ou ≥100%, fusion B3 revue sobriété 2026-04-30). Cohérent R5.3 reformulée — seuil **absolu** par couple, plus de seuil global ni de seuil en %. `0` = pas d'alerte saturation absolue (le seuil 85% jauge prend le relais) |

> **Suppression revue sobriété 2026-04-30 B5** : ancienne colonne `quantite_pleine_recomptee` retirée. Le recomptage met à jour `quantite_pleine` directement (la valeur courante reflète déjà le dernier recomptage). Historique des écarts conservé via `recomptages_stocks_entrepot_log`.

**Index ajouté** : `(quantite_pleine, capacite_max) WHERE capacite_max > 0` (scan jauge ≥ 85%).

**Contrainte CHECK** : `seuil_saturation_pleins >= 0`, `capacite_max >= 0`.

**Impact RLS** : aucun (RLS existante Ops Savr / Admin TMS RW préservée — voir §09).

### 2. `passages_veolia` — 4 nouvelles colonnes (traçabilité origine + audit vidéo + motif annulation) **(V3 sobre 2026-04-30)**

⚠ V3 sobre 2026-04-30 : suppression de 6 colonnes V2 (`confirme_at`, `confirme_par_user_id`, `confirme_par_chauffeur_id`, `confirmation_source`, `auto_confirmee_j7`, `auto_confirmee_at`, `commentaire_confirmation`). Reset stock désormais piloté par la transition `statut: planifie → realise` directement (W3 M10). Audit vidéo simplifié en 1 colonne timestamp inline.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `cree_par_action` | text | NOT NULL, default `'saisie_manuelle'` | Enum `'saisie_manuelle'` (E4 Ops planifie ou crée a posteriori R5.8 v3) / `'bouton_declencher'` (E6 Ops déclenche exceptionnellement). Permet filtre E3 + analyse qualité dispatch exutoire (D5) |
| `statut_realise_at` | timestamptz | nullable | Timestamp où `statut` passe à `'realise'` (saisie Ops E5). Renseigné par fonction `tms.m10_declarer_passage_realise`. NULL tant que `statut <> 'realise'` |
| `verification_video_at` | timestamptz | nullable | Timestamp où Ops a coché "J'ai vérifié via vidéosurveillance que les bacs ont été vidés" en E5. Audit simple inline. NULL si déclaration sans cochage (auto-confirmation a posteriori EC6 v3) ou si statut `<> 'realise'`. **Remplace** les 6 colonnes V2 confirmation supprimées |
| `motif_annulation` | text | nullable, CHECK IN (`'annulation'`,`'report'`,`'autre'`) ou NULL | Enum 3 valeurs. NOT NULL si `statut = 'annule'`, NULL sinon. Sert au tri E3 et au déclenchement W8 (`m10_passage_reporte` vs `m10_passage_annule`). Décision revue sobriété 2026-04-30 D1/B2 : remplace l'ancien statut `reporte` |
| `motif_annulation_libre` | text | nullable | Motif libre (textarea) saisi par Ops à l'annulation. NULL si `statut <> 'annule'` |
| `passage_origine_id` | uuid | FK `passages_veolia(id)`, nullable | Lien optionnel vers le passage initial annulé pour motif `'report'`. NULL si pas de lien (création manuelle indépendante) |

**Renommage** : `nb_bacs_enlevés` → `nb_bacs_enleves` (suppression accent — incompatible certaines libs ORM Supabase). Propagation impacte §04 niveau 4 + §05 R5.4 + §03 M10. **Note V3** : `nb_bacs_enleves` reste collecté (audit + reporting Veolia + V2 facturation), mais **n'a pas d'effet métier** sur le stock V1 (R5.4 v3 reset total piloté par transition `statut: planifie → realise`, pas par cette valeur — présomption "Veolia vide tout ou rien").

**Suppression V1** : aucune. Pas de `cout_ht` ajouté V1 (D6 — coûts Veolia reportés V2).

**Suppressions V3 (revue sobriété 2026-04-30)** : 6 colonnes V2 retirées (`confirme_at`, `confirme_par_user_id`, `confirme_par_chauffeur_id`, `confirmation_source`, `auto_confirmee_j7`, `auto_confirmee_at`, `commentaire_confirmation`). 4 CHECK constraints conditionnelles cohérence retirées. 2 index partiels retirés.

**Contraintes CHECK V3** :
- `cree_par_action IN ('saisie_manuelle', 'bouton_declencher')`
- `nb_bacs_enleves >= 0`
- `motif_annulation IS NULL OR motif_annulation IN ('annulation', 'report', 'autre')`
- **Cohérence statut/motif** : `(statut <> 'annule' AND motif_annulation IS NULL AND motif_annulation_libre IS NULL) OR (statut = 'annule' AND motif_annulation IS NOT NULL)`
- **Cohérence statut/réalisé** : `(statut = 'realise' AND statut_realise_at IS NOT NULL) OR (statut <> 'realise' AND statut_realise_at IS NULL)`
- **Cohérence statut enum réduit** : `statut IN ('planifie', 'realise', 'annule')` (3 valeurs au lieu de 5 — D1/B1/B2 revue sobriété 2026-04-30)

**Index V3** :
- `(cree_par_action, statut)` pour filtre E3 dual
- `(flux, statut, date_prevue)` — scan E3 / cron W7
- `(statut_realise_at) WHERE statut = 'realise'` — historique passages réalisés (utilisé par exports + audit)
- `(passage_origine_id) WHERE passage_origine_id IS NOT NULL` — drill-down passages reportés

### 3. Nouvelle table `recomptages_stocks_entrepot_log` (append-only, 3 ans rétention)

Trace toutes les corrections manuelles Ops du stock entrepôt (E7) avec valeurs avant/après, écarts, motif. Append-only (aucun UPDATE/DELETE autorisé hors purge cron).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `stocks_bacs_entrepot_id` | uuid | FK `stocks_bacs_entrepot(id)`, NOT NULL | Couple `(flux, type_contenant_id)` recompté |
| `flux` | text | NOT NULL | Snapshot dénormalisé (sécurité historique si stock supprimé) |
| `type_contenant_id` | uuid | FK `types_contenants(id)` ON DELETE RESTRICT, NOT NULL | Idem |
| `quantite_pleine_avant` | integer | NOT NULL | Valeur `stocks_bacs_entrepot.quantite_pleine` pré-recomptage |
| `quantite_pleine_apres` | integer | NOT NULL | Valeur saisie Ops |
| `ecart_pleins` | integer | GENERATED ALWAYS AS (`quantite_pleine_apres - quantite_pleine_avant`) STORED | Calculé pour analyse |
| `quantite_vide_disponible_avant` | integer | NOT NULL | Idem pour vides |
| `quantite_vide_disponible_apres` | integer | NOT NULL | |
| `ecart_vides` | integer | GENERATED ALWAYS AS (`quantite_vide_disponible_apres - quantite_vide_disponible_avant`) STORED | |
| `motif` | text | NOT NULL si `abs(ecart_pleins) >= 5 OR abs(ecart_pleins)::float / GREATEST(quantite_pleine_avant, 1) >= 0.20 OR abs(ecart_vides) >= 5` | Justification obligatoire si écart significatif (D10) |
| `recompte_par_user_id` | uuid | FK `users_tms(id)`, NOT NULL | Auteur du recomptage (Ops Savr ou Admin TMS) |
| `created_at` | timestamptz | NOT NULL, default `now()` | |

**Index** : `(stocks_bacs_entrepot_id, created_at DESC)` pour drill-down historique par couple, `(recompte_par_user_id, created_at DESC)` pour suivi qualité Ops, `(created_at)` pour purge cron.

**RLS** : Ops Savr / Admin TMS RW INSERT only (UPDATE / DELETE refusés sauf cron purge système). Manager prestataire / Chauffeur → 403.

**Append-only enforcement** : trigger `BEFORE UPDATE OR DELETE` qui RAISE EXCEPTION sauf si `current_setting('app.cron_purge', true) = 'true'`.

**Rétention** : 3 ans (cohérent rétention M11 D8). Cron `m10_purger_recomptages` mensuel hard DELETE > 3 ans.

### 3 bis. `tournees` — 1 nouvelle colonne (idempotence trigger M10 W1)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `stock_entrepot_update_at` | timestamptz | nullable, default `NULL` | Flag d'idempotence du trigger `trg_m10_auto_increment_pleins` (W1 M10). Renseigné par la fonction trigger après propagation effective vers `stocks_bacs_entrepot`. Présence non-NULL → la fonction skip immédiatement les rejeux (cas réouverture/clôture multiple, replay, restore PITR). NULL en V1 pour toutes les tournées existantes (rétention historique : pas de rejouer rétroactivement) |

**Impact RLS** : aucun (colonne en lecture seule pour Ops/Manager, écriture exclusive par fonction trigger SECURITY DEFINER).

**Index** : non requis V1 (utilisé uniquement en check ligne unique trigger). Reconsidérer si reporting "tournées dont stock propagé" devient utile.

### 4. Paramètres `parametres_tms` namespace `m10_*` (5 paramètres — V3 sobre 2026-04-30)

| Clé | Valeur défaut | `modifiable_par[]` | Description |
|-----|---------------|--------------------|-------------|
| `m10_seuil_alerte_85_pct` | `0.85` | `admin_tms` | Seuil jauge déclenchant `m10_bac_satur` criticité `warning` (fusion B3 — au-dessus du seuil absolu, criticité passe à `critical`). Modifiable Admin si calibrage différent post retour terrain |
| `m10_delai_alerte_non_confirme_h` | `24` | `admin_tms` | Fenêtre R5.1 W7 — passage `planifie` à J-1/J+1 (criticité dynamique warning ; > 1j de retard → criticité critical) |
| `m10_recomptage_motif_seuil_abs` | `5` | `admin_tms` | Seuil absolu (bacs) au-delà duquel motif obligatoire E7 (D10) |
| `m10_recomptage_motif_seuil_rel` | `0.20` | `admin_tms` | Seuil relatif (% écart) au-delà duquel motif obligatoire E7 (D10) |
| `m10_contact_veolia` | `NULL` | `admin_tms` | JSON `{nom, email, tel, plateforme_url}` affiché en E6. Onboarding initial (cf. Q1 §12 M10) |

> **Suppressions revue sobriété 2026-04-30 (3 paramètres)** :
> - `m10_delai_escalade_warning_h` (corollaire A4)
> - `m10_delai_escalade_critical_h` (corollaire A4)
> - `m10_delai_auto_confirmation_h` (corollaire A3)
>
> Paramètres : 8 → 5.

### 5. Fonctions SQL `tms.*` **(V3 sobre 2026-04-30)**

- `tms.m10_recompter(stock_id uuid, qte_pleine_apres int, qte_vide_apres int, motif text) RETURNS uuid` — wrapper transactionnel : INSERT log + UPDATE stock + émission alerte M11 si écart significatif
- `tms.m10_declarer_passage_realise(passage_id uuid, date_realise_at timestamptz, nb_bacs_enleves int DEFAULT NULL, type_contenant_id uuid DEFAULT NULL, poids_total_kg numeric DEFAULT NULL, bsd_numero text DEFAULT NULL, bsd_url text DEFAULT NULL, commentaire text DEFAULT NULL) RETURNS void` — wrapper E5 V3 : UPDATE `statut = 'realise'`, `statut_realise_at = now()`, `verification_video_at = now()`, métadonnées BSD/poids. **Trigger `trg_m10_reset_total_pleins` se déclenche immédiatement sur la transition `statut: planifie → realise`** (R5.4 v3).
- `tms.m10_creer_passage_a_posteriori(date_realise_at timestamptz, flux text, type_contenant_id uuid DEFAULT NULL, nb_bacs_enleves int DEFAULT NULL, ops_user_id uuid, commentaire text DEFAULT NULL) RETURNS uuid` — wrapper E4 a posteriori (R5.8 v3) : INSERT atomique avec `statut='realise'` + `statut_realise_at = now()` + `verification_video_at = now()` directement. Reset stock immédiat via trigger. Retourne `id` passage.
- `tms.m10_declencher_collecte_veolia(date_prevue date, flux text, commentaire text) RETURNS uuid` — wrapper E6 : INSERT passage `planifie` `cree_par_action='bouton_declencher'`.
- `tms.m10_annuler_passage(passage_id uuid, motif_annulation text, motif_annulation_libre text DEFAULT NULL) RETURNS void` — wrapper E3/W10 : UPDATE `statut = 'annule'`, `motif_annulation`, `motif_annulation_libre`. RAISE EXCEPTION si statut d'origine `realise` (R5.7 v3 — annulation post-realise interdite).

> **Suppressions revue sobriété 2026-04-30 (2 fonctions)** :
> - `tms.m10_confirmer_passage_chauffeur` (corollaire A1)
> - `tms.m10_confirmer_passage_ops` (corollaire A2)

### 6. Triggers DB `tms.*` **(V3 sobre 2026-04-30)**

| Trigger | Événement | Action |
|---------|-----------|--------|
| `trg_m10_auto_increment_pleins` | `AFTER UPDATE` sur `tournees` (transition `OLD.statut <> 'terminee' AND NEW.statut = 'terminee'` AND `NEW.stock_entrepot_update_at IS NULL`) | W1 — fonction itère sur les `pesees` *(nom de table corrigé 2026-06-11 — ex-réf « pesees_brutes » inexistante)* rattachées aux `collectes_tms` de la tournée filtrées sur `flux IN ('biodechet','verre','dechet_residuel','emballage','carton')` (5 flux ZD). Si 0 pesées ZD → no-op. Sinon incrémente `stocks_bacs_entrepot.quantite_pleine`, décrémente `quantite_vide_disponible`, puis `UPDATE tournees SET stock_entrepot_update_at = now()` (idempotence) |
| `trg_m10_reset_total_pleins` **(V3 simplifié)** | `AFTER UPDATE` sur `passages_veolia` (transition `OLD.statut = 'planifie' AND NEW.statut = 'realise'`) | W3 / R5.4 v3 : reset total `quantite_pleine = 0` du couple `(flux, type_contenant_id)` du passage, restitue les pleins en `quantite_vide_disponible`, INSERT `recomptages_stocks_entrepot_log` motif `'reset_passage_veolia <id>'`, déclenche auto-résolution alertes M10 saturation + non-confirmation. Idempotent (transition mono-shot, RAISE EXCEPTION sur déconfirmation via `trg_m10_anti_deconfirmation`) |
| `trg_m10_anti_deconfirmation` **(V3 simplifié)** | `BEFORE UPDATE` sur `passages_veolia` (`OLD.statut = 'realise' AND NEW.statut <> 'realise'`) | R5.7 v3 — RAISE EXCEPTION 'Annulation/déconfirmation post-realise interdite. Correction via recomptage manuel E7 + nouveau passage si applicable' |
| `trg_m10_alerte_saturation` | `AFTER UPDATE` sur `stocks_bacs_entrepot.quantite_pleine` | W6 — émet `m10_bac_satur` criticité dynamique (warning si ≥85%, critical si > seuil_saturation_pleins ou ≥100%) |
| `trg_m10_alerte_annule_report` **(V3 fusionné)** | `AFTER UPDATE` sur `passages_veolia` (transition `OLD.statut = 'planifie' AND NEW.statut = 'annule'`) | W8/W10 — émet `m10_passage_reporte` si `motif_annulation = 'report'`, sinon `m10_passage_annule` (escalade critical si saturation simultanée) |
| `trg_m10_capacite_diminuee` | `AFTER UPDATE` sur `stocks_bacs_entrepot.capacite_max` | EC9 — émet `m10_capacite_max_diminuee_satur` si `quantite_pleine > new capacite_max` |
| `trg_m10_recomptage_log_append_only` | `BEFORE UPDATE OR DELETE` sur `recomptages_stocks_entrepot_log` | RAISE EXCEPTION sauf cron purge |

> **Suppressions revue sobriété 2026-04-30 (2 triggers)** :
> - Ancien `trg_m10_alerte_report` séparé (fusionné dans `trg_m10_alerte_annule_report` car statut `reporte` supprimé — D1/B2)
> - Ancien `trg_m10_alerte_annule` séparé (fusionné — corollaire B2)
> - Ancien `trg_m10_anti_annulation_realise` (V1) fusionné avec `trg_m10_anti_deconfirmation` V3 (devenu unique)

### 7. Crons pg_cron `m10_*` **(V3 sobre 2026-04-30)**

| Cron | Périodicité | Action |
|------|-------------|--------|
| `m10_alerte_non_confirme` | horaire | W7 V3 — scan `passages_veolia WHERE statut = 'planifie'`. Pour chaque passage : calcul `delta = date_prevue - now()` ; si `delta <= '24h' AND date_prevue >= now()::date - '1 day'` → émet `m10_passage_non_confirme` criticité `warning` ; si `date_prevue < now()::date - '1 day'` (passage prévu il y a > 1 jour, non déclaré) → émet `m10_passage_non_confirme` criticité `critical`. Plus de cron `m10_escalade_non_confirme` séparé pour les passages `realise` non confirmés (corollaire suppression dualité A2). |
| `m10_purger_recomptages` | mensuel (1er 4h) | Hard DELETE `recomptages_stocks_entrepot_log` > 3 ans |

> **Suppression revue sobriété 2026-04-30** : `m10_escalade_non_confirme` (cron quotidien escalade gradient J+1/J+3/J+7 + auto-confirmation J+7) supprimé entièrement (corollaires A3/A4).

### 8. Catalogue alertes `alertes_catalogue` — 7 codes M10 à seed (V3 sobre 2026-04-30)

Cf. §9 M10 pour la liste exhaustive (criticité, destinataires, auto-résolution). Migration initiale de seed à inclure dans le batch `alertes_catalogue` M11.

**Suppressions revue sobriété 2026-04-30 (5 codes)** :
- `m10_bac_remplissage_85` (fusion B3 dans `m10_bac_satur` criticité dynamique)
- `m10_passage_realise_non_confirme_j1` (corollaire A2/A4)
- `m10_passage_realise_non_confirme_j3` (corollaire A2/A4)
- `m10_passage_auto_confirmee_j7` (corollaire A3)
- `m10_chauffeur_signale_bacs_pleins` (corollaire A1)

Catalogue M10 : 12 codes → 7 codes.

---

## ⚠ Addendum 2026-04-23 (seconde salve) — Retournements prestataires/lieux + snapshot + concurrence

Issus de la seconde salve M01 2026-04-23 ([[06 - Fonctionnalités détaillées TMS/M01 - Réception ordres de collecte]]). 4 impacts structurants sur le data model TMS :

### 1. Prestataires : table unique `shared.prestataires` (D14)

La table `tms.prestataires` décrite ci-après **est migrée vers `shared.prestataires`** (cf. [[../01 - Cahier des charges App/04 - Data Model]] addendum seconde salve). Source de vérité unique, écriture TMS (M06), lecture cross-schema Plateforme.

- **Schéma `shared.prestataires`** — fusion des colonnes historiques `plateforme.prestataires_logistiques` + `tms.prestataires` :

| Colonne | Type | Contrainte | Origine | Description |
|---------|------|-----------|---------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | — | |
| `nom` | text | NOT NULL | 2 | Raison sociale |
| `code` | text | NOT NULL, UNIQUE | Plateforme | `strike`, `marathon`, `a_toutes`, `prestataire_xxx` |
| `type_prestation` | text[] | NOT NULL | 2 | `zd`, `ag` (un presta peut faire les 2) |
| `mode_integration` | enum | NOT NULL | Plateforme | `api` \| `email` \| `manuel` |
| `api_config` | jsonb | | Plateforme | Config endpoint, credentials ref |
| `siret` | text | UNIQUE | 2 | Nullable pour prestataires étrangers |
| `tva_intracom` | text | | Plateforme | |
| `adresse_siege` | jsonb | | 2 | `{rue, code_postal, ville, pays}` |
| `contact_operationnel` | jsonb | | TMS | `{nom, email, telephone}` — propagation M06 2026-04-24 |
| `contact_facturation` | jsonb | | TMS | `{nom, email, telephone}` — propagation M06 2026-04-24 |
| `rayon_intervention_km` | integer | | TMS | NULL pour Strike/Marathon/A Toutes! (couverture fixe), renseigné pour province |
| `coords_siege_lat` | numeric(9,6) | | TMS | M12 calcul distance haversine |
| `coords_siege_lng` | numeric(9,6) | | TMS | Idem |
| `integration_externe` | text | | TMS | `aucune` \| `everest` |
| `everest_client_id` | text | | TMS | NULL sauf `integration_externe=everest` |
| `statut` | text | NOT NULL, default `actif` | 2 | `actif` \| `suspendu` \| `archive` |
| `date_fin_contrat` | date | | TMS | Date d'archivage programmée (NULL sauf suspension 30j). Propagation M06 2026-04-24 |
| `has_portail_self_service` | boolean | NOT NULL, default false | TMS | true uniquement Strike, Marathon, A Toutes! V1 |
| `commentaire_interne` | text | | 2 | Notes Ops Savr |
| `created_at`, `updated_at` | timestamptz | NOT NULL | — | |
| `deleted_at` | timestamptz | | — | Soft delete audit |

Colonne "Origine" : 2 = colonne présente dans les deux schémas historiques, Plateforme = Plateforme uniquement, TMS = TMS uniquement.

- **FK cross-schema autorisées** : `plateforme.collectes.prestataire_logistique_id`, `plateforme.tournees.prestataire_logistique_id`, `plateforme.bordereaux_savr.prestataire_logistique_id`, `tms.collectes_tms.prestataire_id`, `tms.tournees.prestataire_id`, `tms.chauffeurs.prestataire_id`, `tms.vehicules.prestataire_id`, `tms.factures_prestataires.prestataire_id`, `tms.grilles_tarifaires_prestataires.prestataire_id` → tous pointent sur `shared.prestataires.id`.
- **Tables TMS supprimées** : `tms.prestataires` (colonnes `plateforme_prestataire_id`, `sync_occurred_at`, `sync_last_event_id` disparaissent — plus de sync bidirectionnelle, il n'y a plus qu'une table).
- **RLS `shared.prestataires`** : lecture ouverte aux deux `app_domain` (`plateforme` + `tms`) pour rôles Ops/Admin. Écriture réservée `app_domain='tms'` + rôles `admin_tms` / `ops_savr` (sur colonnes identité) / pas d'accès pour `manager_prestataire` et `chauffeur`. Détail §09.
- **Endpoint E4 `PATCH /prestataires/:id`** : **supprimé** (plus de sync). Webhook S2 `prestataire-upsert` : également supprimé.

### 2. Lieux : enrichissement logistique cross-schema (D16, Option C)

**Décision** : `plateforme.lieux` reste Plateforme. TMS enrichit 2 colonnes existantes via RLS cross-schema column-level sans endpoint API.

> ⚠ **Refonte 2026-04-28 (audit cohérence inter-CDC A2)** : décision révisée — fusion sur les colonnes existantes Plateforme `acces_details` + `acces_office` plutôt qu'ajout de 4 nouvelles colonnes. Suppression simultanée des contacts `lieux.contact_*` côté Plateforme (problème métier : un même lieu est utilisé par plusieurs traiteurs et les contacts dépendent du couple lieu × traiteur, pas du lieu seul). Les contacts terrain transitent désormais via le payload E1 (`contact_principal` + `contact_secours`, saisis par le traiteur à la programmation) et sont figés dans `tms.collectes_tms` lors de la création (cf. niveau 2 `collectes_tms` colonnes `contact_principal_*` + `contact_secours_*`).

Colonnes existantes `plateforme.lieux` étendues en RW TMS (spec maintenue côté §04 Plateforme) :

- `acces_details` (text, NULL) — fusion ex-`code_acces` + ex-`parking` addendum + contenu existant Plateforme (badge/code/interphone/gardien)
- `acces_office` (text, NULL) — fusion ex-`instructions_chauffeur` addendum + contenu existant Plateforme (accès office/cuisine/zone déchets)

**Colonnes addendum supprimées** (2026-04-28 — fusion mapping) : , , , .

**Policy RLS révisée** : `GRANT UPDATE (acces_details, acces_office) ON plateforme.lieux TO tms_logistics_writer` si `app_domain()='tms'` AND rôle IN (`admin_tms`, `ops_savr`). Toutes les autres colonnes deny write depuis TMS. Détail §09.

**Endpoint E5 `PATCH /lieux/:id`** : allégé, sert uniquement à notifier le TMS qu'un champ critique (adresse/coords) a changé côté Plateforme → alerte M02 "snapshot divergent" + bouton "Synchroniser snapshot".

### 3. `collectes_tms` : nouvelles colonnes M01 seconde salve

Ajouts à la table `tms.collectes_tms` décrite plus bas (Niveau 2) :

| Colonne | Type | Défaut | Utilité |
|---------|------|--------|---------|
| `coords_manquantes` | boolean | false | Flag absence coords GPS (déjà existant — rappel) |
| `re_confirmation_requise` | boolean | false | Flag modification post-acceptation (déjà existant — rappel) |
| `annulee_pendant_en_cours` | boolean | false | Annulation pendant vacation (déjà existant — rappel) |
| `lieu_snapshot` | jsonb | `'{}'::jsonb` | Photo figée du lieu au moment de la création de la collecte (D15) |
| `last_occurred_at` | timestamptz | `now()` | Horodatage du dernier event appliqué, sérialisation FIFO par skip out-of-order (D18) |

Les champs `sync_occurred_at` / `sync_last_event_id` génériques décrits en principes §72-78 sont **conservés** pour les autres tables synchronisées. Pour `collectes_tms`, `last_occurred_at` remplace la logique générique (même sémantique, nom explicite côté M01).

### 4. Suppression pré-affectation (D10)

Plus de champ `prestataire_id_pre_affecte` en payload webhook E1. Plus de workflow W7 M01. Les collectes arrivent toutes en `statut_dispatch='a_attribuer'`. Les règles d'attribution forte (ex : "client X = toujours Strike") vivent dans M12 TMS (paramétrable, M12 à spécifier).

---

## ⚠ Addendum architectural 2026-04-23 — 1 projet Supabase / 2 schémas

**Retournement de la décision antérieure "2 projets Supabase distincts"** suite à l'atelier tech avec le frère de Val 2026-04-23. Nouvelle architecture :

- **1 seul projet Supabase** (prod + dev distincts) hébergeant 3 schémas PostgreSQL :
  - `plateforme.*` — 27 tables Plateforme
  - **`tms.*`** — toutes les tables décrites dans ce document sont préfixées par ce schéma (ex: `tms.collectes_tms`, `tms.tournees`, `tms.chauffeurs`, etc.)
  - `shared.*` — table `fichiers` référentiel multi-provider Supabase Storage + Cloudflare R2 (voir [[../01 - Cahier des charges App/04 - Data Model#Table shared fichiers]])
- **RLS cross-schema deny par défaut** : aucun rôle TMS (`ops_savr`, `admin_tms`, `manager_prestataire`, `chauffeur`) n'a accès en lecture/écriture à `plateforme.*` et inversement. Tests pgTAP bloquants CI valident le cloisonnement.
- **Users disjoints** : un chauffeur TMS ne peut jamais loguer sur la Plateforme, claim JWT `app_domain = 'tms'` enforced par middleware front + RLS deny DB.
- **FK cross-schema interdites** : les UUID Plateforme (`plateforme_collecte_id`, `plateforme_traiteur_id`, etc.) restent référencés sans contrainte. Cohérence maintenue par contrat API HMAC. **Seule exception** : FK vers `shared.fichiers.id` autorisée.
- **Stockage fichiers** : photos audit M05, PDFs factures prestataires OCR archivés, exports volumineux → **Cloudflare R2** via référentiel `shared.fichiers`. Docs chauffeurs légers (permis, visite médicale) restent sur Supabase Storage (RLS native + volume faible).

**Convention de lecture** : toutes les tables décrites ci-après sont implicitement préfixées par `tms.` dans le schéma réel (ex: `collectes_tms` = `tms.collectes_tms`). Les FK vers `shared.fichiers` sont la seule FK cross-schema autorisée.

### Table `tms.parametres_tms` — ajout kill switches atelier 2026-04-23

Extension du paramétrage existant `tms.parametres_tms` (clé/valeur namespace) avec 2 bools critiques pour coupure instantanée sans revert Git :

| Clé namespace `kill_switches` | Type | Description |
|---|---|---|
| `integration_plateforme_active` | bool | Coupe tous les webhooks sortants TMS → Plateforme et vice-versa. Utilisé si boucle infinie détectée ou clé HMAC compromise. |
| `ocr_factures_active` | bool | Coupe l'appel Mistral OCR, bascule sur saisie manuelle Ops. |

Modifiable par `admin_tms` depuis UI Admin (écran `parametres_tms`). Changement effectif en < 30 sec sans redéploiement.

---

## Principes généraux

### Isolation schémas Plateforme vs TMS (retournement atelier 2026-04-23)

 → **Un seul projet Supabase, deux schémas PostgreSQL distincts** (`plateforme.*` et `tms.*`) isolés par **RLS cross-schema deny**. Aucune jointure SQL cross-schemas autorisée au niveau applicatif. Les entités partagées (collecte, lieu, traiteur, prestataire) sont référencées **par UUID** côté TMS, sans contrainte de clé étrangère vers le schéma Plateforme.

**Conséquence** : le TMS ne peut jamais corrompre la Plateforme au niveau DB (RLS deny). Toute mutation cross-apps passe par le contrat API §08 (webhook HMAC + retry natif Plateforme ≤24h ; polling fallback supprimé Bloc A A4), même si la DB est physiquement la même.

### Source de vérité par entité

| Entité | Source vérité | Raison |
|--------|---------------|--------|
| `collectes` | Plateforme (création) → TMS (reflète, enrichit) | La collecte naît de l'événement côté Plateforme (M03 Plateforme) |
| `tournees` | TMS | Concept purement logistique, invisible au client |
| `vacations` | TMS | Unité de facturation prestataire (Strike 4h), privée |
| `prestataires` | TMS (données opérationnelles) + Plateforme (identité) | Identité last-write-wins, grille tarifaire TMS-only |
| `chauffeurs`, `vehicules`, `equipiers` | TMS uniquement | N'existent pas côté Plateforme |
| `pesees` | TMS (saisie chauffeur) → Plateforme (miroir pour facturation client) | TMS pousse à la pesée terrain (M05) |
| `incidents` | TMS | Remonté à la Plateforme via webhook pour alerting Ops Savr |
| `factures_prestataires` | TMS | Logistique pure, hors Plateforme |
| `stocks_rolls_traiteurs` | TMS | Calcul délégué au TMS, push snapshot Plateforme |
| `rolls_mouvements` | TMS | Audit trail des déclarations chauffeur |

### Conventions de nommage

- **Table** : pluriel snake_case (`chauffeurs`, `factures_prestataires`)
- **Primary key** : `id` uuid v4 généré côté base (`gen_random_uuid()`)
- **FK plateforme** : préfixe `plateforme_` (ex: `plateforme_collecte_id`, `plateforme_traiteur_id`, `plateforme_lieu_id`) — signale qu'il n'y a pas de contrainte de référence locale
- **FK interne TMS** : suffixe `_id` simple (ex: `prestataire_id`, `chauffeur_id`)
- **Timestamps** : `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()` (trigger auto)
- **Soft delete** : `deleted_at timestamptz NULL` sur entités à conserver pour audit (`chauffeurs`, `vehicules`, `prestataires`, `factures_prestataires`, `pesees`, `incidents`). Hard delete uniquement pour entités éphémères (`integrations_logs` > 2 ans, `integrations_inbox` > **7 jours** — revue sobriété §08 Bloc B 2026-05-01 B5, retour ex-30j post-B_M01_01).
- **Enums** : type PostgreSQL `CREATE TYPE` pour les statuts critiques, text libre pour le reste
- **JSON** : `jsonb` uniquement, jamais `json`. Indexer `->` si requête fréquente

### Clés d'idempotence et synchronisation

- Chaque entité synchronisée avec la Plateforme porte deux colonnes :
  - `sync_occurred_at timestamptz` : horodatage métier (source de vérité de l'ordre des events, voir §08)
  - `sync_last_event_id uuid` : dernier event_id appliqué (anti-replay)
- Lors d'un webhook entrant : si `new.occurred_at <= sync_occurred_at` → ignorer (out-of-order)
- La table `integrations_inbox` assure la dédup entrée (clé event_id, TTL **7 jours** — revue sobriété §08 Bloc B 2026-05-01 B5, retour ex-30j post-B_M01_01)

### RLS multi-tenant

RLS activée sur toutes les tables contenant des données prestataires. Principe : **un prestataire ne voit que ses propres données**. Détail en fin de document (section RLS).

- `users_tms.prestataire_id` détermine le périmètre visible
- Rôles cumulables (un manager prestataire peut aussi être chauffeur)
- Ops Savr et Admin TMS → policies `USING (true)` avec rôle `admin_tms` / `ops_savr`

### Immutabilité et audit

Toutes les mutations sur entités critiques (`pesees`, `collectes_tms`, `tournees`, `factures_prestataires`, `grilles_tarifaires_prestataires`) sont tracées dans **`tms.audit_logs`** (niveau 5) : `acteur_user_id`, `table_name`, `row_id`, `action`, `diff jsonb`, `created_at` *(noms de colonnes alignés sur la définition Niveau 5 — corrigé 2026-06-11)*. Rétention 5 ans (obligation Registre transport + BSD V2). **Canonique audit (2026-06-11, conforme ambiguïté A4 du DDL cible confirmée Val)** : 2 journaux d'audit dans le système — `plateforme.audit_log` (back-office App) et `tms.audit_logs` (logistique). **`shared.audit_logs` n'existe pas** (le schéma `shared` ne contient que `prestataires` + `fichiers`) ; toutes les ex-références ont été normalisées sur `tms.audit_logs`. Timeline unifiée App+TMS éventuelle = vue lecture `v_audit_global` (V2), jamais un point d'écriture commun.

### Conventions index

- Index btree par défaut sur FK
- Index partiels sur statuts actifs (ex: `WHERE deleted_at IS NULL`)
- Index GIN sur `jsonb` si requêtes par clé (ex: `grille_tarifaire->'zones'`)
- Index unique composites pour règles métier (ex: `UNIQUE (prestataire_id, chauffeur_id, date_debut) WHERE deleted_at IS NULL`)

---

## Niveau 1 — Identité et authentification

Source : M06 Référentiel prestataires + M13 Admin TMS + M05 app mobile chauffeur.

### Table : `prestataires` → migrée vers `shared.prestataires` (2026-04-23 seconde salve)

> ⚠ **Cette table est migrée vers `shared.prestataires`** (cf. addendum seconde salve en tête de document). Les colonnes ci-dessous servent de **base de référence** pour le schéma `shared.prestataires` (fusionné avec `plateforme.prestataires_logistiques`). Les colonnes `plateforme_prestataire_id`, `sync_occurred_at`, `sync_last_event_id` disparaissent — il n'y a plus qu'une seule table, donc plus de miroir ni de sync. Toutes les FK internes TMS (`chauffeurs.prestataire_id`, `vehicules.prestataire_id`, `collectes_tms.prestataire_id`, `tournees.prestataire_id`, `factures_prestataires.prestataire_id`, `grilles_tarifaires_prestataires.prestataire_id`, `users_tms.prestataire_id`) pointent désormais sur `shared.prestataires.id` (seule FK cross-schema autorisée avec `shared.fichiers`).

Référentiel des entreprises logistiques partenaires (Strike, Marathon, A Toutes! + ~30 prestataires province).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `plateforme_prestataire_id` | uuid | INDEX, UNIQUE, NOT NULL | Miroir `prestataires_logistiques.id` côté Plateforme |
| `nom` | text | NOT NULL | Raison sociale |
| `siret` | text | INDEX, UNIQUE | 14 chiffres, nullable pour prestataires étrangers futurs |
| `adresse_siege` | jsonb | | `{ rue, code_postal, ville, pays }` |
| `contact_operationnel` | jsonb | | `{ nom, email, telephone }` — contact ops quotidien (propagation M06 2026-04-24) |
| `contact_facturation` | jsonb | | `{ nom, email, telephone }` — contact facturation (peut être identique à opérationnel via copie physique côté UI M06) |
| `type_prestation` | text[] | NOT NULL | Enum values : `zd`, `ag` — un prestataire peut faire les 2 |
| `rayon_intervention_km` | integer | | NULL pour Strike/Marathon/A Toutes! (couverture fixe), renseigné pour province |
| `coords_siege_lat` | numeric(9,6) | | Pour M12 calcul distance haversine |
| `coords_siege_lng` | numeric(9,6) | | Idem |
| `integration_externe` | text | | Enum `aucune`, `everest` — `everest` = A Toutes! uniquement |
| `everest_client_id` | text | | NULL sauf si `integration_externe = everest` |
| `statut` | text | NOT NULL, default `actif` | Enum `actif`, `suspendu`, `archive` |
| `date_fin_contrat` | date | | Date d'archivage effective programmée (propagation M06 2026-04-24). NULL sauf pendant suspension 30j. Trigger cron journalier : passe `statut='archive'` quand `date_fin_contrat <= today` |
| `has_portail_self_service` | boolean | NOT NULL, default false | true uniquement pour Strike, Marathon, A Toutes! V1 |
| `commentaire_interne` | text | | Notes Ops Savr |
| `sync_occurred_at` | timestamptz | | Horodatage dernière sync Plateforme |
| `sync_last_event_id` | uuid | | Dernier event_id appliqué |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | Trigger auto |
| `deleted_at` | timestamptz | | Soft delete (audit) |

**Index** : `(plateforme_prestataire_id)` UNIQUE, `(siret)`, `(statut) WHERE deleted_at IS NULL`, `(has_portail_self_service)`, `(date_fin_contrat) WHERE statut = 'suspendu'` (pour trigger cron archivage J+30).

**Règle sync Plateforme** : **plus applicable depuis le retournement D14 seconde salve 2026-04-23**. Table unique `shared.prestataires`, écriture TMS uniquement (M06), lecture cross-schema Plateforme via RLS. Plus de sync, plus de miroir.

**Propagation M06 (2026-04-24)** :
- Retrait `contact_principal jsonb` → ajout `contact_operationnel jsonb` + `contact_facturation jsonb` (copie physique si toggle UI "Identique")
- Ajout `date_fin_contrat date` (déclencheur trigger cron archivage automatique J+30)

**Vue dérivée `tms.vue_prestataires_everest_status` (revue sobriété §04 2026-04-30 A3)** :

```sql
CREATE VIEW tms.vue_prestataires_everest_status AS
SELECT
  p.id AS prestataire_id,
  p.nom,
  p.everest_client_id,
  l.created_at AS last_everest_ping_at,
  CASE
    WHEN l.http_status BETWEEN 200 AND 299 THEN 'ok'
    WHEN l.http_status >= 400 OR l.statut = 'echec_final' THEN 'error'
    ELSE NULL
  END AS last_everest_ping_status
FROM shared.prestataires p
LEFT JOIN LATERAL (
  SELECT created_at, http_status, statut
  FROM tms.integrations_logs
  WHERE system = 'everest'
    AND type_event = 'm14_ping'
    AND payload->>'prestataire_id' = p.id::text
  ORDER BY created_at DESC
  LIMIT 1
) l ON true
WHERE p.integration_externe = 'everest';
```

Lecture par UI M06 fiche prestataire + M13 E6 santé API. Pas de cache : la vue lit `integrations_logs` à chaque ouverture (volume négligeable, 1 ping par test manuel).

**Note** : pas de RLS sur cette table (visible Ops Savr + Admin TMS). Les prestataires ne voient pas la table `prestataires` (ils ne la requêtent jamais — ils voient leurs propres données via `users_tms.prestataire_id`).

---

### Table : `users_tms`

Utilisateurs du TMS : Ops Savr, Admin TMS, Managers prestataires (Strike/Marathon/A Toutes!), Chauffeurs. Reliés à Supabase Auth (1:1 sur `auth.users.id`).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, FK `auth.users(id)` ON DELETE CASCADE | Alignement Supabase Auth |
| `email` | text | NOT NULL, UNIQUE | Login |
| `nom` | text | NOT NULL | |
| `prenom` | text | NOT NULL | |
| `telephone` | text | | E.164 format, utile SMS chauffeur |
| `roles` | text[] | NOT NULL | Values possibles : `ops_savr`, `admin_tms`, `manager_prestataire`, `chauffeur`. Cumul possible (ex: manager+chauffeur). Pas de rôle `equipier` — un équipier est un `chauffeurs` avec `peut_conduire = false`, sans compte users_tms V1 |
| `prestataire_id` | uuid | FK `prestataires(id)`, nullable | NULL pour Ops Savr/Admin TMS, renseigné pour manager/chauffeur |
| `chauffeur_id` | uuid | FK `chauffeurs(id)`, nullable | Renseigné si rôle `chauffeur` pour lier au profil opérationnel |
| `statut` | text | NOT NULL, default `actif` | Enum `actif`, `suspendu`, `archive` |
| `derniere_connexion_at` | timestamptz | | Mise à jour trigger Supabase Auth |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |
| `deleted_at` | timestamptz | | Soft delete (audit RGPD) |
| `consentements` | jsonb | nullable | **RGPD géoloc — trace de l'acceptation de la notice d'information à l'inscription (propagation Bloc 3 2026-06-04).** Structure : `{ "geoloc_notice": { "acknowledged_at": timestamptz, "version_notice": text, "ip": inet } }`. NULL tant que la notice n'a pas été acquittée. **Base légale géoloc = intérêt légitime** (pas consentement — position CNIL géoloc salariés). Écran d'information bloquant à la 1ère connexion PWA chauffeur (cf. §12 D6 + §15.4.1) ; ré-affichage bloquant uniquement si `version_notice` change matériellement. Pas de révocation ni d'écran permanent in-app V1. |

**Index** : `(prestataire_id) WHERE deleted_at IS NULL`, `(email)` UNIQUE, GIN `(roles)`.

**Contrainte métier (CHECK)** : si `'chauffeur' = ANY(roles)` alors `chauffeur_id IS NOT NULL`. Si `'manager_prestataire' = ANY(roles)` ou `'chauffeur' = ANY(roles)` alors `prestataire_id IS NOT NULL`.

**RLS** :
- Ops Savr / Admin TMS → voient tout
- Manager prestataire → voit les `users_tms` de son `prestataire_id` uniquement
- Chauffeur → voit son propre profil uniquement (`auth.uid() = id`)

---

### Table : `chauffeurs`

Profil opérationnel du chauffeur ou équipier (distinct de `users_tms` pour permettre le cumul manager+chauffeur et pour représenter un chauffeur/équipier sans compte actif — cas MTS-1 legacy + vacataires ponctuels).

Le flag `peut_conduire` distingue les chauffeurs (true) des équipiers purs Strike (false, pas de permis obligatoire, facturés +125€/4h).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `prestataire_id` | uuid | FK `prestataires(id)`, NOT NULL | |
| `user_tms_id` | uuid | FK `users_tms(id)`, UNIQUE, nullable | NULL si pas de compte actif (saisi par manager, chauffeur legacy, vacataire) |
| `nom` | text | NOT NULL | |
| `prenom` | text | NOT NULL | |
| `telephone` | text | NOT NULL | Utilisé pour SMS dispatch + contact lieu |
| `email` | text | | Nullable — pas tous les chauffeurs/équipiers ont un email |
| `peut_conduire` | boolean | NOT NULL, default true | true = chauffeur (permis requis), false = équipier Strike |
| `numero_permis` | text | | Stocké chiffré (pgcrypto). NULL attendu si `peut_conduire = false` |
| `date_fin_validite_permis` | date | | Alerte M11 à J-30. NULL attendu si `peut_conduire = false` |
| `permis_url` | text | | Path Supabase Storage, bucket `chauffeurs-documents` |
| `piece_identite_url` | text | | Idem, RGPD suppression sur demande (M06) |
| `vehicule_prefere_id` | uuid | FK `vehicules(id)`, nullable | Pré-sélection UI dispatch (chauffeurs uniquement) |
| `zones_preferees` | text[] | | Codes postaux ou zones A Toutes! (ex: `['75001', '75002', 'zone1']`) |
| `statut` | text | NOT NULL, default `actif` | Enum `actif`, `suspendu`, `archive` |
| `commentaire_interne` | text | | Notes manager |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |
| `deleted_at` | timestamptz | | Soft delete RGPD (5 ans post-suppression manager) |

**Index** : `(prestataire_id) WHERE deleted_at IS NULL`, `(telephone)`, `(user_tms_id)` UNIQUE, `(peut_conduire)`. retiré V1 (pas d'alerte échéance V1, propagation M06 2026-04-24).

**RLS** :
- Ops Savr / Admin TMS → tout
- Manager prestataire → `prestataire_id = current_user.prestataire_id`
- Chauffeur → son propre record uniquement (`user_tms_id = auth.uid()`)

**Décision RGPD** : `numero_permis` et `piece_identite_url` supprimables sur demande prestataire sans supprimer la ligne (set NULL + log audit). Conservation 5 ans pour traçabilité Registre transport.

**Contrainte métier (CHECK)** : si `peut_conduire = true` alors `numero_permis IS NOT NULL AND date_fin_validite_permis IS NOT NULL` au moment de l'affectation à une tournée (vérifié applicativement au dispatch M02, pas au DB level pour permettre la saisie progressive).

---

### Table : `types_vehicules`

Référentiel des types de véhicules utilisables dans le TMS. Paramétrable par Ops Savr (M13 Admin TMS) pour accueillir de nouveaux types sans migration. **Refonte 2026-05-08** : ajout colonne `categorie_plateforme` pour mapping vers l'enum véhicule unifié Plateforme (cf. `[[../01 - Cahier des charges App/05 - Règles métier#R_compatibilite_vehicule_lieu]]`).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `code` | text | NOT NULL, UNIQUE | Slug stable utilisé en code + API (ex: `camion_20m3_hayon`, `camion_16m3`, `camion_6m3`, `velo_cargo_frigo` — cf. seed M03 2026-04-24) |
| `libelle` | text | NOT NULL | Affichage UI (ex: "Camion 20m³ hayon", "Camion 16m³", "Camion 6m³", "Vélo cargo frigo") |
| `categorie` | text | NOT NULL | Enum `camion`, `fourgon`, `velo`, `autre` — utilisé pour filtres et règles M12 internes TMS |
| `categorie_plateforme` | enum | NOT NULL | **Ajout 2026-05-08** — Mapping vers l'enum véhicule unifié Plateforme (`velo_cargo` / `camionnette` / `fourgon` / `vul` / `poids_lourd`). Source unique de vérité pour la **compatibilité véhicule TMS ↔ `plateforme.lieux.type_vehicule_max`** (cf. `R_M04.COMPATIBILITE_VEHICULE_LIEU` §05 TMS + `R_compatibilite_vehicule_lieu` §05 Plateforme). **Hiérarchie ordonnée** : `velo_cargo (1) < camionnette (2) < fourgon (3) < vul (4) < poids_lourd (5)`. À renseigner obligatoirement par Ops/Manager à la création (cf. M03 + M13). Override possible Ops via UPDATE direct si reclassification nécessaire (audit_log). |
| `volume_m3_standard` | numeric(5,2) | | Indicatif, override possible au niveau `vehicules.volume_m3` |
| `co2_g_par_km_standard` | integer | | Indicatif, override possible au niveau `vehicules` |
| `frigorifique` | boolean | NOT NULL, default `false` | **M03 2026-04-24** — Équipement frigo. Utilisé M12 pour matching flux périssables |
| `hayon` | boolean | NOT NULL, default `false` | **M03 2026-04-24** — Hayon élévateur. Utilisé M04 dispatch si lieu a quai bas |
| `valide_ops` | boolean | NOT NULL, default `true` | **M03 2026-04-24** — `false` si créé par manager en attente revue Ops. Utilisable immédiatement, flag informatif |
| `cree_par` | uuid | FK `users_tms(id)`, nullable | **M03 2026-04-24** — NULL pour seed. Pointe user créateur (manager/ops/admin) |
| `ordre_affichage` | integer | NOT NULL, default 100 | Tri listes déroulantes |
| `statut` | text | NOT NULL, default `actif` | `actif`, `archive` |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |

**Index** : `(code)` UNIQUE, `(statut, ordre_affichage)`, `(valide_ops) WHERE valide_ops = false` (scan types à revoir Ops — M03 2026-04-24), `(categorie_plateforme)` *(ajout 2026-05-08, sert vue cross-schema)*.

**Seed V1** (4 types, révisé M03 2026-04-24 + ajout `categorie_plateforme` 2026-05-08) :
- `camion_20m3_hayon` / "Camion 20m³ hayon" / `camion` / **`poids_lourd`** / volume 20 / hayon=true / frigo=false
- `camion_16m3` / "Camion 16m³" / `camion` / **`vul`** / volume 16 / hayon=false / frigo=false
- `camion_6m3` / "Camion 6m³" / `camion` / **`fourgon`** / volume 6 / hayon=false / frigo=false
- `velo_cargo_frigo` / "Vélo cargo frigo" / `velo` / **`velo_cargo`** / volume 1.5 / hayon=false / frigo=true

Tous seedés avec `valide_ops=true`, `cree_par=NULL`, `statut='actif'`.

**RLS** (révisée M03 2026-04-24) : lecture seule pour tous les `users_tms` authentifiés. Écriture (INSERT) autorisée pour **Ops Savr, Admin TMS et Manager prestataire** (D11 M03). Manager crée avec `valide_ops=false` forcé par RLS policy. UPDATE `valide_ops=true` + `statut='archive'` réservés Ops/Admin. Merge via `tms.merger_type_vehicule()` réservé Ops/Admin. **`categorie_plateforme` éditable Ops/Admin uniquement** (manager peut la renseigner à la création mais pas la modifier ensuite — cohérence D11 M03 mais sécurité algo Plateforme).

**Note** : Ops Savr peut ajouter un type (ex: "Camion 3,5T" pour un prestataire province) sans redéploiement. Manager peut aussi créer (cohérence D11 M03), validation Ops différée. Le `code` est immuable une fois créé (pour ne pas casser les références historiques). Doublons tolérés V1 + merge via fonction SQL dédiée.

**Vue cross-schema `plateforme.v_tms_types_vehicules_categories`** *(ajout 2026-05-08)* — exposée à la Plateforme pour permettre la validation tournée TMS contre `lieux.type_vehicule_max` :

```sql
CREATE VIEW plateforme.v_tms_types_vehicules_categories AS
SELECT
  id AS type_vehicule_id,
  code,
  libelle,
  categorie_plateforme,
  statut
FROM tms.types_vehicules
WHERE statut = 'actif';

GRANT SELECT ON plateforme.v_tms_types_vehicules_categories
  TO admin_savr_role, ops_savr_role;
```

**Usage** : la Plateforme (Bloc 0 Attribution Prestataire §06 §3 Back-office Admin) peut joindre `v_tms_types_vehicules_categories` à une `plateforme.tournees` (via `tournees.type_vehicule_tms_id` cross-schema FK potentielle V2 — V1 le mapping reste local côté TMS via `tms.tournees.type_vehicule_id`) pour afficher la catégorie Plateforme du véhicule planifié et alerter l'Ops si incompatibilité avec `lieux.type_vehicule_max`.

---

### Table : `vehicules`

Parc des prestataires (camions Strike, camion Marathon, vélos-cargo A Toutes!, camion A Toutes! ID 91, flotte prestataires province).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `prestataire_id` | uuid | FK `prestataires(id)`, NOT NULL | |
| `type_vehicule_id` | uuid | FK `types_vehicules(id)`, NOT NULL | Référence le référentiel paramétrable |
| `plaque` | text | NOT NULL | Format `AA-123-BB`. Plaque du véhicule stockée au référentiel (saisie manager M06). Sert à la pré-saisie manager M03 E4 (contrôle d'accès). **(saisie chauffeur retirée V1, propagation 2026-06-04)**. Pour vélo cargo : identifiant véhicule interne prestataire |
| `plaque_canonique` | text | GENERATED, UNIQUE | `regexp_replace(upper(plaque), '[^A-Z0-9]', '', 'g')` — évite doublons sur format |
| `volume_m3` | numeric(5,2) | | Override du `volume_m3_standard` du type. Utile pour M12 attribution transporteur |
| `co2_g_par_km` | integer | | Override du standard type. Pour impact RSE M11 |
| `statut` | text | NOT NULL, default `actif` | `actif`, `maintenance`, `archive` |
| `commentaire_interne` | text | | |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |
| `deleted_at` | timestamptz | | |

**Index** : `(prestataire_id) WHERE deleted_at IS NULL`, `(plaque_canonique)` UNIQUE WHERE `deleted_at IS NULL`, `(type_vehicule_id)`. retiré V1 (propagation M06 2026-04-24).

**RLS** : mêmes policies que `chauffeurs`.

**Note sur la plaque (révisée propagation suppression saisie plaque terrain 2026-06-04)** : saisie au référentiel (M06 par le manager) et pré-saisie au niveau tournée par le **manager** en M03 E4 (`tournees.plaque_preassignee_manager`) lorsqu'une collecte exige `controle_acces_requis`. Cette pré-saisie manager déclenche le webhook S7 `plaque-saisie` vers la Plateforme (alimente le bloc Contrôle d'accès traiteur + registre transport M08). **retirée V1 (arbitrage Val 2026-06-04)**. La saisie référentiel sert au dispatch (affichage liste véhicules disponibles) et à l'auto-complete de la pré-saisie manager.

---

---

## Niveau 2 — Opérationnel

Cœur métier du TMS. Sources : M01 Réception ordres, M02 Dispatch, M04 Gestion tournées, M05 App mobile, M07 Pilotage financier, M09 Stock matériel, M11 Alerting.

### Table : `collectes_tms`

Miroir enrichi des collectes côté TMS (Option A validée : duplication champs métier utiles pour autonomie TMS si Plateforme indisponible).

> ⚠ **Addendum seconde salve 2026-04-23 M01** : ajout de 2 colonnes opérationnelles (`lieu_snapshot` JSONB photo figée, `last_occurred_at` timestamptz sérialisation out-of-order). Plus de `prestataire_id_pre_affecte` (pré-affectation Plateforme supprimée). La colonne `prestataire_id` pointe désormais sur `shared.prestataires(id)` (cf. retournement D14).
>
> ⚠ **Addendum sobriété M01 2026-04-30** : colonne `attribuee_source` retirée définitivement V1 (B_M01_04 + D_M01_03) — auto-relance M12 W3 supprimée donc enum mort. À ne pas créer.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | ID interne TMS |
| `plateforme_collecte_id` | uuid | UNIQUE partielle (`WHERE plateforme_collecte_id IS NOT NULL`), nullable | Miroir `collectes.id` Plateforme. **Nullable depuis 2026-06-05 (collecte manuelle Admin TMS, M02 §7.3)** : `NULL` = collecte créée à la main pendant une panne Plateforme (front/webhook down), en attente de réconciliation M13. L'unicité reste garantie pour les valeurs non nulles via un index unique partiel. |
| `plateforme_evenement_id` | uuid | nullable | Miroir `evenements.id` Plateforme. **Nullable depuis 2026-06-05** — idem `plateforme_collecte_id` (`NULL` pour une collecte manuelle, rempli à la réconciliation M13). |
| `origine` | text | NOT NULL, default `webhook_e1` | **Ajout 2026-06-05 (M02 §7.3 collecte manuelle)** — Enum 2 valeurs : `webhook_e1` (réception normale via E1) / `manuelle_tms` (créée par Admin TMS pendant une panne Plateforme — `plateforme_collecte_id`/`plateforme_evenement_id` `NULL` jusqu'à la réconciliation M13 orphelines, QO#10 M02). |
| `plateforme_traiteur_id` | uuid | NOT NULL | Miroir `organisations.id` Plateforme — **précisé 2026-05-07 : pointe sur le traiteur opérationnel** (`evenements.traiteur_operationnel_organisation_id`). Producteur juridique du déchet, possiblement fiche shadow. |
| `plateforme_programmateur_id` | uuid | NOT NULL | **Ajout 2026-05-07** — Miroir `evenements.organisation_id` Plateforme. Donneur d'ordre (qui paye Savr). Peut être de type `traiteur`, `agence` ou `gestionnaire_lieux`. Si `plateforme_programmateur_id = plateforme_traiteur_id` → cas classique (traiteur=programmateur). Sinon → collecte programmée par tiers, info UX uniquement, aucun impact dispatch ni attribution. |
| `programmateur_nom` | text | NOT NULL | **Ajout 2026-05-07** — Recopie pour affichage. |
| `programmateur_type` | text | NOT NULL | **Ajout 2026-05-07** — Enum `traiteur` / `agence` / `gestionnaire_lieux`. Sert à l'affichage M01 réception et M03 dispatch ("Programmée par {{programmateur_nom}}, agence" si différent du traiteur opérationnel). |
| `traiteur_est_shadow` | boolean | NOT NULL DEFAULT false | **Ajout 2026-05-07** — `true` si le traiteur opérationnel est une fiche shadow Plateforme (`organisations.est_shadow=true`). Aucun impact opérationnel TMS, info UX uniquement (badge "Hors référentiel" sur fiche collecte M01/M03). |
| `plateforme_lieu_id` | uuid | NOT NULL | Miroir `lieux.id` Plateforme |
| `traiteur_nom` | text | NOT NULL | Recopie pour affichage (évite appel API Plateforme). Snapshot du traiteur opérationnel. |
| `lieu_adresse` | jsonb | NOT NULL | `{ rue, code_postal, ville, lat, lng }` |
| `parcours` | text | NOT NULL | Enum `zd`, `ag` |
| `heure_collecte` | timestamptz | NOT NULL | **Propagation 2026-04-29** — heure d'arrivée souhaitée du prestataire (point fixe V1, pas de fenêtre). Source : `plateforme.collectes.heure_collecte` figé via E1. Remplace l'ancien couple `creneau_debut` / `creneau_fin`. V2 : option fenêtre dérivée via tampon paramétrable. |
| `nb_pax` | integer | | Pax événement, utilisé M09 rolls + M12 attribution + alerte pesées/pax. **Affiché ZD ET AG en M05 E5 Bloc 1 (propagation revue sobriété M05 2026-04-29)** — utile au chauffeur dans les deux parcours pour anticiper le volume. |
| `contenants_prevus` | jsonb | | `[{ type_contenant, quantite }]` — Ex ZD : `[{"type":"roll_240L","qty":4},{"type":"bac_1100L","qty":1}]` |
| `statut_dispatch` | text | NOT NULL, default `a_attribuer` | Enum 6 valeurs : `a_attribuer`, `attribuee_en_attente_acceptation`, `acceptee`, `en_attente_execution`, `rejetee_par_prestataire`, `annulee_par_traiteur` (propagation A1 2026-04-25 — alignement vocabulaire M03) |
| `prestataire_id` | uuid | FK `shared.prestataires(id)`, nullable | Renseigné à partir de `statut_dispatch = attribuee_en_attente_acceptation`. Cross-schema (seule FK autorisée avec `shared.fichiers`) |
| | | | **Déplacé sur `collecte_tournees.ordre_dans_tournee` (propagation multi-camions 2026-05-25)** — avec N↔N, une collecte a un ordre **par tournée**, donc l'ordre est porté par la ligne de liaison (cf. table `collecte_tournees`). Sémantique inchangée (séquence 1, 2, 3... initialisée au dispatch, réordonnançable Ops via flèches ▲▼ E3 tant que `tournees.statut = 'planifiee'`, base du calcul Haversine). |
| `date_attribution` | timestamptz | | Horodatage passage à `attribuee_en_attente_acceptation` |
| `date_acceptation` | timestamptz | | Horodatage passage à `acceptee` (manager a cliqué accepter) |
| `date_assignation_execution` | timestamptz | | Horodatage passage à `en_attente_execution` (chauffeur+véhicule assignés) — propagation A1 2026-04-25 |
| `date_refus` | timestamptz | | Idem `rejetee_par_prestataire` |
| `motif_refus` | text | | Si `rejetee_par_prestataire` |
| `statut_operationnel` | text | NOT NULL, default `planifiee` | Enum `planifiee`, `en_cours`, `realisee`, `realisee_sans_collecte`, `incident`, `annulee` |
| `aucun_repas_motif` | text | | Si `realisee_sans_collecte` (AG only) — motif chauffeur |
| `aucun_repas_photo_url` | text | | Si `realisee_sans_collecte` — path Storage photo lieu |
| `date_debut_reelle` | timestamptz | | Heure d'arrivée chauffeur sur site |
| `date_fin_reelle` | timestamptz | | Heure de départ chauffeur du site (hors trajet entrepôt) |
| `arrivee_gps` | jsonb | nullable | **Ajout 2026-06-11 (audit data model — colonne fantôme régularisée)** — Position GPS capturée au « J'arrive » chauffeur M05 (géofence 300 m, R_M05). Format `{lat, lng, accuracy_m, captured_at}`. Référencée par la purge RGPD 30 j (addendum M05 §6) sans avoir jamais été définie. NULL si fallback manuel sans GPS (`M05_ARRIVEE_GEOLOC_FALLBACK`). Purge : set NULL à J+30 (cron RGPD). |
| `depart_gps` | jsonb | nullable | **Ajout 2026-06-11 (idem)** — Position GPS au départ du site M05. Même format, même purge RGPD 30 j. |
| `coords_manquantes` | boolean | NOT NULL, default false | M01 D9 — flag absence coords GPS |
| `re_confirmation_requise` | boolean | NOT NULL, default false | M01 D6 — flag modification post-acceptation |
| `annulee_pendant_en_cours` | boolean | NOT NULL, default false | M01 D8 — annulation pendant vacation |
| `lieu_snapshot` | jsonb | NOT NULL, default `'{}'::jsonb` | **M01 D15 (seconde salve 2026-04-23, refonte composition 2026-04-28 audit cohérence A2, sobriété A_M01_05 2026-04-30)** — photo figée du lieu à la création. Composition révisée 2026-04-28 : `{adresse, coords, acces_details, acces_office, stationnement, contraintes_horaires, type_vehicule_max, volume_max_bacs}`. Les contacts ne sont **PAS** dans le snapshot (relogés sur colonnes dédiées `contact_principal_*` + `contact_secours_*` ci-dessous, transmises via payload E1). **Override ponctuel par collecte uniquement** (drawer M02). — action rare avec impact N collectes simultané, retirée V1 (override ponctuel couvre 99% des besoins). |
| `contact_principal_nom` | text | NOT NULL | **Propagation A2 audit cohérence 2026-04-28** — contact terrain principal saisi par le traiteur à la programmation (`evenements.contact_principal_nom` Plateforme), figé dans la collecte au moment de la création TMS via E1. Dépend du couple lieu × traiteur (mutualisation lieux). **S'applique ZD ET AG (propagation revue sobriété M05 2026-04-29)** — affiché chauffeur en M05 E5 Bloc 1 dans les deux parcours. |
| `contact_principal_telephone` | text | NOT NULL | **Propagation A2 audit cohérence 2026-04-28** — numéro joignable jour J. Format E.164 recommandé. **S'applique ZD ET AG (propagation revue sobriété M05 2026-04-29).** |
| `contact_secours_nom` | text | nullable | **Propagation A2 audit cohérence 2026-04-28** — contact de secours si principal injoignable. Optionnel. **S'applique ZD ET AG (propagation revue sobriété M05 2026-04-29).** |
| `contact_secours_telephone` | text | nullable | **Propagation A2 audit cohérence 2026-04-28** — numéro de secours. Format E.164 recommandé. **S'applique ZD ET AG (propagation revue sobriété M05 2026-04-29).** |
| `last_occurred_at` | timestamptz | NOT NULL, default `now()` | **M01 D18 (seconde salve 2026-04-23)** — horodatage du dernier event appliqué. Skip out-of-order si event entrant `occurred_at ≤ last_occurred_at` |
| `controle_acces_requis` | boolean | NOT NULL, default `false` | **M03 2026-04-24 (D8) — restauré 2026-05-01 — renommé 2026-05-03 (refonte formulaire §06.01 Plateforme : flag unique plaque + nom chauffeur)** — miroir `plateforme.collectes.controle_acces_requis` reçu via E1 (ex `plaque_requise`). Le traiteur demande la plaque ET le nom du chauffeur pour contrôle d'accès site (sites Viparis, sécurisés) → manager prestataire **doit** pré-saisir les deux en M03 E4 (plaque saisie sur la tournée + chauffeur affecté via `tournees.chauffeur_id`) → trigger `validate_tournee_controle_acces` (ex `validate_tournee_plaque_requise`) bloque validation tournée si une collecte de la tournée a `controle_acces_requis=true` ET (`tournees.plaque_preassignee_manager IS NULL` OU `tournees.chauffeur_id IS NULL`) (R_M03.4 + R_M04.CONTROLE_ACCES). **Exception A Toutes! vélo cargo** : trigger autorise validation tournée même si `controle_acces_requis=true`, manager vélo cargo n'a pas de plaque à saisir (cas remonté au formulaire programmation Plateforme via message UX "Vélo cargo — pas de plaque possible"). Le nom chauffeur reste requis dans tous les cas si `controle_acces_requis=true`. |
| `informations_supplementaires` | text | nullable, max 1000 car. | **Ajout 2026-05-06 (refonte formulaire §06.01 §2.a Plateforme)** — miroir `plateforme.collectes.informations_supplementaires` reçu via E1. Texte libre saisi par le programmeur (ex: "Sonner interphone B au RDC", "Quai N°2 fermé le lundi"). Affiché côté TMS en M01 (réception manager prestataire), M03 (dispatch), M05 (tournée chauffeur app mobile). Patchable via E2 (push silencieux, pas de réacceptation). |
| `association_snapshot` | jsonb | nullable (AG uniquement) | **Ajout 2026-05-29 (arbitrage Val — intégration association au flux V2)** — destination de livraison des excédents pour une collecte **AG**. Photo figée de l'association bénéficiaire attribuée + validée côté Plateforme (algo §06.09 + validation Admin), reçue via **E2** lors de la cascade `attribution_validee` (V2). Composition : `{association_id, nom, adresse, code_postal, ville, coordonnees_gps {lat,lng}, contact {nom, telephone}, horaires_ouverture}`. NULL pour les collectes ZD (pas de don) et tant que l'attribution AG n'a pas été validée. **Affiché chauffeur en M05 E7** (pré-rempli, lecture par défaut, override libre possible si refus/réorientation terrain). En cas de ré-attribution association (refus asso côté Plateforme), nouvel E2 → snapshot mis à jour. Push silencieux côté M01 (pas de réacceptation transporteur — la destination de livraison n'affecte pas l'acceptation de la course). |
| | | | **Déplacé sur `collecte_tournees.cout_reparti_centimes` (propagation multi-camions 2026-05-25)** — avec N↔N, une collecte reçoit une quote-part **par tournée** qui la sert (1 camion mutualisé OU N camions sur une grosse collecte). Le coût total logistique d'une collecte = `SUM(collecte_tournees.cout_reparti_centimes)` sur ses tournées. La répartition par tournée (`FLOOR(cout_ht × 100 / nb_collectes_de_la_tournée)`, dernière collecte = reste) reste calculée par `trg_m07_calc_cost`, mais écrite sur la ligne de liaison. Sert au M08 rapprochement par collecte (détail par camion conservé). |
| `sync_last_event_id` | uuid | | Anti-replay |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |

**Index** : `(plateforme_collecte_id)` UNIQUE, `(prestataire_id, statut_dispatch) WHERE statut_dispatch IN ('attribuee_en_attente_acceptation','acceptee','en_attente_execution')` (propagation A1 2026-04-25), **retirés multi-camions 2026-05-25** (lien + ordre migrés sur `collecte_tournees`, index correspondants portés par la liaison), `(heure_collecte)` (propagation 2026-04-29 — renommé depuis `creneau_debut`), `(statut_operationnel)`, `(parcours)`. retiré V1 (revue sobriété §04 2026-04-30 A6 — colonne supprimée, lookup via `everest_missions.collecte_tms_id`).

**Note** : pas de `deleted_at` — une collecte annulée passe à `statut_operationnel = annulee`, jamais supprimée (audit).

**RLS** : Ops Savr / Admin TMS → tout. Manager prestataire → collectes où `prestataire_id = current_user.prestataire_id`. Chauffeur → collectes liées (via `collecte_tournees`) à une tournée dont il est chauffeur/équipier *(propagation multi-camions 2026-05-25 — jointure via la liaison au lieu de `collectes_tms.tournee_id` retiré : `EXISTS (SELECT 1 FROM tms.collecte_tournees ct JOIN tms.tournees t ON t.id = ct.tournee_id WHERE ct.collecte_tms_id = collectes_tms.id AND (t.chauffeur_id = current_user.chauffeur_id OR t.equipier_id = current_user.chauffeur_id))`)*.

---

### Table : `tournees`

Regroupement logistique : 1 tournée = 1 camion. Relation **N↔N avec `collectes_tms`** via la table de liaison `tms.collecte_tournees` *(refonte multi-camions 2026-05-25)* : une tournée sert N collectes (mutualisation, même créneau + même zone) ET une collecte peut être servie par N tournées (multi-camions, gros volume découpé sur plusieurs camions). 1 tournée = 1 vacation (cf. §03 M04 notion Strike). Chaque tournée garde son propre chauffeur, véhicule, type de véhicule et plaque — les N camions d'une grosse collecte peuvent donc être de **types différents**.

**Exposition cross-schema (revue sobriété §08 Bloc A 2026-05-01 A2 — contrat de colonnes figé audit cohérence 2026-05-26)** : cette table est lue par la Plateforme via vue `plateforme.v_courses_logistiques`. **Définition canonique = `CREATE VIEW` [[08 - Contrat API Plateforme-TMS#S3 — `POST /webhooks/tms/tournee-upsert`\|§08]]** (convention € HT decimal, grain 1 ligne par couple collecte×tournée via JOIN `tms.collecte_tournees`). Colonnes exposées : `id AS tournee_id` (non unique), `prestataire_id`, `cout_final_ht` (€ HT), `cout_ajuste` (**dérivé** `statut_financier='ajuste'`), `push_s6_version AS version_paiement` *(lu pour reporting "marge ajustée", pas pour push)*, `duree_reelle_minutes`, `snapshot_cout_detail` (**jsonb whitelisté construit par la vue**), `collecte_tms_id AS collecte_id` (via liaison), `cout_reparti_ht` (= `collecte_tournees.cout_reparti_centimes / 100`, € HT). **Colonnes sensibles non exposées** : `grille_tarifaire_id`, `cout_detail` brut *(contient `grille_snapshot` — audit 2026-05-26 A3)*, jointure vers `grilles_tarifaires_prestataires`, `formules_tarifaires`, `cellules_grille` (RLS deny). **N'existent PAS sur la table** (donc jamais exposées) : `cout_total_centimes`, `repartition_methode`. Plus de webhook S6 push, plus d'UPSERT idempotent côté Plateforme — trigger DB cross-schema synchrone `plateforme.fn_recalc_marge_tournee()` recalcule la marge sur UPDATE de `cout_final_ht` ou `push_s6_version`.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `plateforme_tournee_id` | uuid | UNIQUE, nullable | Miroir côté Plateforme. Créé par push TMS → Plateforme via webhook `tournee-upsert` |
| `prestataire_id` | uuid | FK `prestataires(id)`, NOT NULL | |
| `chauffeur_id` | uuid | FK `chauffeurs(id)`, nullable | Affecté au dispatch. Nullable avant dispatch. |
| `equipier_id` | uuid | FK `chauffeurs(id)`, nullable | Chauffeur avec `peut_conduire=false` ou autre chauffeur (Strike équipier). NULL si tournée solo |
| `vehicule_id` | uuid | FK `vehicules(id)`, nullable | Véhicule prévu de la tournée |
| `plaque_preassignee_manager` | text | nullable | **Propagation M03 2026-04-24 — restauré 2026-05-01 — renommage trigger 2026-05-03 (refonte formulaire §06.01 Plateforme)** : plaque saisie par le manager prestataire en M03 E4 quand au moins une collecte de la tournée a `controle_acces_requis=true` (ex `plaque_requise`). Déclenche webhook S7 `tms/plaque-saisie` vers Plateforme (payload enrichi 2026-05-03 : `plaque` + `chauffeur_nom` lus depuis cette colonne + jointure `chauffeurs.nom_complet` via `tournees.chauffeur_id`). Trigger `validate_tournee_controle_acces` (ex `validate_tournee_plaque_requise`, R_M03.4 + R_M04.CONTROLE_ACCES) bloque transition `tournees.statut → acceptee` si plaque OU chauffeur_id manquant (sauf exception A Toutes! vélo cargo : seul chauffeur_id requis). |
| `plaque_preassignee_par_user_id` | uuid | FK `users_tms(id)`, nullable | **Restauré 2026-05-01** — user manager prestataire ayant saisi la plaque (audit M03 E4). |
| `plaque_preassignee_at` | timestamptz | nullable | **Restauré 2026-05-01** — timestamp saisie plaque manager (= timestamp émission webhook S7). |
| `grille_tarifaire_id` | uuid | FK `grilles_tarifaires_prestataires(id)`, nullable | Détermine la formule M07. Dérivée au dispatch à partir de `(prestataire_id, vehicule.type_vehicule_id, date_planifiee)` avec matching sur `date_debut_validite/date_fin_validite`. Éditable par Ops pour overrides exceptionnels |
| `date_planifiee` | date | NOT NULL | Date du créneau |
| `heure_planifiee_debut` | timestamptz | | Début créneau |
| `heure_planifiee_fin` | timestamptz | | Fin créneau |
| `heure_reelle_debut` | timestamptz | | Timestamp chauffeur "démarrer la tournée" (M05) |
| `heure_reelle_fin` | timestamptz | | Timestamp chauffeur "terminer la tournée" (retour entrepôt pour ZD, dernière livraison pour AG) |
| `duree_reelle_minutes` | integer | GENERATED | `EXTRACT(EPOCH FROM (heure_reelle_fin - heure_reelle_debut)) / 60` — NULL si tournée non terminée |
| `nb_personnes_facturation` | integer | NOT NULL, default 1 | 1 = chauffeur seul, 2 = chauffeur + équipier (utilisé pour règle Strike prolongation) |
| `nb_unites_strike` | integer | | Calculé par M07 à la clôture : 1 si ≤4h, 1 si 4-6h, 2 si 6-8h, 2 si 8-10h, etc. (cf. règle Strike 2026-04-22) |
| `cout_calcule_ht` | numeric(10,2) | | Calculé par M07 à la clôture tournée. **Immuable post-clôture** (décision D1 M07 2026-04-24) — trigger BEFORE UPDATE bloque toute modification. Règle spécifique par `type_tournee` (cf. §03 M07) |
| `cout_detail` | jsonb | | Snapshot du calcul : `{ tarif_vacation_base, nb_unites, equipier_base, prolongation_euros, zones_appliquees, palier_applique, grille_snapshot, ... }` pour audit + debug |
| **Colonnes ajustement/figement M07 (simplifiées sobriété 2026-04-30)** | — | — | Voir addendum M07 2026-04-24 + revue 2026-04-30 en tête de doc : `cout_ajuste_ht`, `motif_ajustement`, `ajuste_par_user_id`, `ajuste_at`, `cout_final_ht` (mis à jour par trigger explicite, plus GENERATED), `cout_final_verrouille` (boolean unique), `verrouillee_par_facture_id`, `statut_financier` (**enum 2 valeurs : `calcule`/`ajuste`** — résidu « 3 valeurs avec `cout_manquant` » corrigé 2026-06-11, la revue sobriété §05 2026-05-01 D2 a supprimé `cout_manquant`, cf. addendum M07 §1), `cout_calculated_at`, `push_s6_version`. **Supprimées** : `statut_ajustement`, `validation_admin_requise`, `validation_admin_par_user_id`, `validation_admin_at`, `motif_refus_admin` (workflow validation supprimé sobriété A3). |
| `statut` | text | NOT NULL, default `planifiee` | Enum 5 valeurs : `planifiee`, `acceptee`, `en_cours`, `terminee`, `annulee`. retiré V1 (revue sobriété §05 2026-05-01 D2 — cas impossible par construction grâce à R_M06.X grille obligatoire + trigger anti-expiration). Statut financier porté par colonne séparée `statut_financier`. |
| `cloture_gps` | jsonb | nullable | **Ajout 2026-06-11 (audit data model — colonne fantôme régularisée)** — Position GPS capturée à la clôture de tournée M05 (« Terminer la tournée »), comparée à `m04_coords_gps_entrepot` avec rayon `m04_seuil_distance_cloture_metres` (300 m, R_M04.2). Format `{lat, lng, accuracy_m, captured_at}`. Référencée par la purge RGPD 30 j (addendum M05 §6) et le geofence M04 sans avoir jamais été définie. Purge : set NULL à J+30 (cron RGPD). |
| `cloture_hors_zone` | boolean | NOT NULL, default false | **Ajout 2026-06-11 (idem)** — `true` si la clôture a eu lieu hors du rayon de tolérance → alerte `m04_cloture_hors_zone` (warning, non bloquant). Flag conservé après purge GPS (le booléen survit à l'effacement de la position, l'info d'audit reste). |
| `commentaire_chauffeur` | text | | Saisie M05 en fin de tournée |
| `commentaire_ops` | text | | Notes Ops Savr (ajustements manuels) |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |

**Index** : `(prestataire_id, date_planifiee)`, `(chauffeur_id, date_planifiee)`, `(statut) WHERE statut IN ('planifiee','acceptee','en_cours')`, **retiré V1 (propagation suppression saisie plaque terrain 2026-06-04 — colonne supprimée)**, `(grille_tarifaire_id)`. retiré V1 (revue sobriété §04 2026-04-30 A6 — colonne supprimée, lookup via `everest_missions.tournee_id`).

**Note `nb_rolls_suggeres` (propagation revue sobriété M05 2026-04-29)** : pas de colonne stockée. Calcul à la volée par M09 R4.4 = somme des `nb_rolls_suggeres` de toutes les `collectes_tms` ZD de la tournée (palier `parametres_tms.stock.palier_rolls_par_pax_seuils` appliqué à `collectes_tms.nb_pax`). Affiché : (1) M02 E3 drawer collecte (ZD, par collecte, lecture seule au dispatch), (2) M04 E3 Section 2 (par collecte) + total tournée, (3) M05 E3 checklist pré-départ ZD (somme rolls tournée). Pas d'override Ops/manager (calcul auto figé). Lien vers [[../06 - Fonctionnalités détaillées TMS/M09 - Stock matériel Savr#W3 — Calcul paliers rolls suggérés à prep tournée (R4.4)]].

**Règle de calcul `cout_calcule_ht` (formule à paliers — applicable Strike, Marathon et tout prestataire utilisant `formule_code = 'vacations_paliers'`)** :

```
duree_heures  = duree_reelle_minutes / 60
nb_p          = nb_personnes_facturation
tarif_base    = grille.parametres_formule->>'tarif_vacation_base_ht'
cout_horaire  = grille.parametres_formule->>'cout_horaire_supplementaire_ht'
paliers       = grille.parametres_formule->'paliers'   # tableau JSON configurable par Admin TMS

# Algorithme générique M07 (lecture du tableau paliers — aucun seuil en dur)
palier = paliers.find(p => p.de_h <= duree_heures < p.a_h)
cout   = palier.nb_vacations × tarif_base
si palier.prolongation == true :
    cout += nb_p × cout_horaire × (duree_heures - palier.base_h)
nb_unites = palier.nb_vacations
```

Les seuils horaires (4h, 6h, 8h...) sont dans le JSON, pas dans le code. Si Strike renégocie, l'Admin modifie le tableau dans UI M13, sans déploiement.

**Décision Val 2026-04-22** :
1. Cette règle à paliers remplace la formule `floor(durée/6)+1` précédemment documentée en §03 M07. Propagation §03 à faire.
2. Le coût horaire supplémentaire et le tarif vacation de base sont **paramétrables par prestataire** dans `grilles_tarifaires_prestataires.parametres_formule` (pas de valeur hardcodée, pas de logique Strike-spécifique).

**RLS** : Ops Savr / Admin TMS → tout. Manager prestataire → `prestataire_id = current_user.prestataire_id`. Chauffeur → tournées où `chauffeur_id OR equipier_id = current_user.chauffeur_id`.

**Trigger `trg_validate_tournee_controle_acces` (BEFORE UPDATE on `tms.tournees`)** — restauré 2026-05-01 — renommé 2026-05-03 (refonte formulaire §06.01 Plateforme : flag unique `controle_acces_requis` couvrant plaque + nom chauffeur, ex `plaque_requise`). Bloque la transition `OLD.statut = 'planifiee' AND NEW.statut = 'acceptee'` si au moins une `tms.collectes_tms` rattachée à la tournée a `controle_acces_requis = true` ET (`NEW.plaque_preassignee_manager IS NULL` OU `NEW.chauffeur_id IS NULL`). Exception : pas de blocage sur le critère plaque si toutes les `collectes_tms` de la tournée ont `prestataire.integration_externe = 'everest'` ET `vehicule.type_vehicule_id IN (SELECT id FROM types_vehicules WHERE categorie = 'velo')` *(corrigé 2026-06-11, audit data model — ex-`'velo_cargo'`, valeur inexistante dans l'enum `categorie`)* (cas A Toutes! vélo cargo, pas de plaque attribuable) — mais le `chauffeur_id` reste obligatoire dans tous les cas. Sert R_M03.4 + R_M04.CONTROLE_ACCES (cf. [[../05 - Règles métier TMS|§05]]).

```sql
CREATE OR REPLACE FUNCTION tms.fn_validate_tournee_controle_acces()
RETURNS TRIGGER AS $$
DECLARE
  collecte_controle_acces_count INT;
  velo_cargo_count INT;
  total_collectes INT;
BEGIN
  IF (OLD.statut = 'planifiee' AND NEW.statut = 'acceptee') THEN
    -- Propagation multi-camions 2026-05-25 : collectes de la tournée lues via la liaison `collecte_tournees`
    SELECT COUNT(*) INTO collecte_controle_acces_count
      FROM tms.collecte_tournees ct
      JOIN tms.collectes_tms c ON c.id = ct.collecte_tms_id
      WHERE ct.tournee_id = NEW.id AND c.controle_acces_requis = true;

    IF collecte_controle_acces_count > 0 THEN
      -- Le nom chauffeur (chauffeur_id) est requis dans tous les cas
      IF NEW.chauffeur_id IS NULL THEN
        RAISE EXCEPTION 'Validation tournée bloquée — chauffeur requis (contrôle d''accès). Affecter un chauffeur en M03 E4 avant validation.';
      END IF;

      -- La plaque est requise sauf exception vélo cargo A Toutes!
      IF NEW.plaque_preassignee_manager IS NULL THEN
        SELECT COUNT(*) INTO total_collectes FROM tms.collecte_tournees WHERE tournee_id = NEW.id;
        SELECT COUNT(*) INTO velo_cargo_count
          FROM tms.collecte_tournees ct
          JOIN tms.collectes_tms c ON c.id = ct.collecte_tms_id
          JOIN shared.prestataires p ON p.id = c.prestataire_id
          JOIN tms.vehicules v ON v.id = NEW.vehicule_id
          JOIN tms.types_vehicules tv ON tv.id = v.type_vehicule_id
          WHERE ct.tournee_id = NEW.id
            AND p.integration_externe = 'everest'
            AND tv.categorie = 'velo'; -- corrigé 2026-06-11 (audit data model) : l'enum types_vehicules.categorie est camion|fourgon|velo|autre — l'ex-valeur 'velo_cargo' ne matchait jamais (exception vélo morte → tournées A Toutes! bloquées sur la plaque)

        IF velo_cargo_count = total_collectes THEN
          RETURN NEW; -- Exception A Toutes! vélo cargo : pas de plaque mais chauffeur déjà validé ci-dessus
        END IF;

        RAISE EXCEPTION 'Validation tournée bloquée — plaque manager requise (contrôle d''accès). Saisir la plaque en M03 E4 avant validation.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_tournee_controle_acces
  BEFORE UPDATE ON tms.tournees
  FOR EACH ROW
  EXECUTE FUNCTION tms.fn_validate_tournee_controle_acces();
```

---

### Table : `collecte_tournees`

**Nouvelle entité V1 (refonte multi-camions 2026-05-25)**. Table de liaison **N↔N** entre `collectes_tms` et `tournees`. Remplace l'ancien lien `collectes_tms.tournee_id` singulier (retiré) et accueille les colonnes `ordre_dans_tournee` + `cout_reparti_centimes` (qui dépendent du couple collecte×tournée). Miroir de `plateforme.collecte_tournees` côté Plateforme. Couvre la **mutualisation** (1 tournée → N collectes) ET le **multi-camions** (1 collecte → N tournées). Alimentée au dispatch (M02 W1 + bouton "Ajouter un véhicule" M04, libellé contextuel camion/vélo — généralisé vélo AG 2026-05-29) et poussée à la Plateforme via S3 `tournee-upsert` (liste des `collecte_id` par tournée). Couvre aussi le **multi-vélo AG** (1 collecte AG → N vélos A Toutes!, V2).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `collecte_tms_id` | uuid | FK `collectes_tms(id)`, NOT NULL | |
| `tournee_id` | uuid | FK `tournees(id)`, NOT NULL | |
| `ordre_dans_tournee` | smallint | NOT NULL, CHECK `>= 1` | Séquence de la collecte dans **cette** tournée (1, 2, 3...). Initialisé à l'ordre de sélection au dispatch (M04 W1). Modifiable Ops via flèches ▲▼ E3 Section 2 (RPC `tms.m04_reordonner_collectes`) tant que `tournees.statut = 'planifiee'`. Base du calcul Haversine distance depuis la collecte précédente. *(déplacé depuis `collectes_tms.ordre_dans_tournee` — multi-camions 2026-05-25)* |
| `statut_execution` | text | NOT NULL, default `'a_faire'`, CHECK `statut_execution IN ('a_faire','faite','incident')` | **NOUVELLE colonne (arbitrage Val 2026-07-06 RC-M05-01)** : avancement de la **portion** (collecte × cette tournée). Posée `'faite'` par le chauffeur au clic « Terminer collecte » (M05 W8), `'incident'` si signalement bloquant sur cette portion. Lue par la gate « Terminer la tournée » (M05 E4). Le statut collecte global reste **dérivé** (R6.1) — cette colonne ne le remplace pas. **+1 colonne au DDL cible V2 — regelé 2026-07-06** |
| `cout_reparti_centimes` | integer | nullable | Quote-part du `cout_calcule_ht` de **cette** tournée allouée à cette collecte (centimes). Calculée par `trg_m07_calc_cost` à la clôture de la tournée (répartition égale sur les collectes de la tournée, dernière reçoit le reste). NULL tant que la tournée n'est pas clôturée. Coût logistique total d'une collecte = `SUM(cout_reparti_centimes)` sur ses lignes. Sert M08 rapprochement (détail par camion). *(déplacé depuis `collectes_tms.cout_reparti_centimes` — multi-camions 2026-05-25)* |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |

**Contraintes** :
- `UNIQUE (collecte_tms_id, tournee_id)` — un couple collecte/tournée unique.
- `UNIQUE (tournee_id, ordre_dans_tournee)` DEFERRABLE INITIALLY DEFERRED — ordre unique dans une tournée, swaps en transaction autorisés.

**Index** : `(collecte_tms_id)` (lecture "les N tournées d'une collecte" : statut agrégé, marge, contrôle d'accès, S5), `(tournee_id, ordre_dans_tournee)` (lecture "les N collectes d'une tournée" : E3, prorata coût).

**Règles** :
- Une collecte AG via Everest n'a aucune ligne ici (0 tournée Savr).
- Aucune cascade de statut portée par la liaison : le statut collecte est dérivé applicativement des statuts des tournées liées (cf. [[05 - Règles métier TMS#R6.1 — Cycle de vie `collectes_tms`]] + R6.2).

**RLS** : Ops Savr / Admin TMS → tout. Manager prestataire → lignes dont la tournée a `prestataire_id = current_user.prestataire_id`. Chauffeur → lignes dont la tournée a `chauffeur_id` ou `equipier_id = current_user.chauffeur_id`. Écriture système (dispatch/trigger) uniquement.

**Impact métier** : socle du multi-camions — répartition coût par camion (marge App via somme), ordre de passage par tournée, dérivation du statut collecte, et agrégation des pesées des N camions sous la collecte.

**Trigger `trg_derive_statut_collecte_multi_tournees` (AFTER UPDATE OF statut ON `tms.tournees`)** *(refonte multi-camions 2026-05-25, arbitrage 6a)* — dérive `collectes_tms.statut_operationnel = 'realisee'` quand **toutes** les tournées d'une collecte sont terminales (clôture chauffeur de chaque tournée). Lève le deadlock circulaire collecte↔tournée (cf. [[05 - Règles métier TMS#R6.1 — Cycle de vie `collectes_tms`]] + R6.2). Cas standard (1 tournée) : équivalent à l'ancienne clôture chauffeur de la collecte. C'est la transition `collectes_tms → realisee` qui porte l'émission du S5 terminal unique (pesées des N camions sommées).

```sql
CREATE OR REPLACE FUNCTION tms.fn_derive_statut_collecte_multi_tournees()
RETURNS TRIGGER AS $$
DECLARE
  v_collecte_id uuid;
BEGIN
  IF (OLD.statut IS DISTINCT FROM NEW.statut AND NEW.statut = 'terminee') THEN
    -- Concurrence (revue adversariale 2026-07-06 RC-M04-01) : sérialisation PAR COLLECTE.
    -- Sans lock, deux clôtures de tournées sœurs simultanées se ratent mutuellement
    -- (chaque tx voit l'autre non commitée → NOT EXISTS faux des deux côtés → 0 ligne,
    -- aucun row-lock pris → dérivation perdue, S5 jamais émis).
    -- ORDER BY = ordre de lock déterministe (anti-deadlock si 2 tournées partagent 2 collectes).
    FOR v_collecte_id IN
      SELECT collecte_tms_id FROM tms.collecte_tournees
       WHERE tournee_id = NEW.id
       ORDER BY collecte_tms_id
    LOOP
      -- Lock de la collecte AVANT évaluation : la 2e tx concurrente attend le commit
      -- de la 1re ; l'UPDATE suivant (nouveau statement, READ COMMITTED) ré-évalue
      -- sur un snapshot frais qui voit la tournée sœur commitée.
      PERFORM 1 FROM tms.collectes_tms WHERE id = v_collecte_id FOR UPDATE;

      UPDATE tms.collectes_tms c
         SET statut_operationnel = 'realisee',
             date_fin_reelle = now()
       WHERE c.id = v_collecte_id
         AND c.statut_operationnel NOT IN ('realisee','realisee_sans_collecte','incident','annulee')
         -- toutes les tournées de la collecte sont terminales (terminee ou annulee)
         AND NOT EXISTS (
           SELECT 1 FROM tms.collecte_tournees ct
           JOIN tms.tournees t ON t.id = ct.tournee_id
           WHERE ct.collecte_tms_id = c.id
             AND t.statut NOT IN ('terminee','annulee')
         )
         -- garde ZD : au moins une pesée nette > 0 sur l'ensemble des camions (sinon alerte Ops, pas de bascule auto)
         AND (c.parcours <> 'zd' OR EXISTS (
           SELECT 1 FROM tms.pesees p WHERE p.collecte_tms_id = c.id AND p.poids_net_kg > 0 -- colonne poids_net_kg (kg, GENERATED)
         ));
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_derive_statut_collecte_multi_tournees
  AFTER UPDATE OF statut ON tms.tournees
  FOR EACH ROW
  WHEN (OLD.statut IS DISTINCT FROM NEW.statut)
  EXECUTE FUNCTION tms.fn_derive_statut_collecte_multi_tournees();
```

---

### Table : `outbox_events` (schéma `tms`) — NOUVELLE (arbitrage Val 2026-07-06, revue adversariale RC-M04-06)

Outbox transactionnelle des webhooks sortants TMS → Plateforme (S1-S11). Symétrique de `plateforme.outbox_events` (V1) : toute mutation métier qui doit émettre un S-event **INSÈRE une ligne ici dans la même transaction** (par RPC ou trigger — ex. : la dérivation R6.1 insère le S5 terminal ; `trg_pesee_tardive_s5_correction` insère le S5 correction). Un worker consommateur en **lease/claim** (pattern tranché côté App 2026-06-11 : tx courte de claim `status='processing'` + `claimed_until` + `attempts++` AVANT tout HTTP → POST hors transaction → tx de résultat ; reaper re-queue les claims expirés avec `requires_reconciliation=true` → réconciliation avant re-POST) livre les webhooks : retry 3 paliers (5 min/1h/24h), **head-of-line par agrégat**, DLQ → alerte critical M11. **Remplace le pattern pg_notify comme transport** (non durable — event perdu si worker down) ; `pg_notify` reste autorisé comme simple **réveil** du worker (latence), jamais comme transport.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `seq` | bigserial | UNIQUE | Ordre d'émission (règle aussi les `occurred_at` égaux côté consommateur) |
| `event_id` | uuid | UNIQUE, NOT NULL | Clé d'idempotence du webhook — **réutilisée à l'identique à chaque retry** (dédup `integrations_inbox` Plateforme) |
| `event_type` | text | NOT NULL | Slug S-event (ex : `collecte-acceptee`, `tournee-upsert`, `collecte-terminee`, `incident`) |
| `aggregate_type` | text | NOT NULL, CHECK IN (`'collecte'`,`'tournee'`) | Head-of-line par `(aggregate_type, aggregate_id)` *(naming aligné `plateforme.outbox_events.aggregate_id`)* |
| `aggregate_id` | uuid | NOT NULL | |
| `payload` | jsonb | NOT NULL | Enveloppe complète §08 (`event_id`/`occurred_at`/`source`/`type`/`data`) figée à l'émission |
| `occurred_at` | timestamptz | NOT NULL, default `now()` | |
| `txid` | bigint | NOT NULL, default `txid_current()` | Garde de visibilité worker (`txid < txid_snapshot_xmin(txid_current_snapshot())` — pattern App) |
| `status` | text | NOT NULL, default `'pending'`, CHECK IN (`'pending'`,`'processing'`,`'failed'`,`'dead'`) | Aligné pattern App (`dead` = DLQ) ; livré = `consumed_at NOT NULL` |
| `claimed_until` | timestamptz | nullable | Lease du worker |
| `attempts` | integer | NOT NULL, default 0 | 4 tentatives (3 paliers) puis `dead` + DLQ → alerte critical M11 |
| `next_retry_at` | timestamptz | nullable | Prochain palier (5 min / 1h / 24h) |
| `requires_reconciliation` | boolean | NOT NULL, default `false` | Posé par le reaper sur claim expiré |
| `last_error` | text | nullable | |
| `dead_at` | timestamptz | nullable | |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `consumed_at` / `consumer` | timestamptz / text | nullables | Livraison effective (200 Plateforme) + identité worker |

**Index** : `(status, seq)` (scan worker), `(aggregate_type, aggregate_id, seq)` (head-of-line), `(event_id)` UNIQUE.
**RLS** : écriture/consommation `service_role` uniquement ; Admin TMS lecture seule (dashboard sync M13 + bouton « Rejouer » = re-queue `failed → pending`, même `event_id`, `tentative_num=1` cf. M13 F2).
**⚠ Structure** : +1 table au DDL cible V2 (**92 → 93** — compteur recompté 2026-06-30 : l'ex « 89 » avait dérivé) — **regelé 2026-07-06, validé pglast v7.15 (320 statements, 93 tables)**, re-diff garde-fou 1. Colonnes alignées sur `plateforme.outbox_events` (status `pending|processing|failed|dead`, `consumed_at`/`consumer`/`next_retry_at`/`dead_at`, naming `aggregate_*`) + spécifiques webhook (`event_id` UNIQUE, `occurred_at`, `aggregate_type`) — le DDL cible fait foi pour la structure exacte.

### Triggers de garde `tournees` + filet pesée tardive — NOUVEAUX (arbitrages Val 2026-07-06, revue adversariale)

| Trigger | Événement | Comportement |
|---|---|---|
| `trg_tournees_transitions` | BEFORE UPDATE OF statut ON `tournees` | **Matrice R6.2 en whitelist** (`planifiee→acceptee/annulee`, `acceptee→en_cours/planifiee/terminee/annulee`, `en_cours→terminee`) — toute autre transition → RAISE EXCEPTION (même philosophie que `trg_m10_anti_deconfirmation`). Filet ultime derrière les RPC gardées M04 W2/W4/W6/W7/W9 (`SELECT … FOR UPDATE` + `WHERE statut IN (…)`, 0 ligne = 409) — RC-M04-04 |
| `trg_tournees_horaires_verrouilles` | BEFORE UPDATE OF heure_reelle_debut, heure_reelle_fin ON `tournees` | RAISE EXCEPTION si `cout_final_verrouille = true` — la fenêtre de correction W8 devient transactionnelle (ferme le TOCTOU avec l'auto-validation M08) — RC-M04-03 |
| `trg_pesee_tardive_s5_correction` | AFTER INSERT ON `pesees` | Si la collecte est déjà `realisee` (dérivée) → INSERT `tms.outbox_events` S5 `type='correction'` (déclencheur (c) §08 étendu à toute source) — RC-M05-04 |

**RPC associées (mêmes arbitrages)** : `tms.m04_evaluer_completude(tournee_id)` — `SELECT … FOR UPDATE` sur `tournees` puis relecture des collectes liées, bascule atomique `en_attente_execution` + tournée `acceptee` (RC-M04-05) ; attribution `ordre_pesee` **serveur** sous lock du couple `(collecte_tms_id, flux)` dans la transaction d'INSERT (RC-M05-03).

---

### Table : `pesees`

Saisies de pesée brute par le chauffeur sur l'app mobile (M05). 1 ligne = 1 geste de pesée. Un flux peut générer N lignes si le contenant ne rentre pas en 1 fois sur la balance (cf. exemple 2026-04-22 : 2 pesées emballage sur 1 collecte).

Le poids net par flux = `SUM(poids_net_kg) GROUP BY (collecte_tms_id, flux)`. C'est cette valeur agrégée qui est poussée à la Plateforme via `collecte-terminee` et qui sert aux alertes pesées min/max ZD (§05 Plateforme, normalisées par pax). **Multi-camions (2026-05-25)** : `pesees.tournee_id` reste renseigné (chaque camion pèse sa portion). L'agrégation par `(collecte_tms_id, flux)` **somme déjà naturellement les pesées des N camions** d'une grosse collecte — aucune modification structurelle de `pesees`. Le S5 terminal unique (cf. §08) est émis quand toutes les tournées de la collecte sont `terminee`, avec ces pesées sommées.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `collecte_tms_id` | uuid | FK `collectes_tms(id)`, NOT NULL | |
| `tournee_id` | uuid | FK `tournees(id)`, NOT NULL | Dénormalisé pour perf (RLS + reporting prestataire) |
| `flux` | text | NOT NULL | Enum **fermée V1 (post-refonte 2026-05-02, durcie 2026-06-11)** : `biodechet`, `emballage`, `carton`, `verre`, `dechet_residuel` (ZD) + **`don_alimentaire`** (AG, valeur canonique unique à l'écriture — `repas` = alias legacy lecture/migration seulement, normalisé à l'import, cf. « Compat flux » addendum M05 §1). 5 flux ZD canoniques alignés sur §04 App `flux_dechets`. CHECK constraint DB sur les 6 valeurs d'écriture. |
| `ordre_pesee` | integer | NOT NULL, default 1 | 1, 2, 3... dans l'ordre chronologique pour un `(collecte_tms_id, flux)` |
| `type_contenant_id` | uuid | FK `types_contenants(id)`, nullable | Référence référentiel paramétrable (tare + libellé). Nullable si chauffeur pèse sans typer (rare) |
| `nb_contenants` | integer | NOT NULL, default 1 | Nombre de contenants pesés ensemble |
| `poids_brut_kg` | numeric(7,2) | NOT NULL | Saisi sur la balance |
| `tare_kg` | numeric(7,2) | NOT NULL, default 0 | Auto-calculée au snapshot : `types_contenants.tare_kg × nb_contenants` au moment de la pesée. Éditable manuellement par chauffeur (override). Le snapshot évite que la modification ultérieure de la tare standard ne réécrive les pesées historiques |
| `poids_net_kg` | numeric(7,2) | GENERATED | `GREATEST(poids_brut_kg - tare_kg, 0)` |
| `saisi_par_chauffeur_id` | uuid | FK `chauffeurs(id)`, NOT NULL | |
| `photos` | text[] | default `{}` | Photos balance (preuve). **Champ unique array (décision 2026-06-06 — fusion ex-`photo_url`/`photos_urls`)**. Max 5 (paramètre `m05_photo_max_par_pesee`), toujours array même si 1 photo. |
| `ajuste_par_ops_user_id` | uuid | FK `users_tms(id)`, nullable | Si ajustement manuel post-saisie |
| `motif_ajustement` | text | | Trace pour audit |
| `idempotency_key` | uuid | UNIQUE, NOT NULL — **pas de default** (un oubli de propagation doit échouer bruyamment, pas générer une clé fraîche qui tue la dédup) | Clé générée côté PWA avant stockage queue IndexedDB (W11 M05), propagée telle quelle par le serveur. *(Fusion addendum M05 2026-04-24 dans le bloc canonique — revue adversariale 2026-07-06 RC-M05-02)* |
| `source` | text | NOT NULL, default `chauffeur`, CHECK `source IN ('chauffeur','ag_sans_collecte')` | Enum 2 valeurs (revue sobriété 2026-04-29). *(Fusion addendum M05 — RC-M05-02)* |
| `tare_override_motif` | text | nullable | Obligatoire (≥ 10 car) si `tare_kg` diverge de `types_contenants.tare_kg × nb_contenants` (D8). Audit `PESEE_TARE_OVERRIDE`. *(Fusion addendum M05 — RC-M05-02)* |
| `created_at` | timestamptz | NOT NULL, default `now()` | Horodatage saisie terrain |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |

**Index** : `(collecte_tms_id, flux, ordre_pesee)`, `(tournee_id)`, `(saisi_par_chauffeur_id, created_at DESC)`, `(created_at DESC)`, `(idempotency_key)` UNIQUE (obligatoire pour la dédup retry offline — RC-M05-02), `(source, created_at DESC)`.

**Contrainte (UNIQUE)** : `(collecte_tms_id, flux, ordre_pesee)` UNIQUE pour éviter les doublons d'ordre ; `(idempotency_key)` UNIQUE.

**Écriture serveur (dédup concurrente-sûre — revue adversariale 2026-07-06 RC-M05-02)** : `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` + réponse 200 idempotente (un rejeu ne part jamais en DLQ). Le pattern « check idem key puis insert » applicatif est interdit (racy : Background Sync + réouverture PWA peuvent rejouer le même item en parallèle).

**Attribution `ordre_pesee` (arbitrage Val 2026-07-06 RC-M05-03)** : le client n'envoie **jamais** `ordre_pesee` ; le serveur calcule `COALESCE(MAX(ordre_pesee),0)+1` **sous lock des lignes du couple `(collecte_tms_id, flux)`** dans la transaction d'INSERT (deux chauffeurs multi-camions ou un double-tap ne peuvent pas collisionner sur l'UNIQUE). La contrainte UNIQUE est conservée comme filet.

**RLS** : Ops Savr / Admin TMS → tout. Manager prestataire → pesées de `tournees` où `prestataire_id = current_user.prestataire_id`. Chauffeur → pesées où `saisi_par_chauffeur_id = current_user.chauffeur_id`.

**Push Plateforme** : le webhook `collecte-terminee` (cf. §08) agrège `pesees` par flux :
```json
"pesees_par_flux": {
  "emballage": { "poids_net_kg_total": 18.0, "nb_pesees": 2 },
  "biodechet": { "poids_net_kg_total": 85.0, "nb_pesees": 1 }
}
```

---

### Table : `types_contenants`

Référentiel paramétrable des contenants utilisés sur le terrain (rolls, bacs, sacs). Ops Savr gère cette table via M13 Admin TMS : ajout de nouveaux types, modification des tares si les constructeurs changent.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `code` | text | NOT NULL, UNIQUE | Slug stable (ex: `roll_240L`, `bac_1100L`, `bac_240L`, `sans_contenant`). **Suppression revue sobriété M05 E6 2026-04-30** : `bac_660L` et `caisse_plastique` retirés du seed V1 (jamais utilisés en prod). Statut `archive` pour anciens rows si présents en migration. |
| `libelle` | text | NOT NULL | Affichage UI (ex: "Roll 240L", "Bac 1100L") |
| `categorie` | text | NOT NULL | Enum `roll`, `bac`, `sac`, `autre`. **Sobriété 2026-04-30 D_M09_02** : valeur retirée — seed `caisse_plastique` déjà archivé (revue M05 2026-04-30), aucun row actif ne l'utilise. CHECK constraint à enforcer côté DB. |
| `volume_litres` | integer | | Indicatif |
| `tare_kg` | numeric(7,2) | NOT NULL, default 0 | Poids à vide, utilisé pour auto-calcul pesée |
| `flux_compatibles` | text[] | | Values : `biodechet`, `emballage`, `carton`, `verre`, `dechet_residuel`, `don_alimentaire`/`repas` — filtre UI chauffeur. Alignement §04 App `flux_dechets` post-refonte 2026-05-02. |
| `ordre_affichage` | integer | NOT NULL, default 100 | Tri listes déroulantes |
| `statut` | text | NOT NULL, default `actif` | `actif`, `archive` |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | Les anciennes pesées conservent leur `tare_kg` snapshotée |

**Index** : `(code)` UNIQUE, `(statut, ordre_affichage)`, GIN `(flux_compatibles)`.

**Seed V1 confirmé (Val 2026-04-28)** :

| `code` | `libelle` | `categorie` | `tare_kg` | `flux_compatibles` | `ordre_affichage` |
|--------|-----------|-------------|----------|--------------------|------------------|
| `roll_850L` | "Roll 850L emboîtable" | `roll` | **37,00** | `biodechet, emballage, dechet_residuel` | 1 |
| `roll_pliable` | "Roll pliable" | `roll` | **26,00** | `biodechet, emballage, dechet_residuel` | 2 |
| `bac_1100L` | "Bac 1100L" | `bac` | **50,00** | `biodechet, dechet_residuel, emballage` | 3 |
| `bac_240L` | "Bac 240L" | `bac` | **11,00** | `verre, biodechet` | 4 |
| `sac` | "Sac" | `sac` | 0,50 | `carton, emballage` | 5 |
| `sans_contenant` | "Sans contenant (sac direct)" | `autre` | 0,00 | tous flux | 6 |

**Stocks initiaux confirmés (Val 2026-04-28)** — à seeder au go-live via M13 wizard onboarding (D8) :
- `stocks_rolls_traiteurs` : Roll 850L emboîtable = **60**, Roll pliable = **8** (répartition par traiteur à saisir par Ops Savr E3 J0)
- `stocks_bacs_entrepot` : Bac verre 240L = **20**, Bac biodéchet 240L = **8**, Bac déchet résiduel 1100L = **20**, Bac emballage 1100L = **6**

Ces valeurs sont modifiables par Admin TMS (tares via M13 E4, stocks via M09 E3 recompte / M10 E7 recompte).

**RLS** : lecture seule pour tous `users_tms` authentifiés. Écriture **`admin_tms` uniquement** *(tranché Val 2026-06-07, floue #3 session test-scenarios M09 — ; une tare fausse fausse toutes les pesées, fréquence ~1×/trimestre, M09 E4 fait foi)*. Ops Savr lecture seule.

**Immutabilité du `code`** : une fois créé, `code` est immuable pour ne pas casser les références historiques.

---

### Table : `rolls_mouvements` *(réécrite 2026-06-07 — tranchage Val floue #2 session test-scenarios M09, alignement sur M09 W1/W2/EC10)*

Historique unique des mouvements de stock rolls : déclarations chauffeur en fin de collecte ZD (`source = 'cloture_collecte'`) **et** recomptes manuels Ops (`source = 'recompte_ops'`, M09 W2/E3). Pas de numéro de série (granularité par type — décision §03 M09 D2).

> *Tranché Val 2026-06-07* : l'ancien schéma (jamais propagé depuis M09 V1 2026-04-25) utilisait , (rendait le recompte Ops impossible) et ne portait ni `source` ni `motif` ni `user_id`. Réécrit sur le modèle M09.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `source` | text | NOT NULL, CHECK IN (`cloture_collecte`, `recompte_ops`) | Origine du mouvement (M09 W1 vs W2). Exposée par la vue `plateforme.v_stocks_rolls` (dernier mouvement) |
| `collecte_tms_id` | uuid | FK `collectes_tms(id)` **ON DELETE SET NULL**, nullable | NOT NULL enforced par CHECK si `source = 'cloture_collecte'`. SET NULL = le mouvement survit à la suppression de la collecte (M09 EC10, pas de réversion stock auto) |
| `tournee_id` | uuid | FK `tournees(id)`, nullable | Dénormalisé pour RLS manager. NULL si `recompte_ops` |
| `plateforme_traiteur_id` | uuid | NOT NULL | Miroir `organisations.id` Plateforme |
| `plateforme_lieu_id` | uuid | nullable | Stock par lieu (traiteur multi-entrepôt, M09 D9). NULL = stock global |
| `type_contenant_id` | uuid | FK `types_contenants(id)` ON DELETE RESTRICT, NOT NULL | Référentiel niveau 2 (remplace ex-enum `type_roll`) |
| `nb_pleins_recuperes` | integer | NOT NULL, default 0, CHECK ≥ 0 | Saisie chauffeur (W1). 0 si recompte |
| `nb_vides_laisses` | integer | NOT NULL, default 0, CHECK ≥ 0 | Saisie chauffeur (W1). 0 si recompte |
| `delta` | integer | NOT NULL | Effet net sur le stock. W1 : `nb_vides_laisses − nb_pleins_recuperes`. W2 : `qte_recomptee − qte_avant` |
| `stock_apres` | integer | NOT NULL | Snapshot stock résultant (affiché E2 historique) |
| `motif` | text | nullable | Obligatoire (≥ 10 chars) si `recompte_ops` avec écart absolu ≥ 3 OU relatif ≥ 30% (R_M09.5) |
| `saisi_par_chauffeur_id` | uuid | FK `chauffeurs(id)`, nullable | NOT NULL enforced par CHECK si `source = 'cloture_collecte'` |
| `user_id` | uuid | FK `users_tms(id)`, nullable | NOT NULL enforced par CHECK si `source = 'recompte_ops'` |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |

**CHECK d'intégrité par source** :
```sql
CHECK (
  (source = 'cloture_collecte' AND collecte_tms_id IS NOT NULL AND saisi_par_chauffeur_id IS NOT NULL)
  OR
  (source = 'recompte_ops' AND user_id IS NOT NULL)
)
```

**Index** : `(collecte_tms_id)`, `(plateforme_traiteur_id, created_at DESC)` (E2 historique), `(tournee_id)`.

**Contrainte (UNIQUE partiel)** : `(collecte_tms_id, type_contenant_id) WHERE collecte_tms_id IS NOT NULL` — 1 ligne par (collecte, type), garantit l'idempotence W1 (replay PWA offline → ON CONFLICT DO NOTHING, UPDATE stock skippé). Pas d'unicité sur les recomptes (N recomptes possibles).

**Correction déclaration chauffeur** *(tranché Val 2026-06-07, floue #2)* : UPDATE de la ligne existante (pas INSERT). Le trigger applicatif **reverse l'ancien delta puis applique le nouveau** sur `stocks_rolls_traiteurs` (`stock += new.delta − old.delta`) — jamais de double comptage. `delta` et `stock_apres` recalculés.

**Règle de mise à jour stock** : après chaque INSERT/UPDATE, trigger applicatif (pas DB, pour garder la logique métier accessible) recalcule `stocks_rolls_traiteurs` (niveau 4) : `stock_nouveau = stock_precedent + delta`. **supprimé (revue sobriété §08 Bloc A 2026-05-01 A3)** — lecture Plateforme via vue `plateforme.v_stocks_rolls`.

**RLS** : cf. §09 section 9 (`rolls_staff_all`, `rolls_manager_read` via tournée, `rolls_chauffeur_insert`/`read` self-only, UPDATE/DELETE staff).

---

### Table : `incidents`

Remontées chauffeur terrain (M05) + incidents détectés côté Ops (M11). Remonte à la Plateforme via webhook `incident`.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `collecte_tms_id` | uuid | FK `collectes_tms(id)`, nullable | Renseigné si lié à une collecte |
| `tournee_id` | uuid | FK `tournees(id)`, nullable | Renseigné si lié à une tournée |
| `type_incident` | text | NOT NULL | **Enum final V1 = 5 valeurs** (décision 2026-06-06 : `pas_excedents` retiré — chemin unique « Aucun repas » via E5→S5, plus de signalement incident AG ; cf. §08 enum + M05 E9) : `acces_refuse` (couvre lieu fermé — alias lecture `acces_lieu_refuse` jusqu'à V1.1), `client_absent`, `probleme_tri` (mauvais tri → passage déchet résiduel), `autre`, `client_annule_avant_arrivee`. Suppressions antérieures : `lieu_ferme`/`bacs_vides`/`bacs_non_conformes`/`panne_vehicule`/`retard_chauffeur`/`absence_contenant`/`materiel_casse`/`erreur_pesee`/`blessure`/`accident_route`/`chauffeur_indisponible` (cf. §08 enums). |
| `gravite` | text | NOT NULL, default `warning`, CHECK IN (`'warning'`,`'critical'`) | Enum 2 valeurs (revue sobriété §04 2026-04-30 D1 — valeur `info` retirée V1, aucun comportement applicatif distinct côté UI Ops). Migration : `UPDATE incidents SET gravite = 'warning' WHERE gravite = 'info'`. |
| `description` | text | NOT NULL | Texte libre |
| `photos` | text[] | default `{}` | Photos signalement (preuve). **Champ unique array (décision 2026-06-06 — fusion ex-`photo_url`)**. Max 5. |
| `declarant_chauffeur_id` | uuid | FK `chauffeurs(id)`, nullable | Si remonté par chauffeur |
| `declarant_ops_user_id` | uuid | FK `users_tms(id)`, nullable | Si remonté par Ops |
| `resolu` | boolean | NOT NULL, default false | |
| `commentaire_resolution` | text | | Conservé V1 — note libre Ops à la résolution, payload métier distinct de l'audit acteur/timestamp. |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |
| `deleted_at` | timestamptz | | Soft delete (jamais hard) |

**Index** : `(collecte_tms_id)`, `(tournee_id)`, `(gravite, resolu) WHERE deleted_at IS NULL`, `(created_at DESC)`. *(Index `(push_plateforme_at)` retiré 2026-06-11, audit data model — la colonne n'existe pas : décision Option B 2026-04-22, le retry push est tracé exclusivement via `integrations_logs`, cf. note « Push Plateforme » ci-dessous + index `integrations_logs(prochaine_tentative_at)`.)*

**Contrainte (CHECK)** : `(declarant_chauffeur_id IS NOT NULL) OR (declarant_ops_user_id IS NOT NULL)` — au moins un déclarant.

**RLS** : Ops Savr / Admin TMS → tout. Manager prestataire → incidents liés à ses tournées. Chauffeur → incidents où il est déclarant ou lié à une de ses tournées.

**Push Plateforme** : la remontée à la Plateforme (webhook `incident`) est tracée exclusivement dans `integrations_logs` (niveau 6). Une ligne `type_event = 'incident'`, `statut` parmi `succes|echec_retry|echec_final`. Pour retrouver les incidents non poussés : `SELECT * FROM incidents i LEFT JOIN integrations_logs l ON (l.ressource_id = i.id AND l.type_event = 'incident' AND l.statut = 'succes') WHERE l.id IS NULL`.

---

---

## Niveau 3 — Tarification et financier

Sources : M06 Référentiel prestataires (grilles) + M07 Pilotage financier (calcul coûts) + M08 Facturation prestataires (upload + rapprochement).

### Table : `formules_catalogue`

Catalogue des formules de calcul disponibles dans le TMS. Paramétrable par Ops Savr (M13 Admin TMS) : activation/désactivation d'une formule sans redéploiement, documentation du schéma JSON attendu pour chaque formule, versioning.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `code` | text | NOT NULL, UNIQUE | Slug stable référencé en code M07 (ex: `vacations_paliers`, `grille_matricielle_zone_type_course`, `grille_matricielle_zone`, `forfait_km`, `forfait_fixe`). Immuable une fois créé |
| `libelle` | text | NOT NULL | Affichage UI (ex: "Vacations à paliers (Strike/Marathon)") |
| `description` | text | | Aide contextuelle UI M13 pour l'utilisateur qui crée une grille |
| `schema_parametres` | jsonb | NOT NULL | JSON Schema décrivant la forme attendue de `grilles_tarifaires_prestataires.parametres_formule`. Sert à générer le formulaire UI dynamiquement **et à valider côté application (Zod)** — revue sobriété M06 2026-06-05 B3 : plus de validateur JSON Schema côté DB |
| `exemple_parametres` | jsonb | | Exemple prérempli pour la UI (clic "remplir l'exemple") |
| `statut` | text | NOT NULL, default `actif` | Enum `actif`, `desactive`, `archive` — `desactive` = caché dans UI M13 mais grilles existantes continuent de fonctionner |
| `ordre_affichage` | integer | NOT NULL, default 100 | Tri dans UI |
| `version` | integer | NOT NULL, default 1 | Incrémenté si le schéma évolue (migration compatible) |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |

**Index** : `(code)` UNIQUE, `(statut, ordre_affichage)`.

**RLS** : lecture seule pour tous `users_tms` authentifiés. Écriture Admin TMS uniquement (pas Ops Savr, car toucher au schéma impacte le code M07).

**Seed V1** (5 formules — détail des schémas ci-dessous en section "Formules supportées") :
- `vacations_paliers` — "Vacations à paliers (Strike/Marathon/province horaires)"
- `grille_matricielle_zone_type_course` — "Grille matricielle zone × type de course (A Toutes! vélo)"
- `grille_matricielle_zone` — "Grille matricielle par zone (A Toutes! camion)"
- `forfait_km` — "Forfait + km supplémentaires (prestataires province)"
- `forfait_fixe` — "Forfait fixe (prestataires province)"

**Note ajout formule** : l'ajout d'un slug ici impose l'ajout du bloc de code correspondant dans M07 (sinon calcul renvoie erreur à la clôture tournée). Le couple `code ↔ implémentation M07` est un couplage DB ↔ code assumé (comme les migrations de types).

---

### Table : `grilles_tarifaires_prestataires`

**Table unifiée** (décision Val 2026-04-22, fusion) : pilote aussi bien les formules de calcul paramétrées (Strike, Marathon, prestataires province avec coûts horaires) que les grilles matricielles à lookup (A Toutes! vélo zone × type_course, A Toutes! camion zone). Chaque ligne = 1 grille applicable à un prestataire pour un type de véhicule donné, sur une période de validité donnée.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `prestataire_id` | uuid | FK `prestataires(id)`, NOT NULL | |
| `type_vehicule_id` | uuid | FK `types_vehicules(id)`, nullable | NULL = grille valable pour tous les véhicules du prestataire |
| `libelle` | text | NOT NULL | Affichage UI (ex: "Strike — Camion 20m³ — 2026", "A Toutes! — Vélo — grille v2") |
| `formule_id` | uuid | FK `formules_catalogue(id)`, NOT NULL | Référence le catalogue des formules disponibles |
| `parametres_formule` | jsonb | NOT NULL | Contenu variable selon `formules_catalogue.code`, validé contre `formules_catalogue.schema_parametres` **côté application (Zod)** — schéma détaillé ci-dessous. DB : `NOT NULL` seul (revue sobriété M06 2026-06-05 B3 — plus de fonction de validation JSON Schema en base) |
| `date_debut_validite` | date | NOT NULL | Première date où la grille s'applique |
| `date_fin_validite` | date | | NULL = en cours. Renseigné à l'expiration (ex: nouvelle négociation) |
| `notes_negociation` | text | | Contexte interne (ex: "Renégocié oct 2026, +5% HT") |
| `pdf_contractuel_url` | text | | Path Storage vers PDF négocié signé |
| `cree_par_user_id` | uuid | FK `users_tms(id)`, NOT NULL | Audit |
| `statut` | text | NOT NULL, default `actif` | Enum `actif`, `archive` |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |

**Index** : `(prestataire_id, type_vehicule_id, date_debut_validite DESC)`, `(statut, date_debut_validite)`, `(formule_id)`.

**Contraintes** (sobriété B2 + D2 2026-04-30, refondu revue sobriété §05 2026-05-01 D2) :
- **Unicité période / non-chevauchement** : `EXCLUDE USING gist (prestataire_id WITH =, COALESCE(type_vehicule_id::text, '*') WITH =, daterange(date_debut_validite, COALESCE(date_fin_validite, 'infinity'::date), '[]') WITH &&) WHERE (statut = 'actif')` — remplace l'ancien trigger `tg_grilles_unicite`. Erreur SQL native interceptée côté API (cohérence garantie par index, plus de trigger custom à débugger). Nécessite extension `btree_gist`.
- **Anti-rétroactivité (R2.8 §05 authoritative)** : CHECK `date_debut_validite > created_at::date` en INSERT (i.e. la grille est créée avec une date de validité strictement future). → **Supprimée V1 (revue sobriété §05 2026-05-01 D2)** : le cas `cout_manquant` n'existe plus, donc plus besoin de bypass rétroactif. Si rétroactivité ponctuelle nécessaire (ex: import migration MTS-1) → SQL Admin direct sur Supabase Studio + audit_log manuel.
- **R_M06.X — Grille obligatoire pour prestataire actif (NOUVELLE revue sobriété §05 2026-05-01 D2)** : tout `prestataires.statut = 'actif'` doit avoir au moins 1 grille `grilles_tarifaires_prestataires.statut = 'actif'` avec `(date_debut_validite <= CURRENT_DATE) AND (date_fin_validite IS NULL OR date_fin_validite >= CURRENT_DATE)`. Implémentation : trigger DB `trg_prestataire_grille_obligatoire` AFTER UPDATE sur `shared.prestataires` qui RAISE EXCEPTION si transition `* → actif` sans grille couvrante. M06 W1 / wizard M13 E7 step 2 = step bloquant en UI (pas skippable). Cas migration MTS-1 : seed crée prestataire ET grille dans la même transaction.
- **Trigger anti-expiration sans successeur (NOUVEAU revue sobriété §05 2026-05-01 D2)** : trigger DB `trg_grille_anti_expiration_orpheline` BEFORE UPDATE sur `grilles_tarifaires_prestataires` qui RAISE EXCEPTION si `UPDATE date_fin_validite NOT NULL` ou `UPDATE statut = 'archive'` sur la dernière grille active du couple `(prestataire_id, type_vehicule_id)` sans qu'une grille successeur active soit publiée pour la période suivante. Force Admin TMS à publier la grille suivante AVANT d'expirer la précédente. Couvre EC12 (grille expirée naturellement sans remplacement).

**Vue dérivée** `tms.vue_grilles_etat_courant` (sobriété D2 2026-04-30 — état temporel non persisté) :
```sql
CREATE VIEW tms.vue_grilles_etat_courant AS
SELECT g.*,
  CASE
    WHEN g.statut = 'archive' THEN 'archivee'
    WHEN g.date_debut_validite > CURRENT_DATE THEN 'future'
    WHEN g.date_fin_validite IS NOT NULL AND g.date_fin_validite < CURRENT_DATE THEN 'expiree'
    ELSE 'en_vigueur'
  END AS etat_courant
FROM tms.grilles_tarifaires_prestataires g;
```
La colonne `statut` reste `actif`/`archive` uniquement (2 valeurs persistées). L'état temporel (`future`/`en_vigueur`/`expiree`/`archivee`) est dérivé à la demande via cette vue. Pas de cron quotidien pour transitionner les statuts (sobriété — la dérivation par vue suffit).

**Lookup côté M07 (au dispatch ou à la clôture tournée)** :
```sql
SELECT * FROM grilles_tarifaires_prestataires
WHERE prestataire_id = :prestataire_id
  AND (type_vehicule_id = :type_vehicule_id OR type_vehicule_id IS NULL)
  AND date_debut_validite <= :date_tournee
  AND (date_fin_validite IS NULL OR date_fin_validite >= :date_tournee)
  AND statut = 'actif'
ORDER BY type_vehicule_id NULLS LAST, date_debut_validite DESC
LIMIT 1
```

**RLS** : Admin TMS → lecture + écriture (création, édition, publication, clôture). Ops Savr → **lecture seule** (propagation M06 D3 2026-04-24, durcissement). Manager prestataire → lecture seule de ses propres grilles (`prestataire_id = current_user.prestataire_id`). Chauffeur → pas d'accès (privé financier).

#### Formules supportées V1

Chaque formule référencée par `formule_id` a son schéma JSON défini dans `formules_catalogue.schema_parametres`. UI M06 E7 génère dynamiquement le formulaire d'édition (Admin TMS uniquement). **Validation à l'écriture côté application** (Zod dérivé du JSON Schema) — revue sobriété M06 2026-06-05 B3 : pas de validateur JSON Schema côté DB (écrivain unique Admin TMS de confiance, zéro API externe). Les contraintes dures restent en base : `NOT NULL`, FK, index EXCLUDE overlap, triggers grille-obligatoire / anti-expiration.

**1. `vacations_paliers`** (Strike, Marathon, prestataires province similaires)

Paliers entièrement configurables par Admin TMS sans code. M07 interprète le tableau `paliers` de façon générique.

```json
{
  "tarif_vacation_base_ht": 200.00,
  "cout_horaire_supplementaire_ht": 31.25,
  "equipier_supplement_vacation_ht": 125.00,
  "paliers": [
    { "de_h": 0,  "a_h": 4,  "nb_vacations": 1, "prolongation": false },
    { "de_h": 4,  "a_h": 6,  "nb_vacations": 1, "prolongation": true,  "base_h": 4 },
    { "de_h": 6,  "a_h": 8,  "nb_vacations": 2, "prolongation": false },
    { "de_h": 8,  "a_h": 10, "nb_vacations": 2, "prolongation": true,  "base_h": 8 },
    { "de_h": 10, "a_h": 12, "nb_vacations": 3, "prolongation": false },
    { "de_h": 12, "a_h": 14, "nb_vacations": 3, "prolongation": true,  "base_h": 12 }
  ]
}
```

Lecture M07 :
1. Trouver le palier dont `de_h <= duree_heures < a_h`
2. `cout = nb_vacations × tarif_vacation_base_ht`
3. Si `prolongation = true` : ajouter `nb_personnes × cout_horaire_supplementaire_ht × (duree_heures - base_h)`

**Évolution sans code** : si Strike renégocie en 2027 et passe à des paliers de 5h/8h, l'Admin modifie le tableau JSON via UI M13 → calcul mis à jour immédiatement, sans redéploiement.

**2. `grille_matricielle_zone_type_course`** (A Toutes! vélo)

```json
{
  "dimensions": ["zone", "type_course"],
  "cellules": [
    { "zone": "zone_1", "type_course": "complete", "tarif_ht": 42.50 },
    { "zone": "zone_1", "type_course": "incomplete", "tarif_ht": 21.25 },
    { "zone": "zone_2", "type_course": "complete", "tarif_ht": 48.00 },
    { "zone": "zone_2", "type_course": "incomplete", "tarif_ht": 24.00 }
  ],
  "regle_zone_multi_site": "zone_la_plus_haute"
}
```

**3. `grille_matricielle_zone`** (A Toutes! camion ID 91)

```json
{
  "dimensions": ["zone"],
  "cellules": [
    { "zone": "zone_1", "tarif_fixe_ht": 90.00 },
    { "zone": "zone_2", "tarif_fixe_ht": 145.00 },
    { "zone": "zone_3", "tarif_fixe_ht": 190.00 }
  ]
}
```

**4. `forfait_km`** (prestataires province — exemple)

```json
{
  "forfait_base_ht": 80.00,
  "km_inclus": 30,
  "tarif_km_supplementaire_ht": 0.50
}
```

**5. `forfait_fixe`** (prestataires province — tarif forfaitaire sans variable)

```json
{
  "forfait_ht": 120.00
}
```

**Évolution** : ajout d'une 6ème formule = (1) INSERT dans `formules_catalogue` + (2) ajout du bloc de code correspondant dans M07. Pas de migration DB. L'Admin TMS peut désactiver (`statut = 'desactive'`) une formule pour la masquer dans UI M13 sans impacter les grilles existantes.

#### Zones applicables

Les zones (`zone_1`, `zone_2`, etc.) sont définies dans `parametres_tms` niveau 5 (table de correspondance code postal → zone, éditable par Ops Savr). Cf. §03 M07 règles A Toutes!.

---

### Table : `factures_prestataires`

Factures reçues des prestataires logistiques (upload PDF via portail self-service Strike/Marathon/A Toutes! ou Ops Savr pour province). Rapprochement auto avec `tournees.cout_calcule_ht` au sein de la période facturée.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `prestataire_id` | uuid | FK `prestataires(id)`, NOT NULL | |
| `numero_facture` | text | NOT NULL | Numéro prestataire |
| `date_facture` | date | NOT NULL | Date d'émission |
| `date_reception` | timestamptz | NOT NULL, default `now()` | Upload TMS |
| `periode_debut` | date | NOT NULL | Début période facturée |
| `periode_fin` | date | NOT NULL | Fin période facturée |
| `montant_ht_prestataire` | numeric(10,2) | NOT NULL | Tel que facturé par le prestataire |
| `montant_tva` | numeric(10,2) | NOT NULL, default 0 | |
| `montant_ttc_prestataire` | numeric(10,2) | NOT NULL | |
| `montant_ht_calcule_tms` | numeric(10,2) | | Somme `tournees.cout_calcule_ht` sur la période — mis à jour par M08 au rapprochement |
| `ecart_ht` | numeric(10,2) | GENERATED | `montant_ht_prestataire - montant_ht_calcule_tms` |
| `ecart_pourcent` | numeric(5,2) | GENERATED | `CASE WHEN montant_ht_calcule_tms > 0 THEN ecart_ht / montant_ht_calcule_tms * 100 ELSE NULL END` |
| `statut_rapprochement` | text | NOT NULL, default `en_attente` | Enum 7 valeurs : `en_attente`, `ecart_detecte`, `rapprochement_manuel_requis`, `conteste`, `valide`, `regle`, `remplacee_par_avoir` (refonte propagation M08 2026-04-24 D4/D5/D11 + revue sobriété 2026-04-30 D1 `rejetee_pour_correction` fusionné dans `conteste` + flag `conteste_apres_validation` ; **revue sobriété §05 2026-05-01 D1 `rapproche_ok` fusionné dans `valide` direct, auto-validation match exact zéro tolérance**) |
| `conteste_apres_validation` | boolean | NOT NULL, default `false` | **Ajout revue sobriété 2026-04-30 D1** : flag distinguant W6 Ops avant validation (`false`) vs W9 Admin déverrouille post-validation `action=rejetee_pour_correction` (`true`). Permet filtre E1 sous-section "Contestation post-validation" |
| `pdf_url` | text | NOT NULL | Path Storage |
| `pdf_extraction_json` | jsonb | | OCR Mistral V1 : extraction auto à l'upload (numéro, date, période, montants HT/TVA/TTC, lignes si détectables). Préremplit le formulaire. Blocage upload si champ required incomplet (propagation M08 2026-04-24 D3) |
| `source_upload` | text | NOT NULL, default `manager_m03` | Enum `manager_m03`, `ops_manuel` (ajout M08 2026-04-24, simplifié revue sobriété 2026-04-30 B4 — `ops_rectification` fusionné, info portée par `facture_corrigee_id IS NOT NULL`) |
| `facture_corrigee_id` | uuid | FK `factures_prestataires(id)`, nullable | Self-ref : facture que celle-ci rectifie (ajout M08 2026-04-24 D8) |
| `remplacee_par_facture_id` | uuid | FK `factures_prestataires(id)`, nullable | Self-ref inverse : facture qui remplace celle-ci (ajout M08 2026-04-24) |
| `motif_contestation` | text | | Si `conteste` |
| `type_contestation` | text | nullable | **Text libre (revue sobriété §04 2026-04-30 D3 — CHECK constraint enum retiré V1)** — aucun comportement applicatif distinct par valeur. UI E6 M08 propose une dropdown préremplie (`ecart_montant`, `erreur_periode`, `erreur_prestataire`, `erreur_doublon`, `autre`) + saisie libre possible. Sert au reporting/filtrage Ops. |
| `conteste_par_user_id` | uuid | FK `users_tms(id)`, nullable | Qui a contesté (ajout M08 2026-04-24) |
| `conteste_at` | timestamptz | nullable | Horodatage contestation (ajout M08 2026-04-24) |
| `motif_validation_ecart` | text | nullable | Si validation manuelle malgré écart W5 M08 (min 30 car, R_M08.3, ajout M08 2026-04-24) |
| `commentaire_ops` | text | | |
| `uploade_par_user_id` | uuid | FK `users_tms(id)`, NOT NULL | Qui a uploadé |
| `valide_at` | timestamptz | | Horodatage validation. Conservé pour filtres SQL fréquents. |
| `reference_reglement` | text | nullable | Ex référence virement bancaire (ajout M08 2026-04-24) |
| `commentaire_reglement` | text | nullable | (ajout M08 2026-04-24) |
| `regle_at` | timestamptz | | Horodatage règlement effectif (W8 M08). Conservé pour filtres SQL. |
| `exporte_pennylane_at` | timestamptz | nullable | Marquage export Pennylane V1 manuel (ajout M08 2026-04-24 D10) |
| `action_deverrouillage` | text | nullable | Enum `rejetee_pour_correction`, `reouverte_pour_validation` si W9 M08 exécuté (ajout M08 2026-04-24 D11). **Note revue sobriété 2026-04-30 D1** : la valeur `rejetee_pour_correction` ici reste valeur de cette colonne d'audit ; le `statut_rapprochement` correspondant devient `conteste` + `conteste_apres_validation = true` (vs ex-statut dédié supprimé) |
| `motif_deverrouillage` | text | nullable | Motif W9 ≥ 30 car (ajout M08 2026-04-24). Garde RLS active : `motif_deverrouillage IS NOT NULL AND char_length >= 30`. |
| `deverrouillee_at` | timestamptz | nullable | Horodatage déverrouillage (ajout M08 2026-04-24). Conservé pour filtres SQL. |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |
| `deleted_at` | timestamptz | | Soft delete (jamais hard, audit 5 ans) |

**Index** : `(prestataire_id, date_facture DESC)`, `(statut_rapprochement) WHERE deleted_at IS NULL`, `(periode_debut, periode_fin)`, `(numero_facture, prestataire_id)` UNIQUE WHERE `deleted_at IS NULL` (empêche doublons — même numéro prestataire = rectification interdite, D7/D12), `(exporte_pennylane_at) WHERE exporte_pennylane_at IS NULL` (E9 M08 factures à exporter), `(facture_corrigee_id) WHERE facture_corrigee_id IS NOT NULL` (lookup rectifications).

**RLS** : Ops Savr / Admin TMS → tout. Admin TMS seul pour UPDATE `action_deverrouillage` / `motif_deverrouillage` (W9, R_M08.5). Manager prestataire → ses propres factures (`prestataire_id = current_user.prestataire_id`), lecture + INSERT uniquement (pas UPDATE post-création). Chauffeur → pas d'accès.

**Règle de rapprochement auto M08 (propagation 2026-04-24, D4)** :
- À l'INSERT, trigger DB `trg_m08_rapprocher` appelle fonction `tms.m08_rapprocher(id)` synchrone.
- Si au moins une tournée période a `cout_final_ht IS NULL` → `rapprochement_manuel_requis` + alerte N2.
- Sinon, calcul `montant_ht_calcule_tms = SUM(tournees.cout_final_ht)` sur période + prestataire + `statut = terminee` + `cout_final_verrouille = false`.
- **Match exact (au centime)** : `montant_ht_prestataire = montant_ht_calcule_tms` → **`valide` direct (auto-validation, refondu revue sobriété §05 2026-05-01 D1)**, trigger M07 verrouillage tournées + audit_log `M08_FACTURE_AUTO_VALIDEE` + notification N1 informative. Plus d'étape `rapproche_ok` intermédiaire.
- **Sinon** (tout écart) : `ecart_detecte`.
- Zéro seuil, zéro tolérance (propagation M08 2026-04-24 D4). Paramètre d'alerte `m08.seuil_alerte_validation_manuelle_ht` (default 100€) applicable uniquement en W5 validation manuelle, pas au rapprochement.

**Règle verrouillage tournées M08 (propagation 2026-04-24, R_M08.4)** :
- Trigger `trg_m08_verrouiller` BEFORE UPDATE `statut_rapprochement = 'valide'` appelle `tms.m08_verrouiller_tournees(id)` : UPDATE `tournees SET cout_final_verrouille = true, verrouillee_par_facture_id = id`.
- Périmètre tournées : agrégat période uniquement (revue sobriété §04 2026-04-30 A5 — fallback `factures_prestataires_lignes.tournee_id` supprimé, table retirée V1).
- Trigger `trg_m08_deverrouiller` (W9 M08) : reset `cout_final_verrouille = false, verrouillee_par_facture_id = NULL`. **Retiré revue sobriété §04 2026-04-30 B1** — la garde devient `motif_deverrouillage IS NOT NULL AND char_length(motif_deverrouillage) >= 30`. Acteur tracé par `audit_logs.acteur_user_id`.

---

### Table : `factures_prestataires_lignes` — **Supprimée V1 (revue sobriété §04 2026-04-30 A5)**

> **Suppression V1 entérinée 2026-04-30 (revue sobriété §04, A5)** : la table `factures_prestataires_lignes` est **supprimée du périmètre V1**. L'audit visuel des lignes est désormais couvert par `factures_prestataires.pdf_url` (PDF source) + `factures_prestataires.pdf_extraction_json` (OCR Mistral structuré). Ops ouvre le PDF ou consulte le JSON OCR pour visualiser la structure de la facture.
>
> **Conséquences propagées** :
> - Pas de RLS dédiée à créer (table inexistante).
> - Pas de trigger de cohérence `SUM(montant_ligne_ht) = montant_ht_prestataire` (le PDF prestataire fait foi, l'OCR est informatif).
> - `audit_logs` table surveillée : `factures_prestataires_lignes` retirée de la liste (cf. Niveau 5).
> - Périmètre verrouillage M08 (`tms.m08_verrouiller_tournees`) : agrégat période uniquement, plus de fallback `factures_prestataires_lignes.tournee_id`.
> - Index `factures_prestataires(facture_corrigee_id)` conservé (lookup rectifications).
>
> **Réintroduction V1.1** envisageable si rapprochement ligne-à-ligne devient nécessaire métier (litiges fréquents sur lignes spécifiques par exemple).
>
> Pour l'audit Ops V1 : la UI M08 E1 (drawer facture) affiche le PDF intégré (iframe ou viewer) + à droite les champs extraits par OCR depuis `pdf_extraction_json` (lignes, montants, période). C'est suffisant pour comprendre la structure.

---

---

## Niveau 4 — Stock et exutoires

Source : §03 M09 Stock matériel + M10 Gestion exutoires.

### Table : `stocks_rolls_traiteurs`

Stock actuel de rolls Savr déployés chez chaque traiteur, par type. Recalculé à chaque `rolls_mouvements` insertion/update (trigger applicatif niveau 2). Source de vérité TMS, lue par la Plateforme via vue cross-schema `plateforme.v_stocks_rolls` *(revue sobriété §08 Bloc A 2026-05-01 A3 — résidu stale corrigé 2026-06-07)*.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `plateforme_traiteur_id` | uuid | NOT NULL | Miroir `organisations.id` Plateforme |
| `plateforme_lieu_id` | uuid | nullable | Si stock par lieu (cas traiteur multi-entrepôt). NULL = stock traiteur global |
| `type_contenant_id` | uuid | FK `types_contenants(id)`, NOT NULL | Granularité par type (cf. niveau 2) |
| `quantite_actuelle` | integer | NOT NULL, default 0 | Stock courant (peut être négatif si incohérence → alerte M11) |
| `quantite_cible` | integer | | Consigne (ex: 20 rolls biodéchet 240L). Alerte M11 si `quantite_actuelle < 0.5 × quantite_cible` |
| `derniere_maj_at` | timestamptz | NOT NULL, default `now()` | |
| `derniere_maj_par_chauffeur_id` | uuid | FK `chauffeurs(id)`, nullable | Dernière saisie terrain ayant impacté ce stock |
| `derniere_maj_collecte_id` | uuid | FK `collectes_tms(id)`, nullable | Collecte associée à la dernière maj |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |

**Index** : `(plateforme_traiteur_id, type_contenant_id)` UNIQUE WHERE `plateforme_lieu_id IS NULL`, `(plateforme_traiteur_id, plateforme_lieu_id, type_contenant_id)` UNIQUE WHERE `plateforme_lieu_id IS NOT NULL`, `(quantite_actuelle) WHERE quantite_actuelle < 0` (alertes incohérence), `(derniere_maj_at DESC)`.

**RLS** : Ops Savr / Admin TMS → tout. Manager prestataire → pas d'accès (stock Savr, pas prestataire). Chauffeur → pas d'accès direct (lecture via app M05 qui pré-affiche le stock avant saisie).

**Note** : l'historique des mouvements est conservé dans `rolls_mouvements` (niveau 2). Cette table est un **cache calculé** pour perf UI (pas de re-SUM à chaque ouverture de fiche traiteur).

**Exposition cross-schema (revue sobriété §08 Bloc A 2026-05-01 A3)** : cette table est lue par la Plateforme via vue `plateforme.v_stocks_rolls` (joint `tms.types_contenants` pour libellé). **Pas de joint `organisations_lieux`** côté vue (les rolls sont attribués aux traiteurs uniquement, dashboard gestionnaire de lieux supprimé). Plus de webhook S8 push, plus de table miroir `plateforme.lieux_stocks_rolls`, plus de R_M09.7 — TMS = source de vérité unique en lecture directe.

---

### Table : `stocks_bacs_entrepot`

Stock des bacs (biodéchet, déchet résiduel, verre, emballage, carton) à l'entrepôt Savr central. Alimenté par les passages Veolia (sorties) et les réceptions commandes fournisseur (entrées). Affiché sur dashboard Ops global M02 (tuiles-jauges) + page dédiée `/exutoires` M10.

> ⚠ Voir aussi addendum M10 2026-04-25 + V3 sobre 2026-04-30 en tête de doc.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `type_contenant_id` | uuid | FK `types_contenants(id)`, NOT NULL | Ex: bac 1100L biodéchet, bac 240L, etc. |
| `flux` | text | NOT NULL | Enum fermée V1 : `biodechet`, `emballage`, `carton`, `verre`, `dechet_residuel` — un même type de contenant peut exister pour plusieurs flux. Alignement §04 App `flux_dechets` post-refonte 2026-05-02. |
| `quantite_pleine` | integer | NOT NULL, default 0 | Bacs pleins en attente passage Veolia (source W1 trigger clôture tournée ZD + recomptages Ops E7 directs) |
| `quantite_vide_disponible` | integer | NOT NULL, default 0 | Bacs vides disponibles pour sortie tournée |
| `quantite_vide_cible` | integer | | Seuil de réapprovisionnement (alerte M11 `m10_bacs_vides_sous_seuil`) |
| `capacite_max` | integer | NOT NULL, default 0 | Capacité physique max du couple `(flux, type_contenant_id)`. Sert au calcul jauge dashboard. `0` = couple non paramétré, jauge masquée (propagation M10 2026-04-25) |
| `seuil_saturation_pleins` | integer | NOT NULL, default 0 | Seuil absolu R5.3 (en bacs pleins) déclenchant `m10_bac_satur` criticité dynamique (warning ≥85%, critical au-delà ou ≥100%). `0` = pas d'alerte saturation absolue (propagation M10 2026-04-25, fusion B3 V3 sobre 2026-04-30) |
| `emplacement_entrepot` | text | | Libellé zone entrepôt (ex: "Quai A, zone biodéchet") |
| `derniere_maj_at` | timestamptz | NOT NULL, default `now()` | |
| `derniere_maj_par_user_id` | uuid | FK `users_tms(id)`, nullable | |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |

> **Suppression revue sobriété 2026-04-30 B5** : ancienne colonne `quantite_pleine_recomptee` retirée. Le recomptage E7 met à jour `quantite_pleine` directement (la valeur courante reflète déjà le dernier recomptage). Historique des écarts conservé via `recomptages_stocks_entrepot_log`.

**Index** : `(type_contenant_id, flux)` UNIQUE, `(flux)`, `(quantite_vide_disponible) WHERE quantite_vide_disponible < COALESCE(quantite_vide_cible, 0)` (alertes vides), `(quantite_pleine, capacite_max) WHERE capacite_max > 0` (scan jauge ≥ 85% — propagation M10 2026-04-25).

**Contraintes CHECK** : `capacite_max >= 0`, `seuil_saturation_pleins >= 0`, `quantite_pleine >= 0`, `quantite_vide_disponible >= 0` (propagation M10 2026-04-25).

**RLS** : Ops Savr / Admin TMS → tout. Autres rôles → pas d'accès.

---

### Table : `passages_veolia`

Historique des passages Veolia (enlèvement bacs pleins à l'entrepôt Savr). Source : **saisie manuelle Ops Savr V1** (D4 M10 — pas d'import CSV V1, voir addendum M10).

> ⚠ V3 sobre 2026-04-30 (revue de sobriété) : structure simplifiée. Voir addendum M10 §2 en tête de doc pour le détail. **Suppression** des 6 colonnes V2 confirmation effective dual (`confirme_at`, `confirme_par_user_id`, `confirme_par_chauffeur_id`, `confirmation_source`, `auto_confirmee_j7`, `auto_confirmee_at`, `commentaire_confirmation`). **Ajout** de 3 colonnes V3 : `verification_video_at`, `motif_annulation`, `motif_annulation_libre`, `passage_origine_id`. **Réduction** enum `statut` de 5 → 3 valeurs.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `date_prevue` | date | NOT NULL | Date planning Veolia |
| `statut` | text | NOT NULL, default `'planifie'`, CHECK IN (`'planifie'`,`'realise'`,`'annule'`) | Lifecycle V3 : 3 valeurs. `realise` = déclaration Ops (W3 M10), déclenche reset total stock immédiat via `trg_m10_reset_total_pleins`. `annule` terminal avec `motif_annulation` |
| `statut_realise_at` | timestamptz | nullable | Horodatage **du passage effectif** = valeur saisie Ops `date_realise_at` E5/E4 (peut être antérieure au jour de déclaration, ex. passage de la veille — arbitrage 2026-06-07 F2, pas `now()`). NULL tant que `statut <> 'realise'` |
| `verification_video_at` | timestamptz | nullable | **V3 sobre 2026-04-30** : timestamp où Ops a coché "J'ai vérifié via vidéosurveillance que les bacs ont été vidés" en E5. Audit simple inline. Renseigné automatiquement par `tms.m10_declarer_passage_realise`. NULL si statut <> 'realise' |
| `flux` | text | NOT NULL | Flux concerné |
| `nb_bacs_enleves` | integer | CHECK >= 0 | Saisie terrain au passage (audit/facturation V2 — n'impacte plus le stock en V3, R5.4 v3 reset total piloté par transition `statut`) |
| `type_contenant_id` | uuid | FK `types_contenants(id)`, nullable | |
| `poids_total_kg` | numeric(8,2) | | Optionnel si Veolia communique le poids |
| `bsd_numero` | text | | Numéro Bordereau Suivi Déchets si fourni par Veolia (pour V2 BSD) |
| `bsd_url` | text | | PDF BSD si reçu |
| `commentaire` | text | | |
| `cree_par_action` | text | NOT NULL, default `'saisie_manuelle'`, CHECK IN (`'saisie_manuelle'`,`'bouton_declencher'`) | Origine création passage : E4 manuel ou E6 bouton "Déclencher collecte Veolia" (D5) |
| `motif_annulation` | text | nullable, CHECK IN (`'annulation'`,`'report'`,`'autre'`) ou NULL | **V3 sobre 2026-04-30 (D1/B2)** : enum 3 valeurs. NOT NULL si `statut = 'annule'`. Sert au tri E3 + déclenchement W8 (`m10_passage_reporte` vs `m10_passage_annule`) |
| `motif_annulation_libre` | text | nullable | Motif libre saisi à l'annulation. NULL si `statut <> 'annule'` |
| `passage_origine_id` | uuid | FK `passages_veolia(id)`, nullable | Lien optionnel vers passage initial annulé pour motif `'report'`. NULL sinon |
| `saisi_par_user_id` | uuid | FK `users_tms(id)`, NOT NULL | Ops Savr ayant déclaré `realise` (W3 M10) |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |

**Contraintes CHECK V3** :
- `cree_par_action IN ('saisie_manuelle', 'bouton_declencher')`
- `nb_bacs_enleves >= 0`
- `statut IN ('planifie', 'realise', 'annule')` (3 valeurs au lieu de 5 — D1/B1/B2 revue sobriété 2026-04-30)
- `motif_annulation IS NULL OR motif_annulation IN ('annulation', 'report', 'autre')`
- `(statut <> 'annule' AND motif_annulation IS NULL AND motif_annulation_libre IS NULL) OR (statut = 'annule' AND motif_annulation IS NOT NULL)`
- `(statut = 'realise' AND statut_realise_at IS NOT NULL) OR (statut <> 'realise' AND statut_realise_at IS NULL)`

> **Suppressions revue sobriété 2026-04-30** : 4 CHECK constraints conditionnelles cohérence V2 (`confirme_at × confirmation_source × auto_confirmee_j7`) retirées (corollaire suppression dualité A2).

**Index V3** :
- `(date_prevue DESC)`, `(statut, date_prevue)`, `(flux)`, `(bsd_numero)` WHERE NOT NULL
- `(cree_par_action, statut)` (filtre E3 dual)
- `(flux, statut, date_prevue)` — scan E3 / cron W7 (remplace l'ancien index partiel `(statut, confirme_at)`)
- `(statut_realise_at) WHERE statut = 'realise'` — historique passages réalisés (audit + exports)
- `(passage_origine_id) WHERE passage_origine_id IS NOT NULL` — drill-down passages reportés

**Règle de mise à jour `stocks_bacs_entrepot` V3 sobre 2026-04-30** : à la **déclaration `realise`** d'un passage par Ops Savr (transition `statut: planifie → realise` via E5 avec checkbox vidéo obligatoire), trigger DB `trg_m10_reset_total_pleins` V3 simplifié **reset à 0** la `quantite_pleine` du couple `(flux, type_contenant_id)` et incrémente `quantite_vide_disponible` du `quantite_pleine_avant_reset`. Le trigger est défini `AFTER INSERT OR UPDATE` (précision 2026-06-07 : l'INSERT direct `realise` a posteriori R5.8 v3 doit aussi déclencher le reset). Idempotence garantie par RAISE EXCEPTION sur toute transition depuis un état terminal `realise`/`annule` (trigger `trg_m10_anti_deconfirmation` étendu — arbitrage 2026-06-07 F3). Plus de second axe `confirme_at` (corollaire A2).

**Alertes M11 V3 sobre 2026-04-30** (cf. §9 M10 + §11 M11) :
- `m10_passage_non_confirme` criticité dynamique (cron horaire W7 — warning J-1/J+1, critical > 1j de retard) — fusion C1
- `m10_passage_reporte` (warning, escalade critical si saturation simultanée — W8 trigger `motif_annulation = 'report'`)
- `m10_passage_annule` (warning, W8 trigger `motif_annulation IN ('annulation','autre')`)
- `m10_bac_satur` criticité dynamique (W6 — warning ≥85%, critical > seuil_saturation_pleins ou ≥100%) — fusion B3
- `m10_bacs_vides_sous_seuil` (warning, W1)
- `m10_capacite_max_diminuee_satur` (warning, EC9)
- `m10_stock_incoherence` (warning, W1 clamping vides à 0 — EC14 redéfini arbitrage 2026-06-07 F4)

**Bloc 3 sobriété 2026-04-25 A1** : `m10_recomptage_ecart` (info) retiré du catalogue, trace via `tms.audit_logs` action `M10_RECOMPTAGE_ECART` + `recomptages_stocks_entrepot_log`.

> **Suppressions revue sobriété 2026-04-30 (5 codes M10)** : `m10_bac_remplissage_85` fusion B3, `m10_passage_realise_non_confirme_j1`/`_j3` corollaire A2/A4, `m10_passage_auto_confirmee_j7` corollaire A3, `m10_chauffeur_signale_bacs_pleins` corollaire A1.

**RLS** : Ops Savr / Admin TMS → tout. Autres rôles → pas d'accès.

---

---

## Niveau 5 — Admin et audit

Sources : §03 M11 Alerting/monitoring + M13 Admin TMS + obligation Registre transport (conservation 5 ans).

### Table : `parametres_tms`

Source de vérité des paramètres globaux du TMS éditables par Ops Savr / Admin TMS sans redéploiement. Structuré en clé-valeur typée avec namespace pour éviter les collisions.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `namespace` | text | NOT NULL | Regroupement logique (ex: `facturation`, `attribution`, `zones`, `stock`, `alertes`, `mobile`) |
| `cle` | text | NOT NULL | Identifiant stable (ex: `seuil_tolerance_ht`, `palier_rolls_par_pax_seuils`) |
| `libelle` | text | NOT NULL | Affichage UI M13 |
| `description` | text | | Aide contextuelle |
| `type_valeur` | text | NOT NULL | Enum `number`, `integer`, `string`, `boolean`, `json`, `date` |
| `valeur` | jsonb | NOT NULL | Stockage unifié — cast applicatif selon `type_valeur` |
| `unite` | text | | Ex: "€", "kg", "%", "heures", "km" — affichage UI |
| `valeur_min` | jsonb | | Validation applicative (ex: seuil %: entre 0 et 100) |
| `valeur_max` | jsonb | | |
| `modifiable_par` | text[] | NOT NULL, default `['admin_tms']` | Values : `admin_tms`, `ops_savr` |
| `derniere_maj_par_user_id` | uuid | FK `users_tms(id)`, nullable | |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | Trace via `audit_logs` |

**Index** : `(namespace, cle)` UNIQUE, `(namespace)`.

**RLS** : lecture **staff uniquement** (`admin_tms` + `ops_savr`) *(tranché Val 2026-06-07 test-scenarios M13 F5 — ex-"lecture tous authentifiés" corrigé : config business non exposée aux prestataires/chauffeurs ; les apps clientes lisent leurs paramètres via Edge Function cache 60s, D6 M13)*. Écriture selon `modifiable_par[]` (vérifié via fonction policy qui croise `current_user.roles` et `parametres_tms.modifiable_par`).

**Seed V1 (principaux paramètres)** :

*Namespace `facturation`* — **vide V1 (purgé 2026-06-11, audit data model)** : les seeds `seuil_tolerance_ht` (10 €) et `seuil_tolerance_pourcent` (2 %) contredisaient la décision **D4 M08 zéro tolérance** (2026-04-24) qui les a explicitement supprimés. Le seul seuil M08 vivant est `m08.seuil_alerte_validation_manuelle_ht` (100 €, namespace `m08`, validation manuelle W5 uniquement).

*Namespace `attribution`* (M12) — **réduit à 2 paramètres TMS-only (purgé 2026-06-11, audit data model — ce bloc seed était périmé depuis la refonte A1+A4 2026-05-09 qui a migré les `regle_ag_*` côté Plateforme ; il portait en plus un `regle_ag_seuil_h2_minutes : 120` divergent de la valeur canonique **90** de `plateforme.parametres_algo`)* :
- `province_tri_secondaire_code` : `nb_collectes_6_mois_asc`
- `regle_zd_prestataire_prioritaire_code` : `strike` (F2 2026-06-07)
- Tous les autres (`regle_ag_seuil_pax_velo`, `regle_ag_plage_velo_debut/fin`, `regle_ag_seuil_h2_minutes` = **90**, `a_toutes_indisponible`, `everest_codes_postaux`, `poids_par_repas_kg`) vivent dans `plateforme.parametres_algo` — source de vérité unique, cf. addendum M12 §5.

*Namespace `zones`* (A Toutes!) — **seed réel figé 2026-06-07 (arbitrage Val : « communes limitrophes » = petite couronne entière, mapping par département)** :
- `zones_codes_postaux_mapping` : jsonb — lookup par **préfixe département** (2 premiers caractères du code postal), plus de liste de communes à maintenir :
  ```json
  {
    "75": "paris",
    "92": "communes_limitrophes",
    "93": "communes_limitrophes",
    "94": "communes_limitrophes"
  }
  ```
  Préfixe absent du mapping = **hors zone** → A Toutes! exclu de la suggestion M12 (garde, cf. §05 R1.3) ; si attribution forcée par Ops → coût en saisie manuelle (§05 R2.6).
  ⚠ **Couverture ≠ pricing (clarifié 2026-06-11, audit data model, aligné arbitrage Val)** : la **couverture opérationnelle** Everest est pilotée exclusivement par `plateforme.parametres_algo.everest_codes_postaux` = `['75','92','93']` (source de vérité unique). Le « 94 » de ce mapping est une **zone de pricing** (grille réelle « petite couronne », figée 2026-06-07) — sa présence n'étend **pas** la couverture : un lieu en 94 reste hors suggestion Everest tant que `everest_codes_postaux` ne l'inclut pas. Étendre la couverture = modifier les **deux** paramètres.
- `zones_ordre_priorite` : jsonb `["paris", "communes_limitrophes"]` — ordre croissant pour `regle_zone_multi_site = zone_la_plus_haute` (R2.3 : chargement + livraison → zone la plus haute = `communes_limitrophes`).

*Namespace `stock`* :
- `palier_rolls_par_pax_seuils` : `[{"pax_max": 100, "rolls": 1}, {"pax_max": 200, "rolls": 2}, {"pax_max": 400, "rolls": 4}, {"pax_max": 800, "rolls": 8}, {"pax_max": null, "rolls": null}]` — null/null = saisie manuelle Ops requise >800 pax *(tranché Val 2026-06-07 floue #4 M09 : ex-`palier_rolls_par_pax_biodechet_seuils` avec seed 50/150 + `rolls: 12` divergents — seed M09 E5 fait foi)*
- `seuil_alerte_stock_roll_pct` : 50 (alerte si stock < 50% de la cible)

*Namespace `alertes`* :
- `seuil_alerte_pesee_min_kg_par_pax_biodechet` : 0.10
- `seuil_alerte_pesee_max_kg_par_pax_biodechet` : 0.80
- `seuil_alerte_pesee_min_kg_par_pax_emballage` : 0.02
- `seuil_alerte_pesee_max_kg_par_pax_emballage` : 0.20
- *(idem par flux ZD, à calibrer à l'usage — cf. §00 Question 14)*
- `delai_alerte_permis_jours_avant_expiration` : 30
- `delai_alerte_controle_technique_jours_avant_expiration` : 30

*Namespace `mobile`* :
- `photo_aucun_repas_obligatoire` : true
- `commentaire_aucun_repas_obligatoire` : true

*Namespace `m04`* (tournées — propagation 2026-04-29 ; complété 2026-06-06 — seed des 5 clés documentées M04 §11) :
- `m04_tournee_tampon_minutes` : 30 (durée tampon ajoutée à `max(heure_collecte)` pour auto-suggérer `heure_planifiee_fin` à la création tournée. Saisie Ops éditable.)
- `m04_seuil_distance_cloture_metres` : 300 (rayon de tolérance géoloc à la clôture tournée, R_M04.2 ; > seuil → `cloture_hors_zone=true` + alerte `m04_cloture_hors_zone` warning, non bloquant)
- `m04_coords_gps_entrepot` : `{"lat": <lat Savr Paris>, "lng": <lng Savr Paris>}` (point de référence clôture ZD — à seeder avec les coordonnées réelles de l'entrepôt)
- `m04_seuil_inactivite_tournee_heures` : 8 (au-delà, le cron `cron_m04_alerte_inactivite_tournee` émet `m04_tournee_oubliee_cloture_auto` warning — clôture forcée Ops possible, cf. M11 §11.6)
- `m04_seuil_delta_cout_correction_pct` : 20 (seuil d'alerte `m04_ecart_cout_dispatch` warning sur delta coût après correction durée W8)
- `m04_delai_assignation_chauffeur_alerte_heures` : 17 (heure J-1 à laquelle le cron émet `m04_tournee_sans_chauffeur_j1` warning si une tournée J+0 n'a pas de chauffeur)

**Design** : tout nouveau paramètre métier = INSERT dans `parametres_tms`, jamais de hardcoding dans le code applicatif.

---

### Table : `audit_logs`

Registre chronologique de toutes les mutations sur entités critiques. Rétention **5 ans minimum** (obligations Registre transport + BSD V2 + cohérence RSE). Alimenté par triggers DB (PostgreSQL `AFTER INSERT/UPDATE/DELETE`).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `acteur_user_id` | uuid | nullable, **pas de FK** (snapshot uuid — table partagée App+TMS, append-only ; A4 Option A) | NULL si mutation système (webhook, cron, trigger auto) |
| `acteur_type` | text | NOT NULL, CHECK IN (`'user'`,`'systeme'`,`'webhook'`,`'cron'`,`'migration'`) | Enum 5 valeurs (revue sobriété §04 2026-04-30 D2 — fusion `webhook_plateforme` + `webhook_everest` → `webhook`, détail source dans `acteur_meta.source`). Migration : `UPDATE audit_logs SET acteur_type = 'webhook', acteur_meta = jsonb_set(COALESCE(acteur_meta, '{}'::jsonb), '{source}', to_jsonb(replace(acteur_type, 'webhook_', ''))) WHERE acteur_type IN ('webhook_plateforme', 'webhook_everest')`. |
| `acteur_meta` | jsonb | | Infos complémentaires si pertinent (ex: `{ ip, user_agent }` pour user ; `{ source: 'plateforme', event_id }` pour webhook) |
| `table_name` | text | NOT NULL | Ex: `tournees`, `pesees`, `factures_prestataires` |
| `row_id` | uuid | NOT NULL | PK de la ligne impactée |
| `action` | text | NOT NULL, CHECK regex `^[A-Z][A-Z0-9_]*$` | Convention MAJUSCULE_SNAKE_CASE. Liste non exhaustive (V1) : `INSERT`, `UPDATE`, `DELETE`, `SOFT_DELETE`, `RESTORE`, `EXPORT_DASHBOARD`, `AUDIT_403_ACCESS`, `FORCE_LOGOUT_CHAUFFEUR`, `M12_OVERRIDE_ENRICHED`, `M10_RECOMPTAGE_ECART`, `DEVERROUILLAGE_FACTURE`, `PESEE_TARE_OVERRIDE`, `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `LOGIN_MFA`, `SNAPSHOT_SYNC`, `SNAPSHOT_OVERRIDE`, `IMPERSONATION_START`, `IMPERSONATION_END`, `SECRET_REVEAL`, `SECRET_ROTATE`. Toute nouvelle action doit suivre la convention. *(propagation §11 2026-04-27 — assouplissement enum vers text + CHECK)* |
| `diff` | jsonb | NOT NULL | Pour update : `{ before: {...}, after: {...} }` (uniquement champs modifiés). Pour insert : `{ after: {...} }`. Pour delete : `{ before: {...} }` |
| `commentaire` | text | | Justification métier si fournie (ex: motif ajustement pesée) |
| `request_id` | uuid | | Corrélation avec `integrations_logs` (même request_id pour une même opération API) |
| `created_at` | timestamptz | NOT NULL, default `now()` | Immutable |

**Index** : `(table_name, row_id, created_at DESC)`, `(acteur_user_id, created_at DESC)`, `(action, created_at DESC)`, `(created_at DESC)` BRIN pour scan temporel, `(request_id)` WHERE NOT NULL.

**Partitioning** : partition par mois sur `created_at` (PostgreSQL native partitioning). Permet la purge > 5 ans par `DROP PARTITION` au lieu de `DELETE` ligne-par-ligne. ⚠ **PK composite obligatoire (corrigé 2026-06-11, audit data model)** : sur une table partitionnée, Postgres exige que la clé de partition fasse partie de la PK → **PK `(id, created_at)`** (et non `id` seul). L'unicité de `id` seul n'est pas garantie cross-partitions par contrainte DB — acceptable (uuid v4, collision négligeable, aucune FK entrante : `acteur_user_id` est volontairement sans FK).

**Tables surveillées V1** (trigger AFTER pour chacune) — **14 tables après revue sobriété §04 2026-04-30 B3** (réduction de 17→14 : retrait `types_vehicules`, `types_contenants`, `formules_catalogue`) :
- `collectes_tms`, `tournees`, `pesees`, `rolls_mouvements`, `incidents`
- `factures_prestataires`, `grilles_tarifaires_prestataires` (revue sobriété §04 2026-04-30 A5 — `factures_prestataires_lignes` retirée, table supprimée V1)
- `chauffeurs`, `vehicules`, `prestataires`
- `passages_veolia`, `parametres_tms`, `users_tms`, `audit_logs` (immuable mais surveillance des INSERTS via partitioning)

**Tables NON surveillées V1** (bruit opérationnel ou volumétrie de mutation très faible) :
- `integrations_logs`, `integrations_inbox` (audit propre à l'observabilité intégrations — niveau 6)
- `stocks_rolls_traiteurs`, `stocks_bacs_entrepot` (caches calculés depuis des tables déjà auditées)
- **Retirées V1 (revue sobriété §04 2026-04-30 B3)** — référentiels admin à mutations rares. `parametres_tms` couvre déjà la surveillance config. Réintroduction immédiate possible si besoin réglementaire (ALTER trigger).

**Règles** :
- Immutable : pas d'UPDATE ni DELETE sur `audit_logs` (policy RLS restrictive + GRANT ajusté). Seule exception : DROP de partition > 5 ans.
- RLS : Ops Savr / Admin TMS → lecture seule. Pas d'écriture manuelle (triggers uniquement). Manager prestataire → lecture limitée aux lignes où `diff` concerne son périmètre (complexe : lookup croisé via `table_name` + `row_id`, V1 = pas d'accès, V2 si besoin métier).

**Décisions clés** :
- Triggers DB (pas applicatif) pour garantir qu'aucune mutation hors `audit_logs` ne soit possible.
- Partitioning mensuel obligatoire V1 (avant volumétrie problématique).
- `diff` au format `{before, after}` : choix entre `jsonb_diff` complet vs diff champ-par-champ → on stocke seulement les champs modifiés (plus léger, lisible UI Ops).

---

---

## Niveau 6 — Intégrations

Source : §08 Contrat API Plateforme-TMS + §03 M14 Intégration Everest. Tables miroir côté Plateforme déjà posées dans §04 Plateforme niveau 7 (schéma aligné, mais DB distinctes).

### Table : `integrations_logs`

Trace canonique de tous les events d'intégration (sortants + entrants), tous systèmes confondus (Plateforme, Everest, autres). Source unique de vérité observabilité. Rétention **2 ans** (cf. §08 décision).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `system` | text | NOT NULL | Enum `plateforme`, `everest`, `autre` |
| `direction` | text | NOT NULL | Enum `entrant`, `sortant` |
| `type_event` | text | NOT NULL | Nom du webhook ou endpoint (ex: `collecte-upsert`, `collecte-terminee`, `incident`, `tournee-upsert`, `plaque-saisie`, `course-cout-calculee`, `traiteur-stock-rolls-update`, `sync-poll`, `mission-create`, `mission-update`) |
| `event_id` | uuid | INDEX | Identifiant métier de l'event (clé d'idempotence). Miroir de `Idempotency-Key` HTTP |
| `ressource_type` | text | | Ex: `collecte`, `tournee`, `pesee`, `incident`, `facture_prestataire` |
| `ressource_id` | uuid | | PK de la ressource TMS concernée |
| `url` | text | | URL cible (sortant) ou source (entrant) |
| `http_method` | text | | `POST`, `GET`, `PUT`, `PATCH`, `DELETE` |
| `http_status` | integer | | Code retour |
| `payload` | jsonb | | Corps (masquage si PII) |
| `reponse` | jsonb | | Réponse reçue |
| `occurred_at` | timestamptz | | Horodatage métier (ordre authoritative) |
| `tentative_num` | integer | NOT NULL, default 1 | 1 = première, 2-4 = retries (3 paliers §08 Bloc B B1 — corrigé 2026-06-07 test-scenarios M13 F3, ex-"2-5") |
| `statut` | text | NOT NULL | Enum `succes`, `echec_retry`, `echec_final`, `duplique` |
| `prochaine_tentative_at` | timestamptz | | Planifié par retry policy canonique **3 paliers : 5 min / 1h / 24h** + jitter ±10% (§08 Bloc B B1 — corrigé 2026-06-07 test-scenarios M13 F3, ex-5 paliers stale) |
| `duree_ms` | integer | | Latence requête |
| `request_id` | uuid | | Corrélation avec `audit_logs` |
| `created_at` | timestamptz | NOT NULL, default `now()` | |

**Index** : `(system, direction, created_at DESC)`, `(event_id)`, `(statut) WHERE statut = 'echec_final'`, `(prochaine_tentative_at) WHERE statut = 'echec_retry'`, `(ressource_type, ressource_id)`, `(created_at DESC)` BRIN.

**Partitioning** : mensuel sur `created_at`. Purge > 2 ans via DROP PARTITION. ⚠ **PK composite `(id, created_at)`** (corrigé 2026-06-11 — même contrainte Postgres que `audit_logs` : la clé de partition doit faire partie de la PK ; aucune FK entrante sur cette table).

**RLS** : Ops Savr / Admin TMS → tout. Autres rôles → pas d'accès.

**Règles** :
- Pas de UPDATE destructif : chaque retry = nouvelle ligne avec `tentative_num` incrémenté.
- Après 3 retries (4 tentatives au total, §08 Bloc B B1 — corrigé 2026-06-07 test-scenarios M13 F3) → `statut = echec_final` + alerte Admin TMS (M11).
- Masquage PII : `payload.chauffeur.telephone`, `payload.chauffeur.email`, `payload.numero_permis` chiffrés ou masqués à l'insert.

---

### Table : `integrations_inbox`

Déduplication des events entrants (anti-replay **7 jours** — revue sobriété §08 Bloc B 2026-05-01 B5, retour ex-30j post-B_M01_01 : avec polling supprimé Bloc A A4, retry max va à 24h donc re-émission >7j inexistante. Logs 2 ans assurent l'audit forensic). Cohérente avec la table miroir côté Plateforme (§04 Plateforme niveau 7).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `event_id` | uuid | PK | Clé d'idempotence (de `body.event_id` payload — header `Idempotency-Key` supprimé revue sobriété §08 Bloc C 2026-05-01 C4) |
| `type` | text | NOT NULL | Ex: `collecte-upsert`, `collecte-annulee`, `tournee-ack` (depuis Plateforme) |
| `source` | text | NOT NULL | Enum `plateforme`, `everest`, `autre` |
| `occurred_at` | timestamptz | NOT NULL | Horodatage métier émetteur |
| `recu_le` | timestamptz | NOT NULL, default `now()` | Horodatage réception TMS (= `traite_le` dans le pattern Bloc D D6 : insertion APRÈS traitement réussi seulement) |
| `traite_le` | timestamptz | | Horodatage traitement effectif (égal à `recu_le` post-Bloc D D6) |
| `statut` | text | NOT NULL | **Enum 3 valeurs** (post-revue sobriété §08 Bloc D 2026-05-01 D6, aligné §08 contrat) : `traite`, `ignore_doublon`, `ignore_out_of_order`. // retirés (insertion BDD APRÈS traitement réussi seulement, donc valeurs jamais atteintes en pratique). Dédup garantie par PK `event_id`. Échecs traités via `integrations_logs` (table dédiée audit/forensic 2 ans). |
| `payload_hash` | text | | SHA-256 du payload — détection incohérence replay avec même `event_id` mais payload différent |

**Index** : `(type, recu_le DESC)`, `(recu_le)` BRIN. *(Index partiel `(statut) WHERE statut IN ('en_cours','echec')` retiré 2026-06-11, audit data model — ces valeurs n'existent plus dans l'enum 3 valeurs post-Bloc D D6 ; les échecs vivent dans `integrations_logs`.)*

**Purge automatique** : job cron quotidien supprime les lignes `WHERE recu_le < now() - interval '7 days'` *(harmonisé 2026-06-11, audit data model — la valeur 30j datait de B_M01_01 2026-04-30, annulée par la revue sobriété §08 Bloc B B5 2026-05-01 qui a ramené le TTL à **7 jours**, cf. en-tête de cette table + Principes généraux + §04 Plateforme. Une seule valeur : 7 jours.)*. Permet de réduire la table pour perf dédup.

**Règle anti-replay** : à chaque webhook entrant :
```
1. Lookup par event_id
2. Si trouvé AND statut = 'traite' → renvoyer 200 OK sans retraiter (dédup)
3. Si trouvé AND payload_hash != nouveau → alerte sécurité (replay malveillant)
4. Sinon INSERT + traiter
```

**RLS** : Ops Savr / Admin TMS → lecture. Pas d'écriture manuelle (logique applicative uniquement).

---

### Table : `everest_missions`

Mapping 1:1 ↔ N entre tournées TMS et missions Everest (A Toutes!). Permet de pousser une tournée TMS vers Everest (création mission) et de recevoir les updates d'Everest (affectation coursier, statut, preuve de course). Cf. §03 M14.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `tournee_id` | uuid | FK `tournees(id)`, NOT NULL | |
| `collecte_tms_id` | uuid | FK `collectes_tms(id)`, nullable | Si 1 mission Everest = 1 collecte (cas vélo mono-collecte). NULL si mission couvre toute la tournée (camion multi-collectes) |
| `everest_mission_id` | text | UNIQUE, nullable | Identifiant Everest. **Nullable (test-scenarios M14 2026-06-07, floue #3 tranchée Val)** : NULL autorisé uniquement si `statut_everest IN ('creation_failed','created_manually')` (W1 échec / W4 pré-dispatch : Everest n'a renvoyé aucun ID). CHECK dédié ci-dessous. UNIQUE ignore les NULL. |
| `everest_service_id` | smallint | NOT NULL, CHECK `IN (71, 75, 91)` | `71` vélo standard AG, `75` vélo express last-minute, `91` camion backup Marathon — cf. §03 M12. **(Harmonisé test-scenarios M14 2026-06-07, floue #5 : ex-`text` « 71 ou 91 », 75 manquant — aligné sur `collectes_tms.everest_service_id_target`)** ⚠ **QO gate Everest (notée 2026-06-11, arbitrage Val : référentiel = mapping Plateforme §08 §3 / C2 2026-05-09 = 71/75/91)** : le compte test A Toute! reçu le 2026-06-10 expose des services **71/74/77/91** — le `75` express est à reconfirmer avec Mathieu (Everest) à la session « Spec technique Everest API V1 », avant de coder l'adapter V1.1. Si l'ID réel diffère, corriger ce CHECK + `everest_service_id_target` + le mapping §08 §3 App en une seule passe. Aucun impact go-live (adapter Everest hors scope, gate active). |
| `everest_client_id` | text | NOT NULL | Snapshot `prestataires.everest_client_id` au moment du push |
| `statut_everest` | text | NOT NULL | **Propagation M14 2026-04-25** — Enum 10 valeurs : `created`, `assigned`, `in_progress`, `completed`, `completed_incomplete` (W5 OK), `cancelled` (W3 TMS-initiated), `cancelled_externally` (W2 cancelled non-TMS), `failed` (W2 mission_failed), `creation_failed` (W1 retry échec), `created_manually` (W4 acceptation manuelle Ops) |
| `coursier_nom` | text | | Si Everest communique le coursier affecté |
| `coursier_telephone` | text | | |
| `vehicule_type_everest` | text | | Ex: `bike_cargo`, `truck` |
| `cout_everest_ht` | numeric(10,2) | | Retourné par Everest (peut différer du `cout_calcule_ht` TMS — cf. §03 M12 alternative estimate) |
| `preuve_course_url` | text | | PDF ou photo fournie par Everest |
| `payload_create` | jsonb | | Snapshot du payload envoyé à la création |
| `payload_latest_update` | jsonb | | Dernier webhook Everest reçu |
| `push_create_at` | timestamptz | | Horodatage création mission (POST `/missions`) |
| `manual_acceptance_at` | timestamptz | nullable | **Propagation M14 2026-04-25** — Horodatage W4 acceptation manuelle Ops |
| `manual_acceptance_by_user_id` | uuid | FK `users_tms(id)`, nullable | **Propagation M14 2026-04-25** — Ops qui a saisi |
| `manual_acceptance_contact` | text | nullable | **Propagation M14 2026-04-25** — Contact A Toutes! joint au téléphone (obligatoire si `created_manually`) |
| `manual_acceptance_commentaire` | text | nullable | **Propagation M14 2026-04-25** — Note Ops (optionnel) |
| `derniere_sync_at` | timestamptz | NOT NULL | Dernière maj (reçue ou poussée) |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | |

**Index** : `(tournee_id)`, `(collecte_tms_id)`, `(everest_mission_id)` UNIQUE, `(statut_everest, derniere_sync_at DESC)`, `(statut_everest, derniere_sync_at DESC) WHERE statut_everest IN ('creation_failed','cancelled_externally','failed')` (propagation M14 2026-04-25 — alertes E1).

**CHECK constraint** (propagation M14 2026-04-25) : `((statut_everest = 'created_manually') = (manual_acceptance_at IS NOT NULL AND manual_acceptance_by_user_id IS NOT NULL AND manual_acceptance_contact IS NOT NULL))` — cohérence statut/colonnes manual.

**CHECK constraint** (test-scenarios M14 2026-06-07, floue #3 tranchée Val) : `((statut_everest IN ('creation_failed','created_manually')) OR everest_mission_id IS NOT NULL)` — seuls les états sans réponse Everest (échec création W1, acceptation manuelle W4 pré-dispatch) peuvent avoir `everest_mission_id` NULL.

**RLS** : Ops Savr / Admin TMS → tout. Manager A Toutes! → missions liées à ses tournées (`tournees.prestataire_id = current_user.prestataire_id`). Autres → pas d'accès.

**Décisions** :
- **Granularité 1 collecte = 1 mission vélo** (V1) : une tournée A Toutes! vélo contient typiquement 1 collecte (créneau serré, vélo unique). Si le dispatch groupe plusieurs collectes sur un même vélo (improbable V1), une mission par collecte facilite le suivi et la facturation.
- **Granularité 1 tournée = 1 mission camion** (V1) : camion A Toutes! ID 91 peut regrouper N collectes, une seule mission Everest.
- **Source de vérité coût** : `tournees.cout_calcule_ht` prime sur `cout_everest_ht`. `cout_everest_ht` conservé pour audit et rapprochement facture A Toutes!.
- **Statut chauffeur app TMS** : les chauffeurs A Toutes! utilisent l'app mobile TMS (saisie pesée, photo, rolls). Ils ne voient pas Everest.

---

---

## RLS multi-tenant

### Principe général

L'isolation repose sur `users_tms.prestataire_id` et `users_tms.roles[]`. Un prestataire ne voit **jamais** les données d'un autre prestataire. Ops Savr et Admin TMS voient tout.

### Matrice d'accès par table

| Table | Ops Savr / Admin TMS | Manager prestataire | Chauffeur |
|-------|----------------------|---------------------|-----------|
| `prestataires` | RW | R (son record uniquement) | - |
| `users_tms` | RW | R sur users du même `prestataire_id` | R son propre record |
| `chauffeurs` | RW | RW sur `prestataire_id = self` | R son propre record |
| `types_vehicules` | RW | R | R |
| `vehicules` | RW | RW sur `prestataire_id = self` | R ses véhicules assignés |
| `collectes_tms` | RW | RW sur `prestataire_id = self` | R ses tournées |
| `tournees` | RW | RW sur `prestataire_id = self` | R où `chauffeur_id OR equipier_id = self` |
| `pesees` | RW | R sur tournées de `prestataire_id = self` | RW ses propres saisies |
| `types_contenants` | RW (Admin TMS), R (Ops Savr) *(tranché Val 2026-06-07, floue #3 M09)* | R | R |
| `rolls_mouvements` | RW | R | RW ses propres saisies |
| `incidents` | RW | R sur ses tournées + R incidents déclarés | RW ses propres déclarations |
| `formules_catalogue` | RW (Admin TMS), R (Ops Savr) | R | - |
| `grilles_tarifaires_prestataires` | RW | R sur `prestataire_id = self` | - |
| `factures_prestataires` | RW | RW sur `prestataire_id = self` (upload oui, validation non) | - |
| `stocks_rolls_traiteurs` | RW | - | - |
| `stocks_bacs_entrepot` | RW | - | - |
| `passages_veolia` | RW | - | - |
| `parametres_tms` | RW selon `modifiable_par[]` | R | - |
| `audit_logs` | R | - (V1) | - |
| `integrations_logs` | R | - | - |
| `integrations_inbox` | R | - | - |
| `everest_missions` | RW | R si `prestataire_id = self` AND `integration_externe = 'everest'` | - |

**Légende** : RW = lecture + écriture, R = lecture seule, `-` = pas d'accès.

### Implémentation Supabase

- Chaque table a des policies dédiées par rôle.
- Fonction helper SQL `auth.user_prestataire_id()` et `auth.user_has_role(text)` pour factoriser.
- Bypass via `service_role` pour les Edge Functions internes (webhook ingestion, M07 calcul coût, etc.) — pas exposé au front.

### Tests RLS obligatoires

Suite de tests SQL dédiée (cf. §15 Sécurité TMS) :
- Un manager Strike ne peut pas lire un `tournees.id` Marathon (tentative explicite → 0 lignes).
- Un chauffeur A Toutes! ne peut pas lire une `pesees` d'une tournée qui n'est pas la sienne.
- Un Ops Savr peut lire + modifier toutes les tables sauf `audit_logs`.

---

## Index critiques (récapitulatif)

Index sensibles aux perf V1 (à surveiller en production) :
- `collectes_tms(prestataire_id, statut_dispatch)` — dashboard dispatch M02 (requête la plus fréquente)
- `tournees(prestataire_id, date_planifiee)` — portail prestataire M03
- `tournees(chauffeur_id, date_planifiee)` — app mobile M05
- `pesees(collecte_tms_id, flux, ordre_pesee)` — récap collecte
- `factures_prestataires(prestataire_id, date_facture DESC)` — historique facturation M08
- `audit_logs(table_name, row_id, created_at DESC)` — drill-down historique
- `integrations_logs(statut) WHERE statut = 'echec_final'` — alerting M11
- `integrations_logs(prochaine_tentative_at) WHERE statut = 'echec_retry'` — scheduler retry

BRIN sur `audit_logs.created_at` + `integrations_logs.created_at` (partitioning mensuel).

---

---

## Décisions structurantes

### Architecture et conventions
- **Caduc (purgé 2026-06-11, audit data model — décision annulée dès le 2026-04-23, atelier frère)** : architecture réelle = **1 projet Supabase, 3 schémas** (`plateforme.*`/`tms.*`/`shared.*`), RLS cross-schema deny, FK cross-schema interdites sauf `shared.prestataires` + `shared.fichiers` (cf. addendum architectural en tête de doc).
- **Source de vérité par entité** : voir tableau ci-dessus (2026-04-22)
- **Duplication métier côté TMS (Option A)** : `collectes_tms` recopie les champs métier utiles (flux, traiteur_nom, lieu_adresse, heure_collecte, nb_pax) pour autonomie TMS si Plateforme indisponible. Synchro via webhook `collecte-upsert` (2026-04-22, propagation heure_collecte 2026-04-29)
- **Mutualisation coûts tournée** : le coût tournée est réparti **au prorata du nombre de collectes**, écrit sur `collecte_tournees.cout_reparti_centimes` par `trg_m07_calc_cost`. **Forme caduque purgée 2026-06-11** : côté Plateforme c'est la **vue `v_courses_logistiques`** (grain 1 ligne par couple collecte×tournée, `tournee_id` NON unique — contrat figé audit 2026-05-26), **non créée en V1** (décision Val 2026-06-10). (2026-04-22, refondu 2026-05-25 multi-camions)
- **Multi-camions : collecte ↔ tournée N↔N (2026-05-25)** : table de liaison `tms.collecte_tournees` (miroir `plateforme.collecte_tournees`), `collectes_tms.tournee_id` retiré. Une collecte volumineuse (ex. 3000 pax ZD) est servie par N tournées = N camions, chacun pouvant être un véhicule/type différent. **Arbitrages Val** : (1a) liaison N↔N ; (2a) `cout_reparti_centimes` + `ordre_dans_tournee` déplacés sur la liaison (1 valeur par couple collecte×tournée), coût total collecte = SUM ; (3b) dispatch = bouton "Ajouter un camion" (N illimité) ; (4) S5 terminal unique par collecte après agrégation des N camions ; (6a) **clôture chauffeur = clôture de SA tournée** ; le statut collecte (`realisee`) est **dérivé** quand toutes ses tournées sont `terminee` (reframe R6.2 §05, lève le deadlock circulaire). L'App ne porte aucun champ "nombre de camions" — le découpage est interne au dispatch TMS (M02/M04). Acceptation prestataire **inchangée** (par collecte, avant constitution des tournées).
- **Conventions nommage** : pluriel snake_case, PK `id` uuid v4, préfixe `plateforme_*` pour FK externes (2026-04-22)
- **Soft delete sur entités à conserver** pour audit : `chauffeurs`, `vehicules`, `prestataires`, `factures_prestataires`, `incidents` (2026-04-22)
- **Timestamps `sync_occurred_at` + `sync_last_event_id`** sur toutes entités synchronisées avec la Plateforme (dédup + ordre) (2026-04-22)

### Identité et personnes
- **Séparation `chauffeurs` / `users_tms`** : un chauffeur peut exister sans compte actif (cas migration MTS-1 + vacataire déclaré par manager). Pollution Auth évitée (2026-04-22)
- **Fusion `chauffeurs` et équipiers** avec flag `peut_conduire boolean` : équipier Strike = chauffeur `peut_conduire=false` sans permis (2026-04-22)

### Véhicules et contenants
- **`types_vehicules` paramétrable** par Ops Savr (UI M06 E6) : seed V1 = Camion 20m³, Fourgon 16m³, Camion frigo, Vélo cargo. Extension sans redéploiement (2026-04-22, propagation M06 2026-04-24)
- **`types_contenants` paramétrable** par Ops Savr : ajout types + modification tares. Snapshot de la tare sur `pesees` pour éviter réécriture historique (2026-04-22)

### Tarification et financier
- **Fusion grilles et formules** en table unique `grilles_tarifaires_prestataires` (1 ligne = 1 grille par `(prestataire, type_vehicule, période)`) (2026-04-22)
- **Catalogue DB des formules** (`formules_catalogue`) : activation/désactivation par Admin TMS sans redéploiement, JSON Schema par formule pour UI dynamique (2026-04-22)
- **Règle Strike à paliers** (remplace `floor(durée/6)+1`) : 0-4h → 1 vacation ; 4-6h → 1 vacation + n_pers × cout_horaire × (t-4) ; 6-8h → 2 vacations ; 8-10h → 2 vacations + n_pers × cout_horaire × (t-8) ; etc. Propagation §03 M07 à faire (2026-04-22)
- **Coût horaire supplémentaire paramétrable par prestataire** dans `grilles_tarifaires_prestataires.parametres_formule` (pas de hardcoding) (2026-04-22)
- **Retiré V1 (propagation M08 2026-04-24, D4 zéro tolérance)** — match exact obligatoire, paramètres `seuil_tolerance_ht/pct` supprimés, remplacés par `m08.seuil_alerte_validation_manuelle_ht` (100€) applicable en validation manuelle W5 seulement
- **Supprimé revue sobriété 2026-04-30 B1 + A5** — rapprochement V1 = global uniquement, **table `factures_prestataires_lignes` entièrement supprimée V1** (revue sobriété §04 2026-04-30 A5). L'audit visuel Ops repose sur `factures_prestataires.pdf_url` + `pdf_extraction_json`.
- **OCR factures dès V1** : `factures_prestataires.pdf_extraction_json` préremplit le formulaire Ops (2026-04-22, révision décision §03 M08)

### Opérationnel
- **`pesees` granulaires (1 ligne par geste)** : permet les pesées multiples par flux (ex: 2 pesées emballage sur la même collecte). Agrégation `SUM` au push Plateforme (2026-04-22)
- **Alerte pesées min/max ZD normalisée par pax** : (Σ poids_net_kg / nb_pax) comparée aux seuils paramétrables par flux. S'applique au total par flux (pas par pesée). Propagation §05 + §12 Plateforme à faire (2026-04-22)
- **`rolls_mouvements` pas d'historique corrections** : UNIQUE partiel `(collecte_tms_id, type_contenant_id)`, UPDATE si correction avec reversement delta (2026-04-22, révisé 2026-06-07 floue #2 M09 — ex `type_roll`)
- **Traçabilité push incidents** : via `integrations_logs` uniquement (pas de champ `push_plateforme_at` sur `incidents`) — Option B (2026-04-22)

### Admin et audit
- **`parametres_tms` seul lieu des paramètres métier** : pas de hardcoding, structuré en namespaces (`facturation`, `attribution`, `zones`, `stock`, `alertes`, `mobile`). Droit d'écriture via `modifiable_par[]` (2026-04-22)
- **`audit_logs` alimentés par triggers DB** (pas applicatif) : immuable, partitioning mensuel, rétention 5 ans, purge via DROP PARTITION (2026-04-22)

### RLS et sécurité
- **RLS multi-tenant strict** : Strike ne voit jamais Marathon, cumul rôles via `users_tms.roles[]`, Ops Savr/Admin TMS ont policies ouvertes. Matrice d'accès complète ci-dessus (2026-04-22)
- **Tests RLS obligatoires** : suite dédiée (cf. §15 Sécurité TMS) — un manager prestataire ne peut jamais lire les données d'un autre prestataire (2026-04-22)

### Intégrations
- **`integrations_logs` rétention 2 ans (audit/forensic uniquement, plus utilisée pour dedup — sobriété M01 B_M01_01 2026-04-30) + `integrations_inbox` rétention 7 jours** *(harmonisé 2026-06-11 — l'extension 30j de B_M01_01 a été annulée par la revue sobriété §08 Bloc B B5 2026-05-01, retour à 7j ; cette ligne n'avait pas été mise à jour)*, alignés avec §08 Contrat API et avec le §04 Plateforme niveau 7 (2026-04-22, mise à jour 2026-05-01)
- **`everest_missions` granularité** : 1 collecte = 1 mission vélo (V1), 1 tournée = 1 mission camion (V1). `tournees.cout_calcule_ht` prime sur `cout_everest_ht` (2026-04-22)

---

## Questions ouvertes

1. → **Résolu (Val 2026-04-28, résidu purgé 2026-06-11)** : seed définitif confirmé par inventaire physique — roll_850L = 37 kg, roll_pliable = 26 kg, bac_1100L = 50 kg, bac_240L = 11 kg, sac = 0,5 kg (cf. table `types_contenants`, le « roll 240L ≈ 14 kg » de l'ancienne hypothèse n'existe pas au seed).
2. **Paliers rolls par pax par flux** — valeurs seed posées en `parametres_tms` mais à calibrer à l'usage terrain (cf. §00 Index TMS Question 14).
3. **Seuils alertes pesées min/max par flux ZD par pax** — valeurs placeholder en `parametres_tms.alertes`, à calibrer sur premiers mois V1.
4. → **Résolu (arbitrage Val 2026-06-07, résidu purgé 2026-06-11)** : seed réel figé par préfixe département (`75` = paris ; `92`/`93`/`94` = communes_limitrophes), grille réelle 2 zones — cf. namespace `zones` Niveau 5 (+ clarification couverture ≠ pricing 2026-06-11).
5. **Test volumétrie partitioning `audit_logs`** — hypothèse V1 : ~50 000 mutations/mois. À vérifier dès go-live, ajuster partition mensuelle → hebdo si dépassement.
6. — **Tranché 2026-06-03 (arbitrage Val, option a)** : pas de rapprochement partiel natif V1. Règle V1 = **1 facture = 1 période de facturation sans chevauchement** avec une période déjà facturée (R3.8 §05). Le mécanisme de verrouillage existant garantit déjà l'absence de double comptage : R3.2 ne somme que les tournées `terminee` **ET `cout_final_verrouille = false`** — les tournées déjà rapprochées/facturées (verrouillées par une facture antérieure) sont automatiquement exclues du montant TMS d'une nouvelle facture. Si une facture à cheval produit un écart, elle tombe en `ecart_detecte` / `rapprochement_manuel_requis` (enum existant) → Ops tranche. **Aucune nouvelle colonne, aucun moteur de partiel.** Documenté §05 R3.8 + M08 (pas §08, qui couvre le contrat Plateforme↔TMS, pas la facturation prestataire interne). Rapprochement partiel/ligne-à-ligne réévaluable V1.1 si volume × 5.
7. **Everest webhook entrant statut mission** — à confirmer avec docs Everest si A Toutes! déclenche une mise à jour push (webhook) ou si c'est du polling côté TMS.
8. **Cumul rôle `manager_prestataire` + `ops_savr`** — cas de figure rare mais possible (employé Savr qui pilote aussi un prestataire). Règle RLS : toujours prendre le rôle le plus large (`ops_savr`). À confirmer §09 Auth.
9. → **Caduc (purgé 2026-06-11)** : la table a été remplacée par la vue `v_courses_logistiques` (grain couple collecte×tournée, `tournee_id` non unique — contrat figé 2026-05-26), **non créée en V1** (décision Val 2026-06-10). Plus rien à propager.

---

---

## Liens

- [[03 - Périmètre fonctionnel TMS]] — les 14 modules V1 sourcent les tables
- [[08 - Contrat API Plateforme-TMS]] — contrat d'échange, tables `integrations_logs` + `integrations_inbox`
- [[01 - Cahier des charges App/04 - Data Model]] — DM Plateforme, source de vérité pour `collectes`, `courses_logistiques`, `tournees` côté client
- [[01 - Cahier des charges App/08 - APIs et intégrations]] — DM Plateforme côté intégrations

---

## Addendum 2026-04-27 (propagation §11) — Dashboards transverses

### Audit logs — nouvelles actions documentées

Suite à §11 §3.6 (export dashboards) et §11 §3.10 (page 403), 2 nouveaux codes `action` sont introduits dans `tms.audit_logs` :

| Code action | Émetteur | Diff (JSONB) | Rétention |
|-------------|----------|--------------|-----------|
| `EXPORT_DASHBOARD` | Edge Function `dashboard_export` | `{dashboard_slug, format ('csv'|'pdf'), filters, rows_count, ms_duration}` | 5 ans |
| `AUDIT_403_ACCESS` | Middleware Next.js sur tentative route non autorisée | `{route_attempted, role_actual, ip}` | 5 ans |

Convention `action` : MAJUSCULE_SNAKE_CASE, CHECK regex `^[A-Z][A-Z0-9_]*$` (cf. table `tms.audit_logs`). Toute nouvelle action doit respecter cette convention.

### Vues dashboards

§11 §3.5 introduit les vues d'agrégat dashboards :

- `v_m07_dashboard` (D3 — pilotage financier) — **vue calculée à la volée** (sobriété 2026-06-04 — ex-`mat_view_m07_dashboard_finance` + cron `*/5 * * * *` supprimés ; volume ~300 tournées/mois, index composites `tournees` suffisent à p95 < 2s, aligné App §11 A1)
- `mat_view_m08_dashboard_facturation` (D4 — trésorerie) — vue matérialisée, refresh `pg_cron` `*/5 * * * *`

Spécifications détaillées dans addendums M07 §7 et M08 §addendum existants. Aucun changement de schéma data.

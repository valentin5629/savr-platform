# Authentification et permissions TMS

**Objectif** : spécifier l'authentification, la gestion des comptes, les rôles, le cumul de rôles, les policies RLS Supabase détaillées et la conformité RGPD sur le Savr TMS (tms.gosavr.io).


**Sources croisées** :
- [[04 - Data Model TMS]] — table `users_tms`, matrice RLS, fonctions helpers
- [[03 - Périmètre fonctionnel TMS]] — M13 Admin TMS (gestion comptes)
- [[15 - Sécurité et conformité TMS]] — RGPD, rétention, chiffrement
- [[../01 - Cahier des charges App/09 - Authentification et permissions]] — cohérence conventions Supabase Auth côté Plateforme

---

## ⚠ Addendum 2026-04-25 (propagation M13) — Politique session 30j glissantes admin+ops device trusted + RLS 4 nouvelles tables M13

Issu de [[06 - Fonctionnalités détaillées TMS/M13 - Administration TMS]] V1 rédigée 2026-04-25 (15 décisions D1-D15). **Cet addendum révise la politique de session admin/ops** précédemment implicite et pose les RLS pour les 4 nouvelles tables M13.

### 1. Politique session admin_tms + ops_savr (D10 M13)

**Décision** : session **30 jours glissantes** pour `admin_tms` et `ops_savr` après device trusted. **Pas de re-MFA pour actions sensibles** (R_M13.13, risque assumé conscient).

| Aspect | admin_tms | ops_savr |
|--------|-----------|----------|
| Login initial | SSO Google + MFA TOTP obligatoire | SSO Google (pas de MFA V1) |
| MFA TOTP | Obligatoire à la **1ère connexion sur un device** (D11) | Pas requis V1 |
| Devices trusted | Cap 3 actifs simultanés (R_M13.11, D14) | Idem cap 3 |
| Durée session | 30j glissantes (R_M13.12, `parametres_tms.auth.session_duree_jours_par_role->>'admin_tms'`, default 30) | 30j glissantes (`auth.session_duree_jours_par_role->>'ops_savr'`, default 30) |
| Inactivité | 30j sans activité = expiration auto, re-login complet | Idem |
| Re-MFA actions sensibles | **Non** (R_M13.13, D10 explicit) | n/a |
| Révocation device | Self ou admin via M13 E3.b onglet Devices | Idem |

**Implémentation** :
- Table `tms.users_tms_devices_trusted` (cf. §04 niveau 1 addendum 2026-04-25 M13).
- À chaque login réussi (post-MFA pour admin), si device fingerprint inconnu pour le user : INSERT ligne `actif=true`. Si déjà 3 actifs → reject login avec message "Cap 3 devices, révoque-en un d'abord".
- Supabase Auth session JWT avec `exp = now() + 30 days`, refresh token glissant à chaque activité.
- Trigger BEFORE INSERT/UPDATE sur `users_tms_devices_trusted` enforcing cap 3 (paramètre `m13_device_trusted_max_per_user`).

**Risque assumé documenté (D10/R_M13.13)** : laptop volé/compromis = jusqu'à 30j d'accès admin sans frein. Aucun re-challenge MFA même pour rotation secret, désactivation user, déverrouillage facturation, impersonation. Compensé uniquement par :
- Audit-log exhaustif (toutes mutations admin tracées avec acteur + IP + user-agent)
- Révocation device manuelle possible Admin (M13 E3.b onglet Devices)
- Notification cible sur certaines actions (W4 reset MFA, W9 impersonation)

À reconsidérer V2 si : recrutement 3ème admin, incident sécu, audit externe, ou évolution conformité (ISO 27001, SOC 2).

### 1bis. Sessions chauffeur — grâce de flush device-switch (2026-07-06 COH-08, arbitrage Val RC-M05-05)

**Exception à la règle « révocation = invalidation immédiate »**, cantonnée au device binding chauffeur (D12 M05) :

- **SI** un token chauffeur est révoqué **pour cause de device-switch** (`reason='device_switch'` — login sur un nouveau device, C14 M05) **ALORS** ce token reste accepté pendant `m05_grace_flush_heures` (défaut 48 h, paramètre §12 M05) sur les **seuls endpoints de sync** (`POST /sync/*`), et uniquement pour les items de queue offline **créés avant la révocation** (`created_at <` révocation ; `idempotency_key` dédoublonne si le chauffeur a re-saisi sur le nouveau device).
- **Toute autre révocation reste immédiate sur tous les endpoints** — en particulier le **force-logout sécurité (C5 M05)**, la désactivation user Admin (M13) et la rotation forcée de password (W4 M13) ne bénéficient d'AUCUNE grâce.
- Hors scope de la grâce : tout endpoint non-sync (lecture tournées, login, référentiels) répond 401 normalement dès la révocation.
- **Audit** : chaque write accepté sous grâce est loggé (`audit_logs`, token révoqué + device d'origine identifiés) ; au-delà de la fenêtre, queue orpheline = DLQ locale + audit `SYNC_ORPHAN_QUEUE_DETECTED` (W11 M05).

**Justification** : pas de perte de données terrain au switch de device (KPI « 0 perte » §1 M05) — les écritures de sync sont idempotentes (`idempotency_key`) et à blast radius limité. Cadrage risque : cf. [[15 - Sécurité et conformité TMS]] §Device binding.

### 2. RLS nouvelles tables M13

#### `tms.users_tms_devices_trusted`

```sql
-- Self : SELECT + UPDATE révocation propre
CREATE POLICY users_devices_trusted_self_select ON tms.users_tms_devices_trusted
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY users_devices_trusted_self_update ON tms.users_tms_devices_trusted
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND actif = false); -- révocation only (audit RLS 2026-06-05 : `NEW.` interdit en WITH CHECK RLS → référence colonne directe)

-- Admin TMS : SELECT + UPDATE tout user
CREATE POLICY users_devices_trusted_admin_all ON tms.users_tms_devices_trusted
  FOR ALL
  USING (auth.user_has_role('admin_tms'))
  WITH CHECK (auth.user_has_role('admin_tms'));

-- INSERT : applicatif uniquement (au login post-MFA), pas via PostgREST
REVOKE INSERT ON tms.users_tms_devices_trusted FROM authenticated;
```

#### `tms.alertes_codes_overrides`

> **Dégagée Bloc 6 C3 (revue sobriété 2026-04-28)** — table supprimée. La criticité override passe uniquement par `alertes_catalogue.criticite_par_defaut`. Policies ci-dessous retirées du déploiement.

```sql
-- ⛔ SUPPRIMÉES Bloc 6 C3 — table alertes_codes_overrides retirée V1
-- CREATE POLICY alertes_codes_overrides_read ...
-- CREATE POLICY alertes_codes_overrides_admin_write ...
```

#### `tms.secrets_metadata`

```sql
-- Admin TMS uniquement (read + write)
CREATE POLICY secrets_metadata_admin_only ON tms.secrets_metadata
  FOR ALL
  USING (auth.user_has_role('admin_tms'))
  WITH CHECK (auth.user_has_role('admin_tms'));

-- Note : vault.secrets accessible uniquement via Edge Functions, jamais PostgREST
-- (Supabase Vault verrouille natively)
```

#### `tms.impersonation_sessions`

```sql
-- Admin TMS lecture toutes les sessions
CREATE POLICY impersonation_sessions_admin_read ON tms.impersonation_sessions
  FOR SELECT
  USING (auth.user_has_role('admin_tms'));

-- Pas d'INSERT/UPDATE direct via PostgREST
-- (uniquement via Edge Function impersonation_start/stop)
REVOKE INSERT, UPDATE, DELETE ON tms.impersonation_sessions FROM authenticated;

-- Trigger BEFORE INSERT enforce contraintes R_M13.9
CREATE OR REPLACE FUNCTION tms.check_impersonation_constraints()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- (a) Pas vers admin_tms
  IF EXISTS (SELECT 1 FROM tms.users_tms WHERE id = NEW.target_user_id AND 'admin_tms' = ANY(roles)) THEN
    RAISE EXCEPTION 'Impersonation interdite vers un autre Admin TMS (R_M13.9)';
  END IF;
  -- (b) Pas vers user désactivé
  IF EXISTS (SELECT 1 FROM tms.users_tms WHERE id = NEW.target_user_id AND statut = 'desactive') THEN
    RAISE EXCEPTION 'Impersonation interdite vers un user désactivé (R_M13.9)';
  END IF;
  -- (c) Pas cascadée
  IF EXISTS (SELECT 1 FROM tms.impersonation_sessions WHERE impersonator_user_id = NEW.impersonator_user_id AND ended_at IS NULL) THEN
    RAISE EXCEPTION 'Session impersonation déjà active (EC10)';
  END IF;
  -- (d) Pas self
  IF NEW.impersonator_user_id = NEW.target_user_id THEN
    RAISE EXCEPTION 'Impersonation self interdite';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_impersonation_check
BEFORE INSERT ON tms.impersonation_sessions
FOR EACH ROW EXECUTE FUNCTION tms.check_impersonation_constraints();
```

### 3. Helper SQL `auth.is_impersonating()` (R_M13.10, D15 M13)

```sql
-- Helper retourne true si la session JWT actuelle porte un claim impersonator_user_id
CREATE OR REPLACE FUNCTION auth.is_impersonating()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb ? 'impersonator_user_id')
$$;

-- Helper retourne l'impersonator_user_id réel (NULL si pas impersonation)
CREATE OR REPLACE FUNCTION auth.impersonator_user_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'impersonator_user_id')::uuid
$$;
```

**Utilisation dans triggers `audit_logs`** : modifier les triggers existants pour que :

```sql
INSERT INTO tms.audit_logs (
  acteur_user_id,
  acteur_type,
  acteur_meta,
  ...
) VALUES (
  COALESCE(auth.impersonator_user_id(), auth.uid()),  -- impersonator réel ou user normal
  'user',
  jsonb_build_object(
    'ip', current_setting('request.headers', true)::jsonb->>'x-forwarded-for',
    'user_agent', current_setting('request.headers', true)::jsonb->>'user-agent',
    'impersonation_target_id', CASE WHEN auth.is_impersonating() THEN auth.uid() ELSE NULL END
  ),
  ...
);
```

Ainsi : `acteur_user_id` = toujours l'impersonator réel (Val/Louis), `acteur_meta.impersonation_target_id` = la cible. R_M13.10 + D15 M13 enforced au niveau DB.

### 4. Tests pgTAP M13 (à ajouter)

À écrire dans `migrations/_tests/m13_*.sql` :

1. `test_users_tms_devices_trusted_self_select` : un user voit ses propres devices, pas ceux des autres.
2. `test_users_tms_devices_trusted_self_revoke` : user peut révoquer ses propres devices, pas activer.
3. `test_users_tms_devices_trusted_admin_all` : admin_tms voit + modifie tous.
4. `test_users_tms_devices_trusted_cap_3` : 4ème INSERT actif rejeté par trigger.
5. — retiré Bloc 6 C3 (table supprimée)
6. — retiré Bloc 6 C3 (table supprimée)
7. `test_secrets_metadata_admin_only` : non-admin denied SELECT.
8. `test_impersonation_check_no_admin_target` : INSERT impersonation vers admin_tms rejeté.
9. `test_impersonation_check_no_desactive_target` : INSERT impersonation vers desactive rejeté.
10. `test_impersonation_check_no_cascade` : INSERT 2ème session impersonation par même impersonator rejeté.
11. `test_impersonation_check_no_self` : INSERT impersonation self rejeté.
12. `test_audit_logs_immutable_admin_cannot_update` : admin_tms tente UPDATE audit_logs → rejet RLS.
13. `test_audit_logs_acteur_under_impersonation` : insert audit pendant impersonation → acteur_user_id = impersonator réel + meta.impersonation_target_id non null.
14. `test_audit_logs_acteur_normal` : insert audit hors impersonation → meta.impersonation_target_id IS NULL.

---

## ⚠ Addendum 2026-04-24 (propagation M03) — Authentification manager prestataire + retournement chauffeur magic link → password

Issu de la rédaction de [[06 - Fonctionnalités détaillées TMS/M03 - Portail prestataire self-service]] (V1 rédigée 2026-04-24, 16 décisions structurantes). **Retournement méthode auth chauffeur** : l'addendum M05 plus bas (magic link + device binding) est **partiellement révisé** sur la partie méthode de login — le reste (device binding, session 30j rolling, RLS, purge géoloc) reste valide.

### 1. Politique password unifiée manager + chauffeur (D1 M03, scope Val 2026-04-24)

**Décision** : email + password pour les rôles `manager_prestataire` (nouveau M03) **et** `chauffeur` (retournement M05). Justifications :
- **Manager** : il gère des données business sensibles (assignation tournées, revenus) et doit pouvoir se reconnecter rapidement sans attendre un mail. Password standard + autocomplete navigateur = UX familière.
- **Chauffeur** (retournement de D12 M05) : le magic link supposait un accès email systématique sur le terrain, ce qui n'est pas garanti (chauffeurs ponctuels, emails personnels mal maintenus, pas de réseau parfois). Password que le chauffeur peut noter sur papier = robustesse terrain.
- **Unification stack** : un seul flow d'auth côté TMS (login form + password hash) au lieu de 2 (magic link + password). Moins de code, moins de bugs.

**Politique password commune aux 2 rôles** :
- Longueur **minimum 8 caractères, point**. Aucune contrainte de complexité (pas de règle maj/min/chiffre/symbole). Justification : règles de complexité dégradent l'UX sans apporter de sécurité mesurable (cf. NIST 800-63B depuis 2017 — recommande longueur + blacklist plutôt que complexité).
- Hash **argon2id** via Supabase Auth natif (default Supabase). Paramètres : m=19456 KiB, t=2, p=1.
- **Pas de blacklist mots de passe communs V1** (simplicité max). À ajouter V2 si nécessaire.
- **Pas d'expiration périodique** (NIST depuis 2017 : imposer un changement périodique dégrade la sécurité).

**Scope périmètre auth** :

| Rôle | Méthode auth | MFA | Device binding |
|------|-------------|-----|----------------|
| `admin_savr` | SSO Google + MFA TOTP | Oui (inchangé §09 V1) | Non (desktop trusted) |
| `ops_savr` | SSO Google | **Non V1** *(corrigé 2026-06-07 test-scenarios M13 F4 — addendum M13 2026-04-25 + D11 font foi ; ex-mention "MFA TOTP Oui" stale)* | Non (desktop trusted) |
| `admin_tms` | SSO Google + MFA TOTP | Oui (inchangé §09 V1) | Non (desktop trusted) |
| `manager_prestataire` | **Email + password** (nouveau M03) | Non V1 | **Multi-device illimité** (portail browser) |
| `chauffeur` | **Email + password** (retournement M05 → M03) | Non V1 | **1 device actif** (PWA — inchangé D12 M05) |

### 2. Reset password (magic link fallback uniquement)

Le magic link ne disparaît pas totalement : il est **conservé uniquement pour le flow reset password** (M03 E02 "Mot de passe oublié"). Flow :
1. User (manager OU chauffeur) saisit son email
2. Supabase Auth émet magic link via Resend (template `password_reset`)
3. Magic link TTL 30 min, usage unique
4. Clic → landing page nouveau password (min 8 car) → session créée
5. Anti-énumération : toast neutre si email inconnu
6. Rate limit : 3 resets par email par 24h (paramètre `m03_password_reset_max_per_day`)

**Simplification vs D14 M05** : le paramètre `m05_magic_link_ttl_min` (15 min) est **fusionné** avec le paramètre reset password (30 min) — plus simple, un seul paramètre `m03_password_reset_ttl_min = 30`. Fallback téléphone Ops conservé pour le chauffeur (paramètre `m05_ops_numero_telephone` toujours valide).

### 3. Rate limit login (protection brute force)

- **5 tentatives échouées par IP par 15 minutes** (paramètre `m03_login_rate_limit_per_15min = 5`). Implémentation : Supabase Auth rate limiter natif + middleware Next.js (Vercel KV counter).
- **Pas de lockout compte utilisateur V1** (simplicité max) : l'attaquant est bloqué par IP, pas le user bloqué par son compte (évite DoS ciblé sur un user).
- Erreur 429 Too Many Requests + délai attente 15 min affiché à l'utilisateur.

### 4. Session JWT 30 jours rolling (paramètre unifié JSON par rôle, refondu revue sobriété §05 2026-05-01 C2)

**Source de vérité authoritative** pour la durée de session de tous les rôles V1 (chauffeur, manager_prestataire, ops_savr, admin_tms).

Paramètre unique JSONB `parametres_tms.auth.session_duree_jours_par_role` (default `{"chauffeur": 30, "manager_prestataire": 30, "ops_savr": 30, "admin_tms": 30}`), modifiable `admin_tms` uniquement. Permet d'ajuster la durée par rôle sans introduire de paramètres séparés divergents.

Paramètre `auth.session_glissante` boolean (default `true`) — flag global toutes rôles V1, ex-`m13_session_glissante`.

**Suppressions revue sobriété §05 2026-05-01 C2** :,,,. Toutes ces variantes étaient à 30 — fusion sans changement de comportement V1.

Remplace la décision D13 M05 (spécifique chauffeur) par une règle commune :
- **Durée session** : 30 jours glissants par défaut (paramètre `auth.session_duree_jours_par_role->>'<role>'`)
- **JWT TTL court** : 30 minutes (refresh silencieux via cookie httpOnly sécurisé)
- **Refresh token TTL** : 30 jours
- **Last seen touché à chaque requête** (colonne `auth_sessions_tms.last_seen_at`)
- **Purge auto pg_cron horaire** : sessions `expires_at < now() AND revoked_at IS NULL` → `revoked_at=now(), revoked_reason='expiration'`

### 5. Device binding — spécialisation par rôle (révision D12 M05)

| Rôle | Règle device | Justification |
|------|-------------|---------------|
| `manager_prestataire` | **Multi-device illimité** | Le manager gère depuis bureau + téléphone + parfois tablette. Contrainte 1 device actif serait anti-UX. |
| `chauffeur` | **1 device actif** (INCHANGÉ D12 M05) | Éviter partage d'un même compte entre plusieurs chauffeurs (fraude identité, géoloc brouillée). Toast au device éjecté. |

**Impact table `auth_sessions_tms`** (§04 TMS) : la contrainte `UNIQUE (chauffeur_id) WHERE revoked_at IS NULL` reste valable **pour les chauffeurs uniquement**. Pour les managers prestataires, pas de contrainte unique — un `manager_id` peut avoir N sessions actives simultanées. Schéma révisé :

```sql
-- Contrainte partielle : 1 device actif uniquement pour les chauffeurs
CREATE UNIQUE INDEX auth_sessions_tms_chauffeur_single_active 
  ON tms.auth_sessions_tms (chauffeur_id) 
  WHERE chauffeur_id IS NOT NULL AND revoked_at IS NULL;

-- Pas d'index équivalent sur manager_prestataire_id → multi-device illimité
```

### 6. Anti-énumération et message d'erreur login

- Message d'erreur login unifié : "Email ou mot de passe incorrect" (pas de distinction email inconnu vs password faux).
- Timing constant : `bcrypt_compare` même si email absent (dummy hash compare) pour éviter leak via timing attack.

### 7. Audit log auth

Toutes les tentatives login (succès + échecs) loggées dans `audit_logs_tms` :
- `action='login_success' | 'login_failed' | 'password_reset_requested' | 'password_reset_completed' | 'force_logout'`
- Champs : `user_id`, `role`, `ip`, `user_agent`, `device_fingerprint` (si applicable), `timestamp`, `success boolean`, `failure_reason string|null`
- Rétention : 1 an (paramètre `m15_auth_audit_retention_days = 365`)

---

## ⚠ Addendum 2026-04-24 (propagation M05) — Authentification chauffeur PWA + device binding

> ⚠ **Partiellement retourné 2026-04-24 (addendum M03 ci-dessus)** : la méthode auth chauffeur **magic link → email+password**. Les autres éléments de cet addendum (device binding 1 device actif, session 30j rolling, RLS chauffeur, purge géoloc) restent **valides et inchangés**.

Issu de la rédaction de [[06 - Fonctionnalités détaillées TMS/M05 - App mobile chauffeur]] (V1 rédigée 2026-04-24, 20 décisions structurantes). 6 impacts auth/permissions.

### 1. Magic link chauffeur (D12, D13, D14)

**Flux** : chauffeur saisit son email sur M05 E1 → Supabase Auth émet magic link via Resend (template `chauffeur_magic_link`) → chauffeur clique → session créée avec `device_fingerprint` stocké dans nouvelle table `auth_sessions_tms` (cf. §04 addendum M05).

**Paramètres** :
- Magic link TTL : 15 min (paramètre `m05_magic_link_ttl_min`)
- Usage unique (`used_at` dans Supabase Auth)
- Anti-énumération : toast neutre si email inconnu ("Si ton email est enregistré, tu recevras un lien")
- Renvoi manuel avec délai 60s anti-spam (D14 fallback)

**Fallback D14** : si chauffeur ne reçoit pas le mail, bouton "Renvoyer" (délai anti-spam), puis `tel:` Ops en dernier recours (numéro paramètre `m05_ops_numero_telephone`).

### 2. Device binding 1 seul device actif (D12)

Contrainte DB (UNIQUE partielle sur `auth_sessions_tms (chauffeur_id) WHERE revoked_at IS NULL`) + trigger qui invalide la session précédente lors d'une nouvelle connexion (cf. §04 addendum M05).

Toast sur device éjecté au prochain ping : "Tu as été déconnecté car l'app a été ouverte sur un autre appareil."

### 3. Session 30 jours rolling (D13)

- Durée session chauffeur : 30 jours (paramètre `auth.session_duree_jours_par_role->>'chauffeur'`, ex-`m05_session_duree_jours` — refondu revue sobriété §05 2026-05-01 C2)
- Refresh silencieux : `last_seen_at` touché à chaque requête PWA authentifiée
- Purge auto pg_cron horaire : `UPDATE auth_sessions_tms SET revoked_at=now(), revoked_reason='expiration' WHERE expires_at < now() AND revoked_at IS NULL`
- JWT TTL court (30 min) + refresh via cookie 30 jours — cohérent Supabase Auth defaults

### 4. RLS rôle `chauffeur`

Policies RLS à appliquer sur les tables suivantes pour le rôle `chauffeur` (isolé : il ne voit que ses données) :

> ⚠ **Correctif audit RLS 2026-06-05** : les prédicats fondés sur l'identité du chauffeur utilisent **`auth.user_chauffeur_id()`** (helper qui lit le claim JWT `tms_chauffeur_id` = `chauffeurs.id`) et **non** `auth.uid()` (= `auth.users.id` = `users_tms.id`). `auth.uid()` ne matche **jamais** un `chauffeur_id`/`saisi_par_chauffeur_id`/`declarant_chauffeur_id`. Table alignée sur le SQL canonique A3. Table `chauffeurs` = **`tms.chauffeurs`** (schéma canonique §04, ex-réfs `shared.chauffeurs` corrigées).

| Table | RLS SELECT | RLS INSERT / UPDATE |
|-------|-----------|---------------------|
| `tournees` | `(chauffeur_id = auth.user_chauffeur_id() OR equipier_id = auth.user_chauffeur_id()) AND statut IN ('planifiee', 'en_cours') AND heure_planifiee_debut >= now() - interval '30 days'` | UPDATE limité aux transitions statut explicites (trigger DB) — propagation 2026-04-29 (`creneau_debut` legacy → `heure_planifiee_debut` fenêtre tournée) |
| `collectes_tms` | via `collecte_tournees` → `tournees.chauffeur_id = auth.user_chauffeur_id()` *(multi-camions 2026-05-25, ex `collectes_tms.tournee_id`)* | UPDATE `statut_operationnel` limité aux transitions M05 (W-table cycle de vie) |
| `pesees` | `saisi_par_chauffeur_id = auth.user_chauffeur_id()` | INSERT si `tournee.statut=en_cours AND collecte_tms.statut_operationnel IN ('en_cours', 'arrivee')` |
| `incidents` | `declarant_chauffeur_id = auth.user_chauffeur_id() OR tournee.chauffeur_id = auth.user_chauffeur_id()` | INSERT si chauffeur de la tournée |
| `auth_sessions_tms` | `chauffeur_id = auth.user_chauffeur_id()` | INSERT via flow magic link uniquement (pas direct) |
| `chauffeurs_geolocalisation` | `chauffeur_id = auth.user_chauffeur_id()` | INSERT propres positions uniquement (cf. A3 §21) |
| `types_contenants` | read-only public (tous authentifiés) | — |
| `tms.chauffeurs` | `id = auth.user_chauffeur_id()` | UPDATE `telephone` uniquement (self-service partiel, V1.1) |
| `shared.prestataires` | `id = (SELECT prestataire_id FROM tms.chauffeurs WHERE id = auth.user_chauffeur_id())` | — (lecture raison sociale + infos publiques uniquement) |

**Colonnes masquées chauffeur** :
- `tournees.cout_calcule_ht`, `tournees.cout_detail`, `tournees.grille_tarifaire_id` → coûts invisibles (via vue filtrée ou policy colonne)
- `grilles_tarifaires_prestataires.*` → pas d'accès
- `factures_prestataires.*` → pas d'accès
- `users_tms.*` (autres users) → pas d'accès

### 5. Historique 30 jours + RGPD géoloc

Chauffeur voit 30 jours glissants d'historique tournées/collectes via M05 E10 (lecture seule). Filtre RLS : `created_at >= now() - interval '30 days'`.

Coordonnées GPS purgées au-delà de 30 jours (cf. §04 addendum M05 point 6, job pg_cron quotidien). Photos et signatures conservées selon règles Plateforme (6 ans archivage obligations légales).

### 6. Déconnexion forcée par Admin TMS (C5 M05)

Admin TMS peut invalider toutes les sessions d'un chauffeur via back-office M06 fiche chauffeur (bouton "Déconnecter tous les appareils") :
```sql
UPDATE auth_sessions_tms 
SET revoked_at=now(), 
    revoked_reason='admin_force_logout', 
    revoked_by_user_id=:admin_user_id
WHERE chauffeur_id=:chauffeur_id AND revoked_at IS NULL;
```

Audit log `action=FORCE_LOGOUT_CHAUFFEUR` avec auteur. Au prochain ping PWA, session invalide → redirect E1.

### 7. Fin de contrat chauffeur (révocation accès)

Cohérence avec §A5 "Fin de contrat prestataire" existant : archivage d'un chauffeur (`tms.chauffeurs.statut='archive'`) invalide toutes ses sessions actives (`auth_sessions_tms.revoked_at=now()`, `revoked_reason='contract_end'`) et empêche tout nouveau magic link (blocage email émission).

Documents chauffeur (permis, visite médicale) purgés après 3 ans d'archivage (cron RGPD existant, cf. §A5).

---

## ⚠ Addendum 2026-04-23 (atelier tech + seconde salve M01)

### Isolation par schémas (retournement 2 projets → 1 projet 3 schémas)

 → **1 seul projet Supabase**, 3 schémas (`plateforme.*`, `tms.*`, `shared.*`) isolés par **RLS cross-schema deny**. Une seule table `auth.users` partagée physiquement, mais :

- **JWT custom claim `app_domain`** (`'plateforme'` \| `'tms'`) posé par hook Supabase Auth au login, basé sur l'origine de la tentative de connexion (sous-domaine `app.gosavr.io` vs `tms.gosavr.io`).
- **Fonction helper RLS** `app_domain() RETURNS text` lit le claim JWT courant. Toutes les policies RLS TMS ajoutent `AND app_domain() = 'tms'` (sauf exceptions `shared.*`).
- **Users disjoints en pratique** : un chauffeur TMS ne peut jamais loguer sur la Plateforme (middleware Next.js + RLS deny). Pas de SSO cross-apps V1.
- **Exception Ops Savr** : rôle `ops_savr` peut exister à la fois côté Plateforme et TMS avec le **même email** (1 entry dans `auth.users`, 2 profils distincts `plateforme.users` + `tms.users_tms`). Le claim `app_domain` est recalculé à chaque refresh selon le sous-domaine de connexion.

### Policies RLS cross-schema (seconde salve M01)

Nouvelles policies introduites par la seconde salve M01 (D14 prestataires, D16 lieux) :

**Table `shared.prestataires`** (source de vérité unique, écriture TMS, lecture cross-schema)

```sql
ALTER TABLE shared.prestataires ENABLE ROW LEVEL SECURITY;

-- Lecture : autorisée aux 2 app_domains, rôles staff
CREATE POLICY prestataires_read_cross_domain ON shared.prestataires
  FOR SELECT
  USING (
    (app_domain() = 'tms' AND has_role(ARRAY['admin_tms', 'ops_savr', 'manager_prestataire']))
    OR
    (app_domain() = 'plateforme' AND has_role(ARRAY['admin_savr', 'ops_savr']))
  );

-- Manager_prestataire TMS voit uniquement sa propre ligne
CREATE POLICY prestataires_manager_self ON shared.prestataires
  FOR SELECT
  USING (
    app_domain() = 'tms'
    AND has_role(ARRAY['manager_prestataire'])
    AND id = current_user_prestataire_id()
  );

-- Écriture : TMS uniquement, rôle admin_tms (full) ou ops_savr (colonnes identité only)
CREATE POLICY prestataires_admin_tms_write ON shared.prestataires
  FOR ALL
  USING (app_domain() = 'tms' AND has_role(ARRAY['admin_tms']))
  WITH CHECK (app_domain() = 'tms' AND has_role(ARRAY['admin_tms']));

-- Ops Savr côté TMS : UPDATE restreint aux colonnes identité + opérationnel édition Ops
-- Propagation M06 2026-04-24 : remplacement `contact_principal` → `contact_operationnel` + `contact_facturation`
-- (implémentation Postgres : GRANT UPDATE (nom, siret, adresse_siege, contact_operationnel, contact_facturation, commentaire_interne) ON shared.prestataires TO ops_savr_tms;)
-- Note : `forme_juridique` retiré V1 (revue sobriété M06 2026-04-30 — colonne supprimée).
-- Note M06 : **création directe** prestataire = admin_tms uniquement (policy prestataires_admin_tms_write). Ops Savr ne peut QUE modifier l'identité via UPDATE.
-- **Exception création province (QO#5 M02, tranché 2026-06-05)** : Ops Savr crée un prestataire province via la fonction SECURITY DEFINER `tms.fn_create_prestataire_province` ci-dessous, sans GRANT INSERT direct ni assouplissement column-level.
CREATE POLICY prestataires_ops_tms_update_identity ON shared.prestataires
  FOR UPDATE
  USING (app_domain() = 'tms' AND has_role(ARRAY['ops_savr']))
  WITH CHECK (app_domain() = 'tms' AND has_role(ARRAY['ops_savr']));
-- Les colonnes opérationnelles (rayon_intervention_km, coords_siege_*, integration_externe, everest_client_id, type_prestation, has_portail_self_service, statut, date_fin_contrat) restent deny pour ops_savr via GRANT column-level.
-- Workflow fin de contrat (M06 E8) : seul admin_tms peut écrire `statut` et `date_fin_contrat`.
```

**Fonction `tms.fn_create_prestataire_province` (QO#5 M02 — création province par l'Ops, 2026-06-05)**

Permet à `ops_savr` de créer à la volée (depuis M02 E5 / 7.6) un prestataire `type='province'`, `statut='actif'` **sans** ouvrir de GRANT large sur les colonnes opérationnelles de `shared.prestataires` (le deny column-level reste en place). La fonction est `SECURITY DEFINER`, autorise uniquement `ops_savr`/`admin_tms`, et porte le garde-fou anti-doublon.

> ⚠ **Écart conscient invariant grille (tranché Val 2026-06-07 test-scenarios M06 #4 — TOLÉRANCE ASSUMÉE, inverse de la reco)** : l'INSERT direct `statut='actif'` contourne `trg_prestataire_grille_obligatoire` (scope = AFTER UPDATE `en_onboarding → actif` uniquement, inchangé). Un prestataire province peut donc être `actif` **sans grille tarifaire** — régularisation a posteriori dans M07. Filet aval : tournée clôturée sans grille → coût M07 non calculable → facture en `rapprochement_manuel_requis` M08 (R_M08.8). Idem pour les seeds migration INSERT `actif`. Ne pas re-proposer l'extension du trigger à AFTER INSERT.

```sql
CREATE FUNCTION tms.fn_create_prestataire_province(
  p_nom text, p_siret text, p_ville text,
  p_contact_operationnel jsonb DEFAULT NULL, p_rayon_km int DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = shared, tms AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (app_domain() = 'tms' AND has_role(ARRAY['ops_savr','admin_tms'])) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  -- Garde-fou doublon : SIRET d'abord, puis (nom normalisé, ville)
  IF EXISTS (SELECT 1 FROM shared.prestataires WHERE siret = p_siret AND deleted_at IS NULL)
     OR EXISTS (SELECT 1 FROM shared.prestataires
                WHERE tms.normalize_nom(nom) = tms.normalize_nom(p_nom)
                  AND lower(ville) = lower(p_ville) AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'duplicate_prestataire';
  END IF;
  INSERT INTO shared.prestataires (nom, siret, ville, type, statut, contact_operationnel, rayon_intervention_km)
  VALUES (p_nom, p_siret, p_ville, 'province', 'actif', p_contact_operationnel, p_rayon_km)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION tms.fn_create_prestataire_province FROM public;
GRANT EXECUTE ON FUNCTION tms.fn_create_prestataire_province TO ops_savr_tms, admin_tms;
```

> Admin TMS supervise/corrige a posteriori (la fonction ne fait que lever la barrière de création province, pas de validation amont). Cf. M02 §12 QO#5 + M06.

**Table `plateforme.lieux` — colonnes logistiques enrichies par le TMS (D16)**

```sql
-- La policy existante `lieux_plateforme_*` conserve son comportement : écriture Plateforme
-- complète (adresse, coords, contraintes commerciales, etc.), lecture Plateforme.
-- Nouveau : permissions column-level pour écriture TMS sur 4 colonnes logistiques uniquement.

-- 1. Policy SELECT cross-schema pour les rôles TMS
CREATE POLICY lieux_read_cross_schema_tms ON plateforme.lieux
  FOR SELECT
  USING (
    app_domain() = 'tms'
    AND has_role(ARRAY['admin_tms', 'ops_savr'])
  );
-- Note : chauffeurs et managers prestataires n'accèdent pas directement à plateforme.lieux.
-- Ils voient uniquement le lieu_snapshot JSONB de tms.collectes_tms (photo figée, D15).

-- 2. GRANT UPDATE column-level (2 colonnes logistiques seulement — propagation A2 audit cohérence 2026-04-28)
GRANT UPDATE (acces_details, acces_office)
  ON plateforme.lieux
  TO tms_logistics_writer;  -- rôle Postgres attribué aux users avec app_domain='tms' ET rôle admin_tms|ops_savr
-- Refonte 2026-04-28 : ex-4 colonnes addendum (code_acces, parking, contact_ops_logistique, instructions_chauffeur) supprimées et fusionnées sur acces_details + acces_office Plateforme. Contacts retirés (relogés sur evenements.contact_principal_*/contact_secours_*).

-- 3. Policy UPDATE cross-schema restrictive
CREATE POLICY lieux_write_logistics_cross_schema ON plateforme.lieux
  FOR UPDATE
  USING (
    app_domain() = 'tms'
    AND has_role(ARRAY['admin_tms', 'ops_savr'])
  )
  WITH CHECK (
    app_domain() = 'tms'
    AND has_role(ARRAY['admin_tms', 'ops_savr'])
  );
-- Les autres colonnes sont refusées par le GRANT column-level (erreur Postgres privilege).
```

**Tests pgTAP bloquants CI** :
- `lieux_cross_schema_tms_cannot_update_non_logistics_columns` — tentative UPDATE `nom`/`adresse`/`coordonnees_gps` depuis un user TMS → doit échouer avec erreur privilege.
- `lieux_cross_schema_plateforme_can_update_anything` — user `admin_savr` peut UPDATE toutes les colonnes (comportement historique conservé).
- `prestataires_cross_schema_read_both_domains` — user `ops_savr` côté Plateforme ET côté TMS peut lire `shared.prestataires`.
- `prestataires_cross_schema_plateforme_cannot_write` — user `admin_savr` (app_domain='plateforme') ne peut pas UPDATE/INSERT sur `shared.prestataires`.

Ces tests s'ajoutent aux 17 policies RLS TMS existantes documentées plus bas (A3).

### Impact table `users_tms`

Pas de changement de schéma, mais : le rôle `ops_savr` peut désormais exister simultanément côté Plateforme et TMS (même email, 2 entries logiques dans `users_tms` et `plateforme.users`). Le cycle de vie compte (création, suspension, archivage) doit être coordonné manuellement V1 — pas de sync automatique entre les deux profils. V1.1+ : propagation automatique via trigger.

### Rotation HMAC API Plateforme↔TMS

Rotation **annuelle** (retournement vs décision 9.3.16 semestrielle — atelier tech 2026-04-23). Justification : fréquence de rotation élevée non justifiée par volume V1. Procédure documentée runbook sécurité §15.

---

## Principes fondateurs

### Isolation stricte Plateforme vs TMS

 **(retourné atelier 2026-04-23)** : 1 projet Supabase, 3 schémas (`plateforme.*`, `tms.*`, `shared.*`), isolés par RLS cross-schema deny + claim JWT `app_domain`. Cf. addendum ci-dessus. Le principe d'isolation est maintenu par la sécurité DB (RLS deny par défaut) malgré la DB unique.

**Conséquence** : un Ops Savr qui bosse sur les deux apps a **deux comptes** avec deux emails différents (ou le même email dupliqué sur deux `auth.users`). Pas de session partagée, pas de token partagé.

**V2 potentielle** : fédération via Supabase Auth multi-project ou OIDC centralisé. Hors scope V1.

### Principe du moindre privilège

- Par défaut, un compte créé n'a **aucun droit**. Les droits s'acquièrent via `users_tms.roles text[]` et `users_tms.prestataire_id`.
- Toute policy RLS est **deny-by-default**. Une ligne n'est visible que si au moins une policy `USING` la rend accessible.
- Les Edge Functions (webhooks, calculs, crons) utilisent la clé `service_role` qui bypass RLS → **jamais exposée au front**.

### RLS obligatoire sur toutes les tables métier

- Activation systématique : `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;`
- Aucune table métier ne peut être lue par un client anon ou authenticated sans policy explicite.
- Tables référentiels publics (ex: `types_vehicules`, `types_contenants`, `formules_catalogue`) → policy lecture ouverte aux rôles authentifiés.

### Auditabilité

Toute mutation sur `users_tms` (création, modification de rôles, désactivation) est tracée dans `audit_logs` (cf. §04 niveau 5). L'acteur (`acteur_user_id`) et le diff (`diff jsonb`) sont immuables. Rétention 5 ans.

### Séparation identité (auth) / profil opérationnel

- `auth.users` (Supabase natif) → credentials, email, MFA, sessions, mot de passe.
- `users_tms` (table applicative) → rôles, `prestataire_id`, `chauffeur_id`, métadonnées métier.
- `chauffeurs` → profil opérationnel (permis, documents, contact) indépendant de la présence ou non d'un compte `users_tms`.

**Règle** : un `chauffeurs.user_tms_id` peut être NULL (chauffeur legacy MTS-1, vacataire ponctuel, équipier Strike sans app). Le chauffeur reste identifiable et assignable à une tournée sans compte actif.

---

## A1. Architecture Auth Supabase

### Stack d'authentification

| Couche | Technologie | Rôle |
|--------|-------------|------|
| Provider | Supabase Auth (GoTrue) | Gestion credentials, JWT, sessions |
| Méthodes V1 | Email + mot de passe, Magic link, **SSO Google (Ops/Admin)** | Primaire : SSO Google pour Ops Savr + Admin TMS. Password pour managers prestataires + chauffeurs. Magic link : récupération + onboarding |
| MFA V1 | TOTP (Google Authenticator, Authy, 1Password) | Obligatoire Admin TMS, optionnel autres rôles. SSO Google équivaut au MFA Workspace si déjà configuré côté Workspace |
| MFA V2 | WebAuthn (passkeys) | Hors scope V1, prévu V2 |
| SSO V2 | Microsoft (prestataires) | Hors scope V1 |
| Sessions | JWT access (1h) + refresh token (30j) | Rotation refresh token à chaque usage |
| Tokens API externes | HMAC + JWT service-to-service (§08) | Distinct de l'auth utilisateur |

### Flux de connexion type

**Ops Savr / Admin TMS (SSO Google Workspace)** :
1. Clic "Se connecter avec Google" sur `tms.gosavr.io/login`.
2. Redirection OAuth Google, validation domaine `@gosavr.io` (whitelist côté Supabase Auth provider config).
3. Supabase Auth crée/match `auth.users` via email Google, renvoie `access_token` + `refresh_token`.
4. Edge Function post-login vérifie existence `users_tms`, charge rôles dans custom claims.
5. MFA délégué à Google Workspace (politique Workspace gère obligatoirement le MFA).

**Managers prestataires / Chauffeurs (email + password)** :
1. Saisit email + mot de passe.
2. Supabase Auth valide contre `auth.users`, renvoie tokens.
3. Si `users_tms.roles` contient `admin_tms` et MFA non vérifié → challenge TOTP obligatoire (cas rare si un Admin TMS ne passe pas par SSO).
4. Front stocke l'`access_token` en mémoire (pas en localStorage pour éviter XSS long terme), le `refresh_token` en cookie HttpOnly SameSite=Strict.
5. Chaque requête Supabase porte le JWT → RLS évaluée côté DB.

**Garde-fou SSO** : un email `@gosavr.io` ne peut pas se connecter par password (forcé SSO Google). Un email extérieur (manager/chauffeur) ne peut pas utiliser SSO Google (pas dans la whitelist). Contrainte vérifiée côté Edge Function de login.

### JWT custom claims

Le JWT Supabase porte nativement `sub` (auth.users.id), `email`, `role` (Postgres role = `authenticated`).

On y ajoute des custom claims via un hook Supabase Auth (ou via `raw_app_meta_data`) pour éviter un aller-retour DB dans les policies critiques :

```json
{
  "sub": "<auth.users.id>",
  "email": "manager@strike.fr",
  "role": "authenticated",
  "tms_roles": ["manager_prestataire"],
  "tms_prestataire_id": "uuid-strike",
  "tms_chauffeur_id": null,
  "tms_statut": "actif"
}
```

**Mise à jour** : les claims sont rafraîchis à chaque login et à chaque refresh token. Toute modification de `users_tms.roles` par l'Admin TMS force un invalidate session (cf. A4).

**Fallback** : pour les policies qui ne peuvent pas s'appuyer sur le JWT (cas complexes), on lit `users_tms` via une fonction `SECURITY DEFINER` cachée pendant la transaction.

### Fonctions helpers RLS

Exposées dans le schéma `auth` du TMS (Supabase autorise l'ajout dans `auth`) ou dans un schéma `tms_helpers` dédié.

```sql
-- Retourne le prestataire_id du user courant, NULL pour Ops/Admin
CREATE OR REPLACE FUNCTION auth.user_prestataire_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb
    ->> 'tms_prestataire_id')::uuid
$$;

-- Teste la présence d'un rôle dans le tableau tms_roles du JWT
CREATE OR REPLACE FUNCTION auth.user_has_role(p_role text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT p_role = ANY(
    COALESCE(
      (current_setting('request.jwt.claims', true)::jsonb
        -> 'tms_roles')::jsonb,
      '[]'::jsonb
    )::text[]
  )
$$;

-- Teste si le user est Ops Savr OU Admin TMS (écriture privilégiée)
CREATE OR REPLACE FUNCTION auth.user_is_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT auth.user_has_role('ops_savr')
      OR auth.user_has_role('admin_tms')
$$;

-- Retourne le chauffeur_id du user courant, NULL sinon
CREATE OR REPLACE FUNCTION auth.user_chauffeur_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb
    ->> 'tms_chauffeur_id')::uuid
$$;
```

**Intérêt** : factoriser, éviter de répéter la lecture JWT dans chaque policy, et permettre l'override par rôle via `SECURITY DEFINER` si on doit changer la logique sans toucher 50 policies.

### MFA TOTP

- **Obligatoire** : tout user portant `admin_tms`.
- **Fortement recommandé** : tout user portant `ops_savr`.
- **Optionnel** : `manager_prestataire`, `chauffeur`.
- **Enrollment** : premier login après création → écran "Activer l'authentification à 2 facteurs". Pour Admin TMS, blocage dur tant que MFA non activé.
- **Secret TOTP** : généré par Supabase Auth (`/factors` API), jamais stocké en clair côté applicatif.
- **Backup codes** : 8 codes à usage unique générés à l'enrollment, à télécharger en PDF. Non regénérables sans reset MFA par Admin TMS (trace `audit_logs`).
- **Reset MFA** : seulement par Admin TMS via M13, workflow :
  1. Admin TMS initie reset → email OTP envoyé au user concerné.
  2. User confirme via lien email (valide 15 min).
  3. MFA désactivé, obligation de re-enrollment au prochain login.
  4. Trace `audit_logs.acteur_user_id = admin, diff = { mfa: 'reset' }`.

### Sessions et refresh

- **Access token** : JWT 1h, rotation silencieuse via refresh token.
- **Refresh token** : 30 jours glissants, rotation à chaque usage (anti-replay). Si réutilisé → révocation famille entière → forced logout.
- **Inactivité** : 14 jours sans usage → refresh token expire, user doit se reconnecter.
- **Multi-device** : un user peut avoir N sessions actives (desktop + mobile app chauffeur). Liste consultable dans son profil, révocation unitaire possible.
- **Force logout** : déclenché par Admin TMS via M13, par changement de mot de passe, par modification de `users_tms.roles` (invalidate toutes les sessions via révocation refresh tokens).

### Gating routes frontend (propagation §11 2026-04-27)

Voir aussi [[11 - Dashboards TMS]] §3.10 et [[07 - Architecture technique TMS]] section Routing.

Gating en 2 couches :
- **Backend (RLS Supabase)** : autorité finale (cf. policies par table ci-dessous).
- **Frontend (middleware Next.js)** : sur chaque route protégée, vérifie le rôle via session JWT. Si non-autorisé : redirect `/403` + audit log `AUDIT_403_ACCESS`.

**Page `/403`** : page custom standardisée, sidebar visible (rôle de l'user respecté), message clair, lien retour home rôle. Audit log obligatoire à chaque hit (diff = `{route_attempted, role_actual, ip}`).

**Sidebar** : masque les liens vers routes non autorisées (pas juste désactivation visuelle). Ex : Manager prestataire ne voit jamais les liens vers `/dispatch`, `/admin`, etc.

**Cumul cross-app Ops Plateforme ↔ TMS** : **Simplifié revue sobriété §08 Bloc A 2026-05-01 A1** — bouton sidebar « → Plateforme/TMS » affiché inconditionnellement, page d'accès refusé propre côté cible si user sans profil.

---

## A2. Rôles et cumul

### Les 4 rôles V1

| Rôle | Cible | Portée | Exemples d'actions |
|------|-------|--------|--------------------|
| `ops_savr` | Équipe Savr (Ops logistique, SAV) | Globale (toutes prestataires) | Dispatch collectes, valider factures, lire tous les dashboards, corriger une pesée, déclarer un passage Veolia |
| `admin_tms` | Super-admin Savr (CTO + 1 backup) | Globale + configuration | Créer/désactiver users, modifier `parametres_tms` sensibles, éditer `formules_catalogue`, reset MFA, modifier grilles tarifaires |
| `manager_prestataire` | Dirigeant ou ops chez Strike/Marathon/A Toutes!/province | Limitée à `prestataire_id` | Gérer chauffeurs/véhicules de son entreprise, consulter tournées, uploader factures, suivre acceptation collectes |
| `chauffeur` | Chauffeur ou équipier | Limitée à ses propres tournées | Accepter tournée, saisir pesées, photos, rolls, incidents via app mobile M05 |

### Cumul de rôles

`users_tms.roles` est un `text[]` → un utilisateur peut porter plusieurs rôles simultanément.

**Cas réels attendus V1** :

1. **Manager-chauffeur Strike** : un gérant Strike qui conduit aussi → `roles = ['manager_prestataire', 'chauffeur']`, `prestataire_id = strike`, `chauffeur_id = <profil opé>`. Il voit tout Strike + peut accepter ses propres tournées côté app mobile.

2. **Ops Savr qui fait du support Admin** : un Ops qui a besoin d'éditer ponctuellement `parametres_tms` → `roles = ['ops_savr', 'admin_tms']`. Rare, mais possible. L'admin a la priorité (écritures privilégiées).

3. **Chauffeur multi-prestataires** : **non supporté V1** par `users_tms.prestataire_id` (un seul `prestataire_id`). Workaround : créer 2 comptes (2 emails différents). Décision tranchée : attendre V2 pour support natif.

**Cumul interdit V1 (contrainte applicative)** :

- **`manager_prestataire` + `ops_savr`** et **`manager_prestataire` + `admin_tms`** : **interdits V1**. Un user Savr ne peut pas porter simultanément un rôle prestataire. Validation côté M13 Admin TMS à la création/modification : blocage UI + vérification côté Edge Function `upsert_user_tms` (rejet 400 si combinaison détectée). Envisageable V2 si cas business réel (ex: dirigeant prestataire recruté chez Savr).

**Règles d'unicité** :
- Un `users_tms.email` est unique (contrainte DB).
- Un `chauffeurs.id` peut être référencé par **au plus un** `users_tms.chauffeur_id` (FK UNIQUE déjà en §04).
- Un `chauffeurs.prestataire_id` est fixe → cohérent avec `users_tms.prestataire_id` quand cumul chauffeur.

### Règles de priorité quand cumul

Quand un user cumule plusieurs rôles, les policies RLS sont **additives** (OR logique) → le user voit l'union des périmètres de ses rôles.

**Exemple** : un user `roles = ['manager_prestataire', 'chauffeur']` chez Strike voit :
- Toutes les tournées Strike (via `manager_prestataire`)
- Plus spécifiquement **ses propres tournées** (via `chauffeur`, mais déjà incluses dans la vue Strike)

Le cumul n'ouvre jamais un accès plus large que l'union. Il ne **débloque** pas un périmètre supplémentaire qui ne serait permis par aucun des rôles pris séparément.

**Exception** : pour les **écritures**, on garde la règle la plus restrictive nécessaire. Exemple : un manager-chauffeur peut saisir une pesée (écriture chauffeur sur ses tournées) mais il ne peut pas modifier une pesée d'un autre chauffeur Strike (lecture seule sur `pesees` pour le rôle manager).

### Rôle implicite : "Prestataire actif"

Un user `manager_prestataire` dont le `prestataires.statut = 'suspendu'` ou `archive` → **bloqué** au login (pas de session émise). Géré par policy sur `users_tms` qui croise `prestataires.statut`.

Idem pour `users_tms.statut = 'suspendu'` → login refusé, toutes les sessions invalidées.

### Équipiers : pas de rôle dédié

Rappel §04 : un équipier Strike est un `chauffeurs` avec `peut_conduire = false`. **Il n'a pas de compte `users_tms` en V1** (pas d'app mobile pour lui, il est assigné à une tournée par le chauffeur qui conduit).

**V2 potentielle** : si les équipiers ont besoin de l'app mobile (ex: scanner, saisie pesée seul) → on leur donne le rôle `chauffeur` sans rien changer aux tables. Le flag `peut_conduire = false` reste la source de vérité pour la facturation (+125€/4h).

### Synthèse matrice rôles × grandes catégories d'actions

| Action | ops_savr | admin_tms | manager_prestataire | chauffeur |
|--------|----------|-----------|---------------------|-----------|
| Dispatcher une collecte | Oui | Oui | Non | Non |
| Accepter / refuser une collecte prestataire | Oui (override) | Oui | Oui | Non |
| Constituer / modifier tournée | Oui | Oui | Oui (son scope) | Non |
| Saisir pesée terrain | Oui (override) | Oui | Non | Oui (ses tournées) |
| Valider facture prestataire | Oui | Oui | Non (upload only) | Non |
| Modifier grille tarifaire | Oui | Oui | Non | Non |
| Modifier `parametres_tms` | Oui (si `modifiable_par` inclut `ops_savr`) | Oui (tout) | Non | Non |
| Éditer `formules_catalogue` | Non | Oui | Non | Non |
| Créer / désactiver user | Non | Oui | Non | Non |
| Reset MFA d'un user | Non | Oui | Non | Non |
| Consulter `audit_logs` | Oui | Oui | Non | Non |
| Déclarer passage Veolia | Oui | Oui | Non | Non |
| Modifier `rolls_mouvements` historique | Non | Oui | Non | Non (write-only) |

---

## A3. Policies RLS détaillées par table

Reprise de la matrice §04 avec le SQL concret des policies. Convention : une policy par `(table, rôle, action)` pour traçabilité. Les policies sont toutes en `FOR ALL` ou ciblées `SELECT / INSERT / UPDATE / DELETE` selon le besoin.

Toutes les tables ci-dessous ont `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;` activé.

### 1. `prestataires`

```sql
-- Ops / Admin : accès complet
CREATE POLICY prestataires_staff_all ON prestataires
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

-- Manager : lecture de son propre record uniquement
CREATE POLICY prestataires_manager_self ON prestataires
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('manager_prestataire')
    AND id = auth.user_prestataire_id()
  );

-- Chauffeur : pas d'accès direct (n'en a pas besoin, infos exposées via app mobile)
```

### 2. `users_tms`

```sql
-- Ops / Admin : accès complet
CREATE POLICY users_tms_staff_all ON users_tms
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

-- Manager : lecture users du même prestataire_id
CREATE POLICY users_tms_manager_read ON users_tms
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('manager_prestataire')
    AND prestataire_id = auth.user_prestataire_id()
  );

-- Manager : peut créer / modifier un chauffeur de son prestataire
-- (pas un autre manager, pas lui-même sur ses rôles)
CREATE POLICY users_tms_manager_write_chauffeur ON users_tms
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.user_has_role('manager_prestataire')
    AND prestataire_id = auth.user_prestataire_id()
    AND roles <@ ARRAY['chauffeur']::text[]  -- strictement chauffeur, pas manager
  );

CREATE POLICY users_tms_manager_update_chauffeur ON users_tms
  FOR UPDATE TO authenticated
  USING (
    auth.user_has_role('manager_prestataire')
    AND prestataire_id = auth.user_prestataire_id()
    AND 'chauffeur' = ANY(roles)
    AND NOT ('manager_prestataire' = ANY(roles))
  )
  WITH CHECK (
    prestataire_id = auth.user_prestataire_id()
    AND roles <@ ARRAY['chauffeur']::text[]
  );

-- User lambda : lecture de son propre record
CREATE POLICY users_tms_self_read ON users_tms
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- User lambda : mise à jour champs non-sensibles (telephone, langue)
-- Les rôles, prestataire_id, statut sont protégés (pas dans WITH CHECK)
CREATE POLICY users_tms_self_update_profile ON users_tms
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- rôles / prestataire_id / statut ne peuvent être modifiés que par staff
    -- contrainte applicative côté Edge Function ou trigger BEFORE UPDATE
  );
```

**Trigger BEFORE UPDATE** sur `users_tms` pour empêcher l'escalade de privilège :

```sql
CREATE OR REPLACE FUNCTION prevent_self_privilege_escalation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id = auth.uid() AND NOT auth.user_is_staff() THEN
    IF NEW.roles IS DISTINCT FROM OLD.roles
       OR NEW.prestataire_id IS DISTINCT FROM OLD.prestataire_id
       OR NEW.statut IS DISTINCT FROM OLD.statut
       OR NEW.chauffeur_id IS DISTINCT FROM OLD.chauffeur_id THEN
      RAISE EXCEPTION 'Self-modification of privileged fields is forbidden';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER users_tms_prevent_escalation
  BEFORE UPDATE ON users_tms
  FOR EACH ROW EXECUTE FUNCTION prevent_self_privilege_escalation();
```

### 3. `chauffeurs`

```sql
-- Ops / Admin : accès complet
CREATE POLICY chauffeurs_staff_all ON chauffeurs
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

-- Manager : RW sur son prestataire_id
CREATE POLICY chauffeurs_manager_rw ON chauffeurs
  FOR ALL TO authenticated
  USING (
    auth.user_has_role('manager_prestataire')
    AND prestataire_id = auth.user_prestataire_id()
  )
  WITH CHECK (
    prestataire_id = auth.user_prestataire_id()
  );

-- Chauffeur : lecture de son propre record
CREATE POLICY chauffeurs_self_read ON chauffeurs
  FOR SELECT TO authenticated
  USING (id = auth.user_chauffeur_id());
```

### 4. `types_vehicules`, `types_contenants`, `formules_catalogue`

Tables de référentiel. Lecture ouverte à tous les rôles authentifiés, écriture réservée.

```sql
-- Lecture : tous les users authentifiés
CREATE POLICY types_vehicules_read_all ON types_vehicules
  FOR SELECT TO authenticated USING (true);

-- Écriture types_vehicules : Ops + Admin
CREATE POLICY types_vehicules_staff_write ON types_vehicules
  FOR INSERT TO authenticated WITH CHECK (auth.user_is_staff());
CREATE POLICY types_vehicules_staff_update ON types_vehicules
  FOR UPDATE TO authenticated
  USING (auth.user_is_staff()) WITH CHECK (auth.user_is_staff());

-- Écriture types_contenants : Admin TMS UNIQUEMENT (Ops Savr lecture seule)
-- Tranché Val 2026-06-07 (floue #3 session test-scenarios M09) : ex-écriture staff (Ops incluse)
-- restreinte à admin_tms — une tare fausse fausse toutes les pesées (auto-tare M05),
-- fréquence ~1×/trimestre. Aligné M09 E4 + matrice §04.
CREATE POLICY types_contenants_read_all ON types_contenants
  FOR SELECT TO authenticated USING (true);

CREATE POLICY types_contenants_admin_write ON types_contenants
  FOR ALL TO authenticated
  USING (auth.user_has_role('admin_tms'))
  WITH CHECK (auth.user_has_role('admin_tms'));

-- Pour formules_catalogue : Admin TMS uniquement (Ops Savr lecture seule)
CREATE POLICY formules_catalogue_read ON formules_catalogue
  FOR SELECT TO authenticated USING (true);

CREATE POLICY formules_catalogue_admin_write ON formules_catalogue
  FOR ALL TO authenticated
  USING (auth.user_has_role('admin_tms'))
  WITH CHECK (auth.user_has_role('admin_tms'));
```

### 5. `vehicules`

```sql
CREATE POLICY vehicules_staff_all ON vehicules
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

CREATE POLICY vehicules_manager_rw ON vehicules
  FOR ALL TO authenticated
  USING (
    auth.user_has_role('manager_prestataire')
    AND prestataire_id = auth.user_prestataire_id()
  )
  WITH CHECK (prestataire_id = auth.user_prestataire_id());

-- Chauffeur : lecture des véhicules qui lui sont assignés (via tournées)
CREATE POLICY vehicules_chauffeur_read ON vehicules
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('chauffeur')
    AND EXISTS (
      SELECT 1 FROM tournees t
      WHERE t.vehicule_id = vehicules.id
        AND (t.chauffeur_id = auth.user_chauffeur_id()
             OR t.equipier_id = auth.user_chauffeur_id())
    )
  );
```

### 6. `collectes_tms`

```sql
CREATE POLICY collectes_tms_staff_all ON collectes_tms
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

CREATE POLICY collectes_tms_manager_rw ON collectes_tms
  FOR ALL TO authenticated
  USING (
    auth.user_has_role('manager_prestataire')
    AND prestataire_id = auth.user_prestataire_id()
  )
  WITH CHECK (prestataire_id = auth.user_prestataire_id());

-- Chauffeur : lecture des collectes rattachées à ses tournées
-- (refonte multi-camions 2026-05-25 : jointure via collecte_tournees, ex collectes_tms.tournee_id)
CREATE POLICY collectes_tms_chauffeur_read ON collectes_tms
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('chauffeur')
    AND EXISTS (
      SELECT 1 FROM collecte_tournees ct
      JOIN tournees t ON t.id = ct.tournee_id
      WHERE ct.collecte_tms_id = collectes_tms.id
        AND (t.chauffeur_id = auth.user_chauffeur_id()
             OR t.equipier_id = auth.user_chauffeur_id())
    )
  );
```

### 6 bis. `collecte_tournees` *(nouvelle table — refonte multi-camions 2026-05-25)*

```sql
CREATE POLICY collecte_tournees_staff_all ON collecte_tournees
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

-- Manager : lignes dont la tournée appartient à son prestataire
CREATE POLICY collecte_tournees_manager_read ON collecte_tournees
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('manager_prestataire')
    AND EXISTS (
      SELECT 1 FROM tournees t
      WHERE t.id = collecte_tournees.tournee_id
        AND t.prestataire_id = auth.user_prestataire_id()
    )
  );

-- Chauffeur : lignes dont la tournée lui est assignée (conducteur ou équipier)
CREATE POLICY collecte_tournees_chauffeur_read ON collecte_tournees
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('chauffeur')
    AND EXISTS (
      SELECT 1 FROM tournees t
      WHERE t.id = collecte_tournees.tournee_id
        AND (t.chauffeur_id = auth.user_chauffeur_id()
             OR t.equipier_id = auth.user_chauffeur_id())
    )
  );
```

**Écriture** : `collecte_tournees` n'est écrite que par le système (dispatch M02/M04 + trigger coût `fn_m07_calc_cost`), via service role / SECURITY DEFINER. Aucun rôle applicatif (manager, chauffeur) n'insère/modifie/supprime directement.

### 7. `tournees`

```sql
CREATE POLICY tournees_staff_all ON tournees
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

CREATE POLICY tournees_manager_rw ON tournees
  FOR ALL TO authenticated
  USING (
    auth.user_has_role('manager_prestataire')
    AND prestataire_id = auth.user_prestataire_id()
  )
  WITH CHECK (prestataire_id = auth.user_prestataire_id());

-- Chauffeur : lecture de ses tournées (comme conducteur ou équipier)
CREATE POLICY tournees_chauffeur_read ON tournees
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('chauffeur')
    AND (chauffeur_id = auth.user_chauffeur_id()
         OR equipier_id = auth.user_chauffeur_id())
  );

-- Chauffeur : UPDATE limité à statut d'exécution (démarrage, arrivée, fin)
-- Les autres champs (coût, prestataire, dates planifiées) restent read-only
CREATE POLICY tournees_chauffeur_exec ON tournees
  FOR UPDATE TO authenticated
  USING (
    auth.user_has_role('chauffeur')
    AND chauffeur_id = auth.user_chauffeur_id()
  )
  WITH CHECK (
    chauffeur_id = auth.user_chauffeur_id()
  );
```

**Note** : protection des champs coût/tarif sur UPDATE chauffeur via un trigger `BEFORE UPDATE` ou via une vue restreinte côté app mobile. Le chauffeur ne doit pas pouvoir modifier `cout_calcule_ht`, `grille_tarifaire_id`, etc.

### 8. `pesees`

```sql
CREATE POLICY pesees_staff_all ON pesees
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

-- Manager : lecture seule sur pesées des tournées de son prestataire
CREATE POLICY pesees_manager_read ON pesees
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('manager_prestataire')
    AND EXISTS (
      -- refonte multi-camions 2026-05-25 : jointure via collecte_tournees (ex c.tournee_id = t.id)
      SELECT 1 FROM tournees t
      JOIN collecte_tournees ct ON ct.tournee_id = t.id
      WHERE ct.collecte_tms_id = pesees.collecte_tms_id
        AND t.prestataire_id = auth.user_prestataire_id()
    )
  );

-- Chauffeur : RW sur ses propres saisies (INSERT + SELECT toujours ; UPDATE/DELETE jusqu'à clôture tournée)
CREATE POLICY pesees_chauffeur_insert ON pesees
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.user_has_role('chauffeur')
    AND saisi_par_chauffeur_id = auth.user_chauffeur_id()
  );

CREATE POLICY pesees_chauffeur_read ON pesees
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('chauffeur')
    AND saisi_par_chauffeur_id = auth.user_chauffeur_id()
  );

CREATE POLICY pesees_chauffeur_update ON pesees
  FOR UPDATE TO authenticated
  USING (
    auth.user_has_role('chauffeur')
    AND saisi_par_chauffeur_id = auth.user_chauffeur_id()
    AND EXISTS (
      -- refonte multi-camions 2026-05-25 : on s'appuie sur pesees.tournee_id (tournée du chauffeur)
      -- au lieu de joindre via collectes_tms.tournee_id (retiré) — une collecte a N tournées,
      -- la pesée appartient à UNE tournée précise (celle du camion qui a pesé).
      SELECT 1 FROM tournees t
      WHERE t.id = pesees.tournee_id
        AND t.statut IN ('en_cours', 'planifiee')  -- pas clôturée
    )
  );
```

### 9. `rolls_mouvements`

```sql
CREATE POLICY rolls_staff_all ON rolls_mouvements
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

-- Manager : lecture sur tournées de son prestataire
CREATE POLICY rolls_manager_read ON rolls_mouvements
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('manager_prestataire')
    AND EXISTS (
      SELECT 1 FROM collectes_tms c
      JOIN tournees t ON t.id = c.tournee_id
      WHERE c.id = rolls_mouvements.collecte_tms_id
        AND t.prestataire_id = auth.user_prestataire_id()
    )
  );

-- Chauffeur : INSERT + SELECT de ses propres saisies
CREATE POLICY rolls_chauffeur_insert ON rolls_mouvements
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.user_has_role('chauffeur')
    AND saisi_par_chauffeur_id = auth.user_chauffeur_id()
  );

CREATE POLICY rolls_chauffeur_read ON rolls_mouvements
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('chauffeur')
    AND saisi_par_chauffeur_id = auth.user_chauffeur_id()
  );

-- UPDATE / DELETE : réservé Admin TMS (correction historique)
```

### 10. `incidents`

```sql
CREATE POLICY incidents_staff_all ON incidents
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

-- Manager : lecture sur ses tournées + incidents déclarés par ses chauffeurs
CREATE POLICY incidents_manager_read ON incidents
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('manager_prestataire')
    AND (
      EXISTS (
        SELECT 1 FROM tournees t WHERE t.id = incidents.tournee_id
          AND t.prestataire_id = auth.user_prestataire_id()
      )
      OR EXISTS (
        SELECT 1 FROM chauffeurs ch WHERE ch.id = incidents.declarant_chauffeur_id
          AND ch.prestataire_id = auth.user_prestataire_id()
      )
    )
  );

-- Chauffeur : RW sur ses propres déclarations
CREATE POLICY incidents_chauffeur_rw ON incidents
  FOR ALL TO authenticated
  USING (
    auth.user_has_role('chauffeur')
    AND declarant_chauffeur_id = auth.user_chauffeur_id()
  )
  WITH CHECK (
    declarant_chauffeur_id = auth.user_chauffeur_id()
  );
```

### 11. `grilles_tarifaires_prestataires`

Propagation M06 D3 (2026-04-24) : écriture réservée **Admin TMS**, Ops Savr et Manager prestataire lecture seule (durcissement vs `auth.user_is_staff()` initial).

```sql
-- Lecture : Ops Savr + Admin TMS
CREATE POLICY grilles_staff_read ON grilles_tarifaires_prestataires
  FOR SELECT TO authenticated
  USING (auth.user_is_staff());

-- Écriture : Admin TMS uniquement
CREATE POLICY grilles_admin_tms_write ON grilles_tarifaires_prestataires
  FOR ALL TO authenticated
  USING (auth.user_has_role('admin_tms'))
  WITH CHECK (auth.user_has_role('admin_tms'));

-- Manager : lecture seule sur ses grilles
CREATE POLICY grilles_manager_read ON grilles_tarifaires_prestataires
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('manager_prestataire')
    AND prestataire_id = auth.user_prestataire_id()
  );
```

### 11bis. `tournees` — colonnes ajustement M07 (propagation 2026-04-24, simplifié sobriété 2026-04-30)

Colonnes ajustement (`cout_ajuste_ht`, `motif_ajustement`, `ajuste_par_user_id`, `ajuste_at`, `statut_financier`, `cout_final_ht`, `cout_final_verrouille`) soumises à une policy spécifique par rôle, plus stricte que la policy globale `tournees`.

**Sobriété 2026-04-30** : workflow validation Admin TMS supprimé (A3) → suppression policy `tournees_validation_admin_tms_only` + trigger seuil. Tous ajustements Ops Savr ET Admin TMS suivent la même policy unique. Suppression colonnes `statut_ajustement`/`validation_admin_*`/`motif_refus_admin` (cf. §04 §1).

```sql
-- Ajustement : Ops Savr ET Admin TMS peuvent UPDATE (pas de seuil, push S6 auto immédiat)
CREATE POLICY tournees_ajustement_staff_write ON tournees
  FOR UPDATE TO authenticated
  USING (auth.user_is_staff() AND statut = 'terminee' AND cout_final_verrouille = false)
  WITH CHECK (
    auth.user_is_staff()
    AND statut = 'terminee'
    AND cout_final_verrouille = false
    AND statut_financier IN ('calcule', 'ajuste')  -- revue sobriété §05 2026-05-01 D2 : 'cout_manquant' retiré
  );

-- Trigger DB tms.trg_tournees_ajustement_log (BEFORE UPDATE sur cout_ajuste_ht) :
-- - INSERT append-only dans ajustements_couts_log
-- - SET statut_financier = 'ajuste'
-- - SET cout_final_ht = cout_ajuste_ht
-- - INSERT integrations_logs sortant 'course-cout-calculee' v+1 (push S6 immédiat, pas de seuil)


-- Interdiction UPDATE de cout_calcule_ht (figement R2.8 §05 authoritative)
-- Trigger DB tms.trg_tournees_cout_calcule_immutable (BEFORE UPDATE) :
-- IF OLD.cout_calcule_ht IS NOT NULL AND NEW.cout_calcule_ht IS DISTINCT FROM OLD.cout_calcule_ht THEN
--   RAISE EXCEPTION 'cout_calcule_ht immuable post-clôture (R2.8). Utiliser cout_ajuste_ht.';
-- END IF;
```

**Manager prestataire** : lecture des colonnes ajustement sur ses tournées (visibilité sur son propre coût final). Policy existante `tournees_manager_read` étendue pour inclure ces colonnes.

**Chauffeur** : pas d'accès aux colonnes ajustement (info financière privée).

### 11ter. `ajustements_couts_log` (nouveau — propagation M07 2026-04-24)

Table append-only. Trace audit complète de chaque action d'ajustement.

```sql
-- Lecture : Ops Savr + Admin TMS
CREATE POLICY ajustements_log_staff_read ON ajustements_couts_log
  FOR SELECT TO authenticated
  USING (auth.user_is_staff());

-- Pas de policy INSERT côté RLS : insertions via trigger DB uniquement (définer security)
-- tms.trg_tournees_ajustement_log (AFTER INSERT/UPDATE sur tournees) INSERT append-only

-- Interdiction UPDATE et DELETE strictes (append-only)
CREATE POLICY ajustements_log_no_update ON ajustements_couts_log
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY ajustements_log_no_delete ON ajustements_couts_log
  FOR DELETE TO authenticated
  USING (false);

-- Trigger DB BEFORE UPDATE/DELETE défensif (si policies bypassées par rôle service)
CREATE TRIGGER tg_ajustements_log_append_only
  BEFORE UPDATE OR DELETE ON ajustements_couts_log
  FOR EACH ROW EXECUTE FUNCTION tms.raise_append_only_violation();
```

Tests pgTAP dédiés (3 tests) : lecture Ops OK, lecture Manager refusée, UPDATE/DELETE strictement refusés même en admin_tms.

---

### 12. `factures_prestataires` + `factures_prestataires_lignes` + `exports_pennylane_log`

Refonte propagation M08 2026-04-24, simplifié revue sobriété 2026-04-30 (B1 + B2 + D1) + revue sobriété §04 2026-04-30 (A5) :
- Statut initial INSERT = `en_attente` (refonte enum, plus `deposee`).
- UPDATE `action_deverrouillage` / `motif_deverrouillage` réservé `admin_tms` uniquement (R_M08.5). retirée V1 (revue sobriété §04 2026-04-30 B1) — acteur tracé via `audit_logs.acteur_user_id` action `DEVERROUILLAGE_FACTURE`.
- UPDATE statut `valide` → `regle` réservé staff (Ops + Admin).
- **Supprimée revue sobriété 2026-04-30 B2** — trace via `tms.audit_logs` action `M08_EXPORT_PENNYLANE` (RLS audit_logs standard, immutabilité applicative D5 M13).
- **Table supprimée V1 (revue sobriété §04 2026-04-30 A5)** — audit visuel via `factures_prestataires.pdf_url` + `pdf_extraction_json`. Plus de RLS dédiée à créer.
- Statut `rejetee_pour_correction` fusionné dans `conteste` + flag `conteste_apres_validation` boolean (revue sobriété 2026-04-30 D1) — RLS factures_prestataires inchangée.

```sql
CREATE POLICY factures_staff_all ON factures_prestataires
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

-- Manager : INSERT (upload) + SELECT, pas UPDATE ni DELETE
CREATE POLICY factures_manager_insert ON factures_prestataires
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.user_has_role('manager_prestataire')
    AND prestataire_id = auth.user_prestataire_id()
    AND statut_rapprochement = 'en_attente'  -- INSERT forcément en en_attente (propagation M08 2026-04-24)
    AND source_upload = 'manager_m03'
  );

CREATE POLICY factures_manager_read ON factures_prestataires
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('manager_prestataire')
    AND prestataire_id = auth.user_prestataire_id()
  );

-- Manager : aucun UPDATE autorisé (immuabilité post-upload, rectification = nouvelle facture D7)
-- trigger BEFORE UPDATE refuse tout UPDATE si rôle = manager_prestataire (cohérence applicative + DB)

-- Admin TMS seul pour déverrouillage W9 (R_M08.5(b))
-- Revue sobriété §04 2026-04-30 B1 : retrait `deverrouillee_par_user_id = auth.uid()` (colonne supprimée V1).
-- L'identité de l'acteur Admin est garantie par `auth.user_has_role('admin_tms')` et tracée
-- automatiquement par `tms.audit_logs.acteur_user_id` (capture trigger AFTER UPDATE).
--
-- ⚠ Enforcement colonne-level (arbitrage Val 2026-06-06) : la RLS PostgreSQL est ROW-level, pas
-- column-level. La policy permissive `factures_staff_all` (FOR ALL, user_is_staff() ⊇ ops_savr)
-- autorise déjà ops_savr à UPDATE n'importe quelle colonne. Les policies sont ADDITIVES → la policy
-- ci-dessous N'ENLÈVE RIEN à ops_savr. Le cloisonnement « colonnes W9 = admin_tms only »
-- (action_deverrouillage / motif_deverrouillage / deverrouillee_at) est donc imposé par le
-- TRIGGER `trg_factures_deverrouillage_admin_only` BEFORE UPDATE (M08 §11.14), PAS par cette policy.
-- La policy ci-dessous reste utile comme documentation d'intention + WITH CHECK motif≥30.
--
-- NB (arbitrage Val 2026-06-06) : Ops PEUT contester une facture `valide` (W6) → statut `conteste`
-- + `conteste_apres_validation=true` + déverrouillage des tournées (trg_m08_deverrouiller). Ce chemin
-- n'écrit AUCUNE colonne W9 → non bloqué par le trigger. Le déverrouillage de tournées n'est donc
-- plus strictement admin-only ; seules les colonnes W9 le sont.
CREATE POLICY factures_admin_deverrouillage ON factures_prestataires
  FOR UPDATE TO authenticated
  USING (
    auth.user_has_role('admin_tms')
    AND action_deverrouillage IS NOT NULL  -- check applicatif complémentaire via trigger BEFORE UPDATE
  )
  WITH CHECK (
    auth.user_has_role('admin_tms')
    AND motif_deverrouillage IS NOT NULL
    AND char_length(motif_deverrouillage) >= 30
  );

-- Trigger compagnon (M08 §11.14) — enforcement colonne-level admin-only :
-- CREATE TRIGGER trg_factures_deverrouillage_admin_only BEFORE UPDATE ON factures_prestataires
--   → RAISE EXCEPTION si (action_deverrouillage|motif_deverrouillage|deverrouillee_at) modifiés
--     ET NOT auth.user_has_role('admin_tms').

-- Audit visuel via factures_prestataires.pdf_url + pdf_extraction_json.
-- Réintroduction V1.1 si rapprochement ligne-à-ligne devient nécessaire métier.

-- Trace via tms.audit_logs action M08_EXPORT_PENNYLANE / M08_EXPORT_PENNYLANE_ANNULEE.
-- RLS audit_logs standard (lecture staff via policies existantes) + immutabilité applicative D5 M13.
-- INSERT via fonction tms.audit_log_emit (Edge Function ou trigger M08 W10).
```

**Tests pgTAP bloquants M08 (propagation 2026-04-24, mis à jour revue sobriété 2026-04-30)** :
- Manager ne peut pas voir factures d'un autre prestataire (RLS leak prevention)
- Manager ne peut pas UPDATE une facture (immuabilité post-upload)
- Ops (non-admin) qui modifie `action_deverrouillage`/`motif_deverrouillage`/`deverrouillee_at` → **RAISE EXCEPTION du trigger `trg_factures_deverrouillage_admin_only`** (arbitrage Val 2026-06-06 — l'enforcement W9-only est au trigger, PAS à la RLS qui est row-level ; le test cible le RAISE, pas un deny RLS)
- **Ops PEUT contester une facture `valide` (W6)** → statut `conteste` + `conteste_apres_validation=true` + tournées déverrouillées (arbitrage Val 2026-06-06)
- Ops ne peut PAS contester une facture `regle` (immuabilité R_M08.6, W9 Admin only)
- Admin ne peut pas UPDATE (chemin W9) sans `motif_deverrouillage` ≥ 30 car (revue sobriété §04 2026-04-30 B1 — `deverrouillee_par_user_id` retirée V1, acteur tracé via `audit_logs.acteur_user_id`)
- **Test retiré revue sobriété 2026-04-30 B2** — tracé via `tms.audit_logs` (tests audit_logs immutability déjà couverts par M13 D5)
- Contrainte UNIQUE `(prestataire_id, numero_facture)` bloque doublon
- Trigger `trg_m08_verrouiller` verrouille bien toutes les tournées à la validation
- Trigger `trg_m08_deverrouiller` reset `cout_final_verrouille = false`
- **Ajout revue sobriété 2026-04-30 D1, révisé arbitrage Val 2026-06-06** : transition `valide/regle → conteste` requires `conteste_apres_validation = true` (s'applique W6 Ops contestation d'une `valide` ET W9 Admin) ; contestation depuis `ecart_detecte`/`rapprochement_manuel_requis` requires `conteste_apres_validation = false`
- **Ajout revue sobriété §04 2026-04-30 A5** : schema check pré-migration confirme **suppression entière de la table `factures_prestataires_lignes`** (anciennement B1 sabré 3 colonnes 2026-04-30, A5 finit le travail)

### 13. `stocks_rolls_traiteurs`, `stocks_bacs_entrepot`, `passages_veolia`, `recomptages_stocks_entrepot_log`

Tables internes Ops Savr uniquement.

```sql
CREATE POLICY stocks_rolls_staff_only ON stocks_rolls_traiteurs
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

CREATE POLICY stocks_bacs_staff_only ON stocks_bacs_entrepot
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

CREATE POLICY passages_veolia_staff_full ON passages_veolia
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

-- ⚠ Suppression V3 sobre 2026-04-30 (revue de sobriété A1) :
-- Policies passages_veolia_chauffeur_select et passages_veolia_chauffeur_update_confirm SUPPRIMÉES.
-- Chauffeur n'a plus AUCUN accès à passages_veolia (ni SELECT, ni UPDATE).
-- La déclaration `realise` par Ops (E5 avec checkbox vidéo) vaut désormais confirmation effective (M10 V3 sobre).
-- Plus de modal M05 W13 confirmation passage Veolia, plus d'API /tms/passages-veolia/{id}/confirmer-chauffeur.

-- Append-only log recomptages (propagation M10 2026-04-25)
CREATE POLICY recomptages_log_staff_select ON recomptages_stocks_entrepot_log
  FOR SELECT TO authenticated
  USING (auth.user_is_staff());

CREATE POLICY recomptages_log_staff_insert ON recomptages_stocks_entrepot_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.user_is_staff() AND recompte_par_user_id = auth.uid());

-- UPDATE/DELETE refusés sauf cron purge système (enforcement via trigger BEFORE)
CREATE POLICY recomptages_log_no_update ON recomptages_stocks_entrepot_log
  FOR UPDATE TO authenticated USING (false);

CREATE POLICY recomptages_log_no_delete ON recomptages_stocks_entrepot_log
  FOR DELETE TO authenticated USING (false);
```

**Trigger append-only enforcement** (propagation M10 2026-04-25) :

```sql
CREATE OR REPLACE FUNCTION tms.trg_recomptages_log_append_only_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.cron_purge', true) = 'true' THEN
    RETURN OLD;  -- autorisé pour cron purge système
  END IF;
  RAISE EXCEPTION 'recomptages_stocks_entrepot_log est append-only — UPDATE/DELETE interdit';
END;
$$;

CREATE TRIGGER trg_recomptages_log_append_only
  BEFORE UPDATE OR DELETE ON recomptages_stocks_entrepot_log
  FOR EACH ROW EXECUTE FUNCTION tms.trg_recomptages_log_append_only_fn();
```

**Tests pgTAP bloquants CI** (propagation M10 2026-04-25) :
- Manager prestataire / Chauffeur → 403 sur SELECT/INSERT `recomptages_stocks_entrepot_log` (deny RLS)
- Ops Savr authentifié → INSERT autorisé avec `recompte_par_user_id = auth.uid()`
- Ops Savr → INSERT refusé si `recompte_par_user_id <> auth.uid()` (anti-spoofing)
- Ops Savr → UPDATE/DELETE → RAISE EXCEPTION (append-only)
- Cron `app.cron_purge=true` → DELETE > 3 ans autorisé

**Tests pgTAP bloquants CI passages_veolia** (V3 sobre 2026-04-30) :
- Chauffeur authentifié → 403 SELECT/UPDATE `passages_veolia` (deny RLS V3 — aucun accès chauffeur, suppression policies revue sobriété 2026-04-30 A1)
- Manager prestataire → 403 SELECT/UPDATE `passages_veolia` (deny RLS)
- Ops Savr → SELECT/INSERT/UPDATE autorisés via policy `passages_veolia_staff_full`
- Ops Savr → UPDATE refusé sur transition `realise → autre statut` (RAISE EXCEPTION trigger `trg_m10_anti_deconfirmation` V3 simplifié)
- Ops Savr → UPDATE autorisé sur transition `planifie → realise` (déclenche trigger `trg_m10_reset_total_pleins` V3 — reset stock immédiat)
- Ops Savr → UPDATE autorisé sur transition `planifie → annule` avec `motif_annulation` NOT NULL

### 14. `parametres_tms`

Policies croisent `modifiable_par[]` avec les rôles du user.

> ⚠ **Tranché Val 2026-06-07 (test-scenarios M13 F5)** : lecture restreinte **staff uniquement** (`admin_tms` + `ops_savr`). L'ex-policy `USING (true)` exposait la config business (seuils tolérance facturation, paliers) aux managers prestataires et chauffeurs, en contradiction avec M13 §2 ("aucun accès"). Les apps clientes (M05 mobile) lisent leurs paramètres `m05_*` via Edge Function (cache 60s, D6 M13), jamais en SELECT direct.

```sql
-- Lecture : staff uniquement (tranché Val 2026-06-07 F5 — ex-"tous authentifiés")
CREATE POLICY parametres_tms_read_staff ON parametres_tms
  FOR SELECT TO authenticated
  USING (auth.user_has_role('admin_tms') OR auth.user_has_role('ops_savr'));

-- Écriture : selon modifiable_par[]
CREATE POLICY parametres_tms_write ON parametres_tms
  FOR UPDATE TO authenticated
  USING (
    (auth.user_has_role('admin_tms') AND 'admin_tms' = ANY(modifiable_par))
    OR (auth.user_has_role('ops_savr') AND 'ops_savr' = ANY(modifiable_par))
  )
  WITH CHECK (
    (auth.user_has_role('admin_tms') AND 'admin_tms' = ANY(modifiable_par))
    OR (auth.user_has_role('ops_savr') AND 'ops_savr' = ANY(modifiable_par))
  );

-- INSERT / DELETE : Admin TMS uniquement
CREATE POLICY parametres_tms_admin_crud ON parametres_tms
  FOR INSERT TO authenticated
  WITH CHECK (auth.user_has_role('admin_tms'));

CREATE POLICY parametres_tms_admin_delete ON parametres_tms
  FOR DELETE TO authenticated
  USING (auth.user_has_role('admin_tms'));
```

### 15. `audit_logs`

```sql
-- Lecture : Ops + Admin uniquement
CREATE POLICY audit_logs_staff_read ON audit_logs
  FOR SELECT TO authenticated USING (auth.user_is_staff());

-- Aucune écriture via client : triggers DB + Edge Functions (service_role)
-- Pas de policy INSERT → bloqué par défaut pour tous les rôles authenticated
```

### 16. `integrations_logs`, `integrations_inbox`

```sql
CREATE POLICY integrations_logs_staff_read ON integrations_logs
  FOR SELECT TO authenticated USING (auth.user_is_staff());

CREATE POLICY integrations_inbox_staff_read ON integrations_inbox
  FOR SELECT TO authenticated USING (auth.user_is_staff());

-- Écriture : service_role only (webhooks, cron), pas de policy pour authenticated
```

### 17bis. `suggestions_attribution_log` (propagation M12 2026-04-24, simplifié revue sobriété 2026-04-29)

Table append-only, historique de toutes les exécutions M12. Pas d'UPDATE/DELETE autorisé depuis clients — uniquement write système (service_role) au moment de l'INSERT par le trigger M12 (T1/T2/T3). Pas d'enrichissement post-INSERT V1 (revue sobriété 2026-04-29 — RPC `tms.m12_enrich_override` + 3 colonnes override_* supprimées).

```sql
-- Lecture : Ops Savr + Admin TMS (monitoring M13)
CREATE POLICY suggestions_log_staff_read ON suggestions_attribution_log
  FOR SELECT TO authenticated
  USING (auth.user_is_staff());

-- INSERT : service_role uniquement (trigger DB + Edge Function M12 T1/T2/T3)
-- Pas de policy FOR INSERT/UPDATE/DELETE pour authenticated → deny par défaut.
-- Append-only strict — pas de RPC d'enrichissement V1.
```

**Rétention** : 2 ans, purge via cron daily DELETE WHERE `cree_le < now() - INTERVAL '2 years'`.

### 17ter. `everest_coverage_cache` — **Caduc (audit cohérence A4 2026-05-09, purge F3 2026-06-07)**



```sql
-- Lecture : Ops Savr + Admin TMS
CREATE POLICY everest_cache_staff_read ON everest_coverage_cache
  FOR SELECT TO authenticated
  USING (auth.user_is_staff());

-- Invalidation manuelle : Admin TMS uniquement (bouton M13 dashboard M12)
CREATE POLICY everest_cache_admin_invalidate ON everest_coverage_cache
  FOR UPDATE TO authenticated
  USING (auth.user_has_role('admin_tms'))
  WITH CHECK (
    auth.user_has_role('admin_tms')
    -- Seules les 3 colonnes invalide_* peuvent être updated (check au niveau trigger BEFORE UPDATE)
  );

-- INSERT/UPSERT lors des appels M12 : service_role uniquement (Edge Function).
```

### 18. `everest_missions`

```sql
CREATE POLICY everest_staff_all ON everest_missions
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

-- Manager A Toutes! : lecture de ses missions
-- (corrigé test-scenarios M14 2026-06-07, floue #1 tranchée Val : `everest_missions` n'a pas de
--  colonne `prestataire_id` — le prédicat passe par la tournée porteuse)
CREATE POLICY everest_manager_atoutes_read ON everest_missions
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('manager_prestataire')
    AND tournee_id IN (
      SELECT t.id FROM tms.tournees t
      WHERE t.prestataire_id = auth.user_prestataire_id()
    )
    -- contrainte implicite : seul A Toutes! a integration_externe = 'everest'
  );
```

### 18bis. Couverture RLS M14 (propagation M14 V1 rédigée 2026-04-25)

La RLS `everest_missions` (section 18) couvre les 4 nouvelles colonnes `manual_acceptance_*` ajoutées par l'addendum M14 §04. Le manager A Toutes! peut voir `manual_acceptance_contact` (qui chez eux a confirmé l'acceptation orale lors d'un failover Ops) — non sensible, et plutôt utile côté A Toutes! pour cohérence interne. Pas de policy column-level dédiée V1.

Les 6 API Routes M14 (5 internes `/api/internal/m14/*` + 1 publique `/api/webhooks/everest`) opèrent sous `service_role` (mutations système) ou rôle utilisateur (manual_accept = `ops_savr`, test_connection = `admin_tms`). Route `/api/internal/m14/missions/replay/:inbox_id` supprimée (sobriété 2026-04-30 A_M14_04 — Admin replay via SQL Studio si besoin, runbook §15). Cf. §07 section 18 Architecture API Routes M14.

Le webhook public `/api/webhooks/everest` :
- Validation token header `X-Webhook-Token` contre `secrets_metadata.everest_webhook_token` (Vault, accès via Edge Function `reveal_secret` côté worker `service_role`).
- Pas de RLS table-level applicable (route publique). La sécurité est dans la validation du token et l'idempotence `integrations_inbox`.

**Tests pgTAP ajoutés** (cf. §15) :
- T_M14.1 : Manager Strike ne peut pas SELECT une `everest_missions` rattachée à A Toutes! (RLS `prestataire_id = auth.user_prestataire_id()`).
- T_M14.2 : Chauffeur A Toutes! ne peut pas SELECT `everest_missions` (rôle `chauffeur` exclu de la policy).
- T_M14.3 : Ops Savr peut UPDATE `manual_acceptance_*` (route `manual_accept` autorisée).
- T_M14.4 : Trigger `trg_m14_cascade_cancel` ne s'enclenche pas si **aucune mission Everest active n'existe** dans `tms.everest_missions` pour la collecte ou sa tournée parente (no-op). Revue sobriété §04 2026-04-30 A6 — colonnes miroir `everest_mission_id` supprimées V1, lookup direct sur `everest_missions`.
- T_M14.5 : CHECK constraint `((statut_everest = 'created_manually') = (manual_acceptance_at IS NOT NULL ...))` rejette mutation incohérente.

### 19. `alertes_catalogue`, `alertes`, `alertes_evenements_log` (propagation M11 2026-04-24)

Spec fonctionnelle : [[06 - Fonctionnalités détaillées TMS/M11 - Alerting transverse]]. Toutes écritures passent par fonctions SECURITY DEFINER (`tms.alerte_emit`, `tms.m11_ack`, `tms.m11_snooze`, etc.). Les policies RLS contrôlent uniquement le SELECT + blocage direct INSERT/UPDATE/DELETE.

```sql
-- 1) tms.alertes_catalogue : catalogue des codes émissibles
-- Lecture tous staff, écriture admin_tms uniquement (D2 catalogue configurable)
CREATE POLICY alertes_catalogue_staff_read ON tms.alertes_catalogue
  FOR SELECT TO authenticated
  USING (auth.user_is_staff());

CREATE POLICY alertes_catalogue_admin_write ON tms.alertes_catalogue
  FOR INSERT TO authenticated
  WITH CHECK (auth.user_has_role('admin_tms'));

CREATE POLICY alertes_catalogue_admin_update ON tms.alertes_catalogue
  FOR UPDATE TO authenticated
  USING (auth.user_has_role('admin_tms'))
  WITH CHECK (auth.user_has_role('admin_tms'));
-- Pas de DELETE user : soft delete via UPDATE supprime_at

-- 2) tms.alertes : liste des alertes émises + cycle de vie
-- SELECT : staff OU destinataire explicite (incl. manager prestataire scope R_M11.8)
CREATE POLICY alertes_staff_or_destinataire_read ON tms.alertes
  FOR SELECT TO authenticated
  USING (
    auth.user_is_staff()
    OR auth.uid() = ANY(destinataires_user_ids)
  );

-- INSERT interdit direct : passer par tms.alerte_emit (SECURITY DEFINER)
CREATE POLICY alertes_no_direct_insert ON tms.alertes
  FOR INSERT TO authenticated
  WITH CHECK (false);

-- UPDATE : transitions de statut autorisées uniquement, via RPC
-- Le contrôle fin R_M11.11 est fait par trigger BEFORE UPDATE qui bloque modification
-- des colonnes immuables (code, criticite, emise_at, entity_type, entity_id, dedup_key,
-- occurrences sauf W1/W7) et vérifie transitions de statut autorisées.
-- Tranché Val 2026-06-07 (F5 scénarios M11) : UPDATE réservé au STAFF uniquement.
-- Un manager prestataire destinataire est lecture seule (SELECT via destinataires_user_ids) ;
-- ack/snooze manager = V1.1 si un code scope entity apparaît. Ex-policy `_or_destinataire_update` restreinte.
CREATE POLICY alertes_staff_update ON tms.alertes
  FOR UPDATE TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());
-- Pas de DELETE user : purge mensuelle via cron service_role (R_M11.10)

-- 3) ⛔ tms.alertes_evenements_log — SUPPRIMÉE Bloc 6 C1 (revue sobriété 2026-04-28)
-- Table fusionnée dans tms.audit_logs (entity_type='alerte', row_id=alerte_id)
-- Policies ci-dessous retirées du déploiement.
-- CREATE POLICY alertes_evt_staff_read ...
-- CREATE POLICY alertes_evt_no_direct_insert ...

-- 4) tms.alertes_archive_critical (NOUVELLE — revue sobriété §05 2026-05-01 B3)
-- Archive append-only des alertes critical purgées par m11_purger_archives
ALTER TABLE tms.alertes_archive_critical ENABLE ROW LEVEL SECURITY;

CREATE POLICY alertes_archive_critical_admin_read ON tms.alertes_archive_critical
  FOR SELECT USING (auth.user_has_role('admin_tms'));
-- Aucun INSERT/UPDATE/DELETE en RLS user :
-- l'INSERT se fait exclusivement via le cron m11_purger_archives étape 1 (SECURITY DEFINER service_role)
-- la table est append-only par construction (pas de UPDATE/DELETE policies)
REVOKE INSERT, UPDATE, DELETE ON tms.alertes_archive_critical FROM authenticated;
GRANT SELECT ON tms.alertes_archive_critical TO authenticated;
```

**Manager prestataire** : reçoit automatiquement les alertes dont le catalogue a `manager_prestataire_scope='entity'` + entity appartient à son prestataire. La résolution est faite par `tms.m11_resoudre_destinataires` (W2) qui ajoute ses user_id aux `destinataires_user_ids` — la policy SELECT `auth.uid() = ANY(destinataires_user_ids)` lui donne l'accès. **Lecture seule** : pas d'ack/snooze/résolution manager (F5 2026-06-07, policy UPDATE staff only ci-dessus). **Note** : aucun code V1 utilisant ce scope à date depuis suppression `m08_rappel_facture` revue sobriété §05 2026-05-01 A1 (supervision factures déplacée sur widget M08 E0 manuel). Pattern conservé pour codes futurs.

**Tests pgTAP bloquants CI** (à ajouter à la suite §A3 tests obligatoires) :

- `test_m11_emit_unknown_code_raises` : `SELECT tms.alerte_emit('inexistant', ...)` → doit lever `ALERT001`
- `test_m11_emit_inactive_code_silent` : désactiver code, `alerte_emit` → renvoie NULL, 0 INSERT
- `test_m11_debounce_increments_occurrences` : 2 appels identiques en <5 min → 1 alerte, `occurrences=2`
- `test_m11_ack_requires_staff` : login user non staff (incl. manager prestataire destinataire), tentative ack → rejet (**F5 2026-06-07** : ack/snooze staff only, ex-`test_m11_ack_requires_destinataire_or_staff`)
- `test_m11_snooze_max_24h_enforced` : tentative snooze 48h → rejet
- `test_m11_resolue_auto_idempotent` : 2 appels `alerte_resoudre_auto` sur même triplet → pas d'erreur, 0 nouvel UPDATE
- `test_m11_manager_prestataire_scope_rls` : manager prestataire A tente de lire alerte manager prestataire B → 0 ligne
- `test_m11_catalogue_admin_only_write` : login ops_savr, tentative UPDATE catalogue → rejet policy
- `test_m11_alertes_no_direct_insert` : login authenticated, tentative INSERT direct tms.alertes → rejet policy
- — retiré Bloc 6 C1 (table fusionnée dans tms.audit_logs)

### 20. `auth_sessions_tms` (device binding / sessions chauffeur — bloc ajouté audit RLS 2026-06-05)

Table de sessions + device binding chauffeur (cf. §04 addendum M05 point 4). Le formalisme manquait en A3 (décrit uniquement en prose addendum M05). INSERT/UPDATE réservés au flow magic link + crons (service_role) ; le chauffeur ne fait que lire ses propres sessions ; Admin TMS full (force-logout C5 M05).

```sql
ALTER TABLE tms.auth_sessions_tms ENABLE ROW LEVEL SECURITY;

-- Chauffeur : lecture de ses propres sessions uniquement
CREATE POLICY auth_sessions_chauffeur_read ON tms.auth_sessions_tms
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('chauffeur')
    AND chauffeur_id = auth.user_chauffeur_id()
  );

-- Admin TMS : lecture + UPDATE révocation (force-logout, audit, fin de contrat)
CREATE POLICY auth_sessions_admin_all ON tms.auth_sessions_tms
  FOR ALL TO authenticated
  USING (auth.user_has_role('admin_tms'))
  WITH CHECK (auth.user_has_role('admin_tms'));

-- Ops Savr : lecture (monitoring sessions)
CREATE POLICY auth_sessions_ops_read ON tms.auth_sessions_tms
  FOR SELECT TO authenticated
  USING (auth.user_has_role('ops_savr'));

-- INSERT/UPDATE applicatifs : flow magic link + cron purge = service_role uniquement.
-- Pas de policy INSERT/UPDATE pour authenticated → deny par défaut (rotation session, revoke).
REVOKE INSERT, UPDATE, DELETE ON tms.auth_sessions_tms FROM authenticated;
```

### 21. `chauffeurs_geolocalisation` (positions GPS chauffeur — bloc ajouté audit RLS 2026-06-05)

Table de géolocalisation chauffeur (cf. §04 §8, ~8M lignes/an, donnée personnelle RGPD, base légale intérêt légitime). Le formalisme RLS manquait entièrement en A3 (décrit en prose §04 avec prédicat erroné `auth.uid()`). Cloisonnement strict : chauffeur = ses positions, manager = ses chauffeurs, staff = tout. Aucune mutation hors INSERT chauffeur ; purge par cron service_role.

```sql
ALTER TABLE tms.chauffeurs_geolocalisation ENABLE ROW LEVEL SECURITY;

-- Ops / Admin : accès complet (dispatch + monitoring tournée en cours)
CREATE POLICY geoloc_staff_all ON tms.chauffeurs_geolocalisation
  FOR ALL TO authenticated
  USING (auth.user_is_staff())
  WITH CHECK (auth.user_is_staff());

-- Chauffeur : lecture de ses propres positions
CREATE POLICY geoloc_chauffeur_read ON tms.chauffeurs_geolocalisation
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('chauffeur')
    AND chauffeur_id = auth.user_chauffeur_id()
  );

-- Chauffeur : INSERT de ses propres positions uniquement (anti-spoofing)
CREATE POLICY geoloc_chauffeur_insert ON tms.chauffeurs_geolocalisation
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.user_has_role('chauffeur')
    AND chauffeur_id = auth.user_chauffeur_id()
  );

-- Manager prestataire : lecture des positions des chauffeurs de son prestataire
CREATE POLICY geoloc_manager_read ON tms.chauffeurs_geolocalisation
  FOR SELECT TO authenticated
  USING (
    auth.user_has_role('manager_prestataire')
    AND EXISTS (
      SELECT 1 FROM tms.chauffeurs ch
      WHERE ch.id = chauffeurs_geolocalisation.chauffeur_id
        AND ch.prestataire_id = auth.user_prestataire_id()
    )
  );

-- UPDATE/DELETE : aucun rôle applicatif. Purge rolling 30j via cron service_role (R_M05.13).
REVOKE UPDATE, DELETE ON tms.chauffeurs_geolocalisation FROM authenticated;
```

**Tests pgTAP bloquants CI (ajout audit RLS 2026-06-05)** :
- `test_geoloc_chauffeur_isolation` : chauffeur A ne lit pas les positions du chauffeur B → 0 ligne.
- `test_geoloc_manager_scope` : manager Strike ne lit pas les positions d'un chauffeur Marathon → 0 ligne.
- `test_geoloc_chauffeur_insert_self_only` : INSERT avec `chauffeur_id <> auth.user_chauffeur_id()` → rejet (anti-spoofing).
- `test_auth_sessions_chauffeur_self_only` : chauffeur ne lit que ses sessions ; INSERT direct authenticated → rejet (service_role only).

### Tests RLS obligatoires (à jouer en CI)

Suite SQL dédiée, exécutée à chaque déploiement :

1. `test_manager_strike_cannot_read_marathon` : login manager Strike, `SELECT count(*) FROM tournees WHERE prestataire_id = <marathon_id>` → doit retourner 0.
2. `test_chauffeur_cannot_read_other_chauffeur_pesees` : login chauffeur A, insérer pesée chauffeur B côté service_role, requête chauffeur A → 0 lignes.
3. `test_self_privilege_escalation_blocked` : login manager, tentative `UPDATE users_tms SET roles = roles || 'admin_tms' WHERE id = auth.uid()` → exception.
4. `test_ops_savr_cannot_read_audit_via_direct_insert` : login ops, tentative INSERT audit_logs → rejet policy (pas de policy INSERT pour authenticated).
5. `test_suspended_prestataire_blocked_at_login` : marquer prestataire `statut = suspendu`, login manager → 0 session émise (via trigger login).
6. `test_chauffeur_pesees_immutable_after_tournee_cloture` : clôturer tournée, tentative UPDATE pesée chauffeur → bloqué par policy.
7. `test_chauffeur_predicate_uses_chauffeur_id_claim` *(non-régression audit RLS 2026-06-05)* : un chauffeur dont `users_tms.id` ≠ `chauffeurs.id` (cas réel : ce sont des entités distinctes) lit bien **ses** tournées/pesées via le claim `tms_chauffeur_id` — vérifie qu'aucune policy chauffeur n'utilise `auth.uid()` à la place de `auth.user_chauffeur_id()` (sinon le chauffeur ne voit rien, ou matche une mauvaise ligne).

Référence complète : §15 Sécurité et conformité TMS.

---

## A4. Cycle de vie des comptes

### Création d'un compte

**Acteurs autorisés** :
- **Admin TMS** : peut créer n'importe quel rôle (ops_savr, admin_tms, manager_prestataire, chauffeur).
- **Manager prestataire** : peut créer un chauffeur de son `prestataire_id` uniquement (policy RLS + trigger `prevent_self_privilege_escalation`).

**Workflow nominal (Admin TMS crée un manager Strike)** :

1. Admin TMS ouvre M13 → "Ajouter un utilisateur".
2. Saisit email, nom, prénom, téléphone, rôle(s), `prestataire_id` (obligatoire si `manager_prestataire` ou `chauffeur`).
3. Edge Function `invite_user` :
   - Crée `auth.users` via `supabase.auth.admin.createUser({ email, email_confirm: false })` sans mot de passe.
   - Crée `users_tms` lié (même `id`), statut `actif`.
   - Envoie un **magic link d'invitation** (expire 7 jours) via Supabase Auth.
   - Trace `audit_logs.action = 'user_invited'`.
4. Le destinataire reçoit un email : "Val a créé votre compte Savr TMS. Cliquez pour activer." → lien magique qui ouvre un écran de création de mot de passe.
5. À la création du mot de passe, obligation d'activer MFA si rôle = `admin_tms`.
6. Premier login : trace `audit_logs.action = 'first_login'`.

**Workflow création chauffeur par manager** :

1. Manager Strike ouvre M06 → "Ajouter un chauffeur".
2. Saisit infos chauffeur + coche "Créer un compte app mobile".
3. Si coché : email obligatoire, Edge Function `invite_driver` → crée `auth.users`, `users_tms` (role = `chauffeur`, `prestataire_id` du manager, `chauffeur_id` FK), envoie magic link.
4. Si non coché : crée uniquement `chauffeurs` (pas de compte). Chauffeur legacy, recouvrement MTS-1, vacataire.

### Invitation et activation

- **Magic link invitation** : JWT signé Supabase, TTL 7 jours, à usage unique.
- Si expiré → manager peut renvoyer une invitation (nouveau token).
- Après 3 invitations non acceptées en 30 jours → alerte Ops Savr (manager qui crée des comptes fantômes).
- À l'activation : l'utilisateur définit son mot de passe (contraintes min 12 car, 1 maj, 1 min, 1 chiffre, 1 symbole ; zxcvbn score ≥ 3).
- Pas de question de sécurité (anti-pattern 2026). Recovery = email + éventuellement MFA backup code.

### Modification des rôles

- Réservé Admin TMS (via M13).
- Toute modification de `users_tms.roles`, `prestataire_id`, `statut`, `chauffeur_id` → trigger DB qui :
  1. Écrit dans `audit_logs`.
  2. Appelle `supabase.auth.admin.invalidateRefreshTokens(user_id)` → force logout sur toutes sessions.
  3. Force la regénération des custom claims au prochain login.

### Suspension et désactivation

**Suspension temporaire** (`users_tms.statut = 'suspendu'`) :
- Déclenchée par Admin TMS (ex: manager en congé prolongé, suspicion de fraude).
- Effet immédiat : toutes les sessions révoquées, login refusé avec message "Compte suspendu, contactez Savr".
- Réversible : `statut = 'actif'` → login redevient possible, mais MFA/password inchangés.

**Désactivation définitive** (`users_tms.statut = 'archive'`) :
- Workflow RGPD (cf. A5 Droit à l'effacement).
- Conserve la ligne `users_tms` pour intégrité référentielle des `audit_logs`, `pesees.saisi_par_chauffeur_id`, `factures.uploade_par_user_id`, etc.
- PII anonymisée : `email = 'archived-<uuid>@tms.gosavr.io'`, `telephone = NULL`, `nom = 'Archivé'`, `prenom = ''`.
- `auth.users` supprimé via `supabase.auth.admin.deleteUser(id)` → plus aucune session possible.
- Trace `audit_logs.action = 'user_archived'` avec motif.

**Cascade côté `chauffeurs`** :
- Désactivation user ≠ suppression chauffeur. Le `chauffeurs` reste (audit tournées passées), `user_tms_id` passe à NULL, `statut = 'archive'`.
- Documents permis / CI / visite médicale : rétention 3 ans après départ (obligation employeur), puis purge automatique (cron). Détail en A5.

### Récupération de mot de passe

1. User clique "Mot de passe oublié" sur login.
2. Saisit email → Edge Function vérifie `users_tms.statut = 'actif'` (sinon message générique "email envoyé si compte existe", pour éviter l'énumération).
3. Email envoyé avec lien reset (JWT Supabase Auth, TTL 30 min, usage unique).
4. Reset mot de passe → force une **re-validation MFA** si MFA activé (pas de contournement via reset password).
5. Toutes les sessions actives sont invalidées.
6. Trace `audit_logs.action = 'password_reset'`.

**Rate limit** : max 5 demandes de reset par email par heure. Au-delà, silently dropped côté Edge Function.

### Reset MFA

- Uniquement par Admin TMS (workflow A1).
- User lambda sans MFA actif peut s'auto-enroller via profil.
- User lambda avec MFA qui perd son device → contact Admin TMS → reset manuel.

### Rate limiting login

- 5 tentatives login échouées en 15 min sur un même email → compte temporairement bloqué 15 min.
- 20 tentatives login échouées sur une IP en 15 min → IP blocklistée 1h (via Cloudflare + edge rules Supabase).
- Captcha Cloudflare Turnstile au 3e échec.
- Alerte critical Ops Savr (in-app + email Resend) si 10 emails distincts bloqués dans la même heure (attaque crédential stuffing). Code catalogue M11 : `m11_credential_stuffing_suspect` (à seeder). dégagé V1 (revue sobriété 2026-04-25 A6).

---

## A5. RGPD et confidentialité

### Catégories de données personnelles traitées

| Donnée | Table | Base légale | Rétention |
|--------|-------|-------------|-----------|
| Email, nom, prénom, téléphone | `users_tms` + `auth.users` | Exécution contrat (manager, ops) / intérêt légitime (chauffeur app mobile) | Durée relation + 3 ans |
| Permis de conduire, CNI, visite médicale | Storage (FK `chauffeurs.permis_url` etc.) | Obligation légale employeur transport | 3 ans après départ chauffeur, purge auto cron |
| Géolocalisation chauffeur (tournée en cours) | `tms.chauffeurs_geolocalisation` (cf. §04 §8) *(corrigé Bloc 3 2026-06-04 — ex-`tournees.positions_gps jsonb`, table jamais créée)* | **Intérêt légitime** (sécurité tournée + preuve de passage) — base unique, le consentement n'est pas la base retenue (position CNIL géoloc salariés). Information via notice inscription + CGU. | 30 jours, purge auto |
| Coordonnées GPS collecte (lieu événement) | `collectes_tms.adresse` | Exécution contrat | 5 ans (Registre transport) |
| Logs de connexion (IP, user-agent) | `audit_logs.acteur_meta` | Sécurité, intérêt légitime | 12 mois puis anonymisation IP |
| Logs d'activité (mutations) | `audit_logs` | Obligation légale (traçabilité) | 5 ans |

### Information géoloc et acceptation de la notice (refondu Bloc 3 2026-06-04)

> **Réconciliation Bloc 3 2026-06-04** : l'ancien modèle ci-dessous (consentement Art. 7 + refus possible + révocation in-app via profil + notification manager) est **retiré**. Il contredisait §12 D6 + §15.4.1 (CGU + écran d'information, pas de toggle refusable, pas de révocation in-app) et la position CNIL (le consentement n'est pas la base légale valable pour la géoloc de salariés, en raison du lien de subordination). Modèle canonique V1 : **base légale = intérêt légitime**, l'écran sert à l'**information + la preuve**, pas à recueillir un consentement refusable. Source de vérité : [[15 - Sécurité et conformité TMS]] §15.4.1.

- **Base légale géoloc = intérêt légitime** (sécurité tournée + preuve de passage). Pas de consentement au sens Art. 7 : la géoloc est indispensable à l'exécution de la tournée, elle n'est donc pas refusable individuellement.
- **Écran d'information à l'inscription (1ère connexion PWA chauffeur)** : notice bloquante (finalité, base légale, rétention 30j, destinataires Ops Savr + manager prestataire, droits + canal de contact) + bouton « J'ai lu et compris » obligatoire pour accéder à la PWA. Cf. §12 D6.
- **Trace** : `users_tms.consentements jsonb = { "geoloc_notice": { "acknowledged_at", "version_notice", "ip" } }` (preuve horodatée détenue par Savr, indépendante du contrat prestataire).
- **Versioning** : ré-affichage bloquant de la notice **uniquement si `version_notice` change matériellement** (exceptionnel). En dehors de ce cas, le chauffeur n'est plus confronté au sujet.
- **Pas d'UI in-app après l'inscription V1** : pas d'écran « Mes données » permanent, pas de bouton de révocation/opposition in-app (rejet du « point 4 », arbitrage Val Bloc 3). L'information via CGU prestataire signée à l'embauche reste en complément.
- — **Retiré V1 (Bloc 3 2026-06-04)** : pas de mécanisme de révocation in-app. La géoloc étant fondée sur l'intérêt légitime et indispensable au job, une demande d'opposition (Art. 21) est traitée hors app par l'Admin TMS / le manager prestataire (cf. table « Droits des personnes concernées »). Risque assumé documenté §15.4.1 + §15.5.1.
- — **Retiré V1 (Bloc 3 2026-06-04)** : sans objet (plus de révocation in-app).

### CGU TMS distinctes

- **CGU TMS indépendantes** des CGU Plateforme. Population différente (managers prestataires, chauffeurs), traitements différents (géoloc, docs permis, pesées), obligations différentes (Registre transport).
- Versioning : la version acceptée est tracée dans `users_tms.consentements` (clé `geoloc_notice.version_notice` pour la notice géoloc chauffeur ; clé CGU si acceptation CGU in-app). Ré-acceptation bloquante **uniquement en cas de mise à jour matérielle** (exceptionnel) — pas de re-confrontation routinière de l'utilisateur (alignement Bloc 3 2026-06-04).
- Contenu CGU à rédiger avec juriste RSE (cf. §00 Question ouverte 4).

### Fin de contrat prestataire (révocation accès)

Quand Savr résilie son contrat avec un prestataire (Strike, Marathon, province) :

1. **J0 — Résiliation contractuelle** : `prestataires.statut = 'suspendu'`, date `fin_contrat_at` renseignée.
2. **J0 → J+30** : les `users_tms.prestataire_id = X` restent en `statut = 'actif'` mais accès restreint applicativement (lecture seule sur factures/historique, pas de nouvelle tournée visible car flux coupé côté Plateforme). Permet de régler les factures en cours.
3. **J+30** : cron auto → tous les `users_tms.prestataire_id = X` passent en `statut = 'archive'`, sessions invalidées, email de notification envoyé. `prestataires.statut = 'archive'`.
4. Trace complète dans `audit_logs` (chaque `user_archived` + `prestataire_archived`).

Gestion manuelle possible par Admin TMS pour anticiper (ex: incident de sécurité → archive immédiate sans délai de 30j).

### Droits des personnes concernées

> **Réconciliation Bloc 3 2026-06-04** : §15.5.1 acte qu'il n'y a **pas de portail self-service d'exercice des droits V1** (risque CNIL assumé, arbitrage Val atelier 2026-04-23 + Bloc 3). La table ci-dessous est donc requalifiée : tous les droits sont **traités manuellement par l'Admin TMS sur demande** (canal email / manager prestataire), pas via des boutons in-app. L'ancienne version (bouton « Exporter mes données » in-app, opposition = révocation consentements géoloc) est retirée.

| Droit | Traitement V1 (manuel, Admin TMS — pas de self-service in-app) |
|-------|-------------------|
| Accès (Art. 15) | Sur demande → Admin TMS génère un export JSON consolidé (`users_tms`, `chauffeurs`, tournées rattachées, pesées saisies, incidents déclarés, audit_logs où acteur = self) via requête / Edge Function admin, transmis par lien signé. **reporté V1.1 (§15.5.1)** |
| Rectification (Art. 16) | Champs non-sensibles via profil ; rôles / prestataire / sensibles via Admin TMS |
| Effacement (Art. 17) | Workflow "archive" (A4) — anonymisation PII, conservation lignes pour intégrité référentielle. Documents permis/CI/visite purgés par cron après 3 ans (obligation employeur). **Pas de purge anticipée à la demande V1 (Bloc 3 3a)** — la rétention 3 ans est une obligation employeur, une suppression anticipée risquerait de détruire une pièce encore légalement requise. Reportée V1.1 si besoin terrain |
| Limitation (Art. 18) | `users_tms.statut = 'suspendu'` (action Admin TMS) |
| Portabilité (Art. 20) | Export JSON structuré idem droit d'accès (manuel Admin TMS) |
| Opposition (Art. 21) | Géoloc fondée sur l'intérêt légitime + indispensable au job → opposition traitée hors app par Admin TMS / manager prestataire (arbitrage au cas par cas, pas de bouton in-app). **retirée V1 (Bloc 3)** |

**Délai de réponse** : 1 mois (Art. 12.3 RGPD), traité par Admin TMS. Trace dans `audit_logs`. **Pas de processus automatisé sous 30j V1** (risque assumé §15.5.1).

### Suppression des documents chauffeur

- Permis, CNI stockés dans Supabase Storage bucket `tms-docs-chauffeurs` privé, RLS activée. **V1 : pas de `visite_medicale_url` ni `attestation_employeur_url`** — reporté V2 (propagation M06 2026-04-24, retrait alertes échéance documentaires).
- Policy Storage : lecture par Ops/Admin + manager `prestataire_id = self` + chauffeur lui-même.
- **Cron quotidien** (Edge Function scheduled) :
  ```sql
  -- Chauffeurs archivés depuis ≥ 3 ans → purge docs
  SELECT id, permis_url, piece_identite_url
  FROM chauffeurs
  WHERE statut = 'archive'
    AND archive_at < now() - interval '3 years'
    AND (permis_url IS NOT NULL OR piece_identite_url IS NOT NULL);
  -- Pour chaque : supabase.storage.from('tms-docs-chauffeurs').remove([...])
  -- UPDATE chauffeurs SET permis_url = NULL, piece_identite_url = NULL WHERE id = ...
  -- INSERT audit_logs action = 'documents_purged_rgpd'
  ```
- **Retiré V1 (Bloc 3 2026-06-04, arbitrage 3a)** : pas de purge manuelle anticipée. La rétention 3 ans est une obligation employeur transport; une suppression avant terme risquerait de détruire une pièce encore légalement requise. Purge **cron seule** au-delà de 3 ans. Réouverture V1.1 si besoin terrain avéré.

### Chiffrement et transport

- **Au repos** : Supabase chiffre PostgreSQL + Storage (AES-256 natif).
- **En transit** : TLS 1.3 obligatoire (HSTS activé sur tms.gosavr.io, redirect 301 HTTP→HTTPS).
- **Secrets applicatifs** : variables d'environnement Edge Functions (Supabase), rotation tous les 90 jours pour clés tierces (Pennylane, Everest). Jamais commit en clair.

### Pseudonymisation des logs

- `audit_logs.acteur_meta.ip` : conservé en clair 12 mois, puis anonymisation (hachage SHA-256 + salt fixe pour conserver corrélation) via cron mensuel.
- `audit_logs.acteur_user_id` conservé (nécessaire audit), mais PII jointe récupérée en live via join (évite duplication).

### Registre des traitements

Maintenu par Val (responsable traitement RGPD). Chaque nouveau champ PII ajouté au DB → entrée dans le registre. Template à valider avec juriste RSE (cf. §00 Question ouverte 4).

### Notification de violation de données

- Procédure : si breach détecté (ex: fuite JWT, exfiltration DB) → notification CNIL sous 72h (Art. 33), notification utilisateurs si risque élevé (Art. 34).
- Contact CNIL préparé à l'onboarding.
- Runbook de réponse en §15 Sécurité TMS.

### Sous-traitants

- **Supabase** (hébergement DB + Auth + Storage) : DPA signé, hébergement EU (Frankfurt région).
- **Cloudflare** (CDN, WAF, rate limit) : DPA, EU residency.
- **Pennylane** (facturation) : DPA, FR hosting.
- **Everest** (A Toutes!) : DPA à signer avant go-live.
- **Strike / Marathon** : prestataires eux-mêmes (managers accédant au TMS) → pas sous-traitants au sens RGPD, mais destinataires de données de leurs propres chauffeurs (traitement conjoint limité).

Liste mise à jour dans §15 Sécurité TMS.

---

## Décisions structurantes

### Architecture Auth
- **Supabase Auth natif** (GoTrue), cohérent stack Plateforme (2026-04-22).
- **SSO Google Workspace V1 pour Ops Savr + Admin TMS** (whitelist domaine `@gosavr.io`). Managers prestataires et chauffeurs restent en email+password (2026-04-22).
- **MFA TOTP obligatoire** pour `admin_tms` qui ne passe pas par SSO. SSO Google délègue MFA à Workspace (2026-04-22).
- **WebAuthn / passkeys → V2** uniquement (2026-04-22).
- **SSO Microsoft prestataires → V2** uniquement (2026-04-22).
- **2 `auth.users` distinctes** Plateforme vs TMS, pas de SSO cross-apps V1 (2026-04-22).
- **Custom claims dans JWT** : `tms_roles`, `tms_prestataire_id`, `tms_chauffeur_id`, `tms_statut` → évite aller-retour DB dans policies (2026-04-22).
- **Fonctions helpers SQL** : `auth.user_is_staff()`, `auth.user_has_role()`, `auth.user_prestataire_id()`, `auth.user_chauffeur_id()` factorisent les policies (2026-04-22).

### Rôles
- **4 rôles V1** : `ops_savr`, `admin_tms`, `manager_prestataire`, `chauffeur`. Cumul via `users_tms.roles text[]` (2026-04-22).
- **Cumul `manager_prestataire` + (`ops_savr` OR `admin_tms`) interdit V1** (contrainte applicative côté M13 + Edge Function `upsert_user_tms`). Envisageable V2 si cas business réel (2026-04-22).
- **Chauffeur multi-prestataires non supporté V1** (1 seul `prestataire_id`). V2 si fréquence réelle mesurée (2026-04-22).
- **Rôle `ops_savr` unique V1** : pas de split `ops_logistique` / `ops_finance`. Split possible V2 si besoin émerge (2026-04-22).
- **Équipiers Strike sans compte** V1 : flag `chauffeurs.peut_conduire = false`, pas de rôle `equipier` dédié (2026-04-22).
- **Policies additives sur cumul** : union des périmètres, jamais plus large que chaque rôle pris séparément (2026-04-22).

### MFA et sessions
- **MFA TOTP obligatoire pour `admin_tms`** hors SSO (SSO Google délègue MFA à Workspace) (2026-04-22).
- **Access token 1h, refresh token 30j** avec rotation à chaque usage (anti-replay), inactivité 14j (2026-04-22).
- **Session mobile chauffeur : 30j standard V1** (même config que web), pas de prolongation 90j (2026-04-22).
- **Force logout automatique** sur modification rôles/prestataire/statut via révocation refresh tokens (2026-04-22).
- **Politique mot de passe** : min 12 caractères, 1 majuscule, 1 minuscule, 1 chiffre, 1 symbole, zxcvbn score ≥ 3 (2026-04-22).

### Workflow comptes
- **Invitation par magic link** TTL 7 jours, à usage unique (2026-04-22).
- **Manager peut créer chauffeurs** de son prestataire (RLS + trigger anti-escalade) (2026-04-22).
- **Trigger `prevent_self_privilege_escalation`** : un user ne peut jamais modifier ses propres rôles/prestataire/statut (2026-04-22).
- **Désactivation = archive** : anonymisation PII, conservation ligne pour intégrité audit (2026-04-22).

### RLS
- **Deny-by-default** + policies explicites par table/rôle (2026-04-22).
- **service_role bypass RLS** réservé aux Edge Functions (jamais exposé front) (2026-04-22).
- **Suite de tests RLS obligatoires** jouée en CI avant déploiement (2026-04-22).

### RGPD
- **Rétention docs chauffeur** : 3 ans après départ, purge auto cron (obligation employeur transport) (2026-04-22).
- **Géoloc chauffeur** : consentement explicite, révocable, rétention 30 jours (2026-04-22).
- **Export données (droit d'accès)** automatisé via Edge Function, réponse < 48h, délai légal 1 mois (2026-04-22).
- **Anonymisation IP audit_logs** après 12 mois (hachage SHA-256 + salt) (2026-04-22).
- **CGU TMS distinctes** des CGU Plateforme (populations + traitements + obligations différentes), versioning strict avec ré-acceptation bloquante sur update majeure (2026-04-22).
- **Fin de contrat prestataire** : suspension 30 jours (règlement factures en cours) puis archivage auto cron (users + prestataire). Override possible par Admin TMS (2026-04-22).

---

## Questions ouvertes

### Résolues 2026-04-22

1. — **Interdit V1, possible V2**. Contrainte applicative côté M13 + Edge Function `upsert_user_tms`.
2. — **Attendre V2**. V1 = workaround 2 comptes (2 emails).
3. — **V1 pour Ops/Admin** (whitelist `@gosavr.io`).
4. — **V2**.
5. — **V1 = un seul rôle `ops_savr`**. Split envisageable V2.
6. — **Validée** : 12 car + 1 maj + 1 min + 1 chiffre + 1 symbole + zxcvbn ≥ 3.
7. — **V1 = 30 jours standard** (pas de prolongation 90j).
8. — **CGU TMS distinctes** des CGU Plateforme.
9. — **30 jours suspension puis archivage auto** (override Admin TMS possible).

### Résiduelles

1. — **Tranché 2026-06-03 (arbitrage Val, option a) : pgTAP**, aligné avec le CDC Plateforme (pgTAP ciblé V1 déjà tranché côté App, revue sobriété §09 2026-06-03 B2). Les RLS vivent dans la DB → les tester en SQL au plus près (pgTAP, Supabase local) est plus direct et fiable qu'un script TypeScript via client Supabase, qui dupliquerait l'approche et désalignerait les deux CDC. **Couverture ciblée V1** (mêmes tables critiques que l'App + cloisonnement) : `factures_prestataires`, `collectes_tms`, `tournees`, `collecte_tournees`, `pesees`, tables `shared.*` (cloisonnement `app_domain`), `audit_logs` (immutabilité) + cas cross-schema deny `plateforme.*` ↔ `tms.*`. **100 % des policies promu V1.1** (cohérent App). Bloquant en CI sur la couverture ciblée. Cohérent avec les blocs pgTAP déjà spécifiés (M10, M13, cloisonnement cross-schema). Détail approche CI : [[15 - Sécurité et conformité TMS]].
2. **Contenu CGU TMS** : à rédiger avec juriste RSE (cf. §00 Question ouverte 4 globale).
3. **Configuration SSO Google Workspace** : activer le provider Supabase Auth + whitelist `@gosavr.io` + politique MFA Workspace (obligatoire pour tous les comptes Savr). Action technique à planifier avant go-live V1.

---

## Liens

- [[04 - Data Model TMS]] — table `users_tms`, matrice RLS, helpers
- [[03 - Périmètre fonctionnel TMS]] — M13 Admin TMS (UI gestion comptes), M06 Référentiel prestataires (création chauffeurs)
- [[05 - Règles métier TMS]] — R6 Cycles de vie (utilisateurs, documents)
- [[08 - Contrat API Plateforme-TMS]] — distinction auth utilisateur vs auth service-to-service (HMAC+JWT)
- [[15 - Sécurité et conformité TMS]] — (à rédiger) — tests RLS, runbook breach, registre traitements, sous-traitants
- [[01 - Cahier des charges App/09 - Auth et permissions]] — cohérence conventions côté Plateforme

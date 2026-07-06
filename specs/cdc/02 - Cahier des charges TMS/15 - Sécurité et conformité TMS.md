---
section: 15 - Sécurité et conformité TMS
statut: V1 rédigée (atelier tech 2026-04-23)
references_plateforme:
  - "01 - Cahier des charges App/15 - Sécurité et conformité.md"
  - "01 - Cahier des charges App/09 - Authentification et permissions.md"
dernière_maj: 2026-06-04 (propagation Bloc 3 — workflow RGPD géoloc — §15.4.1 refondu (base légale intérêt légitime, écran d'information bloquant à l'inscription + trace `users_tms.consentements.geoloc_notice`, révocation in-app retirée, exercice droits hors app), §15.5.1 exception Bloc 3 documentée (écran info géoloc fait V1, reste reporté), §15.13 Q5 validation juriste base légale + AIPD) / 2026-04-27 (propagation §12 App mobile chauffeur V1 — D1 PWA `tms.gosavr.io/m/*` (`chauffeur.savr.fr` retiré §15.2 ligne 24), D6 consentement géoloc CGU uniquement sans UI in-app (§15.4.1 ligne 66 bouton arrêter partage retiré, risque assumé V1 documenté), D7 force change password 1ère connexion ajouté §15.4.4) / 2026-04-25 (propagation M13 Administration TMS — Vault secrets API gérés via Edge Function + reveal 30s + rotation auditée, impersonation tracée double acteur (R_M13.10), session 30j glissantes admin+ops sans re-MFA actions sensibles (D10 R_M13.13 risque assumé), audit_logs strictement immutable confirmé R_M13.18, MFA TOTP admin 1ère fois device + cap 3 devices trusted) / 2026-04-24 propagation M03 Portail prestataire — politique password unifiée manager+chauffeur, argon2id, rate limit, audit auth
---

# 15 — Sécurité et conformité TMS

## 15.1 Cadrage

Le TMS partage l'infrastructure Supabase de la Plateforme (1 projet, 3 schémas). Les dispositifs de sécurité transverses (RLS, JWT enrichi, rotation HMAC annuelle, Supabase Vault, pgTAP) sont définis dans le §15 Plateforme et le §09 Auth Plateforme/TMS.

Ce document précise uniquement **ce qui est spécifique au TMS** : surface d'attaque, données sensibles spécifiques (géoloc chauffeur, factures prestataires), risques juridiques assumés, exigences contractuelles (Viparis), runbook DR.

## 15.2 Surface d'attaque spécifique TMS

| Vecteur | Criticité | Dispositif V1 |
|---|---|---|
| Endpoints API TMS publics (tms.savr.fr) | Haute | Auth Supabase obligatoire + RLS pure sur `tms.*` |
| Webhooks TMS → Plateforme | Haute | HMAC SHA-256 + timestamp + replay protection (nonce 5 min) |
| PWA chauffeur (`tms.gosavr.io/m/*`, propagation §12 D1 2026-04-27) | Moyenne | Session 30j rolling (paramètre unifié `auth.session_duree_jours_par_role->>'chauffeur'` — revue sobriété §05 2026-05-01 C2), device binding 1 device actif (D12 M05), bootstrap password via magic link 30 min (§12 D7 refondu B1 2026-05-01) |
| Polling E6 Everest (sortant) | Basse | Secrets en Supabase Vault, IP sortante Vercel whitelistée si demandé |
| OCR Mistral (sortant) | Basse | Factures uploadées via URL signée R2, clés Vault |
| Accès admin Supabase | Haute | 2FA obligatoire sur Supabase + limitation IP console |
| Fichiers R2 (factures, signatures) | Moyenne | URLs signées courte durée (10 min), pas de lecture publique |

## 15.3 Isolation des données TMS

### Cross-schema deny by default

Règle RLS : un utilisateur authentifié sur `tms.savr.fr` (claim `app_domain = 'tms'`) ne doit **jamais** pouvoir lire/écrire dans `plateforme.*`, et réciproquement.

Implémentation (rappel §09) : chaque policy RLS commence par la clause
```sql
app_domain() = 'tms'
```
ou son équivalent Plateforme. Les tables du schéma `shared.*` ont des policies explicites précisant quel domaine peut y accéder (ex: `tms.audit_logs` : lecture cross-domain pour admins, écriture via service role uniquement).

### Tests bloquants CI (pgTAP)

**Décision atelier** (révisée 2026-06-03 — arbitrage Val, alignement App §09 sobriété 2026-06-03 B2) : **framework = pgTAP** (et non un script TS via client Supabase); les RLS vivent dans la DB, on les teste en SQL au plus près. **Couverture ciblée V1**, **100% promu V1.1**. Le moteur reste identique, seul le périmètre bloquant V1 est resserré sur les tables critiques.

| Scope | Règle |
|---|---|
| Tables critiques V1 (couverture ciblée bloquante) | `factures_prestataires`, `collectes_tms`, `tournees`, `collecte_tournees`, `pesees`, `chauffeurs_geolocalisation` (GPS/RGPD — ajout audit RLS 2026-06-05), `auth_sessions_tms` (sessions chauffeur — ajout audit RLS 2026-06-05), tables `shared.*` (cloisonnement `app_domain`), `audit_logs` (immutabilité) + cas cross-schema deny `plateforme.*` ↔ `tms.*` — DOIVENT avoir `has_rls()` + ≥ 1 test policy positive + ≥ 1 test policy négative |
| Toute nouvelle table `tms.*` ou `shared.*` critique | DOIT avoir un test pgTAP sur le même modèle ; PR bloquée en CI sinon |
| Couverture 100% de toutes les tables RLS | **Promu V1.1** (objectif design V1, bloquant V1.1) |
| Exécution | GitHub Actions sur PR + nightly full run |

## 15.4 Données sensibles TMS spécifiques

### 15.4.1 Géolocalisation chauffeur (`tms.chauffeurs_geolocalisation`)

Donnée la plus sensible RGPD du TMS. Régime **refondu Bloc 3 2026-06-04** (workflow consentement + écran d'information inscription) :

| Exigence | Mise en œuvre V1 |
|---|---|
| **Base légale** | **Intérêt légitime** (sécurité de la tournée + preuve de passage en cas de litige). **Pas le consentement** : pour la géoloc de salariés/chauffeurs, la CNIL écarte le consentement (lien de subordination → consentement non « librement donné », Art. 7). La géoloc est par ailleurs indispensable à l'exécution de la tournée, donc non refusable individuellement. *(requalification Bloc 3 — ex-« consentement chauffeur via CGU »)* |
| Information chauffeur | **Double couche** : (1) **écran d'information bloquant à la 1ère connexion** PWA chauffeur — notice (finalité, base légale, rétention 30j, destinataires, droits + canal de contact) + bouton « J'ai lu et compris » obligatoire (propagation §12 D6 refondu 2026-06-04) ; (2) mention dans la CGU prestataire signée à l'embauche (Strike/Marathon/A Toutes!). |
| Trace de l'acceptation | `users_tms.consentements jsonb = { geoloc_notice: { acknowledged_at, version_notice, ip } }` — **preuve horodatée détenue par Savr**, indépendante du dossier RH prestataire. Ré-affichage bloquant uniquement si `version_notice` change matériellement. |
| Finalité documentée | Optimisation tournées + preuve de passage en cas de litige |
| Rétention | 30 jours (pg_cron purge quotidienne, table `tms.chauffeurs_geolocalisation`) |
| Accès | Exploitants dispatch Savr uniquement, admin prestataire visualise ses chauffeurs |
| Minimisation | Throttling 60s + batch 5 min (pas de tracking temps réel seconde par seconde) |
| Révocation / exercice des droits | **Pas d'UI in-app après l'inscription V1** (arbitrage Val Bloc 3 — écran uniquement à l'inscription, le chauffeur n'est plus confronté au sujet ensuite ; rejet du « point 4 » écran permanent + bouton d'opposition). La géoloc étant fondée sur l'intérêt légitime et indispensable au job, une demande d'opposition (Art. 21) est traitée **hors app par l'Admin TMS / le manager prestataire**, au cas par cas. **Risque assumé V1 documenté** : pas de mécanisme self-service d'exercice des droits (cf. §15.5.1). V1.1 : écran in-app si CNIL/audit/grand compte le remonte. |

**Ce que l'écran d'inscription apporte vs CGU papier seule** : il donne à Savr une **preuve propre, nominative, horodatée et versionnée** que ce chauffeur a vu la notice géoloc dans l'app, opposable sans dépendre du dossier RH du prestataire, et renforce l'obligation d'information (Art. 13). Il ne crée **pas** de mécanisme d'exercice des droits (volontairement écarté V1). Le levier de protection dominant reste la **requalification de la base légale** (intérêt légitime) + le traitement des gaps structurels (registre, PIA) → §15.5.1 + juriste RGPD.

### 15.4.2 Factures prestataires (`tms.factures_prestataires`) — propagation M08 2026-04-24

| Exigence | Mise en œuvre V1 |
|---|---|
| Stockage PDF | Cloudflare R2 (bucket `savr-tms-factures-prestataires`) |
| Accès PDF | URLs signées 10 min |
| Rétention légale | 10 ans (obligation comptable art. L123-22 Code de commerce) |
| OCR data | JSON extraits Mistral OCR stockés dans `tms.factures_prestataires.ocr_data` (JSONB) |
| Archivage | R2 Standard → R2 Glacier après 6 mois |
| Confidentialité | Montants et raisons sociales prestataires (donnée commerciale sensible) |
| Source upload | Traçabilité origine : `manager_m03` (portail self-service M03) \| `ops_savr_manuel` (upload Ops E3) |
| Cycle contestation | Avoir + nouvelle facture (pratique comptable FR) — self-ref FK `facture_corrigee_id` / `remplacee_par_facture_id`. Pas de suppression. |
| Verrouillage rapprochement | Trigger DB `trg_m08_verrouiller_tournees` : tournées rapprochées → `cout_final_verrouille = true` (blocage M07 ajustement, cf. M07 EC9) |
| Déverrouillage Admin | Action Admin TMS uniquement via M08 W9, motif ≥ 30 caractères obligatoire, audit log `action='deverrouillage_facture'` rétention 5 ans (`tms.audit_logs`) |
| RLS | Manager : INSERT uniquement `statut='en_attente'` + source `manager_m03` (aucun UPDATE). Staff : lecture + update. Cf. §09 section 12. |

### 15.4.2.a Exports Pennylane (`tms.audit_logs` action `M08_EXPORT_PENNYLANE`) — propagation M08 2026-04-24, simplifié revue sobriété 2026-04-30 B2

| Exigence | Mise en œuvre V1 |
|---|---|
| Nature | Trace via `tms.audit_logs` (table dédiée `tms.exports_pennylane_log` supprimée revue sobriété 2026-04-30 B2) — chaque export CSV déclenché par Ops/Admin vers Pennylane = INSERT action `M08_EXPORT_PENNYLANE` ; compensation W9 = INSERT action `M08_EXPORT_PENNYLANE_ANNULEE` |
| Rétention | 5 ans (rétention `tms.audit_logs` standard — justificatif fiscal export comptabilité, alignée Registre transport) |
| Contenu payload JSONB | `periode_export`, `facture_ids` (uuid[]), `nb_factures`, `total_ht`, `total_tva`, `total_ttc`, `csv_url` (R2 signed 5 ans, conservé pour audit comptable) |
| Accès | Lecture Staff TMS (`admin_tms`, `ops_savr`, `admin_savr`) via policies RLS `tms.audit_logs` standard + INSERT via fonction `tms.audit_log_emit` (Edge Function ou trigger M08 W10) |
| Immuabilité | Policies RLS `tms.audit_logs` bloquent UPDATE/DELETE en standard (audit_logs strictement immutable, propagation M13 D5) |
| Vue lecture | `tms.v_m08_exports_pennylane` filtre `WHERE action IN ('M08_EXPORT_PENNYLANE', 'M08_EXPORT_PENNYLANE_ANNULEE')` |

### 15.4.3 Pesées et déclarations (`tms.pesees`)

Donnée opérationnelle critique (base facturation). Pas de PII mais enjeu financier et traçabilité :

- Audit trail complet (`tms.audit_logs` : qui a créé/modifié/validé chaque pesée)
- Verrouillage après validation finale (pas de modification silencieuse)
- Toute correction = création d'une entrée `tms.pesees_corrections` avec justification

### 15.4.4 Politique password manager prestataire + chauffeur (propagation M03 2026-04-24)

**Scope** : rôles `manager_prestataire` (nouveau M03) et `chauffeur` (retournement M05 magic link → password). **Hors scope** : `admin_savr` / `ops_savr` / `admin_tms` (inchangés SSO Google + MFA TOTP §09 V1).

**Règles password** :
- **Longueur minimum 8 caractères**, pas de contrainte complexité (maj/min/chiffre/symbole). Justification : cohérent NIST 800-63B post-2017 (règles de complexité dégradent l'UX sans sécurité mesurable, privilégier longueur + blacklist).
- **Hash argon2id** via Supabase Auth natif. Paramètres Supabase default : `m=19456 KiB, t=2, p=1`.
- **Pas de blacklist mots de passe communs V1** (simplicité max — à ajouter V2 si retour terrain).
- **Pas d'expiration périodique** (NIST post-2017 : imposer changement périodique dégrade la sécurité en poussant patterns prévisibles).
- **Reset password** : magic link via Resend (TTL 30 min, usage unique, rate limit 3/email/24h), lien unique redirigeant vers écran nouveau password (min 8 car).

**Protection brute force** :
- **Rate limit 5 tentatives échouées par IP par 15 minutes** (paramètre `m03_login_rate_limit_per_15min = 5`). Implémentation : Supabase Auth rate limiter natif + middleware Next.js (Vercel KV counter).
- **Pas de lockout compte V1** (simplicité — évite DoS ciblé sur un user).
- **Réponse 429 Too Many Requests** + délai d'attente 15 min affiché UI.
- **Message d'erreur login unifié** : "Email ou mot de passe incorrect" (anti-énumération).
- **Timing constant** : `bcrypt_compare` dummy hash même si email inconnu (anti timing attack).

**Audit auth** :
- Toutes les tentatives login (succès + échecs) loggées dans `tms.audit_logs` : `action='login_success' | 'login_failed' | 'password_reset_requested' | 'password_reset_completed' | 'force_logout'`
- Champs : `user_id`, `role`, `ip`, `user_agent`, `device_fingerprint` (si applicable), `timestamp`, `success boolean`, `failure_reason string|null`
- Rétention : 1 an (paramètre `m15_auth_audit_retention_days = 365`)

**Device binding** :
- **Manager prestataire** : multi-device illimité (bureau + mobile + tablette, cas business courant)
- **Chauffeur** : 1 device actif (inchangé D12 M05, anti-partage compte, cohérence queue offline PWA)
- **Grâce de flush device-switch (2026-07-06 COH-08, arbitrage Val RC-M05-05) — fenêtre de risque cadrée** : un token chauffeur révoqué pour device-switch reste accepté `m05_grace_flush_heures` (48 h) sur les **seuls** endpoints `POST /sync/*`, pour les items créés avant la révocation (règle complète : [[09 - Authentification et permissions TMS]] §1bis). **Risque assumé** : device volé/perdu ≤ 48 h peut encore pousser des écritures de sync — surface limitée aux écritures **idempotentes** (`idempotency_key`, dédup DB), aucune lecture, aucun endpoint métier, aucun accès aux référentiels. **Mitigations** : exclusion totale du force-logout sécurité C5 (un device compromis se révoque en immédiat via M13, sans grâce), audit de chaque write sous grâce, dédup contre les re-saisies du nouveau device. Le vol de device relève de C5, pas du device-switch.

**Bootstrap password chauffeur via magic link (refondu revue sobriété §05 2026-05-01 B1)** :
- → **Supprimé V1**. Le bootstrap se fait via **magic link 30 min** envoyé par email à la création du compte (M06 W3 manager prestataire ou Ops/Admin + M13 E3 admin). Le chauffeur clique le lien, définit son password (≥ 8 car), session ouverte automatiquement. **Aucun password en clair transmis par email.**
- Justification : sécurité renforcée (zéro password en clair en email = surface d'attaque réduite) + 1 chemin de code au lieu de 2 (le magic link reset password EA2 existait déjà).
- Cohérence : R_M03.1 reset password = magic link 30 min, R_M03.7 création chauffeur = magic link 30 min, EA2 oubli password = magic link 30 min — un seul mécanisme d'établissement password V1.
- Force rotation Admin TMS (M13 W4) : invalider toutes les sessions actives + envoyer un nouveau magic link reset au user cible (au lieu de reset un flag DB). Audit log `action=PASSWORD_FORCE_ROTATION` + `acteur_meta = {target_user_id, motif}`.

**Références** : [[09 - Authentification et permissions TMS#Addendum 2026-04-24 (propagation M03)]] (détail technique complet), [[05 - Règles métier TMS#R_M03.1]] (règle métier), [[12 - App mobile chauffeur#4. Auth chauffeur]] (D7 force change 2026-04-27).

### 15.4.5 Alertes opérationnelles (`tms.alertes`) — propagation M11 2026-04-24, Bloc 6 C1+B2 2026-04-28

Spec fonctionnelle : [[06 - Fonctionnalités détaillées TMS/M11 - Alerting transverse]]. Les alertes sont la mémoire opérationnelle de la plateforme : elles tracent tous les incidents, anomalies et signaux métier émis par M01-M14.

**Classification confidentialité** : moyenne. Le payload JSONB peut contenir montants factures, IDs prestataires, motifs de refus, écarts financiers — jamais public, jamais exposé côté Plateforme.

| Caractéristique | Règle V1 |
|-----------------|----------|
| **Stockage** | Table `tms.alertes` + catalogue `tms.alertes_catalogue`. Timeline événements = `tms.audit_logs` (entity_type='alerte', row_id=alerte_id). Schéma `tms.*` isolé RLS cross-schema. |
| **Source d'écriture** | Uniquement via fonctions SECURITY DEFINER (`tms.alerte_emit`, `tms.m11_ack`, `tms.m11_snooze`, `tms.m11_resoudre_manuel`, `tms.alerte_resoudre_auto`). INSERT direct bloqué par policy WITH CHECK false. |
| **Accès lecture** | Staff (`ops_savr`, `admin_tms`, `admin_savr` lecture seule) OU destinataire explicite (`auth.uid() = ANY(destinataires_user_ids)`). Manager prestataire voit uniquement alertes routées `manager_prestataire_scope='entity'` + entité de son prestataire (R_M11.8). |
| **Cycle de vie** | `ouverte → snoozee/resolue` (terminal `resolue` V1 — cf. R6.5 §05). Ack = **metadata** (`ackee_par_user_id`+`ackee_at` nullable), statut `ouverte` inchangé. Transitions contrôlées par trigger BEFORE UPDATE (R_M11.11). **Bloc 3 sobriété 2026-04-25 A7** : statut `expiree` retiré V1. **Bloc 6 B2 2026-04-28** : statut `ackee` retiré enum (3 valeurs : `ouverte`/`snoozee`/`resolue`). |
| **Immuabilité** | Colonnes `code, criticite, emise_at, entity_type, entity_id, dedup_key, occurrences` immuables post-émission. Modifications seulement via path explicite W1 debounce (occurrences + derniere_occurrence_at) et W7 résolution auto (statut + resolue_*). |
| **Rétention** | 3 ans (paramètre `m11.retention_annees`). Cron mensuel `m11_purger_archives` (refondu B3 2026-05-01) en 2 étapes : (1) dump pré-purge `INSERT INTO tms.alertes_archive_critical SELECT * WHERE criticite='critical' AND statut='resolue' AND resolue_at < now() - 3 years` ; (2) `DELETE FROM tms.alertes WHERE statut='resolue' AND resolue_at < now() - 3 years` (toutes criticités). Cohérent `ajustements_couts_log` M07. **Bloc 3 sobriété 2026-04-25 A7** : scope rétention restreint à `resolue` uniquement (`expiree` dégagé). |
| **Trace post-purge** | Pour les alertes `critical` uniquement : **dump pré-purge dans table dédiée `tms.alertes_archive_critical`** (RLS admin_tms read-only, append-only, snapshot complet) — refondu revue sobriété §05 2026-05-01 B3. supprimé V1 (anti-pattern : trigger sur opération destructive + couplage audit_logs/alertes incorrect). Alertes `warning` purgées définitivement. **Bloc 3 sobriété 2026-04-25 A1** : criticité `info` retirée V1, events ex-info tracés directement dans `tms.audit_logs` ou `tms.integrations_logs` selon module (rétention propre à ces tables). |
| | **Dégagée Bloc 6 C1 (2026-04-28)** — `tms.alertes_evenements_log` fusionnée dans `tms.audit_logs` (entity_type='alerte', row_id=alerte_id, actions M11_ACK/M11_SNOOZE/M11_UNSNOOZE/M11_RESOLVE_MANUEL/M11_RESOLVE_AUTO). Immuabilité garantie par policy RLS append-only de `tms.audit_logs`. |
| **Catalogue** | Table `tms.alertes_catalogue` (codes canoniques) : SELECT tous staff, INSERT/UPDATE admin_tms uniquement. Soft delete via `supprime_at` (alertes historiques préservées). Pas de hard DELETE. |
| **Notifications email** | Provider Resend (aligné M03). Template `alerte_critical_v1`, reply-to `ops@gosavr.io` (non no-reply pour faciliter escalade humaine). Échec Resend → fallback in-app (in-app toujours déclenché indépendamment) + méta alerte `integration_resend_email_failed` critical Admin TMS (sans email pour éviter boucle). |

**Lignes dégagées revue de sobriété 2026-04-25** :
- → A6, plus de paramètres `m11_slack_*` ni route entrante boutons.
- → A8, débordement détectable manuellement via colonne `occurrences`.

**Tests bloquants CI** (pgTAP — cf. §09 A3 §19 RLS M11) :
- `test_m11_emit_unknown_code_raises`, `test_m11_emit_inactive_code_silent`, `test_m11_debounce_increments_occurrences`
- `test_m11_ack_requires_staff` (ex-`test_m11_ack_requires_destinataire_or_staff` — F5 2026-06-07 : ack/snooze staff only), `test_m11_snooze_max_24h_enforced`, `test_m11_resolue_auto_idempotent`
- `test_m11_manager_prestataire_scope_rls`, `test_m11_catalogue_admin_only_write`
- `test_m11_alertes_no_direct_insert`, (retiré Bloc 6 C1 — table fusionnée tms.audit_logs)

**Références** : [[09 - Authentification et permissions TMS#19. alertes_catalogue, alertes, alertes_evenements_log]] (policies RLS détaillées — section mise à jour Bloc 6 2026-04-28), [[05 - Règles métier TMS#R11 — Alerting transverse (M11) — règles métier (propagation 2026-04-24)]] (règles R_M11.1 à R_M11.11 — R_M11.12 dégagée Bloc 4 sobriété 2026-04-25 A5), [[04 - Data Model TMS#⚠ Addendum 2026-04-24 (propagation M11) — Alerting transverse]] (schémas tables).

### 15.4.6 Audit dashboards et exports (propagation §11 2026-04-27)

Voir aussi [[11 - Dashboards TMS]] §3.6 et §3.10.

**Action `EXPORT_DASHBOARD`** :
- Émise à chaque export CSV ou PDF d'un dashboard via Edge Function `dashboard_export`.
- Diff JSONB : `{dashboard_slug, format ('csv'|'pdf'), filters, rows_count, ms_duration}`.
- Gating RLS : l'export voit ce que voit l'user (RLS appliqué sur les requêtes sources).
- Limite hard CSV : 10 000 lignes (au-delà, message « Affinez vos filtres »).
- Limite hard PDF : 1 page A4 paysage par dashboard.
- Rétention : 5 ans dans `tms.audit_logs`.

**Action `AUDIT_403_ACCESS`** :
- Émise à chaque tentative d'accès à une route non autorisée (gating middleware Next.js).
- Diff JSONB : `{route_attempted, role_actual, ip}`.
- Rétention : 5 ans.
- Surveillance : pic d'occurrences `AUDIT_403_ACCESS` pour un même user en < 1 min = signal de scan/intrusion (alerte M11 future à envisager V1.1).

**Convention `action`** : MAJUSCULE_SNAKE_CASE, CHECK regex `^[A-Z][A-Z0-9_]*$` (cf. [[04 - Data Model TMS]] table `tms.audit_logs` + addendum 2026-04-27).

### 15.4.7 Audit mode migration (propagation §13 2026-04-27)

Voir aussi [[13 - Migration MTS-1]] §13.4.

**Action `M13_MIGRATION_MODE_TOGGLE`** :
- Émise à chaque toggle du paramètre `parametres_tms.migration_mode_active` (true ↔ false) par un `admin_tms`.
- Diff JSONB : `{ancien_etat, nouveau_etat, declenche_par_user_id, ip, raison_libre_text}`.
- Gating RLS : update `parametres_tms` clé `migration_mode_active` réservée `admin_tms` (existante `parametres_tms_admin_only`).
- Rétention : 5 ans dans `tms.audit_logs` (alignement standard audit).
- Friction UI : modale confirmation + saisie texte `DESACTIVER MIGRATION` requise pour désactivation avant J+30 (EC11 §13).

**Colonne `audit_logs.contexte`** (nouvelle, propagation §13) :
- Type `text NULL CHECK (contexte IN ('migration_test', NULL))`.
- À `'migration_test'` si l'action s'est produite pendant `migration_mode_active = true`. Renseignée automatiquement par les triggers d'audit via lecture `tms.is_migration_active()`.
- Permet filtrage post-bascule des actions de la fenêtre migration (~30j historique séparable).

**Colonne `tms.alertes.contexte`** (nouvelle, propagation §13) :
- Type identique. Remplie par la fonction `tms.alerte_emit` à l'émission d'une alerte si `migration_mode_active = true`.
- Permet auto-résolution alertes critical de la fenêtre migration à J+30 via cron `m13_cleanup_legacy` (R_§13.8).

**Colonne `factures_prestataires.migration_test`** (nouvelle, propagation §13) :
- Type `boolean NOT NULL DEFAULT false` + index partiel.
- Figée à la création (BEFORE INSERT trigger). Filtre automatique exclusif dans `m08_exporter_pennylane`.
- Sécurité : zéro risque double facturation Pennylane même en cas d'oubli désactivation `migration_mode_active`.

## 15.5 Risques juridiques assumés V1 ⚠⚠

### 15.5.1 Pas de dispositif technique RGPD structurant V1

**Décision explicite Val (atelier 2026-04-23, confirmée Bloc 3 2026-06-04)** : aucun dispositif technique RGPD structurant pour V1, **à une exception près ajoutée Bloc 3** — l'écran d'information géoloc + trace d'acceptation à l'inscription (cf. §15.4.1). Le reste est reporté V1.1+ sans date cible.

**Exception Bloc 3 (ce qui EST fait V1)** :
- Écran d'information géoloc bloquant à la 1ère connexion chauffeur + trace horodatée/versionnée `users_tms.consentements.geoloc_notice` (transparence Art. 13 + preuve)
- Requalification de la base légale géoloc en intérêt légitime (cf. §15.4.1) — gratuit et juridiquement plus solide que le consentement

**Ce qui N'EST TOUJOURS PAS fait V1** :
- Pas de portail self-service d'exercice des droits (accès, rectification, effacement, portabilité) — traités manuellement par Admin TMS sur demande (cf. §09 A5)
- Pas de processus automatisé de purge RGPD au-delà de la purge géoloc 30j
- Pas de registre des traitements formalisé (maintenu manuellement par Val, cf. §09 A5)
- Pas d'analyse d'impact (PIA/DPIA) documentée — **recommandée** car la géoloc de personnes déclenche normalement une AIPD
- Pas de DPO désigné ni de procédure interne de gestion des demandes
- Pas de CGU / politique de confidentialité publique mises à jour pour refléter les nouvelles pratiques (action Val + juriste RGPD)

**Risques assumés** :
- Sanctions CNIL : jusqu'à **4% du CA mondial** ou **20 M€** (le plus élevé)
- Réclamation individuelle d'un chauffeur, prestataire ou employé traiteur → pas de processus de réponse formalisé sous 30 jours
- Audit fournisseur grand compte (Viparis, groupes de lieux) → questionnaire RGPD non renseignable

**Trigger de réouverture V1.1+** :
1. Réclamation formelle reçue (CNIL, client, chauffeur)
2. Demande de questionnaire RGPD par un grand compte
3. Signalement interne d'une violation de données
4. Volume > 100 chauffeurs actifs (élargissement surface)

### 15.5.2 Pas d'audit externe sécurité V1

**Décision explicite Val (atelier 2026-04-23)** : pas d'audit externe (pentest, ISO, SOC2) V1.

**Ce qui N'EST PAS fait V1** :
- Pas de pentest externe (ni application ni infra)
- Pas de certification ISO 27001 ni SOC2
- Pas d'attestation d'hébergement ni de sous-traitance formalisée

**Risques assumés** :
- Questionnaire fournisseur Viparis (grand compte) : cases non cochables → peut bloquer renouvellement contrat ou limiter l'extension du périmètre
- Appels d'offres B2B sur lieux événementiels importants : risque d'élimination sur critère sécurité
- Découverte tardive d'une vulnérabilité critique (pas de regard externe)

**Compensation V1** :
- Dépendance forte sur la sécurité native Supabase (certifié SOC2 Type II)
- pgTAP bloquant = garantie RLS
- Secrets en Supabase Vault
- Monitoring Sentry + Better Uptime

**Trigger de réouverture V1.1+** :
1. Demande explicite grand compte (Viparis ou équivalent)
2. Incident de sécurité avéré
3. Expansion B2B vers secteur régulé (santé, finance)

## 15.6 Chiffrement

### At rest

| Couche | Dispositif |
|---|---|
| Postgres Supabase | AES-256 (géré Supabase, transparent) |
| Cloudflare R2 | AES-256 (géré R2) |
| Supabase Vault | AES-256 (keys rotées annuellement) |
| Backups PITR | AES-256 (géré Supabase) |

### In transit

| Flux | Dispositif |
|---|---|
| Front ↔ API TMS | TLS 1.3 (Vercel) |
| API TMS ↔ Postgres | TLS (Supabase) |
| TMS ↔ Plateforme (webhooks) | TLS + HMAC SHA-256 signature |
| TMS ↔ Everest (polling) | TLS + Bearer token Vault |
| TMS ↔ Mistral OCR | TLS + API key Vault |
| PWA ↔ API TMS | TLS 1.3 + HSTS |

## 15.7 Audit trail

### `tms.audit_logs` (journal logistique / cross-domaine)

> Écrit par le TMS + la migration, lu par les deux schémas. **Pas** écrit par le back-office App (qui audite dans `plateforme.audit_log`) — règle « l'audit suit le schéma de la table écrite » (cf. §04/§09 App, tranché 2026-06-09).

| Item | V1 |
|---|---|
| Actions loguées | Tout CRUD sur entités métier sensibles (collectes, tournées, pesées, factures, utilisateurs, permissions) |
| Rétention | 5 ans |
| Contenu | user_id, impersonator_id, app_domain, action, entity_type, entity_id, diff JSONB, timestamp, IP, user_agent |
| Immuabilité | Insert-only (pas d'UPDATE autorisé, DELETE via service role uniquement pour purge légale > 5 ans) |
| Accessibilité | Admin Plateforme (lecture cross-schema), export CSV sur demande |

### `tms.integrations_logs`

| Item | V1 |
|---|---|
| Actions loguées | Tous les appels webhook TMS↔Plateforme, polling Everest, OCR Mistral |
| Rétention | 2 ans (obligation traçabilité facturation) |
| Contenu | direction (IN/OUT), endpoint, payload_hash, signature_ok, status_http, latency_ms, erreur, retry_count |
| Purge | pg_cron hebdomadaire > 2 ans |

## 15.8 Backup et Disaster Recovery

### RPO / RTO cibles V1

| Métrique | Cible | Dispositif |
|---|---|---|
| RPO (Recovery Point Objective) | 1 heure | Supabase PITR 7 jours (granularité minute) |
| RTO (Recovery Time Objective) | 4 heures | Restauration PITR + redémarrage Vercel |
| Backup fréquence | Continu (PITR) | Supabase Pro |
| Rétention backup | 7 jours PITR + 30 jours daily | Supabase Pro |
| Test de restauration | Trimestriel (manuel V1) | Runbook §15.9 |

### Cloudflare R2

| Dispositif | V1 |
|---|---|
| Versioning bucket | Activé (rétention 30 jours) |
| Réplication | Single region (Paris/London cluster R2) |
| Backup R2 → externe | Non V1, à évaluer V1.1 |

## 15.9 Runbook Disaster Recovery

### Scénario 1 — Corruption donnée TMS (erreur humaine ou bug)

1. Identifier le timestamp T0 avant la corruption (via `tms.audit_logs`)
2. Supabase Dashboard → Database → Backups → PITR → Restaurer à T0
3. **Attention** : la restauration ramène **toute la base** (plateforme + tms + shared) → coordonner avec l'équipe Plateforme
4. Alternative moins disruptive : dump partiel table `pg_dump -t tms.table_xxx --from=T0` via support Supabase
5. Post-incident : entrée incident report dans `docs/incidents/` + post-mortem

### Scénario 2 — Indisponibilité Supabase prolongée

1. Vérifier statut Supabase (status.supabase.com)
2. Si > 30 min : bascule page de maintenance Vercel (`tms.savr.fr/maintenance`)
3. Basculer kill switches : `integration_plateforme_active=false`, `polling_e6_active=false` dès le retour (pour purger la queue sans surcharger)
4. Communiquer clients (email transactionnel via Resend fallback)

### Scénario 3 — Compromission secret HMAC (TMS↔Plateforme)

1. Générer nouveau secret, stocker dans Supabase Vault
2. Déployer Plateforme + TMS avec le nouveau secret (rotation synchrone)
3. Révoquer ancien secret dans Vault
4. Audit `tms.integrations_logs` sur période suspectée pour détecter appels illégitimes
5. Si compromission avérée : activer procédure violation données (même sans dispositif RGPD V1, obligation notification CNIL sous 72h reste)

### Scénario 4 — Perte données PWA chauffeur (téléphone volé/cassé)

1. Pas de données critiques stockées localement > 24h (sync auto)
2. Révoquer session Supabase côté admin
3. Données IndexedDB non synchronisées : **perdues** (risque acceptable V1)
4. V1.1+ : évaluer sync forcé toutes les 5 min même offline via background sync

## 15.10 Secrets et gestion des clés

Voir §07 TMS Architecture technique §7.13 pour la liste exhaustive. Synthèse :

| Secret | Stockage | Rotation | Géré via |
|---|---|---|---|
| HMAC TMS↔Plateforme | Supabase Vault | Annuelle (rappel §09 Plateforme) | M13 E5 |
| Everest client_id + client_secret | Supabase Vault | À négocier avec prestataire | M13 E5 |
| Everest webhook token (M14 D6 filet par défaut) | Supabase Vault | Annuelle (cohérence HMAC TMS↔Plateforme) | M13 E5 |
| Everest access token (cache Bearer V1.1 optionnel) | Mémoire process Next.js (V1) ou Vault (V1.1 si TTL court) | Auto sur 401 (lazy refresh W6) | Worker M14 |
| Mistral OCR API key | Supabase Vault | Annuelle | M13 E5 |
| R2 credentials | Supabase Vault | Annuelle | M13 E5 |
| Pennylane API token v2 | Supabase Vault | 90j | M13 E5 + cron J-7 alerte |
| Strike + Marathon webhook signing keys | Supabase Vault | 12 mois | M13 E5 |
| Bridge API token | Supabase Vault | 90j | M13 E5 + cron J-7 alerte |
| Supabase service role | Supabase (natif) | Sur incident uniquement | n/a (infra) |
| JWT signing key | Supabase (natif) | Rotation annuelle alignée | n/a (infra) |

**Rotation annuelle synchrone Plateforme + TMS** : décision atelier 2026-04-23. Date cible : 1er janvier chaque année, procédure documentée dans runbook.

**Propagation M13 2026-04-25** :
- Tous les secrets ci-dessus exposés dans M13 E5 (Admin TMS uniquement, lecture via reveal 30s + JWT scope reveal — R_M13.16).
- Rotation : bouton "Rotater" + test pré-validation → si OK → UPDATE Vault + métadonnées + audit-log (R_M13.5).
- Métadonnées dans `tms.secrets_metadata` (cf. §04 niveau 5 addendum 2026-04-25).
- Cron `m13_secrets_expiration_cron` quotidien : alerte warning J-7 sur secrets `expire_le` non null (R_M13.15).
- **Pas de re-MFA admin pour reveal/rotate** (D10 risque assumé R_M13.13). Compensé par audit-log exhaustif + révocation device.

**Écart conscient cross-CDC 2026-04-25 — Pennylane API token** : la Plateforme utilise `PENNYLANE_API_KEY` (cf. CDC Plateforme §07 ligne 269 — facturation clients) et le TMS utilise `pennylane_api_token_v2` (M08 facturation fournisseurs). Pennylane n'expose qu'**un seul token par compte entreprise** : les 2 secrets pointent vers le même token réel. Risque cross-CDC : rotation TMS sans propagation Plateforme = casse Plateforme (et inversement). **Décision V1** : écart documenté, rotation Pennylane = procédure manuelle Admin TMS qui rotater Vault TMS + Vault Plateforme dans la même opération. **Roadmap V1.1** : centraliser Pennylane sur un seul namespace Vault (`shared.pennylane_api_token`) accessible par les 2 apps via Edge Function partagée. À traiter avec l'audit `coherence-inter-cdc` global. Aucun autre écart secrets cross-CDC détecté.

## 15.10bis Impersonation tracing (propagation M13 2026-04-25)

**Décision** : `admin_tms` peut démarrer une session d'impersonation (M13 E9, W9) pour debug/support utilisateur. Implications sécurité :

- **Garde-fous (R_M13.9)** : impersonation interdite vers `admin_tms` cible, vers user `desactive`, en cascade. Trigger DB `tms.check_impersonation_constraints()` (cf. §09 addendum 2026-04-25 section 2).
- **Bandeau persistant** (D13) : visible sur toutes les pages M03/M05/etc. tant que session active.
- **Audit double acteur (R_M13.10, D15)** : `audit_logs.acteur_user_id` = impersonator réel + `acteur_meta.impersonation_target_id` = cible. Helper SQL `auth.is_impersonating()`.
- **Notification cible** : email + push (si session active) au target user au start et stop (R_M13.4 niveau notif).
- **JWT 60min** : session expire automatiquement (`m13_impersonation_jwt_duree_minutes=60`).
- **Tracking complet** : table `tms.impersonation_sessions` (cf. §04 niveau 5 addendum 2026-04-25).

Risque accepté : un Admin malicieux pourrait abuser de l'impersonation, mais l'audit-log exhaustif rend la fraude détectable post-mortem.

## 15.10quater Sécurité intégration Everest (propagation M14 2026-04-25)

Issu de [[06 - Fonctionnalités détaillées TMS/M14 - Intégration Everest]] (V1 rédigée 2026-04-25, D6).

**Surface d'attaque** : webhook entrant `/api/webhooks/everest` exposé Internet (route publique nécessaire pour qu'Everest pousse les events). Sans dispositif → spoof possible (faux event `mission_finished` → fausse facturation traiteur).

**Dispositif V1 (filet par défaut M14 D6)** :
- Token secret partagé en header `X-Webhook-Token` (fallback query string `?token=` accepté pour compat).
- Stockage : `vault.secrets` + métadonnées `tms.secrets_metadata.everest_webhook_token`.
- Validation : Edge Function ou middleware Next.js compare en time-constant. Si KO → 401 + alerte warning `m14_everest_webhook_signature_invalid`.
- Rotation : annuelle (cohérence rotation HMAC TMS↔Plateforme), via M13 E5 bouton "Rotater" + test pré-validation. Procédure : générer nouveau token, configurer côté Everest avec dev Everest, rotater Vault TMS, valider via `Test connexion`.

**Upgrade prévu HMAC** :
- Si Everest expose une signature HMAC native (Q2 — à confirmer dev Everest pendant développement Claude Code) → bascule sur HMAC validation (cohérent pattern HMAC TMS↔Plateforme).
- Bascule contrôlée via `parametres_tms.m14_webhook_token_required = false` + activation logique HMAC dans le middleware Next.js. Pas de migration secret (HMAC = nouveau secret partagé Everest, le token devient inactif).

**IP whitelist optionnelle** :
- Si Everest expose des IPs sortantes stables → whitelist Vercel/Supabase Edge Network (`firewall_rules`). Considéré V1.1, **pas V1** (fragilité IPs Everest non garanties).
- En attendant : pas de filtrage IP, validation token uniquement.

**Logging tentatives invalides** :
- Toute requête webhook avec token KO → INSERT `integrations_logs` direction `inbound`, status `error`, message `"webhook_signature_invalid"`, payload tronqué (premier 256 bytes).
- Alerte warning `m14_everest_webhook_signature_invalid` (N déclenchements en 1h = potentielle attaque, à monitorer).

**Risque résiduel V1** : si attaquant obtient le token (fuite côté Everest, MITM TLS échec, social engineering Admin TMS) → spoof events possible. Compensé par : RLS Ops/Admin sur mutation traiteur (le fake event ne déclenche pas un push facturation en aval — c'est M05 chauffeur qui acte la collecte). Fenêtre d'exposition limitée à `everest_missions.statut_everest` (informational).

### Runbook replay manuel webhook Everest `echec_final` (sobriété 2026-04-30 A_M14_04)

L'UI E3 "Replay" + workflow W7 + API route `/api/internal/m14/missions/replay/:inbox_id` ont été supprimés (cas extrêmement rare, cible <1% des webhooks). Si un event `tms.integrations_inbox.status = 'echec_final'` doit être rejoué :

1. Admin authentifié SSO accède à Supabase Studio (rôle `admin_tms`).
2. Identifier la ligne via M13 E6 tab Everest section "Audit webhooks 7j" (filter statut traitement = `failed`) — récupérer `inbox_id`.
3. Inspecter le payload via M13 E6 action "Voir payload" pour comprendre l'échec.
4. Si replay légitime : exécuter
   ```sql
   UPDATE tms.integrations_inbox
   SET status = 'pending', retry_count = 0
   WHERE id = '<inbox_id>';
   ```
5. Ré-exécuter le worker manuellement (Vercel CLI : `vercel run worker:m14_webhook_processor` ou `pg_notify('m14_webhook_replay', '<inbox_id>')` selon impl finale).
6. Vérifier nouveau statut dans M13 E6.
7. La trace de l'opération est captée par `audit_logs` Supabase Studio (acteur Admin via SSO, action `UPDATE` sur `integrations_inbox`).

**Seuil de réintégration UI** : si volume `echec_final` dépasse 1 event/semaine post-go-live (instrumentation via M13 E6 tab Everest KPI "taux échec final"), réintroduire l'UI Replay V1.1.

## 15.10ter Audit log immutable (propagation M13 2026-04-25)

**Confirmation décision §04 + R_M13.18** : la table `tms.audit_logs` est strictement immutable :
- Aucune `UPDATE` ni `DELETE` autorisée, même pour `admin_tms`. RLS deny + `REVOKE UPDATE, DELETE`.
- Seule exception : `DROP PARTITION` mensuelle > 5 ans (DBA-level, pas via PostgREST).
- Partitionnement mensuel natif PostgreSQL (cf. §04 niveau 5).
- Rétention 5 ans minimum (obligation Registre transport + BSD V2 + RSE).
- Pas d'annotation post-hoc V1 (D5 M13). Le champ `commentaire` est renseigné à la mutation source (motif ajustement, raison désactivation, commentaire édition param).

## 15.11 Conformité contractuelle

### Clients grands comptes (Viparis et équivalents)

| Exigence typique | Statut V1 | Commentaire |
|---|---|---|
| Questionnaire RGPD | ❌ Non renseignable complet | Risque commercial assumé |
| Pentest externe < 1 an | ❌ Non disponible | Risque commercial assumé |
| ISO 27001 | ❌ Non | Report V1.1+ si demande forte |
| Attestation hébergement | ⚠️ Partiel (Supabase SOC2 Type II publique) | À valoriser dans réponses |
| Cyber-assurance | À vérifier avec Val | Probablement pas V1 |
| SLA contractuel | ⚠️ Informel V1 | À formaliser V1.1 |

### Prestataires (Strike, Marathon)

| Exigence | Mise en œuvre V1 |
|---|---|
| CGU prestataire distinctes | Oui (décision atelier) |
| Mention géoloc explicite | Oui dans CGU + consent PWA |
| Traitement données prestataire | Savr = responsable, prestataire = co-responsable sur ses chauffeurs |
| Durée conservation données contractuelles | 10 ans après fin de relation |

## 15.12 Synthèse décisions sécurité

| ID | Décision | Rationale |
|---|---|---|
| T.15.1 | pgTAP bloquant CI — couverture ciblée V1 (tables critiques + cross-schema), 100% policies promu V1.1 *(révisé 2026-06-03, alignement App)* | Garantie non-régression RLS |
| T.15.2 | RLS pure + cross-schema deny par `app_domain()` | Isolation stricte TMS / Plateforme |
| T.15.3 | Purge géoloc quotidienne > 30 jours | Minimisation RGPD |
| T.15.4 | Pas de dispositif technique RGPD V1 ⚠⚠ | Risque CNIL assumé, trigger réouverture |
| T.15.5 | Pas d'audit externe V1 ⚠ | Risque Viparis assumé, trigger réouverture |
| T.15.6 | HMAC rotation annuelle synchrone Plateforme+TMS | Décision atelier, simplification ops |
| T.15.7 | Supabase Vault pour tous secrets | Pas de .env prod |
| T.15.8 | `tms.audit_logs` 5 ans, `tms.integrations_logs` 2 ans | Conformité comptable + traçabilité |
| T.15.9 | RPO 1h / RTO 4h via Supabase PITR 7j | Cohérent avec criticité métier |
| T.15.10 | Runbook DR 4 scénarios documentés | Cas nominal + 3 dégradés |

## 15.13 Questions ouvertes

1. Cyber-assurance : Val a-t-il une police couvrant les conséquences d'une violation de données ? À vérifier avant V1.
2. Notification CNIL 72h en cas de violation : procédure formalisée OUI mais qui porte la responsabilité opérationnelle (Val en direct V1) ?
3. Contrat sous-traitance Supabase / Cloudflare / Vercel : récupérer et classer les DPA pour usage questionnaires fournisseurs.
4. Politique de confidentialité publique `savr.fr/privacy` : mise à jour nécessaire pour refléter nouvelles pratiques (géoloc notamment) → à faire même sans dispositif technique, c'est gratuit et limite le risque.
5. **Validation juriste RGPD géoloc (Bloc 3 2026-06-04)** : confirmer (a) la base légale **intérêt légitime** retenue pour la géoloc chauffeur (vs consentement) et documenter le test de mise en balance, (b) le contenu de la notice d'information affichée à l'inscription, (c) l'opportunité d'une **AIPD/PIA** (la géoloc systématique de personnes la déclenche en principe). Rattaché à la question ouverte §00 n°4 (juriste RSE/RGPD), pré-go-live V1.

## 15.14 Liens

- [[01 - Cahier des charges App/15 - Sécurité et conformité|§15 Plateforme — Sécurité et conformité]]
- [[01 - Cahier des charges App/09 - Authentification et permissions|§09 Plateforme — Auth et permissions]]
- [[09 - Authentification et permissions TMS|§09 TMS — Auth et permissions]]
- [[07 - Architecture technique TMS|§07 TMS — Architecture technique]]
- [[14 - Scalabilité TMS|§14 TMS — Scalabilité]]
- [[03 - Ateliers/Atelier tech avec frère - 2026-04-23|Atelier tech frère 2026-04-23]]

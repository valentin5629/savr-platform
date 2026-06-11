# Scénarios de test — M13 Administration TMS

**Source CDC** : §06/M13 + §05 règles R_M13.1 à R_M13.20 + §04 (parametres_tms, users_tms, users_tms_devices_trusted, secrets_metadata, impersonation_sessions, audit_logs, integrations_logs/inbox) + §09 addendum M13 + §13 Migration MTS-1 (§13.4 migration_mode_active)
**Généré le** : 2026-06-07
**Statut** : À implémenter par Claude Code — **5 specs floues TRANCHÉES Val 2026-06-07 + propagées (cf. dernière section)**

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests du module M13.
> Pour chaque scénario :
>
> - Couche `db` → écrire un test pgTAP dans `supabase/tests/`
> - Couche `api` → écrire un test Vitest dans `packages/tms/tests/api/`
> - Couche `ui` → écrire un test Playwright dans `packages/tms/tests/e2e/`
>   Les tests P1-critique sont bloquants CI. Les tests P2 et P3 sont non-bloquants V1.
>   Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.

---

## Résumé de couverture

| Catégorie                | Nb scénarios | Couverture                                                                |
| ------------------------ | ------------ | ------------------------------------------------------------------------- |
| 1. Happy path            | 11           | W1-W7, W9, W10, W12, E4                                                   |
| 2. Cas limites métier    | 10           | R_M13.1/.2/.5/.11/.12/.15, EC14, bornes E4/export                         |
| 3. Cas d'erreur métier   | 12           | EC1-EC3, EC5, EC9, EC10, R_M13.9/.17/.20, trg grille                      |
| 4. Isolation RLS         | 10           | 4 nouvelles tables + audit_logs + parametres_tms + impersonation          |
| 5. Idempotence et états  | 9            | users_tms.statut, prestataires.statut, EC6/EC13/EC17/EC18, dédup alertes  |
| 6. Cross-app (replay W6) | 3            | Replay entrant E1 / sortant S\* — M13 n'a pas d'endpoint propre           |
| 7. Migration             | 4            | migration_mode_active (§13.4), friction EC11 §13, contexte migration_test |
| **TOTAL**                | **59**       |                                                                           |

**Justification cat.6 réduite** : M13 n'expose aucun endpoint du contrat §08 (M13 = admin TMS-only, cf. M13 §16). Les tests HMAC 401 / X-API-Version 400 / dédup `body.event_id` sont déjà couverts par M01 et M05. M13 ne touche le contrat que via le **replay manuel W6** — c'est ce périmètre qui est testé ici.

**Justification cat.7** : la migration des données MTS-1 est hors scope module (couverte par `13 - Migration MTS-1`). En revanche le **paramètre runtime `migration_mode_active`** est piloté depuis M13 E2 (§13.4) — testé ici.

---

## Catégorie 1 — Happy path

```gherkin
# Source : M13 W1 / R_M13.1
# Couche : api
# Priorité : P1-critique

Scénario : edition_parametre_hot_reload_succes
  Étant donné un admin_tms connecté (Val) et le paramètre m04_tournee_tampon_minutes = 30 (requires_redeploy=false, modifiable_par=['admin_tms'])
  Quand il appelle l'EF update_parametre(id, 45, "Ajustement tampon hiver 2026")
  Alors la réponse est 200 et parametres_tms.valeur = 45, derniere_maj_par_user_id = Val, updated_at = now()
  Et une ligne audit_logs existe avec action='UPDATE', table_name='parametres_tms', diff={before:30, after:45}, commentaire renseigné
  Et le toast indique "Prise en compte sous 60s (cache Edge)"
```

```gherkin
# Source : M13 W2 / E3.c
# Couche : api
# Priorité : P1-critique

Scénario : creation_user_staff_ops_magic_link
  Étant donné un admin_tms connecté et aucun user existant avec l'email marie@gosavr.io
  Quand il crée un user type Staff, roles=['ops_savr'], email marie@gosavr.io via EF upsert_user_tms
  Alors users_tms contient une ligne statut='en_attente_premiere_connexion', mfa_active=false
  Et auth.users contient une entrée sans password initial
  Et un email template staff_first_login avec magic link (TTL 30 min) est envoyé, sans password en clair
  Et une ligne audit_logs INSERT existe
```

```gherkin
# Source : M13 W2 (premier login) / D11
# Couche : api
# Priorité : P1-critique

Scénario : premier_login_admin_mfa_setup_device_trusted
  Étant donné un user roles=['admin_tms'] statut='en_attente_premiere_connexion' qui clique son magic link
  Quand il complète le setup MFA TOTP sur son device
  Alors users_tms.statut passe à 'actif' et mfa_active = true
  Et une ligne users_tms_devices_trusted est insérée (actif=true, device_fingerprint, ip, user_agent)
```

```gherkin
# Source : M13 W3 / R_M13.2
# Couche : api
# Priorité : P1-critique

Scénario : desactivation_user_soft_delete_cascade
  Étant donné un user ops_savr actif avec 2 sessions actives et 2 devices trusted
  Quand l'admin_tms le désactive avec raison "Départ de l'équipe ops fin de contrat" (≥ 20 chars)
  Alors users_tms.statut='desactive', desactivee_at, desactivee_par_user_id et raison_desactivation renseignés
  Et toutes ses sessions auth sont révoquées et ses devices trusted passent actif=false
  Et les FK existantes (audit_logs, tournees.created_by) restent intactes
  Et une ligne audit_logs existe
```

```gherkin
# Source : M13 W4 / R_M13.4
# Couche : api
# Priorité : P2-important

Scénario : reset_mfa_totp_user
  Étant donné un admin_tms cible ayant perdu son TOTP
  Quand l'admin exécute reset_mfa_user(target, "Téléphone perdu, demande vérifiée par téléphone") (≥ 20 chars)
  Alors auth.mfa_factors du target est vidé et users_tms.mfa_active=false
  Et audit_logs contient acteur_meta={action:'reset_mfa', target_user_id}
  Et un email mfa_reset_notification est envoyé au target
  Et au prochain login le target est forcé de reconfigurer un TOTP
```

```gherkin
# Source : M13 W5 / R_M13.5
# Couche : api
# Priorité : P1-critique

Scénario : rotation_secret_avec_test_ok
  Étant donné le secret pennylane_api_token_v2 dans Supabase Vault
  Quand l'admin colle une nouvelle valeur, lance "Tester avant validation" (GET /me Pennylane → 200) puis "Valider rotation"
  Alors vault.secrets est mis à jour et secrets_metadata.derniere_rotation_at/par_user_id renseignés
  Et audit_logs contient action='SECRET_ROTATE' avec acteur_meta={secret_name}
  Et aucune alerte M11 n'est émise (m13_secret_rotated retiré du catalogue, audit_logs fait foi)
```

```gherkin
# Source : M13 W6 / R_M13.6 / EC6
# Couche : api
# Priorité : P1-critique

Scénario : replay_event_entrant_echec_final_succes
  Étant donné un event E1 collecte-upsert en statut='echec_final' dans integrations_logs (cause corrigée depuis)
  Et son event_id absent de integrations_inbox (jamais traité avec succès)
  Quand l'admin_tms exécute replay_event(log_id, "Bug handler corrigé, replay")
  Alors le payload original est repoussé dans le handler interne via integrations_inbox (event_id original conservé)
  Et la collecte_tms est créée et integrations_inbox contient event_id statut='traite'
  Et audit_logs contient action='EVENT_MANUAL_REPLAY'
```

```gherkin
# Source : M13 W7 / E7 / R_M13.14 refondue
# Couche : api
# Priorité : P1-critique

Scénario : wizard_onboarding_prestataire_complet
  Étant donné un admin_tms qui démarre le wizard E7 pour un nouveau prestataire "TransFrigo Lyon"
  Quand il complète : étape 1 identité (SIRET, coords entrepôt) → étape 2 grille tarifaire forfait_fixe statut='actif' date_debut_validite=demain → étape 3 first manager + portail ON → étape 4 activation
  Alors shared.prestataires passe en_onboarding → actif (trigger trg_prestataire_grille_obligatoire passe, grille présente)
  Et users_tms contient le manager statut='en_attente_premiere_connexion' avec magic link envoyé (template manager_first_login)
  Et 4 lignes audit_logs existent (1 par étape, dont action prestataire_activation)
  Et aucune alerte m13_prestataire_sans_grille_post_onboarding n'est émise (code supprimé du catalogue)
```

```gherkin
# Source : M13 W9 / E9 / R_M13.10 / D15
# Couche : api + db
# Priorité : P1-critique

Scénario : impersonation_start_stop_manager_strike
  Étant donné Val (admin_tms) et un manager_prestataire Strike actif
  Quand Val démarre une impersonation avec motif "Debug affichage factures côté Strike"
  Alors un JWT est émis avec claims impersonator_user_id=Val, effective_user_id=manager, roles+prestataire_id du manager, exp=+60min
  Et tms.impersonation_sessions contient une ligne active (ended_at IS NULL)
  Et le manager reçoit une notif email impersonation_started
  Et toute mutation pendant la session écrit audit_logs.acteur_user_id=Val + acteur_meta.impersonation_target_id=manager (jamais l'inverse)
  Quand Val clique "Sortir"
  Alors ended_at est renseigné avec end_reason='manual_stop' et le manager reçoit impersonation_ended
```

```gherkin
# Source : M13 E4
# Couche : ui
# Priorité : P3-nominal

Scénario : consultation_audit_log_filtre_diff
  Étant donné 3 édits de parametres_tms sur 7 jours par 2 admins
  Quand l'admin filtre E4 par table_name='parametres_tms' période 7j et ouvre "Voir diff" sur une ligne
  Alors le tableau liste les 3 édits avec acteur, date, commentaire
  Et la modale diff affiche before/after avec champs modifiés highlightés
```

```gherkin
# Source : M13 W12 / R_M13.15
# Couche : db
# Priorité : P2-important

Scénario : cron_secret_expiration_j_moins_7
  Étant donné secrets_metadata.pennylane_api_token_v2.expire_le = now() + 6 jours
  Quand le cron m13_secrets_expiration_cron s'exécute
  Alors une alerte M11 m13_secret_expiration_imminente (warning, scope admin) est émise avec lien E5
  Et elle s'auto-résout à la rotation du secret
```

---

## Catégorie 2 — Cas limites métier

```gherkin
# Source : R_M13.1 (commentaire ≥ 10 chars)
# Couche : api
# Priorité : P1-critique

Scénario : edition_parametre_commentaire_borne_10_chars
  Étant donné un admin_tms qui édite un paramètre
  Quand le commentaire fait exactement 10 caractères
  Alors l'UPDATE est accepté
  Quand le commentaire fait 9 caractères
  Alors l'EF rejette 400 sans UPDATE ni audit_logs
```

```gherkin
# Source : R_M13.2 / W3 (raison ≥ 20 chars)
# Couche : api
# Priorité : P2-important

Scénario : desactivation_raison_borne_20_chars
  Quand l'admin désactive un user avec une raison de exactement 20 caractères
  Alors la désactivation passe
  Quand la raison fait 19 caractères
  Alors l'EF rejette 400, le user reste actif
```

```gherkin
# Source : R_M13.5 (force rotation ≥ 50 chars)
# Couche : api
# Priorité : P2-important

Scénario : rotation_forcee_commentaire_borne_50_chars
  Étant donné un test de secret KO (Pennylane répond 401)
  Quand l'admin force la rotation avec un commentaire de exactement 50 caractères
  Alors la rotation passe avec audit SECRET_ROTATE
  Quand le commentaire fait 49 caractères
  Alors l'EF rejette 400, le Vault n'est pas modifié
```

```gherkin
# Source : R_M13.11 / D14 / EC11 (cap 3 devices)
# Couche : db
# Priorité : P1-critique

Scénario : cap_3_devices_trusted
  Étant donné un user avec exactement 2 devices trusted actifs
  Quand il se connecte sur un 3ème device (post-MFA si admin)
  Alors le 3ème device est inséré actif=true
  Quand il tente une connexion sur un 4ème device
  Alors le trigger BEFORE INSERT rejette, le login est refusé avec le message dédié "Révoque un device"
  Quand il révoque 1 device (actif=false) puis retente le 4ème
  Alors l'INSERT passe (3 actifs à nouveau)
```

```gherkin
# Source : EC14 / §04 parametres_tms valeur_min/valeur_max
# Couche : api
# Priorité : P1-critique

Scénario : edition_parametre_bornes_min_max
  Étant donné le paramètre seuil_alerte_stock_roll_pct avec valeur_min=0, valeur_max=100
  Quand l'admin saisit 100 (= valeur_max)
  Alors l'UPDATE passe
  Quand il saisit 101
  Alors le server rejette 400, l'UI montre l'erreur sous le champ, pas d'UPDATE
```

```gherkin
# Source : R_M13.12 (session 30j glissante)
# Couche : api
# Priorité : P2-important

Scénario : session_30j_glissante_expiration
  Étant donné un admin_tms avec session active et auth.session_duree_jours_par_role->>'admin_tms' = 30
  Quand il a une activité au jour 29
  Alors la session est renouvelée pour 30 jours (refresh token glissant)
  Quand il reste inactif 30 jours pleins
  Alors la session expire, re-login complet requis (SSO + device trusted check)
```

```gherkin
# Source : E9 (JWT impersonation 60 min)
# Couche : api
# Priorité : P2-important

Scénario : impersonation_auto_expiration_60_min
  Étant donné une session impersonation active démarrée il y a 60 minutes
  Quand le JWT expire
  Alors la session se termine avec end_reason='auto_expiration'
  Et audit_logs contient l'action impersonation_stop avec la durée
```

```gherkin
# Source : E4 export CSV (constante MAX_EXPORT_ROWS=10000)
# Couche : api
# Priorité : P3-nominal

Scénario : export_csv_audit_borne_10000_lignes
  Étant donné un filtre E4 retournant exactement 10 000 lignes
  Quand l'admin exporte
  Alors le CSV est généré (10 000 lignes + header)
  Étant donné un filtre retournant 10 001 lignes
  Quand il exporte
  Alors le message "Affine les filtres" s'affiche, pas de CSV
```

```gherkin
# Source : E4 (range max 90 jours, constante UI)
# Couche : ui
# Priorité : P3-nominal

Scénario : audit_log_range_borne_90_jours
  Quand l'admin sélectionne un range de exactement 90 jours
  Alors la query s'exécute (cible < 5s)
  Quand il tente un range de 91 jours
  Alors l'UI refuse et propose l'export CSV uniquement
```

```gherkin
# Source : R_M13.15 / W12 (borne J-7)
# Couche : db
# Priorité : P3-nominal

Scénario : secret_expiration_borne_j7
  Étant donné un secret avec expire_le = now() + 7 jours - 1 heure
  Quand le cron tourne
  Alors l'alerte m13_secret_expiration_imminente est émise
  Étant donné un secret avec expire_le = now() + 8 jours
  Quand le cron tourne
  Alors aucune alerte n'est émise
```

---

## Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : EC1
# Couche : api
# Priorité : P1-critique

Scénario : edition_parametre_role_non_autorise
  Étant donné un ops_savr connecté et un paramètre modifiable_par=['admin_tms']
  Quand il appelle update_parametre
  Alors l'EF retourne 403 avant tout UPDATE, toast "Tu n'as pas les droits sur ce paramètre"
```

```gherkin
# Source : EC2
# Couche : api
# Priorité : P2-important

Scénario : creation_user_email_existant
  Étant donné un user désactivé avec l'email jean@strike.fr
  Quand l'admin crée un nouveau user avec ce même email
  Alors l'EF rejette 409 "Email déjà utilisé" — pas de réactivation automatique (D7 V1)
```

```gherkin
# Source : EC3 / R_M13.3
# Couche : api
# Priorité : P1-critique

Scénario : creation_user_combinaisons_roles_interdites
  Quand l'admin tente de créer un user roles=['manager_prestataire','admin_tms']
  Alors l'EF rejette 400 "Combinaison de rôles non autorisée"
  Quand il tente roles=['chauffeur','ops_savr']
  Alors l'EF rejette 400 (chauffeur + toute autre role interdit)
  Quand il tente roles=['manager_prestataire','ops_savr']
  Alors l'EF rejette 400
  Quand il tente roles=['admin_tms','ops_savr']
  Alors la création passe (combinaison autorisée §09)
```

```gherkin
# Source : EC9 / R_M13.9a / trigger check_impersonation_constraints
# Couche : db
# Priorité : P1-critique

Scénario : impersonation_vers_admin_interdite
  Quand Val tente une impersonation vers Louis (admin_tms)
  Alors le trigger BEFORE INSERT rejette avec RAISE EXCEPTION 'Impersonation interdite vers un autre Admin TMS (R_M13.9)' et l'EF retourne 400
```

```gherkin
# Source : R_M13.9b / trigger
# Couche : db
# Priorité : P1-critique

Scénario : impersonation_vers_user_desactive_interdite
  Quand Val tente une impersonation vers un user statut='desactive'
  Alors le trigger rejette avec RAISE EXCEPTION, aucune ligne impersonation_sessions créée
```

```gherkin
# Source : EC10 / R_M13.9c / trigger
# Couche : db
# Priorité : P1-critique

Scénario : impersonation_cascadee_interdite
  Étant donné une session impersonation active de Val (ended_at IS NULL)
  Quand Val tente de démarrer une 2ème impersonation
  Alors le trigger rejette (EC10) et l'EF retourne 409
```

```gherkin
# Source : trigger check_impersonation_constraints (d)
# Couche : db
# Priorité : P1-critique

Scénario : impersonation_self_interdite
  Quand Val tente une impersonation vers lui-même
  Alors le trigger rejette avec RAISE EXCEPTION 'Impersonation self interdite'
```

```gherkin
# Source : EC5 / W7
# Couche : api
# Priorité : P2-important

Scénario : wizard_smtp_fail_magic_link
  Étant donné le wizard E7 à l'étape 3 (first manager) avec SMTP down
  Quand l'envoi du magic link échoue
  Alors l'alerte m13_user_creation_email_failed (warning) est émise
  Et le wizard affiche "Copier le magic link manuellement" (lien valide 24h)
  Et le user manager est bien créé (pas de rollback)
```

```gherkin
# Source : R_M13.14 refondue / trg_prestataire_grille_obligatoire
# Couche : db
# Priorité : P1-critique

Scénario : activation_prestataire_sans_grille_bloquee
  Étant donné un prestataire en_onboarding SANS grille tarifaire active publiée
  Quand un UPDATE shared.prestataires.statut → 'actif' est tenté (wizard ou SQL direct)
  Alors le trigger trg_prestataire_grille_obligatoire RAISE EXCEPTION, le statut reste en_onboarding
  # M06 #4 TRANCHÉ Val 2026-06-07 : TOLÉRANCE ASSUMÉE — le trigger reste AFTER UPDATE scope en_onboarding→actif.
  # La création province (INSERT actif sans grille) est un écart conscient documenté §09 ; filet aval M07/M08.
  # Ce scénario teste donc uniquement le chemin wizard E7 (UPDATE), pas l'INSERT province.
```

```gherkin
# Source : R_M13.17 / E2
# Couche : api
# Priorité : P2-important

Scénario : edition_parametre_requires_redeploy_sans_confirmation
  Étant donné un paramètre requires_redeploy=true (ex. m05_geofence_rayon_metres)
  Quand l'admin enregistre sans cocher la confirmation explicite redéploiement
  Alors l'EF rejette l'UPDATE
  Quand il confirme explicitement
  Alors l'UPDATE passe avec le toast "redéploiement nécessaire"
```

```gherkin
# Source : W1 / m13_parametre_edition_validation_echec
# Couche : api
# Priorité : P3-nominal

Scénario : validation_server_side_emet_alerte
  Quand une édition paramètre échoue à la validation server (valeur hors bornes contournant le client)
  Alors le server retourne 400 et l'alerte m13_parametre_edition_validation_echec (warning, scope admin) est émise
```

```gherkin
# Source : R_M13.20 / W3
# Couche : db
# Priorité : P1-critique

Scénario : desactivation_seul_manager_actif_alerte
  Étant donné le prestataire Strike avec un unique manager_prestataire actif
  Quand l'admin désactive ce manager
  Alors la désactivation passe (pas de blocage)
  Et l'alerte m13_prestataire_sans_manager_actif (warning, scope ops+admin) est émise
  Et elle s'auto-résout à la création d'un nouveau manager Strike
```

---

## Catégorie 4 — Isolation données (RLS)

```gherkin
# Source : §09 policy secrets_metadata_admin_only / pgTAP 7
# Couche : db
# Priorité : P1-critique

Scénario : rls_secrets_metadata_admin_only
  Étant donné un ops_savr authentifié
  Quand il SELECT tms.secrets_metadata
  Alors 0 ligne retournée (deny)
  Et un manager_prestataire et un chauffeur obtiennent aussi 0 ligne
  Et un admin_tms voit toutes les lignes
```

```gherkin
# Source : §09 policies users_devices_trusted_self_* / pgTAP 1-2
# Couche : db
# Priorité : P1-critique

Scénario : rls_devices_trusted_self_uniquement
  Étant donné deux users ops_savr A et B ayant chacun 2 devices trusted
  Quand A fait SELECT users_tms_devices_trusted
  Alors il ne voit que ses 2 devices, jamais ceux de B
  Quand A tente UPDATE actif=false sur un device de B
  Alors 0 ligne affectée (deny USING)
```

```gherkin
# Source : §09 WITH CHECK actif=false / pgTAP 2
# Couche : db
# Priorité : P1-critique

Scénario : rls_device_revocation_only_pas_reactivation
  Étant donné un user avec un device révoqué (actif=false)
  Quand il tente UPDATE actif=true sur son propre device
  Alors le WITH CHECK (actif = false) rejette — un user ne peut que révoquer, jamais réactiver
  Et un admin_tms peut, lui, modifier tous les devices (policy admin_all)
```

```gherkin
# Source : §09 REVOKE INSERT devices_trusted
# Couche : db
# Priorité : P1-critique

Scénario : rls_device_insert_postgrest_interdit
  Quand un user authentifié (même admin via PostgREST) tente INSERT users_tms_devices_trusted directement
  Alors l'INSERT est rejeté (REVOKE INSERT FROM authenticated) — insertion uniquement applicative au login
```

```gherkin
# Source : §09 REVOKE impersonation_sessions
# Couche : db
# Priorité : P1-critique

Scénario : rls_impersonation_sessions_ef_only
  Quand un admin_tms tente INSERT/UPDATE/DELETE direct sur tms.impersonation_sessions via PostgREST
  Alors rejet (REVOKE FROM authenticated) — mutations uniquement via EF impersonation_start/stop
  Et en SELECT, seul admin_tms lit les sessions ; ops_savr/manager/chauffeur → 0 ligne
```

```gherkin
# Source : R_M13.18 / D5 / pgTAP 12
# Couche : db
# Priorité : P1-critique

Scénario : rls_audit_logs_immutable
  Étant donné une ligne audit_logs existante
  Quand un admin_tms tente UPDATE audit_logs SET commentaire='x'
  Alors rejet (RLS deny + REVOKE)
  Quand il tente DELETE
  Alors rejet — aucune exception, même admin_tms
```

```gherkin
# Source : E4 RLS / §04 audit_logs
# Couche : db
# Priorité : P1-critique

Scénario : rls_audit_logs_lecture_staff_only
  Quand un manager_prestataire Strike fait SELECT audit_logs
  Alors 0 ligne (V1 = pas d'accès manager, V2 si besoin)
  Et un chauffeur obtient 0 ligne
  Et ops_savr et admin_tms lisent tout
```

```gherkin
# Source : M13 §2 / §04 parametres_tms RLS / §09 policy parametres_tms_read_staff — F5 tranchée
# Couche : db
# Priorité : P1-critique

Scénario : rls_parametres_tms_lecture_staff_only
  Quand un manager_prestataire ou un chauffeur fait SELECT parametres_tms
  Alors 0 ligne retournée (config business Savr non exposée aux prestataires)
  Et ops_savr lit tout, admin_tms lit tout
  # F5 TRANCHÉE Val 2026-06-07 : SELECT staff only (policy parametres_tms_read_staff §09). Apps clientes via EF cache 60s.
```

```gherkin
# Source : §04 parametres_tms écriture modifiable_par[]
# Couche : db
# Priorité : P1-critique

Scénario : rls_parametres_tms_ecriture_modifiable_par
  Étant donné un paramètre modifiable_par=['admin_tms','ops_savr']
  Quand un ops_savr UPDATE sa valeur
  Alors l'UPDATE passe
  Étant donné un paramètre modifiable_par=['admin_tms']
  Quand le même ops_savr UPDATE
  Alors rejet RLS (0 ligne affectée)
```

```gherkin
# Source : E9 garde-fous / R_M13.10
# Couche : db
# Priorité : P1-critique

Scénario : rls_perimetre_pendant_impersonation
  Étant donné Val en impersonation d'un manager Strike (JWT roles=manager_prestataire, prestataire_id=Strike)
  Quand il SELECT les tournées
  Alors il ne voit que les tournées Strike, jamais Marathon (RLS du rôle effectif s'applique)
  Quand il tente d'accéder à secrets_metadata ou E5
  Alors deny (le JWT impersonation ne porte pas admin_tms)
```

---

## Catégorie 5 — Idempotence et états

```gherkin
# Source : §8 états users_tms.statut / sobriété D2 2026-04-30
# Couche : db
# Priorité : P1-critique

Scénario : statut_desactive_terminal
  Étant donné un user statut='desactive'
  Quand un UPDATE statut='actif' est tenté (même admin_tms)
  Alors la transition est refusée (terminal V1 — réactivation hors scope, créer un nouveau user)
```

```gherkin
# Source : §8 états users_tms.statut
# Couche : db
# Priorité : P3-nominal

Scénario : annulation_avant_premiere_connexion
  Étant donné un user statut='en_attente_premiere_connexion'
  Quand l'admin le désactive (raison valide)
  Alors la transition en_attente_premiere_connexion → desactive passe (cas rare autorisé)
```

```gherkin
# Source : EC6 / R_M13.6
# Couche : api
# Priorité : P1-critique

Scénario : replay_event_deja_traite_noop
  Étant donné un event_id présent dans integrations_inbox statut='traite'
  Quand l'admin replay cet event
  Alors l'EF retourne 200 sans aucun effet métier (dédup inbox), toast "déjà traité avec succès"
  Et aucune nouvelle collecte/mutation n'est créée
```

```gherkin
# Source : EC17 / R_M13.7
# Couche : db
# Priorité : P2-important

Scénario : wizard_crash_etat_persistant_et_cron_7j
  Étant donné un wizard interrompu après l'étape 1 (prestataire créé en_onboarding)
  Alors le prestataire reste statut='en_onboarding', visible M06 avec badge "Onboarding en cours" (pas de rollback ni reprise auto)
  Quand le cron quotidien trouve ce prestataire en_onboarding depuis > 7 jours
  Alors l'alerte m13_onboarding_inacheve_7j (warning) est émise
  Et elle s'auto-résout à l'activation ou l'archivage du prestataire
```

```gherkin
# Source : EC13
# Couche : api
# Priorité : P2-important

Scénario : desactivation_target_en_cours_impersonation
  Étant donné une session impersonation active de Val vers un manager M
  Quand un autre admin désactive M
  Alors la session impersonation est forcée end_reason='forced_logout'
  Et Val (impersonator) est notifié
```

```gherkin
# Source : EC18
# Couche : api
# Priorité : P3-nominal

Scénario : revocation_tous_devices_session_courante_survit
  Étant donné un user connecté sur le device D1 avec 2 devices trusted
  Quand il clique "Révoquer tous mes devices"
  Alors tous ses devices passent actif=false mais sa session courante reste valide
  Et sa prochaine reconnexion sur D1 exige re-MFA (admin) ou re-MDP (ops)
```

```gherkin
# Source : W5 (rotations successives)
# Couche : api
# Priorité : P3-nominal

Scénario : rotations_successives_metadata_derniere
  Quand l'admin rotate 2 fois le même secret à 1 minute d'intervalle
  Alors 2 lignes audit_logs SECRET_ROTATE existent (append-only)
  Et secrets_metadata.derniere_rotation_at reflète uniquement la 2ème rotation
  Et le Vault contient uniquement la dernière valeur
```

```gherkin
# Source : W12 + M11 dedup_key
# Couche : db
# Priorité : P3-nominal

Scénario : cron_expiration_idempotent
  Étant donné une alerte m13_secret_expiration_imminente déjà active pour pennylane_api_token_v2
  Quand le cron retourne le lendemain (secret toujours non roté)
  Alors aucune alerte doublon n'est créée (dedup_key M11 GENERATED STORED)
```

```gherkin
# Source : E6.b "Marquer comme résolu manuellement"
# Couche : api
# Priorité : P2-important

Scénario : marquage_succes_manuel_sans_replay
  Étant donné un event echec_final corrigé hors-bande par l'admin
  Quand il clique "Marquer comme résolu manuellement" avec commentaire
  Alors integrations_logs.statut passe à 'succes_manuel' + audit_logs obligatoire
  Et l'event sort des compteurs "échecs finaux" E6/E1
```

---

## Catégorie 6 — Scénarios cross-app (replay W6 uniquement)

> M13 n'expose aucun endpoint E1-E6/S1-S11. HMAC, X-API-Version et dédup `body.event_id` sont testés dans M01/M05. Seul le **replay manuel W6** touche le contrat §08.

```gherkin
# Source : W6.b / R_M13.6 / contrat §08 dédup body.event_id
# Couche : api
# Priorité : P1-critique

Scénario : replay_entrant_conserve_event_id_original
  Étant donné un event E1 entrant en echec_final avec body.event_id = X
  Quand l'admin replay
  Alors le webhook est reconstruit avec event_id X original (jamais regénéré)
  Et il passe par integrations_inbox : si X déjà traité → no-op 200 ; sinon → traitement normal
```

```gherkin
# Source : W6.c / E6.b — F2 tranchée Val 2026-06-07
# Couche : api
# Priorité : P1-critique

Scénario : replay_sortant_vers_plateforme
  Étant donné un webhook S1 sortant vers la Plateforme en echec_final (body.event_id = Y)
  Quand l'admin replay
  Alors le payload original est re-POSTé vers l'URL d'origine avec body.event_id = Y conservé (la dédup inbox Plateforme protège du double traitement si Y avait été reçu)
  Et une nouvelle ligne integrations_logs est créée avec tentative_num=1 (nouvelle chaîne) et acteur_meta={action:'manual_replay', original_log_id}
  # F2 TRANCHÉE Val 2026-06-07 : event_id original + tentative_num=1. W6.c et E6.b corrigés dans M13.
```

```gherkin
# Source : EC7 — ⚠ conditionnel floue F3 (retry policy)
# Couche : api
# Priorité : P2-important

Scénarios : replay_sortant_service_down_retry_policy
  Étant donné un replay sortant vers la Plateforme qui répond 500
  Alors une ligne integrations_logs statut='echec_retry' est créée
  Et la retry policy canonique 3 paliers s'applique : 5 min / 1h / 24h (§08 Bloc B B1)
  Et un nouvel echec_final notifie l'admin (alerte M11)
  # F3 CORRIGÉE 2026-06-07 : EC7 M13 + §04 integrations_logs alignés sur 3 paliers.
```

---

## Catégorie 7 — Scénarios de migration (mode migration runtime)

> Les checks de réconciliation data MTS-1 sont couverts par `13 - Migration MTS-1` (hors scope module). M13 porte le **pilotage runtime** du mode migration (§13.4) : testé ici.

```gherkin
# Source : §13.4 / E2 paramètre racine migration_mode_active
# Couche : api
# Priorité : P1-critique

Scénario : activation_mode_migration_j0
  Étant donné migration_mode_active = false
  Quand Val (admin_tms) toggle à true depuis E2
  Alors audit_logs contient action='M13_MIGRATION_MODE_TOGGLE'
  Et le bandeau migration s'affiche et les effets runtime §13.4 s'activent (filtres facturation, contexte audit)
```

```gherkin
# Source : §13 EC11 / friction désactivation
# Couche : ui + api
# Priorité : P1-critique

Scénario : desactivation_mode_migration_friction
  Étant donné migration_mode_active = true
  Quand Val tente le toggle à false
  Alors une modale exige la saisie exacte du texte "DESACTIVER MIGRATION" + une raison libre obligatoire
  Quand il saisit "desactiver migration" (casse incorrecte) ou laisse la raison vide
  Alors la désactivation est refusée
  Quand il saisit le texte exact + raison
  Alors le toggle passe avec audit M13_MIGRATION_MODE_TOGGLE enrichi (raison)
```

```gherkin
# Source : §13.4 / RLS parametres_tms
# Couche : db
# Priorité : P1-critique

Scénario : migration_mode_toggle_admin_only
  Quand un ops_savr tente UPDATE migration_mode_active
  Alors rejet (modifiable_par=['admin_tms'] uniquement)
```

```gherkin
# Source : R_§13.1 / §04 audit_logs.contexte
# Couche : db
# Priorité : P2-important

Scénario : mutations_en_mode_migration_contexte_test
  Étant donné migration_mode_active = true
  Quand une saisie TMS génère une facture et des audit_logs
  Alors factures_prestataires.migration_test = true et audit_logs.contexte = 'migration_test'
  Et ces lignes sont exclues des exports Pennylane (cf. M08)
```

---

## ⚠ Specs floues — TRANCHÉES Val 2026-06-07 + PROPAGÉES

| #      | Spec floue                                                                                                                           | Décision Val 2026-06-07                                                                                                                                     | Propagation effectuée                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **F1** | Wizard E7 : 3 (entête + §3 archi + D8, sobriété B4 2026-04-30) vs 4 étapes grille bloquante (§4 E7.2 + W7 + R_M13.14, D2 2026-05-01) | **4 étapes, grille bloquante** (D2 plus récent fait foi)                                                                                                    | M13 §3 archi réaligné (E7.1-E7.4), D8 refondu, §10 perf corrigé                                          |
| **F2** | Replay sortant W6 : "nouveau Idempotency-Key" (header supprimé du contrat) + tentative_num=1 (W6.c) vs incrémenté (E6.b)             | **`body.event_id` original conservé + `tentative_num=1`** nouvelle chaîne + `acteur_meta.original_log_id` (dédup destinataire protège du double traitement) | M13 W6.c + E6.b corrigés                                                                                 |
| **F3** | EC7 retry policy "5min/30min/2h/6h/24h" (5 paliers stale) vs canonique §08 Bloc B B1                                                 | **3 paliers 5 min / 1h / 24h** (correction doc, pas d'alternative)                                                                                          | M13 EC7 + §04 integrations_logs (tentative_num 2-4, echec_final après 3 retries, prochaine_tentative_at) |
| **F4** | MFA ops_savr : non (addendum M13 2026-04-25 + D11) vs oui (tableau addendum M03 L216)                                                | **Pas de MFA ops_savr V1** (D11 fait foi)                                                                                                                   | §09 tableau M03 corrigé                                                                                  |
| **F5** | Lecture `parametres_tms` : tous authentifiés (§04) vs staff only (M13 §2)                                                            | **SELECT staff only** (`admin_tms`+`ops_savr`) — config business non exposée aux prestataires ; apps clientes via EF cache 60s (D6)                         | §04 RLS corrigé + §09 policy `parametres_tms_read_staff` (ex-`parametres_tms_read_all USING(true)`)      |

**Dépendance externe — SOLDÉE 2026-06-07** : M06 #4 tranché Val = **tolérance assumée** (province créée `actif` sans grille, écart conscient §09, trigger inchangé AFTER UPDATE `en_onboarding→actif`, filet aval M07 coût NULL → M08 `rapprochement_manuel_requis`). Les 3 autres floues M06 tranchées même session — cf. `tests/M06-referentiel-prestataires-scenarios.md`.

**Corrections doc mineures — APPLIQUÉES 2026-06-07** :

- §3 archi : collision E6.c résolue — orphelines = E6.c (V1), dashboard inbox dédup = E6.d (V1.1).
- §18 état final réaligné : 1 paramètre seedé (ex-17), 6 codes alertes actifs (ex-10), 3 tables nouvelles (ex-4), 11 EF (ex-12).

---

## Scénarios hors scope (V1.1)

- **E6.c collectes orphelines (fusion/ignorer)** : scénarios détaillés générés avec M02 (E6.c réconciliation testée dans M02-dispatch-scenarios 7.3) — non dupliqués ici.
- **Pseudonymisation RGPD users** (D7 → V1.1).
- **IP-restrict `/admin/*`** (QO5 non tranchée — pas de scénario tant que la décision sécu n'est pas prise).
- **Notif email sur reveal secret** (QO6 ouverte).
- **Versionning `parametres_tms.valeur` pour rollback** (QO7).
- **Réactivation user désactivé** (hors scope V1, statut terminal).

# Scénarios de test — M06 Référentiel prestataires

**Source CDC** : §06 TMS/M06 + §05 TMS (R2.1, R6.4) + §04 TMS (`shared.prestataires`, `tms.vehicules`, `tms.chauffeurs`, `tms.types_vehicules`, `tms.grilles_tarifaires_prestataires`, `formules_catalogue`, `users_tms`) + §09 TMS (policies RLS + `fn_create_prestataire_province`)
**Généré le** : 2026-06-06 — **4 floues TRANCHÉES Val 2026-06-07 + propagées (M06+§05+§09), scénarios amendés**
**Statut** : À implémenter par Claude Code

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests du module M06.
> Pour chaque scénario :
>
> - Couche `db` → test pgTAP dans `supabase/tests/`
> - Couche `api` → test Vitest dans `packages/tms/tests/api/`
> - Couche `ui` → test Playwright dans `packages/tms/tests/e2e/`
>   Les tests P1-critique sont bloquants CI. Les tests P2 et P3 sont non-bloquants V1.
>   Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.

> **Note de périmètre M06** : module **interne TMS**, aucun endpoint du contrat API Plateforme↔TMS (E1-E6 / S1-S11). La catégorie 6 ne couvre donc **pas** les webhooks inter-apps mais l'**isolation cross-schema** (lecture `shared.prestataires` et vue `categorie_plateforme` côté Plateforme). La catégorie 7 (migration) est traitée hors scope V1 ici — la migration référentiel (seed manuel MTS-1, D7) relève de la skill `cdc-migration-data` (`04 - Migration/05 - Checks reconciliation.md`).

---

## Résumé de couverture

| Catégorie               | Nb scénarios | Couverture                                                                                                                                |
| ----------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Happy path          | 9            | W1 prestataire, W2 véhicule, W3 chauffeur+compte, W5 changement presta, W6 grille, W7 type véhicule, E8 fin contrat, E9 Everest, province |
| 2 — Cas limites métier  | 7            | bornes overlap grille, date_fin_contrat J+30, SIRET nul, magic link 30 min, rayon/coords, archivage type, 0 collecte E8                   |
| 3 — Cas d'erreur métier | 11           | EC1-EC14 (SIRET/plaque doublon, overlap, email doublon, fichier >5Mo, format, Everest échec, prestataire actif sans grille)               |
| 4 — Isolation RLS       | 9            | admin_tms / ops_savr / manager_prestataire / chauffeur sur prestataires, véhicules, chauffeurs, grilles, types                            |
| 5 — Idempotence & états | 8            | transitions prestataire/véhicule/chauffeur/grille, immuabilité archive, anti-expiration grille, grille obligatoire                        |
| 6 — Cross-schema        | 4            | lecture Plateforme `shared.prestataires`, deny écriture cross-schema, vue `categorie_plateforme`                                          |
| 7 — Migration           | 0            | hors scope (cf. note de périmètre)                                                                                                        |
| **TOTAL**               | **48**       |                                                                                                                                           |

---

## Catégorie 1 — Happy path

```gherkin
# Source : §06/M06 W1 + §04 trg_prestataire_grille_obligatoire
# Couche : api
# Priorité : P1-critique

Scénario : creation_prestataire_aboutit_en_onboarding
  Étant donné un Admin TMS connecté (app_domain = 'tms')
  Et aucun prestataire avec le code "prest_rungis" en base
  Quand il soumet E3 avec code="prest_rungis", nom="Rungis Frais", siret="12345678900011", type_prestation=["ZD"], contact_operationnel renseigné
  Alors une ligne shared.prestataires est créée avec statut = 'en_onboarding'
  Et un audit_log action='PRESTATAIRE_CREATE' est écrit avec acteur = admin_tms.user_id
  Et le bouton "Activer le prestataire" reste désactivé tant qu'aucune grille active ne couvre la période
```

```gherkin
# Source : §06/M06 W2 + §04 vehicules
# Couche : api
# Priorité : P1-critique

Scénario : creation_vehicule_actif
  Étant donné un Ops Savr connecté et le prestataire "strike" existant
  Et aucun véhicule actif avec la plaque "AA-123-BB"
  Quand il crée un véhicule plaque="AA-123-BB", type_vehicule_id=<camion_7t>
  Alors une ligne tms.vehicules est créée avec statut = 'actif' et deleted_at = NULL
  Et plaque_canonique = "AA123BB"
  Et un audit_log action='VEHICULE_CREATE' est écrit
```

```gherkin
# Source : §06/M06 W3 + §09 Workflow magic link
# Couche : api
# Priorité : P1-critique

Scénario : creation_chauffeur_avec_compte_magic_link
  Étant donné un Admin TMS connecté et le prestataire "strike" existant
  Quand il crée un chauffeur nom="Dupont", prenom="Marc", telephone="0612345678", toggle compte=on, email="marc.dupont@strike.fr"
  Alors une ligne tms.chauffeurs est créée (statut='actif', peut_conduire=true)
  Et une ligne users_tms est créée avec roles=['chauffeur'], prestataire_id=strike, chauffeur_id lié
  Et une entrée auth.users est créée avec encrypted_password = NULL
  Et un magic link Supabase TTL 30 min est généré et l'email "chauffeur_bienvenue" est envoyé
  Et aucun mot de passe en clair n'est transmis
```

```gherkin
# Source : §06/M06 W3 (toggle off)
# Couche : api
# Priorité : P3-nominal

Scénario : creation_chauffeur_sans_compte
  Étant donné un Ops Savr connecté et le prestataire "marathon" existant
  Quand il crée un chauffeur nom="Sow", prenom="Awa", telephone="0700000000", toggle compte=off
  Alors une ligne tms.chauffeurs est créée
  Et aucune ligne users_tms n'est créée (chauffeur sans compte app mobile)
```

```gherkin
# Source : §06/M06 W6 + §04 EXCLUDE overlap + R2.1
# Couche : api
# Priorité : P1-critique

Scénario : creation_et_publication_grille_tarifaire
  Étant donné un Admin TMS connecté et le prestataire "strike"
  Et aucune grille active sur (strike, camion_7t) chevauchant 2026-07-01 → NULL
  Quand il crée une grille formule_id='vacations_paliers', type_vehicule_id=<camion_7t>, date_debut_validite='2026-07-01', parametres valides, puis clique "Publier"
  Alors la grille passe statut = 'actif'
  Et un audit_log action='GRILLE_PUBLISH' avec snapshot des paramètres est écrit
  Et la grille devient utilisable par R2 calcul coût dès la prochaine clôture tournée
```

```gherkin
# Source : §06/M06 W7 + §04 types_vehicules
# Couche : api
# Priorité : P2-important

Scénario : creation_type_vehicule_par_ops
  Étant donné un Ops Savr connecté
  Et aucun type avec code "camion_3t5"
  Quand il crée un type code="camion_3t5", label="Camion 3,5 t", categorie="camion", categorie_plateforme="camionnette"
  Alors une ligne tms.types_vehicules est créée avec code immuable
  Et un audit_log est écrit
```

```gherkin
# Source : §06/M06 E8 + §05 R6.4
# Couche : api
# Priorité : P1-critique

Scénario : fin_contrat_prestataire_sans_tournee_active
  Étant donné un Admin TMS connecté et le prestataire "prest_rungis" statut='actif'
  Et 0 tournée en statut planifiee/acceptee/en_cours ni collecte statut_dispatch attribuee_en_attente_acceptation/acceptee pour ce prestataire (tranché #1 2026-06-07 — a_attribuer exclu)
  Quand il valide E8 avec date_fin_effective = today+30 et coche la confirmation
  Alors shared.prestataires.statut = 'suspendu' et date_fin_contrat = today+30
  Et tous les users_tms WHERE prestataire_id = prest_rungis passent statut='suspendu'
  Et un audit_log action='PRESTATAIRE_FIN_CONTRAT' est écrit
  Et un email "Fin de contrat programmée" est envoyé au contact_operationnel
```

```gherkin
# Source : §06/M06 W5 + D9
# Couche : api
# Priorité : P2-important

Scénario : changement_prestataire_chauffeur
  Étant donné un Admin TMS et un chauffeur "Marc Dupont" chez "strike" (avec docs uploadés + compte users_tms)
  Quand il clique "Changer de prestataire" et sélectionne "marathon" puis confirme
  Alors le chauffeur chez strike passe deleted_at=now() et son users_tms est archivé (magic link désactivé)
  Et un nouveau chauffeur est créé chez marathon copiant nom, prenom, telephone, peut_conduire, numero_permis
  Et les documents (permis_url, piece_identite_url) NE sont PAS copiés
  Et le compte users_tms N'est PAS copié
  Et trois audit_logs sont écrits : CHAUFFEUR_ARCHIVE, CHAUFFEUR_CREATE, CHAUFFEUR_MIGRATED (payload liant les 2 ids)
```

```gherkin
# Source : §06/M06 E9 + M14 W8
# Couche : api
# Priorité : P2-important

Scénario : activation_everest_test_connexion_ok
  Étant donné un Admin TMS et le prestataire "a_toutes" (A Toutes!) integration off
  Quand il active le toggle Everest, saisit everest_client_id et clique "Tester la connexion" et que M14 W8 répond 200
  Alors integration_externe = 'everest' et everest_client_id est persisté
  Et une entrée tms.integrations_logs (system='everest', type_event='m14_ping') est tracée
  Et la vue tms.vue_prestataires_everest_status reflète la dernière connexion réussie
```

---

## Catégorie 2 — Cas limites métier

```gherkin
# Source : §04 EXCLUDE overlap (bornes adjacentes)
# Couche : db
# Priorité : P1-critique

Scénario : grilles_adjacentes_non_chevauchantes_acceptees
  Étant donné une grille active (strike, camion_7t) du 2026-01-01 au 2026-06-30
  Quand on publie une grille active (strike, camion_7t) du 2026-07-01 au NULL
  Alors l'INSERT réussit (pas de chevauchement, bornes daterange '[]' adjacentes mais disjointes)
```

```gherkin
# Source : §04 EXCLUDE overlap (recouvrement d'un seul jour)
# Couche : db
# Priorité : P1-critique

Scénario : grilles_chevauchement_un_jour_refusees
  Étant donné une grille active (strike, camion_7t) du 2026-01-01 au 2026-06-30
  Quand on publie une grille active (strike, camion_7t) du 2026-06-30 au NULL
  Alors l'INSERT est rejeté par l'index EXCLUDE (conflit sur le 2026-06-30)
```

```gherkin
# Source : §06/M06 E8 + §04 trigger cron J+30
# Couche : db
# Priorité : P1-critique

Scénario : archivage_auto_a_date_fin_contrat_exacte
  Étant donné un prestataire statut='suspendu' avec date_fin_contrat = today
  Quand le cron journalier d'archivage s'exécute
  Alors le prestataire passe statut='archive'
  Et ses users_tms associés sont soft-deleted
  Et un audit_log action='PRESTATAIRE_ARCHIVE_AUTO' est écrit
```

```gherkin
# Source : §06/M06 E8 + §04 trigger cron (borne J-1)
# Couche : db
# Priorité : P2-important

Scénario : pas_archivage_avant_date_fin_contrat
  Étant donné un prestataire statut='suspendu' avec date_fin_contrat = today+1
  Quand le cron journalier d'archivage s'exécute
  Alors le prestataire reste statut='suspendu' (date_fin_contrat > today)
```

```gherkin
# Source : §06/M06 E3 §1 (SIRET optionnel)
# Couche : api
# Priorité : P2-important

Scénario : creation_prestataire_etranger_sans_siret
  Étant donné un Admin TMS connecté
  Quand il crée un prestataire sans siret (NULL), nom="Bruxelles Logistics", type_prestation=["AG"]
  Alors la création réussit (siret nullable, contrainte unique strict appliquée seulement si non NULL)
```

```gherkin
# Source : §06/M06 W3 + §09 magic link TTL
# Couche : api
# Priorité : P2-important

Scénario : magic_link_expire_renvoi_disponible
  Étant donné un chauffeur avec compte créé et magic link généré il y a 31 minutes
  Quand le chauffeur clique le lien
  Alors le lien est refusé (TTL 30 min dépassé)
  Et le bouton "Renvoyer lien d'activation" est disponible sur la fiche chauffeur (M06 E5 / M03 E5)
```

```gherkin
# Source : §06/M06 E3 validation coords + D11
# Couche : api
# Priorité : P2-important

Scénario : rayon_intervention_exige_coords_siege
  Étant donné un Admin TMS créant un prestataire province avec rayon_intervention_km = 50
  Quand le geocoding Nominatim échoue (coords_siege_lat/lng restent NULL)
  Alors l'enregistrement est refusé : coords_siege_lat/lng obligatoires si rayon_intervention_km IS NOT NULL
  Et un message "Non géolocalisé — vérifier l'adresse" est affiché
```

---

## Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : §06/M06 EC1 + D8 (SIRET unique strict)
# Couche : db
# Priorité : P1-critique

Scénario : creation_siret_doublon_refusee
  Étant donné un prestataire "strike" avec siret="98765432100018"
  Quand un Admin TMS tente de créer un prestataire avec le même siret
  Alors l'INSERT est rejeté (contrainte unique stricte sur siret)
  Et l'UI affiche "Ce SIRET existe déjà pour le prestataire strike" avec lien vers la fiche
```

```gherkin
# Source : §06/M06 EC2 + §04 index plaque_canonique
# Couche : db
# Priorité : P1-critique

Scénario : creation_plaque_active_doublon_refusee
  Étant donné un véhicule actif plaque "AA-123-BB" (plaque_canonique "AA123BB", deleted_at NULL) chez strike
  Quand un Ops Savr tente de créer un véhicule plaque "aa 123 bb" chez marathon
  Alors l'INSERT est rejeté par l'index UNIQUE (plaque_canonique) WHERE deleted_at IS NULL
  Et l'UI affiche le prestataire propriétaire du véhicule existant
```

```gherkin
# Source : §06/M06 EC2 (réutilisation après archive)
# Couche : db
# Priorité : P2-important

Scénario : plaque_reutilisable_apres_archivage
  Étant donné un véhicule plaque "AA-123-BB" archivé (deleted_at renseigné, statut='archive')
  Quand un Ops Savr crée un nouveau véhicule plaque "AA-123-BB"
  Alors la création réussit (unicité bornée aux plaques actives uniquement, cf. Q10)
```

```gherkin
# Source : §06/M06 EC3 + D8 (permis sans contrainte)
# Couche : api
# Priorité : P3-nominal

Scénario : numero_permis_doublon_non_bloquant
  Étant donné un chauffeur "Marc Dupont" avec numero_permis="123ABC" chez strike
  Quand un Ops Savr crée un chauffeur avec le même numero_permis chez marathon
  Alors une alerte info non bloquante s'affiche ("déjà saisi sur Marc Dupont chez strike")
  Et la création réussit après confirmation (aucune contrainte DB)
```

```gherkin
# Source : §06/M06 EC7 + §04 EXCLUDE overlap
# Couche : db
# Priorité : P1-critique

Scénario : grille_overlap_refusee
  Étant donné une grille active (strike, camion_7t) du 2026-01-01 au NULL
  Quand un Admin TMS tente de publier une grille active (strike, camion_7t) du 2026-03-01 au NULL
  Alors la publication est rejetée (erreur SQL EXCLUDE interceptée côté API)
  Et l'UI liste la grille en conflit avec sa période
```

```gherkin
# Source : §06/M06 EC8 + §09 users_tms email unique
# Couche : db
# Priorité : P1-critique

Scénario : activation_compte_email_deja_existant_refusee
  Étant donné un users_tms existant avec email="marc.dupont@strike.fr"
  Quand un Admin TMS active un compte chauffeur avec le même email
  Alors l'INSERT users_tms est rejeté (unicité email globale)
  Et l'UI affiche "Cet email est déjà utilisé par {prenom nom} ({role})"
```

```gherkin
# Source : §06/M06 EC4 + §05 R6.4 (blocage fin contrat)
# Couche : api
# Priorité : P1-critique

Scénario : fin_contrat_bloquee_si_tournee_active
  Étant donné un prestataire "strike" avec 2 tournées en statut 'acceptee'
  Quand un Admin TMS ouvre E8
  Alors un bandeau rouge "2 collecte(s)/tournée(s) active(s)" s'affiche
  Et le bouton "Confirmer" est désactivé tant que N > 0
  Et un lien "Ouvrir M02 Dispatch filtré sur strike" est proposé
```

```gherkin
# Source : §06/M06 E8 Bloc 1 + §05 R6.4 — tranché Val 2026-06-07 floue #1
# Couche : api
# Priorité : P1-critique

Scénario : fin_contrat_bloquee_si_collecte_dispatch_en_cours
  Étant donné un prestataire "marathon" sans tournée active mais avec 1 collecte statut_dispatch='attribuee_en_attente_acceptation'
  Quand un Admin TMS ouvre E8
  Alors le COUNT bloquant retourne 1 et le formulaire est désactivé (la collecte attribuée deviendrait orpheline)
  Étant donné un prestataire sans tournée active et avec uniquement des collectes statut_dispatch='a_attribuer' dans le système
  Quand un Admin TMS ouvre E8
  Alors le COUNT retourne 0 et la fin de contrat est possible (a_attribuer non rattachée à un prestataire)
```

```gherkin
# Source : §06/M06 EC6 + §04 garde-fou archivage type
# Couche : db
# Priorité : P2-important

Scénario : archivage_type_vehicule_utilise_refuse
  Étant donné un type_vehicule "camion_7t" avec 3 véhicules actifs
  Quand un Ops Savr tente de l'archiver
  Alors l'archivage est refusé (COUNT véhicules actifs > 0)
  Et le message "Impossible d'archiver : 3 véhicules actifs utilisent ce type" s'affiche
```

```gherkin
# Source : §06/M06 EC9 (Everest échec)
# Couche : api
# Priorité : P3-nominal

Scénario : activation_everest_test_connexion_echec
  Étant donné un Admin TMS activant Everest avec un everest_client_id invalide
  Quand le test de connexion M14 W8 retourne une erreur
  Alors le toggle Everest reste off
  Et l'erreur réseau/clé est affichée
  Et l'Admin peut forcer "Activer sans tester" (case "J'ai vérifié la clé hors TMS") → flag + audit
```

```gherkin
# Source : §06/M06 EC13 + EC14 (upload docs)
# Couche : ui
# Priorité : P3-nominal

Scénario : upload_doc_chauffeur_invalide
  Étant donné un Admin TMS sur E5 section Permis
  Quand il tente d'uploader un fichier de 8 Mo OU un fichier .docx
  Alors l'upload est refusé côté client avant envoi
  Et le message approprié s'affiche ("max 5 Mo" / "PDF ou JPEG uniquement")
```

```gherkin
# Source : §05 R2.1 R_M06.X + §04 trg_prestataire_grille_obligatoire
# Couche : db
# Priorité : P1-critique

Scénario : activation_prestataire_sans_grille_refusee
  Étant donné un prestataire "prest_rungis" statut='en_onboarding' sans aucune grille active couvrante
  Quand un Admin TMS tente de le passer statut='actif'
  Alors le trigger trg_prestataire_grille_obligatoire lève une EXCEPTION
  Et le prestataire reste en_onboarding
```

---

## Catégorie 4 — Isolation données (RLS)

```gherkin
# Source : §09 prestataires_admin_tms_write / prestataires_ops_tms_update_identity
# Couche : db
# Priorité : P1-critique

Scénario : ops_savr_ne_cree_pas_prestataire_directement
  Étant donné un Ops Savr connecté (app_domain='tms')
  Quand il tente un INSERT direct sur shared.prestataires
  Alors l'opération est refusée (policy write = admin_tms uniquement)
```

```gherkin
# Source : §09 GRANT column-level ops_savr
# Couche : db
# Priorité : P1-critique

Scénario : ops_savr_ne_modifie_pas_colonnes_operationnelles
  Étant donné un Ops Savr et un prestataire existant
  Quand il tente un UPDATE de statut OU rayon_intervention_km OU integration_externe
  Alors l'opération est refusée (GRANT column-level : seules nom/siret/adresse_siege/contacts/commentaire_interne autorisées)
  Et un UPDATE de nom réussit (colonne identité autorisée)
```

```gherkin
# Source : §09 grilles_admin_tms_write / grilles_staff_read
# Couche : db
# Priorité : P1-critique

Scénario : ops_savr_lecture_seule_grilles
  Étant donné un Ops Savr connecté
  Quand il lit les grilles tarifaires → autorisé (grilles_staff_read)
  Et quand il tente INSERT/UPDATE d'une grille → refusé (write = admin_tms uniquement)
```

```gherkin
# Source : §09 vehicules_manager_rw (isolation prestataire)
# Couche : db
# Priorité : P1-critique

Scénario : manager_strike_ne_voit_pas_vehicules_marathon
  Étant donné un manager_prestataire de strike (auth.user_prestataire_id() = strike)
  Quand il lit tms.vehicules
  Alors seuls les véhicules WHERE prestataire_id = strike sont retournés
  Et une lecture/écriture d'un véhicule marathon est refusée
```

```gherkin
# Source : §09 chauffeurs_manager_rw
# Couche : db
# Priorité : P1-critique

Scénario : manager_marathon_ne_voit_pas_chauffeurs_strike
  Étant donné un manager_prestataire de marathon
  Quand il lit tms.chauffeurs
  Alors seuls les chauffeurs WHERE prestataire_id = marathon sont retournés
```

```gherkin
# Source : §09 chauffeurs_self_read + grilles (deny chauffeur)
# Couche : db
# Priorité : P1-critique

Scénario : chauffeur_voit_son_record_mais_pas_grilles
  Étant donné un chauffeur connecté (auth.user_chauffeur_id() = ch1)
  Quand il lit tms.chauffeurs → seul son propre record (id = ch1) est visible
  Et quand il lit grilles_tarifaires_prestataires → 0 ligne (pas d'accès)
```

```gherkin
# Source : §09 §3bis périmètre chauffeur (M06 = 403)
# Couche : api
# Priorité : P2-important

Scénario : manager_prestataire_403_sur_ecrans_M06
  Étant donné un manager_prestataire tentant d'accéder à l'URL M06 E1 (liste prestataires)
  Quand la requête est émise
  Alors le système répond 403 (M06 = interne Admin TMS + Ops Savr, cf. D1)
```

```gherkin
# Source : §09 types_vehicules (lecture ouverte / write staff)
# Couche : db
# Priorité : P2-important

Scénario : types_vehicules_lecture_ouverte_ecriture_staff
  Étant donné un chauffeur authentifié
  Quand il lit tms.types_vehicules → autorisé (lecture ouverte authenticated)
  Et quand il tente un INSERT → refusé (write = staff ops/admin uniquement)
```

```gherkin
# Source : §04 RLS types_vehicules categorie_plateforme + W7
# Couche : db
# Priorité : P2-important

Scénario : categorie_plateforme_editable_staff_only
  Étant donné un manager_prestataire ayant créé un type via M03 (valide_ops=false)
  Quand il tente de modifier categorie_plateforme après création
  Alors l'UPDATE est refusé (categorie_plateforme éditable Ops/Admin uniquement)
```

---

## Catégorie 5 — Idempotence et états

```gherkin
# Source : §05 R6.4 (archive irréversible)
# Couche : db
# Priorité : P1-critique

Scénario : prestataire_archive_irreversible
  Étant donné un prestataire statut='archive'
  Quand un Admin TMS tente via UI de le repasser actif/suspendu
  Alors la transition est interdite (archive → * interdit, intervention DB requise)
```

```gherkin
# Source : §05 R6.4 + EC10 (réactivation pendant suspension)
# Couche : api
# Priorité : P2-important

Scénario : reactivation_prestataire_pendant_suspension
  Étant donné un prestataire statut='suspendu', date_fin_contrat=today+10, avec une grille toujours active
  Quand un Admin TMS clique "Réactiver"
  Alors statut='actif', date_fin_contrat=NULL
  Et les users_tms associés repassent statut='actif'
  Et un audit_log action='PRESTATAIRE_REACTIVATE' est écrit
```

```gherkin
# Source : §05 R6.4 + EC10 — tranché Val 2026-06-07 floue #2 (tolérance, inverse reco)
# Couche : db
# Priorité : P1-critique

Scénario : reactivation_grille_expiree_toleree
  Étant donné un prestataire statut='suspendu' dont l'unique grille a expiré pendant la suspension (date_fin_validite < today)
  Quand un Admin TMS clique "Réactiver"
  Alors la transition suspendu→actif PASSE (trg_prestataire_grille_obligatoire scope en_onboarding→actif uniquement, ne se déclenche pas)
  Et un bandeau warning "Grille expirée — republier dans M07" s'affiche sur la fiche E2
  Et aucune alerte M11 n'est émise
  Et si une tournée est clôturée avant republication → coût M07 non calculable → facture M08 en rapprochement_manuel_requis (filet aval)
```

```gherkin
# Source : §09 fn_create_prestataire_province — tranché Val 2026-06-07 floue #4 (tolérance assumée, inverse reco)
# Couche : db
# Priorité : P1-critique

Scénario : creation_province_active_sans_grille_toleree
  Étant donné un ops_savr qui appelle fn_create_prestataire_province("TransExpress Lyon", siret, "Lyon")
  Alors le prestataire est créé directement statut='actif' SANS grille tarifaire (écart conscient documenté §09)
  Et trg_prestataire_grille_obligatoire ne se déclenche pas (INSERT, scope AFTER UPDATE en_onboarding→actif)
  Et le dispatch M02 vers ce prestataire fonctionne immédiatement
  Et une tournée clôturée avant création de grille → coût NULL → M08 rapprochement_manuel_requis (filet aval testé M07/M08)
```

```gherkin
# Source : M06 W5 — tranché Val 2026-06-07 floue #3
# Couche : api
# Priorité : P2-important

Scénario : changement_prestataire_cible_statuts_autorises
  Étant donné un chauffeur actif chez Strike
  Quand l'Admin lance W5 vers un prestataire cible statut='en_onboarding'
  Alors la migration passe (préparation de flotte autorisée)
  Quand il lance W5 vers un prestataire cible statut='suspendu' ou 'archive'
  Alors l'EF rejette 400, le chauffeur reste chez Strike
```

```gherkin
# Source : §06/M06 E2 "Archiver maintenant" (Q6) + §05 R6.4
# Couche : api
# Priorité : P2-important

Scénario : archiver_maintenant_accelere_J30
  Étant donné un prestataire statut='suspendu'
  Quand un Admin TMS clique "Archiver maintenant" et confirme
  Alors statut='archive' immédiatement (sans attendre J+30)
  Et les users_tms associés sont soft-deleted
  Et un audit_log action='PRESTATAIRE_ARCHIVE_MANUEL' est écrit
```

```gherkin
# Source : §08 États (grille brouillon→actif→expire)
# Couche : db
# Priorité : P2-important

Scénario : grille_brouillon_non_utilisable_par_calcul
  Étant donné une grille statut='brouillon' sur (strike, camion_7t)
  Quand R2 calcul coût cherche une grille active à la clôture d'une tournée
  Alors la grille brouillon est ignorée (seul statut='actif' est utilisable)
```

```gherkin
# Source : §04 trg_grille_anti_expiration_orpheline
# Couche : db
# Priorité : P1-critique

Scénario : expiration_derniere_grille_sans_successeur_refusee
  Étant donné l'unique grille active du couple (strike, camion_7t)
  Quand un Admin TMS tente de set date_fin_validite NOT NULL OU statut='archive' sans grille successeur publiée
  Alors le trigger trg_grille_anti_expiration_orpheline lève une EXCEPTION
  Et la grille reste active
```

```gherkin
# Source : §04 trg_grille_anti_expiration (avec successeur)
# Couche : db
# Priorité : P2-important

Scénario : cloture_grille_avec_successeur_autorisee
  Étant donné une grille active (strike, camion_7t) jusqu'à NULL et une grille successeur active publiée à partir de demain
  Quand un Admin TMS clôture la grille courante (date_fin_validite=today)
  Alors la clôture réussit (successeur couvre la période suivante) et statut='expire'
```

```gherkin
# Source : §06/M06 E4 (archivage véhicule soft delete)
# Couche : db
# Priorité : P3-nominal

Scénario : archivage_vehicule_soft_delete
  Étant donné un véhicule actif
  Quand un Ops Savr l'archive
  Alors deleted_at = now() et statut = 'archive'
  Et le véhicule n'apparaît plus dans la liste des plaques actives (libère la plaque)
```

```gherkin
# Source : §06/M06 EC11 (contact facturation désynchronisé)
# Couche : api
# Priorité : P3-nominal

Scénario : contact_facturation_ne_suit_pas_operationnel
  Étant donné un prestataire créé avec toggle "Identique" (contact_facturation = copie physique du contact_operationnel)
  Quand un Admin TMS modifie uniquement le contact_operationnel
  Alors le contact_facturation reste inchangé (copie physique, pas de propagation automatique)
```

---

## Catégorie 6 — Cross-schema (Plateforme ↔ TMS)

```gherkin
# Source : §09 prestataires_read_cross_domain
# Couche : db
# Priorité : P1-critique

Scénario : admin_savr_plateforme_lit_prestataires
  Étant donné un admin_savr connecté côté Plateforme (app_domain='plateforme')
  Quand il lit shared.prestataires
  Alors la lecture est autorisée (policy cross-domain : plateforme + admin_savr/ops_savr)
```

```gherkin
# Source : §09 prestataires_admin_tms_write (deny écriture cross-domain)
# Couche : db
# Priorité : P1-critique

Scénario : admin_savr_ne_modifie_pas_prestataires
  Étant donné un admin_savr connecté côté Plateforme
  Quand il tente un INSERT/UPDATE sur shared.prestataires
  Alors l'opération est refusée (écriture = TMS app_domain uniquement, admin_tms)
```

```gherkin
# Source : §09 prestataires_manager_self
# Couche : db
# Priorité : P1-critique

Scénario : manager_prestataire_voit_uniquement_sa_ligne
  Étant donné un manager_prestataire de strike (app_domain='tms')
  Quand il lit shared.prestataires
  Alors seule la ligne de strike est retournée (policy prestataires_manager_self)
```

```gherkin
# Source : §04 W7 vue cross-schema plateforme.v_tms_types_vehicules_categories
# Couche : db
# Priorité : P2-important

Scénario : plateforme_lit_categorie_plateforme_via_vue
  Étant donné un Ops Savr côté Plateforme et un type_vehicule "camion_7t" categorie_plateforme="poids_lourd"
  Quand la Plateforme interroge plateforme.v_tms_types_vehicules_categories
  Alors elle obtient categorie_plateforme="poids_lourd" pour ce type (mapping compatibilité véhicule↔lieu)
```

---

## Scénarios hors scope (à générer en V1.1)

- **Catégorie 7 — Migration** : seed manuel MTS-1 (D7, ~30 prestataires saisis via UI). Réconciliation traitée par la skill `cdc-migration-data` (`04 - Migration/05 - Checks reconciliation.md`), pas de check de réconciliation automatisé dans M06 V1 (pas d'import CSV / SQL dump).
- **Alertes échéances documentaires** (permis, CNI, assurance) : retirées V1 (D6), aucun scénario.
- **Self-service partiel chauffeur** (UPDATE telephone sur `tms.chauffeurs`) : marqué V1.1 dans §09, hors périmètre M06 V1.
- **`tms.merger_type_vehicule()`** (fusion de types) : non testé ici (workflow Admin/Ops, à couvrir avec M13).

---

## Specs floues remontées — TRANCHÉES Val 2026-06-07 + PROPAGÉES (M06+§05+§09)

> **Décisions** : **#1** = tournées actives OU collectes `attribuee_en_attente_acceptation`/`acceptee` du prestataire, `a_attribuer` exclu (scénario `fin_contrat_bloquee_si_collecte_dispatch_en_cours` ajouté). **#2** = grille expirée **TOLÉRÉE** à la réactivation (inverse reco) — trigger restreint à `en_onboarding→actif`, bandeau E2, filet aval M07/M08 (scénario `reactivation_grille_expiree_toleree`). **#3** = cible W5 `actif` OU `en_onboarding`, rejet 400 sinon (scénario `changement_prestataire_cible_statuts_autorises`). **#4 BLOQUANT** = **TOLÉRANCE ASSUMÉE** (inverse reco) — province créée `actif` sans grille, trigger inchangé AFTER UPDATE, écart conscient §09, ne pas re-proposer AFTER INSERT (scénario `creation_province_active_sans_grille_toleree`). Analyse d'origine conservée ci-dessous pour trace.

1. **Statuts bloquants E8 vs R6.4 — incohérence de granularité.** M06 §4 E8 Bloc 1 liste `planifiee, acceptee, en_cours, a_attribuer` ; or `a_attribuer` est un `statut_dispatch` (collectes_tms) tandis que les trois autres sont des statuts `tournees`. R6.4 ne mentionne que les statuts tournée (`planifiee/acceptee/en_cours`). **À trancher** : la requête COUNT du blocage porte-t-elle sur `tms.tournees.statut` ET `tms.collectes_tms.statut_dispatch='a_attribuer'`, ou seulement sur les tournées ? Impacte le scénario `fin_contrat_bloquee_si_tournee_active`.

2. **Réactivation prestataire dont la grille a expiré pendant la suspension.** EC10 + R6.4 : la réactivation `suspendu→actif` déclenche `trg_prestataire_grille_obligatoire`. Si la grille unique a expiré (date_fin_validite atteinte) pendant les 30 jours de suspension, la réactivation échoue. **À trancher** : comportement attendu (blocage avec message "publier une grille d'abord" ? réactivation autorisée avec grille expirée tolérée ?). Le scénario `reactivation_prestataire_pendant_suspension` suppose une grille toujours active.

3. **W5 changement de prestataire vers un prestataire non actif.** Le workflow ne précise pas si le prestataire cible doit être `statut='actif'` pour recevoir le chauffeur migré. **À trancher** : autoriser la migration vers un prestataire `en_onboarding`/`suspendu` ou la restreindre aux `actif` ?

4. **Création province (`fn_create_prestataire_province`) crée en `statut='actif'` sans grille — trou d'invariant.** §09 montre la fonction insérant directement `statut='actif'`, ce qui contredit R_M06.X (prestataire actif ⇒ grille active obligatoire). **Aggravant détecté à la vérification** : `trg_prestataire_grille_obligatoire` est défini **AFTER UPDATE** sur `shared.prestataires` (transition `*→actif`) — il ne se déclenche **pas** sur un INSERT direct en `statut='actif'`. Donc la création province (et tout seed migration INSERT actif) **contourne silencieusement** l'invariant grille obligatoire. **À trancher** : (a) la fonction crée en `en_onboarding` puis activation via UPDATE (déclenche le trigger), ou (b) le trigger est étendu à `AFTER INSERT OR UPDATE`, ou (c) tolérance assumée (province sans grille régularisée a posteriori). Bloquant : impacte l'intégrité du calcul coût M07.

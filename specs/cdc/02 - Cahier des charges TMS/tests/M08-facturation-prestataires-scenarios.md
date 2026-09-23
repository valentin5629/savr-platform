# Scénarios de test — M08 Facturation prestataires

**Source CDC** : §06/M08 + §05 R3.1-3.8 / R6.3 + §04 `factures_prestataires` (addendum §11) + §09 RLS section 12
**Généré le** : 2026-06-06

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests du module M08.
> Pour chaque scénario :
> - Couche `db` → test pgTAP dans `supabase/tests/`
> - Couche `api` → test Vitest dans `packages/tms/tests/api/`
> - Couche `ui` → test Playwright dans `packages/tms/tests/e2e/`
> Les tests P1-critique sont bloquants CI. P2/P3 non-bloquants V1.
> Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.

> **Périmètre API** : M08 est **100% interne TMS V1** (§12 + §13). Aucun endpoint E1-E6 / S1-S11. La catégorie 6 (cross-app Plateforme↔TMS) est donc **vide et justifiée** ci-dessous ; le seul couplage inter-schéma (lecture `tms.tournees.cout_final_ht` + verrouillage M07) est testé en catégorie 5.

---

## Résumé de couverture

| Catégorie | Nb scénarios | Couverture |
|-----------|-------------|------------|
| 1. Happy path | 9 | W1, W2, W3, W5, W6, W7, W8, W9, W10 |
| 2. Cas limites métier | 6 | Zéro tolérance (R_M08.1), seuil 100€ (R_M08.3), motif ≥30, bornes période, R_M08.7 |
| 3. Cas d'erreur | 10 | EC1/EC2/EC4/EC8/EC9/EC10/EC14/EC16/EC20, R_M08.9, R_M08.10 |
| 4. Isolation RLS | 9 | manager / ops_savr / admin_tms, colonnes W9 admin-only (trigger), contestation `valide` Ops, `regle` immuable |
| 5. Idempotence & états | 11 | R_M08.4, R_M08.6, R3.8, EC17, EC19, transitions interdites, flag `conteste_apres_validation` |
| 6. Cross-app | 0 | N/A — M08 interne TMS (couplage M07 testé en cat. 5) |
| 7. Migration | 1 | R_§13.2 exclusion `migration_test` du flux Pennylane |
| **TOTAL** | **46** | |

**4 specs floues tranchées par Val 2026-06-06 + propagées dans le CDC (M08 + §05 + §09).** Voir section finale.

---

## Catégorie 1 — Happy path

```gherkin
# Source : §06/M08 W1 + W3 / R_M08.1 / R3.3
# Couche : api + db
# Priorité : P1-critique
Scénario : upload_manager_match_exact_auto_validee
  Étant donné un prestataire "Strike" actif avec 3 tournées "terminee" sur juin 2026, cout_final_ht non NULL et non verrouillées, totalisant 1 250,00 € HT
  Et un manager_prestataire Strike connecté sur M03 E10
  Quand il uploade une facture PDF numéro "F-2026-06" période 2026-06-01 → 2026-06-30 montant_ht_prestataire = 1 250,00 €
  Alors la facture est créée statut_rapprochement = 'en_attente' puis le trigger trg_m08_rapprocher la passe à 'valide' (auto-validation match exact)
  Et les 3 tournées passent cout_final_verrouille = true avec verrouillee_par_facture_id = facture.id
  Et un audit_log action 'M08_FACTURE_AUTO_VALIDEE' acteur=système est inséré
  Et la notification N1 (Ops+Admin informative) et l'email prestataire 'notif_facture_validee' sont émis
```

```gherkin
# Source : §06/M08 W2 + E3
# Couche : api + ui
# Priorité : P1-critique
Scénario : upload_ops_province_match_exact
  Étant donné un prestataire province "Transports Sud" sans portail M03
  Et une Ops Savr connectée sur E3
  Quand elle sélectionne le prestataire, uploade le PDF, complète les champs OCR required et soumet une facture montant_ht_prestataire = montant_ht_calcule_tms
  Alors la facture est INSERT avec source_upload = 'ops_manuel', uploade_par_user_id = ops_user_id
  Et le rapprochement W3 passe la facture à 'valide'
  Et Ops est redirigée vers E2 détail
```

```gherkin
# Source : §06/M08 W3 / R3.3
# Couche : db
# Priorité : P1-critique
Scénario : upload_ecart_detecte
  Étant donné des tournées totalisant 1 250,00 € HT pour le prestataire sur la période
  Quand une facture montant_ht_prestataire = 1 300,00 € est uploadée
  Alors statut_rapprochement = 'ecart_detecte'
  Et ecart_ht (generated column) = 50,00 €
  Et la notification N3 (Ops+Admin) et l'alerte M11 'm08_facture_ecart_detecte' (warning) sont émises
  Et aucune tournée n'est verrouillée (cout_final_verrouille reste false)
```

```gherkin
# Source : §06/M08 W5 / R_M08.3
# Couche : api + db
# Priorité : P1-critique
Scénario : validation_manuelle_ecart_avec_motif
  Étant donné une facture statut 'ecart_detecte' avec ecart_ht = 50,00 €
  Et une Ops Savr connectée sur E2
  Quand elle clique "Valider manuellement" et saisit motif_validation_ecart de 35 caractères
  Alors statut_rapprochement = 'valide', motif_validation_ecart et valide_at sont renseignés
  Et les tournées sont verrouillées (R_M08.4)
  Et l'acteur est tracé via audit_logs.acteur_user_id (pas de colonne valide_par_user_id)
```

```gherkin
# Source : §06/M08 W6 / E6 / R_M08.2
# Couche : api + db
# Priorité : P1-critique
Scénario : contestation_facture_ecart_demande_avoir
  Étant donné une facture statut 'ecart_detecte'
  Quand Ops conteste via E6 avec motif ≥ 30 car, type_contestation = "ecart_montant" et option "Demander facture rectificative" cochée
  Alors statut_rapprochement = 'conteste', conteste_apres_validation = false, conteste_par_user_id et conteste_at renseignés
  Et un email N6 est envoyé au contact facturation prestataire avec CTA "émettre avoir + nouvelle facture"
  Et les tournées rattachées restent cout_final_verrouille = false
```

```gherkin
# Source : §06/M08 W7 / R3.5 / D7 / D8
# Couche : api + db
# Priorité : P1-critique
Scénario : upload_rectificative_remplace_par_avoir
  Étant donné une facture "F-2026-06" statut 'conteste'
  Quand le prestataire uploade une nouvelle facture "F-2026-06-R" avec option "Cette facture rectifie une précédente" → "F-2026-06"
  Alors la nouvelle facture est INSERT avec facture_corrigee_id = ancienne.id
  Et le trigger trg_m08_rectification passe l'ancienne à 'remplacee_par_avoir' avec remplacee_par_facture_id = nouvelle.id
  Et un rapprochement auto W3 normal s'exécute sur la nouvelle facture
```

```gherkin
# Source : §06/M08 W8 / E7
# Couche : api
# Priorité : P2-important
Scénario : reglement_facture_validee
  Étant donné une facture statut 'valide'
  Quand Ops saisit date_reglement = aujourd'hui via E7 et enregistre
  Alors statut_rapprochement = 'regle', regle_at et reference_reglement renseignés
  Et l'email N8 'notif_facture_reglee' est envoyé au prestataire
  Et l'acteur est tracé via audit_logs.acteur_user_id
```

```gherkin
# Source : §06/M08 W9 / E8 / R_M08.5 / D11
# Couche : api + db
# Priorité : P1-critique
Scénario : deverrouillage_admin_rejetee_pour_correction
  Étant donné une facture statut 'valide' avec 3 tournées verrouillées
  Et un admin_tms connecté
  Quand il déverrouille via E8 avec motif ≥ 30 car et action_post_deverrouillage = "rejetee_pour_correction"
  Alors statut_rapprochement = 'conteste' + conteste_apres_validation = true + reset valide_at/regle_at
  Et les 3 tournées repassent cout_final_verrouille = false, verrouillee_par_facture_id = NULL
  Et un audit_log critique 'M08_DEVERROUILLAGE_ADMIN' est inséré
  Et l'email N9 prestataire + alerte M11 critique 'alerte_facturation_critique' sont émis
```

```gherkin
# Source : §06/M08 W10 / E9 / R_M08.9
# Couche : api + db
# Priorité : P2-important
Scénario : export_pennylane_csv_puis_marquage
  Étant donné 12 factures statut 'valide' ou 'regle', exporte_pennylane_at IS NULL et migration_test = false
  Quand Ops exporte le CSV puis clique "Marquer comme exportées"
  Alors exporte_pennylane_at = now() sur les 12 factures
  Et un audit_log 'M08_EXPORT_PENNYLANE' est inséré avec payload {facture_ids, nb_factures, total_ht, total_tva, total_ttc, csv_url}
  Et la vue v_m08_exports_pennylane affiche la ligne statut "exporte"
```

---

## Catégorie 2 — Cas limites métier

```gherkin
# Source : §05 R3.3 / R_M08.1 — zéro tolérance, borne
# Couche : db
# Priorité : P1-critique
Scénario : ecart_un_centime_bascule_ecart_detecte
  Étant donné un montant_ht_calcule_tms = 1 250,00 €
  Quand une facture montant_ht_prestataire = 1 250,01 € est rapprochée
  Alors statut_rapprochement = 'ecart_detecte' (aucune tolérance, même 0,01 €)
  Et la facture n'est PAS auto-validée
```

```gherkin
# Source : §06/M08 W5 / R_M08.3 — borne seuil alerte
# Couche : api
# Priorité : P2-important
Scénario : validation_manuelle_ecart_exactement_100_pas_alerte
  Étant donné une facture 'ecart_detecte' avec |ecart_ht| = 100,00 € (= m08.seuil_alerte_validation_manuelle_ht)
  Quand Ops valide manuellement avec motif ≥ 30 car
  Alors statut = 'valide'
  Et AUCUNE notification Admin N13 n'est émise (seuil strict : déclenchement si > 100€, pas =)
```

```gherkin
# Source : §06/M08 W5 / R_M08.3 — dépassement seuil
# Couche : api
# Priorité : P2-important
Scénario : validation_manuelle_ecart_101_alerte_admin
  Étant donné une facture 'ecart_detecte' avec |ecart_ht| = 100,01 €
  Quand Ops valide manuellement avec motif ≥ 30 car
  Alors statut = 'valide'
  Et la notification N13 (in-app + email Admin TMS) "validation manuelle écart" est émise
```

```gherkin
# Source : §06/M08 E6 / W5 / R_M08.3 — motif min 30 car
# Couche : api
# Priorité : P2-important
Scénario : motif_validation_29_caracteres_refuse
  Étant donné une facture 'ecart_detecte'
  Quand Ops soumet une validation manuelle avec motif_validation_ecart de 29 caractères
  Alors le submit est refusé (validation client + server) et statut reste 'ecart_detecte'
  Et un motif de 30 caractères exactement est accepté
```

```gherkin
# Source : §06/M08 E3 étape 4 — borne période vs date facture
# Couche : ui + api
# Priorité : P3-nominal
Scénario : periode_debut_egale_date_facture_moins_3_mois_acceptee
  Étant donné une date_facture = 2026-06-30
  Quand Ops saisit periode_debut = 2026-03-30 (date_facture - 3 mois exact) et periode_fin ≤ date_facture
  Alors la validation passe
  Et une periode_debut = 2026-03-29 (au-delà de 3 mois) est refusée
```

```gherkin
# Source : §06/M08 R_M08.7 / EC11 / D12 — plusieurs factures même mois
# Couche : ui + db
# Priorité : P2-important
Scénario : deuxieme_facture_meme_mois_warning_non_bloquant
  Étant donné un prestataire ayant déjà la facture "F-2026-06" pour juin 2026
  Quand Ops uploade une 2e facture "F-2026-06-bis" même prestataire même mois (numéro différent)
  Alors un warning UI "Ce prestataire a déjà une facture pour ce mois : F-2026-06. Continuer ?" s'affiche
  Et la confirmation permet l'INSERT (UNIQUE porte uniquement sur (prestataire_id, numero_facture))
```

---

## Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : §06/M08 EC1 / R_M08.10 / D3
# Couche : ui
# Priorité : P2-important
Scénario : ocr_champ_required_vide_bloque_submit
  Étant donné un upload où l'OCR n'a pas extrait le numéro de facture
  Quand l'utilisateur tente de soumettre sans renseigner le numéro
  Alors le submit est bloqué (aucun INSERT, pas de brouillon DB)
  Et le champ manquant est signalé visuellement
```

```gherkin
# Source : §06/M08 EC2
# Couche : db
# Priorité : P2-important
Scénario : facture_sans_tournee_sur_periode_ecart_total
  Étant donné un prestataire sans aucune tournée 'terminee' sur la période facturée
  Quand une facture montant_ht_prestataire = 800,00 € est rapprochée
  Alors montant_ht_calcule_tms = 0, ecart_ht = 800,00 €, statut = 'ecart_detecte'
  Et une notification "Aucune tournée TMS trouvée sur la période facturée" est émise
```

```gherkin
# Source : §06/M08 EC4 / R_M08.8 / R3.2
# Couche : db
# Priorité : P1-critique
Scénario : tournee_sans_cout_rapprochement_manuel_requis
  Étant donné une période contenant au moins une tournée 'terminee' avec cout_final_ht IS NULL (grille A Toutes! absente)
  Quand une facture est uploadée et rapprochée
  Alors statut_rapprochement = 'rapprochement_manuel_requis'
  Et la tournée sans coût est exclue du montant_ht_calcule_tms
  Et l'alerte M11 'm08_rapprochement_manuel_requis' (warning) + notification N2 sont émises
```

```gherkin
# Source : §06/M08 EC4 — résolution via Re-rapprocher
# Couche : api + db
# Priorité : P2-important
Scénario : re_rapprocher_apres_saisie_grille_m07
  Étant donné une facture 'rapprochement_manuel_requis'
  Quand Ops saisit la grille M07 manquante puis clique "Re-rapprocher" sur E2
  Alors tms.m08_rapprocher est ré-exécutée
  Et la facture bascule vers 'valide' (si match) ou 'ecart_detecte' (sinon)
```

```gherkin
# Source : §06/M08 EC8 / EC12 / D12 — UNIQUE
# Couche : db
# Priorité : P1-critique
Scénario : numero_facture_duplique_meme_prestataire_refuse
  Étant donné une facture "F-2026-06" existante (deleted_at IS NULL) pour le prestataire
  Quand un INSERT d'une facture "F-2026-06" même prestataire_id est tenté
  Alors la contrainte UNIQUE (prestataire_id, numero_facture) refuse l'INSERT
  Et le même numéro pour un AUTRE prestataire est accepté
```

```gherkin
# Source : §06/M08 EC14 — CHECK montant > 0
# Couche : db
# Priorité : P1-critique
Scénario : montant_ht_zero_refuse
  Quand un INSERT factures_prestataires avec montant_ht_prestataire = 0 est tenté
  Alors la contrainte CHECK (montant_ht_prestataire > 0) refuse l'INSERT
```

```gherkin
# Source : §06/M08 EC20 — CHECK date
# Couche : db
# Priorité : P2-important
Scénario : date_facture_future_refuse
  Quand un INSERT avec date_facture = CURRENT_DATE + 1 est tenté
  Alors la contrainte CHECK (date_facture ≤ CURRENT_DATE) refuse l'INSERT
```

```gherkin
# Source : §06/M08 EC10 — période incohérente
# Couche : db + ui
# Priorité : P2-important
Scénario : periode_debut_superieure_a_fin_refuse
  Quand un INSERT avec periode_debut > periode_fin est tenté
  Alors la validation client ET server-side refusent l'opération
```

```gherkin
# Source : §06/M08 EC9
# Couche : ui + api
# Priorité : P3-nominal
Scénario : pdf_corrompu_ocr_echec_pas_insert
  Étant donné un PDF corrompu / illisible
  Quand l'OCR Mistral retourne une erreur
  Alors l'upload est bloqué avec message "Le PDF n'a pas pu être lu"
  Et aucun INSERT factures_prestataires n'est effectué
```

```gherkin
# Source : §06/M08 R_M08.9 / E9
# Couche : db
# Priorité : P1-critique
Scénario : export_pennylane_bloque_si_facture_non_validee
  Étant donné des factures en statut 'en_attente', 'ecart_detecte', 'rapprochement_manuel_requis', 'conteste', 'remplacee_par_avoir'
  Quand la liste E9 "Factures à exporter" est calculée
  Alors aucune de ces factures n'apparaît (seuls 'valide' et 'regle' sont exportables)
```

```gherkin
# Source : §06/M08 EC16
# Couche : api
# Priorité : P2-important
Scénario : manager_rectification_sans_contestation_interdite
  Étant donné une facture statut 'valide' (ou 'regle')
  Quand un manager_prestataire tente d'uploader une rectificative la référençant via facture_corrigee_id
  Alors l'opération est refusée côté M03 (seul Admin peut déverrouiller W9 au préalable)
```

---

## Catégorie 4 — Isolation données (RLS)

```gherkin
# Source : §09 section 12 / factures_manager_read
# Couche : db
# Priorité : P1-critique
Scénario : manager_strike_ne_voit_pas_factures_marathon
  Étant donné un manager_prestataire rattaché à "Strike"
  Quand il SELECT factures_prestataires
  Alors il ne voit que les factures où prestataire_id = auth.user_prestataire_id()
  Et aucune facture du prestataire "Marathon" n'est retournée
```

```gherkin
# Source : §09 section 12 / factures_manager_insert
# Couche : db
# Priorité : P1-critique
Scénario : manager_insert_uniquement_son_prestataire_en_attente
  Étant donné un manager_prestataire Strike
  Quand il tente un INSERT avec prestataire_id = Marathon OU statut_rapprochement != 'en_attente' OU source_upload != 'manager_m03'
  Alors la policy factures_manager_insert (WITH CHECK) refuse l'INSERT
  Et un INSERT conforme (son prestataire, en_attente, manager_m03) est accepté
```

```gherkin
# Source : §09 section 12 — immuabilité manager / D7
# Couche : db
# Priorité : P1-critique
Scénario : manager_aucun_update_autorise
  Étant donné une facture du prestataire du manager connecté
  Quand le manager tente un UPDATE (ex: modifier montant_ht_prestataire)
  Alors l'opération est refusée (aucune policy UPDATE pour manager_prestataire + trigger BEFORE UPDATE de garde)
```

```gherkin
# Source : §09 section 12 / factures_staff_all
# Couche : db
# Priorité : P2-important
Scénario : ops_savr_voit_toutes_factures
  Étant donné des factures de plusieurs prestataires
  Quand une Ops Savr (auth.user_is_staff() = true) SELECT factures_prestataires
  Alors toutes les factures sont visibles, tous prestataires confondus
```

```gherkin
# Source : §09 section 12 / R_M08.5(b) / M08 §11.14 — colonnes W9 admin-only (TRIGGER)
# Couche : db
# Priorité : P1-critique
# Décision Val 2026-06-06 : enforcement au TRIGGER (RLS row-level ne peut pas cloisonner les colonnes)
Scénario : ops_savr_ne_peut_pas_ecrire_colonnes_w9
  Étant donné une facture statut 'valide'
  Et une Ops Savr (sans rôle admin_tms)
  Quand elle tente un UPDATE modifiant action_deverrouillage / motif_deverrouillage / deverrouillee_at
  Alors le trigger trg_factures_deverrouillage_admin_only lève une EXCEPTION (RAISE), pas un deny RLS
  Et le test cible le RAISE du trigger (la policy factures_staff_all permissive autoriserait sinon l'UPDATE)
```

```gherkin
# Source : §06/M08 W6 / R_M08.5(a) — Ops conteste une facture valide (arbitrage Val 2026-06-06)
# Couche : db
# Priorité : P1-critique
Scénario : ops_savr_conteste_facture_valide_deverrouille_tournees
  Étant donné une facture statut 'valide' avec 3 tournées verrouillées
  Et une Ops Savr connectée
  Quand elle conteste via W6 avec motif_contestation ≥ 30 car
  Alors statut_rapprochement = 'conteste' + conteste_apres_validation = true
  Et le trigger trg_m08_deverrouiller reset les 3 tournées cout_final_verrouille = false + verrouillee_par_facture_id = NULL
  Et aucune colonne W9 (action_deverrouillage/motif_deverrouillage) n'est touchée → trigger admin-only non déclenché
```

```gherkin
# Source : §06/M08 R_M08.6 / §7 — Ops ne peut pas contester une facture reglee
# Couche : db
# Priorité : P1-critique
Scénario : ops_savr_ne_peut_pas_contester_facture_reglee
  Étant donné une facture statut 'regle'
  Et une Ops Savr
  Quand elle tente de la contester (W6)
  Alors l'opération est refusée (regle immuable R_M08.6 ; seul W9 Admin peut la sortir de regle)
```

```gherkin
# Source : §09 section 12 / factures_admin_deverrouillage
# Couche : db
# Priorité : P1-critique
Scénario : admin_tms_deverrouille_avec_motif_valide
  Étant donné un admin_tms et une facture 'valide'
  Quand il UPDATE avec action_deverrouillage renseigné et motif_deverrouillage ≥ 30 car
  Alors la policy factures_admin_deverrouillage (USING + WITH CHECK) autorise l'opération
```

```gherkin
# Source : §09 section 12 / R_M08.5 — garde motif
# Couche : db
# Priorité : P1-critique
Scénario : deverrouillage_motif_moins_30_car_refuse
  Étant donné un admin_tms
  Quand il tente un déverrouillage avec motif_deverrouillage de 29 caractères (ou NULL)
  Alors la policy WITH CHECK (char_length >= 30) refuse l'UPDATE
```

---

## Catégorie 5 — Idempotence et états

```gherkin
# Source : §06/M08 R_M08.4 / R3.6 / trg_m08_verrouiller
# Couche : db
# Priorité : P1-critique
Scénario : verrouillage_tournees_a_la_validation
  Étant donné une facture qui passe à statut 'valide' couvrant 3 tournées 'terminee' non verrouillées de la période
  Quand le trigger trg_m08_verrouiller (BEFORE UPDATE statut 'valide') s'exécute
  Alors les 3 tournées passent cout_final_verrouille = true + verrouillee_par_facture_id = facture.id
  Et le périmètre est l'agrégat période uniquement (pas de ligne-à-ligne)
```

```gherkin
# Source : §06/M08 R3.8 / R3.2 — non double-comptage par verrouillage
# Couche : db
# Priorité : P1-critique
Scénario : rapprochement_exclut_tournees_deja_verrouillees
  Étant donné 2 tournées déjà verrouillées (facture antérieure) + 1 tournée nouvelle non verrouillée à 400,00 € dans une période chevauchante
  Quand une nouvelle facture montant_ht_prestataire = 400,00 € est rapprochée
  Alors montant_ht_calcule_tms = 400,00 € (seules les tournées cout_final_verrouille = false sont sommées)
  Et la facture est 'valide' sans double comptage des tournées déjà payées
```

```gherkin
# Source : §06/M08 R_M08.6 / §7 transitions interdites
# Couche : db
# Priorité : P1-critique
Scénario : facture_reglee_immuable_sauf_w9
  Étant donné une facture statut 'regle'
  Quand Ops tente de la contester (W6) ou de la ré-éditer
  Alors l'opération est refusée
  Et seul un admin_tms via W9 (déverrouillage) peut la sortir de 'regle'
```

```gherkin
# Source : §06/M08 §7 transitions interdites
# Couche : db
# Priorité : P1-critique
Scénario : transition_en_attente_vers_regle_direct_interdite
  Étant donné une facture statut 'en_attente'
  Quand un UPDATE statut_rapprochement = 'regle' direct est tenté
  Alors l'opération est refusée (doit passer par 'valide')
```

```gherkin
# Source : §06/M08 §11.13 / §11.1 flag redéfini (arbitrage Val 2026-06-06)
# Couche : db
# Priorité : P1-critique
Scénario : flag_conteste_apres_validation_reflete_etat_valide_avant_contestation
  Étant donné une contestation W6 Ops sur statut 'ecart_detecte' (jamais validée)
  Alors conteste_apres_validation = false
  Et une contestation W6 Ops sur statut 'valide' → conteste_apres_validation = true
  Et un déverrouillage W9 Admin d'une 'valide' action "rejetee_pour_correction" → conteste_apres_validation = true
  Et toute transition 'valide'/'regle' → 'conteste' exige conteste_apres_validation = true (pgTAP §11.13), quel que soit l'acteur (W6 Ops ou W9 Admin)
```

```gherkin
# Source : §06/M08 W9 / R_M08.5 / m08_deverrouiller_tournees
# Couche : db
# Priorité : P1-critique
Scénario : deverrouillage_reset_cout_final_verrouille
  Étant donné une facture 'valide' avec 3 tournées verrouillées
  Quand le trigger trg_m08_deverrouiller s'exécute (W9)
  Alors les 3 tournées repassent cout_final_verrouille = false + verrouillee_par_facture_id = NULL
```

```gherkin
# Source : §06/M08 EC17 — cross-schema M07 (couplage interne TMS)
# Couche : db
# Priorité : P1-critique
Scénario : m07_ajustement_refuse_si_tournee_verrouillee
  Étant donné une tournée avec cout_final_verrouille = true (rapprochée à une facture validée)
  Quand M07 tente un ajustement du cout_final_ht (D11 M07)
  Alors l'opération est refusée tant que la facture n'est pas déverrouillée (W9 Admin)
```

```gherkin
# Source : §06/M08 EC19 / W9 / B2
# Couche : db
# Priorité : P2-important
Scénario : deverrouillage_apres_export_pennylane_insere_compensation
  Étant donné une facture déjà marquée exporte_pennylane_at IS NOT NULL (audit_log 'M08_EXPORT_PENNYLANE' existant)
  Quand un admin_tms la déverrouille via W9
  Alors un audit_log 'M08_EXPORT_PENNYLANE_ANNULEE' est inséré avec payload {facture_id, motif_deverrouillage, export_origine_audit_id}
  Et une alerte M11 critique "export Pennylane à annuler manuellement" est émise
```

```gherkin
# Source : §06/M08 EC7 — blocage déverrouillage si rectificative en cours
# Couche : api
# Priorité : P2-important
Scénario : deverrouillage_bloque_si_autre_facture_en_traitement
  Étant donné une facture 'valide' et une autre facture déjà uploadée pour la même période en traitement
  Quand un admin_tms tente de déverrouiller la première
  Alors l'opération est bloquée avec message "Une autre facture :numero est en cours de traitement sur cette période"
```

```gherkin
# Source : §06/M08 §7 — statut terminal
# Couche : db
# Priorité : P3-nominal
Scénario : statut_remplacee_par_avoir_terminal
  Étant donné une facture 'remplacee_par_avoir'
  Quand une transition d'état est tentée (hors lecture)
  Alors aucune transition n'est autorisée (statut terminal)
```

```gherkin
# Source : §06/M08 W3 / §11.6 — idempotence re-rapprochement
# Couche : db
# Priorité : P2-important
# ⚠ Voir spec floue #3 (condition d'exécution de Re-rapprocher sur facture déjà 'valide')
Scénario : re_rapprocher_facture_deja_validee_sans_effet_de_bord
  Étant donné une facture 'valide' avec tournées déjà verrouillées
  Quand tms.m08_rapprocher est ré-appelée sur cette facture
  Alors aucune tournée déjà verrouillée n'est recomptée (filtre cout_final_verrouille = false)
  Et le montant_ht_calcule_tms ne double pas
```

---

## Catégorie 6 — Scénarios cross-app (Plateforme ↔ TMS)

**Aucun scénario.** M08 est **100% interne TMS V1** (§12 + §13 : « Pas d'endpoint API V1, M08 100% interne TMS »). Aucun endpoint E1-E6 ni S1-S11 n'est impliqué. La validation HMAC / `X-API-Version` / Idempotency-Key / webhook entité inconnue ne s'appliquent pas à ce module.

Le seul couplage inter-schéma est la lecture de `tms.tournees.cout_final_ht` (source M07) et le verrouillage `cout_final_verrouille`, testés en **catégorie 5** (`verrouillage_tournees_a_la_validation`, `m07_ajustement_refuse_si_tournee_verrouillee`, `deverrouillage_reset_cout_final_verrouille`).

V2 (hors scope V1) : endpoint Pennylane push statut règlement — à tester lors de la spec V2.

---

## Catégorie 7 — Scénarios de migration

La réconciliation de migration MTS-1 → Supabase est **hors scope des tests M08** (couverte par `04 - Migration/05 - Checks reconciliation.md`, runtime ingress). Un seul comportement métier M08 dépend de la migration et doit être testé ici :

```gherkin
# Source : §06/M08 E9 / R_§13.2 — filtre migration_test
# Couche : db
# Priorité : P2-important
Scénario : facture_migration_test_exclue_du_flux_pennylane
  Étant donné une facture 'valide' avec migration_test = true (créée pendant migration_mode_active)
  Quand la liste E9 "Factures à exporter" est calculée
  Alors la facture n'apparaît PAS (filtre SQL migration_test = false)
  Et elle reste visible dans E1-E8 avec badge "Test migration"
```

---

## Scénarios hors scope (à générer en V1.1)

- Rapprochement ligne-à-ligne (table `factures_prestataires_lignes` supprimée V1, revue sobriété §04 A5).
- Workflow escalade automatique contestation > 60j (EC18 — V1 = monitoring manuel via alerte M11).
- Avoir sans facture de remplacement, relance automatique (EC15 — V1 = suivi manuel Ops).
- Cron rappels upload J+5/J+15 (W11 supprimé V1 — widget E0 manuel).
- Double devise / TVA intracommunautaire (Q6/Q7 §15 — EUR + TVA FR V1).
- Push API Pennylane V2 (export + règlement automatiques).

---

## ✅ Specs floues tranchées par Val (2026-06-06) — propagées dans le CDC

### #1 — Déverrouillage admin-only : enforcement au TRIGGER (pas RLS)

**Contexte** : la policy `factures_staff_all` (`FOR ALL USING auth.user_is_staff()`, qui inclut ops_savr) est permissive/additive → elle autorise déjà ops_savr à UPDATE toute colonne. La RLS PostgreSQL étant **row-level**, elle ne peut pas réserver les colonnes W9 à l'Admin, et le rôle `admin_tms` vit dans le JWT (rôle Postgres unique `authenticated`) → un `REVOKE UPDATE (colonne)` ne discriminerait pas.

**Décision Val** : trigger `BEFORE UPDATE` **`trg_factures_deverrouillage_admin_only`** (M08 §11.14) qui `RAISE EXCEPTION` si un non-`admin_tms` modifie `action_deverrouillage`/`motif_deverrouillage`/`deverrouillee_at`. Le commentaire §09 est corrigé (enforcement au trigger, pas RLS). Le test pgTAP cible le RAISE du trigger. Scénario : `ops_savr_ne_peut_pas_ecrire_colonnes_w9` (cat.4).

### #2 — Contestation d'une facture `valide` : autorisée à Ops via W6 (déverrouille les tournées)

**Contexte** : l'auto-validation W3 zéro tolérance ne laisse aucune revue humaine avant verrouillage. Ops doit pouvoir rejeter une auto-validation erronée sans escalade Admin systématique.

**Décision Val** : `Contester` (W6) ouvert à Ops/Admin depuis `ecart_detecte`, `rapprochement_manuel_requis` ET `valide`. Si la facture était `valide`, la contestation **déverrouille les tournées** (`trg_m08_deverrouiller` → `cout_final_verrouille = false`) + `conteste_apres_validation = true`. **`regle` reste immuable** (R_M08.6, W9 Admin only). Le flag `conteste_apres_validation` est redéfini : `true` ⟺ la facture était `valide` avant contestation (W6 Ops OU W9 Admin) — cohérent pgTAP §11.13. Conséquence assumée : le déverrouillage de tournées n'est plus strictement admin-only (R_M08.5 amendé), seules les **colonnes W9** le restent (#1). Propagé : M08 (E1/E2/E6/W6/§7/R_M08.5/R_M08.6/§11.1/§11.11/§11.13), §05 R3.5/R3.7, §09. Scénarios : `ops_savr_conteste_facture_valide_deverrouille_tournees`, `ops_savr_ne_peut_pas_contester_facture_reglee` (cat.4).

### #3 — Bouton « Re-rapprocher » : restreint à `rapprochement_manuel_requis`

**Décision Val** : le bouton `Re-rapprocher` (E2, EC4) est disponible/exécutable **uniquement si `statut_rapprochement = 'rapprochement_manuel_requis'`** (garde server-side). Pas de re-rapprochement sur `valide`/`ecart_detecte`. Propagé M08 EC4.

### #4 — EC13 supprimé (cas impossible)

**Décision Val** : EC13 (facture 0 € → match exact → `valide`) décrivait un cas inatteignable, le CHECK `montant_ht_prestataire > 0` (EC14) refusant toute facture à 0 € à l'INSERT. EC13 retiré de M08 §6.

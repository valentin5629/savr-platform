# Scénarios de test — M03 Portail prestataire self-service

**Source CDC** : §06/M03 + §05 R_M03.1 à R_M03.12 + §04 (`collectes_tms`, `tournees`, `chauffeurs`, `vehicules`, `types_vehicules`, `factures_prestataires`) + §09 RLS TMS
**Généré le** : 2026-06-05
**Statut** : À implémenter par Claude Code

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests du module M03.
> Pour chaque scénario :
>
> - Couche `db` → écrire un test pgTAP dans `supabase/tests/`
> - Couche `api` → écrire un test Vitest dans `packages/tms/tests/api/`
> - Couche `ui` → écrire un test Playwright dans `packages/tms/tests/e2e/`
>   Les tests P1-critique sont bloquants CI. Les tests P2 et P3 sont non-bloquants V1.
>   Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.
>   **Dédup événements entrants** : la clé d'idempotence webhook est `body.event_id` (pas de header `Idempotency-Key`, aligné M01/M02).

---

## Résumé de couverture

| Catégorie                   | Nb scénarios | Couverture estimée                                                                                                                                                                         |
| --------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — Happy path              | 11           | W1 accept, W2 refus, W4 assignation, W7 chauffeur, W8 véhicule+type, W10 facture, W11 drill-down (rémunération vacations + forfait_km), contestation email, W12 login, notif tous managers |
| 2 — Cas limites métier      | 8            | contrôle d'accès, exception vélo cargo, équipier nb=2, match exact facture, urgence UI, magic link 30 min, OCR, permis expiré                                                              |
| 3 — Cas d'erreur métier     | 8            | motif autre vide, archivage bloqué, chevauchement chauffeur/véhicule, plaque/chauffeur manquants, montants incohérents, numéro doublon, écart                                              |
| 4 — Isolation RLS           | 7            | cross-prestataire collectes/tournées/chauffeurs/véhicules/factures, INSERT/UPDATE types_vehicules                                                                                          |
| 5 — Idempotence/états       | 9            | lock optimiste accept, 409 reprise Ops, facture immuable, verrou assignation, lock collectes post-facture, dédup E1, restauration chauffeur, annulation, alerte oubli état courant         |
| 6 — Cross-app (contrat API) | 6            | S1 accept, S2 refus, S7 plaque+chauffeur_nom, E1 controle_acces_requis, E6 annulation, HMAC/version                                                                                        |
| 7 — Migration               | 0            | Hors scope V1 (M03 = portail, aucun check réconciliation propre — voir note fin)                                                                                                           |
| **TOTAL**                   | **57**       |                                                                                                                                                                                            |

**Priorités** : P1-critique = 24 · P2-important = 21 · P3-nominal = 12

**4 specs floues tranchées 2026-06-05** (QO#2 termes calcul / QO#4 email contestation / QO#6 tous managers / W6-vs-R_M03.12 cohérence) — voir section dédiée en fin de fichier.

---

## Scénarios

### Catégorie 1 — Happy path

```gherkin
# Source : §06/M03 W1 / §05 R_M03.1 / §08 S1
# Couche : api
# Priorité : P1-critique

Scénario : acceptation_collecte_standard_emet_s1
  Étant donné un manager Strike connecté
  Et une collecte COL-2026-04789 attribuée à Strike au statut "attribuee_en_attente_acceptation"
  Quand le manager appelle POST /api/m03/collectes/COL-2026-04789/accept
  Alors collectes_tms.statut_dispatch passe à "acceptee"
  Et date_acceptation = now() et accepted_by = manager_id
  Et le webhook sortant S1 "tms/collecte-acceptee" est émis vers la Plateforme
  Et la collecte apparaît dans le bloc E1 "Tournées à assigner"
```

```gherkin
# Source : §06/M03 W2 / §05 R_M03.3 / §08 S2
# Couche : api
# Priorité : P1-critique

Scénario : refus_collecte_avec_motif_emet_s2
  Étant donné un manager Marathon connecté
  Et une collecte attribuée à Marathon au statut "attribuee_en_attente_acceptation"
  Quand le manager appelle POST /api/m03/collectes/:id/reject avec motif "zone_non_couverte"
  Alors collectes_tms.statut_dispatch passe à "rejetee_par_prestataire"
  Et date_refus, motif_refus et rejected_by sont renseignés
  Et le webhook sortant S2 "tms/collecte-refusee" est émis vers la Plateforme
  Et la collecte repasse "a_attribuer" côté M02 dispatch Ops
```

```gherkin
# Source : §06/M03 W4 / §05 R_M03.4 / §08 S7
# Couche : api
# Priorité : P1-critique

Scénario : assignation_chauffeur_vehicule_passe_en_attente_execution
  Étant donné une collecte Strike au statut "acceptee" rattachée à une tournée sans chauffeur ni véhicule
  Et controle_acces_requis = false et nb_personnes_facturation = 1
  Quand le manager valide l'assignation chauffeur seul via POST /api/m03/tournees/:id/assign
  Alors tournees.chauffeur_id est renseigné
  Et toutes les collectes de la tournée passent statut_dispatch "en_attente_execution"
  Et date_assignation_execution = now()
  Et une notification push M05 est envoyée au chauffeur
```

```gherkin
# Source : §06/M03 W7 / §05 R_M03.7
# Couche : api
# Priorité : P1-critique

Scénario : creation_chauffeur_envoie_magic_link
  Étant donné un manager Strike connecté sur E6
  Quand il crée un chauffeur avec nom + email + téléphone + permis + CNI et toggle "Activer compte M05" ON
  Alors une ligne tms.chauffeurs est créée (prestataire_id = Strike)
  Et un user Supabase Auth est créé sans encrypted_password
  Et un email "Définir mon mot de passe" avec magic link TTL 30 min est envoyé à l'adresse saisie
  Et aucun mot de passe en clair n'est transmis
```

```gherkin
# Source : §06/M03 W8 / §05 R_M03.8
# Couche : api
# Priorité : P2-important

Scénario : creation_vehicule_avec_nouveau_type_utilisable_immediatement
  Étant donné un manager A Toutes! connecté sur E8
  Quand il crée un véhicule plaque "AB-123-CD" et crée un nouveau modèle "12m3 hayon" catégorie "vul"
  Alors une ligne types_vehicules est créée avec valide_ops = false, actif = true, cree_par = manager_id, categorie_plateforme = "vul"
  Et le véhicule est créé immédiatement avec ce type (pas de blocage)
  Et un email est envoyé à Ops Savr + alerte M11 warning "m03_type_vehicule_a_valider"
```

```gherkin
# Source : §06/M03 W10 / §05 R_M03.9 / M08
# Couche : api
# Priorité : P1-critique

Scénario : upload_facture_mensuelle_match_exact_auto_validee
  Étant donné un manager Strike avec des tournées du mois M-1 totalisant 4 500,00 € HT calculés TMS
  Quand il uploade un PDF facture numéro "F-2026-0042" avec montant_ht = 4 500,00 €, période M-1, montants cohérents
  Alors factures_prestataires est INSÉRÉE (statut_rapprochement "en_attente", source_upload "manager_m03")
  Et le trigger trg_m08_rapprocher calcule montant_ht_calcule_tms = 4 500,00 €
  Et le match étant exact au centime, statut_rapprochement passe "valide" (auto-validation, acteur = système)
```

```gherkin
# Source : §06/M03 W11 E9 / §05 R_M03.10
# Couche : ui
# Priorité : P3-nominal

Scénario : drill_down_revenus_tournee
  Étant donné un manager Marathon sur E9 dashboard revenus, période "mois courant"
  Et une tournée payée via formule grille "vacations_paliers", cout_detail = {palier "4-8h", nb_vacations 1, tarif_vacation_base_ht 280}
  Quand il clique la ligne tournée du tableau agrégé
  Alors une modale latérale charge v_m03_revenus_detail(tournee_id)
  Et affiche les termes de rémunération issus de tournees.cout_detail (ex "Palier 4-8h → 1 vacation × 280 € HT = 280 €")
  Et les pesées par flux sont affichées séparément, sans entrer dans le calcul du montant payé (QO#2 2026-06-05)
  Et la facture traiteur côté Plateforme et la marge Savr restent masquées (RLS colonne)
```

```gherkin
# Source : §05 R2.3/R2.5 / §06/M03 E9 W11 / QO#2 2026-06-05
# Couche : ui
# Priorité : P3-nominal

Scénario : drill_down_revenus_formule_forfait_km
  Étant donné une tournée province payée via formule "forfait_km", cout_detail = {forfait_base 90, km 62, km_inclus 50, tarif_km_supp 0.80}
  Quand le manager ouvre le drill-down de cette tournée
  Alors les termes affichés sont "Forfait base 90 € + (62 − 50) km × 0,80 €/km = 99,60 € HT"
  Et aucun terme de poids/pesée n'apparaît dans le calcul du montant
```

```gherkin
# Source : §06/M03 W11 step 4 / E3 Section 6 / QO#4 2026-06-05
# Couche : ui
# Priorité : P3-nominal

Scénario : contestation_tournee_ouvre_email_prerempli
  Étant donné un manager sur une collecte/tournée "realisee"
  Quand il clique "Contester / Contact Ops"
  Alors un email pré-rempli (réf collecte + tournée + montant calculé) s'ouvre vers l'adresse Ops Savr
  Et aucune entité contestation n'est créée en base (pas de formulaire structuré V1)
```

```gherkin
# Source : §06/M03 W12 EA1 / §05 R_M03.1 R_M03.6
# Couche : api
# Priorité : P2-important

Scénario : login_manager_session_30j
  Étant donné un manager avec email + password valides (≥ 8 car)
  Quand il se connecte via EA1
  Alors Supabase Auth vérifie le hash argon2id
  Et une session JWT TTL 30j rolling est créée
  Et il est redirigé vers E1
```

```gherkin
# Source : §06/M03 §2 Cas multi-managers / W1 / QO#6 2026-06-05
# Couche : api
# Priorité : P2-important

Scénario : notif_tous_managers_du_prestataire
  Étant donné un prestataire Strike avec 3 utilisateurs manager_prestataire
  Quand Ops dispatche une collecte à Strike (statut "attribuee_en_attente_acceptation")
  Alors les 3 managers reçoivent la notification push + email
  Et aucun dispatcher unique n'est privilégié (pas de désignation V1)
```

---

### Catégorie 2 — Cas limites métier

```gherkin
# Source : §05 R_M03.4 / §06/M03 E4 W4 / trigger validate_tournee_controle_acces
# Couche : db
# Priorité : P1-critique

Scénario : controle_acces_requis_true_exige_plaque_et_chauffeur
  Étant donné une tournée Strike dont ≥ 1 collecte a controle_acces_requis = true (véhicule motorisé)
  Quand le manager tente de valider l'assignation sans véhicule OU sans chauffeur
  Alors le trigger validate_tournee_controle_acces RAISE EXCEPTION
  Et la transition tournees.statut "planifiee → acceptee" est bloquée
  Et l'UI affiche "Saisir plaque (véhicule) ET chauffeur avant validation"
```

```gherkin
# Source : §05 R_M03.4 / §06/M03 E4 Section 3 exception
# Couche : db
# Priorité : P1-critique

Scénario : exception_velo_cargo_a_toutes_plaque_libre_chauffeur_obligatoire
  Étant donné une tournée dont toutes les collectes sont sur prestataire integration_externe = "everest" avec véhicule type "velo_cargo"
  Et au moins 1 collecte a controle_acces_requis = true
  Quand le manager valide en affectant un chauffeur mais sans plaque
  Alors le trigger autorise la validation (exception vélo cargo sur le critère plaque)
  Et la validation reste bloquée si le chauffeur est absent (nom chauffeur obligatoire dans tous les cas)
```

```gherkin
# Source : §06/M03 E4 Section 5 / W4 step 4
# Couche : api
# Priorité : P2-important

Scénario : equipier_obligatoire_si_nb_personnes_facturation_2
  Étant donné une tournée avec nb_personnes_facturation = 2
  Quand le manager valide l'assignation sans équipier
  Alors la validation est refusée avec message demandant l'affectation d'un équipier
  Et inversement, si nb_personnes_facturation = 1 la section équipier est masquée et non requise
```

```gherkin
# Source : §06/M03 EC8 / M08 D4 zéro tolérance
# Couche : db
# Priorité : P1-critique

Scénario : facture_ecart_un_centime_passe_ecart_detecte
  Étant donné des tournées M-1 totalisant 4 500,00 € HT calculés TMS
  Quand le manager uploade une facture montant_ht = 4 500,01 €
  Alors statut_rapprochement passe "ecart_detecte" (aucune tolérance)
  Et l'alerte N3 Ops + Admin est déclenchée
  Et le manager voit "Votre facture présente un écart avec notre calcul"
```

```gherkin
# Source : §06/M03 W7 step 6 / §05 R_M03.7
# Couche : api
# Priorité : P2-important

Scénario : magic_link_expire_renvoi_par_manager
  Étant donné un chauffeur créé dont le magic link a plus de 30 min
  Quand le chauffeur clique le lien expiré
  Alors il est redirigé avec message "Lien expiré"
  Et le manager peut renvoyer un nouveau lien depuis E5 fiche chauffeur (bouton "Renvoyer lien d'activation")
```

```gherkin
# Source : §06/M03 E1 Bloc 1
# Couche : ui
# Priorité : P3-nominal

Scénario : indicateur_urgence_acceptation
  Étant donné des collectes "attribuee_en_attente_acceptation"
  Quand l'heure_collecte est dans moins de 2h
  Alors l'indicateur d'urgence est rouge
  Et il est orange si l'heure_collecte est entre 2h et 4h
```

```gherkin
# Source : §06/M03 W10 step 2-3 OCR Mistral
# Couche : api
# Priorité : P3-nominal

Scénario : ocr_prerempli_champs_facture
  Étant donné un PDF facture < 10 Mo uploadé
  Quand l'OCR Mistral s'exécute (< 30s)
  Alors numéro, date, période, montants HT/TVA/TTC sont préremplis
  Et le manager doit compléter les champs required avant submit (blocage si incomplet)
```

```gherkin
# Source : §06/M03 E6 Section 2 / EC6
# Couche : api
# Priorité : P3-nominal

Scénario : permis_expire_aucun_controle_v1
  Étant donné un chauffeur avec un permis dont la date d'échéance est dépassée
  Quand le manager enregistre la fiche chauffeur
  Alors aucun contrôle automatique n'est déclenché (V1, alerte échéance reportée V2)
  Et le chauffeur reste utilisable
```

---

### Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : §06/M03 EC4 / W2
# Couche : db
# Priorité : P1-critique

Scénario : refus_motif_autre_sans_texte_libre_rejete
  Étant donné un refus de collecte avec motif = "autre"
  Quand rejected_reason_free_text est NULL
  Alors la contrainte NOT NULL serveur rejette l'opération
  Et l'UI exige le champ libre avant submit
```

```gherkin
# Source : §05 R_M03.12 / §06/M03 W9
# Couche : db
# Priorité : P1-critique

Scénario : archivage_chauffeur_avec_tournee_future_bloque
  Étant donné un chauffeur Strike assigné à une tournée future (statut "planifiee", heure_planifiee_debut >= now())
  Quand le manager tente d'archiver le chauffeur
  Alors l'opération est bloquée
  Et le message affiche "Ce chauffeur est assigné à N tournée(s) future(s). Réassignez-les avant archivage."
```

```gherkin
# Source : §06/M03 EC14
# Couche : db
# Priorité : P2-important

Scénario : meme_chauffeur_tournees_chevauchantes_rejete
  Étant donné un chauffeur déjà assigné à la tournée Y dont la fenêtre opérationnelle est 10h-14h
  Quand le manager l'assigne à une tournée Z dont la fenêtre chevauche (12h-16h)
  Alors la validation serveur (OVERLAPS sur heure_planifiee_debut/fin) rejette l'opération
  Et le message indique le conflit avec la tournée Y
  Et la même règle s'applique au véhicule
```

```gherkin
# Source : §06/M03 W10 step 5 / contrainte montants
# Couche : api
# Priorité : P2-important

Scénario : facture_montants_incoherents_rejete
  Étant donné un upload facture avec montant_ht + montant_tva ≠ montant_ttc (au-delà de 0,01 €)
  Quand le manager submit
  Alors la validation serveur rejette avant INSERT
  Et un message d'erreur explicite est retourné
```

```gherkin
# Source : §06/M03 W10 step 5 / UNIQUE (prestataire_id, numero_facture)
# Couche : db
# Priorité : P1-critique

Scénario : numero_facture_doublon_rejete
  Étant donné une facture numéro "F-2026-0042" déjà enregistrée pour Strike
  Quand le manager uploade une nouvelle facture avec le même numéro sans cocher "rectifie une précédente"
  Alors la contrainte UNIQUE (prestataire_id, numero_facture) rejette l'INSERT
  Et le message invite à cocher l'option rectification si applicable
```

```gherkin
# Source : §06/M03 W10 / contraintes périodes
# Couche : api
# Priorité : P3-nominal

Scénario : periode_facture_invalide_rejete
  Étant donné un upload facture avec periode_debut > periode_fin OU date_facture > aujourd'hui
  Quand le manager submit
  Alors la validation serveur rejette avant INSERT
```

```gherkin
# Source : §06/M03 EC3 / RLS transitions statut_dispatch
# Couche : api
# Priorité : P2-important

Scénario : assignation_sur_collecte_non_acceptee_refusee
  Étant donné une collecte au statut "attribuee_en_attente_acceptation" (pas encore acceptée)
  Quand le manager tente directement POST /tournees/:id/assign
  Alors l'opération est refusée (transition non autorisée par RLS UPDATE)
```

```gherkin
# Source : §06/M03 EA1 rate limit / §15
# Couche : api
# Priorité : P2-important

Scénario : login_rate_limit_5_tentatives
  Étant donné 5 tentatives de login échouées depuis la même IP en moins de 15 min
  Quand une 6e tentative est faite
  Alors la requête est rejetée (rate limit)
  Et une alerte M11 warning "m03_login_rate_limit_depasse" est émise
```

---

### Catégorie 4 — Isolation données (RLS)

```gherkin
# Source : §09 RLS / §06/M03 §8 RLS policies
# Couche : db
# Priorité : P1-critique

Scénario : manager_strike_ne_voit_pas_collectes_marathon
  Étant donné un manager_prestataire rattaché à Strike
  Quand il interroge collectes_tms
  Alors il ne voit que les collectes WHERE prestataire_id = Strike
  Et aucune collecte Marathon n'est retournée
```

```gherkin
# Source : §09 RLS / §06/M03 EC5
# Couche : db
# Priorité : P1-critique

Scénario : assignation_chauffeur_autre_prestataire_introuvable
  Étant donné un manager Strike qui force chauffeur_id appartenant à Marathon dans l'API d'assignation
  Quand la requête est exécutée
  Alors la RLS filtre WHERE prestataire_id = auth.prestataire_id() et renvoie "Chauffeur introuvable"
  Et aucune fuite d'information sur l'existence du chauffeur
```

```gherkin
# Source : §09 RLS tournees
# Couche : db
# Priorité : P1-critique

Scénario : manager_strike_ne_voit_pas_tournees_marathon
  Étant donné un manager Strike
  Quand il interroge tournees
  Alors seules les tournées WHERE prestataire_id = Strike sont retournées (SELECT/UPDATE)
```

```gherkin
# Source : §09 RLS factures_prestataires
# Couche : db
# Priorité : P1-critique

Scénario : manager_ne_voit_que_ses_factures
  Étant donné un manager Strike
  Quand il interroge factures_prestataires
  Alors seules ses factures (prestataire_id = Strike) sont retournées (SELECT/INSERT)
  Et toute tentative d'UPDATE sur une facture est bloquée (immuable, Ops/Admin pour litige)
```

```gherkin
# Source : §09 RLS chauffeurs/vehicules
# Couche : db
# Priorité : P2-important

Scénario : crud_parc_isole_par_prestataire
  Étant donné un manager Marathon
  Quand il liste/crée/édite chauffeurs et véhicules
  Alors le CRUD ne s'applique qu'aux lignes WHERE prestataire_id = Marathon
```

```gherkin
# Source : §09 RLS types_vehicules
# Couche : db
# Priorité : P2-important

Scénario : type_vehicule_insert_manager_ok_update_refuse
  Étant donné un manager_prestataire
  Quand il INSERT un nouveau types_vehicules
  Alors l'opération est autorisée (valide_ops = false)
  Et toute tentative d'UPDATE/DELETE (désactivation) sur types_vehicules est refusée (réservée Ops/Admin)
```

```gherkin
# Source : §09 cross-schema
# Couche : db
# Priorité : P2-important

Scénario : manager_ne_lit_pas_tarif_traiteur_plateforme
  Étant donné un manager Strike sur la fiche collecte E3
  Quand il consulte les revenus
  Alors le tarif facturé au traiteur par Savr, la marge et l'historique traiteur ne sont pas exposés (RLS stricte cross-schema)
```

---

### Catégorie 5 — Idempotence et états

```gherkin
# Source : §06/M03 EC2 / lock optimiste
# Couche : api
# Priorité : P1-critique

Scénario : acceptation_simultanee_lock_optimiste
  Étant donné Manager A et Manager B du même prestataire ouvrant la même collecte "attribuee_en_attente_acceptation"
  Quand les deux cliquent "Accepter" à 500 ms d'intervalle
  Alors UPDATE ... WHERE statut_dispatch = 'attribuee_en_attente_acceptation' ne réussit que pour le premier commit
  Et le second reçoit "Cette collecte vient d'être acceptée par un collègue."
```

```gherkin
# Source : §06/M03 EC3
# Couche : api
# Priorité : P2-important

Scénario : acceptation_collecte_reprise_ops_409
  Étant donné une collecte revenue au statut "a_attribuer" suite à un override Ops (M02 W5)
  Et un manager avec un cache client ancien affichant encore "attribuee_en_attente_acceptation"
  Quand il clique "Accepter"
  Alors le serveur renvoie 409 Conflict "Cette collecte a été reprise par les équipes Ops"
```

```gherkin
# Source : §09 RLS factures immuables
# Couche : db
# Priorité : P1-critique

Scénario : facture_immuable_apres_upload
  Étant donné une facture uploadée par le manager
  Quand le manager tente un UPDATE (montant, numéro, période)
  Alors la RLS bloque l'opération (UPDATE réservé Ops/Admin pour litige)
```

```gherkin
# Source : §05 R_M03.11 / trigger fn_lock_tournee_assignation
# Couche : db
# Priorité : P1-critique

Scénario : modification_assignation_bloquee_si_tournee_en_cours
  Étant donné une tournée au statut "en_cours"
  Quand le manager (non-Ops) tente de modifier chauffeur_id ou vehicule_id
  Alors le trigger fn_lock_tournee_assignation RAISE EXCEPTION
  Et la modification reste possible tant que tournees.statut ∈ (planifiee, acceptee)
```

```gherkin
# Source : §05 R_M03.9 lock collectes post-facture
# Couche : db
# Priorité : P2-important

Scénario : collectes_m_moins_1_lecture_seule_apres_facture
  Étant donné une facture validée pour le mois M-1 d'un prestataire
  Quand le manager tente de contester/modifier une collecte du mois M-1 via le portail
  Alors la collecte est en lecture seule (locked_by_facture_id)
  Et la contestation passe hors portail (contact Ops)
```

```gherkin
# Source : §08 E1 / dédup body.event_id
# Couche : api
# Priorité : P1-critique

Scénario : reception_e1_doublon_event_id_pas_de_doublon
  Étant donné un webhook E1 "collecte-creee" déjà traité (body.event_id connu)
  Quand le même event_id est reçu une seconde fois (retry Plateforme)
  Alors aucune collecte_tms n'est créée en double
  Et la réponse est 200 idempotente
```

```gherkin
# Source : §06/M03 EC9 / W9
# Couche : api
# Priorité : P3-nominal

Scénario : archivage_puis_restauration_chauffeur
  Étant donné un chauffeur archivé (archived_at renseigné, session révoquée)
  Quand le manager le restaure le lendemain
  Alors archived_at = NULL et active = true
  Et le chauffeur doit redéfinir un mot de passe (session non restaurée automatiquement)
  Et l'audit_log conserve archivage + restauration
```

```gherkin
# Source : §06/M03 EC1 / §08 E6
# Couche : api
# Priorité : P2-important

Scénario : collecte_annulee_avant_acceptation
  Étant donné une collecte "attribuee_en_attente_acceptation"
  Quand la Plateforme émet le webhook E6 "collecte-annulee"
  Alors statut_dispatch passe immédiatement "annulee_par_traiteur"
  Et la collecte disparaît du bloc E1 "en attente" (ou s'affiche grisée "Annulée")
  Et aucun webhook sortant n'est émis pour cette transition
```

```gherkin
# Source : §06/M03 W6 / R_M03.12 / cohérence 2026-06-05
# Couche : api
# Priorité : P2-important

Scénario : alerte_oubli_assignation_lit_etat_courant
  Étant donné une tournée J+1 au statut "en_attente_execution" sans chauffeur à 17h59
  Et le job d'alerte oubli H-12 s'exécute à 18h00
  Quand le manager assigne un chauffeur à 17h58 (avant le passage du job)
  Alors le job lit l'état courant (chauffeur présent) et n'émet aucune alerte Ops
  Et inversement, si la tournée est toujours sans chauffeur à 18h00, l'alerte Ops est émise
```

---

### Catégorie 6 — Scénarios cross-app (Plateforme ↔ TMS)

```gherkin
# Source : §08 S1 / W1
# Couche : api
# Priorité : P1-critique

Scénario : s1_collecte_acceptee_payload_conforme
  Quand le manager accepte une collecte (W1)
  Alors le webhook S1 "tms/collecte-acceptee" est émis avec l'enveloppe commune (event_id, occurred_at, source, type)
  Et type = "collecte.acceptee" (sans préfixe tms.)
  Et un échec de livraison rejoue selon le retry 3 paliers 5min/1h/24h
```

```gherkin
# Source : §08 S2 / W2
# Couche : api
# Priorité : P2-important

Scénario : s2_collecte_refusee_payload_conforme
  Quand le manager refuse une collecte (W2)
  Alors le webhook S2 "tms/collecte-refusee" est émis avec motif_refus
  Et le motif "sla_depasse" n'existe pas (SLA supprimé V1)
```

```gherkin
# Source : §08 S7 / §05 R_M03.4 / refonte 2026-05-03
# Couche : api
# Priorité : P1-critique

Scénario : s7_plaque_saisie_enrichi_chauffeur_nom
  Étant donné une tournée avec controle_acces_requis = true
  Quand le manager valide l'assignation (véhicule + chauffeur)
  Alors le webhook S7 "tms/plaque-saisie" est émis avec payload { plaque, chauffeur_nom }
  Et la Plateforme alimente tournees.plaque_immatriculation + tournees.chauffeur_nom
```

```gherkin
# Source : §08 E1 / §05 R_M03.4
# Couche : api
# Priorité : P2-important

Scénario : e1_propage_controle_acces_requis
  Quand un webhook E1 "collecte-creee" est reçu avec controle_acces_requis = true
  Alors collectes_tms.controle_acces_requis est persisté à true
  Et l'assignation E4 exigera plaque + chauffeur en conséquence
```

```gherkin
# Source : §08 sécurité HMAC + X-API-Version
# Couche : api
# Priorité : P1-critique

Scénario : webhook_entrant_hmac_invalide_rejete
  Étant donné un webhook entrant dont le payload a été modifié après signature
  Quand le TMS le reçoit
  Alors la validation HMAC échoue et la requête est rejetée 401
  Et un webhook avec X-API-Version absent ou obsolète est rejeté 400
```

```gherkin
# Source : §08 / webhook entité inconnue
# Couche : api
# Priorité : P2-important

Scénario : webhook_entite_inconnue_tracee
  Quand un webhook E1/E6 référence une collecte/entité inconnue côté TMS
  Alors l'erreur est tracée dans integrations_logs
  Et une alerte est levée (pas de création silencieuse)
```

---

## Scénarios hors scope (à générer en V1.1)

- **Catégorie 7 — Migration** : M03 (portail prestataire) n'a pas de check de réconciliation propre dans `04 - Migration/05 - Checks reconciliation.md`. Le parc chauffeurs/véhicules et les types véhicules sont seedés via la migration MTS-1, couverte par les scénarios de migration globaux (QO#1 seed types véhicules). Les données M03 (collectes, tournées) proviennent de M01/M02. → Pas de scénario migration spécifique M03.
- **EC7 re-notification traiteur auto** sur changement de plaque post-acceptation : V2 (V1 = notif Ops uniquement).
- **Alerte échéance permis/CNI** (EC6) : V2.
- **Workflow contestation tournée structuré** (E3 "Contact Ops" / "Contester") : forme finale à confirmer (voir specs floues).

---

## Specs floues — TRANCHÉES 2026-06-05

1. **QO#2 — Détail rémunération prestataire drill-down E9/W11** → **termes lus depuis `tournees.cout_detail`** (snapshot grille figé à la clôture, R2.8) selon la formule de la grille du prestataire (§05 R2 : `vacations_paliers` → palier × vacation ; `grille_matricielle_zone[_type_course]` → cellule zone×type ; `forfait_km`/`forfait_fixe`). **Le coût = la grille de rémunération du prestataire, PAS le poids de déchet ni l'équivalent repas** (l'exemple initial repas×kg×€ était une erreur de modèle). Les pesées restent affichées séparément (info opérationnelle). Scénarios `drill_down_revenus_tournee` (vacations) + `drill_down_revenus_formule_forfait_km`.
2. **QO#4 — Contestation tournée** → **email pré-rempli vers Ops** (réf collecte/tournée + montant), pas de formulaire structuré ni d'entité contestation en base V1 (reporté V1.1). Scénario `contestation_tournee_ouvre_email_prerempli` ajouté.
3. **QO#6 — Multi-managers notifications** → **tous les managers du prestataire** reçoivent push + email (pas de dispatcher désigné V1). Scénario `notif_tous_managers_du_prestataire` ajouté.
4. **W6 vs R_M03.12 — recoupement "tournée future"** → **pas un arbitrage métier, tranché en cohérence d'implémentation** : l'alerte oubli assignation (W6) est calculée par un job ponctuel (cron H-24 à 6h / H-12 à 18h) qui lit l'**état courant** de la tournée au moment de son exécution. Une réassignation effectuée avant le passage du job rend la tournée conforme → aucune alerte émise (pas de fausse alerte résiduelle). R_M03.12 (blocage archivage si tournées futures) opère sur une dimension distincte (cycle de vie chauffeur) et ne croise pas la logique d'alerte. Couvert par le scénario `alerte_oubli_assignation_lit_etat_courant`.

```

```

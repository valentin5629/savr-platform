# Scénarios de test — M07 Pilotage financier logistique

**Source CDC** : §06/M07 + §05 R2.1–R2.8/R2.10 + §04 Addendum M07 (trigger `trg_m07_calc_cost`, tables `tournees`/`ajustements_couts_log`/`grilles_tarifaires_prestataires`) + §09 §6/§7/§11/§11bis/§11ter (RLS)
**Généré le** : 2026-06-06
**Statut** : À implémenter par Claude Code

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests du module M07.
> Pour chaque scénario :
>
> - Couche `db` → écrire un test pgTAP dans `supabase/tests/`
> - Couche `api` → écrire un test Vitest dans `packages/tms/tests/api/`
> - Couche `ui` → écrire un test Playwright dans `packages/tms/tests/e2e/`
>   Les tests P1-critique sont bloquants CI. Les tests P2 et P3 sont non-bloquants V1.
>   Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.

> **Note périmètre** : M07 est un module **interne TMS**. Le webhook sortant **S6 a été supprimé** (revue sobriété §08 Bloc A 2026-05-01 A2) : l'exposition vers la Plateforme se fait par **lecture cross-schema** (vue `plateforme.v_courses_logistiques`) + **trigger DB synchrone** `plateforme.fn_recalc_marge_tournee`. La catégorie 6 ne teste donc **pas** d'enveloppe HTTP (pas d'Idempotency-Key / HMAC / X-API-Version / DLQ pour M07) mais le **contrat de lecture cross-schema** et le recalcul marge en DB. La catégorie 7 (migration MTS-1) est **hors scope de cette session** (traitée par `cdc-migration-data`).

---

## Résumé de couverture

| Catégorie                | Nb scénarios | Couverture estimée                                                                                                                                                                                                                                            |
| ------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Happy path           | 9            | W1 calcul auto (formules instanciées + mode express + camion A Toutes! manuel), répartition collecte, ajustement W2, dashboard E1                                                                                                                             |
| 2 — Cas limites métier   | 10           | **Grilles réelles 2026-06-07** : paliers Strike 16/20 m³ (borne 4h, heure entamée ceil, cas de référence 6h = 360 €), équipage double sur dépassement seul, Marathon forfait_fixe 100 €/tournée, annulation seuil 3h, zone multi-site, type_course incomplete |
| 3 — Cas d'erreur métier  | 9            | Ajustement négatif/identique/motif court, durée nulle, horaires manquants + recalcul auto (#1), seed formule sans implémentation (#5), ajustement tournée verrouillée, rétroactivité grille                                                                   |
| 4 — Isolation RLS        | 8            | Chauffeur masquage coût, Manager presta cross-presta, écriture grille admin_tms only, ajustements_couts_log append-only                                                                                                                                       |
| 5 — Idempotence / états  | 7            | Double clôture no-op, figement `cout_calcule_ht`, enum `statut_financier` 2 valeurs, EXCLUDE chevauchement grilles, EC14 correction de correction                                                                                                             |
| 6 — Cross-schema (ex-S6) | 5            | Recalcul marge trigger, idempotence recalcul, whitelist colonnes vue (exclut grille), `push_s6_version` versioning, deny lecture grille côté Plateforme                                                                                                       |
| 7 — Migration            | 0            | Hors scope session (cf. `cdc-migration-data`)                                                                                                                                                                                                                 |
| **TOTAL**                | **48**       |                                                                                                                                                                                                                                                               |

> **Arbitrages Val 2026-06-06 — les 5 specs floues sont TRANCHÉES et propagées** (§04 + M07). Détail en fin de fichier.
> **Révision 2026-06-07 (session seed-fixtures)** : grilles réelles intégrées (§05 R2.2-R2.5). Cat. 2 révisée : Strike = 2 grilles 16/20 m³, dépassement par **heure entamée (ceil)**, équipage double +31,25 €/h **sur dépassement seul** ; **Marathon reclassé `forfait_fixe` 100 €/tournée** (scénario tranches 4h supprimé) ; A Toutes! vélo = 8 cellules réelles (3e dimension mode programme/express, seuil `m07.atoutes_express_seuil_minutes`), camion A Toutes! = saisie manuelle (aucune grille). 46→48 scénarios.

---

## Scénarios

### Catégorie 1 — Happy path (nominal)

```gherkin
# Source : §05 R2.2 / §06/M07 W1 / §04 trigger fn_m07_calc_cost
# Couche : db
# Priorité : P1-critique

Scénario : calcul_auto_vacations_paliers_strike_3h
  Étant donné une tournée Strike camion en statut "en_cours" avec heure_reelle_debut = 08:00 et heure_reelle_fin = 11:00 (durée 3h)
  Et une grille active Strike "vacations_paliers" avec tarif_vacation_base_ht = 180€ et palier 0h-4h = 1 vacation sans prolongation
  Et nb_personnes_facturation = 1
  Quand la tournée passe au statut "terminee"
  Alors le trigger trg_m07_calc_cost écrit cout_calcule_ht = 180.00
  Et cout_final_ht = 180.00
  Et statut_financier = "calcule"
  Et push_s6_version = 1
  Et cout_calculated_at IS NOT NULL
```

```gherkin
# Source : §05 R2.2 (prolongation) / §06/M07 W1 step 4
# Couche : db
# Priorité : P1-critique

Scénario : calcul_auto_vacations_paliers_strike_5h_prolongation
  Étant donné une tournée Strike camion durée réelle 5h (08:00 → 13:00)
  Et une grille active Strike avec palier 4h-6h = 1 vacation, prolongation = true, base_h = 4h, cout_horaire_supplementaire_ht = 40€
  Et nb_personnes_facturation = 1
  Quand la tournée passe à "terminee"
  Alors cout_calcule_ht = 180 + (1 × 40 × (5 − 4)) = 220.00
  Et cout_detail contient le palier appliqué "4h-6h" et la prolongation 1h
```

```gherkin
# Source : §05 R2.3 / §06/M07 W1 / décision C 2026-04-24
# Couche : db
# Priorité : P1-critique

Scénario : calcul_auto_matricielle_zone_type_course_atoutes_velo_complete
  Étant donné une tournée A Toutes! vélo desservant un lieu en zone Paris, attribuée la veille (mode = programme, délai > m07.atoutes_express_seuil_minutes)
  Et une collecte rattachée en statut_operationnel = "realisee" avec poids_net total = 42 kg (> 0)
  Et la grille réelle "grille_matricielle_zone_type_course" avec cellule (Paris, programme, complete) = 38€
  Quand la tournée passe à "terminee"
  Alors type_course est déterminé = "complete" et mode = "programme"
  Et cout_calcule_ht = 38.00
  Et cout_detail contient zone = "Paris", mode = "programme" et type_course = "complete"
```

```gherkin
# Source : §05 R2.3 2bis — 3e dimension mode express (grille réelle + arbitrage Val 2026-06-07, les 2 axes en V1)
# Couche : db
# Priorité : P2-important

Scénario : matricielle_atoutes_velo_mode_express
  Étant donné une tournée A Toutes! vélo desservant un lieu en zone Communes limitrophes
  Et une attribution de la course à A Toutes! 60 minutes avant heure_planifiee_debut (< m07.atoutes_express_seuil_minutes = 90, confirmé Val 2026-06-07)
  Et une collecte realisee avec poids_net total > 0
  Quand la tournée passe à "terminee"
  Alors mode = "express" et cout_calcule_ht = 75.00 (cellule express/complete/limitrophes)
```

```gherkin
# Source : §05 R2.4 (aucune grille V1) + R2.6 — révisé arbitrage Val 2026-06-07 (pas de grille camion A Toutes!)
# Couche : db
# Priorité : P1-critique

Scénario : atoutes_camion_sans_grille_saisie_manuelle
  Étant donné une tournée A Toutes! camion desservant un lieu Zone 2
  Et aucune grille camion A Toutes! active (arbitrage Val 2026-06-07 — formule grille_matricielle_zone au catalogue sans instance)
  Quand la tournée passe à "terminee" avec durée réelle 2h30
  Alors aucun coût n'est calculé automatiquement
  Et Ops Savr peut saisir le coût manuellement (source = saisie_manuelle, §05 R2.6 — pas d'exception SQL pour ce cas assumé)
```

```gherkin
# Source : §05 R2.5 / §06/M07 W1
# Couche : db
# Priorité : P1-critique

Scénario : calcul_auto_forfait_km_province
  Étant donné une tournée prestataire province "forfait_km" avec kilometrage = 80 km
  Et une grille active forfait_base_ht = 90€, km_inclus = 50, tarif_km_supplementaire_ht = 1,20€
  Quand la tournée passe à "terminee"
  Alors cout_calcule_ht = 90 + max(0, 80 − 50) × 1,20 = 126.00
```

```gherkin
# Source : §06/M07 W1 step 7 / §04 trigger step 7 répartition
# Couche : db
# Priorité : P1-critique

Scénario : repartition_cout_par_collecte_egale_avec_reste
  Étant donné une tournée Strike avec cout_calcule_ht = 100.00 (10000 centimes) servant 3 collectes (A, B, C triées par heure_collecte)
  Quand le trigger calcule la répartition sur collecte_tournees
  Alors collecte A reçoit cout_reparti_centimes = 3333
  Et collecte B reçoit cout_reparti_centimes = 3333
  Et collecte C (dernière) reçoit le reste = 10000 − (3333 × 2) = 3334
  Et la somme des cout_reparti_centimes = 10000 exactement (zéro perte d'arrondi)
```

```gherkin
# Source : §06/M07 W2 / §04 §11bis / §09 tournees_ajustement_staff_write
# Couche : api
# Priorité : P1-critique

Scénario : ajustement_manuel_ops_savr_nominal
  Étant donné une tournée "terminee" avec cout_calcule_ht = 200.00, statut_financier = "calcule", cout_final_verrouille = false
  Et un utilisateur connecté avec rôle ops_savr
  Quand il poste POST /api/tournees/:id/ajustement avec {cout_ajuste_ht: 180.00, motif_ajustement: "Remise négociée one-shot Strike validée par téléphone le 06/06"}
  Alors la réponse est 200
  Et tournees.cout_ajuste_ht = 180.00, statut_financier = "ajuste", cout_final_ht = 180.00
  Et push_s6_version est incrémenté (passe de 1 à 2)
  Et une ligne est insérée dans ajustements_couts_log (action = "ajustement_cree", cout_ajuste_ht_avant = NULL, cout_ajuste_ht_apres = 180.00, acteur_user_id renseigné)
```

```gherkin
# Source : §06/M07 E1 W1/W4/W6 / §10 perf
# Couche : api
# Priorité : P3-nominal

Scénario : dashboard_e1_charge_widgets_a_la_volee
  Étant donné un jeu de tournées clôturées sur le mois en cours pour Strike, Marathon et A Toutes!
  Et un utilisateur ops_savr connecté
  Quand il charge GET /tms/finance/dashboard
  Alors W1 retourne SUM(cout_final_ht) du mois en cours + variation vs N-1
  Et W2 retourne AVG(cout_final_ht) par prestataire sur 30 jours glissants
  Et W6 retourne au max 6 parts (top 5 + "Autres")
  Et la vue v_m07_dashboard est calculée à la volée (pas de table matérialisée)
  Et le temps de réponse p95 < 2s
```

---

### Catégorie 2 — Cas limites métier

```gherkin
# Source : §05 R2.2 paliers Strike réels (borne 4h) — révisé grilles réelles 2026-06-07
# Couche : db
# Priorité : P1-critique

Scénario : palier_strike_borne_exacte_4h
  Étant donné la grille réelle Strike 16m³ avec paliers [0h-4h = 1 vac sans prolongation], [4h-∞ = 1 vac avec prolongation base 4h]
  Et une tournée de durée réelle exactement 4h00 (240 min)
  Quand le calcul s'exécute
  Alors le palier sélectionné est "4h-∞" (règle p.de_h <= duree < p.a_h, 4h appartient à [4h, ∞[)
  Et les heures entamées de dépassement = ceil(4 − 4) = 0
  Et cout_calcule_ht = 240 € (vacation de base seule, pas de supplément horaire)
```

```gherkin
# Source : §05 R2.2 grille réelle Strike 16m³ — cas de référence Val (révisé 2026-06-07, ex-paliers 2 vacations supprimés)
# Couche : db
# Priorité : P1-critique

Scénario : strike_16m3_6h_equipage_simple_360
  Étant donné la grille réelle Strike 16m³ (vacation 4h = 240 €, dépassement 60 €/heure entamée)
  Et une tournée de durée réelle exactement 6h00 en équipage simple
  Quand le calcul s'exécute
  Alors les heures entamées = ceil(6 − 4) = 2
  Et cout_calcule_ht = 240 + 2 × 60 = 360 €
```

```gherkin
# Source : §05 R2.2 dépassement par heure ENTAMÉE (ceil) — révisé grilles réelles 2026-06-07
# Couche : db
# Priorité : P2-important

Scénario : strike_20m3_heure_entamee_ceil
  Étant donné la grille réelle Strike 20m³ (vacation 4h = 300 €, dépassement 75 €/heure entamée)
  Et une tournée de durée réelle 4h15 (255 min) en équipage simple
  Quand le calcul s'exécute
  Alors les heures entamées = ceil(0,25) = 1
  Et cout_calcule_ht = 300 + 1 × 75 = 375 €
```

```gherkin
# Source : §05 R2.2 supplément équipage double — révisé grilles réelles + arbitrage Val 2026-06-07 (dépassement seul)
# Couche : db
# Priorité : P2-important

Scénario : supplement_equipage_double_depassement_seul
  Étant donné la grille réelle Strike 16m³ (equipier_supplement_horaire_ht = 31,25 €)
  Et une tournée de durée 6h00 avec nb_personnes_facturation = 2
  Quand le calcul s'exécute
  Alors la vacation de base reste 240 € (identique en équipage double)
  Et le dépassement = 2 × (60 + 31,25) = 182,50 €
  Et cout_calcule_ht = 422,50 €
  Et cout_detail trace nb_personnes_facturation = 2
```

```gherkin
# Source : §05 R2.5 Marathon forfait_fixe réel (reclassé depuis vacations_paliers, grille réelle 2026-06-07)
# Couche : db
# Priorité : P1-critique

Scénario : marathon_forfait_fixe_100_par_tournee
  Étant donné la grille réelle Marathon "forfait_fixe" (forfait_ht = 100 €)
  Et une tournée Marathon portant 2 collectes, de durée réelle 5h30
  Quand le calcul s'exécute
  Alors cout_calcule_ht = 100 € (indépendant de la durée — arbitrage Val : par tournée)
  Et la répartition collecte_tournees divise le coût entre les 2 collectes
```

```gherkin
# Source : §05 R2.7 annulation seuil 3h (borne exacte)
# Couche : db
# Priorité : P1-critique

Scénario : annulation_exactement_3h_avant_non_facturee
  Étant donné une tournée Strike avec heure_planifiee_debut = 09:00
  Et une annulation enregistrée à 06:00 (exactement 3h avant)
  Quand la règle R2.7 s'applique (seuil m07.delai_annulation_sans_facturation_minutes = 180)
  Alors cout_calcule_ht = 0
  Et cout_detail = {"raison": "annulation_hors_delai_facturation"}
```

```gherkin
# Source : §05 R2.7 annulation < 3h = facturée
# Couche : db
# Priorité : P1-critique

Scénario : annulation_2h59_avant_facturee
  Étant donné une tournée Strike avec heure_planifiee_debut = 09:00
  Et une annulation enregistrée à 06:01 (2h59 avant, < seuil 3h)
  Quand la règle R2.7 s'applique
  Alors une vacation est facturée (formule normale sur durée minimale palier ou durée réelle si chauffeur mobilisé)
  Et cout_calcule_ht > 0
```

```gherkin
# Source : §05 R2.3 zone multi-site (zone_la_plus_haute)
# Couche : db
# Priorité : P2-important

Scénario : zone_multi_site_prend_la_plus_haute
  Étant donné une tournée A Toutes! vélo (mode programme) avec lieu de chargement zone Paris et lieu de livraison zone Communes limitrophes
  Et la grille réelle avec cellules (Paris, programme, complete) = 38€ et (Communes limitrophes, programme, complete) = 51€
  Quand la zone est déterminée (regle_zone_multi_site = zone_la_plus_haute)
  Alors la zone retenue = Communes limitrophes
  Et cout_calcule_ht = 51.00
```

```gherkin
# Source : §05 R2.3 / R2.10 flag tarif_sans_collecte_applicable
# Couche : db
# Priorité : P2-important

Scénario : atoutes_velo_realisee_sans_collecte_type_incomplete
  Étant donné une tournée A Toutes! vélo (mode programme, zone Paris) dont toutes les collectes sont en statut_operationnel = "realisee_sans_collecte" (AG)
  Et la grille réelle avec cellule (Paris, programme, incomplete) = 19,00€
  Quand le calcul s'exécute
  Alors type_course = "incomplete"
  Et cout_calcule_ht = 19.00 (= 50% du tarif complete 38€)
```

```gherkin
# Source : §06/M07 EC13 / décision C 2026-04-24
# Couche : db
# Priorité : P2-important

Scénario : strike_backup_ag_sans_collecte_flag_false_vacation_normale
  Étant donné une tournée Strike (vacations_paliers) en backup AG, toutes collectes "realisee_sans_collecte"
  Et la grille Strike a tarif_sans_collecte_applicable = false
  Quand le calcul s'exécute
  Alors une vacation normale est facturée (pas de coût 0)
  Et cout_calcule_ht = tarif palier appliqué sur la durée réelle
```

---

### Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : §06/M07 E4 validation / §04 CHECK cout_ajuste_ht > 0
# Couche : api
# Priorité : P1-critique

Scénario : ajustement_montant_negatif_refuse
  Étant donné une tournée "terminee" cout_calcule_ht = 200.00
  Et un utilisateur ops_savr
  Quand il poste un ajustement avec cout_ajuste_ht = -50.00
  Alors la réponse est 400 (CHECK cout_ajuste_ht > 0)
  Et aucune ligne n'est insérée dans ajustements_couts_log
```

```gherkin
# Source : §06/M07 E4 validation UI (cout_ajuste != cout_calcule)
# Couche : api
# Priorité : P2-important

Scénario : ajustement_egal_au_calcule_refuse
  Étant donné une tournée "terminee" cout_calcule_ht = 200.00
  Quand un ops_savr poste un ajustement cout_ajuste_ht = 200.00 (identique)
  Alors la réponse est 400 (sinon pas d'ajustement réel)
```

```gherkin
# Source : §06/M07 E4 / §04 CHECK motif >= 30 chars
# Couche : api
# Priorité : P1-critique

Scénario : ajustement_motif_trop_court_refuse
  Étant donné une tournée "terminee" cout_calcule_ht = 200.00
  Quand un ops_savr poste un ajustement cout_ajuste_ht = 180.00 avec motif_ajustement = "remise" (6 chars < 30)
  Alors la réponse est 400 (CHECK motif >= 30 caractères)
```

```gherkin
# Source : §06/M07 EC2 / §04 trigger step 3 / N7
# Couche : db
# Priorité : P1-critique

Scénario : duree_reelle_nulle_cout_zero_alerte
  Étant donné une tournée passée à "terminee" avec heure_reelle_debut = heure_reelle_fin = 10:00 (durée 0)
  Quand le trigger trg_m07_calc_cost s'exécute
  Alors cout_calcule_ht = 0
  Et cout_detail = {"raison": "duree_nulle"}
  Et statut_financier = "calcule"
  Et une alerte M11 m07_duree_nulle (warning) est émise
  Et la tournée n'est PAS bloquée (reste terminee)
```

```gherkin
# Source : §06/M07 §12bis / §04 trigger step 2
# Couche : db
# Priorité : P1-critique

Scénario : horaires_manquants_alerte_critique_cout_null
  Étant donné une tournée passée à "terminee" avec heure_reelle_debut = NULL
  Quand le trigger trg_m07_calc_cost s'exécute
  Alors une alerte M11 m07_horaires_manquants (critical) est émise
  Et cout_calcule_ht reste NULL
  Et statut_financier reste "calcule"
  Et push_s6_version n'est PAS incrémenté
  Et la tournée n'est pas bloquée (reste terminee)
```

```gherkin
# Source : §04 §7 trg_m07_recalc_on_horaires (arbitrage Val 2026-06-06 floue #1)
# Couche : db
# Priorité : P1-critique

Scénario : recalcul_auto_apres_correction_horaires
  Étant donné une tournée "terminee" avec cout_calcule_ht = NULL (horaires manquants à la clôture, alerte m07_horaires_manquants ouverte)
  Quand Ops corrige heure_reelle_debut = 08:00 et heure_reelle_fin = 11:00 (UPDATE sans changer statut)
  Alors le trigger trg_m07_recalc_on_horaires se déclenche
  Et fn_m07_compute_and_store rejoue le calcul → cout_calcule_ht, cout_final_ht renseignés, push_s6_version incrémenté
  Et l'alerte m07_horaires_manquants est résolue
  Et le recalcul marge cross-schema est déclenché (déblocage M08)
```

```gherkin
# Source : §04 §7 trg_m07_recalc_on_horaires garde anti-boucle
# Couche : db
# Priorité : P2-important

Scénario : recalcul_horaires_pas_de_boucle_si_cout_deja_pose
  Étant donné une tournée "terminee" avec cout_calcule_ht = 180.00 (déjà calculé)
  Quand un UPDATE modifie heure_reelle_fin (correction marginale)
  Alors le trigger trg_m07_recalc_on_horaires ne recalcule PAS (condition cout_calcule_ht IS NULL non remplie)
  Et le coût figé reste 180.00 (R2.8 respecté)
```

```gherkin
# Source : §06/M07 EC9 / §09 / §04 §11bis (cout_final_verrouille)
# Couche : api
# Priorité : P1-critique

Scénario : ajustement_tournee_verrouillee_m08_refuse
  Étant donné une tournée "terminee" avec cout_final_verrouille = true (rapprochée à une facture M08 validée)
  Quand un ops_savr tente POST /api/tournees/:id/ajustement
  Alors la réponse est refusée (RLS WITH CHECK cout_final_verrouille = false)
  Et une alerte M11 m07_ajustement_pendant_facturation (critical) est émise
  Et le message indique "déverrouillage nécessaire via M08 W9 (Admin TMS)"
```

```gherkin
# Source : §04 §5 trg_formules_catalogue_impl_check (arbitrage Val 2026-06-06 floue #5)
# Couche : db
# Priorité : P2-important

Scénario : seed_formule_sans_implementation_refuse
  Étant donné un seed/migration tentant un INSERT dans formules_catalogue avec code = "tarif_special_x"
  Et aucune fonction tms.m07_compute_tarif_special_x(uuid, uuid) déployée
  Quand l'INSERT s'exécute
  Alors le trigger trg_formules_catalogue_impl_check RAISE EXCEPTION (mismatch DB seed ↔ code détecté au seed, pas en prod)
  Et l'INSERT échoue
```

```gherkin
# Source : §05 R2.8 anti-rétroactivité / §06/M07 EC11 / §04 CHECK date_debut_validite > CURRENT_DATE
# Couche : db
# Priorité : P1-critique

Scénario : creation_grille_date_debut_passee_refusee
  Étant donné un admin_tms créant une nouvelle grille Strike
  Quand il saisit date_debut_validite = CURRENT_DATE (aujourd'hui, non future)
  Alors l'INSERT est rejeté par le CHECK SQL (date_debut_validite > CURRENT_DATE)
  Et le message indique "Rétroactivité interdite — créer nouvelle grille avec date future"
```

---

### Catégorie 4 — Isolation données (RLS)

```gherkin
# Source : §09 §4 colonnes masquées chauffeur / §09 §7 tournees_chauffeur_read
# Couche : db
# Priorité : P1-critique

Scénario : chauffeur_ne_voit_pas_cout_calcule
  Étant donné un chauffeur Strike connecté (app_domain = tms)
  Et une tournée qui lui est assignée avec cout_calcule_ht = 200.00
  Quand il lit sa tournée via l'app mobile
  Alors les colonnes cout_calcule_ht, cout_detail, grille_tarifaire_id sont masquées (NULL ou inaccessibles)
```

```gherkin
# Source : §09 §11 grilles_manager_read
# Couche : db
# Priorité : P1-critique

Scénario : manager_strike_ne_voit_pas_grille_marathon
  Étant donné un manager_prestataire Strike connecté
  Et une grille active appartenant à Marathon
  Quand il interroge grilles_tarifaires_prestataires
  Alors il ne voit QUE les grilles où prestataire_id = son propre prestataire_id
  Et la grille Marathon n'apparaît pas (deny RLS)
```

```gherkin
# Source : §09 §11 grilles_admin_tms_write
# Couche : db
# Priorité : P1-critique

Scénario : ops_savr_ne_peut_pas_ecrire_grille
  Étant donné un ops_savr connecté
  Quand il tente un INSERT ou UPDATE sur grilles_tarifaires_prestataires
  Alors l'écriture est refusée (policy grilles_admin_tms_write = admin_tms uniquement)
  Et la lecture (grilles_staff_read) reste autorisée
```

```gherkin
# Source : §09 §11 grilles_manager_read (deny write)
# Couche : db
# Priorité : P2-important

Scénario : manager_prestataire_grille_lecture_seule
  Étant donné un manager_prestataire Strike
  Quand il tente de modifier sa propre grille Strike
  Alors l'UPDATE est refusé (seule policy SELECT pour manager)
```

```gherkin
# Source : §09 §11ter ajustements_log_staff_read
# Couche : db
# Priorité : P1-critique

Scénario : manager_prestataire_ne_lit_pas_ajustements_log
  Étant donné un manager_prestataire connecté
  Quand il interroge ajustements_couts_log
  Alors aucune ligne n'est retournée (policy lecture = staff uniquement)
```

```gherkin
# Source : §09 §11ter append-only (no_update / no_delete + trigger défensif)
# Couche : db
# Priorité : P1-critique

Scénario : ajustements_log_update_delete_refuses_meme_admin
  Étant donné un admin_tms connecté
  Et une ligne existante dans ajustements_couts_log
  Quand il tente un UPDATE puis un DELETE sur cette ligne
  Alors les deux opérations sont refusées (policies USING false + trigger tg_ajustements_log_append_only RAISE EXCEPTION)
```

```gherkin
# Source : §09 §7 tournees_manager_rw isolation
# Couche : db
# Priorité : P1-critique

Scénario : manager_marathon_ne_voit_pas_couts_strike
  Étant donné un manager_prestataire Marathon connecté
  Et des tournées Strike avec cout_final_ht renseigné
  Quand il interroge la liste des tournées avec coûts
  Alors il ne voit que les tournées où prestataire_id = Marathon
```

```gherkin
# Source : §09 §6 collecte_tournees écriture système uniquement
# Couche : db
# Priorité : P2-important

Scénario : aucun_role_applicatif_ecrit_cout_reparti
  Étant donné un ops_savr ou un manager_prestataire connecté
  Quand il tente d'écrire directement cout_reparti_centimes sur collecte_tournees
  Alors l'écriture est refusée (collecte_tournees écrite uniquement par système / SECURITY DEFINER)
```

---

### Catégorie 5 — Idempotence et états

```gherkin
# Source : §04 trigger step 1 idempotence / §06/M07 EC5
# Couche : db
# Priorité : P1-critique

Scénario : double_cloture_no_op
  Étant donné une tournée déjà calculée (cout_calcule_ht = 200.00, cout_calculated_at IS NOT NULL)
  Quand un second UPDATE statut = "terminee" est rejoué (relance atomique)
  Alors le trigger sort en no-op silencieux
  Et cout_calcule_ht reste 200.00
  Et push_s6_version n'est pas réincrémenté
```

```gherkin
# Source : §05 R2.8 figement / §04 trg_tournees_cout_calcule_immutable
# Couche : db
# Priorité : P1-critique

Scénario : modification_cout_calcule_post_cloture_rejetee
  Étant donné une tournée "terminee" avec cout_calcule_ht = 200.00 (non NULL)
  Quand un UPDATE tente de poser cout_calcule_ht = 250.00
  Alors le trigger BEFORE UPDATE RAISE EXCEPTION "cout_calcule_ht immuable post-clôture (R2.8). Utiliser cout_ajuste_ht."
```

```gherkin
# Source : §04 CHECK statut_financier IN ('calcule','ajuste')
# Couche : db
# Priorité : P1-critique

Scénario : statut_financier_enum_2_valeurs_seulement
  Étant donné la table tournees
  Quand un UPDATE pose statut_financier = "cout_manquant"
  Alors le CHECK rejette la valeur (enum V1 = {calcule, ajuste}, cout_manquant retiré)
```

```gherkin
# Source : §04 CHECK cohérence ajustement/statut
# Couche : db
# Priorité : P2-important

Scénario : coherence_cout_ajuste_statut_financier
  Étant donné une tournée
  Quand on tente de poser cout_ajuste_ht IS NOT NULL ET statut_financier = "calcule"
  Alors le CHECK rejette (cohérence : ajuste <=> statut_financier = 'ajuste')
```

```gherkin
# Source : §06/M07 EC7 / §04 EXCLUDE USING gist
# Couche : db
# Priorité : P1-critique

Scénario : chevauchement_grilles_actives_refuse
  Étant donné une grille Strike active sur [2026-01-01, infinity) type_vehicule = camion
  Quand un INSERT tente une 2e grille Strike active camion sur [2026-06-01, infinity) (chevauchement)
  Alors la contrainte EXCLUDE USING gist rejette l'INSERT
  Et l'erreur SQL native est interceptée côté API
```

```gherkin
# Source : §06/M07 EC14 / W2 audit log append-only
# Couche : api
# Priorité : P2-important

Scénario : correction_de_correction_ec14
  Étant donné une tournée déjà ajustée (cout_calcule_ht = 200.00, cout_ajuste_ht = 180.00, statut_financier = "ajuste")
  Quand un ops_savr poste un nouvel ajustement cout_ajuste_ht = 175.00
  Alors cout_ajuste_ht passe à 175.00, cout_final_ht = 175.00
  Et une 2e ligne est insérée dans ajustements_couts_log (action = "ajustement_modifie", avant = 180.00, apres = 175.00)
  Et l'écart % est recalculé contre cout_calcule_ht ORIGINAL (200.00), pas contre l'ajustement précédent
  Et push_s6_version est de nouveau incrémenté
```

```gherkin
# Source : §06/M07 §8.2 / §04 vue_grilles_etat_courant
# Couche : db
# Priorité : P3-nominal

Scénario : etat_grille_derive_non_persiste
  Étant donné une grille avec date_debut_validite = CURRENT_DATE + 10 (future)
  Quand on interroge vue_grilles_etat_courant
  Alors etat_courant = "future" (dérivé, statut persisté reste "actif")
  Et aucune colonne etat_temporel n'est stockée en base
```

---

### Catégorie 6 — Cross-schema Plateforme ↔ TMS (ex-webhook S6 supprimé)

```gherkin
# Source : §04 trigger step 8 / §06/M07 W1 step 8 / addendum A2 2026-05-01
# Couche : db
# Priorité : P1-critique

Scénario : recalcul_marge_cross_schema_sur_calcul
  Étant donné une tournée passée à "terminee" avec calcul produisant cout_final_ht = 200.00
  Quand le trigger trg_m07_calc_cost s'exécute (step 8)
  Alors plateforme.fn_recalc_marge_tournee(tournee_id) est appelée de façon synchrone en DB
  Et plateforme.factures.marge_logistique est recalculée
  Et aucun appel HTTP / retry / DLQ n'est émis (pas de webhook S6)
```

```gherkin
# Source : §06/M07 EC15 / fn_recalc_marge_tournee idempotente
# Couche : db
# Priorité : P1-critique

Scénario : recalcul_marge_idempotent_apres_ajustement
  Étant donné une tournée dont la marge a déjà été calculée (push_s6_version = 1)
  Quand un ajustement la fait passer à push_s6_version = 2 avec cout_final_ht = 180.00
  Alors fn_recalc_marge_tournee recalcule la marge depuis cout_final_ht courant (180.00)
  Et un re-appel de la fonction avec la même valeur produit le même résultat (idempotent)
```

```gherkin
# Source : §06/M07 addendum A2 point 7 / audit 2026-05-26 A3 / §04 §6
# Couche : db
# Priorité : P1-critique

Scénario : vue_cross_schema_whitelist_exclut_grille
  Étant donné la vue plateforme.v_courses_logistiques
  Quand la Plateforme lit une ligne tournée
  Alors les colonnes exposées sont limitées à : cout_final_ht, cout_ajuste (dérivé), push_s6_version, duree_reelle_minutes, cout_reparti_ht, snapshot_cout_detail
  Et snapshot_cout_detail EXCLUT grille_snapshot
  Et les colonnes cout_detail brut, formules_tarifaires.*, grilles_tarifaires.*, cellules_grille.* ne sont PAS exposées
```

```gherkin
# Source : §09 RLS cross-schema deny / grilles privées TMS
# Couche : db
# Priorité : P1-critique

Scénario : plateforme_ne_lit_pas_grilles_tarifaires_tms
  Étant donné un admin_savr connecté côté Plateforme (app_domain = plateforme)
  Quand il tente de SELECT sur tms.grilles_tarifaires_prestataires
  Alors l'accès est refusé (RLS deny cross-schema, grilles privées TMS)
```

```gherkin
# Source : §04 push_s6_version versioning / §06/M07 W1 step 8 + W2 step 6
# Couche : db
# Priorité : P2-important

Scénario : push_s6_version_incremente_a_chaque_recalcul
  Étant donné une tournée nouvellement calculée (push_s6_version = 1)
  Quand un premier ajustement intervient puis un second (EC14)
  Alors push_s6_version vaut successivement 2 puis 3
  Et chaque incrément déclenche un recalcul marge cross-schema
  Et le compteur sert au reporting "marge ajustée" côté Plateforme
```

---

## Scénarios hors scope (à générer en V1.1 ou autre session)

- **Catégorie 7 — Migration MTS-1** : import des grilles tarifaires historiques + coûts de tournées MTS-1 vers `grilles_tarifaires_prestataires` / `tournees`. Hors scope de cette session (traité par la skill `cdc-migration-data`, cohérent avec M01–M06).
- **R2.6 saisie manuelle coût Everest absent** : cas exceptionnel A Toutes! sans grille TMS (`source = saisie_manuelle` côté Plateforme). Dépend du module M14 / contrat Plateforme — à tester en session cross-CDC.
- **Export CSV E9/W7** : génération sync, cap 5000 lignes, format Pennylane — P3, à couvrir une fois le format colonnes Pennylane figé (Q2 ouverte).
- **Drill-down coût par événement** (Q4 ouverte) : non tranché V1 vs V1.1.
- **Trigger de validation `formules_catalogue` AFTER INSERT** (Q5 ouverte, "à arbitrer avec frère") : vérification existence `tms.m07_compute_<code>` au seed — voir specs floues #5 ci-dessous.

---

## ✅ Specs floues — TRANCHÉES par Val (2026-06-06) et propagées au CDC

**#1 — BLOQUANT : recalcul après correction des horaires manquants → RÉSOLU.**
Décision : **trigger compagnon dédié `trg_m07_recalc_on_horaires`** (`AFTER UPDATE OF heure_reelle_debut, heure_reelle_fin`). Quand Ops corrige les horaires d'une tournée `terminee` à `cout_calcule_ht NULL`, il rejoue `fn_m07_compute_and_store` et résout l'alerte `m07_horaires_manquants`. Garde anti-boucle : ne s'active que tant que `cout_calcule_ht IS NULL`. Propagé : §04 §7 (DDL + refactor `fn_m07_compute_and_store`), M07 W1 step 1 + garde-fous. Couvert par les scénarios `recalcul_auto_apres_correction_horaires` et `recalcul_horaires_pas_de_boucle_si_cout_deja_pose`.

**#2 — EC5 vs idempotence → RÉSOLU.** Décision : **no-op strict**. EC5 reformulé (M07 §7), mention « recalcul si grille changée » retirée (inatteignable + contraire au figement R2.8). Correction d'un coût erroné = `cout_ajuste_ht` (W2). Couvert par `double_cloture_no_op`.

**#3 — EC6 vs R2.7bis → RÉSOLU.** Décision : EC6 reformulé (M07 §7) en **annulation niveau collecte** pendant tournée `en_cours` ; la tournée ne transite jamais `en_cours→annulee` (R2.7bis authoritative), vacation facturée intégralement. L'annulation avant démarrage relève de R2.7.

**#4 — arrondi répartition → RÉSOLU.** Décision : **FLOOR** (trigger §04 fait foi). Prose M07 W1 step 7 corrigée (ex-`ROUND`), les n−1 premières collectes = `FLOOR`, la dernière = reste. Couvert par `repartition_cout_par_collecte_egale_avec_reste`.

**#5 — validation existence fonction formule → RÉSOLU.** Décision : **validation au seed** via trigger `trg_formules_catalogue_impl_check` (`AFTER INSERT OR UPDATE OF code ON formules_catalogue`, introspection `pg_proc` / `to_regprocedure`). Mismatch DB seed ↔ code détecté au déploiement ; l'exception runtime à la clôture reste le filet de dernier recours. Ordre migration : déployer `m07_compute_*` avant le seed. Propagé : §04 §5, M07 Q5. Couvert par `seed_formule_sans_implementation_refuse`.

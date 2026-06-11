# 02 - Couverture règles métier → objets fixtures (App + TMS)

**Créé** : 2026-06-07 — **volet TMS ajouté le 2026-06-07**. **Base de couverture (décision Val)** : règles §05 App + §05 TMS (R1–R7) + décisions floues tranchées des 26 lots `cdc-test-scenarios` (14 TMS + 12 App, 2026-06-05 → 2026-06-07).
**Invariant** : toute règle critique a ≥ 1 objet fixture qui la déclenche dans `seed_minimal`. Une règle non couverte = blocage avant écriture du script d'injection.

Convention d'ID : slugs déterministes (cf. [[05 - Spec d'injection]]). `★` = présent dans `seed_minimal`.

---

## §05 §1 — Tarification Zéro-Déchet

| Règle                               | Objet fixture                                        | Dataset |
| ----------------------------------- | ---------------------------------------------------- | ------- |
| Grille catalogue (méthode standard) | `grille_zd_standard` + lignes                        | ★       |
| Palier bas (petit événement)        | `ev_zd_palier_bas` (80 pax)                          | ★       |
| Palier haut (> 1000 pax)            | `ev_zd_palier_haut` (1 800 pax, Porte de Versailles) | ★       |
| Tarif négocié hors grille           | `tarif_negocie_kaspia`                               | ★       |

## §05 §2 — Algorithme attribution Anti-Gaspi

| Règle                                                                       | Objet fixture                                                | Dataset |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ | ------- |
| Sélection association (proximité, `ag_province_proximite`)                  | `attr_ag_nominal` → `asso_alpha`                             | ★       |
| Refus asso = **override standard Admin** (F2 §06.09)                        | `attr_ag_refusee` (asso_echo) → réattribution Admin          | ★       |
| Transporteur province                                                       | `col_ag_cirette_rouen` → `prest_transnormandie`              | ★       |
| Attribution IDF (param `'strike'`, `zd_idf_strike` — décisions conscientes) | `col_zd_idf_*` → `prest_strike` / `prest_marathon`           | ★       |
| Auto-accept (`config_auto_accept_ag`, F1 §06.09)                            | `config_aa_fleurdemets` + `attr_ag_auto`                     | ★       |
| Poids V1 AG = saisie manuelle Ops (photos pesées) (F1 §06.09)               | `col_ag_poids_ops` (poids saisi, photo `shared.fichiers`)    | ★       |
| Compatibilité véhicule ↔ lieu (R_compatibilite_vehicule_lieu)               | `lieu_salomon_rothschild` (accès restreint, vélo cargo only) | demo    |

## §05 §3 — Packs Anti-Gaspi

| Règle                                                                                                                  | Objet fixture                                                | Dataset |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------- |
| Pack unique actif par traiteur                                                                                         | 1 pack actif/traiteur, jamais 2                              | ★       |
| Débit d'un crédit à la collecte                                                                                        | `pack_fleurdemets_actif` (crédits partiellement consommés)   | ★       |
| **Blocage création si pack épuisé**                                                                                    | `pack_lenotre_epuise` (0 crédit) — demo ; `pack_epuise_01` ★ |
| Badge pack bas ≤ 10 % relatif (F2 §06.04)                                                                              | `pack_butard_bas` (3/30)                                     | ★       |
| Annulation AG < 12 h = **débit crédit pack** (trigger `trg_pack_debit_annulation_tardive`, F2 §06.01 — §4bis fait foi) | `ev_ag_annule_tardif` (annulé H-6)                           | ★       |
| Annulation > 12 h = recrédit                                                                                           | `ev_ag_annule_recredite`                                     | ★       |
| Sans pack actif = alerte seule, pas de blocage (F3 §06.01)                                                             | `org_tr_grandchemin` (aucun pack) + `ev_ag_sans_pack`        | ★       |
| Hors pack (négociation directe)                                                                                        | `facture_ag_hors_pack_potel`                                 | demo    |

## §05 §4 — Statuts collectes et transitions

| Règle                                                                                          | Objet fixture                                                 | Dataset |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------- |
| Chaque statut a ≥ 1 collecte (brouillon, programmee, acceptee, realisee, cloturee, annulee)    | série `col_statut_*`                                          | ★       |
| `realisee_sans_collecte` **AG-only**                                                           | `col_ag_sans_collecte` ★ — aucun équivalent ZD (test négatif) |
| Annulation directe `brouillon`/`programmee` sans Admin (F1 §06.04)                             | `col_annulee_directe`                                         | ★       |
| DELETE limité au `brouillon` (F5 §06.04)                                                       | `col_brouillon_supprimable`                                   | ★       |
| Modification collecte à venir (`f_collecte_editable` étendue manager+agence, F3 RLS)           | `col_programmee_editable`                                     | ★       |
| Statut consolidé gestionnaire (F2 §06.05)                                                      | mix statuts sur lieux Viparis                                 | ★       |
| Multi-tournées (R_statut_collecte_multi_tournees)                                              | `col_zd_multi_tournees` (2 tournées)                          | ★       |
| Flag `collectes.historique_partiel` (F3 §06.03)                                                | `col_historique_partiel`                                      | ★       |
| Rattachement événement (R_collecte_evenement_rattachement) + `date_evenement` NULL (F1 §06.01) | `ev_date_null`                                                | ★       |
| Blocage AG coche étape 1 formulaire (F5 §06.01)                                                | `ev_ag_bloque_coche`                                          | ★       |
| pax (R_pax_collecte — pax=0 supprimé)                                                          | aucun objet pax=0 (test négatif au script)                    | —       |

## §05 §4bis — Incidents

| Règle                            | Objet fixture                     | Dataset |
| -------------------------------- | --------------------------------- | ------- |
| Collecte manquée par prestataire | `col_incident_manquee`            | demo    |
| Annulation last minute client    | `ev_ag_annule_tardif` (mutualisé) | ★       |
| Problème de pesée (divergence)   | `col_zd_pesee_doute`              | demo    |

## §05 §5 — Factures

| Règle                                                                                                      | Objet fixture                                          | Dataset |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------- |
| ZD par collecte                                                                                            | `fac_zd_collecte_01`                                   | ★       |
| ZD mensuelle = agrégation auto J+1 (F2 §06.08)                                                             | `fac_zd_mensuelle_kaspia` (mois complet)               | ★       |
| AG `globale_achat` (achat pack)                                                                            | `fac_ag_achat_pack`                                    | ★       |
| AG `par_collecte`                                                                                          | `fac_ag_par_collecte`                                  | demo    |
| **Avoir sur `payee` autorisé** (F1 §06.08 — §05 fait foi)                                                  | `fac_avoir_sur_payee`                                  | ★       |
| Lignes de facture `factures_collectes` (`collecte_id` nullable, designation/quantite/taux_tva — F3 §06.08) | `fac_ligne_libre` (ligne sans collecte)                | ★       |
| Numéro conservé après rejet 4xx + `sequences_facturation` gapless (F4 §06.08)                              | `fac_rejetee_4xx` + séquences alignées                 | ★       |
| Colonne fantôme `marge_logistique` + vue `v_factures_client` (masquage, F5 §06.08)                         | toute facture seedée porte `marge_logistique` non NULL | ★       |
| Échéance = `conditions_paiement_jours` (Reco A)                                                            | conditions 30 j par défaut, 45 j sur Potel             | ★       |
| Anti-double-facturation (« non facturée », Reco B)                                                         | `col_cloturee_non_facturee`                            | ★       |
| Multi-entités de facturation                                                                               | `org_tr_potel` (2 entités, factures réparties)         | demo    |

## §05 §6 — Documents réglementaires et impact

| Règle                                                                              | Objet fixture                                                                        | Dataset          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------- | ---- |
| Bordereau Savr (ZD)                                                                | `bord_zd_01` + PDF placeholder                                                       | ★                |
| Attestation de don habilitée vs non                                                | `att_don_alpha` (habilitée) / `att_don_bravo` (non)                                  | ★                |
| Rapport RSE standard                                                               | `rapport_rse_kaspia_2025`                                                            | demo             |
| Rapport « sans excédent » = ligne `rapports_rse` standard sans embargo (F1 §11-12) | `rapport_rse_sans_excedent`                                                          | ★                |
| Régénération manager = Edge Function SERVICE_ROLE (F3 §11-12)                      | `rapport_rse_regen`                                                                  | demo             |
| Alerte pesées min/max — **ZD only, in-app seule** (F2 §11-12)                      | `flux_alerte_min` ×2, `flux_alerte_max` ×2                                           | ★                |
| R_taux_recyclage (captation par filière)                                           | flux multi-filières sur `col_zd_cloturee_*`                                          | ★                |
| R_co2_calcul / R_co2_snapshot_fige                                                 | `impact_calc_*` snapshots figés ≠ paramètres courants (1 param modifié post-clôture) | ★                |
| R_co2_ag (repas détournés)                                                         | `impact_ag_01`                                                                       | ★                |
| R_dechets_labo_estimes                                                             | `coef_perte_labo_custom` (Kaspia)                                                    | demo             |
| R_volume_estime_ag_calcule                                                         | événements AG avec pax variés                                                        | ★                |
| R_marge_zd_traiteur                                                                | données suffisantes dashboard Kaspia                                                 | demo             |
| Histogramme factures `emise                                                        | payee` (F5 §11-12)                                                                   | mix statuts demo | demo |

## §05 §7 — Registre réglementaire

| Règle                                                                                | Objet fixture                                                       | Dataset          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ---------------- | ----------------------- | --- |
| Registre = **`cloturee` seul + ZD only** (F2 §06.03 — ne pas re-proposer `realisee`) | `col_zd_realisee_horsregistre` (présente mais absente du registre)  | ★                |
| Enum `exports_registre.format` = `csv                                                | zip                                                                 | pdf` (F1 §06.03) | 3 exports, 1 par format | ★   |
| Colonne Traiteur = traiteur opérationnel (F4 §06.03)                                 | `ev_agence_caromy` (agence donneur d'ordre ≠ traiteur opérationnel) | ★                |
| Prédicat registre ≠ agence — `v_registre_dechets` (F6 §06.11)                        | `org_ag_caromy` sans accès registre                                 | ★                |

## §05 §8 — Onboarding

| Règle                                         | Objet fixture                                 | Dataset |
| --------------------------------------------- | --------------------------------------------- | ------- |
| Inscription friction minimale (étape 1 seule) | `org_tr_nomad` (compte nu, zéro collecte)     | ★       |
| Completion progressive avant 1re collecte     | `org_tr_grandchemin` (étape 2 incomplète)     | demo    |
| RPC `f_completer_siret_shadow` (F2 §06.11)    | `org_shadow_siret_incomplet` créée par agence | ★       |
| Trigger Cerfa auto (F4 §06.11)                | association seedée sans Cerfa → généré        | demo    |

## §05 §9 — Notifications / emails

| Règle                                                        | Objet fixture                           | Dataset |
| ------------------------------------------------------------ | --------------------------------------- | ------- |
| 19 templates actifs dont 3 tiers/admin (F2 §06.02)           | `email_templates` seed complet          | ★       |
| Échec Resend : statut `echec`, 3 retries, svix (F3 §06.02)   | `email_echec_3retries` + payloads inbox | ★       |
| Pack bas au franchissement (F4 §06.02)                       | `email_pack_bas_butard`                 | demo    |
| Alerte pesées **in-app seule** (pas de template — F2 §11-12) | aucun template seedé (test négatif)     | —       |

## §08 — APIs / intégrations (lot ⑩) — cf. [[04 - Fixtures API]]

| Règle                                                                             | Objet fixture                                                                   | Dataset |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------- |
| Clé dédup MTS-1 sans `occurred_at` (F1 §08)                                       | paires de payloads inbox dupliqués                                              | ★       |
| Polling Pennylane sans borne temporelle (F2 §08)                                  | mock réponse paginée                                                            | ★       |
| Dispatch bouton 3 branches : `non_envoye→E1` / `dirty→E2` / `rejetee→E1` (F3 §08) | `col_dispatch_non_envoye` ★ / `col_dispatch_dirty` ★ / `col_dispatch_rejetee` ★ |
| R_code_mts1_requis                                                                | `prest_sans_code_mts1` (rejet attendu)                                          | demo    |
| `outbox_events` (garde-fou 4)                                                     | 3 événements dont 1 non consommé                                                | ★       |
| Ingestion MTS-1 = polling V1 (pas de webhook entrant)                             | `integrations_logs` de polls                                                    | ★       |

## §09 — RLS transverse (lot ⑪) — cloisonnement

| Règle                                                                                             | Objet fixture                                                  | Dataset |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------- |
| Cloisonnement cross-org                                                                           | ≥ 2 traiteurs + 2 gestionnaires + 1 agence dans `seed_minimal` | ★       |
| `f_is_staff()` canonique (F2 RLS)                                                                 | 4 users staff (admin, ops ×2, commercial)                      | ★       |
| `cf_update_staff` pesées admin+ops (F1 RLS)                                                       | flux modifiables par staff                                     | ★       |
| `users` SELECT org-wide commercial (F4 RLS — demande Val)                                         | user `staff_commercial_01`                                     | ★       |
| Gestionnaire org-wide : invitation/désactivation users (F5 §06.05)                                | 2 users Viparis                                                | ★       |
| Factures SELECT self + `f_fichier_visible` (F6 §06.05)                                            | factures Viparis vs factures Kaspia                            | ★       |
| Brouillons tiers exclus (F3 §06.05)                                                               | `col_brouillon_tiers`                                          | ★       |
| `shared.fichiers` polymorphe 9 `entity_type` (scope strict factures, `documents_generaux` public) | fichiers répartis sur les 9 types                              | ★       |
| Agence V1 : users self only, Top 5 + bloc Utilisateurs retirés (F1 §06.11 — reconfirmé)           | `org_ag_caromy` 2 users                                        | ★       |
| Vue `v_referentiel_traiteurs` (F5 §06.11)                                                         | combobox agence alimentée                                      | ★       |
| `audit_log` (F1 §06.06)                                                                           | 5 entrées multi-acteurs                                        | ★       |

## §06.06 — Back-office (lot ⑥)

| Règle                                                | Objet fixture                 | Dataset |
| ---------------------------------------------------- | ----------------------------- | ------- |
| Packs ajuster/annuler ouverts ops (F2)               | pack ajusté avec `audit_log`  | ★       |
| SIREN + désactivation transporteurs ouverts ops (F3) | `prest_marathon` désactivable | demo    |
| Carte KPI AG (F4)                                    | volumes AG suffisants         | demo    |
| Fusion orgas retirée V1 (F6)                         | aucun objet (test négatif)    | —       |

---

# Volet TMS (2026-06-07)

## R1 — Attribution transporteur (M12)

| Règle                                                                                                             | Objet fixture                                                                               | Dataset    |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------- |
| R1.1 ZD IDF (param `'strike'`, `zd_idf_strike`)                                                                   | `ctms_zd_idf_*` → suggestion `prest_strike`                                                 | ★          |
| R1.2 AG : enum suggestion 9 valeurs (canonique `ag_marathon_volume_backup_camion`, + `ag_velo_fallback_marathon`) | `suggestions_attribution_log` couvrant les 9 valeurs                                        | demo (4 ★) |
| R1.2 AG province proximité (`ag_province_proximite`)                                                              | `ctms_ag_rouen` → `prest_transnormandie`                                                    | ★          |
| Garde ZD province (F7 M12)                                                                                        | `ctms_zd_rouen_garde` (pas de suggestion Strike)                                            | demo       |
| Garde zone tarifaire A Toutes! (R1.3, arbitrage Val 2026-06-07 — grande couronne hors 75/92/93/94)                | `ctms_ag_velizy_78` (lieu 78140 → fallback `ag_velo_fallback_marathon`, jamais A Toutes!)   | demo       |
| Mapping zones réel : 75 → paris, 92/93/94 → communes_limitrophes (préfixe département)                            | `zones_codes_postaux_mapping` seed §04 (réel, plus de calibration)                          | ★          |
| Cache `nb_collectes_6_mois_cache` (F6 M12)                                                                        | valeurs seedées cohérentes avec la timeline                                                 | ★          |
| R1.4 Alerte acceptation sans réponse 48 h/3 h (M02)                                                               | `ctms_attribuee_stale` (attribuée J-3 sans réponse) + alerte `m02_acceptation_sans_reponse` | ★          |
| Refus = `motif_refus` simple + audit (QO#8 M02)                                                                   | `ctms_refusee_motif`                                                                        | ★          |
| Collecte manuelle V1 (M02 7.3 — `origine`, `plateforme_collecte_id` NULL)                                         | `ctms_manuelle_01` ×2                                                                       | demo       |
| Réconciliation orpheline (M13 E6.c)                                                                               | `ctms_orpheline`                                                                            | demo       |

## R2 — Calcul coût tournée (M07)

**Grilles réelles fournies par Val 2026-06-07** (intégrées §05 R2.2-R2.5) — montants figés dans le seed.

| Règle                                                                                                                                                        | Objet fixture                                                                                                                          | Dataset |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| R2.2 `vacations_paliers` réelle Strike : vacation 4 h (240/300 €), dépassement /heure entamée (60/75 €), équipage double +31,25 €/h **sur dépassement seul** | `grille_strike_16m3` ★ / `grille_strike_20m3` + `tournee_strike_6h` (= 360 €, cas de référence Val) + `tournee_strike_double_equipage` | ★       |
| R2.3 `grille_matricielle_zone_type_course` réelle A Toutes! vélo — 8 cellules (Paris/limitrophes × programme/express × complète/incomplète)                  | `grille_atoutes_velo` + 1 tournée par mode (`tournee_atoutes_programme` ★, `tournee_atoutes_express` demo)                             | ★       |
| Seuil express `m07.atoutes_express_seuil_minutes` (**90** — confirmé Val 2026-06-07)                                                                         | tournée attribuée H-1 → cellule express                                                                                                | demo    |
| R2.4 `grille_matricielle_zone` — **aucune grille V1** (arbitrage Val : pas de grille camion A Toutes!)                                                       | aucun objet (test négatif : formule au catalogue, zéro grille l'instanciant)                                                           | —       |
| R2.5 `forfait_fixe` réel Marathon : **100 €/tournée** (répartition collecte_tournees divise)                                                                 | `grille_marathon_forfait` ★ + `tournee_marathon_2collectes` (50 €/collecte réparti)                                                    | ★       |
| R2.5 `forfait_km` (province, synthétique — presta fictif)                                                                                                    | `grille_transnor_km` ★ / `grille_transnor_fixe_expiree`                                                                                | ★/demo  |
| R2.6 sans grille = manuel V1 (camion A Toutes!)                                                                                                              | `tournee_atoutes_camion_manuelle` (coût saisi Ops)                                                                                     | demo    |
| R2.7 annulation seuil 3 h (facturée < 3 h / non > 3 h)                                                                                                       | `tournee_annulee_h2` + `tournee_annulee_h5`                                                                                            | ★       |
| R2.7bis annulation pendant `en_cours` = vacation facturée (annulation niveau collecte, EC6 M07)                                                              | `tournee_encours_collecte_annulee`                                                                                                     | ★       |
| R2.8 figement post-clôture + anti-rétroactivité (grille versionnée EXCLUDE)                                                                                  | `grille_strike_16m3_v2` (succession sans chevauchement) + tournées historiques `cout_calcule_ht` figé ≠ recalcul grille courante       | ★       |
| R2.10 flag `tarif_sans_collecte_applicable` (incomplète = 50 %)                                                                                              | `grille_atoutes_velo` (flag true — porté par A Toutes!, pas Strike)                                                                    | ★       |
| Trigger compagnon recalc horaires (`trg_m07_recalc_on_horaires`, #1 M07)                                                                                     | `tournee_horaires_modifies`                                                                                                            | ★       |
| Arrondi FLOOR (#4 M07)                                                                                                                                       | montants seedés à décimales non triviales                                                                                              | ★       |
| Ajustement W2 + log append-only                                                                                                                              | `ajustement_w2_01`                                                                                                                     | ★       |
| Répartition multi-collectes (`collecte_tournees`)                                                                                                            | tournées doubles (~80)                                                                                                                 | ★ (1)   |

## R3 — Rapprochement factures prestataires (M08)

| Règle                                                                                       | Objet fixture                                        | Dataset |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------- |
| R_M08.1 match exact → auto-valid                                                            | `facpresta_marathon_202604_ok`                       | ★       |
| Seuil écart 100 €                                                                           | `facpresta_strike_ecart_120` (rapprochement manuel)  | ★       |
| R3.5 contestation = avoir (D7)                                                              | `facpresta_contestee_avoir`                          | demo    |
| Contestation post-validation W6 (flag `conteste_apres_validation`, #2 M08)                  | `facpresta_valide_contestee` (déverrouille tournées) | demo    |
| R3.6 verrouillage agrégat période / R_M08.4                                                 | tournées des factures `valide` verrouillées          | ★       |
| R3.7 déverrouillage admin-only = trigger (`trg_factures_deverrouillage_admin_only`, #1 M08) | 1 `audit_logs` de déverrouillage                     | demo    |
| R3.8 1 facture = 1 période sans chevauchement (UNIQUE)                                      | factures mensuelles jointives, zéro overlap          | ★       |
| Re-rapprocher = `rapprochement_manuel_requis` (#3 M08)                                      | `facpresta_re_rapprochement`                         | demo    |
| CHECK montant > 0 / immuabilité R_M08.6                                                     | contraintes vérifiées par `seed:check`               | —       |
| `migration_test = true` exclu Pennylane (EC19/§13)                                          | lot migration ×2                                     | demo    |

## R4 — Stock rolls (M09)

| Règle                                                                       | Objet fixture                                                 | Dataset |
| --------------------------------------------------------------------------- | ------------------------------------------------------------- | ------- |
| R4.1 mise à jour stock à la tournée ZD                                      | mouvements liés aux tournées                                  | ★       |
| R4.2 alerte stock bas                                                       | `stock_butard_bas` + alerte                                   | ★       |
| R4.3 stock négatif = **warning** (`m09_stock_negatif`, F1 M09)              | `stock_grandchemin_negatif`                                   | ★       |
| R4.4 paliers rolls/pax (`palier_rolls_par_pax_seuils`, F4 M09)              | param seedé + tournée préparée                                | ★       |
| Correction = reversement delta (F2 M09 — modèle `rolls_mouvements` réécrit) | `mouv_correction_01`                                          | ★       |
| R_M09.5 recompte Ops trace écart                                            | `mouv_recompte_ecart`                                         | demo    |
| R_M09.6 tare modifiée = audit, pas de recalcul rétroactif                   | `type_contenant_tare_modifiee` (tares admin_tms only, F3 M09) | demo    |
| R_M09.8 archivage type interdit si stock > 0                                | `type_contenant_archivage_bloque`                             | demo    |
| Vue cross-schema `v_stocks_rolls`                                           | lecture App des stocks seedés                                 | ★       |

## R5 — Exutoires Veolia (M10)

| Règle                                                                                                  | Objet fixture                                       | Dataset |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------- |
| R5.1 passage non confirmé (criticité dynamique)                                                        | `passage_non_confirme_j1` + alerte                  | ★       |
| R5.2 annulation/report avec motif                                                                      | `passage_annule_motif`                              | demo    |
| R5.3 saturation entrepôt                                                                               | `stocks_bacs_entrepot` proche seuil à REF_DATE      | ★       |
| R5.4 reset total pleins à `realise` + trigger `trg_m10_reset_total_pleins`                             | `passage_realise_reset`                             | ★       |
| R5.5 auto-incrément `quantite_pleine` à clôture tournée ZD                                             | chaîne tournée → stock                              | ★       |
| R5.6 recomptage manuel Ops écart                                                                       | `recompte_bacs_ecart`                               | demo    |
| R5.7 transitions depuis état terminal interdites (étendue F3 2026-06-07)                               | tests négatifs sur `passage_realise_reset` / annulé | —       |
| R5.8 création a posteriori (E4 sans contrainte date, F1 M10 ; `statut_realise_at` = valeur saisie, F2) | `passage_aposteriori`                               | demo    |
| EC14 clamping vides 0 = alerte (F4 M10)                                                                | `passage_clamping_vides`                            | demo    |

## R6 — Cycles de vie

| Règle                                                                                                                                                                                                     | Objet fixture                                                 | Dataset |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------- |
| R6.1 `collectes_tms` : tous statuts + dérivation `realisee` multi-tournées + multi-camions chauffeur                                                                                                      | série `ctms_statut_*` + `ctms_multi_tournees`                 | ★       |
| R6.2 `tournees` : cycle `planifiee→acceptee→en_cours→terminee` (direct `planifiee→en_cours` interdit ; filet `acceptee→terminee` ; ajout collecte → repasse `planifiee` ; province directe `acceptee` W2) | ≥ 1 tournée par statut + `tournee_province_directe`           | ★       |
| R6.3 `factures_prestataires` : 7 statuts                                                                                                                                                                  | mix demo                                                      | ★ (3)   |
| R6.4 `shared.prestataires` (M06) : W5 cible actif/en_onboarding ; blocage E8 si tournées actives OU dispatch attribuee/acceptee (#1 M06) ; réactivation grille expirée tolérée (#2)                       | `prest_onboarding` + `prest_transnormandie` (grille expirée)  | demo    |
| R6.5 `tms.alertes` : ack admin_savr autorisé (F1 M11), manager SELECT only (F5), dedup_key GENERated, snooze hardcodé {1,4,24}                                                                            | `alerte_ack_admin_savr` ★, `alerte_snoozee`, archive critical |
| Oubli clôture 8 h = cron pg_cron (M04 #4)                                                                                                                                                                 | `tournee_oubli_8h` (en_cours depuis J-1)                      | demo    |

## R7 — App chauffeur (M05)

| Règle                                                                      | Objet fixture                                                                   | Dataset |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------- |
| R_M05.1 checklist bloquante — skip AG/vélo                                 | `tournee_zd_camion` (checklist requise) vs `tournee_ag` / `tournee_velo` (skip) | ★       |
| Géofence 300 m                                                             | points `chauffeurs_geolocalisation` in/out                                      | ★       |
| Pesée auto-tare + override motif                                           | `pesee_override_motif`                                                          | ★       |
| Repas 0,45 kg (AG)                                                         | conversion sur collectes AG miroir                                              | ★       |
| Photos `photos text[]` (fusion 2026-06-06)                                 | pesées + incidents avec 1-3 photos                                              | ★       |
| Chemin unique E5→S5 (`pas_excedents` retiré)                               | aucune fixture `realisee_sans_collecte` côté pesées TMS (test négatif)          | —       |
| Offline sync + DLQ 5 retries                                               | `pesee_batch_offline` + `integrations_logs` DLQ                                 | demo    |
| Device binding + purge géoloc 30 j                                         | `auth_sessions_tms` conflit + cohorte > 30 j                                    | demo    |
| Poids AG V1 = saisie manuelle Ops App (F1 §06.09 — **pas de webhook TMS**) | aucun flux TMS→App poids AG (test négatif)                                      | —       |

## M03 — Portail prestataire

| Règle                                                                                                                                              | Objet fixture                                                     | Dataset |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------- |
| Trigger `validate_tournee_controle_acces` : plaque ET chauffeur ; vélo cargo = plaque libre, chauffeur requis (S7 `plaque=null` + `chauffeur_nom`) | `tournee_controle_acces_camion` ★ + `tournee_controle_acces_velo` |
| Lock optimiste 409                                                                                                                                 | scénario sur `tournee_planifiee`                                  | ★       |
| R_M03.9/R_M03.11/R_M03.12 verrous post-facture + archivage bloqué                                                                                  | tournées des factures `valide`                                    | ★       |
| Contestation = email pré-rempli (QO#4 — pas de table)                                                                                              | aucun objet (test négatif)                                        | —       |
| Drill-down termes calcul (QO#2)                                                                                                                    | `detail` jsonb peuplé sur tournées facturées                      | ★       |

## M13 — Administration

| Règle                                                                              | Objet fixture                                                | Dataset |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------- |
| Wizard E7 4 étapes, grille bloquante (F1)                                          | `prest_onboarding` sans grille                               | demo    |
| Replay sortant `event_id` original + `tentative_num=1` (F2)                        | `intlog_replay_w6`                                           | demo    |
| Retry 3 paliers (5 min/1 h/24 h)                                                   | `intlog_retry_serie`                                         | ★       |
| `parametres_tms_read_staff` (F5)                                                   | lecture params sous JWT ops                                  | ★       |
| Impersonation                                                                      | `impersonation_01`                                           | demo    |
| Mode migration §13.4 : `migration_mode_active` + purge J+30 (`m13_cleanup_legacy`) | lot migration daté avril 2026 (purgeable autour de REF_DATE) | demo    |

## M14 — Everest 🔒 GATE

Aucune fixture `everest_missions` tant que le gate n'est pas levé (réponse dev Everest attendue). Acquis à seeder dès levée : `service_id` smallint (71, 75, 91), `everest_mission_id` nullable + CHECK (#3), W4/E4 → `acceptee` + S1 (#2), garde terminaux W2 (#4), policy RLS par jointure `tournees` (#1). Mocks placeholder : cf. [[04 - Fixtures API]] §4.

## RLS TMS (§09 — transverse)

| Règle                                                                                                             | Objet fixture                                                        | Dataset |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------- |
| Cloisonnement cross-presta                                                                                        | managers Strike + Marathon dans `seed_minimal`                       | ★       |
| Chauffeur : masquage `cout_calcule_ht`, horizon J+1, prédicat `auth.user_chauffeur_id()`                          | tournées J+1 vs J+5 seedées                                          | ★       |
| Géoloc + `auth_sessions_tms` policies (A1/A2 audit RLS)                                                           | données des 2 tables sous chaque persona                             | ★       |
| `tms.chauffeurs` (C1 — tranché, ne pas re-proposer `shared.`)                                                     | table seedée côté TMS                                                | ★       |
| Vues cross-schema `v_courses_logistiques` / `v_stocks_rolls` / colonne fantôme `marge_logistique` (F5 §06.08 App) | lecture App des données TMS seedées, grilles exclues de la whitelist | ★       |

---

## Trous identifiés (à lever avant script)

1. ~~Associations réelles~~ — **TRANCHÉ Val 2026-06-07 : fictif assumé** (`asso_alpha`…`asso_echo`, source de vérité réelle = backend Bubble, non repris dans les fixtures). Ne pas re-proposer.
2. **Everest** : fixtures bloquées par le 🔒 GATE pré-dev (réponse du dev Everest attendue). Placeholders dans [[04 - Fixtures API]], à compléter en session « spec Everest ».
3. ~~Grilles tarifaires réelles à substituer~~ — **SOLDÉ 2026-06-07** : grilles réelles fournies par Val et intégrées (§05 R2.2-R2.5 + fixtures). Seul reste synthétique : `forfait_km` Transnormandie (presta fictif — assumé). ~~Mapping zones à calibrer~~ — **SOLDÉ 2026-06-07** : mapping départemental réel figé §04 (75 → paris, 92/93/94 → communes_limitrophes, arbitrage Val petite couronne entière) + garde zone tarifaire M12.
4. Aucune règle §05 App ni §05 TMS (R1–R7) sans objet déclencheur identifié — couverture complète à date.

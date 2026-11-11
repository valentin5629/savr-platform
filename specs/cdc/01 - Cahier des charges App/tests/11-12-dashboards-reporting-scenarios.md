# Scénarios de test — §11 Dashboards + §12 Reporting et exports (lot ⑫)

**Source CDC** : [[11 - Dashboards]] + [[12 - Reporting et exports]] + [[05 - Règles métier]] (R_taux_recyclage, R_co2_calcul, R_co2_ag, R_co2_snapshot_fige, R_marge_zd_traiteur, R_revenus_imputation_organisation) + [[04 - Data Model]] (`rapports_rse`, `bordereaux_savr`, `attestations_don`, `exports_registre`, `documents_generaux_savr`, `f_benchmark_kg_pax_zd`, vues `v_kpi_*`, `v_registre_dechets`) + [[09 - Authentification et permissions]] (A8, A9, A10, matrices bordereaux/attestations)
**Généré le** : 2026-06-07

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests des modules §11 Dashboards et §12 Reporting/exports.
> Pour chaque scénario :
> - Couche `db` → écrire un test pgTAP dans `supabase/tests/`
> - Couche `api` → écrire un test Vitest dans `packages/plateforme/tests/api/`
> - Couche `ui` → écrire un test Playwright dans `packages/plateforme/tests/e2e/`
> Les tests P1-critique sont bloquants CI. Les tests P2 et P3 sont non-bloquants V1.
> Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.

> **Périmètre du lot** : §11 + §12 transverses. Les dashboards par rôle déjà testés dans leurs lots verticaux (§06.04 lot ④, §06.05 lot ⑤, §06.06 lot ⑥, §06.11 lot ⑨) ne sont PAS re-testés ici — ce lot couvre les règles communes (§11 §8/§9, R_revenus, vues `v_kpi_*`), le cycle de vie documentaire complet §12 (batch J+1, embargo H+24, régénération, snapshots) et les exports.

---

## Résumé de couverture

| Catégorie | Nb scénarios | Couverture |
|-----------|-------------|------------|
| 1. Happy path | 10 | Dashboard Admin actions/revenus/coûts, CA économique AG (patch M3.5), batch J+1, attestation AG, synthèse à la demande, CSV, rapport sans excédent |
| 2. Cas limites | 13 | Documents visibles dès l'émission, email à la clôture (48 h), k-anonymat =5/4 + seuil 3 acteurs, seuils g/pax min/max, taux NULL/0, marge NULL/négative, ≥2 lieux, kg→t |
| 3. Cas d'erreur | 9 | Embargo applicatif, périodes invalides, garde traiteur_ids, régénérations interdites, format export |
| 4. Isolation RLS | 11 | rapports_rse (4 chemins org), bordereaux, attestations, exports_registre, documents_generaux, matrice CSV |
| 5. Idempotence / états | 10 | Versions régénération, snapshots figés (caps, co2, benchmark), batch re-run, synthèse sans stockage |
| 6. Cross-app | 5 | S5 → realisee_at (base embargo), agrégation multi-camions, statut_tms cartes Admin, v_courses_logistiques |
| 7. Migration | 5 | Historique Bubble dans dashboards, historique_partiel, PDF importés, idempotence relance |
| **TOTAL** | **63** | |

---

## Catégorie 1 — Happy path

```gherkin
# Source : §11 §1.1 Bloc 1
# Couche : api
# Priorité : P1-critique

Scénario : dashboard_admin_quatre_cartes_actions
  Étant donné 1 collecte ZD "programmee" "statut_tms=non_envoye" "tms_reference IS NULL" (hors 48h), 1 collecte AG "programmee" "statut_tms=non_envoye" (hors 48h), 1 collecte "statut_tms=attribuee_en_attente_acceptation" (hors 48h), et 1 collecte "programmee" "statut_tms=a_attribuer" à J+1 (dans 48h, non verrouillée)
  Quand un admin_savr charge le Dashboard Admin
  Alors les 4 cartes « Non transmises ZD » / « Non transmises AG » / « En attente prestataire » / « Collectes <48h non validées » affichent respectivement 1 / 1 / 1 / 1 (rangée refondue 2026-07-15 : split Non transmises M3.5 + fusion 48h M3.6)
  Et le clic sur chaque carte redirige vers la liste Collectes §3 avec le chip miroir pré-appliqué (`non_transmises_zd` / `non_transmises_ag` / `attente_prestataire` / `collectes_48h_non_validees`), sans page intermédiaire
  Et la carte « non transmises » et son chip miroir comptent exactement le même ensemble : statut_tms='non_envoye' ET tms_reference IS NULL ET statut IN ('programmee','validee') — prédicat canonique tranché Val 2026-09-14
  Et aucune carte « Modifiées sans renvoi TMS » n'est affichée (retirée, décision Val 2026-10-28)
```

```gherkin
# Source : §11 §1.1 Bloc 2 — camembert de répartition (décision Val 2026-11-05, divergence M0.6_20261105)
# Couche : ui | Priorité : P2-important
Scénario : dashboard_admin_repartition_revenus_par_client
  Quand l'admin_savr consulte le Bloc 2 Revenus
  Alors un camembert affiche les 6 premiers clients par montant total HT et une part « Autres » égale au total de la période moins ces 6 clients
  Quand il bascule sur « ZD » puis « AG »
  Alors la répartition porte sur le montant ZD HT puis AG HT
    Et chaque bascule rejoue l'animation d'entrée du camembert, contrairement à un changement de filtre
```

```gherkin
# Source : §11 Bloc 2 Revenus — filtre unique et défaut de période (décisions Val 2026-07-18, divergences M3.5 / M35)
# Couche : ui | Priorité : P2-important
Scénario : dashboard_admin_revenus_defaut_12_mois
  Étant donné un `admin_savr` qui ouvre /admin/dashboard
  Alors le Bloc 2 Revenus affiche l'histogramme et le camembert de répartition par client côte à côte (50/50 à partir de lg), puis le tableau en pleine largeur dessous
    Et une SEULE barre de filtres (Période, Lieux, Traiteur, Agence, Gestionnaire de lieux) pilote les deux blocs
    Et la période par défaut est les 12 derniers mois glissants, alignés au 1er du mois (12 buckets mensuels pleins)
    Et ce n'est PAS le mois en cours (l'ancien défaut isolé du §11 est supprimé)
    Et aucune rangée de presets n'est affichée sous la barre ; les raccourcis standard (7 derniers jours … Année civile) figurent dans le panneau du filtre Période, comme sur tous les filtres de date (Val 2026-09-30)
    Et aucun bouton « Exporter CSV » n'est affiché (l'endpoint ?format=csv reste servi, sans déclencheur UI)
  Quand l'admin clique « Réinitialiser »
  Alors la période revient aux 12 derniers mois, pas au mois en cours
  Et la même liste de raccourcis figure dans le panneau Période des autres dashboards (traiteur §06.04, gestionnaire §06.05, agence) et du registre
```

```gherkin
# Source : §11 §1.1 Bloc 2 — filtres lieu et organisation (décision Val 2026-10-30)
# Couche : api | Priorité : P2-important
Scénario : dashboard_admin_revenus_filtres_lieu_organisation
  Étant donné un traiteur Kaspia qui a programmé 2 collectes et opéré 1 collecte programmée par l'agence Caromy
    Et un gestionnaire Viparis dont le parc compte le lieu Pavillon Gabriel, où 1 collecte a été programmée par un autre traiteur
  Quand l'admin coche Kaspia dans le filtre Traiteur
  Alors l'histogramme et le tableau comptent 3 collectes, imputées à Kaspia (2) et à Caromy (1)
    Et les 4 cartes « Suivi opérationnel » ne changent pas
  Quand l'admin coche aussi Viparis dans le filtre Gestionnaire de lieux
  Alors 4 collectes sont comptées (union des organisations cochées)
  Quand l'admin coche le seul lieu Pavillon Gabriel dans le filtre Lieux
  Alors seule la collecte tenue sur Pavillon Gabriel est comptée
  Quand l'admin clique « Réinitialiser les filtres »
  Alors la période revient aux 12 derniers mois et tous les lieux et organisations sont rétablis
```

```gherkin
# Source : §11 §1.1 Bloc 2 + §05 R_revenus_imputation_organisation
# Couche : db
# Priorité : P1-critique

Scénario : tableau_revenus_imputation_programmateur
  Étant donné une collecte ZD programmée par l'agence Mathilde M. avec traiteur opérationnel shadow "Maison X", facturée 450 € HT (facture "emise"), date_collecte dans le mois en cours
  Quand l'admin_savr consulte le tableau "Revenu par client" sur le mois en cours
  Alors la ligne porte le nom "Mathilde M." (organisation programmatrice, `evenements.organisation_id`)
  Et "Maison X" (traiteur opérationnel) n'apparaît sur aucune ligne du tableau
  Et le montant ZD HT de la ligne = 450,00 €
```

```gherkin
# Source : §11 §1.1 Bloc 2 (CA économique AG, patch divergence M3.5 2026-07-07)
# Couche : db
# Priorité : P1-critique

Scénario : revenus_ag_ca_economique_pas_facture_pack
  Étant donné un Pack 30 acheté par Kaspia en janvier (montant_total_ht 13 800 €, prix_unitaire_ht 460 €) avec facture achat_pack_antigaspi "payee" + un avoir de 300 € sur cette facture, et 2 collectes AG "realisee" en mars
  Quand l'admin_savr consulte l'histogramme Revenus et le tableau "Revenu par client" sur mars
  Alors le montant AG de mars = 920,00 € (2 × 460 €, imputé au mois de date_collecte)
  Et janvier n'affiche aucun montant AG issu de la facture d'achat de pack (pas de double comptage)
  Et l'avoir de 300 € sur le pack n'impacte pas le CA AG de pilotage (exclu, tranché Val 2026-07-07 — reste visible module Facturation)
  Et le montant ZD est le montant de la prestation de chaque collecte, au mois de date_collecte, sans lecture des factures (décision Val 2026-11-03)
```

```gherkin
# @v1-1 — DESCOPÉ V1.1 : Dashboard Admin Bloc 3 Coûts (coûts logistiques + marge brute) dépend de v_courses_logistiques sur tms.* inexistant en V1 (décision Val 2026-06-10). NON exécuté / NON bloquant CI en V1.
# Source : §11 §1.1 Bloc 3 + §04 v_courses_logistiques
# Couche : api
# Priorité : P3-nominal (V1.1)

Scénario : dashboard_admin_bloc_couts_et_marge
  Étant donné une collecte ZD facturée 600 € HT et un coût logistique agrégé de 180 € HT dans `v_courses_logistiques`
  Quand l'admin_savr consulte le Bloc 3 Coûts
  Alors la marge brute affichée pour la collecte = 420,00 €
  Et le split par prestataire (Strike / Marathon / A Toute! / province) somme exactement le total des coûts
```

```gherkin
# Source : §12 §1.1 + §1.2 + §06.02 template 6
# Couche : api
# Priorité : P1-critique

Scénario : batch_j1_genere_bordereau_et_rapport_rse
  Étant donné une collecte ZD Kaspia avec date_collecte = J-1, passée à "realisee" hier à 14h (realisee_at figé) avec 5 pesées de flux agrégées, puis "cloturee"
  Quand le batch automatique J+1 tourne à 6h00
  Alors une ligne `bordereaux_savr` est créée (statut "emis", numero séquence BSAV, detail_flux jsonb 5 flux, poids_total_kg = somme)
  Et `bordereaux_savr.date_collecte` = `collectes.date_collecte` (J-1, snapshot §04) et `date_emission` = jour du batch (J)
  Et les payloads PDF du bordereau et du rapport portent date_collecte = J-1 au format JJ/MM/AAAA (mention « Intervention le … » si ≠ date_evenement, §12 §1.1) — jamais la date d'exécution du batch
  Et une ligne `rapports_rse` est créée avec genere_par="automatique", version=1, disponible_a = realisee_at + 24h
  Et l'email `rapport_disponible` est envoyé au traiteur avec taux_recyclage et co2_evite
```

```gherkin
# Source : §12 §1.3 + §04 attestations_don + §05 R_co2_ag
# Couche : db
# Priorité : P1-critique

Scénario : attestation_don_ag_batch_avec_snapshot
  Étant donné une collecte AG cloturee avec attribution vers une association habilitée 2041-GE et volume_repas_realise = 120
  Quand le batch J+1 6h tourne
  Alors une `attestations_don` est créée : statut "emise", association_habilitation snapshotée, volume_repas = 120
  Et le PDF inclut la ligne CO₂e évité = 120 × 2,5 = 300 kg (snapshot `co2_facteurs_snapshot` type anti_gaspi)
  Et la mention fiscale 2041-GE est présente (association habilitée)
```

```gherkin
# Source : §12 §1.3-bis
# Couche : api
# Priorité : P1-critique

Scénario : rapport_sans_excedent_genere_batch_nightly
  Étant donné une collecte AG passée en "realisee_sans_collecte" (transition via webhook Everest, course vide AG) avec un motif chauffeur, sans rapport encore généré
  Quand le batch nightly `runBatchSansExcedent` (monté dans le cron J+1 6h) tourne
  Alors le PDF "Événement sans excédent alimentaire" (template `rapport_evenement_sans_excedent`) est généré, sans embargo H+24
  Et une ligne `rapports_rse` standard est créée avec disponible_a = genere_at (F1 tranchée 2026-06-07 — pas de colonne type)
  Et le batch est idempotent (skip si une ligne `rapports_rse` existe déjà pour la collecte)
  Et le PDF contient : heure de présentation chauffeur, nom chauffeur, motif déclaré, mention "Aucun repas n'a été collecté…"
  Et aucune `attestations_don` n'est créée pour cette collecte
  Et aucune photo n'est incluse dans le PDF (photos TMS accessibles back-office Admin seulement)
```

```gherkin
# Source : §12 §1.6
# Couche : api
# Priorité : P1-critique

Scénario : synthese_pdf_a_la_demande_traiteur
  Étant donné un traiteur_manager Kaspia avec 8 collectes cloturees (6 ZD + 2 AG) sur les 30 derniers jours
  Quand il clique "Exporter une synthèse PDF" depuis le Bloc 8 ZD, garde les filtres pré-remplis et génère
  Alors la Route API (Next.js, JWT du demandeur) génère le PDF via Railway/Puppeteer de façon synchrone et retourne une URL pré-signée Cloudflare R2 expirant à 1h
  Et seules les 6 collectes ZD sont agrégées (les 2 AG exclues — Type de collecte figé ZD)
  Et le PDF contient page de garde (logo, filtres en clair, nb collectes), les sections ZD applicables (1 chiffres clés, 2 flux + camembert, 5 évolution + courbe taux, 6 détail) et le taux moyen pondéré par tonnage, sans Section 3 AG
  Et aucune ligne n'est persistée en DB (pas de table `rapports_synthese`)
```

```gherkin
# Source : §12 §1.6 (sections selon le type sélectionné — tranché 2026-07-07 R20b-2)
# Couche : api
# Priorité : P1-critique

Scénario : synthese_sections_ag_seul
  Étant donné un traiteur_manager générant depuis le Bloc 8 AG (Type de collecte figé = AG)
  Quand il génère la synthèse
  Alors le PDF contient les sections AG (chiffres clés AG, Section 3 Anti-Gaspi + Top 3 assos, détail AG)
  Et il ne contient ni Section 2 flux ZD ni Section 5 évolution ZD

Scénario : synthese_type_decoche_couvre_zd_et_ag
  Étant donné le modal de génération avec le filtre « Types de collecte » décoché
  Quand l'utilisateur génère
  Alors le PDF couvre ZD + AG (toutes les sections applicables sont présentes)
```

```gherkin
# Source : §12 §1.6 (Section 4bis Ventilation par traiteur — gestionnaire uniquement)
# Couche : api
# Priorité : P2-important

Scénario : synthese_section_traiteur_gestionnaire_uniquement
  Étant donné un gestionnaire_lieux et un traiteur_manager générant chacun une synthèse sur un périmètre ≥ 2 traiteurs
  Quand chacun génère son PDF
  Alors le PDF du gestionnaire inclut la Section 4bis « Ventilation par traiteur » (traiteur · nb collectes · tonnage)
  Et le PDF du traiteur ne l'inclut pas (périmètre = organisation elle-même)
```

```gherkin
# Source : §12 §1.6 (agrégat vide — tranché 2026-07-07 R20b-2)
# Couche : api
# Priorité : P2-important

Scénario : synthese_agregat_vide_pdf_a_zero
  Étant donné des filtres ne matchant aucune collecte satisfaisant période + embargo H+24
  Quand l'utilisateur génère la synthèse
  Alors un PDF valide est produit avec les sections à zéro et la mention « Aucune collecte sur la période »
  Et le bouton de génération n'est jamais bloqué
```

```gherkin
# Source : §12 §1.6 étape 2 (filtres Client organisateur + Commercial dans la modale)
# Couche : api
# Priorité : P2-important

Scénario : synthese_filtres_client_commercial_dans_modale
  Étant donné un traiteur_manager ouvrant le modal de synthèse (barre 5-dimensions BL-P2-12 déférée)
  Quand la modal charge l'étape 2
  Alors les filtres Client organisateur et Commercial sont des multi-selects natifs de la modal
  Et ils sont alimentés par GET /api/v1/dashboards/synthese-pdf/filtres scopé par rôle
  Et côté gestionnaire_lieux ces deux filtres ne sont pas affichés
```

```gherkin
# Source : §12 §2 Format
# Couche : api
# Priorité : P2-important

Scénario : export_csv_format_fr_et_filtres_actifs
  Étant donné un traiteur_manager ayant filtré sa liste Collectes sur janvier 2026 (3 collectes)
  Quand il clique "Exporter"
  Alors le CSV téléchargé contient exactement 3 lignes de données, séparateur ";", UTF-8, headers français
  Et les colonnes `date_evenement` ET `date_collecte` sont présentes au format DD/MM/YYYY HH:MM
  Et les poids en kg utilisent la virgule décimale
```

```gherkin
# Source : §11 §7 + §05 R_co2_calcul (allégations CO₂, décision Val 2026-11-09)
# Couche : ui
# Priorité : P2-important

Scénario : dashboard_client_organisateur_co2_evite_seul
  Étant donné un client_organisateur rattaché à des événements ZD clôturés
  Quand il consulte l'onglet ZD
  Alors seul le CO₂e évité estimé est affiché, suivi de la phrase de garde-fou et du lien « Voir la méthode » vers /methode-co2
  Et ni CO₂ induit, ni bilan net, ni énergie primaire ne sont affichés pour ce rôle
  Et le bandeau de tête commun affiche la synthèse RSE annuelle YTD
  Et aucune donnée financière ni benchmark n'est visible
```

---

## Catégorie 2 — Cas limites métier

```gherkin
# Source : §12 Vue d'ensemble (embargo supprimé, décision Val 2026-11-04, divergence M1.6_20261104)
# Couche : api
# Priorité : P1-critique

Scénario : document_visible_des_emission
  Étant donné une collecte realisee_at = 2026-06-01T14:00:00Z dont le rapport RSE est émis à 2026-06-01T15:00:00Z (disponible_a = instant d'émission)
  Quand le traiteur accède au rapport à 2026-06-01T15:00:01Z
  Alors l'accès réussit, sans attendre realisee_at + 24h
```

```gherkin
# Source : §12 §1.1/§1.2 (batch toutes les 15 min, email à la clôture, décision Val 2026-11-04, divergence M1.6_20261104)
# Couche : api
# Priorité : P2-important

Scénario : email_document_part_a_la_cloture
  Étant donné une collecte realisee hier à 23h00 dont les pesées sont saisies
  Quand le batch des documents passe
  Alors la ligne `rapports_rse` existe avec disponible_a = instant d'émission et le rapport est visible tout de suite
  Et l'email rapport_disponible part une seule fois, à la clôture (realisee_at + 48h)
```

```gherkin
# Source : §05 R_taux_recyclage cas particuliers
# Couche : db
# Priorité : P1-critique

Scénario : taux_recyclage_null_exclu_ponderation_synthese
  Étant donné 3 collectes ZD : A (taux 80 %, tonnage 100 kg), B (taux 60 %, tonnage 50 kg), C (taux NULL — total pesées = 0)
  Quand la synthèse §1.6 calcule le taux moyen pondéré
  Alors le résultat = (80×100 + 60×50) / 150 = 73,3 % (C exclue de la pondération)
  Et l'UI affiche "—" pour la collecte C, jamais "0 %"
```

```gherkin
# Source : §05 R_taux_recyclage cas particuliers
# Couche : db
# Priorité : P2-important

Scénario : taux_recyclage_zero_si_omr_seul
  Étant donné une collecte ZD dont la seule pesée est 40 kg de dechet_residuel
  Quand le trigger de clôture calcule le taux
  Alors `collectes.taux_recyclage` = 0.00 (et non NULL)
```

```gherkin
# Source : §04 f_benchmark_kg_pax_zd (k-anonymat)
# Couche : db
# Priorité : P1-critique

Scénario : benchmark_k_anonymat_borne_cinq
  Étant donné un segment benchmark avec exactement 5 collectes parc et un autre avec 4, tous deux répartis sur >= 3 acteurs distincts
  Quand `f_benchmark_kg_pax_zd` est appelée sur chaque segment
  Alors le segment à 5 collectes retourne un ratio_benchmark
  Et le segment à 4 collectes est exclu de la réponse (HAVING nb_collectes_segment >= 5 côté serveur)
  Et le front affiche l'axe du radar grisé sans repère parc + "Données insuffisantes pour benchmark"
```

```gherkin
# Source : §04 f_benchmark_kg_pax_zd — période fixe 24 mois (décision Val 2026-09-28)
# Couche : api
# Priorité : P1-critique

Scénario : benchmark_periode_fixe_24_mois_serveur
  Étant donné un appel à /api/v1/dashboards/benchmark avec periode_debut = 2020-01-01 et periode_fin = 2020-12-31
  Quand la route calcule le repère parc un 29/09/2026 (jour civil Paris)
  Alors la RPC est appelée avec p_periode_debut = 2024-09-29 et p_periode_fin = 2026-09-29 (paramètres reçus ignorés)
  Et il en va de même pour la fiche collecte et le rapport PDF (légende « période : AAAA-MM-JJ → AAAA-MM-JJ »)
  Et /api/v1/admin/dashboard-client/benchmark applique la même fenêtre fixe de 24 mois (plus jamais « tout l'historique ») sans appeler la RPC : référence calculée sans k-anonymat (cf. benchmark_admin_reference_filtres_sans_k_anonymat, lot ⑥)
  Et un 29 février, la borne de début est le 28 février deux ans plus tôt
  Et l'encart « Filtres benchmark » n'affiche aucun choix de période
```

```gherkin
# Source : §04 f_benchmark_kg_pax_zd (k-anonymat acteurs, durci 2026-09-22)
# Couche : db
# Priorité : P1-critique

Scénario : benchmark_k_anonymat_acteurs_insuffisants
  Étant donné un segment benchmark de 5 collectes appartenant toutes au MEME acteur
  Quand `f_benchmark_kg_pax_zd` est appelée sur ce segment
  Alors le segment est exclu de la réponse (< 3 acteurs distincts — minimum entre organisations programmatrices et traiteurs opérationnels)
  Et le même segment réparti sur 3 acteurs est publié
  Et la même garde s'applique au PDF rapport RSE via `f_rapport_benchmark_zd` — le gabarit PDF ne rejoue pas le seuil lui-même
```

```gherkin
# Source : §12 §1.5 (seuils g/pax)
# Couche : db
# Priorité : P1-critique

Scénario : alerte_pesee_bornes_min_max (paramétré × 4)
  Étant donné une collecte ZD realisee de 100 pax et les seuils biodéchets [15, 150] g/pax
  Quand le contrôle g/pax s'exécute à réception du webhook S5 (statut realisee)
  Alors avec 1,5 kg de biodéchets (15 g/pax = min exact) → PAS d'alerte
  Et avec 1,4 kg (14 g/pax < min) → alerte in-app back-office Admin (flux, valeur, plage, lien collecte — F2 tranchée 2026-06-07 : pas d'email)
  Et avec 15 kg (150 g/pax = max exact) → PAS d'alerte
  Et avec 15,1 kg (151 g/pax > max) → alerte in-app back-office Admin
  Et aucun email n'est envoyé (aucun template pesée anormale §06.02)
```

```gherkin
# Source : §12 §1.5 (agrégat par flux)
# Couche : db
# Priorité : P2-important

Scénario : alerte_pesee_somme_pesees_multiples_meme_flux
  Étant donné une collecte ZD 100 pax avec 3 pesées successives du flux verre : 0,8 + 0,7 + 0,6 kg (total 2,1 kg = 21 g/pax, min verre = 20)
  Quand le contrôle s'exécute
  Alors aucune alerte n'est levée (le contrôle porte sur le TOTAL agrégé du flux, pas sur chaque pesée individuelle)
```

```gherkin
# Source : §05 R_marge_zd_traiteur cas particuliers
# Couche : db
# Priorité : P2-important

Scénario : marge_zd_null_et_negative
  Étant donné le dashboard traiteur Kaspia filtré sur une période sans collecte ZD
  Quand la grandeur marge se calcule via l'endpoint kpi-traiteur
  Alors l'endpoint retourne NULL (plus affichée en carte KPI — retrait rangée, décision Val 2026-07-13, réversible) ; ancienne UI affichait "—"
  Et sur une période où Σ factures HT (620 €) > tarif×pax (1,50 × 383 = 574,50 €), l'endpoint retourne la valeur négative (affichage carte rouge retiré — décision Val 2026-07-13) "−45,50 €"
```

```gherkin
# Source : §05 R_marge_zd_traiteur (pax des collectes ZD, lot 3)
# Couche : db
# Priorité : P1-critique

Scénario : marge_zd_distinct_pax_multi_collectes
  Étant donné un événement de 500 pax portant 2 collectes ZD clôturées le même soir (mid-event 300 convives + fin-event 200 convives), tarif_refacture = 1,50 €
  Quand le revenu du KPI Marge se calcule
  Alors le revenu = 1,50 × (300 + 200) = 750 € (chaque collecte compte ses propres convives, et non 1 500 € en reprenant les 500 de l'événement pour chacune — lot 3, décision Val Q3 du 2026-10-25)
```

```gherkin
# Source : §11 §8 (unités)
# Couche : ui
# Priorité : P3-nominal

Scénario : bascule_kg_vers_tonnes_a_10000
  Étant donné un KPI tonnage à 9 999 kg puis 10 000 kg
  Quand le dashboard s'affiche
  Alors 9 999 s'affiche en "9 999 kg" et 10 000 en "10 t" (seuil auto à 10 000 kg, patch M3.5 2026-07-07)
```

```gherkin
# Source : §12 §1.6 Section 4
# Couche : api
# Priorité : P3-nominal

Scénario : synthese_section_geo_seulement_si_deux_lieux
  Étant donné une génération de synthèse dont le périmètre filtré couvre 1 seul lieu
  Quand le PDF est généré
  Alors la Section 4 — Ventilation géographique est absente
  Et avec 2 lieux dans le périmètre, elle est présente
```

```gherkin
# Source : §05 R_co2_ag cas particuliers
# Couche : db
# Priorité : P2-important

Scénario : co2_ag_zero_si_sans_collecte
  Étant donné une collecte AG terminée en realisee_sans_collecte
  Quand le trigger de clôture branche AG s'exécute
  Alors co2_evite_kg = 0 et co2_induit_kg / co2_net_kg / energie_primaire_evitee_kwh restent NULL
```

```gherkin
# Source : §11 §8 (état vide)
# Couche : ui
# Priorité : P3-nominal

Scénario : dashboard_etat_vide_explicite
  Étant donné un traiteur sans aucune collecte sur la période sélectionnée
  Quand le dashboard se charge
  Alors le message exact "Aucune collecte sur la période sélectionnée. Ajustez les filtres ou programmez votre première collecte." s'affiche (pas de cadrans à 0 silencieux)
```

```gherkin
# Source : §04 f_benchmark (comparaison à soi-même)
# Couche : ui
# Priorité : P3-nominal

Scénario : benchmark_avertissement_comparaison_a_soi
  Étant donné un gestionnaire qui applique p_lieu_ids = ses propres lieux uniquement
  Quand le radar Bloc 3 ZD se charge
  Alors le tooltip "Vous comparez vos données à vos propres données" s'affiche, sans blocage SQL
```

```gherkin
# Source : §12 §1.2 page 1 — refonte du contenu (décision Val 2026-10-02)
# Couche : api (gabarit rapport-recyclage-zd@3)
# Priorité : P2-important

Scénario : rapport_recyclage_radar_flux_masque_retire
  Étant donné une collecte ZD cloturee sans verre collecté, dont le repère parc « carton » est masqué (k-anonymat)
  Quand le rapport de recyclage est généré avec le bloc benchmark coché
  Alors le radar base 100 porte 3 axes (biodéchets, emballages, déchet résiduel) et la liste à droite donne kg/convive, repère parc, badge d'écart et nombre de collectes du segment
  Et avec moins de 3 axes exploitables la liste est affichée seule, sans radar
  Et l'en-tête affiche le nom du client organisateur, la date de collecte (pas la date de l'événement), l'adresse du lieu et le poids par convive
  Et le bloc carbone ne porte ni équivalence « repas bœuf » ni mention d'incertitude (±50 % figure dans la méthodologie)
  Et au plus 2 photos sont affichées, uniquement celles que l'équipe Savr a choisies (aucune photo choisie = pas de bloc photos), et la comparaison au parc ne cite pas le nombre d'organisations
```

---

## Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : §12 Vue d'ensemble (embargo applicatif)
# Couche : api
# Priorité : P1-critique

@deprecated
# Embargo supprimé (décision Val 2026-11-04, divergence M1.6_20261104) : un rapport n'existe qu'une fois émis, et il est alors visible de tous.
Scénario : acces_direct_rapport_sous_embargo_refuse
  Étant donné un rapport RSE dont disponible_a est dans 10h et un traiteur_manager connaissant l'id du rapport
  Quand il appelle directement l'API de téléchargement (contournement UI)
  Alors la réponse est 403 avec un message explicite mentionnant la date de disponibilité
  Et aucun pdf_url signé n'est retourné
```

```gherkin
# Source : §12 §1.6 (formulaire modal)
# Couche : api
# Priorité : P2-important

Scénario : synthese_periode_invalide_rejetee
  Étant donné le modal de génération de synthèse
  Quand l'utilisateur soumet date_debut > date_fin, puis une période avec borne dans le futur
  Alors chaque soumission est rejetée avec un message de validation (aucun appel de génération parti)
```

```gherkin
# Source : §04 f_benchmark_kg_pax_zd (garde traiteur)
# Couche : db
# Priorité : P1-critique

Scénario : benchmark_filtre_traiteur_ids_interdit_cote_traiteur
  Étant donné un JWT rôle traiteur_manager
  Quand `f_benchmark_kg_pax_zd` est appelée avec p_traiteur_ids = ['{uuid_kardamome}']
  Alors la fonction lève EXCEPTION 'Filter traiteur_ids[] forbidden for traiteur role' (fail fast, avant tout calcul)
```

```gherkin
# Source : §04 f_benchmark_single_collecte (grain single_collecte)
# Couche : db
# Priorité : P1-critique

Scénario : benchmark_collecte_inaccessible_exception
  Étant donné un traiteur_manager Kaspia et une collecte appartenant à Kardamome
  Quand il appelle f_benchmark_single_collecte(p_collecte_id) sur la collecte Kardamome
  Alors la fonction lève EXCEPTION 'Collecte not accessible'
```

```gherkin
# Source : §12 §1.1 + §1.3 + §1.3-bis (régénérations admin-only)
# Couche : api
# Priorité : P1-critique

Scénario : regeneration_bordereau_et_attestation_interdites_traiteur
  Étant donné un traiteur_manager
  Quand il tente de régénérer un bordereau de pesée §1.1, une attestation de don §1.3 ou un rapport sans excédent §1.3-bis
  Alors les trois tentatives sont refusées (régénération admin_savr uniquement)
  Et le rapport de recyclage §1.2 ne se régénère pas non plus : il se télécharge, fabriqué au clic (décision Val 2026-10-16)
  Mais quand il dépose, remplace ou retire le logo du client de l'événement (programmateur ou traiteur opérationnel, hors règle D12), l'attestation et le rapport sans excédent déjà produits sont refaits automatiquement — seul le logo est relu (décision Val 2026-10-30)
```

```gherkin
# Source : §05 R_co2_snapshot_fige (commentaire obligatoire)
# Couche : api
# Priorité : P2-important

Scénario : modification_facteur_co2_sans_commentaire_refusee
  Étant donné un admin_savr sur l'écran Paramètres facteurs CO₂
  Quand il soumet un nouveau fe_evite sans commentaire (ou < 5 caractères)
  Alors la modification est refusée
  Et avec commentaire valide, la ligne history (`parametres_facteurs_co2_history`) est créée
```

```gherkin
# Source : §04 exports_registre.format (enum csv|zip|pdf)
# Couche : db
# Priorité : P2-important

Scénario : export_registre_format_hors_enum_rejete
  Étant donné une tentative d'INSERT `exports_registre` avec format = 'excel'
  Quand l'INSERT s'exécute
  Alors il échoue sur la contrainte enum (valeurs autorisées : csv, zip, pdf)
```

```gherkin
# Source : §12 §1.6 (traitement synchrone)
# Couche : api
# Priorité : P3-nominal

Scénario : synthese_timeout_generation
  Étant donné une génération de synthèse qui dépasse le timeout de 2 min
  Quand la génération (Route API + Railway/Puppeteer) expire
  Alors le modal affiche un état d'échec explicite (pas de spinner infini)
  Et aucun fichier orphelin n'est conservé sur R2
```

```gherkin
# Source : §05 R_taux_recyclage (modification taux de captation)
# Couche : api
# Priorité : P2-important

Scénario : modification_taux_captation_ops_refusee
  Étant donné un ops_savr authentifié
  Quand il appelle PUT /api/v1/admin/parametres/taux-recyclage/{filiere_id}
  Alors la requête est refusée (admin_savr uniquement)
  Et aucune ligne `parametres_taux_recyclage_history` n'est créée
```

---

## Catégorie 4 — Isolation données (RLS)

```gherkin
# Source : §09 A8 rr_select
# Couche : db
# Priorité : P1-critique

Scénario : rapports_rse_cross_org_denied
  Étant donné un rapport RSE d'un événement Kaspia
  Quand un traiteur_manager Kardamome exécute SELECT sur `rapports_rse`
  Alors 0 ligne retournée (pgTAP : rapports_rse_cross_org_denied)
```

```gherkin
# Source : §09 A8 rr_select (4 chemins d'accès)
# Couche : db
# Priorité : P1-critique

Scénario : rapports_rse_quatre_chemins_select_ok (paramétré × 4)
  Étant donné un événement avec organisation programmatrice A, traiteur opérationnel B, client organisateur C, lieu rattaché au gestionnaire D
  Quand chacun (user de A, B, C, D) exécute SELECT sur le rapport RSE de l'événement
  Alors les 4 SELECT retournent la ligne (organisation_id / traiteur_operationnel / client_organisateur / organisations_lieux)
```

```gherkin
# Source : §09 C1 f_fichier_visible branche rapports_rse (aligné f_collecte_visible — M3.4 2026-06-17)
# Couche : db
# Priorité : P1-critique

Scénario : f_fichier_visible_rapport_rse_quatre_chemins (paramétré × 4)
  Étant donné un fichier shared.fichiers (entity_type='plateforme.rapports_rse') lié à un rapport RSE
  Et un événement avec organisation programmatrice A, traiteur opérationnel B, client organisateur C, lieu rattaché au gestionnaire D
  Quand f_fichier_visible est évaluée pour un user de A, B, C ou D
  Alors les 4 évaluations retournent true (pgTAP : fichier_rapport_rse_client_orga_ok / fichier_rapport_rse_gestionnaire_lieu_ok)
  Et f_fichier_visible pour un user org E (hors événement) retourne false (pgTAP : fichier_rapport_rse_cross_org_denied)
```

```gherkin
# Source : §09 A8 rr_write_admin
# Couche : db
# Priorité : P1-critique

Scénario : rapports_rse_write_non_admin_denied
  Étant donné un traiteur_manager et un ops_savr
  Quand chacun tente UPDATE sur `rapports_rse` (version, regenere_at)
  Alors les deux écritures sont refusées (policy rr_write_admin : admin_savr seul + système)
```

```gherkin
# Source : §09 matrice bordereaux_savr
# Couche : db
# Priorité : P1-critique

Scénario : bordereaux_cross_org_denied_et_gestionnaire_ok
  Étant donné un bordereau d'une collecte sur le lieu du gestionnaire G, programmée par le traiteur Kaspia
  Quand un traiteur Kardamome SELECT → 0 ligne
  Et quand le gestionnaire G SELECT (via collecte → evenement → lieu → organisations_lieux) → 1 ligne
  Et quand Kardamome tente UPDATE → refus (écriture admin/auto uniquement)
```

```gherkin
# Source : §09 matrice attestations_don
# Couche : db
# Priorité : P1-critique

Scénario : attestations_don_org_scoped
  Étant donné une attestation de don d'une collecte AG Kaspia
  Quand traiteur_commercial Kaspia SELECT → 1 ligne (lecture org-wide 2026-05-29)
  Et quand traiteur_manager Kardamome SELECT → 0 ligne
```

```gherkin
# Source : §09 A10 er_select / er_insert
# Couche : db
# Priorité : P1-critique

Scénario : exports_registre_trace_self_only
  Étant donné 2 exports tracés : un par user U1 (orga A), un par user U2 (orga A aussi)
  Quand U1 SELECT sur `exports_registre`
  Alors il ne voit QUE son propre export (user_id = auth.uid()), pas celui de U2 même même orga
  Et admin_savr et ops_savr voient les deux
```

```gherkin
# Source : §09 A10 er_insert
# Couche : db
# Priorité : P1-critique

Scénario : exports_registre_insert_usurpation_denied
  Étant donné un user U1 de l'orga A
  Quand il tente INSERT avec user_id = U2 ou organisation_id = orga B
  Alors les deux INSERT sont refusés (WITH CHECK user_id = auth.uid() AND organisation_id = son orga)
```

```gherkin
# Source : §09 A10 dg_read / dg_write
# Couche : db
# Priorité : P2-important

Scénario : documents_generaux_public_actif_seulement
  Étant donné un document méthodologie actif=true et une ancienne version actif=false
  Quand un client_organisateur SELECT
  Alors seul le document actif est visible ; la version inactive n'est visible que par admin/ops
  Et un traiteur_manager qui tente INSERT/UPDATE est refusé (écriture admin_savr seule)
```

```gherkin
# Source : §12 §2 matrice exports par profil
# Couche : api
# Priorité : P1-critique
# Mise à jour 2026-06-19 (M4.1/D1) : "Courses logistiques" hors scope V1 (tms.* inexistant) → remplacé par cas gestionnaire_lieux/Associations + cas 404 entité inconnue

Scénario : matrice_exports_csv_par_profil (paramétré × 4)
  Étant donné la matrice §12 §2 (7 entités V1 — "Courses logistiques" hors scope V1)
  Quand un traiteur_commercial demande l'export "Pesées par flux", "Associations bénéficiaires AG", "Impact RSE consolidé" ou "Packs AG" → servi (révision Val 2026-10-30 ; Packs AG : reco validée Val 2026-11-02, dette code migration d'élargissement)
  Et quand un gestionnaire_lieux demande l'export "Associations bénéficiaires AG" → refusé (—)
  Et quand une agence demande l'export "Associations bénéficiaires AG" → refusé (—)
  Et quand admin_savr demande l'export "courses-logistiques" → refusé 404 (entité non supportée V1 — EXPORT_MATRIX ne la connaît pas)
```

```gherkin
# Source : §04 f_benchmark (SECURITY DEFINER, pas de SELECT brut)
# Couche : db
# Priorité : P1-critique

Scénario : benchmark_pas_de_select_brut_table_base
  Étant donné un traiteur_manager authentifié
  Quand il exécute SELECT direct sur `mv_benchmark_kg_pax_zd_base`
  Alors l'accès est refusé (seule f_benchmark_kg_pax_zd SECURITY DEFINER agrège cross-org, k-anonymat appliqué)
```

```gherkin
# Source : §12 §1.6 RLS (Route API JWT demandeur)
# Couche : api
# Priorité : P1-critique

Scénario : synthese_perimetre_rls_du_demandeur
  Étant donné un gestionnaire_lieux G générant une synthèse
  Quand la Route API agrège les collectes (JWT de G)
  Alors seules les collectes de ses lieux (`organisations_lieux`) + celles qu'il a programmées entrent dans le PDF
  Et aucune collecte d'un lieu hors périmètre n'apparaît en Section 6, même si la période la couvre
```

---

## Catégorie 5 — Idempotence et états

```gherkin
# Source : §12 §1.2 + §1.4 + §04 rapports_rse
# Couche : api
# Priorité : P1-critique

Scénario : rapport_recyclage_correction_pesee_reprise_au_telechargement
  Étant donné une collecte ZD clôturée dont le rapport a déjà été téléchargé
  Quand l'admin corrige une pesée
  Alors aucune régénération n'est lancée et aucune ligne `rapports_rse` n'est modifiée (version, regenere_at, pdf_url inchangés)
  Et le téléchargement suivant fabrique un rapport qui reprend la pesée corrigée (décision Val 2026-10-16)
  Et le PDF du rapport de recyclage ne porte AUCUNE mention de régénération
```

```gherkin
# Source : §12 §1.1 + §1.2 (batch J+1)
# Couche : db
# Priorité : P1-critique

Scénario : batch_j1_rejoue_sans_doublon
  Étant donné un batch J+1 6h déjà passé sur une collecte (bordereau + rapport créés)
  Quand le batch est relancé manuellement le même jour (incident, re-run)
  Alors aucune 2e ligne `bordereaux_savr` (UNIQUE collecte_id) ni `rapports_rse` n'est créée
```

```gherkin
# Source : §12 §1.3 + §05 R_co2_ag (régénération auto attestation)
# Couche : db
# Priorité : P1-critique

Scénarios : attestation_regeneree_auto_sur_correction_volume
  Étant donné une attestation émise avec volume_repas = 120 (co2_evite 300 kg)
  Quand l'admin corrige `attributions_antgaspi.volume_repas_realise` à 100
  Alors l'attestation est régénérée automatiquement : version=2, volume_repas=100, co2_evite_kg recalculé à 250 avec nouveau snapshot
  Et la version précédente est marquée supersédée (indicateur visuel + date)
```

```gherkin
# Source : §05 R_co2_snapshot_fige + R_taux_recyclage (snapshot)
# Couche : db
# Priorité : P1-critique

Scénario : modification_facteur_sans_effet_sur_collectes_figees
  Étant donné une collecte cloturee avec taux_recyclage=78,4 % et co2_* figés (snapshots caps_appliques + co2_facteurs_snapshot)
  Quand l'admin modifie un taux de captation et un facteur CO₂
  Alors taux_recyclage, co2_* et les snapshots de la collecte restent strictement inchangés
  Et le rapport re-téléchargé reprend ces valeurs figées (taux de recyclage, CO₂)
```

```gherkin
# Source : §04 parametres_co2_divers (km_collecte_aller_retour = 15, décision Val 2026-10-20) + §05 R_co2_calcul
# Couche : db
# Priorité : P2-important

Scénario : co2_forfait_transport_15km
  Étant donné km_collecte_aller_retour = 25 et un facteur transport de 0,4 kgCO₂e/km (IVECO 20 m³ diesel, décision Val 2026-11-06)
  Quand une collecte ZD est clôturée
  Alors la part transport de co2_induit_kg vaut 10 kg CO₂e, quelle que soit la taille de la collecte
  Et une collecte déjà clôturée avant le changement garde ses valeurs figées
```

```gherkin
# Source : §05 R_taux_recyclage + R_co2_snapshot_fige (recalcul)
# Couche : db
# Priorité : P1-critique

Scénario : recalcul_apres_correction_pesee_facteurs_du_moment
  Étant donné une collecte cloturee figée avec les anciens taux de captation, puis une modification des taux par l'admin
  Quand l'admin corrige une pesée (realisee → cloturee re-déclenché)
  Alors taux_recyclage et co2_* sont recalculés avec les facteurs DU MOMENT DU RECALCUL (pas les anciens)
  Et caps_appliques + co2_facteurs_snapshot sont réécrits avec les nouveaux taux + horodatage
```

```gherkin
# Source : §12 §1.2 — rapport de recyclage fabriqué au clic, rien n'est stocké (décision Val 2026-10-16 ; remplace benchmark_pdf_reproductible_via_snapshot)
# Couche : api
# Priorité : P1-critique

Scénario : rapport_radar_calcule_au_telechargement
  Étant donné un rapport de recyclage ZD déjà téléchargé avec le radar
  Quand de nouvelles collectes du parc modifient la moyenne benchmark, puis le traiteur télécharge à nouveau le rapport avec d'autres filtres
  Alors le radar du PDF et sa liste par flux reflètent la moyenne et les filtres du moment du téléchargement
  Et `rapports_rse.filtres_benchmark` n'est pas écrit et aucun PDF n'est stocké
  Et la légende sous le graphe liste les filtres appliqués (période, lieux, type, taille — jamais traiteurs)
```

```gherkin
# Source : §12 §1.2 + §06.04 « Lien avec rapport RSE » — divergence M3.1 2026-09-22, option (a)
# Couche : db
# Priorité : P1-critique

Scénario : benchmark_agregation_segments_ponderee_ecran_et_pdf
  Étant donné deux segments parc sur le même flux : (0,30 kg/pax ; nb_collectes_segment = 5)
    et (0,40 kg/pax ; nb_collectes_segment = 15), tous deux au-dessus du k-anonymat (>= 5 collectes et >= 3 acteurs distincts)
  Quand le point de comparaison parc est calculé pour l'écran (aggregateBenchmarkPerFlux)
    et pour le PDF rapport RSE (f_rapport_benchmark_zd)
  Alors les deux retournent 0,375 kg/pax (moyenne pondérée par nb_collectes_segment)
  Et aucun des deux ne retourne 0,350 (moyenne simple non pondérée — comportement PDF avant 2026-09-22)
  Et le cas est atteint sans action utilisateur : type d'événement ou bracket de taille absent
    -> retombée sur les 5 brackets, donc plusieurs segments
```

```gherkin
# Source : §04 f_benchmark_kg_pax_zd + f_benchmark_single_collecte + f_rapport_benchmark_zd (lot C1 — décisions Val C3 2026-10-22, C4 2026-10-20, Q4 2026-10-24)
# Couche : db
# Priorité : P1-critique

Scénario : benchmark_grain_collecte_type_taille_pax_zero
  Étant donné un événement « Gala » de deux soirées : collecte ZD n°1 « Cocktail apéritif » 300 convives et collecte ZD « Repas assis » 600 convives, toutes deux clôturées (événement à 900 convives, type recopié « Cocktail apéritif »)
  Quand f_benchmark_kg_pax_zd agrège le parc
  Alors la collecte « Repas assis » entre dans le segment (Repas assis, M) avec son poids et ses 600 convives
  Et la collecte n°1 entre dans le segment (Cocktail apéritif, S) avec ses 300 convives
  Et aucune des deux n'entre dans un segment L ni n'est divisée par 900
  Quand f_benchmark_single_collecte est appelée sur la collecte « Repas assis »
  Alors ratio_user = poids du flux / 600, sur le segment (Repas assis, M)
  Et f_rapport_benchmark_zd compare le PDF de cette collecte au même segment que l'écran
  Étant donné une collecte ZD clôturée à 0 convive (inconnu, reprise Bubble) avec 80 kg de biodéchet
  Alors elle n'entre dans aucun segment : ni son poids, ni ses convives, ni dans nb_collectes_segment
  Et f_benchmark_single_collecte rend ratio_user = NULL pour elle (pas de point « Vous »)
```

```gherkin
# Source : §12 §1.3 (snapshot habilitation)
# Couche : db
# Priorité : P2-important

Scénario : attestation_valide_apres_perte_habilitation
  Étant donné une attestation émise avec mention 2041-GE (association habilitée au moment T)
  Quand l'association perd son habilitation
  Alors l'attestation passée reste inchangée (snapshot `association_habilitation`)
  Et une NOUVELLE attestation pour cette association est émise SANS mention fiscale
```

```gherkin
# Source : §12 §1.6 (pas de stockage)
# Couche : api
# Priorité : P2-important

Scénario : synthese_regenerable_a_volonte_sans_trace_db
  Étant donné un traiteur générant 3 fois la même synthèse (mêmes filtres)
  Quand les 3 générations aboutissent
  Alors aucune contrainte d'unicité ne bloque, aucune ligne DB n'est créée, 3 PDF distincts téléchargés
```

```gherkin
# Source : §05 R_marge_zd_traiteur (calcul live)
# Couche : api
# Priorité : P2-important

Scénario : marge_dashboard_calcul_live_non_fige
  Étant donné un KPI Marge affiché à 300 € avec une facture en brouillon (exclue)
  Quand la facture passe à "emise" et le dashboard est rechargé
  Alors la marge intègre immédiatement le nouveau montant (vue à la volée, pas de snapshot dashboard)
```

```gherkin
# Source : §12 §1.4 (première consultation)
# Couche : api
# Priorité : P3-nominal

Scénario : consulte_par_user_at_pose_une_seule_fois
  Étant donné un rapport jamais consulté (consulte_par_user_at NULL)
  Quand le traiteur l'ouvre 2 fois
  Alors consulte_par_user_at est posé à la 1re consultation et n'est PAS écrasé à la 2e
  Et le back-office Admin affiche l'indicateur "rapport consulté"
```

```gherkin
# Source : §12 §1.2 Blocs optionnels + Régénération manuelle (décision Val 2026-10-02) + §04 rapports_rse.options_rapport
# Couche : api + ui
# Priorité : P1-critique

Scénario : telechargement_rapport_avec_ou_sans_radar
  Étant donné une collecte ZD clôturée dont l'embargo H+24 est écoulé (ligne rapports_rse posée par le batch J+1, aucun PDF fabriqué)
  Quand un utilisateur autorisé à lire le rapport (traiteur manager ou commercial, agence, gestionnaire de lieux) ouvre l'onglet « Bilan & documents » de la fiche collecte
  Alors le bouton bascule « Intégrer la comparaison au rapport à télécharger » (à côté du radar) est désactivé à l'ouverture
  Quand il règle les filtres de comparaison, active le bouton et clique sur « Télécharger le rapport » dans le pied de la fiche
  Alors il reçoit un PDF qui porte le radar calculé avec ces filtres sous son identité
  Et le PDF contient toujours le taux, les tonnages, le bloc carbone, l'en-tête, la méthodologie et la page 2 (bordereau intégré) quand le demandeur peut lire le bordereau sous sa RLS — sinon page 1 seule (§12 §1.7, décision Val 2026-10-27)
  Quand un autre utilisateur télécharge le rapport sans activer la comparaison
  Alors il reçoit un PDF sans radar, et le premier n'en est pas modifié (rien n'est stocké)
  Et le premier téléchargement par un client pose rapports_rse.consulte_par_user_at
  Et un téléchargement demandé par un utilisateur d'une autre organisation répond 403
```

---

## Catégorie 6 — Scénarios cross-app (Plateforme ↔ TMS)

> §11/§12 n'exposent **aucun endpoint propre** dans le contrat §08 — modules 100 % Plateforme. La couverture cross-app se limite aux **enchaînements consommateurs** de S5/S2/S3 (déjà testés unitairement aux lots ⑩ App et M01-M14 TMS) et à la vue cross-schema `v_courses_logistiques`. Justification : pas de test HMAC/retry/dédup redondant ici.

```gherkin
# Source : §12 Vue d'ensemble + §04 collectes.realisee_at
# Couche : api
# Priorité : P1-critique

Scénario : s5_pose_realisee_at_base_embargo
  Étant donné un webhook S5 `collecte-terminee` (statut realisee) reçu pour une collecte ZD
  Quand le webhook est traité
  Alors `collectes.realisee_at` est posé à l'horodatage du passage à realisee
  Et la clôture est planifiée à realisee_at + 48h ; rapports_rse.disponible_a vaudra l'instant d'émission du document (décision Val 2026-11-04)
```

```gherkin
# Source : §12 §1.5 (agrégation multi-camions S5)
# Couche : api
# Priorité : P1-critique

Scénario : multicamions_agregat_s5_pas_de_faux_positif
  Étant donné une collecte ZD 1000 pax servie par 2 camions, le TMS agrégeant les pesées (60 kg biodéchets total) sous la collecte avant S5
  Quand le contrôle g/pax s'exécute (60 g/pax, plage [15,150])
  Alors AUCUNE alerte n'est levée (volume complet rapporté au pax complet — pas de demi-volume sur pax complet)
  Et le bordereau et le rapport RSE portent les totaux agrégés des 2 camions sous la collecte unique
```

```gherkin
# Source : §11 §1.1 Bloc 1 (miroir statut_tms)
# Couche : api
# Priorité : P2-important

Scénario : carte_admin_attente_validation_suit_s2_s3
  Étant donné une collecte dont statut_tms passe à "attribuee_en_attente_acceptation" (effet S2)
  Quand le Dashboard Admin se recharge
  Alors la carte "Collectes en attente de validation prestataire" l'inclut
  Et après acceptation prestataire (effet S3 → statut_tms acceptee), elle en sort
```

```gherkin
# @v1-1 — DESCOPÉ V1.1 : Dashboard Admin Bloc 3 Coûts (somme coûts tournées multi-camions) dépend de v_courses_logistiques sur tms.* inexistant en V1 (décision Val 2026-06-10). NON exécuté / NON bloquant CI en V1.
# Source : §11 §1.1 Bloc 3 + §04 v_courses_logistiques (cross-schema)
# Couche : db
# Priorité : P3-nominal (V1.1)

Scénario : couts_dashboard_somme_tournees_multi_camions
  Étant donné une collecte multi-camions avec 2 tournées TMS à parts de coût 120 € et 90 €
  Quand le Bloc 3 Coûts lit `v_courses_logistiques`
  Alors le coût logistique de la collecte = 210 € (somme des parts des N tournées)
  Et la marge brute utilise ce total
```

```gherkin
# Source : §12 §1.3-bis (données S5 sans excédent)
# Couche : api
# Priorité : P2-important

Scénario : rapport_sans_excedent_donnees_tms
  Étant donné un S5 realisee_sans_collecte portant motif chauffeur et heure de présentation
  Quand le PDF est généré
  Alors heure de présentation (`tournees.heure_debut_reelle`), nom chauffeur et motif proviennent des données poussées par le TMS
  Et la plaque n'apparaît QUE si controle_acces_requis = true sur la collecte
```

---

## Catégorie 7 — Scénarios de migration (Bubble → Supabase)

> Référence : [[13 - Migration depuis Bubble]]. Env dev, dataset `seed_demo`.

```gherkin
# Source : §13 (historique complet) + §11 §9 vues v_kpi_*
# Couche : db
# Priorité : P1-critique

Scénario : dashboards_integrent_historique_bubble
  Étant donné 24 mois de collectes Bubble migrées en statut cloturee
  Quand le dashboard traiteur charge l'histogramme 12 mois glissants et les KPI
  Alors les collectes migrées sont incluses dans les agrégats (v_kpi_* ne filtrent pas l'origine)
  Et le registre et les rapports historiques restent accessibles (continuité reporting RSE client)
```

```gherkin
# Source : §13 (historique_partiel F3 2026-06-07)
# Couche : db
# Priorité : P1-critique

Scénario : historique_partiel_sans_crash_agregats
  Étant donné une collecte migrée flaggée historique_partiel=true sans pesées détaillées (taux_recyclage NULL, co2_* NULL)
  Quand dashboards et synthèse §1.6 agrègent la période
  Alors la collecte compte dans "Nb collectes" mais est exclue de la pondération taux et des sommes co2_*
  Et l'UI affiche "—" sur ses métriques, aucun calcul ne lève d'erreur
```

```gherkin
# Source : §13 (bordereaux et attestations émis)
# Couche : db
# Priorité : P2-important

Scénario : pdf_importes_accessibles_sans_regeneration
  Étant donné des bordereaux/attestations Bubble importés (PDF existants rattachés)
  Quand le batch J+1 6h tourne après migration
  Alors AUCUNE régénération automatique n'est déclenchée sur les collectes migrées (pas d'écrasement des PDF historiques)
  Et les documents importés sont téléchargeables avec la RLS standard
```

```gherkin
# Source : §13 (check réconciliation reporting)
# Couche : db
# Priorité : P1-critique

Scénario : reconciliation_kpi_bubble_vs_supabase
  Étant donné un échantillon seed_demo migré
  Quand le check de réconciliation compare nb collectes / tonnage total / nb rapports entre source Bubble et Supabase
  Alors les compteurs sont strictement égaux (check vert)
  Et en cas de corruption simulée (1 collecte supprimée), le check échoue et le rollback restaure l'état initial
```

```gherkin
# Source : §13 (idempotence script)
# Couche : db
# Priorité : P1-critique

Scénario : relance_migration_sans_doublon_documents
  Étant donné un script de migration déjà exécuté (collectes + bordereaux + rapports importés)
  Quand le script est relancé intégralement
  Alors aucun doublon n'est créé (UNIQUE bordereaux_savr.collecte_id + numéros BSAV/ATT-DON préservés)
  Et les compteurs post-relance sont identiques à la première exécution
```

---

## Specs floues — TRANCHÉES Val 2026-06-07 (propagées §11 + §12 + §04 + §09)

### F1 — BLOQUANT (tranché : ligne `rapports_rse` standard)
Le PDF « sans excédent » §1.3-bis n'avait aucune table porteuse (`type_rapport` retiré V1, slug absent des 9 `entity_type`). **Décision Val** : ligne `rapports_rse` **standard**, pas de colonne discriminante, `disponible_a = genere_at` (pas d'embargo), `entity_type = 'plateforme.rapports_rse'` existant. Propagé §12 §1.3-bis + §04.

### F2 — (tranché : alerte in-app seule — inverse de la reco, ne pas re-proposer de template)
L'email immédiat « pesées anormales » §1.5 n'avait aucun template §06.02. **Décision Val** : **alerte in-app back-office seule**, email retiré — pas de 20e template. Propagé §12 §1.5 + tableau Décisions.

### F3 — (tranché : Next.js API Route SERVICE_ROLE)
Régénération manager §1.2 morte au niveau RLS (A8 admin-only). **Décision Val** : canal **Next.js API Route SERVICE_ROLE** (aligné 9.1.16, ex-Edge Function 2026-07-07) avec contrôle applicatif du périmètre (mêmes 4 chemins que `rr_select`), policy `rr_write_admin` inchangée. Test P1 `test_rapports_rse_regen_cross_org_denied` ajouté. Propagé §12 §1.2 + §04 + §09 A8.

### F4 — (tranché : prédicat explicite)
Inclusion synthèse §1.6 = `statut = 'cloturee' AND realisee_at + interval '24h' <= now()` (aligné embargo canonique). Propagé §12 §1.6.

### F5 — (tranché : `emise|payee`, avoirs en négatif — ZD seul depuis patch M3.5 2026-07-07)
Histogramme Revenus §11 Bloc 2 = mêmes statuts que R_revenus_imputation_organisation, avoirs comptés en négatif sur leur mois d'émission. Propagé §11 §1.1. **Amendé 2026-07-07 (patch divergence M3.5)** : cette règle ne vaut plus que pour le **ZD** ; le montant AG = CA économique (coût/collecte pack × collectes AG livrées `realisee`/`cloturee`, imputé au mois de `date_collecte`), factures `achat_pack_antigaspi` et avoirs pack exclus du CA AG de pilotage (revenu comptable = module Facturation).

### Note non bloquante — CO₂/taux des collectes migrées (À CONFIRMER)
§13 ne dit pas si les collectes Bubble migrées reçoivent un calcul rétroactif taux/CO₂ ou restent NULL. Le scénario `historique_partiel_sans_crash_agregats` assume **NULL sans recalcul rétroactif** (snapshot « facteurs du moment » non reconstituable). À confirmer en session migration, sinon simple note d'implémentation.

---

## Scénarios filtre période dashboards (DASHBOARDS_20260618)

```gherkin
# Source : DASHBOARDS_20260618 — filtre période dashboard = date_collecte (PR #62, 2026-06-18)
# Couche : api
# Priorité : P1-critique

Scénario : dashboard_filtre_periode_date_collecte (M3.2 gestionnaire)
  Étant donné une collecte C1 avec date_collecte=2026-05-15 et realisee_at=NULL
  Et une collecte C2 avec date_collecte=2026-03-01 et realisee_at=2026-05-10
  Quand `gest_viparis` appelle GET /api/v1/gestionnaire/dashboard?from=2026-05-01&to=2026-05-31
  Alors C1 est dans le périmètre (date_collecte ∈ [from, to])
  Et C2 est hors périmètre (date_collecte=2026-03-01 < from)
  Et le dashboard n'est pas vide (realisee_at NULL n'exclut pas C1)
  # Régression PR #62 : avant le fix, realisee_at NULL excluait silencieusement C1

Scénario : kpi_filtre_periode_date_collecte (M3.6 dashboard client admin)
  Étant donné les mêmes collectes C1 et C2
  Quand `admin_savr` appelle GET /api/v1/admin/dashboard-client?from=2026-05-01&to=2026-05-31&organisation_id=<org>
  Alors C1 est dans le périmètre et C2 hors périmètre (parité M3.2)
  Et le filtre porte sur `date_collecte`, jamais sur `realisee_at`
```

---

## Scénarios hors scope (V1.1 / V2)

- **QR code vérification + lien de partage public 90j** : reportés V1.1 (§12 A1 sobriété 2026-06-03) — aucun scénario.
- **Export REP Citeo (§12 §3)** : V1.1, données déjà collectées — aucun scénario V1.
- **Notice méthodologique CSRD (bloc "À INTÉGRER")** : contenu éditorial à figer au rendu graphique — pas de scénario automatisable.
- **Persistance préférences filtres** : `localStorage` navigateur (sobriété B1) — pas de table serveur, test UI léger seulement (hors P1).
- **Vues matérialisées `mv_kpi_*`** : supprimées V1 (sobriété A1) — ne pas tester de refresh cron ; seule `mv_benchmark_kg_pax_zd_base` (refresh quotidien) reste, couverte via f_benchmark.


## Ajouts divergences 2026-10-13 (run cdc-patch-divergences)

```gherkin
Scénario : liste_organisateur_sans_excedent
  Étant donné une collecte AG « réalisée sans collecte »
  Quand le client organisateur ouvre l'onglet Anti-Gaspi de sa liste Collectes
  Alors la colonne Statut affiche « Réalisée »
  Et la colonne Repas affiche « Sans excédent », jamais « 0 »

Scénario : export_collectes_sans_excedent_zero_repas
  Étant donné une collecte AG « réalisée sans collecte »
  Quand un export CSV Collectes ou Impact RSE est produit
  Alors la colonne Statut vaut « Réalisée » (export Collectes)
  Et la colonne « Repas AG » vaut 0
```

## Ajouts divergences 2026-10-20 (run cdc-patch-divergences — Rapport de don, M2.4)

```gherkin
Scénario : rapport_de_don_titre_imprime_des_deux_pdf
  Étant donné une collecte AG clôturée avec une attestation de don émise
  Quand son PDF est rendu
  Alors le titre imprimé est « Rapport de don » et le sous-titre « Attestation de don »
  Et le numéro ATT-DON et les mentions fiscales sont ceux d'avant
  Étant donné une collecte AG au statut « réalisée sans collecte »
  Quand son PDF est rendu
  Alors le titre imprimé est « Rapport de don » et le sous-titre « Événement sans excédent alimentaire »
  Et le bloc Conséquences dit « Aucun don n'ayant eu lieu, ce rapport ne vaut pas reçu fiscal. »

Scénario : rapport_de_don_nom_du_fichier_servi
  Étant donné une collecte AG clôturée dont l'attestation porte le numéro ATT-DON-2026-00001
  Quand un utilisateur autorisé télécharge son document
  Alors le fichier servi s'appelle « rapport-de-don-ATT-DON-2026-00001.pdf »
  Étant donné une collecte AG « réalisée sans collecte » de l'événement « Gala » du 2026-10-09
  Quand un utilisateur autorisé télécharge son document
  Alors le fichier servi s'appelle « rapport-de-don-2026-10-09-gala.pdf »
  Étant donné une collecte ZD
  Quand un utilisateur autorisé télécharge son rapport de recyclage
  Alors aucun nom de fichier n'est imposé
```

### Ajouts cdc-patch-divergences 2026-11-02 — logo du client sur les rapports de don (M1.6_20261030)

```gherkin
# Source : §12 §1.2 « Logos du client et du traiteur » + §09 « Logo du client de l'événement » (fiche M1.6_20261030_logo-client-rapport-de-don, décision Val 2026-11-02 ; dette code : garde serveur)
# Couche : api
# Priorité : P1-critique

Scénario : logo_client_qui_peut_remplacer_ou_seulement_deposer
  Étant donné un événement programmé par Kaspia sur un lieu Viparis, client organisateur Danone, sans logo client
  Quand le gestionnaire Viparis dépose un logo depuis la fiche collecte
  Alors le dépôt est accepté (aucun logo existant), tracé `logo_client_depose` dans audit_log
  Quand le gestionnaire Viparis tente ensuite de le remplacer ou de le retirer
  Alors la route répond 403 (gestionnaire tiers : dépôt seulement)
  Et le client organisateur Danone, depuis la fiche événement, reçoit aussi 403 au remplacement comme au retrait
  Quand un commercial de Kaspia (organisation programmatrice) le remplace
  Alors le remplacement est accepté et les rapports de don déjà produits de l'événement sont refaits avec le nouveau logo
  Et l'Admin Savr peut le retirer depuis l'onglet Documents de sa fiche collecte
  Et le traiteur opérationnel d'un événement programmé par une agence peut remplacer ou retirer, sauf dès que l'événement porte une collecte AG non annulée et non « sans excédent » (règle D12 : « Réservé à l'organisation qui a programmé la collecte »)

Scénario : logo_client_cascade_et_attestation
  Étant donné un événement programmé par l'agence WPM (logo agence) avec un logo client déposé sur l'événement
  Quand l'attestation de don d'une de ses collectes AG est produite
  Alors l'en-tête porte le logo client déposé à côté du logo Savr, jamais le logo du traiteur
  Et un fichier de plus de 1 Mo est refusé au dépôt
```

### Ajouts cdc-patch-divergences 2026-11-02 — lot A : barre de filtres sur tous les dashboards (M3_20261030) et animation d'entrée des graphiques (DS_20261028)

```gherkin
# Source : §11 §7 Dashboard client_organisateur + §06.06 §2 Dashboard Client + §06.04 Barre de filtres globale (fiche M3_20261030_barre-filtres-tous-dashboards, décision Val 2026-11-02)
# Couche : ui
# Priorité : P2-important

Scénario : barre_filtres_dashboard_organisateur
  Étant donné un client organisateur rattaché à des événements opérés par Kaspia et Butard sur 3 lieux depuis 24 mois, dont une collecte brouillon sur un 4e lieu et une collecte annulée chez un 3e traiteur
  Quand il ouvre son dashboard
  Alors la barre propose Période, Lieux, Traiteurs, Type d'événement, Taille d'événement et « Réinitialiser les filtres »
  Et la liste Lieux propose les 3 lieux, la liste Traiteurs Kaspia et Butard (ni le 4e lieu ni le 3e traiteur : brouillons et annulées écartés des options)
  Quand il filtre sur un lieu
  Alors les cadrans et cartes des onglets ZD et AG sont recalculés sur les seules collectes de ce lieu
  Et le bandeau de tête (synthèse YTD) reste calculé sur l'année entière, non filtré

Scénario : barre_filtres_dashboard_client_admin
  Étant donné l'Admin sur le Dashboard Client avec l'organisation Kaspia choisie
  Quand il ouvre la barre de filtres
  Alors elle porte, après Période et Organisations, Lieux, Traiteurs, Type d'événement et Taille d'événement, toutes sans choix
  Et les listes Lieux et Traiteurs proposent ceux des collectes des 24 derniers mois de Kaspia (programmatrice OU traiteur opérationnel), brouillons et annulées écartés
  Et un Type ou une Taille choisis dans la barre ne modifient pas les filtres de l'encart « Comparer avec » du radar
```

```gherkin
# Source : 10 - Design System §4.5 `--motion-chart` (fiche DS_20261028_entree-graphiques-dashboards, décision Val 2026-11-02)
# Couche : ui
# Priorité : P3-nominal

Scénario : graphiques_animation_entree_une_fois
  Étant donné le dashboard du gestionnaire, dont le bloc Anti-Gaspi est sous la ligne de flottaison
  Quand la page s'ouvre
  Alors les graphiques visibles se construisent en environ 600 ms (barres depuis leur pied, courbes de gauche à droite, donut dans le sens horaire, radar depuis son centre, jauges depuis la gauche)
  Et un graphique hors de l'écran ne s'anime qu'une fois au moins un quart visible
  Quand il change la période ou un filtre
  Alors les graphiques déjà animés se mettent à jour sans rejouer l'animation
  Et quitter la page puis y revenir rejoue l'animation ; dans une fiche collecte, ouvrir une autre collecte la rejoue, changer d'onglet non
  Et avec `prefers-reduced-motion: reduce`, ou à l'impression, les graphiques s'affichent directement sans animation
```

### Ajouts cdc-patch-divergences 2026-11-02 — exports Collectes et Événements : codes VIPARIS et poids par flux (M3.2_20261102_codes-viparis-site-affaire)

```gherkin
# Source : §12 §2 Exports CSV Collectes et Événements (demande VIPARIS, décision Val 2026-11-02)
# Couche : api
# Priorité : P2-important

Scénario : export_collectes_entetes_code_affaire_et_poids_par_flux
  Étant donné un gestionnaire Viparis, une collecte ZD clôturée sur un lieu PCP d'un événement au code affaire « 26SIAL1 » (biodéchets 120 kg, verre 40 kg) et une collecte AG réalisée de 35 repas
  Quand il exporte la liste Collectes
  Alors les en-têtes sont, dans l'ordre : Date événement ; Date collecte ; Heure ; Événement ; Code affaire VIPARIS ; Lieu ; Code postal ; Ville ; Traiteur ; Client organisateur ; Type ; Statut ; Tonnage ZD (kg) ; Biodéchets (kg) ; Emballages (kg) ; Cartons (kg) ; Verre (kg) ; Déchet résiduel (kg) ; Taux recyclage (%) ; CO2 évité (kg) ; Repas AG
  Et la ligne ZD porte « 26SIAL1 », 120 en Biodéchets, 40 en Verre et 0 ou vide dans les autres flux, la ligne AG porte des flux vides et 35 en Repas AG
  Et une collecte d'un lieu sans code ou d'un événement sans code affaire a une colonne Code affaire VIPARIS vide
  Et le code est lu en service_role pour les seuls événements des lignes lues sous la RLS du demandeur

Scénario : export_evenements_entetes_code_affaire_et_poids_par_flux
  Étant donné un événement au code affaire « 26SIAL1 » avec 2 collectes ZD (biodéchets 120 et 80 kg) et 1 collecte AG
  Quand l'utilisateur exporte la liste Événements
  Alors la colonne `code_affaire_viparis` suit `nom_evenement`
  Et la colonne `code_site_viparis` (« Code site VIPARIS ») suit `lieu`, avec le code site du lieu de l'événement, vide pour un lieu sans code site
  Et cinq colonnes Biodéchets, Emballages, Cartons, Verre, Déchet résiduel (kg) suivent `tonnage_zd_kg`, cumulées sur les collectes ZD de l'événement (Biodéchets = 200)
  Et la colonne des repas AG donnés garde son libellé
```


```gherkin
# Source : §11 §1.1 Bloc 2 + §05 R_revenus_imputation_organisation (décisions Val 2026-11-03, divergences M3.5_20261103)
# Couche : api
# Priorité : P1-critique

Scénario : revenus_statuts_comptes_et_annulation_tardive
  Étant donné pour Kaspia sur la période : une ZD programmee (prestation 600 €), une AG realisee débitée d'un pack à 130 €, une ZD annulee 2 h avant le créneau sans incident (annulation_tardive = true, prestation 450 €), une ZD annulee 2 jours avant (annulation_tardive = false), une ZD brouillon et une ZD rejetee_par_prestataire
  Quand l'admin_savr consulte l'histogramme « Revenus par mois » et le tableau « Revenu par client »
  Alors Kaspia compte 3 collectes pour 1 180 € HT (600 + 130 + 450)
  Et ni le brouillon, ni le refus, ni l'annulation non tardive ne sont comptés, et aucune facture n'est lue
  Et une annulation antérieure au 2026-11-03 (annulation_tardive NULL) n'est pas comptée
```

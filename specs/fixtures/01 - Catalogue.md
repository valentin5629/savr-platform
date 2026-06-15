# 01 - Catalogue fixtures — Plateforme Savr (App) + TMS

**Créé** : 2026-06-07 (session `cdc-seed-fixtures`, périmètre App V1) — **complété volet TMS le 2026-06-07**
**Statut** : figé — arbitrages Val 2026-06-07 (App matin, TMS après-midi)
**Périmètre** : tables `plateforme.*` + `shared.*` du §04 App, et tables `tms.*` du §04 TMS (volet TMS ci-dessous).

---

## Principes actés (décisions Val 2026-06-07)

1. **2 datasets** : `seed_minimal` (dev quotidien + tests automatisés, reset < 30 s) et `seed_demo` (démo commerciale + E2E, timeline 12 mois, reset < 5 min).
2. **Noms d'organisations réels** (clients/prospects CRM + 100 % des lieux Viparis). **Toutes les personnes, coordonnées et montants sont fictifs** : emails `@savr-test.local`, téléphones `+33 6 99 99 XX XX`, SIRET du range de test INSEE, montants synthétiques. Aucune vraie donnée de contact. Un `seed_anonymized` (extrait Bubble masqué) viendra éventuellement après `cdc-migration-data` (Phase 10).
3. **Tous les traiteurs sont ZD + AG** (décision Val). Kaspia prédomine sur le ZD.
4. **Volume réel** : ~40 collectes/mois tous traiteurs confondus, saisonnalité événementielle calée sur les vacances scolaires (cf. `03 - Timeline seed_demo.md`).
5. **Paramètres référentiel** (tares, paliers, seuils pesées, facteurs CO₂, mix emballages, coefficients perte labo, `parametres_algo`) : **seed technique placeholder** — calibration terrain pré-go-live (action externe Val, cf. Suivi). Identique dans les 2 datasets.
6. **Déterminisme total** : UUID dérivés (uuid v5) des slugs, dates figées relatives à `SEED_REF_DATE = 2026-06-01`. Aucune génération aléatoire au run (cf. `05 - Spec d'injection.md`).

---

## Casting organisations (noms réels)

### Traiteurs — 8 (`seed_demo`), 3 (`seed_minimal` ★)

| Slug | Organisation | Profil fixture | Particularités couvertes |
|---|---|---|---|
| `org_tr_kaspia` ★ | Kaspia | Gros, **dominant ZD** (~30 % du volume ZD) | Tarif négocié hors grille, volume max |
| `org_tr_fleurdemets` ★ | Fleur de Mets | Moyen, client confirmé, ZD+AG nominal | Cas nominal complet, pack AG actif |
| `org_tr_cirette` ★ | Cirette | Petit, **province (Rouen)**, pack AG 30 | Transporteur province, `controle_acces` simple |
| `org_tr_potel` | Potel et Chabot | Gros | **2 entités de facturation** (multi-entité) |
| `org_tr_lenotre` | Lenôtre | Gros | Pack épuisé + rachat |
| `org_tr_butard` | Butard Enescot | Moyen | Pack bas ≤ 10 % (badge) |
| `org_tr_grandchemin` | Grand Chemin | Moyen | Onboarding incomplet (étape 2 non finie) |
| `org_tr_nomad` | Nomad Traiteur | Petit | Compte créé, **zéro collecte** (état vide) |

### Gestionnaires de lieux — 3 (`seed_demo`), 2 (`seed_minimal` ★)

| Slug | Organisation | Lieux rattachés |
|---|---|---|
| `org_ge_viparis` ★ | Viparis | **10 lieux** (demo) / 3 (minimal) — liste officielle 2026 ci-dessous |
| `org_ge_artsforains` ★ | Musée des Arts Forains | 1 lieu |
| `org_ge_trianon` | Trianon - Élysée Montmartre | 1 lieu |

### Agences — 2 (`seed_demo`), 1 (`seed_minimal` ★)

| Slug | Organisation |
|---|---|
| `org_ag_caromy` ★ | Caromy Event |
| `org_ag_arep` | Agence AREP |

### Associations — 5 (`seed_demo`), 2 (`seed_minimal` ★) — **noms fictifs** (pas de liste partenaires fournie)

`asso_alpha` ★ (habilitée reçu fiscal), `asso_bravo` ★ (**non habilitée** — couvre attestation sans volet fiscal), `asso_charlie`, `asso_delta` (désactivée), `asso_echo` (refus fréquent — couvre override Admin).

### Transporteurs / prestataires (`transporteurs` + `shared.prestataires`)

`prest_strike` ★ (IDF, ~~vélo cargo~~ **camions 16/20 m³** — corrigé grilles réelles 2026-06-07, le vélo cargo = A Toutes!), `prest_marathon` ★ (IDF, camion), `prest_transnormandie` ★ (province Rouen, fictif, `code_mts1` renseigné), `prest_sans_code_mts1` (demo — couvre R_code_mts1_requis en négatif). Casting complet (+ A Toutes!) : cf. volet TMS ci-dessous.

### Lieux Viparis (liste officielle 2026 — 100 %, `seed_demo`)

Paris Expo Porte de Versailles ★, Palais des Congrès de Paris ★, Espace Champerret ★, Paris Nord Villepinte, Paris Le Bourget, Paris Convention Centre, CNIT Forest, Les Salles du Carrousel, Hôtel Salomon de Rothschild, La Serre.
(★ = aussi dans `seed_minimal`.)

**Autres lieux** : Musée des Arts Forains ★, Trianon - Élysée Montmartre (demo), 1 lieu province Rouen ★ (fictif, pour Cirette), 2/6 lieux ponctuels « adresse libre » (dont 1 avec `lieux_modifications_en_attente`).

---

## Volumétrie par entité

| Entité (§04) | seed_minimal | seed_demo | Notes |
|---|---:|---:|---|
| `organisations` (traiteurs) | 3 | 8 | casting ci-dessus |
| `organisations` (gestionnaires) | 2 | 3 | |
| `organisations` (agences) | 1 | 2 | |
| `associations` | 2 | 5 | dont 1 non habilitée, 1 désactivée |
| `entites_facturation` | 6 | 14 | Potel = 2 entités |
| `users` staff Savr | 4 | 6 | 1 admin, 2 ops, 1 commercial (+2 demo) |
| `users` clients | 11 | 28 | 2/traiteur (manager+collaborateur), 2 Viparis, 1/autre gest., 2 agence |
| `lieux` | 6 | 18 | 3→10 Viparis + autres + ponctuels |
| `organisations_lieux` | 8 | 24 | jointures N-N (≥ 1 lieu partagé 2 orgs) |
| `contacts_traiteurs` | 2 | 8 | |
| `transporteurs` / `shared.prestataires` | 3 | 4 | |
| `tarifs_negocie` | 2 | 5 | dont Kaspia |
| `grilles_tarifaires_zd` + `tarifs_zero_dechet` | 1 grille + lignes | idem | lignes incluant palier bas **et** palier haut (> 1000 pax) |
| `tarifs_packs_ag` | grille V1 §05 §3 | idem | seed technique |
| `packs_antgaspi` actifs | 3 | 12 | 1 seul actif/traiteur (R pack unique) |
| `packs_antgaspi` épuisés | 1 | 4 | + 1 pack bas ≤ 10 % (minimal et demo) |
| `evenements` à venir | 4 | 30 | dont 1 `date_evenement` NULL, 1 AG bloqué coche étape 1 |
| `evenements` passés | 14 | ~440 | support des 478 collectes (qq événements multi-collectes) |
| `evenements` annulés | 2 | 12 | dont 1 AG < 12 h (débit crédit pack) |
| `collectes` brouillon | 2 | 6 | dont 1 brouillon tiers (exclu vues gestionnaire) |
| `collectes` à venir (programmee/acceptee) | 3 | 20 | |
| `collectes` realisee (non clôturées) | 2 | 25 | attente facturation/clôture |
| `collectes` cloturee | 8 | ~400 | seules présentes au registre (ZD only) |
| `collectes` annulee | 2 | 12 | |
| `collectes` realisee_sans_collecte (AG only) | 1 | 5 | |
| `collectes` flag `historique_partiel` | 1 | 3 | |
| `collecte_flux` (ZD, post-pesée) | 14 | ~1 000 | 3-4 flux/collecte ZD clôturée ; 2 en alerte min, 2 en alerte max |
| `attributions_antgaspi` | 4 | ~190 | dont 1 refus asso → override Admin ; 1 auto-accept |
| `config_auto_accept_ag` | 1 | 3 | |
| `tournees` + `collecte_tournees` | 2 + 4 | 60 + 130 | miroir MTS-1 ; ≥ 1 collecte multi-tournées. **Décision Val 2026-06-13** : ajouter les 31 collectes AG manquantes à `matrix_collectes.csv` (478 → 509) pour que tous les liens tournée→collecte soient valides. |
| `factures` | 7 | ~120 | par collecte ZD, mensuelle groupée, achat pack AG, hors pack ; statuts : non_envoye, emise, payee, rejetée 4xx (numéro conservé) ; 1 avoir **sur payee** |
| `factures_collectes` (lignes) | 12 | ~260 | dont ligne `collecte_id` NULL (designation libre) |
| `sequences_facturation` | 1/entité | idem | alignées gapless sur factures seedées |
| `bordereaux_savr` | 3 | 60 | ZD clôturées (sous-ensemble demo) |
| `attestations_don` | 2 | 80 | habilitée vs non habilitée |
| `rapports_rse` | 1 | 12 | dont 1 « sans excédent », 1 régénéré manager |
| `exports_registre` | 3 | 6 | 1 par format : csv, zip, pdf |
| `documents_generaux_savr` | 2 | 4 | |
| `shared.fichiers` | 12 | ~300 | répartis sur les 9 `entity_type` ; PDF placeholder 1 page |
| `briefs_evenement` + `brief_items` | 1 + 5 | 10 + 50 | `referentiel_categories/items` = seed technique |
| `impact_calculs` / `impact_synthese_evenement` | 6 / 2 | ~280 / 50 | snapshots figés à la clôture |
| `email_templates` | 19 actifs | idem | seed technique (§06.02) |
| `emails_envoyes` | 6 | ~100 | dont 1 `echec` avec 3 retries |
| `audit_log` | 5 | 50 | |
| `outbox_events` | 3 | 30 | dont 1 non consommé |
| `integrations_logs` / `integrations_inbox` | 4 | 40 | cf. `04 - Fixtures API.md` |
| `lieux_modifications_en_attente` | 1 | 3 | |
| `coefficients_perte_labo` | seed + 1 custom | idem | |
| `parametres_*` (taux recyclage, CO₂, mix, divers, algo) + history | seed technique | idem | placeholders, 1 ligne history chacun |

**Ordres de grandeur** : `seed_minimal` ≈ 130 lignes métier (hors référentiel) ; `seed_demo` ≈ 3 200 lignes (478 collectes sur 12 mois à volume réel).

---

# Volet TMS (session 2026-06-07 après-midi)

## Arbitrages Val TMS (2026-06-07)

1. **Miroir 1:1** : chaque collecte App des 12 mois `seed_demo` a sa `collectes_tms` (+ tournée, pesées, coûts, factures prestataires). Cohérence cross-schema totale, dashboards M07/M08 alimentés sur 12 mois.
2. **Mutualisation ~1,3 collecte/tournée IDF** → ~370 tournées `seed_demo` (majorité mono-collecte, ~80 doubles).
3. **Casting prestataires élargi à A Toutes!** (réel) pour couvrir les 5 formules catalogue (R2.2 → R2.6).
4. **Lot migration M13** : petit lot `seed_demo` sous `migration_mode_active` avec `factures_prestataires.migration_test = true` (couvre cat.7 M09/M10/M13 : consolidation D4, purge J+30).
5. Mêmes principes que l'App : noms d'entreprises réels, **personnes/chauffeurs 100 % fictifs**, déterminisme total (uuid v5, `SEED_REF_DATE = 2026-06-01`), 2 datasets.

## Casting prestataires (`shared.prestataires`) — 5 (`seed_demo`), 3 (`seed_minimal` ★)

| Slug | Prestataire | Profil fixture | Formule / particularités couvertes |
|---|---|---|---|
| `prest_strike` ★ | Strike | IDF, **camions 16 + 20 m³** | `vacations_paliers` (R2.2) — **2 grilles réelles** : 240 €/vacation 4 h + 60 €/h entamée (16 m³), 300 € + 75 €/h (20 m³), équipage double +31,25 €/h entamée **sur dépassement seul** ; param attribution `'strike'` + `zd_idf_strike` |
| `prest_marathon` ★ | Marathon | IDF, camion | **`forfait_fixe` réel : 100 €/tournée** (reclassé depuis vacations, R2.5) ; backup volume AG (`ag_marathon_volume_backup_camion`) ; SIREN/désactivation ops (F3 §06.06) |
| `prest_atoutes` | A Toutes! | IDF, **vélo cargo (Vélo Frais)** | `grille_matricielle_zone_type_course` (R2.3) **réelle, 8 cellules** (2 zones × programme/express × complète/incomplète, 38→75 €, incomplète = 50 % → flag R2.10) + 1 course camion **manuelle sans grille** (R2.6 — pas de grille camion, arbitrage Val) |
| `prest_transnormandie` ★ | Transnormandie (fictif) | Province Rouen, camion | `forfait_km` actif + 1 grille `forfait_fixe` **expirée** (réactivation tolérée, M06 #2) ; création province via `fn_create_prestataire_province` |
| `prest_onboarding` | fictif | `en_onboarding` | Wizard E7 grille bloquante (M13 F1), transition W5, tolérance province actif sans grille (M06 #4 — écart conscient) |

`prest_sans_code_mts1` reste un objet **App-only** (intégration MTS-1 V1), sans pendant TMS.

## Chauffeurs, véhicules, users TMS

- **`chauffeurs`** : 11 demo / 4 ★ — tous fictifs. Dont : 1 chauffeur Marathon **2 camions le même jour** (R6.1), 1 chauffeur avec **changement de device** (binding `auth_sessions_tms`), 1 désactivé.
- **`vehicules`** : 9 demo / 4 ★ — vélos cargo A Toutes! (**plaque libre**, exception trigger contrôle d'accès M03, S7 `plaque=null`), camions Strike 16 m³ + 20 m³ (1 grille réelle chacun), camion Marathon, camion A Toutes! (sans grille → manuel R2.6), camion Transnormandie, 1 archivé.
- **`types_vehicules`** : seed V1 (M03 Q11) + 1 doublon à fusionner via `merger_type_vehicule` (demo).
- **`users_tms`** : 7 ★ / 16 demo — 1 admin_tms, 2 ops, 1 manager par prestataire (cross-presta RLS), chauffeurs liés.

## Volumétrie par entité `tms.*`

| Entité (§04 TMS) | seed_minimal | seed_demo | Notes |
|---|---:|---:|---|
| `shared.prestataires` (volet TMS) | 3 | 5 | casting ci-dessus ; statuts actif / en_onboarding |
| `users_tms` | 7 | 16 | |
| `users_tms_devices_trusted` | 1 | 3 | M13 |
| `auth_sessions_tms` | 2 | 6 | dont 1 conflit device binding |
| `chauffeurs` | 4 | 11 | dont 1 désactivé |
| `chauffeurs_geolocalisation` | 6 pts | ~120 pts | dont cohorte > 30 j (purge RGPD cron) |
| `vehicules` | 4 | 9 | dont 1 archivé |
| `types_vehicules` / `types_contenants` | seed technique | idem | + `sans_contenant` ; 1 type contenant **archivage bloqué** (stock > 0, R_M09.8) |
| `collectes_tms` | 14 | 481 | 478 miroir App + 2 **manuelles** (`origine`, M02 7.3) + 1 orpheline (réconciliation M13 E6.c) |
| `tournees` | 6 | ~370 | cycle complet ; ≥ 1 par statut ; province directe `acceptee` (W2) |
| `collecte_tournees` | 8 | ~460 | ~80 tournées doubles ; 1 collecte multi-tournées (miroir App) |
| `pesees` | 12 | ~1 000 | alimentent `collecte_flux` App ; auto-tare + 1 override motif + 1 batch offline sync |
| `rolls_mouvements` | 8 | ~250 | dont 1 correction = **reversement delta** (F2 M09) |
| `stocks_rolls_traiteurs` | 3 | 8 | 1 stock bas (R4.2), 1 **négatif** (warning `m09_stock_negatif`) |
| `stocks_bacs_entrepot` | 1 | 1 | proche seuil saturation à REF_DATE (R5.3) |
| `passages_veolia` | 2 | ~55 | hebdo ; états 4 ; 1 créé **a posteriori** (R5.8) ; 1 annulé avec motif |
| `incidents` | 2 | 14 | terrain chauffeur + Ops ; `photos text[]` |
| `formules_catalogue` | 5 (seed) | idem | validation au seed `trg_formules_catalogue_impl_check` |
| `grilles_tarifaires_prestataires` | 3 | 7 | **grilles réelles 2026-06-07** : Strike 16 m³ ★ + 20 m³ (vacations), Marathon forfait 100 €/tournée ★, A Toutes! vélo 8 cellules (flag R2.10) ; + Transnormandie `forfait_km` ★ (synthétique, presta fictif), 1 expirée, 1 **versionnée** (anti-rétroactivité R2.8, EXCLUDE) |
| `ajustements_couts_log` | 1 | 4 | W2, append-only |
| `factures_prestataires` | 3 | ~40 + 2 | mensuelles par presta ; + 2 `migration_test = true` (lot M13) |
| `suggestions_attribution_log` | 4 | ~60 | enum 9 valeurs M12 représentées |
| `alertes_catalogue` | 58 émettables (seed) | idem | catalogue autoritaire §11.7 (60 lignes, 2 `active=false`) |
| `alertes` | 6 | ~40 | dont 1 ack admin_savr (F1 M11), 1 snoozée, dedup_key |
| `alertes_archive_critical` | 1 | 3 | |
| `everest_missions` | 0 | 0 | 🔒 **GATE Everest** — placeholders mocks uniquement, cf. [[04 - Fixtures API]] §4 |
| `secrets_metadata` | seed (HMAC + 2 M14) | idem | valeurs dans Vault dev, jamais en clair |
| `impersonation_sessions` | 0 | 1 | M13 |
| `parametres_tms` | seed technique complet | idem | tous namespaces (`m02`–`m14`, attribution dont `'strike'`, `migration_mode_active`) |
| `audit_logs` (volet TMS) | 5 | 40 | dont déverrouillage admin facture (trigger M08 #1) |
| `integrations_logs` / `integrations_inbox` | 6 | ~80 | retries 3 paliers, DLQ 5 retries M05, 1 replay sortant W6 (M13 F2) |

**Ordres de grandeur volet TMS** : `seed_minimal` ≈ 120 lignes métier (hors référentiel) ; `seed_demo` ≈ 3 000 lignes. Total des 2 CDC : minimal ≈ 250, demo ≈ 6 200.

> ⚠ **Articulation V1/V2 — `plateforme.tournees`** : les 60 tournées App du tableau App sont le **miroir MTS-1 (dev V1 Plateforme)**. En contexte V2 (TMS natif), ce miroir est remplacé : `plateforme.tournees` est peuplée depuis le CSV tournées TMS via la sémantique S3 (~370 lignes, statut interne `acceptee` mappé `planifiee`). Les deux volumétries ne coexistent jamais dans un même seed (cf. [[05 - Spec d'injection]] §5 bis).

---

## Liens

- Couverture règle → objet : [[02 - Couverture règles métier]]
- Timeline 12 mois : [[03 - Timeline seed_demo]]
- JWT + mocks API : [[04 - Fixtures API]]
- Spec d'injection Claude Code : [[05 - Spec d'injection]]

# Règles métier TMS

**Objectif** : spécifier les règles métier du Savr TMS — logique d'attribution transporteur, calcul coût tournée, rapprochement factures, gestion stock, alertes, cycle de vie des entités.

> ⚠ **Addendum 2026-05-01 — Propagation revue sobriété §08 Bloc A** : les mentions "push webhook S6 `course-cout-calculee`" et "push webhook S8 `traiteur-stock-rolls-update`" dans les règles ci-dessous sont **obsolètes V1**. Remplacées par lecture cross-schema directe Plateforme via vues `plateforme.v_courses_logistiques` (ex-S6) + `plateforme.v_stocks_rolls` (ex-S8). R_M09.7 "TMS push obligatoire" supprimée. Voir [[08 - Contrat API Plateforme-TMS#Addendum 2026-05-01 — Revue sobriété §08 Bloc A]].


---

## Principes généraux

- Toutes les règles paramétrables sans code vivent dans `parametres_tms` (namespace dédié) ou dans `grilles_tarifaires_prestataires.parametres_formule`.
- Les règles codées en dur sont listées explicitement ici avec leur justification. Toute rigidité doit être consciente.
- Les transitions de statut sont les seules sources de vérité sur l'état d'une entité — pas de déduction depuis d'autres champs.
- Toute mutation sur entité critique génère une ligne `audit_logs` (trigger DB).

---

## R1 — Attribution transporteur (M12)

Source : §03 M12 + `parametres_tms` namespace `attribution` + spec détaillée [[06 - Fonctionnalités détaillées TMS/M12 - Attribution transporteur]] (propagation 2026-04-24).

**Codes de branche canoniques (enum `collectes_tms.suggestion_branche_r1_code`)** — **9 valeurs (F1 tranché 2026-06-07, test-scenarios M12)** : `zd_idf_strike`, `ag_velo_programme`, `ag_velo_express`, `ag_marathon_volume`, `ag_marathon_volume_backup_camion`, `ag_marathon_nuit`, `ag_velo_fallback_marathon`, `ag_province_proximite`, `aucun_prestataire`. Ajoutés par propagation M12 2026-04-24 ; `ag_velo_fallback_marathon` ajouté 2026-06-07 (introduit audit A3 2026-05-09, manquait à l'enum) ; **`ag_marathon_volume_backup_camion` = canonique cross-CDC** (aligné enum App `branche_attribution` §04/§06.09/§08, valeurs stockées en base dès V1 — l'ex-`ag_camion_backup` des listes TMS était la divergence, retiré).

**Triggers de calcul M12** : T1 création, T2 refus (recalcul simple, sans relance auto — revue sobriété 2026-04-29 : Ops réattribue manuellement via M02), T3 re-confirmation post-modif. T4 (Re-suggérer) + T5 (bulk re-compute) supprimés V1. Détail complet §06 M12 §3.

### R1.1 — Collectes ZD

**Règle V1** : Strike par défaut pour toutes les collectes ZD. Un seul prestataire ZD actif en V1, pas de logique de sélection. Pas de collectes ZD en province V1 — **garde explicite (F7 tranché Val 2026-06-07)** : une collecte ZD non-IDF entrante → `aucun_prestataire` avec `reason='zd_province_non_supporte_v1'` + alerte `m12_aucun_prestataire` critical (pas de suggestion Strike fausse silencieuse).

```
→ Attribuer Strike automatiquement (suggestion dispatch M02)
→ Ops Savr confirme ou override manuellement
```

**Évolution** : si un 2ème prestataire ZD est ajouté, la règle d'attribution sera définie à ce moment-là (ajout dans `parametres_tms` + logique M12). Le code M12 ne contient aucune référence à "Strike" en dur — la règle est portée par `parametres_tms.attribution.regle_zd_prestataire_prioritaire_code` (string code prestataire, seed `'strike'`, modifiable `admin_tms` seul — **F2 tranché Val 2026-06-07** : paramètre ajouté au seed §04 TMS §5, il était utilisé sans exister au data model; simplifié string simple V1, cohérent D11).

### R1.2 — Collectes AG

> **Source de vérité règle = [[../01 - Cahier des charges App/05 - Règles métier#Règles d'attribution transporteur Île-de-France|§05 R2 Plateforme]] (audit cohérence A1 2026-05-09)**. Le pseudocode M12 §4 reste la spec d'implémentation TMS. Paramètres `regle_ag_*` + `a_toutes_indisponible` + `everest_codes_postaux` + `poids_par_repas_kg` source unique = `plateforme.parametres_algo` (V1+V2 à reétudier au cutover V2). Métadonnées `a_toutes_indisponible_*` retirées audit sobriété 2026-05-09 B1 (lecture `audit_log` central). Coefficient kg/repas centralisé Plateforme audit sobriété 2026-05-09 B2.

**Règle principale** : A Toutes! vélo pour les petits events jour avec anticipation. Marathon pour les grands events (≥ 600 pax) **et la nuit**. A Toutes! camion en backup Marathon, partage la plage horaire vélo (audit cohérence A2 2026-05-09).

```
Conditions lues depuis plateforme.parametres_algo (V1) — V2 à figer cutover :

Branche 1 — AG nuit (heure_collecte avant regle_ag_plage_velo_debut OU après regle_ag_plage_velo_fin) :
   → Proposer Marathon (code branche : ag_marathon_nuit)
   → Pas de backup V1 (A Toutes! fermé la nuit)
   → Sinon : aucun_prestataire (alerte Ops)

Branche 2 — AG grand événement jour (nb_pax >= regle_ag_seuil_pax_velo) :
   → Proposer Marathon (code branche : ag_marathon_volume)
   → Si Marathon indisponible ET heure_collecte < regle_ag_plage_velo_fin
        ET a_toutes_indisponible = false ET adresse couverte Everest :
      → A Toutes! camion service Everest 91 (code branche : ag_marathon_volume_backup_camion — canonique cross-CDC, F1 2026-06-07)
   → Sinon : aucun_prestataire

Branche 3 — AG vélo jour (nb_pax < regle_ag_seuil_pax_velo, plage jour) :
   → Si A Toutes! disponible ET adresse couverte Everest :
        → délai < regle_ag_seuil_h2_minutes : A Toutes! vélo express (Everest 75, code : ag_velo_express)
        → sinon : A Toutes! vélo programmé (Everest 71, code : ag_velo_programme)
   → Si A Toutes! indispo OU adresse hors zone Everest :
        → Proposer Marathon (code branche : ag_velo_fallback_marathon, audit cohérence A3 2026-05-09)
   → Si Marathon aussi exclu : aucun_prestataire

Couverture Everest = lieu.code_postal[:2] IN parametres_algo.everest_codes_postaux
                     (seed V1 ['75','92','93'], audit cohérence A4 2026-05-09 — vérification locale, plus d'appel API)
```

**Valeurs seed V1** (modifiables Admin Plateforme via `parametres_algo`) :
- `regle_ag_plage_velo_debut` = `07:00`
- `regle_ag_plage_velo_fin` = `20:00` (couvre vélo cargo **et** camion — audit cohérence A2 2026-05-09)
- `regle_ag_seuil_pax_velo` = 600
- `regle_ag_seuil_h2_minutes` = **90** (audit cohérence A5 2026-05-09 — alignement Plateforme, ex-120)
- `everest_codes_postaux` = `['75','92','93']`
- `a_toutes_indisponible` = `false` (métadonnées qui/quand/pourquoi lues depuis `audit_log` central — refonte audit sobriété 2026-05-09 B1)
- `poids_par_repas_kg` = `0.45` (audit sobriété 2026-05-09 B2 — coefficient conversion AG, source unique Plateforme)

**Paramètres supprimés (audit cohérence + sobriété 2026-05-09)** :
- `regle_ag_plage_camion_fin` (A2 — camion partage la plage vélo)
- `a_toutes_indisponible_raison` / `_declaree_le` / `_declaree_par` (B1 audit sobriété — lecture `audit_log`)
- `m05_equivalent_repas_kg` côté `parametres_tms` (B2 audit sobriété — V2 cross-schema lecture Plateforme)

**Disponibilité A Toutes!** : non vérifiable en temps réel V1. Indisponibilité déclarée manuellement par Admin Plateforme via Back-office (flag `a_toutes_indisponible` dans `parametres_algo`) → bascule branche 3 vers Marathon (`ag_velo_fallback_marathon`).

### R1.3 — Contraintes communes

- Ops Savr peut overrider toute suggestion d'attribution (dispatch manuel M02).
- Toute attribution tracée dans `audit_logs` (acteur = Ops Savr user_id, diff = prestataire avant/après).
- Un prestataire ne peut être attribué que si `statut = actif` ET `deleted_at IS NULL`.
- Si aucun prestataire disponible → alerte M11 `gravite = critical`, collecte reste `statut_dispatch = a_attribuer`.
- **Garde zone A Toutes! (nouveau 2026-06-07, arbitrage Val)** : A Toutes! n'est **jamais suggéré** (M12) si le code postal du lieu est **hors zone** (préfixe département ∉ `zones_codes_postaux_mapping` : 75/92/93/94). Même mécanique que la garde ZD province. L'override manuel Ops reste possible → le coût passe alors en saisie manuelle (R2.6, aucune cellule applicable) ; pas de nouvelle alerte V1 (supervision via digest ajustements M07 N3).

### R1.4 — Alerte Ops acceptation sans réponse (M02, nouveau 2026-06-03 — arbitrage Val, révise D4 M02)

Règle de **supervision** uniquement. Ce n'est **pas** un SLA système : aucune bascule de statut, aucune escalade automatique, aucun auto-accept (ceux-ci restent supprimés depuis la sobriété 2026-04-29).

Pour toute collecte `statut_dispatch = 'attribuee_en_attente_acceptation'` (en attente de réponse du prestataire) :

```
delai_ecoule = now() − attribuee_at
proximite    = heure_collecte − now()

seuil = (proximite ≤ m02_alerte_acceptation_seuil_proximite_heures)   -- 48h
          ? m02_alerte_acceptation_delai_proche_heures                -- 3h
          : m02_alerte_acceptation_delai_lointaine_heures             -- 48h

si delai_ecoule ≥ seuil ET pas d'alerte m02_acceptation_sans_reponse active sur la collecte :
   → tms.alerte_emit('m02_acceptation_sans_reponse', warning, collecte_id)
```

- Évaluée par le cron `cron_m02_alerte_acceptation` (15 min).
- Auto-résolution dès que la collecte quitte `attribuee_en_attente_acceptation` (acceptée / refusée / réattribuée / annulée).
- Seuils paramétrables (`parametres_tms` namespace `m02`, §04), calibrables sans redéploiement.
- Couvre A Toutes! (Everest) à l'identique : l'acceptation y est dérivée du webhook `mission_dispatched` ; absence de `mission_dispatched` dans le délai = alerte.

---

## R2 — Calcul coût tournée (M07)

Source : §03 M07 + `grilles_tarifaires_prestataires` + `formules_catalogue`.

### R2.1 — Algorithme général

```
À la clôture de la tournée (heure_reelle_fin IS NOT NULL) :

1. Lookup grille active :
   SELECT * FROM grilles_tarifaires_prestataires
   WHERE prestataire_id = tournee.prestataire_id
     AND (type_vehicule_id = tournee.vehicule.type_vehicule_id OR type_vehicule_id IS NULL)
     AND date_debut_validite <= tournee.date_planifiee
     AND (date_fin_validite IS NULL OR date_fin_validite >= tournee.date_planifiee)
     AND statut = 'actif'
   ORDER BY type_vehicule_id NULLS LAST, date_debut_validite DESC
   LIMIT 1

2. Si grille non trouvée → **RAISE EXCEPTION (cas impossible par construction, refondu revue sobriété §05 2026-05-01 D2)**. Garanties préservant l'invariant :
   - **R_M06.X** : tout prestataire `actif` doit avoir au moins 1 grille `active` couvrant la période courante (CHECK + bloquant à la création M06 W1 / wizard onboarding M13 E7 step 2).
   - **Trigger DB sur `grilles_tarifaires_prestataires`** : empêche `UPDATE date_fin_validite NOT NULL` ou `UPDATE statut = 'archive'` si aucune grille successeur active publiée pour la période suivante.
   - **Trigger DB sur `tournees`** : précondition à la transition `terminee` → vérifie qu'une grille active existe pour `(prestataire_id, type_vehicule_id, date_planifiee)`. Si non → exception (bug à investiguer, pas un cas métier normal V1).
3. Exécuter la fonction de calcul correspondant à formules_catalogue.code
4. Stocker cout_calcule_ht + cout_detail (snapshot JSON) + grille_tarifaire_id sur tournees
5. → **Obsolète V1 (revue sobriété §08 Bloc A 2026-05-01 A2)** : le coût est lu cross-schema par la Plateforme via la vue `plateforme.v_courses_logistiques` + trigger DB `plateforme.fn_recalc_marge_tournee()` (sur UPDATE `tms.tournees.cout_final_ht`). Aucun push HTTP TMS.
```

### R2.2 — Formule `vacations_paliers` (Strike) *(grilles réelles intégrées 2026-06-07 — Marathon reclassé `forfait_fixe` → R2.5)*

Formule générique pilotée par le JSON `paliers` (entièrement configurable Admin TMS sans code).

```
duree_heures    = tournee.duree_reelle_minutes / 60
equipage_double = (tournee.nb_personnes_facturation >= 2)
palier          = grille.parametres_formule.paliers.find(p => p.de_h <= duree_heures < p.a_h)

cout = palier.nb_vacations × grille.tarif_vacation_base_ht
si palier.prolongation :
    h_entamees = ceil(duree_heures - palier.base_h)   # heure ENTAMÉE (grille réelle Strike)
    cout += h_entamees × (grille.cout_horaire_supplementaire_ht
                          + (equipage_double ? grille.equipier_supplement_horaire_ht : 0))

# Supplément équipier (équipage double) : equipier_supplement_horaire_ht,
# appliqué UNIQUEMENT sur les heures entamées de dépassement (arbitrage Val 2026-06-07) —
# la vacation de base 4h est identique en équipage simple ou double.
```

**Grilles Strike V1 réelles** (2026-06-07, seed — modifiables Admin TMS) : 2 grilles, une par type de véhicule.

| Grille | Vacation base 4 h | Dépassement / heure entamée | Supplément équipage double / heure entamée |
|---|---:|---:|---:|
| Strike 16 m³ | 240 € (60 €/h) | 60 € | +31,25 € |
| Strike 20 m³ | 300 € (75 €/h) | 75 € | +31,25 € |

Paliers JSON : `[0h→4h : 1 vacation, sans prolongation]` + `[4h→∞ : 1 vacation, prolongation base 4h]`. Ex (grille réelle Val) : tournée 6 h équipage simple 16 m³ = 240 + 2 × 60 = **360 €**.

**Marathon V1** : — **reclassé `forfait_fixe` 100 €/tournée (grille réelle 2026-06-07), cf. R2.5**.

### R2.3 — Formule `grille_matricielle_zone_type_course` (A Toutes! vélo)

```
1. Déterminer zone du lieu : zone = zones_codes_postaux_mapping[left(code_postal, 2)]
   (seed réel 2026-06-07 : 75 → paris ; 92/93/94 → communes_limitrophes — petite couronne entière, arbitrage Val)
   Préfixe absent du mapping = HORS ZONE → pas de cellule → garde attribution R1.3 ; si forcé → R2.6 saisie manuelle
   Si lieu chargement ET livraison → prendre zone la plus haute (regle_zone_multi_site = zone_la_plus_haute,
   ordre croissant zones_ordre_priorite = [paris, communes_limitrophes])

2. Déterminer type_course :
   - complete : collecte.statut_operationnel = 'realisee' ET Σ poids_net_kg > 0
   - incomplete : collecte.statut_operationnel = 'realisee_sans_collecte' (AG) → tarif ~50%

2 bis. Déterminer mode (3e dimension — grille réelle A Toutes!, arbitrage Val 2026-06-07 : les 2 axes en V1) :
   - express   : (heure_planifiee_debut - horodatage d'attribution de la course à A Toutes!)
                 < parametres_tms.m07_atoutes_express_seuil_minutes (seed 90 — confirmé Val 2026-06-07 :
                 express = course commandée moins de 1h30 avant la collecte)
   - programme : sinon (cas nominal Savr — collectes planifiées)

3. Lookup cellule grille : cellules.find(c => c.zone == zone && c.mode == mode && c.type_course == type_course)

4. cout = cellule.tarif_ht
```

**Grille A Toutes! vélo (Vélo Frais) V1 réelle** (2026-06-07, seed) — 8 cellules, flag `tarif_sans_collecte_applicable = true` (R2.10, incomplète = 50 %) :

| Mode | Complétude | Paris | Communes limitrophes |
|---|---|---:|---:|
| programme (H+2) | complete | 38 € | 51 € |
| programme (H+2) | incomplete | 19,00 € | 25,50 € |
| express (>1.5h) | complete | 57 € | 75 € |
| express (>1.5h) | incomplete | 28,50 € | 37,50 € |

### R2.4 — Formule `grille_matricielle_zone` (A Toutes! camion ID 91) — **aucune grille V1**

```
1. Déterminer zone du lieu (même lookup code_postal que R2.3)
2. cout = cellule.tarif_fixe_ht (indépendant du temps passé)
```

**Arbitrage Val 2026-06-07** : pas de grille camion A Toutes! → le cas camion A Toutes! relève de R2.6 (manuel/Everest). Formule conservée au catalogue (générique, réutilisable), aucune grille ne l'instancie en V1.

### R2.5 — Formules `forfait_km` et `forfait_fixe` (province + **Marathon IDF**, grille réelle 2026-06-07)

```
# forfait_km :
km = tournee.kilometrage (saisie Ops si non fourni auto)
cout = forfait_base_ht + max(0, km - km_inclus) × tarif_km_supplementaire_ht

# forfait_fixe :
cout = forfait_ht        # PAR TOURNÉE (arbitrage Val 2026-06-07) — la répartition
                         # collecte_tournees divise le coût entre collectes portées
```

**Marathon V1 réel** : `forfait_fixe`, `forfait_ht = 100 €` par tournée (reclassé depuis `vacations_paliers`, cf. R2.2).

### R2.6 — Cas sans grille (A Toutes! manuel V1)

A Toutes! = intégration Everest. Coût Everest stocké dans `everest_missions.cout_everest_ht`. La grille TMS prime (cf. décision §04). En V1, si la grille TMS est absente (cas exceptionnel), Ops Savr peut saisir le coût manuellement (`source = saisie_manuelle` sur `courses_logistiques` côté Plateforme).

### R2.7 — Annulation et seuil 3h (sobriété C3 2026-04-30, ex-1h)

**Règle uniforme tous prestataires** (Strike, Marathon, A Toutes!, province) — **règle authoritative pour tout le CDC TMS** :

- **Annulation ≥ 3h avant `heure_planifiee_debut`** → `cout_calcule_ht = 0`, statut tournée `annulee`, `cout_detail = {"raison": "annulation_hors_delai_facturation"}`. Pas de facturation prestataire.
- **Annulation < 3h avant `heure_planifiee_debut`** (ou après) → vacation facturée. M07 calcule normalement (formule standard de la grille applicable, sur durée réelle si chauffeur mobilisé, sinon durée minimale palier).

Seuil paramétrable : `parametres_tms.m07.delai_annulation_sans_facturation_minutes` (default `180`, ex-`60`).

 **Retiré V1 (propagation M07 2026-04-24 D5)**.
 **Remplacé par 3h** (sobriété C3 2026-04-30) — délai de mobilisation chauffeur plus réaliste.

### R2.7 bis — Annulation pendant tournée `en_cours` = vacation facturée (formalisé revue sobriété §05 2026-05-01 C1)

**Règle authoritative** (référencée par M01 W4, M02 §16/§annulation, M04 §8 cycle de vie tournée + §10, R6.1 cas particulier `en_cours`+annulation).

Si un client annule une collecte (DELETE webhook E3 Plateforme) **alors que la tournée est déjà `en_cours`** (chauffeur a démarré, transition `acceptee → en_cours` intervenue) :

1. `collectes_tms.statut_dispatch = annulee_par_traiteur` + `annulee_pendant_en_cours = true`.
2. `collectes_tms.statut_operationnel` reste `en_cours` jusqu'à la clôture chauffeur, puis transite vers `realisee` (le chauffeur saisit pesées même sans repas → justifie la vacation).
3. **La tournée `en_cours` finit toujours** (pas de transition `en_cours → annulee` côté `tournees.statut`). Le bouton "Annuler tournée" Ops/Admin (M04 E5) est désactivé tant que `statut != planifiee`.
4. **Vacation prestataire facturée intégralement** : M07 calcule le coût normalement (durée réelle de la tournée jusqu'à clôture). Le coût n'est pas mis à 0.
5. **Côté Plateforme** : la facturation client (vs grille traiteur) est tranchée par Ops dans M02 sur la base d'une alerte M11 `m02_annulation_en_cours_tournee` (warning).
6. Pas de notification client automatique (l'annulation vient déjà du client).

**Motivation** : un chauffeur démarré = vacation engagée = prestataire dû. La grille TMS prime sur le motif d'annulation. C'est R2.7 bis (vs R2.7 qui couvre l'annulation **avant** démarrage tournée).

### R2.8 — Figement post-clôture + Anti-rétroactivité grilles (sobriété C4 2026-04-30, formulation centralisée)

> **Règle authoritative pour tout le CDC TMS** — fusion de l'ancienne R2.8 (figement) + décision M07 E (anti-rétroactivité).

**Figement coût tournée** :
- Une fois la tournée `terminee` et `cout_calcule_ht` posé par trigger M07 W1, la valeur est **immuable**
- Trigger DB BEFORE UPDATE sur `tournees` rejette toute modification de `cout_calcule_ht`
- Toute correction post-clôture passe par le champ séparé `cout_ajuste_ht` (workflow ajustement manuel, cf. M07 W2)

**Anti-rétroactivité grilles tarifaires** :
- Toute nouvelle grille doit avoir `date_debut_validite > CURRENT_DATE` (CHECK SQL)
- Modification rétroactive d'une grille active (`date_debut_validite <= CURRENT_DATE`) interdite
- Renégo / nouveau tarif → publier nouvelle grille avec date future, l'ancienne reçoit automatiquement `date_fin_validite = nouvelle.date_debut_validite - 1 jour`
- → **Supprimée revue sobriété §05 2026-05-01 D2** (cas `cout_manquant` lui-même supprimé V1, plus de bypass rétroactif nécessaire). Si rétroactivité ponctuelle requise (ex: import migration MTS-1) → SQL Admin direct sur Supabase Studio + audit_log manuel.

### R2.9 Ajustement manuel et seuil validation — **règle supprimée (sobriété A3 2026-04-30)**

> Workflow validation Admin TMS pour ajustements ≥ 15% retiré V1. Tous les ajustements (Ops Savr ou Admin TMS, peu importe l'écart) sont auto-validés et poussés S6 immédiatement. Audit log complet via `ajustements_couts_log` append-only. Supervision a posteriori par Admin TMS via digest quotidien (M07 N3).
>
> Workflow simplifié authoritative dans M07 W2.
>
> **Interdiction d'ajustement** maintenue si `cout_final_verrouille = true` (tournée rapprochée à facture M08 validée). Déverrouillage via cycle M08 W9.
>
> Réintroduction du seuil possible V1.1 si dérive observée en prod. Paramètre `m07.seuil_validation_ajustement_pourcent` supprimé du namespace `parametres_tms`.

### R2.10 — Flag `tarif_sans_collecte_applicable` (nouveau 2026-04-24 M07 D4)

Flag booléen dans `grilles_tarifaires_prestataires.parametres_formule` (défaut `false`) pour formules `vacations_paliers` et `grille_matricielle_zone`. Si `true` : tournée avec toutes collectes en statut `realisee_sans_collecte` (AG) → `cout_calcule_ht = 0`. Si `false` : vacation facturée normalement selon la formule.

**Nota** : `grille_matricielle_zone_type_course` (A Toutes! vélo) gère nativement via `type_course = incomplete` (tarif ~50% défini en grille). Pas de flag nécessaire.

**Seed V1** :
- Strike `vacations_paliers` : `false` (vacation facturée même si 0 kg collecté)
- Marathon `vacations_paliers` : `false` (idem)
- A Toutes! camion `grille_matricielle_zone` : `false` (vacation mobilisée)
- A Toutes! vélo `grille_matricielle_zone_type_course` : N/A (géré par `type_course`)
- Province `forfait_fixe`/`forfait_km` : non concerné (forfait = vacation complète)

---

## R3 — Rapprochement factures prestataires (M08)

Source : §03 M08 + §06 M08 + `factures_prestataires` + `parametres_tms` namespace `m08`. table supprimée V1 (revue sobriété §04 2026-04-30 A5 — audit visuel via `factures_prestataires.pdf_url` + `pdf_extraction_json`).

**Refonte 2026-04-24** (propagation M08 D4 zéro tolérance) : suppression des seuils, logique binaire match/no-match, ajout workflow déverrouillage Admin, nouveau numéro obligatoire pour rectification.

### R3.1 — Déclenchement

Déclenché à l'upload du PDF facture par le prestataire (M03 W10) ou Ops Savr (M08 W2 pour province / manuel). L'OCR Mistral (`pdf_extraction_json`) prérempli le formulaire → Ops/Manager complète les champs required avant submit. Blocage upload si champ required incomplet (propagation M08 D3).

### R3.2 — Calcul du montant TMS

```
montant_ht_calcule_tms =
  SUM(tournees.cout_final_ht)
  WHERE prestataire_id = facture.prestataire_id
    AND date_planifiee BETWEEN facture.periode_debut AND facture.periode_fin
    AND statut = 'terminee'
    AND cout_final_verrouille = false
```

Nota colonne : `cout_final_ht` = `cout_ajuste_ht` si ajustement présent, sinon `cout_calcule_ht` (cf. M07 R2.8 + M07 W2 ; sobriété B5 2026-04-30 — colonne mise à jour par trigger explicite, plus GENERATED).

**Cas A Toutes! / tournée sans coût (R_M08.8)** : si au moins une tournée dans la période a `cout_final_ht IS NULL` (grille absente) → `statut_rapprochement = 'rapprochement_manuel_requis'`, exclusion de la tournée, alerte Ops. Ops doit saisir grille M07 + re-rapprocher (bouton `Re-rapprocher` E2 M08) OU valider manuellement via W5 M08 avec motif.

### R3.3 — Logique de rapprochement — ZÉRO TOLÉRANCE (propagation M08 2026-04-24, D4 ; refondu revue sobriété §05 2026-05-01 D1 — fusion `rapproche_ok` → `valide` direct)

```
si montant_ht_prestataire = montant_ht_calcule_tms (au centime près) :
   → statut_rapprochement = valide  (auto-validation, plus d'étape rapproche_ok intermédiaire)
   → trigger M07 verrouillage tournées (cout_final_verrouille = true)
   → notification Ops + Admin (N1 simplifiée) : "Facture :numero validée automatiquement (match exact)"
   → audit_log action=M08_FACTURE_AUTO_VALIDEE acteur=trigger système

sinon :
   → statut_rapprochement = ecart_detecte
   → notification Ops + Admin : montant prestataire, montant TMS, écart € (N3)
   → Ops/Admin tranche :
      - Valider manuellement avec motif ≥ 30 car (W5 M08, alerte Admin si |écart| > 100€)
      - Contester (W6 M08) → prestataire émet avoir + nouvelle facture (D7)
```

**Refonte D1 revue sobriété §05 2026-05-01** : ancienne étape `rapproche_ok` (notification "validation requise" + Ops/Admin valide via W4) supprimée V1. Avec zéro tolérance R_M08.1, `montant_ht_prestataire = montant_ht_calcule_tms` → aucune valeur ajoutée à la validation Ops manuelle (juste un clic). Auto-validation directe + notification informative N1 = -1 étape workflow, -1 valeur enum, -1 workflow W4. La supervision Ops a posteriori reste possible via filtre E1 statut `valide` + colonne "Validée par : système" dans la liste. Réintroduction V1.1 si Val/Louis veulent ré-instaurer une revue humaine systématique.


**Retiré V1 (propagation M08 2026-04-24, D4)** : zéro tolérance strict, pas de seuil, cohérence pratique comptable FR (avoir obligatoire sur écart). Paramètre d'alerte conservé : `m08.seuil_alerte_validation_manuelle_ht` (default 100€) = notification Admin si Ops valide un écart supérieur.

### R3.4 — Rapprochement ligne-à-ligne **Supprimée V1 revue sobriété 2026-04-30 B1 + table supprimée 2026-04-30 A5**

V1 = rapprochement global uniquement. **Table `factures_prestataires_lignes` entièrement retirée V1** (revue sobriété §04 2026-04-30 A5). Si le prestataire fournit le détail des lignes dans son PDF, l'OCR Mistral extrait la structure dans `factures_prestataires.pdf_extraction_json` (champ `lignes` jsonb). L'UI M08 E1 affiche le PDF intégré + le JSON OCR à droite pour l'audit visuel Ops.

**Motivation** : pratique comptable FR opère au niveau facture (l'avoir annule la facture entière, pas une ligne). Zéro tolérance R_M08.1 préservée au niveau global. Volume V1 (~30 factures/mois) ne justifie pas une table dédiée (snapshot, generated columns, statuts ligne, tests pgTAP dédiés, RLS). Le PDF source + l'OCR JSON couvrent l'audit visuel.

Re-évaluer V2 si volume × 5 ou si un prestataire spécifique exige une analyse ligne-à-ligne contractuelle.

### R3.5 — Workflow de contestation et rectification (propagation M08 2026-04-24, D7)

```
statut_rapprochement = conteste :
  → Ops renseigne motif_contestation (≥30 car) + type_contestation (E6 M08) — `type_contestation` text libre post revue sobriété §04 2026-04-30 D3 (dropdown préremplie + saisie libre)
  → Prestataire notifié par email (N6) : motif, montants, CTA émettre avoir + nouvelle facture
  → Prestataire émet avoir (hors TMS) + NOUVELLE facture avec NUMÉRO DIFFÉRENT (contrainte UNIQUE)
  → Upload de la nouvelle facture via M03 W10 ou M08 W2 avec option "Cette facture rectifie :id"
  → Ancienne facture passe remplacee_par_avoir (terminal)
  → Nouvelle facture référence facture_corrigee_id → re-rapprochement auto normal
```

**Statut source de la contestation (arbitrage Val 2026-06-06)** : la contestation W6 est ouverte à Ops/Admin depuis `ecart_detecte`, `rapprochement_manuel_requis` **et `valide`** (pas `regle` — immuable R_M08.6, W9 Admin only). Si la facture était `valide`, la contestation **déverrouille les tournées** (`cout_final_verrouille = false` via `trg_m08_deverrouiller`) et pose `conteste_apres_validation = true` (le flag = « validée avant contestation », indépendant de l'acteur W6 Ops / W9 Admin). Motivation : l'auto-validation W3 zéro tolérance ne laisse aucune revue humaine avant verrouillage → Ops doit pouvoir rejeter une auto-validation erronée sans escalade Admin systématique.

Pas de rectification in-place (édition montants) d'une facture existante. Un avoir + nouvelle facture est le seul chemin valide.

### R3.6 — Vérification cohérence finale + verrouillage tournées (simplifié revue sobriété 2026-04-30 B1)

À la validation (`statut_rapprochement = 'valide'` via W4 ou W5) :
- **Supprimé V1 (revue sobriété §04 2026-04-30 A5)** — table `factures_prestataires_lignes` retirée. La cohérence interne du PDF est garantie par le prestataire (le total imprimé fait foi). L'OCR `pdf_extraction_json` peut signaler informativement un écart constaté entre `lignes_total_ocr` et `montant_ht_prestataire` saisi (warning UI non bloquant).
- Trigger DB `trg_m08_verrouiller` : UPDATE `tournees SET cout_final_verrouille = true, verrouillee_par_facture_id = facture.id` pour toutes les tournées rapprochées (**périmètre = agrégat période** uniquement post-revue B1, cf. R_M08.4).
- INSERT audit_log (niveau 5) — capture `acteur_user_id` (revue sobriété §04 2026-04-30 B1 : la trace acteur passe désormais exclusivement par `audit_logs`, les colonnes `valide_par_user_id` / `regle_par_user_id` / `exporte_par_user_id` / `deverrouillee_par_user_id` retirées V1 sur `factures_prestataires`).

### R3.7 — Déverrouillage Admin TMS (propagation M08 2026-04-24, D11, simplifié revue sobriété 2026-04-30 D1/B2/C3)

> **Note arbitrage Val 2026-06-06** : le **déverrouillage des tournées** n'est plus exclusivement Admin — Ops peut le déclencher en contestant une facture `valide` (W6, cf. R3.5 + R_M08.5(a)). W9 reste le chemin Admin exclusif pour : (i) déverrouiller une facture `regle`, (ii) l'action `reouverte_pour_validation`, (iii) écrire les colonnes `action_deverrouillage`/`motif_deverrouillage`/`deverrouillee_at` (garde trigger `trg_factures_deverrouillage_admin_only`, RLS row-level ne pouvant pas cloisonner ces colonnes).

Admin TMS uniquement. Workflow W9 M08 :
- Motif obligatoire ≥ 30 car.
- Action :
  - `rejetee_pour_correction` → `statut_rapprochement = 'conteste'` + `conteste_apres_validation = true` (revue sobriété 2026-04-30 D1, ex-statut dédié supprimé)
  - `reouverte_pour_validation` → `statut_rapprochement = 'en_attente'` + re-trigger W3 rapprochement auto
- Trigger DB `trg_m08_deverrouiller` : UPDATE tournées liées `cout_final_verrouille = false, verrouillee_par_facture_id = NULL` (périmètre = agrégat période, revue sobriété 2026-04-30 B1).
- Si facture déjà exportée Pennylane : INSERT `tms.audit_logs` action `M08_EXPORT_PENNYLANE_ANNULEE` (revue sobriété 2026-04-30 B2, ex-table `exports_pennylane_log` supprimée) + alerte M11 critique.
- Notifications (revue sobriété 2026-04-30 C3) : prestataire (email N9) + Ops (alerte M11 critique seule, email retiré) + Admin (in-app + audit log entry, email retiré).
- Audit log append-only niveau critique action `M08_DEVERROUILLAGE_ADMIN`.

### R3.8 — Périmètre période : 1 facture = 1 période sans chevauchement (nouveau 2026-06-03 — arbitrage Val, résout Q6 §04)

**Règle V1** : une facture prestataire couvre **une période de facturation unique, sans chevauchement** avec une période déjà facturée pour le même prestataire. Pas de rapprochement partiel natif V1 (option a).

Le non-double-comptage est garanti par le verrouillage existant (R3.2 + R3.6) :

- R3.2 ne somme que les tournées `terminee` **ET `cout_final_verrouille = false`** dans la période. Les tournées déjà rapprochées/facturées par une facture antérieure sont verrouillées (`cout_final_verrouille = true`, R3.6) → **automatiquement exclues** du `montant_ht_calcule_tms` d'une nouvelle facture, même si sa période les recouvre.
- Conséquence : si un prestataire envoie une facture dont la période chevauche des tournées déjà facturées + des nouvelles, seules les **nouvelles** (non verrouillées) entrent dans le calcul. Le rapprochement se fait sur ce sous-ensemble.
- Si le montant prestataire ne matche pas ce sous-ensemble (le prestataire a refacturé du déjà-payé) → `ecart_detecte` (R3.3) ou `rapprochement_manuel_requis` (R3.2 cas tournée sans coût) → Ops tranche (valider avec motif W5 / contester W6). Pas de découpage automatique de la facture.

**Pas de nouveau mécanisme, pas de nouvelle colonne, pas de nouvel état d'enum.** Rapprochement partiel / ligne-à-ligne réévaluable V1.1 si volume × 5 (cohérent R3.4).

---

## R4 — Stock rolls et alertes (M09 + M11)

Source : §03 M09 + `stocks_rolls_traiteurs` + `rolls_mouvements` + `parametres_tms` namespace `stock`.

### R4.1 — Mise à jour stock traiteur

Déclenchée à chaque INSERT/UPDATE sur `rolls_mouvements` (applicatif, pas trigger DB pour garder la logique accessible) :

```
stock_actuel = stocks_rolls_traiteurs.quantite_actuelle
              WHERE plateforme_traiteur_id = mouvement.plateforme_traiteur_id
                AND type_contenant_id = mouvement.type_contenant_id

nouveau_stock = stock_actuel
               - mouvement.nb_pleins_recuperes
               + mouvement.nb_vides_laisses

UPDATE stocks_rolls_traiteurs SET quantite_actuelle = nouveau_stock
```

 → **Obsolète V1 (revue sobriété §08 Bloc A 2026-05-01 A3)** : le stock rolls est lu cross-schema par la Plateforme via la vue `plateforme.v_stocks_rolls` (lecture directe `tms.stocks_rolls_traiteurs`). Aucun push HTTP TMS.

### R4.2 — Alerte stock bas

```
si stocks_rolls_traiteurs.quantite_actuelle
   < (quantite_cible × seuil_alerte_stock_roll_pct / 100) :
   → Alerte M11 gravite = warning
   → Notification Ops Savr : "Stock roll [type] bas chez [traiteur] — X en stock, cible Y"
```

**Seuil V1** : `seuil_alerte_stock_roll_pct = 50` (alerte si stock < 50% de la cible). Paramétrable.

### R4.3 — Stock négatif

Si `nouveau_stock < 0` → alerte M11 `m09_stock_negatif` `gravite = warning` (audit) + pas de blocage (chauffeur peut se tromper de sens). Ops régularise manuellement via E3 recompte (W2).

> *Tranché Val 2026-06-07 (session test-scenarios M09, floue #1)* : → **warning** — alignement sur M09 §9 post-sobriété (« M09 n'émet aucune alerte critical V1 »). M09 fait foi.

### R4.4 — Calcul paliers rolls suggérés à la préparation tournée

Lors de la constitution d'une tournée (M04), M09 calcule le nombre de rolls à emporter par type :

```
paliers = parametres_tms.stock.palier_rolls_par_pax_seuils
          (seed V1 : [{pax_max: 100, rolls: 1}, {pax_max: 200, rolls: 2},
                      {pax_max: 400, rolls: 4}, {pax_max: 800, rolls: 8},
                      {pax_max: null, rolls: null}]  — null/null = saisie manuelle Ops requise >800 pax)

nb_rolls_suggeres = paliers.find(p => tournee.nb_pax_total <= p.pax_max).rolls
```

> *Tranché Val 2026-06-07 (session test-scenarios M09, floue #4)* : → **`palier_rolls_par_pax_seuils`** + seed M09 E5 (100/200/400/800/null). Pas de variante par flux V1. M09 fait foi.

Affichage informatif pour Ops Savr (pas de blocage si le chauffeur emporte plus ou moins).

**Paramétrage** : les paliers sont modifiables par **Ops Savr** (pas seulement Admin TMS) via M13 Admin TMS. Dans `parametres_tms`, `modifiable_par = ['admin_tms', 'ops_savr']` pour le paramètre `palier_rolls_par_pax_*`. Valeurs V1 à affiner après les premiers mois terrain (cf. §00 Index TMS Question 14).

### R_M09.5 — Recompte Ops trace écarts (nouvelle 2026-04-25, propagation M09 V1)

```
trigger applicatif W2 M09 (E3 modal recompte rolls traiteur) :
   ecart_absolu = |qte_recomptee - qte_actuelle_avant|
   ecart_relatif = ecart_absolu / NULLIF(qte_actuelle_avant, 0)

   si ecart_absolu >= 3 OU ecart_relatif >= 0.30 :
      → INSERT tms.audit_logs (
          table='stocks_rolls_traiteurs', row_id=stock_id,
          action='M09_RECOMPTE_ECART_ROLLS',
          diff={ancien, nouveau, delta},
          acteur_meta={motif, user_id})
```

Audit only (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 `m09_recompte_ecart_rolls` info dégagée, audit_logs reste source de vérité). Exploitation via SQL d'audit ou export Supabase Studio à la demande.

### R_M09.6 — Tare contenant : modification audit + pas de recalcul rétroactif (nouvelle 2026-04-25, propagation M09 V1)

```
trigger AFTER UPDATE sur types_contenants.tare_kg :
   INSERT tms.audit_logs (
       table='types_contenants', row_id=NEW.id,
       action='TYPE_CONTENANT_TARE_UPDATE',
       diff={old: OLD.tare_kg, new: NEW.tare_kg, slug: NEW.slug, libelle: NEW.libelle},
       acteur_user_id=current_user)
   # Bloc 3 sobriété 2026-04-25 A1 : alerte M11 m09_tare_modifiee info dégagée — audit_logs reste source de vérité

   # PAS de recalcul rétroactif des pesees_brutes.tare_kg (snapshot figé)
   # PAS de mutation des stocks (granularité par type uniquement)
```

Le snapshot `pesees_brutes.tare_kg` (calculé `types_contenants.tare_kg × nb_contenants` au moment de la pesée) est **figé** définitivement. Garantit cohérence reportings historiques. Cf. §04 niveau 2 `pesees_brutes`.

### R_M09.7 — Push webhook S8 obligatoire à chaque update stock rolls — **Supprimée V1 (revue sobriété §08 Bloc A 2026-05-01 A3)**

> Webhook S8 supprimé : la Plateforme lit le stock rolls **cross-schema** via `plateforme.v_stocks_rolls` (lecture directe `tms.stocks_rolls_traiteurs`). TMS = source de vérité unique, plus aucun push HTTP, plus de table miroir `plateforme.lieux_stocks_rolls`, plus d'alerte `m09_webhook_s8_dlq`. Voir [[08 - Contrat API Plateforme-TMS#Addendum 2026-05-01 — Revue sobriété §08 Bloc A]].

**(Pseudo-code historique — non implémenté V1)** :

```
W1 (clôture collecte ZD M05) OU W2 (recompte Ops E3) :
   après UPDATE stocks_rolls_traiteurs réussi :
      enqueue webhook S8 'tms/traiteur-stock-rolls-update'
        payload = { traiteur_id, lieu_id, type_contenant_id, collecte_id (W1 only),
                    stock_precedent, stock_actuel, source ('cloture_collecte'|'recompte_ops'),
                    delta, calcule_le }
      retry policy standard 5min/1h/24h (3 paliers, simplifié revue sobriété §08 Bloc B 2026-05-01 B1 — ex-5 paliers)
      si DLQ final (5 retries épuisées) :
         → tms.alerte_emit('m09_webhook_s8_dlq', 'stocks_rolls_traiteurs', stock_id,
                           criticite='critical', destinataires=['ops_savr','admin_tms'],
                           email_resend=true)
         replay manuel via M13 E5 (events `echec_final`)
```

Idempotence Plateforme : `event_id` UUID + `(traiteur_id, type_contenant_id, lieu_id, calcule_le)` clé naturelle de dédup.

### R_M09.8 — Type contenant : archivage interdit si stock > 0 ou pesées historiques (nouvelle 2026-04-25, propagation M09 V1)

```
BEFORE UPDATE sur types_contenants WHEN (NEW.statut = 'archive' AND OLD.statut <> 'archive') :
   IF EXISTS (SELECT 1 FROM stocks_rolls_traiteurs
              WHERE type_contenant_id = NEW.id AND quantite_actuelle > 0)
   OR EXISTS (SELECT 1 FROM pesees_brutes WHERE type_contenant_id = NEW.id)
   THEN
      RAISE EXCEPTION 'Type contenant utilisé : % stocks actifs et % pesées historiques.
                       Décommissionnement impossible. Soldez d''abord les stocks via E3
                       (motif "Décommission type contenant").', stocks_count, pesees_count;
   END IF;
```

Enforced DB. UI Admin TMS bloque l'archivage avec message explicite avant tentative.

---

## R5 — Alertes Veolia et exutoires (M10)

Source : §03 M10 + [[06 - Fonctionnalités détaillées TMS/M10 - Gestion exutoires Veolia|§06 M10]] + `passages_veolia` + `stocks_bacs_entrepot` + `recomptages_stocks_entrepot_log` + `parametres_tms` namespace `m10_*`.

> **Refonte 2026-04-30 (V3 sobre — revue de sobriété)** : suppression dualité `realise`/`confirme_at`, suppression confirmation chauffeur M05 (R5.4 bis retirée), suppression cron escalade gradient + auto-confirmation J+7 (R5.10 retirée), suppression distinction déclaration vs confirmation (R5.9 retirée), statut réduit à 3 valeurs, fusion alertes saturation (`m10_bac_remplissage_85` fusionné dans `m10_bac_satur` criticité dynamique).
>
> **Refonte 2026-04-25 (propagation M10 V1)** : R5.1/R5.2 modernisées (codes alertes M11 canoniques), R5.3 reformulée (seuil absolu par couple `flux × type_contenant`, plus de seuil global), R5.5/R5.6/R5.7/R5.8 ajoutées.

### R5.1 — Alerte passage Veolia non confirmé (criticité dynamique, V3 sobre 2026-04-30)

```
cron horaire (m10_alerte_non_confirme) :
si passages_veolia.statut = 'planifie' :
   delta = passage.date_prevue - now()::date

   si delta <= '24h'::interval ET passage.date_prevue >= now()::date - '1 day' :
      → tms.alerte_emit('m10_passage_non_confirme', 'passages_veolia', passage.id, ...)
      → criticité = 'warning' (J-1 anticipation OU J+1 retard)
      → destinataires : roles=['ops_savr']

   sinon si passage.date_prevue < now()::date - '1 day' (passage prévu il y a > 1 jour, non déclaré) :
      → tms.alerte_emit('m10_passage_non_confirme', 'passages_veolia', passage.id, ...)
      → criticité = 'critical' (retard significatif)
      → destinataires : roles=['ops_savr','admin_tms']
      → email Resend
```

**Fusion C1 V3 sobre 2026-04-30** : un seul code `m10_passage_non_confirme` couvre désormais l'anticipation J-1 + retard J+1 + retard significatif > 1j (criticité dynamique). Plus de cron quotidien escalade gradient W12.

Auto-résolution : `passages_veolia.statut → 'realise'` ou `'annule'` ([[06 - Fonctionnalités détaillées TMS/M10 - Gestion exutoires Veolia|M10]] W7).

### R5.2 — Alerte annulation / report passage (V3 sobre 2026-04-30)

```
trigger AFTER UPDATE sur passages_veolia (transition OLD.statut = 'planifie' AND NEW.statut = 'annule') :
   si NEW.motif_annulation = 'report' :
      → tms.alerte_emit('m10_passage_reporte', ...)
   sinon si NEW.motif_annulation IN ('annulation', 'autre') :
      → tms.alerte_emit('m10_passage_annule', ...)

   → criticité = 'warning' par défaut
   → escalade 'critical' si quantite_pleine du flux > seuil_saturation_pleins au moment de l'annulation/report
   → destinataires : roles=['ops_savr'] (+ admin_tms si critical)
```

> **V3 sobre 2026-04-30 (B2)** : ancien statut `reporte` supprimé. Le report = `annule` avec `motif_annulation = 'report'`. Si Ops veut tracer le nouveau passage, il le crée explicitement via E4 (lien optionnel `passage_origine_id`).

Auto-résolution : `m10_passage_reporte` résolu par création nouveau passage `planifie` pour le même flux. `m10_passage_annule` pas d'auto-résolution.

### R5.3 — Alerte saturation entrepôt **(reformulée 2026-04-25, fusion B3 V3 sobre 2026-04-30)**

```
trigger AFTER UPDATE sur stocks_bacs_entrepot.quantite_pleine :
   # Saturation absolue (seuil R5.3) — criticité critical
   si NEW.quantite_pleine > NEW.seuil_saturation_pleins
      ET (OLD.quantite_pleine <= OLD.seuil_saturation_pleins
          OU pas d'alerte m10_bac_satur critical ouverte) :
      → tms.alerte_emit('m10_bac_satur', 'stocks_bacs_entrepot', NEW.id,
                        criticite='critical',
                        context={flux, type_contenant_id, quantite_pleine, seuil})
      → destinataires : roles=['ops_savr','admin_tms']
      → email Resend (canal critical M11)

   # Seuil 85% jauge — criticité warning (FUSION B3 dans m10_bac_satur)
   si NEW.capacite_max > 0
      ET NEW.quantite_pleine / NEW.capacite_max::float >= m10_seuil_alerte_85_pct (default 0.85)
      ET NEW.quantite_pleine <= NEW.seuil_saturation_pleins
      ET pas déjà m10_bac_satur ouverte pour ce couple :
      → tms.alerte_emit('m10_bac_satur', ..., criticite='warning')
```

**Fusion B3 V3 sobre 2026-04-30** : un seul code `m10_bac_satur` au lieu de 2 (ancien `m10_bac_remplissage_85` warning fusionné). Criticité dynamique gérée par règle scope dans `alertes_catalogue`.

**Refonte vs V0** : → seuil absolu **par couple** `(flux, type_contenant_id)` dans la colonne `stocks_bacs_entrepot.seuil_saturation_pleins` (cf. addendum M10 §04). Configurable Admin TMS via M13.

Auto-résolution : déclaration passage `realise` R5.4 v3 (reset total stock) OU recomptage E7 corrige sous le seuil ([[06 - Fonctionnalités détaillées TMS/M10 - Gestion exutoires Veolia|M10]] W6/W3).

### R5.4 v3 — Reset total stock pleins à la déclaration `realise` **(refonte 2026-04-30 V3 sobre — revue de sobriété)**

La déclaration `passages_veolia.statut = 'realise'` (saisie Ops E5 avec checkbox vidéo obligatoire) **vaut confirmation effective** et déclenche immédiatement le **reset total** des bacs pleins du couple `(flux, type_contenant_id)` du passage en stock entrepôt. Process humain : Ops vérifie via vidéosurveillance que les bacs ont été vidés AVANT de cliquer "Marquer réalisé" (case à cocher `verification_video_at` audit simple inline). Plus de second flux confirmation (suppression `confirme_at` et 6 colonnes V2 associées).

```
-- Trigger V3 simplifié : reset total à la déclaration realise
trigger AFTER INSERT OR UPDATE sur passages_veolia
WHEN (INSERT : NEW.statut = 'realise' — cas a posteriori R5.8 v3 ; UPDATE : OLD.statut = 'planifie' AND NEW.statut = 'realise') :
-- (précision 2026-06-07 — AFTER UPDATE seul ne couvrait pas l'INSERT direct a posteriori)
   # Snapshot pré-reset
   stock_avant = (SELECT * FROM stocks_bacs_entrepot
                  WHERE flux = NEW.flux AND type_contenant_id = NEW.type_contenant_id);

   # Reset total des pleins du couple (flux, type_contenant_id)
   UPDATE stocks_bacs_entrepot SET
     quantite_pleine = 0,
     quantite_vide_disponible = quantite_vide_disponible + stock_avant.quantite_pleine,
     derniere_maj_at = now()
   WHERE flux = NEW.flux AND type_contenant_id = NEW.type_contenant_id;

   # Trace dans recomptages_stocks_entrepot_log avec motif 'reset_passage_veolia'
   INSERT INTO recomptages_stocks_entrepot_log (...)
     VALUES (..., motif = 'reset_passage_veolia ' || NEW.id, recompte_par_user_id = NEW.saisi_par_user_id);

   # Auto-résolution alertes M10 ouvertes pour ce couple
   tms.alerte_resoudre_auto('m10_bac_satur', ..., 'passage_veolia_realise');
   tms.alerte_resoudre_auto('m10_passage_non_confirme', NEW.id, 'passage_realise');
```

**Présomption métier V1** : Veolia vide tout ou rien (cas terrain réel). Si Veolia n'enlève qu'une partie (cas EC7 v3 rare), Ops constate le résiduel via vidéo et soit ne déclare pas `realise` (rester `planifie` jusqu'à passage complémentaire), soit déclare puis recompte E7 immédiatement pour rectifier.

**Important** : la déclaration `realise` est **terminale** (R5.7 v3). Plus de gestion de désynchronisation `realise sans confirmation` ni d'auto-confirmation J+7. Si Ops déclare à tort → correction via recomptage E7 uniquement.

**Champ `nb_bacs_enleves`** : conservé pour audit + statistiques (reporting Veolia, comparaison déclaration vs estimation), mais **n'a pas d'effet métier** sur le stock V1 (R5.4 v3 reset total piloté par transition `statut`, pas par cette valeur). Réservé V2 pour facturation Veolia (D6 reporté V2).

> **Suppressions revue sobriété 2026-04-30** :
> - Ancienne **R5.4 v2** (reset à confirmation effective avec 3 sources) → remplacée par R5.4 v3
> - Ancienne **R5.4 bis** (3 sources mutuellement exclusives — chauffeur_tournee / ops_manuel / auto_confirmee_j7 + lock optimiste) → supprimée (corollaire A1/A2/A3)
> - Ancienne **R5.9** (distinction déclaration vs confirmation effective, deux étapes deux acteurs) → supprimée (corollaire A2)
> - Ancienne **R5.10** (cron escalade gradient J+1 warning / J+3 critical / J+7 auto-confirmation) → supprimée (corollaires A3/A4)

### R5.5 — Auto-incrémentation `quantite_pleine` à clôture tournée ZD **(nouvelle 2026-04-25)**

```
trigger AFTER UPDATE sur tournees
WHEN (OLD.statut <> 'terminee' AND NEW.statut = 'terminee' AND NEW.stock_entrepot_update_at IS NULL) :
   # Filtre interne : itération sur pesees rattachées à la tournée
   # WHERE pesees.tournee_id = NEW.id   -- refonte multi-camions 2026-05-25 : pesees porte tournee_id (dénormalisé), plus collectes_tms.tournee_id retiré
   # AND pesees.flux IN ('biodechet','verre','dechet_residuel','emballage','carton')  -- 5 flux ZD V1 (post-refonte 2026-05-02)
   # Si 0 pesées ZD (cas tournée AG pure) → no-op silencieux
   pour chaque pesee_brute rattachée aux collectes ZD de la tournée :
     UPDATE stocks_bacs_entrepot SET
       quantite_pleine = quantite_pleine + nb_bacs_pleins(pesee.flux, pesee.type_contenant_id),
       quantite_vide_disponible = GREATEST(0, quantite_vide_disponible - nb_bacs_pleins),
       derniere_maj_at = now()
     WHERE flux = pesee.flux AND type_contenant_id = pesee.type_contenant_id;
     # EC14 redéfini (arbitrage 2026-06-07 F4) : si (quantite_vide_disponible - nb_bacs_pleins) < 0
     # avant GREATEST (chauffeur retourne plus de bacs que sortis) → clamp à 0
     # + tms.alerte_emit('m10_stock_incoherence', criticite='warning')

   UPDATE tournees SET stock_entrepot_update_at = now() WHERE id = NEW.id;
```

**Source** : [[06 - Fonctionnalités détaillées TMS/M10 - Gestion exutoires Veolia|M10]] W1.

**Fallback** : si `pesees_brutes` vide (chauffeur clôture sans aucune pesée) → aucun mouvement stock (la collecte n'a pas effectivement collecté). Cas nominal post-revue sobriété 2026-04-29 : R_M05.18 présomption 0kg supprimée avec `flux_prevus`.

**Trigger en aval** : alimentation R5.3 (seuil saturation) + alerte vides sous seuil si `quantite_vide_disponible < quantite_vide_cible`.

### R5.6 — Recomptage manuel Ops trace écart **(nouvelle 2026-04-25, V3 sobre 2026-04-30)**

```
fonction tms.m10_recompter(stock_id, qte_pleine_apres, qte_vide_apres, motif) :
   # Validation motif obligatoire si écart significatif
   ecart_pleins = abs(qte_pleine_apres - stock.quantite_pleine)
   ecart_relatif = ecart_pleins / GREATEST(stock.quantite_pleine, 1)
   ecart_vides = abs(qte_vide_apres - stock.quantite_vide_disponible)

   si (ecart_pleins >= m10_recomptage_motif_seuil_abs (default 5)
       OU ecart_relatif >= m10_recomptage_motif_seuil_rel (default 0.20)
       OU ecart_vides >= m10_recomptage_motif_seuil_abs)
      ET (motif IS NULL OR length(trim(motif)) = 0) :
      → RAISE EXCEPTION 'Motif obligatoire si écart significatif'

   # INSERT log append-only
   INSERT INTO recomptages_stocks_entrepot_log (...)

   # UPDATE stock (V3 : `quantite_pleine_recomptee` supprimée — B5 revue sobriété 2026-04-30)
   UPDATE stocks_bacs_entrepot SET
     quantite_pleine = qte_pleine_apres,
     quantite_vide_disponible = qte_vide_apres,
     ...
   WHERE id = stock_id;

   # INSERT audit_logs si écart significatif (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 m10_recomptage_ecart info dégagée V1)
   si ecart_pleins >= m10_recomptage_motif_seuil_abs OR ecart_relatif >= m10_recomptage_motif_seuil_rel :
      INSERT INTO tms.audit_logs (
        table='stocks_bacs_entrepot', row_id=stock_id,
        action='M10_RECOMPTAGE_ECART',
        diff={ecart_pleins, ecart_relatif, motif},
        acteur_user_id=recompte_par_user_id);
```

**Note Bloc 3 sobriété 2026-04-25 A1** : alerte M11 `m10_recomptage_ecart` info retirée. La trace est portée par `recomptages_stocks_entrepot_log` (append-only) + `tms.audit_logs` (action `M10_RECOMPTAGE_ECART`). Exploitation V2 (dashboard qualité saisie chauffeur) via SQL d'audit ou export Supabase Studio à la demande.

### R5.7 v3 — Toute transition depuis un état terminal (`realise`, `annule`) interdite **(V3 sobre 2026-04-30 — simplifiée ; étendue arbitrage 2026-06-07 F3)**

```
trigger BEFORE UPDATE sur passages_veolia (`trg_m10_anti_deconfirmation` étendu) :
   si OLD.statut IN ('realise', 'annule') AND NEW.statut <> OLD.statut :
      → RAISE EXCEPTION 'Transition depuis un état terminal interdite. Correction stock via recomptage manuel E7 ; report = créer un nouveau passage planifie'
```

> **Extension 2026-06-07 (F3, arbitrage Val)** : le trigger couvre désormais les **2 états terminaux**. Auparavant seul `realise` était protégé en DB ; `annule → planifie` n'était bloqué que par l'UI (incohérence avec §8 M10 "annule terminal" + risque CHECK motif_annulation non purgé).

Préserve l'audit trail. Si erreur de saisie sur `realise`, Ops Savr doit créer un recomptage manuel E7 (motif "Correction passage erroné saisi le [date]") qui restaure le stock pré-passage.

> **Simplification revue sobriété 2026-04-30** : ancien second trigger sur `confirme_at` (transition NOT NULL → NULL interdite) supprimé puisque la colonne `confirme_at` elle-même est supprimée (corollaire A2). Un seul trigger anti-déconfirmation V3.

### R5.8 v3 — Création passage a posteriori autorisée **(V3 sobre 2026-04-30 — simplifiée)**

E4 autorise toute `date_prevue` (arbitrage 2026-06-07 F1 — aucune contrainte de date). Si `date_prevue < now()::date` (**strictement** — passage Veolia non prévu mais déjà réalisé, y compris la veille) → INSERT direct statut `realise` + reset stock immédiat via fonction atomique. Si `date_prevue = now()::date` → INSERT `planifie` normal (Ops déclarera via E5). Plus de logique 3-source (corollaire A2).

```
fonction tms.m10_creer_passage_a_posteriori(date_realise_at, flux, type_contenant_id, nb_bacs_enleves, ops_user_id, commentaire) :
   # Transaction atomique
   INSERT INTO passages_veolia (
     date_prevue = date_realise_at::date,
     statut = 'realise',
     statut_realise_at = date_realise_at,  -- valeur saisie, pas now() (arbitrage 2026-06-07 F2 — le passage peut dater de la veille)
     verification_video_at = now(),  -- Ops a constaté → cochage auto
     flux,
     type_contenant_id,
     nb_bacs_enleves,
     cree_par_action = 'saisie_manuelle',
     saisi_par_user_id = ops_user_id,
     commentaire,
     ...
   )
   # Trigger trg_m10_reset_total_pleins (V3) déclenche reset total stock + auto-résolution alertes
   # Précision 2026-06-07 : le trigger doit être défini AFTER INSERT OR UPDATE
   # (WHEN INSERT : NEW.statut = 'realise' ; WHEN UPDATE : OLD.statut = 'planifie' AND NEW.statut = 'realise')
   # sinon l'INSERT direct a posteriori ne déclencherait pas le reset (AFTER UPDATE seul insuffisant)
```

`cree_par_action = 'saisie_manuelle'` (pas une variante distincte — E4 unifiée).

---

## R6 — Cycle de vie des entités

### R6.1 — Cycle de vie `collectes_tms`

**Statut dispatch** (qui prend en charge) :

```
a_attribuer → attribuee_en_attente_acceptation (Ops attribue prestataire manuellement — revue sobriété 2026-04-29 : auto-relance W3 supprimée)
             → annulee_par_traiteur (annulation Plateforme avant attribution)
attribuee_en_attente_acceptation → acceptee (Strike/Marathon : manager accepte via portail M03 → S1 ; A Toutes! : webhook Everest mission_dispatched → S1 — M14 W2/R_M14.1bis arbitrage Val 2026-05-29 ; A Toutes! Everest down : failover Ops manuel M14 W4)
             → rejetee_par_prestataire → a_attribuer (réattribution manuelle Ops M02 W5)
             → annulee_par_traiteur
acceptee    → annulee_par_traiteur (avant heure de collecte, pas de facturation)
             → [badge `re_confirmation_requise=true` si PATCH post-acceptation, reset à l'ack prestataire — M01 D6]
```

**Statut opérationnel** (état terrain) :

```
planifiee → en_cours (chauffeur démarre tournée sur app M05)
          → annulee (incident avant arrivée, motif unique client_annule_avant_arrivee — Bloc D 2026-05-01 + M05 E4, aligné 2026-07-06 RC-M05-07 — sans passer par en_cours)
en_cours  → realisee (clôture normale — pesées saisies, rolls déclarés)
          → realisee_sans_collecte (AG uniquement — bouton "Aucun repas", photo + commentaire obligatoires)
          → incident (problème terrain — collecte peut rester en incident ou passer à realisee après résolution)
          → annulee (annulation après démarrage — vacation Strike facturée, flag `annulee_pendant_en_cours=true` M01 D8)
```

**Règles de transition** :
- `en_cours → realisee` : requiert `pesees.count >= 1` pour ZD, ou `pesees.count >= 0` pour AG (0 kg possible = `realisee_sans_collecte`).
- **Multi-véhicules — `realisee` dérivé (2026-05-25, arbitrage 6a ; couvre le multi-vélo AG 2026-05-29)** : une collecte servie par N tournées (via `collecte_tournees`) passe à `realisee` quand **toutes** ses tournées sont `terminee` (chacune clôturée par son chauffeur, qui a pesé sa portion). Le statut collecte est **dérivé** des statuts de tournées, pas posé directement par un chauffeur unique. Trigger DB `tms.fn_derive_statut_collecte_multi_tournees()` `AFTER UPDATE OF statut ON tms.tournees` : à chaque passage d'une tournée à `terminee`, pour chaque collecte de cette tournée, si **toutes** ses tournées liées sont `terminee` → collecte `realisee` (ZD : garde `SUM(pesees.poids_net) > 0` ; sinon alerte Ops). C'est cette transition qui **insère l'event S5 terminal unique dans `tms.outbox_events`** (le worker §08 §2bis livre le webhook — elle n'« émet » pas le webhook directement ; pesées des N véhicules sommées par `(collecte_tms_id, flux)` pour le ZD, ou `don_alimentaire` total pour l'AG, cf. §08). **Multi-vélo AG (2026-05-29)** : mécanique identique — les N vélos A Toutes! d'une même collecte sont N tournées sœurs ; la collecte passe `realisee` quand les N sont clôturées. **Cas standard (1 tournée)** : la dérivation se réduit à "la tournée unique est `terminee` ⇒ collecte `realisee`" = comportement identique à avant. **Concurrence (revue adversariale 2026-07-06 RC-M04-01)** : le trigger sérialise **par collecte** (`SELECT … FOR UPDATE` sur `collectes_tms` avant ré-évaluation, ordre de lock déterministe) — deux clôtures de tournées sœurs simultanées ne peuvent pas perdre la dérivation.
- `en_cours → realisee_sans_collecte` : AG uniquement, requiert `aucun_repas_motif IS NOT NULL AND aucun_repas_photo_url IS NOT NULL`.
- **Fin de portion par tournée (arbitrage Val 2026-07-06 RC-M05-01)** : le clic chauffeur « Terminer collecte » (M05 W8) pose `collecte_tournees.statut_execution='faite'` pour (collecte, SA tournée) — il ne pose **jamais** `statut_operationnel=realisee` directement. La gate « Terminer la tournée » (M05 E4) lit `statut_execution` de ses propres liaisons (lève le livelock multi-camions : chaque chauffeur peut clôturer sa tournée sans attendre les tournées sœurs).
- **Pesée tardive post-dérivation (arbitrage Val 2026-07-06 RC-M05-04)** : un INSERT `pesees` sur une collecte déjà `realisee` déclenche automatiquement un S5 `type=correction` (trigger `trg_pesee_tardive_s5_correction` §04 — déclencheur (c) du §08 étendu à toute source) ; la Plateforme régénère bordereau/attestation versionnés.
- **`planifiee → annulee` (incident avant arrivée — aligné 2026-07-06 sur M05 E4 + §08 S9, revue adversariale RC-M05-07 ; ex-`planifiee → incident` 2026-04-29)** : transition ZD ET AG autorisée depuis M05 E4 (overlay "Signaler incident") sans passer par `en_route` / `arrivee` / `en_cours`. **Motif unique : `client_annule_avant_arrivee`** (revue sobriété §08 Bloc D 2026-05-01 — `vehicule_panne`/`accident_route`/`chauffeur_indisponible` retirés, gérés hors app via appel Ops ; enum `type_incident` = 5 valeurs). Webhook S9 `incident` émis avec `geofence_status='avant_arrivee'` et `statut_collecte_apres='annulee'`. Statut collecte après transition : `annulee` (terminal, pas de pesée à attendre — la valeur `incident` est inexprimable dans l'enum S9). Tournée passe à `terminee` automatiquement si toutes collectes restantes terminales (R6.2). Zéro coût M07 pour la collecte (pas de vacation honorée), mais coût tournée préservé si autres collectes réalisées.
- Cas particulier `en_cours` + annulation client (DELETE E3 Plateforme) → `statut_dispatch='annulee_par_traiteur'` + `annulee_pendant_en_cours=true` (propagation A1 2026-04-25), mais `statut_operationnel` reste `en_cours` jusqu'à clôture chauffeur puis passe à `realisee` (saisie pesées justif vacation). Pas de notif client, vacation prestataire facturée (R2.7 bis).
- Toute transition vers un statut terminal (`realisee`, `realisee_sans_collecte`, `incident`, `annulee_par_traiteur`) déclenche les effets suivants (refondu revue sobriété §05 2026-05-01 B4) :
  - Mise à jour du stock rolls (si applicable, cf. R4 — lecture cross-schema Plateforme via `plateforme.v_stocks_rolls`, plus de push S8 ; R_M09.7 supprimée revue sobriété §08 Bloc A 2026-05-01)
  - Calcul coût M07 sur la tournée : déclenché à la **clôture de la tournée** par le chauffeur (transition tournée → `terminee`, cf. R6.2 reframe multi-camions 2026-05-25), plus à la dérivation collecte→`realisee` qui en découle
  - **Émission webhooks Plateforme selon le mapping §08** : S5 `collecte-terminee` à `realisee` / `realisee_sans_collecte`, S9 `incident` à `incident`, **PAS de webhook à `annulee_par_traiteur`** (l'annulation est l'ack TMS du DELETE Plateforme E3, pas un nouvel event sortant). Voir matrice transitions/webhooks §08 contrat API pour le mapping authoritative.

> **Refonte B4** : ancienne formulation "déclenche [...] push webhook Plateforme" générique supprimée — induisait Claude Code à émettre des webhooks fantômes (notamment sur `annulee_par_traiteur`). Le mapping exact transition → webhook est unique source de vérité dans §08.

**Addendum 2026-04-23 seconde salve M01 — Simplifications** :
- Suppression de la branche "pré-affectation Plateforme" (ex-D10 M01 supprimée). Plus de transition `→ attribuee` à réception webhook E1. Toutes les collectes arrivent en `a_attribuer`.
- → **Enum + colonne supprimés V1 (revue sobriété 2026-04-29 puis acté propagation M01 B_M01_04 + D_M01_03 — 2026-04-30)** : auto-relance M12 W3 supprimée, attribution toujours manuelle Ops, donc enum à 1 seule valeur = colonne inutile. Colonne retirée de `tms.collectes_tms` §04 niveau 2.
- Nouveau statut terminal `rejetee_par_tms` possible côté Plateforme (via webhook S11 `collecte-rejetee`) — n'affecte pas le cycle TMS (qui reste en DLQ).

**Addendum 2026-04-30 sobriété M01 — Règle R_M01.X heure_collecte unifiée** *(C_M01_02)* :
- `heure_collecte` rétrograde dans le passé est **invalide à la création (W1) ET à la modification (W3)**. Refus 422 + DLQ motif `validation_metier_echec`. Cohérence des deux endpoints (E1 POST + E2 PATCH) pour empêcher Plateforme de pousser une PATCH legacy avec ancienne heure non contrôlée. Règle unifiée propagée dans M01 §5 W1 étape 3 + W3 étape 4.

### R6.2 — Cycle de vie `tournees`

```
planifiee → acceptee (tournée prête : toutes collectes acceptées + chauffeur/véhicule assignés — Strike/Marathon via manager M03 W3 ; province = créée directement `acceptee` par Ops, W2 M02, sans validation prestataire)
          → annulee (avant heure de collecte)
acceptee  → en_cours (chauffeur démarre : heure_reelle_debut renseignée — saisie plaque retirée V1, propagation 2026-06-04 ; chauffeur province inclus, il utilise l'app M05)
          → planifiee (retour si Ops ajoute une collecte non encore acceptée — la tournée n'est plus complète, M04 W2)
          → terminee (FILET DE SÉCURITÉ : toutes collectes terminales par incident/annulation AVANT démarrage, ou clôture forcée Ops W9 — tournée jamais passée en_cours. Accepté par le trigger `fn_m07_calc_cost` `OLD.statut IN ('en_cours','acceptee')`)
          → annulee
en_cours  → terminee (chauffeur clôture SA tournée — M05, heure_reelle_fin renseignée)
terminee  → [immuable sauf correction Ops dans audit_logs]
annulee   → [immuable]
```

> **Résolution spec floue 2026-06-06 (alignement enum ↔ trigger ↔ M04)** : la transition `acceptee → terminee` est désormais **explicitement listée** (elle était déjà acceptée par le trigger `fn_m07_calc_cost` mais absente de l'enum R6.2 → incohérence remontée par `cdc-test-scenarios` M04). C'est le **filet de sécurité** : une tournée prête (`acceptee`) jamais démarrée peut se clôturer directement si toutes ses collectes deviennent terminales (incident avant arrivée / annulation client) ou par clôture forcée Ops (W9). La transition `planifiee → en_cours` **directe reste interdite** (passage par `acceptee` obligatoire). Tranché Val : la tournée passe bien par `acceptee` ; le chauffeur province utilise l'app M05 comme tout chauffeur (la confirmation manuelle Ops en W2 vaut acceptation, sans validation prestataire). La règle « prestataire accepte depuis portail » ne couvrait que Strike/Marathon — précisée ici pour inclure le cas province.

**Règle de clôture tournée (reframe multi-camions 2026-05-25, arbitrage 6a ; précisée 2026-07-06, arbitrage Val RC-M04-02)** : la tournée passe à `terminee` quand **le chauffeur la clôture** (M05 "terminer la tournée" — retour entrepôt ZD / dernière livraison AG, `heure_reelle_fin` renseignée). Déclenche immédiatement M07 calcul coût. **Filet de sécurité** : la tournée s'auto-clôture aussi si **toutes** ses `collectes_tms` (via `collecte_tournees`) sont déjà terminales **par incident/annulation** (rien à collecter, pas de clôture chauffeur attendue). **Mécanisme du filet** : trigger AFTER UPDATE sur `collectes_tms` (transition vers un statut terminal non-`realisee`) ; tournée filet jamais démarrée → horaires NULL et **coût 0 € sans alerte critical** (exception au précheck `m07_horaires_manquants`). **Gardes (RC-M04-04)** : toute clôture = `UPDATE … WHERE statut IN ('en_cours','acceptee')` (0 ligne = no-op/409) ; la matrice de transitions ci-dessus est matérialisée par le trigger DB `trg_tournees_transitions` (§04, whitelist + EXCEPTION) derrière des RPC `FOR UPDATE` — jamais de garde uniquement UX.

> **Pourquoi ce reframe** : avant, la tournée passait `terminee` "quand toutes ses collectes sont terminales", et la collecte passait `realisee` à la clôture chauffeur. Avec le multi-camions (1 collecte → N tournées), ce serait circulaire : la collecte X ne peut être `realisee` que si T1+T2+T3 sont `terminee`, mais chaque tournée attendait que X soit terminale → **deadlock**. On inverse donc : la **tournée** est pilotée par la clôture chauffeur, et le statut de la **collecte** est dérivé des tournées (cf. R6.1). Pour le cas standard (1 collecte = 1 tournée), le résultat est identique à avant (clôturer la tournée ⇒ collecte `realisee`).

### R6.3 — Cycle de vie `factures_prestataires`

```
[upload]   → en_attente (rapprochement auto en cours)
en_attente → valide (match exact zéro tolérance, auto-validé — refondu revue sobriété §05 2026-05-01 D1)
           → ecart_detecte (montants ne matchent pas)
           → rapprochement_manuel_requis (tournée période sans `cout_final_ht`, R_M08.8)
valide     → regle (règlement effectif enregistré W8)
ecart_detecte → valide (Ops accepte l'écart)
              → conteste (Ops conteste) → [attente facture rectificative prestataire]
conteste   → valide (après résolution) → regle
```

### R6.4 — Cycle de vie `shared.prestataires` (propagation M06 2026-04-24)

```
actif ─[Admin TMS clique "Fin de contrat" M06 E8]─→ suspendu (date_fin_contrat = J+30)
  ↑                                                   │
  │                                                   ├─[trigger cron journalier si date_fin_contrat <= today]─→ archive
  └─[Admin TMS clique "Réactiver"]───────────────────┘   (users_tms associés → archive, magic link désactivé)

archive → [immuable via UI, historique conservé 5 ans]
```

**Règles de transition** :
- `actif → suspendu` : workflow M06 E8 (écran unique), **bloqué** si au moins 1 tournée en statut `planifiee/acceptee/en_cours` **OU** 1 collecte `statut_dispatch IN ('attribuee_en_attente_acceptation','acceptee')` rattachée au prestataire *(tranché Val 2026-06-07 test-scenarios M06 #1 — `a_attribuer` exclu : collecte non rattachée à un prestataire)*. Admin TMS doit d'abord réattribuer ou clôturer avant de continuer.
- `suspendu → actif` : bouton "Réactiver" dans M06 E2 (Admin TMS). `date_fin_contrat = NULL`, `users_tms` associés réactivés. **Grille expirée pendant la suspension tolérée** *(tranché Val 2026-06-07 test-scenarios M06 #2)* : `trg_prestataire_grille_obligatoire` ne porte que sur `en_onboarding → actif` — la réactivation passe sans grille active, bandeau warning E2, filet aval M07 coût non calculable → M08 `rapprochement_manuel_requis`.
- `suspendu → archive` (auto) : trigger cron journalier (Edge Function scheduled) qui passe `statut = 'archive'` pour tous les prestataires `WHERE statut = 'suspendu' AND date_fin_contrat <= today`. Archive également les `users_tms` associés (soft delete).
- `suspendu → archive` (manuel) : bouton "Archiver maintenant" disponible pendant la période de suspension si Admin TMS souhaite accélérer.
- `archive → *` : interdit via UI. Intervention DB Admin requise si erreur.

**Effets de l'archivage** :
- Plus aucune nouvelle attribution possible (M12 exclut `statut != 'actif'`).
- Tournées historiques conservées (FK vers `shared.prestataires.id` reste valide).
- Managers + chauffeurs du prestataire perdent l'accès TMS (`users_tms.statut = 'archive'`, JWT invalidé au refresh).
- Documents chauffeurs purgés après 3 ans d'archivage (cf. §09 cron RGPD).

### R6.5 — Cycle de vie `tms.alertes` (vue d'ensemble — refondu revue sobriété §05 2026-05-01 C3)

> **Source de vérité authoritative pour les transitions et CHECK constraints** : **R_M11.11** ci-dessous (§R11). R6.5 fournit uniquement le diagramme synthétique pour navigation rapide. Toute mise à jour des règles de transition, de l'enum `alerte_statut`, du CHECK `alertes_ackee_coherence` ou de la sémantique ack/snooze/résolution se fait **exclusivement dans R_M11.11**.

```
[ouverte] (émise par alerte_emit)
    │
    ├─ W4 ack user   → metadata update (ackee_par_user_id + ackee_at, statut reste ouverte)
    ├─ W5 snooze 1h/4h/24h           → [snoozee]
    ├─ W6 résolution manuelle        → [resolue]
    └─ W7 résolution auto (trigger)  → [resolue]

[snoozee]
    │
    ├─ cron m11_unsnoozer            → [ouverte] (reset ackee_at = NULL)
    ├─ W6 résolution manuelle        → [resolue]
    └─ W7 résolution auto            → [resolue]

[resolue]   (terminal V1)
```

**Détail authoritative** : R_M11.11 (transitions strictes + colonnes immuables + CHECK `alertes_ackee_coherence`). `resolue → *` impossible V1 (V2 RPC Admin motif ≥ 30 car).

**Notes historiques** (déplacées vers R_M11.11 pour unicité de source de vérité) :
- Bloc 3 sobriété 2026-04-25 A1+A7 : statut `[expiree]` retiré V1
- Bloc 6 B2 sobriété 2026-04-28 : statut `ackee` retiré enum → metadata, enum `alerte_statut` 4 → 3 valeurs

> **Refonte C3** : ancienne duplication des règles de transition entre R6.5 et R_M11.11 supprimée — risque de divergence silencieuse à chaque ajout/modification de transition future. R6.5 = navigation visuelle, R_M11.11 = règles détaillées.

---

## R7 — App mobile chauffeur (M05) — règles métier

Issu de la rédaction de [[06 - Fonctionnalités détaillées TMS/M05 - App mobile chauffeur]] (V1 rédigée 2026-04-24, 20 décisions structurantes tranchées). 14 règles métier.

### R_M05.1 — Checklist pré-départ bloquante (révisée propagation revue sobriété M05 2026-04-29)

Une tournée ne peut pas passer en `statut=en_cours` tant que les items obligatoires de la checklist pré-départ ne sont pas validés par le chauffeur sur M05 E3. **Matrice introduite revue sobriété M05 2026-04-29** (responsabilité conformité véhicule/EPI bascule sur prestataire) :

| Type véhicule         | ZD                                             | AG                          |
| --------------------- | ---------------------------------------------- | --------------------------- |
| Camion frigo motorisé | Tenue Savr + N rolls + Film plastique          | Skip écran E3 (E2 → E4 direct) |
| Vélo cargo            | Aucune checklist (skip écran E3 → direct E4)   | Aucune checklist (skip E3)  |

> **Suppression item Plaque (propagation suppression saisie plaque terrain 2026-06-04, arbitrage Val)** : l'item Plaque de la checklist E3 est retiré. Camion ZD = 3 items (Tenue, N rolls, Film). Camion AG motorisé = plus aucun item → E3 entièrement sauté (E2 → E4 direct, comme le vélo cargo). La plaque pour contrôle d'accès reste pré-saisie manager (R_M04.CONTROLE_ACCES / R_M03.4, inchangées).

**Items E3 ZD camion (3 items, tous bloquants)** :
1. Tenue Savr (gants, gilet, pantalon, chaussures sécurité — checklist regroupée 1 item)
2. N rolls chargés (affichage `tournees.nb_rolls_suggeres` M09)
3. Film plastique

**Items E3 AG camion** : **plus d'item → écran E3 sauté (E2 → E4 direct), propagation 2026-06-04.**

**Vélo cargo** : skip total écran E3 (E2 → E4 direct, ZD ou AG).

**Suppressions vs version antérieure** : section EPI détaillée (4 items), section véhicule (état/niveaux/feux/anomalies), section photos, cas A/B plaque (pré-saisie manager vs saisie chauffeur), checklist vélo cargo détaillée, audit log `PLAQUE_OVERRIDE_CHAUFFEUR`, alerte M11 `m05_plaque_override_chauffeur`, **item Plaque saisie chauffeur (propagation 2026-06-04)**. La conformité véhicule/EPI relève désormais du manager prestataire (M03), Savr ne contrôle que ce qui impacte la collecte.

### R_M05.2 — Saisie plaque par chauffeur uniquement — **Retirée V1 (propagation suppression saisie plaque terrain 2026-06-04, arbitrage Val)**

 Plus de saisie plaque par le chauffeur. La plaque pour contrôle d'accès / registre est la plaque **pré-saisie manager** (`tournees.plaque_preassignee_manager`, webhook S7 émis depuis M03 E4 — voir R_M04.CONTROLE_ACCES). Colonne `tms.tournees.plaque_saisie_terrain` supprimée (§04). Email client T+3h déjà supprimé V1 (propagation Q10 2026-04-24).

### R_M05.3 — Auto-tare contenant paramétrable (D7/D8/D9)

La tare auto appliquée à chaque pesée vient de `types_contenants.tare_kg × nb_contenants`, snapshoté au moment de la pesée (cf. §04). Le chauffeur sélectionne le contenant à chaque pesée via dropdown M05 E6 (D7 override Val : le contenant peut varier au sein d'une même collecte). Contenants gérés par Admin TMS (M13).

### R_M05.4 — Override manuel tare avec motif obligatoire (D8)

Si le chauffeur active le toggle "Corriger la tare" M05 E6 et saisit une tare différente de la tare snapshot attendue, un motif texte libre ≥ 10 caractères est obligatoire. Audit log `action=PESEE_TARE_OVERRIDE` avec before/after + motif. Stocké `pesees.tare_override_motif`.

### R_M05.5 — Contenant `sans_contenant` = pesée sac direct (D7 bis, simplifié revue sobriété §05 2026-05-01 A3)

Le contenant virtuel `sans_contenant` (tare = 0) représente une pesée sac plastique posé directement sur la balance : `poids_net_kg = poids_brut_kg`. Si saisie `sans_contenant` + poids brut = 0, confirmation UI 2 clics avant INSERT.

**Audit V1 (au lieu d'alerte M11)** : chaque pesée 0 kg INSERT une ligne `tms.audit_logs` (action `M05_PESEE_ZERO_KG`, `acteur_user_id = chauffeur`, `diff = {pesee_id, contenant, poids_brut, collecte_id}`). Exploitation a posteriori par Admin TMS via SQL ad-hoc Supabase Studio (détection fraude/négligence chauffeur si pattern récurrent observé).

 → **Supprimée revue sobriété §05 2026-05-01 A3**. Code `pattern_pesee_zero_kg` jamais seedé au catalogue M11 (R_M11.1 violation latente). Détection abus = audit log + requête SQL admin, pas alerte temps réel.

### R_M05.6 — Équivalent repas AG = 0,45 kg / repas

Formule V1 : `nb_repas = round(poids_total_kg / plateforme.parametres_algo.poids_par_repas_kg)` (défaut **0.45** — audit sobriété 2026-05-09 B2). **Source unique cross-app** : le coefficient est défini une seule fois côté Plateforme (`parametres_algo`). V2 TMS lit cross-schema, pas de paramètre miroir côté `parametres_tms` (suppression `m05_equivalent_repas_kg`). Conversion documentée CDC App §06/09 + §04 Data Model `parametres_algo`.

### R_M05.7 — Geofence uniforme 300m (D4 override Val)

Rayon geofence 300m autour `lieux.coords_gps` pour **tout type de lieu** (simplicité, aligné seuil contrôle clôture tournée M04 R_M04.2). Déclenche transition auto `en_route → arrivee` à l'entrée geofence. Sortie du geofence avant clôture : pas de rollback (évite flapping). Paramètre `m05_geofence_rayon_metres`.

### R_M05.8 — Fallback géoloc immédiat (D5 override Val, simplifié revue sobriété §05 2026-05-01 A4)

Bouton "J'arrive" disponible dès `en_route` sans délai (pas de 3 min). Clic = transition manuelle `arrivee` + audit log `geoloc_fallback=true` (`tms.audit_logs` action `M05_ARRIVEE_GEOLOC_FALLBACK`, acteur = chauffeur). Contrat de confiance chauffeur V1.

**Détection abus a posteriori (V1)** : requête SQL ad-hoc Admin TMS sur `audit_logs` (compte par chauffeur sur fenêtre glissante). Pas de widget M11 dédié, pas de paramètre seuil.

 → **Supprimés revue sobriété §05 2026-05-01 A4**. Comportement attendu = chauffeurs en immeuble = fallback légitime fréquent → seuil paramétrable + widget dédié = sur-ingénierie. Audit log seul suffit V1; widget M11 réintroduit V1.1 si Admin TMS constate effectivement un abus systémique.

### R_M05.9 — Queue offline cap 3 tournées + 150 photos + 300 Mo (D2)

Limite dure sur le volume de données stockées en queue IndexedDB côté PWA. Au-delà du cap, l'UI bloque la création de nouvelles pesées/photos et affiche un toast demandant reconnexion. Alerte M11 si cap atteint. Paramètres : `m05_queue_offline_max_tournees`, `m05_queue_offline_max_photos`, `m05_queue_offline_max_size_mb`.

### R_M05.10 — Device binding 1 seul device actif (D12)

Un seul appareil actif par chauffeur (table `auth_sessions_tms`). Toute nouvelle connexion invalide automatiquement la session précédente (trigger DB, cf. §04). Toast sur device éjecté : "Tu as été déconnecté car l'app a été ouverte sur un autre appareil."

### R_M05.11 — Session 30 jours rolling (D13, simplifié revue sobriété §05 2026-05-01 C2 — paramètre unifié)

Durée de session par rôle pilotée par **paramètre unique JSON `parametres_tms.auth.session_duree_jours_par_role`** (default `{"chauffeur": 30, "manager_prestataire": 30, "ops_savr": 30, "admin_tms": 30}`). Source de vérité authoritative : §09 Authentification + permissions TMS.

Refresh silencieux (`last_seen_at` touché à chaque requête PWA authentifiée). Invalidation explicite possible via Admin TMS M06 (bouton "Déconnecter tous les appareils" — C5 M05). Purge pg_cron horaire des sessions expirées.

 → **Supprimé revue sobriété §05 2026-05-01 C2** — fusionné dans `auth.session_duree_jours_par_role` (clé `chauffeur`). Évite la divergence entre 3 paramètres distincts (`m05_session_duree_jours`, `m13_session_duree_jours`, implicite manager).

### R_M05.12 — Push notifications V1 : attribution + H-30 + alerte Ops (D16)

3 types de push déclenchés côté serveur :
1. Attribution tournée (chauffeur assigné par manager via M03)
2. Rappel H-30 avant `tournees.heure_planifiee_debut` (pg_cron Supabase) — propagation 2026-04-29 (créneau tournée = fenêtre opérationnelle, conservée distincte de l'heure de collecte)
3. Alerte Ops : retard, anomalie (M11)

**Skip V1** : rappel J-1 20h (D16 : faible valeur, fatigue). Réintroduction V1.1 si retour terrain. Cap 1 push / collecte / heure pour éviter spam (paramètre `m05_push_cap_par_heure_par_collecte`).

### R_M05.13 — RGPD purge 30 jours coordonnées GPS

Job pg_cron quotidien (3h matin) purge `tournees.cloture_gps`, `collectes_tms.arrivee_gps`, `collectes_tms.depart_gps` au-delà de 30 jours (paramètre `m05_rgpd_purge_geoloc_jours`). Photos et signatures conservées (archivage 6 ans obligations légales Plateforme).

### R_M05.14 — PWA reload différé fin tournée + kill switch (D3)

Une nouvelle version PWA déployée n'est pas rechargée en cours de tournée active : bannière informative discrète "Nouvelle version dispo, redémarrage à la fin de la tournée." Service worker recharge au changement d'écran après clôture tournée (E2 accueil). Kill switch serveur `m05_force_update_active=true` (paramètre TMS) force le reload immédiat en cas de bug sécurité critique.

### R_M05.15 — Résolution conflits sync offline (D1)

Au retour de connexion, la PWA rejoue la queue IndexedDB avec `idempotency_key` (W11 M05). Policy côté serveur :
- Si item déjà présent (idem key match) → return 200 noop (déduplication retry)
- Si statut cible compatible avec état serveur actuel → UPDATE / INSERT merge
- Si incompatible (ex : pesée offline sur collecte `annulee` côté back-office) → `integrations_logs.statut='echec_final'`, type `pesee_dlq` / `signature_dlq` / `incident_dlq` + alerte M11 (R_M05.16) pour arbitrage Ops

### R_M05.16 — Alerte DLQ queue offline (simplifié revue sobriété §05 2026-05-01 B2)

Job pg_cron horaire scanne `integrations_logs` où `statut='echec_final' AND type_event LIKE '%_dlq' AND created_at > now() - interval '24 hours'`. Émet alerte M11 **`warning` si > 0 items DLQ** (un seul niveau de gravité).

 → **Supprimé revue sobriété §05 2026-05-01 B2**. Le double seuil n'apporte rien tant qu'Ops ack la première alerte (aucun item DLQ silencieux). Escalade humaine via traitement de l'alerte warning (lien direct interface Admin TMS pour rejouabilité manuelle V1.1). Réintroduction V1.1 si pattern d'inaction Ops observé sur >10 items DLQ.

Lien direct vers interface Admin TMS pour rejouabilité manuelle (V1.1).

### R_M05.17 — Statuts AG-only côté chauffeur (cohérence AG vs ZD)

Rappel règle transverse : `realisee_sans_collecte` est strictement AG-only (boutons M05 "Aucun repas à collecter" E5 AG). Jamais disponible sur collecte ZD. Cohérence avec [[01 - Vision et objectifs TMS]] et mémoire règle distinction AG/ZD.

### R_M05.19 — Auth chauffeur (renvoi unifié, simplifié revue sobriété §05 2026-05-01 C4)

Auth chauffeur identique à manager prestataire — voir **R_M03.1** (politique password unifiée 2 rôles, min 8 car, hash argon2id Supabase Auth, rate limit 5 tentatives/15min/IP, reset via magic link 30 min) + **§09 Authentification et permissions TMS** (détail technique authoritative). Spécificités chauffeur conservées : device binding 1 device actif (R_M05.10), bootstrap password via magic link 30 min (R_M03.7 / D25 refondu B1).

> **Refonte C4** : ancienne duplication de la politique d'auth entre R_M05.19 et R_M03.1 + §09 supprimée — source de vérité unique R_M03.1 + §09.

### R_M05.18 — Retirée V1 (revue sobriété 2026-04-29 — suppression `flux_prevus`)

Ancienne règle "Présomption 0kg auto à la clôture collecte" supprimée avec la suppression de `collectes_tms.flux_prevus`. Le rapport recyclage Plateforme se base désormais uniquement sur les flux **réellement** pesés par le chauffeur. Plus d'auto-insertion de lignes `pesees` à 0kg, plus de distinction "non pesé" vs "non concerné" côté Plateforme.

Conséquences propagées :
- Enum `pesees.source` 3→2 valeurs (`chauffeur`, `ag_sans_collecte` — `presume_non_pese` retiré)
- Webhook S5 `collecte-terminee` : flag `presume_non_pese` retiré du payload
- M04 : plus aucune logique présomption (W5/W6 nettoyés)
- M05 : plus d'algo SQL R_M05.18 à la clôture (W8)

### R_M04.1 — Retirée V1 (propagation M04 2026-04-24)

Ancienne règle "Présomption 0kg à la clôture tournée" — supprimée définitivement V1 (revue sobriété 2026-04-29).

### R_M04.CONTROLE_ACCES — Trigger DB blocage validation tournée si plaque OU nom chauffeur manquant (restauré 2026-05-01 — renommé + étendu 2026-05-03 refonte formulaire §06.01 Plateforme : ex R_M04.PLAQUE)

Si au moins une des `collectes_tms` liées à une tournée a `controle_acces_requis=true` (ex `plaque_requise`), la tournée ne peut pas passer du statut `planifiee` à `acceptee` (workflow dispatch M03 W4 + validation manager M03 E4) tant que :
- `tournees.plaque_preassignee_manager` est NULL **OU**
- `tournees.chauffeur_id` est NULL (= nom chauffeur non communiqué)

Trigger Postgres `tms.fn_validate_tournee_controle_acces()` BEFORE UPDATE on `tms.tournees` bloque la transition (RAISE EXCEPTION). Deux cas distincts :

1. **`chauffeur_id IS NULL`** → blocage systématique (RAISE EXCEPTION "chauffeur requis"). Aucune exception. Le manager prestataire doit affecter un chauffeur en M03 E4 avant validation.
2. **`plaque_preassignee_manager IS NULL`** → blocage par défaut (RAISE EXCEPTION "plaque requise"), sauf exception A Toutes! vélo cargo (cf. ci-dessous).

**Exception A Toutes! vélo cargo (UNIQUEMENT sur le critère plaque)** : si toutes les `collectes_tms` de la tournée ont `prestataire.integration_externe = 'everest'` ET `vehicule.type_vehicule_id` correspondant à `types_vehicules.categorie = 'velo_cargo'` → trigger autorise la validation tournée même si `plaque_preassignee_manager IS NULL`. Justification : pas de plaque attribuable côté flotte vélo cargo. **Le `chauffeur_id` reste obligatoire** dans tous les cas (le nom chauffeur est requis pour le contrôle d'accès même en vélo cargo). Le formulaire de programmation Plateforme affiche un message UX au traiteur ("Vélo cargo — pas de plaque possible") pour transparence.

**Effets de bord** :
- Émission webhook S7 `plaque-saisie` automatique post-saisie manager M03 E4 (payload enrichi 2026-05-03 : `plaque` + `chauffeur_nom` lus via JOIN `chauffeurs.nom_complet` sur `tournees.chauffeur_id`). Alimente Plateforme `tournees.plaque_immatriculation` + `tournees.chauffeur_nom`.
- **Saisie chauffeur terrain supprimée V1 (propagation 2026-06-04)** — il n'existe plus qu'une seule plaque, celle pré-saisie par le manager (cette règle). La colonne `plaque_saisie_terrain` est supprimée (§04).

**Référence trigger code SQL** : voir [[04 - Data Model TMS|§04 Data Model TMS]] table `tournees` section trigger `trg_validate_tournee_controle_acces`.

### R_M04.COMPATIBILITE_VEHICULE_LIEU — Trigger DB blocage validation tournée si véhicule incompatible avec lieu(x) servi(s) *(ajout 2026-05-08)*

**Objectif** : empêcher qu'une tournée TMS planifiée avec un véhicule trop gros pour un des lieux servis passe en validation (cas typique : poids lourd planifié sur lieu accessible vélo cargo / camionnette uniquement). Aligné sur la règle Plateforme [[../../01 - Cahier des charges App/05 - Règles métier#R_compatibilite_vehicule_lieu|R_compatibilite_vehicule_lieu]] (hiérarchie véhicule unifiée 5 valeurs).

**Règle** :

> Une tournée ne peut pas passer du statut `planifiee` à `acceptee` si la **catégorie Plateforme** de son véhicule (`tms.types_vehicules.categorie_plateforme` via `tournees.vehicule_id → vehicules.type_vehicule_id`) a un **rang strictement supérieur** au minimum des `plateforme.lieux.type_vehicule_max` parmi les lieux servis par les collectes de la tournée.

**Hiérarchie partagée** (cf. R_compatibilite_vehicule_lieu §05 Plateforme) :
`velo_cargo (1) < camionnette (2) < fourgon (3) < vul (4) < poids_lourd (5)`

**Implémentation Postgres** :

```sql
CREATE OR REPLACE FUNCTION tms.fn_validate_tournee_compat_vehicule_lieu()
RETURNS TRIGGER AS $$
DECLARE
  v_categorie_tournee text;
  v_rang_tournee int;
  v_rang_min_lieu int;
BEGIN
  -- Si pas de véhicule encore, skip (autre validation gère le cas)
  IF NEW.vehicule_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Lookup catégorie Plateforme du véhicule
  SELECT tv.categorie_plateforme INTO v_categorie_tournee
  FROM tms.vehicules v
  JOIN tms.types_vehicules tv ON tv.id = v.type_vehicule_id
  WHERE v.id = NEW.vehicule_id;

  v_rang_tournee := plateforme.rang_vehicule(v_categorie_tournee);

  -- Min rang lieu parmi les collectes de la tournée
  SELECT MIN(plateforme.rang_vehicule(l.type_vehicule_max)) INTO v_rang_min_lieu
  FROM tms.collectes_tms ct
  JOIN plateforme.lieux l ON l.id = ct.lieu_id
  WHERE ct.tournee_id = NEW.id;

  -- Si tournée plus grosse que le plus contraignant des lieux → blocage
  IF v_rang_tournee > v_rang_min_lieu THEN
    RAISE EXCEPTION 'Véhicule % incompatible (rang %) avec contrainte lieu (rang max %). Voir R_M04.COMPATIBILITE_VEHICULE_LIEU.',
      v_categorie_tournee, v_rang_tournee, v_rang_min_lieu;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_tournee_compat_vehicule_lieu
  BEFORE UPDATE OF statut ON tms.tournees
  FOR EACH ROW
  WHEN (NEW.statut = 'acceptee' AND OLD.statut = 'planifiee')
  EXECUTE FUNCTION tms.fn_validate_tournee_compat_vehicule_lieu();
```

**Cas particulier vélo cargo** : un transporteur vélo cargo (rang 1) est toujours compatible avec n'importe quel lieu (rang max ≥ 1). Pas de blocage.

**Cas particulier override Ops** : V1, pas de mécanisme d'override. Si Ops Savr veut autoriser une tournée incompatible (cas marginal), il doit modifier `categorie_plateforme` côté `types_vehicules` (audit_log) ou changer le `lieux.type_vehicule_max` (audit_log). Pas de bypass V1.

**Cas particulier `categorie_plateforme IS NULL`** : ne peut pas arriver (NOT NULL contrainte data model). Si donnée corrompue → trigger échoue (RAISE EXCEPTION explicite).

**Tests pgTAP bloquants CI** :
- `tournee_poids_lourd_sur_lieu_velo_cargo_blocked` : tournée poids_lourd sur lieu velo_cargo → UPDATE statut='acceptee' → doit échouer.
- `tournee_velo_cargo_sur_lieu_poids_lourd_ok` : tournée velo_cargo sur lieu poids_lourd → OK (rang 1 ≤ rang 5).
- `tournee_categorie_plateforme_null_blocked` : tournée avec véhicule pointant types_vehicules.categorie_plateforme=NULL (cas data corruption) → doit échouer.

**Justification** : symétrique côté TMS de la règle Plateforme. Source unique de vérité = `tms.types_vehicules.categorie_plateforme`. Évite l'incident "chauffeur arrive avec un poids lourd, ne peut pas accéder au lieu, collecte ratée".

---

## R8 — Portail prestataire self-service (M03) — règles métier (propagation 2026-04-24)

### R_M03.1 — Authentification manager + chauffeur : email + password, min 8 caractères (D1, D24)

Politique password unifiée aux 2 rôles nouveaux M03 (`manager_prestataire`) et révisé M05 (`chauffeur`). Longueur min 8 caractères, pas de contrainte complexité (cohérent NIST 800-63B post-2017). Hash argon2id Supabase Auth natif. Pas d'expiration périodique. Reset via magic link 30 min (lien "Mot de passe oublié"). Rate limit 5 tentatives échouées / 15 min / IP. Message d'erreur login unifié anti-énumération. Ops/Admin inchangés (SSO Google + MFA TOTP §09 V1).

### R_M03.2 — SLA acceptation 3 paliers (D5) — **Supprimé (revue sobriété 2026-04-29)**

Pas de SLA système V1 sur l'acceptation prestataire. Acceptation libre côté manager. Supervision manuelle Ops via M02 E1 Zone 2 + override M02 W5 si une collecte traîne en `attribuee_en_attente_acceptation`. Paramètres `m03_sla_*` + `m03_sla_palier_*_threshold_h` + alerte M11 `m03_sla_acceptation_expire` + cron expiration + webhook S2 motif `sla_depasse` retirés V1.

### R_M03.3 — Alerte 2 refus consécutifs (D5)

Si un prestataire refuse 2 collectes consécutives dans une fenêtre glissante de 7 jours, alerte M11 warning `m03_prestataire_refus_consecutifs` visible Ops + Admin TMS. Ne bloque pas opérationnellement, sert d'indicateur de friction commerciale. Compteur RESET au premier acceptation. Paramètre `m03_seuil_refus_consecutifs = 2`, `m03_fenetre_refus_jours = 7`.

### R_M03.4 — Contrôle d'accès conditionnel niveau lieu (plaque + nom chauffeur) avec override collecte + cascade upgrade-only (restauré 2026-05-01 — renommé + étendu 2026-05-03 refonte formulaire §06.01 Plateforme)

Toggle `controle_acces_requis_default` (ex `plaque_requise_default`) niveau `plateforme.lieux` (défaut `false`, paramétré par Admin Savr selon contraintes site). Copié à l'INSERT d'une nouvelle `plateforme.collectes` dans la colonne `controle_acces_requis` (ex `plaque_requise`). Le traiteur peut override au formulaire de programmation, avec **cascade upgrade-only** : cocher la case alors que défaut lieu = `false` met à jour le lieu (impacte futurs traiteurs), décocher alors que défaut lieu = `true` ne met PAS à jour le lieu (downgrade Admin uniquement). Voir [[../../01 - Cahier des charges App/05 - Règles métier|§05 Plateforme R_controle_acces_cascade]]. Valeur effective propagée au TMS via E1 dans le champ `controle_acces_requis` de la collecte.

**Effet métier** : si `controle_acces_requis=true` sur une collecte → le manager prestataire **doit** pré-saisir **plaque ET nom chauffeur** (= affecter un chauffeur via `tournees.chauffeur_id`) en M03 E4 avant validation tournée. Le trigger `validate_tournee_controle_acces` (R_M04.CONTROLE_ACCES) bloque la transition `tournees.statut = planifiee → acceptee` si plaque OU nom chauffeur manquant (sauf exception A Toutes! vélo cargo sur le critère plaque uniquement — le nom chauffeur reste obligatoire dans tous les cas).

**UX formulaire programmation Plateforme** : si traiteur coche `controle_acces_requis=true` ET lieu/contexte = vélo cargo A Toutes! AG → message UX "Vélo cargo — pas de plaque possible". Soumission autorisée (le manager vélo cargo n'aura pas de plaque à saisir mais devra affecter un chauffeur — le trigger TMS valide via exception sur le critère plaque uniquement). Pas de blocage hard côté formulaire.

**Cas d'usage** : commercial traiteur demande la plaque + le nom du chauffeur pour anticipation contrôle d'accès site (Viparis, sites VIP, sites sécurisés). Visible dashboard traiteur "Contrôle d'accès" dès saisie manager M03 E4 (webhook S7 enrichi 2026-05-03 → `tournees.plaque_immatriculation` + `tournees.chauffeur_nom`). Email client V2.

### R_M03.5 — Multi-device illimité manager, 1 device actif chauffeur

Session multi-device illimitée pour `manager_prestataire` (bureau + mobile + tablette). Contrainte 1 device actif maintenue pour `chauffeur` (R_M05.10, D12 M05) — cohérence queue offline PWA + anti-partage compte.

### R_M03.6 — Session JWT 30 jours rolling (simplifié revue sobriété §05 2026-05-01 C2 — paramètre unifié)

Durée session pour `manager_prestataire` pilotée par **paramètre unique JSON `parametres_tms.auth.session_duree_jours_par_role`** (default 30 jours, cf. clé `manager_prestataire`). JWT TTL 30 min, refresh silencieux via cookie httpOnly. Purge auto pg_cron horaire. Source de vérité authoritative : §09 Authentification + permissions TMS.

### R_M03.7 — Création chauffeur par manager (M06 W7 étendue M03, simplifié revue sobriété §05 2026-05-01 B1)

Le manager prestataire peut créer un nouveau chauffeur depuis M03 E6 (fiche chauffeur). Workflow : saisie email + nom + téléphone + upload permis + numéro permis + date visite médicale. **Bootstrap unique** : email "Définir mon mot de passe" envoyé au chauffeur avec **magic link 30 min** (template `chauffeur_bienvenue`). Le chauffeur clique le lien, définit son password (≥ 8 car), accède à la PWA M05. Aucune transmission de password en clair par email.

 → **Chemin "password généré" supprimé revue sobriété §05 2026-05-01 B1**. Cohérence avec R_M03.1 (reset password = magic link 30 min) — un seul flow d'établissement password = magic link. Réduit la surface d'attaque (pas de password en clair par email) et simplifie l'implémentation (1 chemin de code au lieu de 2).

Admin TMS reste autorisé à créer des chauffeurs côté back-office M06 (cumul de droits sans conflit, même flow magic link). Archivage chauffeur = `tms.chauffeurs.statut='archive'` (soft delete) + invalidation toutes sessions actives (`auth_sessions_tms.revoked_at=now()`).

### R_M03.8 — Création véhicule + type véhicule par manager (D11 option c validée Val)

Le manager prestataire peut créer un véhicule référentiel (M06) avec tous les champs obligatoires (plaque, type, frigorifique, hayon, capacité) + un nouveau **type de véhicule** si absent du référentiel (ex: "Camion 12m3 hayon rabattable"). Le type créé passe en `tms.types_vehicules` avec `valide_ops=false`, `actif=true`, `cree_par=manager_id` (cf. §04 addendum M03 types_vehicules). Champs obligatoires : libellé, volume, frigorifique, hayon (PTAC supprimé revue sobriété M03 passe 2). Type **utilisable immédiatement** par le manager (pas de blocage workflow). Email auto à Ops Savr pour revue manuelle.

Ops Savr voit l'alerte M11 warning `m03_nouveau_type_vehicule_non_valide` et peut :
- **Valider** le type tel quel (`valide_ops=true`)
- **Merger** le type avec un existant via fonction SQL `tms.merger_type_vehicule(type_a_id, type_b_id)` (remap véhicules + grilles + archive du type mergé + audit log)
- **Désactiver** (`actif=false`) si doublon avéré sans merge nécessaire

### R_M03.9 — Facture 1/mois prestataire (D9, simplifiée revue sobriété §05 2026-05-01 A1)

1 facture par mois par prestataire, envoyée par le manager prestataire via M03 E10 (upload PDF + saisie HT). Pas de facture bimestrielle ou quotidienne V1.

**Supervision V1 (Ops, manuelle)** : widget M08 E0 "Factures attendues mois en cours" liste les prestataires sans facture pour la période en cours. Badge `attente` jusqu'au 10 du mois suivant la période, badge `retard` à partir du 10. Ops contacte le prestataire en retard manuellement (téléphone ou email ad-hoc). Volume V1 ≈ 30 factures/mois → revue hebdomadaire suffisante.

**Suppressions revue sobriété §05 2026-05-01 A1** :
- Cron M08 W11 (rappel automatique J+5 + élévation criticité J+15) → supprimé V1
- Code alerte M11 `m08_rappel_facture` (ex-unifié B5 2026-04-30, ex-`m08_rappel_facture_j5` + `m08_escalade_absence_j15`) → supprimé V1
- Notification email N10 M08 (rappel manager J+5) → supprimée V1
- Paramètres `m08.rappel_upload_jour_mois`, `m08.escalade_upload_jour_mois`, `m03.facture_rappel_upload_jour_mois`, `m03.facture_escalade_admin_jour_mois` → supprimés V1
- Template email `rappel_facture_j5` → supprimé V1

**Réintroduction V1.1** possible si volume × 5 (>150 factures/mois) ou si Ops constate dérive significative > 1 mois sur > 5 prestataires.

**Lock collectes post-facture (consolidation 2026-05-02 — ex-§06 M03 R_M03.9)** : après upload validé d'une facture pour le mois M-1, toutes les `tms.collectes_tms` du mois M-1 du prestataire passent en mode **lecture seule** pour le manager (plus de contestation via portail M03). Toute contestation post-facture passe par contact Ops hors portail (téléphone ou email ad-hoc). Objectif : éviter les modifications rétroactives qui invalideraient la facture déjà émise. Implémentation : trigger DB `tms.fn_lock_collectes_post_facture()` ou colonne `tms.collectes_tms.locked_by_facture_id` selon décision dev.

### R_M03.10 — Dashboard revenus lecture seule par manager (D13)

Le manager voit son propre dashboard revenus (M03 E9) en lecture seule : CA HT par mois (12 derniers mois), nb tournées, nb collectes, drill-down par tournée. Les coûts internes (facture traiteur côté Plateforme) sont masqués via RLS colonne. Le manager peut exporter CSV (périmètre prestataire uniquement). Périmètre : `tournees.prestataire_id = current_user_prestataire_id()`.

### R_M03.11 — Fenêtre de modification assignation (consolidation 2026-05-02 — ex-§06 M03 R_M03.4)

Le manager prestataire peut modifier le chauffeur ou le véhicule assigné à une tournée **jusqu'au début effectif de tournée** (tant que `tournees.statut` ∈ `planifiee`/`acceptee` — soit la collecte au stade `statut_dispatch = en_attente_execution` incluse). Verrouillage automatique dès la transition `tournees.statut = en_cours` ou `terminee`. Ops Savr peut débloquer en cas d'urgence (ex: changement de chauffeur jour J pour panne, indisponibilité) via workflow Ops dédié (override avec audit log).

> **Correctif enum revue sobriété §05 2026-06-04** : `en_attente_execution` est une valeur de `collectes_tms.statut_dispatch`, pas de `tournees.statut` (enum 5 valeurs `planifiee/acceptee/en_cours/terminee/annulee`, R6.2). Le verrou tournée raisonne sur `tournees.statut` ; `realisee` (ex-mention) corrigé en `terminee`.

Implémentation : trigger DB `tms.fn_lock_tournee_assignation()` BEFORE UPDATE sur `tms.tournees(chauffeur_id, vehicule_id)` qui RAISE EXCEPTION si `OLD.statut IN ('en_cours', 'terminee')` ET appel non-Ops. Override Ops via fonction SQL dédiée avec `SET LOCAL` + audit log.

### R_M03.12 — Blocage archivage chauffeur avec tournées futures (consolidation 2026-05-02 — ex-§06 M03 R_M03.5)

Archivage d'un chauffeur (`tms.chauffeurs.statut='archive'`) impossible si le chauffeur est encore assigné à au moins une tournée future ou en attente d'exécution :

```sql
EXISTS (SELECT 1 FROM tms.tournees
        WHERE chauffeur_id = :chauffeur_id
        AND heure_planifiee_debut >= now()
        AND statut IN ('planifiee', 'acceptee'))   -- enum tournees.statut (corrigé 2026-06-04 : 'en_attente_execution' était une valeur statut_dispatch collecte, pas tournée)
```

Message UX manager : "Ce chauffeur est assigné à N tournée(s) future(s). Réassignez-les avant archivage." Cohérent avec R_M03.7 (création chauffeur par manager) — symétrie cycle de vie chauffeur.

---

## R11 — Alerting transverse (M11) — règles métier (propagation 2026-04-24)

Spec détaillée : [[06 - Fonctionnalités détaillées TMS/M11 - Alerting transverse]]. 12 règles R_M11.x + cycle de vie alerte consolidé R6.5.

### R_M11.1 — Catalogue source de vérité

Tout appel `tms.alerte_emit(code='X', ...)` où `X ∉ alertes_catalogue.code` lève exception `ALERT001`. Pas de catch-all "code inconnu" V1. Force la discipline seed catalogue + tests pgTAP `check_codes_used_exist_in_catalogue`.

### R_M11.2 — Criticité immuable post-émission

Une fois l'alerte insérée, sa `criticite` ne change plus. Si Admin TMS modifie la criticité par défaut du catalogue, effet sur futures émissions uniquement. Pas de rétroactivité.

### R_M11.3 — Debounce strict fenêtre glissante 5 min

2 appels `alerte_emit` avec même `(code, entity_type, entity_id)` dans les 5 min (paramètre `m11.debounce_seconds`) → même alerte, counter `occurrences++`, pas de nouvelle notification. UI affiche `titre (x N)` si `occurrences > 10`.

### R_M11.4 — Code désactivé = silence total

`alertes_catalogue.active = false` → `alerte_emit` renvoie NULL silencieusement. Utile pour muter pendant incident (ex : intégration Everest down → mute `m14_everest_timeout` pendant l'incident) sans casser les triggers émetteurs.

### R_M11.5 — Code supprimé = exception

`alertes_catalogue.supprime_at IS NOT NULL` → exception `ALERT002` à l'émission. Force le nettoyage côté code émetteur (pas de zombie silent). **Bloc 4 sobriété 2026-04-25 (A10)** : colonne `remplace_par_code` + EC16 procédure renommage dégagés V1. Si renommage post-launch nécessaire : soft-delete ancien code + créer nouveau, alertes historiques restent sous l'ancien code (acceptable V1).

### R_M11.6 — Pas de rétention automatique ouverte warning/critical

Les alertes `warning` et `critical` ouvertes ne s'auto-résolvent jamais (hors résolution auto W7 trigger disparu). Volontaire pour forcer traitement. **Bloc 3 sobriété 2026-04-25 A1+A7** : la criticité `info` est dégagée V1 (events ex-info en `audit_logs`/`integrations_logs`), le cron `m11_expirer_info` est supprimé, plus aucune alerte ne s'auto-expire — règle simplifiée.

### R_M11.7 — Résolution auto idempotente

`tms.alerte_resoudre_auto(code, entity_type, entity_id, raison)` appelée plusieurs fois pour le même triplet résout toutes les alertes ouvertes/ackées/snoozées mais est idempotente (0 ligne affectée si toutes déjà `resolue`, pas d'erreur). Les modules émetteurs l'appellent quand la condition sous-jacente disparaît (ex : M08 W6 remplacement facture par avoir, M07 création grille manquante, M10 passage Veolia saisi).

### R_M11.8 — Escalade manager prestataire scope

Pour les alertes liées à une entité appartenant à un prestataire (`facture_prestataire`, `collecte_tms`, `tournee`), le catalogue peut inclure `destinataires_par_defaut.manager_prestataire_scope = 'entity'` → le(s) manager(s) du prestataire sont automatiquement ajoutés aux destinataires par la fonction `tms.m11_resoudre_destinataires` (W2). Ex : `m08_rappel_facture` routée au manager du prestataire concerné (code unifié J+5/J+15 post-revue sobriété 2026-04-30 B5, ex-`m08_rappel_facture_j5` renommé).

### R_M11.9 — Flood protection méta

**Dégagée revue sobriété 2026-04-25 (A8)**. Volume V1 ne justifie pas un cron 2 min de scan flood. Le compteur `occurrences` sur `tms.alertes` reste consultable pour debug manuel par Admin TMS si suspicion de boucle émetteur.

### R_M11.10 — Rétention 3 ans + trace critical (refondu revue sobriété §05 2026-05-01 B3)

Cron `m11_purger_archives` mensuel (1er du mois 4h) :
1. **Étape 1 (dump pré-purge)** : INSERT INTO `tms.alertes_archive_critical` SELECT * FROM `tms.alertes` WHERE `criticite = 'critical' AND statut = 'resolue' AND resolue_at < now() - interval '3 years'`. Table archive append-only (RLS admin_tms read-only, pas d'UPDATE/DELETE).
2. **Étape 2 (purge)** : DELETE FROM `tms.alertes` WHERE `statut = 'resolue' AND resolue_at < now() - interval '3 years'` (toutes criticités).

 → **Supprimé revue sobriété §05 2026-05-01 B3**. Trigger sur opération destructive = piège (perf sur purge bulk + complexité debug + couplage avec audit_logs alors que le contenu purgé est une alerte, pas une mutation métier). Remplacé par dump explicite dans table dédiée `tms.alertes_archive_critical` (séparation des préoccupations).

Cohérent avec rétention `ajustements_couts_log` M07. **Bloc 3 sobriété 2026-04-25 A7** : statut `expiree` dégagé, scope rétention restreint à `resolue` uniquement.

### R_M11.11 — Colonnes immuables + transitions strictes

Trigger BEFORE UPDATE `tms.alertes` bloque modification de `code, criticite, emise_at, entity_type, entity_id, dedup_key, occurrences` (sauf par W1 debounce et W7 auto-résolution via path explicite). Transitions de statut autorisées uniquement (Bloc 3 sobriété 2026-04-25 A7 : transition `→ expiree` retirée ; Bloc 6 B2 2026-04-28 : statut `ackee` retiré enum → metadata) :
- `ouverte → snoozee | resolue` (l'ack = update colonnes metadata `ackee_par_user_id`/`ackee_at`, pas de changement statut)
- (statut `ackee` retiré Bloc 6 B2)
- `snoozee → ouverte | resolue`
- `resolue → *` **impossible** V1 (V2 : RPC Admin `m11_rouvrir_alerte` motif ≥ 30 car + audit)

Trigger vérifie aussi CHECK `alertes_ackee_coherence` : `(ackee_par_user_id IS NULL) = (ackee_at IS NULL)` — les deux colonnes metadata ack sont remplies ensemble ou NULL ensemble.

### R_M11.12 — Alertes test isolées

**Dégagée Bloc 4 sobriété 2026-04-25 (A5)**. RPC `tms.m11_emit_test`, cron `m11_nettoyer_tests`, paramètres `m11.test_nettoyage_minutes` + `m11.rate_limit_test_par_heure`, dépendance Vercel KV rate limit, `entity_type='test'`, filtre `WHERE entity_type != 'test'` partout — tous supprimés V1. Validation routing/delivery couverte par pgTAP CI (`test_m11_emit_unknown_code_raises`, `test_m11_emit_inactive_code_silent`, etc.). Tests ad-hoc Admin via Supabase Studio si besoin (1 ligne SQL `SELECT tms.alerte_emit(...)`).

---

## R_M13 — Administration TMS (propagation M13 V1 rédigée 2026-04-25)

20 règles métier issues de la rédaction de [[06 - Fonctionnalités détaillées TMS/M13 - Administration TMS]] (D1-D15). Source de vérité : §M13 ne pas dupliquer. Ici = vue consolidée règles transverses.

| Règle | Description | Source M13 |
|-------|-------------|-----------|
| R_M13.1 | Toute édition de `parametres_tms` exige un commentaire ≥ 10 chars (`m13_param_edition_commentaire_min_chars`). Audit-log obligatoire via trigger DB. | M13 W1 |
| R_M13.2 | Désactivation user = soft delete uniquement V1 (`statut='desactive'`). Pas de pseudonymisation/hard delete V1 (D7). | M13 W3, D7 |
| R_M13.3 | Combinaisons rôles interdites (cf. §09 ligne 478) : `manager_prestataire+ops_savr`, `manager_prestataire+admin_tms`, `chauffeur+toute autre role`. Validation Edge Function `upsert_user_tms`. | M13 W2 |
| R_M13.4 | Reset MFA TOTP exige commentaire ≥ 20 chars (`m13_mfa_reset_commentaire_min_chars`) + audit-log + notif email cible. | M13 W4 |
| R_M13.5 | Rotation secret exige test pré-validation (sauf "Forcer quand même" qui exige commentaire long ≥ 50 chars). Edge Function `rotate_secret`. | M13 W5 |
| R_M13.6 | Replay manuel d'event entrant passe obligatoirement par `integrations_inbox` pour respecter dédup `event_id` (anti-double-traitement). | M13 W6, EC6 |
| R_M13.7 | Wizard onboarding (M13 E7) peut s'interrompre entre étapes : prestataire reste `statut='en_onboarding'` jusqu'à étape 4 explicite. Cron quotidien alerte si `en_onboarding > 7j`. | M13 W7, EC17 |
| R_M13.9 | Impersonation interdite : (a) vers `admin_tms` cible, (b) vers user `desactive`, (c) cascadée (impersonator déjà en session impersonation). Edge Function `impersonation_start` rejette 400. | M13 W9, EC9, EC10 |
| R_M13.10 | Mutations sous impersonation : `audit_logs.acteur_user_id` = impersonator réel + `acteur_meta.impersonation_target_id` = cible. **Jamais** acteur_user_id = cible. Helper SQL `auth.is_impersonating()`. | M13 D15 |
| R_M13.11 | Cap **3 devices trusted simultanés actifs** par user (paramètre `m13_device_trusted_max_per_user`). Trigger DB BEFORE INSERT/UPDATE sur `users_tms_devices_trusted`. Si cap atteint → connexion 4ème device refusée avec message dédié (EC11). | M13 W10, D14 |
| R_M13.12 | Session **30 jours glissantes** pour `admin_tms` et `ops_savr` après device trusted. **Paramétrage unifié revue sobriété §05 2026-05-01 C2** : durée pilotée par `parametres_tms.auth.session_duree_jours_par_role` (clés `admin_tms` et `ops_savr`). Flag `auth.session_glissante=true` (toutes rôles) reste sur namespace `auth`. supprimé V1 — source de vérité authoritative §09. | M13 D10 |
| R_M13.13 | **Pas de re-MFA pour actions sensibles** (D10 explicit). Risque assumé : laptop compromis = 30j d'accès admin sans frein supplémentaire. Compensé par device trusted révocable + audit-log exhaustif. À reconsidérer V2 si incident sécu ou recrutement 3ème admin. | M13 D10 |
| R_M13.15 | Secrets avec `secrets_metadata.expire_le` non null sont scannés quotidiennement (cron `m13_secrets_expiration_cron`) → alerte warning à J-7 `m13_secret_expiration_imminente`. | M13 W12 |
| R_M13.16 | Reveal secret = JWT 30s + audit-log obligatoire. Pas de copy auto, pas de cache front. Edge Function `reveal_secret` retourne valeur en clair via JWT scope reveal expirant. | M13 E5, D4 |
| R_M13.17 | Édition d'un paramètre `requires_redeploy=true` exige confirmation explicite "Je sais que ça nécessite un redéploiement" + commentaire dédié. Sinon UPDATE rejeté côté EF. | M13 E2, D12 |
| R_M13.18 | `audit_logs` strictement immutable : aucune UPDATE/DELETE même `admin_tms`. RLS deny + revoke GRANT. Seule exception : DROP de partition > 5 ans (DBA-level). | M13 E4, D5 |
| R_M13.19 | Cache 60s côté Edge Function pour lectures `parametres_tms` côté apps clientes (D6). Param critique = `requires_redeploy=true` lu uniquement au démarrage app, jamais en runtime. | M13 D6 |
| R_M13.20 | Désactivation du seul `manager_prestataire` actif d'un prestataire émet alerte `m13_prestataire_sans_manager_actif` warning (résolution auto à création nouveau manager). | M13 W3 |

---

## R_M14 — Intégration Everest A Toutes! (propagation M14 V1 rédigée 2026-04-25)

8 règles métier issues de la rédaction de [[06 - Fonctionnalités détaillées TMS/M14 - Intégration Everest]] (D1-D10). Source de vérité : §M14 ne pas dupliquer. Ici = vue consolidée règles transverses.

| Règle | Description | Source M14 |
|-------|-------------|-----------|
| R_M14.1 | Push mission Everest à transition `collectes_tms.statut_dispatch → attribuee_en_attente_acceptation` ET `prestataire.integration_externe = 'everest'`. Cohérent pattern Strike/Marathon (manager voit collecte M03 dès `attribuee_en_attente_acceptation`). Trigger DB enqueue worker Next.js `m14_create_mission` pour ne pas bloquer la transaction M02/M12. | M14 W1, D2 |
| R_M14.2 | Granularité Everest **1 mission = 1 tournée** *(reformulé multi-vélo 2026-05-29)* : vélo (services 71/75) → 1 tournée vélo = 1 mission, `collecte_tms_id` renseigné (1 collecte/vélo, D8) + `tournee_id` renseigné. **Multi-vélo : 1 collecte = N vélos = N missions** (même `collecte_tms_id`, `tournee_id` distinct, `client_ref = tournee_id`, idempotence keyée `tournee_id`) = N courses A Toutes! facturées. Camion (service 91) → 1 tournée = 1 mission, `collecte_tms_id IS NULL`, `tournee_id` renseigné. **Source de vérité unique : `tms.everest_missions(everest_mission_id UNIQUE, tournee_id, collecte_tms_id)`** — `collecte_tms_id` **non-unique** (N missions/collecte en multi-vélo) ; colonnes miroir `tournees.everest_mission_id` et `collectes_tms.everest_mission_id` retirées V1 (revue sobriété §04 2026-04-30 A6). Lookup mission via JOIN sur `everest_missions` (index dédiés). | M14 D3 |
| R_M14.3 | Webhooks Everest (6 events `mission_dispatched/pickedup/finished/success/failed/cancelled/late`) ne mutent **jamais** `collectes_tms.statut_operationnel` ni `tournees.statut`. Mutent `everest_missions.statut_everest` + `payload_latest_update` uniquement. M05 chauffeur reste source de vérité opérationnelle. Exceptions (alertes Ops sans mutation enums métier) : `mission_failed` (critical), `mission_cancelled` non-TMS-initiated (critical), `mission_late` (warning). | M14 W2, D4 |
| R_M14.4 | Auth Bearer Everest : pas de cron de refresh proactif V1. Token cache mémoire process Next.js + retry sur 401 → re-auth via `POST /auth` → retry une fois → si re-401 alerte critical `m14_everest_auth_failed`. À reconsidérer V1.1 si TTL token Everest < 1h (Q3). | M14 W6, D5 |
| R_M14.5 | Idempotence webhooks Everest entrants via `tms.integrations_inbox` (pattern unifié M01 webhooks Plateforme). `event_id = mission_id + event_type + occurred_at`. Conflit unique → 200 OK silent (déjà reçu). | M14 W2, D7 |
| R_M14.6 | Failover Everest down (timeout / 5xx) : 1 retry après `m14_api_retry_delay_ms` (default 30s) puis statut `creation_failed` + alerte critical → Ops failover manuel via E4 (appel téléphone A Toutes! → bouton "Marquer accepté manuellement" → `created_manually` + `manual_acceptance_*` colonnes). Pas de retry boucle longue style Plateforme (5min/30min/2h) — collecte AG part dans l'heure. | M14 W4, D8 |
| R_M14.7 | Annulation cascade M12 / annulation traiteur : trigger DB `trg_m14_cascade_cancel` AFTER UPDATE on `collectes_tms` quand `statut_dispatch` transite vers `rejetee_par_prestataire` ou `annulee_par_traiteur` ET **mission Everest active existante** (lookup `everest_missions WHERE collecte_tms_id = NEW.id OR tournee_id = NEW.tournee_id` avec `statut_everest NOT IN ('cancelled','cancelled_externally','completed','completed_incomplete','failed','creation_failed')` — revue sobriété §04 2026-04-30 A6, colonnes miroir supprimées) → enqueue worker `m14_cancel_mission` qui appelle `POST /missions/cancel`. Idempotent (no-op si statut Everest déjà terminal). Si `cancel` échoue post-retry → alerte warning `m14_everest_mission_cancel_failed` → Ops appel manuel A Toutes! (anti double-dispatch). | M14 W3, D9 |

### Référence cross-rule

- M12 R1 (attribution) : couverture A Toutes! vérifiée par **check local** `lieu.code_postal[:2] IN plateforme.parametres_algo.everest_codes_postaux` (zéro appel API). **supprimées (audit cohérence A4 2026-05-09)**. Cf. R1.2 + M12 §4.3.
- M07 R2 (calcul coût) : `tournees.cout_calcule_ht` prime sur `everest_missions.cout_everest_ht` pour vélos et camion A Toutes! (grille TMS source de vérité, Everest = audit/rapprochement M08). Cf. §04 ligne 2567.
- M08 R3 (rapprochement factures) : compare facture A Toutes! vs `tournees.cout_calcule_ht`. Écart vs `cout_everest_ht` informational.
- M11 R11 catalogue : **10 codes alertes M14 seed** (1 existant `m14_everest_timeout` + 9 nouveaux, après retrait Bloc 3 sobriété 2026-04-25 A1 de 3 ex-info ; `m14_everest_mission_late` seedé `active=false` V1 sobriété 2026-04-30 A_M14_07 — risque bruit Q4).
- M13 R_M13.16 (reveal secrets) : `everest_client_id`, `everest_client_secret`, `everest_webhook_token` accessibles via Edge Function `reveal_secret` JWT 30s.

---

## R_§13 — Migration MTS-1 (propagation §13 V1 rédigée 2026-04-27)

| Règle | Énoncé | Trigger | Implémentation |
|---|---|---|---|
| R_§13.1 | `migration_mode_active = true` durant la fenêtre W5 (J0 → J+30). Toute saisie côté TMS marquée `migration_test = true` (factures) et `contexte = 'migration_test'` (audit). | App writes via M02/M05/M08 | Trigger DB BEFORE INSERT `trg_factures_migration_flag` sur `factures_prestataires`. Helper SQL `tms.is_migration_active()` STABLE. Lecture du paramètre `parametres_tms.migration_mode_active`. |
| R_§13.2 | Aucune facture `migration_test = true` exportée vers Pennylane. | M08 W11 export Pennylane CSV | Filtre `WHERE migration_test = false` dans la fonction `m08_exporter_pennylane`. |
| R_§13.3 | Webhooks TMS → Plateforme (S1-S11) émis normalement durant W5. La Plateforme reçoit mais ne déclenche aucune facturation client (Plateforme côté client = encore Bubble en production). | S1-S11 émis | Aucune modification TMS. Cohérence cross-CDC à documenter dans CDC App. |
| R_§13.4 | Webhooks Plateforme → TMS (E1-E10) reçus normalement durant W5. TMS traite les ordres comme en production. | E1-E10 reçus | Aucune modification TMS. |
| R_§13.5 | Si une collecte est saisie sur TMS uniquement (oubli côté Bubble), elle est invalide légalement. Prestataire ne sera pas payé. | Cross-check Val | Aucune implémentation tech. R_§13.5 = règle organisationnelle Val (cross-check hebdo Bubble vs nouvelle Plateforme). |
| R_§13.6 | Si une collecte est saisie sur Bubble uniquement (oubli duplication Val), aucune action TMS. Continuité Bubble normale. | N/A | Aucune implémentation tech. |
| R_§13.7 | Aucune action de retrait/correction automatique entre les 2 écosystèmes pendant W5. Toute correction = manuelle. | N/A | Aucune implémentation tech. |
| R_§13.8 | Cron `m13_cleanup_legacy` à J+30 auto-résout les alertes M11 critical de la fenêtre migration. | Cron pg_cron quotidien (déjà existant via M13) | `UPDATE alertes SET statut = 'resolue', resolue_at = NOW(), resolue_source = 'auto' WHERE contexte = 'migration_test' AND statut IN ('ouverte','snoozee') AND criticite = 'critical' AND emise_at < NOW() - INTERVAL '30 days'`. **Statut canonique `resolue`** (enum `alerte_statut` 3 valeurs `ouverte/snoozee/resolue`, R_M11.11) ; `resolue_auto`/`active` corrigés revue sobriété §05 2026-06-04, distinction « auto » portée par `resolue_source = 'auto'` (enum `alerte_resolution_source`). |
| R_§13.9 | Toggle `parametres_tms.migration_mode_active` réservée rôle `admin_tms`. Audit obligatoire `M13_MIGRATION_MODE_TOGGLE`. | Update `parametres_tms` clé `migration_mode_active` | RLS existante `parametres_tms_admin_only` + audit fonction `tms.audit_param_update`. |

---

## Décisions structurantes

- **M13 hub navigation + écrans transverses** : M13 ne duplique pas les CRUD métier (M06/M07/M08/M11). Écrans propres uniquement pour params, users, audit, secrets Vault, monitoring intégrations, codes alertes overrides, wizard onboarding, impersonation (D1 M13, 2026-04-25).
- **M13 secrets API en Supabase Vault** : Pennylane, Everest, Strike, Marathon, Bridge. Accès via Edge Function uniquement. (Slack dégagé V1 — revue sobriété 2026-04-25 A6, plus de secret Slack à gérer).
- **M13 session 30j glissantes admin + ops, sans re-MFA actions sensibles** : risque compromission laptop assumé. Compensé par device trusted (cap 3) + audit exhaustif (D10 M13, 2026-04-25).
- **M13 audit_logs strictement immutable** : pas d'annotation post-hoc V1, commentaire renseigné à la mutation source (D5 M13, 2026-04-25).
- **M12 générique** : aucun nom de prestataire hardcodé dans le code d'attribution. Priorités pilotées par `parametres_tms` (2026-04-22)
- **Calcul coût M07 entièrement configurable** : paliers JSON dans `grilles_tarifaires_prestataires.parametres_formule`, modifiables par Admin TMS sans redéploiement (2026-04-22)
- **Annulation avant créneau = pas de facturation** : règle uniforme Strike, Marathon, A Toutes! (2026-04-22, cf. §03)
- **Pas d'attribution auto V1** : Ops Savr suggère + valide manuellement. Attribution auto = V2 (trigger : volume dispatch > X/jour)
- **Disponibilité A Toutes! non vérifiable V1** : indisponibilité déclarée manuellement par Ops si retour Everest
- **Clôture tournée par le chauffeur** *(reframe multi-camions 2026-05-25, arbitrage 6a)* : la tournée passe `terminee` quand le chauffeur la clôture (M05). Le statut de la collecte (`realisee`) est dérivé quand toutes ses tournées sont `terminee` (cf. R6.1/R6.2). Filet de sécurité : auto-clôture si toutes les collectes sont déjà terminales par incident/annulation. Pas d'action Ops requise dans le flux normal.
- **Rapprochement facture : zéro tolérance** (R3.3, D4 2026-04-24) : match exact au centime près = auto-validation, sinon `ecart_detecte`. **caduque** — plus aucun seuil de tolérance V1.
- **Stocks : cache calculé, pas recalculé à la volée** : `stocks_rolls_traiteurs` est un cache mis à jour applicativement à chaque mouvement (pas de SUM live)

---

## Questions ouvertes

1. — **Résolu 2026-04-22** : renseigné à l'onboarding. Ops Savr saisit le nombre de bacs par flux et les seuils d'alerte lors de l'initialisation du TMS.
2. **Disponibilité temps réel A Toutes!** : Everest expose-t-il un endpoint de disponibilité ? Non confirmé à date. Laisser en déclaration manuelle Ops Savr V1.
3. **Attribution auto V2** : seuil à mesurer après 3 mois V1. Val fera la demande proactivement si le besoin se manifeste.
4. — **Résolu 2026-04-22** : statut final = `realisee`, trace conservée via `incidents.collecte_tms_id`. UX chauffeur M05 à détailler en §06.
5. — **Résolu 2026-04-22** : si grille absente → rapprochement manuel. À surveiller en production, prioriser saisie grille dans seed data onboarding.
6. — **Résolu 2026-04-22** : re-push `collecte-terminee` avec `type = correction` vers Plateforme. À spécifier dans §08 Contrat API (endpoint S5 enrichi).

---

## Liens

- [[03 - Périmètre fonctionnel TMS]] — modules M07, M08, M09, M10, M12 (spec fonctionnelle)
- [[04 - Data Model TMS]] — tables `grilles_tarifaires_prestataires`, `tournees`, `pesees`, `factures_prestataires`, `stocks_rolls_traiteurs`, `passages_veolia`, `parametres_tms`
- [[08 - Contrat API Plateforme-TMS]] — endpoint S5 (`collecte-terminee`), S9 (`incident`). **supprimés V1 (Bloc A 2026-05-01)** → lecture cross-schema `plateforme.v_courses_logistiques` / `plateforme.v_stocks_rolls`.
- [[01 - Cahier des charges App/05 - Règles métier]] — alerte pesées anormales côté Plateforme (Σ g/pax par flux)

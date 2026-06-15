# Scénarios de test — M04 Gestion des tournées

**Source CDC** : §06/M04 (W1→W10, E1→E5, EC1→C12) + §05 R2 (coût), R2.7 / R2.7bis (annulation), R2.8 (figement), R5.5 (stock ZD), R6.1 / R6.2 (cycles de vie) + §04 table `tournees` + `collecte_tournees` + trigger `fn_m07_calc_cost` + §08 S3 + §09 RLS tournées
**Généré le** : 2026-06-05

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests du module M04.
> Pour chaque scénario :
> - Couche `db` → écrire un test pgTAP dans `supabase/tests/`
> - Couche `api` → écrire un test Vitest dans `packages/tms/tests/api/`
> - Couche `ui` → écrire un test Playwright dans `packages/tms/tests/e2e/`
> Les tests P1-critique sont bloquants CI. Les tests P2 et P3 sont non-bloquants V1.
> Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.
>
> **Conventions de données** : prestataires réels — Strike (ZD camion, `vacations_paliers`), Marathon (AG, `vacations_paliers` tranches 4h), A Toutes! (AG vélo `grille_matricielle_zone_type_course` + camion `grille_matricielle_zone`, intégration Everest). Traiteurs : Kaspia, Kardamome. Statut tournée (5 valeurs, R6.2) : `planifiee`, `acceptee`, `en_cours`, `terminee`, `annulee`. Statut dispatch collecte (6 valeurs) : `a_attribuer`, `attribuee_en_attente_acceptation`, `acceptee`, `en_attente_execution`, `rejetee_par_prestataire`, `annulee_par_traiteur`. Statut opérationnel collecte : `planifiee`, `en_cours`, `realisee`, `realisee_sans_collecte`, `incident`. Relation collecte↔tournée = **N↔N** via `tms.collecte_tournees` (ordre + coût réparti portés par la liaison). Coût en € HT. Seuil géoloc clôture = 300 m (`m04_seuil_distance_cloture_metres`). Seuil annulation sans facturation = 180 min (`m07.delai_annulation_sans_facturation_minutes`).

---

## Résumé de couverture

| Catégorie | Nb scénarios | Couverture estimée |
|-----------|-------------|-------------------|
| 1. Happy path | 11 | W1 création, W2 ajout, W3 assignation→acceptee, W4 démarrage acceptee→en_cours, W5 clôture+coût, W7 annulation, W8 correction durée, W9 clôture forcée + cycle acceptee (province directe, ajout collecte→planifiee, filet sécurité acceptee→terminee) |
| 2. Cas limites | 8 | géoloc 300m exact, R2.7 seuil 3h, R2.7bis en_cours, fenêtre fin>debut, ag_velo N=1, multi-camions dérivation, R2.2 paliers Strike bornes, R2.10 sans collecte |
| 3. Cas d'erreur | 7 | annulation en_cours interdite, ajout collecte non-planifiee, véhicule/chauffeur inactif, grille absente, fin<debut, correction post-facture validée, retrait collecte démarrée |
| 4. Isolation RLS | 5 | ops_savr/admin_tms full, manager_prestataire scope E4, chauffeur scope collecte_tournees, cross-org Strike/Marathon |
| 5. Idempotence/états | 8 | figement cout_calcule_ht, terminee→planifiee interdit, annulee terminal, clôture auto idempotente, R5.5 stock idempotent, dedup event_id S3, push_s6_version, recalc marge cross-schema |
| 6. Cross-app | 6 | S3 émission upsert, retry 3 paliers, HMAC, X-API-Version, E2 PATCH W10 réacceptation créneau, recalc marge trigger DB (ex-S6) |
| 7. Migration | 0 | Hors scope M04 (runtime tournées ; cf. cdc-migration-data + §13 MTS-1) |
| **TOTAL** | **45** | |

---

## Scénarios

### Catégorie 1 — Happy path

```gherkin
# Source : §06/M04 W1 + E1 + §04 collecte_tournees
# Couche : api
# Priorité : P1-critique

Scénario : creation_tournee_dispatch_multi_collectes
  Étant donné 3 collectes ZD du même prestataire Strike en statut_dispatch 'a_attribuer'
  Et un Ops Savr connecté ayant multi-sélectionné ces 3 collectes dans M02 E1
  Quand l'Ops valide la modal E1 "Créer la tournée" (fenêtre, type auto, sans véhicule)
  Alors une ligne tms.tournees est créée avec statut='planifiee', prestataire_id=Strike, type_tournee='zd_camion'
  Et 3 lignes tms.collecte_tournees sont insérées avec ordre_dans_tournee = ordre de sélection (1,2,3)
  Et heure_planifiee_debut = min(heure_collecte) et heure_planifiee_fin = max(heure_collecte) + 30 min
  Et un webhook S3 'tournee-upsert' (création) est émis avec collecte_ids[] et un event_id UUID
  Et un audit_logs action='TOURNEE_CREATE' (before=null) est inséré
  Et le manager Strike est notifié (push + email M03)
```

```gherkin
# Source : §06/M04 W2 + C1
# Couche : api
# Priorité : P1-critique

Scénario : ajout_collecte_a_tournee_planifiee
  Étant donné une tournée Strike statut='planifiee' avec 2 collectes et un chauffeur déjà assigné
  Et une nouvelle collecte Strike 'a_attribuer' arrivée tardivement via M01
  Quand l'Ops ouvre E3 et ajoute la collecte via "Ajouter collecte"
  Alors une ligne collecte_tournees est insérée (ordre_dans_tournee = max+1)
  Et un webhook S3 'tournee-upsert' (update, liste collectes complète) est ré-émis
  Et le manager et le chauffeur sont notifiés
  Et un audit_logs action='TOURNEE_ADD_COLLECTE' (diff collecte_ids) est inséré
```

```gherkin
# Source : §06/M04 W3 + E4
# Couche : api
# Priorité : P1-critique

Scénario : assignation_chauffeur_vehicule_par_manager
  Étant donné une tournée Strike 'planifiee' sans chauffeur ni véhicule, vue par le manager Strike dans E4
  Et un chauffeur Strike statut='actif' peut_conduire=true et un véhicule Strike statut='actif'
  Quand le manager assigne chauffeur + véhicule au niveau tournée et que toutes les collectes sont 'acceptee'
  Alors tms.tournees.chauffeur_id et vehicule_id sont renseignés ET la tournée passe 'planifiee' → 'acceptee' (W3 step 5, tournée prête)
  Et un webhook S3 'tournee-upsert' (update statut=acceptee) est ré-émis vers la Plateforme
  Et le chauffeur assigné reçoit un magic link app mobile (M05)
  Et audit_logs action='TOURNEE_ASSIGN_CHAUFFEUR' et 'TOURNEE_ASSIGN_VEHICULE' sont insérés
  Et si toutes les collectes ne sont PAS encore acceptées, la tournée reste 'planifiee'
```

```gherkin
# Source : §06/M04 W2 + §05 R6.2 (acceptee → planifiee)
# Couche : db
# Priorité : P2-important

Scénario : ajout_collecte_non_acceptee_repasse_tournee_planifiee
  Étant donné une tournée 'acceptee' (toutes collectes acceptées + chauffeur/véhicule assignés)
  Quand l'Ops ajoute une collecte non encore acceptée (W2)
  Alors la tournée repasse 'acceptee' → 'planifiee' (elle n'est plus complète)
  Et elle redeviendra 'acceptee' à l'acceptation de la collecte ajoutée
```

```gherkin
# Source : §06/M04 W4 + §05 R6.2
# Couche : api
# Priorité : P1-critique

Scénario : demarrage_tournee_acceptee_vers_en_cours
  Étant donné une tournée ZD Strike 'acceptee' (prête) avec chauffeur+véhicule assignés et checklist pré-départ validée
  Quand le chauffeur clique "Démarrer tournée" dans M05
  Alors tms.tournees.statut passe 'acceptee' → 'en_cours' et heure_reelle_debut = NOW()
  Et le bouton "Démarrer" était inactif tant que la tournée n'était pas 'acceptee' (transition planifiee → en_cours directe interdite)
  Et un webhook S3 'tournee-upsert' (statut=en_cours) est ré-émis
  Et aucun webhook S7 n'est émis par le chauffeur (saisie plaque terrain retirée V1)
  Et audit_logs action='TOURNEE_START' est inséré
```

```gherkin
# Source : §06/M04 W2 province + §05 R6.2 (chauffeur province via M05)
# Couche : api
# Priorité : P2-important

Scénario : tournee_province_acceptee_directe_puis_demarrage_m05
  Étant donné une collecte province confirmée par Ops via E5/W2 (M02) : collecte 'en_attente_execution', tournée créée directement 'acceptee' avec chauffeur+véhicule, sans validation prestataire
  Quand le chauffeur province ouvre l'app M05 et clique "Démarrer tournée"
  Alors la tournée passe 'acceptee' → 'en_cours' (flux identique Strike/Marathon en aval)
  Et à la clôture elle suit 'en_cours' → 'terminee' avec calcul coût R2 (forfait province)
```

```gherkin
# Source : §05 R6.2 (filet de sécurité acceptee → terminee)
# Couche : db
# Priorité : P2-important

Scénario : cloture_filet_securite_acceptee_vers_terminee
  Étant donné une tournée 'acceptee' jamais démarrée (chauffeur n'a pas cliqué "Démarrer")
  Quand toutes ses collectes deviennent terminales par incident/annulation avant arrivée (ou Ops force la clôture W9)
  Alors la tournée passe directement 'acceptee' → 'terminee' (filet de sécurité, accepté par fn_m07_calc_cost OLD.statut IN ('en_cours','acceptee'))
  Et le calcul coût R2 + recalc marge cross-schema s'appliquent normalement
```

```gherkin
# Source : §06/M04 W5 étapes 5-9 + §05 R2.1 + R2.2
# Couche : api
# Priorité : P1-critique

Scénario : cloture_tournee_calcule_cout_strike
  Étant donné une tournée Strike 'en_cours' dont toutes les collectes sont en statut terminal, GPS clôture ≤ 300m de l'entrepôt
  Quand le chauffeur clique "Terminer tournée" avec capture GPS
  Alors tms.tournees.statut passe à 'terminee', heure_reelle_fin=NOW(), cloture_hors_zone=false
  Et le trigger fn_m07_calc_cost calcule cout_calcule_ht via la formule vacations_paliers + grille Strike active
  Et cout_detail (snapshot JSON palier+formule), grille_tarifaire_id, cout_final_ht et cout_calculated_at sont posés
  Et push_s6_version est incrémenté (0 → 1)
  Et un webhook S3 'tournee-upsert' (statut=terminee) est ré-émis
  Et audit_logs action='TOURNEE_END' et 'COUT_CALCULE' sont insérés
```

```gherkin
# Source : §06/M04 W7 + §05 R2.7 + D7
# Couche : api
# Priorité : P1-critique

Scénario : annulation_tournee_planifiee_collectes_retour_dispatch
  Étant donné une tournée Strike 'planifiee' avec 2 collectes (chacune servie par cette seule tournée)
  Quand l'Ops clique "Annuler tournée" et saisit un motif ≥ 10 caractères
  Alors tms.tournees.statut passe à 'annulee', motif_annulation renseigné
  Et les lignes collecte_tournees sont supprimées ; chaque collecte sans aucune autre tournée repasse statut_dispatch='a_attribuer' avec prestataire_id=NULL
  Et un webhook S3 'tournee-upsert' (statut=annulee, liste collectes vidée) est émis
  Et aucun webhook 'collecte-rejetee' n'est émis (ré-orientation, pas rejet)
  Et audit_logs action='TOURNEE_CANCEL' (avec motif) est inséré
```

```gherkin
# Source : §06/M04 W8 + §05 R2.8 + R_M04.3
# Couche : api
# Priorité : P1-critique

Scénario : correction_duree_aposteriori_recalcule_cout
  Étant donné une tournée 'terminee' avec cout_calcule_ht=282,50€ et la facture prestataire du mois NOT IN ('validee','payee')
  Quand un Ops corrige heure_reelle_fin via "Corriger durée" et saisit un motif ≥ 10 caractères
  Alors duree_reelle_minutes (GENERATED) est recalculée et R2 recalcule le coût
  Et cout_ajuste_ht / cout_final_ht sont mis à jour, statut_financier='ajuste', push_s6_version incrémenté
  Et cout_calcule_ht initial reste immuable (figement R2.8)
  Et si delta coût > 20% une alerte M11 'm04_ecart_cout_dispatch' (warning) est émise à Val+Louis
  Et audit_logs action='TOURNEE_DURATION_CORRECT' (before/after + motif) est inséré
```

```gherkin
# Source : §06/M04 W9 + §13 Q6
# Couche : api
# Priorité : P2-important

Scénario : cloture_forcee_ops_chauffeur_injoignable
  Étant donné une tournée 'en_cours' depuis plus de 8h et un chauffeur injoignable
  Quand l'Ops clique "Clôturer manuellement", saisit heure_reelle_fin estimée + motif obligatoire
  Alors tms.tournees.statut passe à 'terminee' avec la fin saisie et le flag cloture_manuelle_ops=true (audit)
  Et la suite W5 s'applique (R2 calcul coût → recalc marge Plateforme via trigger DB fn_recalc_marge_tournee, S3)
  Et une alerte M11 'm04_cloture_manuelle_forcee' (warning) est émise
  Et audit_logs action='TOURNEE_FORCE_CLOSE' (avec motif) est inséré
```

---

### Catégorie 2 — Cas limites métier

```gherkin
# Source : §05 R_M04.2 + §06/M04 W5 étapes 2-4 (seuil 300m)
# Couche : db
# Priorité : P1-critique

Scénario : cloture_borne_exacte_300m_dans_zone
  Étant donné une tournée 'en_cours', distance position de clôture vs entrepôt = exactement 300m
  Quand le chauffeur clôture avec capture GPS
  Alors cloture_hors_zone=false (≤ 300m est dans la zone) et aucune alerte n'est émise
  Et à 301m cloture_hors_zone=true, distance_cloture_metres et cloture_gps stockés, alerte M11 'm04_cloture_hors_zone' (warning, non bloquant)
```

```gherkin
# Source : §05 R2.7 (borne exacte 3h annulation, M04 cycle de vie tournée planifiee)
# Couche : db
# Priorité : P1-critique

Scénario : annulation_tournee_borne_exacte_3h_no_bill
  Étant donné une tournée 'planifiee' annulée exactement 180 min avant heure_planifiee_debut
  Quand l'annulation est appliquée (W7 / DELETE collecte rendant la tournée vide)
  Alors cout_calcule_ht=0 et cout_detail={"raison":"annulation_hors_delai_facturation"} (≥ 3h = pas de facturation)
  Et à 179 min avant, M07 calcule la vacation (durée minimale palier de la grille applicable)
```

```gherkin
# Source : §05 R2.7bis + §06/M04 R_M04.5 + C... cycle de vie
# Couche : db
# Priorité : P1-critique

Scénario : annulation_pendant_tournee_en_cours_vacation_facturee
  Étant donné une tournée 'en_cours' dont une collecte est annulée par le client (DELETE E3)
  Quand la transition est appliquée
  Alors la tournée n'est PAS mise à 'annulee' (en_cours → annulee interdit, R2.7bis)
  Et la collecte passe statut_dispatch='annulee_par_traiteur' avec annulee_pendant_en_cours=true
  Et statut_operationnel reste 'en_cours' jusqu'à clôture chauffeur puis 'realisee'
  Et la vacation prestataire est facturée intégralement à la clôture (cout_calcule_ht > 0)
```

```gherkin
# Source : §06/M04 E1 Contrôle 3 (fenêtre opérationnelle)
# Couche : ui
# Priorité : P2-important

Scénario : creation_tournee_fenetre_fin_avant_debut_bloquee
  Étant donné l'Ops dans la modal E1 qui édite la fenêtre opérationnelle
  Quand il saisit heure_planifiee_fin ≤ heure_planifiee_debut
  Alors le Contrôle 3 échoue et le bouton "Créer la tournée" est désactivé
  Et la création côté DB est rejetée si forcée (contrainte fin > debut)
```

```gherkin
# Source : §06/M04 E1 Contrôle 2 + W1 + D8 + C6
# Couche : api
# Priorité : P1-critique

Scénario : tournee_ag_velo_limitee_une_collecte
  Étant donné 2 collectes A Toutes! vélo sélectionnées au dispatch
  Quand l'Ops tente de créer une tournée type_tournee='ag_velo' avec N=2
  Alors le Contrôle 2 échoue avec "Tournée vélo A Toutes! limitée à 1 collecte" (D8)
  Et le multi-vélo "1 collecte = N vélos" reste possible via "+ Ajouter un vélo" (tournées sœurs à 1 collecte chacune)
```

```gherkin
# Source : §05 R6.1 (dérivation realisee multi-tournées) + R6.2 (reframe multi-camions)
# Couche : db
# Priorité : P1-critique

Scénario : collecte_realisee_quand_toutes_tournees_soeurs_terminee
  Étant donné une grosse collecte ZD servie par 2 tournées sœurs Strike (collecte_tournees), une 'terminee' et une 'en_cours'
  Quand la 2e tournée passe à 'terminee' (chauffeur clôture)
  Alors le trigger fn_derive_statut_collecte_multi_tournees fait passer la collecte à 'realisee' (toutes tournées terminee, garde SUM(pesees.poids_net) > 0)
  Et un S5 terminal unique est émis avec les pesées des 2 véhicules sommées par (collecte_tms_id, flux)
  Et tant qu'une tournée reste 'en_cours' la collecte ne passe PAS à 'realisee'
```

```gherkin
# Source : §05 R2.2 (paliers Strike, bornes de palier)
# Couche : db
# Priorité : P2-important

Scénario : cout_strike_borne_palier_4h
  Étant donné une tournée Strike terminée avec duree_reelle_minutes = exactement 240 (4h00)
  Quand fn_m07_calc_cost s'exécute (paliers Strike : [0h,4h[ = 1 vacation ; [4h,6h[ = 1 vacation + prolongation base 4h)
  Alors le palier [4h,6h[ s'applique (de_h ≤ duree < a_h) et la prolongation démarre à 0 min au-dessus de 4h
  Et à 239 min le palier [0h,4h[ s'applique (1 vacation pleine, sans prolongation)
```

```gherkin
# Source : §05 R2.10 (flag tarif_sans_collecte_applicable)
# Couche : db
# Priorité : P2-important

Scénario : tournee_toutes_collectes_sans_collecte_facturation_selon_flag
  Étant donné une tournée Strike terminée dont toutes les collectes sont 'realisee_sans_collecte' et grille avec tarif_sans_collecte_applicable=false (seed Strike)
  Quand fn_m07_calc_cost s'exécute
  Alors la vacation est facturée normalement (cout_calcule_ht > 0)
  Et si tarif_sans_collecte_applicable=true (cas A Toutes! camion configuré) alors cout_calcule_ht=0
```

---

### Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : §06/M04 W7 règle + R_M04.5 + R6.2 (en_cours → annulee interdit)
# Couche : db
# Priorité : P1-critique

Scénario : annulation_tournee_en_cours_refusee
  Étant donné une tournée 'en_cours'
  Quand on tente "Annuler tournée" (UI ou API)
  Alors le bouton est désactivé avec tooltip et la transition en_cours → annulee est rejetée par le trigger cycle de vie (R6.2)
```

```gherkin
# Source : §06/M04 W2 contrainte bloquante + C... statut tournée
# Couche : api
# Priorité : P1-critique

Scénario : ajout_collecte_tournee_non_planifiee_bloque
  Étant donné une tournée statut='en_cours' (ou 'terminee' ou 'annulee')
  Quand l'Ops tente d'ajouter une collecte
  Alors le bouton "Ajouter collecte" est désactivé avec tooltip explicatif
  Et toute insertion forcée de collecte_tournees pour cette tournée est rejetée
```

```gherkin
# Source : §06/M04 W3 règles assignation
# Couche : api
# Priorité : P2-important

Scénario : assignation_vehicule_inactif_ou_chauffeur_inactif_refusee
  Étant donné une tournée 'planifiee' et un véhicule statut='en_maintenance' (ou 'inactif')
  Quand le manager tente d'assigner ce véhicule
  Alors l'assignation est refusée (véhicule doit être actif)
  Et de même un chauffeur statut!='actif' ou peut_conduire=false est refusé à l'assignation
```

```gherkin
# Source : §05 R2.1 étape 2 + R2.8 (grille obligatoire, cas impossible par construction)
# Couche : db
# Priorité : P1-critique

Scénario : cloture_sans_grille_active_raise_exception
  Étant donné une tournée 'en_cours' d'un prestataire sans grille active couvrant date_planifiee (état théoriquement impossible — bug)
  Quand la transition vers 'terminee' est tentée
  Alors le trigger précondition lève une RAISE EXCEPTION bloquante (pas un statut métier 'cout_manquant', supprimé V1)
  Et la tournée ne bascule pas en 'terminee'
```

```gherkin
# Source : §06/M04 W8 étape 3 (validation fin > debut)
# Couche : ui
# Priorité : P2-important

Scénario : correction_duree_fin_avant_debut_refusee
  Étant donné une tournée 'terminee' en cours de correction de durée
  Quand l'Ops saisit heure_reelle_fin ≤ heure_reelle_debut
  Alors la validation échoue et la confirmation est refusée (fin > debut obligatoire)
```

```gherkin
# Source : §06/M04 R_M04.3 + C9 (fenêtre correction durée)
# Couche : db
# Priorité : P1-critique

Scénario : correction_duree_facture_validee_bloquee
  Étant donné une tournée 'terminee' dont la facture prestataire du mois est statut='validee' (ou 'payee') → cout_final_verrouille=true
  Quand l'Ops tente "Corriger durée"
  Alors le bouton est désactivé avec tooltip "Facture <mois> validée, correction impossible"
  Et toute modification de cout_final_ht / heure_reelle_fin est rejetée côté DB (figement + verrouillage)
```

```gherkin
# Source : §06/M04 C12 (retrait collecte démarrée)
# Couche : db
# Priorité : P2-important

Scénario : retrait_collecte_demarree_interdit
  Étant donné une collecte rattachée à une tournée 'planifiee' mais dont statut_operationnel != 'planifiee' (déjà en_cours/terminale)
  Quand l'Ops tente "Retirer de la tournée"
  Alors le retrait est interdit (collecte démarrée ne peut pas sortir)
  Et la ligne collecte_tournees n'est pas supprimée
```

---

### Catégorie 4 — Isolation données (RLS)

```gherkin
# Source : §09 RLS tournees (ops/admin USING true)
# Couche : db
# Priorité : P1-critique

Scénario : rls_ops_savr_voit_toutes_tournees
  Étant donné un user rôle 'ops_savr' (app_domain='tms')
  Quand il lit tms.tournees
  Alors il voit toutes les tournées (Strike ET Marathon ET A Toutes!) et peut agir (W1, W2, W6, W7, W8, W9)
```

```gherkin
# Source : §09 RLS tournees (admin_tms full)
# Couche : db
# Priorité : P2-important

Scénario : rls_admin_tms_supervision_full
  Étant donné un user rôle 'admin_tms'
  Quand il lit/modifie tms.tournees
  Alors il voit toutes les tournées et peut corriger durée + re-synchroniser une tournée désynchronisée
```

```gherkin
# Source : §09 RLS + §06/M04 E4 (restriction prestataire_id)
# Couche : db
# Priorité : P1-critique

Scénario : rls_manager_prestataire_scope_ses_tournees
  Étant donné un manager_prestataire Strike consultant E4 via M03
  Quand il lit tms.tournees
  Alors il ne voit que les tournées prestataire_id=Strike et peut éditer uniquement Section 3 (chauffeur/véhicule/équipier, W3)
  Et il ne peut pas annuler (W7), remplacer en cours (W6), réordonner ni ajouter de collecte (Ops uniquement)
```

```gherkin
# Source : §09 RLS chauffeur via collecte_tournees (auth.user_chauffeur_id())
# Couche : db
# Priorité : P1-critique

Scénario : rls_chauffeur_voit_seulement_ses_tournees
  Étant donné un chauffeur (claim tms_chauffeur_id) assigné à la tournée T1
  Et une tournée T2 d'un autre chauffeur
  Quand il lit tms.tournees
  Alors il ne voit que T1 (prédicat auth.user_chauffeur_id(), pas auth.uid())
  Et les colonnes cout_calcule_ht / cout_detail / cout_final_ht ne lui sont pas exposées
```

```gherkin
# Source : §09 RLS cross-org prestataires
# Couche : db
# Priorité : P1-critique

Scénario : rls_isolation_strike_ne_voit_pas_marathon
  Étant donné un manager_prestataire Strike
  Quand il consulte la liste des tournées (équivalent E2 portail)
  Alors il ne voit jamais une tournée Marathon (isolation cross-organisation prestataire absolue)
```

---

### Catégorie 5 — Idempotence et états

```gherkin
# Source : §04 tournees + §05 R2.8 (figement cout_calcule_ht)
# Couche : db
# Priorité : P1-critique

Scénario : figement_cout_calcule_ht_immuable
  Étant donné une tournée 'terminee' avec cout_calcule_ht posé par le trigger W1
  Quand on tente un UPDATE de cout_calcule_ht avec une valeur différente
  Alors le trigger BEFORE UPDATE rejette la modification (RAISE EXCEPTION)
  Et toute correction passe exclusivement par cout_ajuste_ht (statut_financier='ajuste')
```

```gherkin
# Source : §05 R6.2 (transition terminee → planifiee interdite)
# Couche : db
# Priorité : P1-critique

Scénario : reouverture_tournee_terminee_interdite
  Étant donné une tournée statut='terminee'
  Quand on tente de la repasser à 'planifiee' ou 'en_cours'
  Alors le trigger cycle de vie rejette la transition (terminee terminal hors correction de durée)
```

```gherkin
# Source : §05 R6.2 (annulee terminal)
# Couche : db
# Priorité : P1-critique

Scénario : tournee_annulee_terminal
  Étant donné une tournée statut='annulee'
  Quand on tente n'importe quelle transition sortante
  Alors elle est rejetée (annulee est terminal)
```

```gherkin
# Source : §06/M04 §4 clôture auto + R5.5 (idempotence stock_entrepot_update_at)
# Couche : db
# Priorité : P1-critique

Scénario : cloture_auto_stock_zd_idempotent
  Étant donné une tournée ZD passant 'en_cours' → 'terminee' avec pesées ZD (biodechet, verre...) et stock_entrepot_update_at IS NULL
  Quand le trigger trg_m10_auto_increment_pleins s'exécute
  Alors stocks_bacs_entrepot.quantite_pleine est incrémenté, quantite_vide_disponible décrémenté, et tournees.stock_entrepot_update_at = now()
  Et un second passage du trigger (re-update statut) est no-op (garde NEW.stock_entrepot_update_at IS NOT NULL)
  Et une tournée purement AG (0 pesée ZD) est un no-op silencieux
```

```gherkin
# Source : §06/M04 §4 clôture auto (toutes collectes terminales)
# Couche : db
# Priorité : P2-important

Scénario : cloture_auto_quand_toutes_collectes_terminales
  Étant donné une tournée 'en_cours' dont toutes les collectes deviennent terminales (realisee / realisee_sans_collecte / incident / annulee) sans clic chauffeur
  Quand la dernière collecte passe terminale
  Alors la tournée bascule automatiquement en 'terminee' (R6.2 filet de sécurité) et déclenche W5 étapes 6-9
```

```gherkin
# Source : §08 S3 dédup integrations_inbox (PK event_id, TTL 7j)
# Couche : api
# Priorité : P1-critique

Scénario : dedup_event_id_pas_de_double_upsert
  Étant donné un webhook entrant déjà traité avec event_id 'evt-456' (présent dans integrations_inbox)
  Quand le même event_id est reçu une seconde fois (retry émetteur)
  Alors le serveur répond 200 sans rejouer l'effet métier (dédup sur body.event_id, pas de header Idempotency-Key)
  Et aucune ligne ni transition dupliquée n'est créée
```

```gherkin
# Source : §04 tournees push_s6_version + W8
# Couche : db
# Priorité : P2-important

Scénario : push_s6_version_increment_a_chaque_recalcul
  Étant donné une tournée 'terminee' avec push_s6_version=1 (calcul initial)
  Quand un ajustement W8 (correction durée) recalcule le coût
  Alors push_s6_version passe à 2
  Et chaque incrément déclenche le recalcul marge cross-schema Plateforme (lecture v_courses_logistiques)
```

```gherkin
# Source : §06/M04 §8 M07 + §04 §6 cross-schema (ex-S6 supprimé)
# Couche : db
# Priorité : P1-critique

Scénario : recalcul_marge_cross_schema_sur_update_cout_final
  Étant donné une tournée dont cout_final_ht est mis à jour (clôture ou ajustement)
  Quand l'UPDATE est commité
  Alors le trigger DB plateforme.fn_recalc_marge_tournee() se déclenche en synchrone (lecture vue plateforme.v_courses_logistiques)
  Et aucun webhook HTTP S6 'course-cout-calculee' n'est émis (supprimé Bloc A A2 — pas de réseau, retry ni DLQ)
```

---

### Catégorie 6 — Scénarios cross-app (Plateforme ↔ TMS)

```gherkin
# Source : §08 S3 tournee-upsert
# Couche : api
# Priorité : P1-critique

Scénario : emission_s3_a_creation_modif_annulation
  Étant donné une tournée créée, puis modifiée (ajout collecte), puis annulée
  Quand chaque événement survient
  Alors un webhook S3 'tournee-upsert' distinct est émis à chaque fois (enveloppe complète : event_id, occurred_at, source, type) avec l'état à jour (collecte_ids[], chauffeur, véhicule, statut)
```

```gherkin
# Source : §08 retry 3 paliers 5min/1h/24h + dédup event_id
# Couche : api
# Priorité : P1-critique

Scénario : retry_s3_apres_500_sans_doublon
  Étant donné un webhook S3 émis dont la Plateforme renvoie 500 au premier essai
  Quand le retry suit les 3 paliers 5min / 1h / 24h
  Alors un succès à un essai ultérieur ne crée pas de doublon côté Plateforme (dédup event_id)
  Et après 5 tentatives échouées l'event part en DLQ + alerte M11 'm04_evenement_dlq' (critical) à Val+Louis
```

```gherkin
# Source : §08 Auth HMAC-SHA256
# Couche : api
# Priorité : P1-critique

Scénario : webhook_entrant_hmac_invalide_rejet_401
  Étant donné un webhook entrant (ex : DELETE E3, PATCH E2) dont le body a été modifié après signature
  Quand le TMS le reçoit
  Alors il répond 401 unauthorized (non retryable) et aucun effet métier n'est appliqué sur la tournée
```

```gherkin
# Source : §08 Versioning X-API-Version (header autoritatif unique)
# Couche : api
# Priorité : P2-important

Scénario : webhook_entrant_x_api_version_absente_rejet_400
  Étant donné un webhook entrant sans header X-API-Version (ou version ≠ 2026.04)
  Quand le TMS le reçoit
  Alors il répond 400 invalid_payload (header autoritatif, le champ version du body est ignoré)
```

```gherkin
# Source : §06/M04 W10 + §08 E2 PATCH /collectes/:id (réacceptation créneau)
# Couche : api
# Priorité : P1-critique

Scénario : patch_collecte_acceptee_modif_creneau_declenche_reacceptation
  Étant donné une collecte 'acceptee' rattachée à une tournée Strike, avec event_id E2 inédit
  Quand un PATCH E2 modifie date_collecte ou heure_collecte
  Alors le diff est appliqué, statut_dispatch repasse 'attribuee_en_attente_acceptation' avec flags_jsonb.re_confirmation_requise=true
  Et le manager est notifié "modification créneau — re-confirmation requise" (pas de S2 émis ; S1 émis à la re-confirmation)
  Et si la collecte est partagée dans une tournée, une alerte M11 (warning) "Collecte de la tournée T#xxx en re-confirmation" est émise
  Et le PATCH est répondu 200 et un audit_logs action='COLLECTE_PATCH' (diff, event_id, reacceptation_appliquee=true) est inséré
```

```gherkin
# Source : §06/M04 W10 étape 3 (PATCH sur collecte démarrée)
# Couche : api
# Priorité : P2-important

Scénario : patch_collecte_en_cours_renvoie_409
  Étant donné une collecte avec statut_operationnel IN ('en_cours','realisee','realisee_sans_collecte','incident')
  Quand un PATCH E2 est reçu
  Alors le TMS répond 409 Conflict (la Plateforme alerte Ops, ne réessaye pas)
  Et un PATCH sur lieu_id ou type_collecte répond 422 (anomalie — annuler + reprogrammer côté Plateforme)
```

---

## Scénarios hors scope (à générer en V1.1 ou autre module)

- **Catégorie 7 — Migration (Bubble + MTS-1 → Supabase)** : non couverte par M04. Le module porte la gestion runtime des tournées, pas la migration. À générer via `cdc-migration-data` + `04 - Migration/05 - Checks reconciliation.md` (côté TMS : §13 Migration MTS-1).
- **Détail UX checklist pré-départ M05** : couvert par les scénarios M05 (app mobile chauffeur). M04 ne teste que l'effet (transition acceptee → en_cours).
- **Réordonnancement collectes (RPC `m04_reordonner_collectes`)** : flèches ▲▼ E3 — testable V1 mais P3 (pas de risque métier critique). À ajouter si temps.
- **W6 remplacement véhicule/chauffeur en cours** : P2, scénario nominal simple (UPDATE vehicule_id + alerte M11 'remplacement_vehicule_chauffeur_en_cours' + S3). À ajouter si temps.
- **Alertes C8/C11/C4 (GPS indisponible, tournée sans chauffeur J-1 17h, tournée vide)** : edge cases d'alerting M11, P3.
- **Multi-vélo AG (1 collecte = N vélos)** : marqué V2 dans D8bis (le TMS V1 ship 1 collecte = 1 vélo). Mécanique multi-camions héritée, scénario de dérivation couvert par `collecte_realisee_quand_toutes_tournees_soeurs_terminee`.
- **Intégration Everest (everest_missions, A Toutes!)** : portée par M14, testée là-bas.

---

## Specs floues — RÉSOLUES 2026-06-06 (Val) + propagées

Les 4 specs floues remontées à la génération ont été tranchées par Val et propagées dans le CDC. Conservées ici pour traçabilité.

1. **Divergence cycle de vie tournée — `acceptee`** → **TRANCHÉ : la tournée passe par `acceptee`.** Flux nominal = `planifiee → acceptee → en_cours → terminee`. État `acceptee` posé par M03 W3 step 5 (Strike/Marathon : toutes collectes acceptées + chauffeur/véhicule assignés) ou directement à la création province (W2 M02 — confirmation manuelle Ops vaut acceptation, sans validation prestataire ; le chauffeur province utilise l'app M05 comme tout chauffeur). Transition `planifiee → en_cours` **directe interdite**. Propagé : M04 §4 (diagramme + transitions + table déclencheurs + note), W3 step 5, W4 (titre + step 4), E3 boutons, E5 ; §05 R6.2. Scénarios mis à jour : `demarrage_tournee_acceptee_vers_en_cours`, `tournee_province_acceptee_directe_puis_demarrage_m05`, `ajout_collecte_non_acceptee_repasse_tournee_planifiee`.

2. **`acceptee → terminee`** → **TRANCHÉ : transition légitime (filet de sécurité), ajoutée explicitement à l'enum R6.2.** Couvre la tournée prête jamais démarrée dont toutes les collectes deviennent terminales (incident/annulation avant arrivée) ou la clôture forcée Ops W9 — valable pour tous les prestataires, pas seulement province. Le trigger `fn_m07_calc_cost` l'acceptait déjà ; R6.2 l'aligne. Scénario : `cloture_filet_securite_acceptee_vers_terminee`.

3. **Seed params `m04_*`** → **RÉSOLU : 5 clés ajoutées au seed §04** namespace `m04` (`m04_seuil_distance_cloture_metres`=300, `m04_coords_gps_entrepot`, `m04_seuil_inactivite_tournee_heures`=8, `m04_seuil_delta_cout_correction_pct`=20, `m04_delai_assignation_chauffeur_alerte_heures`=17), en plus de `m04_tournee_tampon_minutes`=30 déjà présent.

4. **Détection « tournée oubliée 8h » — cron vs trigger** → **TRANCHÉ : cron pg_cron** (un trigger DB est impossible sur une condition de temps écoulé). Déclaré M11 §11.6 : `cron_m04_alerte_inactivite_tournee` (15 min) émet `m04_tournee_oubliee_cloture_auto` ; `cron_m04_alerte_tournee_sans_chauffeur_j1` (1×/h) émet `m04_tournee_sans_chauffeur_j1`. Miroir de `cron_m02_alerte_acceptation`.

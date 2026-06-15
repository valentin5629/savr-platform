# Scénarios de test — M12 Attribution transporteur

**Source CDC** : §06/M12 + §05 R1.1-R1.4 + §04 TMS §1186-1276 (`collectes_tms` colonnes suggestion, `suggestions_attribution_log`, `shared.prestataires.nb_collectes_6_mois_cache`, `parametres_tms.attribution`) + §09 RLS §14/§17bis + `plateforme.parametres_algo` (App §04)
**Généré le** : 2026-06-07

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests du module M12.
> Pour chaque scénario :
> - Couche `db` → test pgTAP dans `supabase/tests/`
> - Couche `api` → test Vitest dans `packages/tms/tests/api/`
> - Couche `ui` → test Playwright dans `packages/tms/tests/e2e/`
> Les tests P1-critique sont bloquants CI. P2/P3 non-bloquants V1.
> Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.

> **Base de référence** : ces scénarios sont générés sur l'état **post-audit cohérence A1-A5 2026-05-09** : couverture Everest = check local `code_postal[:2] IN parametres_algo.everest_codes_postaux` (zéro appel API, zéro cache), paramètres AG IDF source unique `plateforme.parametres_algo`, seuil express unique 90 min. Le corps de M12 et §04/§09 contiennent encore de la dette doc pré-A4 (cf. F3) — **ne pas implémenter** `everest_coverage_cache`, les colonnes `everest_is_handled_address_*`, ni `refusee_par_prestataire_id[]`.
>
> **Périmètre API** : M12 est **100% interne TMS**. Aucun endpoint E1-E6 / S1-S11 propre — `POST /internal/m12/suggest` est une route interne non exposée. La catégorie 6 se limite aux enchaînements contractuels indirects (T1 déclenché par ingestion E1 — payload/HMAC/dédup testés M01 ; cascade annulation Everest W2 1bis = R_M14.7 testée M14).
>
> **Périmètre migration** : `suggestions_attribution_log` est une table neuve sans équivalent MTS-1. Le risque migration est le déclenchement parasite du trigger T1 sur les INSERT de collectes historiques migrées (cat. 7, conditionné à F5).

---

## Résumé de couverture

| Catégorie | Nb scénarios | Couverture |
|-----------|-------------|------------|
| 1. Happy path | 9 | T1 toutes branches nominales (ZD, vélo programmé/express, Marathon volume/nuit, province), T2 recalcul, T3 bascule, résolution auto W7 |
| 2. Cas limites métier | 11 | Bornes 599/600 pax, 07:00/20:00, 89/90 min, CP 94 IDF hors Everest, distance=rayon, tri égalité distance, grille borne validité, CHECK everest_service_id_target |
| 3. Cas d'erreur métier | 9 | aucun_prestataire toutes raisons (zd exclu, zd province F7, nuit, province rayon/grille/coords), flag a_toutes_indisponible, backup camion, code prestataire introuvable |
| 4. Isolation RLS | 7 | suggestions_attribution_log (staff read, deny presta/chauffeur, append-only strict), parametres_tms.attribution admin-only, masquage suggestion_* portail presta |
| 5. Idempotence & états | 8 | T1/T2 sans bascule statut, T3 no-op branche identique, log append-only, pas de recalcul sur modif param (T5 supprimé), code immuable, nb_collectes_6_mois_cache, figement |
| 6. Cross-app | 2 | Enchaînement E1→T1 (suggestion prête à l'affichage M02), everest_service_id_target posé pour M14 W1 |
| 7. Migration | 2 | INSERT migration ne déclenche pas T1 (F5), idempotence re-run import |
| **TOTAL** | **48** | |

> **Révision 2026-06-07 (session seed-fixtures, mapping zones réel)** : garde zone tarifaire A Toutes! ajoutée (§05 R1.3 + algo §4.6 `is_zone_tarifaire_atoutes`, mapping départemental 75/92/93/94 seed §04). 47→48 scénarios.

**8 specs floues détectées et soldées 2026-06-07** (4 tranchées Val, 2 par reco, 1 dette purgée, 1 reco notée). Voir section finale.

---

## Données de test communes (fixtures minimales)

- Prestataires seedés : `strike` (ZD, actif, grille valide 2026), `marathon` (AG, actif, grille valide), `a_toutes` (AG, actif, intégration externe `everest`).
- Prestataires province : `presta_lyon_a` (AG, coords Lyon, rayon 50 km, grille valide, `nb_collectes_6_mois_cache=12`), `presta_lyon_b` (AG, coords Lyon, rayon 50 km, grille valide, `nb_collectes_6_mois_cache=3`).
- Paramètres `plateforme.parametres_algo` (seed V1) : `regle_ag_plage_velo_debut=07:00`, `regle_ag_plage_velo_fin=20:00`, `regle_ag_seuil_pax_velo=600`, `regle_ag_seuil_h2_minutes=90`, `everest_codes_postaux=['75','92','93']`, `a_toutes_indisponible=false`.
- `parametres_tms.attribution.province_tri_secondaire_code='nb_collectes_6_mois_asc'` (modifiable_par `['admin_tms']`).
- Lieux : `lieu_pavillon_75` (CP 75116), `lieu_vincennes_94` (CP 94300), `lieu_lyon_69` (CP 69002, coords valides).

---

## Catégorie 1 — Happy path

```gherkin
# Source : §06/M12 W1 + §4.6 branche ZD + §05 R1.1
# Couche : db
# Priorité : P1-critique
Scénario : t1_zd_idf_strike_suggestion_initiale
  Étant donné une collecte ZD Kaspia au lieu_pavillon_75, heure_collecte J+2 10:00, insérée dans collectes_tms (ingestion E1 M01)
  Quand le trigger AFTER INSERT appelle tms.m12_suggest(collecte_id, '{}')
  Alors collectes_tms.suggestion_prestataire_id = id de strike
  Et suggestion_branche_r1_code = 'zd_idf_strike'
  Et suggestion_calculee_at IS NOT NULL
  Et everest_service_id_target IS NULL (prestataire non-Everest)
  Et une ligne suggestions_attribution_log existe avec trigger_source='T1_creation', prestataire_id=strike, duree_calcul_ms >= 0
  Et statut_dispatch reste 'a_attribuer'
```

```gherkin
# Source : §06/M12 §4.6 branche AG vélo + §05 R1.2 branche 3 + B_M14_02
# Couche : db
# Priorité : P1-critique
Scénario : t1_ag_velo_programme_petit_event_jour_couvert
  Étant donné une collecte AG 450 pax au lieu_pavillon_75 (CP 75), heure_collecte J+3 14:00
  Quand T1 s'exécute
  Alors suggestion_prestataire_id = a_toutes
  Et suggestion_branche_r1_code = 'ag_velo_programme'
  Et everest_service_id_target = 71
  Et suggestion_detail contient service_everest_id=71 et couverture_verifiee=true
```

```gherkin
# Source : §06/M12 §4.6 sous-branche délai (A5 2026-05-09 seuil unique 90 min)
# Couche : db
# Priorité : P1-critique
Scénario : t1_ag_velo_express_delai_inferieur_90_min
  Étant donné une collecte AG 200 pax au lieu_pavillon_75, heure_collecte = now() + 60 minutes (plage jour)
  Quand T1 s'exécute
  Alors suggestion_branche_r1_code = 'ag_velo_express'
  Et everest_service_id_target = 75
```

```gherkin
# Source : §06/M12 §4.6 branche volume + §05 R1.2 branche 2
# Couche : db
# Priorité : P1-critique
Scénario : t1_ag_marathon_volume_grand_event
  Étant donné une collecte AG 800 pax au lieu_pavillon_75, heure_collecte J+5 15:00
  Quand T1 s'exécute
  Alors suggestion_prestataire_id = marathon
  Et suggestion_branche_r1_code = 'ag_marathon_volume'
  Et everest_service_id_target IS NULL
```

```gherkin
# Source : §06/M12 §4.6 branche nuit + §05 R1.2 branche 1
# Couche : db
# Priorité : P1-critique
Scénario : t1_ag_marathon_nuit
  Étant donné une collecte AG 300 pax au lieu_pavillon_75, heure_collecte J+2 22:30
  Quand T1 s'exécute
  Alors suggestion_branche_r1_code = 'ag_marathon_nuit'
  Et suggestion_prestataire_id = marathon
```

```gherkin
# Source : §06/M12 §4.7 branche_province_ag + §05 R1.2 province + D10
# Couche : db
# Priorité : P1-critique
Scénario : t1_ag_province_proximite_plus_proche_dans_rayon
  Étant donné une collecte AG 150 pax au lieu_lyon_69 (hors IDF), presta_lyon_a à 8 km et presta_lyon_b à 25 km
  Quand T1 s'exécute
  Alors suggestion_prestataire_id = presta_lyon_a (tri primaire distance ASC)
  Et suggestion_branche_r1_code = 'ag_province_proximite'
  Et suggestion_detail.distance_km ≈ 8 et candidats_total = 2
```

```gherkin
# Source : §06/M12 W2 (T2 recalcul sans bascule — revue sobriété 2026-04-29)
# Couche : db
# Priorité : P1-critique
Scénario : t2_refus_prestataire_recalcule_suggestion_sans_bascule
  Étant donné une collecte AG 450 pax IDF attribuée à a_toutes, qui passe statut_dispatch='rejetee_par_prestataire' (refus M03)
  Quand le trigger AFTER UPDATE appelle m12_suggest(id, ARRAY[a_toutes_id])
  Alors suggestion_prestataire_id = marathon (a_toutes exclu du recalcul)
  Et suggestion_branche_r1_code = 'ag_velo_fallback_marathon'
  Et statut_dispatch reste 'rejetee_par_prestataire' (PAS de bascule auto, pas de webhook S1/S2 émis)
  Et une ligne log trigger_source='T2_refus' existe avec detail.prestataire_exclu = [a_toutes_id]
```

```gherkin
# Source : §06/M12 W3 + EC 7.6 (reco C9) + N2
# Couche : db + api
# Priorité : P1-critique
Scénario : t3_re_confirmation_bascule_branche_apres_modif_pax
  Étant donné une collecte AG 450 pax acceptée par a_toutes (statut_dispatch='acceptee', branche 'ag_velo_programme')
  Quand M01 D6 applique nb_pax=650 et pose re_confirmation_requise=true
  Alors T3 recalcule : suggestion_branche_r1_code = 'ag_marathon_volume', suggestion_prestataire_id = marathon
  Et une ligne log trigger_source='T3_re_confirmation' existe
  Et un email N2 est mis en queue pour Ops Savr ("suggestion bascule ag_velo_programme→ag_marathon_volume")
  Et statut_dispatch reste 'acceptee' ET prestataire_id reste a_toutes (pas de bascule attribution — Ops tranche)
```

```gherkin
# Source : §06/M12 §12ter résolution auto W7 + M11 W7
# Couche : db
# Priorité : P2-important
Scénario : alerte_aucun_prestataire_resolue_auto_creation_presta_couvrant
  Étant donné une alerte 'm12_aucun_prestataire' ouverte sur une collecte province (reason='province_aucun_dans_rayon')
  Quand un prestataire AG actif avec grille valide couvrant la zone est créé (fn_create_prestataire_province)
  Alors le trigger shared.prestataires AFTER INSERT/UPDATE résout l'alerte (statut='resolue', resolue_source auto)
```

---

## Catégorie 2 — Cas limites métier

```gherkin
# Source : §05 R1.3 garde zone tarifaire A Toutes! (nouveau 2026-06-07, arbitrage Val — grande couronne hors mapping 75/92/93/94)
# Couche : db
# Priorité : P1-critique
Scénario : garde_zone_atoutes_grande_couronne_fallback_marathon
  Étant donné une collecte AG 300 pax, lieu code postal 78140 (Vélizy — IDF mais hors zones_codes_postaux_mapping), jour, < 600 pax
  Quand T1 s'exécute
  Alors A Toutes! n'est jamais suggéré (is_zone_tarifaire_atoutes = false, même si everest_is_handled_address = true)
  Et suggestion_branche_r1_code = 'ag_velo_fallback_marathon'
```

```gherkin
# Source : §05 R1.2 — nb_pax >= 600 (borne exacte)
# Couche : db
# Priorité : P1-critique
Scénario : limite_600_pax_exactement_marathon
  Étant donné une collecte AG 600 pax IDF jour couverte Everest
  Quand T1 s'exécute
  Alors suggestion_branche_r1_code = 'ag_marathon_volume' (>= strict sur le seuil)
```

```gherkin
# Source : §05 R1.2
# Couche : db
# Priorité : P1-critique
Scénario : limite_599_pax_velo
  Étant donné une collecte AG 599 pax IDF jour couverte Everest, J+3
  Quand T1 s'exécute
  Alors suggestion_branche_r1_code = 'ag_velo_programme'
```

```gherkin
# Source : §06/M12 §4.6 — heure >= plage_velo_fin = nuit
# Couche : db
# Priorité : P1-critique
Scénario : limite_heure_2000_exactement_nuit
  Étant donné une collecte AG 300 pax IDF, heure_collecte à 20:00 exactement
  Quand T1 s'exécute
  Alors suggestion_branche_r1_code = 'ag_marathon_nuit' (20:00 inclus dans la nuit)
```

```gherkin
# Source : §06/M12 §4.6 — heure < plage_velo_debut = nuit
# Couche : db
# Priorité : P2-important
Scénario : limite_heure_0700_exactement_jour
  Étant donné une collecte AG 300 pax IDF couverte, heure_collecte à 07:00 exactement, J+2
  Quand T1 s'exécute
  Alors la branche est une branche jour ('ag_velo_programme') — 07:00 n'est pas < 07:00
```

```gherkin
# Source : §06/M12 §4.6 — minutes_avant_collecte < 90 (A5)
# Couche : db
# Priorité : P1-critique
Scénario : limite_90_minutes_exactement_programme
  Étant donné une collecte AG 200 pax IDF couverte, heure_collecte = now() + 90 minutes exactement
  Quand T1 s'exécute
  Alors suggestion_branche_r1_code = 'ag_velo_programme' (< strict : 90 = programmé)
  Et avec heure_collecte = now() + 89 minutes → 'ag_velo_express'
```

```gherkin
# Source : §06/M12 §4.8 is_ile_de_france vs everest_is_handled_address (A4)
# Couche : db
# Priorité : P1-critique
Scénario : limite_cp_94_idf_mais_hors_couverture_everest
  Étant donné une collecte AG 300 pax au lieu_vincennes_94 (CP 94300 — IDF, hors ['75','92','93']), jour, J+3
  Quand T1 s'exécute
  Alors la branche IDF est déclenchée (pas province)
  Et everest_is_handled_address retourne false (check local préfixe '94')
  Et suggestion_branche_r1_code = 'ag_velo_fallback_marathon' avec detail.reason='a_toutes_hors_zone'
  Et suggestion_prestataire_id = marathon
```

```gherkin
# Source : §06/M12 §4.7 — filtre distance <= rayon
# Couche : db
# Priorité : P2-important
Scénario : limite_province_distance_egale_rayon
  Étant donné presta_lyon_a avec rayon_intervention_km=50 et une collecte à exactement 50.0 km haversine
  Quand T1 s'exécute
  Alors presta_lyon_a est candidat (<= inclusif) et suggéré
```

```gherkin
# Source : §06/M12 §4.7 tri secondaire (D10, reco C5)
# Couche : db
# Priorité : P2-important
Scénario : limite_province_egalite_distance_tri_nb_collectes_asc
  Étant donné presta_lyon_a (nb_collectes_6_mois_cache=12) et presta_lyon_b (cache=3) à distance identique de la collecte
  Quand T1 s'exécute
  Alors suggestion_prestataire_id = presta_lyon_b (tri secondaire nb_collectes_6_mois_asc)
  Et suggestion_detail.tri_secondaire = 'nb_collectes_6_mois_asc'
```

```gherkin
# Source : §06/M12 §4.8 has_grille_valide — BETWEEN inclusif
# Couche : db
# Priorité : P2-important
Scénario : limite_grille_date_fin_validite_egale_date_collecte
  Étant donné strike avec une unique grille date_fin_validite = date de la collecte ZD
  Quand T1 s'exécute
  Alors strike est éligible (borne incluse via COALESCE/BETWEEN) et suggéré 'zd_idf_strike'
```

```gherkin
# Source : §04 TMS — CHECK everest_service_id_target IN (71,75,91)
# Couche : db
# Priorité : P1-critique
Scénario : limite_check_everest_service_id_target_valeur_interdite
  Étant donné une collecte AG quelconque
  Quand un UPDATE pose everest_service_id_target = 80
  Alors la contrainte CHECK rejette l'écriture (violation)
  Et les valeurs 71, 75, 91 et NULL sont acceptées
```

---

## Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : §06/M12 EC 7.1 + §05 R1.3 + §12ter m12_aucun_prestataire
# Couche : db
# Priorité : P1-critique
Scénario : erreur_zd_strike_suspendu_aucun_prestataire
  Étant donné strike avec statut='suspendu' et une collecte ZD entrante
  Quand T1 s'exécute
  Alors suggestion_prestataire_id IS NULL
  Et suggestion_branche_r1_code = 'aucun_prestataire' avec detail.reason='strike_inactif_ou_sans_grille'
  Et statut_dispatch reste 'a_attribuer'
  Et tms.alerte_emit('m12_aucun_prestataire', critical) est appelée (alerte M11 + email Ops/Admin)
```

```gherkin
# Source : §05 R1.1 garde ZD province (F7 tranché Val 2026-06-07)
# Couche : db
# Priorité : P1-critique
Scénario : erreur_zd_province_aucun_prestataire
  Étant donné une collecte ZD entrante au lieu_lyon_69 (CP 69002, non-IDF)
  Quand T1 s'exécute
  Alors Strike n'est PAS suggéré
  Et suggestion_branche_r1_code = 'aucun_prestataire' avec detail.reason='zd_province_non_supporte_v1'
  Et une alerte m12_aucun_prestataire critical est émise
```

```gherkin
# Source : §06/M12 §4.6 branche nuit — pas de backup nuit V1
# Couche : db
# Priorité : P1-critique
Scénario : erreur_ag_nuit_marathon_inactif_aucun_prestataire
  Étant donné marathon statut='suspendu' et une collecte AG 22:00 IDF
  Quand T1 s'exécute
  Alors suggestion_branche_r1_code = 'aucun_prestataire' avec reason='ag_nuit_marathon_exclu'
  Et A Toutes! n'est PAS suggéré (fermé la nuit, pas de backup V1)
```

```gherkin
# Source : §06/M12 §4.7
# Couche : db
# Priorité : P1-critique
Scénario : erreur_province_aucun_presta_dans_rayon
  Étant donné une collecte AG à Marseille (CP 13) sans aucun prestataire AG dont rayon couvre la distance
  Quand T1 s'exécute
  Alors suggestion = NULL / 'aucun_prestataire' / reason='province_aucun_dans_rayon'
  Et alerte critical m12_aucun_prestataire émise
```

```gherkin
# Source : §06/M12 §4.7 + EC 7.5 — conditionné F4 (gravité/caducité presta_sans_grille)
# Couche : db
# Priorité : P2-important
Scénario : erreur_province_presta_dans_rayon_sans_grille
  Étant donné presta_lyon_a dans le rayon mais SANS grille valide à la date de collecte (cas théoriquement impossible par construction R_M06 — test défensif)
  Quand T1 s'exécute
  Alors suggestion 'aucun_prestataire' avec reason='province_presta_trouve_sans_grille'
  Et une alerte m12_aucun_prestataire critical est émise (F4 tranché : gravité uniforme, pas d'alerte dédiée "presta sans grille" — trace integrations_logs warning seule)
```

```gherkin
# Source : §06/M12 EC 7.8 (coords manquantes M01 D9)
# Couche : db
# Priorité : P1-critique
Scénario : erreur_province_coords_manquantes
  Étant donné une collecte province avec lieu_adresse.lat/lng NULL (flag M01 coords_manquantes=true)
  Quand T1 s'exécute
  Alors suggestion 'aucun_prestataire' avec reason='province_coords_manquantes'
  Et une alerte m12_aucun_prestataire critical est émise (F4 tranché : gravité uniforme) et le calcul ne lève PAS d'exception
```

```gherkin
# Source : §05 R1.2 + §06/M12 §4.6 — flag manuel D8
# Couche : db
# Priorité : P1-critique
Scénario : erreur_a_toutes_indisponible_bascule_marathon
  Étant donné parametres_algo.a_toutes_indisponible = true et une collecte AG 300 pax IDF jour couverte
  Quand T1 s'exécute
  Alors suggestion_prestataire_id = marathon
  Et suggestion_branche_r1_code = 'ag_velo_fallback_marathon' avec detail.reason='a_toutes_indispo_bascule_marathon'
```

```gherkin
# Source : §05 R1.2 branche 2 + §06/M12 §4.6 backup camion (A2 2026-05-09)
# Couche : db
# Priorité : P1-critique
Scénario : erreur_marathon_exclu_backup_camion_atoutes_91
  Étant donné marathon suspendu, une collecte AG 700 pax IDF couverte Everest, heure 15:00 (< plage_velo_fin), a_toutes_indisponible=false
  Quand T1 s'exécute
  Alors suggestion_prestataire_id = a_toutes
  Et suggestion_branche_r1_code = 'ag_marathon_volume_backup_camion' (canonique cross-CDC = enum App branche_attribution, F1 révisé 2026-06-07)
  Et everest_service_id_target = 91
  Et suggestion_detail.service_everest_id = 91
```

```gherkin
# Source : §06/M12 §4.8 resolve_prestataire_by_code null-safe
# Couche : db
# Priorité : P2-important
Scénario : erreur_code_prestataire_introuvable_null_safe
  Étant donné strike soft-deleted (deleted_at NOT NULL) et une collecte ZD entrante
  Quand T1 s'exécute
  Alors resolve_prestataire_by_code('strike') retourne NULL sans exception
  Et la suggestion retombe en 'aucun_prestataire' (pas de crash trigger, l'INSERT collecte aboutit)
```

---

## Catégorie 4 — Isolation données (RLS)

```gherkin
# Source : §09 §17bis suggestions_log_staff_read
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : rls_log_ops_et_admin_select_ok
  Étant donné 10 lignes suggestions_attribution_log
  Quand un user ops_savr puis un user admin_tms exécutent SELECT
  Alors les 10 lignes sont visibles pour les deux (auth.user_is_staff())
```

```gherkin
# Source : §09 §17bis + §06/M12 §2 (suggestions internes Savr)
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : rls_log_manager_prestataire_select_deny
  Étant donné un user manager_prestataire Strike authentifié
  Quand il exécute SELECT sur suggestions_attribution_log
  Alors 0 ligne retournée (y compris les suggestions concernant ses propres collectes)
```

```gherkin
# Source : §09 §17bis
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : rls_log_chauffeur_select_deny
  Étant donné un user chauffeur authentifié
  Quand il exécute SELECT sur suggestions_attribution_log
  Alors 0 ligne retournée
```

```gherkin
# Source : §09 §17bis — append-only strict, write service_role only
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : rls_log_insert_update_delete_deny_meme_admin
  Étant donné un user admin_tms authentifié
  Quand il tente INSERT, UPDATE et DELETE sur suggestions_attribution_log
  Alors les 3 opérations sont rejetées (aucune policy write pour authenticated — deny par défaut)
  Et le même INSERT via service_role (trigger T1) réussit
```

```gherkin
# Source : §09 §14 parametres_tms + §04 TMS §5 (modifiable_par=['admin_tms']) + D11
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : rls_parametre_attribution_update_ops_deny_admin_ok
  Étant donné la ligne parametres_tms 'province_tri_secondaire_code' avec modifiable_par=['admin_tms']
  Quand un user ops_savr tente UPDATE de la valeur
  Alors l'UPDATE est rejeté (0 ligne affectée)
  Et le même UPDATE par admin_tms réussit
  Et le SELECT reste autorisé à tout authentifié (parametres_tms_read_all)
```

```gherkin
# Source : §09 §14 — INSERT/DELETE admin only
# Couche : db (pgTAP)
# Priorité : P2-important
Scénario : rls_parametre_attribution_insert_delete_admin_only
  Quand un user ops_savr tente INSERT d'une nouvelle clé namespace 'attribution' puis DELETE d'une clé existante
  Alors les 2 opérations sont rejetées
  Et les mêmes opérations par admin_tms réussissent
```

```gherkin
# Source : §06/M12 §2 "Manager prestataire ne voit jamais les suggestions" — conditionné F8 (masquage colonnes)
# Couche : db (pgTAP)
# Priorité : P2-important
Scénario : rls_colonnes_suggestion_invisibles_portail_prestataire
  Étant donné une collecte attribuée à Strike avec suggestion_* renseignées (recalcul T2 pointant vers Marathon)
  Quand le manager_prestataire Strike lit la collecte via la surface M03 (vue whitelist)
  Alors les colonnes suggestion_prestataire_id, suggestion_branche_r1_code, suggestion_detail ne sont PAS exposées
  (mécanisme exact à figer — arbitrage F8)
```

---

## Catégorie 5 — Idempotence et états

```gherkin
# Source : §06/M12 §8 — T1 ne change pas statut_dispatch
# Couche : db
# Priorité : P1-critique
Scénario : etat_t1_ne_modifie_pas_statut_dispatch
  Étant donné une collecte insérée avec statut_dispatch='a_attribuer'
  Quand T1 pose la suggestion
  Alors statut_dispatch = 'a_attribuer' inchangé et seules les 4 colonnes suggestion_* + everest_service_id_target sont modifiées
```

```gherkin
# Source : §06/M12 W2 (comportements supprimés revue sobriété 2026-04-29)
# Couche : db + api
# Priorité : P1-critique
Scénario : etat_t2_aucune_bascule_ni_webhook_sortant
  Étant donné une collecte rejetee_par_prestataire dont T2 a recalculé la suggestion
  Quand on inspecte l'outbox / la file webhooks TMS→Plateforme
  Alors aucun événement S1/S2 n'a été émis par T2
  Et statut_dispatch n'a subi aucune transition (pas de 'attribuee_en_attente_acceptation' auto)
```

```gherkin
# Source : §06/M12 EC 7.7
# Couche : db
# Priorité : P1-critique
Scénario : etat_t3_branche_identique_noop_mais_log_insere
  Étant donné une collecte acceptée 450 pax branche 'ag_velo_programme'
  Quand nb_pax passe à 480 (même branche)
  Alors les colonnes suggestion_* de collectes_tms sont inchangées (no-op, suggestion_calculee_at non modifié ou modifié selon implémentation — vérifier branche identique)
  Et une ligne log trigger_source='T3_re_confirmation' avec detail.branche_unchanged=true est insérée
  Et re_confirmation_requise reste true (levée uniquement par confirmation Ops M02)
```

```gherkin
# Source : §06/M12 §4.2 append-only + D3
# Couche : db
# Priorité : P1-critique
Scénario : idempotence_log_une_ligne_par_execution
  Étant donné une collecte ayant subi T1 puis T2 puis T3
  Quand on compte les lignes suggestions_attribution_log pour cette collecte
  Alors exactement 3 lignes existent avec trigger_source distincts, ordonnées par cree_le
  Et aucune ligne n'a jamais été UPDATE (pas de RPC d'enrichissement V1)
```

```gherkin
# Source : §06/M12 §2 Admin TMS — pas de bulk re-compute (T5 supprimé)
# Couche : db
# Priorité : P1-critique
Scénario : etat_modif_parametre_ne_recalcule_pas_les_collectes_existantes
  Étant donné 3 collectes 'a_attribuer' avec suggestion 'ag_velo_programme' (450 pax)
  Quand Admin Plateforme passe regle_ag_seuil_pax_velo de 600 à 400
  Alors les 3 collectes conservent leur suggestion et leur suggestion_calculee_at inchangés
  Et une NOUVELLE collecte 450 pax insérée après la modif reçoit 'ag_marathon_volume' (paramètre effectif < 30s, T1 seulement)
```

```gherkin
# Source : §04 TMS — contrainte immutabilité shared.prestataires.code (Q1 2026-04-24)
# Couche : db
# Priorité : P1-critique
Scénario : etat_code_prestataire_immuable_post_creation
  Étant donné le prestataire strike
  Quand un admin tente UPDATE shared.prestataires SET code='strike2'
  Alors le trigger BEFORE UPDATE lève RAISE EXCEPTION 'shared.prestataires.code immuable…'
  Et resolve_prestataire_by_code('strike') reste fonctionnel
```

```gherkin
# Source : §04 TMS §4 nb_collectes_6_mois_cache — conditionné F6 (logique incrément)
# Couche : db
# Priorité : P1-critique
Scénario : idempotence_nb_collectes_cache_pas_de_double_comptage
  Étant donné presta_lyon_b avec nb_collectes_6_mois_cache=3
  Quand une de ses collectes transite attribuee_en_attente_acceptation → acceptee → en_attente_execution
  Alors le cache vaut 4 (incrément UNIQUE sur transition ENTRANTE dans le pipeline, pas +1 par transition interne — F6 tranché 2026-06-07, propagé §04 + M12 §4.4)
```

```gherkin
# Source : §06/M12 W3 étape 4 — UPDATE uniquement si branche différente
# Couche : db
# Priorité : P2-important
Scénario : etat_double_execution_t3_meme_modif_stable
  Étant donné une collecte ayant déjà basculé via T3 vers 'ag_marathon_volume'
  Quand le trigger T3 se redéclenche sur un UPDATE sans changement de nb_pax ni heure_collecte (autre colonne modifiée)
  Alors aucun recalcul n'est lancé (condition OLD/NEW du trigger) et aucune ligne log supplémentaire n'est créée
```

---

## Catégorie 6 — Scénarios cross-app

> M12 n'expose aucun endpoint E/S. Les contrats (HMAC, X-API-Version, dédup `body.event_id`, retry) sont testés dans M01 (E1), M03 (refus), M14 (Everest). On ne teste ici que les effets de bord contractuels de M12.

```gherkin
# Source : §06/M12 W1 + M01 E1 — enchaînement ingestion → suggestion
# Couche : api + db
# Priorité : P1-critique
Scénario : cross_e1_ingestion_produit_suggestion_avant_affichage_dispatch
  Étant donné un webhook E1 'collecte-creee' valide (HMAC OK, version OK) pour une collecte AG 450 pax IDF
  Quand M01 insère la ligne collectes_tms
  Alors dans la même transaction (ou < 500 ms end-to-end), suggestion_prestataire_id et suggestion_branche_r1_code sont renseignés
  Et la collecte apparaît dans M02 E1 avec badge suggestion (pas d'état intermédiaire "sans suggestion" persistant)
```

```gherkin
# Source : §06/M12 §4.1 + B_M14_02 — single source of truth M14 W1
# Couche : db
# Priorité : P1-critique
Scénario : cross_everest_service_id_target_consomme_par_m14
  Étant donné une collecte suggérée 'ag_velo_express' (everest_service_id_target=75) validée par Ops vers A Toutes!
  Quand M14 W1 étape 2 construit la commande Everest
  Alors le service utilisé est 75 lu depuis everest_service_id_target (aucun re-calcul de fenêtre last-minute dans M14)
```

---

## Catégorie 7 — Scénarios de migration

> **F5 tranché Val 2026-06-07** : trigger T1 = `WHEN (NEW.statut_dispatch = 'a_attribuer' AND NEW.origine <> 'migration')`. Dataset `seed_demo`, env dev uniquement.

```gherkin
# Source : §06/M12 W1 + 04-Migration — conditionné F5
# Couche : db
# Priorité : P1-critique
Scénario : migration_insert_collecte_historique_ne_declenche_pas_t1
  Étant donné le script d'import MTS-1 insérant 100 collectes historiques (origine='migration', statuts terminaux)
  Quand l'import s'exécute
  Alors aucune ligne suggestions_attribution_log n'est créée pour ces collectes
  Et aucune alerte m12_aucun_prestataire critical n'est émise
  Et les colonnes suggestion_* restent NULL
```

```gherkin
# Source : 04-Migration checks réconciliation
# Couche : db
# Priorité : P2-important
Scénario : migration_rerun_import_idempotent_cote_m12
  Étant donné l'import déjà exécuté une fois
  Quand le script est relancé (idempotence migration)
  Alors le compte de lignes suggestions_attribution_log est inchangé (0 pour le périmètre migré)
  Et aucun doublon d'alerte n'apparaît
```

---

## Specs floues — TRANCHÉES 2026-06-07 et PROPAGÉES (M12 + §04 + §05 + §09)

### F1 — BLOQUANT tranché (reco appliquée) : enum `suggestion_branche_r1_code` unifié à 9 valeurs

L'enum canonique TMS listait 8 valeurs dont `ag_camion_backup`, mais le pseudo-code M12 §4.6 et §05 R1.2 branche 2 retournaient `ag_marathon_volume_backup_camion`, et `ag_velo_fallback_marathon` (audit A3 2026-05-09) manquait à l'enum.
**Tranché (révisé même jour après check cross-CDC)** : enum = 9 valeurs, **`ag_marathon_volume_backup_camion` canonique** — c'est la valeur de l'enum App `branche_attribution` (§04 L1493 + §06.09 + §08 mapping Everest, audit A3) **stockée en base dès la V1** : la garder évite 3 divergences cross-CDC + un mapping de migration V2. L'ex-`ag_camion_backup` des 3 listes TMS était la divergence, retiré. `ag_velo_fallback_marathon` ajouté. Propagé M12 §4.1/§4.6 + §05 L24/R1.2 + §04 L1193.

### F2 — BLOQUANT TRANCHÉ Val : `regle_zd_prestataire_prioritaire_code` créé côté TMS

Le paramètre était lu par R1.1 + pseudo-code sans exister au data model.
**Tranché Val** : seed `parametres_tms.attribution.regle_zd_prestataire_prioritaire_code='strike'`, string simple V1, `modifiable_par=['admin_tms']` (cohérent D11 — la mention "éditable Ops Savr" de R1.1 corrigée). Propagé §04 §5 + §05 R1.1 + M12 §4.5.

### F3 — Dette doc Everest A4 PURGÉE 2026-06-07

Résidus pré-A4 2026-05-09 soldés : M12 (§3 dépendance API, §4.9 bloc cache + KPI appels, EC 7.2/7.3/7.4, §10 lignes cache/<800ms, §12ter `m14_everest_timeout`, D7/D9, §13 lien, W1 durée cible) ; §04 TMS (§1 → 4 colonnes, `refusee_par_prestataire_id`+GIN+`cascade_depth` barrés, §2 colonnes `everest_is_handled_address_*` barrées, §3 table `everest_coverage_cache` barrée) ; §09 §17ter caduc.

### F4 — TRANCHÉ Val : critical uniforme

Toute branche `aucun_prestataire` → `m12_aucun_prestataire` **critical**, raison dans le payload. EC 7.8 corrigé warning→critical. Alerte dédiée "presta sans grille" (EC 7.5/§4.8) supprimée — aligné §12ter (cas impossible par construction R_M06), trace `integrations_logs` warning seule. Propagé M12 §4.8/7.5/7.8.

### F5 — TRANCHÉ Val : trigger T1 conditionné

`WHEN (NEW.statut_dispatch = 'a_attribuer' AND NEW.origine <> 'migration')` — exclut migration MTS-1 et collectes hors dispatch. Propagé M12 W1 + §04 §1.

### F6 — Tranché (reco appliquée) : `nb_collectes_6_mois_cache`

Incrément uniquement sur transition ENTRANTE dans le pipeline (pas de double comptage). Purge = recalcul complet quotidien idempotent par cron. Propagé M12 §4.4 + §04 §4.

### F7 — TRANCHÉ Val : garde explicite ZD province

ZD non-IDF → `aucun_prestataire` reason `zd_province_non_supporte_v1` + alerte critical (pas de suggestion Strike fausse). Propagé M12 §4.6 + §05 R1.1. Scénario `erreur_zd_province_aucun_prestataire` ajouté.

### F8 — Recos notées (NON propagées au CDC — à confirmer)

(a) Canal lecture `plateforme.parametres_algo` depuis TMS toujours "à figer §08 V2". **Reco** : SELECT cross-schema direct (schémas co-localisés même instance Supabase, zéro problème de fraîcheur, abandonner le webhook sync). À figer avant dev M12 — `tms.m12_suggest` doit savoir où lire.
(b) Masquage des colonnes `suggestion_*` + `everest_service_id_target` pour `manager_prestataire` non explicité §09. **Reco** : vue whitelist M03 les exclut (pattern M07). Scénario `rls_colonnes_suggestion_invisibles_portail_prestataire` en P2 en attendant.

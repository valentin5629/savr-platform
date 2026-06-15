# Rapport export dev-facing

Mode : AGGRESSIVE (T1+T2)
**Total : 931799 -> 864280 octets (-67519, -7.2%)**


## 00 - Index.md
- octets : 17370 -> 9786 (-7584, -43.7%)
- tokens estimes : ~4342 -> ~2446
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## M01 - Réception ordres de collecte.md
- octets : 49122 -> 46097 (-3025, -6.2%)
- tokens estimes : ~12280 -> ~11524
- tombstones supprimes : 6 | fragments barres retires : 15 | en-tetes debarres : 2
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L417: **Propagation à §05 R6.1** : `annulee_pendant_en_cours=true` compatible avec `statut_opera
    L533: - → **Résolu** : documentation `annulee_pendant_en_cours` + suppression branche pré-affect
    L534: - → **Résolu (F1)** : V1 email uniquement (Val + frère). Slack V1.1+ si volume suffisant. 
    L535: - → **Caduc sobriété A_M01_03** (2026-04-30) : action « Escalader Dev » DLQ supprimée.
    L536: - → **Caduc revue sobriété M01 2026-06-04 (A1)** : table supprimée avec le polling (Bloc A

## M02 - Dispatch Ops Savr.md
- octets : 45341 -> 44433 (-908, -2.0%)
- tokens estimes : ~11335 -> ~11108
- tombstones supprimes : 0 | fragments barres retires : 12 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L525: 4. — **Reporté V1.1** post-mesure exploitation 2 mois.
    L530: 9. — **Reporté V1.1**.

## M03 - Portail prestataire self-service.md
- octets : 69418 -> 64734 (-4684, -6.7%)
- tokens estimes : ~17354 -> ~16183
- tombstones supprimes : 5 | fragments barres retires : 11 | en-tetes debarres : 1
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L693: - **Retiré V1 (propagation M08 D5 pas de paliers)**

## M04 - Gestion des tournées.md
- octets : 78932 -> 71506 (-7426, -9.4%)
- tokens estimes : ~19733 -> ~17876
- tombstones supprimes : 5 | fragments barres retires : 36 | en-tetes debarres : 5
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L43: - (retiré data model)
    L44: - (retiré, M03 E4 Section 3 véhicule désormais toujours optionnel)
    L85: - **Retiré V1 (propagation suppression saisie plaque terrain 2026-06-04)** — plus de plaqu
    L113: - **Retiré V1 (propagation suppression saisie plaque terrain 2026-06-04)** — plus de saisi
    L207: - **Supprimé V1 (revue sobriété 2026-04-29)** — champ libre optionnel sans valeur métier. 
    L314: - **Retiré V1 (propagation suppression saisie plaque terrain 2026-06-04)** — plus de plaqu
    L359: - **Retiré V1 (propagation suppression saisie plaque terrain 2026-06-04)**
    L651: - **Retiré V1 (propagation 2026-06-04)**
    L652: - **Retiré V1 (propagation 2026-06-04)**
    L677: : sans objet — l'email T+3h a été retiré V1 (Q10 2026-04-24) et la plaque pour contrôle d'
    L770: 7. **Supprimée V1 (revue sobriété 2026-04-29)** — champ Nom retiré, T# suffit. Question fe
    L782: 1. **Obsolète V1** — l'email plaque T+3h est retiré (Q10 2026-04-24). Plus de template à g
    L824: - [[08 - Contrat API Plateforme-TMS]] — S3, S7 (pesées via S5 `collecte-terminee` batch ém

## M05 - App mobile chauffeur.md
- octets : 92288 -> 85385 (-6903, -7.5%)
- tokens estimes : ~23072 -> ~21346
- tombstones supprimes : 6 | fragments barres retires : 20 | en-tetes debarres : 4
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L256: - Plus de checklist (l'unique item « Plaque » est retiré) : E2 → E4 direct (skip E3), comm
    L265: - **Retiré V1 (propagation M05 2026-06-04)**
    L266: - **Retiré V1 (propagation M05 2026-06-04 — plus de plaque terrain à comparer)**
    L823: - → **supprimée propagation M05 2026-06-04** (plus de saisie plaque chauffeur)
    L829: - → **supprimée revue sobriété §05 2026-05-01 A3** (code jamais seedé au catalogue M11, R_
    L830: - → **supprimée propagation M05 2026-06-04** (plus de saisie plaque chauffeur)
    L873: Plus de saisie plaque par le chauffeur. La plaque pour contrôle d'accès / registre est la 
    L964: Évolution V1.1 : (supprimée — cf. E6 2026-04-30), `m05_push_rappel_j_moins_1_active` (si r
    L1074: - Enrichir table `tournees` : **supprimée (propagation M05 2026-06-04)**, `cloture_gps`, `

## M06 - Référentiel prestataires.md
- octets : 53827 -> 50942 (-2885, -5.4%)
- tokens estimes : ~13456 -> ~12735
- tombstones supprimes : 2 | fragments barres retires : 19 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L102: - — **Retiré V1 (revue sobriété A5 2026-04-30)** : colonne icône dans le tableau suffit.
    L135: - — **Retiré V1 (revue sobriété M06 2026-06-05 A1)** : strictement équivalent à `+ Nouveau
    L136: - Menu kebab : `Voir audit log` (**Retiré V1 — revue sobriété A2 2026-04-30**)
    L212: - — **Retiré V1 (revue sobriété A3 2026-04-30)** : aucun comportement applicatif. Si besoi
    L256: - — **Retiré V1 (revue sobriété 2026-04-30)**. Si un véhicule a un tarif distinct, créer u
    L280: - — **Retiré V1 (revue sobriété A4 2026-04-30)** : aucun comportement applicatif, surface 
    L469: 2. Section Identité : nom, prénom, téléphone, peut_conduire (default on) (**Retiré V1**)
    L480: - INSERT `users_tms` avec `roles=['chauffeur']` + `prestataire_id` + `chauffeur_id` ( supp
    L774: 7. — **Fermé (revue sobriété A2 2026-04-30)** : supprimé V1, export SQL Admin si besoin po

## M07 - Pilotage financier logistique.md
- octets : 60351 -> 55265 (-5086, -8.4%)
- tokens estimes : ~15087 -> ~13816
- tombstones supprimes : 15 | fragments barres retires : 23 | en-tetes debarres : 2
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L129: - **Retiré V1** : (décision D 2026-04-24, reporté V2)
    L137: ** — supprimé (sobriété A5 2026-04-30)**
    L176: - → **Supprimé revue sobriété §05 2026-05-01 D2** (cas impossible par construction grâce à
    L511: - Modification rétroactive de grille interdite. → **Supprimée revue sobriété §05 2026-05-0
    L559: - — workflow validation supprimé, fusionnés en `ajuste` (A3)
    L639: 3. — **Tranchée sobriété B3 2026-04-30** : alerte supprimée V1. Détection via dashboard / 
    L663: - → **N/A revue sobriété §05 2026-05-01 D2** (code supprimé V1)
    L664: - → **N/A revue sobriété 2026-05-01 A2 / propagation 2026-06-04** (code supprimé, S6 rempl

## M08 - Facturation prestataires.md
- octets : 87817 -> 82358 (-5459, -6.2%)
- tokens estimes : ~21954 -> ~20589
- tombstones supprimes : 19 | fragments barres retires : 29 | en-tetes debarres : 6
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L103: - **Supprimé revue sobriété §05 2026-05-01 A1** — supervision via widget E0 "Factures atte
    L104: - **Supprimé revue sobriété 2026-04-30 A2** — export à la demande via E5/E1.
    L182: - **Supprimé revue sobriété 2026-04-30 A3** — validation unitaire suffit pour ~5-10 factur
    L204: - → **supprimée V1** (validation auto match exact, plus d'étape Ops requise)
    L278: - **Supprimé revue sobriété 2026-04-30 A6** — pas de brouillon V1, upload en une session. 
    L320: - **Supprimé V1 A1** — V1 = CSV uniquement.
    L366: - **Supprimé V1 B3** — V1 = virement par défaut (99% cas), modalité atypique tracée dans `
    L504: > déjà supprimée revue sobriété 2026-04-30 A3 (validation unitaire seule).
    L718: **Statuts terminaux** : `regle`, `remplacee_par_avoir`. ( supprimé — fusionné dans `contes
    L1096: - → **supprimée revue sobriété 2026-04-30 B2**, vue SQL `v_m08_exports_pennylane` sur `tms
    L1100: - **Caduc revue sobriété M08 2026-06-05 D4** — paramètre supprimé depuis (revue sobriété §
    L1111: - **Caduc revue sobriété M08 2026-06-05 D5** — plus de lignes, plus de check SUM (table su
    L1120: - **Supprimée revue sobriété 2026-04-30 B2** — table dédiée supprimée, RLS audit_logs stan
    L1159: - → code **supprimé revue sobriété §05 2026-05-01 A1**
    L1164: - → **N/A revue sobriété §05 2026-05-01 A1** (code supprimé)

## M09 - Stock matériel Savr.md
- octets : 44896 -> 43612 (-1284, -2.9%)
- tokens estimes : ~11224 -> ~10903
- tombstones supprimes : 1 | fragments barres retires : 15 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L92: - **Supprimé revue sobriété 2026-05-01 A3** — remplacé par vue cross-schema `plateforme.v_
    L176: - — **Supprimé sobriété 2026-04-30 A_M09_05** : duplique le tri par défaut tableau Section
    L177: - — **Supprimé sobriété 2026-04-30 A_M09_02** : vanity metric sans action déclenchée. Audi
    L178: - — **Supprimé sobriété 2026-04-30 A_M09_03** : vanity metric. Analyse qualité via consult
    L226: - — **Supprimé sobriété 2026-04-30 A_M09_04** : recompte = ~1×/sem ad-hoc sur retour terra
    L477: - [[../../01 - Cahier des charges App/08 - APIs et intégrations|§08 Plateforme]] — **suppr

## M10 - Gestion exutoires Veolia.md
- octets : 48511 -> 47780 (-731, -1.5%)
- tokens estimes : ~12127 -> ~11945
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## M11 - Alerting transverse.md
- octets : 85875 -> 76662 (-9213, -10.7%)
- tokens estimes : ~21468 -> ~19165
- tombstones supprimes : 22 | fragments barres retires : 24 | en-tetes debarres : 7
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L98: - A5 bouton `Tester` retiré (RPC `m11_emit_test` + cron + rate limit dégagés V1, cf. )
    L292: - → **Code supprimé revue sobriété §05 2026-05-01 A1** (W11 cron supprimé V1, supervision 
    L293: - → **N/A revue sobriété §05 2026-05-01 D2** (code supprimé V1, cas impossible par constru
    L353: **Bloc 6 sobriété 2026-04-28 C2** : supprimée. Le front lit directement `tms.alertes` via 
    L807: - — **supprimée Bloc 6 sobriété 2026-04-28 C1** → `tms.audit_logs`.
    L808: - — **supprimée Bloc 6 sobriété 2026-04-28 C2** → lecture directe `tms.alertes` RLS.
    L853: - — **supprimées Bloc 6 sobriété 2026-04-28 C1** (table supprimée)
    L854: - — **supprimées Bloc 6 sobriété 2026-04-28 C3** (table supprimée)
    L855: - — **supprimées Bloc 6 sobriété 2026-04-28 C2** (table supprimée)
    L867: - — **retiré Bloc 6 C1** (table supprimée)
    L879: - → **Caduc revue sobriété §05 2026-05-01 D2** (EC1 refondu en exception SQL bloquante, co
    L881: - **Caduc (propagation suppression saisie plaque terrain 2026-06-04)** — D4 caduque, alert

## M12 - Attribution transporteur.md
- octets : 52715 -> 50344 (-2371, -4.5%)
- tokens estimes : ~13178 -> ~12586
- tombstones supprimes : 3 | fragments barres retires : 27 | en-tetes debarres : 6
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L359: Pas d'interaction V1 ( supprimé A4 2026-05-09, purge F3 2026-06-07). Modification paramètr
    L604: | D4 | → **Supprimé revue sobriété 2026-04-29** | Table `refus_history` normalisée | Auto-
    L605: | D5 | → **Supprimé revue sobriété 2026-04-29** | Obligatoire | Audit override entièrement
    L606: | D6 | → **Supprimé revue sobriété 2026-04-29** | 1 cascade / 3 cascades | Auto-relance W3
    L612: | D12 | → **Supprimé revue sobriété 2026-04-29** | Log minimal | Auto-relance W3 supprimée
    L616: | D16 | → **Supprimé revue sobriété 2026-04-29** | Synchrone bloquant UI | T5 bulk re-comp
    L626: 3. — **TRANCHÉ 2026-04-24 : SUPPRIMÉ V1**. Pas d'alerte automatique sur seuils de qualité.
    L629: 6. — **CADUC (revue sobriété 2026-04-29)**. Colonne supprimée, plus d'historique runtime à
    L630: 7. — **CADUC (revue sobriété 2026-04-29)**. T5 supprimé.
    L632: 9. — **CADUC (revue sobriété 2026-04-29)**. T5 supprimé.

## M13 - Administration TMS.md
- octets : 81866 -> 74230 (-7636, -9.3%)
- tokens estimes : ~20466 -> ~18557
- tombstones supprimes : 7 | fragments barres retires : 51 | en-tetes debarres : 4
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L664: → **Supprimé revue sobriété §05 2026-05-01 D2** (cas impossible par construction)
    L881: - → **Supprimé revue sobriété §05 2026-05-01 C2** — fusionné dans `parametres_tms.auth.ses
    L882: - → **Renommé `auth.session_glissante` revue sobriété §05 2026-05-01 C2** (boolean global 
    L888: - : retiré — W11 dégagée A1 2026-04-30
    L901: **Solde paramètres `m13_*` seedés** : **1** (device_trusted_max_per_user) vs 17 initiaux. 
    L1008: Pas de modification structure. (Table override retirée Bloc 6 C3 — criticité figée seed da
    L1043: | §04 niveau 5 nouvelles tables | INSÉRER specs `users_tms_devices_trusted`, (retirée Bloc
    L1045: | §04 niveau 5 `audit_logs` | Mention explicite : tables `users_tms_devices_trusted`, (ret
    L1078: - **3** tables nouvelles à créer (`alertes_codes_overrides` retirée Bloc 6 C3)
    L1080: - **11** Edge Functions à dev par Claude Code (`upsert_alerte_code_override` retirée ; cor

## M14 - Intégration Everest.md
- octets : 63470 -> 61146 (-2324, -3.7%)
- tokens estimes : ~15867 -> ~15286
- tombstones supprimes : 4 | fragments barres retires : 4 | en-tetes debarres : 4
- lignes historiques T2 supprimees : 3
- ⚠ tombstones en prose a revoir a la main :
    L253: - p50/p95/p99 calls outbound 7j (par endpoint : create, cancel, get, is-handled-address). 

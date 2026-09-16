# Rapport export dev-facing

Mode : AGGRESSIVE (T1+T2)
**Total : 2506460 -> 2308207 octets (-198253, -7.9%)**


## 00 - Index.md
- octets : 163710 -> 73023 (-90687, -55.4%)
- tokens estimes : ~40927 -> ~18255
- tombstones supprimes : 0 | fragments barres retires : 36 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L109: - Catalogue R_M03.X final : R_M03.1 → R_M03.12 (10 actives + 1 supprimée + 1 ré-introduite

## 01 - Vision et objectifs TMS.md
- octets : 52764 -> 52487 (-277, -0.5%)
- tokens estimes : ~13191 -> ~13121
- tombstones supprimes : 0 | fragments barres retires : 3 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L127: | **Retiré V1 (Q10 2026-04-24)** | | | Email plaque supprimé ; plaque de contrôle d'accès 

## 03 - Périmètre fonctionnel TMS.md
- octets : 73318 -> 71826 (-1492, -2.0%)
- tokens estimes : ~18329 -> ~17956
- tombstones supprimes : 5 | fragments barres retires : 10 | en-tetes debarres : 2
- lignes historiques T2 supprimees : 3
- ⚠ tombstones en prose a revoir a la main :
    L510: - **Retiré V1** (D9, reporté V1.1)
    L548: 4. → **étape supprimée V1** (validation auto match exact)
    L606: - **Supprimé revue sobriété §08 Bloc A 2026-05-01 A3** — remplacé par lecture cross-schema
    L1007: 8. — **Résolu revue sobriété 2026-04-25 (A6)** : Slack dégagé V1 entièrement (infra dorman

## 04 - Data Model TMS.md
- octets : 302769 -> 283595 (-19174, -6.3%)
- tokens estimes : ~75692 -> ~70898
- tombstones supprimes : 52 | fragments barres retires : 70 | en-tetes debarres : 7
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L336: - → retiré (W11 dégagée A1 2026-04-30)
    L353: - — **supprimée Bloc 6 sobriété 2026-04-28 C3**
    L427: **Retiré V1 (revue sobriété §04 2026-04-30 A6)** — colonne supprimée. Lookup via `everest_
    L778: - → **Supprimé revue sobriété §05 2026-05-01 D2** (valeur enum supprimée, cas impossible p
    L802: | `action` | text | NOT NULL | Enum simplifié (sobriété A3 2026-04-30) : `ajustement_cree`
    L1224: - **Supprimé (revue sobriété 2026-04-29, purge F3 2026-06-07)**
    L1698: **Colonnes addendum supprimées** (2026-04-28 — fusion mapping) : , , , .
    L1862: - **Retiré V1 (revue sobriété §04 2026-04-30 A3)** — info dérivée de `integrations_logs` v
    L1962: **Index** : `(prestataire_id) WHERE deleted_at IS NULL`, `(telephone)`, `(user_tms_id)` UN
    L2055: **Index** : `(prestataire_id) WHERE deleted_at IS NULL`, `(plaque_canonique)` UNIQUE WHERE
    L3031: - supprimée 2026-06-07 — jamais en vigueur, remplacée par le mapping départemental ci-dess
    L3049: - **Paramètre retiré V1 (propagation suppression saisie plaque terrain 2026-06-04)** — plu

## 05 - Règles métier TMS.md
- octets : 126152 -> 120942 (-5210, -4.1%)
- tokens estimes : ~31538 -> ~30235
- tombstones supprimes : 3 | fragments barres retires : 34 | en-tetes debarres : 10
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L250: **Retiré V1 (propagation M07 2026-04-24 D5)**.
    L1284: - (statut `ackee` retiré Bloc 6 B2)

## 07 - Architecture technique TMS.md
- octets : 36620 -> 35029 (-1591, -4.3%)
- tokens estimes : ~9155 -> ~8757
- tombstones supprimes : 3 | fragments barres retires : 1 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 08 - Contrat API Plateforme-TMS.md
- octets : 106862 -> 101401 (-5461, -5.1%)
- tokens estimes : ~26715 -> ~25350
- tombstones supprimes : 5 | fragments barres retires : 29 | en-tetes debarres : 6
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L211: - **Champ payload supprimé revue sobriété Bloc B 2026-05-01 B3** — header HTTP `X-API-Vers
    L235: - **Supprimé revue sobriété Bloc B 2026-05-01 B3** — la "double ceinture" était un artefac
    L977: | `statut` | enum **3 valeurs** (post-revue sobriété §08 Bloc D 2026-05-01 D6) : `traite` 
    L1086: 3. **Résolu revue sobriété 2026-05-01 A4** — endpoints `/sync/poll` supprimés des deux côt
    L1094: - supprimés revue sobriété 2026-05-01 A4

## 09 - Authentification et permissions TMS.md
- octets : 119179 -> 115858 (-3321, -2.8%)
- tokens estimes : ~29794 -> ~28964
- tombstones supprimes : 0 | fragments barres retires : 33 | en-tetes debarres : 3
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L192: 5. — retiré Bloc 6 C3 (table supprimée)
    L193: 6. — retiré Bloc 6 C3 (table supprimée)
    L436: -- retirées V1 (revue sobriété §04 2026-04-30 A3 — vue dérivée tms.vue_prestataires_everes
    L1269: -- — SUPPRIMÉE (sobriété A3 2026-04-30)
    L1270: -- — SUPPRIMÉ (sobriété A3 2026-04-30)
    L1321: - **Supprimée revue sobriété 2026-04-30 B2** — trace via `tms.audit_logs` action `M08_EXPO
    L1322: - **Table supprimée V1 (revue sobriété §04 2026-04-30 A5)** — audit visuel via `factures_p
    L1385: -- revue sobriété §04 2026-04-30 A5 — table supprimée V1.
    L1389: -- revue sobriété 2026-04-30 B2 — table dédiée supprimée.
    L1402: - **Test retiré revue sobriété 2026-04-30 B2** — tracé via `tms.audit_logs` (tests audit_l
    L1703: - — retiré Bloc 6 C1 (table fusionnée dans tms.audit_logs)
    L1914: - — **Retiré V1 (Bloc 3 2026-06-04)** : sans objet (plus de révocation in-app).

## 10 - Design System TMS.md
- octets : 15907 -> 15871 (-36, -0.2%)
- tokens estimes : ~3976 -> ~3967
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## 11 - Dashboards TMS.md
- octets : 28127 -> 27903 (-224, -0.8%)
- tokens estimes : ~7031 -> ~6975
- tombstones supprimes : 0 | fragments barres retires : 3 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L131: **Détection cumul** : **Supprimé revue sobriété §08 A1 2026-05-01** — confort UX pur (≤4 u

## 12 - App mobile chauffeur.md
- octets : 20634 -> 20312 (-322, -1.6%)
- tokens estimes : ~5158 -> ~5078
- tombstones supprimes : 0 | fragments barres retires : 4 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L222: | — **supprimé revue sobriété 2026-04-30 A1** (déclaration `realise` Ops vaut désormais co

## 13 - Migration MTS-1.md
- octets : 38731 -> 38731 (-0, -0.0%)
- tokens estimes : ~9682 -> ~9682
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## 14 - Scalabilité TMS.md
- octets : 10170 -> 10170 (-0, -0.0%)
- tokens estimes : ~2542 -> ~2542
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## 15 - Sécurité et conformité TMS.md
- octets : 42978 -> 42272 (-706, -1.6%)
- tokens estimes : ~10744 -> ~10568
- tombstones supprimes : 1 | fragments barres retires : 8 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0
- ⚠ tombstones en prose a revoir a la main :
    L171: - `test_m11_alertes_no_direct_insert`, (retiré Bloc 6 C1 — table fusionnée tms.audit_logs)

## 06 - Fonctionnalités détaillées TMS/00 - Index.md
- octets : 17370 -> 9786 (-7584, -43.7%)
- tokens estimes : ~4342 -> ~2446
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## 06 - Fonctionnalités détaillées TMS/M01 - Réception ordres de collecte.md
- octets : 49699 -> 46674 (-3025, -6.1%)
- tokens estimes : ~12424 -> ~11668
- tombstones supprimes : 6 | fragments barres retires : 15 | en-tetes debarres : 2
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L418: **Propagation à §05 R6.1** : `annulee_pendant_en_cours=true` compatible avec `statut_opera
    L534: - → **Résolu** : documentation `annulee_pendant_en_cours` + suppression branche pré-affect
    L535: - → **Résolu (F1)** : V1 email uniquement (Val + frère). Slack V1.1+ si volume suffisant. 
    L536: - → **Caduc sobriété A_M01_03** (2026-04-30) : action « Escalader Dev » DLQ supprimée.
    L537: - → **Caduc revue sobriété M01 2026-06-04 (A1)** : table supprimée avec le polling (Bloc A

## 06 - Fonctionnalités détaillées TMS/M02 - Dispatch Ops Savr.md
- octets : 45341 -> 44433 (-908, -2.0%)
- tokens estimes : ~11335 -> ~11108
- tombstones supprimes : 0 | fragments barres retires : 12 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L525: 4. — **Reporté V1.1** post-mesure exploitation 2 mois.
    L530: 9. — **Reporté V1.1**.

## 06 - Fonctionnalités détaillées TMS/M03 - Portail prestataire self-service.md
- octets : 69704 -> 65020 (-4684, -6.7%)
- tokens estimes : ~17426 -> ~16255
- tombstones supprimes : 5 | fragments barres retires : 11 | en-tetes debarres : 1
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L693: - **Retiré V1 (propagation M08 D5 pas de paliers)**

## 06 - Fonctionnalités détaillées TMS/M04 - Gestion des tournées.md
- octets : 84990 -> 76919 (-8071, -9.5%)
- tokens estimes : ~21247 -> ~19229
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
    L655: - **Retiré V1 (propagation 2026-06-04)**
    L656: - **Retiré V1 (propagation 2026-06-04)**
    L681: : sans objet — l'email T+3h a été retiré V1 (Q10 2026-04-24) et la plaque pour contrôle d'
    L774: 7. **Supprimée V1 (revue sobriété 2026-04-29)** — champ Nom retiré, T# suffit. Question fe
    L786: 1. **Obsolète V1** — l'email plaque T+3h est retiré (Q10 2026-04-24). Plus de template à g
    L829: - [[08 - Contrat API Plateforme-TMS]] — S3, S7 (pesées via S5 `collecte-terminee` batch ém

## 06 - Fonctionnalités détaillées TMS/M05 - App mobile chauffeur.md
- octets : 97424 -> 89813 (-7611, -7.8%)
- tokens estimes : ~24356 -> ~22453
- tombstones supprimes : 6 | fragments barres retires : 20 | en-tetes debarres : 4
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L256: - Plus de checklist (l'unique item « Plaque » est retiré) : E2 → E4 direct (skip E3), comm
    L265: - **Retiré V1 (propagation M05 2026-06-04)**
    L266: - **Retiré V1 (propagation M05 2026-06-04 — plus de plaque terrain à comparer)**
    L829: - → **supprimée propagation M05 2026-06-04** (plus de saisie plaque chauffeur)
    L835: - → **supprimée revue sobriété §05 2026-05-01 A3** (code jamais seedé au catalogue M11, R_
    L836: - → **supprimée propagation M05 2026-06-04** (plus de saisie plaque chauffeur)
    L879: Plus de saisie plaque par le chauffeur. La plaque pour contrôle d'accès / registre est la 
    L971: Évolution V1.1 : (supprimée — cf. E6 2026-04-30), `m05_push_rappel_j_moins_1_active` (si r
    L1081: - Enrichir table `tournees` : **supprimée (propagation M05 2026-06-04)**, `cloture_gps`, `

## 06 - Fonctionnalités détaillées TMS/M06 - Référentiel prestataires.md
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

## 06 - Fonctionnalités détaillées TMS/M07 - Pilotage financier logistique.md
- octets : 61033 -> 55947 (-5086, -8.3%)
- tokens estimes : ~15258 -> ~13986
- tombstones supprimes : 15 | fragments barres retires : 23 | en-tetes debarres : 2
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L129: - **Retiré V1** : (décision D 2026-04-24, reporté V2)
    L137: ** — supprimé (sobriété A5 2026-04-30)**
    L176: - → **Supprimé revue sobriété §05 2026-05-01 D2** (cas impossible par construction grâce à
    L512: - Modification rétroactive de grille interdite. → **Supprimée revue sobriété §05 2026-05-0
    L560: - — workflow validation supprimé, fusionnés en `ajuste` (A3)
    L640: 3. — **Tranchée sobriété B3 2026-04-30** : alerte supprimée V1. Détection via dashboard / 
    L664: - → **N/A revue sobriété §05 2026-05-01 D2** (code supprimé V1)
    L665: - → **N/A revue sobriété 2026-05-01 A2 / propagation 2026-06-04** (code supprimé, S6 rempl

## 06 - Fonctionnalités détaillées TMS/M08 - Facturation prestataires.md
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

## 06 - Fonctionnalités détaillées TMS/M09 - Stock matériel Savr.md
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

## 06 - Fonctionnalités détaillées TMS/M10 - Gestion exutoires Veolia.md
- octets : 48511 -> 47780 (-731, -1.5%)
- tokens estimes : ~12127 -> ~11945
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## 06 - Fonctionnalités détaillées TMS/M11 - Alerting transverse.md
- octets : 86264 -> 77051 (-9213, -10.7%)
- tokens estimes : ~21566 -> ~19262
- tombstones supprimes : 22 | fragments barres retires : 24 | en-tetes debarres : 7
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L98: - A5 bouton `Tester` retiré (RPC `m11_emit_test` + cron + rate limit dégagés V1, cf. )
    L292: - → **Code supprimé revue sobriété §05 2026-05-01 A1** (W11 cron supprimé V1, supervision 
    L293: - → **N/A revue sobriété §05 2026-05-01 D2** (code supprimé V1, cas impossible par constru
    L353: **Bloc 6 sobriété 2026-04-28 C2** : supprimée. Le front lit directement `tms.alertes` via 
    L808: - — **supprimée Bloc 6 sobriété 2026-04-28 C1** → `tms.audit_logs`.
    L809: - — **supprimée Bloc 6 sobriété 2026-04-28 C2** → lecture directe `tms.alertes` RLS.
    L854: - — **supprimées Bloc 6 sobriété 2026-04-28 C1** (table supprimée)
    L855: - — **supprimées Bloc 6 sobriété 2026-04-28 C3** (table supprimée)
    L856: - — **supprimées Bloc 6 sobriété 2026-04-28 C2** (table supprimée)
    L868: - — **retiré Bloc 6 C1** (table supprimée)
    L880: - → **Caduc revue sobriété §05 2026-05-01 D2** (EC1 refondu en exception SQL bloquante, co
    L882: - **Caduc (propagation suppression saisie plaque terrain 2026-06-04)** — D4 caduque, alert

## 06 - Fonctionnalités détaillées TMS/M12 - Attribution transporteur.md
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

## 06 - Fonctionnalités détaillées TMS/M13 - Administration TMS.md
- octets : 82976 -> 75340 (-7636, -9.2%)
- tokens estimes : ~20744 -> ~18835
- tombstones supprimes : 7 | fragments barres retires : 51 | en-tetes debarres : 4
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
    L665: → **Supprimé revue sobriété §05 2026-05-01 D2** (cas impossible par construction)
    L882: - → **Supprimé revue sobriété §05 2026-05-01 C2** — fusionné dans `parametres_tms.auth.ses
    L883: - → **Renommé `auth.session_glissante` revue sobriété §05 2026-05-01 C2** (boolean global 
    L889: - : retiré — W11 dégagée A1 2026-04-30
    L902: **Solde paramètres `m13_*` seedés** : **1** (device_trusted_max_per_user) vs 17 initiaux. 
    L1009: Pas de modification structure. (Table override retirée Bloc 6 C3 — criticité figée seed da
    L1044: | §04 niveau 5 nouvelles tables | INSÉRER specs `users_tms_devices_trusted`, (retirée Bloc
    L1046: | §04 niveau 5 `audit_logs` | Mention explicite : tables `users_tms_devices_trusted`, (ret
    L1079: - **3** tables nouvelles à créer (`alertes_codes_overrides` retirée Bloc 6 C3)
    L1081: - **11** Edge Functions à dev par Claude Code (`upsert_alerte_code_override` retirée ; cor

## 06 - Fonctionnalités détaillées TMS/M14 - Intégration Everest.md
- octets : 65082 -> 62989 (-2093, -3.2%)
- tokens estimes : ~16270 -> ~15747
- tombstones supprimes : 3 | fragments barres retires : 5 | en-tetes debarres : 4
- lignes historiques T2 supprimees : 3
- ⚠ tombstones en prose a revoir a la main :
    L253: - p50/p95/p99 calls outbound 7j (par endpoint : create, cancel, get, is-handled-address). 

## 08 - savr-api-contracts/README.md
- octets : 3006 -> 3006 (-0, -0.0%)
- tokens estimes : ~751 -> ~751
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## tests/M01-reception-ordres-scenarios.md
- octets : 22828 -> 22618 (-210, -0.9%)
- tokens estimes : ~5707 -> ~5654
- tombstones supprimes : 0 | fragments barres retires : 3 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/M02-dispatch-scenarios.md
- octets : 27694 -> 27651 (-43, -0.2%)
- tokens estimes : ~6923 -> ~6912
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/M03-portail-prestataire-scenarios.md
- octets : 28108 -> 28065 (-43, -0.2%)
- tokens estimes : ~7027 -> ~7016
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/M04-gestion-tournees-scenarios.md
- octets : 37700 -> 37657 (-43, -0.1%)
- tokens estimes : ~9425 -> ~9414
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/M05-app-mobile-chauffeur-scenarios.md
- octets : 32499 -> 32456 (-43, -0.1%)
- tokens estimes : ~8124 -> ~8114
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/M06-referentiel-prestataires-scenarios.md
- octets : 31151 -> 31108 (-43, -0.1%)
- tokens estimes : ~7787 -> ~7777
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/M07-pilotage-financier-scenarios.md
- octets : 31993 -> 31950 (-43, -0.1%)
- tokens estimes : ~7998 -> ~7987
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/M08-facturation-prestataires-scenarios.md
- octets : 28685 -> 28642 (-43, -0.1%)
- tokens estimes : ~7171 -> ~7160
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/M09-stock-materiel-scenarios.md
- octets : 29544 -> 29501 (-43, -0.1%)
- tokens estimes : ~7386 -> ~7375
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/M10-gestion-exutoires-veolia-scenarios.md
- octets : 29125 -> 29082 (-43, -0.1%)
- tokens estimes : ~7281 -> ~7270
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/M11-alerting-scenarios.md
- octets : 26021 -> 25978 (-43, -0.2%)
- tokens estimes : ~6505 -> ~6494
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/M12-attribution-transporteur-scenarios.md
- octets : 31648 -> 31424 (-224, -0.7%)
- tokens estimes : ~7912 -> ~7856
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/M13-administration-tms-scenarios.md
- octets : 32631 -> 32507 (-124, -0.4%)
- tokens estimes : ~8157 -> ~8126
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/M14-integration-everest-scenarios.md
- octets : 28257 -> 28134 (-123, -0.4%)
- tokens estimes : ~7064 -> ~7033
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## Assets copies verbatim (non nettoyes)

- 08 - savr-api-contracts/package.json
- 08 - savr-api-contracts/validate.mjs
- 08 - savr-api-contracts/schemas/common.schema.json
- 08 - savr-api-contracts/schemas/entrants/E1.collecte-creee.schema.json
- 08 - savr-api-contracts/schemas/entrants/E2.collecte-modifiee.schema.json
- 08 - savr-api-contracts/schemas/entrants/E3.collecte-annulee.schema.json
- 08 - savr-api-contracts/schemas/entrants/E5.lieu-upsert.schema.json
- 08 - savr-api-contracts/schemas/sortants/S1.collecte-acceptee.schema.json
- 08 - savr-api-contracts/schemas/sortants/S11.collecte-rejetee.schema.json
- 08 - savr-api-contracts/schemas/sortants/S2.collecte-refusee.schema.json
- 08 - savr-api-contracts/schemas/sortants/S3.tournee-upsert.schema.json
- 08 - savr-api-contracts/schemas/sortants/S4.collecte-en-cours.schema.json
- 08 - savr-api-contracts/schemas/sortants/S5.collecte-terminee.schema.json
- 08 - savr-api-contracts/schemas/sortants/S7.plaque-saisie.schema.json
- 08 - savr-api-contracts/schemas/sortants/S9.incident.schema.json

## 🧹 Fichiers perimes SUPPRIMES de l'export (--clean)

- 06 - Fonctionnalités détaillées TMS/_RAPPORT-EXPORT.md
- 08 - savr-api-contracts/_RAPPORT-EXPORT.md
- tests/_RAPPORT-EXPORT.md

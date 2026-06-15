# Rapport export dev-facing

Mode : SUR (T1 seul, T2 detecte)
**Total : 2488751 -> 2419368 octets (-69383, -2.8%)**


## 00 - Index.md
- octets : 160531 -> 157513 (-3018, -1.9%)
- tokens estimes : ~40132 -> ~39378
- tombstones supprimes : 0 | fragments barres retires : 36 | en-tetes debarres : 0
- ⚠ tombstones en prose a revoir a la main :
    L109: - Catalogue R_M03.X final : R_M03.1 → R_M03.12 (10 actives + 1 supprimée + 1 ré-introduite
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L7 [meta-changelog]: **Dernière mise à jour** : 2026-06-11 (**Audit de cohérence inter-CDC (skill `co
    L64 [addendum-date]: ## ⚠ Addendum 2026-05-01 — Audit cohérence inter-CDC pré-handoff (skill `coheren
    L114 [addendum-date]: ## ⚠ Addendum 2026-05-07 — Audit cohérence inter-CDC Run 6 (skill `coherence-int

## 01 - Vision et objectifs TMS.md
- octets : 52764 -> 52615 (-149, -0.3%)
- tokens estimes : ~13191 -> ~13153
- tombstones supprimes : 0 | fragments barres retires : 3 | en-tetes debarres : 0
- ⚠ tombstones en prose a revoir a la main :
    L127: | **Retiré V1 (Q10 2026-04-24)** | | | Email plaque supprimé ; plaque de contrôle d'accès 
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : V1 rédigée — §1 à §7 complets, décisions tracées, questions ouverte
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-04-21

## 03 - Périmètre fonctionnel TMS.md
- octets : 73318 -> 72101 (-1217, -1.7%)
- tokens estimes : ~18329 -> ~18025
- tombstones supprimes : 5 | fragments barres retires : 10 | en-tetes debarres : 2
- ⚠ tombstones en prose a revoir a la main :
    L510: - **Retiré V1** (D9, reporté V1.1)
    L548: 4. → **étape supprimée V1** (validation auto match exact)
    L606: - **Supprimé revue sobriété §08 Bloc A 2026-05-01 A3** — remplacé par lecture cross-schema
    L1007: 8. — **Résolu revue sobriété 2026-04-25 (A6)** : Slack dégagé V1 entièrement (infra dorman
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : V1 rédigée — 14 modules V1 + 2 modules V2
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-04-22
    L125 [meta-changelog]: **Statut** : V1 **rédigée** (fichier détaillé 2026-04-24, 16 décisions structura

## 04 - Data Model TMS.md
- octets : 289030 -> 274217 (-14813, -5.1%)
- tokens estimes : ~72257 -> ~68554
- tombstones supprimes : 52 | fragments barres retires : 70 | en-tetes debarres : 7
- ⚠ tombstones en prose a revoir a la main :
    L336: - → retiré (W11 dégagée A1 2026-04-30)
    L353: - — **supprimée Bloc 6 sobriété 2026-04-28 C3**
    L427: **Retiré V1 (revue sobriété §04 2026-04-30 A6)** — colonne supprimée. Lookup via `everest_
    L778: - → **Supprimé revue sobriété §05 2026-05-01 D2** (valeur enum supprimée, cas impossible p
    L802: | `action` | text | NOT NULL | Enum simplifié (sobriété A3 2026-04-30) : `ajustement_cree`
    L1203: - **Supprimé (revue sobriété 2026-04-29, purge F3 2026-06-07)**
    L1677: **Colonnes addendum supprimées** (2026-04-28 — fusion mapping) : , , , .
    L1841: - **Retiré V1 (revue sobriété §04 2026-04-30 A3)** — info dérivée de `integrations_logs` v
    L1941: **Index** : `(prestataire_id) WHERE deleted_at IS NULL`, `(telephone)`, `(user_tms_id)` UN
    L2034: **Index** : `(prestataire_id) WHERE deleted_at IS NULL`, `(plaque_canonique)` UNIQUE WHERE
    L2924: - supprimée 2026-06-07 — jamais en vigueur, remplacée par le mapping départemental ci-dess
    L2942: - **Paramètre retiré V1 (propagation suppression saisie plaque terrain 2026-06-04)** — plu
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L11 [meta-changelog]: **Dernière mise à jour** : 2026-06-04 (**propagation Bloc 3 — workflow RGPD géol
    L15 [addendum-date]: ## ⚠ Addendum 2026-04-30 (revue de sobriété §04 noyau structurel) — 6 simplifica
    L51 [addendum-date]: ## ⚠ Addendum 2026-04-27 (propagation §13) — Migration MTS-1
    L168 [addendum-date]: ## ⚠ Addendum 2026-04-25 (propagation M13) — Administration TMS
    L384 [addendum-date]: ## ⚠ Addendum 2026-04-25 (propagation M14) — Intégration Everest
    L493 [addendum-date]: ## ⚠ Addendum 2026-04-24 (propagation M03) — Portail prestataire self-service
    L609 [addendum-date]: ## ⚠ Addendum 2026-04-24 (propagation M05) — App mobile chauffeur PWA offline-fi
    L750 [addendum-date]: ## ⚠ Addendum 2026-04-24 (propagation M07) — Pilotage financier logistique
    L1092 [addendum-date]: ## ⚠ Addendum 2026-04-24 (propagation M08) — Facturation prestataires + revue so
    L1173 [addendum-date]: ## ⚠ Addendum 2026-04-24 (propagation M12) — Moteur de suggestion d'attribution
    L1275 [addendum-date]: ## ⚠ Addendum 2026-04-24 (propagation M11) — Alerting transverse
    L1442 [addendum-date]: ## ⚠ Addendum 2026-04-25 (propagation M10) — Gestion exutoires Veolia
    L1606 [addendum-date]: ## ⚠ Addendum 2026-04-23 (seconde salve) — Retournements prestataires/lieux + sn
    L3216 [addendum-date]: ## Addendum 2026-04-27 (propagation §11) — Dashboards transverses

## 05 - Règles métier TMS.md
- octets : 124008 -> 120085 (-3923, -3.2%)
- tokens estimes : ~31002 -> ~30021
- tombstones supprimes : 3 | fragments barres retires : 34 | en-tetes debarres : 10
- ⚠ tombstones en prose a revoir a la main :
    L250: **Retiré V1 (propagation M07 2026-04-24 D5)**.
    L1287: - (statut `ackee` retiré Bloc 6 B2)
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L7 [meta-changelog]: **Dernière mise à jour** : 2026-06-04 (**propagation suppression saisie plaque t

## 00 - Index.md
- octets : 17370 -> 17370 (-0, -0.0%)
- tokens estimes : ~4342 -> ~4342
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Dernière mise à jour** : 2026-06-05 (**Revue de sobriété 6-filtres M06 — Référ

## M01 - Réception ordres de collecte.md
- octets : 49122 -> 46915 (-2207, -4.5%)
- tokens estimes : ~12280 -> ~11728
- tombstones supprimes : 6 | fragments barres retires : 15 | en-tetes debarres : 2
- ⚠ tombstones en prose a revoir a la main :
    L417: **Propagation à §05 R6.1** : `annulee_pendant_en_cours=true` compatible avec `statut_opera
    L533: - → **Résolu** : documentation `annulee_pendant_en_cours` + suppression branche pré-affect
    L534: - → **Résolu (F1)** : V1 email uniquement (Val + frère). Slack V1.1+ si volume suffisant. 
    L535: - → **Caduc sobriété A_M01_03** (2026-04-30) : action « Escalader Dev » DLQ supprimée.
    L536: - → **Caduc revue sobriété M01 2026-06-04 (A1)** : table supprimée avec le polling (Bloc A
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Dernière mise à jour** : 2026-06-04 (**Revue de sobriété M01 (skill `cdc-revie
    L9 [addendum-date]: ## ⚠ Addendum 2026-05-01 — Propagation revue sobriété §08 Bloc A (A4)
    L25 [addendum-date]: ## Addendum 2026-04-30 (revue de sobriété V1) — 14 simplifications appliquées
    L48 [addendum-date]: ## Addendum 2026-04-23 (seconde salve) — Arbitrages de simplification

## M02 - Dispatch Ops Savr.md
- octets : 45341 -> 44825 (-516, -1.1%)
- tokens estimes : ~11335 -> ~11206
- tombstones supprimes : 0 | fragments barres retires : 12 | en-tetes debarres : 0
- ⚠ tombstones en prose a revoir a la main :
    L525: 4. — **Reporté V1.1** post-mesure exploitation 2 mois.
    L530: 9. — **Reporté V1.1**.
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L7 [meta-changelog]: **Dernière mise à jour** : 2026-04-29 (revue de sobriété M02 — coupes radicales 
    L11 [addendum-date]: ## Addendum 2026-04-23 (seconde salve M01) — Impacts M02

## M03 - Portail prestataire self-service.md
- octets : 69418 -> 67273 (-2145, -3.1%)
- tokens estimes : ~17354 -> ~16818
- tombstones supprimes : 5 | fragments barres retires : 11 | en-tetes debarres : 1
- ⚠ tombstones en prose a revoir a la main :
    L693: - **Retiré V1 (propagation M08 D5 pas de paliers)**
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Dernière mise à jour** : 2026-06-05 (**revue de sobriété M03** — A1 param `m03

## M04 - Gestion des tournées.md
- octets : 78932 -> 73904 (-5028, -6.4%)
- tokens estimes : ~19733 -> ~18476
- tombstones supprimes : 5 | fragments barres retires : 36 | en-tetes debarres : 5
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
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : V1 rédigée (session 2026-04-23 — 9 décisions structurantes tranchée
    L6 [meta-changelog]: **Dernière mise à jour** : 2026-06-04 (**purge dette propagation S6 dans le corp
    L10 [addendum-date]: ## ⚠ Addendum 2026-04-29 — Revue sobriété M04
    L27 [addendum-date]: ## ⚠ Addendum 2026-04-24 (propagation M03) — Validation plaque avant dispatch — 

## M05 - App mobile chauffeur.md
- octets : 92288 -> 89278 (-3010, -3.3%)
- tokens estimes : ~23072 -> ~22319
- tombstones supprimes : 6 | fragments barres retires : 20 | en-tetes debarres : 4
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
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : V1 rédigée (session 2026-04-24 — 20 décisions structurantes tranché
    L6 [meta-changelog]: **Dernière mise à jour** : 2026-06-04 (**Revue de sobriété M05 (skill `cdc-revie
    L10 [addendum-date]: ## ⚠ Addendum 2026-04-24 (propagation M03) — Retournement méthode auth chauffeur

## M06 - Référentiel prestataires.md
- octets : 53827 -> 52953 (-874, -1.6%)
- tokens estimes : ~13456 -> ~13238
- tombstones supprimes : 2 | fragments barres retires : 19 | en-tetes debarres : 0
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
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Dernière mise à jour** : 2026-06-07 (**4 floues test-scenarios M06 (2026-06-06

## M07 - Pilotage financier logistique.md
- octets : 60351 -> 55559 (-4792, -7.9%)
- tokens estimes : ~15087 -> ~13889
- tombstones supprimes : 15 | fragments barres retires : 23 | en-tetes debarres : 2
- ⚠ tombstones en prose a revoir a la main :
    L129: - **Retiré V1** : (décision D 2026-04-24, reporté V2)
    L137: ** — supprimé (sobriété A5 2026-04-30)**
    L176: - → **Supprimé revue sobriété §05 2026-05-01 D2** (cas impossible par construction grâce à
    L511: - Modification rétroactive de grille interdite. → **Supprimée revue sobriété §05 2026-05-0
    L559: - — workflow validation supprimé, fusionnés en `ajuste` (A3)
    L639: 3. — **Tranchée sobriété B3 2026-04-30** : alerte supprimée V1. Détection via dashboard / 
    L663: - → **N/A revue sobriété §05 2026-05-01 D2** (code supprimé V1)
    L664: - → **N/A revue sobriété 2026-05-01 A2 / propagation 2026-06-04** (code supprimé, S6 rempl
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : V1 rédigée 2026-04-24, revue de sobriété 2026-04-30, **propagation 
    L7 [addendum-date]: ## ⚠ Addendum 2026-05-01 — Propagation revue sobriété §08 Bloc A (A2)

## M08 - Facturation prestataires.md
- octets : 87817 -> 82809 (-5008, -5.7%)
- tokens estimes : ~21954 -> ~20702
- tombstones supprimes : 19 | fragments barres retires : 29 | en-tetes debarres : 6
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
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : V1 rédigée 2026-04-24, **revue de sobriété 2026-04-30** (16 simplif

## M09 - Stock matériel Savr.md
- octets : 44896 -> 43838 (-1058, -2.4%)
- tokens estimes : ~11224 -> ~10959
- tombstones supprimes : 1 | fragments barres retires : 15 | en-tetes debarres : 0
- ⚠ tombstones en prose a revoir a la main :
    L92: - **Supprimé revue sobriété 2026-05-01 A3** — remplacé par vue cross-schema `plateforme.v_
    L176: - — **Supprimé sobriété 2026-04-30 A_M09_05** : duplique le tri par défaut tableau Section
    L177: - — **Supprimé sobriété 2026-04-30 A_M09_02** : vanity metric sans action déclenchée. Audi
    L178: - — **Supprimé sobriété 2026-04-30 A_M09_03** : vanity metric. Analyse qualité via consult
    L226: - — **Supprimé sobriété 2026-04-30 A_M09_04** : recompte = ~1×/sem ad-hoc sur retour terra
    L477: - [[../../01 - Cahier des charges App/08 - APIs et intégrations|§08 Plateforme]] — **suppr
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : V1 rédigée 2026-04-25 (option e — frontière documentaire avec M10, 
    L7 [addendum-date]: ## ⚠ Addendum 2026-05-01 — Propagation revue sobriété §08 Bloc A (A3)

## M10 - Gestion exutoires Veolia.md
- octets : 48511 -> 48511 (-0, -0.0%)
- tokens estimes : ~12127 -> ~12127
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : V2 sobre 2026-04-30 (revue de sobriété — suppression dualité `reali

## M11 - Alerting transverse.md
- octets : 85875 -> 79441 (-6434, -7.5%)
- tokens estimes : ~21468 -> ~19860
- tombstones supprimes : 22 | fragments barres retires : 24 | en-tetes debarres : 7
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
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : V1 rédigée 2026-04-24 — **Revue de sobriété 2026-04-25 Blocs 1+2+3+
    L6 [meta-changelog]: **Dernière mise à jour** : 2026-06-07 — **Scénarios de test M11 (46, `tests/M11-

## M12 - Attribution transporteur.md
- octets : 52715 -> 50947 (-1768, -3.4%)
- tokens estimes : ~13178 -> ~12736
- tombstones supprimes : 3 | fragments barres retires : 27 | en-tetes debarres : 6
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
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Dernière mise à jour** : 2026-04-29 (revue de sobriété M02 propagée — suppress

## M13 - Administration TMS.md
- octets : 81866 -> 77211 (-4655, -5.7%)
- tokens estimes : ~20466 -> ~19302
- tombstones supprimes : 7 | fragments barres retires : 51 | en-tetes debarres : 4
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
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Dernière mise à jour** : 2026-06-07 (**Test-scenarios M13 — 5 floues tranchées

## M14 - Intégration Everest.md
- octets : 63470 -> 62118 (-1352, -2.1%)
- tokens estimes : ~15867 -> ~15529
- tombstones supprimes : 4 | fragments barres retires : 4 | en-tetes debarres : 4
- ⚠ tombstones en prose a revoir a la main :
    L253: - p50/p95/p99 calls outbound 7j (par endpoint : create, cancel, get, is-handled-address). 
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Dernière mise à jour** : 2026-06-07 (**test-scenarios M14 — 4 floues tranchées
    L198 [meta-changelog]: **Statut** : écran indépendant supprimé (revue sobriété 2026-04-30 A_M14_05). Au
    L461 [meta-changelog]: **Statut** : workflow supprimé. UI E3 + API route `/api/internal/m14/missions/re

## 07 - Architecture technique TMS.md
- octets : 32786 -> 32147 (-639, -1.9%)
- tokens estimes : ~8196 -> ~8036
- tombstones supprimes : 3 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : V1 rédigé 2026-04-23 (suite atelier tech avec frère 2026-04-23)
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-04-27 (propagation §12 App mobile chauffeur V1 2

## 08 - Contrat API Plateforme-TMS.md
- octets : 103684 -> 99835 (-3849, -3.7%)
- tokens estimes : ~25921 -> ~24958
- tombstones supprimes : 5 | fragments barres retires : 28 | en-tetes debarres : 6
- ⚠ tombstones en prose a revoir a la main :
    L207: - **Champ payload supprimé revue sobriété Bloc B 2026-05-01 B3** — header HTTP `X-API-Vers
    L231: - **Supprimé revue sobriété Bloc B 2026-05-01 B3** — la "double ceinture" était un artefac
    L968: | `statut` | enum **3 valeurs** (post-revue sobriété §08 Bloc D 2026-05-01 D6) : `traite` 
    L1077: 3. **Résolu revue sobriété 2026-05-01 A4** — endpoints `/sync/poll` supprimés des deux côt
    L1085: - supprimés revue sobriété 2026-05-01 A4
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : V1 — mise à jour architecturale 2026-04-23 (atelier tech avec frère
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-04 (**propagation suppression saisie plaque t
    L10 [addendum-date]: ## ⚠ Addendum 2026-06-03 — Bloc 2 : JSON Schemas du contrat API (`savr-api-contr
    L28 [addendum-date]: ## ⚠ Addendum 2026-05-01 — Revue sobriété §08 Bloc D (simplifications enums)
    L44 [addendum-date]: ## ⚠ Addendum 2026-05-01 — Revue sobriété §08 Bloc C (duplications à fusionner)
    L57 [addendum-date]: ## ⚠ Addendum 2026-05-01 — Revue sobriété §08 Bloc B (simplifications payload + 
    L71 [addendum-date]: ## ⚠ Addendum 2026-05-01 — Revue sobriété §08 Bloc A (suppressions)
    L86 [addendum-date]: ## ⚠ Addendum 2026-04-24 — Propagation M03 (Portail prestataire)
    L94 [addendum-date]: ## ⚠ Addendum 2026-04-23 — Impacts atelier
    L104 [addendum-date]: ## ⚠ Addendum 2026-04-23 (seconde salve M01) — Contrat API simplifié

## README.md
- octets : 3006 -> 3006 (-0, -0.0%)
- tokens estimes : ~751 -> ~751
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## README.md
- octets : 6164 -> 6164 (-0, -0.0%)
- tokens estimes : ~1541 -> ~1541
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## README.md
- octets : 13781 -> 13781 (-0, -0.0%)
- tokens estimes : ~3445 -> ~3445
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## README.md
- octets : 3311 -> 3311 (-0, -0.0%)
- tokens estimes : ~827 -> ~827
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## README.md
- octets : 8604 -> 8604 (-0, -0.0%)
- tokens estimes : ~2151 -> ~2151
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## README.md
- octets : 3350 -> 3350 (-0, -0.0%)
- tokens estimes : ~837 -> ~837
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## readme.md
- octets : 916 -> 916 (-0, -0.0%)
- tokens estimes : ~229 -> ~229
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## 09 - Authentification et permissions TMS.md
- octets : 117636 -> 115939 (-1697, -1.4%)
- tokens estimes : ~29409 -> ~28984
- tombstones supprimes : 0 | fragments barres retires : 33 | en-tetes debarres : 3
- ⚠ tombstones en prose a revoir a la main :
    L181: 5. — retiré Bloc 6 C3 (table supprimée)
    L182: 6. — retiré Bloc 6 C3 (table supprimée)
    L425: -- retirées V1 (revue sobriété §04 2026-04-30 A3 — vue dérivée tms.vue_prestataires_everes
    L1258: -- — SUPPRIMÉE (sobriété A3 2026-04-30)
    L1259: -- — SUPPRIMÉ (sobriété A3 2026-04-30)
    L1310: - **Supprimée revue sobriété 2026-04-30 B2** — trace via `tms.audit_logs` action `M08_EXPO
    L1311: - **Table supprimée V1 (revue sobriété §04 2026-04-30 A5)** — audit visuel via `factures_p
    L1374: -- revue sobriété §04 2026-04-30 A5 — table supprimée V1.
    L1378: -- revue sobriété 2026-04-30 B2 — table dédiée supprimée.
    L1391: - **Test retiré revue sobriété 2026-04-30 B2** — tracé via `tms.audit_logs` (tests audit_l
    L1692: - — retiré Bloc 6 C1 (table fusionnée dans tms.audit_logs)
    L1903: - — **Retiré V1 (Bloc 3 2026-06-04)** : sans objet (plus de révocation in-app).
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Dernière mise à jour** : 2026-06-04 (**propagation Bloc 3 — workflow RGPD géol
    L15 [addendum-date]: ## ⚠ Addendum 2026-04-25 (propagation M13) — Politique session 30j glissantes ad
    L194 [addendum-date]: ## ⚠ Addendum 2026-04-24 (propagation M03) — Authentification manager prestatair
    L288 [addendum-date]: ## ⚠ Addendum 2026-04-24 (propagation M05) — Authentification chauffeur PWA + de
    L370 [addendum-date]: ## ⚠ Addendum 2026-04-23 (atelier tech + seconde salve M01)
    L606 [meta-changelog]: **Mise à jour** : les claims sont rafraîchis à chaque login et à chaque refresh 

## 10 - Design System TMS.md
- octets : 15907 -> 15907 (-0, -0.0%)
- tokens estimes : ~3976 -> ~3976
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : V1 rédigée 2026-04-28.

## 11 - Dashboards TMS.md
- octets : 28127 -> 27939 (-188, -0.7%)
- tokens estimes : ~7031 -> ~6984
- tombstones supprimes : 0 | fragments barres retires : 3 | en-tetes debarres : 0
- ⚠ tombstones en prose a revoir a la main :
    L131: **Détection cumul** : **Supprimé revue sobriété §08 A1 2026-05-01** — confort UX pur (≤4 u
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : V1 rédigée 2026-04-27.

## 12 - App mobile chauffeur.md
- octets : 20634 -> 20464 (-170, -0.8%)
- tokens estimes : ~5158 -> ~5116
- tombstones supprimes : 0 | fragments barres retires : 4 | en-tetes debarres : 0
- ⚠ tombstones en prose a revoir a la main :
    L222: | — **supprimé revue sobriété 2026-04-30 A1** (déclaration `realise` Ops vaut désormais co
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : V1 rédigée 2026-04-27. **MAJ Bloc 3 2026-06-04** : D6 refondue (écr

## 13 - Migration MTS-1.md
- octets : 38731 -> 38731 (-0, -0.0%)
- tokens estimes : ~9682 -> ~9682
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## 14 - Scalabilité TMS.md
- octets : 10170 -> 10170 (-0, -0.0%)
- tokens estimes : ~2542 -> ~2542
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## 15 - Sécurité et conformité TMS.md
- octets : 42122 -> 41416 (-706, -1.7%)
- tokens estimes : ~10530 -> ~10354
- tombstones supprimes : 1 | fragments barres retires : 8 | en-tetes debarres : 0
- ⚠ tombstones en prose a revoir a la main :
    L170: - `test_m11_alertes_no_direct_insert`, (retiré Bloc 6 C1 — table fusionnée tms.audit_logs)

## M01-reception-ordres-scenarios.md
- octets : 22828 -> 22661 (-167, -0.7%)
- tokens estimes : ~5707 -> ~5665
- tombstones supprimes : 0 | fragments barres retires : 3 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## M02-dispatch-scenarios.md
- octets : 27694 -> 27694 (-0, -0.0%)
- tokens estimes : ~6923 -> ~6923
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## M03-portail-prestataire-scenarios.md
- octets : 27445 -> 27445 (-0, -0.0%)
- tokens estimes : ~6861 -> ~6861
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## M04-gestion-tournees-scenarios.md
- octets : 31920 -> 31920 (-0, -0.0%)
- tokens estimes : ~7980 -> ~7980
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## M05-app-mobile-chauffeur-scenarios.md
- octets : 29430 -> 29430 (-0, -0.0%)
- tokens estimes : ~7357 -> ~7357
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## M06-referentiel-prestataires-scenarios.md
- octets : 31151 -> 31151 (-0, -0.0%)
- tokens estimes : ~7787 -> ~7787
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## M07-pilotage-financier-scenarios.md
- octets : 31993 -> 31993 (-0, -0.0%)
- tokens estimes : ~7998 -> ~7998
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## M08-facturation-prestataires-scenarios.md
- octets : 28685 -> 28685 (-0, -0.0%)
- tokens estimes : ~7171 -> ~7171
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## M09-stock-materiel-scenarios.md
- octets : 29544 -> 29544 (-0, -0.0%)
- tokens estimes : ~7386 -> ~7386
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## M10-gestion-exutoires-veolia-scenarios.md
- octets : 29125 -> 29125 (-0, -0.0%)
- tokens estimes : ~7281 -> ~7281
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## M11-alerting-scenarios.md
- octets : 26021 -> 26021 (-0, -0.0%)
- tokens estimes : ~6505 -> ~6505
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## M12-attribution-transporteur-scenarios.md
- octets : 31648 -> 31648 (-0, -0.0%)
- tokens estimes : ~7912 -> ~7912
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code — **8 specs floues : F2/F4/F5/F7 TRAN

## M13-administration-tms-scenarios.md
- octets : 32631 -> 32631 (-0, -0.0%)
- tokens estimes : ~8157 -> ~8157
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code — **5 specs floues TRANCHÉES Val 2026

## M14-integration-everest-scenarios.md
- octets : 28257 -> 28257 (-0, -0.0%)
- tokens estimes : ~7064 -> ~7064
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code — **5 specs floues TRANCHÉES Val 2026

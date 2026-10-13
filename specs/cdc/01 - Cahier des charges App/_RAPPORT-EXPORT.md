# Rapport export dev-facing

Mode : SUR (T1 seul, T2 detecte)
**Total : 2339435 -> 2306095 octets (-33340, -1.4%)**


## 00 - Index.md
- octets : 120348 -> 119354 (-994, -0.8%)
- tokens estimes : ~30087 -> ~29838
- tombstones supprimes : 0 | fragments barres retires : 12 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L11 [meta-changelog]: **Dernière mise à jour** : 2026-07-07 (**Audit de cohérence inter-CDC (skill `co
    L15 [tracabilite]: **Précédente mise à jour** : 2026-06-05 (**Audit de cohérence inter-CDC (skill `

## 00 - Scoping V1.md
- octets : 6629 -> 6629 (-0, -0.0%)
- tokens estimes : ~1657 -> ~1657
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## 01 - Vision et objectifs.md
- octets : 17652 -> 17652 (-0, -0.0%)
- tokens estimes : ~4413 -> ~4413
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : ✅ Complété
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-04-20

## 02 - Personas et cas d'usage.md
- octets : 22888 -> 22888 (-0, -0.0%)
- tokens estimes : ~5722 -> ~5722
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : ✅ Complété
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-03 (revue sobriété : dédup RLS → §09, purge c

## 03 - Périmètre fonctionnel global.md
- octets : 26617 -> 26016 (-601, -2.3%)
- tokens estimes : ~6654 -> ~6504
- tombstones supprimes : 0 | fragments barres retires : 6 | en-tetes debarres : 0
- ⚠ tombstones en prose a revoir a la main :
    L181: - **Supprimé revue sobriété §08 A1 2026-05-01** (confort UX pur, ≤4 users cumul concernés)
    L187: **Supprimé revue sobriété §08 A1 2026-05-01** — pas d'endpoint dédié, donc pas de CORS spé
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : ✅ Complété
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-04-27 (propagation §11 TMS Dashboards — sous-sec

## 04 - Data Model.md
- octets : 340175 -> 329051 (-11124, -3.3%)
- tokens estimes : ~85043 -> ~82262
- tombstones supprimes : 30 | fragments barres retires : 36 | en-tetes debarres : 7
- ⚠ tombstones en prose a revoir a la main :
    L57: - → supprimé, contacts relogés sur `evenements.contact_principal_*` + `contact_secours_*` 
    L62: - → supprimé (non utilisé en pratique, le téléphone seul suffit le jour J — si besoin V1.1
    L77: → **Colonne `attribuee_source` SUPPRIMÉE V1** *(sobriété M01 B_M01_04 + D_M01_03 — 2026-04
    L1786: **Renommé `montant_fixe_ht` (refonte 2026-05-26)**, puis **renommé `prix_base_ht` (M1.3)**
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé — mise à jour architecturale 2026-04-23 (atelier tech avec f
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-15 — **M2.1 alignement DB→CDC (divergence M2.
    L22 [addendum-date]: ## ⚠ Addendum 2026-04-23 (seconde salve) — Retournements prestataires et lieux
    L85 [addendum-date]: ## ⚠ Addendum 2026-04-24 (propagation M03 TMS) — Plaque requise par traiteur — *
    L87 [tracabilite]: > **NOTE 2026-05-03 (refonte formulaire §06.01)** : addendum **renommé** `plaque
    L95 [tracabilite]: ### Nouvelle colonne `plateforme.lieux.plaque_requise_default` → renommée `contr
    L101 [tracabilite]: ### Nouvelle colonne `plateforme.collectes.plaque_requise` → renommée `controle_
    L134 [addendum-date]: ## ⚠ Addendum 2026-05-03 (refonte formulaire §06.01) — Renommage controle_acces 
    L197 [addendum-date]: ## ⚠ Addendum 2026-05-06 — Indicateur Taux de recyclage (ZD-only, formule à capt
    L325 [addendum-date]: ## ⚠ Addendum 2026-06-04 — Facteurs d'impact carbone CO₂ (Sujet 3, ZD-only)
    L396 [addendum-date]: ## ⚠ Addendum 2026-06-04 (bis) — CO₂ AG (repas détournés)
    L433 [addendum-date]: ## ⚠ Addendum 2026-05-22 — Coefficient de perte labo (estimation déchets amont, 

## 05 - Règles métier.md
- octets : 126232 -> 121755 (-4477, -3.5%)
- tokens estimes : ~31558 -> ~30438
- tombstones supprimes : 3 | fragments barres retires : 21 | en-tetes debarres : 3
- ⚠ tombstones en prose a revoir a la main :
    L987: **UX** : — retiré (2026-09-28, jamais construit). La complétion se fait depuis « Mon organ
    L1050: | Publication rapport post-collecte | Batch J+1 à 6h (embargo H+24 strict) | Rapport non a
    L1263: - : **supprimée V1 (décision Val 2026-06-15)** — type `alerte_ops_pesee_anormale` seedé ma
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-04-20
    L1136 [tracabilite]: > Contenu historique conservé pour traçabilité :

## 07 - Architecture technique.md
- octets : 32386 -> 31516 (-870, -2.7%)
- tokens estimes : ~8096 -> ~7879
- tombstones supprimes : 1 | fragments barres retires : 5 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1 — mise à jour majeure 2026-04-23 (atelier tech avec frère
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-10 (addendum scope V1)
    L8 [addendum-date]: ## ⚠ ADDENDUM 2026-06-10 — Scope V1 : ce document décrit l'ÉTAT FINAL (V2), pas 

## 08 - APIs et intégrations.md
- octets : 141079 -> 136900 (-4179, -3.0%)
- tokens estimes : ~35269 -> ~34225
- tombstones supprimes : 6 | fragments barres retires : 19 | en-tetes debarres : 1
- ⚠ tombstones en prose a revoir a la main :
    L15: 5. **Tranché V1 = polling J+1 3h uniquement (revue sobriété §08 App 2026-05-31 B1)** — web
    L289: - **Supprimé 2026-05-29 (décision Val)** : trop de risque de collecte « fantôme acceptée »
    L585: - → **sans objet V1** (pas de webhook entrant). Conservé pour activation V1.1/V2 : header 
    L1198: - **Event-driven par défaut** *(polling supprimé revue sobriété 2026-05-01 Bloc A A4 — ret
    L1212: - **Supprimés revue sobriété 2026-05-01 Bloc A A4** — retry 3 paliers + dédup `integration
    L1216: - **Supprimé revue sobriété 2026-05-01 Bloc A A1** — bouton sidebar inconditionnel + page 
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Draft V1 — mise à jour architecturale 2026-04-23 (atelier tech avec
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-05-08 (refonte enums Plateforme — `lieux.station
    L9 [addendum-date]: ## ⚠ Addendum 2026-04-23 — Impacts atelier
    L19 [addendum-date]: ## ⚠ Addendum 2026-04-23 (seconde salve M01) — Simplification contrat API TMS

## 09 - Authentification et permissions.md
- octets : 121001 -> 120491 (-510, -0.4%)
- tokens estimes : ~30250 -> ~30122
- tombstones supprimes : 0 | fragments barres retires : 11 | en-tetes debarres : 1
- ⚠ tombstones en prose a revoir a la main :
    L69: - *(retiré 2026-06-07 F3 — `ops_savr` peut éditer le SIREN transporteur)*
    L70: - *(retiré 2026-06-07 F3 — `ops_savr` peut désactiver un transporteur)*
    L464: | | *(retiré V1 — F6 2026-06-07, fusion = script SQL hors UI, cf. §06.06 §8)* | — | — |
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Draft V1 — mise à jour architecturale 2026-04-23 (atelier tech avec
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-11 (**Audit RLS V1 post-35 patchs (skill `cdc
    L34 [addendum-date]: ## ⚠ Addendum 2026-04-23 (seconde salve M01) — Policies cross-schema prestataire

## 10 - Design System.md
- octets : 35450 -> 35450 (-0, -0.0%)
- tokens estimes : ~8862 -> ~8862
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1 — refonte 2026-06-08 (structure inspirée du UAE Design Sy
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-08

## 11 - Dashboards.md
- octets : 30843 -> 30531 (-312, -1.0%)
- tokens estimes : ~7710 -> ~7632
- tombstones supprimes : 0 | fragments barres retires : 4 | en-tetes debarres : 0
- ⚠ tombstones en prose a revoir a la main :
    L81: - : **supprimé refonte 2026-05-05** ; **refonte 2026-05-10** : nouveau Bloc 8 ZD/AG = bout
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-07 (**Session test-scenarios lot ⑫ — F5 tranc

## 12 - Reporting et exports.md
- octets : 57692 -> 57020 (-672, -1.2%)
- tokens estimes : ~14423 -> ~14255
- tombstones supprimes : 0 | fragments barres retires : 7 | en-tetes debarres : 1
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-07 (**Session test-scenarios lot ⑫ — 5 floues

## 13 - Migration depuis Bubble.md
- octets : 14753 -> 14444 (-309, -2.1%)
- tokens estimes : ~3688 -> ~3611
- tombstones supprimes : 0 | fragments barres retires : 4 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Cadrage — le plan d'exécution détaillé vit dans `04 - Migration/` d
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-07 (amendements post-Phase 10 : factures = Pe

## 14 - Scalabilité et évolutivité.md
- octets : 11156 -> 11156 (-0, -0.0%)
- tokens estimes : ~2789 -> ~2789
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-04-20

## 15 - Sécurité et conformité.md
- octets : 16235 -> 16152 (-83, -0.5%)
- tokens estimes : ~4058 -> ~4038
- tombstones supprimes : 0 | fragments barres retires : 2 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-04-20

## 16 - Roadmap et priorisation.md
- octets : 13661 -> 13442 (-219, -1.6%)
- tokens estimes : ~3415 -> ~3360
- tombstones supprimes : 0 | fragments barres retires : 4 | en-tetes debarres : 0
- ⚠ tombstones en prose a revoir a la main :
    L88: - **Retiré V1 (propagation Q10 M05 2026-04-24)** — scheduler + template + trigger email su
    L90: - **Supprimé revue sobriété §08 Bloc A 2026-05-01 A4** — retry 3 paliers (Bloc B B1) + déd
    L134: - **reporté V1.1** (revue sobriété §12 2026-06-03, A1) — V1 : le manager télécharge le PDF
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-04-20

## Adapter MTS-1 (MyTroopers) — relevé as-built Bubble.md
- octets : 15012 -> 15012 (-0, -0.0%)
- tokens estimes : ~3753 -> ~3753
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## CGU Savr V1 - Draft.md
- octets : 28140 -> 28140 (-0, -0.0%)
- tokens estimes : ~7035 -> ~7035
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Draft V1 (2026-04-28) — à valider avec un juriste avant mise en pro

## Frontière TMS-Ready V1.md
- octets : 12375 -> 12375 (-0, -0.0%)
- tokens estimes : ~3093 -> ~3093
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## Interface logistique_provider V1.md
- octets : 11063 -> 11063 (-0, -0.0%)
- tokens estimes : ~2765 -> ~2765
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## _PENDING - Everest API V1 (à intégrer §08 §3).md
- octets : 5073 -> 5073 (-0, -0.0%)
- tokens estimes : ~1268 -> ~1268
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## 00 - Index section 06.md
- octets : 3885 -> 3852 (-33, -0.8%)
- tokens estimes : ~971 -> ~963
- tombstones supprimes : 0 | fragments barres retires : 1 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-05-25 (révision Sujet 1 option A — multi-camions

## 01 - Formulaire de programmation de collecte.md
- octets : 60179 -> 57151 (-3028, -5.0%)
- tokens estimes : ~15044 -> ~14287
- tombstones supprimes : 2 | fragments barres retires : 20 | en-tetes debarres : 2
- ⚠ tombstones en prose a revoir a la main :
    L44: **Retiré V1 (2026-05-29)** — le pax reste **unique au niveau événement** (`evenements.pax`
    L202: > **Retiré V1 (Sujet 5, propagation 2026-05-26)** — contredisait le récap §3.d. Référence 
    L417: 7. **Retiré V1 (propagation Sujet 4 — type vs taille, 2026-05-26)** — « Autre » est une ca
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Draft V1 (refonte formulaire unique événement-centré 2026-05-21)
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-05-29 (revue de sobriété — A1/A2/B1/C1-C5)

## 02 - Templates emails V1.md
- octets : 37511 -> 35929 (-1582, -4.2%)
- tokens estimes : ~9377 -> ~8982
- tombstones supprimes : 0 | fragments barres retires : 22 | en-tetes debarres : 6
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Draft V1 (proposition Claude, à valider Val)
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-07 (**Session test-scenarios §06.02 — 4 specs
    L51 [meta-changelog]: **Statut** : retiré V1
    L200 [meta-changelog]: **Statut** : retiré V1
    L363 [meta-changelog]: **Statut** : retiré V1

## 03 - Registre réglementaire (UX).md
- octets : 11367 -> 11367 (-0, -0.0%)
- tokens estimes : ~2841 -> ~2841
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1 — ZD uniquement (2026-05-04)
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-07 (session test-scenarios lot ③ — 4 floues t

## 04 - Espace client traiteur.md
- octets : 116010 -> 114564 (-1446, -1.2%)
- tokens estimes : ~29002 -> ~28641
- tombstones supprimes : 0 | fragments barres retires : 16 | en-tetes debarres : 4
- ⚠ tombstones en prose a revoir a la main :
    L56: **Retiré V1 (refonte formulaire unique 2026-05-21)** — l'entrée se fait désormais par un b
    L364: - — **retiré 2026-05-07**, géré par le sélecteur de type ZD / AG en haut de page
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-07 (**Test scenarios §06.04 (skill `cdc-test-

## 05 - Espace client gestionnaire de lieux.md
- octets : 66767 -> 66483 (-284, -0.4%)
- tokens estimes : ~16691 -> ~16620
- tombstones supprimes : 0 | fragments barres retires : 7 | en-tetes debarres : 1
- ⚠ tombstones en prose a revoir a la main :
    L521: - : table supprimée refonte 2026-05-05 (synthèses générées à la demande, non archivées)
    L533: - : table supprimée refonte 2026-05-05. Génération synthèse : RLS appliquée via JWT du dem
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1 (session test-scenarios 2026-06-07 — 6 floues tranchées V
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-07-06 (patchs divergences M3.2 — nav 9 sections 

## 06 - Back-office Admin Savr.md
- octets : 142736 -> 140930 (-1806, -1.3%)
- tokens estimes : ~35684 -> ~35232
- tombstones supprimes : 6 | fragments barres retires : 13 | en-tetes debarres : 1
- ⚠ tombstones en prose a revoir a la main :
    L507: - — supprimé 2026-05-07 (unification libellé)
    L511: - — **supprimé V1 (revue sobriété 2026-05-30 A1)** : jamais utilisé (ni facturation, ni al
    L1155: - **Fermée 2026-06-07 (F6, tranché Val)** : bouton retiré V1, fusion = script SQL assisté 
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-07 (**Session `cdc-test-scenarios` lot ⑥ — 6 
    L683 [tracabilite]: > Contenu historique conservé pour traçabilité :

## 08 - Génération et édition facture (Admin).md
- octets : 23362 -> 23105 (-257, -1.1%)
- tokens estimes : ~5840 -> ~5776
- tombstones supprimes : 0 | fragments barres retires : 5 | en-tetes debarres : 0
- ⚠ tombstones en prose a revoir a la main :
    L365: **Clôturé** : reporté V1.1 (2026-05-08, revue de sobriété).
    L366: **Clôturé** : retiré du CDC, pas une décision V1 (2026-05-08, revue de sobriété).
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-07 (session test-scenarios lot ⑦ — 5 floues t

## 09 - Flux algo attribution AG (Admin).md
- octets : 40058 -> 39627 (-431, -1.1%)
- tokens estimes : ~10014 -> ~9906
- tombstones supprimes : 0 | fragments barres retires : 3 | en-tetes debarres : 1
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-04-21

## 11 - Espace client agence.md
- octets : 20352 -> 20229 (-123, -0.6%)
- tokens estimes : ~5088 -> ~5057
- tombstones supprimes : 0 | fragments barres retires : 1 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Draft V1 (création 2026-05-07 — extension programmation 3 types)
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-07 bis (**Complément session test-scenarios l

## 00 - Stack retenue.md
- octets : 4961 -> 4961 (-0, -0.0%)
- tokens estimes : ~1240 -> ~1240
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## 01 - Logs business.md
- octets : 6758 -> 6758 (-0, -0.0%)
- tokens estimes : ~1689 -> ~1689
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## 02 - Logs techniques.md
- octets : 6361 -> 6361 (-0, -0.0%)
- tokens estimes : ~1590 -> ~1590
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## 03 - Alertes.md
- octets : 7239 -> 7239 (-0, -0.0%)
- tokens estimes : ~1809 -> ~1809
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## 04 - Dashboards business.md
- octets : 3304 -> 3304 (-0, -0.0%)
- tokens estimes : ~826 -> ~826
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## 05 - Health checks.md
- octets : 3799 -> 3799 (-0, -0.0%)
- tokens estimes : ~949 -> ~949
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## 06 - Audit trail.md
- octets : 8288 -> 8288 (-0, -0.0%)
- tokens estimes : ~2072 -> ~2072
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0

## 01 - Volumes attendus.md
- octets : 4546 -> 4546 (-0, -0.0%)
- tokens estimes : ~1136 -> ~1136
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-08 (skill `cdc-perf-load`)

## 02 - SLA par endpoint.md
- octets : 5314 -> 5314 (-0, -0.0%)
- tokens estimes : ~1328 -> ~1328
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-08 (skill `cdc-perf-load`)

## 03 - Cibles techniques transverses.md
- octets : 2731 -> 2731 (-0, -0.0%)
- tokens estimes : ~682 -> ~682
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-08 (skill `cdc-perf-load`)

## 04 - Scenarios de charge.md
- octets : 3221 -> 3221 (-0, -0.0%)
- tokens estimes : ~805 -> ~805
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-08 (skill `cdc-perf-load`)

## 05 - Strategies optimisation.md
- octets : 3530 -> 3530 (-0, -0.0%)
- tokens estimes : ~882 -> ~882
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-08 (skill `cdc-perf-load`)

## 06 - Monitoring perf prod.md
- octets : 2781 -> 2781 (-0, -0.0%)
- tokens estimes : ~695 -> ~695
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Validé V1
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-08 (skill `cdc-perf-load`)

## 06.01-formulaire-programmation-scenarios.md
- octets : 42825 -> 42825 (-0, -0.0%)
- tokens estimes : ~10706 -> ~10706
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## 06.02-templates-emails-scenarios.md
- octets : 30441 -> 30441 (-0, -0.0%)
- tokens estimes : ~7610 -> ~7610
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code — **4 specs floues TRANCHÉES Val 2026

## 06.03-registre-reglementaire-scenarios.md
- octets : 27835 -> 27835 (-0, -0.0%)
- tokens estimes : ~6958 -> ~6958
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code — **4 specs floues TRANCHÉES Val 2026

## 06.04-espace-traiteur-scenarios.md
- octets : 59641 -> 59641 (-0, -0.0%)
- tokens estimes : ~14910 -> ~14910
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## 06.05-espace-gestionnaire-lieux-scenarios.md
- octets : 53457 -> 53457 (-0, -0.0%)
- tokens estimes : ~13364 -> ~13364
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## 06.06-back-office-admin-scenarios.md
- octets : 87481 -> 87481 (-0, -0.0%)
- tokens estimes : ~21870 -> ~21870
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## 06.08-generation-edition-facture-scenarios.md
- octets : 31914 -> 31914 (-0, -0.0%)
- tokens estimes : ~7978 -> ~7978
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## 06.09-algo-attribution-ag-scenarios.md
- octets : 35141 -> 35141 (-0, -0.0%)
- tokens estimes : ~8785 -> ~8785
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L13 [meta-changelog]: **Statut** : À implémenter par Claude Code

## 06.11-espace-agence-scenarios.md
- octets : 29062 -> 29062 (-0, -0.0%)
- tokens estimes : ~7265 -> ~7265
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L6 [meta-changelog]: **Statut** : À implémenter par Claude Code

## 08-apis-integrations-scenarios.md
- octets : 59259 -> 59259 (-0, -0.0%)
- tokens estimes : ~14814 -> ~14814
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code
    L494 [addendum-date]: # Source : §08 addendum 2026-04-23 §1 — Payload > 256 KB rejeté

## 09-rls-app-transverse-scenarios.md
- octets : 40146 -> 40146 (-0, -0.0%)
- tokens estimes : ~10036 -> ~10036
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

## 11-12-dashboards-reporting-scenarios.md
- octets : 50713 -> 50713 (-0, -0.0%)
- tokens estimes : ~12678 -> ~12678
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L5 [meta-changelog]: **Statut** : À implémenter par Claude Code

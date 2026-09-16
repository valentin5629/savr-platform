# Rapport export dev-facing

Mode : AGGRESSIVE (T1+T2)
**Total : 2059058 -> 1994411 octets (-64647, -3.1%)**


## 00 - Index.md
- octets : 120217 -> 110810 (-9407, -7.8%)
- tokens estimes : ~30054 -> ~27702
- tombstones supprimes : 0 | fragments barres retires : 12 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## 00 - Scoping V1.md
- octets : 6629 -> 6629 (-0, -0.0%)
- tokens estimes : ~1657 -> ~1657
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## 01 - Vision et objectifs.md
- octets : 17652 -> 17590 (-62, -0.4%)
- tokens estimes : ~4413 -> ~4397
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 02 - Personas et cas d'usage.md
- octets : 22885 -> 22715 (-170, -0.7%)
- tokens estimes : ~5721 -> ~5678
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 03 - Périmètre fonctionnel global.md
- octets : 26617 -> 25860 (-757, -2.8%)
- tokens estimes : ~6654 -> ~6465
- tombstones supprimes : 0 | fragments barres retires : 6 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L181: - **Supprimé revue sobriété §08 A1 2026-05-01** (confort UX pur, ≤4 users cumul concernés)
    L187: **Supprimé revue sobriété §08 A1 2026-05-01** — pas d'endpoint dédié, donc pas de CORS spé

## 04 - Data Model.md
- octets : 311270 -> 296083 (-15187, -4.9%)
- tokens estimes : ~77817 -> ~74020
- tombstones supprimes : 30 | fragments barres retires : 36 | en-tetes debarres : 7
- lignes historiques T2 supprimees : 3
- ⚠ tombstones en prose a revoir a la main :
    L57: - → supprimé, contacts relogés sur `evenements.contact_principal_*` + `contact_secours_*` 
    L62: - → supprimé (non utilisé en pratique, le téléphone seul suffit le jour J — si besoin V1.1
    L77: → **Colonne `attribuee_source` SUPPRIMÉE V1** *(sobriété M01 B_M01_04 + D_M01_03 — 2026-04
    L1775: **Renommé `montant_fixe_ht` (refonte 2026-05-26)**, puis **renommé `prix_base_ht` (M1.3)**

## 05 - Règles métier.md
- octets : 120771 -> 116411 (-4360, -3.6%)
- tokens estimes : ~30192 -> ~29102
- tombstones supprimes : 3 | fragments barres retires : 19 | en-tetes debarres : 3
- lignes historiques T2 supprimees : 3
- ⚠ tombstones en prose a revoir a la main :
    L1045: | Publication rapport post-collecte | Batch J+1 à 6h (embargo H+24 strict) | Rapport non a
    L1258: - : **supprimée V1 (décision Val 2026-06-15)** — type `alerte_ops_pesee_anormale` seedé ma

## 07 - Architecture technique.md
- octets : 29767 -> 28757 (-1010, -3.4%)
- tokens estimes : ~7441 -> ~7189
- tombstones supprimes : 1 | fragments barres retires : 5 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 08 - APIs et intégrations.md
- octets : 128022 -> 122550 (-5472, -4.3%)
- tokens estimes : ~32005 -> ~30637
- tombstones supprimes : 6 | fragments barres retires : 19 | en-tetes debarres : 1
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L15: 5. **Tranché V1 = polling J+1 3h uniquement (revue sobriété §08 App 2026-05-31 B1)** — web
    L289: - **Supprimé 2026-05-29 (décision Val)** : trop de risque de collecte « fantôme acceptée »
    L571: - → **sans objet V1** (pas de webhook entrant). Conservé pour activation V1.1/V2 : header 
    L1169: - **Event-driven par défaut** *(polling supprimé revue sobriété 2026-05-01 Bloc A A4 — ret
    L1183: - **Supprimés revue sobriété 2026-05-01 Bloc A A4** — retry 3 paliers + dédup `integration
    L1187: - **Supprimé revue sobriété 2026-05-01 Bloc A A1** — bouton sidebar inconditionnel + page 

## 09 - Authentification et permissions.md
- octets : 97151 -> 94930 (-2221, -2.3%)
- tokens estimes : ~24287 -> ~23732
- tombstones supprimes : 0 | fragments barres retires : 11 | en-tetes debarres : 1
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L68: - *(retiré 2026-06-07 F3 — `ops_savr` peut éditer le SIREN transporteur)*
    L69: - *(retiré 2026-06-07 F3 — `ops_savr` peut désactiver un transporteur)*
    L422: | | *(retiré V1 — F6 2026-06-07, fusion = script SQL hors UI, cf. §06.06 §8)* | — | — |

## 10 - Design System.md
- octets : 27204 -> 27041 (-163, -0.6%)
- tokens estimes : ~6801 -> ~6760
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 11 - Dashboards.md
- octets : 29651 -> 28373 (-1278, -4.3%)
- tokens estimes : ~7412 -> ~7093
- tombstones supprimes : 0 | fragments barres retires : 4 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L81: - : **supprimé refonte 2026-05-05** ; **refonte 2026-05-10** : nouveau Bloc 8 ZD/AG = bout

## 12 - Reporting et exports.md
- octets : 49862 -> 46705 (-3157, -6.3%)
- tokens estimes : ~12465 -> ~11676
- tombstones supprimes : 0 | fragments barres retires : 6 | en-tetes debarres : 1
- lignes historiques T2 supprimees : 2

## 13 - Migration depuis Bubble.md
- octets : 14753 -> 14060 (-693, -4.7%)
- tokens estimes : ~3688 -> ~3515
- tombstones supprimes : 0 | fragments barres retires : 4 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 14 - Scalabilité et évolutivité.md
- octets : 11156 -> 11095 (-61, -0.5%)
- tokens estimes : ~2789 -> ~2773
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 15 - Sécurité et conformité.md
- octets : 15819 -> 15675 (-144, -0.9%)
- tokens estimes : ~3954 -> ~3918
- tombstones supprimes : 0 | fragments barres retires : 2 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 16 - Roadmap et priorisation.md
- octets : 13615 -> 13335 (-280, -2.1%)
- tokens estimes : ~3403 -> ~3333
- tombstones supprimes : 0 | fragments barres retires : 4 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L88: - **Retiré V1 (propagation Q10 M05 2026-04-24)** — scheduler + template + trigger email su
    L90: - **Supprimé revue sobriété §08 Bloc A 2026-05-01 A4** — retry 3 paliers (Bloc B B1) + déd
    L134: - **reporté V1.1** (revue sobriété §12 2026-06-03, A1) — V1 : le manager télécharge le PDF

## Adapter MTS-1 (MyTroopers) — relevé as-built Bubble.md
- octets : 14358 -> 14358 (-0, -0.0%)
- tokens estimes : ~3589 -> ~3589
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## CGU Savr V1 - Draft.md
- octets : 27897 -> 27809 (-88, -0.3%)
- tokens estimes : ~6974 -> ~6952
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## Frontière TMS-Ready V1.md
- octets : 12375 -> 12375 (-0, -0.0%)
- tokens estimes : ~3093 -> ~3093
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## Interface logistique_provider V1.md
- octets : 10850 -> 10850 (-0, -0.0%)
- tokens estimes : ~2712 -> ~2712
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## _PENDING - Everest API V1 (à intégrer §08 §3).md
- octets : 5073 -> 5073 (-0, -0.0%)
- tokens estimes : ~1268 -> ~1268
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## 06 - Fonctionnalités détaillées/00 - Index section 06.md
- octets : 3856 -> 3362 (-494, -12.8%)
- tokens estimes : ~964 -> ~840
- tombstones supprimes : 0 | fragments barres retires : 1 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 06 - Fonctionnalités détaillées/01 - Formulaire de programmation de collecte.md
- octets : 58448 -> 55267 (-3181, -5.4%)
- tokens estimes : ~14612 -> ~13816
- tombstones supprimes : 2 | fragments barres retires : 20 | en-tetes debarres : 2
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L42: **Retiré V1 (2026-05-29)** — le pax reste **unique au niveau événement** (`evenements.pax`
    L200: > **Retiré V1 (Sujet 5, propagation 2026-05-26)** — contredisait le récap §3.d. Référence 
    L415: 7. **Retiré V1 (propagation Sujet 4 — type vs taille, 2026-05-26)** — « Autre » est une ca

## 06 - Fonctionnalités détaillées/02 - Templates emails V1.md
- octets : 36076 -> 33562 (-2514, -7.0%)
- tokens estimes : ~9019 -> ~8390
- tombstones supprimes : 0 | fragments barres retires : 22 | en-tetes debarres : 6
- lignes historiques T2 supprimees : 5

## 06 - Fonctionnalités détaillées/03 - Registre réglementaire (UX).md
- octets : 8840 -> 8244 (-596, -6.7%)
- tokens estimes : ~2210 -> ~2061
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 06 - Fonctionnalités détaillées/04 - Espace client traiteur.md
- octets : 98786 -> 94845 (-3941, -4.0%)
- tokens estimes : ~24696 -> ~23711
- tombstones supprimes : 0 | fragments barres retires : 15 | en-tetes debarres : 4
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L56: **Retiré V1 (refonte formulaire unique 2026-05-21)** — l'entrée se fait désormais par un b
    L375: - — **retiré 2026-05-07**, géré par le sélecteur de type ZD / AG en haut de page

## 06 - Fonctionnalités détaillées/05 - Espace client gestionnaire de lieux.md
- octets : 51450 -> 50550 (-900, -1.7%)
- tokens estimes : ~12862 -> ~12637
- tombstones supprimes : 0 | fragments barres retires : 7 | en-tetes debarres : 1
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L515: - : table supprimée refonte 2026-05-05 (synthèses générées à la demande, non archivées)
    L527: - : table supprimée refonte 2026-05-05. Génération synthèse : RLS appliquée via JWT du dem

## 06 - Fonctionnalités détaillées/06 - Back-office Admin Savr.md
- octets : 107351 -> 104215 (-3136, -2.9%)
- tokens estimes : ~26837 -> ~26053
- tombstones supprimes : 6 | fragments barres retires : 13 | en-tetes debarres : 1
- lignes historiques T2 supprimees : 3
- ⚠ tombstones en prose a revoir a la main :
    L461: - — supprimé 2026-05-07 (unification libellé)
    L465: - — **supprimé V1 (revue sobriété 2026-05-30 A1)** : jamais utilisé (ni facturation, ni al
    L1085: - **Fermée 2026-06-07 (F6, tranché Val)** : bouton retiré V1, fusion = script SQL assisté 

## 06 - Fonctionnalités détaillées/08 - Génération et édition facture (Admin).md
- octets : 23362 -> 22601 (-761, -3.3%)
- tokens estimes : ~5840 -> ~5650
- tombstones supprimes : 0 | fragments barres retires : 5 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
    L365: **Clôturé** : reporté V1.1 (2026-05-08, revue de sobriété).
    L366: **Clôturé** : retiré du CDC, pas une décision V1 (2026-05-08, revue de sobriété).

## 06 - Fonctionnalités détaillées/09 - Flux algo attribution AG (Admin).md
- octets : 38794 -> 38302 (-492, -1.3%)
- tokens estimes : ~9698 -> ~9575
- tombstones supprimes : 0 | fragments barres retires : 3 | en-tetes debarres : 1
- lignes historiques T2 supprimees : 2

## 06 - Fonctionnalités détaillées/11 - Espace client agence.md
- octets : 19363 -> 16836 (-2527, -13.1%)
- tokens estimes : ~4840 -> ~4209
- tombstones supprimes : 0 | fragments barres retires : 1 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 07 - Observabilité/00 - Stack retenue.md
- octets : 4961 -> 4961 (-0, -0.0%)
- tokens estimes : ~1240 -> ~1240
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## 07 - Observabilité/01 - Logs business.md
- octets : 6381 -> 6381 (-0, -0.0%)
- tokens estimes : ~1595 -> ~1595
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## 07 - Observabilité/02 - Logs techniques.md
- octets : 6361 -> 6361 (-0, -0.0%)
- tokens estimes : ~1590 -> ~1590
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## 07 - Observabilité/03 - Alertes.md
- octets : 6003 -> 6003 (-0, -0.0%)
- tokens estimes : ~1500 -> ~1500
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## 07 - Observabilité/04 - Dashboards business.md
- octets : 3304 -> 3304 (-0, -0.0%)
- tokens estimes : ~826 -> ~826
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## 07 - Observabilité/05 - Health checks.md
- octets : 3799 -> 3799 (-0, -0.0%)
- tokens estimes : ~949 -> ~949
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## 07 - Observabilité/06 - Audit trail.md
- octets : 5671 -> 5671 (-0, -0.0%)
- tokens estimes : ~1417 -> ~1417
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## 08 - Performance/01 - Volumes attendus.md
- octets : 4546 -> 4461 (-85, -1.9%)
- tokens estimes : ~1136 -> ~1115
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 08 - Performance/02 - SLA par endpoint.md
- octets : 5314 -> 5229 (-85, -1.6%)
- tokens estimes : ~1328 -> ~1307
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 08 - Performance/03 - Cibles techniques transverses.md
- octets : 2731 -> 2646 (-85, -3.1%)
- tokens estimes : ~682 -> ~661
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 08 - Performance/04 - Scenarios de charge.md
- octets : 3221 -> 3136 (-85, -2.6%)
- tokens estimes : ~805 -> ~784
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 08 - Performance/05 - Strategies optimisation.md
- octets : 3530 -> 3445 (-85, -2.4%)
- tokens estimes : ~882 -> ~861
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 08 - Performance/06 - Monitoring perf prod.md
- octets : 2781 -> 2696 (-85, -3.1%)
- tokens estimes : ~695 -> ~674
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## tests/06.01-formulaire-programmation-scenarios.md
- octets : 40291 -> 40248 (-43, -0.1%)
- tokens estimes : ~10072 -> ~10062
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/06.02-templates-emails-scenarios.md
- octets : 30093 -> 29879 (-214, -0.7%)
- tokens estimes : ~7523 -> ~7469
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/06.03-registre-reglementaire-scenarios.md
- octets : 26993 -> 26552 (-441, -1.6%)
- tokens estimes : ~6748 -> ~6638
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/06.04-espace-traiteur-scenarios.md
- octets : 41226 -> 41183 (-43, -0.1%)
- tokens estimes : ~10306 -> ~10295
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/06.05-espace-gestionnaire-lieux-scenarios.md
- octets : 34921 -> 34878 (-43, -0.1%)
- tokens estimes : ~8730 -> ~8719
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/06.06-back-office-admin-scenarios.md
- octets : 49557 -> 49514 (-43, -0.1%)
- tokens estimes : ~12389 -> ~12378
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/06.08-generation-edition-facture-scenarios.md
- octets : 30548 -> 30505 (-43, -0.1%)
- tokens estimes : ~7637 -> ~7626
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/06.09-algo-attribution-ag-scenarios.md
- octets : 33105 -> 33062 (-43, -0.1%)
- tokens estimes : ~8276 -> ~8265
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/06.11-espace-agence-scenarios.md
- octets : 25482 -> 25439 (-43, -0.2%)
- tokens estimes : ~6370 -> ~6359
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/08-apis-integrations-scenarios.md
- octets : 56793 -> 56750 (-43, -0.1%)
- tokens estimes : ~14198 -> ~14187
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/09-rls-app-transverse-scenarios.md
- octets : 26927 -> 26884 (-43, -0.2%)
- tokens estimes : ~6731 -> ~6721
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## tests/11-12-dashboards-reporting-scenarios.md
- octets : 44599 -> 44556 (-43, -0.1%)
- tokens estimes : ~11149 -> ~11139
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## 🧹 Fichiers perimes SUPPRIMES de l'export (--clean)

- 06 - Fonctionnalités détaillées/_RAPPORT-EXPORT.md
- 07 - Observabilité/_RAPPORT-EXPORT.md
- 08 - Performance/_RAPPORT-EXPORT.md
- tests/_RAPPORT-EXPORT.md

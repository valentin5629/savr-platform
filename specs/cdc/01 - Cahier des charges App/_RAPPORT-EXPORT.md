# Rapport export dev-facing

Mode : AGGRESSIVE (T1+T2)
**Total : 900421 -> 867158 octets (-33263, -3.7%)**

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

- octets : 26620 -> 25863 (-757, -2.8%)
- tokens estimes : ~6655 -> ~6465
- tombstones supprimes : 0 | fragments barres retires : 6 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
  L181: - **Supprimé revue sobriété §08 A1 2026-05-01** (confort UX pur, ≤4 users cumul concernés)
  L187: **Supprimé revue sobriété §08 A1 2026-05-01** — pas d'endpoint dédié, donc pas de CORS spé

## 04 - Data Model.md

- octets : 282265 -> 267701 (-14564, -5.2%)
- tokens estimes : ~70566 -> ~66925
- tombstones supprimes : 30 | fragments barres retires : 35 | en-tetes debarres : 7
- lignes historiques T2 supprimees : 3
- ⚠ tombstones en prose a revoir a la main :
  L57: - → supprimé, contacts relogés sur `evenements.contact_principal_*` + `contact_secours_*`
  L62: - → supprimé (non utilisé en pratique, le téléphone seul suffit le jour J — si besoin V1.1
  L77: → **Colonne `attribuee_source` SUPPRIMÉE V1** \*(sobriété M01 B_M01_04 + D_M01_03 — 2026-04
  L1694: **Renommé `montant_fixe_ht` (refonte 2026-05-26)**. **Retirés (refonte 2026-05-26)** — ver

## 05 - Règles métier.md

- octets : 116047 -> 112835 (-3212, -2.8%)
- tokens estimes : ~29011 -> ~28208
- tombstones supprimes : 3 | fragments barres retires : 13 | en-tetes debarres : 2
- lignes historiques T2 supprimees : 3

## 07 - Architecture technique.md

- octets : 28611 -> 27601 (-1010, -3.5%)
- tokens estimes : ~7152 -> ~6900
- tombstones supprimes : 1 | fragments barres retires : 5 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 08 - APIs et intégrations.md

- octets : 110923 -> 105469 (-5454, -4.9%)
- tokens estimes : ~27730 -> ~26367
- tombstones supprimes : 6 | fragments barres retires : 18 | en-tetes debarres : 1
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
  L15: 5. **Tranché V1 = polling J+1 3h uniquement (revue sobriété §08 App 2026-05-31 B1)** — web
  L284: - **Supprimé 2026-05-29 (décision Val)** : trop de risque de collecte « fantôme acceptée »
  L502: - → **sans objet V1** (pas de webhook entrant). Conservé pour activation V1.1/V2 : header
  L1089: - **Event-driven par défaut** \*(polling supprimé revue sobriété 2026-05-01 Bloc A A4 — ret
  L1103: - **Supprimés revue sobriété 2026-05-01 Bloc A A4** — retry 3 paliers + dédup `integration
  L1107: - **Supprimé revue sobriété 2026-05-01 Bloc A A1** — bouton sidebar inconditionnel + page

## 09 - Authentification et permissions.md

- octets : 86733 -> 84563 (-2170, -2.5%)
- tokens estimes : ~21683 -> ~21140
- tombstones supprimes : 0 | fragments barres retires : 10 | en-tetes debarres : 1
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
  L68: - _(retiré 2026-06-07 F3 — `ops_savr` peut éditer le SIREN transporteur)_
  L69: - _(retiré 2026-06-07 F3 — `ops_savr` peut désactiver un transporteur)_
  L404: | | _(retiré V1 — F6 2026-06-07, fusion = script SQL hors UI, cf. §06.06 §8)_ | — | — |

## 10 - Design System.md

- octets : 23904 -> 23741 (-163, -0.7%)
- tokens estimes : ~5976 -> ~5935
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 11 - Dashboards.md

- octets : 24398 -> 23120 (-1278, -5.2%)
- tokens estimes : ~6099 -> ~5780
- tombstones supprimes : 0 | fragments barres retires : 4 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
  L80: - : **supprimé refonte 2026-05-05** ; **refonte 2026-05-10** : nouveau Bloc 8 ZD/AG = bout

## 12 - Reporting et exports.md

- octets : 44713 -> 41556 (-3157, -7.1%)
- tokens estimes : ~11178 -> ~10389
- tombstones supprimes : 0 | fragments barres retires : 6 | en-tetes debarres : 1
- lignes historiques T2 supprimees : 2

## 13 - Migration depuis Bubble.md

- octets : 14753 -> 14060 (-693, -4.7%)
- tokens estimes : ~3688 -> ~3515
- tombstones supprimes : 0 | fragments barres retires : 4 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 14 - Scalabilité et évolutivité.md

- octets : 11135 -> 11074 (-61, -0.5%)
- tokens estimes : ~2783 -> ~2768
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 15 - Sécurité et conformité.md

- octets : 15481 -> 15337 (-144, -0.9%)
- tokens estimes : ~3870 -> ~3834
- tombstones supprimes : 0 | fragments barres retires : 2 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2

## 16 - Roadmap et priorisation.md

- octets : 13605 -> 13325 (-280, -2.1%)
- tokens estimes : ~3401 -> ~3331
- tombstones supprimes : 0 | fragments barres retires : 4 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
  L88: - **Retiré V1 (propagation Q10 M05 2026-04-24)** — scheduler + template + trigger email su
  L90: - **Supprimé revue sobriété §08 Bloc A 2026-05-01 A4** — retry 3 paliers (Bloc B B1) + déd
  L134: - **reporté V1.1** (revue sobriété §12 2026-06-03, A1) — V1 : le manager télécharge le PDF

## Adapter MTS-1 (MyTroopers) — relevé as-built Bubble.md

- octets : 9209 -> 9209 (-0, -0.0%)
- tokens estimes : ~2302 -> ~2302
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## CGU Savr V1 - Draft.md

- octets : 27897 -> 27809 (-88, -0.3%)
- tokens estimes : ~6974 -> ~6952
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1

## Frontière TMS-Ready V1.md

- octets : 10259 -> 10259 (-0, -0.0%)
- tokens estimes : ~2564 -> ~2564
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

## Interface logistique_provider V1.md

- octets : 6702 -> 6702 (-0, -0.0%)
- tokens estimes : ~1675 -> ~1675
- tombstones supprimes : 0 | fragments barres retires : 0 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 0

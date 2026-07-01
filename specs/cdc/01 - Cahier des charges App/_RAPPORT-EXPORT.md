# Rapport export dev-facing

Mode : AGGRESSIVE (T1+T2)
**Total : 299514 -> 284352 octets (-15162, -5.1%)**


## 04 - Data Model.md
- octets : 299514 -> 284352 (-15162, -5.1%)
- tokens estimes : ~74878 -> ~71088
- tombstones supprimes : 30 | fragments barres retires : 35 | en-tetes debarres : 7
- lignes historiques T2 supprimees : 3
- ⚠ tombstones en prose a revoir a la main :
    L57: - → supprimé, contacts relogés sur `evenements.contact_principal_*` + `contact_secours_*` 
    L62: - → supprimé (non utilisé en pratique, le téléphone seul suffit le jour J — si besoin V1.1
    L77: → **Colonne `attribuee_source` SUPPRIMÉE V1** *(sobriété M01 B_M01_04 + D_M01_03 — 2026-04
    L1762: **Renommé `montant_fixe_ht` (refonte 2026-05-26)**, puis **renommé `prix_base_ht` (M1.3)**

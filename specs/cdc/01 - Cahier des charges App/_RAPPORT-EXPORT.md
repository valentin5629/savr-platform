# Rapport export dev-facing

Mode : SUR (T1 seul, T2 detecte)
**Total : 289947 -> 278848 octets (-11099, -3.8%)**


## 04 - Data Model.md
- octets : 289947 -> 278848 (-11099, -3.8%)
- tokens estimes : ~72486 -> ~69712
- tombstones supprimes : 30 | fragments barres retires : 35 | en-tetes debarres : 7
- ⚠ tombstones en prose a revoir a la main :
    L57: - → supprimé, contacts relogés sur `evenements.contact_principal_*` + `contact_secours_*` 
    L62: - → supprimé (non utilisé en pratique, le téléphone seul suffit le jour J — si besoin V1.1
    L77: → **Colonne `attribuee_source` SUPPRIMÉE V1** *(sobriété M01 B_M01_04 + D_M01_03 — 2026-04
    L1704: **Renommé `montant_fixe_ht` (refonte 2026-05-26)**, puis **renommé `prix_base_ht` (M1.3)**
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

# Rapport export dev-facing

Mode : SUR (T1 seul, T2 detecte)
**Total : 87867 -> 87408 octets (-459, -0.5%)**


## 09 - Authentification et permissions.md
- octets : 87867 -> 87408 (-459, -0.5%)
- tokens estimes : ~21966 -> ~21852
- tombstones supprimes : 0 | fragments barres retires : 10 | en-tetes debarres : 1
- ⚠ tombstones en prose a revoir a la main :
    L68: - *(retiré 2026-06-07 F3 — `ops_savr` peut éditer le SIREN transporteur)*
    L69: - *(retiré 2026-06-07 F3 — `ops_savr` peut désactiver un transporteur)*
    L404: | | *(retiré V1 — F6 2026-06-07, fusion = script SQL hors UI, cf. §06.06 §8)* | — | — |
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Draft V1 — mise à jour architecturale 2026-04-23 (atelier tech avec
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-06-11 (**Audit RLS V1 post-35 patchs (skill `cdc
    L34 [addendum-date]: ## ⚠ Addendum 2026-04-23 (seconde salve M01) — Policies cross-schema prestataire

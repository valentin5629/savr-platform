# Rapport export dev-facing

Mode : SUR (T1 seul, T2 detecte)
**Total : 131337 -> 127158 octets (-4179, -3.2%)**


## 08 - APIs et intégrations.md
- octets : 131337 -> 127158 (-4179, -3.2%)
- tokens estimes : ~32834 -> ~31789
- tombstones supprimes : 6 | fragments barres retires : 19 | en-tetes debarres : 1
- ⚠ tombstones en prose a revoir a la main :
    L15: 5. **Tranché V1 = polling J+1 3h uniquement (revue sobriété §08 App 2026-05-31 B1)** — web
    L289: - **Supprimé 2026-05-29 (décision Val)** : trop de risque de collecte « fantôme acceptée »
    L573: - → **sans objet V1** (pas de webhook entrant). Conservé pour activation V1.1/V2 : header 
    L1172: - **Event-driven par défaut** *(polling supprimé revue sobriété 2026-05-01 Bloc A A4 — ret
    L1186: - **Supprimés revue sobriété 2026-05-01 Bloc A A4** — retry 3 paliers + dédup `integration
    L1190: - **Supprimé revue sobriété 2026-05-01 Bloc A A1** — bouton sidebar inconditionnel + page 
- 🕓 blocs historiques T2 detectes (non supprimes ; relancer --aggressive apres revue) :
    L3 [meta-changelog]: **Statut** : Draft V1 — mise à jour architecturale 2026-04-23 (atelier tech avec
    L4 [meta-changelog]: **Dernière mise à jour** : 2026-05-08 (refonte enums Plateforme — `lieux.station
    L9 [addendum-date]: ## ⚠ Addendum 2026-04-23 — Impacts atelier
    L19 [addendum-date]: ## ⚠ Addendum 2026-04-23 (seconde salve M01) — Simplification contrat API TMS

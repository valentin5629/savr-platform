# Rapport export dev-facing

Mode : AGGRESSIVE (T1+T2)
**Total : 662485 -> 630461 octets (-32024, -4.8%)**

## 04 - Data Model TMS.md

- octets : 289030 -> 270738 (-18292, -6.3%)
- tokens estimes : ~72257 -> ~67684
- tombstones supprimes : 52 | fragments barres retires : 70 | en-tetes debarres : 7
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
  L336: - → retiré (W11 dégagée A1 2026-04-30)
  L353: - — **supprimée Bloc 6 sobriété 2026-04-28 C3**
  L427: **Retiré V1 (revue sobriété §04 2026-04-30 A6)** — colonne supprimée. Lookup via `everest_
  L778: - → **Supprimé revue sobriété §05 2026-05-01 D2** (valeur enum supprimée, cas impossible p
  L802: | `action`| text | NOT NULL | Enum simplifié (sobriété A3 2026-04-30) :`ajustement_cree`  L1203: - **Supprimé (revue sobriété 2026-04-29, purge F3 2026-06-07)**
  L1677: **Colonnes addendum supprimées** (2026-04-28 — fusion mapping) : , , , .
  L1841: - **Retiré V1 (revue sobriété §04 2026-04-30 A3)** — info dérivée de`integrations_logs`v
  L1941: **Index** :`(prestataire_id) WHERE deleted_at IS NULL`, `(telephone)`, `(user_tms_id)`UN
  L2034: **Index** :`(prestataire_id) WHERE deleted_at IS NULL`, `(plaque_canonique)` UNIQUE WHERE
  L2924: - supprimée 2026-06-07 — jamais en vigueur, remplacée par le mapping départemental ci-dess
  L2942: - **Paramètre retiré V1 (propagation suppression saisie plaque terrain 2026-06-04)** — plu

## 05 - Règles métier TMS.md

- octets : 124008 -> 118798 (-5210, -4.2%)
- tokens estimes : ~31002 -> ~29699
- tombstones supprimes : 3 | fragments barres retires : 34 | en-tetes debarres : 10
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
  L250: **Retiré V1 (propagation M07 2026-04-24 D5)**.
  L1287: - (statut `ackee` retiré Bloc 6 B2)

## 08 - Contrat API Plateforme-TMS.md

- octets : 103684 -> 98707 (-4977, -4.8%)
- tokens estimes : ~25921 -> ~24676
- tombstones supprimes : 5 | fragments barres retires : 28 | en-tetes debarres : 6
- lignes historiques T2 supprimees : 2
- ⚠ tombstones en prose a revoir a la main :
  L207: - **Champ payload supprimé revue sobriété Bloc B 2026-05-01 B3** — header HTTP `X-API-Vers
  L231: - **Supprimé revue sobriété Bloc B 2026-05-01 B3** — la "double ceinture" était un artefac
  L968: | `statut`| enum **3 valeurs** (post-revue sobriété §08 Bloc D 2026-05-01 D6) :`traite`
  L1077: 3. **Résolu revue sobriété 2026-05-01 A4** — endpoints`/sync/poll` supprimés des deux côt
  L1085: - supprimés revue sobriété 2026-05-01 A4

## 09 - Authentification et permissions TMS.md

- octets : 117636 -> 114315 (-3321, -2.8%)
- tokens estimes : ~29409 -> ~28578
- tombstones supprimes : 0 | fragments barres retires : 33 | en-tetes debarres : 3
- lignes historiques T2 supprimees : 2
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

## 11 - Dashboards TMS.md

- octets : 28127 -> 27903 (-224, -0.8%)
- tokens estimes : ~7031 -> ~6975
- tombstones supprimes : 0 | fragments barres retires : 3 | en-tetes debarres : 0
- lignes historiques T2 supprimees : 1
- ⚠ tombstones en prose a revoir a la main :
  L131: **Détection cumul** : **Supprimé revue sobriété §08 A1 2026-05-01** — confort UX pur (≤4 u

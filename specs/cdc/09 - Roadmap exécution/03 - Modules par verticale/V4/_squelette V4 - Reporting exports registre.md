# Squelette V4 — Reporting, exports & registre réglementaire ZD

> Briefs détaillés générés juste-à-temps avant exécution V4. 1er usage réel du transverse **D** (exports CSV) — le poser ici dans `packages/shared` (sauf si déjà posé en V3 pour les exports espace traiteur, auquel cas réutiliser).

**Dépend de** : Niveau 0, V1, V2.

| Module | Périmètre | Sources `_DEV-FACING/` | Tests | Budget (≈) |
|---|---|---|---|---|
| M4.1 — Exports CSV (transverse D) | Exports collectes/événements/pesées/factures + packs AG + associations bénéficiaires AG + impact RSE consolidé (matrice §12 §2 hors « Courses logistiques » = tms.* V2), tous profils, filtrés par RLS — **décision Val 2026-06-19 (M4.1/D1)** | §12 | `tests/11-12-...` | M ~450k |
| M4.2 — Registre réglementaire ZD | UX registre = collectes **`cloturee` seules + ZD only** (F2), export CSV + ZIP bordereaux (enum `format` csv\|zip\|pdf, F1), flag `historique_partiel` (F3) | §06/03, §05 | `tests/06.03-...` | M ~500k |
| M4.3 — Reporting CO₂ ADEME | ZD induit/évité/net + AG évité (2,5 kgCO₂e/repas), **snapshot figé** | §04, §11, §12, §05 | `tests/11-12-...` | M ~400k |

**Hors scope V1** : export PDF registre formaté (V1.1), reporting REP/Citeo (V1.1/V2), benchmark client UI (V2).
**Ordre** : M4.1 → M4.2 → M4.3.
**Budget V4 ≈ 1,4M.**

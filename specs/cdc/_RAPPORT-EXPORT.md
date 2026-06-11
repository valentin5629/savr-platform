# Rapport export dev-facing — racine consolidée

**Régénération complète** : 2026-06-11 (mode AGGRESSIVE, après run SÛR validé)
**Déclencheur** : audit data models + audit coherence-inter-cdc du 2026-06-11 (Vault source modifié → \_DEV-FACING périmé)

## Contrôles source pré-régénération (tous PASS)

- Contrôle 1 — `shared.audit_logs` : 0 usage actif. Les 4 mentions restantes (App §04, §09, §13 + TMS §04) sont des **notes de doctrine** affirmant que la table n'existe pas (dissolution → `plateforme.audit_log` + `tms.audit_logs`). Conforme audit cohérence 2026-06-11.
- Contrôle 2 — §08 TMS Contrat API : poids `numeric(7,2)` en **kg** (L321, réaligné 2026-06-11) ; enum exposé `statut_tournee` = **4 valeurs avec `terminee`** (L303, ex-`realisee`). Marqueurs « réaligné 2026-06-11 » présents = source = version à jour.
- Contrôle 3 — `08 - savr-api-contracts` : `node validate.mjs` → **21/21** OK.

## Résultat régénération

- **64 fichiers code-facing** régénérés (manifest curé identique à l'export précédent), 7 dossiers.
- Invariants harnais : **0 erreur**, **0 barré résiduel**, **0 fichier stale** hors manifest.
- Sentinelles anti-régression présentes : **10 - Design System.md** ✅ + **Adapter MTS-1 … as-built Bubble.md** ✅.
- Nettoyage : 203 tombstones de tableau supprimés, 640 fragments barrés retirés, 93 en-têtes débarrés, 224 lignes méta-changelog T2 retirées (--aggressive).
- Gain : ~728 700 → ~691 200 tokens estimés (**~-37 500 tokens, -5,1 %**).

## Réserve (drift mineur source, NON corrigé — Vault jamais modifié)

- §08 TMS `08 - Contrat API…` : 2 exemples illustratifs utilisent encore `realisee` au lieu de `terminee` pour le statut **tournée** — L610 (exemple payload S3) et L736 (vue SQL `v_courses_logistiques` sur `tms.tournees`, `WHERE t.statut IN ('realisee','annulee')`). La table enum canonique (L303) et les JSON Schemas (21/21) sont corrects. À corriger côté source lors d'une prochaine session CDC.

## Détail par dossier

Voir le `_RAPPORT-EXPORT.md` de chaque sous-dossier.

# Savr — Monorepo Plateforme (V1)

Monorepo pnpm + Turborepo. Périmètre V1 = Plateforme Savr + couche logistique MTS-1 (polling) + Everest.
Le TMS natif est V2 (`packages/tms` = gabarit vide, schéma `tms.*` non créé en V1).

## Structure
- `packages/plateforme` — front Next.js + API routes (app.gosavr.io)
- `packages/tms` — gabarit V2 (vide en V1)
- `packages/shared` — types et utilitaires partagés
- `packages/adapters` — adapters logistiques (MTS-1, Everest) derrière `logistique_provider`
- `supabase/` — migrations + tests pgTAP
- `.claude/` — harnais qualité (hooks + agents reviewers)

## Harnais qualité (lire avant de coder)
Le harnais déplace chaque consigne critique du texte vers un mécanisme qui l'impose.
- Hooks locaux (`.claude/`) : commit rouge bloqué, commandes destructives bloquées, format auto.
- Gates CI (`.github/workflows/quality.yml`) : re-vérif serveur, hors de portée de l'agent.
- `DEFINITION_OF_DONE.md`, `RUNBOOK_INCIDENT.md`, `CHECKLIST_CHECKPOINT.md`.
- Branch protection `main` : voir `BRANCH_PROTECTION.md`.

## Commandes
```
pnpm install
pnpm -w typecheck
pnpm -w lint
pnpm -w test:unit
pnpm -w build
```

> CLAUDE.md (contexte produit + règles non-négociables) est à la racine du repo. Le lire en priorité.

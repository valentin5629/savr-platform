# Branch protection `main` — à appliquer dans GitHub → Settings → Branches

Rend l'enforcement indépendant de l'agent (re-vérif serveur, pas contournable en local).

## Règles sur `main`
- [ ] Require a pull request before merging — **push direct interdit**
- [ ] Require approvals : **1** minimum
- [ ] Require status checks to pass : `lint-typecheck-test`, `anti-coupling`, `pgtap-rls-outbox`, `security`, `migrations`, `migration-timestamp`
      (ajouter `e2e`, `bundle-budget` quand stables)
      - `anti-coupling` = garde-fou 3 TMS-Ready (0 réf directe MTS-1/Everest hors `packages/adapters/`)
      - `pgtap-rls-outbox` = RLS (rôle `authenticated`) **+** garde-fou 4 TMS-Ready (outbox par mutation)
      - `migration-timestamp` = anti-collision de préfixe `YYYYMMDDHHMMSS`, **y compris avec une branche en vol non mergée** — le hook pré-commit ne compare qu'au dossier de sa propre branche et ne peut pas voir ce cas
- [ ] Require branches to be up to date before merging
- [ ] Require conversation resolution before merging
- [ ] Do not allow bypassing the above settings (inclure les admins)
- [ ] Block force pushes

## Privilèges agent (Claude Code)

> ⚠ **Régime temporaire en vigueur** (décision Val 2026-09-03, cf. `CLAUDE.md` §11/§12) — **tant qu'aucun client réel n'est en production**. Dès le premier client réel : basculer sur le **régime cible** ci-dessous et retirer ce régime temporaire (ici et dans `CLAUDE.md`).

### Régime temporaire (en vigueur)
- [ ] Token / compte Claude Code = rôle **write** (jamais admin/maintain). Merge sur `main` **uniquement par PR** : checks verts + gate-pr (GO `reviewer-conformite-spec` + `reviewer-rls-securite` sur le SHA). Jamais de bypass, jamais `--admin`, jamais de force push.
- [ ] Secrets prod (`PROD_DIRECT_URL`) fournis par Val, uniquement dans `.env.local` (hors repo, gitignoré) — jamais dans le repo, une PR ou un log. Sauvegarde prod avant toute migration, stockée hors repo (`~/savr-backups/`).
- [ ] Migration Supabase prod appliquée par Claude Code aux conditions de `CLAUDE.md` §12 : non destructive, CI verte + gate-pr, sauvegarde préalable, annonce à Val. **Toute migration qui ouvre ou élargit un accès (GRANT à `anon`/`authenticated`/`PUBLIC`, policy plus permissive, RLS désactivée, `SECURITY DEFINER` sans REVOKE, hook JWT / triggers anti-escalade) → STOP, Val.**

### Régime cible (dès le premier client réel en production)
- [ ] Token / compte Claude Code = rôle **write** (jamais admin/maintain) : push sur branches, **pas** de merge sur `main`, pas de bypass
- [ ] Aucune clé `service_role` prod ni secret prod accessible en env de dev de l'agent
- [ ] Migration Supabase prod = manuelle (Val + frère après revue du diff SQL)

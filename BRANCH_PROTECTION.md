# Branch protection `main` — à appliquer dans GitHub → Settings → Branches

Rend l'enforcement indépendant de l'agent (re-vérif serveur, pas contournable en local).

## Règles sur `main`
- [ ] Require a pull request before merging — **push direct interdit**
- [ ] Require approvals : **1** minimum
- [ ] Require status checks to pass : `lint-typecheck-test`, `anti-coupling`, `pgtap-rls-outbox`, `security`, `migrations`
      (ajouter `e2e`, `bundle-budget` quand stables)
      - `anti-coupling` = garde-fou 3 TMS-Ready (0 réf directe MTS-1/Everest hors `packages/adapters/`)
      - `pgtap-rls-outbox` = RLS (rôle `authenticated`) **+** garde-fou 4 TMS-Ready (outbox par mutation)
- [ ] Require branches to be up to date before merging
- [ ] Require conversation resolution before merging
- [ ] Do not allow bypassing the above settings (inclure les admins)
- [ ] Block force pushes

## Privilèges agent (Claude Code)
- [ ] Token / compte Claude Code = rôle **write** (jamais admin/maintain) : push sur branches, **pas** de merge sur `main`, pas de bypass
- [ ] Aucune clé `service_role` prod ni secret prod accessible en env de dev de l'agent
- [ ] Migration Supabase prod = manuelle (Val + frère après revue du diff SQL)

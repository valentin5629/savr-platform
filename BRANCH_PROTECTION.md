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
- [x] Require branches to be up to date before merging — **DÉJÀ ACTIF** (`required_status_checks.strict = true`,
      vérifié le 2026-09-22 par `gh api repos/:owner/:repo/branches/main/protection`). La branche est donc bien forcée
      à jour avant merge, et la CI se rejoue sur la vraie cible.
- [ ] **`migration-timestamp` dans `required_status_checks.contexts` — C'EST LA PIÈCE QUI MANQUE.**
      Contexts requis au 2026-09-22 : `anti-coupling`, `detect-prereqs`, `lint-typecheck-test`, `security`.
      `migration-timestamp` et `pgtap-rls-outbox` tournent mais **ne sont pas requis** : leur rouge ne bloque rien.
      Conséquence : la branche est à jour, le job voit le désordre, et le merge passe quand même.
      Vécu le 2026-09-21 (PR #373) — 8 commits sur `main` pendant une seule revue, dont 3 migrations postérieures
      à celle du lot. Une migration mal ordonnée fait ensuite échouer tout `supabase db push` (exit 1), et le seul
      remède du CLI, `--include-all`, applique AUSSI les migrations en attente des autres lots : fermer `lieux` en
      prod a exigé d'en appliquer 8, dont 7 d'autres lots, deux en attente depuis 4 jours.
      Commande (droits admin requis, donc Val — le token agent est `write`) :
      ```bash
      gh api -X PATCH repos/valentin5629/savr-platform/branches/main/protection/required_status_checks \
        -f 'contexts[]=anti-coupling' -f 'contexts[]=detect-prereqs' -f 'contexts[]=lint-typecheck-test' \
        -f 'contexts[]=security' -f 'contexts[]=migration-timestamp' -f 'contexts[]=pgtap-rls-outbox'
      ```
      Côté Claude Code, `.claude/hooks/gate-merge.sh` couvre déjà le cas (contrôle (C) de
      `check-migration-timestamp.sh --merge`). Mais c'est un `PreToolUse(Bash)` : il ne voit ni les merges depuis
      l'UI GitHub, ni `gh pr merge --auto` (qui merge plus tard, côté serveur), ni un `gh pr merge` tapé dans un
      terminal ordinaire. **Rendre le job requis est le seul filet qui couvre ces chemins.**
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

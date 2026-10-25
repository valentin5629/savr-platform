# Branch protection `main` — à appliquer dans GitHub → Settings → Branches

Rend l'enforcement indépendant de l'agent (re-vérif serveur, pas contournable en local).

## Règles sur `main`

> **État relevé le 2026-10-08** par `gh api repos/valentin5629/savr-platform/branches/main/protection`
> (relevé précédent : 2026-09-22, qui ne comptait que 4 status checks requis).
> Les `[x]` ci-dessous sont **constatés actifs**, pas souhaités.
> Restent inactifs : `required_approving_review_count` vaut **0** (donc « Require approvals : 1 » n'est pas
> tenu) et « Require conversation resolution ».
> ⚠ Ne pas cocher une case sans l'avoir relevée : une case fausse fait croire un trou fermé.

- [x] Require a pull request before merging — **push direct interdit** (actif : `required_pull_request_reviews` présent, `dismiss_stale_reviews: true`)
- [ ] Require approvals : **1** minimum — ⚠ `required_approving_review_count` = **0** au 2026-10-08 : NON tenu
- [x] Require status checks to pass — **8 checks requis** (`required_status_checks.contexts` au 2026-10-08) :
      `anti-coupling`, `detect-prereqs`, `lint-typecheck-test`, `security`, `gate-ratchet`, `migration-timestamp`,
      `pgtap-rls-outbox`, `migrations`. Les autres jobs de `quality.yml` tournent sans être requis (dont `e2e`, à
      ajouter quand il sera stable ; le budget du bundle est une étape du job `build`).
      - `lint-typecheck-test` = agrégateur (depuis le 2026-10-25) de `statique` (format, typecheck, lint), `unit`
        (suite Vitest complète en 2 parts) et `build` (build sans variables d'environnement + budget du bundle) — le
        filet des gardes locales de commit et de PR. Il tourne toujours (`!cancelled()`) et vérifie lui-même que les
        trois sont « success » : un job requis sauté parce qu'une dépendance a échoué compterait comme « Success »
      - `anti-coupling` = garde-fou 3 TMS-Ready (0 réf directe MTS-1/Everest hors `packages/adapters/`)
      - `pgtap-rls-outbox` = la seule base de la CI (depuis le 2026-10-25) : application de toutes les migrations sur
        base neuve, puis RLS (rôle `authenticated`) **+** garde-fou 4 TMS-Ready (outbox par mutation) **+** oracles G9
        et integration-contracts (sortis du mode rapport, décision Val C3)
      - `migrations` = garde anti-destructif des migrations nouvelles (sans base depuis le 2026-10-25 ; l'application
        des migrations est faite par `pgtap-rls-outbox`)
      - Étapes sautées selon les fichiers de la PR (depuis le 2026-10-25, `scripts/ci-perimetre.sh`) : le job reste
        joué et rend son statut ; la base ne démarre que si `supabase/`, `.github/` ou `scripts/` changent, build et e2e
        sont sautés pour une PR de specs / docs / fixtures / supabase / .claude / .md. Sens sûr : hors PR, ou fichiers
        illisibles, tout tourne
      - La CI ne tourne plus sur `push: main` (décision Val 2026-10-25, C2) : avec `strict: true`, l'arbre fusionné est
        celui que le passage de la PR a testé
      - `migration-timestamp` = anti-collision de préfixe `YYYYMMDDHHMMSS`, **y compris avec une branche en vol non mergée** — le hook pré-commit ne compare qu'au dossier de sa propre branche et ne peut pas voir ce cas
      - `pgtap-rls-outbox` et `migrations` sont joués **sans condition** depuis le 2026-10-08. Ils portaient un
        `if: has_migrations` hérité du module 0.1 : un job requis sauté par son `if` rend le statut « Success »
        (documentation GitHub), il serait donc passé sans rien contrôler
- [x] Require branches to be up to date before merging — actif (`required_status_checks.strict = true`). La branche
      est forcée à jour avant merge, et la CI se rejoue sur la vraie cible.
- [x] **`migration-timestamp` et `pgtap-rls-outbox` dans les checks requis** — posé (absents du relevé du 2026-09-22,
      où ils tournaient sans bloquer : c'était alors « la pièce qui manque »).
      Pourquoi c'est requis : le 2026-09-21 (PR #373), 8 commits ont atterri sur `main` pendant une seule revue, dont
      3 migrations postérieures à celle du lot. Une migration mal ordonnée fait ensuite échouer tout
      `supabase db push` (exit 1), et le seul remède du CLI, `--include-all`, applique AUSSI les migrations en attente
      des autres lots : fermer `lieux` en prod a exigé d'en appliquer 8, dont 7 d'autres lots, deux en attente depuis
      4 jours.
      Côté Claude Code, `.claude/hooks/gate-merge.sh` couvre le même cas (contrôle (C) de
      `check-migration-timestamp.sh --merge`). Mais c'est un `PreToolUse(Bash)` : il ne voit ni les merges depuis
      l'UI GitHub, ni `gh pr merge --auto` (qui merge plus tard, côté serveur), ni un `gh pr merge` tapé dans un
      terminal ordinaire. **Le job requis est le seul filet qui couvre ces chemins.**
- [ ] Require conversation resolution before merging
- [x] Do not allow bypassing the above settings (inclure les admins) — actif (`enforce_admins: true`)
- [x] Block force pushes — actif (`allow_force_pushes: false`)
- [x] Require linear history — actif (`required_linear_history: true`)
- [x] Interdire la suppression de la branche — actif (`allow_deletions: false`)

Un ruleset `main protection` (id 17409079, actif, sans acteur de contournement) double cette protection sur la
branche par défaut — relevé le 2026-10-08 par `gh api repos/valentin5629/savr-platform/rulesets/17409079` : pas de
suppression, pas de push non fast-forward, PR obligatoire avec **0** approbation requise. Il n'ajoute aucun status
check.

Modifier ces règles demande des droits d'administration sur le dépôt
(`gh api -X PATCH repos/valentin5629/savr-platform/branches/main/protection/required_status_checks …`).
Après toute modification : relever de nouveau, puis mettre ce document à jour avec la date.

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

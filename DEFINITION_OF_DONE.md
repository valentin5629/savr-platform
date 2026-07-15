# Definition of Done — Savr

Un module n'est "fini" que si TOUS les items applicables sont cochés.

## Générique (tout module)
- [ ] `pnpm test --filter <module>` vert ; couverture des règles métier critiques ne baisse pas
- [ ] typecheck, lint, build verts
- [ ] pgTAP des tables du module vert SOUS rôle authenticated
- [ ] Tous les scénarios Gherkin P1 du module verts
- [ ] reviewer-principal : GO ; reviewer-rls-securite : GO (si tables touchées)
- [ ] Aucun secret en dur, aucun TODO/FIXME laissé
- [ ] CLAUDE.md mis à jour si nouveau terme métier ; Journal divergence à jour si fix structurel
- [ ] Scénario démo du module rejouable

## API endpoint inter-apps
- [ ] Conforme au contrat §08 (payload, version d'en-tête, dédup body.event_id, retry policy)
- [ ] Tests de contrat contre les payloads de référence
- [ ] RLS + auth vérifiées sur la route

## UI / écran
- [ ] États vide / chargement / erreur implémentés
- [ ] Permissions par rôle respectées (le bon rôle voit/édite le bon périmètre)
- [ ] Vocabulaire FR du glossaire respecté
- [ ] **Preuve visuelle (R0c / L5)** : pour TOUT livrable présentationnel (badge statut, timeline `audit_log`, watermark/contenu PDF, e-mail rendu, tokens Design System, alerte in-app), **screenshot ou Loom < 10 s joint en commentaire de PR**. Aucun script ne « voit » un rendu → un livrable `statut='à-vérifier'` au manifeste reste **À VÉRIFIER MANUELLEMENT** (jamais GO implicite) tant que la preuve n'est pas jointe. Catalogue auto : `pnpm check:preuve-visuelle`. Discipline GO-VISUAL du reviewer `reviewer-conformite-spec`. **Non mergeable sans.**

## Batch / cron
- [ ] Idempotent (rejouable sans double effet)
- [ ] Refuse de tourner si NODE_ENV=production sur un job de seed
- [ ] Émet les logs/events d'observabilité prévus

## Migration
- [ ] Backward-compat (ADD COLUMN nullable/default, pas de DROP destructif)
- [ ] Nommage conforme + down-migration / rollback documenté

## Merge & nettoyage (fusion vers main — anti-dette de branches/worktrees)
> Cause de la dette : le squash-merge coupe le lien d'ancêtre (`git branch --merged` ne voit pas les branches mergées) → sans nettoyage, chaque lot laisse une branche locale ET distante. Trois mécanismes, du plus structurant au filet de sécurité.
- [ ] **Couche 1 (structurel, une fois)** : GitHub `delete_branch_on_merge` activé (repo Settings → « Automatically delete head branches ») → la branche **distante** est supprimée à chaque merge.
- [ ] **Couche 2 (par merge)** : merge en squash avec suppression de branche — `gh pr merge <n> --squash --delete-branch` (supprime la branche **locale ET distante**). Merge via l'UI GitHub = même effet grâce à la couche 1.
- [ ] **Couche 3 (par session)** : worktree du lot démonté depuis le clone principal après merge — `git worktree remove <wt>`. Jamais deux sessions sur le même clone.
- [ ] **Couche 4 (filet, début de session suivante)** : `pnpm git:hygiene` (fetch --prune + `git worktree prune` + purge des branches locales `[gone]`). Émis automatiquement dans le bloc SETUP par le skill `cdc-next-lot-prompt`. Aucune branche/worktree de lot mergé ne doit s'accumuler.

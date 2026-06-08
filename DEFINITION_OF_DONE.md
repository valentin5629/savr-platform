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

## Batch / cron
- [ ] Idempotent (rejouable sans double effet)
- [ ] Refuse de tourner si NODE_ENV=production sur un job de seed
- [ ] Émet les logs/events d'observabilité prévus

## Migration
- [ ] Backward-compat (ADD COLUMN nullable/default, pas de DROP destructif)
- [ ] Nommage conforme + down-migration / rollback documenté

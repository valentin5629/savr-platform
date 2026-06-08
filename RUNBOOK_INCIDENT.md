# Runbook incident / rollback par module — Savr

## Détection
- CI rouge sur `main`, OU régression remontée par l'agent QA (mode module), OU bug client.

## Décision (qui tranche)
- Val + frère. Critère de rollback immédiat : régression sur un parcours P1 (auth, programmation
  collecte, facturation, contrat API) OU fuite de données cross-organisation.

## Action de rollback localisé
1. Identifier le merge commit du module fautif : `git log --merges --oneline`
2. `git revert -m 1 <merge_commit>` → PR de revert → CI verte → merge
3. Si migration appliquée : exécuter la down-migration correspondante (jamais à la main en prod
   sans revue du SQL)
4. Re-déployer ; relancer l'agent QA mode module sur le périmètre touché
5. Vérifier que les modules antérieurs sont de nouveau verts

## Trace
| Date | Module | Symptôme | Cause racine | Correctif | Temps résolution |
|------|--------|----------|--------------|-----------|------------------|
|      |        |          |              |           |                  |

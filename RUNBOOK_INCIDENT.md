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

## Auth JWT Hook — Activation manuelle (module 0.5)

La fonction `plateforme.fn_custom_access_token` enrichit le JWT avec les claims
`role`, `organisation_id`, `organisation_type`, `app_domain='plateforme'`.

**Activation dans le Dashboard Supabase :**

1. Ouvrir le projet Supabase (dev ou prod)
2. Settings → Auth → Hooks
3. Section "Custom Access Token" → activer
4. Sélectionner la fonction `plateforme.fn_custom_access_token`
5. Sauvegarder

**Vérification :** après connexion, décoder le JWT (jwt.io) et vérifier la présence
des claims `role`, `organisation_id`, `app_domain`.

**Rollback hook :** Settings → Auth → Hooks → désactiver "Custom Access Token".
Les JWT suivants seront émis sans claims custom (middleware renverra 401 si
`app_domain` absent — comportement attendu en dev, à gérer en prod via désactivation
de la route protégée avant rollback hook).

---

## Trace
| Date | Module | Symptôme | Cause racine | Correctif | Temps résolution |
|------|--------|----------|--------------|-----------|------------------|
|      |        |          |              |           |                  |

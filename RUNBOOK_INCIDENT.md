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

## Déblocage DLQ outbox (events `dead`) — R9

Un event outbox en statut `dead` **bloque son agrégat** (head-of-line par collecte :
seul un event `done` libère). Sans déblocage, un E1 mort empêche à jamais E2/E3 de
la même collecte de partir (ex. E1 mort → E3 annulation jamais poussée → camion sur
une collecte annulée). Symptôme : alerte Slack `#savr-alerts-critique` `[DLQ]`, et
collecte bloquée en `non_envoye`/`dirty_tms`.

**Qui :** `admin_savr` uniquement (les RPC valident via `f_assert_audit_context` :
auteur `admin_savr` actif + **motif ≥ 5 caractères**). Toute action est tracée dans
`audit_log` (`action = outbox_requeue|outbox_skip|outbox_resolve`, `motif`).

**Identifier l'event mort :**
```sql
SELECT id, aggregate_id, event_type, attempts, last_error, processed_at
FROM plateforme.outbox_events
WHERE statut = 'dead' ORDER BY seq;
```

**3 actions (toutes en service-role, `p_auteur` = id de l'admin, `p_motif` obligatoire) :**

1. **Re-queue** — redonner une chance au worker (MTS-1 rétabli). Remet `pending`,
   `attempts = 0`, **`requires_reconciliation = true`** (réconciliation OBLIGATOIRE
   avant tout re-POST, §08 §3bis.9 — jamais de doublon MTS-1) :
   ```sql
   SELECT plateforme.fn_admin_requeue_outbox('<event_id>', '<admin_id>', 'MTS-1 rétabli, nouvelle tentative');
   ```
2. **Skip motivé** — abandonner l'event devenu sans objet (ex. collecte annulée
   depuis). Passe `done` → **débloque l'agrégat** sans rien pousser :
   ```sql
   SELECT plateforme.fn_admin_skip_outbox('<event_id>', '<admin_id>', 'Collecte annulée entre-temps, E1 sans objet');
   ```
3. **Resolve manuel** — l'effet a été réalisé manuellement côté MTS-1 (commande
   créée/annulée par téléphone). Passe `done` + `consumer = 'manual'` :
   ```sql
   SELECT plateforme.fn_admin_resolve_outbox('<event_id>', '<admin_id>', 'Commande créée manuellement côté MTS-1');
   ```

Garde-fous : ces RPC n'agissent que sur un event **`dead`** (sinon erreur `22023`) ;
un motif < 5 caractères → `22023` ; un auteur non `admin_savr` → `42501`.

---

## Trace
| Date | Module | Symptôme | Cause racine | Correctif | Temps résolution |
|------|--------|----------|--------------|-----------|------------------|
|      |        |          |              |           |                  |

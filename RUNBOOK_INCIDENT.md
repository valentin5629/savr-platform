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

⚠ Ni le skip ni le resolve ne touchent aux lignes `tournees`. Toute modification
ultérieure de la collecte (ordre `collecte.modifiee`, y compris une modification
faite par le client) crée chez MTS-1 la commande et la tournée unitaire des
rangs qui n'en ont pas, dès qu'au moins un rang de la collecte a une commande.
Si ce camion a été commandé à la main chez MTS-1, il serait commandé une seconde
fois. Aucun geste de l'application ne l'évite : après un resolve manuel d'un
ordre de création, faire aligner par un développeur la ligne `tournees` du rang
(`external_ref_commande` = identifiant de la commande MTS-1) AVANT toute
modification de la collecte. La référence de la tournée peut rester vide : à la
modification suivante, l'adapter relit la commande et reprend sa tournée sans en
créer d'autre, ni la sortir d'une tournée où l'Admin l'a placée.

⚠ Faire cet alignement AVANT de rendre la main à l'équipe Ops (décision Val
2026-10-20). Après un resolve, la fiche collecte Admin ne trouve plus d'ordre
dans la file : tant que la collecte n'a pas de référence, elle affiche
« Non envoyé » et propose « Envoyer à MTS-1 » en bouton principal. Sans
alignement, ce clic émet un nouvel ordre de création, donc une seconde commande
chez MTS-1. Aligné, il émet une modification à la place
(`fn_collecte_commandee_chez_provider`), à quatre conditions : la ligne
`tournees` du rang existe (l'adapter ne la crée qu'après une commande réussie :
un ordre mort avant tout envoi n'en a pas, le développeur la crée), elle est
liée à la collecte par `collecte_tournees`, elle porte `external_ref_commande`
= identifiant de la commande MTS-1, et son `prestataire_logistique_id` est
celui d'un transporteur MTS-1.

⚠ L'index `uniq_tournee_par_tms_reference` (migration `20261013210000`) refuse
toujours (erreur `23505`) d'écrire sur une ligne `tournees` une référence de
tournée qu'une AUTRE ligne porte déjà. Une tournée regroupée par l'Admin
pouvant porter plusieurs collectes, ne pas y écrire de référence à la main pour
les relier — le remonter à Val.

⚠ Ordre de création en échec définitif avec le message « … est déjà terminée
chez MTS-1 … — ni reprise ni nouvelle création » : une commande du même numéro
est terminée ou archivée chez MTS-1. Le remettre en file répète l'arrêt.
Vérifier la collecte chez MTS-1 avant tout geste ; un skip ou un resolve laisse
les lignes `tournees` telles quelles (voir les notes ci-dessus).

⚠ Même effet, à la reprise de la tournée d'une commande déjà enregistrée :
« … est déjà terminée | refusée ou annulée chez MTS-1 (STATUT) — tournée ni
reprise ni créée », ou « commande introuvable chez MTS-1 pour le rang N (…) —
tournée non créée » (une commande annulée n'est plus rendue par MTS-1). Le
remettre en file répète l'arrêt : vérifier la collecte chez MTS-1 d'abord.

Garde-fous : ces RPC n'agissent que sur un event **`dead`** (sinon erreur `22023`) ;
un motif < 5 caractères → `22023` ; un auteur non `admin_savr` → `42501`.

---

## Trace
| Date | Module | Symptôme | Cause racine | Correctif | Temps résolution |
|------|--------|----------|--------------|-----------|------------------|
|      |        |          |              |           |                  |

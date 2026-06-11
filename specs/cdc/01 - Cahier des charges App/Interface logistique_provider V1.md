# Interface `logistique_provider` V1

**Créé** : 2026-06-10 (challenge Frontière TMS-Ready — garde-fou 3 : l'interface était exigée partout, spécifiée nulle part ; sans cette page, l'implémentation serait calquée sur le flux MyTroopers 4 étapes = wrapper cosmétique).
**Localisation code** : `packages/adapters/` (interface + implémentations). **Aucune** référence `mts1`/`everest`/`mytroopers`/`customerOrders` hors de ce package (check `anti-coupling` CI).
**Principe de conception** : la frontière n'est PAS le protocole réseau (garde-fou 2). Côté sortant, le provider **consomme les events outbox** ; côté entrant, il **écrit les tables cibles Plateforme**. Le code métier ne connaît ni les endpoints, ni les statuts, ni les ids du système externe.

---

## 1. Implémentations et sélection

| Implémentation      | `transporteurs.type_tms`           | Version                                                                                                                                                 |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapter_mts1`      | `mts1` (Strike, Marathon)          | **V1**                                                                                                                                                  |
| `adapter_everest`   | `a_toutes` (A Toutes!, vélo cargo) | **V1.1** (gate Everest 2026-06-08 — ne PAS coder pour le go-live)                                                                                       |
| `provider_manual`   | `autre`                            | **V1** — no-op : aucune action API, l'event outbox est marqué `consumed` avec `consumer='manual'`, le dispatch réel = email/téléphone Ops (§08 §3bis.1) |
| `adapter_tms_natif` | (cutover V2)                       | V2 — swap par factory, cf. esquisse cohabitation                                                                                                        |

**Factory** : `getLogistiqueProvider(transporteur)` → lit `type_tms`, retourne l'implémentation. Seul endroit (hors adapters) où les valeurs de l'enum apparaissent — allowlisté.

## 2. Contrat — côté sortant (consommation outbox)

Le worker outbox (**lease/claim — l'advisory lock est supprimé**, incompatible PgBouncer transaction mode + serverless ; cf. §04 `outbox_events`, refonte 2026-06-11 revue adversariale R2) claim les events éligibles et appelle le provider de la collecte/du lieu concerné. **Une méthode par event_type** :

| Event outbox                     | Méthode                              | Effet attendu (postconditions Plateforme)                                                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1 `collecte.creee`              | `dispatchCollecte(collecte, rang→N)` | Pour chaque camion `rang=1..nb_camions_demande` : commande créée chez le provider, ligne `tournees` créée (`external_ref_commande`, `tms_reference`, `type_vehicule`, plaque si résoluble) + ligne `collecte_tournees` ; `statut_tms = attribuee_en_attente_acceptation` |
| E2 `collecte.modifiee`           | `updateCollecte(collecte)`           | Re-push des champs modifiés sur les commandes existantes (corrélation `external_ref_commande`) ; reset `dirty_tms = false` (fait par la RPC émettrice)                                                                                                                   |
| E3 `collecte.annulee`            | `cancelCollecte(collecte)`           | Commandes/tournées annulées chez le provider (contrainte < 1h MTS-1 → erreur typée `CANCEL_WINDOW_CLOSED`, traitement Ops manuel)                                                                                                                                        |
| E5 `lieu.champ_critique_modifie` | `updateLieu(lieu)`                   | Répercussion adresse/coords sur les commandes **futures** (lecture DB à la consommation — pas de re-push des commandes en vol sauf si E2 suit)                                                                                                                           |

**Règles transverses sortantes** _(durcies 2026-06-11, revue adversariale R3/R4/R8/R11)_ :

- **Idempotence** : ne jamais créer si `external_ref_commande IS NOT NULL` pour ce rang (§08 §3bis.5/3bis.9 — MTS-1 présumé NON idempotent, tranché Val 2026-06-11). Retry géré par le worker (3 paliers 5 min/1h/24h), PAS par le provider — le provider est sans état et lève des erreurs typées.
- **Commit par rang** : chaque création réussie persiste immédiatement sa ligne `tournees` (`external_ref_commande`) avant le rang/l'étape suivante — jamais de persistance groupée en fin d'event. Reprise au **curseur par rang** (§08 §3bis.5).
- **Réconciliation avant re-POST** : event repris avec `requires_reconciliation=true` (crash/timeout ambigu) → vérification d'existence distante (§3bis.9) **obligatoire avant** toute création.
- **Erreurs typées** (l'interface expose, le worker route) : `PERMANENT` (4xx données → pas de retry, notif Admin), `TRANSIENT` (5xx/réseau → retry paliers), `AMBIGUOUS` (timeout sans réponse → pas de retry auto, réconciliation au prochain run avant tout re-POST).
- **No-op succès** : `updateCollecte`/`cancelCollecte` sur une collecte sans aucune `external_ref_commande` (E1 skippé DLQ ou jamais parti) = consumed `consumer='noop_no_remote'`, log info — jamais d'erreur (symétrique `provider_manual`).
- **État courant DB** : le provider lit l'état DB **à la consommation** (le payload outbox sert au routage + contrat V2) — anti-staleness vs éditions concurrentes (R11).
- Le provider **ne touche jamais** à `collectes.statut` (dérivé par trigger de `statut_tms` — exception unique : l'effet terminal agrégé du `sync`, §3).

## 3. Contrat — côté entrant (sync)

| Méthode                | Déclencheur                    | Effet attendu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync(fenetre)`        | Cron 15 min 24/7 (§08 §3bis.7) | Lit l'état distant et **écrit les tables cibles** : `statut_tms` (mapping interne au provider, ex. 3bis.6), pesées brutes → **`pesees_tournees`** (upsert clé `(tournee_id, stop_id, flux_id)` — table créée 2026-06-11, INC-0), photos → R2 + `shared.fichiers`, plaque/chauffeur → `tournees`, horodatages réels. Dédup via `integrations_inbox` en **claim atomique** `ON CONFLICT DO NOTHING RETURNING` (3bis.7, R10 — pas de verrou global de poll, traitement isolé par collecte). Poids divergent sur collecte `cloturee` → aucune écriture + alerte Ops (3bis.7, R7). |
| (agrégation terminale) | Interne à `sync`               | Quand tous les tours `rang=1..N` d'une collecte sont terminaux : transaction `FOR UPDATE` sur `collectes`, relecture `collecte_tournees`+`nb_camions_demande` sous lock, agrégat `pesees_tournees` → `collecte_flux` (recalcul complet), transition **gardée** `WHERE statut IN ('validee','en_cours')` (no-op si déjà fait — §05 R_statut_collecte_multi_tournees, R5/R6)                                                                                                                                                                                                    |

**Le mapping statuts externes → `statut_tms` est PRIVÉ au provider** (table 3bis.6 pour MTS-1). Le code métier ne voit que l'enum `statut_tms` à 8 valeurs.

## 4. Ce que l'interface n'expose JAMAIS

- Notions MyTroopers : customerOrder, tour, dispatch/validate, carrierShareableCode, stuffs — invisibles hors `packages/adapters/`.
- Statuts externes bruts (`PLANNED`, `IN_PROGRESSION`, `KO`…).
- Endpoints, hosts, auth (clé Vault lue par l'adapter seul).

**Test de conception** (à vérifier en revue) : la signature de l'interface doit être implémentable telle quelle par `adapter_tms_natif` V2 (event-driven webhooks) **sans changer une seule ligne du code métier ni du worker** — seul `sync()` devient un no-op/filet quand les webhooks S1-S11 poussent en temps réel.

## 5. Liens

- [[Frontière TMS-Ready V1]] (garde-fous 2, 3, 4)
- [[04 - Data Model]] (`outbox_events`, `tournees`, `collecte_flux`, `pesees_tournees`)
- [[08 - APIs et intégrations]] §3bis (flux MTS-1), §3 (Everest V1.1)
- `04 - Migration/08 - Esquisse cohabitation V1 vers V2.md` (swap V2)

# Frontière TMS-Ready V1

**Date** : 2026-06-05 (fork V1, skill `cdc-v1-scoping`)

> Ce document liste les contraintes que la V1 (Plateforme + MTS-1 + Everest) doit respecter pour que le branchement du **Savr TMS natif en V2** soit un **swap d'adapter**, pas une refonte.
> Chaque garde-fou est **BLOQUANT** pour `cdc-readiness-check` (DEV V1) et (PROD V1).

---

## Garde-fou 1 — Data model V1 ⊂ data model complet

**Règle** : Aucune table V1 n'a un schéma divergent du CDC complet (archive). On peut **omettre** des colonnes (NULL / non émises) ou **ne pas activer** une table, **jamais** créer une structure qui sera renommée/migrée en V2.

**Tables V1 actives (schéma = archive, aucune divergence)** : `organisations`, `users`, `lieux`, `evenements`, `collectes`, `collecte_tournees` (N↔N, alimentée par adapter MTS-1), `transporteurs` (+ `code_transporteur_mts1` actif V1), `packs_antgaspi`, `grilles_tarifaires_zd`, `tarifs_negocie` (remises %), `factures_collectes`, `factures`, `bordereaux_savr`, `attestations_don`, `parametres_facteurs_co2*`, `integrations_inbox`, `integrations_logs`, `audit_log` + référentiels. (Liste autoritative : `04 - Data Model.md`.)

**Tables désactivées V1 mais schéma conservé** :

- Schéma `tms.*` (toutes tables TMS natif) : **non créées V1** (MTS-1 fait le dispatch). Schéma figé dans `02 - Cahier des charges TMS/04 - Data Model TMS.md` pour V2.
- **Module 19** (6 tables + `evenements.statut_brief` / `template_brief_id` / `rapports_rse.type_rapport`) : **non créées V1** (audit sobriété §04 2026-05-25). Spec conservée §04 Niveau 6.

**Ajouts V1 forward-compatibles** _(complété 2026-06-10, challenge Frontière)_ : tables `outbox_events` (cf. garde-fou 4) et `jobs_pdf` (file PDF, §04 2026-06-10) — absentes de l'archive, ajouts neutres non destructifs pour V2, **présents dans le DDL cible**.

**Colonnes V1-only assumées** _(ajout 2026-06-10 — exception explicite à la règle « jamais un champ temporaire », toutes présentes dans le DDL cible, à neutraliser/déprécier au cutover V2, cf. garde-fou 5)_ : `collectes.nb_camions_demande` (N décidé par Ops en V1, par le TMS en V2 — omission inverse), `transporteurs.code_transporteur_mts1`, `associations.id_point_collecte_mts1`, **table `plateforme.pesees_tournees`** _(ajout 2026-06-11, revue adversariale INC-0 — pesées brutes par tour alimentées par l'adapter MTS-1, source de l'agrégation terminale ; dormante en V2 où le TMS agrège lui-même et pousse le S5 agrégé)_. **Liste fermée** — tout nouveau champ V1-only doit être ajouté ici ET au DDL cible, sinon = divergence.

**Check de validation** : diff schéma V1 ↔ **DDL cible gelé** (`_DDL-CIBLE-V2/schema_cible_v2.sql`) → **uniquement omissions, jamais divergences de type/nom**. ⚠ **Corrigé 2026-06-10** : les vues cross-schema `v_courses_logistiques` / `v_stocks_rolls` ne sont **PAS créées en V1** (elles SELECT des tables `tms.*` inexistantes ; une vue ne s'« alimente » pas). Conséquence actée : Dashboard Admin Bloc 3 Coûts descopé V1.1 (décision Val 2026-06-10, cf. §11) ; stocks rolls = pas d'affichage V1.

---

## Garde-fou 2 — La frontière V2 est le data model interne, PAS le contrat wire

> ⚠ **Révisé 2026-06-05 (relevé Bubble réel)** : l'ancienne version supposait que la V1 implémentait le contrat webhook S1-S11 du §08, consommé par un adapter MTS-1 « faux-TMS ». **C'est faux.** L'intégration réelle (relevé Bubble) est en **POLLING** (cf. `Adapter MTS-1 (MyTroopers) — relevé as-built Bubble`). Garde-fou reformulé en conséquence.

**Règle** : Ce qui doit rester stable entre V1 et V2 n'est **pas** le contrat réseau, mais la **représentation cible interne** — les tables Plateforme (`collectes`, lignes de pesées, `statut_tms`, `tournees`, photos via `shared.fichiers`) et l'`outbox_events`. L'adapter V1 et le TMS V2 doivent **alimenter les mêmes tables avec la même sémantique**.

**En V1 — adapter MTS-1 (MyTroopers) en POLLING** (zone jetée au cutover V2) :

- **Entrant** : cron qui poll `GET /v3/customerOrders?minDate&maxDate`, `GET /v3/customerOrders/{id}`, `GET /v3/tours/{id}` (pesées = `stops[].weight`), télécharge les photos via `GET {photo_URL}`, puis **mappe vers les tables cibles**.
- **Sortant** : `POST /v3/customerOrders` (+ Create/Dispatch/Validate tour) déclenchés depuis l'`outbox_events`.
- **Auth** : client-credentials (`POST gateway.mytroopers.com/v2/auth/token`), Bearer en Vault.

**En V2 — TMS Savr natif** (event-driven) implémente le **contrat §08** (`02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS.md`) : 12 endpoints (E1/E2/E3/E5 + S1/S2/S3/S4/S5/S7/S9/S11) + 2 vues cross-schema, `X-API-Version 2026.04`, retry 3 paliers, dédup `integrations_inbox` 7j. **Ce contrat est gelé maintenant comme cible V2** ; il n'est pas un livrable V1.

**Conséquence** : le swap V1 → V2 = remplacer l'adapter polling par le TMS natif **derrière la même interface `logistique_provider`** (garde-fou 3), sans toucher au code métier ni aux tables.

**Check de validation** :

- V1 : l'adapter écrit dans les tables cibles ; un jeu de tests vérifie le mapping `champs MyTroopers → tables Plateforme` (pesées, statuts, photos).
- V2-ready : aucune colonne « MyTroopers-spécifique » dans les tables métier (cf. garde-fou 5, `external_ref_commande`). Le contrat §08 reste validable en isolation contre ses JSON Schemas (`08 - savr-api-contracts/`).

---

## Garde-fou 3 — Couche d'abstraction logistique obligatoire

**Règle** : La Plateforme V1 **ne parle jamais directement** à MTS-1 ou Everest depuis le code métier. Elle parle à une interface `logistique_provider` qui aura deux implémentations : `adapter_mts1` (V1) et `adapter_tms_natif` (V2).

**Spec de l'interface** _(ajout 2026-06-10, challenge Frontière — l'interface n'était spécifiée nulle part)_ : **[[Interface logistique_provider V1]]** — contrats de méthodes, mapping events outbox → méthodes, règles d'erreur/idempotence. À respecter pour que l'adapter ne soit pas un wrapper cosmétique calqué sur le flux MyTroopers.

**Conséquence code** :

- Toute logique business référence `logistique_provider`, **jamais** `mts1_client` ni `everest_client`
- Le swap V1 → V2 = changer une **factory / variable d'env**, rien d'autre dans le code métier
- Sélection du provider par `transporteurs.type_tms` — **valeurs réelles de l'enum (corrigé 2026-06-10, alignement §04/DDL cible ; ex « mts1/everest » erroné)** : `mts1` (Strike/Marathon → adapter_mts1), `a_toutes` (Everest, A Toutes! vélo cargo → adapter_everest, **V1.1** gate 2026-06-08), `autre` (dispatch manuel email/téléphone → provider no-op `manual`, aucun appel API)

**Check de validation** : `grep` dans le code → **aucune référence directe** à `mts1`, `everest`, `mytroopers` ou `customerOrders` hors du module `packages/adapters/` (câblé : `check-coupling.sh` + allowlist + job CI `anti-coupling`). Règle d'allowlist _(précisée 2026-06-10)_ : labels UI, valeurs d'enum DB, noms de logs = tolérés ; **logique conditionnelle métier par provider = interdit** (doit passer par l'interface).

---

## Garde-fou 4 — Events métier émis dès V1

**Règle** : Tous les events que le TMS V2 consommera (les **entrants** du contrat, Plateforme → TMS) sont émis par la Plateforme V1 et **persistés dans une table `outbox_events`**, même si en V1 seul l'adapter MTS-1 les consomme.

**Events V1 émis et persistés** : E1 (`collecte.creee`), E2 (`collecte.modifiee`), E3 (`collecte.annulee`), E5 (`lieu.champ_critique_modifie`).

**Mécanisme** : table `outbox_events` (`id`, `event_type`, `payload jsonb`, `aggregate_id`, `created_at`, `consumed_at NULL en V1`, `consumer`). L'adapter MTS-1 lit l'outbox et POST vers MTS-1 V3 ; en V2 l'adapter TMS natif lira le **même** stream. Pattern transactional outbox (l'event est écrit dans la même transaction que la mutation métier → zéro perte).

**Check de validation** : pour chaque action métier qui doit générer un event (création/modif/annulation collecte, modif champ critique lieu), un test vérifie qu'une ligne `outbox_events` est créée dans la transaction.

> ✅ **Ajout data model V1 fait (audit RLS V1 2026-06-05)** : table `outbox_events` créée dans `04 - Data Model.md` (niveau intégrations, après `integrations_inbox`) + policy RLS `SERVICE_ROLE` only (§09 §3ter A2). Forward-compatible V2.

---

## Garde-fou 5 — Migration data préparée double étape

**Règle** : Le plan de migration V1 (Bubble + MTS-1 → Plateforme V1) doit **déjà prévoir la phase 2** (cohabitation TMS V2 ↔ Plateforme V2). Aucun schéma V1 ne force une migration destructive en V2.

**Conséquences** :

- **Champs FK vers les futures tables `tms.*`** = `NULL` en V1, jamais des champs ad-hoc renommables
- **Identifiants logistiques stables** _(naming corrigé 2026-06-10, challenge Frontière — l'ex `external_ref_logistique` n'existait dans aucun data model)_ : on **ne stocke pas** d'ID interne MTS-1 en dur dans les tables métier. La référence neutre est **`tournees.external_ref_commande`** (= customerOrderId MTS-1 en V1, id commande TMS natif en V2 — §04). Exceptions cantonnées et dépréciées au cutover : `transporteurs.code_transporteur_mts1` **et `associations.id_point_collecte_mts1`** (placeId favori MTS-1, ajouté à la liste 2026-06-10). `tournees.tms_reference` / `collectes.tms_reference` changent de référent au cutover (tourId MTS-1 → id TMS natif) : traitement défini dans l'esquisse cohabitation.
- **Plan migration V1 → V2 esquissé** : **`04 - Migration/08 - Esquisse cohabitation V1 vers V2.md`** _(créé 2026-06-10, challenge Frontière — le livrable annoncé dans `13 - Migration depuis Bubble.md` n'existait pas)_.

**Check de validation** : revue du plan migration V2 (esquissé) **avant début dev V1** — livrable : `04 - Migration/08 - Esquisse cohabitation V1 vers V2.md`.

---

## Récapitulatif des checks bloquants (readiness V1)

| #   | Garde-fou                      | Check automatisable                                                                                         |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 1   | Data model ⊂ archive           | diff schéma → omissions only                                                                                |
| 2   | Frontière = data model interne | V1 : tests mapping MyTroopers→tables cibles ; contrat §08 gelé comme cible V2 (validable en isolation, Ajv) |
| 3   | Abstraction logistique         | `grep` → 0 réf `mts1`/`everest` hors `adapters/`                                                            |
| 4   | Outbox events                  | test ligne `outbox_events` par mutation métier                                                              |
| 5   | Migration non destructive      | revue plan migration V2 esquissé                                                                            |

# G1 — Convergence des 7 ENUM divergents par VALEURS / TYPE (lot résiduel)

> Suite du lot de **renommage** (PR #83, commit `87f9e75`, migration `20260623100000`) qui a
> convergé 24 **noms** d'enums purs vers le DDL cible figé. Restent **7 enums** où le nom **et**
> les valeurs / le type divergent. Les traiter mécaniquement casserait des données ou de la
> logique métier → stratégie **par enum**, en 3 clusters + l'outbox en sous-lot dédié.
>
> ⚠️ **PROD EST LIVE AVEC DES DONNÉES.** `enum → text` via `USING col::text` est **sans perte** ;
> en revanche **retirer une valeur** ou **ajouter un CHECK** échoue si des lignes portent une
> valeur hors cible. → Toujours `SELECT count(*)` par valeur **sur prod** AVANT.
>
> Source de vérité cible : `specs/ddl-cible/schema_cible_v2.sql` (FIGÉ, DÉRIVÉ — ne jamais éditer).
> Procédure G1 : `specs/ddl-cible/README.md`. Règles : `CLAUDE.md` §2 / §3bis / §4.

## Statut d'exécution

| Cluster    | Enum                                                      | Action                                       | Statut                                                         |
| ---------- | --------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| **A**      | `serie_facturation_enum`                                  | → `text`                                     | ✅ **EXÉCUTÉ** (migration `20260623110000`)                    |
| **A**      | `job_statut_enum`                                         | → `text` + CHECK                             | ✅ **EXÉCUTÉ** (migration `20260623110000`)                    |
| **B**      | `pack_statut_enum`                                        | retirer `expire`                             | ⏸ **DÉCISION VAL REQUISE** — non codé                          |
| **B**      | `facture_statut_enum`                                     | retirer `envoyee`,`en_retard`                | ⏸ **DÉCISION VAL REQUISE** — non codé                          |
| **B**      | `email_statut_enum`                                       | valeurs disjointes (re-modélisation)         | ⏸ **DÉCISION PRODUIT VAL REQUISE** — non codé                  |
| **C**      | `document_statut_enum` (`documents_generaux_savr.statut`) | colonne absente du cible                     | ⏸ **DÉCISION VAL REQUISE** — non codé                          |
| **Outbox** | `outbox_statut_enum` (`outbox_events.statut`)             | rename colonne `statut→status` + `enum→text` | ⏸ **SOUS-LOT DÉDIÉ** — décision Val, plan ci-dessous, non codé |

Carte des dépendances confirmée par introspection live (chaque enum = **une seule** colonne porteuse) :

```
pack_statut_enum        → packs_antgaspi.statut       (DEFAULT 'actif')
facture_statut_enum     → factures.statut             (DEFAULT 'brouillon')
email_statut_enum       → emails_envoyes.statut       (DEFAULT 'queued')
outbox_statut_enum      → outbox_events.statut        (DEFAULT 'pending')
job_statut_enum         → jobs_pdf.statut             (DEFAULT 'queued')   [cluster A]
serie_facturation_enum  → sequences_facturation.serie (PK, pas de DEFAULT) [cluster A]
document_statut_enum    → documents_generaux_savr.statut (DEFAULT 'en_attente')
```

> **Note** : `document_statut_enum` portait historiquement aussi `bordereaux_savr.statut` et
> `attestations_don.statut`, mais ces deux colonnes ont **déjà** été converties vers
> `bordereau_statut` / `attestation_statut` (migrations M1.6 `20260614160000` et M2.4
> `20260615250000`). Aujourd'hui `document_statut_enum` ne sert **plus que**
> `documents_generaux_savr.statut`.

---

## ⚠️ Comptes prod : à collecter par Val/frère (accès prod interdit depuis dev — CLAUDE.md §11)

Les comptes **locaux** sont tous à **0** (les 7 tables porteuses sont vides en seed local) → non
significatifs. **Avant tout déploiement d'un cluster B/C ou de l'outbox**, exécuter ces requêtes
**sur la base de prod** et reporter les comptes dans la colonne « décision » ci-dessous :

```sql
-- À exécuter sur PROD (lecture seule)
SELECT 'pack',     statut::text v, count(*) FROM plateforme.packs_antgaspi        GROUP BY 2
UNION ALL SELECT 'facture',  statut::text, count(*) FROM plateforme.factures      GROUP BY 2
UNION ALL SELECT 'email',    statut::text, count(*) FROM plateforme.emails_envoyes GROUP BY 2
UNION ALL SELECT 'outbox',   statut::text, count(*) FROM plateforme.outbox_events  GROUP BY 2
UNION ALL SELECT 'job_pdf',  statut::text, count(*) FROM plateforme.jobs_pdf       GROUP BY 2
UNION ALL SELECT 'doc_gen',  statut::text, count(*) FROM plateforme.documents_generaux_savr GROUP BY 2
ORDER BY 1, 2;
```

---

## CLUSTER A — exécuté (sûr, sans décision Val)

### A.1 — `serie_facturation_enum` → `text` (le plus sûr)

- **V1** : `ENUM('ZD_COLLECTE','ZD_MENSUEL','AG_MENSUEL','AVOIR','FZD','FAG','FPK','AV','BSAV','ATTDON')`.
- **Cible** : `sequences_facturation.serie text` (pas d'enum). `text` = surensemble → **aucune valeur perdue**.
- **Colonne** : composant de PK `(serie, annee)` — aucune FK ne la référence ; changer le type d'une
  colonne de PK est OK (l'index PK est reconstruit automatiquement).
- **Dépendances du type** (introspection `pg_depend`) : la colonne **+ 2 fonctions** qui portent le type
  en **argument** : `f_next_numero_facture(serie_facturation_enum, smallint)` et
  `f_attribuer_numero_facture(serie_facturation_enum, smallint)`. **Aucun corps** de fonction ne
  mentionne le nom du type en texte (vérifié `pg_proc.prosrc` = 0 ligne).
- **Action exécutée** :
  1. `ALTER COLUMN serie TYPE text USING serie::text`.
  2. `DROP` + recréation des 2 fonctions en signature `(text, smallint)` (changer un type d'argument
     change l'identité → `CREATE OR REPLACE` impossible), corps **verbatim** (seul le cast `::text`
     du préfixe devient inutile), **posture sécurité reproduite** : `REVOKE EXECUTE … FROM PUBLIC`
     - `GRANT EXECUTE … TO service_role` + `SECURITY DEFINER` + `SET search_path` (fix M1.7
       `20260615000200`).
  3. `DROP TYPE serie_facturation_enum`.
- **Impact app** : transparent. Les callers TS appellent les RPC en passant une **chaîne**
  (`'FZD'`/`'FAG'`/…, cf. `validation-admin.ts`) → texte accepté à l'identique. La validation de
  l'ensemble des séries autorisées vit déjà côté app (modèle cible : `text` contrôlé applicativement).

### A.2 — `job_statut_enum` → `text` + CHECK

- **V1** : `ENUM('queued','processing','done','failed','retrying','pending','dead')` ; colonne
  `jobs_pdf.statut` `DEFAULT 'queued'`.
- **Cible** : `statut text NOT NULL DEFAULT 'pending' CHECK (statut IN ('pending','processing','done','failed','dead'))`.
  → `queued` et `retrying` **en trop** ; le `DEFAULT 'queued'` est lui-même hors cible.
- **Sécurité données** : les 3 sites d'`INSERT` (triggers PDF : attestation, bordereau, fix CO₂)
  posent **tous** `statut = 'pending'` explicitement ; le worker (`pdf-worker.ts`) écrit
  `processing|done|failed|dead`. Donc `queued`/`retrying` sont des valeurs **héritées non écrites
  par le code courant** → en pratique 0 ligne, mais **non garanti sur prod**.
- **GARDE-FOU intégré à la migration** : un bloc `DO` lève une `EXCEPTION` claire si une ligne porte
  une valeur hors cible (`queued`/`retrying`). Sur prod, si ça lève → **STOP, mapping manuel Val**
  (`queued`→`pending`, `retrying`→`failed`/`pending`) avant de rejouer. La migration ne corrompt
  jamais : elle s'arrête net.
- **Dépendances** (introspection) : la colonne + son DEFAULT + **1 vue** `v_ops_jobs_pdf` + **2 index
  partiels** dont les prédicats castent l'enum :
  - `idx_jobs_pdf_anti_dupe` (UNIQUE) `WHERE statut IN ('pending','processing')` → valeurs cible, swap texte direct.
  - `idx_jobs_pdf_queued` `WHERE statut IN ('queued','retrying')` → prédicat **uniquement** sur les 2
    valeurs retirées (jamais écrites par le worker). Reconstruit sur l'ensemble retriable **valide
    sous la nouvelle CHECK** = `('pending','failed')` (= ce que `pdf-worker.ts` scanne réellement,
    `retrying` excepté car inexistant). Nom conservé pour limiter le diff.
- **`v_ops_jobs_pdf`** : recréée avec prédicats `text` (sans `queued`). **`security_invoker = true`
  restauré** : la migration `20260613120000` l'avait posé (vue ops lisant une table RLS), puis M1.6
  l'a **accidentellement perdu** en faisant `DROP VIEW … CREATE VIEW …`. Fonctionnellement inerte
  (seul `service_role`, qui bypass RLS, lit la vue) mais rétablit la posture documentée.
- **Action exécutée** : garde-fou → drop vue + 2 index → `DROP DEFAULT` / `TYPE text` / `SET DEFAULT 'pending'`
  / `ADD CHECK` → `DROP TYPE` → recréation des 2 index (text) + vue (text, `security_invoker`).
- **TS inchangé** : `pdf-worker.ts` filtre `('pending','failed','retrying')` — `retrying` ne matchera
  plus jamais (0 ligne), aucun cassage.

---

## CLUSTER B — réconciliation de VALEURS (⏸ DÉCISION VAL REQUISE — non codé)

> Retirer une valeur d'un enum impose de **recréer le type** (Postgres ne sait pas `DROP VALUE`) :
> créer le type cible, `ALTER COLUMN … TYPE … USING <mapping>`, `DROP TYPE` ancien, recréer
> index/vues/fonctions dépendants. **Échoue si des lignes portent la valeur retirée** → mapping data requis.

### B.1 — `pack_statut_enum` : retirer `expire`

- **V1** `('actif','epuise','expire','annule')` → **Cible** `('actif','epuise','annule')`.
- **Constat** : la valeur **`expire` n'est référencée NULLE PART** dans la logique (grep SQL+TS : aucun
  `WHERE statut='expire'`, aucun trigger ne l'écrit). Les triggers pack
  (`fn_trg_pack_debit_realisee`, `fn_trg_pack_debit_annulation_tardive`, `fn_trg_pack_recredit`,
  `rpc_annuler_credit_collecte`, `rpc_valider_attribution_ag`) n'utilisent que `actif`/`epuise`.
- **Donc** : valeur définie-mais-morte ; suppression **probablement sans impact logique**.
- **❓ DÉCISION VAL** :
  1. Confirmer le **count prod** `WHERE statut='expire'` (attendu : 0).
  2. Si > 0 : mapper `expire` → `epuise` ou `annule` (sémantique métier ? un pack « expiré » = épuisé
     par le temps, pas par consommation — plutôt un statut terminal). **Tranche métier requise.**
  3. Vérifier qu'**aucun process planifié** (cron d'expiration de packs) ne projette d'écrire `expire`
     à l'avenir (sinon la suppression rouvrira la question). Impact FIFO/annulation §4 à re-confirmer.
- **Code** : recréer `pack_statut` `('actif','epuise','annule')`, `ALTER COLUMN statut` avec
  `USING (CASE WHEN statut='expire' THEN '<mapping>' ELSE statut::text END)::plateforme.pack_statut`,
  drop default → re-set `'actif'`, recréer l'index partiel `WHERE statut='actif'`, recréer les 4
  triggers/RPC qui castent `::pack_statut_enum`. **Ne pas coder avant tranche.**

### B.2 — `facture_statut_enum` : retirer `envoyee`, `en_retard`

- **V1** `('brouillon','envoyee','payee','en_retard','annulee','en_attente_pennylane','emise')`
  → **Cible** `('brouillon','en_attente_pennylane','emise','payee','annulee')`.
- **Constat** : `envoyee` et `en_retard` **sont activement référencées** :
  - `packages/.../admin/dashboard/revenus-organisations/route.ts` : filtre `.in('statut', ['envoyee','payee','en_retard'])`.
  - `packages/.../lib/exports/shared.ts` : libellés d'affichage `envoyee:'Envoyée'`, `en_retard:'En retard'`.
  - `packages/.../tests/api/admin/revenus-organisations.test.ts` : assertion sur ce filtre.
  - `packages/shared/src/seed/minimal.ts` : seed facture `'envoyee'` + audit_log `{"statut":"envoyee"}`.
- **❓ DÉCISION VAL (produit)** : quel **mapping** ?
  - Hypothèse cible : `envoyee` (facture transmise) → **`emise`** ; `en_retard` (impayée échue) → **`emise`**
    (le « retard » devient un état **dérivé** d'`emise` + date d'échéance, pas un statut stocké).
  - À confirmer : le dashboard « revenus » et les exports doivent alors recalculer « en retard » via
    une **date d'échéance** (`emise` + délai dépassé), pas via le statut. Refonte UI/exports requise.
- **Code (après tranche)** : recréer `facture_statut`, `ALTER COLUMN … USING (CASE …)`, recréer
  index/fonctions de facturation castant `::facture_statut_enum`, **+ PR front** alignant
  `revenus-organisations`, `exports/shared.ts`, les tests et les seeds. **Ne pas coder avant tranche.**

### B.3 — `email_statut_enum` : valeurs **disjointes** (re-modélisation produit)

- **V1** `('queued','sent','delivered','bounced','failed')` → **Cible** `('envoye','ouvert','clique','bounce','echec')`.
- **Aucune valeur commune** : ce ne sont pas les mêmes axes —
  V1 = **cycle d'envoi** (file → envoyé → délivré → bounce/échec) ;
  Cible = **engagement Resend** (envoyé → **ouvert** → **cliqué** + bounce/échec).
- **❓ DÉCISION PRODUIT VAL** : ce n'est pas un mapping 1:1 mais un **changement de modèle**.
  - Mapping de transition minimal proposé (à valider) : `queued`/`sent`→`envoye`, `delivered`→`envoye`
    (la cible n'a pas « délivré »), `bounced`→`bounce`, `failed`→`echec`. **`ouvert`/`clique` n'existent
    pas en V1** → nécessitent l'ingestion des webhooks Resend `email.opened`/`email.clicked` (existe ? V1.1 ?).
  - Alternative : garder le modèle V1 en V1 et **ne converger qu'en V1.1** quand le tracking
    ouverture/clic est branché → dans ce cas, **acter `email_statut_enum` comme divergence V1 assumée**
    (fichier `_Divergences/`, type `ambigu`) plutôt que forcer un mapping qui perd de l'information.
- **Ne pas deviner. Ne pas coder avant tranche.** Références : `packages/shared/src/testing/mocks/resend.ts`, seeds.

---

## CLUSTER C — divergence STRUCTURELLE (⏸ DÉCISION VAL REQUISE — non codé)

### C.1 — `documents_generaux_savr.statut` (`document_statut_enum`)

- **V1** : colonne `statut document_statut_enum DEFAULT 'en_attente'`, valeurs `('en_attente','genere','erreur','expire')`.
- **Cible** : la table `documents_generaux_savr` **n'a pas de colonne `statut`** (seulement `type`,
  `titre`, `version`, `pdf_url`, `effective_from/to`, `uploaded_by`, `actif`, `created_at`).
- **Constat** : la colonne **est utilisée** — index dédié `idx_docs_generaux_statut ON (statut)` +
  références RLS/queries `WHERE d.statut='genere'` (helpers `0_4a`, financier `0_4c`). Ce n'est pas une
  colonne morte.
- **❓ DÉCISION VAL (3 options)** :
  1. **Garder en V1-only assumé** : ajouter `documents_generaux_savr.statut` à la **liste fermée des
     colonnes V1-only** (Frontière G1, cf. `nb_camions_demande`, `pesees_tournees`, …) et écrire un
     fichier `_Divergences/` (type `ambigu`). Convergence : juste **renommer le type**
     `document_statut_enum` → un nom sans suffixe `_enum` (le cible n'en a aucun → choisir un nom, ex.
     `document_general_statut`). **Recommandé** : la colonne sert une vraie logique (cycle de vie du doc).
  2. **Dropper la colonne** : seulement si le cycle de vie `genere`/`erreur` est porté ailleurs
     (`actif` booléen ?). Casse l'index + les RLS qui lisent `statut='genere'` → refonte requise. Risqué.
  3. **Patcher le cible** : ajouter `statut` à `documents_generaux_savr` dans le Data Model source
     (Vault, **pas** `specs/`) puis régénérer le DDL cible. Si la colonne est légitime V1+V2.
- **`specs/` est DÉRIVÉ : ne pas l'éditer.** Une fois Val tranché (option 1 ou 3), écrire le fichier
  `_Divergences/MODULE_YYYYMMDD.md` (type `ambigu`) ; le Vault sera patché par `cdc-patch-divergences`.
- **Ne pas coder avant tranche.**

---

## OUTBOX — sous-lot DÉDIÉ (le plus risqué — ⏸ décision Val, PR séparée, non codé)

### Pourquoi c'est isolé

1. **Rename de colonne `statut` → `status`** : `CLAUDE.md` §2 impose **2 PRs** pour un rename de colonne
   (PR-1 ajoute `status`, double-écriture/back-fill ; PR-2 retire `statut`). Ne se bundle pas avec un alter de type.
2. **`enum → text`** : `outbox_statut_enum('pending','processing','done','failed','dead')` → cible
   `status text DEFAULT 'pending'`.
3. **Valeur `done` à arbitrer** : la cible (commentaire DDL) liste `pending | processing | failed | dead`
   — **pas `done`**. En cible, un event consommé est marqué par **`consumed_at`** (colonne existante),
   pas par `status='done'`. → re-modélisation de la sémantique terminale.
4. **Table concurrence-critique (lease/claim)** : lue/écrite par `fn_claim_outbox_batch`,
   `fn_reap_outbox_claims`, `fn_result_outbox` (cast `::outbox_statut_enum`, valeurs `'processing'`,
   `'done'`, `'dead'`, `'pending'`, `'failed'`) + côté TS `packages/adapters/src/outbox-worker.ts`
   (`p_statut: 'done'|'dead'|'failed'`). Un changement de colonne/type/valeurs touche le cœur de
   l'idempotence MTS-1 (§2/§3bis garde-fou 4). Toute migration doit être **lockstep** avec le déploiement
   du worker.

### ⚠️ Incohérence pré-existante à corriger DANS ce sous-lot (déjà repérée)

`packages/plateforme/src/app/api/cron/process-attributions-ag/route.ts` référence **déjà** la colonne
**cible** `status` (et non `statut`) **et** des valeurs hors de TOUT enum : `status:'done'` puis
`status: newAttempts >= 4 ? 'dlq' : 'pending'`. Or :

- la colonne live est `statut` (pas `status`) → ce cron est **actuellement cassé** contre le schéma live ;
- `'dlq'` n'existe ni en V1 (`…,dead`) ni en cible → écriture invalide.
  Ce code a visiblement été écrit **en avance** sur le rename. → **Forte indication que le rename
  `statut→status` est bien la convergence voulue**, mais le sous-lot doit **réaligner ce cron** (`status`,
  `'dlq'`→`'dead'`, et la sémantique `done` vs `consumed_at`) dans la même PR, sinon il reste cassé.

### Plan proposé (à valider par Val avant tout code)

- **PR-1** (additive, sans perte) : `ALTER TABLE outbox_events ADD COLUMN status text` ; back-fill
  `status = statut::text` ; adapter `fn_claim/result/reap` + `outbox-worker.ts` pour **lire/écrire les
  deux** (ou basculer en lecture `status`, écriture des deux) ; trancher `done` (le garder en text, ou
  passer à `consumed_at IS NOT NULL`). Convertir `outbox_statut_enum`→`text` sur la nouvelle colonne.
- **PR-2** (après ≥ 1 release sans usage de `statut`) : `DROP COLUMN statut` ; `DROP TYPE outbox_statut_enum` ;
  réaligner `process-attributions-ag` (`status`, `'dlq'`→`'dead'`).
- **Décisions Val** : (a) `done` conservé en text **ou** remplacé par `consumed_at` ? (b) `'dlq'` =
  `'dead'` confirmé ? (c) fenêtre de double-run acceptable sur une table concurrence-critique ?

---

## Pièges respectés (rappel)

- **PROD live** : `enum→text` (`USING col::text`) sans perte ; CHECK/suppression de valeur **gardés**
  par un `count` (garde-fou intégré pour A.2 ; à exécuter manuellement pour B/C avant code).
- **Forward-only** : nouvelle migration `20260623110000` (> max dossier `20260623100000` de #83) ;
  **déployer après #83**. Rename de colonne (outbox) = 2 PRs.
- **Corps PL/pgSQL** (vécu #83) : vérifié `pg_proc.prosrc` — aucun corps ne cite les noms de type du
  cluster A ; seules 2 signatures recréées.
- **`DROP TYPE`** seulement après que plus aucune colonne/fonction/index/vue ne l'utilise.
- **`specs/` = DÉRIVÉ** : non modifié. Divergence structurelle tranchée → fichier `_Divergences/` (Vault), pas `specs/`.
- Aucune table `tms.*`.

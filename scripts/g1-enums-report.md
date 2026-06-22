# Convergence G1 — noms des types ENUM V1 → DDL cible V2

> Garde-fou G1 (CLAUDE.md §3bis + `specs/ddl-cible/README.md`) : le schéma V1 doit être ⊂ au DDL
> cible figé `specs/ddl-cible/schema_cible_v2.sql` (« nom identique, type identique »).
> À HEAD, 32 types ENUM avaient été créés avec un suffixe `_enum` que la cible n'utilise pas
> (la note de cadrage en mentionnait 31 — `code_flux_co2_enum` manquait au décompte, cf. §Note).
> Ce lot ne touche QUE le **nom** des types qui ne divergent que par là. Aucune valeur ni structure.
>
> Migration : `supabase/migrations/20260623100000_plateforme_converge_enums_noms_cible.sql`
> (24 × `ALTER TYPE … RENAME TO`, transactionnel, commutatif, un seul fichier).
> Les références par OID (colonnes / fonctions / RPC) suivent automatiquement → aucun downtime.

## 1. Renommés (24)

| #   | V1 (avant)                         | Cible (après)               | Schéma     | Valeurs vs cible                                                          |
| --- | ---------------------------------- | --------------------------- | ---------- | ------------------------------------------------------------------------- |
| 1   | `collecte_type_enum`               | `collecte_type`             | plateforme | identiques                                                                |
| 2   | `collecte_statut_enum`             | `collecte_statut`           | plateforme | identiques (10 val., `rejetee_par_prestataire` ajouté en M1.8)            |
| 3   | `statut_tms_enum`                  | `collecte_statut_tms`       | plateforme | identiques                                                                |
| 4   | `incident_imputable_enum`          | `incident_imputable`        | plateforme | identiques                                                                |
| 5   | `attribution_mode_validation_enum` | `mode_validation`           | plateforme | identiques                                                                |
| 6   | `organisation_type_enum`           | `organisation_type`         | plateforme | identiques                                                                |
| 7   | `user_role_enum`                   | `user_role`                 | plateforme | identiques (7 val. dont `ops_savr`)                                       |
| 8   | `siret_verification_enum`          | `statut_verification_siret` | plateforme | identiques                                                                |
| 9   | `tva_verification_enum`            | `statut_verification_tva`   | plateforme | identiques                                                                |
| 10  | `mode_paiement_enum`               | `mode_paiement`             | plateforme | identiques                                                                |
| 11  | `region_enum`                      | `region`                    | plateforme | identiques                                                                |
| 12  | `difficulte_acces_enum`            | `acces_difficulte`          | plateforme | identiques                                                                |
| 13  | `type_vehicule_enum`               | `type_vehicule`             | plateforme | identiques                                                                |
| 14  | `tournee_creneau_enum`             | `creneau`                   | plateforme | identiques                                                                |
| 15  | `tournee_statut_enum`              | `tournee_statut`            | plateforme | identiques (4 val.)                                                       |
| 16  | `tarif_negocie_activite_enum`      | `activite_remise`           | plateforme | identiques                                                                |
| 17  | `tarif_negocie_scope_enum`         | `scope_remise`              | plateforme | identiques                                                                |
| 18  | `flux_unite_enum`                  | `unite_mesure`              | plateforme | identiques                                                                |
| 19  | `flux_filiere_enum`                | `filiere_valorisation`      | plateforme | identiques                                                                |
| 20  | `code_filiere_recyclage_enum`      | `code_filiere`              | plateforme | identiques                                                                |
| 21  | `code_materiau_emballage_enum`     | `code_materiau`             | plateforme | identiques                                                                |
| 22  | `type_tms_enum`                    | `type_tms`                  | plateforme | identiques                                                                |
| 23  | `storage_provider_enum`            | `storage_provider`          | **shared** | identiques                                                                |
| 24  | `code_flux_co2_enum`               | `code_flux`                 | plateforme | identiques — **hors liste initiale, ajouté sur décision Val** (cf. §Note) |

**Références textuelles corrigées dans le même PR** (les casts/commentaires ne suivent pas l'OID) :

- `supabase/tests/M1_2__programmation.test.sql` — 8 casts : `::plateforme.collecte_type_enum` (×6) →
  `::plateforme.collecte_type`, `::plateforme.statut_tms_enum` → `::plateforme.collecte_statut_tms`,
  `::plateforme.collecte_statut_enum` → `::plateforme.collecte_statut`.
- `scripts/coupling-allowlist.txt` — 4 mentions de commentaire `type_tms_enum` → `type_tms`
  (documentation de l'allowlist, hors logique ; aucune ligne de glob impactée).
- `packages/**` : aucune référence (les `_enum` trouvés sont des artefacts de build `.next/`, gitignorés).
- `supabase/migrations/**` (historiques) : **non modifiées** — elles s'exécutent avant le rename sur
  base fraîche, donc conservent légitimement les anciens noms (migrations forward-only immuables).

### 1bis. Corps de fonctions PL/pgSQL (⚠ correction NON anticipée par la note de cadrage)

La note supposait que « renommer le TYPE met à jour automatiquement colonnes/fonctions/RPC (référence
par OID) ». C'est vrai pour les **arguments/retours** de fonctions, les colonnes, les contraintes
CHECK, les DEFAULT et les **vues** (tous suivis par OID). Mais le **CORPS** d'une fonction PL/pgSQL est
stocké en **texte** et re-parsé à l'exécution : un `RENAME` n'y est pas répercuté → toute mention
textuelle de l'ancien nom (cast `::type`, déclaration `DECLARE v type`) casse au runtime. Prouvé par
`db reset` + pgTAP : `M1_2` échouait sur `type "plateforme.collecte_type_enum" does not exist`.

Requête sur `pg_proc.prosrc` (les 24 anciens noms) → **4 fonctions** concernées, et seuls 2 noms
apparaissent réellement dans des corps (`collecte_type_enum`, `collecte_statut_enum`) ; les 22 autres
types ne servent que de types de colonnes/arguments (OID-safe). La migration ajoute donc, **après** les
24 `RENAME`, un `CREATE OR REPLACE FUNCTION` (copie verbatim de la définition live, seuls les 2 noms de
types substitués) pour les **3 fonctions réellement cassées** :

| Fonction                                          | Ancien nom dans le corps                     |
| ------------------------------------------------- | -------------------------------------------- |
| `plateforme.fn_creer_collecte`                    | `collecte_type_enum` (déclaration + 3 casts) |
| `plateforme.fn_confirmer_programmation_brouillon` | `collecte_type_enum` (1 cast)                |
| `plateforme.fn_modifier_collecte`                 | `collecte_statut_enum` (1 cast)              |

`plateforme.fn_agreger_terminal_collecte` est **laissée telle quelle** : l'ancien nom n'y figure que
dans un **commentaire** (aucun impact runtime), comme les anciens noms des migrations historiques.

## 2. Conservé tel quel (1)

| V1                         | Cible                      | Pourquoi                                                                         |
| -------------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| `mode_facturation_zd_enum` | `mode_facturation_zd_enum` | La cible **garde** ce suffixe (DDL cible ligne 129, patch M1.7) — déjà conforme. |

## 3. Différés — divergence valeurs/structure en plus du nom (7)

> Hors périmètre de ce lot (« noms seuls »). À traiter dans le cluster valeurs/structure (autre session)
> car le rename seul ne suffit pas à atteindre G1 : il faut aligner les valeurs ou changer le type.

| V1                       | Cible                                  | Raison du report                                                                                                                                                                                |
| ------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email_statut_enum`      | `email_statut` (enum)                  | **valeurs** : V1 `queued/sent/delivered/bounced/failed` ≠ cible `envoye/ouvert/clique/bounce/echec`.                                                                                            |
| `facture_statut_enum`    | `facture_statut` (enum)                | **valeurs** : V1 contient `envoyee`, `en_retard` absents de la cible (`brouillon/en_attente_pennylane/emise/payee/annulee`).                                                                    |
| `pack_statut_enum`       | `pack_statut` (enum)                   | **valeurs** : V1 a `expire` en trop ; la cible = `actif/epuise/annule`. V1 est un **sur-ensemble** (arbitrage G1 requis, pas une simple omission).                                              |
| `outbox_statut_enum`     | `outbox_events.status` **text**        | **type text-vs-enum** : la cible n'a pas d'enum (colonne `status text DEFAULT 'pending'`, et nommée `status` ≠ `statut`).                                                                       |
| `job_statut_enum`        | `jobs_pdf.statut` **text + CHECK**     | **type text-vs-enum** : la cible = `text NOT NULL CHECK (statut IN (…))`, pas un type ENUM.                                                                                                     |
| `serie_facturation_enum` | `sequences_facturation.serie` **text** | **type text-vs-enum** : la cible = colonne `serie text` (PK `(serie, annee)`), pas un enum.                                                                                                     |
| `document_statut_enum`   | — (aucun enum cible)                   | **type/naming** : la cible ne déclare aucun enum `document_statut` ; les statuts de documents/exports y sont en `text + CHECK` ou via les enums dédiés `bordereau_statut`/`attestation_statut`. |

## Note — `code_flux_co2_enum` (le 32e type)

La note de cadrage comptait **31** types `_enum` (23 + 1 + 7). Le décompte réel à HEAD est **32** :
`code_flux_co2_enum` n'apparaissait dans aucun des trois seaux. Vérification faite, ses valeurs
(`verre, carton, biodechet, emballage, dechet_residuel`) sont **identiques** à la cible
`plateforme.code_flux` → c'est un **pur renommage** au sens de ce lot, sans aucune référence textuelle
externe (ni `supabase/tests`, ni `packages`). Sur décision de Val (2026-06-22), il est **inclus** dans
ce lot (24e rename) pour clôturer entièrement l'écart de nommage G1 en un seul PR.

## Vérification (G1) — résultats

- **Collisions** : aucune. Les 24 noms cibles n'existaient pas déjà comme type en V1.
- **Catalogue post-rename** (`pg_type`) : 0 ancien nom, 24 nouveaux, 1 gardé, 7 différés intacts.
- **`supabase db reset`** (base fraîche) : toute la chaîne de migrations s'applique, exit 0.
- **pgTAP** (6 fichiers, local) : tous verts — `M1_2` rejoue ses 16 assertions (`1..16`, 0 `not ok`,
  0 erreur) après le fix des 3 fonctions. (Le runner `scripts/test-pgtap.sh` cible le projet _linked_
  par défaut ; en local sans link, exécuter avec `DATABASE_URL` + `CREATE EXTENSION pgtap` — pgTAP n'est
  pas posée par les migrations, c'est une dépendance d'env de test, identique avant/après ce lot.)
- **`pnpm typecheck` / `pnpm lint` / `pnpm test:unit` (584) / `pnpm build` (5/5)** : tous exit 0.
- **G3 anti-couplage** (`check-coupling.sh`) : OK (allowlist intacte).
- **0 référence cassée** à un ancien nom `_enum` hors migrations historiques (légitimes) et hors
  commentaires de la migration de rename elle-même.
- **`specs/` (dérivé) non modifié** — ce lot résout une divergence G1, il n'en crée pas.

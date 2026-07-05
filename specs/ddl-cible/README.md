# DDL cible V2 gelé — référence du garde-fou 1

> Prérequis bloquant identifié à la revue frère du 2026-06-08 : « le diff schéma V1 ⊂ archive suppose une cible exécutable — écrire **une fois** le DDL complet du schéma cible V2 et le geler (on ne diff pas du SQL contre du markdown) ».
> Ce dossier matérialise cette cible.

## Fichier

`schema_cible_v2.sql` — DDL PostgreSQL **exécutable**, représentation **structurelle** du data model complet **V1+V2** (Plateforme + TMS natif + shared).

- **88 tables** : 54 `plateforme.*` (48 V1 + 6 Module 19 V2), 32 `tms.*` (dont `tms.audit_logs`, ex-`shared.audit_logs` rapatriée 2026-06-11), 2 `shared.*` (`fichiers`, `prestataires`). *(+1 table 2026-06-10 : `plateforme.jobs_pdf` — challenge Frontière G1, file PDF manquante.)*
- **56 types** ENUM + 158 foreign keys (section dédiée, ordre-indépendant ; `tms.audit_logs.acteur_user_id` sans FK — snapshot append-only). *(+2 enums 2026-06-10 : `statut_verification_siret`/`statut_verification_tva` + 4 colonnes `entites_facturation` — challenge onboarding ; +1 enum `type_document_pdf` + FK `jobs_pdf.fichier_id → shared.fichiers` — challenge Frontière. +1 enum 2026-06-19 : `mode_facturation_zd_enum` patch M1.7.)*
- Validé par le **vrai parseur PostgreSQL** (libpg_query / pglast v7.14) : grammaire OK (319 statements), tous les types définis (56 enums), toutes les FK (158) pointent vers une table+colonne existante, cloisonnement cross-schema respecté (seules les FK vers `shared.*` traversent les schémas). Dernière revalidation : 2026-07-05 (post-patch `users.telephone`).

## Périmètre (décision Val 2026-06-08)

- **Inclus** : `CREATE SCHEMA`, `CREATE TYPE` (enums), `CREATE TABLE` (colonnes, types, NOT NULL, DEFAULT, PK, UNIQUE, CHECK, GENERATED), foreign keys.
- **Exclus** : policies RLS (auditées par `cdc-audit-rls`), triggers, fonctions, vues (dérivées). Les colonnes alimentées par trigger (ex `tournees.cout_final_ht`) sont des colonnes simples.

## Source de vérité

- `plateforme.*` + `shared.fichiers` : `01 - Cahier des charges App/04 - Data Model.md` (living, plus récent que l'archive).
- `shared.prestataires` + `tms.*` : `02 - Cahier des charges TMS/04 - Data Model TMS.md`.
- L'archive `… ARCHIVE V1+V2 2026-06-05` ne contient **aucune table V2-only absente du living** : le living est un sur-ensemble. Module 19 (6 tables) présent dans les deux → living fait foi.

## Statut = DÉRIVÉ et RÉGÉNÉRABLE

Ce fichier n'est **pas** une nouvelle source. Il est dérivé des deux Data Model. **À regeler après toute modification d'un Data Model**, sinon le diff de garde-fou compare contre une cible périmée.

## Usage (garde-fou 1)

Diff des migrations V1 (`supabase/migrations/`) contre ce fichier : chaque table/colonne V1 doit être **⊂** la cible (nom ⊆ cible ? type identique ? aucun champ renommable ?). Une divergence structurelle = blocage CI. À défaut de diff SQL automatisé, revue humaine par checklist sur ce fichier.

**Diff automatisé (G6 — Lot 0 / R0c)** : `scripts/check-schema-vs-cible.ts` (job CI `schema-vs-cible`, mode rapport en T0) charge le DDL cible dans une base scratch, le V1 réel via `supabase db reset`, et diffe les deux via `pg_catalog`. Les écarts **assumés** sont listés dans `v1-divergences-allowlist.txt` (lu par le gate) — voir ci-dessous.

## Divergences V1 assumées (liste fermée — allowlist garde-fou 1 / G6)

Source machine : `v1-divergences-allowlist.txt`. Toute entrée = divergence **tracée** (énoncé garde-fou 1 assoupli 2026-06-24 : « omissions OU divergences explicitement tracées dans `_Divergences/` avec plan de convergence V2 » — cf. CLAUDE.md §3bis-1).

- **Colonnes V1-only** (Frontière TMS-Ready G1, neutralisées au cutover V2) : `plateforme.collectes.nb_camions_demande`, `plateforme.transporteurs.code_transporteur_mts1`, `plateforme.associations.id_point_collecte_mts1`, `plateforme.transporteurs.prestataire_logistique_id` *(pont dispatch AG V1, option B Val 2026-06-25, R5/BL-P0-08 — **absent de ce DDL cible** : le TMS natif V2 résout transporteur→prestataire lui-même, garde-fou 2 ; trace `_Divergences/_traités/2026-06/M2.3_20260625.md`)*.
- **Table V1-only** : `plateforme.pesees_tournees` (pesées brutes par tour, INC-0 2026-06-11 — présente aussi dans le DDL cible).
- **Bloc 7 (intégrations) — 4 tables, divergence structurelle A6 assumée** : `integrations_logs`, `integrations_inbox`, `outbox_events`, `emails_envoyes` divergent du DDL cible au-delà de simples omissions (renames / changement de PK / partition). Convergence **reportée V2** (migration 2-step Supabase + redeploy adapter, couverte par l'esquisse cohabitation `04 - Migration/08`). Trace complète : `_Divergences/BLOC7_20260624.md` (type *ambigu*, pré-validé Val A6 — 2026-06-24). Ces 4 tables sont allowlistées **entières** : G6 ne les compte pas comme violations bloquantes.

## ✅ Ambiguïtés résolues — TOUTES CONFIRMÉES

**A4 tranché Val 2026-06-09 ; A1, A2, A3, A5, A6, A7 confirmés Val 2026-06-10 (challenge Frontière).** Les marqueurs `/* AMBIGU */` ont été remplacés par des mentions de confirmation. Choix figés :

- **A1** `factures_collectes` : ajout d'un `id uuid` PK technique (composite impossible, `collecte_id` nullable).
- **A2** `sequences_facturation` : PK = `(serie, annee)`.
- **A3** `factures_collectes.tarif_applique_id` : `uuid` **sans FK** (polymorphe zd/ag).
- **A4** Audit (**RÉVERSÉ — audit data model 2026-06-11**) : **deux** tables distinctes **par schéma** — `plateforme.audit_log` (App, canonique) et `tms.audit_logs` (TMS, partitionnée, porte la colonne migration `contexte`). **`shared.audit_logs` n'existe plus** : le CDC TMS référence partout `tms.audit_logs` (colonnes `acteur_user_id`, `table_name`). PK composite **`(id, created_at)`** (obligatoire pour le partitionnement mensuel). `acteur_user_id` = snapshot uuid **sans FK** (append-only, conforme §2). *(L'ex-décision « Option A » du 2026-06-09 — table partagée `shared.audit_logs` — est abandonnée : elle divergeait du CDC TMS qui n'a jamais cessé de nommer `tms.audit_logs`.)*
- **A5** `tms.pesees` : colonne canonique `poids_net_kg` (le `poids_net_g` d'un trigger = coquille).
- **A6** `tms.types_vehicules.categorie_plateforme` : `text + CHECK` (5 valeurs), pas un enum partagé.
- **A7** Précisions numériques non données par les CDC figées par convention (montants `numeric(12,2)`, poids `numeric(10,3)`, remises `numeric(5,4)`, `taux_tva numeric(5,2)`).

Détails complets et conventions : en-tête du `.sql`.

## Notes de modélisation (non bloquantes)

- `tms.audit_logs` et `tms.integrations_logs` sont **partitionnées mensuellement** en implémentation : matérialisées ici avec leur **PK composite `(id, created_at)`** (la clé de partition doit faire partie de la PK) ; le partitionnement lui-même n'affecte pas le diff structurel.
- `factures_prestataires.ecart_pourcent` : réécrit sur les colonnes de base (une colonne GENERATED ne peut pas référencer une autre colonne GENERATED — `ecart_ht`).
- `tms.grilles_tarifaires_prestataires` : contrainte `EXCLUDE USING gist` anti-chevauchement (nécessite `btree_gist`, déclaré en tête).

Gelé le **2026-06-08**. **Regelé le 2026-06-10** (challenge Frontière : + `plateforme.jobs_pdf` + enum `type_document_pdf` + FK `shared.fichiers`, ambiguïtés toutes confirmées ; revalidé libpg_query — 308 statements OK).

**Regelé le 2026-06-11** (audit data model §04 App + §04 TMS) :
- `plateforme.user_role` → **7 valeurs** alignées §09 (`admin_savr`, `ops_savr`, `traiteur_manager`, `traiteur_commercial`, `agence`, `gestionnaire_lieux`, `client_organisateur` ; ex `commercial`/`manager` renommés, `ops_savr` ajouté).
- `plateforme.organisations.raison_sociale` **créée** (text nullable, fallback `COALESCE(raison_sociale, nom)` des vues `v_registre_dechets` + `v_referentiel_traiteurs`).
- `plateforme.tournee_statut` → **4 valeurs** (`confirmee_prestataire` retirée).
- `heure_debut_reelle`/`heure_fin_reelle` **`time` → `timestamptz`** sur `plateforme.collectes` ET `plateforme.tournees` (collectes de nuit, passage de minuit).
- `plateforme.collecte_flux` : contrainte **`UNIQUE (collecte_id, flux_id)`** (idempotence re-poll adapter MTS-1, UPSERT `ON CONFLICT`).
- Géoloc TMS : `tms.collectes_tms.arrivee_gps`/`depart_gps` + `tms.tournees.cloture_gps` (jsonb) + `tms.tournees.cloture_hors_zone` (boolean) — purge RGPD J+30.
- **A4 réversé** : `shared.audit_logs` supprimée → **`tms.audit_logs`** (App garde `plateforme.audit_log`).
- PK composite **`(id, created_at)`** sur `tms.audit_logs` + `tms.integrations_logs` (partitionnement).

Revalidé libpg_query/pglast v7.14 : **308 statements OK, 88 tables (54+32+2), 55 enums, 158 FK, cloisonnement cross-schema respecté.** Comptes inchangés (la table audit a changé de schéma, pas le total).

**Regelé le 2026-06-19 (patch M1.7 facturation)** : `plateforme.mode_facturation_zd_enum` ajouté (enum `par_collecte | mensuelle`, colonne `organisations.mode_facturation_zd NOT NULL DEFAULT 'par_collecte'`). Décision Val 2026-06-14, manquait du DDL cible. Comptes : **88 tables, 56 enums (+1), 158 FK, 309 statements (+1 CREATE TYPE).** Revalidation pglast à rejouer.

**Regelé le 2026-06-24 (patch divergence M1.6/M2.4 — lot R2, BL-P1-API-07)** : colonne `template_version text` (nullable) ajoutée à `plateforme.rapports_rse`, `plateforme.bordereaux_savr`, `plateforme.attestations_don` — versioning des gabarits PDF pour re-rendu iso. Convergence V2 = colonne permanente (le TMS natif génère les mêmes PDF), donc ajoutée à la cible (V1 ⊂ cible rétabli, ce n'est plus une divergence). **Revalidé pglast v7.14 : 315 statements OK** (le compteur 309 documenté ci-dessus était périmé — 3 colonnes nullables n'ajoutent aucun statement), **89 tables logiques** (55 plateforme + 32 tms + 2 shared ; 91 `CreateStmt` incl. 2 partitions audit), **56 enums, 158 FK, cloisonnement cross-schema OK.**

**Regelé le 2026-06-11 (bis — re-validation garde-fou 1 post audit RLS)** : les §04 avaient été modifiés après le regel du matin (§04 TMS 09:53, §04 App 12:27 audit RLS). Diff complet rejoué — **un seul delta structurel** : `tms.pesees.flux` passe de CHECK applicatif à **CHECK DB sur les 6 valeurs d'écriture** (`biodechet`,`emballage`,`carton`,`verre`,`dechet_residuel`,`don_alimentaire` — §04 TMS « Compat flux » durci 2026-06-11). Les modifs audit RLS du §04 App (Q2 `entites_facturation`, B-6 `v_registre_dechets` SECURITY DEFINER) sont hors périmètre DDL (policies/vues). Comptes inchangés : 88 tables, 55 enums, 158 FK.

**Regelé le 2026-07-05 (patch divergence M3.1 — « Mon profil », BL-P1-TRAIT-02)** : colonne `telephone text` (nullable) ajoutée à `plateforme.users` — champ téléphone éditable du profil utilisateur, transverse tous rôles (§06.04 §7). La table n'avait aucune colonne téléphone (seule `organisations.telephone` existait), provoquant un bug P0 transverse sur `/api/me/profil` (colonne fantôme). Intégrée à la cible (convergence : V1 ⊂ cible rétabli, ce n'est **plus** une divergence à tracer — pas d'ajout à la liste V1-only). V1 migration `20260705110000_plateforme_r19_users_telephone.sql`. **Revalidé pglast v7.14 : 319 statements OK, 92 `CreateStmt` (58 plateforme + 32 tms + 2 shared, incl. 2 partitions audit), 56 enums, 3 schémas — comptes inchangés (une colonne nullable n'ajoute aucun statement).**

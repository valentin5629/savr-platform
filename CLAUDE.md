# CLAUDE.md — Savr Platform (V1)

> Lu par Claude Code en priorité à chaque session. Décisions non-négociables, conventions, et pointeurs CDC par module.
> **Périmètre = V1** : Plateforme Savr + couche logistique **MTS-1 (API V3, polling) + Everest**. Le **Savr TMS natif = V2** (non développé, schéma `tms.*` non créé en V1).
> Source de vérité specs : export allégé `_DEV-FACING/` du Vault Obsidian (régénéré par `cdc-devfacing-export`). **Ne jamais lire les sources brutes `01 - …/` `02 - …/`** pendant le dev.

---

## 1. Contexte produit (2 min)

Savr collecte les invendus d'événements traiteurs : **AG** (Anti-Gaspi, don à association, attestation fiscale) et **ZD** (Zéro Déchet, compostage/méthanisation, bordereau + rapport recyclage). La Plateforme (ce repo) remplace l'app Bubble actuelle. Stack cible : Claude Code + Supabase + Next.js. La logistique terrain (dispatch, tournées, pesées) est sous-traitée en V1 à **MTS-1** (Strike/Marathon) et **Everest** (A Toutes!, vélo cargo) ; un **TMS natif Savr** les remplacera en V2. Objectif V1 : go-live en 8-11 semaines, migration intégrale de l'historique Bubble.

---

## 2. Architecture — Règles non-négociables

### Stack
- **Monorepo pnpm workspaces + Turborepo** : `packages/plateforme`, `packages/tms` (V2, gabarit vide en V1), `packages/shared`, `packages/adapters` (MTS-1 + Everest).
- **Next.js 15 App Router** — 2 fronts Vercel : `app.gosavr.io` (+ `tms.gosavr.io` réservé V2).
- **1 projet Supabase** (Pro) par env — 3 schémas : `plateforme.*`, `shared.*`, et `tms.*` **non créé en V1**.
- Code serveur = **Next.js API Routes sur Vercel** (PAS Supabase Edge Functions par défaut) + `pg_cron` / Vercel Cron pour les batchs.
- **PDF** : Railway (Puppeteer headless), file `jobs_pdf`, retry 15 min/4h.
- **Stockage fichiers volumineux** : Cloudflare R2 (URLs pré-signées), référencés via `shared.fichiers`.
- **Emails** : Resend (16 templates en seed DB, vouvoiement, FR, 0 emoji, signature « L'équipe Savr »).
- App mobile = **responsive PWA** (React Native = jamais, hors scope).

### Règles DB absolues
- Noms tables/colonnes/fonctions SQL : **en français** (sauf IDs techniques, timestamps, booléens).
- Schéma toujours explicite : `plateforme.`, `shared.`. **Aucune table `tms.*` créée en V1.**
- FK cross-schema interdites sauf vers `shared.prestataires` et `shared.fichiers`.
- **RLS DENY ALL par défaut** sur toutes les tables + **cross-schema deny**. Policies ajoutées explicitement (cf. §09).
- Migrations : dossier unique `supabase/migrations/`, nommage `YYYYMMDDHHMMSS_[plateforme|shared]_<slug>.sql`. Backward-compatible (add column nullable OK ; rename = 2 PRs ; drop après 1 release sans usage).
- **pgTAP : 100 % des policies RLS testées, bloquant CI.**

### Règles logistique V1 (⚠ lire la Frontière TMS-Ready, §3bis)
- La Plateforme **ne parle jamais directement** à MTS-1/Everest depuis le code métier → toujours via l'interface **`logistique_provider`** (impl. `adapter_mts1`, `adapter_everest`). `grep mts1|everest|customerOrders` hors `packages/adapters/` doit retourner 0.
- **MTS-1 = polling** (cron 15 min : `GET /v3/customerOrders`, `GET /v3/tours/{id}`, download photos), auth client-credentials, Bearer en Vault. **Le contrat webhook S1-S11 du §08 n'est PAS implémenté en V1** — c'est la cible V2 (gelée, validable en isolation contre les JSON Schemas `08 - savr-api-contracts/`).
- Sélection provider via `transporteurs.type_tms` (`mts1` | `everest`).
- **Outbox obligatoire dès V1** : toute mutation métier émettant un event (E1 `collecte.creee`, E2 `collecte.modifiee`, E3 `collecte.annulee`, E5 `lieu.champ_critique_modifie`) écrit une ligne `outbox_events` **dans la même transaction**. L'adapter MTS-1 la consomme. **Consommation durcie (revue frère 2026-06-08, cf. `04 - Data Model` table `outbox_events`) :** `FOR UPDATE SKIP LOCKED` + `pg_try_advisory_lock` (worker unique), ordering par `seq` bigserial (jamais `created_at`), **head-of-line blocking par collecte** (event N+1 d'un agrégat consommé seulement si tous les `seq ≤ N` du même agrégat sont `consumed`), retry backoff, **DLQ → alerte Slack `#savr-alerts-critique`**. Idempotence `POST /v3/customerOrders` MTS-1 = QO à confirmer.

---

## 3. Périmètre V1 (source : `_DEV-FACING/01 - …/00 - Scoping V1.md`)

### Dans le scope V1 (développer)
- **6 rôles** : `admin_savr`, `traiteur_manager`, `traiteur_commercial`, `agence`, `gestionnaire_lieux`, `client_organisateur`.
- Auth + onboarding self-service (SIRET INSEE + TVA VIES, rattachement orga par domaine email).
- Back-office Admin (CRUD orgas/users/lieux/événements/collectes, dashboard, packs AG, brouillons factures, paramètres algo).
- Formulaire programmation collecte 3 étapes (ZD + AG événement-centré, tarif ZD base+remises, vérif pack AG).
- Machine à états collecte unifiée : `programmee → validee → en_cours → realisee → cloturee` (+ `realisee_sans_collecte` AG only).
- Intégration logistique V1 = **adapter MTS-1 polling + Everest** derrière `logistique_provider`.
- Génération PDF (bordereau ZD, rapport recyclage ZD, attestation don AG), batch J+1 6h, embargo H+24.
- Pennylane v2 (brouillons ZD par collecte + mensuel groupé, AG), **polling J+1** (webhook = V1.1).
- Dashboards par rôle, Reporting + exports CSV, Registre réglementaire **ZD-only**.
- CO₂ ADEME (ZD induit/évité/net + AG évité 2,5 kgCO₂e/repas), snapshot figé.
- Migration Bubble (~1 500 AG + ~175 ZD + lieux + orgas + users), Resend.

### Hors scope V1 (NE PAS développer, ne pas anticiper)
- **TMS natif Savr** (tout `02 - Cahier des charges TMS/` = V2) : app chauffeur M05, dispatch M02/M12, portail prestataire M03, tournées, pesées natives.
- Modules App reportés : benchmark client (M12 UI), reporting REP/Citeo (M13, V1.1), app native (M14), multi-langues (M15), signature électronique (M16), import brief IA (M19, 6 tables non créées).
- 2FA (V1.1), SSO SAML (V2, archi anticipée), Trackdéchets (V2), lien partage public rapport (V1.1), QR vérif PDF (V1.1), export PDF registre formaté (V1.1), UI édition templates emails (V1.1), coûts Veolia auto (V2), scoring prestataires (V2), multi-régions (V2), notifs in-app/SMS (V1.1), archivage > 3 ans (V2).

## 3bis. Frontière TMS-Ready V1 — 5 garde-fous BLOQUANTS

> Source de vérité : `_DEV-FACING/01 - …/Frontière TMS-Ready V1.md`. Toute violation = refonte massive en V2. Vérifiés par `cdc-readiness-check` (DEV + PROD).

1. **Data model V1 ⊂ data model archive** — uniquement des omissions, jamais une structure divergente qui sera renommée/migrée. Diff schéma bloquant. **✅ Prérequis levé (2026-06-08) :** DDL cible V2 exécutable écrit et gelé → `_DDL-CIBLE-V2/schema_cible_v2.sql` (87 tables = 53 `plateforme.*` + 32 `tms.*` + 2 `shared.*`, 52 enums, 158 FK ; validé par le vrai parseur PostgreSQL libpg_query). Cf. `_DDL-CIBLE-V2/README.md` (périmètre = structure diffable sans RLS/triggers/vues ; 7 ambiguïtés `/* AMBIGU */` à confirmer par Val, dont A4 audit). **Fichier DÉRIVÉ : à régénérer après toute modif d'un Data Model.** Le diff des migrations V1 se fait désormais contre ce fichier (nom ⊆ cible ? type identique ? pas de champ renommable ?). **Repriorisation conservée :** câbler d'abord garde-fou 3 (grep anti-couplage) + garde-fou 4 (test outbox par mutation), le diff schéma vient ensuite.
2. **Frontière V2 = data model interne, PAS le contrat wire** — adapter V1 et TMS V2 alimentent **les mêmes tables avec la même sémantique** (`collectes`, pesées, `statut_tms`, `tournees`, photos via `shared.fichiers`, `outbox_events`). Contrat §08 gelé comme cible V2.
3. **Abstraction `logistique_provider` obligatoire** — 0 réf directe `mts1`/`everest` hors `packages/adapters/` (lint/grep custom).
4. **Events outbox émis dès V1** — `outbox_events` peuplée par chaque mutation métier (E1/E2/E3/E5), test présent par mutation. Pattern transactional outbox.
5. **Migration data double étape** — FK vers futures `tms.*` = NULL en V1, jamais de champ ad-hoc renommable. Référence neutre `external_ref_logistique` (jamais d'ID MTS-1 en dur dans les tables métier). `code_transporteur_mts1` cantonné à `transporteurs`, neutralisé au cutover.

---

## 4. Règles métier critiques — NE PAS réinterpréter (SI/ALORS)

- **SI** pack AG attribué **ALORS** FIFO strict sur `created_at` du pack — jamais LIFO.
- **SI** annulation AG < 12h avant collecte **ALORS** débit du crédit pack (trigger `trg_pack_debit_annulation_tardive`). **SINON** crédit non débité.
- **SI** programmation AG **ET** aucun pack actif **ALORS** alerte seule (pas de blocage hors-pack — supprimé).
- Tarifs ZD : **versionnés**, jamais modifiés rétroactivement.
- **SI** collecte passe à `realisee` **ET** type=AG **ALORS** générer attestation don au batch J+1 6h, AVEC mention fiscale 2041-GE si `association.habilitee_fiscale=true` **SINON** sans mention.
- **SI** `realisee_sans_collecte` (AG only) **ALORS** facture au tarif normal V1, pas d'attestation, badge + motif + photo + alerte Ops.
- **SI** `pesee.poids_kg < seuil_min` **OU** `> seuil_max` (ZD only) **ALORS** alerte **in-app** Admin (pas d'email, pas de template).
- **Multi-camions (V1/MTS-1)** : **SI** grosse collecte **ALORS** Ops fixe N (`collectes.nb_camions_demande`, même transporteur, volume global) **ET** l'adapter crée N customerOrders + N tournées (1 par camion, clé idempotence `reference-{rang}`, `external_ref_commande` stocké par tournée) **ET** agrège lui-même « tous les tours finis » → `realisee` (pas de webhook S5 en V1). **V2** : le TMS natif décide N et agrège (option a) — data model identique, garde-fou 2. L'outbox reste **par collecte** (`collecte.creee`), jamais par camion.
- Registre réglementaire = collectes **`cloturee` seules + ZD only**.
- Factures : numérotation séquentielle **gapless** (`sequences_facturation`), numéro conservé après échec 4xx. Avoir autorisé sur facture `payee`.
- Emails : 16 templates seed V1, vouvoiement, FR, 0 emoji, signature « L'équipe Savr ». UI d'édition = V1.1.
- **Pour toute règle non couverte par le CDC : STOP et demander à Val** plutôt qu'interpréter.

---

## 5. Entités partagées — Droits d'écriture (V1)

| Table | Schéma | Écrit par | Lu par |
|-------|--------|-----------|--------|
| `prestataires` / `transporteurs` | `shared`/`plateforme` | Admin Savr (référentiel) + `code_transporteur_mts1` | Plateforme, adapters |
| `fichiers` | `shared` | Plateforme + adapters | Plateforme |
| `lieux` | `plateforme` | Plateforme | Plateforme |
| `collectes` | `plateforme` | Plateforme + adapter MTS-1 (statut/pesées) | Plateforme |
| `collecte_tournees` (N↔N) | `plateforme` | Adapter MTS-1 (1 collecte = N camions, N décidé par Ops `nb_camions_demande`, 1 camion = 1 customerOrder + 1 tournée) | Plateforme (calcul marge) |
| `outbox_events` | `plateforme` | Plateforme (mutations) | Adapter MTS-1 (V1), TMS natif (V2) |
| `tms.*` | `tms` | **— non créé en V1 —** | — |

---

## 6. Contrat API Plateforme↔TMS — statut V1

- **V1 = polling MTS-1** (entrant) + `POST /v3/customerOrders` depuis l'outbox (sortant). Le contrat webhook **S1-S11 N'EST PAS un livrable V1**.
- Contrat §08 (E1/E2/E3/E5 + S1/S2/S3/S4/S5/S7/S9/S11, `X-API-Version 2026.04`, HMAC-SHA256+JWT, dédup `body.event_id` TTL 7j, retry 3 paliers 5min/1h/24h) = **cible V2 gelée**, validable en isolation contre `02 - …/08 - savr-api-contracts/` (JSON Schemas + Ajv).
- Source de vérité : `_DEV-FACING/02 - …/08 - Contrat API Plateforme-TMS.md` — à respecter quand on code l'outbox et les payloads, pour que le swap V2 soit trivial.

---

## 7. Gates & questions ouvertes (NE PAS débloquer sans Val)

- 🔒 **GATE Everest — DÉCISION 2026-06-08 (revue frère, validée) : Everest hors périmètre go-live → V1.1.** Vélo cargo marginal + API fragile (token sans refresh, webhooks sans HMAC, pas de sandbox) + QO non résolues (re-fetch course par id, IP stables). **Ne PAS coder l'adapter Everest pour le go-live.** Au lancement, les AG IDF concernées basculent sur le fallback MTS-1 (Marathon). Code Everest = V1.1, **après** réponse dev Everest (mail 2026-06-07 : TTL token, sécu webhooks, course vide, sandbox/compte test — en attente) + compte test fourni. Pattern sécu retenu pour V1.1 : webhook = signal → re-fetch API = vérité + rate-limit + dédup + aucune action irréversible depuis le webhook. Cf. §08 App §3 V1 (gelé) + Q1-Q4 M14.
- **DNS `gosavr.io`** : registrar + hébergeur DNS à identifier pour CNAME Supabase/Railway/Vercel (en attente ancien CTO). Bloque Phase 1 infra.
- **Profils go-live** : quels rôles sont indispensables au go-live ? — Val tranche plus tard (impacte ordre Phases 9-10). *(Everest : tranché 2026-06-08 = V1.1, hors go-live — cf. gate Everest ci-dessus.)*
- **[Action Val — calendrier]** Date d'échéance licence MTS-1 = conditionne la date de cutover (go-live ≥ échéance − 1 mois double-run).
- **[Action Val — juridique]** Validation juriste RSE/RGPD (base légale géoloc, notice, AIPD) avant go-live.

Pour toute zone d'ombre non tranchée ici : **stop et demander**.

---

## 8. Ordre de développement V1 (source : `09 - Roadmap exécution/`, skill `cdc-roadmap-execution` 2026-06-08)

> **Roadmap d'exécution séquentielle = `09 - Roadmap exécution/`.** Structure 3 niveaux : **Niveau 0 Foundations → V1 ZD → V2 AG → V3 Espaces/dashboards → V4 Reporting/registre → V5 Migration**. Un module = 1 session Claude Code = 1 brief chirurgical (`03 - Modules par verticale/`) = 1 `/goal` (condition binaire) + checkpoint humain entre modules. Jamais de `/goal` global. Budget ≈ **31M tokens** (~138 € Sonnet / ~688 € Opus sans caching, moins avec caching). Tracker : `06 - Suivi exécution`.
> Arbitrages 2026-06-08 : **6 rôles livrés avant go-live** (V3 sur chemin critique, pas de décalage) ; transverse webhook HMAC (H) **différé V2** (V1 = polling MTS-1 + outbox) ; briefs détaillés N0 + V1 produits, V2-V5 en squelette généré juste-à-temps.
> La liste 1-11 ci-dessous = vue linéaire historique (équivalente, mappée aux verticales dans `02 - Verticales`).

1. **Fondations infra** — Supabase prod+dev (`eu-west-3`), Railway, Resend, R2, repo + CI/CD GitHub Actions, migrations (tables + index + RLS DENY ALL), seed dev, env vars.
2. **Auth + onboarding** — login/refresh, inscription SIRET+TVA+CGV, rattachement domaine email, RLS par rôle, emails bienvenue/vérif.
3. **Back-office Admin** — CRUD orgas/users/lieux/événements/collectes, dashboard Admin, packs AG, brouillons factures, paramètres algo.
4. **Formulaire programmation collecte** — 3 étapes ZD+AG, autocomplétion lieux/contacts, tarif ZD auto, vérif pack AG, email confirmation.
5. **Intégration logistique (adapter MTS-1 polling)** — émission outbox E1/E2/E3/E5, cron poll MTS-1, sync `statut_tms`, alerte pesées anormales in-app, affichage statuts Admin.
6. **Génération PDF** — Railway/Puppeteer + `jobs_pdf`, templates bordereau/rapport/attestation, batch J+1 6h, embargo H+24, R2.
7. **Pennylane** — brouillons ZD (collecte + mensuel) + AG, push API v2 après validation Admin, avoirs, numérotation.
8. **Espace client traiteur** — dashboards manager/commercial, accès PDFs + régén, exports CSV.
9. **Profils secondaires** — dashboards gestionnaire lieux / agence / client organisateur, tarifs préférentiels.
10. **Algo AG + Everest** — recommandation top 3 asso/transporteurs, validation Admin, auto-accept, course Everest (⚠ gate Everest §7).
11. **Migration Bubble + go-live** — scripts migration, test parallèle 2-4 sem, email pré-bascule J-15, DNS, go-live.

---

## 9. Pointeurs CDC par module

> ⚠ **Tous les chemins ci-dessous = export allégé `_DEV-FACING/`** (barré + change-logs retirés, addenda conservés). **Régénérer l'export après toute modif du CDC** (`cdc-devfacing-export`), sinon Claude Code lit du périmé. Modules `tms.*` listés = **référence V2 lecture seule**, pas à développer en V1.

| Module à développer (V1) | Lire en priorité (dans `_DEV-FACING/`) |
|---|---|
| Auth + RLS | `01 - …/09 - Authentification et permissions.md` |
| Data model | `01 - …/04 - Data Model.md` |
| Règles métier | `01 - …/05 - Règles métier.md` |
| Architecture / adapters | `01 - …/07 - Architecture technique.md` + Frontière TMS-Ready V1 |
| Back-office Admin | `01 - …/06 - …/06 - Back-office Admin Savr.md` |
| Espace traiteur | `01 - …/06 - …/04 - Espace client traiteur.md` |
| Espace gestionnaire lieux | `01 - …/06 - …/05 - Espace client gestionnaire de lieux.md` |
| Espace agence | `01 - …/06 - …/11 - Espace client agence.md` |
| Formulaire programmation | `01 - …/06 - …/01 - Formulaire de programmation de collecte.md` |
| Templates emails | `01 - …/06 - …/02 - Templates emails V1.md` |
| Registre réglementaire | `01 - …/06 - …/03 - Registre réglementaire (UX).md` |
| Facturation | `01 - …/06 - …/08 - Génération et édition facture (Admin).md` |
| Algo attribution AG | `01 - …/06 - …/09 - Flux algo attribution AG (Admin).md` |
| Dashboards | `01 - …/11 - Dashboards.md` |
| Reporting / exports | `01 - …/12 - Reporting et exports.md` |
| **Design System (UI — toute interface)** | `01 - …/10 - Design System.md` |
| **Sécurité / conformité (RGPD)** | `01 - …/15 - Sécurité et conformité.md` |
| **CGU (flux onboarding / acceptation CGV)** | `01 - …/CGU Savr V1 - Draft.md` |
| **Scalabilité / évolutivité** | `01 - …/14 - Scalabilité et évolutivité.md` |
| Vision / objectifs (contexte) | `01 - …/01 - Vision et objectifs.md` |
| Personas / cas d'usage (contexte + QA) | `01 - …/02 - Personas et cas d'usage.md` |
| Adapter MTS-1 (as-built) | `01 - …/Adapter MTS-1 (MyTroopers) — relevé as-built Bubble.md` (exporté dans `_DEV-FACING/` — décision E2 2026-06-10) |
| APIs / intégrations | `01 - …/08 - APIs et intégrations.md` |
| Contrat API V2 (cible) | `02 - …/08 - Contrat API Plateforme-TMS.md` + `08 - savr-api-contracts/` |
| Migration Bubble + MTS-1 | `04 - Migration/` (dans le Vault) |
| Fixtures / seed data | `05 - Fixtures/` (dans le Vault) |
| Agent QA / scénarios | `06 - QA Agent/` + `tests/` de chaque CDC |

---

## 10. Glossaire métier (vocabulaire figé — pas de drift)

| Terme | Définition | Naming technique |
|---|---|---|
| Organisation (traiteur/lieu) | Client B2B Savr | `plateforme.organisations` (type) |
| Lieu | Lieu d'événement | `plateforme.lieux` |
| Association | Bénéficiaire don AG | `plateforme.associations` |
| Pack | Crédit collectes AG | `plateforme.packs_antgaspi` |
| Événement | Réception organisée | `plateforme.evenements` |
| Collecte | Récup des invendus | `plateforme.collectes` |
| AG | Anti-Gaspi (don asso) | `collectes.type='ag'` |
| ZD | Zéro déchet (compost/métha) | `collectes.type='zd'` |
| Réalisée sans collecte | AG sans invendus | `collectes.statut='realisee_sans_collecte'` |
| Pesée | Mesure poids invendus | (pesées, alim. adapter MTS-1 en V1) |
| Tournée | Trajet logistique | `plateforme.tournees` (alim. adapter) |
| Transporteur | Presta logistique (Strike/Marathon/A Toutes!) | `plateforme.transporteurs` |
| Attestation don | Cerfa 2041-GE | `plateforme.attestations_don` |
| Bordereau | Justificatif pesée ZD | `plateforme.bordereaux_savr` |
| Facture | Facture client | `plateforme.factures` / `factures_collectes` |

> Compléter à chaque nouveau terme.

---

## 11. Environnements (2 seulement — pas de staging V1)

| Env | Plateforme | Données | Usage |
|---|---|---|---|
| **dev** | `dev.app.gosavr.io` | `seed_minimal` + `seed_demo` | Dev local, tests, démos |
| **prod** | `app.gosavr.io` | Réelles client | Production |

- 2 projets Supabase distincts (`savr-dev`, `savr-prod`), secrets séparés (Pennylane sandbox en dev).
- Branches Vercel : `main` → prod, `dev` → dev. **Déploiement prod = action manuelle Val (+ frère), jamais auto.**
- Aucun accès DB prod depuis dev. Pas de copie prod→dev sans anonymisation (`seed_anonymized`). Secrets dans Vercel/Supabase Vault, jamais dans le repo.

---

## 12. CI/CD minimum viable + Harnais qualité (CÂBLÉ 2026-06-08)

> **Harnais qualité câblé et smoke-testé** (skill `cdc-dev-quality-loop` BUILD, 2026-06-08). Repo squelette = `savr-platform/` (monorepo pnpm+Turborepo prêt à pousser). Traçabilité + preuve smoke test : `_Harnais qualité dev/00 - Harnais câblé 2026-06-08.md`. Principe : consigne critique = mécanisme qui l'impose (test > hook > gate CI > reviewer), pas du texte espéré suivi.
> 7 artefacts : (1) hooks `.claude/` — commit rouge bloqué (exit 2), commandes destructives bloquées, format auto ; (2) 4 agents reviewers `.claude/agents/` (principal, rls-securite, conformite-spec, data-model-migration) ; (3) `.github/workflows/quality.yml` ; (4) `BRANCH_PROTECTION.md` (⏳ manuel GitHub) ; (5) `DEFINITION_OF_DONE.md` ; (6) `RUNBOOK_INCIDENT.md` ; (7) `CHECKLIST_CHECKPOINT.md`.
> Avant câblage CI réel : **validation syntaxe par le frère** (hooks/Actions évoluent) + appliquer branch protection au repo GitHub (token agent rôle `write` non-admin).
> **Garde-fous TMS-Ready 3 & 4 câblés (2026-06-08)** : G3 anti-couplage = `scripts/check-coupling.sh` + job CI `anti-coupling` + hook pré-commit + `scripts/coupling-allowlist.txt` (0 réf directe MTS-1/Everest hors `packages/adapters/`) ; G4 outbox par mutation = `supabase/tests/outbox_par_mutation.test.sql` (pgTAP E1/E2/E3/E5 + atomicité rollback, **auto-activé** dès création table+trigger). Traçabilité : `_Harnais qualité dev/01 - Garde-fous TMS-Ready câblés 2026-06-08.md`. **POINT À CONFIRMER frère** : modèle d'émission E2 (trigger DB vs action dispatch, cf. §08 F3).

- **Pré-commit (câblé, hook `PreToolUse`)** : `check-coupling.sh` (anti-couplage G3) + `pnpm -w typecheck + lint + test:unit`, **exit 2 = commit bloqué**. ESLint + Prettier auto en `PostToolUse`.
- **PR (GitHub Actions, bloquants)** : lint/format, type-check, Vitest, **`anti-coupling` (G3 TMS-Ready : 0 réf MTS-1/Everest hors `packages/adapters/`)**, **`pgtap-rls-outbox` = pgTAP RLS sous rôle `authenticated` (non négociable) + G4 TMS-Ready (outbox par mutation, auto-activé)**, Playwright E2E workflows critiques, build Next.js, secret scan gitleaks, dry-run migration anti-destructif, bundle-budget. `pnpm audit` = warning.
- **Merge `main`** : PR obligatoire + checks verts + 1 approbation, pas de bypass admin, pas de force push ; déploiement Vercel ; **migration Supabase prod = manuelle** (revue diff SQL Val + frère) ; tag git.
- **Cron** : attestations J+1 6h, bordereaux J+1 6h, relance factures, polling MTS-1 15 min, purge logs.

---

## 13. Observabilité — spécifiée (2026-06-08)

> **Dossier `01 - …/07 - Observabilité/` créé** (étape `cdc-observability` exécutée 2026-06-08). 7 fichiers : `00 - Stack retenue`, `01 - Logs business`, `02 - Logs techniques`, `03 - Alertes`, `04 - Dashboards business`, `05 - Health checks`, `06 - Audit trail`.
> Stack : **Supabase Logs + Sentry + Better Uptime + Slack (3 canaux par sévérité)**. Pas de Datadog V1 (décision 9.1.3). OpenTelemetry léger instrumenté dès V1.
> Arbitrages session : OBS-1 alertes → **Slack 3 canaux** (`#savr-alerts-critique`/`-eleve`/`-info`), SMS Better Uptime = filet uptime critique ; OBS-2 audit trail = **écritures sensibles seulement** ; OBS-3 `/health/full` = **DB + Auth seul**.
> Réconciliations à respecter au build : pesée hors seuil ZD + collecte non transmise TMS + `realisee_sans_collecte` = **in-app / dashboard, jamais d'alerte Slack** (pas de doublon). Dashboards métier = `11 - Dashboards` fait foi ; `07 - Observabilité/04` n'ajoute que la couche ops `v_ops_*`. Audit trail = table `audit_log` `04 - Data Model` (ne pas redéfinir).
> Propagé dans `_DEV-FACING/` (régé `cdc-devfacing-export` 2026-06-10).

---

## 14. Migration de données — Pointeurs (`04 - Migration/`)

Inventaire Bubble + MTS-1 (`01 - …`), mappings (`02 - Mappings/`), ordre d'exécution (`03`), transformations (`04`), checks réconciliation SQL (`05`), rollback (`06`), données abandonnées (`07`). Plan V1→V2 esquissé (garde-fou 5) dans `13 - Migration depuis Bubble.md`.

---

## 15. Fixtures et seed data — Pointeurs (`05 - Fixtures/`)

Catalogue/volumétrie (`01`), couverture règles métier (`02`), timeline `seed_demo` (`03`), fixtures API (`04`), spec d'injection (`05`). Grilles réelles intégrées (Strike camions 16/20 m³, Marathon forfait 100 €/tournée, A Toutes! vélo 8 cellules). Commandes : `pnpm seed:minimal`, `pnpm seed:demo`. **Jamais de seed en prod** (refus si `NODE_ENV=production`).

---

## 16. Performance et charge — spécifiée (2026-06-08)

> **Dossier `01 - …/08 - Performance/` créé** (skill `cdc-perf-load` exécutée 2026-06-08). 6 fichiers : `01 - Volumes attendus`, `02 - SLA par endpoint`, `03 - Cibles techniques transverses`, `04 - Scenarios de charge`, `05 - Strategies optimisation`, `06 - Monitoring perf prod`.
> **Dimensionnement An 1** (arbitrages Val 2026-06-08) : volumes repris du §14 Scalabilité (~80 orgas, ~150 collectes/mois, ~300 k lignes DB), **pic = 50 users simultanés** (lundi matin). An 3 = vision (~300 collectes/mois, ~900 k lignes). Supabase Pro couvre sans upgrade — le risque V1 = perf des requêtes, pas la capacité.
> **SLA p95 clés** : listes paginées 200 ms, détails 250 ms, dashboard Admin global 800 ms (vue matérialisée), écritures 400-600 ms, PDF async 5 s e2e, login 500 ms. Endpoints **À optimiser** (dashboard Admin, exports, inscription INSEE/VIES) embarquent leur stratégie dès la 1re implémentation.
> **Scénarios de charge bloquants avant prod** (k6, sur `seed_demo` volume An 1, env dev jamais prod) : **S1 nominal (50 users, 30 min) + S4 endurance (24 h)**. S2 pic ×3 / S3 batch concurrent / S5 résilience API = squelettes V1.1 (S2 à activer avant tout go-live grand compte).
> **Optimisations autorisées sans Val** : index RLS + composites, pagination/cursor, cache LRU paramétrages, PDF + API tierces async, vues matérialisées dashboards, PgBouncer. **Interdites sans Val** : Redis/Memcached, CDN custom, sharding, read replicas.
> **Monitoring perf** = extension `07 - Observabilité/` (aucun outil ajouté) : 6 alertes perf câblées dans les 3 canaux Slack existants. Anti-doublon : alertes fonctionnelles restent in-app, seules les alertes techniques vont sur Slack.
> Position pipeline : skill exécutée tôt (post-handoff) pour figer les cibles que Claude Code respectera pendant le dev. Re-vérifiée par `cdc-readiness-check` mode PROD (les benchmarks S1+S4 doivent passer).
> Propagé dans `_DEV-FACING/` (régé `cdc-devfacing-export` 2026-06-10).

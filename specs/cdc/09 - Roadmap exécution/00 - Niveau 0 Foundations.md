# 00 - Niveau 0 — Foundations

> Modules transverses indispensables **avant toute feature métier**. Faits une fois, dans l'ordre. À la fin : les 2 fronts tournent vides mais sécurisés, CI verte. **Audit dev senior (frère) recommandé ici.**
> Source specs : `_DEV-FACING/`. Les tables `tms.*` ne sont **pas** créées en V1 (garde-fou 1).

---

## Vue d'ensemble

| #    | Module                                                                    | Catégorie | Tokens (≈) | Sources `_DEV-FACING/`                     |
| ---- | ------------------------------------------------------------------------- | --------- | ---------- | ------------------------------------------ |
| 0.1  | Setup tooling (monorepo, Turborepo, ESLint, Husky, CI/CD)                 | S         | 150k       | §07 + CLAUDE.md §12                        |
| 0.2  | Setup Supabase dev + secrets + env                                        | XS        | 50k        | §07 + CLAUDE.md §11                        |
| 0.3  | Schéma DB complet (toutes tables Plateforme+shared, sans triggers métier) | XL        | 1,5M       | §04                                        |
| 0.4  | RLS policies exhaustives (DENY ALL + policies par rôle)                   | XL        | 1,5M       | §09                                        |
| 0.5  | Auth + signup + login + JWT + middleware par rôle                         | M         | 400k       | §09                                        |
| 0.6  | Tests pgTAP RLS (couverture 100%, bloquant CI)                            | L         | 800k       | `tests/09-rls-app-transverse-scenarios.md` |
| 0.7  | Seed minimal + demo injectable + commandes pnpm                           | M         | 300k       | `05 - Fixtures/`                           |
| 0.8  | Composants UI de base (shadcn, layouts, nav par rôle)                     | M         | 450k       | §10 Design System + §06                    |
| 0.9  | Logging structuré + Sentry + health check                                 | S         | 180k       | `07 - Observabilité/`                      |
| 0.10 | Audit trail (table `audit_log` + middleware écritures sensibles)          | S         | 150k       | `07 - Observabilité/06` + §04              |
| 0.11 | Mocks & fixtures API tierces (MTS-1, INSEE/VIES, Pennylane, Resend, sinks) | M        | 250k       | `12 - Conventions` §3 + as-built MTS-1     |
|      | **TOTAL Niveau 0**                                                        |           | **~5,7M**  |                                            |

Ordre interne : 0.1 → 0.2 → 0.3 → 0.4 → 0.5 → 0.6 (gate qualité) → 0.7 → 0.8 → 0.9 → 0.10 → 0.11. Les transverses émergents A-H **ne sont pas** posés ici (cf. fichier `01`), sauf C (emails) au 1er usage en 0.5. ⚠ 0.3 et 0.4 = modules XL → **sous-lots, 1 /goal par sous-lot** (conventions §6). Les mocks INSEE/VIES de 0.11 sont nécessaires aux tests de 0.5 → poser le sous-ensemble INSEE/VIES dans le budget de 0.5, le reste en 0.11.

---

## Briefs détaillés

### Module 0.1 — Setup tooling

- **Objectif** : monorepo pnpm + Turborepo opérationnel, CI/CD GitHub Actions verte sur un repo vide.
- **À coder** : `packages/plateforme`, `packages/tms` (gabarit vide V1), `packages/shared`, `packages/adapters` ; ESLint + Prettier + type-check ; Husky + lint-staged pré-commit ; workflow GitHub Actions (lint/format, type-check, build) ; **lint custom grep** `mts1|everest|customerOrders` hors `packages/adapters/` = 0 (garde-fou 3).
- **Complément 2026-06-11 (conventions `12`)** : pose de `specs/` (script `scripts/sync-specs.sh` + 1er sync : `specs/cdc/` = `_DEV-FACING`, `specs/tests/`, `specs/ddl-cible/`, `specs/fixtures/`, `specs/manifests/`) ; scripts **`pnpm test:module <id>`** (échoue si 0 test collecté) et **`pnpm check:coverage <id>`** (échoue si un ID du manifest n'a pas de test vert).
- **Hors scope** : aucune feature, aucune table.
- **Définition de fini** : `pnpm install` OK, `pnpm lint` + `pnpm build` verts, CI verte sur PR vide, lint custom adapters présent et passant.
- **/goal** : `Le module 0.1 est terminé quand pnpm install, pnpm lint, pnpm type-check et pnpm build passent sans erreur ET le workflow GitHub Actions est vert sur une PR.`
- **Budget** : 150k — alerte +50%.

### Module 0.2 — Setup Supabase dev + secrets

- **Objectif** : projet Supabase dev (`eu-west-3`) connecté, schémas `plateforme` + `shared` créés (vides), env vars sur Vercel/Railway/Resend/R2.
- **À coder** : init Supabase, migration `00000000000000_init_schemas.sql` (CREATE SCHEMA plateforme, shared ; **PAS tms**), config env (`.env.example` + secrets Vault), connexion vérifiée.
- **Hors scope** : tables métier (0.3), prod (manuel Val + frère).
- **Définition de fini** : `supabase db push` OK en dev, schémas présents, app Next.js se connecte.
- **/goal** : `Le module 0.2 est terminé quand supabase db push applique la migration init en dev sans erreur ET un script de smoke-test confirme la connexion aux schémas plateforme et shared.`
- **Budget** : 50k.
- ✅ **Dépendance** : DNS `gosavr.io` **LEVÉE 2026-06-11** (registrar = OVH, demande 4468362). CNAME Supabase/Railway/Vercel à configurer au démarrage.

### Module 0.3 — Schéma DB complet

- **Objectif** : toutes les tables Plateforme + shared créées par migrations, **sans triggers métier** (ajoutés dans les verticales), avec index et FK.
- **À coder** : migrations `YYYYMMDDHHMMSS_[plateforme|shared]_<slug>.sql` pour l'intégralité de `§04 Data Model` (orgas, lieux, associations, packs_ag, evenements, collectes, collecte_tournees, tournees, transporteurs, pesées, attestations_don, bordereaux_savr, factures, factures_collectes, sequences_facturation, outbox_events, audit_log, fichiers (shared), prestataires (shared), tables email, etc.). Noms **en français**, schéma explicite. **Aucune table `tms.*`** (garde-fou 1). FK cross-schema uniquement vers `shared.prestataires`/`shared.fichiers`.
- **Hors scope** : RLS (0.4), triggers métier (verticales), tables Module 19 (non créées V1).
- **Définition de fini** : migrations appliquées en dev, diff schéma ⊂ archive (garde-fou 1), tous index présents.
- **Garde-fou 1 opérationnalisé** : le diff schéma se fait contre `specs/ddl-cible/schema_cible_v2.sql` (copie versionnée du DDL cible V2 regelé 2026-06-11) via script `scripts/check-schema-subset.sh` : chaque table/colonne V1 doit exister dans la cible avec un type identique (omissions OK, divergences = échec). À câbler en CI.
- **Sous-lots (1 /goal chacun)** : 0.3a référentiel (orgas, users, lieux, associations, transporteurs, prestataires shared) ~500k · 0.3b cœur métier (evenements, collectes, collecte_tournees, tournees, pesees_tournees, packs, outbox_events) ~550k · 0.3c facturation + documents + emails (factures, factures_collectes, sequences_facturation, attestations, bordereaux, fichiers shared, tables email, audit_log, jobs_pdf) ~450k.
- **/goal (par sous-lot)** : `Le sous-lot 0.3x est terminé quand supabase db push applique les migrations en dev sans erreur ET le test de présence vérifie chaque table du sous-lot (colonnes + index) ET scripts/check-schema-subset.sh passe ET aucune table tms.* n'existe.`
- **Budget** : 1,5M (XL) — charger §04 par blocs, pas en entier.

### Module 0.4 — RLS policies exhaustives

- **Objectif** : RLS DENY ALL par défaut sur toutes les tables + policies explicites par rôle + cross-schema deny.
- **À coder** : `ALTER TABLE … ENABLE ROW LEVEL SECURITY` partout ; policies §09 + addenda audit RLS (§3ter) ; helpers `f_is_staff()`, `f_collecte_visible()`, `f_fichier_visible()` ; cloisonnement cross-organisation ; `shared.fichiers` polymorphe (9 `entity_type`).
- **Assertion ENABLE RLS exhaustive (garde-fou E3, audit intégrité 2026-06-09)** : test post-migration `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname IN ('plateforme','shared') AND c.relrowsecurity = false` doit renvoyer **0** (hors tables service-role explicitement listées). Une table créée sans `ENABLE` n'a aucune RLS (accès ouvert selon GRANT) et le pgTAP V1 réduit ne la rattrape pas → cette assertion transforme « DENY ALL par défaut » en **invariant testé**, pas une intention. À câbler dans le gate CI (bloquant) au même titre que le pgTAP RLS.
- **Hors scope** : tests (0.6 — mais écrits en parallèle).
- **Définition de fini** : chaque table a policies explicites pour chaque rôle × CRUD ; cross-org et cross-schema verrouillés ; aucune table sans policy.
- **Sous-lots (1 /goal chacun, jumelés aux sous-lots 0.3)** : 0.4a policies référentiel + helpers (`f_is_staff()`, `f_collecte_visible()`, `f_fichier_visible()`) ~550k · 0.4b policies cœur métier (collectes, tournées, pesées, outbox) ~500k · 0.4c policies facturation/documents/emails + cross-schema deny ~450k.
- **/goal (par sous-lot)** : `Le sous-lot 0.4x est terminé quand les pgTAP des tables du sous-lot sont verts ET l'assertion relrowsecurity sur ces tables renvoie 0 ET le script d'audit confirme que 100% des tables du sous-lot ont au moins une policy explicite.`
- **Budget** : 1,5M (XL).
- **Note** : 0.4 et 0.6 sont jumelés — l'audit RLS V1 (`project_audit_rls_v1_app`) a déjà identifié les trous (organisations_lieux, shared.fichiers, outbox_events, factures_collectes). Les respecter.

### Module 0.5 — Auth + signup + login + JWT

- **Objectif** : auth Supabase email/password, inscription self-service, JWT avec rôle, middleware Next.js par rôle.
- **À coder** : login/logout/refresh ; inscription (validation **SIRET INSEE + TVA VIES** + CGV) ; rattachement orga par domaine email ; claims JWT (rôle, org_id) ; middleware de route par rôle ; **emails bienvenue + vérif** (1er usage transverse C → poser `packages/shared/email`).
- **Hors scope** : 2FA (V1.1), SSO SAML (V2), gestion fine profils secondaires (V3).
- **Définition de fini** : un compte se crée (SIRET/TVA validés), se connecte, reçoit un JWT avec rôle, accède à une route protégée selon son rôle ; emails partent (Resend).
- **/goal** : `Le module 0.5 est terminé quand les tests Vitest auth + les tests Playwright login/signup passent ET pnpm test:pgtap reste vert ET un compte de test traverse signup → vérif email → login → route protégée.`
- **Budget** : 400k (M).

### Module 0.6 — Tests pgTAP RLS (100%)

- **Objectif** : couverture pgTAP de 100% des policies RLS, bloquant CI (non négociable, CLAUDE.md §12).
- **À coder** : tests pgTAP pour chaque policy (positif + négatif cross-org/cross-schema), à partir de `tests/09-rls-app-transverse-scenarios.md` (62 scénarios).
- **Définition de fini** : `pnpm test:pgtap` vert, couverture 100% des policies, intégré au gate CI bloquant.
- **/goal** : `Le module 0.6 est terminé quand pnpm test:pgtap couvre 100% des policies (script de couverture vert) ET le job pgTAP est bloquant dans la CI.`
- **Budget** : 800k (L).

### Module 0.7 — Seed minimal + demo

- **Objectif** : jeux de données injectables `seed_minimal` + `seed_demo`, commandes pnpm, refus en prod.
- **À coder** : scripts `pnpm seed:minimal` / `pnpm seed:demo` (cf. `05 - Fixtures/`, grilles réelles Strike/Marathon/A Toutes!) ; garde `NODE_ENV=production` → refus.
- **Définition de fini** : `pnpm seed:demo` peuple un dev vierge sans erreur, refus en prod, données conformes au catalogue Fixtures.
- **/goal** : `Le module 0.7 est terminé quand pnpm seed:demo s'exécute sans erreur sur une DB dev vierge ET un test confirme le refus si NODE_ENV=production ET les volumétries correspondent au catalogue Fixtures.`
- **Budget** : 300k (M).

### Module 0.8 — Composants UI de base

- **Objectif** : design system (shadcn), layouts, navigation conditionnée par rôle, tokens (§10).
- **À coder** : setup shadcn/ui + tokens design (§10, dark mode structuré), layout app shell, navigation par rôle, composants communs (table paginée, formulaire, modale, toasts), **shell back-office Admin** (coquille de navigation, écrans branchés en V1).
- **Hors scope** : écrans métier (verticales).
- **Définition de fini** : storybook/preview des composants, navigation affiche les bonnes entrées selon le rôle (mock), build OK.
- **/goal** : `Le module 0.8 est terminé quand pnpm build passe ET les tests de rendu des composants de base passent ET la navigation conditionnée par rôle est testée (Playwright) pour les 6 rôles.`
- **Budget** : 450k (M).

### Module 0.9 — Logging structuré + Sentry + health check

- **Objectif** : observabilité minimale (CLAUDE.md §13) — logs structurés, Sentry, `/health/full` (DB + Auth).
- **À coder** : logger structuré (OpenTelemetry léger), intégration Sentry, endpoint `/health/full` (DB + Auth seul, décision OBS-3), 3 canaux Slack câblés (`#savr-alerts-critique`/`-eleve`/`-info`, OBS-1), Better Uptime.
- **Hors scope** : Datadog (refusé V1), alertes fonctionnelles in-app (restent in-app, anti-doublon).
- **Définition de fini** : logs structurés émis, erreur test remonte dans Sentry, `/health/full` renvoie l'état DB+Auth, alerte test arrive sur le bon canal Slack.
- **/goal** : `Le module 0.9 est terminé quand les tests d'intégration logging/health passent ET un test de bout en bout confirme qu'une erreur simulée atteint Sentry et le canal Slack attendu.`
- **Budget** : 180k (S).

### Module 0.10 — Audit trail

- **Objectif** : table `shared.audit_log` (déjà définie §04) + middleware d'écriture sur les opérations sensibles (décision OBS-2 : écritures sensibles seulement).
- **À coder** : middleware/trigger qui journalise les écritures sensibles (création/modif orgas, users, rôles, factures, packs, paramètres algo) vers `audit_log` ; **ne pas redéfinir la table** (§04 fait foi).
- **Définition de fini** : une écriture sensible crée une ligne `audit_log` (qui, quoi, quand, avant/après) ; tests présents.
- **/goal** : `Le module 0.10 est terminé quand les tests confirment qu'une écriture sensible (rôle, facture, paramètre algo) produit exactement une ligne audit_log conforme ET pnpm test:pgtap reste vert.`
- **Budget** : 150k (S).

### Module 0.11 — Mocks & fixtures API tierces

- **Objectif** : aucun test CI ne dépend d'un service externe (conventions §3). Tout ce dont V1 a besoin pour tester les intégrations en local/CI.
- **À coder** (dans `packages/shared/testing/`) :
  - **Mock MTS-1** (pré-requis M1.5) : customerOrders/tours/photos pilotés par fixtures (`tours_pesees_flux.json`, multi-camions, KO partiel, pesées incomplètes, photo 404, timeout post-POST pour le plan B Q3bis-6), libellés stuffs exacts du as-built.
  - **Mock INSEE + VIES** : états vérifié/rejeté/down (teste la dégradation gracieuse de l'inscription — complète la pose minimale faite en 0.5).
  - **Mock Pennylane v2** : création brouillon, 4xx/5xx, statuts pour le polling J+1.
  - **Mock Resend** + **sinks Sentry/Slack** : assertion sur le payload émis, pas sur la livraison réelle.
- **Hors scope** : mock Everest (V1.1, gate), simulateur Railway (service interne).
- **Définition de fini** : chaque mock pilotable par fixture + documenté ; les tests 0.5/0.9 re-câblés dessus si besoin.
- **/goal** : `Le module 0.11 est terminé quand pnpm test:module M0.11 est vert (échoue si 0 test ; un test de comportement par mock et par état simulé) ET pnpm build passe ET pnpm lint ne renvoie aucune erreur.`
- **Budget** : 250k (M).

---

## Sortie de Niveau 0 (Definition of Done global)

- [ ] CI verte : lint + type-check + Vitest + **pgTAP RLS 100% bloquant** + Playwright (signup/login) + build.
- [ ] 2 fronts (`app.gosavr.io` dev) tournent vides mais sécurisés (RLS active partout).
- [ ] **Assertion `relrowsecurity` exhaustive verte** (garde-fou E3) : 0 table `plateforme.*`/`shared.*` sans RLS activée (hors service-role) — invariant testé en CI, pas seulement la matrice prose §09.
- [ ] `pnpm seed:demo` peuple un dev vierge.
- [ ] Logging + Sentry + `/health/full` + Slack opérationnels.
- [ ] Lint custom `mts1|everest` hors adapters = 0 (garde-fou 3).
- [ ] Aucune table `tms.*` (garde-fou 1) ; `scripts/check-schema-subset.sh` vert (diff vs `specs/ddl-cible/`).
- [ ] `specs/` versionné et synchronisé ; `pnpm test:module` + `pnpm check:coverage` opérationnels (conventions `12`).
- [ ] Mocks API tierces (0.11) livrés — pré-requis M1.5/M1.7/M1.8.
- [ ] **Checkpoint humain : audit dev senior (frère) avant de lancer V1.**

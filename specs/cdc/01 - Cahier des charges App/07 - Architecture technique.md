# 07 - Architecture technique


---

## ⚠ ADDENDUM 2026-06-10 — Scope V1 : ce document décrit l'ÉTAT FINAL (V2), pas le périmètre V1

> **À lire AVANT toute implémentation** (challenge logistique 2026-06-10 — formalise la réserve de scope du 2026-05-29 restée en attente, cf. [[08 - APIs et intégrations]] §1 note). Ce document a été rédigé pour l'écosystème cible Plateforme + Savr TMS natif. **En V1, les éléments suivants NE SONT PAS à développer** — en cas de conflit, [[00 - Scoping V1]], la [[Frontière TMS-Ready V1]] et le CLAUDE.md racine font foi :
>
> - **Schéma `tms.*` : NON créé en V1** (toute mention `tms.*` ici = cible V2). Les **kill switches §2.4 dans `tms.parametres_tms` n'existent pas en V1** — si un kill switch V1 s'avère nécessaire (couper le polling MTS-1, le push Pennylane), le poser dans la table de paramètres Plateforme existante (type `parametres_algo`, cf. [[04 - Data Model]]) au moment du module concerné, pas dans `tms.*`.
> - **Front `tms.gosavr.io` : réservé V2** (gabarit vide monorepo), aucun déploiement V1.
> - **« Licence MTS-1 terminée » (§7 plan de continuité) : vaut APRÈS le cutover V2 seulement.** En V1, MTS-1 est le **système de dispatch actif** (Strike/Marathon) piloté par l'adapter polling (cf. [[08 - APIs et intégrations]] §3bis) — la ligne « plus de fallback système » ne s'applique pas.
> - **Webhooks entrants TMS/Everest (§2.4 `POST /api/webhooks/*`, §8 `api.gosavr.io/webhooks/*`) : PAS un livrable V1.** V1 = polling MTS-1 sortant + entrant (aucun endpoint entrant exposé, surface d'attaque nulle). Le contrat webhook S1-S11 = cible V2 gelée. Seul webhook entrant V1 réel : **Resend** (`/webhooks/resend/events`, signature svix).
> - **Everest : hors go-live → V1.1** (gate 2026-06-08). Fallback AG IDF = Marathon via `parametres_algo.a_toutes_indisponible = true`.
> - **Adapter logistique** : toute intégration MTS-1/Everest passe par l'interface `logistique_provider` dans `packages/adapters/` (garde-fou 3 TMS-Ready — 0 réf directe ailleurs, lint/grep CI). **Spec de l'interface : [[Interface logistique_provider V1]]** *(créée 2026-06-10, challenge Frontière)*.
> - **Compléments 2026-06-10 (challenge Frontière)** : §0 monorepo — `packages/adapters/` ajouté à l'arbre (manquait) ; §2.1 — « 27 tables » corrigé (~48 tables `plateforme.*`, liste autoritative [[04 - Data Model]]) ; §3 — flux PDF corrigé (API Route/cron → Railway → upload **R2**, pas Edge Function ni Supabase Storage, file `jobs_pdf` cf. §04) ; §6 — secret **`MTS1_API_KEY`** ajouté (Supabase Vault, cf. §08 §3bis.3), `TMS_WEBHOOK_SECRET`/`PLATEFORME_WEBHOOK_SECRET`/`MISTRAL_OCR_API_KEY` = **V2 seulement** (aucun webhook TMS ni OCR en V1).

---

## Vue d'ensemble

La Plateforme Savr repose sur une architecture **serverless-first** : pas de serveur à gérer, les services managés (Supabase, Vercel, Cloudflare R2, Railway, Resend) absorbent la charge et la maintenance infra. Claude Code développe et déploie, l'infrastructure s'autogère.

```
[Navigateur utilisateur]
        ↓ HTTPS
[app.gosavr.io] ← Next.js 15 App Router (hébergé Vercel)
        ↓
[Supabase — 1 projet unique]
   ├─ schéma plateforme.* ← DB Plateforme
   ├─ schéma tms.*        ← DB TMS (schéma logique distinct, RLS deny cross-schema)
   └─ schéma shared.*     ← table `fichiers` (référentiel de stockage R2/Supabase)
        ↓ webhooks HMAC + JWT / API versionnée YYYY.MM
[TMS Savr (tms.gosavr.io)] ↔ [Pennylane v2] ↔ [Everest (via TMS)]
        ↓
[Cloudflare R2] ← fichiers volumineux (photos audit M05, PDFs archivés, exports) — egress 0€
[Supabase Storage] ← fichiers légers (docs chauffeurs, logos)
[Railway — Puppeteer] ← génération PDF à la demande
[Resend] ← envoi emails transactionnels
```

**Retournement architectural 2026-04-23** : après atelier avec le frère de Val, la décision initiale "2 projets Supabase isolés (Plateforme + TMS)" est **remplacée** par **1 projet Supabase unique avec 2 schémas PostgreSQL distincts** (`plateforme.*` et `tms.*`) + 1 schéma `shared.*` pour le référentiel de fichiers. Les 2 fronts Next.js restent distincts sur Vercel (`app.gosavr.io` et `tms.gosavr.io`). Le contrat API HMAC+JWT est conservé intégralement pour forcer la discipline architecturale et éviter les jointures cross-schema côté application.

**Principe directeur** : chaque brique est remplaçable indépendamment. Les 2 fronts restent découplés par contrat API. Si le besoin de scission DB émerge un jour (spin-off TMS, vente), un schéma PostgreSQL se déplace proprement vers un projet dédié.

---

## 0. Monorepo

Le code est organisé en **monorepo pnpm workspaces + Turborepo** pour mutualiser types, helpers et outillage entre les 2 apps.

```
savr/
├── packages/
│   ├── plateforme/       ← Next.js 15 Plateforme (app.gosavr.io)
│   ├── tms/              ← Next.js 15 TMS (tms.gosavr.io — gabarit vide V1, réservé V2)
│   ├── adapters/         ← logistique_provider + adapter_mts1 (V1) / adapter_everest (V1.1) — ajout 2026-06-10, garde-fou 3
│   └── shared/           ← types contrat API (16 endpoints), helpers, design tokens
├── supabase/
│   └── migrations/       ← dossier unique, convention YYYYMMDDHHMMSS_[plateforme|tms|shared]_xxx.sql
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

**Avantages** : types TypeScript du contrat API partagés des 2 côtés (impossible de dériver), cache build intelligent via Turborepo (PR ne touchant que `plateforme` ne rebuild pas `tms`), CI/CD unifiée en 1 workflow GitHub Actions.

**Déploiement** : 1 seul workflow GitHub Actions. Vercel déploie automatiquement les 2 apps en preview par PR et en prod sur merge `main`.

---

## 1. Environnements

### V1 : 2 environnements

| Environnement | URL Plateforme | URL TMS | Projet Supabase |
|---|---|---|---|
| **dev** | `dev.app.gosavr.io` | `dev.tms.gosavr.io` | 1 projet Supabase dev (schémas `plateforme.*` + `tms.*` + `shared.*`) |
| **prod** | `app.gosavr.io` | `tms.gosavr.io` | 1 projet Supabase prod (schémas `plateforme.*` + `tms.*` + `shared.*`) |

**Isolation stricte** : les deux projets Supabase (dev vs prod) sont distincts — aucune donnée de dev ne peut contaminer prod. Variables d'environnement séparées, clés API séparées.

**Isolation intra-projet** (dans chaque env) : les schémas `plateforme.*` et `tms.*` sont **cloisonnés par RLS cross-schema deny** (aucun rôle Plateforme ne peut lire/écrire dans `tms.*` et inversement). Les users sont **disjoints** — un chauffeur TMS ne peut jamais loguer sur la Plateforme et vice-versa. Voir [[09 - Authentification et permissions]] §RLS cross-schema.

### V1.1 : ajout staging (prévu, non bloquant)

Un troisième environnement `staging.app.gosavr.io` sera ajouté dès qu'un reviewer humain entre dans la boucle de validation avant déploiement prod. Effort estimé : 1-2h Claude Code (créer projet Supabase staging, copier migrations, mettre à jour pipeline CI/CD). Aucun refactoring d'architecture requis.

### Seed de données dev

Un script de seed peuplera l'environnement dev avec :
- 5 organisations fictives (2 traiteurs, 1 gestionnaire lieux, 1 agence, 1 client final)
- 20 événements avec collectes dans des états variés (programmée, en cours, réalisée, annulée)
- Des packs AG à niveaux variés (plein, épuisé, à renouveler)
- Des utilisateurs avec chaque rôle V1

Ce seed est rejouable à tout moment (`npm run seed:dev`) pour repartir d'un état propre.

---

## 2. Supabase

Supabase est le cœur de l'architecture : base de données, authentification, stockage fichiers, et fonctions serverless dans un seul service managé. **1 projet Supabase héberge les schémas `plateforme.*`, `tms.*` et `shared.*`**.

### 2.1 Base de données (PostgreSQL)

- **Plan dev** : Free tier (0€) — suffisant pour le développement, pas de backup nécessaire
- **Plan prod** : Pro (~25$/mois) dès le go-live — backups quotidiens automatiques (PITR 7 jours rétention), pas de pause automatique, 8 GB storage inclus
- **Extensions activées** : `uuid-ossp` (identifiants UUID), `pgcrypto` (hachage), `pg_trgm` (recherche textuelle sur lieux/traiteurs)
- **3 schémas logiques** :
  - `plateforme.*` — ~48 tables Plateforme V1 *(corrigé 2026-06-10 — ex « 27 », périmé ; liste autoritative : [[04 - Data Model]])* (organisations, events, collectes, tarifs, packs AG, factures, outbox, jobs_pdf, etc.)
  - `tms.*` — tables TMS (collectes_tms, tournees, prestataires, chauffeurs, pesees, audit_logs, etc.)
  - `shared.*` — table `fichiers` (référentiel multi-provider Supabase/R2) + éventuels utilitaires cross-domain futurs
- **RLS activée sur toutes les tables** avec **cross-schema deny par défaut** : aucune policy n'autorise un rôle Plateforme à lire/écrire dans `tms.*` (et inversement). Voir [[09 - Authentification et permissions]] pour le détail des politiques par rôle et les tests pgTAP associés.
- **PgBouncer activé dès V1** (transaction mode) : multiplie les 60 connections Postgres Pro en 200 connections applicatives, absorbe les pics webhooks + crons + Realtime.
- **Migrations versionnées** via Supabase CLI natif. **1 dossier unique `supabase/migrations/`** à la racine du monorepo. Convention de nommage `YYYYMMDDHHMMSS_[plateforme|tms|shared]_<slug>.sql` pour tracer l'origine. Les migrations cross-schemas (ex: fix RLS) sont préfixées `_shared_`. Pas de scripts `down` systématiques V1 : toute migration doit être backward-compatible (add column nullable OK, rename = 2 migrations en 2 PRs, drop column après 1 release sans usage).

### 2.2 Auth

- Provider principal : email + password (magic link en option V1.1)
- JWT session 1h, refresh token 30 jours
- SSO SAML anticipé en archi V1 (activable V2 sans migration de schéma)
- Voir [[09 - Authentification et permissions]] pour le détail complet

### 2.3 Storage — split Supabase / Cloudflare R2

**Décision atelier 2026-04-23** : les fichiers volumineux sont externalisés sur **Cloudflare R2** (egress 0€, storage 0.015$/GB) pour éviter de saturer la bande passante Supabase Pro (250 GB/mois inclus) et maîtriser les coûts à volume V2.

**Supabase Storage** (fichiers légers, accès RLS simple) :

| Bucket | Contenu | Accès |
|---|---|---|
| `logos` | Logos organisations | Public (URL signée) |
| `docs-chauffeurs` | Permis, visites médicales, cartes grises (léger, RLS critique) | RLS prestataire + admin_tms |

**Cloudflare R2** (fichiers volumineux, egress 0€) :

| Bucket R2 | Contenu | Pattern d'accès |
|---|---|---|
| `bordereaux` | PDFs bordereaux de pesée | URL pré-signée 15 min |
| `attestations` | PDFs attestations de don AG | URL pré-signée 15 min |
| `rapports` | PDFs rapports de recyclage | URL pré-signée 15 min |
| `photos-collectes` | Photos Strike (V1), photos audit M05 (V2) | URL pré-signée 15 min |
| `factures-prestataires` | PDFs factures prestataires OCR archivés | URL pré-signée 15 min |

**Référentiel unique** : toute référence de fichier est enregistrée dans `shared.fichiers` avec colonnes `storage_provider` (`supabase`|`r2`), `bucket`, `key`, `content_hash`, `size_bytes`, `entity_type` (polymorphique), `entity_id`, `created_by`, `created_at`.

**Rétention** : PDFs conservés indéfiniment (obligation légale / audit). Photos de collecte 3 ans puis archivées sur bucket R2 froid.

**Génération PDF** : les PDFs sont générés par Railway (Puppeteer) puis uploadés dans le bon bucket R2 via SDK AWS S3-compatible. Upload/download client direct avec URLs pré-signées (pas de passage par Vercel ni Supabase).

### 2.4 Code serveur — Next.js API Routes + pg_cron

**Décision atelier 2026-04-23** : le code serveur tourne **principalement en Next.js API Routes sur Vercel** (pas en Supabase Edge Functions). Raisons : types TypeScript partagés via `packages/shared`, même runtime que les fronts, pas de quota Edge Functions à surveiller, tooling CI/CD unifié.

| Endpoint / Cron | Hébergement | Déclencheur | Rôle |
|---|---|---|---|
| | | | **❌ NE PAS DÉVELOPPER V1 (audit RLS 2026-06-11, Bloc E)** — V1 = polling MTS-1 (§08 §3bis : « aucun endpoint entrant, surface d'attaque entrante nulle ») + Everest V1.1 + TMS V2. Seul webhook entrant V1 = `POST /webhooks/resend/events` (signé svix, §08 §4). Rangée conservée comme cible V1.1/V2 (HMAC, `integrations_inbox`). |
| `POST /api/sync/poll` | Vercel (Next.js API Route) | Cron 15 min **24/7** | Polling MTS-1 (§08 §3bis.7) — *V1 c'est LE chemin entrant, pas un fallback* |
| | | | **❌ Webhook V2 (TMS natif).** En V1, la même logique métier (bordereau/attestation, PDF, brouillon Pennylane, badge `realisee_sans_collecte`) est déclenchée **par le cron de polling** quand il détecte l'état terminal MTS-1 — pas par un endpoint entrant. La logique décrite reste valide, le déclencheur change. |
| `on-pack-ag-epuise` | Vercel (trigger DB → webhook) | Trigger DB sur `plateforme.packs_antgaspi` | Bloque la programmation AG + notif Admin |
| `on-statut-collecte-change` | Vercel (trigger DB → webhook) | Trigger DB sur `plateforme.collectes.statut` | Dispatch emails transactionnels via Resend |
| `scheduler-attestations` | Vercel Cron | J+1 6h | Batch génération attestations de don AG |
| `scheduler-bordereaux` | Vercel Cron | J+1 6h | Batch génération bordereaux ZD |
| `purge-geoloc` | **pg_cron Supabase** (exception) | Cron quotidien | Purge géoloc > 30j en local DB (évite aller-retour réseau sur grosses DELETE) |

**Kill switches** : 3 bools dans `tms.parametres_tms` permettent la coupure instantanée sans revert Git : `integration_plateforme_active`, `polling_e6_active`, `ocr_factures_active`. Coupure via UI Admin en 30 sec.

**Sécurité des routes serveur — doctrine V1 (ajout 2026-06-11, audit RLS Bloc E — 3 trous transverses bouchés)** :

1. **Validation d'entrée systématique** : toute API route et tout webhook parse son payload via un **schéma Zod** défini dans `packages/shared` (un schéma par endpoint, typé, réutilisé front/back). Payload invalide → **422** + trace `integrations_logs` si route d'intégration. Aucune route ne lit `req.body` brut. (Le CDC ne le spécifiait nulle part — chaque route aurait improvisé.)
2. **Protection des routes cron** : les URLs Vercel Cron (`/api/sync/poll`, `scheduler-attestations`, `scheduler-bordereaux`, poll Pennylane J+1 3h, worker outbox) sont **publiquement invocables** par défaut. Chaque route cron vérifie en tête `Authorization: Bearer ${CRON_SECRET}` (env var Vercel, transmise automatiquement par Vercel Cron) → sinon **401, aucun traitement**. Complété par les verrous applicatifs existants (`pg_try_advisory_lock` worker outbox, dédup `integrations_inbox` poll). Secret dans l'inventaire §6 (rotation annuelle).
3. **Auth du micro-service Puppeteer (Railway)** : le container n'est pas exposé sans contrôle — header `X-Internal-Token` (secret partagé Vercel ↔ Railway, Vault/env) vérifié sur chaque requête de rendu ; réseau privé Railway si disponible. Idem pour les routes appelées par triggers DB (`on-pack-ag-epuise`, `on-statut-collecte-change`) : appel `pg_net` avec header secret (`INTERNAL_WEBHOOK_SECRET` depuis Supabase Vault), vérifié côté route.

---

## 3. Railway — Puppeteer (génération PDF)

### Pourquoi Railway

Puppeteer (bibliothèque de génération PDF via Chrome headless) ne peut pas tourner dans Supabase Edge Functions — trop lourd. Railway est un hébergeur de conteneurs léger, ~10$/mois pour l'usage Savr.

### Architecture

```
API Route / batch Vercel Cron (J+1 6h)           ← corrigé 2026-06-10 (ex « Edge Function », décision 9.1.16)
    → INSERT plateforme.jobs_pdf (file, cf. §04)
    → worker POST /generate-pdf {template, data} → Railway (service Puppeteer)
    → Génère le PDF
    → Upload Cloudflare R2 (bucket §2.3) + ligne shared.fichiers   ← corrigé 2026-06-10 (ex « Supabase Storage », décision 9.1.14)
    → jobs_pdf.statut = done, fichier_id renseigné
```

### Templates PDF V1

| Template | Déclenché par | Destination bucket |
|---|---|---|
| Bordereau de pesée ZD | Batch J+1 6h | `bordereaux` |
| Attestation de don AG | Batch J+1 6h | `attestations` |
| Rapport de recyclage | Demande manuelle ou auto J+1 | `rapports` |

### Résilience

Si Railway est indisponible : la génération PDF est mise en file d'attente (table `jobs_pdf` en DB). Un retry automatique toutes les 15 min pendant 4h. Si toujours en échec après 4h : notif Admin Savr.

---

## 4. CI/CD — Pipeline GitHub Actions

### Principe

Tout le code est versionné sur GitHub. Les déploiements en prod sont automatiques mais conditionnés au passage des tests. Claude Code ne peut pas déployer en prod si les tests échouent.

### Pipeline sur merge vers `main` (→ prod)

```
1. Tests unitaires (règles métier critiques)
   → Échec = déploiement bloqué

2. Tests d'intégration (RLS + flux collecte→bordereau→facture)
   → Échec = déploiement bloqué

3. Test E2E Playwright : "programmer une collecte" (parcours critique)
   → Échec = déploiement bloqué

4. Migration DB (Supabase CLI)
   → Applique les migrations en prod

5. Déploiement frontend + Edge Functions
   → Go live
```

### Pipeline sur branche feature (→ dev)

Mêmes tests, déploiement sur environnement dev. Utilisé par Claude Code pour valider avant de proposer un merge vers main.

### Couverture cible V1

~60-70% de couverture automatique sur la logique métier (règles tarification, débit packs, génération attestations, RLS). Le reste est testé manuellement sur dev avant chaque release significative.

### Stratégie de rollback

Si un bug critique est détecté en prod après déploiement : revert du commit sur GitHub déclenche automatiquement un redéploiement de la version précédente. Délai de rollback : < 5 minutes.

---

## 5. Monitoring et observabilité

> **Spec détaillée : [[07 - Observabilité/00 - Stack retenue]]** (catalogue logs, liste d'alertes, audit trail, health checks — session 2026-06-08). Cette section reste le résumé infra. **Routage des alertes actualisé (arbitrage OBS-1)** : les alertes applicatives passent par **Slack 3 canaux par sévérité** (`#savr-alerts-critique` / `-eleve` / `-info`, cf. [[07 - Observabilité/03 - Alertes]]) ; le SMS Better Uptime ci-dessous est conservé comme **filet uptime critique** (hors Slack).

### Better Uptime (uptime monitoring)

- **Plan** : gratuit (10 moniteurs)
- **Ce qu'il surveille** :
  - `app.gosavr.io` (santé frontend)
  - `api.gosavr.io/health` (santé API)
  - `tms.gosavr.io` (santé TMS, si exposé)
  - Railway Puppeteer endpoint
- **Fréquence** : ping toutes les 3 minutes
- **Alertes** : SMS + email à Val dès qu'un moniteur passe en erreur
- **Critique pour Savr** : les opérations se déroulent entre 22h et 3h. Un incident non détecté pendant cette fenêtre = collecte sans retour de statut pour Strike.

### Sentry (error tracking)

- **Plan** : gratuit (< 5 000 erreurs/mois — largement suffisant pour les volumes Savr V1)
- **Intégré dans** : frontend Next.js + Edge Functions Supabase
- **Ce qu'il capture** : toute exception non gérée avec stacktrace, contexte utilisateur (rôle, organisation_id), et la requête ayant déclenché l'erreur
- **Alertes** : email à Val dès qu'une nouvelle erreur apparaît (pas un doublon d'une erreur connue)
- **Upgrade** : si Savr dépasse 5 000 erreurs/mois, c'est le signe d'un problème structurel à corriger — pas un signal d'upgrade plan Sentry

### Logs Supabase

Supabase conserve nativement les logs DB et Auth sur 7 jours (plan Pro). Consultables depuis le dashboard Supabase. Complément des logs Sentry pour les incidents côté base de données.

---

## 6. Gestion des secrets et variables d'environnement

### Principe

Aucun secret ne transite dans le code ou le repo GitHub. Toutes les clés API, credentials, et variables sensibles sont gérées via les variables d'environnement de chaque service.

### Inventaire des secrets V1

| Secret | Utilisé par | Renouvellement |
|---|---|---|
| `SUPABASE_URL` + `SUPABASE_ANON_KEY` | Frontend | Jamais (public par design) |
| `SUPABASE_SERVICE_ROLE_KEY` | API Routes Next.js (serveur) | Annuel |
| `PENNYLANE_API_KEY` | API Route facturation | À la rotation Pennylane |
| `RESEND_API_KEY` | API Route emails | Annuel |
| `MTS1_API_KEY` *(ajout 2026-06-10 — challenge Frontière, manquait)* | Adapter MTS-1 (`Authorization: Bearer`, sortant uniquement) — **Supabase Vault**, cf. §08 §3bis.3 | Manuelle (durée de vie token = QO éditeur 3bis.13.4) |
| `TMS_WEBHOOK_SECRET` (HMAC) — **V2 seulement** | Validation webhooks entrants TMS | Annuel |
| `PLATEFORME_WEBHOOK_SECRET` (HMAC) — **V2 seulement** | Signature webhooks sortants vers TMS | Annuel |
| `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` | Upload/download Cloudflare R2 | Annuel |
| `RAILWAY_PDF_SECRET` | Authentification Railway | Annuel |
| `MISTRAL_OCR_API_KEY` — **V2 seulement** (OCR M08 TMS) | OCR factures prestataires | À la rotation Mistral |
| `SENTRY_DSN` | Frontend + API Routes | Jamais (non sensible) |

**Rotation annuelle** (retournement atelier 2026-04-23 vs décision 9.3.16 semestrielle) : simplification opérationnelle, procédure documentée dans runbook sécurité.

### Stockage secrets

- **GitHub Actions** : secrets GitHub (jamais dans le code)
- **Vercel** : variables d'environnement Vercel (par projet, par env)
- **Supabase Vault** (`vault.secrets`) : secrets accessibles depuis les triggers DB / pg_cron
- **Railway** : variables d'environnement Railway
- **Local dev** : fichier `.env.local` gitignored

---

## 7. Backup et plan de continuité

### Backup DB

Supabase Pro inclut des backups quotidiens automatiques avec rétention 7 jours. En cas de corruption ou suppression accidentelle : restauration possible jusqu'à J-7 depuis le dashboard Supabase. Délai de restauration : < 30 minutes.

**Point d'attention** : Supabase Storage (fichiers PDF) n'est PAS sauvegardé automatiquement sur le plan Pro. Les PDFs générés sont reconstructibles à la demande via Puppeteer (les données source sont en DB). Une régénération en masse est possible en cas de perte.

### Plan de continuité opérationnelle

| Scénario | Impact | Procédure |
|---|---|---|
| Supabase indisponible | Plateforme hors ligne | Attendre retour (SLA Supabase 99.9%). En cas d'opération urgente : commandes manuelles Admin. Notifier Strike par téléphone. |
| Railway indisponible | PDFs non générés | File d'attente activée, retry auto toutes les 15 min. Pas d'impact opérationnel immédiat. |
| Resend indisponible | Emails non envoyés | Retry automatique Resend intégré. En cas de panne prolongée : emails manuels Admin. |
| Bug critique en prod | Comportement imprévu | Rollback GitHub < 5 min. Better Uptime alerte Val immédiatement. |

**MTS-1 terminé** : la licence est arrêtée, il n'y a plus de fallback système côté TMS. En cas d'indisponibilité du TMS Savr : toutes les opérations TMS passent en mode manuel Admin Savr (saisie directe en DB via dashboard Supabase ou interface Admin dédiée).

---

## 8. Sous-domaines et DNS

### Structure V1

| Sous-domaine | Service | Environnement |
|---|---|---|
| `app.gosavr.io` | Plateforme (frontend + API) | Prod |
| `dev.app.gosavr.io` | Plateforme | Dev |
| `tms.gosavr.io` | TMS Savr | Prod |
| `api.gosavr.io/webhooks/*` | Webhooks entrants (TMS, Everest) | Prod |

### Question ouverte



✅ **LEVÉE 2026-06-11** — Registrar = **OVH**. Contacts transférés (demande OVH 4468362 terminée). Zones DNS sous contrôle Val. CNAME Supabase/Railway/Vercel à configurer au démarrage Phase 1 infra.

---

## Décisions prises

| # | Décision | Alternative écartée | Raison |
|---|---|---|---|
| 9.1.1 | 2 environnements V1 (dev + prod) | 3 env dès V1 | Inutile sans reviewer humain dans la boucle. Staging ajouté V1.1 sans refactoring. |
| 9.1.2 | Staging prévu V1.1 (non bloquant) | Pas de staging du tout | Reviewer humain peut en avoir besoin pour valider avant prod. |
| 9.1.3 | Better Uptime (gratuit) + Sentry (gratuit) V1, Datadog V1.1 | Datadog dès V1 (~80-200$/mois) | Surcoût non justifié V1, stack gratuite couvre 95% besoins early-stage. Datadog intégré V1.1 avec OpenTelemetry instrumenté dès V1 pour faciliter bascule. |
| 9.1.4 | Railway pour Puppeteer (~10$/mois) | `@sparticuz/chromium` en Edge Function (0€) | Railway plus fiable/maintenable sur mises en page complexes. |
| 9.1.5 | CI/CD GitHub Actions avec tests bloquants | Déploiement manuel | Garantit qu'aucun code cassé n'atteint la prod. |
| 9.1.6 | Rollback via revert Git | Procédure manuelle | Automatique, < 5 min, sans intervention humaine. |
| 9.1.7 | PDFs reconstructibles à la demande | Backup Storage automatisé | Plan Pro ne backup pas Storage. Données source DB suffisent. |
| 9.1.8 | Supabase région Paris (`eu-west-3`) | Frankfurt, autres régions EU | Même tarif, hébergement France, RGPD maximal. |
| **9.1.10** | **1 projet Supabase unique, 3 schémas `plateforme.*` + `tms.*` + `shared.*`** (retournement atelier 2026-04-23, typo "2 schémas" corrigée audit cohérence inter-CDC 2026-05-01 B3) | 2 projets Supabase distincts | Simplicité opérationnelle (1 seul monitoring, 1 seul plan Pro). Cloisonnement maintenu par RLS cross-schema deny + users disjoints. Coût -25$/mois. |
| **9.1.11** | **Monorepo pnpm + Turborepo** (`packages/plateforme`, `tms`, `shared`) | 2 repos distincts | Types contrat API partagés, cache build intelligent, 1 CI/CD. |
| **9.1.12** | **Next.js 15 App Router** pour les 2 apps | Vite + React, Pages Router | Server Components + API Routes unifiés, SEO Plateforme, même stack partout. |
| **9.1.13** | **shadcn/ui** pour les 2 apps + design tokens partagés dans `packages/shared` | Chakra, MUI | Cohérence UX Plateforme/TMS, customisable, communauté forte. |
| **9.1.14** | **Cloudflare R2** pour fichiers volumineux (photos, PDFs, factures OCR) | S3, Supabase Storage uniquement | Egress 0€ critique pour photos consommées depuis mobile + dashboards. |
| **9.1.15** | **Vercel** pour les 2 fronts (`app.gosavr.io` + `tms.gosavr.io`) | Netlify, Cloudflare Pages | Intégration native monorepo Turborepo, preview deployments par PR. |
| **9.1.16** | **Next.js API Routes** pour webhooks entrants + crons métier | Supabase Edge Functions | Types partagés, même runtime que front, pas de quota. Exception : `pg_cron` pour purge géoloc (grosse DELETE en local DB). |
| **9.1.17** | **Supabase CLI natif** pour migrations, dossier unique avec convention `YYYYMMDDHHMMSS_[plateforme\|tms\|shared]_xxx.sql` | Drizzle migrations, Flyway | Workflow officiel, pas de surcouche, lisible. |
| **9.1.18** | **Pas de scripts down systématiques V1** (backward-compatible obligatoire) | Up/Down pairés | Coût maintenance vs bénéfice marginal. Rollback = revert Git + migration corrective. |
| **9.1.19** | **PgBouncer transaction mode activé dès V1** | Connexions directes | 60 connections Pro × PgBouncer = 200 applicatives. |
| **9.1.20** | **Rotation secrets annuelle manuelle V1** (retournement vs semestrielle 9.3.16) | Rotation automatique | Simplification opérationnelle V1. |
| **9.1.21** | **Pas de système feature flags V1** — kill switches ad-hoc dans `tms.parametres_tms` | Unleash, LaunchDarkly, table dédiée | Over-engineering V1. Revert Git < 5 min + 3 kill switches suffisent. |

## Questions ouvertes

- **✅ LEVÉE 2026-06-11 — Registrar = OVH, contacts transférés (demande 4468362). CNAME Supabase/Railway/Vercel à configurer au démarrage Phase 1 infra.****

**Re-tranché 2026-05-31 (revue sobriété §08 App B1)** : **V1 = polling J+1 3h uniquement** (un seul chemin de code, latence ≤ 24h acceptable pour le recouvrement). Webhook `invoice.paid` temps réel **reporté V1.1**. *(Annule la décision 2026-04-28 « webhook temps réel retenu » — cf. §08 §2 + §08 Questions ouvertes.)*

## Liens

- [[04 - Data Model]]
- [[08 - APIs et intégrations]]
- [[09 - Authentification et permissions]]
- [[13 - Migration depuis Bubble]]
- [[14 - Scalabilité et évolutivité]]

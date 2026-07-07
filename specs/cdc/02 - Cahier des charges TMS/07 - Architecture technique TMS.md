# 07 - Architecture technique TMS


**Rôle du document** : décrit l'architecture technique du Savr TMS. Pendant TMS de [[../01 - Cahier des charges App/07 - Architecture technique]]. Les deux documents doivent rester alignés — l'infrastructure est mutualisée à 80%.

---

## 1. Vue d'ensemble

Le Savr TMS est un des **deux fronts Next.js** (`tms.gosavr.io`) du monorepo Savr, partageant avec la Plateforme (`app.gosavr.io`) un **projet Supabase unique** segmenté en 3 schémas PostgreSQL distincts.

```
[Ops Savr / Admin TMS / Managers / Chauffeurs]
        ↓ HTTPS
[tms.gosavr.io] ← Next.js 15 App Router (hébergé Vercel)
        ↓
[Supabase — projet unique partagé avec Plateforme]
   ├─ schéma tms.*        ← tables TMS (collectes_tms, tournees, pesees, chauffeurs, etc.)
   ├─ schéma plateforme.* ← inaccessible au TMS (RLS cross-schema deny)
   └─ schéma shared.*     ← table fichiers (référentiel R2/Supabase)
        ↓ webhooks HMAC + JWT versionné YYYY.MM
[Plateforme (app.gosavr.io)]
        ↓
[Cloudflare R2] ← photos audit M05, PDFs factures OCR archivés, exports
[Supabase Storage] ← docs chauffeurs légers (permis, visites médicales)
[Mistral OCR] ← extraction factures prestataires
[Everest (A Toutes!)] ← saisie terrain logistique (intégration TMS-only)
```

**Principe directeur** : mêmes services managés que la Plateforme, mêmes patterns. Le TMS hérite de toute l'infra (monorepo, Turborepo, Vercel, Supabase, Sentry, Better Uptime, Cloudflare R2). Seules les spécificités TMS (OCR factures, intégration Everest, app mobile chauffeur PWA) apportent des briques additionnelles.

---

## 2. Monorepo et packaging

Même organisation que la Plateforme (voir [[../01 - Cahier des charges App/07 - Architecture technique#0. Monorepo]]) :

```
savr/
├── packages/
│   ├── plateforme/
│   ├── tms/              ← package TMS
│   ├── ui-tms/           ← composants React partagés dashboards TMS (propagation §11 2026-04-27)
│   └── shared/           ← types contrat API (16 endpoints), helpers, design tokens partagés
├── supabase/migrations/
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

**`packages/ui-tms/`** (propagation §11 2026-04-27) — composants React partagés dashboards (cf. [[11 - Dashboards TMS]] §3.7) : `<DashboardExportButton />`, `<KPICard />`, `<TuileJauge />`, `<DataTable />`, `<AlerteBandeau />`, `<DateRangePicker />`, `<ChartBar/Line/Pie />`, `<EmptyState />`, `<LoadingSkeleton />`.

**Types TypeScript du contrat API** (16 endpoints, payloads, erreurs) : définis **une seule fois** dans `packages/shared/api-contract/` et importés des 2 côtés. Impossible de dériver — toute modification casse les 2 builds.

---

## 3. Environnements

Mêmes principes que Plateforme (voir [[../01 - Cahier des charges App/07 - Architecture technique#1. Environnements]]) :

| Environnement | URL TMS | Projet Supabase |
|---|---|---|
| **dev** | `dev.tms.gosavr.io` | Supabase dev (schémas `plateforme.*` + `tms.*` + `shared.*`) |
| **prod** | `tms.gosavr.io` | Supabase prod (schémas `plateforme.*` + `tms.*` + `shared.*`) |

**Isolation cross-schemas** : voir [[04 - Data Model TMS#Addendum architectural 2026-04-23]].

**Seed dev** : script `packages/tms/supabase/seed.tms.sql` peuple :
- 3 prestataires principaux (Strike, Marathon, A Toutes!) + 5 prestataires province fictifs
- 10 chauffeurs, 8 véhicules, 3 équipiers
- Catalogue types véhicules, types contenants, formules tarifaires
- 20 collectes TMS dans états variés (attribuee, en_cours, realisee, etc.)
- 5 tournées simulées avec routing factice
- 101 zones géo (départements FR + zones_etrangeres)

Rejouable par `supabase db reset` pour repartir propre.

---

## 4. Supabase — côté TMS

### 4.1 Schéma `tms.*` dans le projet mutualisé

Tables principales (voir [[04 - Data Model TMS]] pour le détail complet) :
- **Opérationnelles** : `collectes_tms`, `tournees`, `etapes_tournee`, `pesees`, `incidents`, `rolls_mouvements`, `stocks_rolls_traiteurs`
- **Référentiels** : `prestataires`, `chauffeurs`, `vehicules`, `equipiers`, `types_vehicules`, `types_contenants`, `formules_catalogue`, `grilles_tarifaires_prestataires`, `zones_geo`
- **Facturation prestataire** : `vacations`, `factures_prestataires`, `avoirs_prestataires`, `courses_logistiques` (miroir Plateforme)
- **Intégrations** : `integrations_inbox`, `integrations_logs`, `integrations_dlq`, `integrations_polling_state`
- **Auth & audit** : `users_tms`, `audit_logs`, `parametres_tms`

### 4.2 RLS

- **Cross-schema deny** strict (aucun rôle TMS ne voit `plateforme.*`).
- **Intra-schéma** : 4 rôles V1 (`ops_savr`, `admin_tms`, `manager_prestataire`, `chauffeur`) + policies par table selon matrice [[09 - Authentification et permissions TMS]].
- Tests **pgTAP** bloquants CI : 100% des policies, 1 allow + 1 deny minimum par policy.
- Benchmarks 100k rows sur `tms.pesees` et `tms.audit_logs` avant go-live (p95 < 200ms).

### 4.3 Extensions PostgreSQL activées (projet-wide)

Mêmes extensions que Plateforme : `uuid-ossp`, `pgcrypto`, `pg_trgm`. Extension additionnelle TMS : `cube` + `earthdistance` (si besoin futur de calculs géo — reporté V2 avec routing M15).

### 4.4 Migrations

Dossier unique `supabase/migrations/` à la racine monorepo. Migrations TMS préfixées `YYYYMMDDHHMMSS_tms_<slug>.sql`. Voir [[../01 - Cahier des charges App/07 - Architecture technique#2.1 Base de données (PostgreSQL)]].

---

## 5. Storage — split Supabase / Cloudflare R2

Décision atelier 2026-04-23 : **fichiers volumineux externalisés sur Cloudflare R2** (egress 0€) pour absorber le volume photos audit M05 V2 et maîtriser les coûts.

**Supabase Storage TMS** (léger, RLS native) :

| Bucket | Contenu | Accès |
|---|---|---|
| `docs-chauffeurs` | Permis de conduire + pièce d'identité chauffeurs (carte grise véhicule retirée revue sobriété M03 passe 2 2026-04-29 — `vehicules.carte_grise_url` supprimé) | RLS prestataire + admin_tms |

**Cloudflare R2 TMS** (volume, egress 0€) :

| Bucket R2 | Contenu | Pattern d'accès |
|---|---|---|
| `photos-collectes-tms` | Photos audit M05 chauffeurs (état lieu, anomalie, aucun repas) | URL pré-signée 15 min |
| `photos-incidents` | Photos incidents collecte remontées par chauffeur | URL pré-signée 15 min |
| `signatures-assos` | Signatures associations bénéficiaires AG | URL pré-signée 15 min |
| `factures-prestataires` | PDFs factures prestataires avant OCR + après archivage | URL pré-signée 15 min |

**Référentiel unique** : tout fichier est enregistré dans `shared.fichiers` (voir [[../01 - Cahier des charges App/04 - Data Model#Table shared fichiers]]). Les payloads API transportent des IDs de fichier, jamais d'URLs directes.

**Cycle de vie** :
- Photos audit M05 : conservation 3 ans puis archivage bucket R2 froid, purge 10 ans
- Photos incidents : conservation 5 ans (contentieux)
- Signatures assos : conservation 10 ans (conformité registre don 2041-GE)
- Factures prestataires archivées : 10 ans (obligation comptable)

---

## 6. Code serveur TMS

### 6.1 Next.js API Routes sur Vercel

Principe identique à Plateforme : webhooks entrants + crons métier en Next.js API Routes par défaut. **Edge Functions Supabase autorisées V1 pour cas d'usage spécifiques** (propagation §12 D5 2026-04-27 — alignement M13/§11/§12) :

- **M13 secrets** : `reveal_secret`, `rotate_secret`, `test_secret` (cf. §17 ci-dessous + R_M13.16) — accès Vault depuis runtime authentifié `admin_tms` uniquement.
- **§11 dashboard** : `dashboard_export` (export CSV/PDF avec RLS user-scope respectée — cf. [[11 - Dashboards TMS]] §3.6).
- **§12 push chauffeur** : `tms.push_send` (Web Push VAPID, lib `web-push`) — invoquée depuis triggers DB ou crons (attribution tournée, rappel H-30, alerte Ops). Cf. §12 §3.5 et M05 D15/D16.

Tous les autres cas (webhooks entrants, crons métier M01/M02/M07/M08, OCR, intégration Everest M14) restent en **Next.js API Routes Vercel** (types partagés, même runtime que front, pas de quota Edge). Exception historique `pg_cron` pour purge géoloc 30j (M05 R_M05.13) conservée.

| Endpoint | Hébergement | Déclencheur | Rôle |
|---|---|---|---|
| `POST /api/webhooks/plateforme/*` | Vercel | Webhooks entrants Plateforme (collecte créée, modifiée, annulée, lieu MAJ, prestataire MAJ) | Validation HMAC, écriture `tms.integrations_inbox`, traitement asynchrone |
| `POST /api/webhooks/everest/*` | Vercel | Webhooks Everest (A Toutes!) | Réception confirmations A Toutes! si API Everest disponible (V1 = workflow manuel Ops) |
| `on-tournee-cout-update` | Vercel (Trigger DB) | UPDATE `tms.tournees.cout_final_ht` ou `push_s6_version` *(noms corrigés audit 2026-05-26 A2 — ex `cout_total_centimes`/`version_paiement` inexistants sur la table)* | **Nouveau revue sobriété 2026-05-01 A2** — appelle `plateforme.fn_recalc_marge_tournee(tournee_id)` cross-schema (remplace ex-webhook S6) |
| `POST /api/ocr/process` | Vercel | Upload facture prestataire par Ops | Appel Mistral OCR, préremplissage formulaire |
| `on-collecte-realisee` | Vercel (API Route) | Transition statut `en_cours` → `realisee` | Calcul `courses_logistiques`, push webhook `collecte-terminee` vers Plateforme |
| `on-refus-prestataire` | Vercel (API Route) | Statut `rejetee_par_prestataire` | Recalcul suggestion M12 T2 (sans bascule auto) — revue sobriété 2026-04-29 : auto-relance hybride 4h + escalade 3 refus consécutifs supprimées |
| `scheduler-archivage-docs` | Vercel Cron | Quotidien 3h | Purge soft-deleted `tms.chauffeurs` > 3 ans post-départ |
| `purge-geoloc-cron` | **pg_cron Supabase** | Quotidien 2h | Purge données géoloc > 30j (exception pg_cron pour grosse DELETE locale) |

### 6.2 Kill switches

3 bools dans `tms.parametres_tms.namespace=kill_switches` permettent la coupure instantanée sans revert Git (voir [[04 - Data Model TMS#Table tms parametres_tms]]) :
- `integration_plateforme_active`
- `polling_e6_active`
- `ocr_factures_active`

Modifiables par `admin_tms` depuis UI Admin, changement effectif < 30 sec.

---

## 7. App mobile chauffeur M05 — PWA

Décision atelier 2026-04-23 : **PWA en V1**, React Native reporté V1.1+.

### 7.1 Stack PWA

- **Next.js 15** (même package `packages/tms` avec route dédiée `/m/*` — propagation §12 D1 2026-04-27, alignement §11 D1 mono-domaine `tms.gosavr.io`)
- **shadcn/ui** composants responsive (mobile-first)
- **Service Worker** pour cache shell + data de la tournée courante (résilience coupure réseau ~30 sec)
- **Manifest PWA** pour install home screen iOS / Android
- **Web APIs** natives : `getUserMedia` (caméra photos), `geolocation` (géoloc tournée), `indexedDB` (cache tournée)

### 7.2 Cibles perfs

- Bundle cible < 200 KB compressé core JS + code splitting par route
- Temps first contentful paint < 1.5s sur 4G moyenne
- Bundle de la tournée (JSON) < 50 KB pour chargement rapide

### 7.3 Offline V1 — offline-first complet (propagation §12 D4 2026-04-27 — alignement M05)

- **V1 = offline-first complet** : Service Worker (Serwist `@serwist/next` v9+, propagation §12 D3) + IndexedDB (4 object stores : `sync_queue`, `pesees_local`, `signatures_local`, `photos_local`) + Background Sync API (Chromium / Safari iOS 16.4+ partiel). Cap queue 3 tournées + 150 photos / 300 Mo (M05 D2). Chauffeur peut saisir pesées, photos, signatures sans réseau, sync différée au retour réseau (LWW + audit log côté serveur, M05 D1).
- **Justification du retournement** : ex-§7.7.3 (atelier 2026-04-23) annonçait "V1 cache HTTP simple, V1.1 offline-first" — obsolète. M05 (V1 rédigée 2026-04-24) est la source de vérité fonctionnelle et impose offline-first dès V1 (zone blanche, sous-sols parking). §12 D4 (2026-04-27) acte le réalignement architecture.
- **V1.1+** : améliorations possibles (sync forcé background toutes les 5 min, conflict resolution avancée multi-versions, compression WebP/adaptative).

### 7.4 Limites PWA assumées V1

- Push notifications iOS Safari : support fragile en 2026 — fallback email + SMS pour alertes critiques
- Caméra : qualité/fluidité photo inférieure à app native, acceptable V1
- Si V1.1 passe en React Native : **réécriture mobile** (pas de migration douce depuis PWA). Risque accepté par Val en atelier.

---

## 8. Intégration Everest (A Toutes!) — TMS-only

Décision actée (§ CDC Plateforme 9.3.4) : Everest est rattaché au TMS, pas à la Plateforme.

### 8.1 V1

- **Aucune API Everest** disponible côté A Toutes! (hypothèse actuelle).
- Workflow manuel Ops : indisponibilité déclarée dans `tms.parametres_tms.toutes_disponibilite_statut`.
- Validation terrain par A Toutes! sur leur propre outil Everest, remontée manuelle à Ops.

### 8.2 V2

- Si A Toutes! ouvre API Everest : webhook entrant `POST /api/webhooks/everest/collecte-confirmee` déjà pré-spécifié.
- Endpoint TMS prêt à recevoir, policies RLS déjà prévues.

---

## 9. Intégration Mistral OCR (factures prestataires)

Décision atelier 2026-04-23 : **Mistral OCR** pour extraction automatique des factures prestataires scannées/PDF.

### 9.1 Flow

```
Ops upload PDF facture
    ↓
API Route POST /api/ocr/process
    ↓
Mistral OCR API (async)
    ↓
Préremplit pdf_extraction_json sur tms.factures_prestataires
    ↓
Ops valide/corrige formulaire
    ↓
Rapprochement automatique vs vacations / courses_logistiques
```

### 9.2 Coûts

- ~0.001$/facture
- Volume V1 : 3 prestataires × 10 factures/mois = ~0.03€/mois
- Volume V2 : 15 prestataires × 15 factures/mois = ~0.25€/mois

### 9.3 Fallback

- Si Mistral OCR échoue (timeout, API down, parsing impossible) → saisie manuelle Ops dans formulaire M01.
- Kill switch `ocr_factures_active = false` force le mode manuel pour tous.

---

## 10. CI/CD TMS

Même pipeline GitHub Actions que Plateforme (1 workflow unique monorepo, skip intelligent Turborepo). Voir [[../01 - Cahier des charges App/07 - Architecture technique#4. CI/CD — Pipeline GitHub Actions]].

### Spécificités TMS

- **Tests E2E Playwright V1** (5 parcours critiques TMS) :
  - Ops attribue collecte à prestataire (M02 W1)
  - Manager prestataire accepte collecte
  - Chauffeur saisit pesée ZD depuis mobile (M05)
  - Ops valide facture prestataire OCR-ée (M09)
  - Admin TMS déclenche annulation collecte (M02 W6)

- **Tests pgTAP bloquants** : 100% des policies RLS `tms.*`, benchmarks 100k rows sur `pesees` et `audit_logs`.

---

## 11. Monitoring & observabilité TMS

Mutualisé avec Plateforme. Voir [[../01 - Cahier des charges App/07 - Architecture technique#5. Monitoring et observabilité]].

### Spécificités TMS

- **Sentry projet `savr-tms`** (1 team Savr, 2 projets)
- **Better Uptime checks TMS** : `tms.gosavr.io`, `tms.gosavr.io/api/health`, `tms.gosavr.io/api/webhooks/health`
- **Alertes DB spécifiques TMS** (webhook Supabase → Slack `#alerts-prod`) :
  - `tms.integrations_dlq` > 10 messages (intégrations bloquées)
  - Collectes en statut `en_cours` > 4h sans transition (chauffeur perdu ?)
  - Taux refus prestataire > 10% sur 24h glissant
- **OpenTelemetry SDK instrumenté dès V1** pour faciliter bascule Datadog V1.1

---

## 12. Backup, PITR et plan de continuité TMS

Mutualisé avec Plateforme (même projet Supabase Pro, PITR 7 jours).

### 12.1 RPO/RTO

- **RPO = 1h** (perte max data = 1h activité)
- **RTO = 4h** (downtime max toléré)
- Pas d'HA actif/actif V1

### 12.2 Runbook disaster recovery

Document dédié dans [[15 - Sécurité et conformité TMS]] §12.

### 12.3 Fichiers Cloudflare R2

- R2 ne bénéficie PAS de backup automatique (pas de PITR bucket).
- **Versionning R2** activé sur les 4 buckets TMS : chaque overwrite conserve la version précédente 30 jours.
- Suppression accidentelle → restauration depuis version précédente.

---

## 13. Secrets TMS

Mutualisé avec Plateforme (Supabase Vault + Vercel env vars). Secrets spécifiques TMS :

| Secret | Utilisé par | Renouvellement | Géré par |
|---|---|---|---|
| `TMS_WEBHOOK_SECRET` (HMAC) | Validation webhooks entrants depuis Plateforme | Annuel | Vault + M13 E5 |
| `PLATEFORME_WEBHOOK_SECRET` (HMAC) | Signature webhooks sortants vers Plateforme | Annuel | Vault + M13 E5 |
| `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` | Upload/download Cloudflare R2 (buckets TMS) | Annuel | Vault + M13 E5 |
| `MISTRAL_OCR_API_KEY` | OCR factures prestataires | À la rotation Mistral | Vault + M13 E5 |
| `everest_client_id` + `everest_client_secret` | Intégration A Toutes! Everest | Sur demande Everest | Vault + M13 E5 |
| `pennylane_api_token_v2` | Export factures Pennylane M08 | 90j | Vault + M13 E5 |
| `strike_webhook_signing_key` | Validation webhook Strike M01 | 12 mois | Vault + M13 E5 |
| `marathon_webhook_signing_key` | Validation webhook Marathon M01 | 12 mois | Vault + M13 E5 |
| `bridge_api_token` | Bridge API rapprochement bancaire | 90j | Vault + M13 E5 |

**Stratégie M13** (propagation 2026-04-25) : tous les secrets vivent dans **Supabase Vault** (`vault.secrets`). Métadonnées exposées via table `tms.secrets_metadata` (lue + éditée par Admin TMS via M13 E5). Accès en clair limité à reveal 30s + Edge Functions authentifiées rôle `admin_tms`. Audit-log obligatoire à chaque reveal/rotation/test. Cf. M13 D4, R_M13.16.

**Rotation manuelle** depuis M13 E5 (bouton "Rotater" + test pré-validation). Cron `m13_secrets_expiration_cron` quotidien alerte J-7 (R_M13.15).

---

## 14. Sous-domaines et DNS TMS

| Sous-domaine | Service | Environnement |
|---|---|---|
| `tms.gosavr.io` | TMS Savr (frontend + API Routes + PWA chauffeur servie sur sous-route `/m/*` cf. §12 D1) | Prod |
| `dev.tms.gosavr.io` | TMS Savr (idem prod, sous-route `/m/*` incluse) | Dev |
| `api.gosavr.io/webhooks/*` | Webhooks entrants TMS (partagé avec Plateforme) | Prod |

**Note PWA chauffeur (propagation §12 D1 2026-04-27)** : pas de sous-domaine `chauffeur.savr.fr` (rejeté option c §12). 1 seul front Vercel mono-domaine, routes `/m/*` (layout mobile-first, bottom nav, manifest standalone). Évite cookies cross-domain et CORS supplémentaire.

Question ouverte commune : registrar `gosavr.io` (OVH, Cloudflare, Namecheap, Gandi) — bloquant pour config CNAME Vercel.

---

## 15. Décisions prises (atelier 2026-04-23)

| # | Décision | Alternative écartée | Raison |
|---|---|---|---|
| T.7.1 | 1 projet Supabase mutualisé Plateforme + TMS, 3 schémas (`plateforme.*`, `tms.*`, `shared.*`) | 2 projets Supabase isolés | Simplicité opérationnelle, -25$/mois, cloisonnement maintenu par RLS cross-schema deny. |
| T.7.2 | Stack unifiée Plateforme/TMS (Next.js 15 App Router + shadcn/ui + Turborepo + Vercel) | Stack divergente Vite pour TMS | Mutualisation types, patterns, outillage. |
| T.7.3 | PWA pour M05 mobile chauffeur V1 | React Native/Expo dès V1 | 2-3 mois de dev économisés, pas de store review. React Native reporté V1.1+ si besoin natif avéré. |
| T.7.4 | Cloudflare R2 pour fichiers volumineux TMS | S3 AWS, Supabase Storage uniquement | Egress 0€ critique pour photos audit M05 consommées depuis mobile + dashboards. |
| T.7.5 | Next.js API Routes pour webhooks + crons métier TMS | Supabase Edge Functions | Types partagés, même runtime que front, pas de quota. Exception `pg_cron` pour purge géoloc. |
| T.7.6 | 3 kill switches dans `tms.parametres_tms` | Système feature flags complet (Unleash, table dédiée) | Over-engineering V1, revert Git < 5 min suffit en backup. |
| T.7.7 | Mistral OCR pour factures prestataires | Google Document AI, AWS Textract, Tesseract | Meilleur ratio qualité/coût, français natif, API simple. |
| T.7.8 | Rotation secrets annuelle | Rotation semestrielle (décision 9.3.16 initiale) | Simplification opérationnelle V1. |
| T.7.9 | Paris `eu-west-3` seul V1+V2 | Multi-region EU/UK/US V2 | Stratégie commerciale Savr = marché français V1+V2. |
| T.7.10 | MapLibre GL JS + tuiles OSM/MapTiler pour la carte dispatch M02 E6 (V1) *(arbitrage Val 2026-06-03)* | Google Maps JS API ; report V2 | Carte = simple rendu de pins (coords GPS déjà fournies par la Plateforme via E1, `collectes_tms.lieu_adresse.lat/lng`, aucun géocodage côté TMS). MapLibre open-source, pas de coût par chargement, suffisant pour des pins + clustering. Google Maps = coût + lock-in inutiles. Pas de routing/optimisation de tournée V1 (V2). |

---

## 16. Questions ouvertes

- Registrar DNS `gosavr.io` (prérequis sous-domaines `tms.*`, `api.*`, `dev.tms.*`)
- Pennylane v2 webhook `invoice.paid` disponible ou polling J+1 3h ? (impacte aussi Plateforme)
- Rejoint frère comme reviewer dans CI/CD = quand ? (détermine timing ajout staging)
- Politique IP-restrict `tms.gosavr.io/admin/*` V1 ou V1.1 ? (M13 QO5 — allowlist IP fixe Val/Louis vs accès libre auth-only, gating middleware Next.js sur path `/admin/*`)
- **Dashboard export PDF (D5 §11)** : valider hébergement Puppeteer = Vercel Functions ou worker Render dédié. À traiter en atelier tech avec frère. *(propagation §11 2026-04-27)*

---

## 17. Edge Functions M13 (propagation 2026-04-25)

12 Edge Functions à dev côté Supabase Edge Runtime pour M13. Toutes audit-loggées + RLS-respectful + role-checked (`auth.user_has_role('admin_tms')`).

| Edge Function | Rôle requis | Action principale | Tables mutées |
|---------------|-------------|-------------------|---------------|
| `update_parametre(id, valeur, commentaire)` | `admin_tms` ou `ops_savr` selon `parametres_tms.modifiable_par[]` | UPDATE param + valid type/min/max | `parametres_tms`, `audit_logs` (trigger) |
| `upsert_user_tms(email, nom, prenom, roles, prestataire_id?)` | `admin_tms` | INSERT user + magic link + email | `users_tms`, `audit_logs` |
| `deactivate_user(user_id, raison)` | `admin_tms` | Soft delete user + révoque sessions + devices | `users_tms`, `users_tms_devices_trusted`, `auth.sessions`, `audit_logs` |
| `reset_mfa_user(target_user_id, commentaire)` | `admin_tms` | DELETE mfa_factors + flag mfa_active=false + notif | `users_tms`, `auth.mfa_factors`, `audit_logs` |
| `rotate_secret(secret_name, new_value, commentaire)` | `admin_tms` | UPDATE Vault + meta + audit | `vault.secrets`, `secrets_metadata`, `audit_logs` |
| `test_secret(secret_name, new_value)` | `admin_tms` | Test connectivité externe (sans persist) | aucune |
| `reveal_secret(secret_name)` | `admin_tms` | Retourne JWT 30s scope reveal | `audit_logs` |
| `replay_event(integrations_log_id, commentaire)` | `admin_tms` | Repush event entrant ou sortant | `integrations_logs`, `integrations_inbox` (entrant), `audit_logs` |
| `wizard_onboarding_prestataire(payload_step)` | `admin_tms` | Multi-step (4 étapes : prestataire, grille, manager, activation) | `shared.prestataires`, `grilles_tarifaires_prestataires`, `users_tms`, `audit_logs` |
| `upsert_alerte_code_override(code, criticite_override, commentaire)` | `admin_tms` | UPSERT override criticité catalogue M11 | `alertes_codes_overrides`, `audit_logs` |
| `impersonation_start(target_user_id, motif)` | `admin_tms` | Génère JWT 60min impersonation + INSERT session | `impersonation_sessions`, `audit_logs` |
| `impersonation_stop(reason)` | `admin_tms` | Ferme session active + invalide JWT | `impersonation_sessions`, `audit_logs` |

**Cache stratégie** : `parametres_tms` mis en cache 60s (Map keyed par `<namespace>:<cle>`) côté Edge Functions exposant des params aux apps clientes (M03 portail, M05 mobile, M11 dashboard). Param `requires_redeploy=true` jamais en cache (lu uniquement au boot app). Cf. R_M13.19, M13 D6.

**Helper SQL ajouté** : `auth.is_impersonating()` returns boolean (lit JWT claim `impersonator_user_id`). Utilisé par triggers `audit_logs` pour distinguer mutations sous impersonation (R_M13.10).

---

## 18. API Routes M14 + Trigger DB cascade (propagation 2026-04-25)

Issu de [[06 - Fonctionnalités détaillées TMS/M14 - Intégration Everest]] (V1 rédigée 2026-04-25, 10 décisions D1-D10). Cohérent avec règle §07 ligne 140 (TMS = Next.js API Routes + Vercel, pas Supabase Edge Functions hors M13). Toutes les routes M14 audit-loggées + RLS-respectful + role-checked.

### 5 API Routes Next.js internes + 1 publique (sobriété 2026-04-30 A_M14_04 — `/replay/:inbox_id` supprimée)

| Route | Type | Rôle requis | Action principale | Tables mutées |
|-------|------|-------------|-------------------|---------------|
| `POST /api/internal/m14/missions/create` | Internal (worker queue) | `service_role` | Push création mission Everest (W1) — appelé par worker depuis trigger DB `trg_m14_push_mission` enqueue | `everest_missions` (source de vérité unique post revue sobriété §04 2026-04-30 A6 — colonnes miroir `tournees.everest_mission_id` / `collectes_tms.everest_mission_id` supprimées), `integrations_logs`, `audit_logs` |
| `POST /api/internal/m14/missions/cancel` | Internal (worker queue) | `service_role` | Annule mission Everest (W3) — appelé par worker depuis trigger DB `trg_m14_cascade_cancel` ou bouton Admin E1/E2 | `everest_missions`, `integrations_logs`, `audit_logs` |
| `POST /api/internal/m14/missions/manual_accept` | Internal | `ops_savr` | Failover acceptation manuelle Ops (W4) — appelé depuis E4 modal | `everest_missions` (4 colonnes manual_*), `collectes_tms.statut_dispatch = acceptee`, `audit_logs` |
| `POST /api/internal/m14/test_connection` | Internal | `admin_tms` | Test connexion Everest (W8) — appelé depuis fiche M06 prestataire A Toutes! ou M13 E6 tab Everest (sobriété 2026-04-30 A_M14_03 — 2 entrées validées) | `tms.integrations_logs(system='everest', type_event='m14_ping')` (revue sobriété §04 2026-04-30 A3 — colonnes `last_everest_ping_*` supprimées V1, vue dérivée `tms.vue_prestataires_everest_status` lit `integrations_logs`), `audit_logs` |
| `POST /api/webhooks/everest` | **Public** | aucun (validation token header `X-Webhook-Token`) | Réception webhook Everest entrant (W2) — endpoint exposé Internet | `integrations_inbox`, `integrations_logs`, `everest_missions` |

**Note sobriété 2026-04-30 A_M14_04** : route `POST /api/internal/m14/missions/replay/:inbox_id` (W7 Admin replay event `echec_final`) supprimée. Cas extrêmement rare (cible <1% webhooks). Admin replay via SQL direct sur Supabase Studio si besoin (`UPDATE tms.integrations_inbox SET status='pending' WHERE id=$inbox_id` + ré-exécution worker manuelle). Cf. runbook §15.

### 1 Trigger DB

| Trigger | Type | Source | Effet |
|---------|------|--------|-------|
| `trg_m14_push_mission` | AFTER UPDATE on `tms.collectes_tms` | `OLD.statut_dispatch IS DISTINCT FROM NEW.statut_dispatch AND NEW.statut_dispatch = 'attribuee_en_attente_acceptation' AND prestataire.integration_externe = 'everest'` (lookup cross-schema `shared.prestataires`) | **INSERT `tms.outbox_events`** (`event_type='everest.create'`, `aggregate_type='collecte'`, `aggregate_id=NEW.id`) dans la même transaction + `pg_notify('m14_create_queue')` en simple **réveil** — le worker outbox (§18bis) consomme la ligne et POST `/api/internal/m14/missions/create` *(bascule 2026-07-06 COH-03 option A — l'ex pg_notify-transport, non durable, est remplacé)* |
| `trg_m14_cascade_cancel` | AFTER UPDATE on `tms.collectes_tms` | `OLD.statut_dispatch IS DISTINCT FROM NEW.statut_dispatch AND NEW.statut_dispatch IN ('rejetee_par_prestataire','annulee_par_traiteur') AND EXISTS (SELECT 1 FROM tms.everest_missions em WHERE (em.collecte_tms_id = NEW.id OR em.tournee_id = NEW.tournee_id) AND em.statut_everest NOT IN ('cancelled','cancelled_externally','completed','completed_incomplete','failed','creation_failed'))` (revue sobriété §04 2026-04-30 A6 — colonnes miroir supprimées V1, lookup direct sur `everest_missions`) | **INSERT `tms.outbox_events`** (`event_type='everest.cancel'`, `aggregate_type='collecte'`, `aggregate_id=NEW.id`) dans la même transaction + `pg_notify('m14_cancel_queue')` en simple **réveil** — le worker outbox (§18bis) consomme la ligne et POST `/api/internal/m14/missions/cancel` *(bascule 2026-07-06 COH-03 option A)* |

### 1 Fonction SQL helper

| Fonction | Signature | Usage |
|----------|-----------|-------|
| `tms.m14_lookup_mission_by_collecte(collecte_id uuid)` | returns `tms.everest_missions` | Résout la mission Everest depuis une collecte : (1) lookup direct `everest_missions WHERE collecte_tms_id = $collecte_id` (cas vélo, services 71/75), (2) sinon résout la `tournee_id` via `collectes_tms` puis lookup `everest_missions WHERE tournee_id = ?` (cas camion). Revue sobriété §04 2026-04-30 A6 — colonnes miroir supprimées V1, source de vérité unique = `everest_missions`. Utilisé W2 (réception webhook) et W5 (notify_incomplete). |

### Worker Next.js (consommateur outbox — refondu 2026-07-06 COH-03 option A)

**Les jobs Everest M14 sont consommés par le worker outbox unique (§18bis)** depuis `tms.outbox_events` (`event_type IN ('everest.create','everest.cancel')`). `LISTEN m14_create_queue`/`m14_cancel_queue` ne sert plus que de **réveil** (latence) — une notification perdue est rattrapée au scan périodique de l'outbox, plus aucune mission créée/annulée ne peut se perdre si le worker est down. Co-localisé avec le worker M11 (`alerte_emit` queue) si possible pour limiter les processes.

## 18bis. Worker outbox sortants S1-S11 + jobs Everest (ajout 2026-07-06 COH-02 / COH-03 option A — arbitrage RC-M04-06)

> Chapitre architecture du consommateur de `tms.outbox_events` (§04) promis par §08 §2bis. Pattern identique au worker outbox App (tranché 2026-06-11 côté App — même doctrine, même vocabulaire).

**Périmètre consommé** : webhooks sortants TMS → Plateforme **S1-S11** (`event_type` = slugs S-events) **+ jobs d'intégration Everest M14** (`event_type` `everest.create` / `everest.cancel` → POST API routes internes M14 au lieu d'un POST Plateforme). Toute mutation métier productrice INSÈRE dans `tms.outbox_events` **dans sa transaction** (RPC ou trigger — dérivation R6.1, `trg_pesee_tardive_s5_correction`, `trg_m14_push_mission`, `trg_m14_cascade_cancel`…) ; **aucun webhook/POST n'est émis directement depuis un trigger ou un handler HTTP**.

**Mécanique (lease/claim)** :
- **Claim** : tx courte — sélection `status='pending'` éligible (`next_retry_at IS NULL OR <= now()`, garde de visibilité `txid < txid_snapshot_xmin(txid_current_snapshot())`), passage `status='processing'` + `claimed_until = now() + lease` + `attempts++`, **AVANT tout HTTP**. Jamais de lock tenu pendant le HTTP (PgBouncer transaction mode + serverless).
- **Livraison** : POST hors transaction (Plateforme pour S1-S11, API route interne pour everest.*), enveloppe §08 figée à l'émission, `event_id` réutilisé à l'identique à chaque retry (dédup côté récepteur).
- **Résultat** : tx courte — succès = `consumed_at`/`consumer` posés ; échec = `status='failed'` + `next_retry_at` au palier suivant.
- **Ordering** : `seq` bigserial + **head-of-line par agrégat** `(aggregate_type, aggregate_id)` — un event `pending`/`processing`/`failed` plus ancien bloque les suivants du même agrégat (jamais de S5 avant son S3, jamais de cancel avant son create).
- **Retry** : 3 paliers **5 min / 1h / 24h** (4 tentatives) puis `status='dead'` + `dead_at` → **DLQ = alerte critical M11** (visibilité + Rejouer : dashboard M13 E6/W6, re-queue `status='pending'` avec `event_id` d'origine).
- **Reaper** : re-queue les claims expirés (`claimed_until < now()` et `processing`) avec `requires_reconciliation=true` → **réconciliation obligatoire avant tout re-POST** (le POST a pu partir avant le crash).
- **`pg_notify` = réveil uniquement, jamais transport** : les triggers producteurs peuvent notifier un channel pour réduire la latence de scan ; toute notification perdue est rattrapée par le scan périodique. C'est l'outbox qui porte la durabilité.

**Hébergement** : worker Next.js long-running (même process que le listener M14 refondu ci-dessus + worker M11 si possible) — PAS une API route serverless (le lease/claim requiert un scan périodique).

**Renvois** : structure table + index → §04 `tms.outbox_events` ; doctrine émission + enveloppe + matrice transitions/webhooks → §08 §2bis ; dashboard sync + Rejouer → M13 E6/W6 ; alerte DLQ → M11.

### Sécurité webhook entrant

- **Filet par défaut V1** (M14 D6) : `POST /api/webhooks/everest` valide `X-Webhook-Token` header contre `secrets_metadata.everest_webhook_token` (Vault). Si absent / faux → 401 + alerte warning `m14_everest_webhook_signature_invalid`.
- **Upgrade prévu** : HMAC signature si Everest l'expose (Q2 — à confirmer dev Everest pendant développement). Bascule contrôlée via `parametres_tms.m14_webhook_token_required = false` + activation logique HMAC.

---

## 19. Routing Next.js et shell de navigation (propagation §11 2026-04-27)

### Convention routes

Convention validée §11 D1 : `/{section}` ou `/{section}/{sous-section}`. Préfixe `/admin/*` pour les dashboards exclusifs Admin TMS. Pas de sous-domaine séparé (rejeté option b). 1 seul front Vercel TMS.

Liste détaillée des routes : voir [[11 - Dashboards TMS]] §3.1.

### Redirection racine selon rôle

`/` redirige automatiquement selon rôle :
- Ops Savr → `/dispatch`
- Admin TMS → `/admin`
- Admin TMS + Ops (cumul) → `/dispatch`
- Manager prestataire → `/portail`
- Chauffeur → PWA dédiée (cf. M05)

Implémentation : Server Component `app/page.tsx` lit la session Supabase Auth, lit le claim `roles text[]`, redirige côté serveur via `redirect()`.

### Pages 403 et 404

- **`/404`** : page custom avec sidebar + lien retour home rôle.
- **`/403`** : page custom (tentative d'accès route non autorisée), sidebar + message + lien retour home rôle. Audit log `AUDIT_403_ACCESS` (cf. §04 addendum §11).

### Gating routes

Gating en 2 couches :
- **Backend (RLS Supabase)** : autorité finale, déjà spécifié [[09 - Authentification et permissions TMS]].
- **Frontend (middleware Next.js)** : sur chaque route protégée, vérifie le rôle via session JWT. Si non-autorisé : redirect `/403` + audit log.

Sidebar masque les liens vers routes non autorisées (pas juste désactivation visuelle).

### SSR vs CSR

- Shell rendu **côté serveur** (Next.js App Router, Server Components) : header, sidebar, gating rôle, breadcrumbs.
- Contenu dashboards rendu **côté client** (Client Components avec « use client »), fetch via React Query, polling/realtime géré client.
- Cookie session Supabase Auth lu en SSR pour déterminer rôle + cumul cross-app.

### Cumul cross-app Ops Plateforme ↔ Ops TMS

Implémentation §11 D3 :
- À la connexion TMS, appel sortant `GET https://app.gosavr.io/api/v1/me/has-profile` (auth JWT cross-domain).
- Réponse cachée 1h dans cookie httpOnly `savr.has_plateforme_profile=true|false`.
- Si `true` : bouton sidebar « → Plateforme » visible (clic = redirect cross-domain `https://app.gosavr.io/dashboard`).
- Symétrique côté Plateforme (cf. propagation cross-CDC §08 Plateforme).
- Configuration CORS sur Plateforme : autoriser origin `https://tms.gosavr.io` sur cet endpoint (`Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials: true`).

Risque assumé V1 : si profil Plateforme désactivé sans MAJ cookie, bouton reste visible 1h max. Acceptable (pas de fuite, juste 403 au clic).

---

## Liens

- [[../01 - Cahier des charges App/07 - Architecture technique]]
- [[04 - Data Model TMS]]
- [[08 - Contrat API Plateforme-TMS]]
- [[09 - Authentification et permissions TMS]]
- [[11 - Dashboards TMS]]
- [[14 - Scalabilité TMS]]
- [[15 - Sécurité et conformité TMS]]

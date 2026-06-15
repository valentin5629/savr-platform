# 04 - Fixtures API — JWT, mocks et payloads (App V1)

**Créé** : 2026-06-07. Périmètre V1 Plateforme : MTS-1 (polling + envoi d'ordres), Pennylane v2, Everest (🔒 gate), Resend. Pas de TMS natif en V1 (cf. [[../01 - Cahier des charges App/Frontière TMS-Ready V1]]).

---

## 1. JWT de test par rôle

Un JWT par persona, généré localement par script (`npm run seed:jwt`), stocké dans `.env.local` / `supabase/.temp` — **jamais commité** (entrée `.gitignore` obligatoire, vérifiée par hook qualité).

| Persona | Rôle | Rattachement |
|---|---|---|
| `jwt_admin` | admin_savr | staff |
| `jwt_ops1`, `jwt_ops2` | ops_savr | staff |
| `jwt_commercial` | `traiteur_commercial` *(rôle effectif seed M0.7 — pas de valeur `commercial_savr` dans l'enum ; décision à trancher §04)* | `org_savr` (type temporaire `agence` — cf. §04 note M0.7) |
| `jwt_manager_kaspia` | manager traiteur | `org_tr_kaspia` |
| `jwt_collab_kaspia` | collaborateur traiteur | `org_tr_kaspia` |
| `jwt_manager_fleurdemets` | manager traiteur | `org_tr_fleurdemets` (2e org : tests cross-org) |
| `jwt_gest_viparis` | gestionnaire lieux | `org_ge_viparis` (org-wide F5 §06.05) |
| `jwt_gest_artsforains` | gestionnaire lieux | `org_ge_artsforains` |
| `jwt_agence_caromy` | agence | `org_ag_caromy` (users self only) |
| `service_role` | SERVICE_ROLE | Edge Functions (régén rapports F3 §11-12) — clé locale Supabase |

Usage pgTAP : les tests RLS s'exécutent sous `authenticated` avec `request.jwt.claims` simulés (cf. décision quality-loop) — les JWT ci-dessus servent aux tests E2E/HTTP, les claims simulés aux tests SQL.

## 2. Mocks MTS-1 (polling — pas de webhook entrant V1, audit RLS 2026-06-05)

Fichiers `fixtures/api/mts1/*.json` :

- `poll_statuts_nominal.json` — lot de statuts de courses (acceptée, réalisée, clôturée) mappés sur les collectes seedées.
- `poll_dedup_pair.json` — **2 payloads identiques hors `occurred_at`** → 1 seule ingestion (clé dédup sans `occurred_at`, F1 §08).
- `envoi_ordre_ok.json` / `envoi_ordre_rejet_4xx.json` — branches dispatch : `non_envoye→E1`, `dirty→E2`, `rejetee→E1` (F3 §08).
- `pesees_photos.json` — métadonnées photos pesées AG (saisie Ops manuelle V1 — F1 §06.09).
- `tours_pesees_flux.json` *(ajout 2026-06-10 — QO pesées par flux soldée, relevé as-built)* — réponse `GET /v3/tours/{id}` avec `stops[]` portant 1 élément pesé par stuff, **libellés exacts as-built** : `<volume_du_camion>` (qty 1, à ignorer), `Bio-déchets (en kg)`, `Carton (en kg)`, `D.I.B (en kg)`, `Film plastique (en kg)`, `Verre (en kg)` + `weight` kg par stuff. Sert le test de mapping garde-fou 2 (stuff name → `flux_dechets`, cf. §08 §3bis.7) ; inclure 1 variante avec stuff inconnu (`Gravats (en kg)`) → alerte Ops attendue. **Mapping stuff → code DB (champ documentaire `_mapping_libelles`, corrigé 2026-06-14 — divergence M1.5b)** : `Bio-déchets (en kg)` → `biodechet` ; `Carton (en kg)` → `carton` ; `D.I.B (en kg)` → `dechet_residuel` ; `Film plastique (en kg)` → `emballage` ; `Verre (en kg)` → `verre` ; `<volume_du_camion>` → `_ignore` ; `Gravats (en kg)` → `_inconnu_alerte_ops`. ⚠ Les codes `dib`, `biodechets` (avec 's') et `film_plastique` sont inexistants en DB — ne pas utiliser.

Serveur mock : interceptions HTTP locales (msw/nock ou stub Edge Function), réponses servies depuis ces fichiers. Dev jamais bloqué par l'absence du vrai MTS-1.

## 3. Mocks Pennylane v2 (polling)

- `customers_page1.json` / `customers_page2.json` — pagination.
- `invoices_poll_sans_borne.json` — scope polling **sans borne temporelle** (F2 §08) : contient des factures anciennes re-présentées → vérifie idempotence.
- `invoice_payment_status.json` — transitions emise→payee pour alimenter les créances de la timeline.
- `error_429.json`, `error_500.json` — backoff/retry.

## 4. Everest — 🔒 GATE pré-dev

Mail envoyé au dev Everest 2026-06-07 (TTL token, sécu webhooks, course vide, sandbox). **Aucune fixture définitive avant sa réponse.**

Placeholders à créer (structure d'après Swagger v1.252 déjà dépouillé, à valider en session « spec Everest ») :
- `auth_token.json` (TTL inconnu — placeholder),
- `course_create_ok.json`, `course_vide.json` (comportement à confirmer Q1-Q4 M14),
- `webhook_statut.json` (sécurisation à confirmer).

Marqués `// PLACEHOLDER — GATE EVEREST` dans le repo ; le brief handoff doit interdire à Claude Code de coder l'intégration Everest tant que le gate n'est pas levé.

## 5. Mocks Resend (sortant + webhooks svix)

- Sortant : interception des appels Resend en dev (aucun email réel ; tous les destinataires sont `@savr-test.local` — double sécurité).
- Webhooks entrants signés svix (F3 §06.02) : `delivered.json`, `bounced.json`, `failed.json` + secret svix de test ; cas `echec` → 3 retries → statut final `echec` (mappé sur `email_echec_3retries` du seed).
- `signature_invalide.json` → 401 attendu.

## 6. Rattachement aux données seedées

Chaque mock référence des IDs du seed (collectes, factures, orgs) — pas d'IDs orphelins. La cohérence mock ↔ seed est vérifiée par un check d'intégrité au build des fixtures (cf. [[05 - Spec d'injection]] §5).

---

# Volet TMS (2026-06-07)

## 7. JWT / personas TMS

Mêmes règles que §1 (générés localement, jamais commités, mot de passe commun dev).

| Persona | Rôle | Rattachement |
|---|---|---|
| `jwt_admin_tms` | admin_tms | staff |
| `jwt_ops_tms1`, `jwt_ops_tms2` | ops | staff (lecture params F5 M13) |
| `jwt_manager_strike` | manager prestataire | `prest_strike` |
| `jwt_manager_marathon` | manager prestataire | `prest_marathon` (cross-presta RLS) |
| `jwt_chauffeur_marathon1` | chauffeur | device trusted (binding nominal) |
| `jwt_chauffeur_strike1` | chauffeur | 2e device (conflit binding) |

pgTAP TMS : claims simulés sous `authenticated`, prédicat `auth.user_chauffeur_id()` (B1 audit RLS).

## 8. Payloads contrat Plateforme ↔ TMS — réutiliser `savr-api-contracts`

**Source de vérité : `02 - Cahier des charges TMS/08 - savr-api-contracts/`** (12 endpoints, JSON Schema 2020-12, Ajv 21/21). Les fixtures ne dupliquent pas les exemples : `fixtures/api/tms/*.json` référence les `examples/` du package, re-validés Ajv au `seed:check`.

À couvrir, mappés sur les IDs du seed :
- **Entrants E1/E2/E3/E5** : E1 création (`statut_tms non_envoye→a_attribuer`), E2 réacceptation `date/heure_collecte` seuls (M01), E3 annulation → cascade, E5 changement champ critique lieu.
- **Sortants S1–S5, S7, S9, S11** : S1 acceptée, S2 refusée (motif), S3 tournée-upsert (`acceptee` interne mappée `planifiee` — contrat 4 valeurs), S4 en-cours, S5 terminée (pesées+photos), **S7 plaque-saisie avec cas vélo cargo `plaque=null` + `chauffeur_nom`**, S9 incident (gravité 2 valeurs), S11 rejet DLQ → `rejetee_par_tms`.
- **Dédup** : paire de payloads même `body.event_id` → 1 ingestion (clé canonique, Idempotency-Key supprimé).
- **Erreurs** : HMAC invalide → 401 ; `X-API-Version` absente/inconnue → 400 ; séries retry 3 paliers (5 min/1 h/24 h) + DLQ 5 retries M05.

## 9. Secrets HMAC de test

2 secrets de test (App→TMS, TMS→App) dans Vault dev via `secrets_metadata` — valeurs distinctes de toute prod future, rotation non testée en V1.

## 10. Everest

Inchangé : 🔒 GATE (cf. §4). Le volet TMS n'ajoute **aucun** mock Everest tant que le gate n'est pas levé.

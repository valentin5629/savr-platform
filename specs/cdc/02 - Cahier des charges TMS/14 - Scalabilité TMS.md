---
section: 14 - Scalabilité TMS
statut: V1 rédigée (atelier tech 2026-04-23)
references_plateforme:
  - "01 - Cahier des charges App/14 - Scalabilité et évolutivité.md"
dernière_maj: 2026-04-23
---

# 14 — Scalabilité TMS

## 14.1 Cadrage

Le TMS partage l'infrastructure Supabase de la Plateforme (1 projet, 3 schémas `plateforme` / `tms` / `shared`). Les contraintes de scalabilité sont donc **communes** aux deux apps au niveau base de données, mais les **volumes générés** par le TMS ont une dynamique propre (collectes, tournées, pesées) qui dicte les limites.

Ce document précise uniquement ce qui est **spécifique au TMS**. Les aspects transverses (Postgres, PgBouncer, Vercel, R2) sont traités dans le §14 de la Plateforme.

## 14.2 Volumes cibles

### V1 (mise en production, M+3)

| Dimension | Volume attendu | Notes |
|---|---|---|
| Collectes créées / jour | 50 à 100 | Moyenne ≈ 70/j, pics 120/j (lundi/vendredi) |
| Tournées créées / jour | 15 à 30 | 1 tournée groupe plusieurs collectes |
| Pesées saisies / jour | 150 à 300 | ~3 pesées par collecte en moyenne |
| Acceptations prestataires / jour | 15 à 30 | 1 par tournée |
| Factures OCR / mois | 100 à 200 | Mensuelles (Strike/Marathon) |
| Prestataires actifs | 3 à 8 | Strike, Marathon principaux |
| Chauffeurs connectés (PWA) | 10 à 20 | Pic simultané ≈ 8 |

### V2 (M+12 à M+18)

| Dimension | Volume attendu | Ratio V1 → V2 |
|---|---|---|
| Collectes créées / jour | 400 à 600 | ×6 |
| Tournées créées / jour | 80 à 150 | ×5 |
| Pesées saisies / jour | 1 200 à 2 000 | ×7 |
| Prestataires actifs | 15 à 25 | ×3 |
| Chauffeurs connectés | 40 à 80 | ×4 |

### V3 (M+24+, scénario croissance)

Volumes estimés ×2 par rapport à V2 (clientèle multi-région, ouverture B2B logistique). À ré-évaluer mi-V2 selon trajectoire commerciale.

## 14.3 Stockage base de données

### Croissance tables TMS

Estimation sur 12 mois de V1 (70 collectes/j × 365 j ≈ 25 500 collectes/an) :

| Table | Lignes / an V1 | Taille unitaire estimée | Taille cumulée V1 | Projection V2 |
|---|---|---|---|---|
| `tms.collectes` | 25 500 | 2 Ko | ~50 Mo | ~300 Mo |
| `tms.tournees` | 7 500 | 1,5 Ko | ~12 Mo | ~75 Mo |
| `tms.pesees` | 75 000 | 0,8 Ko | ~60 Mo | ~420 Mo |
| `tms.prestations_prestataires` | 7 500 | 1,2 Ko | ~10 Mo | ~60 Mo |
| `tms.chauffeurs_geolocalisation` (rolling 30j) | ~8M lignes (purge quotidienne) | 200 o | ~1,6 Go glissant | ~10 Go glissant |
| `tms.factures_prestataires` | ~2 000 | 5 Ko + OCR JSON | ~10 Mo | ~60 Mo |
| `tms.audit_logs` (partagé TMS+Plateforme) | — | — | Voir §14 Plateforme | — |

**Total TMS V1** : ~150 Mo hors géoloc (géoloc purgée à 30j, poids constant ~1,6 Go).

**Projection V2 globale (plateforme + TMS)** : ~8 à 12 Go base de données → confortablement dans Supabase Pro (disque 8 Go inclus, 0.125$/Go au-delà).

### Règles de purge spécifiques TMS

| Table | Politique | Justification |
|---|---|---|
| `tms.chauffeurs_geolocalisation` | Purge quotidienne > 30 jours (pg_cron) | RGPD minimisation + réduction du volume |
| `tms.webhooks_events` (polling E6) | Purge > 90 jours | Audit court terme, historique stocké dans `tms.audit_logs_integration` |
| `tms.integrations_logs` | Rétention 2 ans | Obligation traçabilité facturation prestataires |
| OCR raw JSON Mistral | Stocké 6 mois puis archivé R2 Glacier | Coût stockage chaud |

## 14.4 Performance cibles

### Objectifs p95 (V1)

| Fonctionnalité | Cible | Mesure |
|---|---|---|
| M01 Dispatch — liste collectes | p95 < 800 ms | Next.js API Route + RLS |
| M01 Dispatch — création collecte | p95 < 500 ms | Write simple + trigger audit |
| M02 Acceptation prestataire — liste à accepter | p95 < 1,5 s | Jointure multi-tables, filtre RLS complexe |
| M02 Acceptation — action accepter/refuser | p95 < 400 ms | Update + notif API Plateforme |
| M05 PWA chauffeur — chargement initial | p95 < 2 s (3G) | Bundle JS < 200 Ko gzippé |
| M05 PWA — saisie pesée | p95 < 300 ms offline, < 800 ms sync | IndexedDB + sync différé |
| Webhook TMS → Plateforme | p95 end-to-end < 2 s | Signature HMAC + POST + ACK |
| Polling E6 Everest | p95 < 5 s (cycle complet) | 15 min d'intervalle |

### Budget bundle front

Le TMS M02 (acceptation web) et M05 (PWA chauffeur mobile) ont des contraintes différentes :

| Front | Bundle JS max (gzippé) | Stratégie |
|-------|------------------------|-----------|
| tms.savr.fr (dispatch M01, acceptation M02, pilotage M06) | < 350 Ko initial | Code splitting par module, lazy-load des tables lourdes |
| `tms.gosavr.io/m/*` (M05 PWA chauffeur — propagation §12 D1 2026-04-27, ex-`chauffeur.savr.fr` retiré) | < 200 Ko initial | Minimal shell, Service Worker Serwist, assets locaux, offline-first complet (§12 D3+D4) |

## 14.5 Limites infra V1 et triggers V2

### Ce que supporte Supabase Pro V1 (25$/mois)

- 8 Go disque Postgres
- 2 Go RAM compute (compute-xs)
- 60 connexions simultanées via PgBouncer transaction mode
- 250 Go bandwidth
- 100 Go Storage

Pour les volumes V1 du TMS (confondus avec Plateforme), largement suffisant. **Marge de sécurité confortable jusqu'à ~2× V1** sans upgrade.

### Triggers d'upgrade (V1 → V1.5)

Déclencher l'upgrade compute-s (50$/mois) OU Pro+ si **l'une** des conditions survient :

1. Latence p95 M02 dépasse 1,5 s pendant 3 jours consécutifs → upgrade compute
2. Connexions PgBouncer > 50 en régime nominal → passer à 200 connexions (compute-s)
3. Disque Postgres > 6 Go → anticiper upgrade ou archivage agressif
4. Volume collectes > 150/jour soutenu pendant 1 mois → upgrade compute + review indexation

### Triggers d'upgrade (V1.5 → V2 scaling)

- Volume > 300 collectes/jour : activer read replicas Supabase (Pro Team 599$/mois) pour offload des dashboards M06
- Volume > 500 collectes/jour : évaluer partitionnement `tms.chauffeurs_geolocalisation` par jour (pg_partman)
- Pesées > 1 000/jour : évaluer index partiels sur `tms.pesees(date_pesee)` et archivage pesées > 2 ans

## 14.6 Région, multi-région et DR

**V1 décision** : Paris seul (`eu-west-3` AWS, via Supabase région Europe — Frankfurt le plus proche en fait).

- Pas de multi-région (complexité + coût disproportionnés pour la cible)
- Pas de sharding géographique V1 ni V2
- Latence cible depuis Paris : < 50 ms aller-retour Postgres

**V2 si ouverture UK/DE** : à ré-évaluer, mais par défaut on reste Frankfurt single-region (marché logistique français exclusif jusqu'en V2).

## 14.7 Scalabilité PWA chauffeur (M05)

La PWA M05 a ses propres contraintes de scalabilité car elle tourne sur des terminaux chauffeurs hétérogènes (smartphones bas de gamme, 3G/4G parfois).

| Axe | Stratégie V1 |
|---|---|
| Bundle | < 200 Ko gzippé initial, lazy-load reste |
| Assets | Service Worker cache-first, pré-cache des icônes et fonts |
| Offline | IndexedDB pour pesées/signatures non synchronisées, queue de retry |
| Sync | Background Sync API quand dispo, fallback polling léger (60s) |
| Réseau dégradé | Timeout 10s + retry exponentiel, jamais de blocage UI |
| Geoloc | `watchPosition` avec throttling 60s + envoi batch toutes les 5 min |

**Limite connue V1** : pas de React Native. Capacités natives limitées (pas de notification push iOS stable, pas de scanner barcode natif). Report à V1.1.

## 14.8 Scalabilité OCR Mistral

Factures prestataires OCR via Mistral (décidé atelier 2026-04-23).

| Dimension | V1 | V2 |
|---|---|---|
| Volume mensuel | 100 à 200 factures | 600 à 1 200 |
| Coût unitaire | ~0,001$ / facture | Identique (prix Mistral) |
| Coût mensuel estimé | 0,10 à 0,20$ | 0,60 à 1,20$ |
| Latence cible | < 15 s par facture | < 15 s |
| Concurrence | 1 facture en parallèle suffit | 3 à 5 en parallèle (queue) |
| Kill switch | `tms.parametres_tms.ocr_factures_active` | Fallback saisie manuelle |

**Pas de problème de scalabilité OCR attendu** : volumes faibles, API managée, queue simple (Next.js API Route + traitement sync en V1).

## 14.9 Polling Everest E6

Polling décidé atelier 2026-04-23 (pas de webhook). Fréquence cible : **15 minutes**.

| Item | V1 | V2 |
|---|---|---|
| Fréquence polling | 15 min | 10 min si volumes justifient |
| Lieux suivis | Tous les lieux avec tournée active | Idem |
| API calls / jour | 96 (1/15min) × N lieux actifs | 144 × N lieux actifs |
| Rate limit Everest | À confirmer avec prestataire | — |
| Kill switch | `tms.parametres_tms.polling_e6_active` | Fallback saisie manuelle pesées |
| Cron | Vercel Cron (pas pg_cron) | Idem |

**Risque identifié** : si Everest impose un rate limit < 100 appels/jour, il faudra négocier un relèvement ou réduire la fréquence à 30 min. À valider avant mise en prod V1.

## 14.10 Synthèse décisions scalabilité

| ID | Décision | Rationale |
|---|---|---|
| T.14.1 | Volumes V1 cibles : 50-100 collectes/j, 15-30 tournées/j | Projection basée sur activité Savr actuelle + marge |
| T.14.2 | Paris single-region uniquement V1 et V2 | Pas de besoin multi-région sur marché français |
| T.14.3 | p95 M02 web < 1,5 s, bundle mobile PWA < 200 Ko gzippé | Cible réaliste et mesurable |
| T.14.4 | Supabase Pro 25$/mois suffit V1, triggers d'upgrade explicites | Volume < 2× V1 tient sur compute-xs |
| T.14.5 | Purge `chauffeurs_geolocalisation` quotidienne > 30 jours (pg_cron) | Minimisation RGPD + maîtrise volume |
| T.14.6 | Polling E6 Everest toutes les 15 min via Vercel Cron | Pas de webhook côté Everest V1 |
| T.14.7 | OCR Mistral, volumes V1 négligeables | ~0,20$/mois, aucun souci scalabilité |
| T.14.8 | Pas de sharding ni read replicas V1 ni V1.5 | Prématuré pour le volume réel |

## 14.11 Questions ouvertes

1. Rate limit effectif API Everest sur endpoint E6 → à confirmer avant V1
2. Politique d'archivage pesées > 2 ans (conservation légale ou suppression) → ouvrir avec comptable
3. Bascule pg_partman sur `chauffeurs_geolocalisation` : à quel volume exact déclencher ? Proposition : 5M lignes vivantes après purge

## 14.12 Liens

- [[01 - Cahier des charges App/14 - Scalabilité et évolutivité|§14 Plateforme — Scalabilité transverse]]
- [[07 - Architecture technique TMS|§07 TMS — Architecture technique]]
- [[04 - Data Model TMS|§04 TMS — Data Model]]
- [[03 - Ateliers/Atelier tech avec frère - 2026-04-23|Atelier tech frère 2026-04-23]]

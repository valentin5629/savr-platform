# 14 - Scalabilité et évolutivité


---

## Principe directeur

La scalabilité de la Plateforme Savr repose sur deux axes distincts :

1. **Scalabilité des volumes** : l'architecture tient sans refonte jusqu'à ~500 collectes/mois (×25 vs aujourd'hui). Au-delà, des ajustements ciblés suffisent.
2. **Scalabilité fonctionnelle** : l'architecture peut accueillir de nouveaux types de clients (agences, lieux), de nouvelles régions, de nouveaux partenaires logistiques et de nouveaux modules sans réécriture du cœur.

---

## 1. Projections de volumes

### Trajectoire retenue

| Horizon | Collectes/mois | Base événements cumulés | PDFs cumulés | Lignes DB estimées |
|---|---|---|---|---|
| Aujourd'hui | ~30 | ~400 | ~1 000 | ~50 000 |
| T+18 mois | 150 | ~3 000 | ~8 000 | ~400 000 |
| T+36 mois | ~300 | ~7 000 | ~18 000 | ~900 000 |

*Hypothèse : 1 collecte = ~50-100 lignes de données (événement, pesées par flux, facture, PDF, logs, audit). PDFs à ~100 Ko/unité.*

### Impact sur l'infrastructure

| Ressource | Capacité Supabase Pro | T+18 mois | T+36 mois | Tension |
|---|---|---|---|---|
| DB storage | 8 GB | ~200 MB | ~500 MB | Aucune |
| Storage PDFs | 100 GB | ~800 MB | ~1,8 GB | Aucune |
| Storage photos (2/collecte, ~2 Mo compressé) | 100 GB | ~7 GB cumulé | ~37 GB cumulé | Faible — 37% du Pro à T+36 mois |
| Bandwidth | 250 GB/mois | ~2 GB/mois | ~5 GB/mois | Aucune |
| Edge Function invocations | 2M/mois | ~10 000/mois | ~25 000/mois | Aucune |
| Connexions DB (PgBouncer) | 200 pooled | <20 simultanées | <50 simultanées | Aucune |

**Conclusion** : Supabase Pro couvre largement la trajectoire 18-36 mois sans upgrade. Le vrai risque à surveiller n'est pas la capacité mais la **performance des requêtes** à mesure que les tables grossissent.

**Note photos** : les photos de collecte (2/collecte, ~2 Mo après compression) représentent le poste de stockage le plus significatif — ~37 Go cumulés sur 3 ans. Confortable dans les 100 Go inclus. **Prérequis** : le TMS Savr doit compresser les photos avant upload (JPEG 80%, cible ≤ 2 Mo/photo). Sans compression, des photos à 10 Mo/unité porteraient le total à ~120 Go sur 3 ans — proche de la limite.

---

## 2. Performance des requêtes — Indexation

### Principe

PostgreSQL devient lent non pas à cause du volume de données brut, mais à cause de l'absence d'index sur les colonnes fréquemment filtrées. À 5 000 collectes en base, une requête sans index sur `organisation_id` scanne toute la table.

### Index obligatoires V1

À créer dès le déploiement initial — pas à ajouter a posteriori.

| Table | Colonne(s) indexée(s) | Raison |
|---|---|---|
| `collectes` | `organisation_id`, `statut`, `created_at` | Filtres dashboard, batch J+1 |
| `collectes` | `evenement_id` | Jointures fréquentes |
| `evenements` | `organisation_id`, `lieu_id`, `date_evenement` | Filtres principaux |
| `pesees` | `collecte_id` | Jointure pesées → collecte |
| `factures` | `organisation_id`, `statut`, `created_at` | Dashboard facturation |
| `rapports_rse` | `collecte_id`, `disponible_a` | Embargo H+24 + lookup |
| `bordereaux_savr` | `collecte_id` | Lookup bordereau |
| `attestations_don` | `collecte_id` | Lookup attestation |
| `packs_antgaspi` | `organisation_id`, `statut` | Vérification blocage AG |
| `audit_log` | `user_id`, `created_at` | Recherche logs par user |
| `organisations` | `type`, `actif` | Filtres back-office |

**Index composites** à créer sur les patterns de requêtes RLS les plus fréquents :
- `collectes (organisation_id, statut, created_at)` — vue liste dashboard traiteur
- `evenements (organisation_id, date_evenement DESC)` — timeline événements

### Connection pooling

**PgBouncer activé dès V1** (inclus dans Supabase Pro). Les API Routes Next.js se connectent via le port de pooling (6543 pooler) et non directement à la DB (5432 direct). Cela permet de supporter des pics de connexions simultanées sans saturer PostgreSQL.

---

## 3. Batch J+1 6h — Concurrence PDF

### Situation à T+18 mois

À 150 collectes/mois, une nuit typiquement chargée (vendredi soir d'une grosse semaine événementielle) peut générer 15-20 collectes à traiter en batch. Chaque collecte nécessite 2-3 PDFs (bordereau + rapport + attestation AG si applicable). Le batch peut déclencher **30-50 appels simultanés** vers Railway Puppeteer.

### Solution V1 : file d'attente séquentielle

Le batch ne lance pas 50 appels en parallèle — il les met en file dans la table `jobs_pdf` et les traite en séquence ou par petits groupes (5 PDFs simultanés max). Temps de traitement estimé : ~2 min pour 50 PDFs. Largement terminé avant 7h.

### Seuil de tension

Au-delà de 100 collectes en batch unique (soit ~300 PDFs), la file séquentielle prend >10 min. **Seuil d'alerte** : si le batch dépasse 100 collectes, envisager le scaling Railway (ajouter des workers). Ce seuil correspond à ~500 collectes/mois — hors de la trajectoire 18 mois mais à anticiper pour T+3 ans.

---

## 4. RLS à grande échelle

### Risque

Les politiques RLS (Row Level Security) filtrent chaque requête SQL en ajoutant une clause `WHERE` implicite. À grande échelle, si les index ne couvrent pas les colonnes RLS, chaque requête devient un full table scan.

### Mitigation

- Tous les index listés en section 2 couvrent les colonnes utilisées dans les politiques RLS (`organisation_id`, `lieu_id`, `client_organisateur_organisation_id`)
- Les politiques RLS sont testées dans la suite d'intégration CI/CD sur des jeux de données volumeux (seed 10 000 lignes) pour détecter les régressions de performance avant prod

### Monitoring

Supabase Pro expose les requêtes lentes dans son dashboard (pg_stat_statements). Lors de chaque release significative, vérifier qu'aucune requête dépasse 500ms sur le jeu de données de dev.

---

## 5. Archivage et rétention des données

### V1 : pas d'archivage automatique

Toutes les données restent en base active. À 900 000 lignes sur 3 ans, PostgreSQL gère sans problème.

### V2 : politique d'archivage (à définir post-lancement)

Déclencher une réflexion sur l'archivage si l'une de ces conditions est atteinte :
- DB storage > 4 GB (50% du Pro)
- Requêtes dashboard > 1s en moyenne
- Données > 5 ans (obligation légale atteinte pour certains documents)

Stratégie probable V2 : archivage des collectes > 3 ans dans une table `collectes_archive` (même schéma, hors RLS active). Les PDFs restent dans Cloudflare R2 (coût marginal).

---

## 6. Scalabilité fonctionnelle

### 6.1 Viparis (janvier 2027)

**Impact anticipé** : si Viparis impose Savr à ses 50 sites + traiteurs référencés, le volume peut tripler en quelques semaines. Ce n'est pas une montée progressive.

**Ce que ça change architecturalement** :
- Rien sur l'architecture de base (RLS, Supabase, Railway)
- Le référentiel lieux devra être pré-chargé pour tous les sites Viparis (migration batch depuis leur liste de sites)
- Les remises préférentielles Viparis devront être saisies dans `tarifs_negocie` (ex `tarifs_zd_par_gestionnaire`) avant le go-live
- Le batch J+1 devra être monitoré pendant les premières semaines pour détecter des pics inattendus

**Action préventive** : 3 mois avant janvier 2027, valider avec Val que les index et la file PDF tiennent sur un test de charge simulant 50 collectes en une nuit.

### 6.2 Nouvelles régions

Aujourd'hui : Paris + première couronne. Si Savr s'étend en province (Lyon, Bordeaux, Marseille) :
- **Données** : aucun impact architectural — `lieux` et `organisations` sont déjà géographiquement agnostiques
- **Logistique** : nouveaux prestataires à référencer dans le TMS, nouvelles associations AG à intégrer
- **RLS** : aucun changement — le filtrage est par `organisation_id`, pas par région
- **À anticiper** : le champ `associations.region` et le **géocodage adresse** des transporteurs (`latitude/longitude`, refonte 2026-05-08 — ex `regions_couvertes`/`villes_couvertes` supprimés) couvrent ce cas via filtrage Haversine sur `R_compatibilite_vehicule_lieu` + zone 50 km algo AG

### 6.3 Nouveaux types de clients

Si Savr ajoute un type de client non prévu en V1 (ex: organisateurs d'événements en direct, collectivités, hôtels) :
- La table `organisations.type` est un enum extensible — ajouter un type = 1 migration
- Les politiques RLS devront être étendues pour le nouveau type
- Le formulaire d'onboarding devra proposer ce nouveau type
- Effort estimé : 1-2 jours Claude Code

### 6.4 Nouveaux modules

Le data model a anticipé les évolutions V2 sans les construire :
- **Module 19 — Impact enrichi** : 6 tables + 3 champs déjà structurés en V1. Activation = construire l'UI et les calculs, pas migrer le schéma.
- **Module Benchmark sectoriel** : données déjà collectées (pesées, KPIs). Activation = construire la vue agrégée anonymisée.
- **SSO SAML** : architecture JWT déjà compatible. Activation = configurer le provider SAML dans Supabase Auth.
- **Dark mode** : tokens CSS déjà structurés pour un second thème.

---

## 7. Seuils de décision — Quand upgrader

| Indicateur | Seuil d'alerte | Action recommandée |
|---|---|---|
| DB storage > 4 GB | ~2 000+ collectes/mois pendant 1 an | Envisager archivage V2 |
| Requêtes dashboard > 1s | Dès détection | Analyser index manquants via pg_stat_statements |
| Batch PDF > 100 collectes/nuit | ~500 collectes/mois | Ajouter worker Railway ($10/mois supplémentaire) |
| DB connexions simultanées > 150 | Pic inhabituel | Vérifier PgBouncer, investiguer requêtes longues |
| Supabase Pro DB > 6 GB | Croissance continue | Upgrade Supabase Team ($599/mois) ou archivage |
| Erreurs Sentry > 100/jour | Dégradation qualité | Sprint de stabilisation obligatoire |

**Upgrade Supabase Team** ($599/mois) : non anticipé avant 3-4 ans au rythme actuel. À reconsidérer si Viparis génère un pic brutal ou si un second grand compte s'ajoute.

---

## Décisions prises

| Décision | Alternative écartée | Raison |
|---|---|---|
| Indexation complète dès V1 | Ajouter les index si ça rame | Beaucoup plus coûteux de corriger les performances en prod avec des données réelles |
| PgBouncer activé dès V1 | Connexions directes | Prévient les saturations sur les pics de fonctions serverless (API Routes) |
| File PDF séquentielle (5 simultanés max) | Parallélisation totale | Évite de saturer Railway sur les grosses nuits. Délai batch < 2 min à T+18 mois |
| Pas d'archivage automatique V1 | Archivage dès V1 | Inutile sur les volumes projetés. Complexité disproportionnée. Revisiter à T+3 ans |
| Upgrade Supabase Team non planifié V1 | Pro → Team dès le lancement | Pro couvre largement la trajectoire 36 mois. Team = ×24 le coût mensuel pour des besoins qui n'existent pas encore |
| Test de charge Viparis 3 mois avant | Tester au moment du go-live | Anticiper les problèmes sans pression opérationnelle |

## Questions ouvertes

- **Test de charge Viparis** : à planifier ~octobre 2026 (3 mois avant janvier 2027)
- **Politique d'archivage V2** : à définir si DB > 4 GB ou requêtes > 1s. Aucune urgence V1.

## Liens

- [[07 - Architecture technique]]
- [[04 - Data Model]]
- [[08 - APIs et intégrations]]
- [[13 - Migration depuis Bubble]]

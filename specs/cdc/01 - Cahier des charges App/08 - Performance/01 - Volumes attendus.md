# 08 - Performance / 01 - Volumes attendus

**Statut** : Validé V1
**Dernière mise à jour** : 2026-06-08 (skill `cdc-perf-load`)
**Source des projections** : [[14 - Scalabilité et évolutivité]] §1 (trajectoire validée 2026-04-20). Pic users : arbitrage Val 2026-06-08 = 50 simultanés.

---

## Principe

Ce document fige les **ordres de grandeur** servant de base aux SLA ([[02 - SLA par endpoint]]) et aux scénarios de charge ([[04 - Scenarios de charge]]). « An 1 » = horizon T+12-18 mois ; « An 3 » = vision T+36 mois. Toute cible chiffrée du dossier `08 - Performance/` se dimensionne sur la colonne **An 1** ; la colonne **An 3** sert uniquement à vérifier qu'aucune décision V1 ne crée un mur à 3 ans.

> Règle : pas de « ? ». Les chiffres ci-dessous sont des estimations dérivées du parc Bubble actuel et de la trajectoire §14. À corriger si la réalité diverge, mais jamais à laisser vide.

---

## 1. Table des volumes

| Métrique | Aujourd'hui (Bubble) | **An 1 (cible dim.)** | An 3 (vision) | Hypothèse |
|---|---|---|---|---|
| Organisations actives | ~30-40 | **~80** | ~250 | ×2 an 1, ×6 an 3 (déploiement multi-villes) |
| Utilisateurs total | ~80 | **~250** | ~800 | ~3 users / orga active |
| **Utilisateurs simultanés en pic** | ~10 | **50** | ~150 | Arbitrage Val 2026-06-08. Pic = lundi matin (saisie collectes week-end) |
| Événements créés / mois | ~120 | **~350** | ~900 | Aligné collectes ×~2,3 |
| Collectes réalisées / mois | ~30 | **~150** | ~300 | §14 (T+18 = 150, T+36 = 300) |
| Pesées enregistrées / mois | ~50 | **~250** | ~550 | ~1,7 pesée / collecte (ZD multi-flux) |
| Tournées logistiques / mois | ~25 | **~120** | ~250 | ~0,8 tournée / collecte (mutualisation) |
| Factures émises / mois | ~35 | **~170** | ~350 | 1 / collecte ZD + mensuelles groupées |
| Attestations fiscales / mois | ~20 | **~90** | ~180 | AG habilitées fiscalement uniquement |
| Appels API tierces sortants / jour | ~30 | **~120** | ~300 | Pennylane + Everest + MTS-1 outbox |
| Polls MTS-1 entrants / jour | ~96 | **~96** | ~96 | Cron 15 min = 96/j, indépendant du volume |
| Taille DB | ~50 k lignes | **~300 k lignes** | ~900 k lignes | §14 (~50-100 lignes / collecte) |
| Storage fichiers (PDF + photos) | ~1 Go | **~10 Go** | ~40 Go | §14 (photos = poste dominant, ~37 Go à 3 ans) |

---

## 2. Pics et saisonnalité

- **Pic hebdo** : lundi matin 9h-11h — les traiteurs saisissent les collectes du week-end. ~80 % de l'écriture hebdo se concentre sur cette fenêtre → c'est le profil dimensionnant du scénario de charge nominal (50 users simultanés, mix orienté écriture).
- **Pic saisonnier** : septembre-décembre (saison événementielle) — volume ×1,5 à ×2 vs été. Le dimensionnement An 1 (50 users / 150 collectes mois) intègre déjà le pic saisonnier, pas la moyenne lissée.
- **Batch nocturne** : J+1 6h — génération attestations/bordereaux. À An 1, une grosse nuit = 15-20 collectes → 30-50 PDFs (§14 §3). Largement sous le seuil de tension (100 collectes / batch).
- **Risque non-linéaire** (§14 §6) : si un grand compte type Viparis impose Savr à ses sites + traiteurs référencés, le volume peut tripler en quelques semaines. Ce n'est pas une montée progressive → surveiller les connexions DB et les slow queries comme signal d'alerte précoce (cf. [[06 - Monitoring perf prod]]).

---

## 3. Capacité infra de référence (rappel §14)

Supabase Pro couvre la trajectoire An 1-An 3 **sans upgrade** :

| Ressource | Quota Pro | An 1 | An 3 | Tension |
|---|---|---|---|---|
| DB storage | 8 Go | ~250 Mo | ~600 Mo | Aucune |
| Storage fichiers | 100 Go | ~10 Go | ~40 Go | Faible à An 3 |
| Connexions DB pooled (PgBouncer) | 200 | <20 simultanées | <50 simultanées | Aucune |
| Bandwidth | 250 Go/mois | ~2 Go/mois | ~5 Go/mois | Aucune |

**Conclusion** : le risque V1 n'est **pas la capacité** mais la **performance des requêtes** quand les tables grossissent sans index adéquats. D'où l'importance des index obligatoires (§14 §2, repris dans [[05 - Strategies optimisation]]) et des benchmarks ([[04 - Scenarios de charge]]).

---

## 4. Hypothèses à revalider

- Pic 50 users simultanés = hypothèse An 1. Si un déploiement grand compte intervient avant 12 mois, re-dimensionner sur le scénario 2 (pic ×3 = 150) avant le go-live concerné.
- Ratio pesées/collecte (1,7) à confirmer une fois la ventilation ZD multi-flux réelle observée.
- Les 96 polls MTS-1/jour sont fixes (cron) ; seul le **poids de chaque poll** croît avec le nombre d'ordres ouverts — borne haute à surveiller (cf. SLA polling, [[02 - SLA par endpoint]]).

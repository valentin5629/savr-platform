# 01 - Vision et objectifs

**Statut** : ✅ Complété
**Dernière mise à jour** : 2026-04-20

---

## Résumé exécutif

Refonte complète de la plateforme Savr (actuellement sur Bubble.io + outil logistique tiers MTS-1) vers une application unique, propriétaire, scalable, construite avec Claude Code + Supabase. Objectif : gagner en autonomie (non-dépendance au CTO sortant), fiabilité (rapports, data), UX, performance analytique et réduire les coûts d'outillage externe.

---

## Le problème : pourquoi refondre

### Bloc 1 — Bugs et limites techniques de Bubble

- Bugs récurrents sur fonctionnalités de base : import photos/logos, connexions API, remontées de données
- Rapports envoyés aux clients peu fiables : données qui ne remontent pas, format qui saute
- Site non responsive, format qui varie selon l'ordinateur → image professionnelle dégradée
- UX globalement sous les standards attendus par des clients premium (Viparis, Potel, Lenôtre)

### Bloc 2 — Data model non scalable

- Data model initial mal pensé : impossibilité d'agréger et analyser les données essentielles (volumes de collectes, poids par collecte, comparaisons inter-collectes/clients/lieux)
- Impossibilité de construire des rapports ou dashboards analytiques exploitables
- Absence de pré-remplissage par adresse/lieu → saisies sales par les commerciaux des traiteurs, ce qui pollue tous les rapports en aval
- Incohérence des données à la source → défauts de qualité en cascade sur le reporting RSE

### Bloc 3 — Gestion des utilisateurs inadaptée à la réalité métier

Les types d'utilisateurs actuels ne reflètent pas les rôles réels. Découpage pressenti (à challenger en section 02 - Personas) :

- **Traiteur** : commercial (programmation) vs. directeur/manager (analyse historique et prévisionnel)
- **Lieu** : vue multi-traiteurs sur un lieu (analyse historique et prévisionnel)
- **Gestionnaire de lieux** (type Viparis, Sodexo) : vue multi-lieux et multi-traiteurs
- **Agence** : vue multi-lieux et multi-traiteurs, ET programmation de collectes
- **Ops Savr** : admin complet
- **Finance Savr** : pilotage revenus/coûts

### Bloc 4 — Intégrations manquantes ou inexistantes

- Pas de connexion Bubble ↔ Pennylane → facturation automatique impossible, alors que certains traiteurs demandent 1 collecte = 1 facture
- Dépendance forte à MTS-1 (outil logistique tiers, 200 €/mois) → frictions avec Strike sur l'attribution des courses et la saisie des poids
- Informations chauffeurs (nom, plaque, véhicule) non transmises automatiquement aux clients → tâche manuelle récurrente
- Même problématique côté Marathon (prestataire logistique Anti-Gaspi)

### Bloc 5 — Algorithme d'attribution Anti-Gaspi imparfait

- Matching transporteur × association × lieu d'événement pas fiable
- Logique actuelle : recommander association à proximité (selon bénéficiaires, horaires) + transporteur (souvent les mêmes en IDF, variables en province) → programmation automatique ordre de transport
- Gestion des ajouts/modifications de transporteurs et associations (surtout province) non optimisée

### Bloc 6 — Absence de pilotage financier dans l'app

- Impossibilité de piloter revenus et coûts (logistique, exutoires, packs consommés) depuis l'app
- Obligation d'exports manuels pour la compta / analyse

### Bloc 7 — Dépendance humaine et financière à l'ancien CTO

- Chaque évolution Bubble passe par l'ancien CTO (Eloi) → coût élevé, qualité variable, vitesse faible
- Objectifs post-refonte : autonomie, qualité, vitesse (Claude Code = levier)

### Bloc 8 — Coûts d'outillage externe à centraliser

- Bubble : 120 €/mois
- MTS-1 : 200 €/mois
- Total actuel : ~320 €/mois d'outils tiers que la nouvelle app doit absorber (au moins partiellement)

---

## La vision : ce que doit devenir Savr

Savr passe d'un back-office Bubble artisanal à un **système d'information événementiel** complet, composé de deux apps propriétaires communicantes :

1. **Plateforme Savr** (objet principal de ce CDC) : gestion des événements, collectes, reporting RSE, facturation, espace client multi-profils, pilotage financier interne, benchmarks data
2. **Savr TMS** (app séparée, CDC dédié à créer) : gestion logistique (attribution courses, saisie poids chauffeurs Strike/Marathon, communication chauffeur → client) — remplace MTS-1 sur mesure

Les deux apps communiquent par API. **La licence MTS-1 est terminée** : plus de fallback système. En cas d'indisponibilité TMS Savr > 30 min, bascule manuelle par Admin Savr (commandes directes aux prestataires par email/PDF).

**Ambition data** : data product dès le départ — benchmarks sectoriels anonymisés (taux de recyclage *(ZD uniquement, formule à captation par filière, méthode UE 2019/1004 — cf. [[05 - Règles métier#R_taux_recyclage]])* par type d'événement, comparatifs traiteurs/lieux), pas seulement reporting individuel.

**Ambition V2 — Plateforme de mesure d'impact événementiel complet** : au-delà du bilan déchets (collecte ZD + AG), Savr vise à devenir le système de mesure d'impact environnemental sur l'ensemble de l'événement — alimentation, emballages, décor, mobilier, transport des convives, énergie du lieu. Le traiteur importe son brief (document existant), l'information est parsée automatiquement, croisée avec un référentiel propriétaire de facteurs d'émission (CO2, recyclabilité, etc.) et restituée au client final sous forme d'un rapport d'impact complet. Cible : obligations CSRD des clients finaux (LVMH, Kering, etc.), justification d'une prime de prix, et data product enrichi. **Non-inclus au MVP**, mais structure data anticipée dès V1 pour éviter toute migration.

---

## Décisions structurantes prises

### Décision 1 — Architecture 2 apps avec API entre elles

**Décision** : développer 2 apps propriétaires en parallèle — Plateforme Savr + Savr TMS — qui communiquent via clés API. **MTS-1 décommissionné** (licence terminée, plus de fallback système). Bascule commandes manuelles Admin Savr en cas d'indisponibilité TMS.

**Pourquoi** : MTS-1 était sous-utilisé, mal adapté aux besoins Savr (attribution courses, saisie poids, communication chauffeurs), coûtait 200 €/mois. Construire sur mesure crée de la valeur. L'architecture découplée limite le risque : si le TMS a des bugs en prod, la Plateforme continue de fonctionner (commandes manuelles).

**Implications techniques** :
- Il faut définir le "contrat API" entre les deux apps dès maintenant : quelles données circulent, dans quel sens, à quelle fréquence → à documenter dans [[08 - APIs et intégrations]]
- La Plateforme Savr sera probablement la source de vérité pour les événements et collectes planifiées ; le TMS sera la source de vérité pour les pesées réalisées et les informations chauffeurs
- Le data model des deux apps doit être conçu ensemble pour que les agrégations futures soient cohérentes
- Ce CDC couvre uniquement la **Plateforme Savr**. Un CDC dédié sera à créer pour le TMS.

**Alternatives écartées** :
- Tout intégrer dans une seule app → trop risqué, trop long, bloque le MVP
- Garder MTS-1 seul → écarté car sous-utilisation forte + coût + frictions données

### Décision 2 — Utilisateur stratégique prioritaire : traiteurs d'abord, gestionnaires de lieux à moyen terme

**Décision** : la v1 optimise l'expérience traiteurs (commerciaux et managers). Les gestionnaires de lieux (Viparis, Sodexo Live) sont la cible stratégique à 18-36 mois. Les autres profils (agences, lieux indépendants) sont servis "correctement" pas "excellemment" en v1.

**Implication** : le data model est unique et partagé. La couche présentation (dashboards, vues) varie par profil utilisateur via Row Level Security Supabase + BI personnalisée. Plusieurs dashboards à concevoir, priorisés dans cet ordre : ops Savr → traiteur commercial → traiteur manager → lieu → gestionnaire de lieux → agence.

**Implications techniques** :
- Architecture multi-tenant avec isolation stricte des données par organisation → [[09 - Authentification et permissions]]
- Un même "événement" peut être visible par le traiteur, le lieu, le gestionnaire de lieu ET les ops Savr — avec des niveaux de détail différents
- Prévoir dès maintenant les champs nécessaires pour les vues gestionnaires de lieux (multi-traiteurs, multi-sites) même si la vue n'est pas développée en v1

### Décision 3 — Ambition data Niveau 2 dès le départ (data product)

**Décision** : le data model est conçu dès le départ pour permettre des benchmarks sectoriels anonymisés à terme — pas seulement du reporting individuel.

**Pourquoi c'est structurant** : si on ne l'anticipe pas maintenant, on devra tout refaire dans 18 mois. Le coût de cette décision est faible à la conception, prohibitif en rétrofit.

**Ce que ça implique concrètement** :
- Toutes les entités clés (collecte, flux, pesée, événement, lieu, traiteur) doivent avoir des champs permettant l'agrégation et la comparaison anonymisée
- Horodatage systématique de toutes les données (created_at, updated_at, realized_at)
- Schéma versionné : si une règle métier change (tarification, nature d'un flux), les anciennes données restent cohérentes avec leurs règles de l'époque

**Stack analytics retenue : Option A — Supabase + vues SQL**
Volume réel Savr : ~150 collectes/mois max → ~630k lignes de pesées sur 5 ans même en x10. Postgres/Supabase gère nativement les requêtes analytiques complexes (percentiles, window functions, GROUP BY multi-dimensions) à ce volume sans outil tiers. Option valide à vie pour ces volumes. Réévaluer si Savr dépasse 2 000 collectes/mois.

**Alternatives écartées** :
- Niveau 1 seul (reporting individuel) → écarté car objectif stratégique est de devenir une infrastructure data RSE de référence
- Option B (Metabase) et Option C (ClickHouse/BigQuery) → inutiles au regard des volumes Savr

### Décision 4 — Facturation automatisée via Pennylane dès le MVP

**Décision** : l'intégration Pennylane est dans le MVP. Au minimum : mode "1 collecte = 1 facture" pour les clients qui le demandent.

**Implication** : dépendance API Pennylane à sécuriser. Voir [[08 - APIs et intégrations]].

### Décision 5 — Repenser complètement le data model

**Décision** : le data model Bubble est abandonné sans migration partielle. On repart de zéro, conçu pour l'analyse, l'agrégation et la scalabilité.

**Implication** : investissement majeur sur [[04 - Data Model]] avant tout développement. C'est la fondation critique.

---

## KPIs de succès — Lancement MVP

KPIs opérationnels dès la mise en production :

| KPI | Cible | Source de mesure |
|-----|-------|-----------------|
| Collectes manquées pour cause d'erreur app | 0 | Dashboard ops |
| Erreurs de rapports RSE envoyés aux clients | 0 | Logs génération + feedback client |
| Tracking financier (revenus + coûts logistiques) | Disponible en temps réel | Dashboard finance |
| Coût outillage mensuel (Bubble + MTS-1 remplacés) | 0 € (vs. 320 €/mois actuel) | Comptabilité |
| Collectes avec facture Pennylane auto générée | 100% des clients ayant demandé ce mode | Pennylane |
| Erreurs de facturation prestataires (Strike, Marathon) | 0 | Rapprochement factures TMS |

**Timeline cible** : aucune pression. Bascule vers la nouvelle app quand elle atteint 90% de son potentiel. Bubble continue de faire tourner le business en attendant. L'objectif est la robustesse et l'évolutivité, pas la vitesse de lancement. CDC construit intégralement avant le début du développement.

---

## Hors-périmètre explicite de la V1

| Fonctionnalité | Statut | Note |
|---|---|---|
| App mobile native (traiteurs/ops Savr) | **V2** | TMS aura interface mobile chauffeurs en V1 |
| Module CRM | **Hors-scope** | Géré dans Notion |
| Benchmarks visibles clients | **V1** | Data model anticipe dès V1. Vigilance : segmenter par type d'événement (cocktail apéritif, cocktail repas complet, repas assis, autre — format de service) ET par taille (bracket pax). Question ouverte : données historiques Savr seules ou données marché externes ? |
| Multi-langues | **V2** | Anglais pour Sodexo Live management. Anticiper dans le data model (champs traduisibles) |
| Marketplace associations (portail self-service) | **Hors-scope V1** | Gestion assocs en back-office admin Savr |
| Intégration comptable hors Pennylane | **Hors-scope** | Pennylane suffit |
| Signature électronique | **V2** | |
| Chat / messagerie interne | **Hors-scope V1** | |
| Reporting REP/Citeo automatisé | **V2** | Export Excel manuel pour l'instant. À revoir si Citeo impose un format API |
| Import brief traiteur + analyse impact complet | **V2** | Parsing IA du brief, mapping vers référentiel d'impact propriétaire Savr, rapport d'impact élargi. Structure data anticipée en V1. Orientation retenue : **recrutement interne** (chargé projet environnemental) pour construire le référentiel |
| Intégration Trackdéchets (BSD officiels dématérialisés) | **V2** | En MVP, registre interne Savr uniquement. Renvoi vers Veolia en cas d'audit. Trackdéchets intégré en V2 si demande client émerge |
| Méthodologie dynamique par événement | **V2** | PDF statique en MVP. Dynamique en V2 (couplé Module 19) |

## Périmètre confirmé V1

- **Savr TMS inclus dans V1** : la Plateforme dépend du TMS pour envoyer les ordres aux prestataires logistiques. Deux interfaces : app mobile chauffeurs (saisie poids sur terrain) + interface web Manager (programmation collectes, suivi volumes).
- **Province inclus en V1** : 100% des associations et transporteurs, IDF + province.
- **Référentiel Savr associations + transporteurs** : Savr tient le référentiel (données propriétaires), pas d'intégration web externe. Onboarding manuel de chaque assoc/transporteur. 
- **Algorithme d'attribution Anti-Gaspi** : recommandation automatique (lieu, type d'événement, capacité assoc/transporteur, horaires) + validation humaine ops Savr obligatoire avant envoi. Notification email automatique à l'assoc/transporteur une fois sélectionnés.
- **A Toutes! prestataire anti-gaspi en V1** : prestataire IDF journée. Les ordres de collecte sont envoyés par la Plateforme au Savr TMS, qui gère la communication avec Everest (système propriétaire A Toutes!) et pilote l'exécution terrain. Les chauffeurs A Toutes! utilisent l'app mobile Savr TMS pour la saisie terrain (poids, photos). Voir [[02 - Cahier des charges TMS/01 - Vision et objectifs TMS]] pour les détails de l'intégration Everest.
- **Suivi packs Anti-Gaspi par client** : comptabilité précise (solde, consommation, historique) dès V1.
- **Suivi financier complet** : revenus (Plateforme) + coûts logistiques (TMS) agrégés.
- **Traçabilité réglementaire V1** : registre chronologique des déchets interne Savr, accessible à tous les profils espace client (filtrage RLS sur événements associés). Bordereaux Savr émis automatiquement à la clôture de chaque collecte ZD (mentionnant exutoires Veolia, transporteur, poids, code déchet européen). Attestations de don aux associations pour les collectes AG éligibles (document type 2041-GE, défiscalisation 60%). Méthodologie statique PDF accessible. Pas d'intégration Trackdéchets en V1 — renvoi vers Veolia en cas d'audit sur les BSD officiels.

---

## Décisions complémentaires (Challenge Session)

### Décision 6 — Deux CDC en parallèle : Plateforme Savr + TMS Savr

**Décision** : créer deux CDC distincts (ce CDC couvre Plateforme Savr, un CDC TMS dédié à créer après). Les deux apps communiquent via API documentée.

**Implications** :
- API contrat clair dès maintenant entre Plateforme et TMS → anticipé dans [[08 - APIs et intégrations]]
- Pendant dev CDC Plateforme : identifier les dépendances TMS, laisser des hooks pour l'API
- Quand CDC TMS est construit : mise à jour du CDC Plateforme si nouvelles dépendances découvertes
- Isolation logique mais cohérence architecturale garantie

### Décision 7 — TMS V1 : app mobile chauffeurs + interface web manager

**Décision** : TMS V1 = app mobile natif (chauffeurs terrain) + interface web (manager Savr/prestataires bureau). Deux UX, une API TMS centralisée.

### Décision 8 — Gestion de A Toutes! via le Savr TMS (révision 2026-04-21)

**Décision** : l'intégration avec Everest (système propriétaire A Toutes!) est gérée par le Savr TMS, pas par la Plateforme. La Plateforme envoie les ordres au TMS, qui transmet à Everest et remonte les statuts. En cas d'indisponibilité TMS > 30 min : bascule commandes manuelles Admin Savr (email structuré au prestataire).

**Implication** : contrat API Plateforme ↔ TMS bien documenté. Le risque lié à Everest est porté par le CDC TMS.

### Décision 9 — Référentiel associations/transporteurs : modèle A (Ops Savr gère les updates)

**Décision** : Savr tient le référentiel propriétaire. Ops Savr met à jour lors des interactions. Assocs/transporteurs reçoivent un email automatique + phrase type : "Si vos informations changent, envoyez-nous un mail pour nous en informer".

**Implication** : champ "dernière vérification" sur chaque entrée du référentiel pour anticiper une future automatisation.

### Décision 10 — Algorithme Anti-Gaspi : recommandation + validation humaine optionnelle (auto-accept paramétrable)

**Décision** : l'algorithme recommande toujours. Validation humaine ops Savr obligatoire par défaut. Prévoir un mode "auto-accept" configurable (ex: même assoc × même type d'événement → acceptation auto au-delà de N fois).

**Implication** : tableau de bord ops pour activer/désactiver auto-accept par combinaison (assoc + type événement). À documenter dans [[05 - Règles métier]].

---

## Liens

- [[00 - Index]]
- [[02 - Personas et cas d'usage]] (à construire ensuite)
- [[04 - Data Model]] (dépend fortement de cette section)
- [[08 - APIs et intégrations]]
- [[16 - Roadmap et priorisation]]

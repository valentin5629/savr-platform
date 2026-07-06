# 01 - Vision et objectifs TMS


---

## 1. Pourquoi un TMS propriétaire

### Contexte de la décision

Savr opérait jusqu'en 2026 avec **MTS-1**, un TMS tiers sous licence (~200€/mois). La licence a été arrêtée : le TMS de remplacement sera **Savr TMS**, application propriétaire développée sur la même stack que la Plateforme (Claude Code + Supabase) et communicante avec elle par API.

La décision de construire un TMS propriétaire plutôt que basculer sur un autre SaaS ou un module intégré dans la Plateforme repose sur quatre raisons structurantes, validées le 2026-04-21.

### Raison 1 — Aucune solution marché ne colle au métier Savr

Les TMS du marché (Chronotruck, Shippeo, WE-Transport, MTS-1, etc.) sont calibrés pour du transport de marchandise standard : B→B, palettes, ordres de transport, traçabilité douane. Ils ne modélisent pas les spécificités métier Savr :

- Collecte de déchets événementielle (pesée par flux, équivalent roll, rattachement à un événement Plateforme)
- Collecte alimentaire anti-gaspi (attribution association, poids repas, traçabilité don)
- Multi-prestataires avec logiques de coûts hétérogènes (Strike = camion + opérateur à l'heure, Marathon = forfait par vacation nuit)
- Webhooks vers Plateforme pour facturation et synchronisation (l'email plaque T+3h a été retiré V1 — Q10 2026-04-24 ; la plaque de contrôle d'accès est pré-saisie par le manager en M03 E4)

**Preuve MTS-1** : environ 10 % de la plateforme utilisée, 200 €/mois pour un outil qui ne fonctionne qu'à moitié — persona cible MTS-1 ne correspond pas au business Savr.

*Alternative écartée* : SaaS TMS générique. Trop d'adaptation pour peu de valeur, dépendance éditeur, coûts de licence élevés à l'usage (500-2 000 €/mois/utilisateur sur les TMS sérieux).

### Raison 2 — Le TMS est un levier de marge, pas un centre de coût

Le pilotage financier logistique est **core business Savr** : calcul du coût par course (tarifs Strike/Marathon), remontée vers la Plateforme pour le calcul de marge par collecte, identification des événements non rentables. Externaliser à un TMS tiers = donner à un éditeur l'accès à la donnée la plus sensible de Savr ET dépendre de son modèle de facturation, qui ne colle pas au nôtre.

**Preuves MTS-1** :

- Impossible de suivre les coûts directement depuis MTS-1
- Modèle de facturation non adapté, données qui ne remontent pas correctement
- Réconciliation événement ↔ dispositif logistique (type camion, nombre d'équipiers, temps passé) difficile → litiges récurrents sur la facturation prestataire

*Alternative écartée* : licence MTS-1 renouvelée. Licence arrêtée, pas d'API, pas de pilotage marge, blocage scalabilité.

### Raison 3 — Isolation des risques et des cycles de dev

Le TMS et la Plateforme ont des **usages radicalement différents** :

- Plateforme = usage bureau / heures de bureau / navigateur desktop / faible fréquence de saisie
- TMS = usage terrain / opérations nuit et tôt matin / app mobile / saisie intensive / photos

Les mettre dans la même application créerait :

- Des cycles de dev couplés (un bug TMS = risque Plateforme en prod)
- Des permissions mélangées (prestataires logistiques accédant aux données clients)
- Une app mobile chauffeur qui exposerait toute la Plateforme
- Une montée en charge mal dimensionnée (pics nuit vs pics journée)

*Alternative écartée* : module TMS dans la Plateforme. Isolation des risques et cycles de dev séparés → décision déjà posée côté Plateforme.

### Raison 4 — Sur-mesure + évolutivité contrôlée

Un TMS propriétaire permet de construire **exactement** ce dont le métier Savr a besoin, d'adapter au fil de l'eau, et de garantir une communication sans divergence avec la Plateforme. Les compétiteurs ou MTS-1 ne peuvent ni suivre le rythme d'évolution du métier, ni se connecter proprement à notre écosystème.

**Preuves MTS-1** (fonctionnalités manquantes ou mal implémentées) :

- Workflow app MTS-1 décalé du terrain → perturbation chauffeurs
- Pas d'outil pour déduire automatiquement le poids du contenant (tare) : le chauffeur pèse le contenant plein, puis vide, puis soustrait. Perte de temps + erreurs
- Attribution collecte → traiteur / lieu / client difficile
- Pas de notion de tournée (= vacation Strike avec plusieurs collectes)
- Multi-camions par événement non paramétrable → confusion collectes/événements
- Stockage photos chauffeur absent ou inaccessible

### Bilan financier et retour sur investissement

- **Coût MTS-1 évité** : ~2 400 €/an
- **Coût infra TMS propriétaire (estimé V1)** : ~50 $/mois Supabase + ~10 $/mois container Puppeteer/services tiers ≈ 720 $/an (soit ~660 €)
- **Gain net direct annuel** : ~1 700 € — faible en absolu, non décisif seul
- **Vrai ROI** : valeur des fonctionnalités manquantes (pilotage marge, auto-tare, tournées, photos exploitables) qui se chiffrent en réduction des collectes manquées, litiges prestataires, temps ops, erreurs pesée. Voir §4 pour KPIs cibles.

---

## 2. Périmètre TMS vs Plateforme

### Principe général

- **Plateforme Savr** = côté client / commercial / admin bureau. Source de vérité sur les clients, lieux, programmations, tarifs clients, facturation client (Pennylane), reporting réglementaire, documents RSE.
- **Savr TMS** = côté opérations terrain / logistique / prestataires. Source de vérité sur les tournées, les chauffeurs, les véhicules, les pesées, les photos, les coûts prestataires, l'exécution opérationnelle.
- **Frontière** : tout ce qui touche au **terrain** ou au **prestataire** → TMS. Tout ce qui touche au **client**, à la **facturation client**, au **reporting réglementaire** → Plateforme.

### Grille détaillée

| Fonction | Plateforme | TMS | Commentaire |
|---|---|---|---|
| **Cycle de vie collecte** | | | |
| Création collecte (brouillon, validée, programmée) | X | | Programmée par traiteur/Admin dans la Plateforme |
| Annulation collecte | X | | Admin Savr uniquement |
| Envoi ordre au transporteur | | X | Push Plateforme → TMS, puis TMS gère acceptation |
| Acceptation / refus par prestataire | | X | Strike / Marathon / A Toutes! dans le TMS |
| Constitution tournée (groupement collectes) | | X | Ops Savr ou prestataire dans le TMS |
| Saisie plaque, chauffeur, véhicule | | X | Saisie terrain par le chauffeur |
| Saisie pesées + photos | | X | App mobile chauffeur |
| Auto-tare contenants (roll, bac 1100L, bac 240L) | | X | Fonctionnalité obligatoire V1 |
| Capture début / fin tournée | | X | Horodatage auto à l'ouverture / dernière saisie |
| Géolocalisation chauffeur temps réel | | X | Via app mobile, consent RGPD requis |
| Déclaration incident / collecte manquée | | X | Chauffeur ou ops TMS |
| Clôture collecte (statut final) | X | | Admin Plateforme valide après réception webhook TMS |
| **Référentiels partagés** | | | |
| Clients, traiteurs, lieux, événements | X | | Source de vérité Plateforme uniquement |
| Prestataires logistiques — identité (nom, SIRET, contacts) | X | X | Sync bidirectionnelle permissive, last-write-wins + log audit |
| Prestataires logistiques — données opérationnelles (grille tarifaire, astreinte, fiabilité) | | X | Privé TMS |
| Chauffeurs | | X | Natif TMS (nom, téléphone, habilitation, langue) |
| Véhicules / plaques | | X | Natif TMS |
| Règles d'attribution transporteur | | X | Suggestions auto + override admin TMS |
| **Pilotage financier** | | | |
| Tarification client (packs, grilles ZD) | X | | Source de vérité Plateforme |
| Grille tarifaire prestataires (Strike, Marathon, autres) | | X | Privé TMS, paramétrable |
| Calcul coût d'une tournée (vacation de base + heures sup + équipier sup + ajouts) | | X | Calculé dans TMS |
| Répartition coût tournée → coût par collecte | | X | Répartition égale V1 |
| Push coût collecte → Plateforme (`courses_logistiques`) | | X | Webhook TMS → Plateforme |
| Calcul marge par collecte (facture − coût) | X | | Calcul Plateforme |
| Dashboard marge par collecte / événement / client | X | | Admin Plateforme |
| Dashboard coûts logistiques par prestataire | | X | Admin TMS |
| **Facturation** | | | |
| Émission facture client (Pennylane) | X | | Jamais dans TMS |
| Dépôt factures prestataires reçues (PDF) | | X | Upload par transporteur ou Admin Savr dans le TMS |
| Rapprochement auto facture prestataire ↔ courses réalisées | | X | Détection d'écart tarif annoncé vs facturé |
| Validation facture prestataire pour comptabilisation | | X | TMS valide puis remonte consolidé à la Plateforme |
| **Communication client** | | | |
| Email programmation, confirmation | X | | Via Resend depuis Plateforme |
| **Retiré V1 (Q10 2026-04-24)** | | | Email plaque supprimé; plaque de contrôle d'accès pré-saisie manager M03 E4 |
| Rapport RSE PDF post-collecte | X | | Puppeteer Plateforme |
| **Communication interne / terrain** | | | |
| Notifications push app mobile chauffeur | | X | Attribution tournée, rappel départ, incident |
| Alerting ops en cas de retard chauffeur | | X | Dashboard TMS Admin |
| **Reporting réglementaire** | | | |
| Bordereaux Citeo / REP | X | | Jamais dans TMS |
| Attestations de don AG (2041-GE) | X | | Jamais dans TMS |
| Registre déchets (Module 20) | X | | Jamais dans TMS |
| **Matériel Savr** | | | |
| Gestion stock rolls / bacs déployés sur site | | X | Entrées/sorties lors des collectes |
| Alertes réapprovisionnement matériel | | X | Dashboard TMS Admin |
| **Exutoires Veolia** | | | |
| Suggestion passages Veolia (sur seuils de remplissage) | | X | Module à spécifier en §3 |
| Déclaration passages Veolia (bacs vidés) | | X | Admin TMS saisit manuellement (pas d'API Veolia V1) |
| Historique passages / reçus Veolia | | X | Stockage documents dans TMS |
| **App mobile** | | | |
| App chauffeur (unifiée camion + vélo cargo) | | X | 100% TMS |
| App Admin / Traiteur / Lieu | X | | 100% Plateforme (web V1, mobile V2 éventuelle) |

### Fonctionnalités nouvelles à spécifier en §3 Périmètre fonctionnel TMS

Certaines fonctions du tableau ci-dessus n'existent dans aucun des deux CDC aujourd'hui et méritent une spécification dédiée :

1. **Dépôt factures prestataires + rapprochement auto** (§3 module facturation prestataires)
2. **Synchronisation bidirectionnelle prestataires Plateforme ↔ TMS** (§3 module référentiel partagé, §8 contrat API)
3. **Gestion stock matériel Savr** (§3 module matériel)
4. **Check-list pré-départ chauffeur** (§3 module app mobile)
5. **Géolocalisation temps réel chauffeur** (§3 module app mobile, §15 RGPD)
6. **Alerting ops retard chauffeur** (§3 module dashboard ops)
7. **Gestion exutoires Veolia — suggestion + déclaration** (§3 module exutoires)
8. **Algorithme d'attribution transporteur** (§5 règles métier — règles pré-définies + override admin)

### Décision sur l'intégration Everest

Conséquence du choix "100% transporteurs dans le TMS" : **Everest est intégré côté TMS uniquement**. Flux métier :

```
Traiteur programme collecte AG jour → Plateforme
  → Plateforme pousse l'ordre au TMS (webhook)
    → TMS pousse l'ordre à Everest (nouvelle intégration TMS)
      → A Toutes! valide dans Everest
        → Everest retourne le statut au TMS (webhook Everest → TMS)
          → TMS remonte à la Plateforme (webhook TMS → Plateforme)
            → Chauffeur A Toutes! exécute via l'app mobile TMS Savr
```

**Impact CDC Plateforme** : suppression de la section "API Plateforme ↔ Everest" dans `01 - Cahier des charges App/08 - APIs et intégrations.md`. Voir Question ouverte 6.

## 3. Utilisateurs cibles du TMS

Le TMS est utilisé par **4 personas distincts** aux attentes et contraintes très différentes. Un 5ème persona (Support technique / dev) a été écarté : usage interne Savr couvert par l'audit log et les dashboards admin.

### Persona 1 — Ops Savr
- **Identité** : équipe opérations Savr (aujourd'hui Val + Louis assurent aussi ce rôle, demain 1-2 salariés ops)
- **Objectifs** : dispatcher efficacement, suivre le terrain temps réel, résoudre incidents, piloter la marge logistique
- **Tâches principales** : dispatch des collectes vers prestataires, suivi temps réel via dashboard 6 statuts, gestion incidents, validation rapprochement factures, déclenchement collectes Veolia, paramétrage paliers rolls
- **Fréquence** : quotidienne, plusieurs heures/jour
- **Hardware** : desktop principal (planning + dashboard), mobile secondaire (alertes hors bureau)
- **Contraintes UX** : gros volume d'actions, besoin de shortcuts clavier, vues bulk, recherche rapide
- **Digital maturity** : haute

### Persona 2 — Admin TMS
- **Identité** : Val + Louis (co-fondateurs), tous les droits
- **Objectifs** : configurer le TMS, paramétrer tarifs, gérer prestataires, accéder finance, auditer, impersonifier pour support
- **Tâches principales** : paramétrage tarifs prestataires, onboarding nouveaux prestataires, configuration paliers rolls par pax, audit log, exports (comptabilité, CSRD), gestion RGPD (suppressions)
- **Fréquence** : hebdomadaire pour paramétrage, ponctuelle sinon
- **Hardware** : desktop uniquement
- **Granularité droits V1** : aucune — tous les admins ont tous les droits. À revoir si 3ème admin recruté à 12-18 mois

### Persona 3 — Manager prestataire (Strike, Marathon, A Toutes!)
- **Identité** : responsable opérationnel chez le prestataire, 1-3 personnes par prestataire
- **Objectifs** : piloter ses opérations Savr, valider collectes attribuées, gérer parc (véhicules + chauffeurs), suivre revenus, déposer factures
- **Tâches principales (portail self-service web)** :
  1. **Valider une collecte attribuée par Savr** en assignant chauffeur + véhicule + éventuel équipier (workflow A1 : Ops propose, manager accepte/refuse puis assigne)
  2. **Gérer son parc véhicules** (volume, plaque, tarif) et ses chauffeurs/équipiers (nom, prénom, pièce d'identité, permis de conduire)
  3. **Accéder** aux collectes à venir et à l'historique
  4. **Consulter les durées** de chaque collecte
  5. **Dashboard de pilotage revenus** (tarifs négociés × volumes × durées)
  6. **Dépôt factures** sur le TMS avec envoi email parallèle à Louis + Val
- **Fréquence** : quotidienne (validation collectes), hebdomadaire (facturation)
- **Hardware** : desktop principal (paramétrage, dashboard), mobile possible (validation rapide)
- **RGPD docs chauffeurs** : stockage Supabase Storage (chiffré at-rest), conservation pendant contrat + 3 ans après départ sauf demande de suppression du prestataire, accès manager prestataire + Ops Savr (contrôle sous-traitance)
- **Multi-tenant RLS** : manager ne voit QUE ses propres données. Isolation stricte entre prestataires

### Persona 4 — Chauffeur
- **Identité** : conducteur employé du prestataire (camion Strike/Marathon, ou vélo-cargo A Toutes!), français uniquement V1
- **Objectifs** : exécuter sa tournée, remonter les infos terrain, éviter les erreurs de saisie
- **Contexte** : 2 parcours distincts selon le type de collecte — **ZD** (5 flux, pesée entrepôt) et **AG** (1 flux don alimentaire, pesée sur place, livraison directe assos)
- **Fréquence** : quotidienne, intensive pendant tournées
- **Hardware** : smartphone (personnel ou fourni prestataire), usage terrain
- **Contraintes UX** : 3G parfois limitée, pas de formation longue, gants, soleil, pluie → app quasi-intuitive, offline-tolerant (sync différée auto)
- **Cumul rôles manager + chauffeur** : supporté V1 via compte unique multi-rôles (`{manager: true, chauffeur: true}`) + switch de contexte dans l'app. Cas rare mais couvert
- **Langue V1** : français uniquement. Multilingue (anglais, portugais, arabe) en V1.1+

#### Parcours chauffeur — Collecte ZD (Zéro Déchet)

| Étape | Action | Déclenchement |
|---|---|---|
| Onboarding | Magic link, tuto 90s, consentement RGPD géoloc | 1ère connexion |
| Début tournée | **Checklist pré-départ ZD** : Tenue Savr, Plaque véhicule OK, Rolls vides chargés, Carburant OK. Bouton "Je démarre ma tournée" | Horodatage début |
| En route vers collecte | Statut auto + itinéraire | Géoloc |
| Arrivé sur le lieu | Statut auto (pas de validation) | Geofence entrée lieu |
| Collecte en cours | Bouton "Je commence la collecte" | Saisie manuelle |
| Déclaration rolls | Rolls pleins récupérés + rolls vides laissés (MAJ stock traiteur) | Obligatoire |
| Photos collecte | Rolls pleins dans le camion (pas plaque, pas contenants vides) | Obligatoire |
| Collecte terminée | Bouton "Collecte N terminée" | Saisie manuelle |
| Enchaînement collectes 2..N | Répétition | Auto |
| En route vers entrepôt | Statut auto | Geofence sortie dernière collecte |
| En cours de pesée | Statut auto (trigger : geofence entrepôt OU 1ère saisie pesée) | Auto |
| Pesées entrepôt par flux par collecte | 5 flux possibles (biodéchets, verre, emballage, carton, déchet résiduel), flux 0kg possibles. Poids brut → auto-tare contenant → poids net. Bouton "+" pour pesées multiples d'un même flux. Photo par flux avec écran balance visible | Saisie manuelle |
| Déclaration bacs entrepôt | 4 types (biodéchet 240L, verre 240L, déchet résiduel 1100L, emballage 1100L) × 3 paliers (50%/75%/100%) | Obligatoire avant clôture |
| Tournée finalisée | Bouton "Je quitte l'entrepôt" | Horodatage fin |

#### Parcours chauffeur — Collecte AG (Alimentaire anti-gaspi)

| Étape | Action | Déclenchement |
|---|---|---|
| Onboarding | Identique ZD | 1ère connexion |
| Début tournée | **Checklist pré-départ AG** : Balance, Matériel isotherme, Carbo glace. Bouton "Je démarre ma tournée" | Horodatage début |
| Séquence ordonnée | Planning dynamique ordonné par Ops Savr — enchaînement flexible collectes/assos (possible entrelacement C1→A1→C2→A2, ou C1..Cn→A1..An, ou N collectes → 1 asso unique) | Dispatch Ops |
| En route vers collecte | Statut auto + itinéraire | Géoloc |
| Arrivé sur le lieu | Statut auto | Geofence entrée lieu |
| **Branche "Aucun repas à collecter"** | Bouton disponible après entrée geofence, **AVANT** démarrage de la pesée. Déclenche un sous-flow bloquant : photo du lieu obligatoire (géo-taguée + horodatée) + commentaire obligatoire min 10 caractères (raison). Validation explicite puis clôture collecte sans pesée. | Saisie manuelle chauffeur |
| Collecte en cours | Bouton "Je commence la collecte" | Saisie manuelle |
| Pesée sur place | 1 flux (don alimentaire). Poids brut = poids net (contenants tarés ou tare négligeable). Bouton "+" pour pesées multiples. Photo obligatoire : contenants pleins pesés + écran balance visible | Obligatoire |
| Collecte terminée | Bouton "Collecte terminée" | Saisie manuelle |
| En route vers asso (ou collecte suivante) | Statut auto | Géoloc |
| Arrivé à l'asso | Statut auto | Geofence entrée asso |
| Livraison à l'asso | Photo remise du don + Signature numérique récepteur (nom/prénom + signature tactile) — preuve légale 2041-GE. Pas de bouton "Je commence la livraison" (pas de statut intermédiaire) | Obligatoire |
| Livraison terminée | Bouton "Livraison terminée" | Saisie manuelle |
| Enchaînement assos 2..N | Répétition | Auto |
| Tournée finalisée | Bouton "Je termine ma tournée" (après dernière livraison) | Horodatage fin |

**Répartition poids multi-assos AG** : % théorique pré-défini par Ops Savr au dispatch × poids total pesé. Pas de saisie poids par asso (pas d'écart attendu). Attestation 2041-GE générée auto depuis cette répartition.

**Équivalent repas AG** : calculé auto = poids (kg) / `plateforme.parametres_algo.poids_par_repas_kg` (défaut 0,45 kg/repas, paramétrable Admin Plateforme). **Source unique cross-app** (audit sobriété 2026-05-09 B2) — V2 TMS lit cross-schema, pas de paramètre miroir côté `parametres_tms`. Conversion documentée CDC App §06/09 + §04 `parametres_algo`.

**Relevé température camion AG** : reporté V2 (pas V1).

**Reliquat non livré AG** : cas non géré V1 (Val assume "ça n'arrive pas"). À revoir V1.1 si retour terrain différent.

**Cas "Aucun repas à collecter" (AG)** : sous-flow dédié si le traiteur n'a finalement rien à donner (événement annulé en interne, pas de surplus, etc.). Flow bloquant : photo du lieu + commentaire obligatoire. Clôture la collecte en statut `realisee_sans_collecte` (pesée = 0 kg pushée Plateforme, tarif "course incomplète" A Toutes! auto-appliqué par M07, Strike facture la vacation complète quoi qu'il arrive). Alerte Ops Savr pour documentation côté Commercial Savr. Détail complet en §03 M05.

#### Module signalements rapides (toutes tournées)

Accessible en 2 clics depuis n'importe quel écran. 2 catégories V1 :

- **Catégorie 1 — Entrepôt** : manque consommable (café/thé/etc. liste paramétrable), entrepôt sale, bac non vidé Veolia, problème technique (balance, porte, chariot), demande matériel (rolls, gants)
- **Catégorie 3 — Client/Collecte** : accès bloqué, tri non conforme (photos + description), stock inhabituel, comportement problématique
- **Catégorie 2 — Véhicule** : reportée V1.1+ (job prestataire)

#### Fonctionnalités "whaou" chauffeur V1

- **Boussole RSE personnelle** : dashboard mensuel "X kg collectés ce mois, Y kg CO2 évités, Z arbres équivalents"
- **Gamification légère** : badges discrets paramétrés par Ops Savr (30 tournées sans incident, 100 photos parfaites...). Visible chauffeur + manager, pas public. Pas de classement public entre chauffeurs
- **Boîte à idées** : champ libre en fin de tournée, remontée à Ops Savr. Dépouillement mensuel par Ops. Chauffeurs ne voient pas les remontées des collègues
- **Exclus V1** : SOS bouton urgence, Tips du jour push

### Matrice rôles et permissions (synthèse)

| Action | Ops Savr | Admin TMS | Manager prestataire | Chauffeur |
|---|---|---|---|---|
| Dispatcher une collecte vers un prestataire | X | X | | |
| Voir dashboard temps réel toutes collectes | X | X | | |
| Valider/refuser une collecte attribuée | | | X | |
| Assigner chauffeur/véhicule/équipier | | | X | |
| Gérer véhicules + chauffeurs du prestataire | | X (global) | X (scoped) | |
| Paramétrer tarifs prestataires | | X | | |
| Paramétrer paliers rolls par pax | X | X | | |
| Mettre à jour statut terrain + pesées + photos | | | | X |
| Déclarer rolls/bacs | | | | X |
| Déposer facture prestataire | | | X | |
| Valider facture (rapprochement auto + alerte écart) | X | X | | |
| Déclencher collecte Veolia | X | X | | |
| Accès audit log / impersonate | | X | | |

## 4. Objectifs business et KPIs

6 objectifs structurants, chacun avec KPIs quantifiés (ou à mesurer à l'onboarding quand baseline inconnue).

### Objectif 1 — Remplacer MTS-1 avant échéance licence
- **KPI principal** : go-live V1 TMS avant date d'échéance MTS-1 (date à préciser — **action Val**)
- **Critère succès** : 0 collecte ratée pendant la bascule
- **Double-run** : 1 mois MTS-1 + TMS Savr en parallèle

### Objectif 2 — Économie coûts directs
- **KPI principal** : ~2 400 €/an économisés (licence MTS-1 ~200€/mois supprimée)
- **KPI secondaire** : coût run TMS < 660€/an (Supabase + stockage + services)
- **Mesure** : P&L dès mois 1 post-bascule

### Objectif 3 — Amélioration marge logistique
- **KPI principal** : marge logistique % par événement > baseline (baseline à mesurer à l'onboarding V1, cible quantifiée à fixer ensuite)
- **KPI secondaire** : écart moyen tarif théorique vs facturé prestataire < 1% (rapprochement auto)
- **Mesure** : dashboard admin TMS, pilotage mensuel

### Objectif 4 — Zéro erreur non détectée Plateforme↔TMS
- **KPI principal** : taux sync réussi > 99,5%
- **KPI secondaire** : < 5 alertes divergence/semaine
- **KPI secondaire** : MTTR divergence détectée < 2h
- **Mesure** : audit log + dashboard technique

### Objectif 5 — Accélération cycle opérationnel
- **KPI principal** : délai dispatch → assignation chauffeur (baseline à mesurer à l'onboarding)
- **KPI secondaire** : délai collecte réalisée → facture prestataire reçue (baseline à mesurer)
- **Mesure** : dashboard Ops, pilotage mensuel
- **Hors scope** : facturation client (reste sur Plateforme, pas de KPI TMS)

### Objectif 6 — Visibilité temps réel opérations
- **KPI principal** : % collectes avec statut à jour = 100%
- **KPI secondaire** : délai entre événement terrain et remontée app < 5 min
- **Mesure** : monitoring app mobile chauffeur

### Fonctionnalité critique — Suivi temps réel statuts différenciés ZD / AG

Fonctionnalité pilier de l'Objectif 6. Les statuts diffèrent selon le type de collecte (ZD vs AG). Détails du workflow complet en §3 (parcours chauffeur).

**Statuts Collecte ZD (8)** — pesée à l'entrepôt en fin de tournée :

| Statut | Déclenchement |
|---|---|
| Début tournée | Bouton "Je démarre ma tournée" (horodatage début) |
| En route vers collecte | Auto géoloc |
| Arrivé sur le lieu | **Auto** geofence entrée lieu (pas de validation) |
| Collecte en cours | Bouton "Je commence la collecte" |
| Collecte N terminée | Bouton "Collecte N terminée" (enchaînement puis En route vers collecte suivante, ou vers entrepôt) |
| En route vers entrepôt | **Auto** geofence sortie dernière collecte |
| En cours de pesée | **Auto** geofence entrée entrepôt OU 1ère saisie pesée |
| Tournée finalisée | Bouton "Je quitte l'entrepôt" (horodatage fin) |

**Statuts Collecte AG (8)** — pesée sur place + livraison directe assos :

| Statut | Déclenchement |
|---|---|
| Début tournée | Bouton "Je démarre ma tournée" (horodatage début) |
| En route vers collecte | Auto géoloc |
| Arrivé sur le lieu | **Auto** geofence entrée lieu |
| Collecte en cours | Bouton "Je commence la collecte" |
| Collecte terminée | Bouton "Collecte terminée" (enchaînement vers collecte suivante ou vers asso selon planning dispatché) |
| En route (vers collecte ou asso) | Auto géoloc |
| Arrivé à l'asso | **Auto** geofence entrée asso |
| Livraison terminée | Bouton "Livraison terminée" (après photo + signature récepteur) |
| Tournée finalisée | Bouton "Je termine ma tournée" (après dernière livraison, pas de retour entrepôt) |

- **Détection** : mixte auto (geofence) + boutons chauffeur aux transitions d'action. Pas de validation manuelle des statuts auto (différent de la décision initiale Option B).
- **Remontée Plateforme** : **TMS-only V1**. Les statuts terrain ne sont pas remontés à la Plateforme (qui garde 2 statuts client-facing : planifiée / réalisée). À réévaluer V2 selon besoins clients.

## 5. Non-objectifs (ce que le TMS ne fait pas)

10 non-objectifs V1 explicites. Destination précisée pour chaque.

| # | Non-objectif V1 | Raison | Destination |
|---|---|---|---|
| 1 | Optimisation automatique tournées (routing AI) | Assignation manuelle Ops suffit au volume actuel | V2 si volume > 50 collectes/jour |
| 2 | Multilingue chauffeur/manager | Français only V1 | V1.1 ou V2 selon recrutement |
| 3 | Tracker GPS externe (hardware) | Géoloc mobile suffit V1 | Hors scope définitif sauf problème |
| 4 | Gestion RH chauffeurs (paie, congés, planning) | Job du manager prestataire, pas Savr | Hors scope définitif |
| 5 | Maintenance véhicules (révisions, carburant, km) | Job du prestataire, pas Savr | Hors scope définitif |
| 6 | Multi-devise / international | Business France uniquement V1 | V2 si expansion |
| 7 | Portail client TMS (visibilité client sur statut tournée) | Couvert par Plateforme (`app.gosavr.io`) | Hors scope définitif (pas le rôle du TMS) |
| 8 | Module comptabilité intégré | Pennylane v2 via Plateforme | Hors scope définitif |
| 9 | BSD Trackdéchets (bordereau dématérialisé) | Complexité intégration + juriste RSE à consulter | V2 — risque amende 7 500€/bordereau acté |
| 10 | Gestion sinistres / assurances transport | Hors scope métier Savr | Hors scope définitif |

**Note V2 sur BSD** : reporter l'intégration Trackdéchets à V2 expose Savr à un risque réglementaire (amende en cas de contrôle). Décision Val assumée 2026-04-21. **Action recommandée** : valider avec juriste RSE le niveau d'exposition réel et l'acceptabilité du risque sur 4-6 mois.

## 6. Horizon et phasage

### Phasage macro V1 / V2

**V1 (monolithique)** — tout ce qui a été acté, livré en une seule release :

- **Dispatch Ops Savr** (UI web, vue planning, bulk actions)
- **Portail prestataire self-service** (web) : validation collectes A1, gestion parc véhicules + chauffeurs, dashboard revenus, upload factures
- **App mobile chauffeur unifiée** (camion + vélo cargo) : 6 statuts mixtes géoloc+validation, pesées auto-tare, photos, déclarations stock rolls/bacs, incidents
- **Stock matériel complet** : paliers rolls par pax paramétrables, déclaration rolls/bacs par chauffeur, alertes Veolia 85% via bouton manuel Ops, inventaire trimestriel email magic link traiteurs
- **CSRD export** (tonnes collectées, CO2 évité, % valorisation par client) — argument commercial grands comptes
- **Registre transport** (traçabilité légale en backup des prestataires)
- **Rapprochement factures auto** (validation manuelle si écart > 1%)
- **Contrat API Plateforme↔TMS** : 7 webhooks TMS → Plateforme + sync pax via webhook Plateforme → TMS à la création événement
- **Multi-tenant RLS strict** Supabase
- **Audit log** actions sensibles (rétention 5 ans)
- **Bascule MTS-1** avec 1 mois double-run

**V2** — reporté :

- **BSD Trackdéchets** (intégration API gouvernementale) — risque réglementaire acté
- **Automations avancées** : Veolia auto (email+SMS à 85%), routing intelligent tournées
- **Multilingue** chauffeur / manager prestataire
- **Traçabilité contenants par numéro de série** (granularité stock Option B)
- **Multi-devise / international** si expansion

### Estimation timing V1

- **Dev pur (Claude Code solo)** : ~3 semaines au clavier
- **Timing calendaire réaliste** : **4-5 mois** incluant spécification restante, intégrations API tierces (Pennylane v2, Everest, Plateforme), seed data depuis MTS-1, tests terrain, formation prestataires, double-run

Le bottleneck n'est pas le code (Claude Code accélère 5-10x). Ce sont : les décisions produit, les API tierces (dépendances externes non compressibles), les tests terrain, la migration data.

### Blocages amont à lever avant go-live V1

1. **Date d'échéance licence MTS-1** — inconnue à date. **Action Val** prioritaire : conditionne tout le planning V1
2. **Baselines opérationnelles** (délais dispatch, délais facturation, marge actuelle) — à mesurer à l'onboarding V1, pas de cible chiffrée préalable
3. **Seed data depuis MTS-1** — export traiteurs, prestataires, véhicules, chauffeurs, tarifs, historique 2 ans + nettoyage manuel. ~1 semaine de travail Ops
4. **Inventaire actuel rolls / bacs / traiteurs** — nécessaire pour initialiser le module stock matériel. À réaliser en parallèle du dev

## 7. Principes directeurs

9 principes qui guident toutes les décisions V1 et V2 du TMS.

### 1. Cohérence Plateforme↔TMS — source de vérité unique par entité
- **Règle** : pour chaque entité (client, prestataire, collecte, tournée, facture), une seule app est source de vérité
- **Répartition** :
  - **Plateforme SoT** : clients, devis, facturation client, reporting réglementaire, documents RSE
  - **TMS SoT** : prestataires (données ops), véhicules, chauffeurs, tournées, stock matériel, coûts logistiques
  - **Collectes** : Plateforme crée, TMS exécute (sync bidirectionnelle avec ownership par champ)
- **Implication design** : contrat API versionné v1, champs ownership documentés

### 2. Zéro erreur non détectée Plateforme↔TMS
- **Règle** : tout écart de sync doit être détecté automatiquement sous 2h (objectif "0 erreur non détectée", pas "0 erreur")
- **Implication design** : reconciliation job toutes les 15 min, dashboard technique divergences, alerte Ops si écart non résolu après 1h

### 3. Périmètre strictement métier Savr
- **Règle** : on construit uniquement ce que le métier Savr exige. Pas de fonctionnalité générique, pas de scope creep
- **Implication design** : chaque nouvelle feature passe un test "fait-il avancer Savr spécifiquement ?"

### 4. Ops-first dispatch
- **Règle** : l'usage quotidien Ops Savr guide l'UX (1 clic = 1 décision, shortcuts clavier, bulk actions)
- **Implication design** : keyboard-driven, recherche ultra-rapide, assignation en masse, vue planning semaine/jour

### 5. Mobile-first chauffeur
- **Règle** : l'app mobile chauffeur doit fonctionner en terrain dégradé (3G, gants, soleil plein écran, pluie)
- **Implication design** : gros boutons (>48dp), peu de saisie texte, offline-tolerant avec sync différée, contraste élevé, économie batterie (géoloc haute précision uniquement quand nécessaire)

### 6. Multi-tenant RLS strict
- **Règle** : Strike ne voit JAMAIS les données de Marathon (et vice-versa), y compris via faille technique
- **Implication design** : Supabase Row Level Security sur toutes les tables prestataire-scoped, tests RLS obligatoires en CI, audit annuel isolation

### 7. Auditabilité totale actions sensibles
- **Règle** : toute action financière, attribution, modification tarif ou facture est tracée (horodatage + auteur + before/after)
- **Implication design** : table `audit_log` append-only, rétention 5 ans (obligation comptable), vue admin filtrable

### 8. Scalabilité 10x sans refactor
- **Règle** : le TMS tient 10x le volume actuel (1 000+ collectes/mois, 50+ chauffeurs, 10+ prestataires) sans redesign
- **Implication design** : indexes DB dès V1, pagination systématique, pas de logique métier dans les vues SQL, queues pour tâches lourdes

### 9. Fail-safe dégradation gracieuse
- **Règle** : si TMS down, les Ops Savr doivent pouvoir continuer à dispatcher via email/SMS manuel pendant 24-48h sans perte opérationnelle
- **Implication design** : export dispatch "papier" (PDF planning hebdo + coordonnées prestataires), pas de hard-dépendance runtime entre Plateforme et TMS

---

## Décisions prises

- **TMS propriétaire** retenu face à 3 alternatives (SaaS générique, licence MTS-1 renouvelée, module dans Plateforme) — 2026-04-21
- **Sous-domaine** : `tms.gosavr.io` — 2026-04-21
- **Stack** : Claude Code + Supabase (même que Plateforme pour mutualiser l'expertise) — déjà posé côté Plateforme
- **Principe "0 erreur non détectée"** retenu comme principe directeur (§7) — 2026-04-21
- **Principe "périmètre strictement métier Savr"** retenu (§7) — 2026-04-21
- **Auto-tare contenants** : fonctionnalité obligatoire V1. Contenants référencés : roll Savr, bac 1100L, bac 240L. Poids à vide (tare) à confirmer — 2026-04-21
- **Définition "vacation"** : mise à disposition pendant 4h d'un camion + 1 chauffeur (+ potentiellement 1 équipier supplémentaire). Unité de base de la facturation Strike — 2026-04-21
- **Définition "tournée Savr"** : 1 vacation = 1 camion → N collectes (N ≥ 1), même créneau. Cohérent avec la définition `tournees` côté Plateforme — 2026-04-21
- **Multi-camions par événement** : 1 événement → N collectes → N tournées possibles (1 tournée par camion). Coût logistique de l'événement = somme des coûts des tournées associées — 2026-04-21
- **Répartition du coût d'une tournée sur N collectes** : **répartition égale** V1 (option A). Simple, lisible, implémentable sans saisie chauffeur supplémentaire. Affinage possible V2 si besoin pilotage marge plus précis — 2026-04-21
- **Modèle tarifaire prestataires paramétrable** : chaque prestataire a son propre schéma tarifaire configurable. Pas de règle codée en dur. Le TMS doit permettre l'ajout dynamique d'un transporteur (notamment pour la province) avec grille tarifaire sur mesure — 2026-04-21
- **Grille tarifaire Strike V1** : camion 16m3 = 220€/vacation (4h), camion 20m3 = 300€/vacation (4h), équipier = 125€/vacation (pré-déclaré, ajustable a posteriori). Mécanique : 0-4h = tarif de base ; 4h-6h = heures sup 31,25€/h × nb_personnes (chauffeur seul = 1, + équipier = 2) ; >6h = nouvelle vacation de 4h, mécanique repart à 0. Tous les seuils paramétrables Admin TMS — 2026-04-22
- **Grille tarifaire Marathon V1** : 100€/vacation (4h). Tout dépassement de 4h déclenche une vacation supplémentaire complète (100€). Pas d'heures sup partielles. Paramétrable Admin TMS — 2026-04-22
- **Ajustement durée vacation a posteriori** : le TMS doit permettre de corriger la durée réelle d'une vacation après la course (base de recalcul automatique du coût) — 2026-04-21
- **100% des transporteurs dans le TMS V1** (Strike, Marathon, A Toutes!) : saisie terrain (poids, photos, plaque) centralisée dans le TMS pour uniformité des données — 2026-04-21
- **Intégration Everest rattachée au TMS, pas à la Plateforme** : la Plateforme envoie l'ordre au TMS, le TMS pousse vers Everest, A Toutes! valide dans Everest, Everest retourne le statut au TMS, le TMS remonte vers la Plateforme. Simplifie le flux Plateforme ↔ TMS et supprime l'intégration Plateforme ↔ Everest du CDC Plateforme — 2026-04-21
- **App mobile chauffeur unifiée** : une seule app mobile pour tous les transporteurs (camion Strike, camion Marathon, vélo cargo A Toutes!). Pas de variantes V1 — 2026-04-21
- **Synchronisation bidirectionnelle Plateforme ↔ TMS (prestataires)** : option permissive retenue. Tous les champs prestataire éditables depuis les 2 apps, stratégie last-write-wins + log d'audit. Révision V2 possible si conflits récurrents — 2026-04-21
- **Géolocalisation temps réel chauffeur V1** via l'app mobile TMS (geolocation API). Prérequis d'activation : consentement RGPD chauffeur + accord prestataire — 2026-04-21
- **Temps de tournée capturé** : horodatage début (prise en main par le chauffeur) et horodatage fin (dernière saisie effectuée). Durée = base pour calcul dépassement vacation 4h et pilotage productivité. Aligné avec `tournees.heure_debut_reelle` / `heure_fin_reelle` côté Plateforme — 2026-04-21
- **4 personas TMS retenus** : Ops Savr, Admin TMS, Manager prestataire, Chauffeur. Persona "Support technique / dev" écarté (couvert par audit log + dashboards admin) — 2026-04-21
- **Portail prestataire self-service (Option A)** : chaque prestataire a un compte TMS dédié avec accès aux collectes assignées, gestion parc, dashboard revenus, upload factures. Impact scope V1 assumé (+3-5 semaines dev) — 2026-04-21
- **Workflow validation collecte (A1)** : Ops Savr propose la collecte au prestataire → manager accepte/refuse → si accepte, assigne chauffeur + véhicule + éventuel équipier — 2026-04-21
- **RGPD docs chauffeurs** : stockage Supabase Storage (chiffré at-rest). Conservation pendant contrat chauffeur + 3 ans après départ sauf demande de suppression du prestataire. Accès manager prestataire + Ops Savr (contrôle sous-traitance) — 2026-04-21
- **Cumul rôles manager + chauffeur (B1)** : compte unique multi-rôles (`{manager: true, chauffeur: true}`) + switch de contexte dans l'app mobile. Cas rare mais supporté V1 — 2026-04-21
- **Rapprochement factures prestataires (C1)** : upload PDF → calcul auto montant théorique → si écart ≤ 1% validation auto, sinon alerte Louis/Val pour validation manuelle — 2026-04-21
- **Langue chauffeur V1** : français uniquement. Multilingue reporté V1.1 ou V2 — 2026-04-21
- **Granularité droits Admin TMS V1** : aucune — tous les admins (Val + Louis) ont tous les droits. À revoir si 3ème admin recruté à 12-18 mois — 2026-04-21
- **6 objectifs business V1** : remplacer MTS-1, économie 2 400€/an, amélioration marge logistique, 0 erreur non détectée Plateforme↔TMS, accélération cycle opérationnel, visibilité temps réel. KPIs chiffrés ou baselines à mesurer à l'onboarding — 2026-04-21
- **Double-run MTS-1 + TMS Savr** : 1 mois avant bascule définitive — 2026-04-21
- **Suivi temps réel 6 statuts mixtes** : En route vers collecte / Arrivé sur le lieu / Collecte en cours / En route vers entrepôt / En cours de pesée à l'entrepôt / Tournée finalisée. Portée mixte par collecte + par tournée — 2026-04-21
- **Détection statuts mixte (Option B)** : géoloc propose le statut, chauffeur valide par bouton (évite faux positifs GPS) — 2026-04-21
- **Statuts TMS-only (Option X)** : les 6 statuts terrain ne sont pas remontés à la Plateforme V1. La Plateforme conserve 2 états client-facing (planifiée / réalisée) — 2026-04-21
- **10 non-objectifs V1** actés : routing AI, multilingue, tracker GPS externe, RH chauffeurs, maintenance véhicules, multi-devise, portail client TMS, module comptabilité, BSD Trackdéchets, sinistres/assurances — 2026-04-21
- **BSD Trackdéchets reporté V2** : risque réglementaire acté (amende 7 500€+ par bordereau manquant). Validation juriste RSE recommandée — 2026-04-21
- **CSRD export en V1** : agrégation tonnes collectées, CO2 évité, % valorisation par client. Argument commercial grands comptes (Sodexo, Compass, Elior) — 2026-04-21
- **Registre transport en V1** : traçabilité légale en backup contre défaillance prestataires — 2026-04-21
- **Gestion stock matériel complet en V1** (upgrade depuis V1.1) — 2026-04-21
- **Granularité stock matériel par type** (Option A) : suivi par type (X rolls, Y bacs 1100L, Z bacs 240L), pas par numéro de série unique (reporté V2) — 2026-04-21
- **Paliers rolls par pax V1** : <100 pax = 1 roll, 100-200 = 2, 200-400 = 4, 400-800 = 8, >800 = saisie manuelle Ops. **Éditables par Ops Savr dans le TMS** — 2026-04-21
- **Source nb pax via webhook Plateforme → TMS** (Option A) : inclus dans le payload de création événement. Le nb pax doit figurer sur la collecte dans le TMS — 2026-04-21
- **Flux stock rolls déclaratif chauffeur** : à chaque collecte, le chauffeur déclare rolls pleins récupérés + rolls vides laissés chez traiteur. Permet suivi stock par traiteur + alertes sur/sous-capacité — 2026-04-21
- **Déclaration bacs entrepôt 3 paliers** (Option G) : au retour entrepôt, chauffeur déclare chaque bac rempli avec palier 50% / 75% / 100% pour les 4 types (biodéchet 240L, verre 240L, déchet résiduel 1100L, emballage 1100L) — 2026-04-21
- **Alertes Veolia à 85% (Option E)** : notification Ops Savr + bouton manuel "déclencher collecte Veolia" dans le TMS. Automation auto reportée V2 — 2026-04-21
- **Inventaire trimestriel rolls traiteurs via email magic link** : tous les 3 mois le TMS envoie un email auto au contact Ops du traiteur pour confirmer le stock théorique. Écarts remontés à Ops Savr. Contacts Ops traiteurs paramétrés manuellement dans le TMS — 2026-04-21
- **Pas d'inventaire physique entrepôt V1** : à revoir V1.1 si écarts stock théorique vs réel détectés — 2026-04-21
- **Phasage V1 monolithique** : tout livré en une seule release V1 (hors BSD Trackdéchets reporté V2). Bascule MTS-1 après V1 complet — 2026-04-21
- **Estimation timing V1** : ~3 semaines dev pur Claude Code, 4-5 mois calendaires réels (spécification + API tierces + seed data + tests terrain + double-run) — 2026-04-21
- **9 principes directeurs V1** actés : cohérence SoT unique, 0 erreur non détectée, périmètre strict Savr, Ops-first dispatch, Mobile-first chauffeur, Multi-tenant RLS strict, Auditabilité totale, Scalabilité 10x, Fail-safe dégradation — 2026-04-21
- **Date d'échéance licence MTS-1** : 30 mai (année à confirmer). Prolongation envisageable si nécessaire — Val assume pas de panique car Claude Code + full-time compresse les délais — 2026-04-21
- **Parcours chauffeur différencié ZD vs AG** : deux workflows terrain distincts. ZD = pesée à l'entrepôt en fin de tournée. AG = pesée sur place + livraison directe assos — 2026-04-21
- **Statuts terrain ZD (8 statuts)** et **Statuts terrain AG (8 statuts)** : séquences distinctes documentées en §4. Détection mixte : geofence auto pour transitions de déplacement, boutons chauffeur pour transitions d'action — 2026-04-21
- **Checklist pré-départ ZD** : Tenue Savr, Plaque véhicule OK, Rolls vides chargés, Carburant OK — 2026-04-21
- **Checklist pré-départ AG** : Balance, Matériel isotherme, Carbo glace (applicable à tous les chauffeurs AG : camion + vélo-cargo) — 2026-04-21
- **5 flux ZD** : biodéchets, verre, emballage, carton, déchet résiduel. Valeur 0kg possible par flux si non collecté — 2026-04-21
- **1 flux AG** : don alimentaire — 2026-04-21
- **Pesées ZD** : réalisées à l'entrepôt après fin de tournée. Poids brut → auto-tare contenant → poids net. Pesées multiples possibles par flux par collecte (bouton "+" UX, accumulation avec total visible) — 2026-04-21
- **Pesées AG** : réalisées sur place lors de la collecte. Poids brut = poids net (contenants tarés ou tare négligeable). Pesées multiples possibles (bouton "+") — 2026-04-21
- **Photos ZD** : rolls pleins dans le camion lors de la collecte (pas de photo plaque ni contenants vides laissés) + photo par flux à l'entrepôt avec écran balance visible (preuve pesée) — 2026-04-21
- **Photos AG** : contenants pleins pesés avec écran balance visible + photo remise du don à l'asso — 2026-04-21
- **Signature numérique récepteur asso AG** : obligatoire. Nom + prénom + signature tactile. Preuve légale pour attestation fiscale 2041-GE (déduction fiscale donneur) — 2026-04-21
- **Enchaînement AG flexible** : planning dynamique ordonné par Ops Savr au dispatch. Entrelacement possible C1→A1→C2→A2, ou toutes les collectes puis toutes les livraisons, ou N collectes → 1 asso unique. Chauffeur suit la séquence sans choisir — 2026-04-21
- **Pas de bouton "Je commence la livraison" AG** : statut "Livraison en cours" supprimé. Seul bouton "Livraison terminée" après photo + signature — 2026-04-21
- **Répartition poids multi-assos AG** : % théorique pré-défini par Ops Savr au dispatch × poids total pesé. Pas de saisie poids par asso (écart non attendu selon Val). Attestation 2041-GE générée auto depuis cette répartition — 2026-04-21
- **Équivalent repas AG** : calcul auto = poids (kg) / coefficient Admin TMS (défaut 0,45 kg/repas, paramétrable). Coefficient strictement aligné Plateforme — propagation revue sobriété M05 E7 2026-04-30 — 2026-04-21 (mis à jour 2026-04-30)
- **Relevé température camion AG** : reporté V2 (pas V1) — 2026-04-21
- **Reliquat non livré AG** : cas non géré V1 (assumé "ça n'arrive pas" par Val). À revoir V1.1 si retour terrain différent — 2026-04-21
- **Module signalements rapides V1** : Catégorie 1 Entrepôt (consommables, nettoyage, problèmes techniques, demande matériel) + Catégorie 3 Client/Collecte (accès bloqué, tri non conforme, comportement). Catégorie 2 Véhicule reportée (responsabilité prestataire) — 2026-04-21
- **Fonctionnalités "whaou" chauffeur V1** : Boussole RSE personnelle (dashboard mensuel kg/CO2/arbres), Gamification badges discrets, Boîte à idées. Exclus V1 : SOS bouton urgence, Tips du jour push — 2026-04-21
- **Gouvernance whaou** : Ops Savr paramètre les badges et dépouille la boîte à idées (cadence mensuelle). Chauffeurs ne voient pas les remontées des collègues — 2026-04-21
- **Stock rolls traiteur — SoT TMS** : calcul auto à partir des déclarations chauffeur (stock = précédent − rolls pleins récupérés + rolls vides laissés). Remontée au référentiel traiteur Plateforme par webhook `traiteur-stock-rolls-update` pour affichage Admin — 2026-04-21
- **Planning chauffeur app mobile** : affichage d'une séquence numérotée ordonnée ("Étape 3 sur 7 : Livraison Resto du Cœur Paris 11e"). Ordre défini par Ops au dispatch. Chauffeur suit sans choisir — 2026-04-21
- **Impact data model — pesées multiples** : table `pesees` doit supporter N pesées pour un même couple (collecte_id, flux_type). Poids net total flux = Σ(pesées individuelles). À spécifier en §04 Data Model TMS — 2026-04-21

## Questions ouvertes

1. — **Résolu (Val 2026-04-28)** : Roll 850L emboîtable = **37 kg**, Roll pliable = **26 kg**, Bac 1100L = **50 kg**, Bac 240L = **11 kg**, Sac = 0,5 kg. Propagé §04 `types_contenants` seed + M09 QO2 clôturée.
2. **Tarif camion Strike en cas de prolongation de vacation** : non négocié à date. Ex : si vacation dure 7h au lieu de 4h, qu'est-ce que Strike facture en plus des heures sup opérateurs (31,25€/h/personne) côté immobilisation camion ? Action côté Val : **négocier avec Strike**. En attendant, paramétrage libre dans le TMS (ex : linéaire au prorata, tranche de 4h, forfait, autre).
3. **Tarifs Marathon en cas de dépassement de 4h** : à clarifier. Structure identique Strike (heures sup/personne + immobilisation camion) ou logique forfaitaire ? Action côté Val : **confirmer avec Marathon**.
4. **3ème type de camion Strike (V2)** : type et tarif encore inconnus. Architecture Data Model doit permettre l'ajout sans migration lourde.
5. — **Résolu 2026-04-22**. Décision Option A : `courses_logistiques.tournee_id UNIQUE` (côté Plateforme). Coût porté par la tournée, réparti au prorata du nombre de collectes (`cout_par_collecte_ht = cout_ht / nb_collectes_tournee`). MAJ §04 Plateforme + §05 Plateforme + §04 TMS effectuées.
6. **MAJ CDC Plateforme — suppression intégration directe Plateforme ↔ Everest** : traitée 2026-04-21 (10 edits sur 6 fichiers du CDC Plateforme). Section à archiver dans cette liste.
7. **Consentement RGPD chauffeur + accord prestataire** (géoloc V1) : modalités à définir. Options : opt-in à l'activation du compte, clause type dans le contrat prestataire Strike/Marathon/A Toutes!, coupure individuelle par chauffeur. À traiter en §15 Sécurité et conformité TMS.
8. **Règles d'attribution transporteur** : V1 doit permettre règles pré-définies (suggestion + éventuelle attribution auto) + override admin. Critères pressentis : zone géographique, disponibilité, type de prestation (ZD/AG), coût attendu, fiabilité. À spécifier en §5 Règles métier TMS.
9. **Date d'échéance licence MTS-1** : inconnue. **Action Val prioritaire** — conditionne tout le planning V1. Impact : délai go-live V1 = échéance − 1 mois (double-run).
10. **Baselines opérationnelles V1** : marge logistique % par événement, délai dispatch → assignation chauffeur, délai collecte → facture prestataire reçue. À mesurer à l'onboarding TMS (pas de cible chiffrée préalable). Cibles quantifiées à fixer après 3 mois d'usage.
11. **Validation juriste RSE — report BSD en V2** : risque amende 7 500€+ par bordereau manquant en cas de contrôle. **Action Val** : faire valider par un juriste RSE ou expert-comptable le niveau d'exposition réel et l'acceptabilité sur 4-6 mois avant V2.
12. **Seed data depuis MTS-1** : export + nettoyage traiteurs, prestataires, véhicules, chauffeurs, tarifs, historique 2 ans. Qui pilote et sous quel délai ? ~1 semaine de travail Ops. À planifier en parallèle du dev.
13. **Inventaire actuel rolls / bacs / traiteurs** : stocks initiaux totaux confirmés Val 2026-04-28 (Roll 850L=60, Roll pliable=8, Bac verre 240L=20, Bac biodéchet 240L=8, Bac déchet résiduel 1100L=20, Bac emballage 1100L=6). Répartition par traiteur restante — à saisir par Ops Savr E3 à J0 migration (D4 §13). Action : relevé traiteurs par email/visite à planifier avant go-live.
14. **Obligations Registre transport** : Savr donneur d'ordre ou transporteur au sens du code des transports ? Implique quelle périodicité de tenue ? À valider avec juriste RSE (lot commun avec Question 11).
15. **RGPD docs chauffeurs — suppression sur demande** : workflow exact pour la "demande de suppression du prestataire" (Persona 3). Interface self-service dans le portail prestataire ou ticket email à Ops Savr ? À spécifier en §15 Sécurité et conformité TMS.
16. **Valeurs par défaut paliers rolls** : à valider à l'usage terrain. Les valeurs V1 (<100=1, 100-200=2, 200-400=4, 400-800=8) sont des hypothèses raisonnables mais à affiner avec retours chauffeurs premiers mois.
17. **Année d'échéance licence MTS-1** : 30 mai — confirmer 2026 (crise planning, 39 jours) ou 2027 (confortable, 13 mois). **Action Val urgente**.
18. **Coefficient kg/repas AG** : défaut **0,45 kg** (mis à jour 2026-04-30 — alignement strict TMS+Plateforme). À valider avec les assos ou les coefficients ADEME officiels. Impact direct sur l'attestation 2041-GE et le reporting RSE client.
19. **Réglementation DDPP chaîne du froid AG** : le relevé de température camion sera-t-il exigé réglementairement en V2 ? Source : DDPP (Direction Départementale de la Protection des Populations) sur le transport de denrées alimentaires périssables. À faire valider avec juriste RSE (lot commun Q4 + Q11).
20. **Tare contenants AG** : le "poids brut = poids net" suppose des contenants de tare négligeable ou pré-connue. Liste des contenants AG autorisés + tares à définir (actuellement non documenté).
21. **Hypothèse répartition poids multi-assos AG** : validation implicite du modèle "% pré-défini par Ops au dispatch × poids total". À challenger si le terrain montre des écarts significatifs (V1.1 possible).

## Liens

- [[00 - Index]]
- [[01 - Cahier des charges App/00 - Index|CDC Plateforme — Index]]
- [[01 - Cahier des charges App/03 - Périmètre fonctionnel global|CDC Plateforme — Périmètre (Module 9 TMS)]]
- [[01 - Cahier des charges App/04 - Data Model|CDC Plateforme — Data Model (tournees, collectes, courses_logistiques)]]
- [[01 - Cahier des charges App/08 - APIs et intégrations|CDC Plateforme — API et webhooks TMS]]

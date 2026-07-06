# 13 - Migration depuis Bubble


---

## Coordination cross-CDC avec §13 TMS Migration MTS-1 (propagation 2026-04-27)

Les deux migrations sont **simultanées** sur la même fenêtre temporelle :
- **Côté Plateforme** (ce document) : Bubble → nouvelle Plateforme Savr (utilisateurs, packs AG, lieux, historique collectes, factures)
- **Côté TMS** ([[../02 - Cahier des charges TMS/13 - Migration MTS-1]]) : MTS-1 → nouvelle TMS Savr (référentiel prestataires, double-run total 1 mois)

**Alignements clés à acter en V1 finale** :
- **Durée double-run** : 1 mois (cf. §13 TMS — aligner Phase 2 ci-dessous "2 à 4 semaines" sur 1 mois fixe)
- **Communications** : clients (Plateforme) vs prestataires/chauffeurs (TMS) → audiences distinctes, à coordonner pour éviter doublons emails sur dirigeants prestataires qui seraient aussi clients
- **Source légale fenêtre migration** : Bubble + MTS-1 (production) ; Plateforme nouvelle + TMS Savr = shadow + tests
- **Mode migration côté nouvelle Plateforme** : à acter — flag équivalent `migration_mode_active` côté Plateforme pour bloquer envois emails clients + facturation pendant le mois (question ouverte cross-CDC)

**Écart cross-CDC — résolu (2026-06-11)** : la colonne `contexte` (mode migration) vit sur `tms.audit_logs` (cf. [[../02 - Cahier des charges TMS/04 - Data Model TMS#3. tms.audit_logs — 1 nouvelle colonne contexte]]), table TMS distincte du journal App `plateforme.audit_log`. Depuis la dissolution de `shared.audit_logs` (audit canonique = 2 journaux séparés `plateforme.audit_log` + `tms.audit_logs`), il n'y a plus de table partagée ni de colonne fantôme côté App : aucun écart. Si un mode migration côté App devient nécessaire V1.1+, ajouter explicitement la colonne à `plateforme.audit_log`.

---

## Volumes actuels (source Bubble)

| Entité | Volume *(réels exports 2026-06-07 — inventaire Phase 10)* |
|--------|--------|
| Collectes alimentaires (AG) | **1 755** (2021→2026) |
| Collectes déchets (ZD) | **222** |
| Utilisateurs | **306** lignes (~30-36 éligibles après filtre activité 12 mois) |
| Organisations traiteurs | **133** (avant fusion doublons) + 157 agences |
| Lieux | **773** lignes `Lieu événementiels` (avant dédup par adresse) |
| Packs AG | **24** + 22 abonnements historiques |
| Factures émises | n/a — **Pennylane = source de vérité** (décision Val 2026-06-07) |

**État général** : données peu structurées côté Bubble, difficilement accessibles. Migration 1:1 impossible, nécessite retravail manuel.

---

## Priorisation des données à migrer

### Critiques (obligatoires avant go-live nouvelle app — bloquantes)

1. **Utilisateurs** : email, nom, prénom, téléphone, rôle, organisation → permet continuité de service
2. **Organisations** : raison sociale, SIRET, entités de facturation, contacts → permet reprise facturation
3. **Packs AG actifs (non épuisés)** : crédits initiaux, crédits consommés, crédits restants, mode de facturation, date de validité → critique pour ne pas perdre d'argent
4. **Référentiel lieux initié via migration** (normalisé + enrichi : adresse accès unique — `adresse_grand_public` supprimée revue sobriété M05 2026-04-29, accès office, stationnement enum, type véhicule max, traiteurs opérant) — ensuite **modifiable Admin Savr** exclusivement. **Précision 2026-06-07 (Phase 10, tranché Val)** : source = Data Type Bubble `Lieu événementiels` (773 lignes, dédupliquées par adresse normalisée) + 2e passe sur les adresses des collectes ; `type_vehicule_max` initialisé `poids_lourd` (resserrage Admin lieu par lieu), `stationnement`/`acces_office` NULL (cf. cas particulier 2026-05-08 ci-dessous). Fiche complète : `04 - Migration/02 - Mappings/03`.
5. **Associations et transporteurs AG** : référentiel minimal pour que l'algo fonctionne dès le lancement
6. **Historique complet des collectes clôturées** (tout l'historique Bubble migré, pas seulement 12 mois) — obligatoire avant ouverture nouvelle app pour ne pas casser le reporting RSE client ni l'accès au registre réglementaire
7. **Amendé 2026-06-07 (Phase 10, tranché Val)** — Bubble n'a aucun Data Type Facture : **Pennylane est la source de vérité comptable**, aucune migration de factures. La continuité est assurée côté Pennylane; le rapprochement `entites_facturation.pennylane_customer_id` se fait post-import (match SIRET puis raison sociale, listing manuel des non-matchés — fiche `04 - Migration/02 - Mappings/01` §3). La table `factures` démarre vide à la bascule.
8. **Amendé 2026-06-07 (Phase 10, tranché Val)** — aucune trace exploitable dans Bubble (colonne CERFA vide à 100 %) : bordereaux/attestations/rapports d'impact historiques = **archive cold uniquement** (export Bubble complet, §Phase 4). Le registre réglementaire est reconstruit depuis les collectes migrées (badge `historique_partiel` le cas échéant); les rapports restent régénérables à la demande via §12. Items 16-18 de `04 - Migration/07 - Donnees abandonnees`.

### Traitement manuel des cas manquants

Si une collecte historique Bubble est incomplète (pas d'exutoire, pas de pesée, association manquante) :
- Listing généré par le script de migration
- Admin Savr complète manuellement via back-office **avant go-live** ou marque la collecte via le flag `collectes.historique_partiel = true` (visible dans le registre avec badge « Historique partiel » — **précisé 2026-06-07, F3 session test-scenarios §06.03** : flag boolean dédié, le statut reste `cloturee`, pas de 10e valeur d'enum)

### Non-critiques (arbitrage au cas par cas)

9. **Commentaires libres, pièces jointes ad hoc** : à évaluer selon valeur business
10. **Brouillons de collectes non validés** : pas migrés

---

## Stratégie de bascule (confirmée)

**Période de test parallèle obligatoire** avant bascule : les deux apps tournent en même temps pendant une période de vérification (2 à 4 semaines), avec équipe ops Savr qui valide les calculs de crédits, la génération PDF, les montants facturés, la cohérence des dashboards sur données réelles.

- **Phase 0 — Préparation (≈ 2 mois avant bascule)** : export Bubble, scripts de migration, staging, audit qualité.
- **Phase 1 — Migration technique** : import de toutes les données dans la nouvelle app (staging + prod silencieuse), **référentiel lieux figé** et enrichi manuellement par Val/Admin. Historique complet + cas manquants traités manuellement.
- **Phase 2 — Test parallèle** : ops Savr opère sur les deux apps en parallèle 2 à 4 semaines. Les collectes sont saisies sur la nouvelle app, contrôlées contre Bubble. Contrôle quotidien : factures émises, PDF bordereaux, dashboards client.
- **Phase 3 — Bascule complète** : après validation go/no-go de Val, tous les users basculent sur la nouvelle app. Ancienne app en lecture seule pour sauvegarde, décommissionnée 30 jours après.
- **Phase 4 — Décommissionnement Bubble** : export cold (S3 ou équivalent) + résiliation abonnement 120 €/mois.

**Downtime acceptable** : < 2h en heures creuses (weekend). Communication clients en amont.

---

## Actions concrètes

1. **Export complet Bubble** en JSON/CSV dès la décision de migration (sauvegarde cold)
2. **Audit de qualité des données** par Val (nettoyage Bubble en amont pour limiter la casse côté import)
3. **Scripts de migration sur mesure** (Python) :
   - Mapping users Bubble → Supabase + envoi emails "votre compte est prêt"
   - Mapping packs AG actifs (calcul crédits restants)
   - Mapping **référentiel lieux** (normalisation `adresse_acces` unique — `adresse_grand_public` supprimée revue sobriété M05 2026-04-29 ; si Bubble fournit les 2 valeurs, prendre `adresse_acces_livraison` en priorité, sinon `adresse_grand_public`. **Refonte 2026-05-08** : `stationnement` + `acces_office` + `type_vehicule_max` ne sont **pas** migrés depuis Bubble — nouveau référentiel à ressaisir post-migration (cf. ci-dessous). Rattachement traiteurs opérant conservé.)
   - Mapping **historique complet collectes** avec gestion des cas partiels
   - Liste des collectes incomplètes → traitement manuel Admin Savr avant go-live

### Cas particulier : refonte enums `lieux` 2026-05-08

Suite à la refonte §06 §7 du 2026-05-08 (changement de nature des enums `stationnement` + `acces_office` + alignement `type_vehicule_max` sur enum véhicules unifié), **aucune migration automatique n'est faite** sur ces 3 colonnes :

- **`stationnement`** : nouveau référentiel "difficulté d'accès" (`facile/difficile/tres_difficile`). L'ancien enum Bubble "type d'emplacement" (parking dédié, quai livraison, stationnement rue, zone livraison courte) n'a pas de mapping sémantique direct. **Initialisé NULL pour tous les lieux**, ressaisie manuelle par Admin lieu par lieu post-migration.
- **`acces_office`** : nouveau enum (`facile/difficile/tres_difficile`) ex-texte libre. **Initialisé NULL**, ressaisie via UI Admin V1.1 (file de normalisation lieux).
- **`type_vehicule_max`** : enum aligné `velo_cargo/camionnette/fourgon/vul/poids_lourd` (ex `vl/camion_16m3/camion_20m3/camion_30m3`). **Migration manuelle Admin** : Val ressaisit lieu par lieu (volume V1 estimé ~quelques centaines de lieux actifs) au moment de l'enrichissement référentiel.

### Cas particulier : refonte `transporteurs` 2026-05-08

- **3 champs supprimés** : `regions_couvertes`, `villes_couvertes`, `capacite_max_kg` — non importés depuis Bubble.
- **6 nouveaux champs obligatoires à compléter** côté Admin avant go-live : `siren` (validation INSEE), `adresse`, `code_postal`, `ville`, `latitude`/`longitude` (géocodage auto), `type_tms` (`mts1/a_toutes/autre`), `contact_telephone` (rendu obligatoire).
- **`types_vehicules`** : si Bubble fournit `velo_cargo` ou `camionnette_refrigeree`, normaliser vers le nouvel enum unifié (`velo_cargo/camionnette/fourgon/vul/poids_lourd`). Sinon NULL → ressaisie manuelle Admin.

### Cas particulier : refonte `types_evenements` 2026-05-26 (Sujet 4 — type vs taille)

Le référentiel `types_evenements` passe à **4 catégories de format de service** (`cocktail_aperitif`, `cocktail_repas_complet`, `repas_assis`, `autre`). Mapping des valeurs Bubble vers les nouveaux `code` (la FK `evenements.type_evenement_id` étant un uuid, le remap se fait à l'INSERT des `evenements`) :

- Ancien `cocktail_10` / "Cocktail <10 pièces" → **`cocktail_aperitif`**
- Ancien `cocktail_24` / "Cocktail <24 pièces" → **`cocktail_repas_complet`**
- Ancien `diner_assis` / "Dîner assis" → **`repas_assis`**
- Toute autre valeur Bubble (type libre, gala, conférence, showroom, valeur vide…) → **`autre`**
- **Champ texte libre Bubble ignoré** : le mécanisme `type_evenement_libre` est retiré V1 (cf. [[04 - Data Model]] + [[05 - Règles métier]] R_type_evenement_libre retirée). Aucune colonne cible — la valeur Bubble n'est pas importée. Si Val veut conserver une distinction fine pour certains événements, ressaisie manuelle vers une nouvelle ligne `types_evenements` ajoutée ad hoc.

### Cas particulier : fusion type `lieu_independant` → `gestionnaire_lieux` (sobriété 2026-06-03 D1)

Le type d'organisation `lieu_independant` est supprimé (cf. [[09 - Authentification et permissions]] + [[04 - Data Model]]). Mapping à l'import des `organisations` :

- Toute org Bubble typée « lieu indépendant » / `lieu_independant` → `organisations.type = 'gestionnaire_lieux'`.
- Ses lieux sont rattachés normalement via `organisations_lieux` (un lieu autonome = une seule ligne de rattachement). Aucune perte de donnée, aucune UX dégradée (dashboard gestionnaire scopé à 1 lieu).
- Les users associés (rôle Bubble équivalent) → `users.role = 'gestionnaire_lieux'`.

4. **Phase de test parallèle** 2-4 semaines (ops sur les deux apps en simultané)
5. **Communication client** : email pré-migration (15 jours avant, **confirmé**), email jour J, email post-migration. Template dans `06 - Fonctionnalités détaillées/02 - Templates emails V1`.

---

## Décisions prises

- **Historique complet obligatoire** avant ouverture de la nouvelle app (pas seulement 12 mois) — bloquant go-live
- **Cas manquants traités manuellement** par Admin Savr avant go-live (ou marqués via le flag `collectes.historique_partiel` dans le registre — F3 2026-06-07)
- **Référentiel lieux initié via migration** + enrichi lors de la migration, ensuite **modifiable exclusivement par Admin Savr**
- **Bascule après période de test parallèle** 2-4 semaines (ops sur les deux apps)
- **Email pré-migration 15 jours avant** confirmé (template dans 06/02 Emails)
- Val accompagne activement la migration (pas de dev tiers autonome)
- Priorité : **utilisateurs + packs AG actifs + référentiel lieux + historique complet**
- Pas de migration 1:1 : la qualité actuelle des données Bubble ne le permet pas
- **Décommissionnement Bubble 30 jours après bascule** + archive cold

## Cohabitation V1 → V2 (garde-fou 5 TMS-Ready)

> **Créé 2026-06-10 (challenge Frontière)** — la Frontière TMS-Ready annonçait cette section sans qu'elle existe. L'esquisse complète vit dans **[[../04 - Migration/08 - Esquisse cohabitation V1 vers V2]]** : création `tms.*` au cutover (zéro modification `plateforme.*`), bascule par transporteur via la factory `logistique_provider`, double-run avec worker outbox unique routant par `type_tms`, devenir de `tms_reference`/`external_ref_commande`/`nb_camions_demande`, neutralisation `code_transporteur_mts1` + `id_point_collecte_mts1`, archive de clôture MTS-1, rollback jusqu'à la résiliation. À détailler par `cdc-cutover-plan`.

## Questions ouvertes

_Aucune — module stabilisé pour V1. (2026-04-28)_

 **Clôturé** : ~30 utilisateurs actifs. (2026-04-28)
 **Clôturé** : pas de conditions particulières. Migration = récupérer types de packs + crédits restants par organisation. (2026-04-28)

## Liens

- [[00 - Index]]
- [[04 - Data Model]]
- [[../04 - Migration/01 - Inventaire source Bubble]] — **plan d'exécution Phase 10 complet** (inventaire, 8 mappings, ordre, transformations, checks SQL, rollback, abandons)
- [[../02 - Cahier des charges TMS/13 - Migration MTS-1]] — section TMS coordonnée (V1 rédigée 2026-04-27)
- [[../02 - Cahier des charges TMS/00 - Index]] — Index CDC TMS
- [[11 - Dashboards]]

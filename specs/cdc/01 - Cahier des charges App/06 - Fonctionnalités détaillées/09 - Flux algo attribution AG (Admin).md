# 09 - Flux algo attribution AG (Admin)

**Lié à** : [[05 - Règles métier]] §2 — Algorithme d'attribution Anti-Gaspi · [[04 - Data Model]] tables `attributions_antgaspi`, `associations`, `transporteurs`, `parametres_algo`

---

## Objectif fonctionnel

Pour chaque collecte Anti-Gaspi programmée, l'algorithme recommande automatiquement une association bénéficiaire + un transporteur (si applicable). L'Admin Savr valide, modifie ou traite manuellement cette recommandation, puis déclenche l'envoi des emails aux parties prenantes.

Ce module est exclusivement accessible par le profil `admin_savr`.

---

## 1. Accès à l'attribution AG — intégré à la page Collectes (refonte UX 2026-06-30)

### Emplacement
> **Refonte UX 2026-06-30 (divergence ATTRIBUTION-EMPLACEMENT)** : il n'y a **plus de page dédiée « Attributions à valider » dans le menu**. L'accès à l'attribution AG est **intégré à la page Collectes** du back-office Admin.

- Un **filtre / chip « Collectes à attribuer »** sur `/admin/collectes` liste les collectes AG en attente d'attribution (= ex-file d'attente : `type = anti_gaspi` + `statut_tms = non_envoye` + statut `programmee`/`validee`).
- Chaque ligne AG porte un bouton **« Attribuer → »** menant à l'écran d'attribution `/admin/attributions-ag/[collecteId]` (§2). Cet écran **ne figure pas dans le menu de gauche** : on y accède uniquement depuis la liste Collectes.
- Les **« Paramètres algorithme »** et la **« Configuration auto-accept »** (auparavant rattachés à la file d'attente) sont déplacés sous la page **Paramètres** du menu principal.

### Affichage (liste Collectes)
Colonnes de la liste Collectes, dans l'ordre (décision Val 2026-06-30) : **Type · Date · Heure · Traiteur · Pax · Lieu · Statut · bouton Attribuer**. La colonne « Statut TMS » est **retirée de cette vue**. Le filtre « Collectes à attribuer » restreint la liste aux collectes AG en attente d'attribution, triées par **créneau de collecte le plus proche** (`collectes.date_collecte` ASC).

### Indicateur criticité < 48h (reporté sur « Collectes à attribuer » — décision Val 2026-06-30)
La criticité < 48h vit désormais sur la vue filtrée « Collectes à attribuer » de la page Collectes (la page dédiée disparaît) : badge rouge **« URGENT »** sur la ligne + ligne surlignée (fond rose pâle) si `date_collecte < now() + 48h` ET attribution non validée. Les lignes urgentes sont **automatiquement remontées en tête** de la liste filtrée, avant le tri chronologique général. Pas de notification email Admin pour ce seuil en V1 (traitement visuel uniquement).

---

## 2. Détail d'une attribution

L'Admin clique sur une ligne pour ouvrir l'écran de traitement.

### Structure de l'écran

**Bloc collecte (haut, lecture seule)**
- Événement, traiteur, lieu, date/heure, volume estimé repas
- Statut actuel de la collecte
- Lien vers la fiche collecte complète

**Bloc recommandation algorithme — Associations (top 3)**

Tri unique par **distance Haversine croissante** entre `lieux.latitude/longitude` et `associations.latitude/longitude`. Pas de scoring sur 100 points — la règle métier est "association ouverte la plus proche ayant la capacité de recevoir les dons", la capacité est un filtre binaire (cf. §05 R2), la distance est le tri unique.

| Rang | Association | Distance (km) | Capacité max (repas) | Recommandée |
|------|------------|--------------|---------------------|-------------|
| 1 | Nom assoc A | 4,2 km | 850 | ✓ |
| 2 | Nom assoc B | 8,7 km | 1 200 | |
| 3 | Nom assoc C | 12,1 km | 500 | |

- Si une association est exclue par horaire : affichée en grisé avec mention "Exclue — horaires incompatibles"
- Bouton **"Sélectionner"** sur chaque ligne pour choisir une alternative au top 1
- Bouton **"Choisir une autre association"** : ouvre une recherche manuelle dans le référentiel `associations` (hors top 3) avec filtres : ville, capacité min, habilitation 2041-GE

**Bloc recommandation algorithme — Transporteurs**

La sélection du transporteur AG suit **deux logiques distinctes selon la région du lieu de collecte** :

- **Lieu en Île-de-France** → application des **règles d'attribution dur §2.3** (3 branches A Toutes!/Marathon). Pas de top 3 affiché : la branche retourne un transporteur unique avec un motif explicite (bandeau "Branche AG Marathon nuit", "Branche AG vélo express", etc.). L'Admin peut overrider avec motif obligatoire (cf. §3).
- **Lieu hors Île-de-France** → scoring distance + véhicule compatible (cf. [[05 - Règles métier#Critères de scoring — Transporteur]]). Top 3 affiché, sélection par l'Admin, override avec motif si choix ≠ top 1.

**Précision périmètre V1 (filtres province — 2026-06-30, divergence M2.3)** : la **validité de grille tarifaire transporteur n'est PAS un filtre V1**. Le référentiel de coûts/grilles par transporteur n'existe pas en V1 (il relève du Dashboard Bloc 3 Coûts sur `tms.*`, descopé V1.1 — cf. CLAUDE.md §3). Les filtres d'éligibilité province réellement appliqués en V1 sont : `actif` + `type_prestation` contient `ag` + rayon (Haversine ≤ `rayon_intervention_km`) + compatibilité véhicule/lieu ; le **tri** se fait sur distance ASC puis `nb_collectes_6_mois_cache` ASC. Un transporteur sans grille de coût peut donc figurer dans le top 3 (l'Admin valide, le coût étant calculé hors algo en V1.1+). Le filtre grille sera réintroduit en V2 quand le référentiel `tms.*` existera.

**Précision conceptuelle 2026-05-09** : A Toutes! et Marathon sont modélisés dans la table `transporteurs` (jamais dans `associations`). A Toutes! gère son propre transport via Everest, mais l'orchestration de l'ordre (Plateforme V1 / Savr TMS V2) reste centralisée — cf. §3 cascade de validation. La référence ancienne "association = A Toutes!" était un raccourci ambigu, supprimée pour cohérence avec les règles IDF dur §2.3.

**Cas aucune association éligible**
- Le tableau top 3 affiche : "Aucune association disponible pour ce créneau. Traitement manuel requis."
- L'Admin doit sélectionner manuellement via la recherche libre
- Log `audit_log` : `action = "attribution_manuelle_aucune_reco"` avec `user_id` Admin

### 2.3. Règles d'attribution transporteur AG — Île-de-France (workflow Admin)

> **Source de vérité de la règle métier** : [[05 - Règles métier#Règles d'attribution transporteur Île-de-France|§05 R2 — Règles d'attribution transporteur Île-de-France]]. Cette sous-section décrit le **workflow d'écran Admin** correspondant. En cas de divergence, §05 prime.

**Affichage Admin Savr** : pour une attribution AG IDF, l'écran affiche un bandeau au-dessus du bloc transporteur indiquant la branche calculée (ex : "Branche AG vélo express — A Toutes! vélo, délai 1h12 avant collecte") + le transporteur résultant. Pas de top 3 transporteurs (la branche détermine un transporteur unique, pas un classement). Override via bouton "Choisir un autre transporteur" → ouvre la recherche libre dans `transporteurs` + motif obligatoire (cf. §3 Override).

**Cas modification `nb_pax` post-attribution (refonte sobriété A2 2026-05-09)** : aucun workflow dédié V1. Si un Admin modifie `nb_pax` après validation et que la branche calculée diffère, la collecte n'est **pas re-routée automatiquement** ni notifiée par template dédié. Si l'Admin souhaite changer de transporteur, il rouvre l'écran d'attribution et applique un override standard (motif libre `autre`). Justification : edge case rare en pratique, l'audit cohérence + la file d'attente standard suffisent.

**Cas `ag_everest_camion_express`** (branche 9, ajout 2026-06-15 DIV-8, tranché Val) : rescue grand volume urgent IDF. Se déclenche quand la branche initiale aurait retourné `aucun_prestataire` **ET** `nb_pax ≥ seuil_pax_velo (600)` **ET** `a_toutes_indisponible = false` **ET** `delai_minutes < seuil_h2_minutes (90)`. Dans ce cas, A Toutes! est sollicitée via le service Everest **77 (camion express)** au lieu de laisser la collecte en traitement manuel. L'écran affiche le bandeau "Branche AG Everest camion express — A Toutes!, délai urgent". L'Admin peut overrider avec motif.

**Cas `aucun_prestataire`** : la branche n'a pas trouvé de transporteur valide (Marathon exclu sans backup possible **et** conditions `ag_everest_camion_express` non remplies). L'écran affiche "Aucun prestataire éligible — traitement manuel". L'Admin doit sélectionner un transporteur via la recherche libre + motif obligatoire.

> **Go-live — branche backup camion morte (décision consciente Val 2026-06-10, challenge logistique)** : tant que la gate Everest est active (adapter Everest = V1.1, hors go-live), `parametres_algo.a_toutes_indisponible = true` est **seedé au go-live**. Conséquences : les branches vélo basculent `ag_velo_fallback_marathon` (Marathon/MTS-1, nominal prévu) **et la branche backup `ag_marathon_volume_backup_camion` (service Everest 91) est inopérante** → si Marathon est exclu sur un gros volume, la collecte tombe **directement en `aucun_prestataire`** = traitement manuel Ops ci-dessus. Cas rare, assumé. Réactivation automatique du backup à la livraison de l'adapter Everest V1.1 (repasser le flag à `false`). **Ne pas coder de fallback Strike camion** à la place (non validé opérationnellement).

**Gros volume AG de jour servi par plusieurs vélos (décision 2026-05-29)** : V1 **ne modélise pas** le multi-vélo. Pour un gros événement de jour à servir en vélo cargo A Toutes!, l'Admin crée **une seule course Everest** côté Savr ; la duplication en N vélos est réalisée **manuellement par A Toutes! sur sa plateforme Everest**. Savr ne voit donc qu'**une** course, **un** poids total (agrégé chez A Toutes!) et des photos rattachées à la collecte (déjà illimitées par collecte, cf. [[../08 - APIs et intégrations]] contrainte photos) — **aucun champ ni table multi-vélo en V1**, 0 changement de data model. **V2** (Everest passe sous le Savr TMS) : le TMS programmera **N courses automatiquement** et agrégera poids/coût **au niveau collecte**, en réutilisant le substrat multi-camions **générique** déjà en place (`collecte_tournees` N↔N + S5 terminal agrégé + [[../05 - Règles métier#R_statut_collecte_multi_tournees|R_statut_collecte_multi_tournees]]) — ce n'est pas un nouveau mécanisme. Volet à spécifier en session `cdc-tms-savr`.

---

## 3. Validation et envoi

### Bouton "Valider l'attribution"
Actif uniquement si une association est sélectionnée ET un transporteur est sélectionné (toujours, depuis refonte 2026-05-09 — A Toutes! et Marathon sont des transporteurs explicites).

**Action côté Plateforme — transaction synchrone unique (refonte 2026-05-09 sobriété B5)** :
1. `attributions_antgaspi.valide_par` = `current_user.id`, `valide_at` = `now()`
2. `attributions_antgaspi.mode_validation` = `'manuel_top1'` si reco non modifiée, `'manuel_override'` si override (voir §8 enum)
3. **La collecte passe au statut `programmee`** (et **non** `validee`). **Alignement machine à états ZD/AG (Sujet AG statuts, 2026-05-29)** : la validation d'attribution Admin = décision de dispatch (choix asso + transporteur), équivalent fonctionnel de l'envoi prestataire en ZD — donc `programmee`, pas `validee`. `statut_tms` reste `non_envoye` à ce stade (l'ordre n'est pas encore parti : étape 5, asynchrone). Le passage `programmee → validee` est dérivé **ultérieurement** par le trigger `fn_sync_statut_collecte_from_tms` à l'acceptation transporteur (cf. cascade ci-dessous + [[05 - Règles métier]] §4). Aucune écriture applicative directe de `statut` sur la plage `programmee ↔ validee`.
4. Débit du pack AG (voir [[05 - Règles métier#3. Packs Anti-Gaspi — Décrémentation et blocage]])
5. **Publication d'un événement applicatif `attribution_validee`** (job queue Supabase) qui déclenche **asynchrone** : envoi email association (Resend), envoi email transporteur (Resend), envoi de l'ordre transporteur (cf. cascade V1/V2 ci-dessous).

**Justification cascade asynchrone** : un échec Everest (timeout, 5xx) ne bloque pas la validation Admin ni la cohérence interne (statut collecte, pack, attribution). Le job retry indépendamment selon politique standard (3 paliers, cf. §08). Resend journalise les envois côté Resend (suppression timestamps `email_*_envoye_at` colonnes Plateforme — refonte 2026-05-09 sobriété A3).

**Cascade asynchrone — envoi de l'ordre transporteur (V1/V2)** :
- **V1** (sans TMS Savr) : la Plateforme appelle directement l'API du prestataire selon le mapping branche → service détaillé dans [[../08 - APIs et intégrations#V1 — appel direct Plateforme → Everest|§08 §3]] (Everest pour A Toutes!, MTS-1 pour Marathon + province). Réponse stockée dans `attributions_antgaspi.confirmation_transporteur`. **Pilotage `statut_tms` par la Plateforme (Sujet AG statuts, 2026-05-29, arbitrage 2a)** : à l'envoi effectif de l'ordre, la Plateforme positionne `collectes.statut_tms = 'attribuee_en_attente_acceptation'` (le transporteur est déjà désigné par l'Admin → on saute `a_attribuer`). Le `statut` métier reste `programmee`. En V1 il n'y a pas de TMS Savr : c'est la Plateforme (et non un webhook TMS) qui fait progresser `statut_tms` pour l'AG.
- **V2** (avec TMS Savr) : webhook Plateforme → TMS Savr (E2 §08). Le TMS ré-applique [[../../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées/M12 - Attribution transporteur|M12 §4]] (lit `parametres_algo` Plateforme) puis orchestre Everest/dispatch. `statut_tms` est alors piloté par les webhooks TMS (`collecte-acceptee`, etc.) comme en ZD. Statut remonte via webhook S2 et est stocké dans `attributions_antgaspi.confirmation_transporteur`. **Transmission de l'association attribuée (ajout 2026-05-29, arbitrage Val)** : la cascade E2 inclut l'objet `association_attribuee` (snapshot de l'association validée : id, nom, adresse, GPS, contact, horaires). Le TMS le fige dans `collectes_tms.association_snapshot` et l'affiche au chauffeur en M05 E7 (destination de livraison des excédents). Sans cela, le chauffeur ne saurait pas où livrer. En V1 (sans TMS), cette info reste sur la Plateforme — pas de transmission. Une ré-attribution (refus asso, cf. workflow refus association) ré-émet E2 avec le nouveau snapshot.

**Acceptation transporteur → `validee` (Sujet AG statuts, 2026-05-29)** : dès que le transporteur a accepté, `collectes.statut_tms` passe à `acceptee`, ce qui déclenche le trigger `fn_sync_statut_collecte_from_tms` qui dérive `programmee → validee` (machine commune ZD/AG, cf. [[04 - Data Model]] §`statut_tms` + [[05 - Règles métier]] §4). Deux chemins vers `acceptee` :
- **V1** : confirmation Everest synchrone positive (`confirmation_transporteur.statut = accepté`) → `statut_tms = acceptee` immédiat. Pour MTS-1, signal positif explicite (commande planifiée / démarrée — cf. [[../08 - APIs et intégrations#3bis. API Plateforme ↔ MTS-1|§08 §3bis]], Q3bis-2).
- **V2** : webhook `collecte-acceptee` du TMS Savr (identique à la ZD).

**Acceptation = signal positif explicite uniquement (révision 2026-05-29, décision Val — suppression de l'acceptation implicite par délai)** : la Plateforme ne bascule **jamais** en `acceptee` par simple écoulement de temps. Tant qu'aucun signal positif n'est reçu, la collecte reste `attribuee_en_attente_acceptation` (statut métier `programmee`) et remonte dans le monitoring Admin des collectes non confirmées (relance Ops manuelle à l'approche de la `date_collecte`). Le rejet (HTTP error sync, webhook async Everest, refus Marathon) positionne `statut_tms = 'rejetee_par_prestataire'`, déclenche notification Admin + retour file d'attente. **Supprimés 2026-05-29** (risque de collecte « fantôme acceptée » jamais réalisée).

### Override de la recommandation

Quand l'Admin sélectionne une association ou un transporteur différent du top 1 recommandé, un motif est obligatoire avant que "Valider" soit cliquable.

**UI — liste déroulante + texte libre (refonte 2026-05-09 sobriété B4)** : 6 motifs preset + "Autre" → champ texte libre obligatoire (min 10 car.) :

| Code preset | Libellé UI |
|-------------|-----------|
| `assoc_top1_surchargee` | Association top 1 surchargée cette semaine |
| `client_demande` | Demande spécifique client |
| `transporteur_top1_indispo` | Transporteur top 1 indisponible |
| `a_toutes_indispo_locale` | A Toutes! indisponible localement (incident ponctuel non flag) |
| `proximite_acceptable` | Distance top 2/3 acceptable, choix opérationnel |
| `autre` | Autre — préciser (texte libre) |

Stocké dans `attributions_antgaspi.motif_override` (text, code preset ou texte libre si `autre`). `mode_validation = 'manuel_override'`. Log `audit_log` : `action = "attribution_override"`, `details = { motif_code, motif_texte, association_reco, association_choisie, transporteur_reco, transporteur_choisi }`.

---

## 4. Emails envoyés à la validation

### Email — Association bénéficiaire
Envoyé à : adresse(s) de contact de l'association (`associations.email_contact`)

Contenu :
- Nom de l'événement, date/heure de collecte
- Lieu (adresse complète + accès office si disponible)
- Volume estimé en repas
- Nom du transporteur mandaté (si applicable)
- Contact Admin Savr pour questions

Template Resend : `ag_attribution_association` (nouveau — à ajouter à [[02 - Templates emails V1]])

### Email — Transporteur
Envoyé à : adresse de contact du transporteur (`transporteurs.email_contact`)

Contenu :
- Date/heure de prise en charge
- Adresse de collecte
- Adresse de livraison (siège association)
- Volume estimé
- Contact Admin Savr

Template Resend : `ag_attribution_transporteur` (nouveau)

**Pas de relance automatique en V1.** Unique email d'information. Si nécessaire, l'Admin relance manuellement hors plateforme.

---

## 5. Suivi post-attribution

### Onglet "Attributions validées"
Tableau historique : même structure que la file d'attente, avec colonnes supplémentaires :
- Association attribuée
- Transporteur attribué
- Override (oui/non, avec motif en tooltip)
- Volume repas réalisé (renseigné post-collecte)

### Saisie du volume repas réalisé (post-collecte)

**Décompte du pack AG sur le programmateur (clarification 2026-05-07)** : à la transition `collectes.statut → 'realisee'`, le crédit AG est décompté sur le pack actif de l'organisation programmatrice (`evenements.organisation_id`), **pas** du traiteur opérationnel. Si l'organisation programmatrice n'a pas de pack actif → erreur de transition (impossible normalement car la programmation aurait été bloquée en amont, cf. §06.01 sélection pack AG). Algo de matching prestataire/association reste basé sur le **lieu** (zone géographique), inchangé : la nature du programmateur n'impacte pas le scoring.

**Flux V1 (sans TMS Savr)** : Ops Savr saisit manuellement le `poids_repas_kg` dans l'onglet "Attributions validées" en analysant les **photos de pesées** remontées par le chauffeur. Ni Everest ni MTS-1 ne retournent ce poids en V1. La saisie est loggée dans `audit_log` (`action = 'poids_repas_saisi_ops'`). Permission : `ops_savr` + `admin_savr` peuvent UPDATE `attributions_antgaspi.poids_repas_kg` (à ajouter §09). **Flux V2 (avec TMS Savr)** : le chauffeur saisit le poids sur le TMS Savr ; le TMS pousse via webhook vers la Plateforme. **(Décision 2026-06-07, Val)**

**Conversion automatique — source unique de la formule (§7.2 et §8 y renvoient, dédup sobriété 2026-06-03 C1)** : `volume_repas_realise = ceil(poids_repas_kg / parametres_algo.poids_par_repas_kg)` (défaut `0.45`, soit 450 g = 1 repas — refonte audit sobriété 2026-05-09 B2). **Source unique cross-app** : le paramètre est défini une seule fois dans `parametres_algo` Plateforme. Le TMS V2 lit ce coefficient via cross-schema (`plateforme.parametres_algo.poids_par_repas_kg`) — `m05_equivalent_repas_kg` historiquement présent côté `parametres_tms` est supprimé V2 (cf. M05 §coefs).

Mise à jour automatique de `attributions_antgaspi.volume_repas_realise` et `attributions_antgaspi.poids_repas_kg` (voir §7 Impact data model).

L'Admin voit la valeur mise à jour dans l'onglet "Attributions validées" sans action de sa part. Si la valeur semble aberrante, il peut la corriger manuellement avec motif obligatoire.

---

## 6. Auto-accept

### Définition
Pour certaines combinaisons `(association_id, type_evenement_id)` connues et fiables, l'Admin peut activer le mode **auto-accept** : l'attribution est validée automatiquement sans intervention humaine.

### Écran de configuration
Accessible via : Back-office Admin → Paramètres → Auto-accept AG

Tableau de ~40 lignes maximum (V1) :

| Association | Type d'événement | Activé | Modifié par | Modifié le |
|------------|-----------------|--------|------------|-----------|
| Les Restos du Cœur | Mariage | ✓ | Admin A | 12 avr 2026 |
| Secours Pop | Cocktail | | | |

- Bouton toggle par ligne
- Pas de pagination en V1 (< 50 lignes)
- Filtre rapide par association ou type d'événement

### Comportement en auto-accept
1. Algorithme tourne normalement
2. Si top 1 = association concernée ET type_evenement correspond : validation immédiate
3. `attributions_antgaspi.mode_validation = 'auto_accept'` + `valide_par = null` (aucun humain) — refonte 2026-05-09 sobriété D2
4. La collecte passe en statut `programmee` (et **non** `validee` — alignement ZD/AG 2026-05-29, cf. §3) + débit pack AG (cf. §3 transaction synchrone). `statut_tms = non_envoye` jusqu'à l'envoi de l'ordre (étape 5). `validee` dérivé à l'acceptation transporteur par le trigger.
5. **Cascade asynchrone** déclenchée (cf. §3) : envoi emails + ordre transporteur via job queue (positionne `statut_tms = attribuee_en_attente_acceptation` à l'envoi, puis `acceptee` à l'acceptation → trigger → `validee`)
6. L'Admin voit la ligne dans l'onglet "Attributions validées" avec badge "Auto" (pas dans la file à valider)

### Cas de non-déclenchement de l'auto-accept
Si le top 1 ne correspond pas à l'association configurée en auto-accept (ex : association exclue pour horaires ce jour-là), le workflow revient en validation manuelle normale. Aucun fallback automatique sur une autre association.

---

## 7. Paramètres pilotables de l'algorithme

Accessible via : Back-office Admin → Paramètres → Algorithme AG.
Tous les paramètres sont stockés dans `parametres_algo` (table existante, voir [[04 - Data Model#Table parametres_algo]]). Toute modification est versionnée (`updated_at`, `valide_par`) et loggée dans `audit_log` (`action = "parametres_algo_update"`, `details = { champ, ancienne_valeur, nouvelle_valeur, motif }`).

### 7.1. Pondération scoring association — supprimé refonte 2026-05-09

> **Refonte 2026-05-09 — sobriété A1+B3** : la pondération distance/capacité ajustable (60/40) a été supprimée. Le scoring sur 100 points est remplacé par un tri unique par distance Haversine croissante après filtres binaires (cf. §05 R2 sélection association). La capacité est désormais un filtre binaire (`capacite × 2 > volume_estime`), plus un critère pondéré. Conséquences : suppression colonnes `parametres_algo.poids_distance_assoc` + `poids_capacite_assoc`, suppression colonnes `attributions_antgaspi.score_association` + `score_transporteur`. Si V2 réintroduit un scoring multi-critères → ré-ajouter les paramètres.

### 7.2. Règles d'attribution transporteur IDF — branches §2.3

Pilotables par l'Admin Savr sans redéploiement. **Source de vérité unique = Plateforme** (`parametres_algo`), V1 comme V2. Le TMS V2 ne définit pas ses propres paramètres : il **lit** les valeurs depuis la Plateforme (push synchrone via webhook dédié `parametres-algo-sync` lors de toute modification, ou pull TMS au démarrage + cache local invalidé par webhook). Cf. [[../../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées/M12 - Attribution transporteur|M12 §4 TMS]] pour l'application des règles côté TMS.

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `regle_ag_seuil_pax_velo` | int | 600 | Seuil `evenements.nb_pax` au-delà duquel grand événement jour → Marathon (branche 2) |
| `regle_ag_plage_velo_debut` | time | 07:00 | Début plage horaire jour (A Toutes! ouvert) |
| `regle_ag_plage_velo_fin` | time | 20:00 | Fin plage horaire jour (A Toutes! ouvert) — couvre vélo cargo **et** camion (décision 2026-05-09) |
| `regle_ag_seuil_h2_minutes` | int | 90 | Frontière express vs programmé (minutes restantes avant collecte) — sous-branche 3 |
| `a_toutes_indisponible` | bool | false | Flag opérationnel manuel — bascule branche 3 vers Marathon en cas d'incident A Toutes!. **Métadonnées (qui/quand/pourquoi) lues depuis `audit_log` (filtre `action = "parametres_algo_update"`, `details.cle = 'a_toutes_indisponible'`) — refonte audit sobriété 2026-05-09 B1.** |
| `everest_codes_postaux` | text[] | `['75', '92', '93']` | Préfixes département (2 caractères) couverts par le service Everest. Vérification locale `lieux.code_postal[:2] IN (…)` dans branche 3 et backup branche 2. Liste extensible Admin Savr. |
| `province_tri_secondaire_code` | text | `nb_collectes_6_mois_asc` | **Ajouté audit cohérence B3 2026-05-09** — algorithme de tri secondaire pour la branche `ag_province_proximite` (après distance ASC). Permet de répartir la charge entre prestataires à distances équivalentes. Aligné TMS M12 §4.7. |
| `poids_par_repas_kg` | numeric | `0.45` | **Ajouté audit sobriété 2026-05-09 B2** — coefficient de conversion poids→repas (cf. §5 conversion volume_repas_realise). Source unique cross-app : la Plateforme V1 codé en dur, le TMS V2 lit cross-schema (`plateforme.parametres_algo.poids_par_repas_kg`). Évite divergence Plateforme/TMS. |

**Modification d'un paramètre IDF** :
- Champ obligatoire **motif** (texte libre min 10 caractères) loggé dans `audit_log.details`.
- Bascule du flag `a_toutes_indisponible` à `true` : déclenche en plus une notification Ops "A Toutes! marqué indisponible — toutes les nouvelles attributions IDF jour basculent vers Marathon" (template `ag_a_toutes_indispo` à ajouter [[../02 - Templates emails V1]]).
- Avertissement standard : "Modifie les attributions futures uniquement. Les attributions déjà validées ne sont pas recalculées."

---

## 8. Impact data model

### Champs à ajouter sur `attributions_antgaspi`

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `motif_override` | text | NULL si `mode_validation ∈ ('manuel_top1', 'auto_accept')` | Code preset (cf. §3 Override) ou texte libre si `autre`. Obligatoire si `mode_validation = 'manuel_override'`. |
| `motif_override_libre` | text | NULL si motif preset | Texte saisi quand `motif_override = 'autre'` (min 10 car.) |
| `poids_repas_kg` | decimal | | Poids brut saisi par le chauffeur via TMS (source de vérité). Conversion `volume_repas_realise` : formule + coefficient = **source unique §5** (dédup sobriété 2026-06-03 C1). |
| `branche_attribution` | text | NOT NULL | Valeurs canoniques (audit cohérence A3 2026-05-09 — alignées TMS M12) : `ag_marathon_nuit`, `ag_marathon_volume`, `ag_marathon_volume_backup_camion`, `ag_velo_express`, `ag_velo_programme`, `ag_velo_fallback_marathon`, `ag_province_proximite` (= hors IDF, tri distance + secondaire `nb_collectes_6_mois`), `aucun_prestataire`, **`ag_everest_camion_express`** (ajout 2026-06-15, DIV-8, tranché Val) : branche rescue grand volume urgent IDF — service Everest 77 camion express, déclenchée quand `nb_pax ≥ seuil_pax_velo` ET `a_toutes_indisponible=false` ET `delai_minutes < seuil_h2_minutes (90)` — cas edge qui évite le `aucun_prestataire` sur gros volume urgent avec A Toutes! disponible. **+ `migration_bubble` (ajout 2026-06-07 Phase 10, tranché Val)** : posée exclusivement par le script de migration sur l'historique AG Bubble — jamais produite par l'algo |
| `confirmation_transporteur` | jsonb | NULL avant retour prestataire | Réponse Everest/MTS-1 (V1) ou TMS (V2) : `{ statut, reference_externe, recu_at, brut }` |
| `mode_validation` | enum | NOT NULL | **Refonte 2026-05-09 sobriété D2** : remplace ex-bool `recommandation_auto`. Valeurs : `manuel_top1` (Admin valide reco top 1), `manuel_override` (Admin choisit autre + motif), `auto_accept` (zéro humain, auto-accept activé). Plus lisible que combiner bool + `valide_par null`. |

### Champs supprimés sur `attributions_antgaspi` (refonte 2026-05-09)

| Champ supprimé | Motif |
|---------------|-------|
| `score_association` | Sobriété B3 — scoring 100 pts remplacé par tri distance pure |
| `score_transporteur` | Sobriété B3 — idem (et IDF n'utilise pas de score) |
| `recommandation_auto` (bool) | Sobriété D2 — remplacé par enum `mode_validation` (3 valeurs) |
| `email_association_envoye_at` | Sobriété A3 — Resend journalise les envois côté son interface |
| `email_transporteur_envoye_at` | Sobriété A3 — idem |
| `email_association_envoye` (bool) | Sobriété A3 — déduit du job queue + Resend |
| `email_transporteur_envoye` (bool) | Sobriété A3 — idem |

### Champs supprimés sur `parametres_algo` (refonte 2026-05-09)

| Champ supprimé | Motif |
|---------------|-------|
| `poids_distance_assoc` | Sobriété A1 — pondération supprimée, distance pure |
| `poids_capacite_assoc` | Sobriété A1 — capacité = filtre binaire |

### Paramètres restants sur `parametres_algo`

8 paramètres pilotables (cf. §7.2 + §04 Data Model `parametres_algo`) : `regle_ag_seuil_pax_velo`, `regle_ag_plage_velo_debut`, `regle_ag_plage_velo_fin`, `regle_ag_seuil_h2_minutes`, `a_toutes_indisponible`, `everest_codes_postaux`, `province_tri_secondaire_code`, `poids_par_repas_kg` (audit sobriété 2026-05-09 B2).

---

## Décisions prises

| Décision | Alternative écartée | Raison |
|----------|-------------------|--------|
| Top 3 trié par distance Haversine pure (refonte 2026-05-09 sobriété B3) | Scoring sur 100 pts (60 distance + 40 capacité ajustable) | Règle métier = "association ouverte la plus proche ayant la capacité". Capacité = filtre binaire (`capacite × 2 > volume`), distance = tri unique. Pas besoin de pondération paramétrable que personne n'a vocation à modifier en V1. |
| Override avec liste déroulante 5 motifs preset + texte libre (refonte 2026-05-09 sobriété B4 + audit sobriété 2026-05-09) | Texte libre min 10 car. | Permet stats overrides exploitables sans NLP + cohérence avec le motif `a_toutes_indispo_locale` introduit par les branches IDF. Motif `recalcul_pax` retiré (cas particulier `nb_pax` post-attribution supprimé — cf. §2.3). |
| Cascade validation asynchrone via job queue Supabase (refonte 2026-05-09 sobriété B5) | 7 étapes synchrones bloquantes | Échec Everest/Resend ne bloque ni la validation Admin ni la cohérence interne (statut, pack, attribution). Retry indépendant. |
| Suppression timestamps emails côté Plateforme (refonte 2026-05-09 sobriété A3) | Stockage `email_*_envoye_at` + booléens | Resend journalise les envois côté son interface. Doublon stockage évité. |
| `mode_validation` enum 3 valeurs (refonte 2026-05-09 sobriété D2) | Bool `recommandation_auto` + check `valide_par null` | Sémantique explicite : `manuel_top1` / `manuel_override` / `auto_accept`. Évite la combinaison bool + champ null ambigüe. |
| Poids kg saisi par chauffeur (TMS) → conversion auto plateforme | Saisie repas directe | Le chauffeur raisonne en poids, pas en repas. Conversion centralisée évite erreurs de saisie |
| Pas de relance automatique V1 | Relance J+1 auto | Complexité vs usage réel faible (associations sont habituées au process) |
| Auto-accept : table simple sans pagination | Workflow de validation auto complexe | ~40 lignes max en V1, inutile de sur-ingénier |
| Indicateur rouge < 48h visuel uniquement | Notification email Admin | L'Admin consulte régulièrement le back-office ; alerte email = bruit |
| **Règles IDF dur (3 branches A Toutes!/Marathon §2.3)** | Scoring distance + véhicule uniforme IDF + province | Contrats opérationnels A Toutes! (vélo cargo journée) et Marathon (nuit / grosses) imposent une logique métier dur. Scoring uniforme produirait des recommandations contractuelles invalides. |
| **Source de vérité paramètres = Plateforme V1+V2** (refonte 2026-05-09) | Bascule TMS V2 (`parametres_tms.attribution`) | Le TMS V2 lit `parametres_algo` Plateforme via webhook ou pull, jamais n'écrit. Évite duplication stockage + synchronisation bidirectionnelle. |
| **A Toutes! et Marathon = `transporteurs`, jamais `associations`** | Modélisation hybride (A Toutes! comme association autonome) | Refonte 2026-05-09 : la confusion A Toutes! = "association qui gère son transport" générait du couplage entre §05 R2, §09 et §08. Une fois A Toutes! repositionnée comme transporteur, les branches IDF deviennent lisibles et l'algo reste générique côté association. |
| **Validation attribution AG → `programmee`, pas `validee` (Sujet AG statuts 2026-05-29)** | Forçage direct `validee` à la validation Admin (état antérieur) | La machine `collectes.statut` est commune ZD/AG : `validee` = **accepté par le prestataire**, dérivé par le trigger `fn_sync_statut_collecte_from_tms` depuis `statut_tms`. La validation d'attribution Admin = décision de dispatch (équivalent envoi prestataire ZD) → `programmee`. `validee` n'arrive qu'à l'acceptation transporteur. Le trigger étant déjà générique, aligner l'AG sur `statut_tms` suffit — aucun trigger AG-spécifique. |
| **Plateforme pilote `statut_tms` AG en V1 (arbitrage 2a)** | Laisser `statut_tms` AG inerte jusqu'à V2 | En V1 l'AG passe par Everest direct (pas de TMS Savr). Pour que AG et ZD partagent la même sémantique de statut dès V1, la Plateforme écrit elle-même `statut_tms` (envoi → `attribuee_en_attente_acceptation`, acceptation → `acceptee`, rejet → `rejetee_par_prestataire`). En V2 le TMS reprend ce pilotage via webhooks. |
| **Multi-vélo AG : V1 manuel (1 course Everest + duplication A Toutes!), V2 auto TMS (2026-05-29)** | Modéliser dès V1 N ordres côté Savr (table fille + agrégation poids/coût) | Sobriété V1 : le découpage de la flotte est un détail opérationnel d'A Toutes!. En créant une seule course Everest et en dupliquant les vélos à la main chez A Toutes!, Savr ne voit qu'une course → **0 data model**, photos déjà illimitées, poids = total agrégé chez le prestataire. La modélisation N-courses + agrégation au niveau collecte est reportée en V2 (chantier TMS), où elle **réutilise le substrat multi-camions générique** (`collecte_tournees` N↔N, S5 terminal agrégé, `R_statut_collecte_multi_tournees`) — pas un mécanisme neuf à inventer. |
| **Correction `volume_repas_realise` → régénération automatique de l'attestation de don (2026-05-29)** | Régénération manuelle / pas de régénération | L'attestation de don est un document à valeur quasi-juridique (justificatif fiscal 2041-GE) : elle doit refléter le chiffre corrigé. Quand l'Admin corrige `volume_repas_realise` (saisie aberrante), l'attestation correspondante est **régénérée automatiquement** ; la version précédente est marquée supersédée (indicateur visuel + date de mise à jour, cf. [[12 - Reporting et exports#1.3 Attestation de don AG]]). Cohérent avec le mécanisme de régénération post-correction de pesée du rapport de recyclage. |

---

## Questions ouvertes

- **Tranchée 2026-05-29 (Val) : oui, régénération automatique** — cf. Décisions prises + [[12 - Reporting et exports#1.3 Attestation de don AG]].
- **Sync `parametres_algo` Plateforme → TMS V2** (audit cohérence A1 2026-05-09) : V1 source unique = Plateforme. **V2** : à reétudier au cutover. Canal de sync (webhook push vs pull TMS + invalidation cache) à figer dans §08 V2 + plan de cutover.
- **Caduque 2026-05-29** : acceptation implicite par délai supprimée (décision Val). L'acceptation se fait uniquement sur signal positif explicite ; pas de paramètre de délai. Reste à figer (V1) le délai d'**alerte Ops** pour les collectes non confirmées approchant leur `date_collecte` — détail de monitoring §06.06, pas un auto-accept.
- **Spec technique Everest API V1** : endpoints exacts (services 71/75/91), auth, payload, gestion d'erreur — session dédiée à prévoir avant dev V1 (cf. §08 §3).
- **V2 — multi-vélo AG automatique (chantier TMS)** : programmer automatiquement N courses Everest pour une grosse collecte AG de jour servie en vélo cargo + agréger poids/coût au niveau collecte. Côté App, le substrat multi-camions (`collecte_tournees` N↔N, S5 terminal agrégé, `R_statut_collecte_multi_tournees`) **couvre déjà** le besoin (générique ZD/AG, vérifié 2026-05-29) ; reste à confirmer la complétude AG dans le S5 terminal agrégé (signature asso, génération attestation 2041-GE sur poids total, conversion poids→repas agrégée). À spécifier en session `cdc-tms-savr`. V1 = workaround manuel (cf. §2.3 + Décisions).

---

## Liens

- [[05 - Règles métier]] — §2 Algorithme d'attribution AG (filtres assoc + scoring province)
- [[04 - Data Model]] — tables `attributions_antgaspi`, `associations`, `transporteurs`, `parametres_algo`
- [[05 - Règles métier#3. Packs Anti-Gaspi — Décrémentation et blocage]] + [[06 - Back-office Admin Savr]] §8 onglet Packs AG
- [[08 - APIs et intégrations]] — Everest API + MTS-1 (V1), webhooks E2/S2 (V2)
- [[02 - Templates emails V1]] — templates `ag_attribution_association`, `ag_attribution_transporteur`, `ag_a_toutes_indispo` à ajouter
- [[../../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées/M12 - Attribution transporteur|TMS — M12 §4]] — pseudocode des 3 branches IDF (source de vérité V2)

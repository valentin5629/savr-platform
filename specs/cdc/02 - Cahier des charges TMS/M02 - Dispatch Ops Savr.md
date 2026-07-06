# M02 — Dispatch Ops Savr

**Module pilote** du sous-dossier §06. Définit le gabarit pour les 13 autres modules.

**Persona principal** : Ops Savr (Val, Louis, +1 recrue prévue V1.1)
**Contexte d'usage** : desktop bureau, pic d'activité 6h-10h (préparation journée) + ajustements continus jusqu'à 20h.

---

## Addendum 2026-04-23 (seconde salve M01) — Impacts M02

Issu de la seconde salve M01 ([[M01 - Réception ordres de collecte]]). 2 impacts sur M02 (l'impact 2 — override snapshot — a été retiré dans la revue de sobriété 2026-04-29).

1. **Flux `a_attribuer` unifié** : toutes les collectes reçues via E1 arrivent désormais en `statut_dispatch='a_attribuer'` (D10 pré-affectation supprimée). Plus de cas "Collecte pré-affectée par Plateforme" à gérer dans l'UI M02. Plus de toast `dispatch_pre_affectation`. L'écran E1 Dispatch affiche toutes les collectes en attente d'attribution dans la même liste. Les règles d'attribution forte (ex : client X = toujours Strike) vivent dans M12 (paramétrable, à spécifier).
2. **Bouton "Synchroniser snapshot depuis lieu"** (D15 M01) : sur le drawer d'une collecte, bouton permettant de rafraîchir `collectes_tms.lieu_snapshot` depuis la version courante de `plateforme.lieux`. Utile quand l'Ops reçoit l'alerte `dispatch_lieu_snapshot_divergent`. Confirmation modale obligatoire (audit `action='SNAPSHOT_SYNC'`). **Override ponctuel du snapshot retiré V1** (revue sobriété 2026-04-29) — cas tordu géré hors plateforme par appel traiteur ou correction lieu upstream Plateforme.
3. **Nouvelle alerte `m02_lieu_snapshot_divergent`** (warning) : bandeau orange sur la carte collecte quand un PATCH E5 `/lieux/:id` est reçu côté TMS pour un lieu référencé par cette collecte. Le bouton "Synchroniser snapshot pour cette collecte" *(override ponctuel — sobriété M01 A_M01_05 2026-04-30)* est mis en évidence dans le drawer. Persiste jusqu'à sync ou passage à `statut_operationnel='en_cours'` (auto-dismiss).

---

## 1. Objectif métier

Interface quotidienne de l'équipe Ops Savr pour attribuer les collectes aux prestataires logistiques, suivre l'avancement temps réel et gérer les incidents de dispatch. C'est **le poste de commandement** de la journée opérationnelle.

**Ce que M02 résout vs MTS-1** :
- Dispatch suggestion auto (M12) au lieu du tri manuel
- Vue temps réel des statuts sans refresh
- Gestion province intégrée (confirmation manuelle structurée)

**KPI cibles V1** :
- 0 collecte oubliée en fin de journée (alerte automatique si `a_attribuer` à J-1 18h)
- 100% des refus prestataire traités en < 15 min (suivi manuel par Ops, pas de SLA système V1)

---

## 2. Personas et contexte d'usage

### Ops Savr
- Desktop Mac/Windows, Chrome/Safari, écran 15" minimum (layout deux colonnes).
- Session longue (6h-20h), souvent en multi-onglets (TMS + Plateforme admin + Slack + Gmail + Notion).
- Travaille à 6h du matin en conditions pas toujours optimelles (café, low-attention) → **zéro clic inutile**, raccourcis visuels forts.
- 2 Ops simultanés attendus V1, 3 en V1.1. **Last-write-wins assumé** : si 2 Ops attribuent la même collecte en parallèle, dernier l'emporte. Cas rare avec 2-3 Ops qui se parlent (Slack/téléphone).

### Admin TMS (secondaire)
- Accès complet en lecture + override. Utilise M02 en supervision, pas en quotidien.
- Peut reprendre la main sur un refus ou une attribution contestée.

### Manager prestataire (hors périmètre M02)
- Ne voit **jamais** M02. Il utilise M03 (portail self-service) pour accepter/refuser. Mention ici uniquement pour préciser la séparation stricte.

### Chauffeur (hors périmètre M02)
- N'interagit pas avec le dispatch. Reçoit les tournées acceptées via M05 (app mobile).

---

## 3. Architecture des écrans

Six écrans V1, tous desktop-first (revue sobriété 2026-04-29 — fusion E2/E3 en vue mois ; **E6 carte ajouté V1 — arbitrage Val 2026-06-03, révise D2**).

| # | Écran | Rôle | Accès |
|---|-------|------|-------|
| E1 | Dashboard dispatch | Vue par défaut au login, KPI du jour + liste collectes à attribuer | Ops, Admin TMS |
| E2 | Vue mois | Planning mois, 1 ligne par collecte, filtres persistants | Ops, Admin TMS |
| E3 | Détail collecte (drawer) | Fiche complète + actions | Ops, Admin TMS |
| E4 | Modal attribution | Sélection prestataire + confirmation (mono-collecte) | Ops, Admin TMS |
| E5 | Formulaire province | Confirmation manuelle Ops après contact hors-TMS | Ops, Admin TMS |
| E6 | Vue carte du jour | Pins géolocalisés des collectes du jour, lecture visuelle de la répartition pour mutualiser | Ops, Admin TMS |

**Navigation** : header avec onglets E1 / E2 / E6 (carte). Drawer E3 s'ouvre en overlay latéral sur E1/E2/E6 (n'interrompt pas la vue). Modal E4 au-dessus du drawer E3. Formulaire E5 = page dédiée (tunnel, trop de champs pour un modal).

---

## 4. Écran par écran

### E1 — Dashboard dispatch (vue par défaut au login)

**Décision Val 2026-04-23** : au login, Ops atterrit sur E1.
**Décision Val 2026-04-29 (revue sobriété)** : E1 est devenu un écran d'action directe. Plus de bandeau alertes en zone 1 (les alertes vivent dans M11 / cloche header). Plus de KPIs J-7 rolling (export CSV M11 si besoin). Plus de tuiles-jauges exutoires (lien direct dans header vers /exutoires). Layout simplifié à 2 zones.

**Layout** : 2 zones verticales.

**Zone 1 — KPI du jour (top)** :
- Carte unique compacte : `Collectes du jour : {total}` / `{a_attribuer}` / `{attribuees_en_attente}` / `{acceptees}` / `{en_cours}` / `{terminees}`
- Pas de KPI J-7 rolling, pas de taux acceptation par prestataire — exports M11 si besoin

**Zone 2 — Collectes à attribuer (liste pleine largeur)** :
- Tableau pleine largeur affichant toutes les collectes `statut_dispatch IN ('a_attribuer','rejetee_par_prestataire')` du jour J et J+1
- Tri par défaut : `heure_collecte` croissante
- Colonnes : Heure de collecte / Lieu / Traiteur / Type (ZD/AG badge) / Pax / Statut / Suggestion M12 (prestataire + branche R1) / Actions
- Couleur ligne : rouge si `heure_collecte` < 2h, orange si 2-4h, normale sinon
- Clic ligne : ouvre drawer E3
- Bouton "Attribuer" en bout de ligne : ouvre modal E4 directement

**Actions header** :
- Recherche globale (collecte ID, lieu, traiteur)
- Bouton "Nouvelle collecte manuelle" (fallback Plateforme down, Admin TMS uniquement, cf. Edge case 7.3)
- Lien "Exutoires" → /exutoires (M10 E2)
- Lien "Alertes" → cloche header M11

---

### E2 — Vue mois

**Décision Val 2026-04-29 (revue sobriété)** : fusion ex-E2 (vue jour) + ex-E3 (vue semaine) en une seule vue mois. 1 ligne par collecte. Suppression de la zone géo (pas de filtre département V1, pas de colonne zone).

**Layout** : 2 colonnes.

**Colonne gauche (25%)** — Filtres persistants :
- Mois (date picker, défaut = mois courant)
- Type : toutes / ZD / AG (toggle)
- Statut dispatch : toutes / `a_attribuer` / `attribuee_en_attente_acceptation` / `acceptee` / `en_attente_execution` / `rejetee_par_prestataire` / `annulee_par_traiteur` / `rejetee_par_tms`
- Statut opérationnel : toutes / `planifiee` / `en_cours` / `realisee` / `incident`
- Prestataire : multi-select depuis `prestataires` actifs
- Filtre "Mes anomalies" : refusées + `heure_collecte` < 2h non attribuées

**Décision Val 2026-04-23 (arbitrage 8)** : filtres persistés par Ops dans `users_tms.preferences_json` namespace `dispatch.filters.v1`. Reset possible via bouton "Réinitialiser".

**Colonne droite (75%)** — Liste collectes :
- Tableau virtualisé (pagination infinite scroll, 50 lignes initiales, +50 au scroll)
- Tri par défaut : `heure_collecte` croissante
- Colonnes : Date / Heure de collecte / Lieu / Traiteur / Type (ZD/AG badge) / Pax / Statut dispatch / Statut op / Prestataire / Actions
- Couleur ligne :
  - Rouge : `heure_collecte` < 2h non attribuée
  - Orange : `heure_collecte` < 4h et statut `a_attribuer`
  - Vert pâle : `acceptee` ou statut op actif
  - Grise : `annulee_par_traiteur`, `terminee`
- Hover : highlight + prévisualisation rapide (tooltip avec chauffeur si assigné, horodatage, lien plaque)
- Clic : ouvre drawer E3
- Pas de bulk actions V1 (suppression revue sobriété 2026-04-29) — réattribution unitaire au cas par cas
- Export CSV (debug / audit) — bouton individuel hors sélection

---

### E3 — Drawer détail collecte

**Layout** : panneau latéral droit, 480px largeur, scrollable.

**Sections** :

1. **Header** : ID collecte (copy-clipboard), badge type ZD/AG, statut dispatch, statut op
2. **Contexte événement** (read-only, source Plateforme) : événement, date, `heure_collecte`, nb_pax, lieu (adresse + accès), traiteur, contact client, commentaire événement, **nb rolls suggérés** (ZD uniquement, calcul auto M09 R4.4 par paliers pax — affichage lecture seule au moment du dispatch, pas d'override Ops, propagation revue sobriété M05 2026-04-29)
3. **Suggestion attribution** (M12) : prestataire proposé + branche R1 appliquée (ex: "R1.2 branche 1 — Vélo A Toutes! — pax 450 < 600 et heure de collecte à H+3h30")
4. **Attribution** :
   - Si `a_attribuer` : bouton primaire "Attribuer" (ouvre E4)
   - Si `attribuee_en_attente_acceptation` : nom prestataire + bouton "Réattribuer" (secondaire)
   - Si `acceptee` / `en_attente_execution` : nom prestataire + chauffeur + véhicule + plaque (si saisie)
   - Si `rejetee_par_prestataire` : prestataire + motif refus (saisi par manager côté M03) + bouton "Réattribuer"
5. **Tournée(s) associée(s)** (si existe) : **liste** des tournées rattachées à la collecte (via `collecte_tournees`) + lien M04 par tournée + autres collectes de chaque tournée. **Bouton "+ Ajouter un véhicule"** *(multi-camions 2026-05-25, arbitrage 3b ; généralisé vélo AG 2026-05-29 — libellé contextuel « camion » ZD/AG camion, « vélo » AG vélo selon `type_tournee`)* : crée une tournée sœur (même prestataire) pré-remplie avec cette collecte et ouvre M04 E1 ; réutilisable autant de fois que nécessaire (N véhicules, types différents possibles en ZD). Cas usage : grosse collecte ZD (ex. 3000 pax) servie par plusieurs camions ; **collecte AG dont le volume de repas dépasse la capacité d'un vélo cargo A Toutes! → N vélos** (cf. M04 E1bis / D8bis, V2).
6. **Bouton "Synchroniser snapshot pour cette collecte"** *(override ponctuel — sobriété M01 A_M01_05 2026-04-30)* : visible si alerte `m02_lieu_snapshot_divergent` active. Action **par collecte uniquement** (pas de sync batch lieu→toutes futures, retiré V1). Confirmation modale + audit `SNAPSHOT_SYNC`
7. **Historique** : audit log filtré sur cette collecte (acteur, action, timestamp, diff) — lecture des `audit_logs` génériques (pas d'enrichissement motif override)
8. **Actions secondaires** : Annuler collecte, Marquer en incident (→ M11), Copier lien Plateforme (Admin Savr)

**Transitions drawer** :
- Fermeture : Esc, clic outside, bouton X
- Refresh : polling 30s (revue sobriété 2026-04-29 — ex-Realtime Supabase). Cohérent §11 dashboards refresh patterns.

---

### E4 — Modal attribution

**Contexte** : ouvert depuis E3 (mono-collecte uniquement — bulk supprimé V1).

**Layout** : modal centré, 640px.

**Sections** :
1. **Résumé collecte** : récap complet (`heure_collecte`, lieu, traiteur, type, pax)
2. **Suggestion prestataire** (M12) :
   - Prestataire n°1 (recommandé) : nom + branche R1 + raison + bouton "Choisir"
   - Prestataire n°2 (alternative) : si branche R1 branche 2 ou backup, affiché
   - Override manuel : select depuis référentiel `prestataires` actifs + toggle "Inclure province"
   - Au clic "Attribuer" : INSERT `suggestions_attribution_log` (suggestion calculée + branche R1) sans enrichissement override (revue sobriété 2026-04-29)
3. **Confirmation** :
   - Si prestataire self-service (Strike, Marathon, A Toutes!) : bouton primaire "Attribuer" → statut `attribuee_en_attente_acceptation`, en attente d'acceptation. **Acceptation selon le prestataire** : Strike/Marathon → manager clique "Accepter" dans le portail M03 → `acceptee` + webhook S1. **A Toutes! (Everest, pas de portail M03)** → l'acceptation est dérivée du webhook Everest `mission_dispatched` (assignation coursier) qui mute `acceptee` + émet S1 (M14 W2 / R_M14.1bis, arbitrage Val 2026-05-29) ; en cas d'Everest down, failover Ops manuel (M14 W4).
   - Si prestataire province : bouton primaire "Confirmer manuellement" → redirige vers E5 (formulaire province)

---

### E5 — Formulaire province (confirmation manuelle)

**Contexte** : déclenché depuis E4 quand Ops a contacté un prestataire province hors TMS et veut enregistrer l'accord.

**Décision Val 2026-04-23 (arbitrage 6 — hybride C)** :
- Sélection prioritaire depuis référentiel
- Bouton "Créer nouveau" en fallback
- Validation doublons par `(nom normalisé, téléphone E.164)` sur `chauffeurs` + `vehicules.plaque` + `prestataires.nom`

**Layout** : page dédiée, tunnel en 3 étapes avec stepper visible.

**Étape 1 — Prestataire** :
- Select from `prestataires` WHERE `type = 'province'` AND `statut = 'actif'` AND `deleted_at IS NULL`
- Champ recherche par nom ou SIRET
- Lien "Créer un nouveau prestataire province" → ouvre M06 en modal, retour automatique. La création est faite **directement par l'Ops** via `tms.fn_create_prestataire_province(...)` (`SECURITY DEFINER`, pose `type='province'`/`statut='actif'`, valide doublon SIRET puis `(nom_normalisé, ville)`) — pas de validation Admin préalable (QO#5 tranché 2026-06-05).

**Étape 2 — Chauffeur** :
- Select from `chauffeurs` WHERE `prestataire_id = {choisi}` AND `statut = 'actif'`
- Champs chauffeur existant affichés en readonly (nom, téléphone, langue, permis valide)
- Bouton "Créer nouveau chauffeur" → form inline (nom, prénom, téléphone E.164, langue, pièce id upload optionnel, permis upload optionnel — permis requis V1 ou V1.1 à trancher)
- Validation doublon : si `nom normalisé + téléphone` existe déjà dans la base TMS (tous prestataires) → alerte modale "Ce chauffeur existe chez {prestataire_x}. Réutiliser ou créer un doublon ?" (choix explicite Ops)

**Étape 3 — Véhicule + équipier (optionnel)** :
- Select from `vehicules` WHERE `prestataire_id = {choisi}`
- Affichage **catégorie Plateforme du véhicule** *(ajout 2026-05-08)* à côté du libellé : badge `velo_cargo` / `camionnette` / `fourgon` / `vul` / `poids_lourd` (lookup sur `types_vehicules.categorie_plateforme`).
- **Alerte UI compatibilité véhicule ↔ lieu** *(ajout 2026-05-08)* : si le rang `categorie_plateforme` du véhicule sélectionné > rang `lieux.type_vehicule_max` du lieu de la collecte → bandeau warning rouge "⚠ Véhicule incompatible — ce lieu accepte au maximum un [type_vehicule_max]. La validation tournée sera bloquée (R_M04.COMPATIBILITE_VEHICULE_LIEU)." Bloque le bouton "Confirmer l'attribution province" tant qu'un véhicule compatible n'est pas sélectionné.
- Bouton "Créer nouveau véhicule" → form (type_vehicule, plaque avec validation regex FR `^[A-Z]{2}-\d{3}-[A-Z]{2}$` ou libre si `plaque_etranger=true`, volume m³, tonnage). Si création nouveau type véhicule (sous-modale) → champ `categorie_plateforme` required (cf. M03 E8).
- Équipier : même logique que chauffeur, section optionnelle collapsible

**Validation finale** :
- Tous champs requis remplis
- **Compatibilité véhicule ↔ lieu validée** *(ajout 2026-05-08, R_M04.COMPATIBILITE_VEHICULE_LIEU)*
- Bouton primaire "Confirmer l'attribution province"
- Effet : création/lecture entités TMS, insertion `tournees` statut `acceptee`, statut collecte `en_attente_execution`, webhook S1 `tms/collecte-acceptee` push Plateforme, audit log complet. Le trigger `trg_validate_tournee_compat_vehicule_lieu` confirme la compatibilité côté DB (double check post-UI).

**Champs optionnels V1** (peuvent rester vides) :
- Véhicule équipier (sans impact facturation Strike/Marathon)
- Upload docs chauffeur (obligation Registre transport à confirmer §15)

---

### E6 — Vue carte du jour

**Décision Val 2026-06-03 (révise D2 — carte V1)** : la vue carte était reportée V2 (D2, revue sobriété 2026-04-29) au motif du coût de géocodage. Or les coordonnées GPS sont **déjà fournies par la Plateforme** dans le payload E1 et figées sur `collectes_tms.lieu_adresse` (`{rue, code_postal, ville, lat, lng}`) — **aucun géocodage à faire côté TMS**. La carte ne fait que rendre des pins. Valeur : lecture visuelle de la répartition géographique des collectes du jour pour décider des mutualisations de tournée (collectes proches → même camion).

**Contexte** : onglet header dédié, à côté de E1/E2. Pas la vue par défaut (E1 reste le poste de commandement).

**Layout** : carte plein écran + panneau latéral repliable (filtres + liste synchronisée).

- **Fond de carte** : MapLibre GL JS + tuiles OpenStreetMap (ou MapTiler) — cf. §07. Pas de service de routing V1 (le calcul d'itinéraire/optimisation de tournée TSP reste V2).
- **Pins** : une épingle par collecte du jour J (et J+1 optionnel via toggle), positionnée sur `lieu_adresse.lat/lng`.
  - Couleur du pin par `statut_dispatch` : rouge `a_attribuer`/`rejetee_par_prestataire`, orange `attribuee_en_attente_acceptation`, vert `acceptee`/`en_attente_execution`, gris `annulee_par_traiteur`.
  - Badge type ZD/AG sur le pin.
  - Clustering automatique des pins proches au dézoom (densité Paris intra).
- **Collecte sans coords** (`coords_manquantes = true`) : non affichable sur la carte → listée dans un encart "N collectes sans coordonnées" en bas du panneau latéral (clic → drawer E3 pour traitement manuel). **Limite V1 connue** : le payload E1 ne porte les coords que pour les collectes **ZD en IDF** ; les collectes **AG** et **hors-IDF** arrivent sans coords (`coords_manquantes=true`, cf. §08 E1) → elles tomberont systématiquement dans cet encart. La carte E6 est donc en V1 surtout un outil de mutualisation ZD-IDF. (Géocodage des AG/hors-IDF = chantier V2, hors scope.)
- **Filtres** (panneau latéral) : jour (J / J+1), type ZD/AG, statut dispatch, prestataire — réutilisent les mêmes préférences que E2 (`users_tms.preferences_json` namespace `dispatch.filters.v1`).
- **Interactions** :
  - Clic sur un pin → ouvre le drawer E3 (overlay latéral, même composant que E1/E2).
  - Survol pin → tooltip (heure de collecte, lieu, traiteur, prestataire si attribué).
- **Refresh** : polling 30s (cohérent E1/E2/E3).

**Performance** : rendu < 1,5 s p95 pour le volume V1 (Paris + petite couronne, quelques dizaines de collectes/jour). Pas d'optimisation pour > 500 pins simultanés V1 (cap non atteint ; clustering suffit).

**Non-goals V1** : pas de tracé d'itinéraire, pas d'optimisation de tournée, pas de géofencing, pas de live position chauffeur (la géoloc chauffeur M05 reste sur l'app mobile, hors carte dispatch V1).

---

## 5. Workflows détaillés

### W1 — Attribution standard (self-service)

**Pré-condition** : collecte reçue via webhook E1 `POST /collectes` depuis Plateforme, statut `a_attribuer`.

1. Système : M12 calcule suggestion selon R1 (trigger T1, cf. [[M12 - Attribution transporteur]] §3) + stocke dans `collectes_tms.suggestion_prestataire_id`, `suggestion_branche_r1_code`, `suggestion_detail`, `suggestion_calculee_at` + INSERT `suggestions_attribution_log` (propagation M12 2026-04-24)
2. Dashboard E1 : collecte affichée dans Zone 2 "Collectes à attribuer", coloration selon `heure_collecte`
3. Ops ouvre collecte (E3 drawer) ou clique "Attribuer" directement en ligne
4. Ops clique "Attribuer" → E4 modal
5. Ops confirme suggestion ou override
6. Système (propagation A1 2026-04-25 — alignement enum statut_dispatch 6 valeurs) :
   - UPDATE `collectes_tms.statut_dispatch = 'attribuee_en_attente_acceptation'`, `prestataire_id`, `attribuee_par_user_id`, `attribuee_at`
   - INSERT `audit_logs` (table=`collectes_tms`, action=`ATTRIBUTION`, diff=`{before:..., after:...}`) — sans enrichissement motif override (revue sobriété 2026-04-29)
   - **Si `prestataire.integration_externe = 'everest'` (A Toutes!)** : trigger DB `trg_m14_push_mission` enqueue worker `m14_create_mission` (M14 W1, R_M14.1, propagation 2026-04-25). Push asynchrone non-bloquant pour transaction M02.
   - Notification email manager prestataire (M03) + push app si connecté
   - **Pour A Toutes! pas de notification M03** (utilisent Everest côté manager)
7. Prestataire reçoit notification, va sur M03, accepte/refuse
8. Webhook S1 `tms/collecte-acceptee` ou S2 `tms/collecte-refusee` push Plateforme

**Durée cible** : étape 3 à 6 < 10 secondes pour Ops expérimenté (1 clic attribuer + 1 clic confirmer suggestion).

### W2 — Attribution province (confirmation manuelle)

Pré-condition : collecte reçue + prestataire suggéré `type = 'province'`.

1. E4 modal : bouton "Confirmer manuellement" (pas "Attribuer")
2. Ops contacte prestataire hors TMS (email/téléphone) — hors scope système
3. Ops revient, clique "Confirmer manuellement" → redirigé vers E5
4. E5 tunnel 3 étapes (prestataire / chauffeur / véhicule)
5. Validation finale (propagation A1 2026-04-25) :
   - UPDATE `collectes_tms.statut_dispatch = 'en_attente_execution'` (skip `attribuee_en_attente_acceptation` et `acceptee` — confirmation manuelle Ops vaut acceptation directe + chauffeur/véhicule renseignés dans le tunnel E5)
   - INSERT `tournees` (`statut='acceptee'`, `prestataire_id`, `chauffeur_id`, `vehicule_id`)
   - INSERT `audit_logs`
   - Webhook S1 `tms/collecte-acceptee` push Plateforme

**Durée cible** : 1-2 minutes (la lenteur vient du call téléphonique prestataire, pas de l'UI).

### W3 — Refus prestataire (simple — revue sobriété 2026-04-29)

**Décision Val 2026-04-29 (revue sobriété)** : suppression de la branche hybride auto/manuel. Tout refus = retour `a_attribuer` direct, Ops réattribue manuellement via E1 ou E2. Suppression de l'escalation 3 refus consécutifs.

1. Manager prestataire clique "Refuser" dans M03, saisit motif (`motif_refus` text libre — cf. M03 §4)
2. Webhook S2 `tms/collecte-refusee` push Plateforme
3. Système TMS (propagation A1 2026-04-25) :
   - UPDATE `collectes_tms.statut_dispatch = 'rejetee_par_prestataire'`, `motif_refus`, `date_refus` (colonnes §04, alignées M03 §4). Le prestataire qui refuse reste `prestataire_id` courant jusqu'à réattribution (badge "Refusée par {prestataire}").
   - **Pas de table `collecte_refus_historique` V1 (QO#8 tranché 2026-06-05)** — l'historique des refus multiples sur une même collecte, et le KPI taux de refus par prestataire, sont dérivés de `audit_logs` (diff `prestataire_id` avant/après à chaque transition). Table dédiée reportée V1.1 si le KPI devient un besoin réel.
   - Statut retombe en `a_attribuer` après validation Ops dans drawer E3 (bouton "Réattribuer")
   - Affichage E1 Zone 2 (collectes à attribuer) avec badge "Refusée par {prestataire}"

### W4 — Annulation collecte côté Plateforme (ex-W6)

Pré-condition : événement annulé côté Plateforme, webhook E3 `DELETE /collectes/:id`.

1. TMS : UPDATE `collectes_tms.statut_dispatch = 'annulee_par_traiteur'`, `annulee_at` (revue sobriété 2026-04-29 — colonne `annulee_source` supprimée, 1 seule source d'annulation)
2. Si statut tournée `planifiee` ou `acceptee` : détacher la collecte de la tournée. Si la tournée devient vide → statut tournée `annulee`, no-bill (annulation avant démarrage = 0€ Strike/Marathon). Cf. §05 R2.7.
3. Si tournée `en_cours` : alerte Ops M11 `gravite=warning` "Annulation en cours de tournée" — règle R2.7 bis : vacation facturée intégralement, Ops tranche facturation client côté Plateforme
4. Notification email manager prestataire

### W5 — Override manuel Ops (ex-W7)

Ops ouvre E3, clique "Réattribuer" sur une collecte `statut_dispatch IN ('attribuee_en_attente_acceptation','acceptee','en_attente_execution')` (pas encore `statut_operationnel='en_cours'`) (propagation A1 2026-04-25).

1. Modale confirmation simple (sans motif — revue sobriété 2026-04-29)
2. Reset `statut_dispatch = a_attribuer`, ex-prestataire notifié email
3. Re-run M12 + retour en E4 standard

**Règle** : override impossible si `statut_operationnel IN ('en_cours', 'realisee', 'realisee_sans_collecte', 'incident')`. Affichage grisé + tooltip "Collecte démarrée, override bloqué".

### W6 — Alerte Ops acceptation sans réponse (nouveau — arbitrage Val 2026-06-03, révise D4)

**Décision Val 2026-06-03** : réintroduction d'une **alerte de supervision** (pas d'un SLA système avec escalade/auto-accept — la machinerie 3 paliers + cron + KPI supprimée en sobriété 2026-04-29 reste supprimée). Une collecte attribuée qui reste sans réponse du prestataire trop longtemps remonte en alerte Ops, sans bascule de statut automatique. Cf. §05 R1.4.

**Logique** (cron `cron_m02_alerte_acceptation`, fréquence 15 min) — pour chaque collecte `statut_dispatch = 'attribuee_en_attente_acceptation'` :
- `delai_ecoule = now() − attribuee_at`
- `proximite = heure_collecte − now()`
- seuil applicable :
  - si `proximite ≤ m02_alerte_acceptation_seuil_proximite_heures` (48h) → seuil = `m02_alerte_acceptation_delai_proche_heures` (3h)
  - sinon → seuil = `m02_alerte_acceptation_delai_lointaine_heures` (48h)
- si `delai_ecoule ≥ seuil` et aucune alerte `m02_acceptation_sans_reponse` active sur cette collecte → `tms.alerte_emit('m02_acceptation_sans_reponse', warning, collecte_id)`.

**Résolution** : auto-dismiss dès que la collecte sort de `attribuee_en_attente_acceptation` (acceptée S1, refusée S2, réattribuée W5, annulée W4). Debounce M11 5 min natif.

**Couverture A Toutes! (Everest)** : l'acceptation A Toutes! étant dérivée du webhook `mission_dispatched` (pas de portail M03), l'alerte s'applique à l'identique — pas de `mission_dispatched` dans le délai = alerte.

**Note** : les seuils (48h proximité / 48h lointaine / 3h proche) et la criticité sont paramétrables (`parametres_tms` namespace `m02` + catalogue M11). Calibrables à l'usage sans redéploiement.

> **Workflows supprimés (revue sobriété 2026-04-29)** :
> - W4 ex-Bulk attribution → manuel unitaire V1
> - W5 ex-Bulk réattribution → manuel unitaire V1 (cas annulation Strike/Marathon = Ops réattribue collecte par collecte)

---

## 6. Règles métier appliquées

| Ref | Règle | Application dans M02 |
|-----|-------|----------------------|
| §05 R1.1 | Attribution ZD → Strike par défaut | Suggestion auto E3/E4 pour toutes collectes ZD |
| §05 R1.2 | Attribution AG → branches vélo / Marathon / backup | Suggestion auto + branche R1 affichée textuellement dans E3/E4 |
| §05 R1.3 | Override toujours possible par Ops | Bouton "Override" dans E4 (sans motif requis V1) |
| §05 R1.3 | Audit log basique de chaque attribution | `audit_logs` INSERT systématique W1/W2/W5 (pas d'enrichissement motif override) |
| §05 R1.3 | Prestataire inactif non attribuable | Filtré dans select E4 et suggestions M12 |
| §05 R6.1 | Transitions statut dispatch | W1-W5 respectent strictement R6.1 |
| §05 R2.7 | Annulation avant démarrage = 0€ | W4 no-bill tournée vide |
| §08 E1 | Webhook réception collecte | Déclenche apparition collecte en E1/E2 |
| §08 S1/S2 | Webhook acceptation/refus vers Plateforme | W1 étape 8, W3 étape 2 |
| §08 S3 | Webhook tournée-upsert | Déclenché indirect via M04 (pas M02) |
| §09 | RLS `ops_savr` et `admin_tms` | `USING (true)` sur `collectes_tms`, `tournees`, `prestataires` |

---

## 7. Edge cases

### 7.1 — Réseau coupé côté Ops pendant une attribution
- Optimistic UI : attribution affichée comme "en cours" localement
- Retry automatique 3 fois (intervalle 2s / 5s / 10s)
- Échec final : toast "Attribution non enregistrée, réessayer", collecte reste `a_attribuer`
- **Pas** de double attribution possible grâce à `idempotency_key` UUID côté client

### 7.2 — Conflit concurrence 2 Ops simultanés
**Décision Val 2026-04-29 (revue sobriété)** : last-write-wins assumé. Suppression de la colonne `version` lock optimiste et du toast "Collecte déjà modifiée". Si 2 Ops attribuent en parallèle, dernier l'emporte. Cas rare avec 2-3 Ops qui se parlent (Slack/téléphone).

### 7.3 — Fallback Plateforme down (webhook E1 silencieux)
- Le retry 3 paliers (5 min / 1h / 24h, §08 B1) + la dédup `integrations_inbox` couvrent 99,99 % des pannes transitoires. **Le polling E6/S10 a été supprimé** (§08 A4 2026-05-01) — ne plus le référencer.
- Plateforme indisponible de façon prolongée → alerte M11 `critical` + intervention manuelle.
- **Pire cas (collecte urgente pendant la panne) : collecte manuelle V1** créée par l'Admin TMS via le bouton "Nouvelle collecte manuelle" du header E1 (réservé Admin TMS pour limiter les dérapages). Spec figée ci-dessous (QO#6 tranché 2026-04-23 = Admin TMS uniquement ; formulaire figé 2026-06-05, arbitrage Val).

**Formulaire "Nouvelle collecte manuelle" (V1 minimal — Admin TMS)** :
- Comme les 2 apps partagent un seul projet Supabase (schémas `plateforme.*` + `tms.*`), les référentiels lieu/traiteur restent lisibles même si le **front/webhook** Plateforme est down. Champs :
  - **Lieu** : select sur `plateforme.lieux` (lecture cross-schema) → renseigne `plateforme_lieu_id`, `lieu_adresse`, `lieu_snapshot`.
  - **Traiteur opérationnel** : select sur `plateforme.organisations` → `plateforme_traiteur_id`, `traiteur_nom`. Programmateur = traiteur par défaut (`plateforme_programmateur_id`, `programmateur_nom`, `programmateur_type`).
  - **`heure_collecte`** (timestamptz, validation R_M01.X : pas dans le passé), **`parcours`** (ZD/AG), **`nb_pax`**.
  - **`contact_principal_nom` + `contact_principal_telephone`** (requis), contact secours optionnel.
  - `informations_supplementaires` (optionnel).
- **Effet** : INSERT `collectes_tms` avec `statut_dispatch='a_attribuer'`, **`origine='manuelle_tms'`** et **`plateforme_collecte_id=NULL` / `plateforme_evenement_id=NULL`** (la collecte n'existe pas côté Plateforme, le front était down). M12 calcule la suggestion, le dispatch suit le flux normal.
- **Réconciliation M13** : quand la Plateforme revient et émet le webhook E1 pour cette collecte, la dédup `event_id` ne matche pas (pas de Plateforme id sur la collecte manuelle) → 2 lignes. L'écran M13 "Collectes orphelines à réconcilier" (QO#10) suggère le match `(plateforme_lieu_id, heure_collecte ±30 min, plateforme_traiteur_id, nb_pax ±10%)` ; l'Admin fusionne (la collecte manuelle reçoit `plateforme_collecte_id`/`plateforme_evenement_id`, la ligne webhook en doublon est rejetée DLQ).

### 7.4 — Webhook M03 prestataire en échec (prestataire n'a pas reçu la notif)
- Retry standard **3 paliers : 5min / 1h / 24h** (§08, simplifié revue sobriété Bloc B 2026-05-01 B1 — ex-5 paliers)
- Si tous retries échouent → alerte M11 `gravite=critical`, collecte status reste `attribuee_en_attente_acceptation` avec flag `notification_prestataire_failed=true`
- Ops peut forcer retry manuel depuis E3 "Relancer prestataire"

### 7.5 — Collecte avec `heure_collecte` < 2h
- Coloration ligne rouge dans E1 Zone 2 + E2 liste
- Email manager prestataire flaggé `urgent=true`
- Retour Ops manuel immédiat si refus (pas d'auto-relance — revue sobriété 2026-04-29)

### 7.6 — Prestataire province non référencé
- E5 tunnel permet création à la volée via bouton "Nouveau prestataire province"
- Création **directe par l'Ops** via `tms.fn_create_prestataire_province(...)` (`SECURITY DEFINER`) — mini-wizard M06 (nom, SIRET, contact, zone couverte), pas de validation Admin préalable (QO#5 tranché 2026-06-05)
- Validation doublon par SIRET puis par `(nom_normalisé, ville)` (intégrée à la fonction)

### 7.7 — Everest down (A Toutes! indisponible)
- `parametres_tms.toutes_disponibilite_statut` = `indisponible` (toggle manuel Ops V1, API Everest V2)
- Suggestion M12 skip A Toutes! branche 1/2 backup, bascule Marathon
- Bandeau E1 warning "A Toutes! indisponible — report Marathon auto"

### 7.8 — Collecte de dernière minute créée hors horaires ouvrés (nuit/weekend)
- Email immédiat à Ops (revue sobriété 2026-04-29 — push navigateur supprimé)
- Si personne n'est connecté depuis 10 min → email Admin TMS
- Si > 30 min sans action → email Admin TMS prioritaire (SMS reporté V2)

### 7.9 — Plaque saisie invalide en E5
- Validation regex FR `^[A-Z]{2}-\d{3}-[A-Z]{2}$` par défaut
- Toggle "Plaque étrangère" désactive regex (libre, max 15 car, uppercased auto)
- Soft warning si plaque déjà utilisée sur un autre véhicule (doublon = alerte mais non-bloquant)

> **Edge cases supprimés (revue sobriété 2026-04-29)** :
> - Ex-7.5 SLA dépassé → cron + alertes M11 SLA supprimés. Suivi manuel Ops via E1 Zone 2 (refus en attente de réattribution).

---

## 8. États et transitions

### Statut dispatch collecte (cf. §05 R6.1)

```
a_attribuer                       → attribuee_en_attente_acceptation  [W1 étape 6]
                                  → en_attente_execution              [W2 étape 5 — province direct]
                                  → annulee_par_traiteur              [W4]
attribuee_en_attente_acceptation  → acceptee                          [W1 étape 8 — webhook S1]
                                  → rejetee_par_prestataire           [W3 étape 3 — webhook S2]
                                  → a_attribuer                       [W5 — override Ops]
                                  → annulee_par_traiteur              [W4]
rejetee_par_prestataire           → a_attribuer                       [W3 — manuel Ops via E3]
acceptee                          → en_attente_execution              [transition M04]
                                  → a_attribuer                       [W5 — override Ops, si pas en_cours]
                                  → annulee_par_traiteur              [W4]
en_attente_execution              → annulee_par_traiteur              [W4 — avec impact tournée selon R2.7]
```

### Permissions de transition par rôle

| Transition | Ops Savr | Admin TMS | Manager prestataire |
|------------|----------|-----------|---------------------|
| `a_attribuer → attribuee_en_attente_acceptation` | Oui (M02) | Oui | Non |
| `attribuee_en_attente_acceptation → acceptee` | Oui (W2) | Oui | Oui (M03) |
| `attribuee_en_attente_acceptation → rejetee_par_prestataire` | Non | Oui (force) | Oui (M03) |
| `attribuee_en_attente_acceptation → a_attribuer` (override) | Oui (W5) | Oui | Non |
| `rejetee_par_prestataire → a_attribuer` | Oui (W3 manuel) | Oui | Non |
| `acceptee → a_attribuer` (override) | Oui (si pas en_cours) | Oui | Non |
| `X → annulee_par_traiteur` | Oui | Oui | Non (demande via incident) |

Toute transition non listée → bloquée applicativement + trigger Postgres anti-escalade (cf. §09).

---

## 9. Notifications

### Côté Ops Savr

**Décision Val 2026-04-29 (revue sobriété)** : email seul. Suppression de toast in-app + push navigateur pour les nouvelles collectes (toast visible uniquement pour les actions en cours type attribution). Pas de SLA → pas d'alerte SLA. Pas d'escalation 3 refus.

| Trigger | Canal | Condition | Template |
|---------|-------|-----------|----------|
| Nouvelle collecte reçue (E1 webhook) | Email | 100% des collectes | `dispatch_new_collecte` |
| Refus prestataire | Email | Toujours | `dispatch_refus` |
| Aucun prestataire dispo | Email | Priorité critical | `dispatch_no_provider` |
| Webhook prestataire en échec après retries | Email | 7.4 | `dispatch_notification_failed` |

**Évolution V1.1 si volume excessif** : possibilité de basculer en digest toutes les 15 min via `users_tms.preferences.dispatch.notifications.batch = true`. Décision non activée V1, à rejuger après 2 mois d'exploitation.

### Côté manager prestataire (hors M02 mais déclenché par M02)

| Trigger | Canal | Template |
|---------|-------|----------|
| Attribution collecte | Email + push app M03 si connecté | `prestataire_attribution` |
| Attribution urgente (`heure_collecte` < 4h) | Email + push + flag `urgent=true` | `prestataire_attribution_urgent` |
| Réattribution (vos collectes perdues) | Email | `prestataire_reattribution` |

### Côté Admin TMS

| Trigger | Canal | Condition |
|---------|-------|-----------|
| Ops inactif + collecte urgente | Email | 7.8 |

---

## 10. Performance cibles

| Métrique | Cible V1 | Méthode |
|----------|----------|---------|
| Temps chargement dashboard E1 (collectes du jour) | < 1.5 s p95 | Supabase query optimisée + index partiel `WHERE statut_dispatch IN ('a_attribuer','rejetee_par_prestataire')` |
| Temps chargement E2 vue mois | < 2 s p95 | Cursor-based pagination sur `heure_collecte, id` + index partiel mois courant (renommage propagation 2026-04-29) |
| Temps chargement E3 drawer | < 300 ms p95 | Fetch depuis cache si collecte déjà en E1/E2, sinon 1 query JOIN |
| Temps action attribution (W1 étapes 3→6) | < 800 ms p95 | UPDATE + webhook en transaction, audit log async |
| Pagination infinite scroll E2 | < 200 ms par page | Cursor-based pagination |
| Refresh drawer | Polling 30s | (revue sobriété 2026-04-29 — ex-Realtime) |

**Décision non-goal V1** :
- Pas d'optimisation pour > 5000 collectes actives simultanées (cap V1 non atteint).
- Pas de mode offline (desktop, connexion fiable attendue).
- Pas de Realtime drawer (polling 30s suffisant — revue sobriété 2026-04-29).

---

## 11. Décisions structurantes prises

| # | Décision | Alternative écartée | Raison |
|---|----------|---------------------|--------|
| D1 | Vue par défaut au login = E1 dashboard avec liste à attribuer | E2 vue mois directe | Ops attaque les collectes urgentes en haut de pile |
| D2 | → **Carte V1 (E6), révisé 2026-06-03** | Reporter V2 | **Révisé arbitrage Val 2026-06-03** : la raison du report (coût géocodage) ne tient plus — les coords GPS sont déjà fournies par la Plateforme (`collectes_tms.lieu_adresse.lat/lng`, payload E1) et figées sur la collecte. La carte ne fait que rendre des pins (MapLibre + tuiles OSM, cf. §07). Pas de routing/optimisation (ça, ça reste V2). Valeur : lecture visuelle pour mutualiser les tournées. |
| D3 | Refus prestataire = retour `a_attribuer` direct (manuel Ops) | Auto-relance hybride 4h / Auto pur | Revue sobriété 2026-04-29 — code complexe (test fenêtre, exclusion presta, audit AUTO_RELANCE) pour un cas géré simplement à la main |
| D4 | → **Alerte Ops de supervision V1 (W6), révisé 2026-06-03** | SLA 3 paliers + escalade auto + auto-accept | **Révisé arbitrage Val 2026-06-03** : on ne réintroduit PAS le SLA système (escalade auto, auto-accept, KPI — restent supprimés). On ajoute uniquement une **alerte warning** quand une collecte attribuée reste sans réponse au-delà d'un seuil paramétrable (48h si collecte lointaine > 48h, 3h si proche ≤ 48h). Pas de bascule de statut auto. Cf. W6 + §05 R1.4. |
| D5 | Concurrence multi-Ops = last-write-wins | Lock optimiste / Lock explicite | Revue sobriété 2026-04-29 — 2-3 Ops qui se parlent, conflit rare, simplicité gagne |
| D6 | Province = hybride sélection référentiel ou création à la volée | Tout à la volée / Tout référencé | Zéro doublon sur récurrents, zéro friction onboarding |
| D7 | Pas de bulk V1 (attribution + réattribution unitaires) | Bulk attribution / réattribution | Revue sobriété 2026-04-29 — couvre 10% des cas, validation "même branche R1" complexe, manuel acceptable V1 |
| D8 | Filtres Ops persistés dans `users_tms.preferences_json` namespace `dispatch.filters.v1` | Session-only | UX 6h du matin, coût dev négligeable |
| D9 | Notifications Ops = email seul | Toast + email + push | Revue sobriété 2026-04-29 — Web Push complexe (Service Worker, permissions), email suffit pour usage 6h-20h connecté |
| D10 | Vue mois unique (E2) | E2 jour + E3 semaine séparées | Revue sobriété 2026-04-29 — 1 écran couvre les 2 besoins (date picker mois) |
| D11 | Drawer refresh polling 30s | Realtime Supabase | Revue sobriété 2026-04-29 — cohérent §11 dashboards refresh patterns, latence 30s acceptable mono-Ops |
| D12 | Pas d'override snapshot ponctuel | Bouton "Éditer snapshot pour cette collecte uniquement" | Revue sobriété 2026-04-29 — cas tordu, gérable hors plateforme |

---

## 12. Questions ouvertes

1. — **Tranché 2026-04-29** : SLA dispatch (escalade auto + auto-accept + KPI) supprimé V1 (revue sobriété). **Mis à jour 2026-06-03 (arbitrage Val)** : une **alerte Ops de supervision** simple est réintroduite (W6, §05 R1.4) — collecte sans réponse au-delà de 48h (collecte lointaine) ou 3h (collecte ≤ 48h) → alerte warning `m02_acceptation_sans_reponse`. Seuils paramétrables `parametres_tms` namespace `m02`. Pas de bascule de statut auto (ce n'est pas un SLA système).
2. — **Tranché 2026-04-23 : V1.1**. V1 = simple warning visuel "permis manquant" non bloquant.
3. — **Tranché 2026-04-23 : V2**. V1 = email Admin TMS uniquement.
4. — **Reporté V1.1** post-mesure exploitation 2 mois.
5. — **Tranché 2026-06-05 (arbitrage Val) : Ops Savr crée directement via fonction `SECURITY DEFINER`**. Le bouton "Créer un nouveau prestataire province" (E5 / 7.6) appelle `tms.fn_create_prestataire_province(...)` qui insère un `shared.prestataires` `type='province'`, `statut='actif'` **sans** ouvrir de GRANT large à `ops_savr` sur les colonnes opérationnelles (la RLS §09 garde le deny direct sur ces colonnes). Friction zéro au dispatch 6h. Garde-fou intégré à la fonction : validation doublon `SIRET` puis `(nom_normalisé, ville)`. Admin TMS supervise/corrige a posteriori. Cf. §09 (définition fonction) + M06.
6. — **Tranché 2026-04-23 : Admin TMS uniquement**.
7. — **Tranché 2026-04-29 (revue sobriété)** : pas de filtre zone géo V1 (pas de découpage administratif/département). Référentiel `zones_geo` retiré de M02 (peut rester en data model si M04/M12 l'utilisent). **Précision 2026-06-03** : l'ajout de la carte E6 (pins GPS) ne réintroduit PAS de filtre zone géo — ce sont deux choses distinctes (la carte affiche des positions, elle ne filtre pas par zone administrative).
8. — **Tranché 2026-06-05 (arbitrage Val) : colonne simple V1**. Pas de table dédiée ni de `jsonb` V1. `collectes_tms.motif_refus` (text) + `date_refus` portent le dernier refus (W3); l'historique des refus multiples et le KPI taux de refus par prestataire sont dérivés de `audit_logs` (diff `prestataire_id` avant/après). Table `collecte_refus_historique` reportée V1.1 si le KPI est confirmé.
9. — **Reporté V1.1**.
10. — **Tranché 2026-04-23** : UI M13 "Collectes orphelines à réconcilier" + suggestion auto match `(lieu_id, heure_collecte ±30min, traiteur_id, nb_pax ±10%)` (propagation 2026-04-29).

---

## 12bis. Alertes M11 émises par M02 (propagation M11 2026-04-24)

> **Normatif (R_M11.1)** : tous les triggers M02 utilisent `tms.alerte_emit(code, ...)` avec codes canoniques catalogue.

| Code canonique | Criticité | Trigger M02 |
|----------------|-----------|-------------|
| `m02_lieu_snapshot_divergent` | warning | PATCH E5 `/lieux/:id` reçu pour lieu d'une collecte en cours |
| `m02_notification_prestataire_failed` | critical | Échec notification prestataire après retries, collecte reste `attribuee_en_attente_acceptation` |
| `m02_collectes_orphelines_polling` | info | Collectes manquées rattrapées via polling |
| `m02_annulation_en_cours_tournee` | warning | Annulation reçue alors que statut tournée = `en_cours` (R2.7 bis) |
| `m02_acceptation_sans_reponse` | warning | Collecte `attribuee_en_attente_acceptation` sans réponse > seuil (48h lointaine / 3h proche). Cron `cron_m02_alerte_acceptation` 15 min, W6, §05 R1.4 *(nouveau 2026-06-03, révise D4)* |

> **Codes supprimés (revue sobriété 2026-04-29)** :
> - `m03_sla_acceptation_expire` (SLA dispatch supprimé)
> - Alerte 3 refus consécutifs (escalation supprimée — Ops gère via Zone 2)

---

## 13. Liens

- Vue macro : [[../03 - Périmètre fonctionnel TMS#M02 — Dispatch Ops Savr]]
- Data Model : [[../04 - Data Model TMS]] — tables `collectes_tms`, `tournees`, `prestataires`, `chauffeurs`, `vehicules`, `audit_logs`, `users_tms`, `parametres_tms`
- Règles métier : [[../05 - Règles métier TMS#R1 — Attribution transporteur (M12)|R1]], [[../05 - Règles métier TMS#R6.1 — Cycle de vie collectes_tms|R6.1]], [[../05 - Règles métier TMS#R2.7 — Annulation avant démarrage|R2.7]]
- Contrat API : [[../08 - Contrat API Plateforme-TMS]] — E1, E3, E6, S1, S2
- Auth et permissions : [[../09 - Authentification et permissions TMS]] — rôles `ops_savr` / `admin_tms`, RLS `collectes_tms`
- Modules dépendants :
  - [[M01 - Réception ordres de collecte]] (en amont — arrivée webhook)
  - [[M03 - Portail prestataire self-service]] (en aval — acceptation)
  - [[M04 - Gestion des tournées]] (parallèle — regroupement)
  - [[M06 - Référentiel prestataires]] (création à la volée province)
  - [[M11 - Alerting et monitoring ops]] (alertes critical / warning)
  - [[M12 - Attribution transporteur]] (suggestions M12 affichées)
- CDC Plateforme : [[../../01 - Cahier des charges App/08 - APIs et intégrations]] (contrat webhooks côté Plateforme)

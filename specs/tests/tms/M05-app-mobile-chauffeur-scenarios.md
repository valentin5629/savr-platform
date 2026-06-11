# Scénarios de test — M05 App mobile chauffeur (PWA offline-first)

**Source CDC** : §06/M05 (E1→E10, W1→W12) + §05 R_M05.1→R_M05.19 + R6.1/R6.2 (cycle de vie) + §04 tables `pesees`, `types_contenants`, `auth_sessions_tms`, `incidents`, `chauffeurs_geolocalisation` + §08 S3/S5/S9 + §09 RLS chauffeur
**Généré le** : 2026-06-06
**Statut** : À implémenter par Claude Code

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests du module M05.
> Pour chaque scénario :
>
> - Couche `db` → écrire un test pgTAP dans `supabase/tests/`
> - Couche `api` → écrire un test Vitest dans `packages/tms/tests/api/`
> - Couche `ui` → écrire un test Playwright dans `packages/tms/tests/e2e/` (PWA mobile-first ; offline simulé via Service Worker mock + IndexedDB)
>   Les tests P1-critique sont bloquants CI. Les tests P2 et P3 sont non-bloquants V1.
>   Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.
>
> **Conventions de données** : prestataires réels — Strike (ZD camion frigo motorisé), Marathon (AG camion frigo), A Toutes! (AG vélo cargo + camion backup, intégration Everest). Traiteurs : Kaspia, Kardamome. Chauffeurs : `chauffeur_strike_1`, `chauffeur_marathon_1`, `chauffeur_atoutes_velo_1`.
> **Auth** : email + password (argon2 Supabase), 8 car min, device binding 1 device actif chauffeur (index unique partiel `auth_sessions_tms`), session 30j rolling, rate limit 5 tentatives/15min/IP, reset via magic link 30 min, bootstrap sans password initial.
> **Cycle de vie collecte (statut_operationnel)** : `planifiee` → `en_route` → `arrivee` → `en_cours` → `realisee` / `realisee_sans_collecte` (AG-only) / `echec_acces` / `incident`. Multi-camions : collecte `realisee` **dérivée** quand toutes ses tournées sont `terminee` (R6.1).
> **Statut tournée (R6.2, 5 valeurs)** : `planifiee`, `acceptee`, `en_cours`, `terminee`, `annulee`.
> **Pesée** : `pesees.poids_brut_kg` numeric(7,2) saisie balance, `tare_kg` snapshot (`types_contenants.tare_kg × nb_contenants`, figé), `poids_net_kg` GENERATED `GREATEST(brut - tare, 0)`, `source` enum 2 valeurs (`chauffeur`, `ag_sans_collecte`), `idempotency_key` UUID unique. Min 0 / max 2000 kg, 1 décimale. Contenant `sans_contenant` → tare 0.
> **Webhooks sortants M05** : S3 `tournee-upsert`, S5 `collecte-terminee`, S9 `incident`. **S7 n'est PAS émis par M05** (émis par le manager M03 E4). Dédup serveur via `body.event_id` (pas de header `Idempotency-Key`). HMAC-SHA256 + `X-API-Version: 2026.04` autoritatif.
> **S9 incident** : enum `type_incident` **5 valeurs** (`acces_refuse`, `client_absent`, `probleme_tri`, `autre`, `client_annule_avant_arrivee` — décision 2026-06-06, `pas_excedents` retiré) ; `statut_collecte_apres` **4 valeurs** (`realisee`, `echec_acces`, `inchange`, `annulee`) ; `gravite` 2 valeurs (`warning`, `critical`). Le cas AG « aucun repas » passe par E5 → S5 (`realisee_sans_collecte`, `statut_final`), pas par S9.
> **Géofence** : 300 m (`m05_geofence_rayon_metres`). Fallback "J'arrive" immédiat → audit `M05_ARRIVEE_GEOLOC_FALLBACK`.
> **Équivalent repas** : `round(poids_total_kg / plateforme.parametres_algo.poids_par_repas_kg)`, défaut 0,45 (source unique cross-schema, pas de paramètre miroir TMS).
> **Checklist E3** : camion ZD motorisé = 3 items bloquants (Tenue Savr, N rolls, Film). Camion AG motorisé + vélo cargo = E3 sauté (E2 → E4 direct).

---

## Résumé de couverture

| Catégorie                       | Nb scénarios | Couverture estimée                                                                                                                                                          |
| ------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Happy path                   | 10           | E1 login, E2 accueil, E3 checklist ZD + skip AG/vélo, W4 géofence, E6 pesée auto-tare, E7 signature AG + repas, aucun repas AG, W8 clôture collecte, W9 clôture tournée GPS |
| 2. Cas limites métier           | 9            | géofence 300 m exact, poids 0/2000/décimale, `sans_contenant` 0 kg 2-clics, round repas 0,45, queue offline 80%/100%, rate limit 5, password 8 car                          |
| 3. Cas d'erreur métier          | 8            | checklist incomplète, poids <0 / >2000, override sans motif, clôture ZD sans pesée, clôture tournée prématurée, login échoué, contenant manquant tél                        |
| 4. Isolation données (RLS)      | 7            | cross-chauffeur, cross-prestataire, masquage coûts, horizon visibilité, device binding, geoloc, pesées                                                                      |
| 5. Idempotence / états          | 8            | dédup `event_id`, `realisee→en_cours` interdit, `annulee` terminal, edit pesée post-realisee, DLQ 5 retries, conflit serveur, dédup photo, multi-camions dérivé             |
| 6. Cross-app (TMS → Plateforme) | 7            | S5 payload + agrégation, S9 enum + statut_apres, S3 transitions, HMAC 401, X-API-Version 400, event_id rejoué, entité inconnue                                              |
| 7. Migration                    | 0            | **Hors scope M05** (cf. note ci-dessous)                                                                                                                                    |
| **TOTAL**                       | **49**       |                                                                                                                                                                             |

> **Note catégorie 7 (migration)** : M05 ne possède pas de check de réconciliation propre dans `04 - Migration/05 - Checks reconciliation.md`. Les chauffeurs, pesées et historiques migrés depuis MTS-1 sont des données d'amont (M06/M01) ; M05 ne fait que les consommer en runtime. Les scénarios de migration sont couverts par les modules sources. Aucun scénario migration M05 V1.

---

## Scénarios

### Catégorie 1 — Happy path (nominal)

```gherkin
# Source : §06/M05 E1 + §05 R_M05.19 + §09 auth chauffeur
# Couche : api
# Priorité : P1-critique

Scénario : login_chauffeur_email_password_valide
  Étant donné un chauffeur "chauffeur_strike_1" existant dans tms.chauffeurs avec un password défini (hash argon2)
  Et aucune session active sur aucun device
  Quand il appelle POST /auth/login avec son email et son password correct
  Alors la réponse est 200 avec un JWT de session
  Et une ligne auth_sessions_tms est créée avec son device_fingerprint et revoked_at NULL
  Et il est redirigé vers E2 (accueil)
```

```gherkin
# Source : §06/M05 E2 + W2
# Couche : api
# Priorité : P1-critique

Scénario : accueil_liste_tournees_horizon_7_jours
  Étant donné un chauffeur connecté "chauffeur_strike_1"
  Et 3 tournées assignées : une aujourd'hui (planifiee), une à J+3 (planifiee), une à J+10 (planifiee)
  Quand il appelle GET /api/chauffeur/tournees pour l'horizon J → J+7
  Alors la réponse contient les 2 tournées dans la fenêtre J → J+7
  Et la tournée J+10 est exclue
  Et les tournées sont triées par date croissante puis heure_planifiee_debut croissante
```

```gherkin
# Source : §06/M05 E3 + §05 R_M05.1 + W3
# Couche : ui
# Priorité : P1-critique

Scénario : checklist_zd_3_items_coches_active_demarrage
  Étant donné un chauffeur "chauffeur_strike_1" sur une tournée ZD planifiee avec un camion frigo motorisé
  Et l'écran E3 affichant 3 items (Tenue Savr, N rolls, Film plastique)
  Quand il coche les 3 items
  Alors le bouton "Démarrer tournée" devient actif
  Et au clic, tournees.statut passe à en_cours, heure_reelle_debut est renseigné
  Et le webhook S3 tournee-upsert (statut en_cours) est émis
```

```gherkin
# Source : §06/M05 E3 + §05 R_M05.1 (matrice véhicule)
# Couche : ui
# Priorité : P1-critique

Scénario : skip_checklist_velo_cargo_et_camion_ag
  Étant donné un chauffeur "chauffeur_atoutes_velo_1" sur une tournée AG avec un vélo cargo
  Quand il clique "Démarrer la tournée" depuis E2
  Alors l'écran E3 est entièrement sauté (transition directe E2 → E4)
  Et tournees.statut passe à en_cours sans validation de checklist
  Et le même comportement s'applique pour un camion AG motorisé
```

```gherkin
# Source : §06/M05 W4 + §05 R_M05.7
# Couche : ui
# Priorité : P1-critique

Scénario : geofence_entree_transition_auto_arrivee
  Étant donné un chauffeur en route vers une collecte (statut_operationnel = en_route)
  Et la position GPS entrant dans le rayon de 300 m autour de lieux.coords_gps
  Quand le geofence monitoring détecte l'entrée
  Alors statut_operationnel passe automatiquement à arrivee
  Et un toast "Tu es arrivé à <lieu>" est affiché
  Et aucun rollback n'a lieu si la position ressort ensuite du geofence
```

```gherkin
# Source : §06/M05 E6 + §05 R_M05.3 + §04 pesees
# Couche : db
# Priorité : P1-critique

Scénario : pesee_zd_auto_tare_calcul_net
  Étant donné une collecte ZD en_cours
  Et un contenant "bac_240L" de tare 14 kg dans types_contenants
  Quand le chauffeur saisit flux=biodechet, contenant=bac_240L (nb_contenants=1), poids_brut_kg=85.0
  Alors une ligne pesees est insérée avec tare_kg=14.00 (snapshot) et poids_net_kg=71.00 (GENERATED)
  Et source=chauffeur et idempotency_key est un UUID unique
```

```gherkin
# Source : §06/M05 E7 + §05 R_M05.6
# Couche : api
# Priorité : P1-critique

Scénario : signature_ag_capturee_avec_equivalent_repas
  Étant donné une collecte AG en_cours avec association_snapshot renseigné
  Et plateforme.parametres_algo.poids_par_repas_kg = 0.45
  Quand le chauffeur saisit poids_total_kg=20, signe sur le canvas, puis valide
  Alors l'équivalent repas affiché est round(20 / 0.45) = 44 repas
  Et la signature PNG est stockée dans le bucket tms-signatures
  Et le webhook S5 collecte-terminee est émis avec le poids agrégé
```

```gherkin
# Source : §06/M05 E5 + W6 (aucun repas) + mémoire AG vs ZD
# Couche : api
# Priorité : P1-critique

Scénario : ag_aucun_repas_a_collecter
  Étant donné une collecte AG en_cours
  Quand le chauffeur clique "Aucun repas à collecter" et sélectionne un motif obligatoire
  Alors statut_operationnel passe à realisee_sans_collecte
  Et une pesée est insérée avec source=ag_sans_collecte et poids 0
  Et le webhook S5 collecte-terminee est émis avec source=ag_sans_collecte
```

```gherkin
# Source : §06/M05 W8 + §05 R6.1
# Couche : api
# Priorité : P1-critique

Scénario : cloture_collecte_zd_avec_pesee
  Étant donné une collecte ZD en_cours avec au moins 1 pesée enregistrée
  Quand le chauffeur clique "Terminer collecte"
  Alors statut_operationnel passe à realisee, heure_fin_reelle est renseigné
  Et le webhook S5 collecte-terminee est émis en batch (pesees agrégées par flux)
  Et un audit log COLLECTE_REALISEE est créé
```

```gherkin
# Source : §06/M05 E8 + W9 + §05 R6.2
# Couche : api
# Priorité : P1-critique

Scénario : cloture_tournee_avec_capture_gps
  Étant donné une tournée en_cours dont toutes les collectes sont terminales
  Quand le chauffeur capture sa position GPS en E8 et confirme la fin de tournée
  Alors tournees.statut passe à terminee, cloture_gps est renseigné
  Et M04 W5 applique R2 (calcul coût) et le trigger fn_recalc_marge_tournee() est déclenché
  Et le webhook S3 tournee-upsert (statut terminee) est émis
```

### Catégorie 2 — Cas limites métier

```gherkin
# Source : §05 R_M05.7 (geofence 300m exact)
# Couche : api
# Priorité : P2-important

Scénario : geofence_distance_exactement_300m
  Étant donné une collecte en_route et lieux.coords_gps fixé
  Quand la position du chauffeur est à exactement 300 m du point lieu
  Alors la transition auto en_route → arrivee se déclenche (borne incluse, <= 300 m)
  Et à 301 m la transition ne se déclenche pas
```

```gherkin
# Source : §06/M05 E6 + §04 pesees (min 0 kg)
# Couche : db
# Priorité : P2-important

Scénario : pesee_poids_brut_zero_kg_sans_contenant
  Étant donné une collecte ZD en_cours
  Et un contenant "sans_contenant" de tare 0
  Quand le chauffeur saisit poids_brut_kg=0
  Alors une confirmation UI 2 clics est exigée avant l'INSERT
  Et après confirmation, poids_net_kg=0 (GREATEST(0-0,0))
  Et un audit log M05_PESEE_ZERO_KG est inséré
```

```gherkin
# Source : §06/M05 E6 (max 2000 kg)
# Couche : api
# Priorité : P2-important

Scénario : pesee_poids_brut_exactement_2000_kg
  Étant donné une collecte ZD en_cours
  Quand le chauffeur saisit poids_brut_kg=2000.0
  Alors la pesée est acceptée (borne haute incluse)
  Et à 2000.1 kg la saisie est rejetée avec message "Poids hors limites (max 2000 kg)"
```

```gherkin
# Source : §06/M05 E6 (1 décimale max)
# Couche : api
# Priorité : P3-nominal

Scénario : pesee_arrondi_une_decimale
  Étant donné une collecte ZD en_cours
  Quand le chauffeur saisit un poids_brut avec plus d'une décimale (ex 71.37)
  Alors la valeur est arrondie à 1 décimale côté TMS : round(71.37, 1) = 71.4
```

```gherkin
# Source : §05 R_M05.6 (équivalent repas borne)
# Couche : db
# Priorité : P3-nominal

Scénario : equivalent_repas_arrondi
  Étant donné poids_par_repas_kg = 0.45
  Quand le poids total collecté est 1 kg
  Alors nb_repas = round(1 / 0.45) = 2
  Et quand le poids total est 0.45 kg, nb_repas = 1
```

```gherkin
# Source : §05 R_M05.9 (queue offline cap)
# Couche : ui
# Priorité : P2-important

Scénario : queue_offline_avertissement_80_pct
  Étant donné une PWA hors-ligne accumulant des items en queue IndexedDB
  Quand la taille de la queue atteint 80% de la capacité (3 tournées / 150 photos / 300 Mo)
  Alors un avertissement est affiché au chauffeur
  Et la création de nouvelles données reste autorisée
```

```gherkin
# Source : §05 R_M05.9 + edge case C7
# Couche : ui
# Priorité : P2-important

Scénario : queue_offline_saturee_blocage_100_pct
  Étant donné une PWA hors-ligne avec une queue à 100% de la capacité
  Quand le chauffeur tente de créer une nouvelle pesée ou photo
  Alors le stockage est refusé avec toast "Queue pleine. Connecte-toi à un réseau."
  Et l'alerte M11 m05_queue_offline_saturee (warning) est émise au retour réseau
```

```gherkin
# Source : §09 + §12 m03_login_rate_limit_per_15min
# Couche : api
# Priorité : P2-important

Scénario : rate_limit_login_5_tentatives
  Étant donné un chauffeur tentant de se connecter avec un mauvais password
  Quand il échoue 5 fois en moins de 15 minutes depuis la même IP
  Alors la 6e tentative retourne 429 avec le délai d'attente affiché
  Et le message reste unifié "Email ou mot de passe incorrect" pour les 5 premières (anti-énumération)
```

```gherkin
# Source : §12 m03_password_min_length
# Couche : api
# Priorité : P3-nominal

Scénario : password_longueur_minimale_8_caracteres
  Étant donné un chauffeur définissant son password via magic link (bootstrap W1)
  Quand il saisit un password de 7 caractères
  Alors la définition est rejetée avec message "8 caractères minimum"
  Et un password de 8 caractères exactement est accepté
```

### Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : §06/M05 E3 + §05 R_M05.1
# Couche : ui
# Priorité : P1-critique

Scénario : checklist_zd_incomplete_bloque_demarrage
  Étant donné un chauffeur ZD sur E3 avec 2 items cochés sur 3
  Quand il tente de cliquer "Démarrer tournée"
  Alors le bouton reste grisé avec tooltip "Complète la checklist"
  Et tournees.statut reste acceptee (aucune transition en_cours ; la tournée est `acceptee`=prête avant démarrage, cf. cycle de vie M04 §4 2026-06-06)
```

```gherkin
# Source : §06/M05 E6 (poids négatif)
# Couche : api
# Priorité : P1-critique

Scénario : pesee_poids_negatif_refuse
  Étant donné une collecte ZD en_cours
  Quand le chauffeur tente de saisir poids_brut_kg = -5
  Alors la saisie est rejetée (min 0 kg)
  Et aucune ligne pesees n'est insérée
```

```gherkin
# Source : §06/M05 E6 + §05 R_M05.4 (override tare)
# Couche : api
# Priorité : P1-critique

Scénario : override_tare_sans_motif_refuse
  Étant donné une collecte ZD en_cours et un chauffeur activant "Corriger la tare"
  Quand il saisit une tare divergente de la tare snapshot sans saisir de motif (ou motif < 10 caractères)
  Alors l'enregistrement est refusé avec message "Motif obligatoire (10 caractères min)"
  Et avec un motif >= 10 caractères, la pesée est enregistrée et pesees.tare_override_motif est rempli
  Et un audit log PESEE_TARE_OVERRIDE (before/after + motif) est créé
```

```gherkin
# Source : §06/M05 E5 (clôture ZD)
# Couche : api
# Priorité : P1-critique

Scénario : cloture_collecte_zd_sans_pesee_refusee
  Étant donné une collecte ZD en_cours sans aucune pesée enregistrée
  Quand le chauffeur tente de cliquer "Terminer collecte"
  Alors l'action est refusée (validation : >= 1 pesée requise pour ZD)
  Et statut_operationnel reste en_cours
```

```gherkin
# Source : §06/M05 E4 (clôture tournée prématurée)
# Couche : ui
# Priorité : P1-critique

Scénario : cloture_tournee_avec_collecte_non_terminale_bloquee
  Étant donné une tournée en_cours avec au moins une collecte non-terminale (ni realisee, ni realisee_sans_collecte, ni incident, ni annulee)
  Quand le chauffeur ouvre E4
  Alors le bouton "Terminer la tournée" est grisé
  Et il devient actif uniquement quand toutes les collectes sont terminales
```

```gherkin
# Source : §06/M05 E1 + §09 (anti-énumération)
# Couche : api
# Priorité : P2-important

Scénario : login_password_incorrect_message_unifie
  Étant donné un chauffeur existant
  Quand il saisit un email valide mais un password incorrect
  Alors la réponse est "Email ou mot de passe incorrect"
  Et le même message exact est retourné pour un email inexistant (timing constant via dummy compare)
```

```gherkin
# Source : §06/M05 edge case C13
# Couche : ui
# Priorité : P3-nominal

Scénario : appel_traiteur_numero_manquant_bouton_desactive
  Étant donné une collecte dont le contact traiteur n'a pas de téléphone renseigné
  Quand le chauffeur ouvre E5
  Alors le bouton "Appeler traiteur" est désactivé avec tooltip "Numéro traiteur non renseigné, contacte Ops"
  Et le bouton "Appeler Ops" reste actif (numéro paramètre m05_ops_numero_telephone)
```

```gherkin
# Source : §06/M05 E9 + §05 R6.1
# Couche : api
# Priorité : P2-important

Scénario : incident_acces_refuse_passe_echec_acces
  Étant donné une collecte arrivee
  Quand le chauffeur signale un incident catégorie acces_refuse en E9
  Alors statut_operationnel passe à echec_acces
  Et le webhook S9 incident est émis avec statut_collecte_apres=echec_acces
```

### Catégorie 4 — Isolation données (RLS)

```gherkin
# Source : §09 RLS chauffeur (auth.user_chauffeur_id)
# Couche : db
# Priorité : P1-critique

Scénario : rls_chauffeur_ne_voit_pas_tournees_autre_chauffeur
  Étant donné deux chauffeurs "chauffeur_strike_1" et "chauffeur_strike_2" du même prestataire Strike
  Et une tournée T1 assignée à chauffeur_strike_2
  Quand chauffeur_strike_1 requête ses tournées
  Alors T1 n'apparaît pas dans son résultat (RLS chauffeur_id = auth.user_chauffeur_id())
```

```gherkin
# Source : §09 RLS chauffeur cross-prestataire
# Couche : db
# Priorité : P1-critique

Scénario : rls_chauffeur_strike_ne_voit_pas_tournees_marathon
  Étant donné un chauffeur Strike et une tournée assignée à un chauffeur Marathon
  Quand le chauffeur Strike requête tournees, collectes_tms, pesees
  Alors aucune donnée Marathon n'est visible
```

```gherkin
# Source : §09 (chauffeur ne voit pas les coûts)
# Couche : db
# Priorité : P1-critique

Scénario : rls_chauffeur_masque_cout_calcule_ht
  Étant donné un chauffeur connecté consultant une de ses tournées
  Quand il lit la ligne tournees
  Alors la colonne cout_calcule_ht n'est pas exposée
  Et aucune grille tarifaire n'est lisible par le rôle chauffeur
```

```gherkin
# Source : §09 (horizon visibilité chauffeur)
# Couche : db
# Priorité : P2-important

Scénario : rls_chauffeur_horizon_statut_et_date
  Étant donné un chauffeur avec des tournées de statuts variés
  Quand il requête ses tournées
  Alors il ne voit que les tournées statut IN (planifiee, en_cours) du jour + J+1, plus l'historique 30 jours
  Et les tournées annulee ne sont jamais retournées
```

```gherkin
# Source : §05 R_M05.10 + §09 (device binding)
# Couche : db
# Priorité : P1-critique

Scénario : device_binding_un_seul_device_actif
  Étant donné un chauffeur avec une session active sur device A
  Quand il se connecte sur device B
  Alors la session de device A est invalidée (revoked_at renseigné)
  Et l'index unique partiel auth_sessions_tms_chauffeur_single_active garantit 1 seule ligne active
  Et un toast de déconnexion est affiché sur device A au prochain ping
```

```gherkin
# Source : §09 RLS chauffeurs_geolocalisation
# Couche : db
# Priorité : P2-important

Scénario : rls_chauffeur_ne_voit_que_sa_geolocalisation
  Étant donné deux chauffeurs avec des positions enregistrées dans chauffeurs_geolocalisation
  Quand chauffeur_strike_1 lit la table
  Alors il ne voit que ses propres positions (chauffeur_id = auth.user_chauffeur_id())
```

```gherkin
# Source : §04 pesees RLS + §09
# Couche : db
# Priorité : P1-critique

Scénario : rls_chauffeur_pesees_propres_uniquement
  Étant donné des pesées saisies par plusieurs chauffeurs
  Quand chauffeur_strike_1 requête pesees
  Alors il ne voit que les pesées où saisi_par_chauffeur_id = son id
  Et un manager prestataire voit les pesées de toutes les tournées de son prestataire
```

### Catégorie 5 — Idempotence et états

```gherkin
# Source : §08 dédup event_id + §8.2 sync
# Couche : api
# Priorité : P1-critique

Scénario : webhook_s5_event_id_rejoue_pas_de_doublon
  Étant donné un webhook S5 collecte-terminee déjà traité côté Plateforme (event_id connu dans integrations_inbox)
  Quand le même event_id est rejoué (retry après timeout ambigu)
  Alors la Plateforme retourne 200 sans créer de second effet métier (noop)
  Et une seule remontée de pesées est enregistrée
```

```gherkin
# Source : §06/M05 §cycle de vie (transitions non-autorisées)
# Couche : db
# Priorité : P1-critique

Scénario : transition_realisee_vers_en_cours_interdite_chauffeur
  Étant donné une collecte realisee
  Quand le chauffeur (ou M05) tente de la repasser en_cours
  Alors la transition est refusée (réservée à Ops via back-office)
  Et le statut reste realisee
```

```gherkin
# Source : §06/M05 §cycle de vie (annulee terminal)
# Couche : db
# Priorité : P2-important

Scénario : statut_annulee_terminal
  Étant donné une collecte annulee
  Quand une transition vers tout autre statut est tentée depuis M05
  Alors elle est refusée (annulee est terminal)
```

```gherkin
# Source : §06/M05 E6 (edit pesée)
# Couche : api
# Priorité : P2-important

Scénario : edit_pesee_bloquee_apres_realisee
  Étant donné une pesée sur une collecte en_cours (édition autorisée)
  Quand la collecte passe à realisee
  Alors toute édition ultérieure de la pesée par le chauffeur est refusée (correction Ops uniquement)
```

```gherkin
# Source : §8.2 + §06/M05 W11 (DLQ)
# Couche : api
# Priorité : P1-critique

Scénario : sync_dlq_apres_5_retries_5xx
  Étant donné un item de queue offline en sync_status=pending
  Quand le POST webhook échoue 5 fois consécutives avec HTTP 5xx
  Alors l'item passe en sync_status=dlq
  Et l'alerte M11 m05_dlq_offline_conflict (warning) ou sync_dlq_item est émise
```

```gherkin
# Source : §06/M05 edge case C8 + §8.4 (conflit)
# Couche : api
# Priorité : P1-critique

Scénario : conflit_sync_collecte_annulee_serveur_dlq
  Étant donné une pesée insérée offline pendant que Ops passe la collecte à annulee côté serveur
  Quand la queue se synchronise au retour réseau
  Alors le serveur rejette le statut incompatible et l'item part en DLQ (policy D1 option b)
  Et une alerte M11 est émise pour arbitrage Ops
```

```gherkin
# Source : §8.4 (dédup photo)
# Couche : api
# Priorité : P2-important

Scénario : photo_upload_double_dedup_idempotency_key
  Étant donné une photo uploadée deux fois (retry après timeout ambigu) avec le même idempotency_key
  Quand le serveur reçoit le second upload
  Alors un seul INSERT est conservé (déduplication via idempotency_key UNIQUE)
```

```gherkin
# Source : §05 R6.1 (multi-camions dérivé)
# Couche : db
# Priorité : P1-critique

Scénario : multi_camions_collecte_realisee_quand_toutes_tournees_terminee
  Étant donné une collecte ZD servie par 3 tournées (relation N↔N via collecte_tournees)
  Et 2 tournées sont terminee, la 3e est en_cours
  Quand la 3e tournée passe à terminee (chauffeur la clôture)
  Alors le trigger fn_derive_statut_collecte_multi_tournees() passe la collecte à realisee
  Et c'est cette transition qui émet le S5 terminal unique (pesées des 3 camions sommées par (collecte_tms_id, flux))
  Et tant qu'au moins une tournée n'est pas terminee, la collecte reste non-realisee
```

### Catégorie 6 — Scénarios cross-app (TMS → Plateforme)

```gherkin
# Source : §08 S5 collecte-terminee + §04 agrégation pesees
# Couche : api
# Priorité : P1-critique

Scénario : s5_payload_agregation_pesees_par_flux
  Étant donné une collecte ZD avec 2 pesées emballage (10 + 8 kg net) et 1 pesée biodechet (85 kg net)
  Quand le webhook S5 collecte-terminee est émis à la clôture
  Alors le payload contient pesees_par_flux : emballage {poids_net_kg_total: 18.0, nb_pesees: 2}, biodechet {poids_net_kg_total: 85.0, nb_pesees: 1}
  Et source ∈ {chauffeur, ag_sans_collecte}
  Et l'enveloppe contient event_id (UUID v4), occurred_at, source, type=cloture
```

```gherkin
# Source : §08 S9 incident (enum 5 valeurs + statut_apres 4 + gravite)
# Couche : api
# Priorité : P1-critique

Scénario : s9_incident_payload_enums_valides
  Étant donné un signalement E9
  Quand le webhook S9 incident est émis
  Alors la catégorie ∈ {acces_refuse, client_absent, probleme_tri, autre, client_annule_avant_arrivee} (5 valeurs, pas_excedents retiré 2026-06-06)
  Et statut_collecte_apres ∈ {realisee, echec_acces, inchange, annulee} (4 valeurs, realisee_sans_collecte retiré → émis via S5)
  Et gravite ∈ {warning, critical} (info retiré)
  Et un payload avec type_incident=pas_excedents OU statut_collecte_apres=realisee_sans_collecte est rejeté par le schéma JSON (enum + additionalProperties false)
```

```gherkin
# Source : §08 S3 tournee-upsert
# Couche : api
# Priorité : P2-important

Scénario : s3_tournee_upsert_transitions
  Étant donné une tournée
  Quand le chauffeur démarre la tournée puis la clôture
  Alors un S3 tournee-upsert (statut en_cours) est émis au démarrage
  Et un S3 tournee-upsert (statut terminee) est émis à la clôture
```

```gherkin
# Source : §08 §4 Sécurité HMAC
# Couche : api
# Priorité : P1-critique

Scénario : hmac_payload_modifie_rejet_401
  Étant donné un webhook S5 signé HMAC-SHA256 sur le body brut
  Quand le payload est altéré après signature (HMAC ne correspond plus)
  Alors le récepteur Plateforme rejette avec 401
  Et aucun effet métier n'est appliqué
```

```gherkin
# Source : §08 §5 Versioning X-API-Version
# Couche : api
# Priorité : P2-important

Scénario : x_api_version_absent_ou_obsolete_rejet
  Étant donné un webhook sortant TMS → Plateforme
  Quand le header X-API-Version est absent ou différent de 2026.04
  Alors le récepteur rejette la requête (400)
  Et le header est autoritatif (un champ version dans le body est ignoré)
```

```gherkin
# Source : §08 §dédup integrations_inbox
# Couche : api
# Priorité : P2-important

Scénario : event_id_rejoue_inbox_ignore_doublon
  Étant donné un event_id déjà présent dans integrations_inbox (PK event_id, TTL 7j)
  Quand le même événement est rejoué
  Alors integrations_inbox.statut = ignore_doublon
  Et aucun second traitement n'a lieu
```

```gherkin
# Source : §08 (entité inconnue)
# Couche : api
# Priorité : P2-important

Scénario : webhook_entite_inconnue_tracee_et_alertee
  Étant donné un webhook S5 référençant une collecte inconnue côté Plateforme
  Quand la Plateforme le reçoit
  Alors l'erreur est tracée dans integrations_logs avec le détail
  Et une alerte est levée pour investigation (pas de crash silencieux)
```

---

## Scénarios hors scope (à générer en V1.1)

- **W10 déclaration stocks matériel** : reporté V1.1, intégration M09 — aucun workflow M05 V1.
- **C6 changement chauffeur in-flight** : reporté V1.1 (D11) — résolution manuelle Ops via M04 W6, pas de workflow M05.
- **Switch contexte manager ↔ chauffeur (D20)** : reporté V1.1.
- **Présélection contenant par stats prestataire (Q11)** : reportée V1.1 — V1 sans présélection.
- **Multi-langue, audit WCAG, signature AG renforcée (horodatage GPS), feedback post-appel, gestion équipier** : V1.1 (Q9/Q10/Q12/Q13/Q14).
- **Migration MTS-1** : couverte par modules sources (M06 chauffeurs/véhicules, M01 collectes) — pas de check de réconciliation propre à M05.

---

## Specs tranchées (Val, 2026-06-06) — propagées CDC zéro dette

Les 4 specs floues remontées ont été tranchées et propagées (§04, §08, M05, M11, §00 Index, common.schema.json — Ajv 21/21) :

1. **Colonne photos pesées → `photos text[]` unique** — fusion ex-`photo_url` (singulier) + ex-`photos_urls` (array), dualité legacy supprimée sur `pesees` ET `incidents`, aligné sur le payload S5/S9 `photos: string[]`. Max 5 (`m05_photo_max_par_pesee`). (§04 §1 + table `pesees` canonique + table `incidents` canonique.)

2. **FK contenant → `type_contenant_id` FK `types_contenants`** (noms canoniques §04 conservés ; renommage refusé car `types_contenants` = référentiel de _types_ avec tare, plus exact, et `type_contenant_id` est utilisé par M09/M10). Prose M05 (E6, W5, D9, §15.1, Liens) alignée sur §04.

3. **Table → `incidents`** (nom canonique §04 conservé ; `incidents_terrain` refusé car la table porte aussi les incidents Ops M11, pas seulement terrain). Prose M05 (W7, §15.1, RLS, Liens) alignée.

4. **Chemin unique « aucun repas » E5 → S5** — `pas_excedents` retiré de E9 et de l'enum `type_incident` S9 (6→5). Le cas AG « aucun repas » passe exclusivement par le bouton de clôture E5 → `realisee_sans_collecte` → S5 `collecte-terminee` (poids 0, `source=ag_sans_collecte`). `realisee_sans_collecte` retiré de `statut_collecte_apres` S9 (5→4). Doublon (2 UX + 2 webhooks) supprimé ; tarif « course incomplète » M03/M07 piloté par le statut `realisee_sans_collecte` (cf. §03). Propagé : M05 (E9, cycle de vie, W7, §10, §15.1), §08 (enum + exemple + statut_apres + sur_place + récap), common.schema.json (enum_type_incident 5 / enum_statut_collecte_apres 4), §04 incidents enum, M11 alerte, §00 Index.

# M06 — Référentiel prestataires

**Persona principal** : Admin TMS (fondations) + Ops Savr (quotidien)
**Contexte d'usage** : desktop bureau, fréquence ponctuelle (création/mise à jour), haute sensibilité données financières (grilles tarifaires) et RGPD (docs chauffeurs).

---

## 1. Objectif métier

Référentiel **interne** des entités logistiques partenaires : prestataires, véhicules, chauffeurs, types de véhicules, grilles tarifaires. C'est la **source de vérité** alimentant tout le TMS en aval :

- M02 Dispatch : liste des prestataires éligibles (suggestions attribution)
- M04 Gestion tournées : parc véhicules + chauffeurs assignables
- M05 App mobile chauffeur : compte chauffeur (auth)
- M07 Pilotage financier : grilles tarifaires = clé de voûte du calcul coût
- M08 Facturation : rapprochement factures vs coûts calculés
- M12 Attribution : critères prestataire (actif, type_prestation, zone, intégration Everest)

**Split avec autres modules** :

- M06 = gestion interne Admin TMS / Ops Savr (ce module)
- [[M03 - Portail prestataire self-service]] = Manager prestataire édite **ses propres** véhicules + chauffeurs + docs (RLS restrictive)
- [[M13 - Administration TMS]] = config système TMS (paramètres globaux, kill switches), **pas de référentiel métier**

**Ce que M06 résout vs MTS-1** :

- Saisie unifiée (vs 3 écrans dispersés MTS-1)
- Grilles tarifaires versionnées avec date_debut/date_fin (vs écrasement destructif MTS-1)
- Soft delete + audit trail sur toute mutation
- Préparation auto des références pour M02/M04/M12 (pas de data sale en production)

**KPI cibles V1** :

- 100% des prestataires créés via M06 (zéro dump SQL manuel après seed initial)
- 0 grille tarifaire en conflit d'overlap `(prestataire_id, type_vehicule_id, période)` (validation DB)
- Temps création prestataire complet (identité + 1 véhicule + 1 chauffeur + 1 grille) : < 5 minutes Admin TMS

---

## 2. Personas et contexte d'usage

### Admin TMS

- Accès **complet** sur toutes les entités M06 (création / édition / archivage / grilles tarifaires).
- Usage **hebdomadaire** en régime de croisière : onboarding d'un nouveau prestataire, MAJ annuelle grilles tarifaires, revue du parc.
- Usage **intensif** à la phase seed (migration MTS-1) : saisie manuelle de ~30 prestataires + véhicules + chauffeurs + grilles historiques sur 3-5 jours.

### Ops Savr

- Accès **lecture large** sur tout le référentiel.
- Accès **écriture** sur véhicules + chauffeurs (pas sur prestataires, pas sur grilles tarifaires).
- Accès **écriture** sur catalogue `types_vehicules` (ajout d'un type spécifique province).
- Usage **occasionnel** : ajout d'un chauffeur remplaçant en urgence, ajout véhicule temporaire, création d'un type véhicule rare.

### Manager prestataire (hors périmètre M06)

- **Ne voit jamais M06**. Utilise [[M03 - Portail prestataire self-service]] pour gérer ses véhicules + chauffeurs + docs.
- Peut être bloqué par le système (policies RLS) même s'il tente l'URL M06.

### Chauffeur (hors périmètre M06)

- N'accède à aucun écran M06. Sa fiche est créée par Admin TMS / Ops Savr / Manager prestataire.
- Reçoit ses identifiants magic link pour l'app mobile M05 après activation du compte (si `users_tms` créé).

---

## 3. Architecture des écrans

Neuf écrans V1, tous desktop-first.

| #   | Écran                                                | Rôle                                                                                | Accès                                                                                                                          |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| E1  | Liste prestataires                                   | Index paginé + filtres + recherche                                                  | Admin TMS, Ops Savr                                                                                                            |
| E2  | Fiche prestataire (onglets)                          | Détail complet avec tabs identité / véhicules / chauffeurs / grilles / intégrations | Admin TMS, Ops Savr                                                                                                            |
| E3  | Formulaire prestataire (création / édition identité) | Modal ou page dédiée                                                                | Admin TMS (+ **Ops Savr pour la création province uniquement**, via `tms.fn_create_prestataire_province`, QO#5 M02 2026-06-05) |
| E4  | Fiche véhicule (création / édition)                  | Modal depuis onglet véhicules de E2                                                 | Admin TMS, Ops Savr                                                                                                            |
| E5  | Fiche chauffeur (création / édition)                 | Page dédiée avec sections identité + docs + compte                                  | Admin TMS, Ops Savr                                                                                                            |
| E6  | Catalogue types véhicules                            | Liste + création / édition type                                                     | Ops Savr, Admin TMS                                                                                                            |
| E7  | Grille tarifaire (création / édition)                | Page dédiée avec form dynamique selon `formules_catalogue`                          | Admin TMS                                                                                                                      |
| E8  | Workflow fin de contrat                              | Page dédiée, bouton "Mettre fin au contrat" sur E2                                  | Admin TMS                                                                                                                      |
| E9  | Onglet intégrations externes                         | Sous-onglet de E2, toggle Everest + test API                                        | Admin TMS                                                                                                                      |

**Navigation** :

- Menu principal TMS → entrée "Référentiels" → sous-menu : Prestataires (E1), Types véhicules (E6).
- E2 = vue pivot avec tabs horizontaux : `Identité` / `Véhicules` / `Chauffeurs` / `Grilles tarifaires` / `Intégrations` (E9).
- E3 accessible depuis bouton "+ Nouveau prestataire" sur E1 (Admin TMS) **et** depuis le bouton "Créer un nouveau prestataire province" du tunnel dispatch M02 E5 (Ops Savr — création `type='province'` via `tms.fn_create_prestataire_province`, validation doublon SIRET puis `(nom_normalisé, ville)`, QO#5 M02 2026-06-05).
- E4/E5 s'ouvrent en modal ou page depuis les tabs de E2.
- E7 accessible depuis tab "Grilles tarifaires" de E2, page dédiée (trop de champs pour modal).
- E8 accessible depuis bouton "Fin de contrat" dans le header de E2 (Admin TMS uniquement).

---

## 4. Écran par écran

### E1 — Liste prestataires

**Layout** : tableau paginé pleine largeur + barre de filtres en haut + bouton d'action à droite.

**Header** :

- Titre "Prestataires" + compteur "42 actifs / 47 total"
- Bouton `+ Nouveau prestataire` (Admin TMS uniquement, disabled + tooltip pour Ops Savr)

**Barre de filtres** (sticky) :

- Recherche full-text (nom, SIRET, code)
- Filtre `statut` : pills "Actifs" (default) / "Suspendus" / "Archivés" / "Tous"
- Filtre `type_prestation` : checkboxes ZD / AG
- Filtre `integration_externe` : dropdown "Toutes" / "Aucune" / "Everest"
- — **Retiré V1 (revue sobriété A5 2026-04-30)** : colonne icône dans le tableau suffit.

**Colonnes tableau** :
| Colonne | Tri | Format |
|---------|-----|--------|
| Code | Oui | `strike`, `marathon`, `a_toutes`, `prest_xxx` en mono |
| Nom | Oui | Raison sociale |
| Statut | Oui | Badge coloré (actif=vert, suspendu=orange, archive=gris) |
| Type prestation | Non | Pills ZD / AG |
| SIRET | Non | `XXX XXX XXX XXXXX` |
| Ville siège | Oui | Depuis `adresse_siege.ville` |
| Parc | Non | "3 véhicules / 5 chauffeurs" (compteurs live) |
| Portail | Non | Icône si `has_portail_self_service = true` |

**Pagination** : 50 lignes/page, lazy load.

**Actions ligne** : clic ligne → ouvre E2. Pas d'actions inline (édition via E2).

**RLS** : Admin TMS + Ops Savr → lecture complète. Manager prestataire + Chauffeur → 403.

---

### E2 — Fiche prestataire (onglets)

**Header** (sticky, visible sur tous les tabs) :

- Breadcrumb : Référentiels > Prestataires > {code prestataire}
- Nom + badge statut + code
- Actions globales (droite) :
  - `Modifier identité` (Admin TMS) → ouvre E3 en édition
  - `Fin de contrat` (Admin TMS, visible si `statut = actif`) → ouvre E8
  - `Réactiver` (Admin TMS, visible si `statut = suspendu`) → confirmation modale
  - `Archiver maintenant` (Admin TMS, visible si `statut = suspendu`) → confirmation modale + passage immédiat `archive` (accélère le trigger J+30 — cf. §8 transitions, Q6) → soft delete `users_tms` associés + audit `PRESTATAIRE_ARCHIVE_MANUEL`
- — **Retiré V1 (revue sobriété M06 2026-06-05 A1)** : strictement équivalent à `+ Nouveau prestataire` (copie identité vide = aucun gain), ~30 prestataires seedés une fois.
- Menu kebab : `Voir audit log` (**Retiré V1 — revue sobriété A2 2026-04-30**)

**Tabs** :

#### Tab 1 — Identité

Affichage read-only (édition via E3 pour Admin TMS) :

- Bloc "Entreprise" : raison sociale, code, SIRET, forme juridique, adresse siège
- Bloc "Contact opérationnel" : nom, email, téléphone
- Bloc "Contact facturation" : nom, email, téléphone (avec indicateur "Identique à contact opérationnel" si applicable, cf. Q12)
- Bloc "Activité" : type_prestation (ZD/AG), rayon_intervention_km, coords_siege (lat/lng — géocodées en background au save)
- Bloc "Commentaire interne" : zone texte libre (Ops Savr peut éditer)

#### Tab 2 — Véhicules

Tableau du parc véhicules du prestataire (filtré `prestataire_id`) :

| Colonne       | Format                                                 |
| ------------- | ------------------------------------------------------ |
| Plaque        | Format `AA-123-BB` ou identifiant interne (vélo cargo) |
| Type véhicule | Label depuis `types_vehicules.label`                   |
| Statut        | `actif` / `archive`                                    |
| Créé le       | Date                                                   |
| Actions       | Bouton "Éditer" (E4) + bouton "Archiver" (soft delete) |

Bouton `+ Nouveau véhicule` (Admin TMS + Ops Savr) → ouvre E4 en création.

#### Tab 3 — Chauffeurs

Tableau des chauffeurs du prestataire (filtré `prestataire_id`) :

| Colonne           | Format                                                             |
| ----------------- | ------------------------------------------------------------------ |
| Nom / prénom      |                                                                    |
| Téléphone         | Format FR `06 XX XX XX XX`                                         |
| Peut conduire     | Toggle visuel ✓ / ✗                                                |
| Compte app mobile | Badge "Activé" / "Non activé" (selon présence `users_tms`)         |
| Docs              | "Permis ✓ / CNI ✓" (icône grisée si absente, non bloquant cf. Q11) |
| Statut            | `actif` / `archive`                                                |
| Créé le           | Date                                                               |
| Actions           | Bouton "Éditer" (E5) + bouton "Archiver"                           |

Bouton `+ Nouveau chauffeur` (Admin TMS + Ops Savr) → ouvre E5 en création.

#### Tab 4 — Grilles tarifaires (Admin TMS uniquement — Ops Savr lecture seule)

Liste des grilles actives et historiques :

| Colonne             | Format                                                                   |
| ------------------- | ------------------------------------------------------------------------ |
| Formule             | Label depuis `formules_catalogue.label`                                  |
| Type véhicule       | Label ou "Tous véhicules" si NULL                                        |
| Période             | `date_debut_validite` → `date_fin_validite` (ou "En cours" si NULL)      |
| Statut              | `actif` / `expire` / `brouillon`                                         |
| Créée le            | Date                                                                     |
| Actions (Admin TMS) | `Éditer` (E7) + `Clôturer` (set date_fin_validite = today) + `Dupliquer` |

Bouton `+ Nouvelle grille tarifaire` (Admin TMS) → ouvre E7 en création.

**Vue Ops Savr** : mêmes colonnes, pas d'action d'édition, pas de bouton création.

#### Tab 5 — Intégrations externes (E9, cf. ci-dessous)

---

### E3 — Formulaire prestataire (création / édition identité)

**Accès** : Admin TMS uniquement. Ouverture en page dédiée (pas modal, trop de champs).

**Mode création** : tous les champs vides avec seed intelligent (`statut = actif`, `has_portail_self_service = false`, `integration_externe = aucune`).

**Mode édition** : pré-rempli depuis `shared.prestataires`, diff affiché en haut sur save.

**Sections** :

1. **Entreprise** (bloqué en édition pour `code`, `siret`)
   - `code` (slug court, unique, immuable) — ex: `strike`, `prest_rungis`
   - `nom` (raison sociale, obligatoire)
   - `siret` (14 chiffres, optionnel pour prestataires étrangers, unique strict si renseigné)

- — **Retiré V1 (revue sobriété A3 2026-04-30)** : aucun comportement applicatif. Si besoin, saisir dans `commentaire_interne`.
  - `adresse_siege` : saisie manuelle 4 champs séparés (`rue`, `code_postal`, `ville`, `pays`). Geocoding Nominatim appelé en **background au save** → remplit `coords_siege_lat/lng` automatiquement. Résultat affiché en lecture seule "Géolocalisé ✓" ou "Non géolocalisé — vérifier l'adresse" (pas de carte affichée V1 — **cf. A1 revue sobriété 2026-04-30**).

2. **Contact opérationnel**
   - `contact_operationnel.nom`
   - `contact_operationnel.email` (validation format)
   - `contact_operationnel.telephone` (format libre, normalisation côté DB)

3. **Contact facturation**
   - Toggle "Identique au contact opérationnel" (default: off)
   - Si off : mêmes champs (nom, email, téléphone) vides
   - Si on : copie en lecture seule du contact opérationnel (stockage DB = copie physique dans `contact_facturation` pour robustesse — changement opérationnel n'impacte pas facturation automatiquement)

4. **Activité**
   - `type_prestation` (checkboxes ZD / AG, au moins 1 cochée)
   - `rayon_intervention_km` (nombre, nullable — seed à null pour Strike/Marathon/A Toutes!, valeur pour province)

5. **Portail self-service**
   - `has_portail_self_service` (toggle, default false) — tooltip "Active M03 pour les managers de ce prestataire"

6. **Commentaire interne**
   - Zone texte libre (markdown simple)

**Actions** :

- `Enregistrer` → validation + INSERT ou UPDATE + redirection E2
- `Annuler` → retour E1 ou E2 selon provenance

**Validations** :

- `code` unique global (erreur inline si conflit)
- `siret` unique global si non NULL
- `nom` non vide
- Au moins un `type_prestation` coché
- `coords_siege_lat/lng` obligatoires si `rayon_intervention_km IS NOT NULL` (sinon calcul haversine impossible pour M12)

---

### E4 — Fiche véhicule (création / édition)

**Accès** : Admin TMS + Ops Savr. Modal depuis E2 tab Véhicules.

**Champs** :

- `plaque` (format libre `AA-123-BB` ou identifiant interne ; validation regex FR optionnelle + warning si format non FR)
- `type_vehicule_id` (dropdown depuis `types_vehicules`, obligatoire)
- `statut` (toggle actif / archive, default actif)
- — **Retiré V1 (revue sobriété 2026-04-30)**. Si un véhicule a un tarif distinct, créer une grille tarifaire dédiée `type_vehicule_id` spécifique dans E7.

**Note V1** : pas de `assurance_date_fin` (retiré V2 cf. Q6 Salve 2 M06). Les colonnes assurance sont retirées de `§04 Data Model TMS/vehicules`.

**Validations** :

- `plaque` unique globale active (SELECT `plaque` WHERE `deleted_at IS NULL AND statut = 'actif'`) → erreur bloquante si conflit + lien vers le véhicule existant
- `type_vehicule_id` existant dans `types_vehicules` (dropdown contraint)

**Actions** :

- `Enregistrer` → INSERT/UPDATE + fermeture modal + refresh tab
- `Archiver` (mode édition) → confirmation modale + `deleted_at = now()` + `statut = 'archive'`

---

### E5 — Fiche chauffeur (création / édition)

**Accès** : Admin TMS + Ops Savr. Page dédiée depuis E2 tab Chauffeurs (trop de sections pour modal).

**Sections** :

1. **Identité**
   - `nom`
   - `prenom`
   - `telephone` (format FR, normalisation)

- — **Retiré V1 (revue sobriété A4 2026-04-30)** : aucun comportement applicatif, surface RGPD inutile.
  - `peut_conduire` (toggle, default true) — tooltip "Décocher pour les équipiers non-conducteurs"

2. **Permis** (tous optionnels V1 cf. Q6/Q11)
   - `numero_permis` (texte libre, alerte info "Numéro déjà saisi sur un autre chauffeur : {nom}" si doublon, non bloquant)
   - `date_fin_validite_permis` (datepicker, optionnel — pas d'alerte échéance V1)
   - Upload `permis_url` (PDF ou JPEG, 5 Mo max, Supabase Storage) — optionnel, non bloquant activation compte

3. **Pièce d'identité** (optionnelle V1)
   - Upload `piece_identite_url` (PDF ou JPEG, 5 Mo max) — optionnel, non bloquant

4. **Compte app mobile**
   - Toggle "Activer le compte app mobile" (default off)
   - Si on : champ `email` obligatoire (validation format + unicité global `users_tms`)
   - Bouton `Envoyer magic link` (si compte activé) → invoque workflow magic link (cf. §09 Auth)
   - Indication "Compte créé / En attente premier login / Actif depuis {date}"

**Validations** :

- `nom` + `prenom` + `telephone` non vides
- Si compte activé → `email` non vide + unique dans `users_tms`
- `numero_permis` : alerte info si doublon (UI "Ce numéro est déjà saisi sur un chauffeur chez {prestataire_nom}"), **non bloquant**
- Upload permis / CNI : non bloquant, activation compte possible sans ces docs

**Actions** :

- `Enregistrer`
- `Archiver` (mode édition) → soft delete + archive `users_tms` associé
- `Changer de prestataire` (cf. W5 — archivage + création)

**Mention RGPD affichée** : "Les documents permis et CNI sont conservés 5 ans (obligation Registre transport). Le chauffeur peut demander leur suppression à tout moment sans archiver la fiche." → bouton `Supprimer documents sans archiver` (set NULL `permis_url` + `piece_identite_url`, log audit).

---

### E6 — Catalogue types véhicules

**Accès** : Ops Savr (édition) + Admin TMS (édition). Menu Référentiels → Types véhicules.

**Vue** : tableau simple.

| Colonne         | Format                                          |
| --------------- | ----------------------------------------------- |
| Code            | Mono `camion_7t`, `velo_cargo`, etc. (immuable) |
| Label           | Texte affiché UI                                |
| Catégorie       | `camion`, `velo_cargo`, `utilitaire`, `autre`   |
| Capacité volume | m³ (optionnel)                                  |
| Capacité poids  | kg (optionnel)                                  |
| Utilisé par     | "3 véhicules actifs" — compteur live            |
| Actions         | `Éditer` + `Archiver` (si 0 véhicule actif)     |

Bouton `+ Nouveau type`.

**Validations** :

- `code` unique, immuable après création (lock UI en édition)
- Archivage impossible si `COUNT(vehicules WHERE type_vehicule_id = :id AND deleted_at IS NULL) > 0` → message "Impossible d'archiver : {N} véhicules actifs utilisent ce type"

---

### E7 — Grille tarifaire (création / édition)

**Accès** : Admin TMS uniquement.

**Header** :

- Prestataire (lecture seule, pré-rempli depuis E2)
- Mode : Création / Édition

**Sections** :

1. **Formule**
   - Dropdown `formule_id` depuis `formules_catalogue` (5 valeurs V1 : `vacations_paliers`, `grille_matrice_velo`, `grille_matrice_camion_zone`, `forfait_km`, `forfait_fixe`)
   - Description de la formule affichée sous le dropdown (texte depuis `formules_catalogue.description`)

2. **Portée**
   - `type_vehicule_id` (dropdown depuis `types_vehicules` + option "Tous véhicules" = NULL)
   - `date_debut_validite` (datepicker, obligatoire)
   - `date_fin_validite` (datepicker, nullable — "En cours" si NULL)

3. **Paramètres formule** (dynamique selon `formule_id` + `formules_catalogue.schema_parametres` JSON Schema)
   - Formulaire auto-généré depuis le JSON Schema (cf. §04 `formules_catalogue.schema_parametres`)
   - Exemple `vacations_paliers` : tableau de paliers éditable (de_h, a_h, nb_vacations, prolongation bool, equipier_supplement_vacation_ht) + `tarif_vacation_base_ht` + `cout_horaire_supplementaire_ht`
   - Exemple `grille_matrice_velo` : tableau zone × type_course avec inputs tarif_ht
   - Validation JSON Schema **côté application uniquement** (Zod généré depuis `formules_catalogue.schema_parametres`) — revue sobriété M06 2026-06-05 B3/C1 : pas de validateur JSON Schema PL/pgSQL côté DB (écrivain unique = Admin TMS de confiance, zéro surface API externe sur M06 ; double validation = risque de divergence). La DB garde les **contraintes dures** : `parametres_formule NOT NULL`, FK `formule_id`, index EXCLUDE overlap, triggers grille-obligatoire / anti-expiration (§04). Ferme Q8.

4. **Statut**
   - Radio : `brouillon` (default, non utilisable par calcul) / `actif` (utilisable par R2 calcul coût)

**Validations bloquantes** :

- Overlap interdit : SELECT grilles WHERE `prestataire_id = :id AND type_vehicule_id = :vid AND statut = 'actif'` AND overlap `(date_debut_validite, date_fin_validite)` avec la nouvelle → erreur "Conflit avec la grille {id} active du {date_debut} au {date_fin}"
- `parametres_formule` valide contre `schema_parametres` (retour erreur détaillée champ par champ)
- `date_debut_validite < date_fin_validite` si les deux renseignés

**Actions** :

- `Enregistrer brouillon`
- `Publier` (passe `statut = actif` après validation overlap)
- `Clôturer` (édition uniquement, set `date_fin_validite = today`)
- `Dupliquer` (copie avec `statut = brouillon`, date_debut = demain)

---

### E8 — Workflow fin de contrat

**Accès** : Admin TMS uniquement, depuis E2 header "Fin de contrat".

**Page dédiée — écran unique** (revue sobriété M06 2026-06-05 B2 — ex-tunnel 3 étapes aplati : action rare, le découpage en 3 écrans était du sur-séquençage ; toute la logique est préservée, regroupée sur une page) :

**Bloc 1 — Check bloquant collectes / tournées en cours** (en tête de page)

- Requête COUNT _(tranché Val 2026-06-07 test-scenarios floue #1 — granularité corrigée)_ : `tms.tournees.statut IN ('planifiee','acceptee','en_cours')` du prestataire **OU** `tms.collectes_tms.statut_dispatch IN ('attribuee_en_attente_acceptation','acceptee')` rattachées au prestataire. retiré (statut_dispatch d'une collecte **non encore rattachée** à un prestataire — ne peut pas bloquer une fin de contrat).
- Si **N > 0** → bandeau rouge + reste du formulaire **désactivé** : "Ce prestataire a **{N} collecte(s)/tournée(s) active(s)**. Réattribuez-les avant de continuer. [→ Ouvrir M02 Dispatch filtré sur {nom_prestataire}]"
- Si **N = 0** → formulaire actif
- **Pas de tableau détaillé** (revue sobriété B4 2026-04-30) — l'Admin TMS traite les réattributions dans M02.

**Bloc 2 — Date de fin effective**

- Datepicker `date_fin_effective` (default: today + 30j)
- Message explicatif : "Le prestataire passera en statut `suspendu` immédiatement (aucune nouvelle attribution possible). À la date de fin effective ({date}), son statut passera automatiquement en `archive` (historique conservé, plus de connexion possible pour ses managers et chauffeurs)."

**Bloc 3 — Confirmation** (même page, sous le datepicker)

- Récapitulatif live : prestataire {nom}, date fin effective {date}, {N} managers suspendus, {N} chauffeurs suspendus
- Checkbox "Je confirme la fin de contrat avec ce prestataire"
- Bouton `Confirmer` (rouge, disabled tant que checkbox non cochée OU N > 0)
- Audit : `action = 'PRESTATAIRE_FIN_CONTRAT'`, `acteur = admin_tms.user_id`, `payload = {date_fin_effective}`

**Effets immédiats à la confirmation** :

- `shared.prestataires.statut = 'suspendu'`
- `shared.prestataires.date_fin_contrat = :date_fin_effective` (colonne à ajouter §04)
- Tous les `users_tms WHERE prestataire_id = :id` → `statut = 'suspendu'` (invalidation JWT lors du prochain refresh)
- Pas d'impact immédiat sur tournées historiques (archive quand statut = archive à J+30)

**Trigger J+30** (cron journalier) :

- Pour chaque prestataire `WHERE statut = 'suspendu' AND date_fin_contrat <= today`
- → `statut = 'archive'`
- → Soft delete `users_tms` associés
- → Audit log `action = 'PRESTATAIRE_ARCHIVE_AUTO'`

**Réversibilité** : pendant la période de suspension (J+1 à J+29), Admin TMS peut cliquer "Réactiver" sur E2 → retour `statut = actif`, `date_fin_contrat = NULL`, `users_tms` réactivés.

---

### E9 — Onglet intégrations externes

**Accès** : Admin TMS (édition) + Ops Savr (lecture). Sous-onglet de E2.

**Section Everest** :

- Toggle "Intégration Everest activée" (default off)
- Si on :
  - Champ `everest_client_id` (texte, obligatoire)
  - Bouton `Tester la connexion` → déclenche [[M14 - Intégration Everest#W8 — Test connexion Everest|M14 W8]] (`POST /availabilities` avec service*id 71 + date demain, endpoint léger). Retour visuel immédiat (vert "Connexion OK" ou rouge "Échec : {erreur}"). **Trace dans `tms.integrations_logs`** (revue sobriété §04 2026-04-30 A3 — colonnes `last_everest_ping*\*` supprimées V1, info dérivée). Test connexion permanent disponible aussi depuis [[M13 - Administration TMS#E6 — Monitoring intégrations|M13 E6 tab Everest]] (sobriété 2026-04-30 A_M14_03 — 2 entrées validées : référentiel prestataires + monitoring système).
  - Dernière connexion réussie affichée — lue depuis la **vue dérivée `tms.vue_prestataires_everest_status`** (revue sobriété §04 2026-04-30 A3) qui dérive `last_everest_ping_at` + `status` depuis `integrations_logs`.
- Si off :
  - Grisé, message "Activer pour configurer l'intégration Everest (M14)"

**Section futures intégrations** (placeholder V2) :

- Titre "Autres intégrations" avec texte "Aucune autre intégration disponible pour le moment"

---

## 5. Workflows détaillés

### W1 — Création prestataire (Admin TMS, from scratch — refondu revue sobriété §05 2026-05-01 D2 grille obligatoire)

> **Note D2** : ce workflow desktop M06 est l'alternative au wizard guidé M13 E7. Il aboutit au même invariant : **prestataire `actif` ⇒ grille tarifaire active publiée**. Recommandation : pour un onboarding standard, préférer le wizard M13 E7 (4 steps guidés). M06 W1 reste utile pour onboarding partiel (création en `en_onboarding`, complétion grille ultérieure, activation finale en M13 E2).

1. E1 → clic `+ Nouveau prestataire` → redirection E3 mode création
2. Admin TMS remplit section Entreprise (code unique, nom, SIRET, forme juridique, adresse siège avec autocomplete → coords auto)
3. Remplit contact opérationnel (nom, email, tel)
4. Remplit contact facturation (toggle identique ou saisie séparée)
5. Coche type_prestation (ZD / AG), éventuellement `rayon_intervention_km`
6. Toggle `has_portail_self_service` si souhaité
7. Clic `Enregistrer` → validations côté client + serveur :
   - `code` unique → erreur inline si conflit, suggestion alternative (`prest_xxx_2`)
   - `siret` unique → erreur inline si conflit avec lien vers prestataire existant
   - Format email / téléphone
8. INSERT `shared.prestataires` **`statut = 'en_onboarding'`** (refondu revue sobriété §05 2026-05-01 D2 — plus jamais `actif` direct sans grille) + audit log `action='PRESTATAIRE_CREATE'`
9. Redirection E2 sur le prestataire créé, tab Identité ouvert
10. Bandeau flash orange "Prestataire {nom} créé en `en_onboarding`. **Grille tarifaire obligatoire** avant activation : créer dans M07 puis revenir activer ici (bouton `Activer` apparaîtra dès la grille publiée)." Bouton `Activer le prestataire` sur tab Identité reste désactivé tant que `trg_prestataire_grille_obligatoire` ne valide pas. **Vérification au chargement de l'onglet + bouton `Rafraîchir`** (revue sobriété M06 2026-06-05 B1 — polling AJAX 30s permanent retiré : onboarding = action rare, un re-check à l'ouverture/refresh suffit, pas de timer front ni de charge DB continue). La tentative d'`Activer` revalide de toute façon côté serveur.

### W2 — Création véhicule

**Acteurs possibles** : Admin TMS, Ops Savr (via E4), Manager prestataire (via M03).

1. E2 → tab Véhicules → clic `+ Nouveau véhicule` → modal E4
2. Saisie plaque + sélection type_vehicule
3. Validation unicité plaque active globale
4. Si conflit → erreur bloquante + lien vers véhicule existant (audit qui possède cette plaque)
5. INSERT `vehicules` + audit log `action='VEHICULE_CREATE'`
6. Fermeture modal + refresh tab + toast "Véhicule {plaque} créé"

### W3 — Création chauffeur + upload docs optionnel + activation compte

**Acteurs possibles** : Admin TMS, Ops Savr (via E5), Manager prestataire (via M03).

1. E2 → tab Chauffeurs → clic `+ Nouveau chauffeur` → E5 mode création
2. Section Identité : nom, prénom, téléphone, peut_conduire (default on) (**Retiré V1**)
3. Section Permis (toutes optionnelles V1) : numero_permis, date_fin_validite, upload PDF/JPEG
   - Si `numero_permis` saisi et doublon détecté → alerte info non bloquante "Ce numéro est déjà saisi sur {prenom nom} chez {prestataire}"
4. Section CNI : upload PDF/JPEG (optionnel)
5. Section Compte app mobile :
   - Toggle off par défaut → fin de workflow après Enregistrer
   - Toggle on → champ email apparaît (obligatoire si toggle on)
6. Clic `Enregistrer` :
   - INSERT `chauffeurs` + audit `action='CHAUFFEUR_CREATE'`
   - Upload docs vers Supabase Storage si fournis (dossier `chauffeurs/{chauffeur_id}/permis_{timestamp}.pdf`, `cni_{timestamp}.pdf`)
   - Si toggle compte on (simplifié revue sobriété §05 2026-05-01 B1 — bootstrap magic link uniquement) :

- INSERT `users_tms` avec `roles=['chauffeur']` + `prestataire_id` + `chauffeur_id` ( supprimé V1 — la colonne devient inutile, le magic link force la création du password à la 1ère connexion)
  - INSERT `auth.users` Supabase **sans password initial** (`encrypted_password = NULL`)
  - Génération magic link Supabase Auth TTL 30 min
  - Envoi email d'invitation chauffeur (template Resend `chauffeur_bienvenue` reformaté V1) contenant : **lien "Définir mon mot de passe" (magic link 30 min)** + lien `https://tms.gosavr.io/m/login` + instructions d'installation PWA. **Aucun password en clair transmis par email.**
  - Bandeau "Compte créé. Email d'activation envoyé à {email}. Le chauffeur clique le lien pour définir son mot de passe."
  - Si magic link expiré (>30 min) → bouton "Renvoyer lien d'activation" disponible sur fiche chauffeur (M03 E5 + M06 E5)

7. Retour E2 tab Chauffeurs, ligne créée avec badges docs (grisés si absents)

### W4 — Fin de contrat prestataire

Cf. E8 workflow 3 étapes. Tunnel bloquant si tournées actives. Trigger J+30 pour archivage auto.

### W5 — Changement de prestataire pour un chauffeur (Q9 décision : soft delete + création)

**Cas** : chauffeur Strike quitte et rejoint Marathon.

1. Admin TMS / Ops Savr ouvre E5 du chauffeur chez Strike
2. Clic bouton `Changer de prestataire` → modal de confirmation
3. Modal : "Ce chauffeur sera archivé chez {Strike}. Voulez-vous créer un nouveau chauffeur identique chez un autre prestataire ? Sélectionnez le prestataire cible : [dropdown]" — dropdown filtré `statut IN ('actif','en_onboarding')` _(tranché Val 2026-06-07 test-scenarios floue #3 : migration autorisée vers un prestataire en cours d'onboarding pour préparer la flotte ; rejet 400 server-side si cible `suspendu`/`archive`)_
4. Admin TMS sélectionne Marathon → clic `Confirmer`
5. Effets :
   - Archivage chauffeur actuel : `deleted_at = now()` + archivage `users_tms` associé (magic link désactivé)
   - Création nouveau chauffeur chez Marathon : copie `nom`, `prenom`, `telephone`, `peut_conduire`, `numero_permis` (déclenche alerte doublon info)
   - **Pas de copie** des documents : ils sont associés à l'ancien prestataire, le nouveau doit les re-uploader (cohérence RGPD + traçabilité)
   - **Pas de copie** du compte `users_tms` : il faut en recréer un si nécessaire (nouveau magic link)
6. Redirection vers E5 du nouveau chauffeur créé, mode édition
7. Toast "Chauffeur {nom} archivé chez {Strike} et créé chez {Marathon}. Compte app mobile à recréer si nécessaire."
8. Audit logs : `action='CHAUFFEUR_ARCHIVE'` + `action='CHAUFFEUR_CREATE'` + `action='CHAUFFEUR_MIGRATED'` avec payload liant les deux IDs

**Historique tournées** : toutes les tournées passées pointent sur l'ancien `chauffeur_id` → rattachement Strike correct (pas de réécriture historique).

### W6 — Création / édition grille tarifaire (Admin TMS)

1. E2 → tab Grilles tarifaires → clic `+ Nouvelle grille`
2. E7 page dédiée
3. Sélection formule → chargement dynamique du formulaire depuis `formules_catalogue.schema_parametres`
4. Saisie type_vehicule, dates validité, paramètres
5. Clic `Enregistrer brouillon` → statut = `brouillon`, non utilisable par R2
6. Validation UI puis DB :
   - Vérification overlap `(prestataire_id, type_vehicule_id, période, statut='actif')` — garantie par index EXCLUDE DB, erreur native interceptée côté API
   - Validation JSON Schema des `parametres_formule` **côté application (Zod)** (revue sobriété M06 2026-06-05 B3 — plus de fonction DB)
7. Si validations OK → statut `brouillon` sauvegardé
8. Clic `Publier` → statut passe `actif`, alerte utilisée par M07 dès la prochaine clôture tournée
9. Audit log `action='GRILLE_CREATE'` ou `action='GRILLE_PUBLISH'` + snapshot complet des paramètres

**Édition d'une grille active** : autorisée mais **déconseillée** (UI affiche warning "Modifier une grille active change le calcul des tournées futures. Pour un changement de tarif, créer une nouvelle grille avec date_debut_validite future."). Audit log `action='GRILLE_UPDATE'` avec diff.

**Clôturer une grille** : set `date_fin_validite = today` + `statut = 'expire'`. Utile quand un prestataire renégocie — on clôture l'ancienne, on crée la nouvelle.

### W7 — Gestion catalogue types véhicules (Ops Savr)

1. Menu Référentiels → Types véhicules → E6
2. Clic `+ Nouveau type` → modal
3. Saisie code (immuable), label, catégorie (interne TMS : `camion`/`fourgon`/`velo`/`autre`), **categorie_plateforme** _(ajout 2026-05-08, required)_ parmi `velo_cargo/camionnette/fourgon/vul/poids_lourd`, capacités (volume m³, frigo, hayon)
4. INSERT `types_vehicules` + audit
5. Retour E6 avec nouveau type listé

**Édition `categorie_plateforme` a posteriori** _(ajout 2026-05-08)_ : Ops Savr peut reclasser via Action "Modifier la catégorie Plateforme" sur une ligne du catalogue. Modal demande le motif obligatoire (≥10 car.) + audit_log. **Conséquence** : la prochaine validation tournée TMS utilisant un véhicule de ce type sera évaluée contre la nouvelle catégorie (R_M04.COMPATIBILITE_VEHICULE_LIEU). Pas de propagation rétroactive aux tournées déjà acceptées (audit historique préservé).

**Archivage** : possible uniquement si 0 véhicule actif utilise le type. Sinon message bloquant.

**Réutilisation par la Plateforme** _(ajout 2026-05-08)_ : la colonne `categorie_plateforme` est exposée à la Plateforme via vue cross-schema `plateforme.v_tms_types_vehicules_categories` (cf. [[../04 - Data Model TMS|§04 Data Model TMS]] table `types_vehicules`). La Plateforme l'utilise pour afficher la catégorie véhicule des tournées (Bloc 0 Attribution Prestataire §06 §3 Back-office Admin) et pour le check de compatibilité côté UI Plateforme.

---

## 6. Règles métier appliquées

| Workflow                  | Règle                                                      | Source                                                               |
| ------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| W4 fin de contrat         | R6 cycle de vie prestataires (statut → suspendu → archive) | [[../05 - Règles métier TMS]] §R6                                    |
| W4 déclencheur J+30       | Trigger cron archivage                                     | §R6 + §14 Scalabilité                                                |
| W6 grille tarifaire       | Overlap interdit (contrainte métier §04)                   | [[../04 - Data Model TMS]] `grilles_tarifaires_prestataires`         |
| W6 publication grille     | Active pour R2 calcul coût                                 | [[../05 - Règles métier TMS]] §R2                                    |
| W5 archivage chauffeur    | `audit_logs` obligatoire niveau 5 (mutation critique)      | §04 Auditabilité                                                     |
| W3 activation compte      | Workflow magic link Supabase                               | [[../09 - Authentification et permissions TMS]] §Workflow invitation |
| RLS sur E2 tab Chauffeurs | Manager prestataire = périmètre propre uniquement          | [[../09 - Authentification et permissions TMS]] §Policies            |

---

## 7. Edge cases

### EC1 — Tentative création SIRET doublon

- Erreur bloquante inline sur champ `siret`
- Message : "Ce SIRET existe déjà pour le prestataire {nom} (code: {code}). [Voir la fiche]"
- Pas de contournement UI — changer le SIRET ou éditer l'existant

### EC2 — Tentative création plaque déjà active

- Erreur bloquante inline sur champ `plaque`
- Message : "Cette plaque est déjà active chez {prestataire_nom} (véhicule créé le {date}). [Voir le véhicule]"
- Contournement : archiver d'abord l'ancien véhicule, puis créer le nouveau

### EC3 — Numéro permis doublon

- Alerte **info** non bloquante (bandeau jaune)
- Message : "Ce numéro de permis est déjà saisi sur {prenom nom} chez {prestataire}. Vérifiez qu'il s'agit bien d'une autre personne."
- Workflow passe si Admin TMS confirme

### EC4 — Archivage prestataire avec tournées actives

- Tunnel E8 étape 1 bloque
- Liste exhaustive affichée avec lien vers M02 Dispatch
- Admin TMS doit réattribuer ou clôturer chaque tournée avant de continuer

### EC5 — Changement de prestataire chauffeur : docs non copiés

- Message UI explicite à l'étape confirmation
- Si ancien chauffeur avait des docs uploadés, ils restent sur l'ancienne fiche (consultables en lecture audit pendant rétention 5 ans)
- Nouveau chauffeur = docs à re-uploader côté nouveau prestataire

### EC6 — Suppression d'un type véhicule utilisé

- Archivage bloqué
- Message : "Impossible d'archiver : {N} véhicules actifs utilisent ce type. Archivez d'abord les véhicules ou migrez-les vers un autre type."
- Pas de workflow de migration bulk V1 (à faire manuellement véhicule par véhicule)

### EC7 — Grille tarifaire en conflit (overlap)

- Erreur bloquante UI + DB (trigger)
- Liste les grilles existantes en conflit avec leurs périodes
- Contournement : ajuster `date_debut_validite` ou clôturer l'ancienne grille d'abord

### EC8 — Activation compte chauffeur avec email déjà existant dans `users_tms`

- Erreur bloquante inline
- Message : "Cet email est déjà utilisé par {prenom nom} ({role}). Un utilisateur ne peut avoir qu'un seul compte."
- Contournement : utiliser un autre email ou archiver l'ancien compte

### EC9 — Test connexion Everest échoue à l'activation

- Toggle reste off tant que test n'est pas passé
- Affichage erreur réseau / clé invalide / client non trouvé
- Admin TMS peut forcer "Activer sans tester" (cocher "J'ai vérifié la clé hors TMS") → flag + audit

### EC10 — Prestataire réactivé après suspension (avant J+30)

- Admin TMS clique "Réactiver" sur E2
- `statut = 'actif'`, `date_fin_contrat = NULL`
- `users_tms` associés → `statut = 'actif'` (reconnexion possible)
- Collectes futures peuvent à nouveau lui être attribuées
- Audit log `action='PRESTATAIRE_REACTIVATE'`
- **Grille expirée pendant la suspension — TOLÉRÉE** _(tranché Val 2026-06-07 test-scenarios floue #2, inverse de la reco)_ : la réactivation passe même si aucune grille active. Le scope de `trg_prestataire_grille_obligatoire` est restreint à la transition **`en_onboarding → actif`** (il ne se déclenche pas sur `suspendu → actif`). UI : bandeau warning persistant sur la fiche E2 "Grille expirée — republier dans M07 avant la prochaine tournée". Filet aval : tournée clôturée sans grille → coût M07 non calculable → `rapprochement_manuel_requis` M08 (R_M08.8). Pas de nouveau code alerte M11 (sobriété).

### EC11 — Contact facturation identique désynchronisé après édition

- Si toggle "Identique à opérationnel" activé à la création, les deux `jsonb` sont physiquement copiés
- Si Admin TMS modifie uniquement le contact opérationnel après coup, **le contact facturation ne bouge pas** (c'est voulu — on ne veut pas changer la facturation par accident)
- Pour resynchroniser : Admin TMS doit rééditer et recocher le toggle "Identique"

### EC12 — Suppression documents chauffeur par Ops Savr sans archivage

- Bouton "Supprimer documents sans archiver" sur E5
- Modal de confirmation : "Les documents permis et CNI seront supprimés du stockage. Cette action est irréversible. La fiche chauffeur reste active."
- `UPDATE chauffeurs SET permis_url=NULL, piece_identite_url=NULL`
- Physique : fichiers supprimés de Supabase Storage
- Audit log `action='CHAUFFEUR_DOCS_DELETE'`

### EC13 — Upload fichier > 5 Mo

- Refus côté client avant upload (validation taille)
- Message : "Fichier trop volumineux (max 5 Mo). Compressez le PDF ou utilisez une image JPEG."

### EC14 — Format fichier non PDF/JPEG

- Refus côté client
- Message : "Format non supporté. PDF ou JPEG uniquement."

---

## 8. États et transitions

### Prestataire (`shared.prestataires.statut`)

```
actif ─[Admin clique "Fin de contrat"]─→ suspendu ─[trigger J+30 OU Admin clique "Archiver maintenant"]─→ archive
  ↑                                         │
  └──[Admin clique "Réactiver"]─────────────┘
```

Transitions autorisées :

- `actif → suspendu` : Admin TMS via E8
- `suspendu → actif` : Admin TMS via bouton Réactiver sur E2
- `suspendu → archive` : trigger cron J+30 OU Admin TMS manuellement (bouton "Archiver maintenant" disponible pendant la suspension)
- `archive → *` : **interdit** (irréversible, sauf intervention DB Admin)

### Véhicule (`vehicules.statut`)

```
actif ─[clique "Archiver"]─→ archive (soft delete, irréversible via UI V1)
```

### Chauffeur (`chauffeurs.statut` + `users_tms.statut`)

```
actif ─[clique "Archiver"]─→ archive (soft delete)
  │
  └─[clique "Changer de prestataire"]─→ archive + création nouveau chauffeur autre prestataire
```

### Grille tarifaire (`grilles_tarifaires_prestataires.statut`)

```
brouillon ─[clique "Publier"]─→ actif ─[clique "Clôturer" OU date_fin_validite atteinte]─→ expire
```

---

## 9. Notifications

| Événement                             | Destinataire                                               | Canal                       | Template                                                                          |
| ------------------------------------- | ---------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| Prestataire créé                      | Admin TMS (bandeau UI)                                     | In-app                      | Toast vert                                                                        |
| Prestataire fin de contrat déclenchée | Manager prestataire (email à `contact_operationnel.email`) | Email                       | "Fin de contrat programmée — accès TMS suspendu à compter du {date}"              |
| Prestataire archivé auto J+30         | Admin TMS                                                  | Email + In-app              | "Prestataire {nom} archivé automatiquement. {N} tournées historiques conservées." |
| Prestataire réactivé                  | Manager prestataire                                        | Email                       | "Votre contrat a été réactivé. Vos accès TMS sont restaurés."                     |
| Chauffeur compte activé               | Chauffeur                                                  | Email (magic link Supabase) | "Bienvenue sur l'app Savr. Cliquez pour vous connecter : {magic_link}"            |
| Grille tarifaire publiée              | Admin TMS                                                  | In-app                      | Toast vert + log visible dans tab Grilles                                         |
| Test connexion Everest échoué         | Admin TMS                                                  | In-app                      | Bannière rouge                                                                    |

**Non V1** : alertes échéances documentaires (permis, CNI) → V2.

---

## 10. Performance cibles

| Action                                  | Cible                                         |
| --------------------------------------- | --------------------------------------------- |
| Chargement E1 (50 prestataires paginés) | < 800 ms p95                                  |
| Chargement E2 tabs                      | < 500 ms p95 par tab (requêtes indépendantes) |
| Test connexion Everest (API externe)    | timeout 5s, UI feedback loader                |
| Recherche full-text E1                  | < 300 ms p95 (index trigram PostgreSQL)       |
| Upload doc chauffeur (5 Mo)             | < 3s p95 (Supabase Storage direct upload)     |

---

## 11. Décisions structurantes prises

### D1 — Périmètre M06 = Admin TMS + Ops Savr uniquement

- **Décision** : M06 est un écran interne. Manager prestataire n'y accède jamais, utilise M03 Portail pour édition self-service.
- **Alternatives écartées** : UI unique M06 avec RLS restrictive pour Manager — rejeté car UX distincte (Manager a besoin de focus opérationnel, pas d'un écran chargé Admin).
- **Implication** : M03 devra dupliquer certains écrans (liste véhicules, liste chauffeurs, upload docs) en les simplifiant pour Manager. Acceptable V1, factorisable V1.1 en composants communs.
- **Lien** : cf. [[M03 - Portail prestataire self-service]] (à spécifier).

### D2 — Création prestataire = Admin TMS ; Création véhicules/chauffeurs = Admin TMS + Ops Savr (+ Manager via M03)

- **Décision** : onboarding d'un prestataire = acte contractuel → Admin TMS seul. Véhicules/chauffeurs = opérationnel quotidien → Ops Savr peut agir, Manager également via M03.
- **Alternatives écartées** : Ops Savr peut créer un prestataire (rejeté : trop de risque de doublons non qualifiés) ; seul Admin TMS partout (rejeté : bloque Ops en urgence terrain).
- **Implication** : policies RLS §09 à finaliser pour traduire cette répartition (déjà spec §09).

### D3 — Grilles tarifaires : Admin TMS seul

- **Décision** : édition + publication réservées Admin TMS. Ops Savr lecture seule.
- **Alternatives écartées** : workflow 4 yeux (Admin → valide par un autre Admin) — rejeté, trop lourd V1 pour un volume faible (~30 prestataires, MAJ annuelle). Audit_logs suffit.
- **Implication** : seed data grilles = étape dédiée Admin TMS dans onboarding, pas parallélisable avec Ops.

### D4 — Catalogue `types_vehicules` : Ops Savr gère

- **Décision** : Ops Savr peut ajouter / éditer / archiver un type. Justifié par la fréquence (cas province avec véhicules spécifiques) et l'urgence terrain.
- **Alternatives écartées** : réservé Admin TMS — rejeté, crée friction inutile alors que l'impact financier est limité (matching grille se fait par `type_vehicule_id`, pas par label).
- **Garde-fou** : archivage bloqué si véhicules actifs utilisent le type.

### D5 — Archivage prestataire J+30 auto + blocage si tournées actives

- **Décision** : workflow E8 en 3 étapes, blocage en amont si tournées actives, trigger cron J+30 pour passage archive.
- **Alternatives écartées** : archivage immédiat sans délai — rejeté, risque de coupure sèche pour Manager en cours de journée. Auto-réattribution tournées futures — rejeté, trop magique, Ops doit garder le contrôle.
- **Implication** : colonne `date_fin_contrat` à ajouter dans `shared.prestataires` (§04 propagation).

### D6 — V1 = permis + CNI uniquement, pas d'alertes échéance documentaires

- **Décision** : retrait V1 des champs `assurance_date_fin`, `assurance_document_url` (`vehicules`), `visite_medicale_date_fin` (`chauffeurs`). Pas d'alerte J-30 sur aucun document. À reprendre V2.
- **Alternatives écartées** : alertes passives non bloquantes — rejeté par Val pour simplicité max V1.
- **Implication §04 Data Model** : retrait de 3 colonnes. Propagation nécessaire.

### D7 — Seed MTS-1 par saisie unitaire manuelle Admin TMS

- **Décision** : pas d'import CSV, pas de script SQL. Saisie via UI M06 directement.
- **Alternatives écartées** : import CSV (rejeté : développer l'importeur coûte plus que saisir) ; SQL dump (rejeté : contrôle qualité moins bon que passage main).
- **Implication** : prévoir 3-5 jours Admin TMS pour seed initial. UI doit être ergonomique (autocomplete adresse, raccourcis clavier, dupliquer prestataire).
- **Précision §13 (propagation 2026-04-27)** : décision §13 D6 confirme saisie directe M06 (pas wizard M13 E7) pour les 30 prestataires V1. Checklist seed M06 stricte 16 champs obligatoires à respecter par Admin TMS, revue croisée Val/Louis sur Strike + Marathon. Cf. [[13 - Migration MTS-1#W1 — Seed référentiel (J-60 → J-15)]].

### D8 — Unicité SIRET strict / plaque active / permis sans contrainte

- **Décision** : SIRET unique strict global (bloquant). Plaque unique active globale (bloquant, réutilisable après archive). Numéro permis sans contrainte DB (alerte info UI seulement).
- **Alternatives écartées** : plaque unique par prestataire (rejeté : une plaque = un camion, pas deux prestataires) ; permis unique strict (rejeté : saisie manuelle peu fiable, faux positifs probables).

### D9 — Changement prestataire chauffeur = soft delete + création nouveau

- **Décision** : UI bouton "Changer de prestataire" → archive ancien + création neuf (pas de copie docs, pas de copie compte).
- **Alternatives écartées** : modification FK `prestataire_id` (rejeté : casse historique tournées) ; table pivot `chauffeurs_prestataires_history` (rejeté : complexité injustifiée V1).
- **Implication** : numero_permis doublon alerté info (non bloquant) à la création du nouveau.

### D10 — 2 contacts typés opérationnel + facturation (jsonb séparés)

- **Décision** : remplacement du champ unique `contact_principal` par 2 colonnes `contact_operationnel jsonb` + `contact_facturation jsonb`. Toggle UI "Identique" → copie physique à la saisie.
- **Alternatives écartées** : table séparée `prestataire_contacts` (rejeté : complexité injustifiée, 95% des cas = 1 ou 2 contacts) ; 1 seul contact (rejeté : facturation séparée courante).
- **Implication §04 Data Model** : colonne `contact_principal` à remplacer par 2 colonnes. Propagation nécessaire.

### D11 — Zone géographique : rayon_km depuis coords siège

- **Décision** : 1 seul champ `rayon_intervention_km`. Calcul haversine depuis `coords_siege_lat/lng`.
- **Alternatives écartées** : liste de départements couverts (rejeté : saisie plus lourde, peu de valeur ajoutée V1).

### D12 — Upload docs chauffeur non bloquant pour activation compte

- **Décision** : permis et CNI restent optionnels même si le chauffeur a un compte app mobile actif. Activation découplée de la complétude documentaire.
- **Alternatives écartées** : blocage activation compte si docs absents — rejeté par Val, priorité V1 = démarrer vite, complétude = V2.

### D13 — Intégration Everest : toggle contextuel fiche prestataire avec test API

- **Décision** : E9 sous-onglet de E2. Toggle + champ `everest_client_id` + bouton test connexion.
- **Alternatives écartées** : config centrale M13 (rejeté : éloigne la config du contexte prestataire) ; modal séparée (rejeté : moins visible).

---

## 12. Questions ouvertes

1. — **Résolu (propagation M06 2026-04-24)** : `date_fin_contrat date` présent §04 TMS `shared.prestataires` ligne 1578 + section Plateforme ligne 1750. Trigger cron archivage indexé sur `(date_fin_contrat) WHERE statut = 'suspendu'`.
2. — **Re-fermé (revue sobriété §04 2026-04-30 A3)** : 2 colonnes **supprimées V1** suite duplication avec `tms.integrations_logs`. Affichage UI fiche prestataire + M13 E6 santé API → vue dérivée `tms.vue_prestataires_everest_status` qui lit `integrations_logs(system='everest', type_event='m14_ping')`. Spec vue détaillée §04 Niveau 1 `shared.prestataires`.
3. — **Résolu (propagation M06 2026-04-24)** : `vehicules.assurance_date_fin` retiré V1 §04 ligne 1900 (strikethrough + note V2). `chauffeurs.visite_medicale_date` retiré V1 §04 ligne 1827. `vehicules.assurance_document_url` retiré dans même propagation.
4. — **Résolu (propagation M06 2026-04-24)** : `contact_operationnel jsonb` + `contact_facturation jsonb` présents §04 TMS lignes 1568-1569 (TMS) + 1739-1740 (Plateforme cross-schema). `contact_principal` supprimé.
5. — **Fermé (revue sobriété M06 2026-06-05)** : documenté §07 Architecture (pg_cron) + §14 Scalabilité, référencé §13 Liens (ligne ~785). Trigger indexé `(date_fin_contrat) WHERE statut = 'suspendu'`.
6. — **Fermé / confirmé V1 (revue sobriété M06 2026-06-05, décision Val)** : bouton présent sur E2 header (visible si `statut = suspendu`), passage immédiat `archive` + soft delete `users_tms` + audit `PRESTATAIRE_ARCHIVE_MANUEL`. Cohérent avec transition §8 + §05 R6 ligne 835.
7. — **Fermé (revue sobriété A2 2026-04-30)** : supprimé V1, export SQL Admin si besoin ponctuel.
8. — **Fermé (revue sobriété M06 2026-06-05 B3)** : pas de fonction DB `validate_formule_parametres()`. Validation côté application (Zod dérivé de `schema_parametres`), écrivain unique Admin TMS de confiance, contraintes dures restent en DB (overlap EXCLUDE, NOT NULL, FK, triggers grille-obligatoire / anti-expiration §04).
9. — **Fermé (revue sobriété A1 2026-04-30)** : mini-map supprimée V1 (aucun comportement applicatif, librairie carte non justifiée pour ~30 prestataires). Geocoding Nominatim backend sur save suffit pour coords M12. Vue carte reportée V2.
10. — **Fermé (revue sobriété M06 2026-06-05)** : **aucune contrainte ni garde-fou V1** (simplicité max). Unicité bornée aux plaques actives (`deleted_at IS NULL AND statut = 'actif'`, cf. E4/EC2). Une plaque archivée est réutilisable immédiatement. Garde-fou "< 6 mois" reporté si besoin terrain avéré.

---

## 13. Liens

- [[../04 - Data Model TMS]] — tables `shared.prestataires`, `vehicules`, `chauffeurs`, `types_vehicules`, `grilles_tarifaires_prestataires`, `formules_catalogue`, `users_tms`
- [[../05 - Règles métier TMS]] — R1 attribution (utilise prestataires), R2 calcul coût (utilise grilles), R6 cycles de vie (statuts prestataires)
- [[../08 - Contrat API Plateforme-TMS]] — aucun endpoint direct M06 (référentiel privé TMS, pas exposé Plateforme sauf lecture `shared.prestataires` cross-schema)
- [[../09 - Authentification et permissions TMS]] — policies RLS par table, workflow invitation magic link, suspension 30j fin contrat
- [[../07 - Architecture technique TMS]] — stockage docs (Supabase Storage pour permis/CNI légers), trigger archivage J+30 (pg_cron)
- [[M01 - Réception ordres de collecte]] — consommateur `shared.prestataires`
- [[M02 - Dispatch Ops Savr]] — consommateur pour suggestions attribution
- [[M04 - Gestion des tournées]] — consommateur véhicules + chauffeurs
- [[M03 - Portail prestataire self-service]] — miroir self-service Manager (à spécifier)
- [[M07 - Pilotage financier logistique]] — consommateur grilles tarifaires
- [[M14 - Intégration Everest (A Toutes!)]] — consommateur `everest_client_id`
- [[../../01 - Cahier des charges App/04 - Data Model]] — `shared.prestataires` (lecture cross-schema Plateforme)
- [[../../01 - Cahier des charges App/09 - Authentification et permissions]] — policies lecture cross-schema

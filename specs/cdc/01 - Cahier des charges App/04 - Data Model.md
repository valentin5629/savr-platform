# 04 - Data Model


---

## ⚠ Addendum architectural 2026-04-23 — Schémas PostgreSQL

**Suite à l'atelier tech avec le frère de Val 2026-04-23**, l'architecture retient **1 seul projet Supabase** hébergeant **3 schémas PostgreSQL distincts** :

- **`plateforme.*`** — toutes les 28 tables décrites dans ce document (sauf mention contraire ; +1 = `outbox_events` ajoutée audit RLS V1 2026-06-05, garde-fou 4 ; +2 = `email_templates`/`emails_envoyes` intégrées 2026-06-07, F1 session test-scenarios §06.02). Exemples : `plateforme.organisations`, `plateforme.evenements`, `plateforme.collectes`, `plateforme.packs_antgaspi`, `plateforme.factures`, etc.
- **`tms.*`** — tables propres au TMS (voir [[../02 - Cahier des charges TMS/04 - Data Model TMS]]).
- **`shared.*`** — tables cross-domain accessibles aux deux applications via policies RLS explicites. V1 : **`shared.fichiers`** (référentiel multi-provider Supabase Storage / Cloudflare R2) + **`shared.prestataires`** (table unique prestataires logistiques, seconde salve 2026-04-23 — cf. addendum ci-dessous).

**Convention de lecture de ce document** : toutes les tables décrites ci-après sont implicitement préfixées par `plateforme.` dans le schéma réel (ex: `organisations` = `plateforme.organisations`). Les FK cross-schema restent interdites (les UUID sont partagés sans contrainte DB, la cohérence est maintenue par le contrat API HMAC). Les FK vers `shared.fichiers` et `shared.prestataires` sont les seules exceptions autorisées.

**RLS cross-schema** : aucun rôle Plateforme n'a accès en lecture/écriture au schéma `tms.*` et inversement (policies `USING (false)` au niveau des schémas non autorisés). Validé par tests pgTAP bloquants CI. Voir [[09 - Authentification et permissions]].

---

## ⚠ Addendum 2026-04-23 (seconde salve) — Retournements prestataires et lieux

Issus de l'arbitrage M01 seconde salve (ref. [[06 - Fonctionnalités détaillées/M01 - Réception ordres de collecte]]). Objectif : éliminer les doubles saisies Plateforme/TMS et simplifier la cohérence.

### Retournement 1 — Prestataires logistiques : table unique `shared.prestataires`

**Décision D14 M01** : la table `plateforme.prestataires_logistiques` décrite §"Table : prestataires_logistiques" **est migrée vers `shared.prestataires`**. Source de vérité unique. Une seule saisie, écriture depuis le TMS (M06 Référentiel prestataires), lecture Plateforme via RLS cross-schema.

- **Écriture** : rôles TMS (`admin_tms`, `ops_savr` restreint aux champs identité) — policies §09.
- **Lecture Plateforme** : rôles `admin_savr`, `ops_savr` (ce rôle est le même côté Plateforme et TMS, cf. atelier tech — Ops Savr a `app_domain` = deux contextes possibles) via policy `USING (true)` en lecture seule.
- **Schéma `shared.prestataires` — définition canonique = [[../02 - Cahier des charges TMS/04 - Data Model TMS]] §1 (rappel corrigé 2026-06-11, audit data model : la description ci-dessous divergeait du schéma réel sur 4 colonnes)**. Colonnes effectives : fusion `plateforme.prestataires_logistiques` + `tms.prestataires` avec, en cas de divergence, la forme TMS qui fait foi — **`type_prestation text[]`** valeurs `zd`/`ag` (et non l'ex-enum `zero_dechet|anti_gaspi|mixte`), **`statut`** 3 valeurs `actif|suspendu|archive` (et non un boolean `actif`), **`adresse_siege jsonb`** (et non `adresse` text), **`commentaire_interne`** (singulier) ; + `mode_integration`, `api_config`, `siret`, `tva_intracom`, `contact_operationnel`/`contact_facturation` jsonb, timestamps, et les colonnes opérationnelles TMS (`rayon_intervention_km`, `coords_siege_lat/lng`, `integration_externe`, `everest_client_id`, `has_portail_self_service`, `date_fin_contrat`, `nb_collectes_6_mois_cache`). Les champs "grille tarifaire" restent dans `tms.grilles_tarifaires_prestataires` (logistique pure). Tout code Plateforme lisant cette table utilise `statut = 'actif'` (jamais `actif = true`).
- **Propagation M06 (2026-04-24)** — changements schéma `shared.prestataires` :
  - Remplacement champ unique `contact_principal jsonb` → 2 colonnes `contact_operationnel jsonb` + `contact_facturation jsonb` (toggle UI "Identique" copie physique à la saisie, pas de re-sync auto).
  - Ajout `date_fin_contrat date` (NULL sauf pendant suspension 30j — trigger cron journalier pour archivage automatique).
  - Ajout `last_everest_ping_at timestamptz` + `last_everest_ping_status text` (test connexion API Everest contextuel).
  - Détail complet : [[../02 - Cahier des charges TMS/04 - Data Model TMS]] §Table prestataires + [[../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées TMS/M06 - Référentiel prestataires]].
- **Propagation M12 (2026-04-24, MAJ A1 2026-04-25)** — ajout colonne `shared.prestataires.nb_collectes_6_mois_cache integer NOT NULL default 0` + index `(type_prestation, statut, nb_collectes_6_mois_cache)`. Cache mis à jour par trigger DB `AFTER INSERT/UPDATE` sur `tms.collectes_tms` quand `statut_dispatch IN ('attribuee_en_attente_acceptation','acceptee','en_attente_execution')` (propagation A1 2026-04-25 — alignement enum `statut_dispatch` 6 valeurs sur vocabulaire M03). Purge glissante via cron daily (soustrait collectes > 6 mois). Sert au tri secondaire province multi-candidats (cf. [[../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées TMS/M12 - Attribution transporteur]] §4.4 + §4.7). Lecture cross-schema Plateforme autorisée, écriture exclusivement via trigger TMS.
- **Plateforme** : toutes les FK historiques (`collectes.prestataire_logistique_id`, `tournees.prestataire_logistique_id`, `bordereaux_savr.prestataire_logistique_id`, etc.) référencent désormais `shared.prestataires.id` — unique FK cross-schema autorisée vers `shared`.
- **Traiteurs** : décision D17 — **pas** de retournement. `plateforme.traiteurs` reste Plateforme-only, TMS accède uniquement en lecture via `collectes.traiteur_id` passé dans les webhooks (snapshot).

### Retournement 2 — Lieux : enrichissement logistique cross-schema (Option C)

**Décision D16 M01** : `plateforme.lieux` **reste Plateforme** (source de vérité, création depuis workflow événement Plateforme). Le TMS peut **enrichir** 2 colonnes logistiques existantes via RLS cross-schema column-level, sans endpoint API.

> ⚠ **Refonte 2026-04-28 (audit cohérence inter-CDC A2)** : décision révisée — fusion sur les colonnes existantes `acces_details` + `acces_office` plutôt qu'ajout de 4 nouvelles colonnes. Suppression simultanée de `lieux.contact_nom/telephone/email` (problème métier : un même lieu est utilisé par plusieurs traiteurs et les contacts dépendent du couple lieu × traiteur, pas du lieu seul). Les contacts terrain transitent désormais via `evenements.contact_principal_*` + `contact_secours_*` (déjà existants), saisis par le traiteur à la programmation et transmis au TMS via le payload E1.

| Colonne `plateforme.lieux` | Type | RW Plateforme | RW TMS | Utilité |
|----------------------------|------|---------------|--------|---------|
| `acces_details` | text | Admin Savr | Ops + Admin TMS (via column-level GRANT) | Instructions accès : badge, code, interphone, contact gardien, **digicode/bip parking** (ex-`code_acces`), **notes stationnement texte libre** (ex-`parking`). Champ "carnet d'accès terrain" partagé Plateforme commercial + TMS opérationnel. |
| `acces_office` | text | Admin Savr | Ops + Admin TMS (via column-level GRANT) | Instructions accès office/cuisine/zone récup déchets, **horaires livraison/ascenseur/notes chauffeur** (ex-`instructions_chauffeur`). Champ "carnet terrain office" partagé. |

**Colonnes addendum supprimées** (2026-04-28 — fusion mapping) :
- → fusionné dans `acces_details`
- → fusionné dans `acces_details` (`stationnement` enum existant reste sur l'aspect commercial type-emplacement)
- → fusionné dans `acces_office`
- → supprimé, contacts relogés sur `evenements.contact_principal_*` + `contact_secours_*` (cf. note règle métier ci-dessus)

**Colonnes `plateforme.lieux` supprimées** (2026-04-28 — relogement contacts) :
- → relogé sur `evenements.contact_principal_nom` / `contact_secours_nom`
- → relogé sur `evenements.contact_principal_telephone` / `contact_secours_telephone`
- → supprimé (non utilisé en pratique, le téléphone seul suffit le jour J — si besoin V1.1, ajouter `evenements.contact_principal_email`)

**Policy RLS révisée** : `GRANT UPDATE (acces_details, acces_office) ON plateforme.lieux TO tms_logistics_writer` (rôle Postgres attribué aux users `app_domain='tms'` ET `admin_tms|ops_savr`). Toutes les autres colonnes restent deny write depuis TMS. Détail §09.

**Propagation collectes TMS** : cf. décision D15 — chaque collecte stocke un `lieu_snapshot` JSONB figé dans `tms.collectes_tms` (photo au moment T). Composition révisée 2026-04-28 : `{adresse, coords, acces_details, acces_office, stationnement, contraintes_horaires, type_vehicule_max, volume_max_bacs}`. **Les contacts ne sont PAS dans le snapshot** — ils sont transmis dans le payload E1 séparément (`contact_principal` + `contact_secours`) et figés sur `tms.collectes_tms` dans des colonnes dédiées (cf. §04 TMS).

**Endpoint E5 `PATCH /lieux/:id`** : allégé. Sert uniquement à notifier le TMS qu'un champ critique du lieu (adresse, coords) a changé côté Plateforme, pour déclencher l'alerte "snapshot divergent" côté M02 (bouton de synchro). Voir [[08 - APIs et intégrations]].

### Impact collectes TMS (cf. [[../02 - Cahier des charges TMS/04 - Data Model TMS]])

M01 seconde salve ajoute 2 colonnes sur `tms.collectes_tms` pour matérialiser le snapshot lieu et la sérialisation des events :

- `lieu_snapshot` (JSONB, NOT NULL) — photo figée du lieu à la création.
- `last_occurred_at` (TIMESTAMPTZ, NOT NULL) — horodatage du dernier event appliqué (skip out-of-order si event reçu ≤ cette valeur).

→ **Colonne `attribuee_source` SUPPRIMÉE V1** *(sobriété M01 B_M01_04 + D_M01_03 — 2026-04-30 ; auto-relance M12 W3 retirée → enum à 1 valeur = colonne morte)*. À ne pas créer.

### Impact suppression pré-affectation

**Décision D10 M01 supprimée 2026-04-23**. Plus de `prestataire_id_pre_affecte` dans les payloads Plateforme → TMS. Toutes les collectes arrivent en `statut_dispatch='a_attribuer'`. Les règles d'attribution forte (ex : "client X = toujours Strike") vivent dans M12 TMS (paramétrable). Impact §08 : retrait de ce champ du payload E1 `POST /collectes`.

---

## ⚠ Addendum 2026-04-24 (propagation M03 TMS) — Plaque requise par traiteur — **RESTAURÉ 2026-05-01 — RENOMMÉ + ÉTENDU 2026-05-03**


> **NOTE 2026-05-01** : addendum **restauré V1** suite à l'audit cohérence inter-CDC pré-handoff (annulation revue sobriété M05 2026-04-29 + Bloc C C3). La chaîne complète `plaque_requise` est réactivée cross-CDC : `lieux.plaque_requise_default` + `collectes.plaque_requise` (Plateforme) + `tms.collectes_tms.plaque_requise` + `tms.tournees.plaque_preassignee_manager` + trigger DB `validate_tournee_plaque_requise` (R_M04.PLAQUE) + R_M03.4 (§05 TMS) + workflow M03 E4 + payload E1 enrichi + webhook S7 `plaque-saisie` (Option B Val : émis à la saisie manager M03 E4 uniquement, plaque chauffeur terrain M05 reste TMS-only). **Exception A Toutes! vélo cargo** : trigger TMS autorise validation tournée même si `plaque_requise=true` (pas de plaque attribuable), message UX inline formulaire programmation Plateforme alerte le traiteur ("Vélo cargo — pas de plaque possible"). Note 2026-04-29 antérieure (suppression V1) annulée.

Issu de la rédaction de [[../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées TMS/M03 - Portail prestataire self-service]] (V1 rédigée 2026-04-24, décision D8 M03 + sous-décision Q8.1 = toggle niveau lieu par défaut, override par collecte possible).

**Cas d'usage** : certains traiteurs opèrent sur des sites sécurisés (enceintes Viparis, sièges avec PC sécurité, quais industriels) où le véhicule qui viendra doit être identifié à l'avance par sa plaque. Ces sites sont typiquement toujours concernés (digicode, liste blanche véhicules autorisés). Le toggle par défaut du lieu évite de re-cocher à chaque programmation de collecte.

### Nouvelle colonne `plateforme.lieux.plaque_requise_default` → renommée `controle_acces_requis_default` (2026-05-03 — bloc ci-dessous conservé pour traçabilité, voir table `lieux` + addendum renommage)

| Colonne | Type | Défaut | Écriture | Utilité |
|---------|------|--------|----------|---------|
| `plaque_requise_default` | boolean | `false` | Plateforme (Admin Savr via référentiel lieu) | Valeur par défaut propagée à chaque nouvelle collecte créée sur ce lieu. Si `true`, la collecte héritera `plaque_requise=true` sauf override explicite au formulaire de programmation |

### Nouvelle colonne `plateforme.collectes.plaque_requise` → renommée `controle_acces_requis` (2026-05-03 — bloc ci-dessous conservé pour traçabilité, voir table `collectes` + addendum renommage)

| Colonne | Type | Défaut | Utilité |
|---------|------|--------|---------|
| `plaque_requise` | boolean | `lieux.plaque_requise_default` (copié à la création de la collecte) | Valeur effective propagée au TMS via E1. Override par collecte possible au formulaire de programmation (traiteur peut activer ponctuellement même sur lieu normalement non-sécurisé, ou désactiver ponctuellement) |

**Règle de copie** : au `INSERT INTO collectes`, la valeur par défaut est `COALESCE(NEW.plaque_requise, lieux.plaque_requise_default)`. Si l'utilisateur coche/décoche explicitement, sa valeur l'emporte.

### Impact UX Plateforme

- **Formulaire programmation collecte** : ajout case à cocher "Recevoir la plaque du véhicule à l'avance" initialement pré-cochée si `lieu.plaque_requise_default=true`, décochable par traiteur
- **Dashboard client traiteur** : nouveau bloc "Véhicule qui viendra" affiché **uniquement** si `plaque_requise=true` et plaque déjà connue (lu depuis webhook S7 `plaque-saisie` TMS→Plateforme). Template visuel : "Votre collecte du [date] sera effectuée par le véhicule [plaque]."
- **Pas d'email traiteur V1** (décision Q8.2 : dashboard seul V1, email traiteur V2)
- **Pas de re-notification traiteur V1** si la plaque change post-acceptation (décision Q8.3 : manager prestataire peut changer, Ops Savr notifié, traiteur V2)
- **Formulaire lieu côté Admin Savr** : ajout toggle `plaque_requise_default` dans la section sécurité/accès

### Impact §06 Programmation collecte

Addendum à [[06 - Fonctionnalités détaillées/M-Programmation collecte]] : documenter la case à cocher côté formulaire traiteur + son comportement par défaut.

### Impact §08 Contrat API

Payload E1 `POST /tms/collectes` (webhook Plateforme→TMS) enrichi avec le champ `plaque_requise BOOLEAN`.

### Impact TMS

- [[../02 - Cahier des charges TMS/04 - Data Model TMS]] — nouvelle colonne `tms.collectes_tms.plaque_requise BOOLEAN` miroir
- [[../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées TMS/M03 - Portail prestataire self-service]] — R_M03.4 plaque conditionnelle niveau lieu + R_M04.PLAQUE trigger blocage validation tournée si plaque manquante (sauf exception A Toutes! vélo cargo)
- [[../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées TMS/M04 - Gestion des tournées]] — validation pré-dispatch M05 (blocage si véhicule manquant + plaque requise)
- [[../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées TMS/M05 - App mobile chauffeur]] — plaque éditable avec warning si pré-assignée

---

## ⚠ Addendum 2026-05-03 (refonte formulaire §06.01) — Renommage controle_acces + cascade lieu + table lieux_modifications_en_attente + type_evenement_libre

Issu de la refonte du formulaire de programmation de collecte ([[06 - Fonctionnalités détaillées/01 - Formulaire de programmation de collecte]]) — propagations data model en cascade.

### 1. Renommage `plaque_requise` → `controle_acces_requis` (sémantique étendue plaque + nom chauffeur)

- **`plateforme.lieux.plaque_requise_default`** → **`plateforme.lieux.controle_acces_requis_default`** (cf. table `lieux` ci-dessous)
- **`plateforme.collectes.plaque_requise`** → **`plateforme.collectes.controle_acces_requis`** (cf. table `collectes` ci-dessous)
- **`tms.collectes_tms.plaque_requise`** → **`tms.collectes_tms.controle_acces_requis`** (cf. [[../02 - Cahier des charges TMS/04 - Data Model TMS]])
- **Payload E1 `POST /tms/collectes`** : champ renommé `plaque_requise` → `controle_acces_requis` (cf. [[08 - APIs et intégrations]])
- **Trigger DB TMS** : `validate_tournee_plaque_requise` → `validate_tournee_controle_acces` (cf. [[../02 - Cahier des charges TMS/05 - Règles métier TMS]] R_M04.CONTROLE_ACCES, ex R_M04.PLAQUE)

**Sémantique étendue** : si `controle_acces_requis=true`, le manager prestataire doit pré-saisir **plaque ET nom chauffeur** en M03 E4 du portail prestataire TMS. Le trigger TMS bloque la validation tournée si l'un des deux manque (sauf exception A Toutes! vélo cargo). Côté Plateforme, le bloc dashboard traiteur "Véhicule qui viendra" est renommé "Contrôle d'accès" et affiche plaque + nom chauffeur (lus depuis `tournees.plaque_immatriculation` + `tournees.chauffeur_nom`).

### 2. Cascade lieu upgrade-only (R_controle_acces_cascade)

Nouvelle règle métier — si un traiteur **coche** la case "Plaque + nom chauffeur requis" au formulaire de programmation alors que `lieux.controle_acces_requis_default = false`, le lieu est **mis à jour** à `true` (cascade upgrade). Impacte tous les futurs traiteurs qui programmeront une collecte sur ce lieu.

Si un traiteur **décoche** la case alors que le défaut lieu est `true`, **PAS d'update lieu** (la collecte courante porte `false`, le lieu reste `true` pour les futurs). Le downgrade reste un acte Admin uniquement (via le formulaire de gestion des lieux).

**Implémentation** : trigger DB `AFTER INSERT/UPDATE` sur `plateforme.collectes` :
```sql
IF NEW.controle_acces_requis = true
  AND (SELECT controle_acces_requis_default FROM plateforme.lieux WHERE id = NEW.lieu_id) = false
THEN
  UPDATE plateforme.lieux SET controle_acces_requis_default = true WHERE id = NEW.lieu_id;
END IF;
```

Voir détail dans [[05 - Règles métier#R_controle_acces_cascade]].

### 3. Modification d'un lieu au formulaire → override collecte + signalement Admin *(simplifié 2026-05-25, audit sobriété §04 B1)*

> ⚠ **Simplification 2026-05-25 (audit sobriété §04, B1)** : la table `lieux_modifications_en_attente` et sa machine à états (`en_attente`/`validee`/`rejetee` + `validee_par`/`validee_le`/`motif_rejet`) sont **supprimées**. Motif : workflow d'approbation formel surdimensionné pour un cas que le métier qualifie de rare. Remplacé par : **override per-collecte** (`collectes.lieu_overrides`) + **signalement Admin léger** (notification, pas de table dédiée).

**Comportement V1** : lorsqu'un programmeur modifie une info d'un lieu existant au formulaire de programmation :

1. Les nouvelles valeurs sont stockées sur la **collecte courante** dans `collectes.lieu_overrides` (jsonb, override per-collecte, utilisé immédiatement et transmis au TMS via E1 pour figer `tms.collectes_tms.lieu_snapshot`). Le `lieux` officiel n'est **pas** modifié (les autres programmeurs continuent de voir la valeur de référence).
2. Une **notification Admin Savr** est émise (le diff avant/après est lisible dans `lieu_overrides` + tracé dans `audit_log`).
3. L'Admin, s'il juge la correction pérenne, **édite le lieu directement** dans le back-office lieux existant (§06). Aucune action requise sinon — la collecte garde son override.

**Worklist Admin** (remplace l'ex-écran "modifs en attente") : vue filtrée sur les collectes récentes dont `lieu_overrides IS NOT NULL` et dont une valeur diffère encore du `lieux` officiel. Auto-résolutive : dès que l'Admin aligne le lieu, l'écart disparaît de la liste. Pas de flag d'état à maintenir.

**Override** : porté par `collectes.lieu_overrides jsonb` (option b, désormais actée et définie dans la table `collectes`). Format clé/valeur : `{"adresse_acces": "...", "stationnement": "difficile", ...}`.

### 4. Nouveau champ `evenements.type_evenement_libre` **Retiré V1 (propagation Sujet 4 — type vs taille, 2026-05-26)**

>
>
> **Retiré V1 (Sujet 4, 2026-05-26)** : le mécanisme « Autre + texte libre + normalisation » est supprimé. `types_evenements` est figé à **4 catégories** (`cocktail apéritif`, `cocktail repas complet`, `repas assis`, `autre`). `autre` devient une **catégorie fourre-tout sélectionnable sans saisie** (pas de champ texte, pas de file de normalisation Admin). La colonne `evenements.type_evenement_libre` est supprimée, la règle `R_type_evenement_libre` (§05) est retirée. Extension future = ajout direct d'une ligne dans `types_evenements` (Supabase), sans UI dédiée.

### 5. Suppression `evenements.heure_debut` + `evenements.heure_fin`

Voir table `evenements` ci-dessous. La notion d'horaire événement (début + fin) est supprimée V1. Seule reste l'**heure de collecte** (point fixe par collecte) sur `collectes.heure_collecte` (déjà en place depuis 2026-04-29).

**Impact rapports / dashboards** : tous les écrans qui affichaient "Cocktail 18h→22h" doivent être actualisés pour n'afficher que la date événement + l'heure de collecte. Cf. [[11 - Dashboards]] + [[12 - Reporting et exports]] + [[06 - Fonctionnalités détaillées/06 - Back-office Admin Savr]] (ligne 79 référence `heure_debut` à corriger).

### 6. Seed `types_evenements.autre` *(reformulé Sujet 4, 2026-05-26)*

Voir table `types_evenements` ci-dessous. **Reformulé (Sujet 4, 2026-05-26)** : `autre` est une **catégorie fourre-tout sélectionnable sans saisie de texte**. Aucun champ libre déverrouillé, aucune notification de normalisation. Les événements `autre` sont comptés comme un bucket benchmark normal.

---

## ⚠ Addendum 2026-05-06 — Indicateur Taux de recyclage (ZD-only, formule à captation par filière)

Introduction d'un indicateur de référence unique **Taux de recyclage** affiché dans tous les espaces clients (traiteur, gestionnaire, Back-office Admin) et le PDF Rapport RSE par collecte. Remplace les notions historiques floues "Taux de recyclage" (sans formule explicite) et "Taux de valorisation" (supprimée).

### 1. Périmètre

- **ZD-only** : l'indicateur n'a de sens que sur les collectes ZD (basé sur les 5 pesées des flux ZD V1). Toutes les références AG sont supprimées (cf. §11 Dashboards + §12 Reporting + §06.04).
- **Une seule métrique** : suppression définitive de la notion "Taux de détournement" et "Taux de valorisation". Vocabulaire UI / PDF / CGU unifié sur "Taux de recyclage".

### 2. Formule officielle (V1)

```
Taux de recyclage = [(P_verre × cap_verre) + (P_carton × cap_carton) + (P_bio × cap_bio) + (P_emb × cap_emb)] / (P_verre + P_carton + P_bio + P_emb + P_omr) × 100
```

Où :
- `P_X` = poids réel collecté du flux X (en kg, source `collecte_flux.poids_reel_kg`)
- `cap_X` = taux de captation effectif de la filière X (decimal entre 0 et 1, source `parametres_taux_recyclage.taux_captation`)
- L'OMR (`dechet_residuel`) entre uniquement au dénominateur (par définition non valorisée matière). Pas de captation associée. La valorisation énergétique éventuelle (UIOM) est hors scope V1 (report V2).

**Cas particuliers** :
- Si total pesées = 0 → afficher `—` (pas de division, pas de "0 %")
- Si un flux n'est pas collecté sur l'événement (P_X = 0) → n'impacte pas le calcul (terme nul au numérateur ET dénominateur)
- Si total > 0 mais aucun flux valorisé (uniquement OMR) → `Taux de recyclage = 0 %`

### 3. Nouvelle table `parametres_taux_recyclage` (Niveau 2 Référentiel)

Une ligne par filière. **Granularité Niveau 1 (MVP)** : 4 lignes globales Savr (extensible V2 vers `prestataire_id` + V3 vers `couple lieu × filière`).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `code_filiere` | enum | NOT NULL, UNIQUE | `verre` \| `carton` \| `biodechet` \| `emballage` (cohérent `flux_dechets.code` sauf `dechet_residuel` exclu) |
| `nom_filiere` | text | NOT NULL | Libellé UI (ex: "Verre", "Carton", "Biodéchets", "Emballages") |
| `taux_captation` | decimal(5,4) | NOT NULL, CHECK 0 ≤ x ≤ 1 | Valeur entre 0 et 1 (ex: 0.9600 pour 96 %) |
| `prestataire` | text | | Texte libre — prestataire associé V1 (ex: "Citeo", "Veolia/A Toutes!"). Évolutif V2 vers FK. |
| `source_donnee` | text | | Référence source (ex: "Citeo 2023", "ADEME ITOM 2017") |
| `commentaire` | text | | Notes Admin |
| `actif` | boolean | NOT NULL, défaut `true` | Permet désactivation sans suppression (audit trail conservé) |
| `date_maj` | timestamptz | NOT NULL | Date de la dernière modification effective du taux |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Seed V1 (4 lignes — moyennes nationales)** :

| code_filiere | nom_filiere | taux_captation | source_donnee |
|--------------|-------------|----------------|---------------|
| `verre` | Verre | 0.9600 | Citeo 2023 |
| `carton` | Carton | 0.9000 | Citeo 2023 |
| `biodechet` | Biodéchets | 0.8700 | ADEME ITOM 2017 |
| `emballage` | Emballages | 0.7700 | Citeo 2023 (moyenne centres de tri) |

**Cible V2** : valeurs spécifiques par prestataire/filière issues des bordereaux recycleur final (ajout colonne `prestataire_id` FK → `shared.prestataires`).

**RLS** :
- Lecture : `admin_savr` + `ops_savr` (lecture seule)
- Écriture : `admin_savr` uniquement (Val + Louis)
- Autres rôles : pas d'accès direct. La lecture du taux appliqué se fait indirectement via `collectes.caps_appliques` snapshot (cf. §5).

### 4. Nouvelle table `parametres_taux_recyclage_history` (audit trail)

Une ligne par modification d'un taux de captation. Permet la traçabilité réglementaire et le drill-down Back-office.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `parametre_id` | uuid | FK → parametres_taux_recyclage, NOT NULL | Filière concernée |
| `code_filiere` | enum | NOT NULL | Snapshot du code (résiste à un éventuel rename) |
| `taux_captation_avant` | decimal(5,4) | NOT NULL | Valeur avant modification |
| `taux_captation_apres` | decimal(5,4) | NOT NULL | Valeur après modification |
| `prestataire_avant` | text | | |
| `prestataire_apres` | text | | |
| `source_donnee_avant` | text | | |
| `source_donnee_apres` | text | | |
| `commentaire_modif` | text | NOT NULL | Motif obligatoire saisi par l'Admin (ex: "MAJ Citeo rapport annuel 2025") |
| `modifie_par` | uuid | FK → users (admin_savr), NOT NULL | |
| `modifie_le` | timestamptz | NOT NULL | |
| `created_at` | timestamptz | NOT NULL | |

**Trigger DB** : `AFTER UPDATE` sur `parametres_taux_recyclage` insère automatiquement une ligne d'historique si l'un des champs auditables change (`taux_captation`, `prestataire`, `source_donnee`).

**RLS** :
- Lecture : `admin_savr` + `ops_savr` (lecture seule)
- Écriture : interdite à tous (insertion uniquement via trigger DB)

### 5. Modifications table `collectes` — colonnes snapshot

Ajout de 2 colonnes sur `plateforme.collectes` (cf. table ci-dessous) pour figer le calcul à la clôture (`statut = cloturee`) et garantir la **reproductibilité du PDF Rapport RSE** (refonte 2026-05-05) :

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `taux_recyclage` | decimal(5,2) | NULL | Pourcentage calculé à la clôture (ex: 78.42). NULL tant que la collecte n'est pas `cloturee` ou si total pesées = 0. ZD uniquement (NULL pour AG). |
| `caps_appliques` | jsonb | NULL | Snapshot des taux de captation utilisés au moment du calcul. Format : `{"verre": 0.96, "carton": 0.90, "biodechet": 0.87, "emballage": 0.77, "version_parametres_at": "2026-05-06T10:00:00Z"}`. Garantit que toute modification ultérieure des taux n'affecte pas les anciennes collectes ni les anciens PDF. |

**Calcul et persistance** :
- Trigger DB `AFTER UPDATE` sur `collectes` : si transition `statut → cloturee` ET `type = zero_dechet` → calcule `taux_recyclage` à partir des `collecte_flux` + `parametres_taux_recyclage` actifs au moment T → écrit `taux_recyclage` + `caps_appliques`.
- Si pesée modifiée a posteriori (Admin force `realisee → cloturee` après correction) → recalcul avec les `parametres_taux_recyclage` **du moment du recalcul** (pas réingestion des anciens taux). Cohérent avec recalcul facture.

**Consultation** : tous les rôles peuvent lire `collectes.taux_recyclage` + `collectes.caps_appliques` selon leur RLS habituelle sur `collectes` (pas de restriction additionnelle).

### 6. Endpoints API + Permissions

Cf. [[08 - APIs et intégrations]] §section dédiée + [[09 - Authentification et permissions]] (matrice rôles × tables).

### 7. Cascade documentaire

Renommage / suppression de la notion "Taux de valorisation" propagés sur :
- §02 Personas — l. 119, 189, 210
- §01 Vision — l. 81 ("taux de détournement" → "taux de recyclage")
- §03 Périmètre fonctionnel — l. 127, 227
- §05 Règles métier — règle "Calcul taux de recyclage" + matrice indicateurs (l. 530-531)
- §06.02 Templates emails V1 — variable `{{taux_valorisation}}` → `{{taux_recyclage}}`
- §06.03 Registre réglementaire — méthodologie l. 107
- §06.04 Espace traiteur — Bloc KPIs ZD + fiche collecte ZD
- §06.05 Espace gestionnaire — Bloc 1 KPIs ("Taux de tri global" → "Taux de recyclage" formule à captation) + Section Traiteurs l. 387
- §06.06 Back-office Admin — Dashboard + liste collectes + nouvelle sous-section §9 Paramètres > Taux de recyclage par filière
- §11 Dashboards — suppression cadrans AG l. 105 + 154 ; renommage l. 32, 159 ; règles communes
- §12 Reporting et exports — PDF Rapport RSE §1.2 + Synthèse §1.6 + exports CSV (ajout colonne `taux_recyclage`)
- §16 Roadmap — l. 129
- §00 Index — l. 106
- CGU — définition "Rapport RSE" l. 69 (suppression "taux de valorisation")

### 8. TMS — pas de cascade

Le TMS Savr (M02-M14) push les **pesées brutes** (webhook S5 `collecte-terminee`). Le calcul du taux de recyclage est **côté Plateforme uniquement**. Aucun champ `taux_recyclage` dans le payload S5, aucun calcul TMS, aucune écriture cross-schema. Les paramètres `parametres_taux_recyclage` restent **schéma `plateforme.*`** (pas de duplication TMS).

---

## ⚠ Addendum 2026-06-04 — Facteurs d'impact carbone CO₂ (Sujet 3, ZD-only)

Modélisation des **équivalents CO₂** affichés sur les rapports RSE et dashboards. Jusqu'ici §12/§11 affichaient un « équivalent CO₂ ADEME » **sans aucune table, ni versioning, ni snapshot** — contrairement à `parametres_taux_recyclage` qui était complet. Cet addendum comble le trou en répliquant exactement ce pattern. Référence métier : [[../11. Contexte Réglementaire & Marché/Calcul Impact Carbone/Analyse methode calcul impact]] + calculette v2.

### 1. Périmètre et principes

- **ZD** (5 flux : verre, carton, biodéchet, emballage, dechet_residuel) traité dans cet addendum. Le **CO₂ AG (repas détournés)** est traité en **extension AG — addendum bis 2026-06-04 ci-dessous** (facteur unique 2,5 kgCO₂e/repas FAO, même pattern table versionnée + snapshot, affiché sur attestations de don + dashboard AG).
- **Trois grandeurs par collecte** : émissions **induites** (collecte + traitement), émissions **évitées** (substitution matière/énergie/engrais), **net** = induites − évitées. **Règle ABC** : les évitées se présentent sur une **ligne séparée**, jamais soustraites pour afficher une « compensation ». + **énergie primaire évitée** (kWh, recyclage vs vierge).
- **Biodéchet = méthanisation** (filière Savr) : évité 77 kgCO₂e/t (44 énergie + 33 digestat, Base Carbone).
- **Emballage = agrégat dérivé d'un mix paramétrable** : pas de FE propre, `FE_emballage = Σ(part_matériau × FE_matériau)` recalculé par trigger depuis `parametres_mix_emballages`.
- **Reproductibilité** : tous les facteurs (FE par flux + mix + équivalences + forfait collecte) sont **figés en snapshot sur la collecte à la clôture** (comme `caps_appliques`). Un PDF re-téléchargé redonne exactement les mêmes valeurs.

### 2. Formules officielles (V1)

```
Par flux X (kg → tonne) :
  induit_X   = (P_X / 1000) × fe_induit_X + part_collecte_X
  part_collecte_X = (P_X / P_total) × (km_aller_retour × fe_camion_benne_kg_km)
  evite_X    = (P_X / 1000) × fe_evite_X
  energie_X  = (P_X / 1000) × energie_primaire_evitee_kwh_t_X

Agrégat collecte :
  co2_induit_kg = Σ induit_X (5 flux)
  co2_evite_kg  = Σ evite_X  (5 flux)
  co2_net_kg    = co2_induit_kg − co2_evite_kg
  energie_primaire_evitee_kwh = Σ energie_X

FE emballage (dérivé du mix, recalculé par trigger) :
  fe_induit_emballage = Σ (part_pct_m / 100 × fe_induit_m)   pour m ∈ matériaux actifs
  fe_evite_emballage  = Σ (part_pct_m / 100 × fe_evite_m)
```

**Cas particuliers** : total pesées = 0 → toutes grandeurs NULL (pas de division, `—` à l'affichage). Flux non collecté (P_X=0) → terme nul. OMR : `fe_evite` porte déjà le bénéfice énergétique de l'incinération → `energie_primaire_evitee_kwh_t = 0` (volontaire, anti-double-comptage, décision a1 Val 2026-06-04). Forfait collecte V1 = paramètre ; **V2 = km réels remontés du TMS** (surcouche, cf. §08 + hook S5).

### 3. Nouvelles tables (résumé — définitions complètes plus bas)

- `parametres_facteurs_co2` — 1 ligne/flux (5), FE induit + évité + énergie primaire, versionnée `parametres_facteurs_co2_history`.
- `parametres_mix_emballages` — 1 ligne/matériau (7), part_pct + FE matériau, versionnée `parametres_mix_emballages_history`. Trigger de recalcul de la ligne `emballage` de `parametres_facteurs_co2`.
- `parametres_co2_divers` — clé-valeur (forfait collecte + équivalences pédagogiques), audité via `audit_log` (sobriété, pas de table history dédiée — faible enjeu).

### 4. Modifications table `collectes` — colonnes snapshot CO₂

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `co2_induit_kg` | decimal(10,2) | NULL | Émissions induites figées à la clôture. NULL si `statut ≠ cloturee`, total pesées = 0, ou AG. |
| `co2_evite_kg` | decimal(10,2) | NULL | Émissions évitées figées (valeur positive, signe − à l'affichage). |
| `co2_net_kg` | decimal(10,2) | NULL | `co2_induit_kg − co2_evite_kg`. Affiché ligne séparée (règle ABC). |
| `energie_primaire_evitee_kwh` | decimal(12,2) | NULL | Énergie primaire évitée (recyclage vs vierge). |
| `co2_facteurs_snapshot` | jsonb | NULL | Snapshot complet : `{ "facteurs": {<flux>: {induit, evite, energie}}, "mix_emballages": {<materiau>: {part_pct, induit, evite}}, "equivalences": {km_voiture, repas_boeuf, foyer_kwh}, "forfait_collecte": {km, fe_camion}, "version_parametres_at": "<timestamp>" }`. Garantit la reproductibilité du PDF. ZD only, NULL pour AG. |

**Calcul et persistance** : même trigger DB que `taux_recyclage` (`AFTER UPDATE` sur `collectes`, transition `statut → cloturee` ET `type = zero_dechet`) → calcule les 4 grandeurs + écrit `co2_facteurs_snapshot` à partir des `parametres_facteurs_co2` / `parametres_mix_emballages` / `parametres_co2_divers` **actifs au moment T**. Recalcul a posteriori (`realisee → cloturee` après correction pesée) = facteurs **du moment du recalcul** (cohérent `taux_recyclage` + facture). Consultation : selon RLS habituelle `collectes` (pas de restriction additionnelle).

### 5. Endpoints + permissions

Cf. [[08 - APIs et intégrations]] (endpoints admin CRUD) + [[09 - Authentification et permissions]] (RLS). Règles de calcul : [[05 - Règles métier#R_co2_calcul|§05 R_co2_*]].

### 6. Cascade documentaire (propagation 2026-06-04)

- §05 Règles métier — `R_co2_calcul`, `R_co2_snapshot_fige`, `R_co2_emballage_mix` + matrice indicateurs
- §08 APIs — endpoints admin `parametres_facteurs_co2` / `parametres_mix_emballages` / `parametres_co2_divers`
- §09 Auth/RLS — policies 5 tables CO₂ (admin W / ops R)
- §11 Dashboards — KPI « CO₂ évité » (+ induit/net/énergie repliable) par rôle
- §12 Reporting — bloc CO₂ rapport RSE (induit + évité ligne ABC + net + énergie) + annexe méthodo référentiel figé + Synthèse §1.6
- §00 Index + TO DO/Suivi (Sujet 3 résolu)

### 7. TMS — pas de cascade (V1)

Le CO₂ client (traitement des déchets) est **calculé côté Plateforme uniquement**. Le TMS push les pesées brutes (S5) ; aucun facteur/calcul CO₂ traitement TMS, aucune écriture cross-schema. Les tables `parametres_facteurs_co2*` / `parametres_mix_emballages*` / `parametres_co2_divers` restent `plateforme.*`. **Hook V2 documenté (lien cross-CDC conscient, 0 divergence V1)** : la surcouche « km réels » remplacera le forfait collecte (`parametres_co2_divers.km_collecte_aller_retour` + `fe_camion_benne_kg_km`) en lisant la distance de tournée + le facteur véhicule `tms.types_vehicules.co2_g_par_km_standard` / `tms.vehicules.co2_g_par_km` (déjà présents côté TMS pour l'impact RSE M11). Canal à figer §08 V2. Ne pas confondre avec la « boussole RSE chauffeur » (§01 TMS) qui est un usage TMS-interne distinct.

---

## ⚠ Addendum 2026-06-04 (bis) — CO₂ AG (repas détournés)

Extension du modèle CO₂ aux collectes **Anti-Gaspi** (don de repas). Même pattern que le CO₂ ZD (table versionnée + snapshot figé sur la collecte). Comble le trou : « CO₂e évité AG » était affiché sur le dashboard AG et destiné aux attestations sans aucun facteur modélisé.

### 1. Principe et formule

- **Périmètre** : collectes `type = anti_gaspi`. Métrique = **émissions évitées par le don** (denrées consommables sauvées du gaspillage). **Pas d'induit/net en V1** (le don est un bénéfice ; arbitrage Val 3a). **V2** : induit + évité + net intégrant le transport (distance + type de véhicule, via le hook TMS — même canal que la surcouche km réels ZD).
- **Unité = par repas** (`volume_repas_realise`, unité canonique AG déjà affichée sur attestation + dashboard ; arbitrage 1a).
- **Facteur V1 = 2,5 kgCO₂e évités par repas** (source **FAO**, standard du secteur anti-gaspi).

```
co2_evite_kg (AG) = collectes → attributions_antgaspi.volume_repas_realise × parametres_facteurs_co2_ag.facteur_co2_evite_par_repas_kg
```

### 2. Stockage (réutilisation des colonnes ZD)

**Pas de nouvelles colonnes sur `collectes`** (arbitrage 4a) : on réutilise `co2_evite_kg` + `co2_facteurs_snapshot`, discriminés par `collectes.type`. Pour une collecte AG : `co2_induit_kg` / `co2_net_kg` / `energie_primaire_evitee_kwh` restent **NULL** ; `co2_evite_kg` = repas × facteur ; `co2_facteurs_snapshot = { "type": "anti_gaspi", "facteur_co2_evite_par_repas_kg": 2.5, "volume_repas_realise": <n>, "equivalences": {km_voiture}, "version_parametres_at": "<ts>" }`.

### 3. Déclencheur et figement

Même trigger DB que ZD, **branche `type = anti_gaspi`** : à la transition `collectes.statut → cloturee` (moment où `volume_repas_realise` est figé), calcul de `co2_evite_kg` + snapshot AG. **Séquencement batch J+1 (précisé 2026-06-11, audit data model — sans cet ordre, l'attestation pouvait être rendue avec un CO₂ NULL)** : le batch J+1 6h (1) passe la collecte à `cloturee` — le trigger CO₂/taux s'exécute **dans cette transaction** — puis (2) enqueue le job `jobs_pdf` de l'attestation, dont le `payload` snapshot lit `co2_evite_kg` déjà figé. Le PDF n'est jamais généré avant la clôture ; jamais d'attestation au stade `realisee`. Recalcul si `volume_repas_realise` corrigé a posteriori (cohérent avec la **régénération automatique de l'attestation**, §12 §1.3) → facteur du moment du recalcul. `realisee_sans_collecte` (aucun repas) → `co2_evite_kg = 0`.

### 4. Table (définition complète plus bas)

`parametres_facteurs_co2_ag` (1 ligne V1) + `parametres_facteurs_co2_ag_history`. Même RLS que les facteurs ZD (admin W / ops R). Endpoint admin §08 9ter.6.

### 5. Affichage

- **Attestation de don** (§12 §1.3) : ligne « CO₂e évité : X kg » + équivalence km voiture (`parametres_co2_divers.equiv_km_voiture_kgco2`). Lu depuis `collectes.co2_evite_kg` figé (reproductibilité du document officiel).
- **Dashboard AG** (§11 onglet AG) : cadran « CO₂e évité » alimenté par le modèle (n'est plus un placeholder).

### 6. Cascade + V2

§05 R_co2_ag · §08 9ter.6 · §09 RLS · §11 onglet AG · §12 §1.3 · §06.06 UI admin · §00 + Suivi. **V2** : référentiel multi-critères par aliment (Module 19 Impact enrichi, non créé V1) affinera ce facteur unique ; transport AG induit (distance TMS + `co2_g_par_km` véhicule). **Cross-CDC TMS = 0 V1.**

---

## ⚠ Addendum 2026-05-22 — Coefficient de perte labo (estimation déchets amont, gestionnaire-only)

Introduction d'un indicateur **estimé** quantifiant le déchet généré **en amont, au laboratoire/cuisine du traiteur** (épluchures, parures, surplus de production), **distinct** du déchet collecté sur l'événement (pesées réelles par flux). Affiché **uniquement** dans l'espace gestionnaire de lieux (détail événement + colonne liste). Hors PDF rapport et hors espace traiteur en V1.

### 1. Objet et formule

- Calcul par le traiteur, **une fois par an** : `coefficient (kg/couvert) = tonnage total déchets labo année N ÷ couverts servis année N`.
- Le traiteur **communique** sa valeur ; l'**Admin Savr la saisit** sur la plateforme (pas de saisie traiteur en V1).
- Appliquée aux événements de l'année **N+1** : `Déchets labo estimés (kg) = evenements.pax × coefficient`.
- Le coefficient est porté par le **traiteur opérationnel** de l'événement (`evenements.traiteur_operationnel_organisation_id`) — c'est lui le producteur du déchet labo, y compris quand l'événement est programmé par une agence ou un gestionnaire.

### 2. Nouvelle table `coefficients_perte_labo` (Niveau 2 Référentiel)

Une ligne par traiteur × année de référence.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `organisation_id` | uuid | FK → organisations (type=traiteur), NOT NULL | Traiteur producteur du déchet labo. Cohérent avec `evenements.traiteur_operationnel_organisation_id`. |
| `annee_reference` | integer | NOT NULL, CHECK (BETWEEN 2020 AND 2100) | Année des données ayant servi au calcul. S'applique aux événements de `annee_reference + 1`. |
| `coefficient_kg_couvert` | numeric(6,4) | NOT NULL, CHECK (>= 0) | kg de déchet labo estimé par couvert (ex: `0.1500` = 150 g/couvert). |
| `source_commentaire` | text | | Note libre Admin — méthode / source communiquée par le traiteur. |
| `saisi_par` | uuid | FK → users (admin_savr), NOT NULL | Admin Savr ayant saisi la valeur. |
| `saisi_le` | timestamptz | NOT NULL | |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Contraintes** :
- `UNIQUE (organisation_id, annee_reference)` — un seul coefficient par traiteur et par année.
- `CHECK (coefficient_kg_couvert >= 0)`.

**Index** : `(organisation_id, annee_reference)` — lookup direct à l'affichage d'un événement.

**Audit** : la correction d'un coefficient existant est tracée via `audit_log` central (pas de table `_history` dédiée — volume faible, 1 ligne/traiteur/an). Aligné sur le pattern `organisations.tarif_refacture_pax_zd`.

**RLS** :
- Écriture + lecture directe : `admin_savr` uniquement (saisie §06.06).
- `ops_savr` : lecture seule.
- Autres rôles (`gestionnaire_lieux`, traiteur) : **pas d'accès direct à la table**. L'estimation `pax × coefficient` est calculée côté serveur (fonction SECURITY DEFINER alimentant le détail événement / la liste gestionnaire). Le coefficient brut n'est jamais exposé — seule l'estimation en kg l'est.

### 3. Calcul de l'estimation (à la volée, non stocké)

Cf. règle [[05 - Règles métier#R_dechets_labo_estimes]].

```
Déchets labo estimés (kg) = evenements.pax × C

où C = coefficients_perte_labo.coefficient_kg_couvert
       WHERE organisation_id = evenements.traiteur_operationnel_organisation_id
         AND annee_reference = EXTRACT(YEAR FROM evenements.date_evenement) - 1
```

**Cas particuliers** :
- Aucune ligne correspondante (traiteur sans coefficient pour l'année N-1) → estimation **NULL** → UI affiche `—` / "Coefficient non communiqué". **Pas de fallback** sur une autre année (un chiffre faux est pire qu'une absence assumée).
- Calculé en lecture, **non stocké** (cohérent `taille_evenement` non stocké). Pas de snapshot : affichage gestionnaire-only, pas de besoin de reproductibilité PDF.
- Base de calcul = `evenements.pax` (programmé). `pax_reels` non utilisé (décision Val 2026-05-22).

### 4. Migration SQL

```sql
CREATE TABLE plateforme.coefficients_perte_labo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES plateforme.organisations(id),
  annee_reference integer NOT NULL CHECK (annee_reference BETWEEN 2020 AND 2100),
  coefficient_kg_couvert numeric(6,4) NOT NULL CHECK (coefficient_kg_couvert >= 0),
  source_commentaire text,
  saisi_par uuid NOT NULL REFERENCES plateforme.users(id),
  saisi_le timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_coeff_labo_org_annee UNIQUE (organisation_id, annee_reference)
);
CREATE INDEX idx_coeff_labo_org_annee
  ON plateforme.coefficients_perte_labo (organisation_id, annee_reference);
```

### 5. TMS — pas de cascade

Le coefficient et l'estimation sont une métrique **reporting Plateforme** rattachée au traiteur. Le TMS ne manipule pas le pax côté reporting, ne calcule aucune estimation, et `coefficients_perte_labo` reste schéma `plateforme.*`. Aucun champ ajouté au contrat API, aucune écriture cross-schema. Écart conscient documenté.

---

## Table `shared.fichiers` (nouvelle V1, atelier 2026-04-23)

Référentiel centralisé de tous les fichiers utilisés par la Plateforme et le TMS. Remplace la logique "un chemin de fichier stocké en dur dans chaque table" par une référence polymorphique.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | Identifiant unique du fichier |
| `storage_provider` | enum | NOT NULL | `supabase` \| `r2` |
| `bucket` | text | NOT NULL | Nom du bucket (`bordereaux`, `photos-collectes`, `docs-chauffeurs`, etc.) |
| `key` | text | NOT NULL | Clé/chemin dans le bucket |
| `content_hash` | text | | SHA-256 du contenu (déduplication, intégrité) |
| `size_bytes` | bigint | NOT NULL | Taille en octets |
| `content_type` | text | NOT NULL | MIME type (`application/pdf`, `image/jpeg`, etc.) |
| `entity_type` | text | NOT NULL | Table propriétaire (`plateforme.collectes`, `tms.pesees`, `tms.chauffeurs`, etc.) |
| `entity_id` | uuid | NOT NULL | ID de la ligne propriétaire (pas de FK formelle, polymorphique) |
| `created_by` | uuid | | User qui a créé le fichier (peut être null pour imports auto) |
| `created_at` | timestamptz | NOT NULL | |
| `deleted_at` | timestamptz | | Soft delete avant purge physique |

**Index** : `(entity_type, entity_id)` pour lookup rapide des fichiers d'une entité donnée.

**Cycle de vie** : les fichiers ne sont jamais supprimés directement. Soft delete via `deleted_at` puis job cron mensuel qui purge physiquement les fichiers > 30j après soft delete (sauf si rétention légale impose conservation plus longue — PDFs factures, audit, etc.).

**Accès** : URLs pré-signées 15 min générées à la demande par les API Routes Next.js via SDK AWS S3-compatible (pour R2) ou SDK Supabase Storage natif (pour Supabase). Jamais d'accès direct bucket depuis le client.

**RLS (BLOQUANT — audit RLS V1 2026-06-05)** : le contrôle d'accès ne peut **pas** reposer uniquement sur les URLs pré-signées. Table polymorphe (`entity_type`/`entity_id`) → policy SELECT obligatoire via fonction `SECURITY DEFINER shared.f_fichier_visible(entity_type, entity_id)` qui résout l'ownership de l'entité propriétaire (deny par défaut sur tout `entity_type` non whitelisté). Sans elle : fuite cross-org des bordereaux/photos/attestations. Écriture `SERVICE_ROLE` + admin. Cf. [[09 - Authentification et permissions#C1 — `shared.fichiers`]].

**Doctrine colonnes `*_url` / `*_urls` (tranchée 2026-06-11, audit data model — le data model mélangeait deux systèmes de référence fichier)** : `shared.fichiers` est l'**unique source de vérité** de tout fichier généré ou uploadé (PDF bordereaux/rapports/attestations, photos collectes, logos). Les colonnes `pdf_url` / `photos_urls` / `logo_url` / `aucun_repas_photo_url` des tables métier sont des **dénormalisations de lecture** : elles stockent la **clé de stockage** (`bucket/key`, jamais une URL signée — celles-ci expirent en 15 min) du fichier correspondant déjà référencé dans `shared.fichiers` (`entity_type`/`entity_id` pointant la ligne métier ; `jobs_pdf.fichier_id` fait le lien à la génération). Tout accès client passe par l'API (URL pré-signée à la demande) sous contrôle `f_fichier_visible` — la colonne dénormalisée ne contourne jamais la RLS fichiers. Cycle de vie (soft delete + purge) piloté exclusivement par `shared.fichiers`.

---

## Principe de lecture

Ce fichier décrit les entités (tables Supabase), leurs champs, leurs relations et les règles d'intégrité. Il est conçu pour être lu par Claude Code avant toute phase de développement.

**Convention** :
- Toutes les tables sont dans le schéma `plateforme.*` (sauf mention explicite `tms.*` ou `shared.*`)
- `PK` = clé primaire (identifiant unique de la ligne)
- `FK` = clé étrangère (lien vers une autre table **du même schéma** uniquement, sauf `shared.fichiers`)
- `NOT NULL` = champ obligatoire
- `UNIQUE` = valeur unique dans la table
- `[]` = liste de valeurs possibles (enum)
- Relations : `1-N` (un-à-plusieurs), `N-N` (plusieurs-à-plusieurs via table de jointure)

---

## Décision structurante principale

**1 événement → N collectes.** Un même événement physique (ex: dîner Kaspia au Palais des Congrès le 15/06) peut avoir simultanément une collecte zéro-déchet (Strike) ET une collecte anti-gaspi (A Toutes! ou Marathon). La table `evenements` est la table centrale. Les collectes lui sont rattachées **explicitement via `collectes.evenement_id`** (refonte 2026-05-21 — fin du rattachement par matching date+lieu+client, source de doublons).

**Multi-camions (révisé 2026-05-25, Sujet 1 option A — annule la décision 4a du 2026-05-21)** : un événement à fort volume (ex: 3000 pax) nécessitant plusieurs camions reste **une seule collecte ZD** côté traiteur/Plateforme (assiette pax, facturation, rapport, registre). Le dimensionnement en N camions est décidé par l'**Admin Savr au dispatch** et reste **interne au TMS** : `1 collecte ZD → N tournées` prestataire (rattachées au `collecte_id`). Les pesées des N camions sont **agrégées sous la collecte ZD** (webhook S5 agrège par `collecte_tms_id`). **Cardinalité TMS `collecte → N tournées` à figer en session `cdc-tms-savr` dédiée** (le modèle TMS actuel `1 tournée → N collectes` / `collecte → 1 tournée` doit évoluer). Contrat §08 S5 inchangé (agrège déjà par `collecte_tms_id`).

**`date_collecte` = champ primaire, `date_evenement` = dérivé (refonte 2026-05-29)** : `collectes.date_collecte` est la date d'intervention logistique saisie par le programmeur — chaque collecte porte la sienne. `evenements.date_evenement` est calculé automatiquement = `MIN(collectes.date_collecte)` de l'événement via trigger (jamais saisi). C'est la date de référence des rapports PDF. **Retiré V1 (2026-05-29)** — pax unique au niveau événement (`evenements.pax`) ; multi-jours à pax variable reporté V2. Voir tables `evenements` et `collectes` ci-dessous.

---

## Niveau 1 — Organisations et utilisateurs

### Table : `organisations`

Entité générique pour tous les types de clients et partenaires externes.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | Identifiant unique |
| `nom` | text | NOT NULL | Nom de l'organisation |
| `raison_sociale` | text | NULL | **Ajout 2026-06-11 (audit data model — colonne fantôme régularisée)** — Raison sociale de l'organisation, référencée par `v_registre_dechets` (`traiteur_raison_sociale`, F4 2026-06-07) et `v_referentiel_traiteurs` (F5 2026-06-07) qui la lisaient sans qu'elle existe. Saisie à l'onboarding (ou par l'agence pour une fiche shadow — la décision shadow 2026-05-07 mentionnait déjà « nom + raison sociale »). NULL toléré (fallback affichage = `nom` via `COALESCE(raison_sociale, nom)` dans les 2 vues). ⚠ Ne remplace pas `entites_facturation.raison_sociale` (entité juridique de facturation, source de vérité facture) — celle-ci porte la raison sociale par entité, celle-là la raison sociale « par défaut » de la fiche organisation (registre, référentiel). |
| `type` | enum | NOT NULL | `traiteur` \| `agence` \| `gestionnaire_lieux` \| `client_organisateur`. **Pas de valeur `lieu_independant`** : un lieu autonome mono-site est un `gestionnaire_lieux` avec une seule ligne `organisations_lieux` (sobriété 2026-06-03 D1 — confirme l'absence déjà actée ici). **Migration Bubble** : toute org typée « lieu indépendant » → `gestionnaire_lieux`. |
| `email_principal` | text | | Email de contact principal |
| `telephone` | text | | |
| `adresse` | text | | |
| `siret` | text | | **Requalifié 2026-05-25 (audit sobriété §04 — C2)** — SIRET de la fiche organisation, utilisé **uniquement** pour les fiches **shadow** (`est_shadow=true`, interdites d'`entites_facturation` : SIRET optionnel saisi par l'agence à la création, lu par le bordereau si traiteur opérationnel shadow). Pour toute organisation facturable, la **source de vérité est `entites_facturation.siret`** (NOT NULL). À la promotion d'une fiche shadow, le SIRET est migré vers l'`entite_facturation` créée. |
| `logo_url` | text | | URL Supabase Storage (bucket `logos`). Couvre traiteurs, agences, gestionnaires de lieux et clients finaux. |
| `notes_internes` | text | | Commentaires Admin Savr (non visible par le client) |
| `actif` | boolean | NOT NULL, défaut `true` | Permet de désactiver sans supprimer |
| `est_shadow` | boolean | NOT NULL, défaut `false` | **Ajout 2026-05-07** — Fiche traiteur créée par une agence pour un traiteur hors référentiel. Pas de `users` rattachés, pas d'`entites_facturation` autorisée tant que `est_shadow=true`. Promotion en client réel par Admin Savr (bascule à `false` + onboarding standard). Cas valable uniquement pour `type='traiteur'`. |
| `cree_par_organisation_id` | uuid | FK → organisations | **Ajout 2026-05-07** — Renseigné si `est_shadow=true` : agence qui a créé la fiche. NULL sinon. Utilisé pour la RLS de visibilité shadow. |
| `tarif_refacture_pax_zd` | numeric(10, 2) | NOT NULL, DEFAULT 1.50, CHECK (>= 0) | **Ajout 2026-05-07** — Tarif refacturé par couvert (€) sur les collectes ZD au client final du traiteur. Sert au calcul du KPI **Marge générée** dashboard traiteur ZD ([[06 - Fonctionnalités détaillées/04 - Espace client traiteur#KPI Marge générée]]). Édition Admin Savr only via §06.06 Back-office. Audit_log sur changement. Champ pertinent uniquement pour `type='traiteur'` (autres types : valeur défaut 1.50 ignorée côté UI). |
| `grille_tarifaire_zd_id` | uuid | FK → grilles_tarifaires_zd, NULL | **Ajout 2026-05-26 (refonte tarification ZD)** — Grille tarifaire ZD du catalogue affectée à cette organisation (cf. `grilles_tarifaires_zd`). `NULL` = la grille marquée `est_defaut=true` s'applique (grille publique standard par paliers). Permet de ranger un client sur une autre méthode standard (ex. forfait + variable) sans toucher au formulaire ni au prix affiché (cf. Sujet 5 — tarif non affiché). Édition Admin Savr only via §06.06. Pertinent pour `type='traiteur'` (assiette de facturation ZD = le programmateur). |
| `mode_facturation_zd` | enum | NOT NULL, DEFAULT `par_collecte` | **Ajout 2026-06-14 (décision Val — correction trou data model)** — Préférence de facturation ZD : `par_collecte` = 1 brouillon par collecte ZD cloturée (défaut) \| `mensuelle` = collectes ZD du mois agrégées en 1 brouillon mensuel par traiteur. Configurable par Admin Savr via §06.06. Pertinent pour `type='traiteur'` uniquement. **Le batch J+1 lit cette colonne pour décider du mode de génération du brouillon.** Migration : toutes les organisations existantes héritent de `par_collecte`. |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Contraintes** :
- `CHECK (est_shadow = false OR type = 'traiteur')` — seules les fiches traiteur peuvent être shadow
- `CHECK (est_shadow = false OR cree_par_organisation_id IS NOT NULL)` — toute fiche shadow doit être tracée par son créateur
- `CHECK (tarif_refacture_pax_zd >= 0)` — pas de tarif négatif
- Index partiel `WHERE est_shadow = true` pour notifications Admin et requêtes de promotion

**Mécanique shadow — décisions F2/F3/F4 test-scenarios §06.11 lot ⑨ (2026-06-07, tranché Val)** :
- **RPC `f_completer_siret_shadow(org_id uuid, siret text)`** (SECURITY DEFINER) : seule voie de complétion du SIRET d'une fiche shadow par l'agence créatrice (pas d'UPDATE RLS direct). Gardes : `est_shadow=true`, `cree_par_organisation_id = org appelant`, rôle `agence`, `siret` cible NULL (écrasement interdit → exception), format 14 chiffres.
- **Notifications Admin shadow** (création fiche + SIRET complété) : **in-app seules** (aucun template email — catalogue §06.02 inchangé).
- **Trigger `trg_cerfa_debloque_siret`** : `AFTER UPDATE OF siret ON organisations` (scope `est_shadow=true`, NULL→NOT NULL) → finalise automatiquement les bordereaux Cerfa en `brouillon` des collectes liées à cette fiche shadow (cf. §06.11 F4).

**Migration SQL — ajout 2026-05-07 `tarif_refacture_pax_zd`** :
```sql
ALTER TABLE plateforme.organisations
  ADD COLUMN tarif_refacture_pax_zd numeric(10, 2) NOT NULL DEFAULT 1.50
  CHECK (tarif_refacture_pax_zd >= 0);
```
Toutes les organisations existantes héritent de la valeur 1.50 € à la migration. Admin Savr ajuste ensuite par traiteur via §06.06.

**Migration SQL — ajout 2026-06-14 `mode_facturation_zd`** :
```sql
CREATE TYPE plateforme.mode_facturation_zd_enum AS ENUM ('par_collecte', 'mensuelle');

ALTER TABLE plateforme.organisations
  ADD COLUMN mode_facturation_zd plateforme.mode_facturation_zd_enum NOT NULL DEFAULT 'par_collecte';
```
Toutes les organisations existantes héritent de `par_collecte`. Admin Savr configure ensuite par traiteur via §06.06.

**Relations** :
- 1 organisation → N users (via `users.organisation_id`) — sauf si `est_shadow=true` (0 user)
- 1 organisation (traiteur, agence ou gestionnaire de lieux) → N événements (via `evenements.organisation_id`) — voir §05 règle programmateur=facturé V1
- N-N organisations ↔ lieux (via `organisations_lieux`, **V1 : utilisé uniquement pour les gestionnaires de lieux**, le périmètre agence est ouvert sans restriction lieux)

**Questions ouvertes** :
- Un traiteur peut-il avoir plusieurs adresses de facturation (ex: groupe avec plusieurs entités juridiques) ? → **Résolu** : oui, via `entites_facturation`
- Une agence peut-elle être associée à plusieurs traiteurs ET plusieurs lieux simultanément ? → **Résolu V1 (2026-05-07)** : oui, sans restriction lieux (périmètre ouvert). `organisations_lieux` réservé aux gestionnaires de lieux en V1. Verrouillage agence reportable V1.5 si besoin métier (flag `agence_perimetre_ferme` à ajouter le moment venu).

---

### Table : `users`

Tous les utilisateurs de la plateforme.

| Champ                | Type        | Contrainte                   | Description                                                                                     |
| -------------------- | ----------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `id`                 | uuid        | PK                           | Identifiant Supabase Auth                                                                       |
| `organisation_id`    | uuid        | FK → organisations, **NULL autorisé pour les rôles staff** (`admin_savr`, `ops_savr`) | Organisation d'appartenance. **Décision Val 2026-06-13** : nullable pour les rôles staff — le staff n'appartient à aucune organisation cliente. La RLS staff utilise `f_is_staff()` (role-based), jamais `organisation_id`. Le claim JWT `organisation_type` est NULL pour le staff. Tous les autres rôles : NOT NULL. |
| `email`              | text        | NOT NULL, UNIQUE             |                                                                                                 |
| `prenom`             | text        | NOT NULL                     |                                                                                                 |
| `nom`                | text        | NOT NULL                     |                                                                                                 |
| `role`               | enum        | NOT NULL                     | **7 valeurs — alignées §09 (corrigé 2026-06-11, audit data model : l'ex-enum `commercial`/`manager` divergeait du référentiel canonique §09 utilisé par toutes les policies RLS et les claims JWT, et omettait `ops_savr`)** : `admin_savr` \| `ops_savr` \| `traiteur_manager` \| `traiteur_commercial` \| `agence` \| `gestionnaire_lieux` \| `client_organisateur`. Source de vérité du modèle de rôles : [[09 - Authentification et permissions]] §2. |
| `actif`              | boolean     | NOT NULL, défaut `true`      |                                                                                                 |
| `derniere_connexion` | timestamptz |                              |                                                                                                 |
| `created_at`         | timestamptz | NOT NULL                     |                                                                                                 |
| `cgu_accepte_le`     | timestamptz | NULL                         | Horodatage de l'acceptation des CGU (= création du compte, CGU Art. 11/22, preuve opposable). NULL pour les comptes migrés Bubble sans trace (pas de rétro-remplissage). **Colonne PERMANENTE → converge V1=V2 (garde-fou G1/G6), n'est PAS V1-only.** |
| `cgu_version`        | text        | NULL                         | Version du texte CGU acceptée (constante applicative `CGU_VERSION_COURANTE`, `'v1'`). NULL pour les comptes migrés. V1 = une seule acceptation à la création (pas de table d'historique multi-versions). **Colonne PERMANENTE → converge V1=V2.** |
| `deleted_at`         | timestamptz | NULL                         | **Ajout 2026-06-25 (divergence M0.4 R7 — matérialise §15 §3.3 effacement RGPD)** — Soft-delete RGPD. NULL = compte vivant. Renseigné par `fn_anonymize_user` lors d'une suppression RGPD validée (anonymisation PII, pas de hard-delete Auth — préservation des pièces comptables, cf. [[15 - Sécurité et conformité]] §3.3). Index partiel `WHERE deleted_at IS NULL`. Toutes les policies de lecture `users` sont gatées `deleted_at IS NULL` (sauf `usr_admin`). **Colonne PERMANENTE → converge V1=V2.** |

**Note RLS** : le champ `role` + `organisation_id` détermine exactement ce que voit l'utilisateur. La politique RLS Supabase est définie sur cette combinaison.

**Invariant V1 (tranché 2026-06-10, challenge logistique+onboarding — ex-question ouverte)** : **1 user = 1 organisation**. `organisation_id` est singulier, le claim JWT `organisation_id` aussi, et il n'existe **aucune table N-N `users ↔ organisations`** — ne pas en créer. Un consultant multi-traiteurs utilise un email distinct par organisation. Seule exception documentée : double profil `ops_savr` Plateforme/TMS (§09, sans objet V1). Multi-orga = à revoir V2.

---

### Table : `demandes_suppression`

**Ajout 2026-06-25 (divergence M0.4 R7 — matérialise §15 §3.3 : workflow de demande de suppression RGPD validée par l'Admin sous 48h).** Trace les demandes d'effacement RGPD émises par un utilisateur et leur traitement par l'Admin Savr.

| Champ            | Type        | Contrainte                                                  | Description                                                                                                  |
| ---------------- | ----------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`             | uuid        | PK                                                          |                                                                                                            |
| `user_id`        | uuid        | FK → users, NOT NULL                                        | Utilisateur dont l'effacement est demandé.                                                                  |
| `statut`         | enum        | NOT NULL, défaut `en_attente`                              | `en_attente` \| `validee` \| `refusee`. SLA cible Admin 48h (§15 §3.3).                                     |
| `justification`  | text        | NULL                                                        | Motif de la demande (saisi par le demandeur) et/ou de la décision Admin.                                    |
| `demande_le`     | timestamptz | NOT NULL, défaut `now()`                                    | Horodatage de la demande.                                                                                   |
| `traitee_le`     | timestamptz | NULL                                                        | Horodatage de la décision Admin (NULL tant que `en_attente`).                                               |
| `traitee_par`    | uuid        | FK → users (admin_savr), NULL                               | Admin Savr ayant statué.                                                                                    |

**RLS** : self `INSERT` + self `SELECT` (le demandeur voit ses propres demandes) ; `admin_savr` `ALL`. Pas d'écriture cliente après création (le statut est piloté par l'Admin / SERVICE_ROLE).

**Notification de demande = file in-app Admin** (pas d'email — catalogue gelé 19 templates, §15 n'en mandate pas ; décision Val 2026-06-25). La validation déclenche `fn_anonymize_user(user_id, justification, acteur, id)`.

**Fonction d'effacement RGPD — `plateforme.fn_anonymize_user(p_user_id uuid, p_justification text, p_acteur uuid, p_demande_id uuid)`** (ajout 2026-06-25, divergence M0.4 R7) : `SECURITY DEFINER`, réservée `service_role`. Matérialise la suppression RGPD V1 = **anonymisation, pas de hard-delete Auth** (les factures / bordereaux / registres doivent rester rattachables — contrainte légale §15 §3.3 l.111).

- Périmètre PII anonymisé = `users.{prenom, nom, email}` (le `téléphone` de §15 l.111 n'existe pas sur `users` ; il est porté par `organisations` = entité légale, hors périmètre RGPD individuel).
- Renseigne `users.deleted_at = now()` + `users.actif = false`.
- Trace l'opération dans `audit_log` (acteur, justification, demande source).
- Idempotente sur un compte déjà anonymisé (no-op si `deleted_at IS NOT NULL`).
- Toutes les policies de lecture `users` sont gatées `deleted_at IS NULL` (sauf `usr_admin`) → un compte anonymisé disparaît des vues clientes sans casser les FK comptables.

---

### Table : `entites_facturation`

Une organisation peut porter plusieurs entités juridiques de facturation (cas des groupes type Potel et Chabot). Chaque entité a son propre SIRET et ses propres factures.

| Champ                       | Type        | Contrainte                   | Description                                                  |
| --------------------------- | ----------- | ---------------------------- | ------------------------------------------------------------ |
| `id`                        | uuid        | PK                           |                                                              |
| `organisation_id`           | uuid        | FK → organisations, NOT NULL | Organisation parente                                         |
| `raison_sociale`            | text        | NOT NULL                     | Raison sociale juridique (ex: "Potel et Chabot SAS")         |
| `siret`                     | text        | NOT NULL                     | SIRET de l'entité                                            |
| `tva_intracom`              | text        |                              | Numéro de TVA intracommunautaire                             |
| `pennylane_customer_id`     | text        |                              | **Ajout 2026-05-25 (audit sobriété §04 — C2)** — Identifiant client Pennylane de cette entité. **Source de vérité unique** (l'ex-colonne `organisations.pennylane_customer_id` est supprimée). Renseigné à la 1re synchro Pennylane. |
| `adresse_facturation`       | text        | NOT NULL                     |                                                              |
| `code_postal`               | text        | NOT NULL                     |                                                              |
| `ville`                     | text        | NOT NULL                     |                                                              |
| `pays`                      | text        | NOT NULL, défaut `FR`        |                                                              |
| `email_facturation`         | text        |                              | Email dédié facturation (peut différer de l'email principal) |
| `contact_compta_nom`        | text        |                              |                                                              |
| `conditions_paiement_jours` | integer     | NOT NULL, défaut 30          | Délai de paiement négocié (30, 45, 60 jours)                 |
| `mode_paiement`             | enum        |                              | `virement` \| `prelevement` \| `cb` \| `cheque`              |
| `siret_verification`        | enum        | NOT NULL, défaut `en_attente` | **Ajout 2026-06-10 (challenge logistique+onboarding — matérialise §15 §2.6)** — Statut de vérification du SIRET via API INSEE/Sirene : `en_attente` \| `verifie` \| `echec`. Écrit par le job async de vérification (SERVICE_ROLE, retries 15 min / 1 h / 24 h si INSEE down) ou en synchrone si INSEE répond < 3 s. `echec` = INSEE a répondu « inexistant/inactif » → alerte Admin (filtre « nouvelles organisations » §06.06). **Gate facturation** : facture émise uniquement si `siret_verification = 'verifie'` (cf. [[05 - Règles métier]] §8 étape 3). |
| `siret_verifie_le`          | timestamptz |                              | **Ajout 2026-06-10** — Horodatage du dernier verdict INSEE (succès ou échec). |
| `tva_verification`          | enum        | NOT NULL, défaut `en_attente` | **Ajout 2026-06-10** — Statut de vérification TVA intracom via VIES : `en_attente` \| `verifie` \| `echec` \| `non_applicable` (`tva_intracom` vide). **Non bloquant pour la facturation** (arbitrage Val 2026-06-10 : VIES trop instable pour gater du cash) — `en_attente`/`echec` prolongé = alerte Admin in-app seule. |
| `tva_verifiee_le`           | timestamptz |                              | **Ajout 2026-06-10** — Horodatage du dernier verdict VIES. |
| `entite_par_defaut`         | boolean     | NOT NULL, défaut `false`     | 1 seule entité par défaut par organisation                   |
| `actif`                     | boolean     | NOT NULL, défaut `true`      |                                                              |
| `commentaires`              | text        |                              |                                                              |
| `created_at`                | timestamptz | NOT NULL                     |                                                              |
| `updated_at`                | timestamptz | NOT NULL                     |                                                              |

**Règles** :
- Une organisation **non-shadow** a au minimum 1 `entite_facturation` (créée par défaut à l'onboarding)
- **Cas shadow (2026-05-07)** : interdiction d'`entites_facturation` tant que `organisations.est_shadow = true`. Trigger SQL `BEFORE INSERT` qui rejette toute insertion si l'organisation cible est shadow. La promotion shadow → client réel par Admin Savr déclenche la création de l'`entite_facturation` par défaut dans le même flow.
- Une seule peut avoir `entite_par_defaut = true` par organisation (contrainte SQL unique partielle)
- **Unicité partielle du SIRET (2026-06-30, divergence M0.4 — matérialise §15 §2.6 l.69 « détection de doublons »)** : index `UNIQUE (siret) WHERE siret <> ''` (`uniq_entites_facturation_siret`). Les entités créées sans SIRET (onboarding partiel / shadow) portent `siret = ''` et ne collisionnent pas ; deux entités ne peuvent pas porter le même SIRET non vide → bloque l'inscription si le SIRET est déjà rattaché à une organisation existante. Voir [[15 - Sécurité et conformité#2.6 Protection contre les abus à l'onboarding]].
- À la programmation d'un événement, l'entité de facturation est sélectionnée (par défaut celle marquée `entite_par_defaut`)
- **Règle V1 (2026-05-07)** : `evenements.entite_facturation_id` doit appartenir à l'organisation programmatrice (`evenements.organisation_id`). Pas de découplage programmateur ≠ facturé en V1. Voir §05.
- Les champs `siret`, `adresse`, `email_principal` sur `organisations` deviennent informatifs — la source de vérité pour la facturation est `entites_facturation`

**Migration Pennylane** : chaque `entite_facturation` correspond à un client distinct côté Pennylane (mapping via `pennylane_customer_id`, colonne **désormais portée par `entites_facturation`** — audit sobriété §04 2026-05-25 C2).

**RLS (audit RLS 2026-06-11, Q2 — BLOQUANT levé)** : l'ex-classement §09 « table financière interne, admin only » était un résidu — la table porte les entités de **toutes** les organisations clientes (sélecteur §06.01, « Mon organisation »). Policy corrigée : lecture staff + `organisation_id = self` pour tous les rôles clients ; écriture staff seul V1 (création onboarding = SERVICE_ROLE) ; colonnes système (`siret_verification`, `tva_verification`, `pennylane_customer_id`…) écrites par SERVICE_ROLE seul. Cf. [[09 - Authentification et permissions#Q2 — `entites_facturation`]].

---

### Table : `file_revalidation_siret` *(nouvelle V1 — ajout 2026-06-30, divergence M0.4 / lot R13 onboarding)*

File d'attente **interne plateforme** qui matérialise le job asynchrone de revalidation SIRET imposé par [[15 - Sécurité et conformité#2.6 Protection contre les abus à l'onboarding]] (l.73 — 3 paliers 15 min / 1 h / 24 h quand INSEE est injoignable au signup). Sans elle, aucune structure ne porte l'état du job (statut / tentatives / prochaine tentative) : l'enqueue au signup et le worker cron n'auraient nulle part où persister leur avancement.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `entite_facturation_id` | uuid | FK → entites_facturation, NOT NULL | Entité dont le SIRET reste à revalider |
| `statut` | text | NOT NULL, CHECK IN (`en_attente`, `resolu`, `epuise`), défaut `en_attente` | `resolu` = INSEE a répondu (verdict écrit dans `entites_facturation.siret_verification`) ; `epuise` = 3 paliers échoués sans réponse INSEE |
| `tentatives` | integer | NOT NULL, défaut 0 | Compteur de paliers consommés (max 3) |
| `prochaine_tentative_le` | timestamptz | NOT NULL, défaut now() | Échéance de la prochaine tentative (scan cron). Sur une ligne terminale (`resolu`/`epuise`), la valeur n'est plus relue et n'est pas remise à NULL |
| `derniere_erreur` | text | | Dernier motif d'échec (timeout, 5xx…) |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Contraintes / index** :
- `UNIQUE (entite_facturation_id) WHERE statut = 'en_attente'` — idempotence de l'enqueue (une entité n'a qu'une revalidation active à la fois).
- Index `(prochaine_tentative_le) WHERE statut = 'en_attente'` — scan du worker cron.
- Choix `text` + `CHECK` (pas d'ENUM) pour `statut` : évite une convergence de nom d'ENUM supplémentaire au cutover V2 (cf. migration `…_converge_enums_noms_cible`).

**RLS** : DENY ALL par défaut + 1 policy lecture staff (`frs_staff_select` via `f_is_staff()`, debug Ops) ; écriture `SERVICE_ROLE` seul (enqueue au signup + worker cron). Aucun rôle client.

**Forward-compatible (garde-fou G1)** : file **purement plateforme** (gating facturation) — le TMS V2 n'en a aucun besoin, aucune sémantique partagée. Ajout neutre à intégrer au DDL cible V2 pour que le diff schéma V1↔cible reste vide (même statut V1-only assumé que `nb_camions_demande` / `pesees_tournees`, liste fermée Frontière G1).

---

### Table : `organisations_lieux` *(table de jointure N-N)*

Associe une organisation (gestionnaire de lieux ou agence) aux lieux qu'elle peut voir.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `organisation_id` | uuid | FK → organisations, NOT NULL | |
| `lieu_id` | uuid | FK → lieux, NOT NULL | |
| `created_at` | timestamptz | NOT NULL | |
| `created_by` | uuid | FK → users | Admin Savr qui a créé l'association |

**Note V1 (2026-05-07)** : utilisé **uniquement pour les gestionnaires de lieux** (ex: profil Viparis voit ses 15 lieux). Le périmètre agence est ouvert en V1 — toute agence peut programmer sur n'importe quel lieu sans entrée préalable dans cette table. Si verrouillage agence requis en V1.5, ajouter flag `organisations.agence_perimetre_ferme` + utiliser `organisations_lieux` pour matérialiser le périmètre fermé.

**RLS (BLOQUANT — audit RLS V1 2026-06-05)** : table de jointure référencée dans les sous-requêtes RLS de `evenements`/`lieux`/`collectes`. RLS activée **sans policy = deny total → casse silencieuse** des policies dépendantes. Policy obligatoire (admin ALL + `org_lieux_self_select` sur `organisation_id`). Cf. [[09 - Authentification et permissions#A1 — `organisations_lieux`]].

---

## Niveau 2 — Référentiel

### Table : `types_evenements`

Référentiel des types d'événement. Extensible par Admin Savr (ajout/modification sans redéploiement).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `code` | text | NOT NULL, UNIQUE | Slug technique, ex: `cocktail_aperitif`, `cocktail_repas_complet`, `repas_assis` |
| `libelle` | text | NOT NULL | Nom affiché, ex: "Cocktail apéritif" |
| `ordre_affichage` | integer | NOT NULL, défaut 0 | Pour trier dans les dropdowns |
| `actif` | boolean | NOT NULL, défaut `true` | Désactiver sans supprimer (préserve l'historique) |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Valeurs initiales (seed)** *(refonte Sujet 4 — type vs taille, 2026-05-26 ; ex `cocktail_10`/`cocktail_24`/`diner_assis`)* :
- `cocktail_aperitif` → "Cocktail apéritif"
- `cocktail_repas_complet` → "Cocktail repas complet"
- `repas_assis` → "Repas assis"
- `autre` → "Autre" (catégorie fourre-tout sélectionnable **sans saisie de texte** — pas de `type_evenement_libre`, pas de file de normalisation)

> **Décision Sujet 4 (2026-05-26)** : le `type_evenement` ne capture que le **format de service** (qui pilote le volume de déchet), distinct de la **taille** de l'événement qui se dérive du `pax` via `taille_evenement_bracket()` (XS→XL, cf. table `evenements`). Le seed mélangeait auparavant les deux (les libellés `<10 pièces`/`<24 pièces` désignaient les pièces par convive et étaient lus à tort comme un nombre d'invités). Les libellés ne portent désormais plus aucun nombre. remplacés (la FK `evenements.type_evenement_id` étant un uuid, le renommage du `code` n'exige **aucune migration des `evenements`** — mapping reprise Bubble cf. [[13 - Migration depuis Bubble]]).

**Impact métier** : le `type_evenement_id` peut influencer la tarification future (grille différente cocktail vs repas). La grille tarifaire actuelle ne dépend que du pax, mais le modèle permet de faire évoluer sans migration. La catégorie `autre` est comptée comme un bucket benchmark normal (plus d'exclusion des agrégats : le mécanisme de texte libre + normalisation est retiré V1, cf. addendum §4/§6 ci-dessus + `R_type_evenement_libre` retirée §05). Référentiel **extensible par ajout direct de ligne** (Admin/Supabase), sans UI dédiée.

---

### Table : `prestataires_logistiques` → migrée vers `shared.prestataires` (2026-04-23 seconde salve)

> ⚠ **Cette table a été migrée vers `shared.prestataires`** (cf. addendum seconde salve en tête de document). Le contenu ci-dessous décrit le schéma historique et sert de **base de référence** pour les colonnes reprises dans `shared.prestataires`. Les FK pointent désormais vers `shared.prestataires.id`. Écriture côté TMS (M06), lecture cross-schema Plateforme. Voir [[../02 - Cahier des charges TMS/04 - Data Model TMS]] pour le détail complet du schéma `shared.prestataires`.

Référentiel des partenaires logistiques externes (collecte + transport). Géré par Admin Savr.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `nom` | text | NOT NULL | ex: "Strike", "Marathon", "A Toutes!" |
| `code` | text | NOT NULL, UNIQUE | ex: `strike`, `marathon`, `a_toutes` |
| `type_prestation` | enum | NOT NULL | `zero_dechet` \| `anti_gaspi` \| `mixte` |
| `mode_integration` | enum | NOT NULL | `api` \| `email` \| `manuel` |
| `api_config` | jsonb | | Config API (endpoint, credentials ref) si `mode_integration=api` |
| `siret` | text | | Pour mention sur bordereaux Savr |
| `tva_intracom` | text | | |
| `adresse` | text | | Pour mention sur bordereaux |
| `contact_nom` | text | | |
| `contact_email` | text | | |
| `contact_telephone` | text | | |
| `actif` | boolean | NOT NULL, défaut `true` | |
| `commentaires_internes` | text | | |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Note** : cette table est distincte de `organisations` car les prestataires logistiques ne sont pas des clients Savr (pas de users, pas de facturation entrante, pas de RLS par organisation). C'est un référentiel opérationnel.

**Valeurs initiales (seed)** :
- `strike` → "Strike" (zero_dechet, api via TMS Savr)
- `marathon` → "Marathon" (anti_gaspi, email)
- `a_toutes` → "A Toutes!" (anti_gaspi, api Everest)

**Colonnes ajoutées post-migration côté TMS (à lire cross-schema)** :

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `nb_collectes_6_mois_cache` | integer | NOT NULL, défaut `0` | **Propagation A1 audit cohérence inter-CDC 2026-04-25** (ajout côté §04 Plateforme via audit 2026-04-29 A5). Cache pour tri province multi-candidats (reco C5 M12 TMS). MAJ par trigger TMS `AFTER INSERT/UPDATE` sur `tms.collectes_tms` quand `statut_dispatch IN ('attribuee_en_attente_acceptation','acceptee','en_attente_execution')`. Purge glissante via cron daily TMS. Côté Plateforme : **lecture seule cross-schema** (pas d'écriture). Index TMS `(type_prestation, statut, nb_collectes_6_mois_cache)` pour lookup province performant. Voir [[../02 - Cahier des charges TMS/04 - Data Model TMS#4. shared.prestataires — 1 nouvelle colonne nb_collectes_6_mois_cache]]. |

---

### Table : `lieux`

Base de données propriétaire de tous les lieux d'événement. Référentiel initié à la migration depuis Bubble et modifiable ensuite par l'Admin Savr uniquement.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `nom` | text | NOT NULL | Nom du lieu (ex: "Palais des Congrès - Salle Havane") |
| `nom_alternatif` | text | | Alias ou nom court |
| `adresse_acces` | text | NOT NULL | Adresse / point d'accès logistique pour la collecte (renommé depuis `adresse_acces_livraison` lors de la suppression de `adresse_grand_public` revue sobriété M05 2026-04-29 — devient l'adresse unique du lieu, obligatoire) |
| `code_postal` | text | NOT NULL | |
| `ville` | text | NOT NULL | |
| `latitude` | float | | Pour le calcul de distance algo Anti-Gaspi |
| `longitude` | float | | |
| `region` | enum | | `idf` \| `province` |
| `acces_details` | text | | **RW Admin Savr + RW TMS Ops/Admin (column-level GRANT, propagation A2 audit cohérence 2026-04-28)** — "Carnet d'accès terrain" partagé : badge, code, interphone, contact gardien, **digicode/bip parking** (ex-`code_acces` addendum), **notes stationnement texte libre** (ex-`parking` addendum). Toute mise à jour est tracée dans `audit_log` standard. |
| `acces_office` | enum nullable | | **Refonte 2026-05-08** — enum `facile` \| `difficile` \| `tres_difficile` (ex texte libre). Difficulté d'accès à l'office/cuisine/zone récupération déchets. Migration via UI Admin V1.1 (file de normalisation lieux) — en attendant : NULL par défaut, ressaisie manuelle Admin lieu par lieu. RW Admin Savr + RW TMS Ops/Admin. Notes terrain horaires/ascenseur → `acces_details`. |
| `stationnement` | enum nullable | | **Refonte 2026-05-08** — enum `facile` \| `difficile` \| `tres_difficile` (ex enum 4 valeurs "type d'emplacement" `parking_dedie/quai_livraison/stationnement_rue/zone_livraison_courte` post-revue sobriété §08 Bloc D 2026-05-01 D4). **Changement de nature** : type d'emplacement → difficulté d'accès. Pas de migration depuis Bubble — nouveau référentiel à ressaisir lieu par lieu post-migration. RW Admin Savr. Notes texte libre stationnement → `acces_details`. |
| `type_vehicule_max` | enum | NOT NULL | **Refonte 2026-05-08** — `velo_cargo` \| `camionnette` \| `fourgon` \| `vul` \| `poids_lourd` (ex `vl/camion_16m3/camion_20m3/camion_30m3`). Aligné sur `transporteurs.types_vehicules` — hiérarchie unique du plus petit au plus gros. Sémantique : capacité max acceptée par le lieu, tous les véhicules ≤ max sont compatibles (cf. [[05 - Règles métier#R_compatibilite_vehicule_lieu]]). Migration manuelle Admin (ressaisie lieu par lieu post-migration). |
| `contraintes_horaires` | text | | Plages horaires autorisées pour la collecte. RW Admin Savr (info commerciale). |
| `flux_autorises` | text[] | | Liste des flux acceptés sur ce lieu |
| `volume_max_bacs` | integer | | Nombre max de bacs 1100L acceptés |
| `traiteurs_operant` | uuid[] | | FK implicites → organisations (type=traiteur). Liste des traiteurs connus pour opérer sur ce lieu (information indicative, alimentée à la migration + enrichie automatiquement à chaque nouvelle collecte sur ce lieu) |
| `controle_acces_requis_default` | boolean | NOT NULL, défaut `false` | **M03 TMS 2026-04-24 (D8) — restauré 2026-05-01 (annulation partielle revue sobriété M05 2026-04-29 + Bloc C C3, audit cohérence inter-CDC) — renommé 2026-05-03 (refonte formulaire §06.01 : flag unique plaque + nom chauffeur)** : valeur par défaut propagée aux nouvelles collectes sur ce lieu. Si `true` → la collecte hérite `controle_acces_requis=true` sauf override traiteur au formulaire. Sert le besoin métier "site sécurisé exige plaque ET nom chauffeur pour contrôle SAS → manager prestataire pré-saisit les deux en M03 E4 → blocage validation tournée si manquante (R_M04.CONTROLE_ACCES TMS, ex R_M04.PLAQUE)". RW Admin Savr (référentiel lieu) + RW indirect via cascade upgrade-only depuis formulaire programmation (R_controle_acces_cascade §05 : cocher la case update le lieu, décocher non). Ancien nom `plaque_requise_default` (sémantique étendue à plaque + nom chauffeur). |
| `photos_urls` | text[] | | URLs des photos du lieu (stockées dans Supabase Storage) |
| `commentaires_internes` | text | | Notes opérationnelles Admin Savr (technique migration, contexte historique). Distinct de `commentaire_lieu` (commercial/contextuel). |
| `commentaire_lieu` | text | NULL | **Ajout 2026-05-08** — Commentaire interne Savr (contexte commercial, alerte ops, note opérationnelle). Distinct de `acces_details` (consignes terrain partagées TMS) et `commentaires_internes` (note technique migration). RLS column-level admin/ops only, **strictement invisible** côté traiteur/agence/gestionnaire/client organisateur. |
| `siren` | text | NULL, CHECK `siren ~ '^[0-9]{9}$'` | **Ajout 2026-05-08** — SIREN propriétaire du lieu (peut différer du SIREN du gestionnaire si filiale, lieu indépendant géré par un tiers). Pas d'auto-fill depuis le gestionnaire. RLS admin/ops only. |
| `email_gestionnaire` | text | NULL | **Ajout 2026-05-08** — Email référent gestionnaire (différent du contact terrain `evenements.contact_*`). Usage : relances commerciales/opérationnelles internes Savr. RLS admin/ops only. |
| `reference_citeo` | boolean | NOT NULL, défaut `false` | **Ajout 2026-05-08** — Lieu référencé Citeo (REP emballages). Usage interne Savr (reporting). RLS admin/ops only. |
| `actif` | boolean | NOT NULL, défaut `true` | |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Relations** :
- 1 lieu → N événements (via `evenements.lieu_id`)
- N-N lieux ↔ organisations (via `organisations_lieux`)
- N-N lieux ↔ gestionnaires avec tarifs préférentiels (via `tarifs_negocie`)

**Visibilité champs admin/ops only** *(ajout 2026-05-08)* : les colonnes `commentaire_lieu`, `siren`, `email_gestionnaire`, `reference_citeo` sont protégées par column-level GRANT (cf. [[09 - Authentification et permissions]]) et **jamais exposées** dans le payload S7 Plateforme→TMS (cf. [[08 - APIs et intégrations]]). Lecture/écriture limitées aux profils `admin_savr` + `ops_savr`.

**Note** : ces données sont transmises au TMS Savr via l'API au moment de l'envoi d'une collecte programmée. Le TMS ne stocke pas le référentiel lieux — il le consomme depuis la Plateforme. Le champ `traiteurs_operant` est mis à jour automatiquement (cron quotidien) à partir des collectes réalisées sur le lieu, pour enrichir le référentiel sans saisie manuelle.

---

### Table : `contacts_traiteurs`

Référentiel des contacts terrain par organisation (traiteur ou agence). Permet l'autocomplete dans le formulaire de programmation (contact principal + contact secours) et évite la ressaisie.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `organisation_id` | uuid | FK → organisations, NOT NULL | Orga propriétaire du contact |
| `prenom` | text | NOT NULL | |
| `nom` | text | NOT NULL | |
| `telephone` | text | NOT NULL | Format E.164 recommandé |
| `email` | text | | Optionnel |
| `fonction` | text | | ex: "Chef de salle", "Responsable événement" |
| `utilise_nb_fois` | integer | NOT NULL, défaut 0 | Incrémenté à chaque réutilisation (tri de l'autocomplete) |
| `derniere_utilisation` | timestamptz | | Pour classement récence |
| `actif` | boolean | NOT NULL, défaut `true` | |
| `created_by` | uuid | FK → users | User qui a saisi le contact la première fois |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Règles** :
- Unicité `(organisation_id, telephone)` ou `(organisation_id, prenom, nom)` pour éviter les doublons.
- Alimenté automatiquement à chaque programmation de collecte : si le contact saisi n'existe pas dans le référentiel de l'organisation, il est créé et rattaché. S'il existe (match téléphone ou nom complet), on incrémente `utilise_nb_fois`.
- Isolation RLS : une orga ne voit que ses propres contacts.

**Impact métier** : accélère la programmation répétée (les commerciaux saisissent 2-3 contacts récurrents dans 90% des cas).

---

### Table : `tournees`

**Nouvelle entité V1**. Une tournée = un camion qui réalise N collectes successives sur une journée (ou demi-journée). Permet de rattacher plusieurs collectes / événements à une même logistique. Concept critique pour l'optimisation logistique Savr.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `reference_interne` | text | NOT NULL, UNIQUE | ex: `TRN-2026-00147` (séquence Savr) |
| `date_tournee` | date | NOT NULL | Date de réalisation |
| `creneau` | enum | NOT NULL | `matin` \| `apres_midi` \| `soir` \| `nuit` \| `journee_complete` |
| `heure_debut_prevue` | time | | |
| `heure_fin_prevue` | time | | |
| `heure_debut_reelle` | timestamptz | | Remontée TMS. **Type corrigé `time` → `timestamptz` (2026-06-11, audit data model)** : les collectes Savr sont la nuit — une tournée 23h→2h donnait `heure_fin < heure_debut` en `time`, cassant tout calcul de durée. Aligné sur le TMS (`tms.tournees.heure_reelle_debut/fin` déjà en timestamptz). |
| `heure_fin_reelle` | timestamptz | | Remontée TMS. **Type corrigé (2026-06-11, idem)** — supporte le passage de minuit. |
| `prestataire_logistique_id` | uuid | FK → **`shared.prestataires`**, NOT NULL | *(FK repointée — résidu `prestataires_logistiques` corrigé 2026-06-11, migration D14 2026-04-23)* |
| `type_vehicule` | enum | | **Refonte 2026-05-08** — `velo_cargo` \| `camionnette` \| `fourgon` \| `vul` \| `poids_lourd` (ex `vl/camion_16m3/camion_20m3/camion_30m3`). Aligné sur `lieux.type_vehicule_max` + `transporteurs.types_vehicules`. Permet de vérifier la compatibilité tournée ↔ lieu(x) servi(s) (cf. [[05 - Règles métier#R_compatibilite_vehicule_lieu]]). **Origine — V1** (réconcilié 2026-06-10, challenge Frontière : `tms.*` non créé en V1, ni vue ni trigger cross-schema possibles) : renseigné directement par l'**adapter MTS-1** à la création de la tournée (déduit du `volume_du_camion` envoyé au create tour ZD + du référentiel `transporteurs.types_vehicules` ; `velo_cargo` pour A Toutes!). **V2** : dérivé de `tms.types_vehicules.categorie_plateforme` via vue cross-schema `plateforme.v_tms_types_vehicules_categories` (cf. [[02 - Cahier des charges TMS/04 - Data Model TMS]] — table `types_vehicules` ajout 2026-05-08), sync à l'INSERT/UPDATE `plateforme.tournees` via trigger DB cross-schema lookup sur `tms.tournees.vehicule_id → tms.vehicules.type_vehicule_id → tms.types_vehicules.categorie_plateforme` (source unique de vérité). Si Ops modifie cette colonne TMS a posteriori, propagation aux `plateforme.tournees` existantes via batch (volume acceptable, pas de propagation auto live). |
| `plaque_immatriculation` | text | nullable | **Restaurée 2026-05-01 (annulation Bloc C C3 + audit cohérence inter-CDC)** — plaque officielle de la tournée. **Alimentation — V1** (réconcilié 2026-06-10, challenge Frontière) : adapter MTS-1 = `dispatch.vehicleShareableCode` du tour → match `GET /v3/carrier` `vehicles[].numberPlate` (cf. relevé as-built §6) ; **V2** : webhook S7 à la saisie manager prestataire en M03 E4 (`tms.tournees.plaque_preassignee_manager`). Cas vélo cargo A Toutes! → reste NULL (pas de plaque à attribuer). **Propagation suppression saisie plaque terrain 2026-06-04 (arbitrage Val)** : la saisie plaque chauffeur (`tms.tournees.plaque_saisie_terrain` M05 E3) est supprimée côté TMS — il ne reste qu'une seule plaque dans le système, la plaque manager portée par cette colonne. Aucun impact sur cette colonne ni sur l'affichage traiteur. |
| `plaque_saisie_at` | timestamptz | nullable | **Restaurée 2026-05-01 (annulation Bloc C C3)** — **V1** : timestamp de la résolution plaque par l'adapter au polling ; **V2** : horodatage de la saisie manager M03 E4 (= timestamp réception webhook S7). Permet monitoring Admin "délai acceptation tournée → saisie plaque manager" + dashboard traiteur "plaque disponible depuis X". |
| `chauffeur_nom` | text | | |
| `chauffeur_telephone` | text | | |
| `statut` | enum | NOT NULL | **4 valeurs (corrigé 2026-06-11, audit data model)** : `planifiee` \| `en_cours` \| `terminee` \| `annulee`. L'ex-valeur `confirmee_prestataire` est retirée : aucun flux ne l'écrivait — le contrat S3 V2 pousse 4 valeurs (l'état interne TMS `acceptee` est mappé `planifiee` côté App, arbitrage M04 2026-06-06), et en V1 l'adapter MTS-1 mappe les états tour : création/dispatch → `planifiee`, démarrage → `en_cours`, `OK`/`PARTIAL` → `terminee`, `CANCELED`/`KO` → `annulee` (cf. CLAUDE.md multi-camions + §08 §3bis). |
| `tms_reference` | text | | Identifiant de la tournée côté TMS Savr (V2) / `tourId` MTS-1 (V1, créé par l'adapter à l'envoi). |
| `external_ref_commande` | text | nullable | **(ajout 2026-06-08, multi-camions V1)** Référence **neutre** de la commande logistique externe = `customerOrderId` MTS-1 en V1, une par tournée/camion (`tms_reference` = id tournée/tour ; cette colonne = id commande). Permet à l'adapter MTS-1 de retrouver une commande déjà envoyée → **idempotence du retry** (cf. [[08 - APIs et intégrations]] §3bis.5). Neutre TMS-Ready (garde-fou 5, jamais d'id MTS-1 en dur). |
| `notes_internes` | text | | |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Relations** *(refonte multi-camions 2026-05-25 — ex-lien `collectes.tournee_id` singulier retiré)* :
- Relation **N↔N** entre `collectes` et `tournees` via la table de liaison `collecte_tournees`. Deux cas réels couverts par le même mécanisme :
  - **Mutualisation** : 1 tournée → N collectes (un camion enchaîne plusieurs collectes proches dans la même fenêtre).
  - **Multi-camions** : 1 collecte → N tournées (une grosse collecte, ex. 3000 pax, servie par 3 camions = 3 tournées). **Qui décide N — distinction V1/V2 (précisé 2026-06-08, réalité opérationnelle Val) :**
    - **V1 (adapter MTS-1, polling)** : **Ops Savr décide N manuellement** au dispatch (`collectes.nb_camions_demande`). L'adapter crée les N customerOrders + N tournées sur MTS-1 et peuple `collecte_tournees`. C'est l'adapter (pas un webhook) qui alimente les tournées à l'envoi.
    - **V2 (TMS natif)** : retour au modèle initial — le **TMS décide** le découpage selon le volume réel et pousse les tournées en retour (option a, arbitrage 2026-05-25). L'App lit/affiche.
    - **Data model identique** dans les deux cas (mêmes tables, même sémantique) ; seul change l'acteur qui décide/peuple — garde-fou 2 TMS-Ready préservé.
- 1 tournée → 1 prestataire logistique

**Règles** :
- Une collecte peut être rattachée à 0, 1 ou N tournées (0 = collecte AG gérée via Everest non rattachée à une tournée Savr ; 1 = cas standard ; N = multi-camions). Lien porté par `collecte_tournees`.
- **Statut de la collecte agrégé sur ses tournées** *(refonte multi-camions 2026-05-25 — réconcilié V1/V2 2026-06-10, challenge Frontière : ce bloc contredisait le bloc Relations ci-dessus et §08 §3bis.5)* : la collecte passe `en_cours` dès qu'**au moins une** de ses tournées démarre. Elle passe `realisee` / `realisee_sans_collecte` une fois **toutes** ses tournées terminées. **Qui agrège — distinction V1/V2** : **V1 (adapter MTS-1, polling)** = c'est **l'adapter** qui détecte au polling que tous les tours `rang=1..N` sont terminés, agrège les pesées et produit l'effet terminal (**pas de webhook S5 en V1**, cf. §08 §3bis.5 « Agrégation terminale V1 ») ; **V2 (TMS natif)** = le TMS attend tous les camions, agrège les pesées et émet le **S5 terminal unique** (arbitrage 2026-05-25 option a) — l'App ne calcule alors plus rien elle-même. `collectes.realisee_at` = horodatage de cet effet terminal (= départ de l'embargo H+24 du rapport, cf. §12). Voir [[05 - Règles métier#R_statut_collecte_multi_tournees]].
- **Retiré V1 (propagation Q10 M05 2026-04-24)** — scheduler `scheduler-email-plaque` supprimé. **Webhook S7 `tms/plaque-saisie` restauré 2026-05-01 (annulation Bloc C C3, audit cohérence inter-CDC)** : émis à la saisie manager prestataire en M03 E4, alimente `tournees.plaque_immatriculation` + `plaque_saisie_at` Plateforme. **Saisie plaque chauffeur supprimée V1 (propagation 2026-06-04, arbitrage Val)** : il ne reste qu'une seule plaque, la plaque manager (ce webhook S7). S7 inchangé.

**Impact métier** : base du dashboard Admin "Tournées du jour", base de la mutualisation logistique (marge), base de la traçabilité chauffeur/véhicule.

---

### Table : `collecte_tournees`

**Nouvelle entité V1 (refonte multi-camions 2026-05-25)**. Table de liaison **N↔N** entre `collectes` et `tournees`. Remplace l'ancien lien `collectes.tournee_id` singulier (retiré). Porte deux cas réels avec un seul mécanisme : la **mutualisation** (une tournée sert plusieurs collectes) et le **multi-camions** (une collecte est servie par plusieurs tournées). **Alimentation — V1** : peuplée par l'**adapter MTS-1** à l'envoi (1 ligne par couple collecte×tournée créée, cf. §08 §3bis.5) ; **V2** : alimentée par le webhook S3 `tournee-upsert` émis par le TMS (cf. [[08 - APIs et intégrations#Notion de tournée]]). *(Réconcilié V1/V2 2026-06-10, challenge Frontière.)*

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `collecte_id` | uuid | FK → collectes, NOT NULL | |
| `tournee_id` | uuid | FK → tournees, NOT NULL | |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Contraintes** :
- `UNIQUE (collecte_id, tournee_id)` — un couple collecte/tournée ne peut exister qu'une fois.
- Index sur `collecte_id` (lecture "les N tournées d'une collecte" : contrôle d'accès, marge, statut) et sur `tournee_id` (lecture "les N collectes d'une tournée" : mutualisation, prorata coût).

**Relations** :
- N collectes ↔ N tournées.
- Pas de coût/ordre porté ici *(asymétrie volontaire avec `tms.collecte_tournees` qui porte `cout_reparti_centimes` + `ordre_dans_tournee` — confirmé audit 2026-05-26 B1)* : la quote-part de coût est calculée côté TMS et lue par la Plateforme via `v_courses_logistiques.cout_reparti_ht` (somme par `collecte_id`). L'ordre de passage est interne TMS (Haversine). La liaison Plateforme ne sert qu'aux liens (contrôle d'accès multi-plaques, agrégation de statut).

**Règles** :
- Pas de FK déclenchant de cascade de statut : la règle d'agrégation de statut collecte est portée applicativement (cf. table `tournees` règles + [[05 - Règles métier#R_statut_collecte_multi_tournees]]).
- Une collecte AG via Everest n'a aucune ligne ici (0 tournée Savr).

**Impact métier** : socle du calcul de marge multi-tournées, de l'affichage multi-plaques (contrôle d'accès §06.04) et de l'agrégation de statut.

---

### Table : `tarifs_negocie`

**Refonte 2026-05-26 (tarification ZD multi-méthodes + remises) — la table ne porte plus que des remises en pourcentage.** Avant cette refonte, `tarifs_negocie` portait des prix négociés absolus (`prix_ht`). Désormais le **prix de base** est porté par la couche catalogue (`grilles_tarifaires_zd` pour le ZD, `tarifs_packs_ag` pour l'AG), et `tarifs_negocie` ne contient que des **remises** appliquées par-dessus la base. Cela sépare proprement « méthode de calcul du prix » (catalogue, réutilisable) et « réduction accordée à un client/lieu » (remise).

Une ligne = une remise % éligible selon son scope. Plusieurs remises éligibles pour une même collecte se **cumulent multiplicativement** (décision Val 2026-05-26).

Exemples couverts :
- Viparis (gestionnaire) accorde −5 % à tout traiteur opérant sur ses lieux → `activite=zd`, `scope=gestionnaire`, `gestionnaire_organisation_id=viparis`, `lieu_id=null`, `remise_pct=0.05`
- Viparis accorde une remise spécifique sur un seul lieu → idem avec `lieu_id` renseigné
- Remise négociée directement avec un traiteur sur ses collectes AG unitaires → `activite=ag`, `scope=organisation`, `organisation_id=...`, `remise_pct=...`

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `activite` | enum | NOT NULL | `zd` \| `ag` — l'activité sur laquelle porte la remise |
| `scope` | enum | NOT NULL | `organisation` \| `gestionnaire` |
| `organisation_id` | uuid | FK → organisations | Renseigné si `scope=organisation` — organisation bénéficiaire (traiteur/agence/gestionnaire programmateur) |
| `gestionnaire_organisation_id` | uuid | FK → organisations | Renseigné si `scope=gestionnaire` — gestionnaire négociateur (ex: Viparis) |
| `lieu_id` | uuid | FK → lieux | Optionnel pour `scope=gestionnaire` — null = tous les lieux du gestionnaire |
| `remise_pct` | decimal | NOT NULL, CHECK (> 0 AND <= 1) | Remise en fraction (ex: `0.05` = −5 %). % uniquement en V1 (remise en montant € reportée V1.1). |
| `valide_du` | date | NOT NULL | |
| `valide_jusqu_au` | date | | null = actif |
| `commentaires` | text | | Conditions négociées — usage interne Admin Savr |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Règles** :
- **Cumul multiplicatif** : si plusieurs remises sont éligibles pour une collecte (ex. remise traiteur `scope=organisation` + remise lieu `scope=gestionnaire`), le prix final = `base × Π(1 − remise_pct)`. Pas de plafond dur V1 (saisie Admin contrôlée). Voir la règle de résolution complète [[05 - Règles métier#Tarifs et remises — résolution du prix]].
- **La remise s'applique sur la base, qu'elle soit publique ou négociée** : la base ZD vient de la grille du catalogue affectée à l'organisation (`grilles_tarifaires_zd`), la base AG est le tarif unitaire (`tarifs_packs_ag` type `unitaire`).
- **Périmètre AG** : la remise AG ne s'applique qu'aux collectes AG **facturées à l'unité** (hors pack). Une collecte qui décrémente un pack prépayé n'est pas facturée à la collecte → rien à remiser.
- Versioning : jamais de modification rétroactive, fermeture (`valide_jusqu_au`) + nouvelle ligne.
- Contrainte de cohérence : `organisation_id` et `gestionnaire_organisation_id` sont mutuellement exclusifs (CHECK selon `scope`).
- Traçabilité : la remise effectivement appliquée est figée dans `factures_collectes.tarif_detail` (jsonb, snapshot base + remises) en plus du `montant_ligne_ht` final.

**Migration** : les anciennes lignes `tarifs_negocie` portant un `prix_ht` absolu sont reprises ainsi — un tarif de base négocié devient une grille dédiée du catalogue (`grilles_tarifaires_zd`) affectée à l'organisation ; un rabais devient une ligne `remise_pct`. Cas AG « tarif par collecte négocié » (ex. Potel & Chabot) : repris via pack `personnalise` (`tarifs_packs_ag`) ou remise % selon la négociation ; le montant libre Admin à la facture reste l'override final (cf. `factures_collectes`).

**Impact métier** : couvre Viparis (−5 % sur tous ses lieux), les remises traiteur, et le cumul base négociée + remise lieu, sans mélanger base et réduction dans la même ligne.

---

### Table : `flux_dechets`

Référentiel des types de déchets collectés V1. Administré par Admin Savr.

**Décision Val 2026-05-02** : enum **fermée V1** à 5 valeurs canoniques. Suppression définitive des flux historiques (`dib` renommé `dechet_residuel` ; suppression de `dangereux`, `huiles`, `papier`, `deee`, `gravats`, `terre`). Justification : Savr ne collecte aucun de ces flux supprimés, hypothèse acceptée par Val. Le référentiel reste techniquement extensible (table, pas enum SQL stricte) pour permettre un ajout V2 sans migration, mais aucun ajout V1 n'est autorisé sans validation produit.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `nom` | text | NOT NULL | ex: "Biodéchets", "Déchet résiduel", "Verre" |
| `code` | text | NOT NULL, UNIQUE | Enum fermée V1 : `biodechet` \| `emballage` \| `carton` \| `verre` \| `dechet_residuel`. Singulier — enum partagé avec CDC TMS §04 + §08. CHECK constraint applicatif. |
| `unite_mesure` | enum | NOT NULL | `kg` \| `litre` \| `bac` |
| `ordre_affichage` | integer | NOT NULL, défaut 0 | Pour trier dans le formulaire de programmation |
| `exutoire` | text | | ex: "Veolia Saint-Denis" |
| `exutoire_adresse` | text | | Pour mention sur bordereau Savr |
| `exutoire_siret` | text | | Pour mention sur bordereau Savr |
| `code_dechet_europeen` | text | | Nomenclature européenne 6 chiffres (ex: `20 01 08` biodéchets, `15 01 01` emballages) — obligatoire sur bordereau |
| `filiere_valorisation` | enum | NOT NULL | `recyclage` \| `compostage` \| `methanisation` \| `valorisation_energetique` \| `enfouissement` \| `don_alimentaire` |
| `eligible_citeo` | boolean | défaut `false` | Pour le reporting REP futur |
| `actif` | boolean | NOT NULL, défaut `true` | |

**Valeurs initiales (seed V1 — 5 flux)** :

| code | nom | unite_mesure | filiere_valorisation | code_dechet_europeen |
|------|-----|--------------|---------------------|---------------------|
| `biodechet` | Biodéchets | kg | `methanisation` ou `compostage` | `20 01 08` |
| `emballage` | Emballages | kg | `recyclage` | `15 01 02` (plastique) ou `15 01 04` (métal) selon matériau |
| `carton` | Carton | kg | `recyclage` | `15 01 01` |
| `verre` | Verre | kg | `recyclage` | `15 01 07` |
| `dechet_residuel` | Déchet résiduel | kg | `valorisation_energetique` | `20 03 01` |

**Migration historique** (depuis Bubble + TMS legacy) :
```sql
-- 1. Renommage dib → dechet_residuel
UPDATE flux_dechets SET code = 'dechet_residuel', nom = 'Déchet résiduel' WHERE code = 'dib';
UPDATE collecte_flux SET flux_id = (SELECT id FROM flux_dechets WHERE code = 'dechet_residuel') WHERE flux_id IN (SELECT id FROM flux_dechets WHERE code = 'dib');
-- bordereaux_savr.detail_flux jsonb → script post-migration scan + replace

-- 2. Suppression flux historiques (papier fusionné dans carton, autres totalement supprimés)
-- 2a. Vérification préalable (échec migration si non-vide) :
SELECT COUNT(*) FROM collecte_flux cf JOIN flux_dechets fd ON cf.flux_id = fd.id WHERE fd.code IN ('papier','dangereux','huiles','deee','gravats','terre');
-- Si 0 → DELETE flux_dechets WHERE code IN (...) ; sinon stop migration et arbitrage Val.
-- 2b. Pour le cas papier (si lignes existantes) : merge dans carton
UPDATE collecte_flux SET flux_id = (SELECT id FROM flux_dechets WHERE code = 'carton') WHERE flux_id IN (SELECT id FROM flux_dechets WHERE code = 'papier');
DELETE FROM flux_dechets WHERE code IN ('papier','dangereux','huiles','deee','gravats','terre');
```

**Note** : cette enum est figée V1. Tout ajout V2 nécessite une décision produit explicite + propagation alignée sur §08 contrat API + M05 chauffeur + M10 stocks Veolia.

---

### Table : `parametres_taux_recyclage` *(ajout 2026-05-06)*

Référentiel des **taux de captation par filière** utilisés pour le calcul du **Taux de recyclage** (cf. addendum 2026-05-06 §2 formule). 4 lignes V1 (verre, carton, biodéchet, emballage). Granularité Niveau 1 (MVP) — taux globaux Savr, extensible V2 vers prestataire et V3 vers couple lieu × filière. **ZD uniquement** (l'OMR n'a pas de taux de captation associé).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `code_filiere` | enum | NOT NULL, UNIQUE | `verre` \| `carton` \| `biodechet` \| `emballage`. Cohérent avec `flux_dechets.code` (sauf `dechet_residuel` exclu). |
| `nom_filiere` | text | NOT NULL | Libellé UI (ex: "Verre", "Carton", "Biodéchets", "Emballages") |
| `taux_captation` | decimal(5,4) | NOT NULL, CHECK 0 ≤ x ≤ 1 | Valeur entre 0 et 1 (ex: 0.9600 pour 96 %) |
| `prestataire` | text | | Texte libre — prestataire associé V1 (ex: "Citeo", "Veolia/A Toutes!"). Évolutif V2 vers FK. |
| `source_donnee` | text | | Référence source (ex: "Citeo 2023", "ADEME ITOM 2017") |
| `commentaire` | text | | Notes Admin (ex: "Moyenne nationale 2023 — à raffiner avec bordereaux Strike Q3 2026") |
| `actif` | boolean | NOT NULL, défaut `true` | Permet désactivation sans suppression (audit trail conservé). Si `actif=false` → fallback comportement Admin (cf. §05 Règles métier). |
| `date_maj` | timestamptz | NOT NULL | Date effective de la dernière modification du taux (distincte de `updated_at` qui peut bouger pour autres champs) |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Seed V1 (4 lignes — moyennes nationales)** :

| code_filiere | nom_filiere | taux_captation | prestataire | source_donnee |
|--------------|-------------|----------------|-------------|---------------|
| `verre` | Verre | 0.9600 | Citeo | Citeo 2023 |
| `carton` | Carton | 0.9000 | Citeo | Citeo 2023 |
| `biodechet` | Biodéchets | 0.8700 | Veolia/A Toutes! | ADEME ITOM 2017 |
| `emballage` | Emballages | 0.7700 | Citeo | Citeo 2023 (moyenne centres de tri) |

**Cible V2** : valeurs spécifiques par prestataire/filière issues des bordereaux recycleur final. Ajout d'une colonne `prestataire_id` FK → `shared.prestataires` + index composite `(code_filiere, prestataire_id, actif)`.

**RLS** :
- Lecture : `admin_savr` + `ops_savr` (lecture seule)
- Écriture : `admin_savr` uniquement
- Autres rôles : pas d'accès direct. La consultation du taux appliqué se fait indirectement via `collectes.caps_appliques` (snapshot figé à la clôture collecte).

**Trigger DB associé** : `AFTER UPDATE` sur `parametres_taux_recyclage` → INSERT ligne dans `parametres_taux_recyclage_history` si l'un des champs auditables change (`taux_captation`, `prestataire`, `source_donnee`).

---

### Table : `parametres_taux_recyclage_history` *(ajout 2026-05-06 — audit trail)*

Une ligne par modification d'un taux de captation. Permet la traçabilité réglementaire et le drill-down Back-office (sous-section §06.06 §9 Paramètres > Taux de recyclage par filière).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `parametre_id` | uuid | FK → parametres_taux_recyclage, NOT NULL | Filière concernée |
| `code_filiere` | enum | NOT NULL | Snapshot du code (résiste à un éventuel rename) |
| `taux_captation_avant` | decimal(5,4) | NOT NULL | Valeur avant modification |
| `taux_captation_apres` | decimal(5,4) | NOT NULL | Valeur après modification |
| `prestataire_avant` | text | | |
| `prestataire_apres` | text | | |
| `source_donnee_avant` | text | | |
| `source_donnee_apres` | text | | |
| `commentaire_modif` | text | NOT NULL | Motif obligatoire saisi par l'Admin (ex: "MAJ Citeo rapport annuel 2025") |
| `modifie_par` | uuid | FK → users (admin_savr), NOT NULL | |
| `modifie_le` | timestamptz | NOT NULL | |
| `created_at` | timestamptz | NOT NULL | |

**RLS** :
- Lecture : `admin_savr` + `ops_savr` (lecture seule)
- Écriture : interdite à tous (insertion uniquement via trigger DB sur `parametres_taux_recyclage`)

**Note rétention** : pas de purge V1 (volumétrie minime — 4 filières × quelques modifs/an). Conservation indéfinie pour audit réglementaire.

---

### Table : `parametres_facteurs_co2` *(ajout 2026-06-04 — Sujet 3)*

Référentiel des **facteurs d'émission CO₂ par flux** (induit + évité + énergie primaire évitée). 5 lignes V1. Granularité Niveau 1 (taux globaux Savr, extensible V2 vers `prestataire_id`). **ZD-only.** La ligne `emballage` est **dérivée** (recalculée par trigger depuis `parametres_mix_emballages`) — ne pas l'éditer manuellement sauf `energie_primaire` (voir note).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `code_flux` | enum | NOT NULL, UNIQUE | `verre` \| `carton` \| `biodechet` \| `emballage` \| `dechet_residuel`. Cohérent `flux_dechets.code`. |
| `nom_flux` | text | NOT NULL | Libellé UI |
| `fe_induit_kg_t` | decimal(8,2) | NOT NULL, CHECK ≥ 0 | Émissions induites (traitement) kgCO₂e/t. `emballage` = dérivé du mix. |
| `fe_evite_kg_t` | decimal(8,2) | NOT NULL, CHECK ≥ 0 | Émissions évitées kgCO₂e/t (valeur positive ; signe − à l'affichage). `emballage` = dérivé du mix. |
| `energie_primaire_evitee_kwh_t` | decimal(10,2) | NOT NULL, défaut 0 | Énergie primaire évitée par recyclage (kWh/t). 0 pour `biodechet` (porté par évité) et `dechet_residuel` (anti-double-comptage). |
| `source_donnee` | text | | Référence (ex: "Base Carbone V23.6", "FEDEREC 2017/2023") |
| `commentaire` | text | | Notes Admin |
| `actif` | boolean | NOT NULL, défaut `true` | |
| `date_maj` | timestamptz | NOT NULL | Date effective de la dernière modification du facteur |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Seed V1 (5 lignes)** :

| code_flux | nom_flux | fe_induit_kg_t | fe_evite_kg_t | energie_primaire_evitee_kwh_t | source_donnee |
|-----------|----------|----------------|---------------|-------------------------------|---------------|
| `verre` | Verre | 639.00 | 1158.00 | 4000.00 | Base Empreinte V23.6 / FEDEREC 2017 |
| `carton` | Carton | 670.00 | 390.00 | 10098.00 | Base Empreinte V23.6 / FEDEREC 2017 |
| `biodechet` | Biodéchets (méthanisation) | 40.00 | 77.00 | 0.00 | Base Carbone (44 énergie + 33 digestat) |
| `emballage` | Emballages ménagers (mix) | 540.00 | 1188.00 | 7000.00 | Dérivé `parametres_mix_emballages` ; énergie = estimation agrégée provisoire |
| `dechet_residuel` | Déchet résiduel (OMR) | 380.00 | 180.00 | 0.00 | Base Empreinte V23.6 / MODECOM 2017 / ITOM 2014 |

**Note `emballage`** : `fe_induit_kg_t` + `fe_evite_kg_t` sont **maintenus par trigger** `fn_recompute_emballage_fe` (recalcul `Σ part×FE` à chaque modif du mix) — non éditables à la main. `energie_primaire_evitee_kwh_t` reste **éditable manuellement** (estimation agrégée provisoire ; décomposition par sous-flux en V1.1 quand les données FEDEREC énergie par matériau seront disponibles).

**RLS** : Lecture `admin_savr` + `ops_savr` ; Écriture `admin_savr` uniquement ; autres rôles via snapshot `collectes.co2_facteurs_snapshot`.

**Trigger DB** : `AFTER UPDATE` → INSERT `parametres_facteurs_co2_history` si `fe_induit_kg_t` / `fe_evite_kg_t` / `energie_primaire_evitee_kwh_t` change.

**Cible V2** : valeurs par prestataire (colonne `prestataire_id` FK → `shared.prestataires`).

---

### Table : `parametres_facteurs_co2_history` *(ajout 2026-06-04 — audit trail)*

Une ligne par modification d'un facteur. Traçabilité réglementaire (quadruplet auditeur RSE : nom facteur + source + version + date).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `parametre_id` | uuid | FK → parametres_facteurs_co2, NOT NULL | |
| `code_flux` | enum | NOT NULL | Snapshot du code |
| `fe_induit_avant` / `fe_induit_apres` | decimal(8,2) | NOT NULL | |
| `fe_evite_avant` / `fe_evite_apres` | decimal(8,2) | NOT NULL | |
| `energie_avant` / `energie_apres` | decimal(10,2) | | |
| `source_donnee_avant` / `source_donnee_apres` | text | | |
| `commentaire_modif` | text | NOT NULL | Motif obligatoire Admin |
| `modifie_par` | uuid | FK → users (admin_savr), NOT NULL | |
| `modifie_le` | timestamptz | NOT NULL | |
| `created_at` | timestamptz | NOT NULL | |

**RLS** : Lecture `admin_savr` + `ops_savr` ; Écriture interdite (trigger uniquement). Pas de purge V1.

---

### Table : `parametres_mix_emballages` *(ajout 2026-06-04 — Sujet 3)*

Composition du flux emballages par matériau, **éditable Admin**. Le FE agrégé du flux `emballage` en découle. 7 lignes V1.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `code_materiau` | enum | NOT NULL, UNIQUE | `carton_papier` \| `pet` \| `pehd` \| `acier` \| `alu` \| `briques` \| `autres` |
| `nom_materiau` | text | NOT NULL | Libellé UI |
| `part_pct` | decimal(5,2) | NOT NULL, CHECK 0 ≤ x ≤ 100 | Part du matériau dans le mix (somme des lignes actives = 100, validée par trigger) |
| `fe_induit_kg_t` | decimal(8,2) | NOT NULL, CHECK ≥ 0 | FE induit du matériau |
| `fe_evite_kg_t` | decimal(8,2) | NOT NULL, CHECK ≥ 0 | FE évité du matériau |
| `source_donnee` | text | | |
| `commentaire` | text | | |
| `actif` | boolean | NOT NULL, défaut `true` | |
| `date_maj` | timestamptz | NOT NULL | |
| `created_at` / `updated_at` | timestamptz | NOT NULL | |

**Seed V1 (mix Savr — arbitrage Val 2026-06-04)** :

| code_materiau | nom_materiau | part_pct | fe_induit_kg_t | fe_evite_kg_t | source |
|---------------|--------------|----------|----------------|---------------|--------|
| `carton_papier` | Carton-papier | 60.00 | 670.00 | 390.00 | FEDEREC 2017/2023 |
| `pet` | PET | 20.00 | 400.00 | 1400.00 | FEDEREC 2017/2023 |
| `pehd` | PEhd | 10.00 | 350.00 | 1200.00 | FEDEREC 2017/2023 |
| `acier` | Acier | 3.00 | 75.00 | 1600.00 | FEDEREC ; SNFBM/Empac |
| `alu` | Aluminium | 5.00 | 200.00 | 10000.00 | FEDEREC ; Metal Packaging Europe |
| `briques` | Briques alimentaires | 1.00 | 670.00 | 390.00 | Citeo / Alliance Carton Nature |
| `autres` | Autres / refus (→ OMR) | 1.00 | 380.00 | 180.00 | Base Carbone OMR |

→ Agrégat : induit +540 / évité −1 188 kgCO₂e/t. **L'aluminium (5 % du mix) = 42 % du bénéfice évité** : paramètre le plus sensible, à fiabiliser via bordereaux de tri prestataires.

**Validation** : trigger `BEFORE INSERT/UPDATE` rejette si `Σ part_pct (actifs) ≠ 100` (tolérance 0,05).
**Trigger recalcul** : `AFTER INSERT/UPDATE/DELETE` → `fn_recompute_emballage_fe` met à jour la ligne `emballage` de `parametres_facteurs_co2` (`fe_induit`/`fe_evite` = Σ part×FE) + INSERT `parametres_mix_emballages_history`.
**RLS** : Lecture `admin_savr` + `ops_savr` ; Écriture `admin_savr` uniquement.

---

### Table : `parametres_mix_emballages_history` *(ajout 2026-06-04 — audit trail)*

Structure identique au pattern history : `parametre_id`, `code_materiau` (snapshot), `part_pct_avant`/`_apres`, `fe_induit_avant`/`_apres`, `fe_evite_avant`/`_apres`, `source_donnee_avant`/`_apres`, `commentaire_modif` (NOT NULL), `modifie_par` (FK admin_savr), `modifie_le`, `created_at`. **RLS** : Lecture admin+ops ; Écriture trigger uniquement.

---

### Table : `parametres_co2_divers` *(ajout 2026-06-04 — clé-valeur)*

Paramètres CO₂ secondaires (forfait collecte V1 + équivalences pédagogiques). Modèle clé-valeur typé (comme `parametres_algo`), **audité via `audit_log`** (action `parametres_co2_divers_update`) — pas de table history dédiée (faible enjeu, sobriété).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `cle` | text | NOT NULL, UNIQUE | Identifiant |
| `valeur` | decimal(12,4) | NOT NULL | Valeur numérique |
| `unite` | text | NOT NULL | Unité (UI) |
| `description` | text | NOT NULL | Libellé Back-office |
| `source_donnee` | text | | |
| `valide_par` | uuid | FK → users (admin_savr) | |
| `updated_at` / `created_at` | timestamptz | NOT NULL | |

**Seed V1 (5 clés)** :

| cle | valeur | unite | description |
|-----|--------|-------|-------------|
| `km_collecte_aller_retour` | 50 | km | Distance forfaitaire collecte (V1 ; km réels TMS en V2) |
| `fe_camion_benne_kg_km` | 2.1 | kgCO₂e/km | FE benne 26 t gazole (Base Carbone V23) |
| `equiv_km_voiture_kgco2` | 0.218 | kgCO₂e/km | Équivalence 1 km voiture thermique |
| `equiv_repas_boeuf_kgco2` | 7 | kgCO₂e | Équivalence 1 repas avec bœuf |
| `equiv_foyer_elec_kwh_an` | 4500 | kWh/an | Conso élec annuelle foyer FR (ADEME) |

**RLS** : Lecture `admin_savr` + `ops_savr` ; Écriture `admin_savr` (log `audit_log` à chaque modif).

---

### Table : `parametres_facteurs_co2_ag` *(ajout 2026-06-04 bis — CO₂ AG)*

Facteur d'émission évitée par repas donné (Anti-Gaspi). 1 ligne V1. **AG-only.**

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `cle` | text | NOT NULL, UNIQUE | `facteur_co2_evite_par_repas_kg` (V1 : 1 seule ligne ; extensible si segmentation V2) |
| `facteur_co2_evite_par_repas_kg` | decimal(8,4) | NOT NULL, CHECK ≥ 0 | kgCO₂e évités par repas donné |
| `source_donnee` | text | | Référence (ex: "FAO — 2,5 kgCO₂e/repas") |
| `commentaire` | text | | Notes Admin |
| `actif` | boolean | NOT NULL, défaut `true` | |
| `date_maj` | timestamptz | NOT NULL | |
| `created_at` / `updated_at` | timestamptz | NOT NULL | |

**Seed V1 (1 ligne)** : `facteur_co2_evite_par_repas_kg = 2.5000`, `source_donnee = "FAO (2,5 kgCO₂e/repas) — standard secteur anti-gaspi"`.

**RLS** : Lecture `admin_savr` + `ops_savr` ; Écriture `admin_savr` uniquement ; autres rôles via snapshot `collectes.co2_facteurs_snapshot` (AG). **Trigger DB** : `AFTER UPDATE` → INSERT `parametres_facteurs_co2_ag_history` si `facteur_co2_evite_par_repas_kg` change.

**Cible V2** : remplacé/affiné par le référentiel multi-critères par aliment (Module 19 Impact enrichi, non créé V1) + transport AG induit (distance TMS × `co2_g_par_km` véhicule).

---

### Table : `parametres_facteurs_co2_ag_history` *(ajout 2026-06-04 bis — audit trail)*

Structure pattern history : `id`, `parametre_id` (FK → parametres_facteurs_co2_ag), `facteur_avant`/`facteur_apres` (decimal(8,4)), `source_donnee_avant`/`_apres`, `commentaire_modif` (NOT NULL), `modifie_par` (FK admin_savr), `modifie_le`, `created_at`. **RLS** : Lecture admin+ops ; Écriture trigger uniquement. Pas de purge V1.

---

### Table : `parametres_algo` *(ajout 2026-05-09 — intégration règles M12 IDF dans §06.09)*

Référentiel des paramètres pilotables de l'algorithme d'attribution AG. Modifiables par Admin Savr via Back-office → Paramètres → Algorithme AG (cf. [[06 - Fonctionnalités détaillées/09 - Flux algo attribution AG (Admin)#7. Paramètres pilotables de l'algorithme|§06.09 §7]]). Une ligne par paramètre (modèle clé-valeur typé).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `cle` | text | NOT NULL, UNIQUE | Identifiant du paramètre (ex: `regle_ag_seuil_pax_velo`) |
| `valeur` | jsonb | NOT NULL | Valeur typée (int, time, bool, decimal sérialisés JSON) |
| `type_valeur` | enum | NOT NULL | `int` \| `time` \| `bool` \| `decimal` \| `string` — cohérence applicative |
| `description` | text | NOT NULL | Libellé UI pour Back-office |
| `valide_par` | uuid | FK → users (admin_savr) | Dernier modificateur |
| `motif_derniere_modif` | text | | Motif loggé à chaque modification (≥ 10 car.) |
| `updated_at` | timestamptz | NOT NULL | |
| `created_at` | timestamptz | NOT NULL | |

**Seed V1 (8 paramètres — refonte 2026-05-09 + audit cohérence inter-CDC 2026-05-09 + audit sobriété 2026-05-09 B1 (3 colonnes audit retirées) + B2 (`poids_par_repas_kg` ajouté))** :

| cle | type_valeur | valeur | description |
|-----|-------------|--------|-------------|
| `regle_ag_seuil_pax_velo` | int | `600` | Seuil `nb_pax` au-delà duquel grand événement IDF jour → Marathon |
| `regle_ag_plage_velo_debut` | time | `"07:00"` | Début plage horaire jour A Toutes! IDF (vélo cargo + camion) |
| `regle_ag_plage_velo_fin` | time | `"20:00"` | Fin plage horaire jour A Toutes! IDF (vélo cargo + camion) |
| `regle_ag_seuil_h2_minutes` | int | `90` | Frontière express vs programmé branche AG vélo jour |
| `a_toutes_indisponible` | bool | `false` | Flag opérationnel manuel — bascule branche 3 → Marathon. **Métadonnées (raison/quand/par qui) lues depuis `audit_log` (`action = "parametres_algo_update"`, `details.cle = 'a_toutes_indisponible'`) — refonte audit sobriété 2026-05-09 B1, suppression colonnes dédiées.** |
| `poids_par_repas_kg` | numeric | `0.45` | **Ajouté audit sobriété 2026-05-09 B2** — coefficient de conversion poids→repas pour AG (`volume_repas_realise = ceil(poids_repas_kg / poids_par_repas_kg)`). Source unique cross-app : Plateforme V1 codé en dur, TMS V2 lit cross-schema (`plateforme.parametres_algo.poids_par_repas_kg`). Évite divergence Plateforme/TMS. |
| `everest_codes_postaux` | text[] | `['75', '92', '93']` | Préfixes département (2 car.) couverts par Everest. Vérification locale `lieux.code_postal[:2] IN (…)` dans branches IDF (cf. §06.09 §2.3). Liste extensible Admin Savr. |
| `province_tri_secondaire_code` | text | `nb_collectes_6_mois_asc` | **Ajouté audit cohérence B3 2026-05-09** — algorithme tri secondaire branche `ag_province_proximite` (après distance ASC). Aligné TMS M12 §4.7. |

**Note refonte 2026-05-09** : ex-paramètres `poids_distance_assoc` (60) + `poids_capacite_assoc` (40) supprimés (sobriété A1). Si V2 réintroduit un scoring multi-critères → ré-ajouter.

**Mirroring TMS V2** : tous les paramètres `regle_ag_*` + `a_toutes_indisponible` + `everest_codes_postaux` + `poids_par_repas_kg` sont source unique Plateforme V1+V2 (V2 à reétudier au cutover). Le TMS V2 lit en cache local rafraîchi par webhook (canal à figer §08 V2). Voir [[../02 - Cahier des charges TMS/04 - Data Model TMS#5. parametres_tms.attribution|§04 TMS]]. **Audit sobriété 2026-05-09 B1** : colonnes `a_toutes_indisponible_raison/_declaree_le/_declaree_par` retirées — métadonnées lues depuis `audit_log` central. **B2** : ajout `poids_par_repas_kg` source unique (remplace doublon TMS `m05_equivalent_repas_kg`).

**Source de vérité TMS V2** : **Plateforme reste source unique**, V1 comme V2. Le TMS V2 ne stocke pas ses propres copies des paramètres IDF : il les **lit** depuis la Plateforme (push webhook `parametres-algo-sync` à chaque UPDATE, ou pull TMS au démarrage + cache local invalidé). Toute modification Admin Savr se fait dans `parametres_algo` Plateforme et se propage au TMS. Cf. [[../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées/M12 - Attribution transporteur|M12 §4 TMS]].

**RLS** :
- Lecture : `admin_savr` + `ops_savr` (lecture seule)
- Écriture : `admin_savr` uniquement
- Toute modification trigger un log `audit_log` (`action = "parametres_algo_update"`, `details = { cle, ancienne_valeur, nouvelle_valeur, motif }`).

**Note historique** : pas d'audit trail dédié V1 (l'`audit_log` central suffit, volumétrie modifs estimée < 50/an). Une table `parametres_algo_history` pourra être ajoutée V2 si le besoin de drill-down apparaît.

---

### Table : `associations`

Référentiel des associations Anti-Gaspi. Géré par Admin Savr.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `nom` | text | NOT NULL | |
| `adresse` | text | NOT NULL | |
| `latitude` | float | | Pour calcul distance algo |
| `longitude` | float | | |
| `region` | enum | NOT NULL | `idf` \| `province` |
| `ville` | text | NOT NULL | |
| `capacite_max_beneficiaires` | integer | | Nombre max de bénéficiaires pouvant être servis |
| `types_aliments_acceptes` | text[] | | ex: ["chaud", "froid", "sec"] |
| `horaires_ouverture` | jsonb | | Plages horaires par jour de semaine |
| `contact_nom` | text | | |
| `contact_email` | text | NOT NULL | Pour envoi email automatique |
| `contact_telephone` | text | | |
| `habilitee_attestation_fiscale` | boolean | NOT NULL, défaut `false` | `true` si l'association est habilitée à émettre le document 2041-GE (défiscalisation 60% pour le donateur) |
| `date_expiration_habilitation` | date | NULL | **Ajout R17b 2026-07-02** — Date d'expiration de l'habilitation 2041-GE (satisfait le CDC §06 §5 « booléen + date expiration »). Édition admin-only. |
| `siren` | text | NULL, CHECK `siren ~ '^[0-9]{9}$'` | **Ajout R17b 2026-07-02** — SIREN INSEE 9 chiffres, **non obligatoire** (tranché Val). Édition admin-only (trigger `trg_ops_immutable_cols`). Aligné sur `lieux`/`transporteurs`. |
| `logo_url` | text | NULL | **Ajout R17b 2026-07-02** — URL logo association (bucket Storage `logos`), affiché dans les rapports AG. |
| `instructions_acces` | text | NULL | **Ajout R17b 2026-07-02** — Instructions d'accès au lieu pour le transporteur (texte long). |
| `actif` | boolean | NOT NULL, défaut `true` | |
| `derniere_verification` | date | | Date de dernière vérification des infos par Admin Savr |
| `commentaires_internes` | text | | Notes Admin Savr |
| `description_rapport_impact` | text | NOT NULL, ≥ 30 caractères | **Ajout 2026-05-07** — Description publique de l'association, copiée dans rapport AG. Rendue obligatoire (refonte back-office §06 §5 Associations). Migration : pour les associations existantes sans description, valeur par défaut "Description à compléter — association {{nom}}." (≥ 30 car.) puis Admin/Ops complète manuellement. |
| `id_point_collecte_mts1` | text | NULL | **Ajout 2026-05-07 — V1 only** — Identifiant point de collecte côté MTS-1, sert au pré-fill V1 lors envoi MTS-1 (Bouton "Envoyer à MTS-1" §06 §3 Bloc 0). En V2 (TMS Savr natif), ce champ devient déprécié (gardé en lecture pour audit historique). |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

> **Note 2026-05-07** : pas de champ `nom_interne_savr`. La doc back-office mentionnait un libellé conceptuel "interne Savr" distinct du "nom public", supprimé à la refonte 2026-05-07. Unique nom = `associations.nom`.

---

### Table : `transporteurs`

Référentiel des transporteurs Anti-Gaspi (IDF + province, tous prestataires confondus). **Refonte 2026-05-08** — voir [[06 - Fonctionnalités détaillées/06 - Back-office Admin Savr]] §6 + mémoire `project_refonte_back_office_admin_2026_05_08`.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `nom` | text | NOT NULL | |
| `siren` | text | NOT NULL, CHECK `siren ~ '^[0-9]{9}$'` | **Ajout 2026-05-08** (ex `numero_transporteur`) — SIREN INSEE 9 chiffres. Source unique d'identification légale. RW admin-only. |
| `adresse` | text | NOT NULL | **Ajout 2026-05-08** — Adresse postale (base calcul distance algo AG). |
| `code_postal` | text | NOT NULL | **Ajout 2026-05-08** |
| `ville` | text | NOT NULL | **Ajout 2026-05-08** |
| `latitude` | float | | **Ajout 2026-05-08** — Géocodage automatique adresse (Algolia Places ou équivalent) |
| `longitude` | float | | **Ajout 2026-05-08** |
| `types_vehicules` | text[] | NOT NULL, length ≥ 1 | **Refonte 2026-05-08** — Multi-valeurs parmi `velo_cargo / camionnette / fourgon / vul / poids_lourd`. Hiérarchie alignée sur `lieux.type_vehicule_max` (du plus petit au plus gros). Sert à la règle [[05 - Règles métier#R_compatibilite_vehicule_lieu]]. Au moins une valeur requise. |
| `types_collecte` | text[] | NOT NULL, length ≥ 1 | **Ajout R17b 2026-07-02** — Flux gérés par le transporteur, multi-valeurs parmi `anti_gaspi` / `zero_dechet`. |
| `type_tms` | enum | NOT NULL | **Ajout 2026-05-08** — Enum `mts1` / `a_toutes` / `autre` / `par_mail` / `par_telephone` (**ajout R17b 2026-07-02** — `par_mail`/`par_telephone` = transporteurs hors TMS routés `provider_manual`, validation manuelle Admin). Détermine le mode de dispatch + le bouton affiché en Bloc 0 Attribution Prestataire §06 §3 (Envoyer à MTS-1 / Envoyer à A Toutes! / Manuel email+téléphone). Fusionne les ex-champs `process_creation_collecte`, `process_creation_collecte_detail`, `type_tms` jamais physiquement créés en DB Bubble. |
| `code_transporteur_mts1` | text | NULL | **Ajout 2026-05-29 — V1 only (propagation [[08 - APIs et intégrations#3bis. API Plateforme ↔ MTS-1]])** — `carrierShareableCode` côté MTS-1, identifie ce transporteur lors du **dispatch de la tournée** `POST /v3/tours/{tourId}/dispatch` (payload `{ carrierShareableCode }` — flux réconcilié relevé as-built 2026-06-06). Récupérable via `GET /v3/carrier`. **Requis si `type_tms = 'mts1'`** (cf. [[05 - Règles métier#R_code_mts1_requis]]). Déprécié en V2 (gardé en lecture pour audit). |
| `contact_nom` | text | NOT NULL | **Rendu obligatoire 2026-05-08** |
| `contact_email` | text | NOT NULL | Pour envoi email automatique `ag_attribution_transporteur` |
| `contact_telephone` | text | NOT NULL | **Rendu obligatoire 2026-05-08** — Format E.164 recommandé. Joignable jour J. |
| `tarif_par_course` | decimal | | En euros HT (pour pilotage financier V1) |
| `actif` | boolean | NOT NULL, défaut `true` | |
| `derniere_verification` | date | | |
| `commentaires_internes` | text | | Notes opérationnelles Admin Savr (ex consignes métier libres ex-`process_creation_collecte_detail`) |
| `description_process_collecte` | text | NULL | **Ré-ajout R17b 2026-07-02** (ex `process_creation_collecte_detail`) — consignes métier de collecte propres au transporteur, champ dédié. |
| `created_at` | timestamptz | NOT NULL | |

---

## Niveau 3 — Opérationnel

### Table : `evenements`

Table centrale. Un événement = une prestation physique chez un client, à un lieu, à une date.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `organisation_id` | uuid | FK → organisations, NOT NULL | **Étendu 2026-05-07** — Organisation programmatrice : `traiteur`, `agence` ou `gestionnaire_lieux`. Voir §05 règle V1 programmateur=facturé. |
| `traiteur_operationnel_organisation_id` | uuid | FK → organisations (type=traiteur), NOT NULL | **Ajout 2026-05-07** — Traiteur qui opère physiquement la prestation sur place (producteur juridique du déchet, destinataire des notifications info-only quand programmé par tiers). Si `organisation_id.type='traiteur'`, alors `traiteur_operationnel_organisation_id = organisation_id`. Si `organisation_id.type='agence'` : choisi à la programmation, peut être une fiche shadow (`organisations.est_shadow=true`). Si `organisation_id.type='gestionnaire_lieux'` : choisi à la programmation parmi traiteurs référencés (pas de shadow autorisé côté gestionnaire — règle métier §05). |
| `entite_facturation_id` | uuid | FK → entites_facturation, NOT NULL | Entité juridique à facturer (par défaut = entité par défaut de l'organisation programmatrice). **V1 (2026-05-07)** : doit appartenir à `organisation_id` (programmateur=facturé). |
| `lieu_id` | uuid | FK → lieux, NOT NULL | |
| `created_by` | uuid | FK → users, NOT NULL | User programmateur (`traiteur_commercial`, `traiteur_manager`, `agence`, `gestionnaire_lieux`, ou `admin_savr` — naming rôles aligné §09, corrigé 2026-06-11). Étendu 2026-05-07 : ouverture aux rôles agence et gestionnaire_lieux. |
| `nom_evenement` | text | | Nom libre (ex: "Gala LVMH 2026") |
| `type_evenement_id` | uuid | FK → types_evenements, NOT NULL | Référence à la table `types_evenements` (4 catégories de **format de service** : `cocktail_aperitif`, `cocktail_repas_complet`, `repas_assis`, `autre`). Référentiel extensible par ajout direct de ligne (Admin/Supabase), sans UI. La **taille** de l'événement ne vit pas ici : elle se dérive du `pax` via `taille_evenement_bracket()`. **Sujet 4 (2026-05-26)** : le seed `autre` est un fourre-tout sélectionnable sans saisie ; le mécanisme de texte libre est retiré. |
| `date_evenement` | date | NULL *( — révisé 2026-06-07, test scenarios §06.01 F1 BLOQUANT, arbitrage Val : la ligne `evenements` est écrite dès le brouillon étape 1, avant toute `date_collecte` ; NULL = brouillon sans collecte datée, jamais NULL sur événement confirmé — garde applicative à la confirmation, cf. §05 R_date_evenement_auto_derive)* | **Champ backend auto-dérivé (refonte 2026-05-29)** — Non saisi dans les formulaires. Calculé automatiquement = `MIN(collectes.date_collecte)` des collectes rattachées à l'événement, via trigger `fn_set_date_evenement` (`AFTER INSERT/UPDATE/DELETE ON collectes`, `FOR EACH ROW`). **Date de référence des rapports PDF client** (§12). Extensible V2 : la règle de dérivation pourra être affinée (ex. date réelle de l'événement ≠ première collecte, si recueillie séparément). |
| `pax` | integer | NOT NULL | Nombre de convives — fourni systématiquement par le traiteur à la programmation. Base de la facturation ZD. |
| `contact_principal_nom` | text | NOT NULL | Contact terrain principal (responsable événement côté traiteur ou lieu) |
| `contact_principal_telephone` | text | NOT NULL | Numéro joignable le jour J |
| `contact_secours_nom` | text | | Contact de secours si le principal ne répond pas |
| `contact_secours_telephone` | text | | |
| `nom_client_organisateur` | text | | Nom du client organisateur (utilisé comme "nom de l'événement"). Champ texte libre saisi par le programmeur |
| `logo_client_organisateur_url` | text | | URL Supabase Storage (bucket `logos`). Uploadé par le traiteur_commercial ou traiteur_manager au moment de la programmation. Utilisé dans le rapport de recyclage PDF. Priorité : si `client_organisateur_organisation_id` est renseigné ET que `organisations.logo_url` existe, le logo de l'organisation prime. Sinon, ce champ est utilisé. |
| `client_organisateur_organisation_id` | uuid | FK → organisations (type=client_organisateur) | Renseigné si le client organisateur dispose d'un compte Savr pour accéder à ses événements (profil 6 Client Organisateur). Nullable — la majorité des événements n'ont pas de compte Savr côté client organisateur en V1 |
| `reference_affaire` | text | | Référence interne client (ex: numéro d'affaire Potel & Chabot). Saisie optionnelle par le `traiteur_commercial` ou `traiteur_manager` à la programmation. Reportée sur la facture (champ "Référence" Pennylane) et sur le PDF Savr. Disponible pour tous les clients — 2026-04-28 |
| `notes_internes` | text | | Notes Admin Savr uniquement |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Relations** :
- 1 événement → N collectes (via `collectes.evenement_id`)
- 1 événement → N rapports RSE (via `rapports_rse.evenement_id`)
- 1 événement → N briefs (V2, via `briefs_evenement.evenement_id`)
- 1 événement → 1 synthèse d'impact (V2, via `impact_synthese_evenement.evenement_id`)

**Champ calculé `taille_evenement`** (ajout 2026-05-02 — refonte Dashboard §05) :
Bracket dérivé de `pax`, non stocké, exposé via fonction PostgreSQL ou colonne générée :

```sql
CREATE OR REPLACE FUNCTION taille_evenement_bracket(p_pax integer) RETURNS text AS $$
  SELECT CASE
    WHEN p_pax < 250 THEN 'XS'
    WHEN p_pax < 500 THEN 'S'
    WHEN p_pax < 750 THEN 'M'
    WHEN p_pax < 1000 THEN 'L'
    ELSE 'XL'
  END
$$ LANGUAGE SQL IMMUTABLE;
```

Utilisé par : Dashboard §05 (filtre global + filtre benchmark dédié), liste Événements §05, fonction `f_benchmark_kg_pax_zd`.

**Challenge à trancher** : voir section "Questions ouvertes" ci-dessous.

---

### Table : `collectes`

Une collecte = une intervention physique d'un type donné (zéro-déchet OU anti-gaspi) rattachée à un événement.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `evenement_id` | uuid | FK → evenements, NOT NULL | |
| `type` | enum | NOT NULL | `zero_dechet` \| `anti_gaspi` |
| `prestataire_logistique_id` | uuid | FK → **`shared.prestataires`** | Strike (ZD), Marathon / A Toutes! (AG) *(FK repointée — résidu corrigé 2026-06-11, migration D14 2026-04-23)* |
| `nb_camions_demande` | smallint | NOT NULL, défaut 1 | **(ajout 2026-06-08, multi-camions V1)** Nombre de camions décidé **manuellement par Ops Savr** au dispatch. Une collecte servie par N camions = N customerOrders + N tournées **créés par l'adapter MTS-1** (même transporteur, volume global non réparti — arbitrages Val 2026-06-08). Le prestataire ne réajuste pas. **N modifiable à chaud par Ops (arbitrage Val 2026-06-10, challenge logistique — remplace « N figé »)** : si Ops modifie `nb_camions_demande` après envoi, l'adapter **réconcilie par rang** — augmentation (N→N+k) : création des seuls rangs manquants (les rangs existants ont leur `external_ref_commande`, l'idempotence par `reference-{rang}` les protège) ; réduction (N→N−k) : `DELETE /v3/customerOrders` des rangs retirés (soumis à la règle MTS-1 « bloqué < 1h avant mission » — si bloqué : alerte Ops + contact transporteur direct, cf. [[08 - APIs et intégrations]] §3bis.8). **V1-only / MTS-1** : en V2 (TMS natif), le découpage redevient une décision du TMS (option a, cf. relations `tournees` + [[05 - Règles métier#R_statut_collecte_multi_tournees]]) → colonne omise/ignorée (omission neutre garde-fou 1). **Gate de modification (ajout 2026-06-11, revue adversariale R5)** : la RPC de changement de N prend `SELECT … FOR UPDATE` sur la ligne `collectes` et exige `statut IN ('programmee','validee','en_cours')` — **interdit dès `realisee`** (jamais de régression d'un état terminal ; ajouter un camion après coup = flux incident Admin, édition pesées + recalcul). Ce lock sérialise le changement de N avec l'agrégation terminale de l'adapter (qui prend le même lock, cf. R_statut_collecte_multi_tournees). |
| `statut` | enum | NOT NULL | `brouillon` (créé non soumis) \| `programmee` (soumise au formulaire — **transmise au TMS dès la soumission**, en cours de dispatch jusqu'à acceptation prestataire ; couvre `statut_tms ∈ (non_envoye, a_attribuer, attribuee_en_attente_acceptation)`) \| `validee` (**acceptée par le prestataire logistique** ; `statut_tms ∈ (acceptee, en_attente_execution)`) \| `en_cours` \| `realisee` \| `realisee_sans_collecte` (AG sans repas) \| `cloturee` (back-office fini : taux recyclage calculé + bordereau/attestation + facturation) \| `annulation_demandee` \| `annulee` \| **`rejetee_par_prestataire`** (tous les tours multi-camions en état CANCELED/KO — agrégation terminale `fn_agreger_terminal_collecte`, ajouté M1.8 A2 2026-06-15 via migration `20260615115900`). **Audit sobriété §04 2026-05-25 (D1)** : `manquee` supprimé (no-show prestataire = `annulee` + `incident_imputable_a='prestataire'` + `motif_incident`) ; `en_reexamen` supprimé (pesée contestée = la collecte reste `cloturee`, correction par édition Admin + recalcul + avoir, cf. §05). Enum 11 → 9 → **10 valeurs** (+ `rejetee_par_prestataire` 2026-06-15). **Sujet 2 (propagation 2026-05-26)** : sémantique `programmee`/`validee` figée — l'ancien gloss "validée par Admin Savr" est supprimé (il n'y a **PAS** de validation Admin à la création : le cycle est 100 % automatisé, l'Admin n'intervient qu'en annulation/modif/incident, cf. §05). E1 `POST /collectes` part **à la soumission** (statut `programmee`, `statut_tms` `non_envoye`→`a_attribuer`), jamais au statut `validee`. La sous-transition `programmee ↔ validee` est **dérivée de `statut_tms`** par trigger DB (cf. `statut_tms` ci-dessous, arbitrage 2a). **Libellés d'affichage (UX uniquement, 2026-06-30, divergence UX-STATUTS — valeurs d'enum inchangées)** : `brouillon` est ré-étiqueté **« Créée »** partout (admin + client) ; côté **client** (traiteur/agence/gestionnaire/organisateur) le mapping d'affichage complet (jamais « Programmée » → `programmee` = « Créée » ; « Réalisée » = `cloturee` ; `realisee` affiché **« En cours »** ; `realisee_sans_collecte` = « Sans excédents » ; `rejetee_par_prestataire` masqué = « Créée ») fait foi en [[06 - Fonctionnalités détaillées/04 - Espace client traiteur#Mapping d'affichage du statut collecte côté client (canonique — décision Val 2026-06-30, divergence UX-STATUTS)]]. **Supersède la décision F2 2026-06-07.** |
| `aucun_repas_motif` | text | NULL | Motif saisi par le chauffeur sur l'app mobile TMS si `statut = realisee_sans_collecte` (cas AG "Aucun repas à collecter", voir §08 API) |
| `aucun_repas_photo_url` | text | NULL | URL Supabase Storage de la photo du lieu prise par le chauffeur comme preuve de présence si `statut = realisee_sans_collecte` |
| `statut_tms` | enum | NOT NULL, défaut `non_envoye` | **Renommé + aligné 2026-04-25 (audit cohérence inter-CDC, A1+B2)** — Enum 8 valeurs : `non_envoye` (avant succès E1) \| `a_attribuer` \| `attribuee_en_attente_acceptation` \| `acceptee` \| `en_attente_execution` \| `rejetee_par_prestataire` \| `annulee_par_traiteur` \| `rejetee_par_tms` (Admin TMS rejette définitivement un event DLQ via S11). **Miroir 1:1** de `tms.collectes_tms.statut_dispatch` (6 valeurs centrales) + `non_envoye` (état Plateforme avant E1 OK) + `rejetee_par_tms` (état exclusif Plateforme après webhook S11). Visible dashboard Admin. Ancien nom `tms_acceptance_status` (enum 5 valeurs `non_envoye`/`envoye_prestataire`/`accepte_prestataire`/`refuse_prestataire`/`reassigne`) supprimé pour aligner sémantique avec TMS et éviter bugs de traduction. **Trigger de dérivation `statut` (Sujet 2, propagation 2026-05-26, arbitrage 2a)** : `fn_sync_statut_collecte_from_tms()` (`AFTER UPDATE OF statut_tms`, `WHEN OLD.statut_tms IS DISTINCT FROM NEW.statut_tms`) synchronise **uniquement** la sous-transition métier `programmee ↔ validee` à partir de `statut_tms` (source de vérité, pilotée par les webhooks TMS) : (1) si `NEW.statut_tms ∈ ('acceptee','en_attente_execution')` ET `statut = 'programmee'` → `statut = 'validee'` ; (2) si `NEW.statut_tms ∈ ('non_envoye','a_attribuer','attribuee_en_attente_acceptation')` ET `statut = 'validee'` (cas réacceptation après modif date/heure, cf. [[05 - Règles métier]] §4 « Réacceptation prestataire ») → `statut = 'programmee'`. Le trigger **ne touche jamais** aux statuts terminaux (`en_cours` / `realisee` / `realisee_sans_collecte` / `cloturee` / `annulation_demandee` / `annulee`), pilotés respectivement par les webhooks `collecte-en-cours` / `collecte-terminee`, le batch de clôture J+1 et le flux d'annulation. Garantit l'absence de désync entre `statut` et `statut_tms`. **Périmètre ZD + AG (Sujet AG statuts, 2026-05-29)** : `statut_tms` et ce trigger s'appliquent **à l'identique aux collectes AG** — la collecte AG suit la même machine que la ZD, `validee` étant dérivée à l'acceptation transporteur (`statut_tms = acceptee`), **jamais forcée** à la validation d'attribution Admin (ancien comportement §06.09 supprimé). **Qui écrit `statut_tms`** : ZD + AG V2 → webhooks du TMS Savr ; **AG V1** (envoi via Everest direct, sans TMS Savr) → c'est la **Plateforme** qui fait progresser `statut_tms` lors de la cascade d'envoi de l'ordre : `attribuee_en_attente_acceptation` à l'envoi → `acceptee` **uniquement sur signal positif explicite du transporteur** (confirmation Everest synchrone, ou signal MTS-1 §3bis ; plus d'acceptation implicite par délai — décision Val 2026-05-29), ou `rejetee_par_prestataire` au rejet (cf. [[06 - Fonctionnalités détaillées/09 - Flux algo attribution AG (Admin)]] §3 + arbitrage 2a). L'AG **saute `a_attribuer`** (transporteur déjà désigné par l'Admin), elle entre directement en `attribuee_en_attente_acceptation`. |
| `statut_tms_at` | timestamptz | | **Renommé 2026-04-25 (audit cohérence inter-CDC, A1+B2)** — Horodatage de la dernière transition de `statut_tms`. Ancien nom `tms_acceptance_at`. |
| `collecte_remplacee_id` | uuid | FK → collectes | Si cette collecte remplace une collecte `annulee` (traçabilité ; couvre le cas ex-`manquee` = no-show prestataire annulé) |
| `motif_incident` | text | | Renseigné si statut = `annulee` (y compris no-show prestataire, ex-`manquee`) ou `realisee_sans_collecte`. Édité aussi lors d'une contestation de pesée (collecte restant `cloturee`, ex-`en_reexamen`). |
| `incident_imputable_a` | enum | | `prestataire` \| `client` \| `association` \| `savr` \| `externe` (météo, grève). Renseigné avec `motif_incident` sur les annulations imputables (ex-`manquee` = `prestataire`). |
| `date_collecte` | date | NOT NULL | Date d'intervention du prestataire. **Champ primaire (refonte 2026-05-29)** — saisie obligatoire au formulaire §06.01 étape 3, par collecte, sans défaut pré-rempli depuis `date_evenement` (la relation est inversée : c'est `evenements.date_evenement` qui est dérivé de cette colonne). Chaque collecte porte sa propre date : multi-jours = N collectes sur N dates distinctes. **Refonte 2026-05-21 (D2)** : désormais saisie explicitement au formulaire (anciennement défaut implicite = date événement). Transmise au TMS via webhook E1 `heure_collecte.date` (= `date_collecte`, cf. [[../02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS#E1 — `POST /collectes`]]). |
| `heure_collecte` | time | NOT NULL | **Propagation 2026-04-29** — heure d'arrivée souhaitée du prestataire (point fixe V1, pas de fenêtre). Saisie commercial à la programmation. Anciennement `heure_debut_prevue` (renommé pour lever toute ambiguïté point/fenêtre). V2 : dérivation d'une fenêtre opérationnelle TMS via tampon paramétrable (cf. `m04_tournee_tampon_minutes`). |
| `heure_debut_reelle` | timestamptz | | Renseignée par l'adapter MTS-1 (V1) / le TMS Savr (V2) — heure réelle d'arrivée chauffeur. **Type corrigé `time` → `timestamptz` (2026-06-11, audit data model — collectes de nuit, passage de minuit ; aligné `tms.collectes_tms.date_debut_reelle` timestamptz)** |
| `heure_fin_reelle` | timestamptz | | Renseignée par l'adapter MTS-1 (V1) / le TMS Savr (V2) — heure réelle de départ chauffeur. **Type corrigé (2026-06-11, idem)** |
| `volume_estime_repas` | integer | | Pour anti-gaspi : nb de repas estimés (aide à dimensionner l'assoc). **Calculé auto backend V1** = `round(0.10 × evenements.pax)` via trigger DB `set_volume_estime_repas` (refonte 2026-05-07 : retiré du formulaire §06.01, invisible côté traiteur, voir [[05 - Règles métier#R_volume_estime_ag_calcule]]). Recalculé à l'UPDATE de `evenements.pax` tant que la collecte AG associée n'est pas en statut `realisee` (`collectes.statut`, pas de statut événement — cf. D2 2026-05-25). Affiché Admin/Ops + emails associations/transporteurs uniquement. |
| `controle_acces_requis` | boolean | NOT NULL, défaut depuis `lieux.controle_acces_requis_default` | **M03 TMS 2026-04-24 (D8) — restauré 2026-05-01 — renommé 2026-05-03 (refonte formulaire §06.01 : flag unique plaque + nom chauffeur)** : le traiteur demande à ce que plaque ET nom chauffeur soient communiqués AVANT exécution → manager prestataire **doit** pré-saisir les deux en M03 E4 → blocage validation tournée si l'un manque (R_M04.CONTROLE_ACCES TMS, ex R_M04.PLAQUE), sauf cas vélo cargo A Toutes! (exception dans le trigger). Visible V1 sur dashboard traiteur "Contrôle d'accès" dès saisie manager (webhook S7 → `tournees.plaque_immatriculation` + `tournees.chauffeur_nom`). Email client V2. Copié depuis `lieux.controle_acces_requis_default` à l'INSERT, override explicite possible au formulaire programmation. Propagé au TMS via E1. **Cascade upgrade-only** (R_controle_acces_cascade §05) : si traiteur coche la case alors que `lieux.controle_acces_requis_default=false`, update le lieu à `true` (impacte futurs traiteurs). Si traiteur décoche alors que défaut lieu `true`, **PAS d'update lieu** (la collecte porte `false`, le lieu reste `true` pour les futurs). Le downgrade reste un acte Admin uniquement. Cas vélo cargo (lieu A Toutes! AG) : message UX formulaire "Vélo cargo — pas de plaque possible" si traiteur coche, soumission autorisée, exception trigger TMS valide validation tournée. Ancien nom `plaque_requise` (sémantique étendue à plaque + nom chauffeur). **Refonte 2026-05-21 (formulaire unique)** : le flag est désormais **saisi une seule fois au niveau événement** au formulaire §06.01 étape 2.c (la contrainte vient du site, indépendamment du type ZD/AG) puis **copié sur chaque collecte** générée à l'INSERT. La colonne reste portée par `collectes` (override per-collecte toujours possible). Cascade lieu upgrade-only inchangée. |
| `notes_internes` | text | | Commentaires libres Admin Savr |
| `informations_supplementaires` | text | NULL, max 1000 car. | **Ajout 2026-05-06 (refonte formulaire programmation §06.01 §2.a)** — Informations logistiques saisies par le programmeur en étape 2.a (ex: "Sonner interphone B au RDC", "Quai N°2 fermé le lundi"). Texte libre. Niveau collecte (chaque collecte ZD/AG sur un même événement peut porter ses propres infos). Visible : prestataire (manager + chauffeur) via webhook E1, Admin Savr, Espace traiteur (consultation + modification post-programmation via E2 `PATCH /collectes/:id`). Pas visible Espace gestionnaire de lieu. Remplace `evenements.notes_client` retiré V1. |
| `tms_reference` | text | | Identifiant de la collecte côté TMS Savr (pour rapprochement) |
| `informations_completes` | boolean | NOT NULL, défaut `true` | `false` si certains champs non bloquants sont manquants à la programmation (contacts, instructions, logo). Permet badge "Info incomplète" côté Admin |
| `annulee_cote_savr` | boolean | NOT NULL, défaut `false` | `true` si l'Admin Savr a annulé le crédit de cette collecte pour un problème interne (pas de facturation, recrédit pack AG applicable) |
| `dirty_tms` | boolean | NOT NULL, défaut `false` | **Ajout 2026-05-07 — « émission S7 » renommée « émission dispatch » 2026-06-07 (F5 session test-scenarios §06.06 : S7 = webhook TMS→App `plaque-saisie`, le sens sortant App→TMS est le dispatch E1 / réémission §08 §10.1)** — `true` si la collecte a subi une modification métier (date, heure, lieu, pax, flux, contrôle d'accès, contacts, info supplémentaire) **après** dernière émission dispatch et **avant** renvoi explicite. Reset à `false` à la prochaine émission dispatch. Sert au KPI dashboard Admin "Collectes modifiées sans renvoi TMS" (§06 §1 Bloc 1). Géré par trigger DB `set_collectes_dirty_tms` sur UPDATE des champs propagés au TMS. |
| `motif_override_prestataire` | text | NULL | **Ajout 2026-05-07** — Motif renseigné par Admin si le prestataire choisi pour une AG ≠ top 1 algo recommandé. Audit_log automatique. Champ obligatoire UI quand override (validation côté front + endpoint S7 dispatch manuel §06 §3 Bloc 0). Voir [[06 - Fonctionnalités détaillées/06 - Back-office Admin Savr]] §3 Bloc 0 Attribution Prestataire. |
| `annulee_cote_savr_motif` | text | | Obligatoire si `annulee_cote_savr = true` — raison de l'annulation côté Savr |
| `historique_partiel` | boolean | NOT NULL, défaut `false` | **Ajout 2026-06-07 (F3 session test-scenarios §06.03)** — `true` si collecte historique Bubble migrée avec données incomplètes (exutoire, pesée ou association manquante, cf. §13 Migration). Posé exclusivement par le script de migration. Le statut reste `cloturee` (pas de 10e valeur d'enum). Badge « Historique partiel » au registre réglementaire + mention sur la ligne. Jamais `true` pour une collecte née sur la nouvelle app. |
| `taux_recyclage` | decimal(5,2) | NULL | **Ajout 2026-05-06** — Pourcentage calculé à la clôture collecte (ex: 78.42). NULL tant que `statut ≠ cloturee` ou si total pesées 5 flux = 0. **ZD uniquement** (NULL pour AG). Calculé via trigger DB à partir de `collecte_flux.poids_reel_kg` × `parametres_taux_recyclage.taux_captation` actifs (formule à captation, cf. addendum 2026-05-06 §2). |
| `caps_appliques` | jsonb | NULL | **Ajout 2026-05-06** — Snapshot des taux de captation appliqués au moment du calcul. Format `{"verre": 0.96, "carton": 0.90, "biodechet": 0.87, "emballage": 0.77, "version_parametres_at": "<timestamp>"}`. Garantit que toute modification ultérieure des taux n'affecte ni le taux figé sur la collecte ni le PDF Rapport RSE déjà généré. ZD uniquement, NULL pour AG. |
| `co2_induit_kg` | decimal(10,2) | NULL | **Ajout 2026-06-04 (Sujet 3)** — Émissions CO₂ induites (collecte + traitement) figées à la clôture. NULL si `statut ≠ cloturee`, total pesées = 0, ou AG. Cf. addendum 2026-06-04. |
| `co2_evite_kg` | decimal(10,2) | NULL | **Ajout 2026-06-04 (Sujet 3)** — Émissions CO₂ évitées, valeur positive (signe − à l'affichage), ligne séparée règle ABC. **ZD** = substitution + valorisation (Σ flux) ; **AG** = `volume_repas_realise × facteur FAO` (addendum bis 2026-06-04). Discriminé par `type`. |
| `co2_net_kg` | decimal(10,2) | NULL | **Ajout 2026-06-04 (Sujet 3)** — `co2_induit_kg − co2_evite_kg`. Présenté en ligne séparée (jamais comme compensation). ZD uniquement. |
| `energie_primaire_evitee_kwh` | decimal(12,2) | NULL | **Ajout 2026-06-04 (Sujet 3)** — Énergie primaire évitée par recyclage (kWh). ZD uniquement. |
| `co2_facteurs_snapshot` | jsonb | NULL | **Ajout 2026-06-04 (Sujet 3)** — Snapshot complet figé à la clôture, garantit la reproductibilité du document. **ZD** : `{ "type":"zero_dechet", "facteurs": {<flux>: {induit, evite, energie}}, "mix_emballages": {...}, "equivalences": {...}, "forfait_collecte": {km, fe_camion}, "version_parametres_at": "<ts>" }`. **AG** (addendum bis 2026-06-04) : `{ "type":"anti_gaspi", "facteur_co2_evite_par_repas_kg": 2.5, "volume_repas_realise": <n>, "equivalences": {km_voiture}, "version_parametres_at": "<ts>" }`. |
| `pack_antgaspi_id` | uuid | FK → packs_antgaspi, NULL | **Ajout 2026-05-25 (audit sobriété §04 — C1, définition rétablie)** — Pack AG sur lequel le crédit de cette collecte est décompté (pack du programmateur `evenements.organisation_id`). NULL pour ZD et pour AG hors pack (négo directe). Mis à `NULL` au recrédit d'annulation (cf. [[05 - Règles métier#Annulation d'une collecte AG recrédit automatique]]). Était référencé §05/§06 sans définition dans la table. |
| `lieu_overrides` | jsonb | NULL | **Ajout 2026-05-25 (audit sobriété §04 — C1, option b actée §05 L1027 + addendum 2026-05-03 §3)** — Valeurs de lieu corrigées par le programmeur au formulaire (override per-collecte, clé/valeur). Lu par le TMS via E1 pour figer `tms.collectes_tms.lieu_snapshot`. NULL si aucune modification. Tranche la question ouverte de l'addendum 2026-05-03 §3 (option b retenue). |
| `realisee_at` | timestamptz | NULL | **Ajout 2026-05-25 (audit sobriété §04 — C1, remplace la réf fantôme `fin_at`)** — Horodatage du passage à `statut = realisee` (**V1** : posé par l'adapter MTS-1 à l'agrégation terminale au polling, cf. §08 §3bis.5 ; **V2** : source webhook S5 — réconcilié 2026-06-10). Base de l'embargo rapport : `rapports_rse.disponible_a = realisee_at + 24h`. `heure_fin_reelle` (type `time`) était insuffisant pour un calcul H+24. |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Relations** :
- 1 collecte (zero_dechet) → N pesées de flux (via `collecte_flux`)
- 1 collecte (anti_gaspi) → 1 attribution algo (via `attributions_antgaspi`)
- 1 collecte → 1 facture (ou N si groupée)

---

### Table : `collecte_flux` *(zéro-déchet uniquement)*

Détail des flux **réellement** collectés pour une collecte zéro-déchet (poids réel + volume équivalent roll). Les lignes sont créées dynamiquement à la clôture terrain, 1 ligne par flux pesé — **V1** : par l'**adapter MTS-1** au polling (`GET /v3/tours/{id}` → `stops[].weight`, règle de répartition par flux cf. §08 §3bis.7 — réconcilié 2026-06-10) ; **V2** : à réception du webhook S5 `collecte-terminee` TMS. Plus de pré-création à la programmation (revue sobriété 2026-04-29 — suppression `flux_prevus` côté TMS, suppression "Flux attendus" formulaire programmation côté Plateforme).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `collecte_id` | uuid | FK → collectes, NOT NULL | |
| `flux_id` | uuid | FK → flux_dechets, NOT NULL | |
| `poids_reel_kg` | decimal | | Source de vérité terrain. **V1** : remonté par l'adapter MTS-1 (`stops[].weight`, kg confirmé) ; **V2** : saisi par le chauffeur dans l'app TMS Savr (webhook S5) |
| `equivalent_roll` | decimal | | Volume déclaré en équivalent roll. Valeurs autorisées : 0,1 \| 0,25 \| 0,5 \| 0,75 \| 1 \| 1,25 \| 1,5 \| 1,75 \| 2 \| 2,5 \| 3 \| ... (pas de 0,25 jusqu'à 2, puis pas de 0,5) |
| `nb_bacs` | integer | | Nombre de bacs 1100L collectés (redondant avec equivalent_roll mais utile pour traçabilité logistique) |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Contrainte UNIQUE `(collecte_id, flux_id)` + règle d'idempotence (ajout 2026-06-11, audit data model)** : 1 ligne par flux et par collecte, garantie DB. Sans cette contrainte, un re-poll de l'adapter MTS-1 après crash partiel pouvait dupliquer des lignes → poids doublés → taux de recyclage, CO₂, bordereau et facture faux. **Règle d'écriture adapter (V1 — précisée 2026-06-11, revue adversariale INC-0)** : l'adapter ne fait jamais d'incrément — à chaque agrégation terminale il **recalcule l'agrégat complet par flux depuis `pesees_tournees`** (somme des poids des rangs 1..N, table ci-dessous — plus de re-fetch MTS-1 au moment de l'agrégation) et écrit par **UPSERT `ON CONFLICT (collecte_id, flux_id) DO UPDATE`**. Écrasement autorisé tant que la collecte n'est pas `cloturee` (cohérent §08 §3bis.7). V2 : même contrat pour le webhook S5 (payload déjà agrégé par flux).

---

### Table : `pesees_tournees` *(nouvelle V1 — ajout 2026-06-11, revue adversariale concurrence INC-0)*

Store **brut par tour** des pesées remontées au polling MTS-1. Comble l'incohérence détectée en revue : §08 §3bis.7 spécifiait un upsert par clé `(tournee_id, stopId, flux)` sans qu'aucune table ne porte ces colonnes (`collecte_flux` = agrégat par collecte). C'est la **source de l'agrégation terminale** (`collecte_flux` est dérivée par recalcul complet) — sans elle, l'adapter devrait re-fetcher MTS-1 au moment d'agréger (fenêtre de course supplémentaire, dépendance réseau dans une transaction).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `tournee_id` | uuid | FK → tournees ON DELETE CASCADE, NOT NULL | CASCADE : la réduction de N (DELETE rang) emporte ses pesées brutes (R12) |
| `stop_id` | text | NOT NULL | `stopId` MTS-1 (neutre : identifiant d'arrêt du système logistique) |
| `flux_id` | uuid | FK → flux_dechets, NOT NULL | Résolu par match `stuffs[].name` (mapping §08 §3bis.7) |
| `poids_kg` | decimal | NOT NULL | `stops[].weight` (kg confirmé as-built) |
| `created_at`, `updated_at` | timestamptz | NOT NULL | |

**Contraintes** : `UNIQUE (tournee_id, stop_id, flux_id)` — clé naturelle de l'upsert poll (§08 §3bis.7). Re-lecture même poids = no-op ; poids modifié côté MTS-1 = UPDATE écrasant tant que la collecte n'est pas `cloturee` ; après clôture = aucune écriture + **alerte Ops divergence** (§08 §3bis.7, R7).
**Forward-compatible (garde-fou 1)** : ajout neutre, à intégrer au DDL cible V2 — en V2 le TMS natif agrège lui-même (`tms.pesees`) et pousse le S5 agrégé, la table devient dormante (même statut que `nb_camions_demande` : V1-only assumé, liste fermée Frontière G1).
**RLS** : écriture `SERVICE_ROLE` uniquement (adapter) ; `admin_savr` SELECT (debug). Aucun rôle client.

**Note sur l'équivalent roll** : le "roll" est le conteneur de collecte standard. Le chauffeur déclare visuellement le taux de remplissage (ex: 0,75 = conteneur rempli aux trois-quarts). Permet une saisie rapide terrain sans pesée systématique. Converti en kg approximatif via un coefficient par flux (à définir dans la section [[05 - Règles métier]] si besoin d'approximation pour les rapports).

**RLS (audit RLS V1 2026-06-05, révisée F1 test-scenarios §09 lot ⑪ 2026-06-07)** : visibilité dérivée de la collecte parente (`f_collecte_visible(collecte_id)`), INSERT système (`SERVICE_ROLE`, 5 flux auto-créés + clôture — adapter MTS-1 V1 / webhook S5 V2) ; **UPDATE `admin_savr` + `ops_savr`** (policy `cf_update_staff` — édition manuelle des pesées §06.06 fiche collecte Bloc 2, motif obligatoire + `audit_log`). Cf. [[09 - Authentification et permissions#A6/A7 — `collecte_flux` + `attributions_antgaspi`]].

---

### Table : `attributions_antgaspi`

Résultat de l'algorithme d'attribution pour une collecte anti-gaspi.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `collecte_id` | uuid | FK → collectes, NOT NULL, UNIQUE | 1 attribution par collecte |
| `association_id` | uuid | FK → associations, NOT NULL | Association sélectionnée |
| `transporteur_id` | uuid | FK → transporteurs, NOT NULL pour AG | Transporteur sélectionné (Marathon, A Toutes!, ou transporteur province). **Refonte 2026-05-09** : A Toutes! est désormais modélisé dans `transporteurs` (n'apparaît jamais dans `associations`). Plus de cas `transporteur_id = null`. |
| `branche_attribution` | text | NOT NULL | **Ajouté 2026-05-09 (intégration règles M12 IDF dans §06.09 §2.3)**. Valeurs canoniques : `ag_marathon_nuit`, `ag_marathon_volume`, `ag_marathon_volume_backup_camion`, `ag_velo_express`, `ag_velo_programme`, `ag_velo_fallback_marathon`, `aucun_prestataire`, `ag_province_proximite` (= hors IDF, tri distance §05 R2 — **résidu `province` corrigé audit cohérence 2026-06-07**, canonique A3 2026-05-09 aligné §05 L83 + §06.09 + §08 + TMS M12). Note : l'enum TMS M12 compte une 9e valeur `zd_idf_strike` (branche ZD, TMS V2 only — jamais produite par l'algo AG Plateforme §06.09). **Ajout 2026-06-07 (Phase 10 migration-data, tranché Val)** : valeur `migration_bubble` — posée exclusivement par le script de migration sur les attributions AG historiques Bubble (asso/transporteur connus, branche d'algo inexistante à l'époque). Jamais produite par l'algo §06.09. Cf. [[../../04 - Migration/02 - Mappings/08 - evenements + collectes + flux + attributions]]. |
| `confirmation_transporteur` | jsonb | NULL avant retour prestataire | **Ajouté 2026-05-09**. Réponse Everest/MTS-1 (V1 appel direct Plateforme) ou TMS Savr (V2 webhook S2) : `{ statut, reference_externe, recu_at, brut }`. Source de vérité statut transport. |
| `mode_validation` | enum | NOT NULL | **Refonte 2026-05-09 sobriété D2** : remplace ex-bool `recommandation_auto`. Valeurs : `manuel_top1` (Admin valide reco top 1) / `manuel_override` (Admin choisit autre + motif) / `auto_accept` (zéro humain). |
| `valide_par` | uuid | FK → users | Admin Savr qui a validé (NULL si `mode_validation = 'auto_accept'`) |
| `valide_at` | timestamptz | | |
| `volume_repas_realise` | integer | | Nb de repas effectivement collectés — calculé automatiquement : `ceil(poids_repas_kg / parametres_algo.poids_par_repas_kg)` (audit sobriété 2026-05-09 B2 — coefficient désormais paramétré, défaut 0.45). |
| `poids_repas_kg` | decimal | | Poids brut saisi par le chauffeur sur le TMS (source de vérité, poussé par webhook) |
| `motif_override` | text | NULL si `mode_validation ≠ 'manuel_override'` | **Refonte 2026-05-09 sobriété B4 + audit sobriété 2026-05-09 A2** : code preset 5 valeurs (`assoc_top1_surchargee`, `client_demande`, `transporteur_top1_indispo`, `a_toutes_indispo_locale`, `proximite_acceptable`, `autre`) ou texte libre si `autre`. Motif `recalcul_pax` retiré (cas particulier `nb_pax` post-attribution supprimé). |
| `motif_override_libre` | text | NULL si motif preset | **Ajouté 2026-05-09** : texte saisi quand `motif_override = 'autre'` (min 10 car.) |
| `created_at` | timestamptz | NOT NULL | |

**RLS (audit RLS V1 2026-06-05)** : visibilité dérivée de la collecte parente (`f_collecte_visible(collecte_id)`) ; écriture `admin_savr` (override AG) + `SERVICE_ROLE` (algo/pesées), aucune écriture cliente. Cf. [[09 - Authentification et permissions#A6/A7 — `collecte_flux` + `attributions_antgaspi`]].

---

### Table : `collecte_partages` → Reportée V1.1 *(audit sobriété §04 2026-05-25, A4)*

> ⚠ **Reportée V1.1 (audit sobriété §04 2026-05-25, A4)** : le partage de collecte entre commerciaux d'une même organisation est retiré du périmètre V1. Motif : le manager voit déjà 100 % des collectes de son organisation ; le seul cas couvert (commercial↔commercial) est marginal et ne justifie pas une table de jointure + une clause RLS `OR` sur **chaque** lecture de collecte. Réintroduction V1.1 si le besoin métier se confirme.

**RLS collectes V1 (sans partage) — révision 2026-05-29, naming + prédicat corrigés 2026-06-11 (audit data model)** : la **lecture** est org-wide pour `traiteur_manager` **et** `traiteur_commercial` — un user voit une collecte si l'organisation programmatrice de son événement est la sienne (`collectes.evenement_id → evenements.organisation_id = user.organisation_id` ; ⚠ `collectes` ne porte **pas** de colonne `organisation_id`, le scope passe toujours par la jointure `evenements`), ou si son traiteur y est opérationnel (`evenements.traiteur_operationnel_organisation_id`). L'**écriture** (INSERT/UPDATE/DELETE) reste limitée : `collectes.created_by = auth.uid()` (commercial : ses propres collectes) **OU** `traiteur_manager` / `admin_savr` de l'organisation. Le `OR collecte_partages` est retiré de la policy (réactivation V1.1 sur l'écriture). Détail §09.

*(spec conservée pour réactivation V1.1)*

---

### Vue : `v_courses_logistiques` *(ex-table `courses_logistiques` migrée en vue cross-schema — revue sobriété §08 Bloc A 2026-05-01 A2)*

> 🔒 **STATUT V1 — NON CRÉÉE (décision Val 2026-06-10, challenge Frontière TMS-Ready)** : cette vue SELECT depuis `tms.tournees ⋈ tms.collecte_tournees` — le schéma `tms.*` n'est **pas créé en V1** et MTS-1 n'expose pas les coûts par API (extract CSV = V2, cf. §08 §3bis.10). **La vue, le trigger marge `fn_recalc_marge_tournee` et l'écriture de `factures.marge_logistique` sont donc V2** (la colonne `marge_logistique` existe dès V1 mais reste NULL — omission neutre garde-fou 1). Le pilotage coûts/marge V1 reste hors plateforme (DAF / savr-data-query). Conséquence dashboards : Bloc 3 Coûts Admin **descopé V1.1** (cf. §11). Le KPI traiteur « Marge générée € » (§06.04) n'est PAS concerné (formule 100 % Plateforme : `tarif_refacture_pax_zd × pax − Σ factures HT ZD`) — il reste V1. Toute la spec ci-dessous = **cible V2, inchangée**.

> ⚠ **Migration 2026-05-01 (revue sobriété §08 Bloc A, A2)** : ex-table physique `plateforme.courses_logistiques` alimentée par webhook S6 → **vue `plateforme.v_courses_logistiques`** SELECT directe depuis `tms.tournees` JOIN `tms.collecte_tournees` *(jointure via la liaison N↔N — corrigé audit 2026-05-26)*. Plus de table miroir côté Plateforme, plus de webhook S6, plus d'UPSERT idempotent ni d'anti-replay applicatif.
>
> **Trigger marge** : sur UPDATE de `tms.tournees.cout_final_ht` ou `tms.tournees.push_s6_version` *(noms corrigés audit 2026-05-26 A2 — ex `cout_total_centimes`/`version_paiement` inexistants sur la table)*, fonction Postgres `plateforme.fn_recalc_marge_tournee(tournee_id uuid)` est invoquée par trigger DB cross-schema → recalcule `plateforme.factures.marge_logistique` pour **toutes les collectes rattachées à cette tournée via `collecte_tournees`** *(refonte multi-camions 2026-05-25 : la jointure passe par la table de liaison, plus par `collectes.tournee_id` retiré ; une collecte multi-camions est recalculée dès qu'une seule de ses N tournées change de coût)*. Pas de réseau, pas de retry, pas de DLQ.
>
> **Sécurité grille tarifaire** : la vue ne SELECT pas `tms.formules_tarifaires.*`, `tms.grilles_tarifaires.*`, `tms.cellules_grille.*` (RLS deny). Seul `snapshot_cout_detail` est exposé — et il est **construit par la vue** comme un sous-ensemble whitelisté de `tms.tournees.cout_detail` (audit 2026-05-26 A3) : la colonne brute `cout_detail` contient `grille_snapshot` et n'est **jamais** exposée telle quelle.

Coût logistique réel par tournée. Base du pilotage marge (V2 — cf. statut V1 ci-dessus).

> **Nettoyage 2026-05-25 (audit sobriété §04, C3) + contrat figé 2026-05-26** : `v_courses_logistiques` est une **vue en lecture seule** (SELECT direct depuis `tms.tournees` JOIN `tms.collecte_tournees`). Le tableau de colonnes ci-dessous décrit les **colonnes exposées** par la vue (et non des colonnes de table) : aucune contrainte `PK`/`UNIQUE`/`GENERATED`, aucun index, aucune table côté Plateforme. À ne pas matérialiser.

**Décision 2026-04-22 + refonte multi-camions 2026-05-25 + contrat de colonnes figé audit 2026-05-26** : la répartition se compose en deux temps. (1) **Mutualisation** : une tournée TMS couvre 1 à N collectes ; son coût est réparti **au prorata du nombre de collectes** par le trigger TMS `trg_m07_calc_cost`, qui écrit la quote-part directement sur la ligne de liaison `tms.collecte_tournees.cout_reparti_centimes`. (2) **Multi-camions** : une collecte peut être servie par N tournées (relation N↔N via `collecte_tournees`) ; sa marge **somme les quotes-parts** de chacune de ses tournées. Le calcul du prorata est donc fait **côté TMS** (la Plateforme ne divise plus rien) ; la vue expose une **part déjà répartie par couple collecte×tournée**.

> **Contrat de colonnes (audit cohérence inter-CDC 2026-05-26 A1/A2)** — source de vérité = `CREATE VIEW` [[../02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS#S3 — `POST /webhooks/tms/tournee-upsert`\|§08 TMS]]. Convention **€ HT decimal** alignée sur les colonnes réelles de `tms.tournees`. **Grain = 1 ligne par couple (collecte × tournée)** : `tournee_id` n'est PAS unique, et la vue porte un `collecte_id`. Les ex-colonnes `tms_tournee_id` (UNIQUE), `cout_ht`, `nb_collectes_tournee`, `cout_par_collecte_ht` (GENERATED), `cout_total_centimes`, `repartition_methode`, `devise`/`source`/`pushed_at` sont **supprimées** (jamais présentes dans le SQL réel ou inexistantes sur `tms.tournees`).

| Colonne exposée | Type | Description |
|-----------------|------|-------------|
| `tournee_id` | uuid | ID tournée TMS (`tms.tournees.id`). **NON unique** — 1 ligne par couple collecte×tournée |
| `collecte_id` | uuid | ID collecte TMS (`tms.collecte_tournees.collecte_tms_id`). Clé de regroupement de la marge par collecte |
| `prestataire_id` | uuid | Prestataire logistique (`tms.tournees.prestataire_id`) |
| `cout_final_ht` | numeric(10,2) | Coût total de la tournée € HT = `cout_ajuste_ht` si `statut_financier='ajuste'`, sinon `cout_calcule_ht` |
| `cout_reparti_ht` | numeric(10,2) | Quote-part du coût de la tournée allouée à CETTE collecte (€ HT). Stockée en centimes côté liaison TMS (`cout_reparti_centimes`), exposée en €. NULL tant que la tournée n'est pas clôturée |
| `cout_ajuste` | boolean | Dérivé `statut_financier='ajuste'`. Flag reporting marge "ajustée" |
| `version_paiement` | integer | = `tms.tournees.push_s6_version`. Lecture reporting uniquement (plus d'upsert/anti-replay côté Plateforme depuis la migration en vue 2026-05-01) |
| `duree_reelle_minutes` | integer | Durée réelle tournée |
| `snapshot_cout_detail` | jsonb | Whitelist NON sensible **construite par la vue** : `{formule_code, palier_applique, nb_vacations, nb_personnes_facturation, duree_reelle_minutes, raison}`. **Exclut `grille_snapshot`** (audit 2026-05-26 A3 — `tms.tournees.cout_detail` brut contient la grille, jamais exposé) |

**Calcul marge par collecte** *(figé audit 2026-05-26)* : `factures.montant_ht - (SELECT COALESCE(SUM(cout_reparti_ht), 0) FROM v_courses_logistiques WHERE collecte_id = :collecte_id)`. La vue ayant déjà fait la jointure `tms.tournees ⋈ tms.collecte_tournees` et la répartition côté TMS, la marge est une simple somme des `cout_reparti_ht` des lignes de la collecte. Cas standard (1 tournée) = un seul terme. Cas multi-camions (N tournées dédiées) = somme des N parts. Cas mutualisé (tournée partagée) = la part déjà proratisée par le trigger TMS.

**Source de vérité** : `tms.tournees` côté TMS, exposée en lecture via vue `plateforme.v_courses_logistiques` *(remplace ex-webhook `course-cout-calculee` S6 supprimé revue sobriété §08 Bloc A 2026-05-01 A2)*. La Plateforme ne recalcule pas le coût — elle le lit. **Sans objet 2026-05-01** : la vue lit directement le dernier état TMS, le versioning reste interne TMS pour audit (colonne `version_paiement` exposée en lecture pour reporting "marge ajustée").

---

### Table : `lieux_stocks_rolls` → Vue : `v_stocks_rolls` *(migrée 2026-05-01 — revue sobriété §08 Bloc A, A3)*

> ⚠ **Migration 2026-05-01 (revue sobriété §08 Bloc A, A3)** : ex-table physique `plateforme.lieux_stocks_rolls` (créée propagation M09 V1 2026-04-25, **jamais déployée en prod**) supprimée → **vue `plateforme.v_stocks_rolls`** SELECT directe depuis `tms.stocks_rolls_traiteurs` + `tms.types_contenants`.
>
> **Pas de joint `organisations_lieux`** *(décision Val 2026-05-01)* — les rolls sont attribués aux **traiteurs uniquement**, pas aux gestionnaires de lieux. Suppression du dashboard "stocks rolls" côté gestionnaire de lieux Plateforme. Dashboard Admin Savr Plateforme + dashboard traiteur Plateforme conservés.
>
> **Conséquences** :
> - Suppression de R_M09.7 "TMS push obligatoire" (TMS = source de vérité unique en lecture directe DB).
> - Suppression alerte M11 `m09_webhook_s8_dlq` (sans objet, pas de webhook).
> - Suppression cardinalité 1:1 par type contenant (lecture directe = N rangs scannés en une requête).
> - Suppression idempotence par clé naturelle.

Stock courant des contenants Savr (rolls) déployés chez chaque traiteur, par lieu et par type. **Source de vérité unique** : `tms.stocks_rolls_traiteurs` côté TMS, exposée en lecture via vue cross-schema. La Plateforme **n'écrit pas** ce stock.

**Justification cross-CDC** : `lieux.stock_rolls_courant` était référencé §08 ligne 115 + payloads S8 sans définition `§04` (colonne fantôme détectée audit cohérence inter-CDC propagation M09 V1 2026-04-25). Solution validée Val 2026-04-25 : option β table dédiée miroir avec granularité par type. **2026-05-01** : option β migrée en vue cross-schema (lecture directe sans table physique).

> **Nettoyage 2026-05-25 (audit sobriété §04, C3)** : ce bloc décrivait encore une table physique (index UNIQUE, colonnes `id`/`created_at`/`updated_at`, RLS write, politique UPSERT, effet webhook S8) — incohérent avec son statut de **vue en lecture seule cross-schema**. Réécrit ci-dessous : colonnes exposées + RLS de lecture uniquement. Pas d'index propre (les index vivent sur les tables `tms.*` sources), pas d'écriture, pas de webhook S8 (déjà supprimé à la migration 2026-05-01).

**Colonnes exposées par la vue** (projection depuis `tms.stocks_rolls_traiteurs` + `tms.types_contenants` **+ LATERAL dernier `tms.rolls_mouvements` pour la colonne `source`** — précisé 2026-06-11, audit data model : `source` n'existe pas sur `stocks_rolls_traiteurs`, elle est dérivée du dernier mouvement du couple traiteur×type) :

| Colonne | Type | Description |
|---------|------|-------------|
| `traiteur_id` | uuid | Traiteur propriétaire du stock (réf `organisations`) |
| `lieu_id` | uuid | Lieu si stock par lieu (multi-entrepôt traiteur), NULL = stock global traiteur |
| `type_contenant_slug` | text | Identifiant cross-CDC du type contenant (ex: `roll_savr_400L`, `bac_1100L`) |
| `type_contenant_libelle` | text | Libellé du type contenant (ex: "Roll Savr 400L") |
| `quantite_actuelle` | integer | Stock courant. Peut être négatif (incohérence terrain, alerte M11 TMS `m09_stock_negatif`) |
| `quantite_cible` | integer | Consigne TMS paramétrée par Ops Savr (nullable) |
| `derniere_maj_at` | timestamptz | Horodatage de la dernière mise à jour côté TMS |
| `source` | text | Origine de la dernière mise à jour TMS (`cloture_collecte` / `recompte_ops`) |

**RLS (lecture seule — la vue n'est jamais écrite côté Plateforme)** :
- **Admin Savr** + **Ops Savr** → lecture totale.
- **Traiteur** (`traiteur_manager` / `traiteur_commercial`) → lecture sur `traiteur_id = current_user_organisation_id`.
- **Gestionnaire de lieux** → **pas d'accès** (décision Val 2026-05-01 : rolls attribués aux traiteurs uniquement, dashboard stocks rolls gestionnaire supprimé).
- **Client Organisateur** → pas d'accès.

**Source de vérité** : `tms.stocks_rolls_traiteurs` (TMS). La Plateforme lit directement, ne recalcule ni n'écrit rien.

---

## Niveau 4 — Financier

### Table : `grilles_tarifaires_zd` *(catalogue — ajout 2026-05-26)*

Catalogue des **méthodes de tarification ZD**. Plusieurs grilles coexistent (ex. « Standard paliers », « Forfait + variable grands comptes »). Chaque organisation est rattachée à une grille via `organisations.grille_tarifaire_zd_id` (NULL → grille `est_defaut`). Les lignes de la grille (table `tarifs_zero_dechet`) portent une **formule affine par tranche**.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `nom` | text | NOT NULL | Libellé interne (ex: « Standard paliers », « Forfait + variable ») |
| `mode` | enum | NOT NULL | `paliers` \| `fixe_variable` — **label d'aide à la saisie/affichage uniquement**. Le moteur calcule toujours `prix_base_ht + prix_par_couvert_ht × pax` quelle que soit l'étiquette (une grille `paliers` peut avoir un palier final variable, cf. tranche >1000). |
| `est_defaut` | boolean | NOT NULL, défaut `false` | Grille appliquée si l'organisation n'en a aucune d'affectée. **Exactement une** grille active marquée `est_defaut=true` (partial unique index `WHERE est_defaut=true AND valide_jusqu IS NULL`). |
| `valide_du` | date | NOT NULL | Versioning au niveau grille |
| `valide_jusqu` | date | | null = grille active |
| `commentaires` | text | | Usage interne Admin Savr |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**⚠ Écart V1 tracé (divergence R18, 2026-07-04)** : le schéma **live** de `grilles_tarifaires_zd` porte deux colonnes héritées **`actif` (boolean)** + **`description` (text)** absentes de cette cible (le DDL cible V2 a `commentaires` + `est_defaut`, pas `actif`/`description`). V1-only, non utilisées par le versionnement (close-then-create sur `valide_du`/`valide_jusqu`/`est_defaut`) → **à retirer en convergence V2** (garde-fou 1). Le POST `admin/grilles-tarifaires-zd` lit/insère bien **`mode`** (enum `mode_grille_zd`), jamais `methode` (colonne inexistante — bug code corrigé migration R18 `20260704170000`).

**Versioning** : pour modifier une grille, on la ferme (`valide_jusqu`) et on crée une nouvelle grille (entête + lignes) ; les collectes passées conservent leur tarif via `factures_collectes.tarif_detail`. Pas de modification rétroactive.

**Seed grille par défaut** (« Standard paliers », `est_defaut=true`) — reprend la grille publique historique, le palier >1000 étant désormais exprimable proprement en affine (`prix_base_ht=0`, `prix_par_couvert_ht=1`) :

| pax_min | pax_max | prix_base_ht | prix_par_couvert_ht | Prix résultant |
|---------|---------|--------------|---------------------|----------------|
| 1 | 250 | 450.00 | 0 | 450 € |
| 251 | 500 | 600.00 | 0 | 600 € |
| 501 | 750 | 800.00 | 0 | 800 € |
| 751 | 1000 | 1000.00 | 0 | 1 000 € |
| 1001 | null | 0.00 | 1.00 | 1 €/pax |

**RLS (audit RLS V1 2026-06-05)** — vaut pour `grilles_tarifaires_zd`, `tarifs_zero_dechet` et `tarifs_packs_ag` : lecture **authentifiée** (référentiel de calcul, pas de donnée par orga ; le prix n'est pas affiché au formulaire = règle UI, pas RLS), écriture **`admin_savr` only**. Le détail négocié vit dans `tarifs_negocie` + `factures_collectes.tarif_detail`. Cf. [[09 - Authentification et permissions#A5 — `grilles_tarifaires_zd` + `tarifs_zero_dechet` + `tarifs_packs_ag`]].

---

### Table : `tarifs_zero_dechet` *(lignes de grille — refonte 2026-05-26)*

Lignes d'une grille du catalogue ZD. Chaque ligne couvre une tranche de pax et porte une **formule affine** `prix_base_ht + prix_par_couvert_ht × pax`. **Refonte 2026-05-26** : rattachement à une grille (`grille_id`), renommage `prix_ht` → `montant_fixe_ht`, ajout `montant_par_pax_ht`, retrait du versioning par ligne (porté désormais par `grilles_tarifaires_zd`). **M1.3** : renommage `montant_fixe_ht` → `prix_base_ht`, `montant_par_pax_ht` → `prix_par_couvert_ht` (alignement DDL réel).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `grille_id` | uuid | FK → grilles_tarifaires_zd, NOT NULL | Grille parente (**ajout 2026-05-26**) |
| `pax_min` | integer | NOT NULL | ex: 1 |
| `pax_max` | integer | | ex: 250 (null = illimité) |
| `prix_base_ht` | decimal | NOT NULL, défaut 0 | Part fixe HT (**ex-`prix_ht`, renommé 2026-05-26 en `montant_fixe_ht`, puis M1.3 en `prix_base_ht`**) |
| `prix_par_couvert_ht` | decimal | NOT NULL, défaut 0 | Part variable HT par pax (**ajout 2026-05-26 sous `montant_par_pax_ht`, renommé M1.3**). `0` = palier à prix fixe. |
| `created_at` | timestamptz | NOT NULL | |

**Prix d'une ligne** = `prix_base_ht + prix_par_couvert_ht × pax`, pour `pax` dans `[pax_min, pax_max]`.
- Grille `paliers` : `prix_par_couvert_ht = 0` (prix fixe par tranche).
- Grille `fixe_variable` : typiquement une ligne unique `[1, null]` avec part fixe + part variable (ex. 200 € + 1 €/pax), ou plusieurs tranches si paliers internes.

**Renommé `montant_fixe_ht` (refonte 2026-05-26)**, puis **renommé `prix_base_ht` (M1.3)**. **Retirés (refonte 2026-05-26)** — versioning porté par la grille.

**Migration** : créer la grille `est_defaut` « Standard paliers » ; rattacher les lignes existantes (`prix_base_ht = ancien prix_ht`, `prix_par_couvert_ht = 0`, `grille_id` = grille standard) ; reprendre la tranche >1000 en `prix_base_ht=0`/`prix_par_couvert_ht=1`.

---

### Table : `tarifs_packs_ag`

Historique versionné des tarifs Anti-Gaspi publics par type de pack. Sert de **grille de référence** au formulaire de création de pack en back-office Admin (§06 §8 onglet Packs AG). L'Admin peut surcharger le prix au moment de la création d'un pack `personnalise`. Versionné selon la même logique que `tarifs_zero_dechet`.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `type_pack` | enum | NOT NULL | `unitaire` \| `pack_10` \| `pack_30` \| `pack_60` (le type `personnalise` n'a pas de tarif public — saisi à la main par l'Admin) |
| `credits` | integer | NOT NULL | Nombre de collectes du pack (1, 10, 30, 60) |
| `prix_unitaire_ht` | decimal | NOT NULL | Prix HT par collecte (ex : 590.00, 500.00, 460.00, 390.00) |
| `montant_total_ht` | decimal | NOT NULL | `credits × prix_unitaire_ht` (dénormalisé pour lecture rapide, validation cohérence en trigger) |
| `mensualisable` | boolean | NOT NULL, défaut false | Indication contractuelle uniquement (Pack 30 = 3 mensualités, Pack 60 = 6 mensualités). Pas de logique de paiement gérée par la plateforme — calendrier traité hors-app ou dans Pennylane. |
| `nb_mensualites` | integer | | Renseigné si `mensualisable=true` (3 ou 6). Affiché dans le formulaire de création pack à titre informatif. |
| `valide_du` | date | NOT NULL | Date de début de validité |
| `valide_jusqu_au` | date | | null = tarif actuel |
| `created_at` | timestamptz | NOT NULL | |

**Valeurs V1 de référence** :

| `type_pack` | `credits` | `prix_unitaire_ht` | `montant_total_ht` | `mensualisable` | `nb_mensualites` |
|---|---|---|---|---|---|
| `unitaire` | 1 | 590.00 | 590.00 | false | null |
| `pack_10` | 10 | 500.00 | 5 000.00 | false | null |
| `pack_30` | 30 | 460.00 | 13 800.00 | true | 3 |
| `pack_60` | 60 | 390.00 | 23 400.00 | true | 6 |

**Règles** :
- Versionning identique à `tarifs_zero_dechet` : modifier un tarif = fermer la ligne (`valide_jusqu_au`) + créer une nouvelle ligne. Pas de modification rétroactive.
- Au moment de la création d'un pack `packs_antgaspi`, le formulaire pré-remplit `credits_initiaux` + `montant_total_ht` depuis la ligne active de `tarifs_packs_ag` correspondant au `type_pack` choisi. L'Admin peut surcharger le `montant_total_ht` au cas par cas (ex : remise commerciale ponctuelle), traçabilité via `packs_antgaspi.commentaires`.
- Le tarif n'est **pas** stocké dans `packs_antgaspi.tarif_pack_ag_id` (pas de FK historique) — `montant_total_ht` est figé directement sur le pack à la création (snapshot). Cohérent avec la philosophie de la plateforme où les valeurs financières sont gravées sur l'objet métier.
- Type `personnalise` : pas de ligne dans `tarifs_packs_ag`. Le formulaire affiche les champs `credits_initiaux` + `prix_unitaire_ht` libres, calcule `montant_total_ht` à la volée.

---

### Table : `packs_antgaspi`

Packs pré-payés Anti-Gaspi par client. Un client peut avoir plusieurs packs au total (historique épuisé/annulé + un actif), mais **au plus UN pack avec `statut=actif` à un instant T** (refonte 2026-05-08, contrôle d'unicité applicatif — voir [[05 - Règles métier#Règle V1 — Pack unique actif refonte 2026-05-08]]). Mode de facturation choisi à l'achat : global ou par collecte.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `organisation_id` | uuid | FK → organisations, NOT NULL | **Étendu 2026-05-07** — Client détenteur du pack : `traiteur`, `agence` ou `gestionnaire_lieux`. Le crédit AG est décompté sur le pack du programmateur de la collecte (`evenements.organisation_id`), pas sur le pack du traiteur opérationnel. Voir §06.09. |
| `type_pack` | enum | NOT NULL | `unitaire` \| `pack_10` \| `pack_30` \| `pack_60` \| `personnalise` (tarif négocié libre) |
| `credits_initiaux` | integer | NOT NULL | ex: 10, 30, 60 |
| `credits_consommes` | integer | NOT NULL, défaut 0 | Incrémenté à chaque collecte réalisée |
| `credits_restants` | integer | GENERATED ALWAYS AS (credits_initiaux - credits_consommes) STORED | **Sobriété §04 2026-05-25 (B3)** : colonne calculée au niveau DB (ex-colonne simple « Calculé » qui risquait la désync). Plus aucune maintenance applicative. |
| `montant_total_ht` | decimal | NOT NULL | Montant total négocié pour le pack (indépendant du nb de collectes) |
| `mode_facturation` | enum | NOT NULL | `globale_achat` = 1 facture au moment de l'achat \| `par_collecte` = facture générée à chaque collecte avec montant libre |
| `date_achat` | date | NOT NULL | |
| `date_expiration` | date | | V1 : toujours null (pas de règle d'expiration). V2 : à rouvrir (ex: 12 mois glissants) |
| `facture_achat_id` | uuid | FK → factures | Renseigné si `mode_facturation=globale_achat` |
| `statut` | enum | NOT NULL | `actif` \| `epuise` \| `annule` *(`expire` retiré V1 — revue sobriété 2026-05-30 D1 : aucun mécanisme d'expiration V1, `date_expiration` toujours null ; `expire` réintroduit en V2 avec la règle d'expiration)* |
| `commentaires` | text | | Notes commerciales (conditions négociées) |
| `prix_unitaire_ht` | decimal | | Snapshot du prix unitaire par collecte au moment de la création (pré-rempli depuis `tarifs_packs_ag.prix_unitaire_ht` pour les types standards, saisi librement pour `personnalise`). Ajouté M2.1b 2026-06-15 — Option A DDL cible V2. |
| `idempotency_key` | text | UNIQUE | Clé de dédup pour le POST API de création pack (évite les doubles créations en cas de retry réseau). Ajouté M2.1b 2026-06-15 — Option A DDL cible V2. |
| `cree_par_user_id` | uuid | FK → shared.users | Traçabilité de l'Admin Savr ayant créé le pack. Ajouté M2.1b 2026-06-15 — Option A DDL cible V2. |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Règles** :
- Quand `credits_consommes = credits_initiaux` → `statut` passe automatiquement à `epuise`. **Pas de blocage de programmation (corrigé 2026-06-11, audit data model — résidu contredisant la décision « blocage hors-pack supprimé », F3 test-scenarios §06.01 + CLAUDE.md §4)** : programmer une AG sans pack actif (pack épuisé inclus) déclenche une **alerte seule** (Admin in-app + signal au formulaire), la collecte est facturée à l'unité (négo directe) tant qu'un nouveau pack n'est pas négocié.
- Le `montant_total_ht` n'est PAS répercuté tel quel sur les factures par collecte : chaque facture par collecte porte son propre `montant_ht` fixé librement par l'admin (voir `factures_collectes.montant_ligne_ht`).
- **Unicité du pack actif (refonte 2026-05-08)** : double protection — (1) validation applicatif lors de l'INSERT/UPDATE côté API, (2) **partial unique index DB-level** garantissant qu'un seul pack par organisation peut être à `statut='actif'` simultanément. SQL : `CREATE UNIQUE INDEX uniq_pack_actif_par_org ON packs_antgaspi (organisation_id) WHERE statut = 'actif';`. Voir [[05 - Règles métier#Règle V1 — Pack unique actif refonte 2026-05-08]].
- **Recrédit automatique annulation collecte (refonte 2026-05-08)** : trigger DB sur transition `collectes.statut: realisee → annulee`. Effet atomique : `credits_consommes -= 1` + bascule `statut: epuise → actif` si applicable + UPDATE `collectes.pack_antgaspi_id = NULL` + audit_log. Voir [[05 - Règles métier#Annulation d'une collecte AG recrédit automatique]].

---

### Table : `factures`

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `organisation_id` | uuid | FK → organisations, NOT NULL | **Étendu 2026-05-07** — Client facturé : `traiteur`, `agence` ou `gestionnaire_lieux`. V1 : programmateur=facturé (= `evenements.organisation_id` de la ou des collectes liées). |
| `entite_facturation_id` | uuid | FK → entites_facturation, NOT NULL | Entité juridique précise à facturer (porte le SIRET) |
| `numero_facture` | text | NOT NULL, UNIQUE | Numéro séquentiel selon format : `FZD-YYYY-NNNNN` (ZD), `FAG-YYYY-NNNNN` (AG), `FPK-YYYY-NNNNN` (pack AG), `AV-YYYY-NNNNN` (avoir, série unique toutes typologies). Attribué à la validation uniquement (pas en brouillon) pour respecter l'intégrité séquentielle fiscale. Refonte 2026-05-08 : séries `AZD-` et `AAG-` fusionnées en `AV-` (la typologie d'origine reste tracée via `facture_origine_id`). |
| `facture_origine_id` | uuid | FK → factures | Renseigné si `type=avoir` — trace la facture annulée |
| `type` | enum | NOT NULL | `zero_dechet` \| `achat_pack_antigaspi` \| `collecte_antigaspi` \| `avoir`. Refonte 2026-05-08 : `avoir_integral` + `avoir_partiel` fusionnés en `avoir` (avoir partiel reporté V1.1, V1 ne supporte que l'avoir intégral). |
| `mode_facturation` | enum | NOT NULL | `par_collecte` \| `mensuelle` \| `globale_pack` |
| `pack_antgaspi_id` | uuid | FK → packs_antgaspi | Renseigné si type=`achat_pack_antigaspi` ou si facture par collecte rattachée à un pack |
| `montant_ht` | decimal | NOT NULL | |
| `taux_tva` | decimal | NOT NULL, défaut 20.0 | |
| `montant_ttc` | decimal | NOT NULL | |
| `statut` | enum | NOT NULL | `brouillon` \| `en_attente_pennylane` \| `emise` \| `payee` \| `annulee`. Refonte 2026-05-08 : `en_retard` retiré du enum — désormais calculé en lecture (`statut = 'emise' AND date_echeance < CURRENT_DATE`), pas stocké. `en_attente_pennylane` = Admin a validé, push Pennylane en cours ou en retry (2026-04-28). |
| `pennylane_id` | text | | Identifiant Pennylane (après envoi) |
| `pdf_url_pennylane` | text | | URL du PDF Factur-X émis par Pennylane (source de vérité légale) |
| `pdf_url_savr` | text | | URL du PDF copie de travail généré par Savr (affichage client, archivage interne) |
| `date_emission` | date | | |
| `date_echeance` | date | | |
| `date_paiement` | date | | |
| `erreur_synchro` | text | | Message d'erreur Pennylane si échec synchro (4xx ou retry épuisé) |
| `erreur_synchro_at` | timestamptz | | Horodatage de la dernière erreur synchro Pennylane |
| `derniere_tentative_pennylane_at` | timestamptz | | Horodatage du dernier push Pennylane tenté (alimente le bandeau "il y a Xmin" en UI Admin) |
| `marge_logistique` | decimal | | **Ajout F5 test-scenarios 2026-06-07 (ex-colonne fantôme — référencée par le trigger marge `fn_recalc_marge_tournee` sans exister dans ce tableau)** — marge Savr au grain facture : `montant_ht − Σ cout_reparti_ht` (via `v_courses_logistiques`) des collectes liées par `factures_collectes`. Écrite uniquement par le trigger cross-schema. **V1 : colonne créée mais reste NULL** (vue + trigger = V2, décision Val 2026-06-10 — cf. statut V1 de `v_courses_logistiques`). **Donnée sensible jamais exposée clients** (cf. vue `v_factures_client` ci-dessous + §09) |
| `created_at` | timestamptz | NOT NULL | |

**Refonte 2026-05-08 — colonnes supprimées V1** : `derniere_relance_at`, `nb_relances` (les relances sont gérées directement dans Pennylane, pas dans Savr — décision 2026-04-28). Voir [[06 - Fonctionnalités détaillées/08 - Génération et édition facture (Admin)]] §8.

**Vue `v_factures_client` (décision F5 test-scenarios 2026-06-07)** : la RLS row-level ne masquant pas une colonne, les rôles clients (traiteur manager/commercial, agence, gestionnaire_lieux) lisent les factures via cette vue whitelist — toutes les colonnes **sauf** `marge_logistique`, `erreur_synchro`, `erreur_synchro_at`, `derniere_tentative_pennylane_at`. SELECT direct sur `plateforme.factures` réservé staff (`admin_savr`/`ops_savr`). Les policies org-scoped de la matrice §09 s'appliquent à travers la vue (`security_invoker`).

**Matrice des cas de facturation** :

| Cas métier | `type` | `mode_facturation` | `pack_antgaspi_id` | `factures_collectes` |
|------------|--------|-------------------|---------------------|----------------------|
| ZD à la collecte | `zero_dechet` | `par_collecte` | null | 1 ligne |
| ZD mensuel groupé | `zero_dechet` | `mensuelle` | null | N lignes |
| Achat pack AG global | `achat_pack_antigaspi` | `globale_pack` | renseigné | 0 ligne |
| Collecte AG sur pack "par collecte" | `collecte_antigaspi` | `par_collecte` | renseigné | 1 ligne (montant libre) |
| Collecte AG hors pack (négo directe) | `collecte_antigaspi` | `par_collecte` | null | 1 ligne (montant libre) |
| Avoir intégral (annulation facture) | `avoir` | idem facture d'origine | idem | N lignes en négatif |

### Table : `factures_collectes` *(lignes de facture — étendue décision F3 test-scenarios 2026-06-07, ex-jointure N-N stricte)*

Relie une facture à une ou plusieurs collectes ET porte les **lignes libres** (frais divers, remises ponctuelles — §06.08 §4 Bloc 3) ainsi que la **TVA par ligne** (totaux par taux Bloc 4). Supporte le mode mensuel groupé ET la facturation par collecte avec montant libre (cas Anti-Gaspi).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK, défaut `gen_random_uuid()` | **Ajout 2026-06-11 (audit data model)** — PK surrogate. Indispensable depuis F3 : les lignes libres (`collecte_id` NULL) n'ont aucune clé naturelle, et une même collecte peut apparaître sur une facture annulée puis sa remplaçante. |
| `facture_id` | uuid | FK → factures, NOT NULL | |
| `collecte_id` | uuid | FK → collectes, **NULL autorisé (F3 2026-06-07)** | NULL = ligne libre. `CHECK (collecte_id IS NOT NULL OR designation IS NOT NULL)` |
| `designation` | text | | **Ajout F3 2026-06-07** — désignation de la ligne libre (obligatoire si `collecte_id` NULL). Pour une ligne collecte, `libelle_ligne` reste le libellé personnalisable |
| `quantite` | numeric | NOT NULL, défaut 1 | **Ajout F3 2026-06-07** — V1 : toujours 1 pour ZD/AG (§06.08 Bloc 2), libre sur ligne libre |
| `taux_tva` | numeric | NOT NULL, défaut 20.0 | **Ajout F3 2026-06-07** — taux TVA par ligne (20 / 10 / 5,5 / 0). Les totaux TVA par taux (§06.08 Bloc 4) sont calculés depuis les lignes ; `factures.taux_tva` devient le taux majoritaire informatif |
| `tarif_applique_id` | uuid | FK, NULL | **Redéfini 2026-05-26** — pointe vers la ligne de **base** appliquée : `tarifs_zero_dechet` (ligne de grille ZD) ou `tarifs_packs_ag` (tarif unitaire AG). NULL si montant libre Admin (AG hors barème). Le détail complet (base + remises) est dans `tarif_detail`. |
| `tarif_applique_source` | enum | | **Redéfini 2026-05-26** — `zd_grille` \| `ag_unitaire` \| `libre`. Indique la nature de la base (la base ne vient plus jamais de `tarifs_negocie`, qui ne porte que des remises). |
| `tarif_detail` | jsonb | | **Ajout 2026-05-26** — snapshot figé de la composition : `{ base: { source, ref_id, montant_ht }, remises: [ { tarifs_negocie_id, remise_pct } ], montant_final_ht }`. Garantit la reproductibilité même si grilles/remises évoluent (pattern comparable à `tarif_applique_id`). Source de vérité du calcul affiché sur la facture. |
| `montant_ligne_ht` | decimal | NOT NULL | Montant **final** de la ligne (base × Π(1 − remises)) — figé. Pour l'AG hors barème, saisi librement par l'Admin. |
| `libelle_ligne` | text | | Libellé personnalisable sur la facture (ex: "Collecte AG - Gala LVMH 15/06") |

**Refonte 2026-05-08 — colonne supprimée V1** : `motif_modification_montant` (le log audit standard tient lieu de traçabilité — qui / quand / ancien montant / nouveau montant). Voir [[06 - Fonctionnalités détaillées/08 - Génération et édition facture (Admin)]] §5.

**Principe de flexibilité Anti-Gaspi** : pour les collectes AG sur pack "par collecte" ou hors pack, le `montant_ligne_ht` est saisi manuellement par l'Admin Savr à chaque facture — il n'est PAS contraint par le prix unitaire de référence du pack (`montant_total_ht / credits_initiaux`, ex-colonne `prix_unitaire_reference_ht` retirée 2026-05-25). Cela permet de moduler selon la négociation client, la complexité de la collecte, ou une gestuelle commerciale.

**RLS (audit RLS V1 2026-06-05)** : contient `tarif_detail` (base + remises négociées figées) = donnée sensible. Lecture dérivée de `factures` via `facture_id` (org-scoped), écriture `admin_savr`. Cf. [[09 - Authentification et permissions#A4 — `factures_collectes`]].

**Trigger `trg_fc_collecte_non_facturee` (Reco B test-scenarios 2026-06-07)** : BEFORE INSERT — RAISE EXCEPTION si `NEW.collecte_id` a déjà une ligne `factures_collectes` rattachée à une facture de `statut ≠ annulee` et `type ≠ avoir`. Ce prédicat est la **définition formelle « collecte non facturée »** (sélecteur §06.08 §6, batch J+1, recyclage post-avoir). Lignes libres (`collecte_id` NULL) non concernées.

### Table : `sequences_facturation` *(nouvelle F4 test-scenarios 2026-06-07)*

Compteurs de numérotation fiscale gapless (§06.08 §7). Une ligne par couple série × année.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `serie` | text | NOT NULL, **PK composite `(serie, annee)`** *(déclarée 2026-06-11, audit data model — la table n'avait pas de PK, seule l'unicité était mentionnée)* | `FZD` \| `FAG` \| `FPK` \| `AV` (+ `BSAV` / `ATT-DON` si réutilisée pour les documents §05 §6) |
| `annee` | integer | NOT NULL, PK composite | Nouvelle ligne créée au premier numéro de l'année (reset implicite à 00001) |
| `dernier_numero` | integer | NOT NULL, défaut 0 | Incrémenté sous verrou ligne `SELECT ... FOR UPDATE` dans la transaction de validation. Un rejet Pennylane 4xx ne décrémente jamais (numéro conservé par la facture — décision F4) |

**RLS** : écriture `SERVICE_ROLE` seul (fonction de validation), lecture `admin_savr`. Migration : amorcée au dernier numéro Bubble par série × année (cf. scénario `migration_amorce_sequences_apres_dernier_numero`).

---

## Niveau 5 — Reporting et suivi

### Table : `rapports_rse`


| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `evenement_id` | uuid | FK → evenements, NOT NULL | |
| `collecte_id` | uuid | FK → collectes | Si rapport par collecte (null si rapport événement global) |
| `version` | integer | NOT NULL, défaut 1 | Incrémenté à chaque régénération manuelle |
| `pdf_url` | text | | URL Supabase Storage |
| `genere_at` | timestamptz | | Date/heure de la génération initiale (automatique batch J+1 6h) |
| `genere_par` | enum | | `automatique` \| `manuel` |
| `regenere_at` | timestamptz | | Date/heure de la dernière régénération manuelle (null si jamais régénéré) |
| `regenere_par_user_id` | uuid | FK → users | Utilisateur ayant déclenché la dernière régénération (null si non régénéré) |
| `disponible_a` | timestamptz | NOT NULL | H+24 après `collectes.realisee_at` — rapport non accessible avant cette date (embargo). **Corrigé 2026-05-25 (C1)** : ex-réf fantôme `collectes.fin_at` (inexistante) remplacée par `collectes.realisee_at` (timestamptz du passage à `realisee`). |
| `envoye_client` | boolean | défaut `false` | |
| `envoye_at` | timestamptz | | |
| `consulte_par_user_at` | timestamptz | | Horodatage de la première consultation du rapport par le user programmeur (affiché en back-office Admin comme indicateur "rapport consulté") |
| `filtres_benchmark` | jsonb | nullable | Snapshot des filtres benchmark (Période / Lieux / Type d'événement / Taille d'événement) choisis par le traiteur au moment de la génération du PDF rapport RSE. Garantit la reproductibilité du point benchmark au re-téléchargement (même PDF = mêmes valeurs de référence) et alimente la **légende des filtres affichée sous le graphe benchmark** du PDF (cf. [[12 - Reporting et exports]] §1.2). **Rétablie 2026-06-03 (annulation revue sobriété §12 B2, sur arbitrage Val — session sobriété §06.04)** : la revue §12 B2 du même jour (benchmark calculé à la volée, colonne supprimée) est **annulée**. Motif Val : l'utilisateur doit pouvoir figer son benchmark personnalisé sur le PDF, avec légende des filtres. Le taux de recyclage reste figé (`collectes.taux_recyclage`). |
| `template_version` | text | NULL | **Ajout 2026-06-24 (divergence M1.6/M2.4 — lot R2, BL-P1-API-07)** — Version figée du gabarit PDF utilisé (ex. `attestation-don@1`), écrite au rendu pour garantir un re-rendu iso. NULL pour les documents émis avant l'introduction du versioning (R2). Convergence V2 = colonne permanente (le TMS natif génère les mêmes PDF), pas une colonne V1-only neutralisée au cutover. |
| `created_at` | timestamptz | NOT NULL | |

---

**RLS (audit RLS V1 2026-06-05)** : lecture org-scoped via `evenement_id` (organisation programmatrice / traiteur opérationnel / client organisateur / gestionnaire du lieu) ; l'embargo H+24 (`disponible_a`) reste un contrôle **applicatif**, pas RLS. Écriture système (batch J+1) + `admin_savr` (régénération). Cf. [[09 - Authentification et permissions#A8 — `rapports_rse`]].

> **Rapport « sans excédent » (tranché 2026-06-07, F1 lot ⑫ test-scenarios)** : le PDF « Événement sans excédent alimentaire » ([[12 - Reporting et exports]] §1.3-bis) est porté par une **ligne `rapports_rse` standard** — pas de colonne discriminante (cohérent retrait `type_rapport` A1). Particularité : `disponible_a = genere_at` (génération immédiate au webhook S5 `realisee_sans_collecte`, pas d'embargo H+24). Référence fichier : `shared.fichiers` `entity_type = 'plateforme.rapports_rse'` (liste des 9 inchangée).
>
> **Régénération manuelle traiteur_manager (tranché 2026-06-07, F3 lot ⑫)** : passe par une **Edge Function SERVICE_ROLE** (contrôle applicatif du périmètre, mêmes 4 chemins que la policy A8 SELECT) — aucune écriture client directe, policy `rr_write_admin` inchangée. Test P1 bloquant : régénération cross-org → 403.

---

### Table : `rapports_synthese` (supprimée — refonte 2026-05-05)

> **Refonte 2026-05-05** : table supprimée. Les synthèses agrégées multi-collectes ne sont plus archivées. Génération uniquement à la demande via bouton "Exporter une synthèse PDF" du dashboard traiteur §06.04 (et équivalent dashboard gestionnaire §06.05 si applicable), téléchargement direct, pas de stockage côté DB. Cohérent avec :
> - Suppression nav Rapports RSE espace traiteur (§06.04)
> - Suppression batchs auto mensuel/trimestriel/annuel (jamais arrivés en prod V1, retirés du périmètre)
> - Suppression bucket Supabase Storage `rapports_synthese`
> 
> **Migration** : pas de migration nécessaire (la table n'a jamais été déployée). Si elle l'avait été, suppression de la table + bucket + lignes.
> 
> **Spec PDF synthèse** (contenu) : conservée et déplacée dans [[12 - Reporting et exports]] §Synthèses à la demande. La génération reste asynchrone (Edge Function), mais le PDF n'est plus persisté en DB — l'utilisateur le télécharge et le conserve lui-même.

---

## Niveau 5bis — Traçabilité réglementaire (Module 20 MVP)

Registre chronologique interne Savr. Les données sont agrégées via une vue SQL sur `collectes` + `collecte_flux` + `attributions_antgaspi`, filtrée par RLS sur l'organisation de l'utilisateur. Les justificatifs (bordereaux + attestations) sont des PDF générés automatiquement à la clôture de la collecte.

### Table : `bordereaux_savr`

Bordereau de collecte émis par Savr pour chaque collecte zéro-déchet clôturée. Format PDF généré automatiquement. Pas de valeur légale officielle (Trackdéchets V2), mais document interne Savr auditable.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `collecte_id` | uuid | FK → collectes, NOT NULL, UNIQUE | 1 bordereau par collecte ZD |
| `numero` | text | NOT NULL, UNIQUE | ex: `BSAV-2026-00123` (séquence globale Savr) |
| `date_emission` | date | NOT NULL | Date de génération du PDF |
| `date_collecte` | date | NOT NULL | Snapshot depuis `collectes.date_collecte` |
| `producteur_entite_facturation_id` | uuid | FK → entites_facturation | **Précisé 2026-05-07** — Snapshot du producteur juridique du déchet = **traiteur opérationnel** (`evenements.traiteur_operationnel_organisation_id`), pas le programmateur. Nullable car le traiteur opérationnel peut être une fiche shadow sans `entite_facturation` ; dans ce cas, les champs `producteur_raison_sociale`/`producteur_siret` ci-dessous sont remplis directement depuis `organisations` (et le bordereau est marqué `bordereaux_savr.statut='brouillon'` tant que `producteur_siret` est manquant — alerte UX au moment de la programmation cf. §06.01). |
| `producteur_raison_sociale` | text | NOT NULL | Snapshot du traiteur opérationnel |
| `producteur_siret` | text | NULL | **Précisé 2026-05-07** — Snapshot du traiteur opérationnel. Peut être NULL si fiche shadow sans SIRET → bordereau bloqué en `brouillon` jusqu'à enrichissement. |
| `producteur_adresse` | text | NOT NULL | Snapshot (adresse du lieu événement en général) |
| `transporteur_nom` | text | NOT NULL | Snapshot depuis `prestataires_logistiques` (ex: Strike) |
| `transporteur_siret` | text | | Snapshot |
| `exutoire_nom` | text | NOT NULL | Snapshot depuis `flux_dechets.exutoire` (ex: Veolia Saint-Denis) |
| `exutoire_adresse` | text | | Snapshot |
| `exutoire_siret` | text | | Snapshot |
| `detail_flux` | jsonb | NOT NULL | Liste des flux collectés : `[{flux, code_dechet, poids_kg, nb_bacs, filiere}]` |
| `poids_total_kg` | decimal | NOT NULL | Somme des flux |
| `pdf_url` | text | NOT NULL | URL Supabase Storage |
| `statut` | enum | NOT NULL | `brouillon` \| `emis` \| `corrige` \| `annule` |
| `version` | integer | NOT NULL, défaut 1 | Incrémenté si régénération après correction |
| `template_version` | text | NULL | **Ajout 2026-06-24 (divergence M1.6/M2.4 — lot R2, BL-P1-API-07)** — Version figée du gabarit PDF utilisé (ex. `bordereau-zd@1`), écrite au rendu pour garantir un re-rendu iso. NULL pour les documents émis avant l'introduction du versioning (R2). Convergence V2 = colonne permanente (le TMS natif génère les mêmes PDF), pas une colonne V1-only neutralisée au cutover. |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Principe snapshot** : toutes les données du producteur, transporteur, exutoire sont copiées dans le bordereau à l'émission. Si un exutoire change d'adresse en 2028, le bordereau émis en 2026 reste cohérent.

---

### Table : `attestations_don`

Attestation de don émise par Savr pour chaque collecte Anti-Gaspi vers une association habilitée. Permet la défiscalisation 60% du donateur (document type 2041-GE-SD).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `collecte_id` | uuid | FK → collectes, NOT NULL, UNIQUE | 1 attestation par collecte AG |
| `attribution_antgaspi_id` | uuid | FK → attributions_antgaspi, NOT NULL | |
| `numero` | text | NOT NULL, UNIQUE | ex: `ATT-DON-2026-00045` |
| `date_emission` | date | NOT NULL | |
| `date_collecte` | date | NOT NULL | |
| `donateur_entite_facturation_id` | uuid | FK → entites_facturation, NOT NULL | **Précisé 2026-05-07** — Snapshot du donateur fiscal = entité de facturation de l'**organisation programmatrice** (= facturée en V1, cf. règle programmateur=facturé). Peut être un traiteur, une agence ou un gestionnaire de lieux. SIRET garanti NOT NULL (interdiction de programmer une AG depuis une organisation sans `entite_facturation` — règle §05). |
| `donateur_raison_sociale` | text | NOT NULL | Snapshot |
| `donateur_siret` | text | NOT NULL | Snapshot |
| `association_id` | uuid | FK → associations, NOT NULL | |
| `association_nom` | text | NOT NULL | Snapshot |
| `association_numero_rup` | text | | Si RUP (Reconnue d'Utilité Publique) |
| `association_habilitation` | text | NOT NULL | Snapshot du statut 2041-GE au moment de l'émission |
| `volume_repas` | integer | | Nb de repas donnés (depuis `attributions_antgaspi.volume_repas_realise`) |
| `poids_kg` | decimal | | Poids donné si disponible |
| `valeur_estimee_ht` | decimal | | Valeur estimée du don pour défiscalisation (base : coût de revient traiteur) |
| `pdf_url` | text | NOT NULL | |
| `statut` | enum | NOT NULL | `brouillon` \| `emise` \| `corrigee` \| `annulee` |
| `version` | integer | NOT NULL, défaut 1 | |
| `template_version` | text | NULL | **Ajout 2026-06-24 (divergence M1.6/M2.4 — lot R2, BL-P1-API-07)** — Version figée du gabarit PDF utilisé (ex. `attestation-don@1`), écrite au rendu pour garantir un re-rendu iso. NULL pour les documents émis avant l'introduction du versioning (R2). Convergence V2 = colonne permanente (le TMS natif génère les mêmes PDF), pas une colonne V1-only neutralisée au cutover. |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Règle d'émission (précisée 2026-06-11, audit data model — 3 formulations divergeaient : « 100 % des AG », « si assoc habilitée » au diagramme de relations, « pas d'attestation si realisee_sans_collecte » CLAUDE.md §4)** : attestation générée pour **100 % des collectes AG arrivées à `realisee` avec des repas effectivement donnés**, quel que soit le statut d'habilitation de l'association. **Exclusions** : `realisee_sans_collecte` (aucun repas → aucune attestation, badge + motif + photo seuls) et collectes `annulee`. Le PDF adapte son contenu selon `association.habilitee_attestation_fiscale` :
- Association habilitée (2041-GE-SD) : l'attestation inclut les mentions légales permettant la défiscalisation 60% du donateur
- Association non habilitée : l'attestation reste un document officiel de traçabilité de don (volumes, association destinataire, date), mais sans mention fiscale
Ce choix garantit que chaque collecte AG laisse une trace documentée, utile pour le reporting RSE du donateur même sans avantage fiscal.

---

### Table : `documents_generaux_savr`

Documents statiques Savr accessibles depuis l'espace client (méthodologie, CGV, politique de confidentialité). Versionnés.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `type` | enum | NOT NULL | `methodologie` \| `cgv` \| `politique_confidentialite` \| `autre` |
| `titre` | text | NOT NULL | |
| `version` | text | NOT NULL | ex: `v1.0`, `v2.1` |
| `pdf_url` | text | NOT NULL | URL Supabase Storage |
| `effective_from` | date | NOT NULL | Date d'entrée en vigueur |
| `effective_to` | date | | null = actuel |
| `uploaded_by` | uuid | FK → users, NOT NULL | Admin Savr |
| `actif` | boolean | NOT NULL, défaut `true` | |
| `created_at` | timestamptz | NOT NULL | |

**Usage** : 1 seul document par `type` actif à la fois (contrainte métier). Méthodologie V2 dynamique (Module 19) viendra compléter sans remplacer.

> ⚠ **Divergence V1 assumée (colonne `statut`)** *(cluster C, décision Val 2026-06-22)* : la table V1 live porte une colonne `statut` (enum `document_general_statut` : `en_attente`/`genere`/`erreur`/`expire`) qui **n'existe pas dans le DDL cible V2**. Elle n'est **pas morte** — elle porte le cycle de vie du document généré et est lue par l'index `idx_docs_generaux_statut`, la RLS `dg_read` (`USING (statut = 'genere' OR f_is_staff())`) et `shared.f_fichier_visible` (gating visibilité PDF). Conservée en **V1-only assumé** (cf. liste fermée Frontière TMS-Ready garde-fou 1). Le type a été renommé `document_statut_enum → document_general_statut` (convergence de nommage, **valeurs inchangées, aucune donnée altérée**). En V2 la visibilité sera dérivée autrement. Cf. `_Divergences/CLUSTER-C_20260622.md`.

**RLS (audit RLS V1 2026-06-05)** : documents statiques publics — lecture **tous authentifiés** sur `actif = true`, écriture `admin_savr`. Cf. [[09 - Authentification et permissions#A10 — `exports_registre` + `documents_generaux_savr`]].

---

### Table : `exports_registre`

Traçabilité de chaque export du registre déchets généré par un utilisateur. Obligatoire pour auditabilité (qui a téléchargé quoi, quand).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `user_id` | uuid | FK → users, NOT NULL | |
| `organisation_id` | uuid | FK → organisations, NOT NULL | Périmètre de l'export |
| `type_export` | enum | NOT NULL | `registre_dechets` \| `bordereaux_batch` \| `attestations_batch` |
| `periode_debut` | date | NOT NULL | |
| `periode_fin` | date | NOT NULL | |
| `filtres_appliques` | jsonb | | ex: `{lieu_ids: [...], flux_ids: [...]}` |
| `format` | enum | NOT NULL | `csv` \| `zip` \| `pdf` — **corrigé 2026-06-07 (F1 session test-scenarios §06.03)** : ex `excel \| pdf` incohérent avec les exports V1 réels (CSV registre + ZIP bordereaux). `pdf` = aucun écrivain V1, réservé à l'export registre PDF V1.1 (sobriété §06.03 A1). `nb_lignes` = nb lignes CSV ou nb fichiers ZIP. |
| `nb_lignes` | integer | | |
| `genere_at` | timestamptz | NOT NULL | |

**RLS (audit RLS V1 2026-06-05)** : trace d'audit — chaque user voit **ses propres** exports (`user_id = auth.uid()`) + admin/ops voient tout ; INSERT contraint `user_id = auth.uid()` ET `organisation_id = son orga`. Cf. [[09 - Authentification et permissions#A10 — `exports_registre` + `documents_generaux_savr`]].

> **Note M4.2 (alignement DB→CDC 2026-06-19, divergence M4.2/D2)** : la migration bloc6 (`20260611171640`) avait créé la table avec les noms `created_by`/`nb_collectes`/`created_at` et sans `type_export`/`format`/`filtres_appliques`. La migration M4.2 (`20260619120000`) a aligné la table sur ce CDC : RENAME `created_by→user_id`, `nb_collectes→nb_lignes`, `created_at→genere_at`, ajout `type_export`/`format`/`filtres_appliques` + enums correspondants, recréation des policies. La table n'avait aucun consommateur V1 avant M4.2 — rename non destructif. **Décision Val 2026-06-19** : colonne `fichier_id uuid → shared.fichiers` (héritée bloc6, jamais écrite, absente cible V2) → **DROP COLUMN**. Artefact de migration sans consommateur, table vide avant M4.2 — inutile de l'ajouter à G1. Migration : `ALTER TABLE plateforme.exports_registre DROP COLUMN IF EXISTS fichier_id;` à inclure dans la prochaine migration courte post-M4.2.

---

### Vue SQL : `v_registre_dechets`

Vue agrégée non matérialisée servant le registre chronologique côté espace client. Pas de table physique — construite à la volée depuis `collectes`, `collecte_flux`, `evenements`, `lieux`, `flux_dechets`, `prestataires_logistiques`, `bordereaux_savr`. RLS appliquée par `organisation_id` (via jointure avec `evenements.organisation_id` + `organisations_lieux` pour les gestionnaires de lieux). **Exclusion agence (tranché Val 2026-06-07, F6 session test-scenarios §06.11)** : la vue intègre le prédicat `auth.jwt()->>'role' <> 'agence'` — l'agence (donneuse d'ordre, non productrice) ne voit **aucune** ligne du registre, y compris sur ses propres collectes (§06.11 diff #5 ; sans ce prédicat, le scope par `organisation_id` lui aurait exposé ses lignes). pgTAP P1 : `registre_agence_denied`.

**Périmètre V1 (tranché 2026-06-07, F2 session test-scenarios §06.03)** : `collectes.statut = 'cloturee'` ET `collectes.type = 'zero_dechet'` **uniquement**. Les collectes `realisee` (fenêtre pré-clôture) et tout le volet AG sont exclus du registre V1 — la jointure `attestations_don` et ses colonnes sont retirées de la vue (réintégrées V2 avec le périmètre AG, cf. §06.03 Reporté V2). Le filtre UI « Statut bordereau dispo/manquant » couvre : `cloturee` sans bordereau (fenêtre clôture → batch J+1 6h) + bordereaux `brouillon` (fiche shadow sans SIRET).

**Colonne traiteur (tranché 2026-06-07, F4 — colonne régularisée 2026-06-11)** : `traiteur_raison_sociale` = **traiteur opérationnel** (`evenements.traiteur_operationnel_organisation_id` → `COALESCE(organisations.raison_sociale, organisations.nom)` — la colonne `organisations.raison_sociale` est créée par l'audit data model 2026-06-11, fallback `nom` si NULL), pas le programmateur — cohérent avec le snapshot producteur du bordereau (producteur juridique du déchet, R541-43). Fiches shadow incluses (raison sociale sans SIRET).

Colonnes exposées : date_collecte, evenement_nom, lieu_nom, flux, poids_kg, filiere, traiteur_raison_sociale, transporteur, exutoire, bordereau_numero, bordereau_statut, bordereau_pdf_url, historique_partiel. (V2).

**Mode de sécurité (précisé 2026-06-11, audit RLS B-6 — non spécifié jusqu'ici)** : vue **SECURITY DEFINER** (owner privilégié), comme `v_referentiel_traiteurs`. `security_invoker` est **impossible** ici : la vue joint `shared.prestataires` (SELECT admin/ops seul) et `organisations` (SELECT self) — la RLS sous-jacente viderait les colonnes `transporteur`/`traiteur_raison_sociale` pour les rôles clients. Le cloisonnement est donc porté **intégralement par les prédicats internes de la vue** : scope `evenements.organisation_id = auth.jwt()->>'organisation_id'` OU `lieu_id IN (organisations_lieux du user)` + exclusion `rôle <> 'agence'` + staff full. GRANT SELECT aux rôles authentifiés. pgTAP : `registre_cross_org_denied` (org B → 0 ligne) en plus de `registre_agence_denied`.

---

### Vue SQL : `v_referentiel_traiteurs` *(ajout 2026-06-07 — F5 session test-scenarios §06.11, tranché Val)*

Vue whitelist servant la lecture du référentiel traiteurs par les rôles programmateurs non-traiteur (`agence`, `gestionnaire_lieux`) : combobox « Traiteur opérant » (§06.01 Cas Agence / Cas Gestionnaire de lieux) + résolution du nom sur la ligne « Traiteur opérationnel » de la fiche collecte (§06.11 diff #3). Nécessaire car la matrice RLS `organisations` (§09) limite le SELECT de ces rôles à `id = self` (+ fiches shadow créées, pour l'agence) — sans cette vue, la combobox et l'affichage du nom sont morts au niveau RLS.

- **Colonnes exposées** : `id`, `nom`, `raison_sociale` (= `COALESCE(organisations.raison_sociale, organisations.nom)` — colonne créée par l'audit data model 2026-06-11) — rien d'autre (pas de `siret`, `logo_url` ni colonnes internes).
- **Périmètre** : `type = 'traiteur' AND est_shadow = false`. Les fiches shadow de l'agence restent lues en direct via la policy `organisations` dédiée (créatrice seule).
- **Implémentation** : vue **SECURITY DEFINER** (owner privilégié, pas de `security_invoker`) + GRANT SELECT aux rôles clients programmateurs. Le SELECT direct sur `plateforme.organisations` reste inchangé (aucun élargissement).
- **pgTAP** : `referentiel_traiteurs_whitelist_ok` (colonnes + périmètre, shadows exclus) / le SELECT direct cross-org reste deny (couvert lot ⑪).

---

### Fonction SQL : `f_benchmark_kg_pax_zd` *(ajout 2026-05-02 — refonte 2026-05-03 : 5 dimensions filtrables — extension 2026-05-04 : ouverture rôles traiteur sans filtre `traiteur_ids[]` — refonte sobriété 2026-05-30 : unification, l'ancien nom de vue `v_benchmark_kg_pax_zd` est retiré, l'objet canonique est la fonction `SECURITY DEFINER`)*

Fonction agrégée (adossée à la table base matérialisée `mv_benchmark_kg_pax_zd_base`) alimentant les jauges Bloc 3 ZD du Dashboard gestionnaire de lieux ([[06 - Fonctionnalités détaillées/05 - Espace client gestionnaire de lieux#Bloc 3 ZD — Jauges kg/pax par flux × benchmark parc]]) **et du Dashboard traiteur** ([[06 - Fonctionnalités détaillées/04 - Espace client traiteur#Bloc 3 ZD — Jauges kg/pax par flux × benchmark parc]] — extension 2026-05-04, 4 dimensions filtrables côté traiteur car `traiteur_ids[]` est interdit).

**Source** : `collectes` JOIN `collecte_flux` JOIN `evenements` JOIN `flux_dechets` JOIN `types_evenements`, **toutes organisations confondues** (parc Savr complet — c'est le sens du benchmark). Période par défaut UI = 12 mois glissants ; périodicité paramétrable via la barre filtre benchmark dédiée du Bloc 3 ZD.

**Colonnes exposées** :
| Colonne | Type | Description |
|---|---|---|
| `flux_id` | uuid | FK `flux_dechets` |
| `flux_code` | text | Snapshot du code (5 valeurs ZD) |
| `type_evenement_id` | uuid | FK `types_evenements` |
| `taille_evenement` | text | Bracket calculé via `taille_evenement_bracket(evenements.pax)` (XS/S/M/L/XL) |
| `kg_par_pax_moyen` | decimal(8,4) | `SUM(collecte_flux.poids_reel_kg) / SUM(evenements.pax)` sur le segment |
| `nb_collectes_segment` | integer | Compteur pour k-anonymat |
| `nb_organisations_distinctes` | integer | Pour audit (vérifier qu'on n'a pas un seul gestionnaire qui poids tout) |

**Paramètres de filtrage dynamique** *(refonte 2026-05-03 — option D Val, barre filtre benchmark dédiée 5 dimensions)* :

Implémentation : **fonction PostgreSQL** `f_benchmark_kg_pax_zd(p_flux_id, p_type_evenement_ids[], p_taille_evenement_codes[], p_periode_debut, p_periode_fin, p_lieu_ids[], p_traiteur_ids[]) RETURNS TABLE (...)` (pas une vue figée, qui ne peut pas prendre de paramètres dynamiques). Tous les paramètres sont facultatifs (NULL = pas de filtre sur la dimension).

| Paramètre | Type | Effet |
|---|---|---|
| `p_flux_id` | uuid | Filtre sur `flux_id` (1 jauge par flux côté front, 5 appels en parallèle) |
| `p_type_evenement_ids` | uuid[] | Multi-select sur `evenements.type_evenement_id` |
| `p_taille_evenement_codes` | text[] | Multi-select sur le bracket (`XS`/`S`/`M`/`L`/`XL`) |
| `p_periode_debut` / `p_periode_fin` | date | Filtre sur `collectes.date_collecte` (corrigé 2026-05-25 — ex-réf fantôme `collectes.date_debut`) |
| `p_lieu_ids` | uuid[] | Filtre sur `evenements.lieu_id` (sur l'ensemble du parc Savr, pas seulement les lieux du gestionnaire) |
| `p_traiteur_ids` | uuid[] | Filtre sur `evenements.organisation_id` (organisation de type `traiteur`) |

**RLS / k-anonymat** : la fonction applique systématiquement `nb_collectes_segment >= 5` côté serveur dans son `WHERE` final. Tout segment avec moins de 5 collectes est exclu de la réponse — pas d'option pour le contourner côté front. Aucune donnée individuelle de gestionnaire n'est exposée. Plus le gestionnaire restreint les filtres benchmark, plus le risque de masquage augmente — c'est le compromis assumé de l'option D.

**Risque "comparaison à soi-même"** : si le gestionnaire applique `p_lieu_ids` ou `p_traiteur_ids` sur ses propres lieux/traiteurs, la moyenne benchmark est mécaniquement identique au ratio gestionnaire. Le front affiche un avertissement UX (tooltip "Vous comparez vos données à vos propres données"), pas de blocage SQL.

**Permissions** *(extension 2026-05-04)* : EXECUTE ouvert aux rôles `gestionnaire_lieux`, `traiteur_manager`, `traiteur_commercial` sur `f_benchmark_kg_pax_zd`. La fonction est `SECURITY DEFINER` pour permettre l'agrégation cross-organisations sans exposer les tables sources. Pas de SELECT brut sur les tables sources pour ces rôles (RLS standard appliquée).

**Garde côté serveur — variante traiteur** : si `current_setting('request.jwt.claim.role')` ∈ {`traiteur_manager`, `traiteur_commercial`} ET `p_traiteur_ids` IS NOT NULL ET non vide → `RAISE EXCEPTION 'Filter traiteur_ids[] forbidden for traiteur role'`. Implémentation au début de la fonction (fail fast). Le front traiteur n'envoie pas ce paramètre, mais la garde serveur protège contre toute manipulation.

**Performance** : à matérialiser via une table intermédiaire `mv_benchmark_kg_pax_zd_base` rafraîchie quotidiennement (5 dimensions = `flux_id × type_evenement_id × taille_evenement × jour × lieu_id × traiteur_id` — cardinalité maîtrisable à volume V1). La fonction `f_benchmark_kg_pax_zd` interroge cette table matérialisée (≤ 200 ms attendus). Si le coût stockage dérive en V2, basculer en agrégation à la volée avec index ciblés (cf. [[14 - Scalabilité et évolutivité]]).

#### Grain `single_collecte` — fonction dédiée `f_benchmark_single_collecte` (refonte 2026-05-05 — aligné as-built 2026-07-06, divergence M3.2)

Pour alimenter le Bloc 3 ZD jauges sur la fiche collecte traiteur §06.04, le grain `single_collecte` est servi par une **fonction dédiée** `plateforme.f_benchmark_single_collecte(p_collecte_id uuid)` — **pas** par une extension de signature de `f_benchmark_kg_pax_zd`. La fonction dédiée réutilise `f_benchmark_kg_pax_zd`, filtrée sur le `(type_evenement × taille_evenement)` du segment de la collecte, pour établir le point de comparaison (benchmark parc).

**Signature** :
```sql
f_benchmark_single_collecte(
  p_collecte_id uuid
) RETURNS TABLE (
  flux_code text,              -- flux ZD de la collecte
  taille_evenement text,       -- segment (taille) de l'événement de la collecte
  ratio_user numeric,          -- ratio kg/pax de cette collecte (poids_kg_flux / pax_evenement)
  benchmark_kg_pax numeric,    -- moyenne pondérée du parc sur le segment (type × taille), via f_benchmark_kg_pax_zd
  nb_collectes_segment integer -- effectif du segment de comparaison
);
```

**Comportement** :
- `ratio_user` = `(poids_kg_flux_de_cette_collecte / pax_evenement)`, calculé depuis `collecte_flux` + `evenements` jointe via `collectes`. RLS standard appliquée (le demandeur doit avoir accès à la collecte).
- `benchmark_kg_pax` = moyenne pondérée du parc (refonte 2026-05-30, `kg_par_pax_moyen`) obtenue en appelant `f_benchmark_kg_pax_zd` avec les `p_type_evenement_ids` + `p_taille_evenement_codes` du segment de la collecte.
- K-anonymat ≥5 appliqué sur `benchmark_kg_pax` uniquement (le `ratio_user` est par définition une donnée du demandeur, pas anonymisable).

**Garde** : si la collecte référencée n'est pas accessible via RLS au rôle courant → `RAISE EXCEPTION 'Collecte not accessible'` (fail fast).

> **Note as-built (divergence M3.2, 2026-07-06)** : la fonction est implémentée et **recâblée sur la nouvelle signature** de `f_benchmark_kg_pax_zd` (valeur servie = moyenne pondérée correcte), mais **actuellement inerte** (0 consommateur front — la fiche collecte §06.04 ne l'appelle pas encore). Les noms de colonnes de sortie ci-dessus sont la forme canonique cible ; l'as-built expose encore `bracket`/`valeur_kg_pax`/`median_kg_pax`, **à normaliser au câblage front §06.04**.

> ⚠ **NON CRÉÉ V1 (audit sobriété §04 2026-05-25, A1)** : les 6 tables ci-dessous (`briefs_evenement`, `referentiel_categories`, `referentiel_items`, `brief_items`, `impact_calculs`, `impact_synthese_evenement`) **ne sont pas créées en V1**. Anticipation retirée du schéma V1 : zéro interface/règle/API V1, et sous Supabase l'ajout en V2 est une migration triviale (l'argument « zéro migration V2 » n'achète rien et ajoute 6 tables + RLS à maintenir + un risque que le dev code dessus par erreur). La spec ci-dessous est **conservée comme référence V2** (Module 19).

Spec V2 — voir [[03 - Périmètre fonctionnel global]] Module 19.

**Pattern** : `brief → items extraits → mapping référentiel → calculs d'impact → synthèse événement`

### Table : `briefs_evenement`

Document brief importé par le traiteur pour un événement donné. 1 événement → N briefs (versions successives possibles).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `evenement_id` | uuid | FK → evenements, NOT NULL | |
| `fichier_url` | text | NOT NULL | Chemin Supabase Storage du document original |
| `fichier_nom` | text | NOT NULL | Nom original du fichier |
| `fichier_type` | enum | NOT NULL | `pdf` \| `xlsx` \| `docx` \| `image` \| `autre` |
| `version` | integer | NOT NULL, défaut 1 | Incrémenté si réimport |
| `statut_parsing` | enum | NOT NULL | `en_attente` \| `en_cours` \| `termine` \| `echec` \| `valide_admin` |
| `parsing_resultat` | jsonb | | Résultat brut du parsing IA (pour audit/debug) |
| `parsing_provider` | text | | Service IA utilisé (ex: `openai-gpt5`, `anthropic-claude`) |
| `parsing_cout` | decimal | | Coût d'appel IA en euros (pour suivi marge) |
| `uploaded_by` | uuid | FK → users, NOT NULL | |
| `uploaded_at` | timestamptz | NOT NULL | |

---

### Table : `referentiel_categories`

Catégories du référentiel d'impact. Extensible par Admin Savr.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `code` | text | NOT NULL, UNIQUE | ex: `alimentation`, `emballage`, `decor`, `mobilier`, `transport_convive`, `energie_lieu` |
| `libelle` | text | NOT NULL | |
| `ordre_affichage` | integer | NOT NULL, défaut 0 | |
| `actif` | boolean | NOT NULL, défaut `true` | |
| `created_at` | timestamptz | NOT NULL | |

**Valeurs initiales (seed V2)** :
- `alimentation` → "Alimentation" (menus servis)
- `emballage` → "Emballage" (vaisselle, contenants, verres)
- `decor` → "Décor et mobilier"
- `transport_convive` → "Transport des convives"
- `energie_lieu` → "Énergie du lieu"

---

### Table : `referentiel_items`

Référentiel propriétaire Savr des items avec leurs facteurs d'impact. Chantier de construction V2 (partenaire ou recrutement interne).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `categorie_id` | uuid | FK → referentiel_categories, NOT NULL | |
| `code` | text | NOT NULL, UNIQUE | ex: `menu_gastronomique_viande`, `emballage_pla_compostable`, `verre_consigne` |
| `libelle` | text | NOT NULL | |
| `description` | text | | |
| `unite_mesure` | enum | NOT NULL | `unite` \| `kg` \| `litre` \| `km` \| `kwh` \| `pax` |
| `facteur_co2_kg` | decimal | | kg CO2eq par unité de mesure |
| `facteur_eau_litre` | decimal | | Litres d'eau consommés par unité |
| `recyclabilite` | enum | | `recyclable` \| `compostable` \| `reutilisable` \| `non_recyclable` |
| `source` | text | | ex: `ADEME Base Carbone v23`, `Greenly 2026`, `Estimation Savr` |
| `date_validite_debut` | date | NOT NULL | Permet le versioning des facteurs |
| `date_validite_fin` | date | | null = actif |
| `actif` | boolean | NOT NULL, défaut `true` | |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Note** : le versioning des facteurs (`date_validite_debut` / `date_validite_fin`) permet de ne pas recalculer rétroactivement les impacts déjà calculés quand un facteur change.

---

### Table : `brief_items`

Items extraits d'un brief par le parsing IA, mappés vers le référentiel.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `brief_id` | uuid | FK → briefs_evenement, NOT NULL | |
| `referentiel_item_id` | uuid | FK → referentiel_items | null si mapping non trouvé (à valider par Admin) |
| `texte_brut` | text | NOT NULL | Texte extrait du brief (ex: "200 assiettes en amidon de maïs") |
| `quantite` | decimal | NOT NULL | ex: 200 |
| `unite_detectee` | text | | Unité détectée par le parsing (normalisée vers `referentiel_items.unite_mesure` si possible) |
| `confiance_mapping` | decimal | | Score 0-1 de confiance du mapping IA |
| `statut` | enum | NOT NULL | `auto_detecte` \| `valide_admin` \| `corrige_admin` \| `ignore` |
| `valide_par` | uuid | FK → users | |
| `valide_at` | timestamptz | | |
| `created_at` | timestamptz | NOT NULL | |

---

### Table : `impact_calculs`

Calcul d'impact item par item pour un événement donné. Source des agrégats.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `evenement_id` | uuid | FK → evenements, NOT NULL | |
| `brief_item_id` | uuid | FK → brief_items, NOT NULL | |
| `referentiel_item_id` | uuid | FK → referentiel_items, NOT NULL | Facteur utilisé (figé au moment du calcul) |
| `quantite_appliquee` | decimal | NOT NULL | |
| `co2_kg` | decimal | | `quantite × facteur_co2_kg` |
| `eau_litre` | decimal | | `quantite × facteur_eau_litre` |
| `genere_at` | timestamptz | NOT NULL | |

**Note** : les facteurs sont figés au moment du calcul (pattern comparable à `tarif_applique_id` sur factures_collectes). Si le référentiel évolue, l'impact déjà calculé reste cohérent avec les facteurs de l'époque.

---

### Table : `impact_synthese_evenement`

Agrégat d'impact au niveau événement (une ligne par événement, régénérée à chaque recalcul).

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `evenement_id` | uuid | FK → evenements, NOT NULL, UNIQUE | |
| `version` | integer | NOT NULL, défaut 1 | Incrémenté à chaque recalcul |
| `co2_total_kg` | decimal | | Somme de `impact_calculs.co2_kg` |
| `co2_par_categorie` | jsonb | | `{ "alimentation": 45.2, "emballage": 12.8, "transport_convive": 120.5 }` |
| `eau_total_litre` | decimal | | |
| `dechets_detournes_kg` | decimal | | Depuis `collecte_flux` (ZD + AG agrégés) |
| `nb_items_analyses` | integer | | |
| `nb_items_non_mappes` | integer | | Items du brief sans correspondance référentiel |
| `calcule_at` | timestamptz | NOT NULL | |

**Note** : cet agrégat alimente un nouveau type de rapport RSE (`type_rapport = impact_complet` à ajouter sur `rapports_rse` en V2) et les benchmarks sectoriels enrichis (Module 12).

---

### Évolutions V1 sur tables existantes (Module 19) → Non créées V1 *(audit sobriété §04 2026-05-25, A1)*

> ⚠ **Non créées V1 (A1 2026-05-25)** : les 3 champs anticipés sont retirés du schéma V1 et seront ajoutés en V2 (Module 19) par migration. Spec conservée pour V2 :

**Sur `evenements`** (V2) :
- enum : `non_demande` (défaut) | `demande` | `importe` | `parse` | `rapport_genere`
- uuid FK vers une future table `templates_brief`

**Sur `rapports_rse`** (V2) :
- enum : `dechets_seulement` | `impact_complet`

---

## Niveau 7 — Intégrations et synchronisation

Tables techniques support des intégrations externes (TMS Savr, Pennylane, Resend). Contrat API bidirectionnel détaillé dans [[08 - APIs et intégrations]] (côté Plateforme) et [[02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS]] (source de vérité).

### Table : `integrations_logs`

Journal de toutes les requêtes HTTP entrantes et sortantes avec les systèmes externes. Rétention 2 ans (alignement audit RGPD).

> ⚠ **V1 diverge structurellement du DDL cible (Bloc 7, divergence assumée — A6, 2026-06-24)** : la migration V1 live (`20260611171641_plateforme_bloc7_integrations.sql`) s'écarte de cette spec/cible — `integration` (text) au lieu de `event_id` (uuid), `system` text au lieu d'enum, renames (`statut_http`→`response_status`, `duree_ms`→`latence_ms`), colonnes absentes (`tentative_numero`, `erreur_code`), ad-hoc en trop (`methode`, `payload_in/out`, `correlation_id`), **PK partitionnée `(id, created_at)` vs PK cible `(id)`**. Convergence reportée **V2** (2-step + suppression de partition). Cf. `_Divergences/BLOC7_20260624.md`.

| Colonne | Type | Contraintes | Notes |
|---------|------|-------------|-------|
| `id` | uuid | PK | |
| `event_id` | uuid | INDEX | Référence au payload (même UUID que le header `Idempotency-Key` reçu ou émis) |
| `system` | enum | NOT NULL | `tms` \| `pennylane` \| `resend` \| `everest` \| `mts1` *(ajout revue sobriété §08 App 2026-05-31 D1 — en V1 la Plateforme appelle directement Everest §3 et MTS-1 §3bis ; ces appels doivent être traçables)* |
| `direction` | enum | NOT NULL | `entrant` \| `sortant` |
| `endpoint` | text | NOT NULL | Ex: `POST /webhooks/tms/collecte-terminee` |
| `request_headers` | jsonb | | Sans `Authorization` ni secret |
| `request_body` | jsonb | | Payload tronqué si photos (URLs signées seulement) |
| `response_status` | integer | | |
| `response_body` | jsonb | | |
| `latence_ms` | integer | | |
| `tentative_numero` | integer | NOT NULL, défaut 1 | 1 à 4 (tentative initiale + 3 retries) selon retry policy §08 §6 *(corrigé revue sobriété §08 App 2026-05-31 C1 — ex « 1 à 5 », résidu politique 5 paliers)* |
| `statut` | enum | NOT NULL | `succes` \| `echec_retryable` \| `echec_final` |
| `erreur_code` | text | | Si échec (ex: `invalid_payload`, `rate_limited`) |
| `created_at` | timestamptz | NOT NULL, défaut now() | |

**Index** : `(system, direction, created_at DESC)` pour le dashboard admin, `(event_id)` pour la trace end-to-end d'un event, `(statut) WHERE statut = 'echec_final'` pour le bouton "Rejouer".

### Table : `integrations_inbox`

Dédup des events reçus côté Plateforme pour garantir l'idempotence. Fenêtre courte (**7 jours**) suffisante pour couvrir les **3 retries** *(simplifié revue sobriété §08 Bloc B 2026-05-01 B1 — ex-5 retries)*. Aligné avec `tms.integrations_inbox` côté TMS (Bloc B B5).

> ⚠ **V1 diverge structurellement du DDL cible (Bloc 7, divergence assumée — A6, 2026-06-24)** : la migration V1 live porte **PK `id` (uuid)** au lieu de `event_id`, `event_type` au lieu de `type`, `source` text au lieu d'enum, colonnes absentes (`occurred_at`, `recu_le`), `traite`(bool)+`traite_at` au lieu de `statut`(enum)+`traite_le`, en trop (`event_id_externe`, `payload`, `erreur`). ⚠ Conséquence fonctionnelle : sans `occurred_at`, le rejet **out-of-order** entrant est impossible en V1. Convergence reportée **V2** (changement de PK = backfill `event_id`). Cf. `_Divergences/BLOC7_20260624.md`.

| Colonne | Type | Contraintes | Notes |
|---------|------|-------------|-------|
| `event_id` | uuid | PK | Unicité globale, rejet direct si déjà présent |
| `type` | text | NOT NULL | Ex: `tms.collecte.terminee`, `tms.incident` |
| `source` | enum | NOT NULL | `tms` \| `mts1` *(ajout revue sobriété §08 App 2026-05-31 D2 — en V1 les webhooks entrants MTS-1 §3bis.7 sont dédupliqués via cette table, clé `source='mts1'`)*. `everest` non requis V1 (pas de webhook async Everest entrant retenu V1). |
| `occurred_at` | timestamptz | NOT NULL | Horodatage métier émetteur, utilisé pour détecter out-of-order |
| `recu_le` | timestamptz | NOT NULL, défaut now() | |
| `traite_le` | timestamptz | | Null si traitement en cours |
| `statut` | enum | NOT NULL | **3 valeurs** (post-revue sobriété §08 Bloc D 2026-05-01 D6) : `traite` \| `ignore_doublon` \| `ignore_out_of_order`. supprimé (insertion BDD APRÈS traitement réussi seulement, donc valeur jamais atteinte en pratique). Dédup garantie par PK `event_id`. |

**Purge automatique** : job quotidien qui supprime les lignes de plus de 7 jours (index sur `recu_le`).

**Règle d'insertion** : avant tout traitement d'un event entrant, tenter `INSERT ... ON CONFLICT DO NOTHING`. Si insertion = 0 lignes → event déjà traité → ignorer.

**Cas MTS-1 (polling — tranchée F1 2026-06-07)** : MTS-1 ne pousse pas de webhook ; la Plateforme poll GET `/v3/customerOrders` toutes les 15-30 min. `occurred_at` n'est pas fourni par MTS-1 (ce serait `now()` au moment du poll, donc différent à chaque passage même pour le même état). La clé de dédup MTS-1 est donc **`(source='mts1', customerOrderId, customerOrderStatus)`** — `occurred_at` retiré de la clé. `event_id` est synthétique et **déterministe**, calculé par la Plateforme : `md5(source || ':' || customerOrderId || ':' || customerOrderStatus)::uuid` *(corrigé 2026-06-11, audit data model — l'ancienne formulation « `gen_random_uuid()` basé sur md5 » était auto-contradictoire : `gen_random_uuid()` est aléatoire ; implémenté tel quel, l'`event_id` aurait changé à chaque poll et le `ON CONFLICT DO NOTHING` n'aurait jamais dédupliqué → retraitement infini toutes les 15 min)*. Même état MTS-1 = même UUID = jamais traité deux fois. `occurred_at` (NOT NULL) est renseigné avec `now()` du poll — il ne participe **pas** à la clé de dédup et ne sert pas au out-of-order MTS-1 (la progression de statut est gérée par la machine à états `statut_tms`).

**Dédoublonnement out-of-order** : lors d'un event reçu, comparer son `occurred_at` au dernier `occurred_at` traité pour la même entité métier (collecte, tournée, etc.). Si plus ancien → passer `statut = ignore_out_of_order` et ne pas modifier l'état.

**RLS** : table système écrite en `SERVICE_ROLE` (réception webhooks/events). Aucun rôle applicatif n'y accède en écriture ; lecture `admin_savr`/`ops_savr` seulement. Cf. [[09 - Authentification et permissions#A3 — `integrations_inbox`]].

---

### Table : `outbox_events` *(nouvelle V1 — garde-fou 4 TMS-Ready, ajout 2026-06-05)*

Pattern **transactional outbox** : tous les events métier sortants que le TMS V2 consommera (Plateforme → TMS) sont persistés ici **dans la même transaction** que la mutation métier (zéro perte). En V1, l'adapter MTS-1 lit ce stream et POST vers MTS-1 V3 ; en V2, l'adapter TMS natif lira le **même** stream (swap d'adapter, garde-fou 3). Table absente de l'archive V1+V2 → **ajout neutre forward-compatible** (garde-fou 1 : omission/ajout neutre, jamais divergence).

> ⚠ **V1 diverge structurellement du DDL cible (Bloc 7, divergence assumée — A6, 2026-06-24)** : la migration V1 live porte `statut` (enum, valeur `done`) au lieu de `status` (text, sans `done`), rename `processed_at`→`consumed_at`, colonnes absentes (`dead_at` — horodatage DLQ surchargé sur `processed_at` —, `next_retry_at`), en trop (`aggregate_type`). *(Les colonnes `txid`/`claimed_until`/`requires_reconciliation` sont conformes — ajoutées au DDL cible le 2026-06-11.)* Convergence reportée **V2**. Cf. `_Divergences/BLOC7_20260624.md`.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `seq` | bigserial | NOT NULL, UNIQUE | **Ordre de consommation (ajout 2026-06-08, revue frère).** Séquence monotone = ordering déterministe. **Ne JAMAIS ordonner par `created_at`** (collisions possibles à la même milliseconde). |
| `event_type` | text | NOT NULL | Type d'event sortant : `collecte.creee` (E1) \| `collecte.modifiee` (E2) \| `collecte.annulee` (E3) \| `lieu.champ_critique_modifie` (E5) |
| `aggregate_id` | uuid | NOT NULL | ID de l'entité métier source (collecte, lieu) |
| `payload` | jsonb | NOT NULL | Payload de l'event (schéma = contrat §08 cible V2, validé en isolation) |
| `created_at` | timestamptz | NOT NULL, défaut now() | |
| `consumed_at` | timestamptz | NULL en V1 | Horodatage de consommation par l'adapter. NULL = en attente |
| `consumer` | text | | Identifiant du consommateur (`adapter_mts1` en V1, `adapter_tms_natif` en V2) |
| `attempts` | int | NOT NULL, défaut 0 | **(ajout 2026-06-08)** Nombre de tentatives de push effectuées. |
| `status` | text | NOT NULL, défaut `'pending'` | **(ajout 2026-06-08)** `pending` \| `failed` (échec transitoire, à retenter) \| `dead` (DLQ, abandonné après N tentatives). |
| `next_retry_at` | timestamptz | NULL | **(ajout 2026-06-08)** Prochaine tentative autorisée (backoff exponentiel). Worker ignore les lignes `next_retry_at > now()`. |
| `last_error` | text | NULL | **(ajout 2026-06-08)** Dernier message d'erreur (debug DLQ). |
| `dead_at` | timestamptz | NULL | **(ajout 2026-06-08)** Horodatage de passage en DLQ → déclenche l'alerte. |
| `txid` | bigint | NOT NULL, défaut `txid_current()` | **(ajout 2026-06-11, revue adversariale concurrence R1)** Transaction d'émission. Garde de visibilité : le worker ne consomme que les lignes `txid < txid_snapshot_xmin(txid_current_snapshot())` — élimine le faux low-water-mark quand un `seq` inférieur est encore in-flight (transaction non commitée invisible au check head-of-line). |
| `claimed_until` | timestamptz | NULL | **(ajout 2026-06-11, R2/R3)** Bail (lease) du claim en cours. NULL = non claimé. `status='processing'` + `claimed_until < now()` = claim expiré (worker crashé) → reaper repasse `pending` + `requires_reconciliation=true`. |
| `requires_reconciliation` | boolean | NOT NULL, défaut `false` | **(ajout 2026-06-11, R3/R4)** `true` si l'event a été claimé puis perdu (crash/timeout ambigu) : **toute reprise DOIT exécuter la réconciliation MTS-1 (§08 §3bis.9) AVANT tout re-POST** — un crash entre le 201 MTS-1 et le commit local est indistinguable d'un timeout. |

**Index** : `(consumed_at) WHERE consumed_at IS NULL` (file des events à pousser), `(aggregate_id, seq)` (ordering + head-of-line par agrégat), `(status, claimed_until) WHERE status='processing'` (reaper).

> Valeur `status` ajoutée 2026-06-11 : `processing` (claim en cours, bail `claimed_until`) — enum complet : `pending` | `processing` | `failed` | `dead`.

**Mécanisme d'émission (précisé 2026-06-08, garde-fou 4 — décision Val) :** l'émission est **pilotée par l'action métier, pas par un trigger brut sur chaque `UPDATE`** (sinon chaque édition de champ repartirait au TMS, ce qui contredit `dirty_tms` et le KPI « Collectes modifiées sans renvoi TMS »). Modèle mixte :

- **E1 `collecte.creee` / E2 `collecte.modifiee` / E3 `collecte.annulee`** : émis par les **RPC métier** (soumission, renvoi/dispatch, annulation), implémentés en fonction Postgres `SECURITY DEFINER` qui, **dans une seule transaction**, met à jour `statut_tms` / `dirty_tms` ET insère la ligne `outbox_events` (transactional outbox respecté). C'est l'action dispatch qui décide la branche, cohérente avec [[08 - APIs et intégrations]] §10.1 (F3 : `non_envoye→E1` / `dirty→E2` / `rejetee→E1`). **Ordre interne IMPÉRATIF (ajout 2026-06-11, revue adversariale R1)** : la RPC acquiert le **row lock de l'agrégat AVANT** d'insérer la ligne outbox (l'UPDATE `collectes` — `statut_tms`/`dirty_tms` — précède l'INSERT `outbox_events` ; à défaut d'UPDATE, `SELECT … FOR UPDATE` explicite). Deux émissions concurrentes sur le même agrégat se sérialisent ainsi sur le row lock → **seq intra-agrégat = ordre de commit, par construction** (sans cette règle, un E3 commité avant un E2 in-flight de seq inférieur serait consommé hors ordre). La RPC lit aussi les champs du payload **après** acquisition du lock (anti-course avec le trigger `set_collectes_dirty_tms`, R11).
- **Édition brute d'un champ critique d'une collecte** : trigger `set_collectes_dirty_tms` positionne `dirty_tms = true`, **aucun event émis** tant que le renvoi explicite n'a pas lieu.
- **E5 `lieu.champ_critique_modifie`** : émis par **trigger** `AFTER UPDATE` sur `lieux` (adresse / coords) — il n'existe pas d'action « dispatch d'un lieu », le trigger est ici le bon outil.

Un worker (cron/Edge Function, `SERVICE_ROLE`) claim les lignes éligibles, POST vers MTS-1, puis renseigne `consumed_at`/`consumer`. **Test garde-fou 4** : `savr-platform/supabase/tests/outbox_par_mutation.test.sql` (1 event par mutation + atomicité rollback).

**Consommation — règles durcies (2026-06-08, revue frère, validées — REFONDUES 2026-06-11, revue adversariale concurrence R2/R3) :**

- **SUPPRIMÉ 2026-06-11 (R2, BLOQUANT)** : `pg_try_advisory_lock` est un lock **session** — sur PgBouncer **transaction mode** (§07 9.1.19, actif dès V1) + fonctions serverless, le lock reste attaché au backend rendu au pool (fuite → famine totale du worker, ou exclusion mutuelle fictive). Et un `FOR UPDATE` tenu à travers un appel HTTP MTS-1 est impossible en transaction pooling. **Remplacé par le pattern lease/claim** (aligné `jobs_pdf`) :
  - **Tx 1 — claim (courte, compatible pooler)** : `UPDATE outbox_events SET status='processing', claimed_until=now()+interval '2 min', attempts=attempts+1 WHERE id IN (SELECT id FROM outbox_events WHERE status IN ('pending','failed') AND (next_retry_at IS NULL OR next_retry_at<=now()) AND txid < txid_snapshot_xmin(txid_current_snapshot()) AND <head-of-line par agrégat> ORDER BY seq LIMIT k FOR UPDATE SKIP LOCKED) RETURNING *` — le `SKIP LOCKED` ne vit QUE dans cette transaction courte ; **`attempts` est incrémenté AVANT tout HTTP** (claim-before-POST : un crash laisse une trace, jamais de re-POST silencieux à attempts inchangé).
  - **HTTP hors transaction** : appels MTS-1 entre tx 1 et tx 2, aucune connexion/lock tenu.
  - **Tx 2 — résultat** : succès → `status` final + `consumed_at`/`consumer` ; échec typé → `failed` + `next_retry_at` (paliers ci-dessous) ; le `attempts` du claim compte la tentative.
  - **Reaper (même cron)** : `status='processing' AND claimed_until < now()` (worker crashé) → `status='pending'`, `requires_reconciliation=true`. La reprise d'un event `requires_reconciliation` exécute **obligatoirement** la réconciliation MTS-1 (§08 §3bis.9) avant tout re-POST.
  - **Anti-chevauchement** : il n'y a **plus de verrou global de run** — deux invocations concurrentes du worker sont inoffensives par construction (le claim atomique est l'exclusion mutuelle, à la ligne près).
- **Ordering** : consommation par `seq` croissant (jamais `created_at`).
- **Head-of-line blocking PAR AGRÉGAT** : tant qu'un event d'une collecte est `failed`/`dead` (non consommé), **bloquer tous les events suivants de CETTE collecte** (les autres collectes/lieux continuent). Empêche que MTS-1 reçoive une `collecte.modifiee` (E2) d'une collecte dont la `collecte.creee` (E1) n'est jamais arrivée. Concrètement : pour un `aggregate_id` donné, ne consommer la ligne `seq` N+1 que si toutes les lignes `seq ≤ N` du même agrégat sont `consumed`.
- **Retry** : **3 paliers 5 min / 1h / 24h** via `next_retry_at`, incrément `attempts` à chaque échec *(tranché Val 2026-06-10, challenge Frontière — remplace « backoff exponentiel » : politique unique alignée §08 §3bis.9 + contrat §08 V2 + retry Pennylane/PDF)*. Après le 3e échec → `status = 'dead'`.
- **DLQ** : après le 3e échec (4 tentatives au total) → `status = 'dead'` + `dead_at = now()` → **alerte Slack `#savr-alerts-critique`** (une ligne en DLQ = collecte non transmise au transporteur = camion absent ; cf. [[07 - Observabilité/03 - Alertes]]). Jamais d'échec silencieux.
- **Alerte anticipée collecte imminente (ajout 2026-06-10, challenge logistique+onboarding)** : si l'event concerne une collecte dont `date_collecte < now() + interval '24h'` **ET** `attempts ≥ 2` → **alerte Slack `#savr-alerts-critique` immédiate, sans attendre la DLQ**. Motif : avec les paliers 5 min / 1 h / 24 h, une panne MTS-1 de 2 h à J-0 laisse l'échec silencieux entre le palier 1 h et le palier 24 h alors que la collecte est le soir même (camion absent). Cf. [[07 - Observabilité/03 - Alertes]].
- **Déblocage DLQ V1 (ajout 2026-06-10, challenge Frontière — le head-of-line fait qu'un event `dead` bloque PERMANENTEMENT tous les events suivants de son agrégat ; ex. E1 dead → E3 annulation jamais poussée → camion envoyé sur collecte annulée)** : procédure admin (SQL `SERVICE_ROLE`, tracée `audit_log`), 3 issues exclusives : **(a) re-queue** — l'erreur amont est corrigée (donnée invalide, MTS-1 rétabli) → `status='pending'`, `next_retry_at=now()`, `attempts=0` (le `seq` original est conservé, l'ordre reste garanti) ; **(b) skip motivé** — l'event est devenu sans objet (ex. E2 d'une collecte depuis annulée) → `status='dead'` conservé + `consumed_at=now()`, `consumer='admin_skip'`, motif dans `last_error` (l'agrégat se débloque) ; **(c) résolution manuelle MTS-1** — l'action a été faite à la main côté MTS-1 (commande créée par Ops) → marquer `consumed` + renseigner `external_ref_commande` sur la tournée pour réaligner la corrélation. Cette procédure est à recopier dans `RUNBOOK_INCIDENT.md` du repo (section « DLQ outbox »). Le **replay outillé** (UI M13) reste V2.
- **Idempotence côté réception MTS-1 — TRANCHÉE (Val 2026-06-11, revue adversariale)** : `POST /v3/customerOrders` est **présumé NON idempotent** (la confirmation éditeur reste souhaitable mais le design n'en dépend plus). Conséquences obligatoires : (1) **commit par rang** — après chaque 201, la ligne `tournees` (`external_ref_commande`) est commitée immédiatement, avant le rang suivant, jamais « tout à la fin » ; (2) re-POST autorisé uniquement sur erreur typée `TRANSIENT` (5xx/réseau avec échec certain) ; (3) timeout ambigu OU reprise post-crash (`requires_reconciliation`) → **réconciliation §08 §3bis.9 AVANT tout re-POST** (scan `minDate/maxDate` + match `orderNumber=reference-{rang}` côté Savr — le plan B sans filtre `?orderNumber` est codé dès V1, Q3bis-5 non bloquante).
- **Sémantique no-op (ajout 2026-06-11, R8)** : E2/E3 consommés sur une collecte **sans aucune** `external_ref_commande` (E1 skippé en DLQ issue b, ou jamais parti) = **no-op succès** : `consumed_at=now()`, `consumer='noop_no_remote'`, log info. Jamais d'erreur ni de retry sur un agrégat sans existence distante.

**RLS** : écriture/lecture **`SERVICE_ROLE` uniquement** (trigger + worker). Aucun rôle applicatif ; `admin_savr` en lecture pour le debug. Cf. [[09 - Authentification et permissions#A2 — `outbox_events`]].

---

### Table : `jobs_pdf` *(intégrée §04 le 2026-06-10 — challenge Frontière G1 : file de génération PDF imposée par l'architecture (§07 Résilience Railway, CLAUDE.md) mais absente du data model et du DDL cible)*

File d'attente de génération PDF (bordereau ZD, rapport recyclage, attestation don AG). Un job = une demande de génération envoyée à Railway/Puppeteer. Retry **15 min pendant 4h** (politique §07 Résilience, distincte des 3 paliers outbox) ; échec final → notif Admin in-app.

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id` | uuid | PK | |
| `type_document` | enum | NOT NULL | `bordereau_zd` \| `rapport_recyclage` \| `attestation_don` |
| `entity_type` | text | NOT NULL | Table cible du document (`bordereaux_savr` \| `rapports_rse` \| `attestations_don`) |
| `entity_id` | uuid | NOT NULL | Ligne métier dont le PDF est généré |
| `payload` | jsonb | NOT NULL | Données figées passées au template (snapshot — le retry rejoue le même rendu) |
| `statut` | text | NOT NULL, défaut `'pending'` | `pending` \| `processing` \| `done` \| `failed` (transitoire, à retenter) \| `dead` (échec final 4h) |
| `attempts` | integer | NOT NULL, défaut 0 | |
| `next_retry_at` | timestamptz | NULL | Prochaine tentative (pas de 15 min) |
| `last_error` | text | NULL | |
| `fichier_id` | uuid | FK → shared.fichiers, NULL | Renseigné quand `statut = done` (PDF uploadé R2) |
| `created_at`, `updated_at` | timestamptz | NOT NULL | |

**Index** : `(statut, next_retry_at)` (file du worker). `UNIQUE (entity_type, entity_id, type_document) WHERE statut IN ('pending','processing')` — pas deux jobs actifs pour le même document (la régénération manuelle crée un nouveau job une fois l'ancien terminal).
**RLS** : `SERVICE_ROLE` uniquement (worker + batchs J+1) ; `admin_savr` SELECT (debug). Forward-compatible V2 (table technique Plateforme, ajout neutre garde-fou 1 — **ajoutée au DDL cible 2026-06-10**).

---

### Table : `email_templates` *(intégrée §04 le 2026-06-07 — F1 session test-scenarios §06.02 ; table déjà spécifiée §06.02, absente du data model)*

Templates emails transactionnels. Définition fonctionnelle complète : [[06 - Fonctionnalités détaillées/02 - Templates emails V1]] (19 templates actifs V1, seed DB).

| Colonne | Type | Contraintes | Notes |
|---------|------|-------------|-------|
| `id` | uuid | PK | |
| `slug` | text | UNIQUE, NOT NULL | Identifiant stable (ex: `collecte_programmee`) |
| `objet` | text | NOT NULL | Sujet email (avec variables `{{...}}`) |
| `corps_html` | text | NOT NULL | Corps HTML (avec variables) |
| `corps_text` | text | NOT NULL | Version texte fallback |
| `variables` | jsonb | NOT NULL | Liste des variables attendues (contrôle au rendu — variable requise manquante = refus d'envoi, F3) |
| `actif` | boolean | NOT NULL, défaut true | Template inactif = aucun envoi, skip tracé `integrations_logs` |
| `created_at`, `updated_at` | timestamptz | NOT NULL | |

**Édition V1** : seed DB + mise à jour SQL/migration uniquement (UI Admin reportée V1.1, sobriété A1 2026-06-03).
**RLS** : écriture `SERVICE_ROLE` uniquement (migrations/seed) ; `SELECT` `admin_savr` (debug back-office) ; deny tout autre rôle. Cf. [[09 - Authentification et permissions]] (bloc ajouté 2026-06-07).

### Table : `emails_envoyes` *(intégrée §04 le 2026-06-07 — F1, table déjà spécifiée §08 §4)*

Historique des envois Resend. Contient des PII (`destinataire_email`).

> ⚠ **V1 diverge structurellement du DDL cible (Bloc 7, divergence assumée — A6, 2026-06-24)** : la migration V1 live applique des renames (`template_code`→`template_slug`, `sujet`→`objet`, `envoye_at`→`delivered_at`), un **split** `destinataire` (text) → `destinataire_user_id` (uuid) + `destinataire_email` (text), des colonnes absentes (`variables_jsonb`, `tentative_numero`), en trop (`entity_type`, `entity_id`, `erreur`), et `resend_id` **sans contrainte UNIQUE**. *(La divergence d'enum `email_statut` est tracée séparément.)* Convergence reportée **V2**. Cf. `_Divergences/BLOC7_20260624.md`.

| Colonne | Type | Contraintes | Notes |
|---------|------|-------------|-------|
| `id` | uuid | PK | |
| `destinataire_user_id` | uuid | FK → users, NULL | NULL si destinataire externe (association, transporteur, alias Ops) |
| `destinataire_email` | text | NOT NULL | PII — accès admin_savr seul |
| `template_slug` | text | NOT NULL, INDEX | Réf. `email_templates.slug` (pas de FK dure : trace conservée si template supprimé) |
| `objet` | text | NOT NULL | Objet rendu (variables interpolées) |
| `variables_jsonb` | jsonb | NOT NULL | Payload d'interpolation au moment de l'envoi |
| `resend_id` | text | UNIQUE, NULL | ID Resend ; NULL si `statut = echec` avant acceptation Resend |
| `statut` | enum | NOT NULL | `envoye` \| `ouvert` \| `clique` \| `bounce` \| `echec` *(valeur `echec` ajoutée 2026-06-07, F3)*. `bounce` et `echec` terminaux (pas de régression via webhook tardif) |
| `tentative_numero` | integer | NOT NULL, défaut 1 | 1 à 4 (initiale + 3 retries 1min/10min/1h, F3) |
| `created_at` | timestamptz | NOT NULL, défaut now() | |
| `delivered_at` | timestamptz | NULL | Renseigné une seule fois (premier event delivered) |

**Index** : `(template_slug, created_at DESC)`, `(destinataire_user_id)`, `(resend_id)`.
**RLS** : écriture `SERVICE_ROLE` uniquement (Edge Function `send-email` + webhook `/webhooks/resend/events`) ; `SELECT` `admin_savr` ; deny tout autre rôle (PII). Cf. [[09 - Authentification et permissions]] (bloc ajouté 2026-06-07).

**⚠ Divergence V1 assumée (enum `statut`)** — en V1, la table `emails_envoyes` conserve l'axe **cycle d'envoi** (`queued/sent/delivered/bounced/failed`, DEFAULT `queued`), pas l'axe engagement listé ci-dessus. L'enum cible (`envoye/ouvert/clique/bounce/echec`) est livré en **V1.1**, en lockstep avec le tracking ouverture/clic (webhooks Resend `email.opened`/`email.clicked`, hors scope V1). Mapping de transition V1→V1.1 : `queued/sent/delivered → envoye`, `bounced → bounce`, `failed → echec`, puis `ouvert`/`clique` alimentés par les webhooks. Seule divergence enum cluster B assumée en V1 (Frontière G1, V1-only). Décision Val 2026-06-22.

---

### Table : `audit_log` *(intégrée §04 le 2026-06-07 — F1 session test-scenarios §06.06, tranché Val)*

Journal d'audit central de la Plateforme. Référencée ~40× dans les CDC (§05, §06.06, §09, §15) sans définition jusqu'ici — **bloquant levé**. Nom canonique : **`audit_log`** (singulier — le résidu `audit_logs` de §05 R_controle_acces_cascade est corrigé). Trace toutes les actions sensibles back-office (Admin/Ops), les triggers métier (cascade contrôle d'accès, recrédit pack, débit annulation tardive…) et les sessions d'impersonation.

**Cible d'audit = schéma de la table écrite, pas l'acteur** (tranché Val 2026-06-09) : le back-office App écrit **uniquement** dans `plateforme.audit_log`. `tms.audit_logs` est le journal logistique/cross-domaine (TMS V2 + migration + traces cross-domaine type exports Pennylane), **jamais écrit par le back-office App** *(`shared.audit_logs` n'existe pas — audit canonique 2026-06-11 = 2 journaux séparés `plateforme.audit_log` + `tms.audit_logs`)*. Une écriture TMS sur une table `plateforme.*` (ex. `lieux.acces_details`) s'audite dans `plateforme.audit_log` via le trigger plateforme — l'auteur réel est figé dans `role`/`user_id`. Besoin éventuel d'une timeline unifiée App+TMS = **vue lecture** `v_audit_global` (`UNION` des deux journaux + RLS), jamais un point d'écriture unique.

| Colonne | Type | Contraintes | Notes |
|---------|------|-------------|-------|
| `id` | uuid | PK, défaut `gen_random_uuid()` | |
| `user_id` | uuid | FK → users, NULL | Auteur de l'action. NULL si action 100 % système (batch, webhook) |
| `impersonator_id` | uuid | FK → users, NULL | Renseigné si l'action est faite en mode impersonation (§09 §7) — distinct de `user_id` (= utilisateur impersonné) |
| `role` | text | NULL | Snapshot du rôle au moment de l'action (`admin_savr`, `ops_savr`, `traiteur_manager`…) — figé, indépendant des changements de rôle ultérieurs |
| `action` | text | NOT NULL, INDEX | Identifiant snake_case de l'action (ex. `pack_recredite_annulation_collecte`, `controle_acces_cascade_upgrade`, `parametres_algo_update`, `pack_debite_annulation_tardive`) |
| `table_name` | text | NULL | Table principale concernée (ex. `collectes`, `packs_antgaspi`) |
| `record_id` | uuid | NULL, INDEX | Id de la ligne concernée (permet le Bloc 7 Historique fiche collecte : filtre `table_name='collectes' AND record_id=<id>`) |
| `old_values` | jsonb | NULL | Snapshot avant (champs modifiés uniquement) |
| `new_values` | jsonb | NULL | Snapshot après |
| `motif` | text | NULL | Motif saisi quand l'action l'exige (≥ 10 car. selon l'action — validation applicative, pas de CHECK générique) |
| `details` | jsonb | NULL | Contexte libre complémentaire (ex. `cascade_tms`, `priorite_urgence` pour les modifs collecte §05 §4) |
| `created_at` | timestamptz | NOT NULL, défaut now() | |

**Index** : `(table_name, record_id, created_at DESC)`, `(action)`, `(user_id)`.
**Écriture** : **jamais par l'API directement** — INSERT via triggers DB et code serveur (`SERVICE_ROLE` / fonctions `SECURITY DEFINER`). Aucun UPDATE/DELETE (append-only, immuable).
**RLS** : `SELECT` `admin_savr` + `ops_savr` ; deny tout autre rôle ; INSERT/UPDATE/DELETE deny pour tous les rôles applicatifs (cohérent matrice §09 « Audit log : écriture — (trigger DB) »).

### Table : `config_auto_accept_ag` *(nouvelle — F1 test-scenarios §06.09, tranché Val 2026-06-07)*

Configuration des règles d'auto-accept AG : pour certaines combinaisons `(association, type_evenement)` connues et fiables, l'attribution est validée automatiquement sans intervention humaine Admin. ~40 lignes max V1. Référencée par §06.09 §6.

| Colonne | Type | Contraintes | Notes |
|---------|------|-------------|-------|
| `id` | uuid | PK, défaut `gen_random_uuid()` | |
| `association_id` | uuid | NOT NULL, FK → associations(id) | Association bénéficiaire concernée |
| `type_evenement_id` | uuid | NOT NULL, FK → types_evenements(id) | Type d'événement concerné |
| `actif` | bool | NOT NULL, DEFAULT false | Toggle — si true et top1=cette association + type correspondant → auto-accept déclenché |
| `modifie_par` | uuid | FK → users, NULL | Admin qui a modifié le toggle en dernier (NULL = jamais modifié depuis le seed) |
| `modifie_le` | timestamptz | NOT NULL, DEFAULT now() | Horodatage dernière modification |
| UNIQUE | | `(association_id, type_evenement_id)` | Une seule règle par combinaison |

**Écriture** : `admin_savr` uniquement (UPDATE toggle). Seed initial : toutes les lignes à `actif=false`.
**RLS** : SELECT + ALL `admin_savr` uniquement (cf. §09 A9bis ci-dessous).
**Audit** : toute modification INSERT/UPDATE → `audit_log` (`action = 'config_auto_accept_update'`, `details = { association_id, type_evenement_id, actif_avant, actif_apres }`).

---

## Vue d'ensemble des relations

```
organisations
  ├── entites_facturation (1-N)
  ├── users (1-N)
  ├── evenements (1-N, via organisation_id)
  ├── packs_antgaspi (1-N)
  ├── factures (1-N)
  └── organisations_lieux (N-N avec lieux)

entites_facturation
  ├── evenements (1-N, via entite_facturation_id)
  └── factures (1-N, via entite_facturation_id)

factures
  └── factures (1-N self-ref, via facture_origine_id pour les avoirs)

types_evenements → evenements (1-N)
shared.prestataires                     # noms corrigés 2026-06-11 (ex-prestataires_logistiques migrée 2026-04-23 ; ex-courses_logistiques = vue V2 non créée V1)
  ├── collectes (1-N, via prestataire_logistique_id)
  ├── tournees (1-N)
  └── v_courses_logistiques (lecture, V2 — non créée V1)

lieux
  ├── evenements (1-N)
  └── organisations_lieux (N-N avec organisations)

evenements
  ├── collectes (1-N)
  ├── rapports_rse (1-N)
  └── client_organisateur_organisation_id (N-1 vers organisations si client_organisateur a compte)

tournees
  ├── collectes (N-N via collecte_tournees)
  └── prestataires_logistiques (N-1)

collecte_tournees                       # liaison N-N (refonte multi-camions 2026-05-25)
  ├── collectes (N-1)
  └── tournees (N-1)

contacts_traiteurs
  └── organisations (N-1)

tarifs_negocie
  ├── organisations (N-1, organisation_id — scope=organisation)
  ├── organisations (N-1, gestionnaire_organisation_id — scope=gestionnaire)
  └── lieux (N-1, nullable)

collectes
  ├── collecte_flux (1-N, si type=zero_dechet)
  ├── attributions_antgaspi (1-1, si type=anti_gaspi)
  ├── v_courses_logistiques (via tournees, lecture coût/marge)
  ├── factures_collectes (N-N avec factures)
  ├── rapports_rse (1-N)
  └── tournees (N-N via collecte_tournees)   # refonte multi-camions 2026-05-25 (ex tournee_id N-1 nullable retiré)

packs_antgaspi
  ├── factures (1-1 si mode=globale_achat, via facture_achat_id)
  └── factures (1-N si mode=par_collecte, via factures.pack_antgaspi_id)

# Traçabilité réglementaire (Module 20 MVP)
collectes
  ├── bordereaux_savr (1-1 si type=zero_dechet)
  └── attestations_don (1-1 si type=anti_gaspi, realisee avec repas donnés — habilitée ou non, le PDF adapte la mention fiscale ; corrigé 2026-06-11, ex-mention « si assoc habilitée » contredisait la règle d'émission)

associations → attestations_don (1-N)
entites_facturation → bordereaux_savr (1-N, producteur)
entites_facturation → attestations_don (1-N, donateur)

users → exports_registre (1-N)
organisations → exports_registre (1-N)

# Anticipation V2 (Module 19 — Import brief + Impact enrichi)
evenements
  ├── briefs_evenement (1-N)
  ├── impact_calculs (1-N, via evenement_id)
  └── impact_synthese_evenement (1-1)

briefs_evenement
  └── brief_items (1-N)

referentiel_categories
  └── referentiel_items (1-N)

referentiel_items
  ├── brief_items (1-N, via referentiel_item_id)
  └── impact_calculs (1-N, facteur figé)

brief_items
  └── impact_calculs (1-N)
```

---

## Décisions prises

- **1 événement → N collectes** : un même événement peut avoir simultanément une collecte ZD et une collecte AG. **Révisé 2026-05-25 (Sujet 1, option A)** : le multi-camions n'est plus modélisé comme N collectes ZD — il est interne au TMS (1 collecte ZD → N tournées prestataire). En usage normal, 1 collecte ZD par événement (un 2ᵉ exemplaire du même type reste techniquement possible pour des cas distincts type passage mi-événement/fin d'événement, sans contrainte d'unicité)
- **Rattachement explicite collecte→événement (2026-05-21, D1)** : via `collectes.evenement_id`. Suppression du rattachement par matching textuel date+lieu+client (source de doublons d'événements). Le formulaire unique §06.01 crée l'événement puis ses collectes ; l'ajout ultérieur passe par l'`evenement_id` existant.
- **`date_collecte` champ primaire, `date_evenement` auto-dérivé (refonte 2026-05-29)** : `collectes.date_collecte` = date d'intervention logistique saisie obligatoirement par collecte au formulaire §06.01 étape 3 (sans défaut). `evenements.date_evenement` = calculé automatiquement = `MIN(collectes.date_collecte)` via trigger `fn_set_date_evenement` — jamais saisi, référence des rapports PDF. Extensible V2 (règle de dérivation affinable). **Retiré V1 (2026-05-29)** : pax unique au niveau événement (`evenements.pax`), non modifiable par collecte ; multi-jours à pax variable reporté V2.
- **Contrôle d'accès saisi niveau événement, copié sur collectes (2026-05-21)** : `controle_acces_requis` saisi une fois (la contrainte vient du site), copié sur chaque `collectes` à l'INSERT. Colonne conservée sur `collectes` (override per-collecte possible).
- **Tarifs ZD versionnés** : les tarifs ne sont jamais modifiés rétroactivement — chaque collecte fige le tarif appliqué
- **`organisations` générique** : traiteurs, agences et gestionnaires de lieux partagent la même table avec un champ `type`
- **Séparation `evenements` / `collectes`** : infos événement (lieu, pax, traiteur) sur `evenements`, infos opérationnelles (prestataire, statut, pesées) sur `collectes`
- **Référentiel lieux partagé avec TMS** : les données du lieu sont poussées vers le TMS Savr à chaque envoi de collecte — le TMS ne stocke pas le référentiel en propre
- **Types d'événement en table extensible** : `types_evenements` (FK depuis `evenements`) plutôt qu'un enum figé — permet d'ajouter/modifier sans migration ni UI dédiée. Seed (4 formats de service, refonte Sujet 4 2026-05-26) : `Cocktail apéritif`, `Cocktail repas complet`, `Repas assis`, `Autre`. Le type = format de service uniquement ; la taille se dérive du `pax` via `taille_evenement_bracket()`.
- **Pax obligatoire à la programmation** : le traiteur le fournit systématiquement, base de la facturation ZD. **Retiré V1 (propagation 2026-05-22)** — colonne orpheline jamais consommée, supprimée. La facturation ZD s'appuie exclusivement sur `pax`.
- **Prestataires logistiques en table dédiée** : `prestataires_logistiques` distincte de `organisations` (pas de RLS, pas de users, pas de facturation entrante)
- **Caduc (purgé 2026-06-11, audit data model)** : la table est devenue la **vue `v_courses_logistiques`** (sobriété §08 Bloc A 2026-05-01), **non créée en V1** (décision Val 2026-06-10, challenge Frontière — dépend de `tms.*` inexistant). Pilotage coûts/marge V1 = hors plateforme. Cf. section vue `v_courses_logistiques`.
- **Facturation AG flexible** : 2 modes par pack (`globale_achat` = 1 facture à l'achat OU `par_collecte` = 1 facture par collecte avec montant libre). Le `montant_ligne_ht` par collecte n'est PAS contraint par le prix unitaire de référence du pack
- **Blocage auto pack épuisé** : quand `credits_consommes = credits_initiaux`, le pack passe en `epuise` et la programmation AG est bloquée tant qu'un nouveau pack n'est pas négocié
- **Multi-SIRET supporté dès V1** : table `entites_facturation` liée à `organisations` (1-N). Chaque `evenement` et chaque `facture` est rattaché à une entité précise. Une entité par défaut par organisation
- **Pas d'expiration des packs AG en V1** : `date_expiration` nullable, à rouvrir en V2
- **Traçabilité des avoirs** : `factures.facture_origine_id` (self-ref) pour tracer quelle facture est annulée/corrigée. Numéro de facture unique (`numero_facture`) requis dès V1
- **Programmation ouverte aux 3 types d'organisations en V1 (2026-05-07)** : `traiteur`, `agence` et `gestionnaire_lieux` peuvent programmer une collecte. Règle V1 = programmateur=facturé (`evenements.organisation_id = entite_facturation_id.organisation_id`). Découplage agence↔traiteur (refacturation) reporté V2 (réintroduction `organisation_facturation_id`).
- **Traiteur opérationnel ≠ programmateur (2026-05-07)** : nouvelle colonne `evenements.traiteur_operationnel_organisation_id` qui pointe sur le traiteur qui opère physiquement (producteur juridique du déchet). Si programmateur=traiteur, alors traiteur opérationnel=programmateur. Si programmateur=agence ou gestionnaire, le traiteur opérationnel est choisi à la programmation.
- **Fiches traiteur shadow (2026-05-07)** : une agence peut programmer avec un traiteur hors référentiel Savr. Création d'une fiche `organisations` minimale (nom + raison sociale + SIRET optionnel) avec `est_shadow=true`. Pas de `users`, pas d'`entites_facturation` autorisée. Notification Admin → promotion manuelle en client réel possible (continuité historique préservée). Cas valable uniquement pour `type='traiteur'` et créé uniquement par `type='agence'` (gestionnaire restreint au référentiel).
- **Pack AG ouvert aux 3 types en V1 (2026-05-07)** : un pack `packs_antgaspi` peut appartenir à un traiteur, une agence ou un gestionnaire de lieux. Le crédit AG est décompté sur le pack du programmateur (`evenements.organisation_id`). Voir §06.09.
- **Snapshot producteur bordereau = traiteur opérationnel (2026-05-07)** : `bordereaux_savr.producteur_*` snapshote le traiteur opérationnel (producteur juridique du déchet). Si shadow sans SIRET, bordereau bloqué en `brouillon` (alerte UX au formulaire).
- **Snapshot donateur attestation = programmateur (2026-05-07)** : `attestations_don.donateur_*` snapshote l'organisation programmatrice (= facturée = défiscalisée). SIRET garanti par l'onboarding bloquant.
- **Module 19 Impact enrichi — NON CRÉÉ V1 (audit sobriété §04 2026-05-25, A1)** : les 6 tables (`briefs_evenement`, `referentiel_categories`, `referentiel_items`, `brief_items`, `impact_calculs`, `impact_synthese_evenement`) et les 3 champs anticipés (`evenements.statut_brief`, `evenements.template_brief_id`, `rapports_rse.type_rapport`) sont **retirés du schéma V1**. Ajout en V2 par migration (triviale sous Supabase). Spec conservée en référence (Niveau 6). Pattern `brief → items → mapping référentiel → calculs → synthèse` inchangé pour V2.
- **Module 20 Traçabilité réglementaire — MVP** : 4 tables (`bordereaux_savr`, `attestations_don`, `documents_generaux_savr`, `exports_registre`) + vue SQL `v_registre_dechets` agrégée à la volée. Enrichissement de `flux_dechets` (code déchet européen, filière de valorisation, adresse/SIRET exutoire) et `associations` (habilitation 2041-GE). **Pattern snapshot** : données producteur/transporteur/exutoire copiées dans bordereaux et attestations à l'émission pour figer l'historique. Pas d'intégration Trackdéchets en V1.
- **Attestation de don pour 100% des collectes AG réalisées avec repas donnés** *(précision 2026-06-11 — exclut `realisee_sans_collecte` et `annulee`, cf. règle d'émission table `attestations_don`)* : émission systématique, avec ou sans mention fiscale selon l'habilitation de l'association. Garantit une traçabilité documentée de chaque don.
- **Nouvelle table `tournees`** (V1) : 1 camion par tournée, relation **N↔N avec `collectes`** via `collecte_tournees` (mutualisation : 1 tournée → N collectes ; multi-camions : 1 collecte → N tournées — refonte 2026-05-25). Support de la plaque d'immatriculation, chauffeur, statut acceptance prestataire. Base de la mutualisation logistique et du dashboard Admin.
- **Cardinalité collecte↔tournée N↔N via `collecte_tournees` (refonte multi-camions 2026-05-25)** : remplace l'ancien `collectes.tournee_id` singulier (retiré). Une collecte volumineuse (ex. 3000 pax) peut être servie par N camions = N tournées. **Décision option a** : le découpage en N camions est **interne au TMS** (le dispatcher décide selon le volume réel) — l'App ne porte aucun champ "nombre de camions", elle reçoit et affiche les tournées via le webhook S3 `tournee-upsert`. Conséquences : marge = somme des parts de coût des N tournées ; statut collecte agrégé (en_cours dès la 1ʳᵉ tournée, realisee au S5 terminal unique émis par le TMS après agrégation des N camions) ; affichage multi-plaques au contrôle d'accès. **Pesées : un seul S5 terminal agrégé** émis par le TMS (option a) — le contrat App `collecte-terminee` reste inchangé. **Volet TMS différé** (dispatch M02 + cardinalité `collectes_tms → N tournees` + timing d'émission du S5 agrégé) : à spécifier en session `cdc-tms-savr` dédiée (écart cross-CDC conscient, tracé index + Suivi).
- **Nouvelle table `contacts_traiteurs`** : référentiel autocomplete par organisation, alimenté automatiquement à chaque programmation. Évite la ressaisie.
- **Tarification ZD multi-méthodes + remises (refonte 2026-05-26)** : la **base** de prix vit dans le catalogue `grilles_tarifaires_zd` (méthodes `paliers` | `fixe_variable`, formule affine `prix_base_ht + prix_par_couvert_ht × pax` par tranche), chaque organisation y est rattachée via `organisations.grille_tarifaire_zd_id` (NULL = grille `est_defaut`). La table `tarifs_negocie` ne porte plus que des **remises %** (`remise_pct`), par scope organisation/gestionnaire, **cumulables multiplicativement** sur la base. Base AG = tarif unitaire `tarifs_packs_ag` (remise AG sur collectes unitaires uniquement). Composition figée dans `factures_collectes.tarif_detail` (jsonb). Remplace l'ancien modèle `tarifs_negocie` à prix absolu (lui-même remplaçant `tarifs_zd_par_gestionnaire` 2026-04-28). Lève le besoin "% de réduction" + "forfait fixe + variable" + cumul base/remise (Val 2026-05-26).
- **Champ `reference_affaire` sur `evenements`** : référence interne client optionnelle (ex: numéro d'affaire Potel & Chabot). Saisie à la programmation, reportée sur facture Pennylane et PDF Savr.
- **Référentiel `lieux` enrichi** : adresse accès (unique — `adresse_grand_public` supprimée revue sobriété M05 2026-04-29), accès office, stationnement (enum), type véhicule max (enum `velo_cargo`/`camionnette`/`fourgon`/`vul`/`poids_lourd`), traiteurs opérant auto-renseignés, initié à la migration et modifiable par Admin uniquement.
- **Retiré V1 (propagation Q10 M05 2026-04-24)** — champ supprimé, case cochée supprimée du formulaire, scheduler supprimé. La plaque reste saisie et persistée dans `tournees.plaque_immatriculation` + `tournees.plaque_saisie_at` pour traçabilité interne (registre transport, audit M08 rapprochement factures, monitoring Admin délai acceptation→saisie). Webhook S7 conservé sans trigger email.
- **Profil Client Organisateur intégré au data model** : `organisations.type` étend `client_organisateur`, `users.role` étend `client_organisateur`, `evenements.client_organisateur_organisation_id` (nullable) permet le rattachement.
- **Corrigé 2026-05-29 (propagation §3bis)** : MTS-1 reste en V1 le système de dispatch des transporteurs `type_tms = 'mts1'` (coupure en V2). Le champ libre `mts1_reference` reste supprimé, mais la corrélation se fait désormais via `transporteurs.code_transporteur_mts1` (carrierShareableCode) + `attributions_antgaspi.confirmation_transporteur.reference_externe` (= `customerOrderId` MTS-1). Le fallback manuel reste le plan de secours, pas le mode nominal.
- **Taux de recyclage indicateur unique ZD-only (2026-05-06)** : suppression définitive des notions "Taux de détournement" et "Taux de valorisation" du data model. Une seule métrique `collectes.taux_recyclage` calculée avec captation par filière (formule : numérateur = somme `P_X × cap_X` pour les 4 filières valorisables, dénominateur = somme des 5 flux ZD V1 incluant OMR). 2 nouvelles tables `parametres_taux_recyclage` (4 seed) + `parametres_taux_recyclage_history` (audit). 2 colonnes snapshot sur `collectes` (`taux_recyclage` decimal + `caps_appliques` jsonb) figées à la clôture pour reproductibilité PDF Rapport RSE. RLS écriture `admin_savr` uniquement. Cf. addendum 2026-05-06 + §06.06 §9 Paramètres + §08 endpoints + §05 R_taux_recyclage.
- **Facteurs d'impact CO₂ ZD-only (2026-06-04, Sujet 3)** : modélisation des équivalents CO₂ (jusque-là affichés §11/§12 sans aucune table ni snapshot). 3 grandeurs figées par collecte (`co2_induit_kg`, `co2_evite_kg`, `co2_net_kg`) + `energie_primaire_evitee_kwh` + `co2_facteurs_snapshot` jsonb (reproductibilité PDF, règle ABC ligne séparée). 4 nouvelles tables référentiel : `parametres_facteurs_co2` (5 seed) + `_history`, `parametres_mix_emballages` (7 seed, FE emballage dérivé `Σ part×FE` par trigger) + `_history`, `parametres_co2_divers` (clé-valeur forfait collecte + équivalences, audité `audit_log`). Biodéchet = méthanisation 77 ; OMR énergie primaire = 0 (anti-double-comptage, décision a1 Val). RLS écriture `admin_savr`. Forfait collecte V1 → km réels TMS V2. Cf. addendum 2026-06-04 + §08 endpoints + §09 RLS + §05 R_co2_* + §11 + §12.
- **Facteur CO₂ AG (2026-06-04 bis)** : extension AG du modèle CO₂. Table `parametres_facteurs_co2_ag` (1 ligne, **2,5 kgCO₂e/repas FAO**) + `_history`. Réutilise `collectes.co2_evite_kg` + `co2_facteurs_snapshot` (discriminés par `type=anti_gaspi`, pas de nouvelle colonne) : `co2_evite_kg = volume_repas_realise × facteur`, figé à la clôture AG. Évité seul V1 (induit+net+transport = V2). Affiché attestations de don (§12 §1.3) + dashboard AG (§11). RLS admin W/ops R. Cf. addendum bis + §05 R_co2_ag + §08 9ter.6.

## Questions ouvertes — TOUTES RÉSOLUES (section purgée 2026-06-11, audit data model — ne rien rouvrir)

1. → **Tranché Val 2026-06-10** : invariant V1 figé (cf. table `users`), multi-orga = V2.
2. → **Tranché (F4 test-scenarios 2026-06-07)** : séries `FZD-`/`FAG-`/`FPK-`/`AV-YYYY-NNNNN` + table `sequences_facturation` gapless (cf. tables `factures` + `sequences_facturation`).
3. → **Figé** : `client_organisateur` (enum `users.role` + `organisations.type`, glossaire CLAUDE.md). Aucun renommage prévu.

## Liens

- [[01 - Vision et objectifs]]
- [[02 - Personas et cas d'usage]] (RLS basée sur organisation_id, lieu_id, created_by)
- [[03 - Périmètre fonctionnel global]]
- [[05 - Règles métier]] (tarification, algo attribution, décrémentation packs)
- [[09 - Authentification et permissions]] (politiques RLS Supabase)

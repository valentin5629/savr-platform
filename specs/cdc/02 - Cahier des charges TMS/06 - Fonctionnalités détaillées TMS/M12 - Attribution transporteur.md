# M12 — Attribution transporteur

**Persona principal** : Système (moteur backend) + Ops Savr (consommateur via M02) + Admin TMS (monitoring via M13)
**Contexte d'usage** : backend pur, appelé à la volée par M01/M02. Aucune UI dédiée V1 — monitoring dans M13.

---

## 1. Objectif métier

M12 est le **moteur de suggestion d'attribution transporteur**. Pour chaque collecte entrante (ou modifiée), il calcule automatiquement quel prestataire Ops Savr devrait retenir, en appliquant les règles R1. La suggestion s'affiche dans M02 Dispatch. Ops valide ou override. M12 est **un cerveau, pas un écran**.

> **Source de vérité paramètres règle AG IDF (audit cohérence A1 2026-05-09)** : pour V1, les paramètres pilotables (`regle_ag_seuil_pax_velo`, `regle_ag_plage_velo_debut`, `regle_ag_plage_velo_fin`, `regle_ag_seuil_h2_minutes`, `a_toutes_indisponible*`, `everest_codes_postaux`) restent stockés côté Plateforme dans [[../../01 - Cahier des charges App/04 - Data Model#Table parametres_algo|`plateforme.parametres_algo`]] (TMS V1 inexistant en prod). Pour V2, la cohabitation source de vérité Plateforme ↔ TMS sera réétudiée au moment du cutover. En attendant la spec V2, le M12 TMS lit ces paramètres depuis Plateforme (cache local TMS rafraîchi par webhook ou pull au démarrage — canal à figer §08 V2). L'écran M13 TMS affiche ces paramètres en **lecture seule** + bouton "Modifier dans Back-office Plateforme".

**Ce que M12 résout** :

- Supprime la décision manuelle "qui prend cette collecte" pour 95%+ des cas standards (ZD = Strike, AG < 600 pax = vélo, AG ≥ 600 pax = Marathon).
- Permet de modifier les règles d'attribution **sans redéploiement** (changement seuil 600 → 500 pax = 1 INSERT dans `parametres_tms`, effectif < 30s).
- Trace toutes les suggestions dans `suggestions_attribution_log` pour calibrer R1 (si taux override > 20% sur une branche → la règle est mauvaise).
- Recalcule la suggestion après refus prestataire pour aider Ops à choisir le suivant (sans bascule automatique — revue sobriété 2026-04-29).
- Prépare la V2 (attribution 100% auto sans validation Ops) : le même moteur, on supprime juste l'étape de confirmation.

**Split avec autres modules** :

- **M12 = moteur de suggestion** (ce module). Ne fait pas l'attribution, ne contacte pas le prestataire.
- [[M02 - Dispatch Ops Savr]] = écran de consommation des suggestions, validation/override par Ops, déclenche l'attribution réelle (`statut_dispatch = attribuee_en_attente_acceptation`, propagation A1 2026-04-25).
- [[M06 - Référentiel prestataires]] = référentiel lu par M12 (`shared.prestataires`, `grilles_tarifaires_prestataires`).
- [[M13 - Administration TMS]] = paramétrage des règles (`parametres_tms.attribution`) + panneau monitoring M12.
- [[M14 - Intégration Everest (A Toutes!)]] = M12 ne fait **plus** appel `is-handled-address` (refonte audit cohérence A4 2026-05-09 — vérification couverture locale via `parametres_algo.everest_codes_postaux`). M14 reste utilisé pour passer les commandes A Toutes! validées.

**KPI cibles V1** :

- Taux de suggestion produite (non-nulle) : > 98% (alerte si < 95% 7 jours glissants).
- Taux de suggestion acceptée par Ops (non-overridée) : > 85% (alerte si < 70% 7 jours — signal R1 mal calibré).
- Temps de calcul p95 : < 300 ms (vérification couverture locale, plus d'appel Everest synchrone — refonte audit cohérence A4 2026-05-09).

---

## 2. Personas et contexte d'usage

### Système (trigger)

M12 est **majoritairement invoqué par le système**, pas par un utilisateur. 3 triggers distincts (cf. §3) couvrent 100% des exécutions V1 (T4 Re-suggérer + T5 Bulk re-compute supprimés revue sobriété 2026-04-29).

### Ops Savr (consommateur indirect)

- Consomme les suggestions via l'écran E4 Modal attribution de [[M02 - Dispatch Ops Savr]].
- Peut override toute suggestion sans justification obligatoire (motif retiré V1, revue sobriété 2026-04-29).

### Admin TMS (paramétreur et superviseur)

- **Audit cohérence A1 2026-05-09** : Admin TMS ne modifie **plus** directement les règles d'attribution AG IDF — source de vérité = Plateforme `parametres_algo` (V1+V2 V1, à reétudier V2). M13 TMS affiche en lecture seule + redirige vers Back-office Plateforme.
- Pas de bulk re-compute V1 (revue sobriété 2026-04-29) — modifs paramètres n'impactent que les nouvelles collectes (T1) et les recalculs T2/T3 ultérieurs. Les collectes déjà `a_attribuer` gardent leur ancienne suggestion jusqu'à action Ops.
- Consomme le dashboard monitoring M12 dans M13 (cf. §4 panneau monitoring).

### Manager prestataire et Chauffeur

- **Hors périmètre M12**. Ne voient jamais les suggestions (c'est interne Savr). Ne peuvent pas déclencher M12.

---

## 3. Architecture du moteur

### Surfaces techniques

M12 est implémenté comme **un service backend interne** au TMS (Next.js API route + fonction SQL pour les parties performance-critiques). Pas d'écran dédié V1. Le panneau monitoring M13 est le seul point d'exposition UI.

| Surface                                                  | Type                      | Consommateur                       | Contrat                                                                                 |
| -------------------------------------------------------- | ------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| `POST /internal/m12/suggest`                             | API route interne Next.js | M02, M01 (après création collecte) | Input: `collecte_id` + `excluded_prestataire_ids: uuid[]` / Output: suggestion complète |
| `tms.m12_suggest(collecte_id uuid, excluded_ids uuid[])` | Fonction SQL plpgsql      | API route (délègue la logique DB)  | Retourne record `(prestataire_id, branche_code, detail jsonb)`                          |
| Panneau monitoring M13                                   | Écran UI                  | Admin TMS                          | Dashboard read-only avec KPI + historique suggestions                                   |

### Triggers (quand M12 tourne)

| #   | Trigger                    | Déclencheur                                                                                                 | Contexte                                                                                                                                                  |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Création collecte          | Insertion ligne `collectes_tms` (webhook M01 E1 ou création manuelle Ops)                                   | Suggestion initiale                                                                                                                                       |
| T2  | Refus prestataire          | Transition `statut_dispatch = rejetee_par_prestataire` via M03/E1 webhook (propagation A1 2026-04-25)       | Recalcul affichage pour aider Ops à choisir le suivant — **pas de bascule auto** (revue sobriété 2026-04-29)                                              |
| T3  | Re-confirmation post-modif | Trigger `re_confirmation_requise = true` posé par M01 D6 (modif `nb_pax`/`heure_collecte` post-acceptation) | Si branche R1 diffère → re-suggestion, sinon no-op (`flux_prevus` retiré revue sobriété 2026-04-29 ; `creneau` → `heure_collecte` propagation 2026-04-29) |

> **Triggers supprimés (revue sobriété 2026-04-29)** :
>
> - T4 Bouton Ops "Re-suggérer" — usage rare V1
> - T5 Bulk re-compute après modif paramètres — collectes existantes gardent leur suggestion, nouvelles passent par T1

### Dépendances amont

- `shared.prestataires` : lit `statut`, `type_prestation[]`, `rayon_intervention_km`, `coords_siege_lat/lng`, `everest_service_ids`, `deleted_at`. RLS cross-schema read-only (app_domain=tms).
- `tms.grilles_tarifaires_prestataires` : vérifie qu'au moins une grille valide existe à `heure_collecte` pour le prestataire candidat (renommage propagation 2026-04-29).
- `tms.parametres_tms` (namespace `attribution`) : seuils, plages horaires, flags indisponibilité.
- `tms.parametres_tms` (namespace `zones`) : mapping code postal → zone A Toutes! (pour branche backup camion).
- `tms.collectes_tms` : lit `parcours`, `nb_pax`, `heure_collecte`, `lieu_adresse` (renommage propagation 2026-04-29).
- **Caduc (A4 2026-05-09, purge F3 2026-06-07)** — couverture = check local `code_postal[:2] IN parametres_algo.everest_codes_postaux`, zéro appel API, zéro cache.

### Dépendances aval

- `tms.collectes_tms` : upsert 4 colonnes suggestion (cf. §4 data model).
- `tms.suggestions_attribution_log` : insert append-only de chaque suggestion (trace historique + métriques).
- `tms.audit_logs` : trace événements critiques (`AUCUNE_SUGGESTION`).
- Push alerte M11 si `branche_code = aucun_prestataire` → gravite `critical`.

---

## 4. Algorithme détaillé + structure data

### 4.1 Data model : nouvelles colonnes `collectes_tms`

Ajout de 4 colonnes à la table existante (propagation §04, revue sobriété 2026-04-29 — `refusee_par_prestataire_id` array supprimée) :

| Colonne                      | Type        | Contraintes                            | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ----------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `suggestion_prestataire_id`  | uuid        | FK `shared.prestataires(id)`, nullable | Prestataire suggéré par M12. Null si aucune suggestion calculable ou branche `aucun_prestataire`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `suggestion_branche_r1_code` | text        | nullable                               | Enum **9 valeurs (F1 tranché 2026-06-07, révisé même jour)** : `zd_idf_strike`, `ag_velo_programme`, `ag_velo_express`, `ag_marathon_volume`, `ag_marathon_volume_backup_camion`, `ag_marathon_nuit`, `ag_velo_fallback_marathon`, `ag_province_proximite`, `aucun_prestataire`. (`ag_velo_fallback_marathon` ajouté — introduit audit A3 2026-05-09, manquait à l'enum ; **`ag_marathon_volume_backup_camion` = canonique cross-CDC** — c'est la valeur de l'enum App `branche_attribution` §04/§06.09/§08 stockée en base dès la V1 ; l'ex-`ag_camion_backup` des listes TMS était la divergence, retiré) |
| `suggestion_detail`          | jsonb       | NOT NULL, default `'{}'::jsonb`        | Détail du calcul : `{ distance_km, service_everest_id, couverture_verifiee_at, prestataires_candidats_count, prestataires_exclus, branche_conditions_matched, parametres_snapshot }`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `suggestion_calculee_at`     | timestamptz | nullable                               | Horodatage dernière exécution M12. Null tant qu'aucune suggestion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Index ajoutés** :

- `(suggestion_prestataire_id, statut_dispatch) WHERE statut_dispatch = 'a_attribuer'`
- `(suggestion_branche_r1_code) WHERE statut_dispatch = 'a_attribuer'`

> **Colonne supprimée (revue sobriété 2026-04-29)** : `refusee_par_prestataire_id uuid[]` — auto-relance W3 supprimée. L'historique des refus se reconstitue depuis `suggestions_attribution_log` au besoin (rétention 2 ans). L'index GIN associé est supprimé. Ops peut voir le motif refus du dernier prestataire dans le drawer M02 E3 via `motif_refus_code/texte` sur `collectes_tms`.

> **Colonne ajoutée (sobriété M14 2026-04-30 B_M14_02)** : `everest_service_id_target smallint` (nullable, CHECK IN (71, 75, 91)) — single source of truth pour le service Everest cible. M12 pose cette colonne **en même temps que `suggestion_detail`** quand la branche calculée vise A Toutes! (vélo standard 71, vélo express 75, camion backup 91). Si Ops override le prestataire dans M02 vers A Toutes! manuellement → M02 met à jour `everest_service_id_target`. Si Ops override vers Strike/Marathon hors backup → M02 met à NULL. Cette colonne est lue par M14 W1 étape 2 (qui ne re-calcule plus la fenêtre last-minute). Cf. propagation §04 ligne 372.

### 4.2 Data model : table `suggestions_attribution_log`

Append-only. Une ligne par exécution M12. Sert à mesurer la fiabilité des règles et à préparer le scoring V2.

```sql
CREATE TABLE tms.suggestions_attribution_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    collecte_id uuid NOT NULL REFERENCES tms.collectes_tms(id),
    trigger_source text NOT NULL,  -- 'T1_creation' | 'T2_refus' | 'T3_re_confirmation' (T4/T5 supprimés revue sobriété 2026-04-29)
    prestataire_id uuid REFERENCES shared.prestataires(id),  -- NULL si aucune suggestion
    branche_r1_code text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    duree_calcul_ms integer NOT NULL,
    cree_le timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON tms.suggestions_attribution_log (collecte_id, cree_le DESC);
CREATE INDEX ON tms.suggestions_attribution_log (branche_r1_code, cree_le);
CREATE INDEX ON tms.suggestions_attribution_log (trigger_source, cree_le);
```

> **Colonnes + index supprimés (revue sobriété 2026-04-29)** :
>
> - `prestataires_exclus uuid[]` — debug auto-relance retiré
> - `override_by_ops_user_id uuid` — audit override retiré V1
> - `override_motif text` — motif override retiré V1
>
> **Colonnes supprimées audit cohérence A4 2026-05-09** :
>
> - `everest_is_handled_address_called bool` — sans objet (vérification locale, pas d'appel API)
> - `everest_is_handled_address_from_cache bool` — sans objet (pas de cache)
> - `override_vers_prestataire_id uuid` — traçabilité override retirée V1
> - Index `(override_by_ops_user_id) WHERE override_by_ops_user_id IS NOT NULL`

**Rétention** : 2 ans (purge automatique au-delà — volume estimé : 3 × nb_collectes/jour × 365j × 2 ans ≈ 70k lignes/an × 2 = 140k lignes V1, négligeable).

**RLS** : lecture `admin_tms` + `ops_savr`. Écriture système uniquement (service role) via INSERT à la création de la suggestion (T1/T2/T3). Plus de RPC d'enrichissement post-INSERT V1.

### 4.3 Table `everest_coverage_cache` — **Supprimée audit cohérence A4 2026-05-09**

> **Refonte 2026-05-09** : la table cache + appel API Everest `is-handled-address` est supprimée V1+V2. La couverture Everest est désormais déterminée par **vérification locale** sur les codes postaux préfixe `[:2]` lus depuis `plateforme.parametres_algo.everest_codes_postaux` (seed V1 `['75','92','93']`). Aucune dépendance API Everest dans le chemin critique de l'attribution. Conséquences : suppression de la table `tms.everest_coverage_cache`, suppression du paramètre `parametres_tms.attribution.fallback_everest_down_supposer_couvert`, suppression alerte `m14_everest_timeout` sur ce flux (l'API Everest reste utilisée pour passer les commandes dans M14, pas pour vérifier la couverture).
>
> **Mise à jour de la liste extensible** : Admin Plateforme ajoute/retire des préfixes département dans `parametres_algo.everest_codes_postaux` via Back-office Plateforme. Le TMS V2 lit ce paramètre depuis cache local rafraîchi par webhook (canal à figer §08 V2). Plus de bouton "Invalider cache" dans M13 — l'invalidation se fait par modification du paramètre côté Plateforme.

### 4.4 Data model : extension `shared.prestataires` (pour M12)

Une colonne ajoutée pour calibrer la reco C5 (tri province multi-candidats) :

| Colonne                     | Type    | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nb_collectes_6_mois_cache` | integer | NOT NULL default 0. Compteur incrémenté par trigger sur `collectes_tms` **uniquement sur transition ENTRANTE dans le pipeline** : `OLD.statut_dispatch NOT IN (...) AND NEW.statut_dispatch IN ('attribuee_en_attente_acceptation','acceptee','en_attente_execution')` — pas de double comptage par transition interne (F6 tranché 2026-06-07, précise propagation A1 2026-04-25). Purge = **recalcul complet quotidien** par cron (`UPDATE shared.prestataires SET nb_collectes_6_mois_cache = (SELECT count(*) ... WHERE attribuee_at > now() - interval '6 months')` — idempotent, corrige toute dérive). Sert au tri province (cf. §4.6 branche province). |

**Index** : `(type_prestation, statut, nb_collectes_6_mois_cache)` pour lookup province performant.

**Alternative écartée** : calcul temps réel (COUNT sur `collectes_tms`) — rejeté car scan inacceptable à chaque suggestion province. Cache trigger simple suffit V1.

### 4.5 Data model : paramètres lus pour M12 (refonte audit cohérence A1+A4 2026-05-09 + audit sobriété 2026-05-09 B1+B2)

> **Source de vérité unique = `plateforme.parametres_algo`** (V1+V2 à reétudier au cutover V2). Le TMS V2 lit en cache local rafraîchi par webhook (canal §08 V2). Voir [[../04 - Data Model TMS#5. parametres_tms.attribution|§04 TMS]] pour le résiduel TMS-only.

**Paramètres lus depuis Plateforme** : `a_toutes_indisponible` (bool), `regle_ag_seuil_pax_velo`, `regle_ag_plage_velo_debut`, `regle_ag_plage_velo_fin`, `regle_ag_seuil_h2_minutes`, `everest_codes_postaux`, `poids_par_repas_kg`. Métadonnées qui/quand/pourquoi du flag `a_toutes_indisponible` lues depuis `audit_log` central côté Plateforme (audit sobriété B1).

**Paramètre TMS-only** (`parametres_tms` namespace `attribution`) :

| Clé                                     | Type   | Valeur seed V1            | Modifiable par |
| --------------------------------------- | ------ | ------------------------- | -------------- |
| `province_tri_secondaire_code`          | string | `nb_collectes_6_mois_asc` | `admin_tms`    |
| `regle_zd_prestataire_prioritaire_code` | string | `strike`                  | `admin_tms`    |

> **F2 tranché Val 2026-06-07 (test-scenarios M12)** : le paramètre `regle_zd_prestataire_prioritaire_code` était utilisé par R1.1 + pseudo-code §4.6 mais absent de tout seed. Ajouté ici (TMS-only, string simple V1 — pas de liste ordonnée tant qu'il n'y a qu'un presta ZD). Modifiable `admin_tms` seul (cohérent D11) — la mention "éditable Ops Savr" de R1.1 §05 est corrigée.

> **Paramètres supprimés** :
>
> - `max_auto_relances_cascade` (revue sobriété 2026-04-29) — auto-relance W3 supprimée
> - `fallback_everest_down_supposer_couvert` (audit cohérence A4 2026-05-09) — vérification couverture locale
> - `a_toutes_indisponible_raison` / `_declaree_le` / `_declaree_par` (audit sobriété 2026-05-09 B1) — métadonnées dans `audit_log` Plateforme

### 4.6 Algorithme par branche (pseudo-code)

```
function m12_suggest(collecte_id uuid, excluded_prestataire_ids uuid[]):
    c = SELECT * FROM collectes_tms WHERE id = collecte_id;
    params = load_namespace('attribution');
    candidates_excluded = excluded_prestataire_ids;  -- (revue sobriété 2026-04-29 : refusee_par_prestataire_id supprimée, exclusion uniquement via param d'appel si l'appelant la passe explicitement)

    # === Branche ZD ===
    if c.parcours = 'zd':
        # Garde ZD province (F7 tranché Val 2026-06-07) : pas de ZD province V1 —
        # rejet explicite au lieu d'une suggestion Strike fausse
        if not is_ile_de_france(c.lieu_adresse.code_postal):
            return suggestion(NULL, 'aucun_prestataire', reason='zd_province_non_supporte_v1');
        strike_id = resolve_prestataire_by_code(params.regle_zd_prestataire_prioritaire_code);
        if strike_id in candidates_excluded:
            return suggestion(NULL, 'aucun_prestataire', reason='zd_strike_exclu');
        if not is_prestataire_eligible(strike_id, c.heure_collecte):
            return suggestion(NULL, 'aucun_prestataire', reason='strike_inactif_ou_sans_grille');
        return suggestion(strike_id, 'zd_idf_strike', detail={...});

    # === Branche AG ===
    if c.parcours = 'ag':
        # Détection province vs IdF via is_ile_de_france(c.lieu_adresse.code_postal)
        if not is_ile_de_france(c.lieu_adresse.code_postal):
            return branche_province_ag(c, candidates_excluded);

        heure = c.heure_collecte::time;
        minutes_avant_collecte = EXTRACT(EPOCH FROM (c.heure_collecte - now())) / 60;

        # Branche AG nuit (après 20h ou avant 7h)
        if heure >= params.regle_ag_plage_velo_fin OR heure < params.regle_ag_plage_velo_debut:
            marathon_id = resolve_prestataire_by_code('marathon');
            if marathon_id not in candidates_excluded and is_prestataire_eligible(marathon_id, c.heure_collecte):
                return suggestion(marathon_id, 'ag_marathon_nuit', detail={...});
            # Pas de backup nuit en V1 — A Toutes! fermé
            return suggestion(NULL, 'aucun_prestataire', reason='ag_nuit_marathon_exclu');

        # Branche AG grand événement (≥ 600 pax) — codes alignés Plateforme audit cohérence 2026-05-09
        if c.nb_pax >= params.regle_ag_seuil_pax_velo:
            marathon_id = resolve_prestataire_by_code('marathon');
            if marathon_id not in candidates_excluded and is_prestataire_eligible(marathon_id, c.heure_collecte):
                return suggestion(marathon_id, 'ag_marathon_volume', detail={...});
            # Backup : A Toutes! camion (ID 91) — partage la plage horaire vélo (audit cohérence A2 2026-05-09)
            # + garde zone tarifaire (nouveau 2026-06-07, arbitrage Val — cf. §05 R1.3) :
            #   is_zone_tarifaire_atoutes(cp) = left(cp, 2) ∈ keys(zones_codes_postaux_mapping) — 75/92/93/94
            if not params.a_toutes_indisponible and heure < params.regle_ag_plage_velo_fin and is_zone_tarifaire_atoutes(c.lieu_adresse.code_postal):
                atoutes_id = resolve_prestataire_by_code('a_toutes');
                if atoutes_id not in candidates_excluded and is_prestataire_eligible(atoutes_id, c.heure_collecte):
                    couverture_ok = everest_is_handled_address(c.plateforme_lieu_id);
                    if couverture_ok:
                        return suggestion(atoutes_id, 'ag_marathon_volume_backup_camion',  # canonique cross-CDC = enum App branche_attribution (F1 révisé 2026-06-07)
                                          detail={service_everest_id: 91, couverture_verifiee: true, ...});
            return suggestion(NULL, 'aucun_prestataire', reason='ag_volume_marathon_et_atoutes_camion_indispo');

        # Branche AG vélo (< 600 pax, plage jour)
        # Garde zone tarifaire A Toutes! (nouveau 2026-06-07, arbitrage Val — cf. §05 R1.3) : couvre la grande
        # couronne (77/78/91/95 = IdF mais hors grille A Toutes!) que everest_is_handled_address ne filtre pas
        atoutes_id = resolve_prestataire_by_code('a_toutes');
        if params.a_toutes_indisponible OR atoutes_id in candidates_excluded OR not is_prestataire_eligible(atoutes_id, c.heure_collecte) OR not is_zone_tarifaire_atoutes(c.lieu_adresse.code_postal):
            # Bascule Marathon si A Toutes! indispo — code distinct (audit cohérence A3 2026-05-09)
            marathon_id = resolve_prestataire_by_code('marathon');
            if marathon_id not in candidates_excluded and is_prestataire_eligible(marathon_id, c.heure_collecte):
                return suggestion(marathon_id, 'ag_velo_fallback_marathon',
                                  detail={reason: 'a_toutes_indispo_bascule_marathon', ...});
            return suggestion(NULL, 'aucun_prestataire', reason='ag_velo_indispo_marathon_exclu');

        couverture_ok = everest_is_handled_address(c.plateforme_lieu_id);
        if not couverture_ok:
            # Fallback Marathon si adresse hors zone A Toutes! — code distinct (audit cohérence A3 2026-05-09)
            marathon_id = resolve_prestataire_by_code('marathon');
            if marathon_id not in candidates_excluded and is_prestataire_eligible(marathon_id, c.heure_collecte):
                return suggestion(marathon_id, 'ag_velo_fallback_marathon',
                                  detail={reason: 'a_toutes_hors_zone', ...});
            return suggestion(NULL, 'aucun_prestataire', reason='ag_velo_hors_zone_marathon_exclu');

        # Sous-branche selon délai (audit cohérence A5 2026-05-09 : seuil unique 90 min — ex-zone hybride 90-120 supprimée)
        if minutes_avant_collecte < params.regle_ag_seuil_h2_minutes:
            return suggestion(atoutes_id, 'ag_velo_express',
                              detail={service_everest_id: 75, couverture_verifiee: true, ...});
        return suggestion(atoutes_id, 'ag_velo_programme',
                          detail={service_everest_id: 71, couverture_verifiee: true, ...});

    # === Branche ZD Province (V2, rejet V1) ===
    # Return aucun_prestataire — à implémenter V2
```

**Note sobriété 2026-04-30 B_M14_02** : à l'écriture en base de la suggestion sur `tms.collectes_tms`, le persister `service_everest_id` (présent dans `suggestion_detail` JSONB) doit aussi être copié vers la nouvelle colonne `tms.collectes_tms.everest_service_id_target` (smallint). Cette colonne est la **single source of truth** lue par M14 W1 (M14 ne re-calcule plus la fenêtre last-minute). Si la branche retourne `aucun_prestataire` ou un prestataire non-Everest (Strike/Marathon hors backup) → `everest_service_id_target` posé à NULL.

### 4.7 Sous-routine : `branche_province_ag`

```
function branche_province_ag(c, candidates_excluded):
    # Filtrer prestataires actifs ayant 'ag' dans type_prestation ET rayon_intervention_km > 0
    candidates = SELECT * FROM shared.prestataires
                 WHERE statut = 'actif'
                   AND deleted_at IS NULL
                   AND 'ag' = ANY(type_prestation)
                   AND rayon_intervention_km > 0
                   AND id != ALL(candidates_excluded);

    # Calcul distance haversine coords_siege ↔ lieu collecte
    candidates = candidates.map(p => {
        distance_km: haversine(p.coords_siege_lat, p.coords_siege_lng,
                               c.lieu_adresse.lat, c.lieu_adresse.lng)
    });

    # Filtrer par rayon
    candidates = candidates.filter(p => p.distance_km <= p.rayon_intervention_km);

    if candidates is empty:
        return suggestion(NULL, 'aucun_prestataire', reason='province_aucun_dans_rayon');

    # Filtrer ceux avec grille valide à la date
    candidates = candidates.filter(p => has_grille_valide(p.id, c.heure_collecte));

    if candidates is empty:
        return suggestion(NULL, 'aucun_prestataire',
                          reason='province_presta_trouve_sans_grille', alert_m11=true);

    # Tri primaire : distance ASC
    # Tri secondaire : nb_collectes_6_mois_cache ASC (reco C5 validée)
    candidates.sort((a, b) => {
        if a.distance_km != b.distance_km:
            return a.distance_km - b.distance_km;
        return a.nb_collectes_6_mois_cache - b.nb_collectes_6_mois_cache;
    });

    winner = candidates[0];
    return suggestion(winner.id, 'ag_province_proximite',
                      detail={distance_km: winner.distance_km,
                              candidats_total: candidates.length,
                              tri_primaire: 'distance_asc',
                              tri_secondaire: 'nb_collectes_6_mois_asc'});
```

### 4.8 Helpers SQL

- `is_prestataire_eligible(presta_id, heure_collecte)` : retourne bool. Vérifie `statut = 'actif'` ET `deleted_at IS NULL` ET `EXISTS(grille valide à heure_collecte)`. Si pas de grille valide → trace `integrations_logs` warning seule — supprimée (F4 tranché 2026-06-07, aligné §12ter : cas impossible par construction R_M06) (cf. §7 edge case 7.5).
- `has_grille_valide(presta_id, date)` : retourne bool. Vérifie existence d'au moins une ligne `grilles_tarifaires_prestataires` avec `prestataire_id = X` ET `date BETWEEN date_debut_validite AND COALESCE(date_fin_validite, 'infinity')`.
- `resolve_prestataire_by_code(code)` : retourne uuid. Lookup `shared.prestataires.code` UNIQUE (Strike, Marathon, A Toutes! codes figés dans seed). Null-safe (retourne NULL si prestataire retiré).
- `haversine(lat1, lng1, lat2, lng2)` : fonction SQL immutable, distance en km.
- `is_ile_de_france(code_postal text)` : fonction SQL immutable. Match sur préfixes `75`, `77`, `78`, `91`, `92`, `93`, `94`, `95` — **déclencheur de basculement vers les branches IDF dur** (vs scoring province). Ne pas confondre avec la couverture Everest, qui est un sous-ensemble (cf. ci-dessous).
- `everest_is_handled_address(plateforme_lieu_id uuid)` : **refonte audit cohérence A4 2026-05-09** — vérification **locale** sans appel API. Lit `lieu.code_postal` (depuis `tms.lieux_cache` ou cross-schema), match `code_postal[:2] IN parametres_algo.everest_codes_postaux` (paramètre source Plateforme, cache local TMS, seed V1 `['75','92','93']`). Pas de timeout, pas de fallback nécessaire. **Conséquence** : un lieu IDF en 94/95 déclenche la branche IDF mais `everest_is_handled_address` retourne `false` → bascule `ag_velo_fallback_marathon`.

### 4.9 Panneau monitoring M13 (dashboard M12)

**Route** : `tms.gosavr.io/admin/integrations#m12-attribution` (rendu sous M13 E6 sous-onglet, cf. [[11 - Dashboards TMS]] D11, propagation §11 2026-04-27).

Écran dédié dans [[M13 - Administration TMS]] onglet "Monitoring M12 Attribution". Accès `admin_tms` seul.

| Bloc                        | KPI affichés                                                                                                                                             | Source                                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Volumétrie (24h / 7j / 30j) | Nb suggestions émises, nb par branche R1, nb par trigger_source                                                                                          | `suggestions_attribution_log`                                                                                                                                        |
| Qualité                     | Taux suggestion acceptée par branche R1 (calculé par jointure `suggestions_attribution_log` + `collectes_tms.prestataire_id` au moment de l'attribution) | Jointure (revue sobriété 2026-04-29 — colonnes override\_\* supprimées, taux override calculé via comparaison `suggestion_prestataire_id` vs `prestataire_id` final) |
| Performance                 | p50, p95, p99 durée calcul (caduc A4 2026-05-09, purge F3 2026-06-07)                                                                                    | `suggestions_attribution_log.duree_calcul_ms`                                                                                                                        |
| Alertes actives             | Collectes en `aucun_prestataire` non résolues, durée cumulée                                                                                             | `collectes_tms` + join                                                                                                                                               |
| Paramètres actifs           | Lecture seule de `parametres_tms.attribution` (valeurs, date dernière MAJ, acteur)                                                                       | `parametres_tms`                                                                                                                                                     |

Pas d'interaction V1 ( supprimé A4 2026-05-09, purge F3 2026-06-07). Modification paramètres = redirection vers Back-office Plateforme (A1 2026-05-09).

**Pas d'alerte automatique sur les KPI qualité V1** (décision Q3 2026-04-24) : le bloc "Qualité" reste en affichage passif. Aucun seuil déclenchant une alerte M11 même si le taux d'override dépasse 50%. Arbitrage : simplification V1, la supervision humaine (Admin TMS qui consulte le dashboard) suffit.

---

## 5. Workflows détaillés

### W1 — Suggestion initiale à la création collecte (T1)

```
1. Plateforme push `collecte-creee` (webhook E1) → M01 insère ligne `collectes_tms`
2. Trigger DB `AFTER INSERT` **`WHEN (NEW.statut_dispatch = 'a_attribuer' AND NEW.origine <> 'migration')`** (F5 tranché Val 2026-06-07 — exclut les INSERT migration MTS-1 et collectes créées hors dispatch : pas d'alertes critical parasites ni de pollution log ; colonne `origine` posée M02 7.3) appelle `tms.m12_suggest(NEW.id, '{}')`
3. M12 exécute l'algo §4.6 → retourne `(presta_id, branche_code, detail)`
4. UPDATE `collectes_tms` SET suggestion_prestataire_id, suggestion_branche_r1_code, suggestion_detail, suggestion_calculee_at = now()
5. INSERT `suggestions_attribution_log` avec trigger_source = 'T1_creation'
6. Si branche_code = 'aucun_prestataire' → INSERT `alertes` (M11) gravite = critical
7. Collecte s'affiche dans E1 Dispatch M02 avec badge suggestion
```

**Durée cible** : < 500 ms end-to-end ( caduc A4 — calcul 100% local).

### W2 — Recalcul après refus prestataire (T2 — revue sobriété 2026-04-29)

> Anciennement "Auto-relance après refus" — refonte 2026-04-29. La bascule automatique vers le prestataire suivant a été supprimée. M12 recalcule juste la suggestion pour aider Ops à choisir le suivant via M02 W3 (refus simple) puis M02 W5 (override manuel).

```
-- propagation A1 2026-04-25 — alignement enum statut_dispatch 6 valeurs
-- propagation M14 2026-04-25 — étape 1bis cascade annulation Everest (R_M14.7)
1. M03 ou webhook reçoit refus prestataire → UPDATE collectes_tms SET statut_dispatch = 'rejetee_par_prestataire'
1bis. **Si `prestataire_refusant.integration_externe = 'everest'` (A Toutes!)** : trigger DB `trg_m14_cascade_cancel` enqueue worker `m14_cancel_mission` (M14 W3, R_M14.7) → `POST /missions/cancel` Everest pour annuler la mission active côté A Toutes! (anti double-dispatch).
2. Trigger DB `AFTER UPDATE` détecte transition vers 'rejetee_par_prestataire'
3. Appelle m12_suggest(id, ARRAY[prestataire_refusant_id]) — exclusion explicite du refusant pour ce recalcul uniquement
4. UPDATE collectes_tms SET suggestion_prestataire_id, suggestion_branche_r1_code, suggestion_detail = nouvelle suggestion (PAS de bascule statut_dispatch)
5. INSERT suggestions_attribution_log avec trigger_source = 'T2_refus' + detail = { prestataire_exclu: [refusant_id] }
6. Si nouvelle suggestion = NULL (aucun_prestataire) → INSERT alertes M11 gravite = critical
7. Ops voit la collecte dans M02 E1 Zone 2 (collectes à attribuer) avec nouvelle suggestion + badge "Refusée par {refusant}". Réattribue manuellement via E4 modal attribution.
```

> **Comportement supprimé (revue sobriété 2026-04-29)** :
>
> - Bascule auto `statut_dispatch = 'attribuee_en_attente_acceptation'` vers nouveau presta
> - Push webhook S1 'collecte-acceptee' source 'tms_auto_relance'
> - cascade_depth incrémenté + max_auto_relances_cascade
> - Audit log action='AUTO_RELANCE'
> - Alerte M11 `m12_cascade_max_atteinte` (cascade dépassée)

### W3 — Re-confirmation post-modification collecte (T3)

```
1. M01 D6 pose re_confirmation_requise = true suite à modif nb_pax / `heure_collecte` (`flux_prevus` retiré revue sobriété 2026-04-29 ; `creneau` → `heure_collecte` propagation 2026-04-29)
2. Trigger DB `AFTER UPDATE` si OLD.nb_pax != NEW.nb_pax OR OLD.heure_collecte != NEW.heure_collecte
3. Appelle m12_suggest(id, '{}') — pas d'exclusion (pas un refus)
4. Compare nouvelle_branche avec suggestion_branche_r1_code actuelle
   - Identique : no-op, pas de re-confirmation nécessaire
   - Différente : UPDATE suggestion_prestataire_id, suggestion_branche_r1_code, suggestion_detail
     + INSERT suggestions_attribution_log avec trigger_source = 'T3_re_confirmation'
     + Notification email Ops Savr : "Collecte #{id} — suggestion revue suite modif ({ancien} → {nouveau})"
```

> **Workflows supprimés (revue sobriété 2026-04-29)** :
>
> - W4 ex-Re-suggestion manuelle Ops (T4) — bouton "Re-suggérer" retiré V1
> - W5 ex-Bulk re-compute après modif paramètres (T5) — recalcul sur paramètres retiré V1
> - W6 ex-Override Ops (enrichissement log) — RPC `m12_enrich_override` retirée + 3 colonnes `override_*` retirées

---

## 6. Règles métier appliquées

Renvoi explicite vers §05 [[../05 - Règles métier TMS]] :

| Source              | Règle                                                   | Implémentation M12                                                                                                                                                         |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §05 R1.1            | ZD → Strike par défaut                                  | Branche `zd_idf_strike`, paramétrée via `parametres_tms.regle_zd_prestataire_prioritaire_code`                                                                             |
| §05 R1.2            | AG → vélo si < 600 pax jour H+2                         | Branches `ag_velo_programme`, `ag_velo_express`, `ag_marathon_volume`, `ag_marathon_volume_backup_camion`, `ag_marathon_nuit`, `ag_velo_fallback_marathon` (F1 2026-06-07) |
| §05 R1.2 (province) | Plus proche dans rayon                                  | Branche `ag_province_proximite` + tri secondaire `nb_collectes_6_mois_asc`                                                                                                 |
| §05 R1.3            | Prestataire inactif non attribuable                     | Helper `is_prestataire_eligible` filtre systématique                                                                                                                       |
| §05 R1.3            | Audit log basique chaque attribution                    | INSERT `suggestions_attribution_log` (revue sobriété 2026-04-29 — audit AUTO_RELANCE retiré, audit override retiré)                                                        |
| §05 R1.3            | Override Ops possible à tout moment                     | M02 W5 (revue sobriété 2026-04-29 — sans motif, sans RPC enrich)                                                                                                           |
| §05 R6.1            | Cycle de vie collectes_tms — refus ne bascule plus auto | W2 recalcul affichage uniquement (revue sobriété 2026-04-29)                                                                                                               |
| §03 M12             | Architecture générique (zéro hardcoding presta)         | `resolve_prestataire_by_code()` résout via `shared.prestataires.code`                                                                                                      |
| §03 M12             | Détection last-minute < 1h30                            | Branche `ag_velo_express` (service Everest 75)                                                                                                                             |

---

## 7. Edge cases

### 7.1 — Aucun prestataire candidat (toutes branches)

**Cas** : collecte ZD mais Strike suspendu (cf. fin contrat M06), OU collecte AG nuit avec Marathon refusé, OU collecte province sans presta dans rayon, OU presta province trouvé mais sans grille valide.

**Comportement** :

- `suggestion_prestataire_id = NULL`, `suggestion_branche_r1_code = 'aucun_prestataire'`, `suggestion_detail.reason = <raison précise>`.
- Collecte reste en `statut_dispatch = 'a_attribuer'`.
- INSERT `alertes` (M11) gravite = `critical`, destinataire = Ops Savr + Admin TMS, canal = email, titre = "Collecte sans suggestion : #{collecte_id} — {raison}".
- E1 Dispatch M02 affiche badge rouge "Aucune suggestion" sur la ligne.

### 7.2 — Everest down au moment d'un appel `is-handled-address` — **Caduc (A4 2026-05-09, purge F3 2026-06-07)** : vérification locale, aucun appel API sur ce flux

**Cas** : timeout > 2s sur POST `/is-handled-address`.

**Comportement** (reco C4 validée) :

- Fonction retourne `true` par défaut (supposer couvert — réduit faux négatifs).
- INSERT `integrations_logs` type = `warning`, message = "Everest is_handled_address timeout, fallback=true assumed", collecte_id, lieu_id.
- **Ne pas persister** en `everest_coverage_cache` (éviter de pérenniser une fausse valeur).
- Si finalement A Toutes! refuse à l'acceptation → recalcul T2 vers Marathon (W2).

### 7.3 — Everest retourne `is_handled = false` sur adresse IdF — **Caduc (A4 2026-05-09, purge F3 2026-06-07)** : le cas métier survit (adresse IDF hors `everest_codes_postaux`, ex CP 94 → `ag_velo_fallback_marathon`, cf. §4.8) mais sans appel API ni cache

**Cas** : A Toutes! ne couvre pas une adresse spécifique (ex: nouvelle zone non encore intégrée).

**Comportement** :

- Branche AG vélo bascule sur Marathon (`ag_marathon_volume` avec `detail.reason = 'a_toutes_hors_zone'`).
- Persist cache 7j (pour éviter réappeler Everest à chaque re-run).
- Ops peut invalider le cache manuellement via M13 si A Toutes! étend sa couverture.

### 7.4 — Cache Everest expiré mais Everest down — **Caduc (A4 2026-05-09, purge F3 2026-06-07)** : plus de cache

**Cas** : `expires_at < now()` ET timeout API Everest.

**Comportement** :

- Même logique que 7.2 : fallback `true` + log warning + **ne pas** mettre à jour cache (garde l'ancienne entrée expirée non purgée).
- Cron daily de purge ne supprime que les entrées `expires_at < now() - INTERVAL '30 days'` (marge de sécurité).

### 7.5 — Prestataire actif mais sans grille tarifaire valide

**Cas** : presta `statut = 'actif'` mais aucune ligne `grilles_tarifaires_prestataires` avec `date_debut_validite <= heure_collecte <= COALESCE(date_fin_validite, 'infinity')`.

**Comportement** (reco C7 validée — amendé F4 tranché Val 2026-06-07, aligné §12ter) :

- Presta exclu de la suggestion (filtré par `is_prestataire_eligible`).
- **Supprimé (F4 2026-06-07)** : cas impossible par construction (R_M06 grille obligatoire à création presta actif) — trace `integrations_logs` warning seule. Si déclenché en prod = bug DB à investiguer.
- Si c'est le seul candidat possible → branche `aucun_prestataire` avec `detail.reason = 'presta_sans_grille'` → alerte `m12_aucun_prestataire` **critical** (gravité uniforme F4).

### 7.6 — Modification `nb_pax` post-attribution franchissant le seuil 600

**Cas** : collecte acceptée par A Toutes! vélo à 450 pax. Traiteur met à jour à 650 pax. M01 D6 pose `re_confirmation_requise = true`.

**Comportement** (reco C9 validée) :

- T3 déclenché automatiquement.
- m12_suggest re-calcule → nouvelle branche `ag_marathon_volume`.
- UPDATE `suggestion_prestataire_id`, `suggestion_branche_r1_code`, `suggestion_detail`.
- Notification email Ops Savr : "Collecte #{id} : modif pax 450→650, suggestion bascule A Toutes! vélo → Marathon. Action requise."
- **Pas** de bascule automatique de l'attribution — Ops doit trancher manuellement (confirmer avec Marathon ou garder A Toutes! si accord spécifique).
- Collecte reste `statut_dispatch IN ('acceptee','en_attente_execution')` mais avec flag `re_confirmation_requise = true`.

### 7.7 — Trigger T3 déclenché mais `suggestion_prestataire_id` identique

**Cas** : modif `nb_pax` 450 → 480 (toujours dans la même branche `ag_velo_programme`).

**Comportement** :

- `suggestion_branche_r1_code` identique → no-op côté UPDATE `collectes_tms`.
- **Toujours** INSERT `suggestions_attribution_log` avec trigger_source = 'T3_re_confirmation' et `detail.branche_unchanged = true` pour audit complet.
- `re_confirmation_requise` reste à `true` (levée uniquement par confirmation explicite Ops côté M02).

### 7.8 — `plateforme_lieu_id` absent ou coords GPS nulles (branche province)

**Cas** : collecte entrée via webhook E1 avec `lieu_adresse.lat/lng = NULL`. Flag M01 D9 `coords_manquantes = true`.

**Comportement** :

- `branche_province_ag` impossible (pas de point de départ haversine).
- Retour `suggestion(NULL, 'aucun_prestataire', reason='province_coords_manquantes')`.
- INSERT `alertes` M11 gravite = `critical` (F4 tranché Val 2026-06-07 — gravité uniforme : toute branche `aucun_prestataire` émet `m12_aucun_prestataire` critical, la raison est dans le payload), titre = "Coords manquantes lieu — province non suggestible", destinataire = Ops Savr.
- Ops doit géocoder manuellement dans Plateforme ou override.

> **Edge cases supprimés (revue sobriété 2026-04-29)** :
>
> - Ex-7.2 "Refus en cascade plafond" — cascade supprimée
> - Ex-7.8 "Presta suspendu pendant bulk re-compute T5" — T5 supprimé
> - Ex-7.10 "Re-suggérer T4 avec excluded vide" — T4 supprimé
> - Ex-7.11 "Collision T5 bulk + T1 création" — T5 supprimé

---

## 8. États et transitions

M12 ne porte pas d'état propre (moteur stateless). Impact sur états des entités amont :

### Impact sur `collectes_tms.statut_dispatch`

(propagation A1 2026-04-25 — alignement enum 6 valeurs ; revue sobriété 2026-04-29 — auto-relance W3 supprimée)

| État avant                           | Trigger M12                            | État après                                                                                       |
| ------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| (création)                           | T1                                     | `a_attribuer` (inchangé, juste suggestion renseignée)                                            |
| `a_attribuer`                        | Ops valide suggestion                  | `attribuee_en_attente_acceptation` (via M02, pas M12 directement)                                |
| `rejetee_par_prestataire`            | T2 (recalcul affichage)                | `rejetee_par_prestataire` (inchangé — Ops réattribue manuellement via M02 W3 puis nouveau cycle) |
| `acceptee` ou `en_attente_execution` | T3 re-confirmation, branche différente | inchangé (flag `re_confirmation_requise = true`, à trancher Ops)                                 |

> **Transitions supprimées (revue sobriété 2026-04-29)** :
>
> - `attribuee_en_attente_acceptation → attribuee_en_attente_acceptation` (auto-relance OK)
> - `attribuee_en_attente_acceptation → a_attribuer` (auto-relance KO cascade max)
> - `a_attribuer → a_attribuer` (T5 bulk)

### Impact sur `collectes_tms.refusee_par_prestataire_id[]`

Colonne supprimée (revue sobriété 2026-04-29). Historique refus reconstituable via `suggestions_attribution_log.detail.prestataires_exclus` ou via lecture des transitions sur `audit_logs`.

### Impact sur `collectes_tms.suggestion_detail.cascade_depth`

Concept supprimé (revue sobriété 2026-04-29) — auto-relance W3 retirée, cascade_depth n'a plus de sens.

---

## 9. Notifications

| #   | Destinataire | Canal | Condition                                                          | Template / Contenu                                                                                                              |
| --- | ------------ | ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| N1  | Ops Savr     | Email | T1 suggestion émise `aucun_prestataire`                            | "Collecte #{id} — aucune suggestion possible ({raison})"                                                                        |
| N2  | Ops Savr     | Email | T3 re-confirmation avec branche différente                         | "Modif collecte #{id} ({nb_pax ancien}→{nouveau}) : suggestion bascule {branche ancienne}→{nouvelle}. Re-confirmation requise." |
| N3  | Admin TMS    | Email | Alerte M11 gravite=critical (aucun_prestataire)                    | Cf. [[M11 - Alerting et monitoring ops]]                                                                                        |
| N4  | Admin TMS    | Email | Alerte M11 gravite=warning (presta sans grille, coords manquantes) | Idem                                                                                                                            |

> **Notifications supprimées (revue sobriété 2026-04-29)** :
>
> - Ex-N2 banner T5 bulk re-compute terminé — T5 supprimé
> - Ex-N3 toast T2 auto-relance réussie — auto-relance supprimée
> - Ex-N4 alert T2 cascade refus max atteinte — cascade supprimée
> - Web Push + toasts in-app remplacés par email seul (cohérent M02 D9 revue sobriété 2026-04-29)

**Pas** de notification au prestataire, ni au chauffeur, ni au traiteur — M12 est interne Savr.

---

## 10. Performance cibles

| Métrique                                                               | Cible V1                                               | Mesure                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------- |
| p95 durée calcul M12 (sans appel Everest)                              | < 300 ms                                               | `suggestions_attribution_log.duree_calcul_ms` |
|                                                                        | **Caduc (A4 2026-05-09, purge F3)** — plus d'appel API | —                                             |
| Indexation `collectes_tms(suggestion_prestataire_id, statut_dispatch)` | < 5ms lookup                                           | EXPLAIN ANALYZE                               |

**Stratégies performance** :

- Fonction SQL plpgsql pour le cœur de l'algo (évite allers-retours TS ↔ DB).
- **Caduc (A4 2026-05-09, purge F3)** — check local, pas de cache.
- Index composite ciblés sur `collectes_tms(statut_dispatch, suggestion_branche_r1_code)` pour monitoring M13.

**Hors scope V1** : optimisation multi-prestataires sur fenêtre temporelle (TSP ou linear programming), prévu M15 V2. Pas de bulk re-compute V1 (revue sobriété 2026-04-29).

---

## 11. Décisions structurantes prises

| #   | Décision                                                                                                      | Alternatives écartées                                                      | Raison                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| D1  | M12 = moteur backend pur, pas d'UI dédiée                                                                     | Écran M12 autonome avec historique + re-run manuel                         | Complexité UI + V1 80/20 — le monitoring dans M13 suffit. Tous les triggers sont automatiques                    |
| D2  | 3 triggers explicites (T1-T3, revue sobriété 2026-04-29)                                                      | Trigger unique "on INSERT/UPDATE" générique                                | Traçabilité — chaque trigger_source alimente un compteur distinct dans monitoring M13                            |
| D3  | 4 colonnes `collectes_tms` + table `suggestions_attribution_log` append-only                                  | Tout stocker dans JSONB sur `collectes_tms` / tout stocker dans log séparé | Hybride retenu : colonnes denormalisées pour lookup rapide E1 Dispatch M02 + log complet pour audit et métriques |
| D4  | → **Supprimé revue sobriété 2026-04-29**                                                                      | Table `refus_history` normalisée                                           | Auto-relance W3 supprimée, exclusion runtime n'a plus d'usage. Historique reconstituable depuis log              |
| D5  | → **Supprimé revue sobriété 2026-04-29**                                                                      | Obligatoire                                                                | Audit override entièrement retiré V1                                                                             |
| D6  | → **Supprimé revue sobriété 2026-04-29**                                                                      | 1 cascade / 3 cascades                                                     | Auto-relance W3 supprimée. Ops réattribue manuellement après refus                                               |
| D7  | → **Caduc (A4 2026-05-09, purge F3 2026-06-07)** — vérification locale `everest_codes_postaux`, plus de cache | —                                                                          | —                                                                                                                |
| D8  | V1 flag manuel `a_toutes_indisponible` (pas API availabilities)                                               | API Everest availabilities V1                                              | Complexité intégration V1 rejetée. Ops déclare indispo en 2 clics M13 — suffit en régime de croisière            |
| D9  | → **Caduc (A4 2026-05-09, purge F3 2026-06-07)** — pas d'appel API, pas de fallback nécessaire                | —                                                                          | —                                                                                                                |
| D10 | Tri province secondaire = `nb_collectes_6_mois_cache ASC`                                                     | Alphabétique / score fiabilité (V2)                                        | Répartit la charge sans complexité. Calibre le V2 sans préjuger                                                  |
| D11 | `admin_tms` seul peut modifier `parametres_tms.attribution`                                                   | `ops_savr` autorisé                                                        | Ces seuils pilotent la marge Strike/Marathon/A Toutes! — pas sujet ops quotidien                                 |
| D12 | → **Supprimé revue sobriété 2026-04-29**                                                                      | Log minimal                                                                | Auto-relance W3 supprimée. Traçabilité réduite à l'INSERT log + audit_logs basique attribution M02               |
| D13 | Dashboard monitoring dans M13, pas standalone                                                                 | Écran dédié M12 monitoring                                                 | Toutes les infos d'admin système TMS dans M13 — cohérence UX Admin                                               |
| D14 | Rétention `suggestions_attribution_log` = 2 ans                                                               | 5 ans (comme `audit_logs`) / 1 an                                          | Volume estimé 140k lignes sur 2 ans — suffit pour calibrer R1 V2. Pas obligation légale comme `audit_logs`       |
| D15 | `nb_collectes_6_mois_cache` colonne dans `shared.prestataires` mise à jour par trigger                        | Calcul temps réel COUNT                                                    | Scan table `collectes_tms` inacceptable à chaque suggestion. Cache + trigger = bon compromis                     |
| D16 | → **Supprimé revue sobriété 2026-04-29**                                                                      | Synchrone bloquant UI                                                      | T5 bulk re-compute supprimé — modifs paramètres impactent uniquement les nouvelles collectes                     |

---

## 12. Questions ouvertes — tranchées 2026-04-24

Les 9 questions posées à la rédaction initiale ont été tranchées lors de la session de clôture 2026-04-24. État final post-revue sobriété 2026-04-29 :

1. — **TRANCHÉ 2026-04-24**. `shared.prestataires.code` immutable post-création.
2. — **TRANCHÉ 2026-04-24 : anticipation architecture, pas de spec V1**.
3. — **TRANCHÉ 2026-04-24 : SUPPRIMÉ V1**. Pas d'alerte automatique sur seuils de qualité.
4. — **TRANCHÉ 2026-04-24 : V2**.
5. — **TRANCHÉ 2026-04-24 : V2 sans pré-instrumentation V1**.
6. — **CADUC (revue sobriété 2026-04-29)**. Colonne supprimée, plus d'historique runtime à effacer.
7. — **CADUC (revue sobriété 2026-04-29)**. T5 supprimé.
8. — **TRANCHÉ 2026-04-24 : V2 confirmé**.
9. — **CADUC (revue sobriété 2026-04-29)**. T5 supprimé.

---

## 12bis. Questions ouvertes résiduelles V1 (à surveiller)

Aucune question bloquante. Points à surveiller en régime de croisière :

- Taux d'override Ops par branche R1 (consultation manuelle M13) — signal de recalibrage R1 nécessaire.
- Temps Ops sur flag `a_toutes_indisponible` — déclencheur V2 API `availabilities`.
- Apparition d'un 2ème presta ZD ou d'un contrat ZD province — déclencheur spec dédiée.

---

## 12ter. Alertes M11 émises par M12 (propagation M11 2026-04-24)

> **Normatif (R_M11.1)** : tous les triggers M12 utilisent `tms.alerte_emit(code, ...)` avec codes canoniques catalogue.

| Code canonique          | Criticité | Trigger M12                                                                                                                                                             |
| ----------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `m12_aucun_prestataire` | critical  | 0 prestataire couvre la zone (branche `aucun_prestataire` R1.5)                                                                                                         |
|                         | —         | **Caduc sur ce flux (A4 2026-05-09, purge F3 2026-06-07)** — plus d'appel API dans l'attribution. Le code reste émis par M14 (passage de commandes), hors périmètre M12 |

> **Code supprimé (revue sobriété 2026-04-29)** : `m12_cascade_max_atteinte` — auto-relance W3 supprimée.

**Code dégagé Bloc 3 sobriété 2026-04-25 (A1)** : `m14_everest_coverage_stale` (ex-`info`) retiré du catalogue M11. Cache coverage Everest > 7j sans rafraîchissement → trace via `tms.integrations_logs`.

**Résolution auto W7** : `m12_aucun_prestataire` résolue auto dès création prestataire couvrant la zone (trigger `shared.prestataires` AFTER INSERT/UPDATE). → **N/A revue sobriété §05 2026-05-01 D2** (code supprimé V1, cas impossible par construction).

---

## 13. Liens

- [[../03 - Périmètre fonctionnel TMS#M12 — Attribution transporteur]] — règles R1 détaillées macro
- [[../04 - Data Model TMS]] — tables `collectes_tms`, `shared.prestataires`, `grilles_tarifaires_prestataires`, `parametres_tms`
- [[../05 - Règles métier TMS#R1 — Attribution transporteur (M12)]] — règles R1.1/R1.2/R1.3
- [[../08 - Contrat API Plateforme-TMS]] — webhooks `tms/collecte-acceptee` (revue sobriété 2026-04-29 — source `tms_auto_relance` supprimée), payload inchangé
- [[../09 - Authentification et permissions TMS]] — RLS `suggestions_attribution_log` (admin_tms + ops_savr read), `parametres_tms.attribution` (admin_tms write)
- [[M01 - Réception ordres de collecte]] — trigger T1 (création collecte) + T3 (re_confirmation_requise M01 D6)
- [[M02 - Dispatch Ops Savr]] — consommation suggestions dans E4 modal (revue sobriété 2026-04-29 — bouton "Re-suggérer" T4 + W6 enrichissement override supprimés)
- [[M06 - Référentiel prestataires]] — fournit `shared.prestataires.code` canonique et `coords_siege_*`, `rayon_intervention_km`
- [[M11 - Alerting et monitoring ops]] — alertes `aucun_prestataire`, presta sans grille (cascade max supprimée revue sobriété 2026-04-29)
- [[M13 - Administration TMS]] — paramétrage `parametres_tms.attribution` + panneau monitoring M12
- [[M14 - Intégration Everest (A Toutes!)]] — passage de commandes A Toutes! ( caduc A4 2026-05-09 — couverture = check local)
- [[../01 - Cahier des charges App/04 - Data Model]] — `shared.prestataires` (cross-schema)
- [[../01 - Cahier des charges App/08 - APIs et intégrations]] — webhooks TMS → Plateforme inchangés

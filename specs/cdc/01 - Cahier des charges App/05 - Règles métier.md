# 05 - Règles métier


---

## Principe de lecture

Ce fichier décrit les règles de gestion qui gouvernent le comportement de la Plateforme Savr. Il est destiné à être lu par Claude Code avant tout développement des modules métier. Chaque règle précise : le déclencheur, la logique exacte, les cas limites, et l'acteur responsable.

---

## 1. Tarification Zéro-Déchet

### Grille tarifaire (catalogue de méthodes — refonte 2026-05-26)

La base de prix ZD vient du **catalogue** `grilles_tarifaires_zd` (voir section 04). Plusieurs grilles coexistent (méthodes `paliers` | `fixe_variable`), chaque organisation est rattachée à une grille via `organisations.grille_tarifaire_zd_id` (NULL → grille `est_defaut`). Chaque ligne de grille porte une **formule affine** `prix_base_ht + prix_par_couvert_ht × pax` sur sa tranche.

**Grille par défaut « Standard paliers »** (`est_defaut=true`, seed initial) :

| Tranche pax | prix_base_ht | prix_par_couvert_ht | Prix HT |
|-------------|--------------|---------------------|---------|
| 1 – 250 | 450 € | 0 | 450 € |
| 251 – 500 | 600 € | 0 | 600 € |
| 501 – 750 | 800 € | 0 | 800 € |
| 751 – 1 000 | 1 000 € | 0 | 1 000 € |
| > 1 000 | 0 € | 1 € | 1 €/pax (ex : 1 200 pax = 1 200 €) |

Le palier > 1 000 (1 €/pax) est désormais exprimé proprement en affine (`prix_base_ht=0`, `prix_par_couvert_ht=1`, borne inférieure 1 001) — plus de cas spécial dans le code.

**Exemple grille « Forfait + variable »** : une ligne `[1, null]` avec `prix_base_ht=200`, `prix_par_couvert_ht=1` → 200 € + 1 €/pax. Affectée à une organisation via `grille_tarifaire_zd_id`.

**Règle d'application** : la grille (donc la base de prix) est déterminée par l'organisation programmatrice et le `evenements.pax` au moment de la facturation. **Retiré V1 (2026-05-29)** : pax unique au niveau événement, pas d'override par collecte ; multi-jours à pax variable reporté V2. La composition base + remises est figée dans `factures_collectes.tarif_detail` + `montant_ligne_ht`. Si la grille évolue entre programmation et facturation, c'est la grille en vigueur à la facturation qui s'applique (sauf engagement contractuel — CGV). Voir la résolution complète ci-dessous, [[#Tarifs et remises — résolution du prix]].

**Modification tarifaire** : pour modifier une grille, l'Admin Savr ferme la grille (`grilles_tarifaires_zd.valide_jusqu`) et en crée une nouvelle (entête + lignes). Pas de modification rétroactive ; les collectes passées conservent leur calcul via `tarif_detail`.

---

## 2. Algorithme d'attribution Anti-Gaspi

### Objectif

Pour chaque collecte Anti-Gaspi programmée, l'algorithme recommande une association bénéficiaire + un transporteur (si nécessaire). La recommandation est ensuite validée ou modifiée par l'Admin Savr avant envoi.

### Sélection — Association (refonte 2026-05-09)

**Filtres binaires d'éligibilité** (toutes les conditions doivent être vraies) :

| Condition | Source |
|-----------|--------|
| `associations.actif = true` | Référentiel |
| Région association = région de l'événement | `associations.region = lieux.region` |
| **Horaires compatibles** : plage horaire de la collecte chevauche `associations.horaires_ouverture` | Critère éliminatoire |
| **Capacité suffisante** : `capacite_max_beneficiaires × 2 > volume_estime_repas` (refonte 2026-05-09) — l'association peut absorber au moins la moitié du volume | Filtre métier |

**Tri** : distance Haversine croissante entre `lieux.latitude/longitude` et `associations.latitude/longitude`. **Pas de scoring sur 100 points** (refonte 2026-05-09 — pondération 60/40 ajustable supprimée car non utilisée en pratique). La règle métier "association ouverte la plus proche ayant la capacité" se traduit en filtre binaire (capacité) + tri unique (distance).

**Top 3** = les 3 plus proches respectant tous les filtres. Top 1 = recommandation principale. Top 3 affiché Admin pour arbitrage manuel.

> **Note refonte 2026-05-03** : le champ `Contraintes aliments` (froid/chaud/végé/halal) du formulaire de programmation AG a été supprimé (cf. [[06 - Fonctionnalités détaillées/01 - Formulaire de programmation de collecte]]). L'algo n'en dépendait pas en V1.

**Si aucune association n'est éligible** : alerte Admin Savr immédiate, pas de recommandation automatique, traitement entièrement manuel via recherche libre.

### Sélection — Transporteur province (refonte 2026-05-09)

**Périmètre** : sélection transporteur AG **hors Île-de-France**. En IDF, ce sont les règles dur 3 branches qui s'appliquent (cf. ci-dessous). A Toutes! et Marathon sont modélisés dans `transporteurs` (refonte 2026-05-09).

**Filtres binaires d'éligibilité** :

| Condition | Source |
|-----------|--------|
| `transporteurs.actif = true` | Référentiel |
| Type prestation contient `ag` | `transporteurs.types_prestation` |
| Distance Haversine ≤ `transporteurs.rayon_intervention_km` | Refonte 2026-05-08 — calcul depuis coords géocodées |
| Compatibilité hiérarchique véhicule/lieu | Règle `R_compatibilite_vehicule_lieu` — au moins un `transporteurs.types_vehicules` ≤ `lieux.type_vehicule_max` |
| Grille tarifaire valide à la date de la collecte **(V2 — référentiel de coûts transporteur sur `tms.*`, hors V1 ; cf. Dashboard Bloc 3 Coûts descopé V1.1)** | Référentiel grilles |

**Tri** :
- Primaire : distance Haversine ASC
- Secondaire : `prestataires.nb_collectes_6_mois_cache` ASC (audit cohérence B3 2026-05-09 — répartit la charge entre prestataires équidistants, aligné TMS M12 §4.7). Algorithme paramétrable via `parametres_algo.province_tri_secondaire_code`.

**Code branche stocké** : `attributions_antgaspi.branche_attribution = 'ag_province_proximite'` (audit cohérence A3 2026-05-09 — alignement TMS M12, ex-`province` générique déprécié).

**Si aucun candidat éligible** → `branche_attribution = 'aucun_prestataire'`, alerte Admin Savr.

### Règles d'attribution transporteur Île-de-France (source de vérité, refonte 2026-05-09)

> **Source de vérité unique de la règle métier**. [[06 - Fonctionnalités détaillées/09 - Flux algo attribution AG (Admin)#2.3. Règles d'attribution transporteur AG — Île-de-France|§06.09 §2.3]] décrit le **workflow d'écran Admin** correspondant.

Logique figée alignée sur les contrats opérationnels A Toutes! (vélo cargo IDF jour) et Marathon (nuit / grosses collectes). Un scoring générique distance + véhicule produirait des recommandations contractuelles invalides → règles dur IDF, scoring uniquement pour la province.

**Inputs lus par la règle** :
- `lieux.region = 'IDF'` (déclencheur du basculement règles dur, sinon scoring province ci-dessus)
- `evenements.nb_pax`
- `collectes.heure_collecte`
- Délai en minutes entre `now()` et `collectes.heure_collecte` (sous-branche express vs programmé)
- `parametres_algo.a_toutes_indisponible` (flag opérationnel manuel)
- Couverture Everest = vérification locale `lieux.code_postal[:2] IN parametres_algo.everest_codes_postaux` (seed V1 `['75', '92', '93']`)

**Branches évaluées dans l'ordre** :

#### Branche 1 — Plage horaire nuit (Marathon)
- **Condition** : `heure_collecte < regle_ag_plage_velo_debut` (défaut 07:00) OU `heure_collecte ≥ regle_ag_plage_velo_fin` (défaut 20:00)
- **Résultat** : `transporteur_id = Marathon`, `branche_attribution = 'ag_marathon_nuit'`
- **Backup V1** : aucun (A Toutes! fermé la nuit). Si Marathon exclu → `branche_attribution = 'aucun_prestataire'`, alerte Admin Savr.

#### Branche 2 — Grand événement jour (Marathon)
- **Condition** : plage jour ET `nb_pax ≥ regle_ag_seuil_pax_velo` (défaut 600)
- **Résultat** : `transporteur_id = Marathon`, `branche_attribution = 'ag_marathon_volume'`
- **Backup** : si Marathon exclu, A Toutes! camion (service Everest) si toutes les conditions remplies — plage horaire jour active (mêmes bornes que vélo, décision 2026-05-09) + `a_toutes_indisponible = false` + adresse couverte Everest. Si OK → `ag_marathon_volume_backup_camion`. Sinon → `aucun_prestataire`.

#### Branche 3 — AG vélo jour (A Toutes! par défaut)
- **Condition** : plage jour ET `nb_pax < regle_ag_seuil_pax_velo`
- **Sous-branche selon délai** : délai `< regle_ag_seuil_h2_minutes` (défaut 90 min) → A Toutes! vélo express (Everest **74**, corrigé 2026-06-15 ex-75) `ag_velo_express` ; sinon → A Toutes! vélo programmé (Everest 71) `ag_velo_programme`.
- **Bascules** : `a_toutes_indisponible = true` OU adresse hors zone Everest → Marathon `ag_velo_fallback_marathon`. Si Marathon aussi exclu → `aucun_prestataire`.

#### Branche 4 — Camion express last-minute Everest *(DIV-3, décision Val 2026-06-15)*
- **Condition** : plage jour ET `nb_pax ≥ regle_ag_seuil_pax_velo` ET Marathon exclu/indisponible ET `a_toutes_indisponible = false` ET adresse couverte Everest ET délai `< regle_ag_seuil_h2_minutes`
- **Résultat** : `transporteur_id = A Toutes!`, service Everest **77** (camion express), `branche_attribution = 'ag_everest_camion_express'`
- **Usage** : last-minute camion quand Marathon ne peut pas répondre. Distinct de `ag_marathon_volume_backup_camion` (service 91, hors last-minute).
- **Fallback** : `a_toutes_indisponible = true` aussi → `aucun_prestataire`, alerte Admin.

**Modification `nb_pax` post-attribution (refonte audit sobriété 2026-05-09 A2)** : aucun re-calcul automatique de la branche, aucun template dédié. Si l'Admin souhaite changer de transporteur après modif `nb_pax`, il rouvre l'écran d'attribution et applique un override standard (motif libre `autre`). Justification : edge case rare en pratique.

**Stockage de la branche** : `attributions_antgaspi.branche_attribution` (text NOT NULL, **9 valeurs canoniques** + `province` pour hors IDF — +1 `ag_everest_camion_express` 2026-06-15).

**Source de vérité paramètres** : Plateforme `parametres_algo` V1+V2. Le TMS V2 lit (jamais n'écrit) — voir §06.09 §7.2 et §04 `parametres_algo`. Application TMS dans [[../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées/M12 - Attribution transporteur|M12 §4]].

**Cascade orchestration** (cf. §06.09 §3) :
- V1 sans TMS : appel direct API Everest (A Toutes!) ou MTS-1 (Marathon, province) depuis la Plateforme.
- V2 avec TMS : webhook E2 vers TMS Savr → TMS lit `parametres_algo` Plateforme et ré-applique M12 → orchestre Everest/dispatch interne → statut remonté via webhook S2.

#### Grille tarifaire A Toutes! (Vélo Frais) — V1 2026-04-28

| Type de course | Zone | Programmé H+2 | Express >1.5h |
|----------------|------|--------------|---------------|
| Course complète (collecte + livraison) | Paris | 38 € | 57 € |
| Course complète (collecte + livraison) | Communes limitrophes | 51 € | 75 € |
| Course incomplète (livreur présent, aucun repas collecté) | Paris | 19 € | 28,5 € |
| Course incomplète (livreur présent, aucun repas collecté) | Communes limitrophes | 25,5 € | 37,5 € |

Ces tarifs sont remontés via Everest (tarifs réels exposés par l'API). Seed V1 à injecter dans `courses_logistiques` / `parametres_algo` selon l'implémentation choisie côté TMS.

### Auto-accept

Configurable par l'Admin Savr par combinaison `(association_id, type_evenement_id)`. Quand activé, l'attribution recommandée par l'algorithme est automatiquement validée sans intervention humaine, et les emails sont envoyés directement.

**Condition d'activation** : décision Admin Savr via le tableau de bord (pas de règle algorithmique d'activation automatique).

**Traçabilité** : `attributions_antgaspi.mode_validation = 'auto_accept'` + `valide_par = null` (refonte 2026-05-09 sobriété D2 — ex-bool `recommandation_auto` remplacé par enum 3 valeurs).

---

## 3. Packs Anti-Gaspi — Décrémentation et blocage

### Grille tarifaire de référence V1

La grille tarifaire AG publique est gérée comme référentiel versionné (table [[04 - Data Model#Table tarifs_packs_ag|`tarifs_packs_ag`]]) — administrée dans `06 - Back-office Admin Savr` §9 Paramètres > Tarifs Anti-Gaspi (publics), à côté de la grille ZD :

| Offre | Volume | Prix unitaire HT | Montant total HT | Mensualisable |
|-------|--------|-----------------|-----------------|--------------|
| Unitaire (à la collecte) | 1 collecte | 590 € | 590 € | Non |
| Pack 10 | 10 collectes | 500 € | 5 000 € | Non |
| Pack 30 | 30 collectes | 460 € | 13 800 € | Oui — 3 mensualités de 4 600 € |
| Pack 60 | 60 collectes | 390 € | 23 400 € | Oui — 6 mensualités de 3 900 € |
| Personnalisé | Libre | Libre | Libre | Selon accord |

**Mensualisabilité** : indication contractuelle uniquement. Les crédits sont alloués **en totalité dès la création du pack** — la plateforme ne gère pas le calendrier de paiement (traité hors-plateforme ou dans Pennylane).

**Type `personnalise`** : pour les partenaires avec négociation spécifique (ex : GL Events), l'Admin crée un pack avec volume et prix unitaire libres. Pas de ligne dans `tarifs_packs_ag` ; conditions documentées dans `packs_antgaspi.commentaires`.

### Règle V1 — Pack unique actif (refonte 2026-05-08)

**Un traiteur, une agence ou un gestionnaire de lieux a au plus UN pack `packs_antgaspi.statut = actif` à un instant T.** Pas de FIFO multi-packs en V1. Double protection : (1) validation applicatif lors de l'INSERT côté API — un INSERT avec un pack actif existant échoue avec un message explicite ; (2) partial unique index DB-level (`CREATE UNIQUE INDEX uniq_pack_actif_par_org ON packs_antgaspi (organisation_id) WHERE statut = 'actif';`) garantissant l'invariant même en cas de race condition applicative.

**Implication renouvellement** : avant d'activer un nouveau pack, l'Admin doit clôturer l'ancien :
- Si l'ancien pack est `epuise` (`credits_consommes = credits_initiaux`) → création directe du nouveau pack.
- Si l'ancien pack est `actif` avec crédits restants (cas rachat anticipé) → l'Admin **annule** l'ancien pack (`statut = annule`, motif obligatoire) avant de créer le nouveau, et **reporte manuellement les crédits restants** sur le nouveau pack en ajustant `credits_initiaux` à la création (motif loggé dans `packs_antgaspi.commentaires`). Pas de logique automatique de transfert.

**Justification** : 1 solde affiché côté traiteur (UX simple), zéro logique FIFO à coder, transfert manuel < 5 cas/an V1 estimés.

### Débit d'un crédit

**Déclencheurs** *(2e déclencheur ajouté 2026-06-07 — test scenarios §06.01 F2, arbitrage Val)* :
1. `collectes.statut` passe à `realisee` (signalé par le TMS Savr via API) — cas nominal.
2. **Annulation tardive** : transition `collectes.statut → annulee` d'une collecte AG si annulation reçue **< 12h avant l'heure de collecte** OU **après mandat prestataire** (cf. §4bis) — trigger DB dédié `trg_pack_debit_annulation_tardive`. Le client « consomme » un crédit même si la collecte n'a pas eu lieu (aligné §4bis « plein tarif = débit pack AG »).

**Action** (identique pour les 2 déclencheurs) :
1. `packs_antgaspi.credits_consommes` += 1 sur le pack `actif` unique de l'organisation programmatrice (`evenements.organisation_id`)
2. Si `credits_consommes = credits_initiaux` → `packs_antgaspi.statut` = `epuise`
3. `collectes` reçoit une référence au pack consommé (`pack_antgaspi_id`) pour traçabilité (+ `audit_log` `action='pack_debite_annulation_tardive'` pour le déclencheur 2)

**Garde-fou** : jamais `credits_consommes > credits_initiaux` (le débit ne cible qu'un pack `actif` ; CHECK DB en double sécurité).

**Cas sans pack actif au moment du débit** *(tranché Val 2026-06-07 — F3)* : si aucun pack `actif` n'existe à l'instant du déclencheur (pack devenu `epuise` ou `annule` entre programmation et réalisation — ex. 2 collectes AG programmées sur 1 crédit restant) → **aucun débit, aucune facturation automatique**. Alerte Admin `ag_realisee_sans_pack_actif` (ou `ag_annulee_tardive_sans_pack_actif`) ; l'Admin arbitre au cas par cas (facture manuelle ou geste commercial).

### Blocage si pack épuisé

Quand le pack `actif` unique passe à `epuise` et qu'aucun nouveau pack `actif` n'existe pour l'organisation :
- La programmation d'une nouvelle collecte AG est bloquée côté interface (bouton désactivé, message explicite, voir [[06 - Fonctionnalités détaillées/04 - Espace client traiteur#Bloc 4 AG — Mon pack AG]])
- Une notification est envoyée à l'Admin Savr : "Le pack Anti-Gaspi de [organisation] est épuisé. Renouvellement requis avant programmation."
- La programmation d'une collecte ZD reste possible sans restriction (les 2 types sont indépendants)

### Annulation d'une collecte AG : recrédit automatique *(refonte 2026-05-08)*

Le crédit pack étant débité **uniquement au statut `realisee`** (cf. règle "Débit d'un crédit" ci-dessus), le traitement du recrédit dépend du moment de l'annulation :

**Annulation avant `realisee`** (statuts `programmee`, `validee`, `en_cours`) — cas le plus courant, déclenché par le traiteur ou l'Admin :
- Aucun débit pack n'a eu lieu → aucun recrédit nécessaire, le pack reste intact.
- La collecte AG annulée n'apparaît plus dans la consommation du pack.

**Annulation après `realisee`** (Admin Savr uniquement, cas exceptionnel — cf. §4 transitions de statut) :
- **Recrédit automatique** déclenché par trigger DB sur la transition `collectes.statut: realisee → annulee` :
  1. `packs_antgaspi.credits_consommes -= 1` (sur le pack identifié par `collectes.pack_antgaspi_id`)
  2. Si `packs_antgaspi.statut = 'epuise'` ET `credits_consommes < credits_initiaux` après recrédit → bascule automatique vers `actif` (le pack redevient consommable, programmation AG redevient possible)
  3. UPDATE `collectes.pack_antgaspi_id = NULL` (la collecte annulée n'est plus rattachée au pack)
  4. Audit_log automatique : `action = 'pack_recredite_annulation_collecte'`, `collecte_id`, `pack_antgaspi_id`, motif d'annulation hérité de `collectes.motif_annulation` (obligatoire pour annulation post-`realisee`)
- Trigger DB pour atomicité (vs validation applicative) — pas de race condition possible entre annulation et débit concurrent.

**Cas particulier — Annulation client < 12h avant créneau** (cf. §4bis Annulation last minute) — *révisé 2026-06-07 (test scenarios §06.01 F2, arbitrage Val : §4bis fait foi)* : **Le « plein tarif » AG = débit d'un crédit pack** : trigger dédié `trg_pack_debit_annulation_tardive` sur la transition `→ annulee` (cf. « Débit d'un crédit », déclencheur 2). Pas de facture standalone si un pack est actif. Si **aucun pack actif** à cet instant → aucun débit ni facture automatique, alerte Admin + arbitrage manuel (F3). L'ancien invariant « 1 crédit pack = 1 collecte effectivement réalisée » est **amendé** : 1 crédit = 1 collecte réalisée OU annulée tardivement.

**Articulation avec le recrédit** : une collecte débitée par annulation tardive porte `pack_antgaspi_id` renseigné et est déjà `annulee` → le trigger de recrédit (`realisee → annulee`) ne s'applique pas (transition différente), aucun double mouvement possible. Un recrédit exceptionnel reste possible via l'override Admin « Ajuster crédits ».

**Override Admin** : l'action manuelle "Ajuster crédits" (§06 §8 onglet Packs AG) reste disponible pour les cas exceptionnels où le recrédit auto est inadapté (correction d'erreur saisie, geste commercial sortant du cadre, etc.). Motif obligatoire ≥ 10 caractères loggé dans `audit_log`.

---

## 4. Statuts des collectes — Transitions et responsabilités

```
brouillon → programmee → validee (auto) → en_cours → realisee → cloturee (auto)
                             ↑                                          ↑
                             │ validation admin UNIQUEMENT              │
                             │ si modification/annulation post-programmation
                             ↓
                        annulation_demandee → (validation admin) → annulee
```

| Transition | Déclencheur | Acteur |
|-----------|-------------|--------|
| `brouillon` → `programmee` | Soumission du formulaire de programmation. **ZD** : déclenche **immédiatement** l'envoi au TMS (E1 `POST /collectes`, `statut_tms` `non_envoye`→`a_attribuer`). **AG** : **pas d'envoi à la soumission** — la collecte entre dans la file d'attente d'attribution Admin (`statut_tms` reste `non_envoye`) ; l'ordre n'est envoyé au transporteur qu'à la validation d'attribution (cf. note « Spécificité AG » ci-dessous + [[06 - Fonctionnalités détaillées/09 - Flux algo attribution AG (Admin)]] §3). **Aucune validation Admin sur le cycle ZD** (cf. Principe V1 ci-dessous). | Le programmeur (Traiteur-Commercial, Agence ou Gestionnaire de lieux) ou Admin Savr |
| `programmee` → `validee` | **Automatique (trigger DB)** — acceptation de la collecte par le **prestataire logistique** (`statut_tms`→`acceptee` ; ZD : webhook `collecte-acceptee` ; AG V1 : confirmation Everest synchrone positive ou signal positif explicite MTS-1 §3bis — **plus d'acceptation implicite par délai depuis 2026-05-29** ; AG V2 : webhook TMS). Le trigger `fn_sync_statut_collecte_from_tms` dérive `validee` de `statut_tms` (cf. [[04 - Data Model]] §`statut_tms`, arbitrage 2a). L'envoi au prestataire a déjà eu lieu (ZD : E1 à la soumission ; AG : à la validation d'attribution) — il n'est **pas** le déclencheur de `validee`. | Système (dérivé de `statut_tms`) |
| `validee` → `en_cours` | Démarrage de la collecte signalé par le TMS — **dès qu'au moins une** des tournées rattachées démarre (multi-camions, cf. R_statut_collecte_multi_tournees) | TMS Savr (automatique) |
| `en_cours` → `realisee` | Fin de collecte signalée par le TMS via le **S5 terminal unique** (pesées agrégées des N camions + équivalent roll). Le TMS attend que **toutes** les tournées de la collecte soient terminées avant d'émettre ce S5 (cf. R_statut_collecte_multi_tournees) | TMS Savr (automatique) |
| `realisee` → `cloturee` | **Automatique** — clôture après embargo H+24 (`realisee_at + 24h`), sans action Admin. Bordereaux, attestations et rapport RSE générés au batch J+1 à 6h (voir section 6) | Système (cron `cloture-embargo`) |

> **Frontière `programmee` / `validee` et envoi TMS (Sujet 2, propagation 2026-05-26)** : l'envoi au TMS (E1 `POST /collectes`) a lieu **à la soumission du formulaire** (`brouillon`→`programmee`), pas au passage `validee`. `programmee` couvre tout le dispatch (`statut_tms ∈ non_envoye, a_attribuer, attribuee_en_attente_acceptation`) ; `validee` = collecte **acceptée par le prestataire** (`statut_tms ∈ acceptee, en_attente_execution`). La sous-transition `programmee ↔ validee` est **dérivée de `statut_tms`** par le trigger DB `fn_sync_statut_collecte_from_tms` (source de vérité = `statut_tms`, arbitrage 2a) — aucune logique applicative ne met à jour `statut` indépendamment sur cette plage, ce qui élimine tout risque de désync. Le trigger ne touche jamais aux statuts terminaux (`en_cours`/`realisee`/.../`annulee`), pilotés par les webhooks et le batch.

> **Spécificité AG — même machine à états, envoi décalé (Sujet AG statuts, 2026-05-29)** : la collecte AG suit **exactement la même machine** que la ZD (`programmee → validee → en_cours → realisee → cloturee`) avec la même dérivation `validee` depuis `statut_tms`. Seule différence : le **moment de l'envoi prestataire**. La ZD est dispatchée automatiquement dès la soumission (E1) ; l'AG nécessite une décision d'attribution Admin (asso + transporteur, file d'attente [[06 - Fonctionnalités détaillées/09 - Flux algo attribution AG (Admin)]] §1). Donc : (1) soumission AG → `programmee` / `statut_tms = non_envoye`, en attente d'attribution ; (2) validation d'attribution Admin (ou auto-accept) → reste `programmee`, l'ordre part en cascade asynchrone → `statut_tms = attribuee_en_attente_acceptation` ; (3) acceptation transporteur → `statut_tms = acceptee` → trigger → `validee`. **En V1** (AG via Everest direct, sans TMS Savr), c'est la **Plateforme** qui écrit `statut_tms` ; **en V2**, le TMS Savr le pilote via webhooks comme la ZD (arbitrage 2a). La validation d'attribution Admin **ne pose jamais `validee` directement** — l'ancien comportement (forçage `validee` à la validation) est supprimé.

#### R_statut_collecte_multi_tournees *(refonte multi-camions 2026-05-25)*

Une collecte peut être servie par N tournées (relation N↔N via `collecte_tournees`, cf. [[04 - Data Model#Table : `collecte_tournees`]]). Règle d'agrégation du statut :

- **`en_cours`** : la collecte passe `en_cours` dès qu'**au moins une** de ses tournées démarre (premier webhook S5 `collecte-en-cours`). Les démarrages suivants des autres camions ne changent pas le statut (déjà `en_cours`).
- **`realisee` / `realisee_sans_collecte`** : la collecte passe à l'état terminal au **S5 terminal unique** (`collecte-terminee`). Le TMS n'émet ce S5 qu'une fois **toutes** les tournées de la collecte terminées et **après avoir agrégé les pesées** des N camions (responsabilité TMS — arbitrage 2026-05-25 option a). L'App ne calcule pas elle-même la complétude des tournées : elle reçoit un seul événement terminal, déjà agrégé.
- **`realisee_at`** : horodatage de réception de ce S5 terminal = départ de l'embargo H+24 du rapport (cf. [[12 - Reporting et exports]] §1.2).
- **Cas standard (1 tournée)** : la règle dégénère en `en_cours` au démarrage / `realisee` à la fin de l'unique tournée — comportement inchangé.

**Frontière App/TMS** : côté App, le contrat `collecte-terminee` reste **inchangé** (un seul S5 terminal par collecte, `pesees[]` déjà sommées). Le mécanisme TMS « attendre les N camions + agréger + émettre un seul S5 » est **différé en session `cdc-tms-savr`** (dispatch M02 + cardinalité `collectes_tms → N tournees`). Écart cross-CDC conscient tracé index + Suivi.

**Précision V1 (adapter MTS-1, polling — 2026-06-08) :** en V1 il n'y a **pas de webhook S5**. C'est l'**adapter MTS-1** qui joue le rôle du TMS V2 : il poll les N tours, détecte lui-même que **toutes** les tournées de la collecte sont terminées, **agrège les pesées** des N camions, puis produit le **même effet terminal** (`collectes.statut = realisee` + `realisee_at`). Les N camions sont décidés par Ops (`collectes.nb_camions_demande`, cf. [[04 - Data Model#Table : `collectes`]]). Côté App, la sémantique est strictement identique au cas V2 (un seul passage terminal, pesées déjà sommées) — seul le **déclencheur** diffère (détection adapter en V1 vs webhook S5 en V2). Aucun changement de structure.

**Tour KO partiel — états terminaux par tour (ajout 2026-06-10, challenge logistique, arbitrage Val)** : « toutes les tournées terminées » = chaque tour de la collecte a atteint un **état terminal MTS-1 ∈ {OK, PARTIAL, CANCELED, KO}** (jamais d'attente infinie sur un tour annulé). Règle d'agrégation :
- **Au moins un tour `OK`/`PARTIAL`** → la collecte passe `realisee` sur l'agrégat des pesées des seuls tours `OK`/`PARTIAL` ; si au moins un tour est `CANCELED`/`KO` → **alerte Ops in-app** « collecte partiellement servie (x/N camions) » (pas d'email, pas de Slack — convention alertes fonctionnelles in-app, cf. [[../01 - Cahier des charges App/07 - Observabilité/03 - Alertes]]).
- **Tous les tours `CANCELED`/`KO`** → `collectes.statut = 'rejetee_par_prestataire'` (visibilité dashboard, décision Val 2026-06-15) + `statut_tms = 'rejetee_par_prestataire'` + **alerte Admin in-app « réattribution requise »**. Retour file **Ops-driven** (réattribution/reprogrammation manuelle), pas de remise auto en file — la file `/pending` exige `statut = 'programmee'` (mapping [[08 - APIs et intégrations]] §3bis.6).
- Le cas 1 camion (N=1) dégénère sur les règles existantes.

**Concurrence de l'agrégation terminale (ajout 2026-06-11, revue adversariale R5/R6, arbitrages Val)** :
- **Transaction verrouillée** : l'agrégation prend `SELECT … FOR UPDATE` sur la ligne `collectes`, puis **relit sous ce lock** `collecte_tournees` + `nb_camions_demande` (jamais un set lu avant le lock — sinon Ops peut augmenter N entre la lecture et la décision → `realisee` posé alors qu'un camion 3 est en route, ses pesées perdues sur collecte clôturée). Si `COUNT(collecte_tournees) < nb_camions_demande` relu → abort (rangs en cours de création).
- **Transition idempotente** : `UPDATE … SET statut='realisee', realisee_at=now() WHERE statut IN ('validee','en_cours')` — 0 ligne = no-op strict (deux polls qui se chevauchent ne posent jamais deux fois `realisee`, et `realisee_at` — départ de l'embargo H+24 — n'est jamais écrasé).
- **Changement de N gaté** : la RPC Ops de modification de `nb_camions_demande` prend le même lock `collectes` et exige `statut IN ('programmee','validee','en_cours')` — **interdit dès `realisee`** : jamais de régression d'un état terminal ; ajouter un camion après coup = flux incident Admin (édition pesées + recalcul). Cf. [[04 - Data Model#Table : `collectes`]].
- **Anti-famine pesées** : une collecte `realisee` skippée par le batch J+1 (pesées incomplètes) depuis **> 48h** → escalade Admin « saisie manuelle requise » (cf. [[08 - APIs et intégrations]] §3bis.7).

**Principe V1** : le cycle de vie normal d'une collecte est **100% automatisé**. L'Admin Savr n'intervient PAS sur une collecte qui se déroule sans incident. Les rapports, factures, bordereaux et attestations sont générés et disponibles automatiquement.

**Validation admin requise UNIQUEMENT dans ces 3 cas** :
1. Demande d'annulation par le traiteur depuis son espace client
2. Modification post-programmation d'une collecte déjà `validee` ou `en_cours`
3. Incident signalé (collecte manquée, refus association, problème pesée)

**Vision V2** : automatiser également la validation des modifications/annulations sous conditions (ex: délai > 48h avant collecte = annulation auto, sinon validation admin).

### Annulation

**Depuis `brouillon` ou `programmee`** : annulation directe possible par le Traiteur-Commercial, le Traiteur-Manager, ou l'Admin Savr. *(Révisé 2026-06-07 — test scenarios §06.04 F1+F5, arbitrage Val : cette section fait foi, le flux §06.04 ex-uniforme `annulation_demandee` est scindé)* : si `statut_tms ≠ non_envoye` (collecte déjà poussée TMS — cas ZD dès la soumission), l'annulation directe déclenche **systématiquement E3 `DELETE /collectes/:id`** vers le TMS, quel que soit l'acteur (traiteur, Ops, Admin) — le prestataire est informé côté TMS sans délai. Email info (non bloquant) à l'Admin Savr. Le DELETE physique reste limité à `statut = 'brouillon'` (cf. §06.04 policy DELETE).

**Depuis `validee`** : le Traiteur (Commercial ou Manager) peut **soumettre une demande d'annulation** depuis son espace client. Cette demande :
1. Passe le statut à `annulation_demandee` (statut intermédiaire)
2. Déclenche une notification à l'Admin Savr : "Demande d'annulation pour [événement] par [traiteur]"
3. Si le prestataire logistique a déjà été mandaté (`attributions_antgaspi` ou ordre TMS envoyé) : notification automatique au prestataire
4. L'Admin Savr confirme ou refuse l'annulation → si confirmé, statut = `annulee`

**Depuis `en_cours` ou `realisee`** : Admin Savr uniquement, cas exceptionnel, avec champ obligatoire `motif_annulation`.

**Depuis `cloturee`** : impossible. Une collecte clôturée est archivée définitivement. Si erreur de clôture → émission d'un avoir (module facturation).

### Modification d'une collecte à venir (refonte 2026-05-04)

Le traiteur peut modifier librement les informations de toute collecte non encore réalisée depuis sa fiche collecte ([[06 - Fonctionnalités détaillées/04 - Espace client traiteur#Modification des informations d'une collecte à venir]]).

**Statuts autorisés** : `collectes.statut IN ('programmee', 'validee')` ET `collectes.statut_tms IN ('non_envoye', 'a_attribuer', 'attribuee_en_attente_acceptation', 'acceptee')`. Verrouillage UI dès `collectes.statut IN ('en_cours', 'realisee', 'realisee_sans_collecte', 'cloturee', 'annulee')` *(`manquee` retiré — audit sobriété §04 2026-05-25 D1)*.

> **Gates de statut canoniques (sobriété 2026-06-03 C2) — ne jamais réinscrire ces listes en dur dans une policy.** Deux gates distincts, à ne pas confondre :
> - **`f_collecte_editable(p_evenement_id uuid) RETURNS boolean`** — gate d'écriture **niveau événement**. Retourne `TRUE` si l'événement possède au moins une collecte au statut **`brouillon`, `programmee` ou `validee`** (couvre la création de brouillon ET la modification avant exécution). Référencé par les policies RLS sur la table `evenements` (ex. `traiteur_commercial` UPDATE, cf. [[09 - Authentification et permissions]]). Inclut `brouillon` car la ligne `evenements` est écrite dès la phase de brouillon du formulaire §06.01.
> - **Fenêtre de modification niveau collecte** = `collectes.statut IN ('programmee', 'validee')` (+ contraintes `statut_tms` ci-dessus) — c'est la règle décrite dans cette section, appliquée au niveau ligne `collectes` (modification depuis la fiche, policy agence `collectes` UPDATE [[06 - Fonctionnalités détaillées/11 - Espace client agence]]). **N'inclut pas `brouillon`** (un brouillon n'apparaît pas en fiche, il vit dans le formulaire). Cette section §05 §4 fait foi pour cette liste ; toute policy modifiant une ligne `collectes` s'y réfère.

**Champs modifiables** : tous les champs métier collecte/événement (date, heure, pax, contacts, notes, type d'événement, taille, `controle_acces_requis`).

> **Refonte 2026-05-05** : champ "type de pesée" retiré de la liste (champ orphelin, jamais défini en data model, jamais câblé côté TMS — cf. §06.04 décision suppression).

**Champs verrouillés UI (sobriété A4 2026-05-04)** :
- `traiteur_organisation_id` : immuable (un traiteur ne peut pas réattribuer la collecte à un autre traiteur).
- `type_collecte` (ZD / AG) : verrouillé. Pour changer de type, le traiteur doit **annuler la collecte et en programmer une nouvelle**. Évite la cascade DELETE+POST côté TMS, le recalcul tarif et la modale de confirmation dédiée. Volume estimé < 1% des modifs — alternative manuelle (annuler + reprogrammer) parfaitement acceptable V1.
- `lieu_id` : verrouillé pour les mêmes raisons. Tooltip UI : "Pour changer le lieu ou le type de collecte, annulez cette collecte et programmez-en une nouvelle."

**Pas de cut-off bloquant V1** — modulation par sévérité de l'alerte Ops :
- Modification ≥ 12h avant créneau : email Ops standard (`admin_modification_collecte_traiteur` priorité normale)
- Modification < 12h avant créneau : email Ops **priorité haute** (`admin_modification_collecte_traiteur` variante "urgence") + modal de confirmation côté traiteur
- Modification après début collecte : verrouillage UI

**Cascade TMS** : si `collectes.statut_tms ≠ non_envoye` (collecte déjà poussée vers le TMS), déclenchement endpoint E2 `PATCH /collectes/:id` vers TMS (voir [[08 - APIs et intégrations]]).

> **Précision M1.2 (2026-06-26)** : la modification d'un champ ÉVÉNEMENT TMS-pertinent (`contact_principal_*`, `contact_secours_*`, `nb_pax`) émet également E2 par collecte dispatchée rattachée à l'événement (push silencieux, pas de réacceptation). E2 est catch-all et inclut contacts + nb_pax (§08 l.156). `lieu_id` reste verrouillé — jamais de PATCH lieu (§08 l.158). Implémenté via `fn_modifier_evenement` (RPC, transactional outbox, row lock sur collecte avant INSERT `outbox_events`). Patch M1.2_20260626.

**Réacceptation prestataire** : si modification de `date_collecte` ou `heure_collecte` sur collecte `statut_tms = acceptee`, le statut TMS repasse à `attribuee_en_attente_acceptation` (réutilisation enum existant + flag `flags_jsonb.re_confirmation_requise = true` côté TMS, cf. M04 W10) → notification au prestataire pour re-confirmation. **Conséquence côté statut métier (Sujet 2, 2026-05-26)** : le trigger `fn_sync_statut_collecte_from_tms` ramène alors `statut` de `validee` à `programmee` (la collecte n'est plus acceptée tant que le prestataire n'a pas re-confirmé) — côté traiteur, la fiche repasse de « Confirmée » à « En cours d'organisation », ce qui reflète fidèlement l'état réel. Au retour `acceptee`, le trigger repasse `programmee`→`validee`. Modifications mineures (notes, contact secours, etc.) : push silencieux sans réacceptation, `statut` inchangé.

**Permissions** :
- Programmeur (`cree_par_user_id`) : autorisé
- Manager (`role = traiteur_manager`, même orga) : autorisé
- Collègue partagé : refusé (cohérent avec règle annulation)

**Audit** : toute modification logguée dans `audit_log` global avec `user_id`, `collecte_id`, `champ_modifie`, `ancienne_valeur`, `nouvelle_valeur`, `timestamp`, `cascade_tms` (bool), `priorite_urgence` (bool si <12h). Pas de table dédiée `collectes_modifications` (sobriété — `audit_log` couvre).

**Notification client organisateur** : aucune notification automatique au contact principal de la collecte ni au client organisateur. Ops Savr fait le filtre + relais cas par cas.

---

## 4bis. Gestion des incidents

### Collecte manquée par le prestataire logistique

**Définition** : le prestataire (Strike, Marathon, transporteur province, A Toutes!) ne s'est pas présenté ou n'a pas pu effectuer la collecte pour une raison qui lui est imputable (retard, panne, oubli, erreur de programmation).

**Règles** *(modélisation révisée audit sobriété §04 2026-05-25 D1 — statut `manquee` supprimé)* :
- `collectes.statut` = `annulee` + `incident_imputable_a` = `'prestataire'` + `motif_incident` renseigné (ex : "Prestataire non présenté"). Le no-show prestataire n'a plus de statut dédié : il est porté par l'annulation imputable.
- **Pas de facturation** au client (ni ZD, ni débit de pack AG)
- Notification automatique au client : "Un incident est survenu de notre côté lors de la collecte. Nous vous prions de vouloir nous en excuser. La collecte ne sera évidemment pas facturée."
- Alerte Admin Savr avec motif imputable au prestataire — à facturer potentiellement en pénalité au prestataire (hors V1, traitement manuel)
- Option de reprogrammation : création d'une nouvelle collecte liée à l'événement (`collectes.collecte_remplacee_id`)

### Annulation last minute par le client

**Définition** : le client (traiteur ou agence) annule une collecte après validation, dans un délai qui empêche la réallocation du prestataire.

**Règles V1** :
- Si annulation reçue **≥ 12h avant l'heure de collecte** : pas de facturation
- Si annulation reçue **< 12h avant l'heure de collecte** OU **après mandat prestataire** : facturation **plein tarif** — ZD : facture standard ; AG : **débit d'un crédit pack** via trigger `trg_pack_debit_annulation_tardive` *(confirmé Val 2026-06-07 — F2, cette section fait foi ; mécanique détaillée §3 « Débit d'un crédit » déclencheur 2 ; sans pack actif → alerte Admin + arbitrage manuel, F3)*
- **Pas de facturation partielle ni de pénalité** au-delà de ces règles en V1 (pas de dégressivité J-3/J-1)
- Notification automatique au client avec mention explicite de la règle de facturation

**Note** : ces seuils (12h, plein tarif) sont les valeurs V1 actées. À intégrer aux CGV. Évolution possible V2 : facturation dégressive (ex: 50% entre J-3 et J-1, 100% < J-1).

### Refus de l'association Anti-Gaspi

**Définition** : l'association accepte initialement puis se rétracte avant la collecte (capacité dépassée, fermeture imprévue).

**Règles** :
- Notification immédiate Admin Savr
- Relance de l'algorithme d'attribution sur les associations Top 2 et Top 3
- Si aucune alternative viable : collecte basculée en manuel (admin contacte les assocs hors algo) ou annulation de la partie AG sans facturation
- Le traiteur est informé du changement d'association

### Problème de pesée (divergence, doute)

**Définition** : la pesée TMS est incohérente ou contestée (ex: poids aberrant, désaccord traiteur).

**Règles** *(révision audit sobriété §04 2026-05-25 D1 — statut `en_reexamen` supprimé)* :
- Le traiteur peut contester depuis son espace client (**délai : 48h après réception du rapport de collecte** — décision Val 2026-04-28)
- La collecte **reste en statut `cloturee`** (pas de statut intermédiaire dédié) ; la contestation est tracée via `motif_incident` + une notification Admin
- Admin Savr vérifie avec le prestataire logistique
- Correction éventuelle → recalcul (force `realisee → cloturee` après correction des pesées, cf. §04 trigger taux_recyclage) → régénération du bordereau (`version` incrémentée) et du rapport RSE
- Si facturation déjà émise : émission d'un avoir + nouvelle facture

---

## 5. Génération des factures

### Zéro-Déchet — Mode par collecte

**Déclencheur** : `collectes.statut` passe à `cloturee`.

**Action** :
1. Création d'un brouillon de facture dans `factures` (type=`zero_dechet`, mode=`par_collecte`, statut=`brouillon`)
2. Création d'une ligne dans `factures_collectes` avec le tarif figé
3. **L'Admin Savr valide le brouillon** avant envoi à Pennylane (pas d'envoi automatique en V1)
4. Après validation admin : `factures.statut = en_attente_pennylane`, push API Pennylane ; `emise` + `pennylane_id` renseigné **uniquement après succès du push** *(corrigé test-scenarios 2026-06-07 — résidu stale qui décrivait `emise` avant le push ; le flux unique [[06 - Fonctionnalités détaillées/08 - Génération et édition facture (Admin)]] §2 fait foi)*

### Zéro-Déchet — Mode mensuel groupé *(réécrit décision F2 test-scenarios 2026-06-07, arbitrage Val — §06.08 §3 fait foi, ex-génération manuelle Admin)*

**Déclencheur** : automatique — batch J+1 6h, pour toute collecte `cloturee` d'une organisation en mode `mensuelle`.

**Action** :
1. Le batch ajoute la collecte (ligne `factures_collectes`) au **brouillon mensuel en cours** de l'organisation ; si c'est la première collecte de la période, le brouillon est créé
2. L'Admin valide le brouillon en fin de mois → envoi Pennylane (flux §06.08 §2)
3. Le sélecteur manuel multi-collectes (§06.08 §6) reste disponible pour rattrapage ponctuel

**Note V1** : pas d'automatisation complète. L'Admin valide toujours les factures avant envoi Pennylane. L'automatisation totale (génération + envoi sans intervention humaine) est à envisager en V2 une fois les processus stabilisés.

### Anti-Gaspi — Achat de pack (mode `globale_achat`)

**Déclencheur** : création d'un nouveau `packs_antgaspi` avec `mode_facturation=globale_achat` par l'Admin Savr.

**Action** :
1. Brouillon de facture créé (type=`achat_pack_antigaspi`, mode=`globale_pack`, montant=`packs_antgaspi.montant_total_ht`)
2. Admin valide → envoi Pennylane

### Anti-Gaspi — Facturation par collecte (mode `par_collecte`)

**Déclencheur** : `collectes.statut` passe à `cloturee` + pack associé en mode `par_collecte`.

**Action** :
1. Brouillon de facture créé (type=`collecte_antigaspi`, mode=`par_collecte`)
2. Montant : saisi manuellement par l'Admin Savr (non contraint par le prix de référence du pack)
3. Admin valide → envoi Pennylane

### Anti-Gaspi — Hors pack (négociation directe)

**Déclencheur** : collecte AG clôturée sans pack actif associé.

**Action** : idem mode `par_collecte`, montant entièrement libre, `pack_antgaspi_id = null` sur la facture.

### Avoirs

**Déclencheur** : annulation ou correction d'une facture `emise` ou `payee`.

**Action** :
1. Création d'une nouvelle facture (type=`avoir`) avec `facture_origine_id` = facture annulée/corrigée
2. Montant de l'avoir = montant à annuler (négatif en comptabilité)
3. Numéro séquentiel distinct (ex: `AV-2026-00001`)
4. Envoi Pennylane via API (Pennylane supporte les avoirs)

---

## 6. Génération des bordereaux et attestations (Module 20)

### Bordereau Savr (ZD)

**Déclencheur** : `collectes.statut` passe à `cloturee` + `collectes.type = zero_dechet`.

**Timing d'émission** : génération **automatique J+1 à 6h du matin** (batch quotidien). Ce délai permet de regrouper les éventuelles corrections de pesée qui arrivent en soirée depuis le TMS et d'émettre un bordereau stable au lieu de régénérations successives.

**Action** :
1. Batch quotidien 6h00 : sélectionne toutes les collectes ZD passées à `cloturee` la veille et non encore bordereautées
2. Génération automatique du PDF bordereau depuis les données de la collecte
3. **Snapshot** des données producteur, transporteur, exutoire dans `bordereaux_savr` (voir section 04)
4. Numéro séquentiel global Savr attribué automatiquement (`BSAV-YYYY-NNNNN`)
5. PDF stocké dans Supabase Storage, URL enregistrée dans `bordereaux_savr.pdf_url`
6. Disponible immédiatement dans l'espace client du traiteur concerné

**Correction** : si une pesée est corrigée post-émission (rare), l'Admin Savr peut régénérer le bordereau → `version` incrémentée, ancien PDF archivé, nouveau PDF remplace l'affichage espace client.

### Attestation de don (AG)

**Déclencheur** : `collectes.statut` passe à `cloturee` + `collectes.type = anti_gaspi`. **Émission pour 100% des collectes AG**, quel que soit le statut d'habilitation de l'association.

**Timing d'émission** : même logique que le bordereau — **batch J+1 à 6h du matin**.

**Action** :
1. Génération automatique du PDF attestation
2. Snapshot des données donateur + association dans `attestations_don`
3. Numéro séquentiel (`ATT-DON-YYYY-NNNNN`)
4. PDF stocké Supabase Storage
5. Disponible dans l'espace client du traiteur

**Adaptation du contenu selon habilitation** :
- Association habilitée 2041-GE-SD : l'attestation inclut les mentions légales permettant la défiscalisation 60% du donateur (montant estimé, référence article 238 bis CGI, numéro d'habilitation)
- Association non habilitée : l'attestation reste un document officiel de traçabilité (volumes, association destinataire, date) sans mention fiscale ni montant défiscalisable

### Rapport de recyclage ZD

**Déclencheur** : `collectes.statut` passe à `cloturee` + `collectes.type = zero_dechet`.

**Règle embargo H+24** : le rapport de recyclage n'est ni généré ni accessible avant H+24 après la fin de la collecte. Ce délai laisse à l'Admin Savr le temps de corriger une pesée erronée transmise par le TMS. La génération automatique est intégrée au **batch J+1 à 6h** (même timing que bordereau et attestation), ce qui garantit dans la quasi-totalité des cas le respect de l'embargo.

**Régénération manuelle** : disponible pour le `traiteur_manager` depuis son espace client, à tout moment post-génération initiale. Cas typique : correction de pesée post-génération, intégration d'une donnée manquante.

**Indicateur de mise à jour** : si le rapport est régénéré après sa première émission automatique, un picto ⟳ accompagné de la mention "Mis à jour le [date]" est affiché dans l'espace client. Le PDF lui-même porte en pied de page "Version mise à jour — générée le [date]". La traçabilité complète de chaque régénération est enregistrée dans `audit_log`.

**Partage (V1)** : pas de lien de partage public natif en V1. Le `traiteur_manager` télécharge le PDF et le transmet lui-même au client final par email. **Lien de partage public horodaté (90 jours) reporté V1.1** (revue sobriété §12 2026-06-03, A1 — aligné sur le QR code de vérification, lui aussi V1.1). Voir [[12 - Reporting et exports#1.2]].

### Alerte pesées anormales (Admin Savr) **— SUPPRIMÉE V1 (décision Val 2026-06-15)**

> **Décision Val 2026-06-15** : le check poids hors seuil (`alerte_ops_pesee_anormale`) est **hors scope V1**. Le type d'alerte reste seedé en DB (migration `20260611171642…`) mais n'est jamais déclenché. Réintroduit en V1.1 si besoin avéré. Divergence ADAPTER_20260615.md archivée.









### R_taux_recyclage — Calcul du Taux de recyclage *(ajout 2026-05-06)*

**Objectif** : produire un indicateur de référence unique, lisible client, aligné méthodologie UE 2019/1004 (taux de recyclage net), affichable dans tous les espaces (traiteur, gestionnaire, Back-office Admin) et le PDF Rapport RSE par collecte.

**Périmètre** : ZD uniquement. AG = `taux_recyclage` reste NULL (la métrique n'a pas de sens sur les collectes AG — métrique de référence AG = repas détournés + CO₂e).

**Déclencheur** : transition `collectes.statut → cloturee` ET `collectes.type = zero_dechet`. Trigger DB `AFTER UPDATE` (cf. [[04 - Data Model]] §collectes + [[08 - APIs et intégrations]] §9 Trigger DB).

**Formule officielle V1** :

```
Taux de recyclage = [(P_verre × cap_verre) + (P_carton × cap_carton) + (P_bio × cap_bio) + (P_emb × cap_emb)] / (P_verre + P_carton + P_bio + P_emb + P_omr) × 100
```

Où :
- `P_X` = somme des `collecte_flux.poids_reel_kg` pour le flux X de la collecte (en kg)
- `cap_X` = `parametres_taux_recyclage.taux_captation` actif pour la filière X au moment T (decimal entre 0 et 1)
- `P_omr` = poids du flux `dechet_residuel` (entre uniquement au dénominateur — pas de captation)

**Cas particuliers** :
- `P_verre + P_carton + P_bio + P_emb + P_omr = 0` → `taux_recyclage = NULL` (UI affiche "—", pas "0 %")
- Flux non collecté sur l'événement (`P_X = 0`) → terme nul au numérateur ET dénominateur, n'impacte pas le calcul
- Total > 0 mais aucun flux valorisé (uniquement OMR) → `taux_recyclage = 0.00`
**Cas multi-camions (refonte 2026-05-21, D3/4a)** : un événement à fort volume peut porter **N collectes ZD** (une par camion). Chaque collecte conserve son `taux_recyclage` calculé par collecte (inchangé). Le **taux de recyclage affiché au niveau événement** dans le Rapport de recyclage (§12 §1.2) et la synthèse (§12 §1.6) est **recalculé sur l'agrégat** : la formule officielle est appliquée sur les `P_X` sommés sur toutes les collectes ZD de l'événement (`P_X = Σ collecte_flux.poids_reel_kg du flux X sur l'ensemble des collectes ZD de l'evenement_id`). Les snapshots `caps_appliques` des collectes individuelles restent inchangés ; l'agrégat événement utilise les taux de captation actifs au moment du rendu du rapport.

**Snapshot caps_appliques** : à l'écriture de `taux_recyclage`, le trigger DB écrit également `collectes.caps_appliques jsonb` avec le snapshot des 4 taux de captation utilisés + horodatage (cf. [[04 - Data Model]] §collectes). Garantit la **reproductibilité du PDF Rapport RSE** : si Val modifie un `taux_captation` plus tard, les anciennes collectes restent figées avec les anciens taux et les anciens PDF restent identiques.

**Recalcul** : si l'Admin Savr corrige une pesée a posteriori (`realisee → cloturee` après modif, ou régénération forcée), le trigger DB recalcule `taux_recyclage` + écrit un nouveau snapshot `caps_appliques` avec les taux **du moment du recalcul**. Pas de réingestion des anciens taux. Cohérent avec la régénération de facture / bordereau.

**Affichage UI** :
- Format : pourcentage avec 1 décimale (ex: `78.4 %`). Cas NULL → `—`.
- Couleur : aucun seuil d'alerte V1 (l'utilisateur compare au benchmark via le Bloc 3 ZD jauges, pas au taux de recyclage seul).
- Tooltip standard : "Taux de recyclage net (méthode UE 2019/1004) — calculé avec les taux de captation par filière. Cliquez sur Méthodologie pour le détail."

**Modification des taux de captation** : `admin_savr` uniquement via [[06 - Fonctionnalités détaillées/06 - Back-office Admin Savr#9. Paramètres > Taux de recyclage par filière]]. Endpoint `PUT /api/v1/admin/parametres/taux-recyclage/{filiere_id}` avec `Idempotency-Key` + commentaire obligatoire (≥ 5 caractères). Audit trail automatique via trigger DB → `parametres_taux_recyclage_history`. Écriture via RPC `SECURITY DEFINER` `rpc_maj_taux_recyclage` (même mécanisme audit-write que les facteurs CO₂, cf. [[#R_co2_snapshot_fige — Reproductibilité (snapshot figé à la clôture)]]).

**Pas de cascade TMS** : le calcul est 100 % côté Plateforme. Le TMS push les pesées brutes via webhook S5 `collecte-terminee` (inchangé). Les paramètres de captation ne sont jamais répliqués vers `tms.*`.

### R_co2_calcul — Calcul de l'impact carbone CO₂ (induit / évité / net / énergie) *(ajout 2026-06-04, Sujet 3)*

**Objectif** : calculer et figer les équivalents CO₂ d'une collecte ZD pour affichage rapports RSE + dashboards. Remplace l'« équivalent CO₂ ADEME » qui était affiché sans aucun support data model.

**Périmètre** : ZD uniquement (5 flux). AG = grandeurs CO₂ NULL (le CO₂ AG repas détournés est un chantier distinct à venir, cf. note fin de règle). Référence métier : [[../11. Contexte Réglementaire & Marché/Calcul Impact Carbone/Analyse methode calcul impact]].

**Déclencheur** : transition `collectes.statut → cloturee` ET `type = zero_dechet` — **même trigger DB que R_taux_recyclage** (un seul `AFTER UPDATE` calcule taux + CO₂ + snapshots).

**Formule officielle V1** :

```
Par flux X (P_X = Σ collecte_flux.poids_reel_kg du flux X) :
  induit_X  = (P_X/1000) × fe_induit_X + part_collecte_X
  part_collecte_X = (P_X / P_total) × (km_collecte_aller_retour × fe_camion_benne_kg_km)
  evite_X   = (P_X/1000) × fe_evite_X
  energie_X = (P_X/1000) × energie_primaire_evitee_kwh_t_X

co2_induit_kg = Σ induit_X (5 flux)        co2_evite_kg = Σ evite_X (5 flux)
co2_net_kg    = co2_induit_kg − co2_evite_kg
energie_primaire_evitee_kwh = Σ energie_X
```

Où `fe_induit_X` / `fe_evite_X` / `energie_primaire_evitee_kwh_t_X` = `parametres_facteurs_co2` actifs au moment T ; `km_collecte_aller_retour` + `fe_camion_benne_kg_km` = `parametres_co2_divers`.

**Règle ABC (présentation)** : `co2_evite_kg` se présente **toujours sur une ligne séparée** des induites — jamais soustraite pour annoncer une « compensation ». `co2_net_kg` est fourni à titre indicatif, présenté distinctement (cf. §12 + §11).

**Cas particuliers** : `P_total = 0` → toutes grandeurs NULL (UI `—`). Flux non collecté → terme nul. **OMR (`dechet_residuel`)** : contribue aux induites + à `fe_evite` (bénéfice incinération) mais `energie_primaire_evitee_kwh_t = 0` — anti-double-comptage (le bénéfice énergie de l'incinération est déjà dans son `fe_evite`, décision a1 Val 2026-06-04). Incertitude ADEME ±50 % (à mentionner en annexe rapport).

**Cas multi-camions** : comme R_taux_recyclage — grandeurs CO₂ par collecte ; l'agrégat événement (§12 §1.2/§1.6) somme les `P_X` sur toutes les collectes ZD de l'événement avant application des facteurs.

### R_co2_emballage_mix — FE emballage dérivé du mix *(ajout 2026-06-04, Sujet 3)*

Le flux `emballage` n'a pas de FE saisi : `fe_induit_emballage = Σ(part_pct_m/100 × fe_induit_m)` et `fe_evite_emballage = Σ(part_pct_m/100 × fe_evite_m)` sur les matériaux actifs de `parametres_mix_emballages`. Recalcul automatique par trigger `fn_recompute_emballage_fe` à chaque modif du mix → met à jour la ligne `emballage` de `parametres_facteurs_co2`. Contrainte : `Σ part_pct (actifs) = 100` (trigger de validation, tolérance 0,05). L'`energie_primaire` emballage reste une estimation agrégée éditée à la main (décomposition sous-flux V1.1). Mix V1 = carton-papier 60 / PET 20 / PEhd 10 / acier 3 / alu 5 / briques 1 / autres 1 → agrégat +540 / −1 188 kgCO₂e/t.

### R_co2_snapshot_fige — Reproductibilité (snapshot figé à la clôture) *(ajout 2026-06-04, Sujet 3)*

À l'écriture des grandeurs CO₂, le trigger DB écrit `collectes.co2_facteurs_snapshot jsonb` (facteurs par flux + mix emballages + équivalences + forfait collecte + horodatage). Garantit qu'une modification ultérieure d'un facteur n'affecte ni les collectes figées ni les PDF déjà générés. **Recalcul a posteriori** (`realisee → cloturee` après correction pesée) = facteurs **du moment du recalcul** (cohérent R_taux_recyclage + recalcul facture). **Modification des facteurs** : `admin_savr` uniquement, commentaire obligatoire, audit trail (`parametres_facteurs_co2_history` / `parametres_mix_emballages_history` ; `parametres_co2_divers` via `audit_log`). Cf. [[08 - APIs et intégrations]] endpoints + [[09 - Authentification et permissions]] RLS.

**Mécanisme d'écriture des paramètres CO₂/recyclage (admin)** *(précision 2026-06-25, divergence M2.4)* : les API Routes admin appellent une **RPC `SECURITY DEFINER` par famille** (`rpc_maj_facteurs_co2`, `rpc_maj_mix_emballages`, `rpc_maj_facteur_co2_ag`, `rpc_maj_co2_divers`, `rpc_maj_taux_recyclage`) — jamais d'`UPDATE` direct via le client service-role. Chaque RPC, dans une transaction unique : (1) pose le **commentaire obligatoire** dans `savr.audit_motif` et l'identité de l'auteur via `SET LOCAL` ; (2) exécute l'UPDATE → les triggers d'audit (rendus **`SECURITY DEFINER`**) écrivent l'historique avec `modifie_par` = auteur courant. Un trigger d'historisation alimente `parametres_mix_emballages_history` (absent jusque-là). **Raison** : sous client service-role `auth.uid()` = NULL (viole `modifie_par NOT NULL`) ; sous client user-scoped les triggers non-DEFINER échouent sur la policy SELECT-only des tables `_history`. Ce mécanisme est le **modèle de référence** pour toute route admin écrivant une table auditée par trigger. `parametres_taux_recyclage` suit le même pattern (mêmes colonnes réelles, même RPC `SECURITY DEFINER`).

### R_co2_ag — Calcul de l'impact carbone CO₂ AG (repas détournés) *(ajout 2026-06-04 bis)*

**Objectif** : calculer et figer le CO₂e évité d'une collecte AG pour affichage attestation de don + dashboard AG. Comble le placeholder « CO₂e évité AG ».

**Périmètre** : collectes `type = anti_gaspi`. Métrique = **émissions évitées par le don** (denrées consommables sauvées). **Évité seul V1** (pas d'induit/net — arbitrage Val 3a) ; V2 = induit + net intégrant le transport (distance TMS × `co2_g_par_km` véhicule).

**Déclencheur** : transition `collectes.statut → cloturee` ET `type = anti_gaspi` — **même trigger DB que R_co2_calcul / R_taux_recyclage**, branche AG.

**Formule officielle V1** :

```
co2_evite_kg = volume_repas_realise × facteur_co2_evite_par_repas_kg
```

Où `volume_repas_realise` = `attributions_antgaspi.volume_repas_realise` (= `ceil(poids_repas_kg / poids_par_repas_kg)`, cf. §04) ; `facteur_co2_evite_par_repas_kg` = `parametres_facteurs_co2_ag` actif (**V1 = 2,5 kgCO₂e/repas, source FAO**).

**Cas particuliers** : `realisee_sans_collecte` (aucun repas) → `co2_evite_kg = 0`. `co2_induit_kg` / `co2_net_kg` / `energie_primaire_evitee_kwh` restent **NULL** pour l'AG. **Recalcul** : si l'Admin corrige `volume_repas_realise` a posteriori (régénération auto de l'attestation, cf. §12 §1.3 + R 2026-05-29) → recalcul `co2_evite_kg` + nouveau snapshot avec le facteur du moment.

**Snapshot** : `collectes.co2_facteurs_snapshot = { "type":"anti_gaspi", "facteur_co2_evite_par_repas_kg": 2.5, "volume_repas_realise": <n>, "equivalences": {km_voiture}, "version_parametres_at": "<ts>" }` (reproductibilité de l'attestation = document officiel).

**Affichage** : attestation de don (§12 §1.3) = ligne « CO₂e évité : X kg » + équivalence km voiture ; dashboard AG (§11 onglet AG) = cadran CO₂e évité. **Modification du facteur** : `admin_savr` uniquement (§06.06), audit `parametres_facteurs_co2_ag_history`. **Pas de cascade TMS V1.**

> **V2** : référentiel multi-critères par aliment (Module 19 Impact enrichi, non créé V1) affinera ce facteur unique.

### R_marge_zd_traiteur — Calcul de la Marge générée ZD (KPI dashboard traiteur) *(ajout 2026-05-07)*

**Objectif** : exposer au traiteur (manager + commercial selon RLS) une lecture nette du gain économique généré par son service "tri à la source" (ZD), sur le périmètre des filtres globaux du dashboard. KPI affiché en Bloc 1 du dashboard traiteur onglet ZD ([[06 - Fonctionnalités détaillées/04 - Espace client traiteur#KPI Marge générée]]).

**Périmètre** : ZD uniquement. AG = pas de KPI marge V1 (modèle pack — la marge AG sera spécifiée V2 si le besoin remonte).

**Formule officielle V1** :

```
Marge générée ZD = (organisations.tarif_refacture_pax_zd) × Σ_DISTINCT(evenements.pax)
                 − Σ(factures_collectes.montant_ht WHERE factures.statut IN ('emise', 'payee'))
```

Où :
- `tarif_refacture_pax_zd` : champ paramétré sur l'organisation traiteur (numeric, défaut 1.50 €, NOT NULL — cf. [[04 - Data Model#Table : `organisations`]]). Édité par Admin Savr only.
- `Σ_DISTINCT(evenements.pax)` : somme des pax des événements ayant **au moins une collecte ZD** dans le périmètre filtré. Le `DISTINCT` sur `evenements.id` empêche le double comptage si un événement porte plusieurs collectes ZD (ex: collecte mid-event + fin-event).
- `Σ(factures_collectes.montant_ht)` : somme des montants HT des lignes de facture rattachées aux collectes ZD du périmètre, **uniquement** lorsque `factures.statut IN ('emise', 'payee')`. Brouillons et avoirs **exclus**.

**Filtres pris en compte** : tous les filtres globaux du dashboard (Période, Lieux, Client organisateur, Type d'événement, Taille d'événement). RLS héritée de `collectes` en lecture : **manager = toute l'orga, commercial = toute l'orga** (révision 2026-05-29 — lecture alignée manager via `organisation_id`).

**Cas particuliers** :
- `Σ pax = 0` (aucune collecte ZD sur la période filtrée) → marge = `NULL`, UI affiche `—`
- `Σ factures HT = 0` mais `Σ pax > 0` (collectes cloturées sans facture émise — cas attente facturation) → marge = revenu pur, badge info "{{n}} collectes en attente de facturation" sous la carte. *(Précision 2026-06-07 — test scenarios §06.04 F3, arbitrage Val)* : le badge s'affiche dès que **n ≥ 1**, où `n` = nombre de collectes ZD `cloturee` du périmètre filtré sans facture `emise`/`payee` rattachée — **y compris en facturation partielle** (le cas Σ HT = 0 est couvert par cette règle générale).
- `Σ factures HT > revenu` (coût > revenu, marge négative) → affichée en rouge avec valeur absolue, exemple `−45,20 €`. Pas d'alerte automatique V1 (Ops Savr arbitre cas par cas via back-office).

**Affichage UI** :
- Format : `1 234,56 €` (locale fr-FR, 2 décimales). Couleur neutre par défaut, rouge si négatif.
- Tooltip standard : "Marge = {{tarif}} €/pax × {{pax}} pax − {{coût}} € de prestations Savr facturées (statuts émise + payée). Tarif refacturé éditable par Savr."
- Carte clickable → renvoie vers la liste Collectes onglet ZD avec filtres globaux transmis en query string.

**Source de vérité du tarif** : un seul champ DB (`organisations.tarif_refacture_pax_zd`). Pas de surcharge par contrat traiteur×lieu V1 (sobriété). Si un traiteur applique des tarifs différents selon ses clients finaux, la valeur stockée est sa **valeur la plus représentative** (à arbitrer avec Savr lors de l'onboarding) — V2 si segmentation requise.

**Modification du tarif** : `admin_savr` uniquement via [[06 - Fonctionnalités détaillées/06 - Back-office Admin Savr]] §Édition organisation. Audit_log automatique sur changement (champ `tarif_refacture_pax_zd`, ancienne et nouvelle valeur).

**Pas de cascade TMS** : KPI 100 % Plateforme. Le TMS n'a pas connaissance du tarif refacturé.

### R_dechets_labo_estimes — Estimation des déchets produits au labo du traiteur *(ajout 2026-05-22)*

**Objectif** : afficher au gestionnaire de lieux une **estimation** du déchet généré en amont, au laboratoire/cuisine du traiteur (épluchures, parures, surplus de production), distinct du déchet collecté sur l'événement (pesées réelles). Permet de matérialiser l'empreinte déchet totale d'un événement au-delà de ce que Savr collecte sur site.

**Périmètre** : affichage **espace gestionnaire de lieux uniquement** (détail événement + colonne liste — cf. [[06 - Fonctionnalités détaillées/05 - Espace client gestionnaire de lieux]]). **Hors PDF rapport** et **hors espace traiteur** en V1. S'applique à tout événement disposant d'un `pax` et d'un coefficient pour l'année applicable, quel que soit le type de collecte (ZD ou AG) — le déchet labo est lié à la production culinaire, pas au flux collecté.

**Source du coefficient** : table `coefficients_perte_labo` (cf. [[04 - Data Model#⚠ Addendum 2026-05-22 — Coefficient de perte labo (estimation déchets amont, gestionnaire-only)]]). Le coefficient (`kg/couvert`) est calculé une fois par an par le traiteur sur les données de l'année N, communiqué à Savr, et **saisi par l'Admin Savr** (pas de saisie traiteur V1). Il s'applique aux événements de l'année **N+1**.

**Formule officielle V1** :

```
Déchets labo estimés (kg) = evenements.pax × C

où C = coefficients_perte_labo.coefficient_kg_couvert
       WHERE organisation_id = evenements.traiteur_operationnel_organisation_id
         AND annee_reference = EXTRACT(YEAR FROM evenements.date_evenement) − 1
```

Où :
- `evenements.pax` = nombre de couverts programmé (base de calcul retenue ; `pax_reels` non utilisé — décision Val 2026-05-22).
- `evenements.traiteur_operationnel_organisation_id` = traiteur producteur du déchet labo (porteur du coefficient), y compris si l'événement est programmé par une agence ou un gestionnaire.
- `C` = coefficient du traiteur pour l'année de référence = année de l'événement − 1.

**Cas particuliers** :
- Aucun coefficient pour `(traiteur opérationnel, année − 1)` → estimation = **NULL** → UI affiche `—` / "Coefficient non communiqué". **Pas de fallback** sur une autre année (un chiffre faux est pire qu'une absence assumée).
- `pax = 0` ou NULL → estimation = NULL → `—`.
- Coefficient = 0 (traiteur déclarant zéro perte) → estimation = `0 kg` (affiché tel quel, distinct de NULL).

**Calcul** : à la volée en lecture, **non stocké** (cohérent `taille_evenement`). Aucun snapshot — l'affichage est gestionnaire-only, sans besoin de reproductibilité PDF. Si le coefficient est corrigé a posteriori par l'Admin, l'estimation affichée évolue rétroactivement (acceptable pour un affichage de consultation).

**Affichage UI** :
- Format : kg avec 0 ou 1 décimale (ex: `75 kg` ou `74,5 kg`). Cas NULL → `—`.
- Tooltip standard : "Estimation des déchets produits au laboratoire du traiteur (préparation), distincte des déchets collectés sur l'événement. Calcul : nombre de couverts × coefficient annuel du traiteur."

**Confidentialité** : le gestionnaire ne lit **jamais** le coefficient brut. L'estimation en kg est calculée côté serveur (fonction SECURITY DEFINER) et seule la valeur kg est exposée (cf. [[09 - Authentification et permissions]]).

**Modification du coefficient** : `admin_savr` uniquement via [[06 - Fonctionnalités détaillées/06 - Back-office Admin Savr]] §Édition organisation traiteur. Audit_log automatique sur changement.

**Pas de cascade TMS** : métrique reporting 100 % Plateforme. Le TMS ne manipule pas le pax côté reporting et ne calcule aucune estimation. `coefficients_perte_labo` reste schéma `plateforme.*`.

### R_volume_estime_ag_calcule — Calcul automatique du volume estimé de repas AG *(ajout 2026-05-07)*

**Objectif** : retirer la saisie utilisateur du volume estimé AG (le traiteur n'est pas qualifié pour estimer ce chiffre, source d'erreurs et de friction). Calcul backend invisible servant uniquement à l'algo d'attribution association.

**Formule V1** :

```
collectes.volume_estime_repas = round(0.10 × evenements.pax)
```

**Trigger** :
- Calculée à l'INSERT d'une collecte AG (trigger DB `set_volume_estime_repas` sur `collectes BEFORE INSERT WHERE type = 'ag'`).
- Recalculée à l'UPDATE de `evenements.pax` si la collecte AG associée n'est pas encore en statut `realisee` (trigger `update_volume_estime_repas`).
- Verrouillée à partir du statut `realisee` (la valeur réelle `volume_repas_realise` prend le relais).

**Visibilité** :
- **Pas affiché côté traiteur** (ni dans le formulaire de programmation §06.01, ni dans l'espace client traiteur §06.04).
- **Affiché côté Admin/Ops** dans la vue détail collecte §06 §3 Bloc 5 (Attribution AG complète).
- Affiché côté association (email `ag_attribution_association`) pour l'aider à se positionner (déjà cas).
- Affiché côté transporteur (email `ag_attribution_transporteur`) pour dimensionnement véhicule (déjà cas).

**Cas particuliers** :
- **Supprimé 2026-06-07 (test scenarios §06.01 F4, arbitrage Val)** — cas impossible par construction : validation bloquante formulaire `pax ≥ 1` + `evenements.pax` NOT NULL. Le plus petit volume possible est `round(0.10 × 1) = 0`, déjà couvert par le flux nominal de l'algo.
- Modification post-attribution : si `pax` est modifié après attribution validée, le `volume_estime_repas` est recalculé mais l'attribution n'est pas réinvalidée automatiquement V1 (audit_log seulement, Admin arbitre).

**Justification du 10 %** : valeur empirique constatée Savr 2024-2025 sur ~150 collectes AG analysées (médiane ratio repas récupérés / pax = 9.7 %). À ré-évaluer V2 sur dataset plus large.

### R_flux_par_defaut_zd — Aucune saisie flux ZD côté traiteur, peuplement post-pesée *(ajout 2026-05-07, consolidation)*

**Objectif** : confirmer (refonte back-office 2026-05-07) que les flux ZD ne sont saisis nulle part côté utilisateur — ni au formulaire de programmation §06.01, ni au back-office. La table `collecte_flux` est peuplée à la clôture (1 ligne par flux pesé via webhook S5 TMS).

**État V1** :
- Pas de pré-création des 5 flux à l'INSERT collecte ZD (la table `collecte_flux` reste vide jusqu'à la pesée).
- Pas de saisie traiteur : aucun champ "Flux souhaités" au formulaire §06.01 (revue sobriété 2026-04-29 confirmée 2026-05-07).
- Pas de champ "Flux à valider" sur la fiche collecte avant clôture.
- L'enum flux V1 est figé à 5 valeurs (memory `project_enum_flux_5_valeurs_2026_05_02`) : `biodechet`, `emballage`, `carton`, `verre`, `dechet_residuel`.

**Au passage en `realisee`** (webhook S5 `collecte-terminee` TMS) :
- 1 ligne `collecte_flux` par flux **effectivement pesé** par le chauffeur (peut être 1, 2, 3, 4 ou 5 lignes selon ce qui a été collecté).
- Un flux non pesé n'apparaît pas dans `collecte_flux` (vs `poids_reel_kg = 0`).

**Affichage rapport RSE** :
- Un flux pesé à `0 kg` est listé "0 kg collecté" (transparent — montre la consigne suivie sans matière à trier).
- Un flux jamais pesé (absent de `collecte_flux`) est masqué du rapport.

**Justification** : le prestataire collecte ce qu'il trouve sur place. Le traiteur n'a pas à anticiper les flux. Le rapport reflète la réalité du tri, pas une intention.

### R_revenus_imputation_organisation — Imputation revenus tableau Dashboard Admin *(ajout 2026-05-07)*

**Objectif** : figer la règle d'imputation comptable du tableau "Revenus par organisation" du Dashboard Admin (§06 §1 Bloc 2.2).

**Règle** :
- L'organisation imputée est l'**organisation programmatrice** (`evenements.organisation_id`), pas le traiteur opérationnel (`evenements.traiteur_operationnel_organisation_id`).
- Cohérent avec règle V1 programmateur=facturé : la facture est émise à l'entité de facturation appartenant à l'organisation programmatrice.
- Filtre dates : sur `collectes.date_collecte` (et non `factures.date_emission`) — l'utilisateur Admin cherche à savoir "combien j'ai facturé pour les collectes effectivement réalisées dans cette période".

**Conséquence pour les agences** :
- Une collecte programmée par une agence pour le compte d'un traiteur shadow → la ligne du tableau apparaît au nom de l'**agence** (programmatrice = facturée), même si le traiteur opérationnel est une fiche shadow distincte.
- Le traiteur opérationnel (shadow ou non) n'apparaît pas dans le tableau Revenus.

**Conséquence pour les gestionnaires** :
- Une collecte programmée par un gestionnaire de lieux → la ligne apparaît au nom du **gestionnaire** (programmateur = facturé), même si le traiteur opérationnel est une organisation traiteur référencée Savr.

**Source SQL** :

```sql
SELECT
  o.id, o.nom, o.type,
  COUNT(*) FILTER (WHERE c.type = 'zd') AS nb_zd,
  COALESCE(SUM(fc.montant_ht) FILTER (WHERE c.type = 'zd' AND f.statut IN ('emise', 'payee')), 0) AS montant_zd,
  COUNT(*) FILTER (WHERE c.type = 'ag') AS nb_ag,
  COALESCE(SUM(fc.montant_ht) FILTER (WHERE c.type = 'ag' AND f.statut IN ('emise', 'payee')), 0) AS montant_ag
FROM organisations o
JOIN evenements e ON e.organisation_id = o.id
JOIN collectes c ON c.evenement_id = e.id
LEFT JOIN factures_collectes fc ON fc.collecte_id = c.id
LEFT JOIN factures f ON f.id = fc.facture_id
WHERE c.date_collecte BETWEEN :from AND :to
GROUP BY o.id, o.nom, o.type
ORDER BY (COALESCE(SUM(fc.montant_ht), 0)) DESC;
```

(Vue matérialisée envisagée V1.1 si volume justifie — V1 = requête live OK ≤ ~150 orgs actives.)

### R_compatibilite_vehicule_lieu — Compatibilité véhicule transporteur ↔ lieu *(ajout 2026-05-08)*

**Objectif** : figer la logique de filtrage véhicule de l'algo d'attribution AG (et de la validation manuelle) en tenant compte de la contrainte de capacité max imposée par le lieu.

**Hiérarchie des véhicules** (du plus petit au plus gros) :

| Rang | Valeur enum | Description |
|------|-------------|-------------|
| 1 | `velo_cargo` | Vélo cargo (A Toutes! IDF) |
| 2 | `camionnette` | Camionnette |
| 3 | `fourgon` | Fourgon |
| 4 | `vul` | Véhicule utilitaire léger |
| 5 | `poids_lourd` | Poids lourd / camion 20m³ et plus |

**Sémantique** :
- `lieux.type_vehicule_max` (NOT NULL) = capacité **max** acceptée par le lieu (rang max).
- `transporteurs.types_vehicules` (text[], length ≥ 1) = parc véhicules disponibles du transporteur (multi).
- `tournees.type_vehicule` (NOT NULL côté Plateforme) = véhicule effectivement assigné à la tournée.

**Règle de compatibilité** :

> Un transporteur est **compatible** avec un lieu si **au moins un** de ses `types_vehicules` a un rang ≤ `lieux.type_vehicule_max`.

```sql
-- Hiérarchie matérialisée :
CREATE OR REPLACE FUNCTION rang_vehicule(v text) RETURNS int AS $$
  SELECT CASE v
    WHEN 'velo_cargo' THEN 1
    WHEN 'camionnette' THEN 2
    WHEN 'fourgon' THEN 3
    WHEN 'vul' THEN 4
    WHEN 'poids_lourd' THEN 5
  END
$$ LANGUAGE SQL IMMUTABLE;

-- Compatibilité (booléen) :
CREATE OR REPLACE FUNCTION transporteur_compatible_lieu(t_id uuid, l_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM transporteurs t, lieux l, unnest(t.types_vehicules) AS tv
    WHERE t.id = t_id AND l.id = l_id
      AND rang_vehicule(tv) <= rang_vehicule(l.type_vehicule_max)
  )
$$ LANGUAGE SQL STABLE;
```

**Conséquence pour l'algo AG** :
- Pré-filtre des transporteurs : `WHERE transporteur_compatible_lieu(t.id, c.lieu_id) = true`
- Le **vélo cargo** (rang 1) est **toujours compatible** avec n'importe quel lieu (rang max ≥ 1). Pas de cas de bypass nécessaire — la hiérarchie suffit.
- Un lieu `type_vehicule_max = velo_cargo` n'accepte **que** le vélo cargo (cas marginal V1, pertinent pour zones piétonnes).

**Conséquence pour la validation tournée TMS** :
- Validation tournée TMS bloquée si `tournees.type_vehicule` a un rang > `MIN(rang(lieux.type_vehicule_max))` parmi les lieux servis (cf. CDC TMS §05).

**Conséquence post-réalisation** :
- Pas de check rétroactif : si un véhicule plus gros que `type_vehicule_max` a quand même servi le lieu, la collecte reste valide (le chauffeur a su gérer). Mais l'incident est consigné si remonté manuellement.

**Justification** : modèle hiérarchique simple, lisible, évite la matrice véhicule × lieu (N×M cases). Source unique de vérité = enum aligné `lieux.type_vehicule_max` ↔ `transporteurs.types_vehicules` ↔ `plateforme.tournees.type_vehicule`.

**⚠ Question ouverte cohérence cross-app TMS** *(à arbitrer dans audit cohérence inter-CDC dédié)* : le TMS dispose d'un référentiel paramétrable `tms.types_vehicules` (table seed avec UUID FK + attributs `hayon`, `frigorifique`, `volume_m3_standard`, codes `camion_20m3_hayon` / `camion_16m3` / `camion_6m3` / `velo_cargo_frigo`). La traduction `tms.types_vehicules.code` → catégorie Plateforme `velo_cargo/camionnette/fourgon/vul/poids_lourd` n'est pas spécifiée V1. Reco : ajouter une colonne `tms.types_vehicules.categorie_plateforme` (enum) seed manuel par Val/Ops, exposée via vue cross-schema pour validation tournée TMS contre `plateforme.lieux.type_vehicule_max`. Décision à prendre dans `coherence-inter-cdc` post-refonte 2026-05-08.

---

### R_lieux_admin_only_fields — Visibilité champs internes Savr sur table `lieux` *(ajout 2026-05-08)*

**Objectif** : garantir que les 4 champs internes Savr de la table `lieux` (`commentaire_lieu`, `siren`, `email_gestionnaire`, `reference_citeo`) ne fuitent jamais vers les profils non-Savr.

**Règle** :

> Les colonnes `lieux.commentaire_lieu`, `lieux.siren`, `lieux.email_gestionnaire`, `lieux.reference_citeo` sont **strictement réservées aux profils `admin_savr` et `ops_savr`** en lecture comme en écriture.
>
> Tout autre profil (traiteur_*, agence_*, gestionnaire_*, client_organisateur_*) **ne doit jamais voir ces colonnes** :
> - Pas exposées dans les SELECT publics (`v_lieux_clients` masque ces colonnes)
> - Pas exposées dans le payload S7 Plateforme→TMS (cf. [[08 - APIs et intégrations]])
> - Pas exposées dans les exports CSV/Excel client (cf. [[12 - Reporting et exports]])
> - Pas exposées dans les rapports RSE/PDF clients

**Implémentation Postgres** :

```sql
-- Column-level GRANT explicite par défaut sur les colonnes publiques + admin only
REVOKE ALL ON plateforme.lieux FROM PUBLIC;

GRANT SELECT (id, nom, nom_alternatif, adresse_acces, code_postal, ville,
              latitude, longitude, region, acces_details, acces_office,
              stationnement, type_vehicule_max, contraintes_horaires,
              flux_autorises, volume_max_bacs, traiteurs_operant,
              controle_acces_requis_default, photos_urls, actif,
              created_at, updated_at)
  ON plateforme.lieux TO traiteur_role, agence_role, gestionnaire_role,
                         client_organisateur_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON plateforme.lieux
  TO admin_savr_role, ops_savr_role;
-- Note : commentaire_lieu, siren, email_gestionnaire, reference_citeo,
--        commentaires_internes ne sont PAS dans le GRANT public →
--        invisibles côté traiteur/agence/gestionnaire/lieu/client_organisateur.
```

**Vue publique** :

```sql
CREATE VIEW plateforme.v_lieux_clients WITH (security_invoker = true) AS
SELECT id, nom, nom_alternatif, adresse_acces, code_postal, ville,
       latitude, longitude, region, acces_details, acces_office,
       stationnement, type_vehicule_max, contraintes_horaires,
       flux_autorises, volume_max_bacs, traiteurs_operant,
       controle_acces_requis_default, photos_urls, actif,
       created_at, updated_at
FROM plateforme.lieux;
```

**Conséquence** : toute modification de schéma sur ces 4 colonnes admin-only doit être validée RLS dans skill `cdc-audit-rls`. Toute fuite (ex: bug ORM exposant `*` au lieu de la liste explicite) est une faille de sécurité critique.

**Justification** : ces 4 champs portent des données commerciales (commentaire interne), légales (SIREN), de relation client (email gestionnaire) et de reporting interne (Citeo) qui ne doivent jamais être restituées aux clients par erreur.

---

### Numérotation séquentielle

Séquence globale Savr (pas par entité de facturation) pour les 4 types de documents :
- Factures ZD : `FZD-YYYY-NNNNN`
- Factures AG : `FAG-YYYY-NNNNN`
- Factures achat pack AG : `FPK-YYYY-NNNNN` *(ajouté 2026-06-07 test-scenarios — série existante §06.08 §7 + §04, absente de cette liste par dette doc)*
- Avoirs : `AV-YYYY-NNNNN`
- Bordereaux : `BSAV-YYYY-NNNNN`
- Attestations de don : `ATT-DON-YYYY-NNNNN`

Chaque séquence repart à 00001 au 1er janvier. La combinaison (préfixe + année + numéro) est unique et non ambiguë.

---

### R_code_mts1_requis — Code transporteur MTS-1 obligatoire si `type_tms = 'mts1'` *(ajout 2026-05-29, propagation §3bis)*

**Objectif** : garantir qu'un transporteur dispatché via MTS-1 dispose bien de son `carrierShareableCode`, sans quoi le dispatch de la tournée `POST /v3/tours/{tourId}/dispatch` (payload `{ carrierShareableCode }`) échoue *(flux réconcilié sur le relevé as-built — propagation §08 §3bis 2026-06-06)*.

**Règle** :

> Si `transporteurs.type_tms = 'mts1'`, alors `transporteurs.code_transporteur_mts1` doit être renseigné (non NULL, non vide). Contrôle bloquant à la saisie/édition du transporteur (Back-office §06 §6) et avant tout envoi MTS-1.

**Implémentation** : CHECK applicatif côté formulaire transporteur + garde dans la fonction d'envoi MTS-1 (si `code_transporteur_mts1` manquant → erreur explicite Admin, collecte non poussée, statut reste `non_envoye`). V1 only (déprécié V2). Voir [[04 - Data Model#Table : transporteurs]] et [[08 - APIs et intégrations#3bis. API Plateforme ↔ MTS-1]].

---

## 7. Règles d'accès au registre réglementaire (Module 20)

**Accès** : tous les profils espace client ont accès au registre. Le périmètre visible est filtré par RLS.

| Profil | Périmètre visible |
|--------|------------------|
| Traiteur-Commercial | Événements qu'il a créés (`evenements.created_by = user.id`) |
| Traiteur-Manager | Tous les événements de son organisation (`evenements.organisation_id = user.organisation_id`) |
| Agence | Tous les événements dont elle est l'organisatrice (`evenements.organisation_id = user.organisation_id`) |
| Gestionnaire de lieux | Tous les événements sur les lieux qui lui sont associés (via `organisations_lieux`) |
| Lieu (indépendant) | Tous les événements sur son/ses lieu(x) (via `organisations_lieux`) |
| Admin Savr | Vue globale tous clients, tous événements |

**Justificatifs** : seuls les justificatifs liés aux collectes dans le périmètre RLS de l'utilisateur sont téléchargeables.

---

## 8. Onboarding — Création de compte self-service

### Principe

**Onboarding 100% automatisé en V1**. Aucune validation amont par l'Admin Savr : un utilisateur peut créer son compte, compléter sa fiche organisation, programmer sa première collecte et recevoir sa facture **sans intervention humaine** côté Savr. Si une incohérence est détectée a posteriori (SIRET invalide, abus, comportement anormal), l'Admin peut désactiver le compte.

**Corollaire technique** : les contrôles automatiques doivent être suffisamment robustes pour limiter les risques (validation SIRET via API INSEE/Sirene, validation TVA intracom via VIES, détection doublons orga). Voir section 15 Sécurité.

### Étape 1 — Inscription (friction minimale)

Informations obligatoires à la création du compte :

| Champ | Contrainte |
|-------|-----------|
| `email` | Format email valide + unicité globale. Sert d'identifiant. |
| `mot_de_passe` | 10 caractères min, 1 majuscule, 1 chiffre, 1 caractère spécial |
| `prenom` | Texte libre, 2 caractères min |
| `nom` | Texte libre, 2 caractères min |
| `telephone` | Format FR (validation regex) |
| `type_profil` | Enum : `traiteur` / `agence` / `gestionnaire_lieux` |
| `raison_sociale` | Texte libre. Auto-complétion si domaine email déjà connu (matching sur `organisations.domaine_email`). |
| `acceptation_cgu` | Checkbox obligatoire (horodatée) |

Confirmation par email avec lien de validation avant premier accès.

**Logique de rattachement à une organisation** :
- Si le domaine email (`@dalloyau.fr` par ex.) correspond à une entrée de la table `organisations_domaines_email` (N-N avec `organisations`) → rattachement automatique avec rôle par défaut selon `organisations.type` :
  - `traiteur` → `traiteur_commercial`
  - `agence` → `agence`
  - `gestionnaire_lieux` → `gestionnaire_lieux`
- Sinon → création d'une nouvelle `organisations` avec `type` choisi via `type_profil` à l'inscription, et l'utilisateur en rôle "manager" de son orga (accès admin sur son orga) :
  - `traiteur` → `traiteur_manager`
  - `agence` → `agence` (un seul rôle agence en V1, manager implicite)
  - `gestionnaire_lieux` → `gestionnaire_lieux` (un seul rôle V1, manager implicite)

**Multi-domaines supporté** : une organisation peut avoir plusieurs domaines email (cas Dalloyau `@dalloyau.fr` + `@dalloyau.com`, ou groupes avec filiales). Modélisation via table `organisations_domaines_email (organisation_id, domaine, verifie_at)`. Un domaine ne peut être rattaché qu'à une seule organisation (unicité).

**Cas spécial fiches shadow (2026-05-07)** : si une agence crée un événement avec un traiteur opérationnel "hors référentiel", une fiche `organisations` shadow (`est_shadow=true`) est créée. Cette fiche n'a aucun user rattaché et n'est pas visible dans le matching domaine email. Si plus tard un user du domaine du traiteur shadow s'inscrit (ex: contact saisi par l'agence), il créera une nouvelle organisation distincte — l'Admin Savr peut alors fusionner les deux organisations (action `fusionner_shadow` qui rebascule `est_shadow=false`, transfère l'historique et supprime le doublon).

### Étape 2 — Avant première collecte (completion progressive)

Le formulaire de programmation de collecte est bloqué tant que les informations suivantes ne sont pas complétées au niveau organisation. **Étendu 2026-05-07 : règle bloquante identique pour les 3 types d'organisations programmatrices** (traiteur, agence, gestionnaire de lieux).

| Champ | Niveau |
|-------|--------|
| `siret` | organisations (ou entites_facturation) |
| `tva_intracom` | entites_facturation |
| `adresse_facturation` | entites_facturation |
| `contact_facturation_email` | entites_facturation |
| `acceptation_cgv` | organisations (horodatée, version CGV figée) |

**UX** : quand un utilisateur tente de programmer sa première collecte, modal "Complétez votre profil entreprise" qui redirige vers le formulaire de complétion. Une fois rempli, la programmation débloquée.

**Règle V1 programmateur=facturé (2026-05-07)** : `evenements.entite_facturation_id` doit appartenir à `evenements.organisation_id` (l'organisation programmatrice est aussi celle qui est facturée). Pas de découplage en V1. Refacturation interne (ex: agence facturée puis refacture le traiteur en off-Plateforme) est hors scope Savr.

**Cas traiteur shadow (2026-05-07)** : une fiche traiteur `est_shadow=true` n'est jamais programmatrice ni facturée — elle est uniquement référencée comme `evenements.traiteur_operationnel_organisation_id`. L'onboarding bloquant ne s'applique pas aux fiches shadow (pas de user, pas de programmation possible).

### Étape 3 — Facturation automatique (pas de gating Admin V1)

**Changement V1** : avec l'onboarding 100% automatisé, aucune validation Admin n'est requise avant facturation. La facture est émise dès que la collecte est clôturée, sous réserve que les infos de facturation soient complètes (SIRET validé via API INSEE, CGV acceptées).

**Gating précis (tranché Val 2026-06-10, challenge logistique+onboarding)** : la condition bloquante d'émission est **`entites_facturation.siret_verification = 'verifie'`** sur l'entité facturée (cf. [[04 - Data Model#Table : `entites_facturation`]]) — **seule**. La vérification TVA VIES (`tva_verification`) **n'est PAS bloquante** : `en_attente`/`echec` = alerte Admin in-app, la facture part quand même (VIES est trop instable pour conditionner du cash). Tant que `siret_verification ∈ (en_attente, echec)` : facture non émise + alerte Admin in-app (cf. [[15 - Sécurité et conformité]] §2.6 dégradation gracieuse — job async 15 min / 1 h / 24 h).

Si une incohérence est détectée a posteriori (ex: SIRET inactif après validation initiale), l'Admin peut suspendre l'envoi Pennylane depuis le back-office.

### Lieux

Création et rattachement des lieux par l'Admin Savr uniquement. Un gestionnaire de lieux peut demander l'ajout d'un lieu via un formulaire → notification Admin. **Étendu 2026-05-07** : une agence peut également proposer un nouveau lieu lors d'une programmation (workflow identique à celui d'un traiteur — création immédiate de la fiche lieu via le formulaire §06.01 étape 2.a, sans approbation Admin préalable, l'audit a posteriori suffit).

---

## 9. Notifications V1

### Principe

Canal unique V1 : **email transactionnel**. Pas de notifications in-app, pas de SMS. Destinataire principal = utilisateur qui a programmé la collecte (`collectes.created_by`). Destinataires additionnels documentés explicitement dans la matrice ci-dessous (notamment **traiteur opérationnel** quand la collecte est programmée par une agence ou un gestionnaire de lieux — règle 2026-05-07).

### Matrice des notifications V1

| Événement déclencheur | Destinataire(s) | Objet |
|----------------------|-----------------|-------|
| Collecte programmée | `collectes.created_by` | Récapitulatif collecte (date, lieu, flux, contact) |
| **Collecte programmée par un tiers** *(2026-05-07)* | `traiteur_operationnel_organisation_id` (manager + commerciaux du traiteur opérationnel) | **Info-only**, pas de validation requise. Template `collecte_programmee_tiers` *(ajouté 2026-06-07, F2 session test-scenarios §06.02)* + récap (date, lieu, flux, contact, programmateur). Déclenché uniquement si `evenements.organisation_id ≠ traiteur_operationnel_organisation_id` ET si le traiteur opérationnel n'est pas une fiche shadow. Si shadow → pas de destinataire (silencieux). |
| **Collecte modifiée ou annulée par un tiers** *(2026-05-07)* | `traiteur_operationnel_organisation_id` (manager + commerciaux) | Idem ci-dessus. Template `collecte_modifiee_tiers` *(ajouté 2026-06-07, F2 — variable `type_changement` modification/annulation)*. Déclenché uniquement si action effectuée par programmateur ≠ traiteur opérationnel. |
| Collecte modifiée | `collectes.created_by` | Récap diff avant/après |
| Collecte annulée | `collectes.created_by` (template `collecte_annulee`) + Admin Savr (template `admin_collecte_annulee`, *ajouté 2026-06-07 F2*) + (si tiers) `traiteur_operationnel_organisation_id` (`collecte_modifiee_tiers`, `type_changement=annulation`) | Confirmation annulation. |
| Rapport post-collecte disponible | `collectes.created_by` | Lien espace client + résumé impact |
| Inscription | User | Template `verification_email` — lien d'activation valide 24h *(F5 corrigée 2026-06-07 : l'ancienne ligne « Première connexion → bienvenue + lien vérif » conflatait 2 templates)* |
| Email vérifié | User | Template `bienvenue` — post-vérification, sans lien d'activation |
| Pack AG bientôt épuisé — **franchissement** du seuil ≤ 10% des crédits initiaux restants (transition > 10% → ≤ 10%, pas de répétition à chaque décrément ; recrédit ré-arme — F4 tranchée 2026-06-07) | Admin Savr (V1) / + Traiteur-Manager (V2) | Alerte "pack bientôt épuisé" (template `admin_pack_ag_etat`, niveau=bas) |
| Incident collecte (prestataire manqué, pesée contestée) | Admin Savr | Alerte opérationnelle |

### Hors scope V1

- Envoi automatique des factures par email (Admin envoie manuellement depuis Pennylane)
- Notifications in-app (cloche)
- Notifications SMS
- Digest quotidien/hebdomadaire
- Préférences de notification configurables par l'utilisateur

### Templates

Contenus à rédiger par l'Admin Savr en co-construction avec Val. Premier draft proposé par Claude en section 06. Stockés dans la base (table `email_templates`) pour édition sans déploiement. Variables d'interpolation standardisées (`{{prenom}}`, `{{date_collecte}}`, etc.).

---

## 10. SLAs opérationnels V1

| Événement | SLA V1 | Commentaire |
|-----------|--------|-------------|
| Délai programmation → réalisation | Aucun | Le traiteur programme à sa convenance. Pas de délai min de prévenance V1. À documenter dans CGV en cas d'abus. |
| Publication rapport post-collecte | Batch J+1 à 6h (embargo H+24 strict) | Rapport non accessible avant H+24. supprimée V1 (2026-06-15). |
| Génération bordereau ZD | Batch J+1 à 6h | Auto |
| Génération attestation don AG | Batch J+1 à 6h | Auto (100% des collectes AG) |
| Génération brouillon facture | Aucun SLA V1 (décision Val 2026-04-28 — pas d'engagement contractuel sur ce délai) | Génération automatique dès clôture, mais délai non garanti contractuellement |
| Envoi facture client | Aucun SLA V1 | Dépend de la cadence de validation Admin |
| Réponse support | Non défini V1 | À cadrer quand support structuré |

**Règle de monitoring** : V1 pas d'alertes SLA automatiques. Suivi manuel par Admin. Alertes automatiques dès V2 si SLA dashboard ajouté.

---

## 11. Dashboards Gestionnaires de lieux (Module dédié)

### KPIs V1

| KPI | Granularité |
|-----|-------------|
| Taux de recyclage *(ZD uniquement, formule à captation par filière, cf. R_taux_recyclage ci-dessous)* | Par lieu / traiteur / événement / période |
| Tonnage par flux (5 flux V1 : biodéchets, emballages, carton, verre, déchet résiduel) | Par lieu / traiteur / événement / période |
| Impact CO₂ (évité en headline ; induit + net + énergie primaire en détail, règle ABC, cf. R_co2_calcul) | Par lieu / traiteur / événement / période |
| Nombre de collectes | Par lieu / traiteur / période |
| Nombre d'événements | Par lieu / traiteur / période |

KPIs supplémentaires ajoutés au fil des demandes terrain (design extensible).

### UX du dashboard

- **Vue agrégée par défaut** : tous les lieux + tous les traiteurs du périmètre du gestionnaire.
- **Filtres interactifs** : période (picker), lieu (multi-select), traiteur (multi-select), type d'événement.
- **Drill-down** : clic sur un lieu / traiteur / événement → vue détaillée avec historique collectes et impact.
- **Données nominatives** : le gestionnaire voit le nom des traiteurs et des événements (pas d'anonymisation dans son dashboard).
- **Export** : CSV des données filtrées (demande Val à confirmer en section 12).

### Tarifs et remises — résolution du prix (refonte 2026-05-26)

Le prix d'une collecte se compose en **deux couches** : une **base** (méthode de calcul du prix) puis des **remises** (% accordés par-dessus). Modélisation : `grilles_tarifaires_zd` + `tarifs_packs_ag` (bases) et `tarifs_negocie` (remises) dans [[04 - Data Model]].

**Couche base**
- **ZD** : grille du catalogue affectée à l'organisation programmatrice (`organisations.grille_tarifaire_zd_id`, NULL → grille `est_defaut`). Base = `prix_base_ht + prix_par_couvert_ht × pax` sur la ligne couvrant `evenements.pax` **(pax_collecte retiré V1 le 2026-05-29 — pax unique niveau événement)**.
- **AG** : tarif **unitaire** (`tarifs_packs_ag` type `unitaire`) pour une collecte facturée à l'unité. Une collecte qui décrémente un pack prépayé n'est pas facturée à la collecte → pas de base à la collecte (donc pas de remise).

**Couche remise** (`tarifs_negocie`, % uniquement) — deux scopes :
- **scope organisation** : remise accordée directement à un programmateur (traiteur/agence/gestionnaire) — s'applique à ses collectes.
- **scope gestionnaire** : remise accordée par un gestionnaire de lieux (cas Viparis −5 %) — s'applique à tout traiteur programmant sur un lieu rattaché au gestionnaire (`lieu_id` = ce lieu OU null).

**Algorithme de résolution** (à la facturation) :
1. Identifier l'activité (`zd`/`ag`), l'organisation programmatrice, `evenements.pax`, `evenements.lieu_id`.
2. Calculer la **base** : ZD → grille de l'org ; AG → tarif unitaire (si facturée à l'unité).
3. Collecter les **remises éligibles** de même `activite`, en vigueur :
   - `scope=organisation` avec `organisation_id` = programmateur
   - `scope=gestionnaire` avec `gestionnaire_organisation_id` référençant le lieu (via `organisations_lieux`) et `lieu_id` = ce lieu OU null
4. **Prix final = base × Π(1 − remise_pct)** — cumul **multiplicatif** de toutes les remises éligibles (pas de plafond dur V1). Le négocié ne « concurrence » plus le public : la base est ferme (le client paie sa grille), les remises s'empilent dessus.
5. Figer dans `factures_collectes` : `montant_ligne_ht` (final), `tarif_applique_id` + `tarif_applique_source` (la base), `tarif_detail` jsonb (base + remises appliquées).

**Exemple** : Butard (grille « Forfait + variable » 200 € + 1 €/pax) programme 300 pax chez Viparis (remise gestionnaire −5 %) → base = 200 + 300 = 500 € → final = 500 × 0,95 = **475 € HT**.

**Gestion Admin Savr** : grilles du catalogue, affectation des organisations et remises créées/modifiées depuis le back-office (§06.06). Versioning par fermeture + nouvelle ligne, jamais de modification rétroactive.

**Note** : aucun pouvoir de commande de collecte n'est accordé au gestionnaire de lieux en V1. Le gestionnaire consulte (et peut porter une remise sur ses lieux), il ne programme pas.

---

## 12. Règles de suppression et archivage

### Suppression de comptes

- **Qui peut initier** : l'utilisateur lui-même via son espace client (demande de suppression RGPD), ou l'Admin Savr
- **Validation** : toute demande de suppression est **validée par l'Admin Savr** avant exécution (SLA 48h ouvrées)
- **Deux niveaux** :
  - **Soft-delete** (par défaut) : `users.supprime_le` + `users.actif = false`. Les données liées (collectes, factures) sont conservées pour l'intégrité des registres. L'utilisateur ne peut plus se connecter. Ses contributions historiques restent attribuées à son identité (nom/prénom figés dans `evenements.created_by_snapshot`).
  - **Suppression dure** (sur demande explicite RGPD + validation Admin) : anonymisation des champs personnels (`users.email` → `deleted-{id}@savr.local`, `prenom`/`nom` → `Utilisateur supprimé`). Les obligations légales (factures, bordereaux, registre déchets) imposent de conserver la donnée comptable ; seule la PII (Personally Identifiable Information) est anonymisée.
- **Effet commun** : perte d'accès immédiate, session invalidée.

### Archivage des données

- **V1** : aucune durée de conservation fixée. Toutes les données restent accessibles indéfiniment.
- **Obligations légales à respecter malgré l'absence de politique explicite** : factures/bordereaux conservés minimum 10 ans (obligation comptable), registre déchets conservé minimum 5 ans (Code de l'environnement).
- **V2** : définir une politique RGPD de conservation + suppression automatique des données d'utilisateurs supprimés après N années.

---

## 13. Règles refonte formulaire programmation 2026-05-03

Issu de la refonte du formulaire de programmation §06.01. Les règles ci-dessous gouvernent les nouveaux comportements introduits. *(Note : `R_type_evenement_libre` retirée V1 le 2026-05-26 — propagation Sujet 4, cf. ci-dessous.)*

### R_type_evenement_libre **Retirée V1 (propagation Sujet 4 — type vs taille, 2026-05-26)**

> **Retirée V1 (Sujet 4, 2026-05-26)** : le mécanisme « Autre + texte libre + normalisation Admin » est supprimé. `types_evenements` est figé à 4 catégories de format de service (`cocktail_aperitif`, `cocktail_repas_complet`, `repas_assis`, `autre`), `autre` étant un fourre-tout sélectionnable **sans saisie**. Plus de colonne `type_evenement_libre`, plus de file de normalisation back-office. Les événements `autre` sont comptés comme un bucket benchmark normal. Extension du référentiel = ajout direct d'une ligne dans `types_evenements` (Supabase), sans UI. Cf. [[04 - Data Model]] table `types_evenements` + [[06 - Fonctionnalités détaillées/01 - Formulaire de programmation de collecte]].
>
>

### R_lieu_modif_pending *(simplifié 2026-05-25 — audit sobriété §04 B1)*

> ⚠ **Simplification 2026-05-25 (audit sobriété §04, B1)** : suppression de la table `lieux_modifications_en_attente` et de son workflow d'approbation (`en_attente`/`validee`/`rejetee` + `motif_rejet`). Remplacé par override per-collecte + signalement Admin léger (l'Admin édite le lieu directement dans le back-office existant). Plus de machine à états.

**Déclencheur** : à la confirmation d'une collecte, si l'utilisateur a modifié au moins une valeur affichée d'un lieu existant (cas "lieu existant" du formulaire §2.a).

**Action** :

1. INSERT `plateforme.collectes` avec les nouvelles valeurs stockées sur la collecte courante (override per-collecte via `collectes.lieu_overrides JSONB` — désormais défini dans la table `collectes` §04, option b).
2. **Notification Admin Savr** (le diff avant/après est lisible dans `collectes.lieu_overrides` comparé au `lieux` officiel + tracé dans `audit_log`). Pas d'INSERT dans une table dédiée.
3. **Le `plateforme.lieux` officiel n'est PAS mis à jour** automatiquement. Les autres programmeurs continuent de voir la valeur de référence.
4. L'Admin, s'il juge la correction pérenne, **édite le lieu directement** dans le back-office lieux existant (§06). Aucune action requise sinon — la collecte garde son override.

**Worklist Admin** : vue filtrée sur les collectes récentes dont `lieu_overrides IS NOT NULL` et dont une valeur diffère encore du `lieux` officiel (auto-résolutive — l'écart disparaît dès que l'Admin aligne le lieu). Pas de flag d'état à maintenir.

**Cas particulier — collecte en attente d'envoi TMS** : le snapshot lieu envoyé au TMS (E1) reflète toujours les valeurs override de la collecte (par construction, via `lieu_overrides`). Une édition Admin ultérieure du lieu officiel ne re-propage pas au TMS pour la collecte courante (snapshot figé) — elle s'applique aux futures collectes.

**SLA cible** : revue quotidienne par Admin (pas de SLA contractuel V1).

### R_date_evenement_auto_derive *(ajout 2026-05-29)*

**Règle** : `evenements.date_evenement` n'est jamais saisi par un utilisateur. Il est calculé automatiquement via trigger DB `fn_set_date_evenement` (`AFTER INSERT OR UPDATE OR DELETE ON collectes`, `FOR EACH ROW`) :

```sql
UPDATE evenements
SET date_evenement = (
  SELECT MIN(date_collecte) FROM collectes WHERE evenement_id = [id de l'événement]
)
WHERE id = [id de l'événement];
```

**Déclencheur** : toute insertion, modification de `date_collecte`, ou suppression d'une collecte. Si l'événement n'a plus aucune collecte (suppression de la dernière), `date_evenement` reste à la dernière valeur connue.

**Colonne nullable** *(révisé 2026-06-07 — test scenarios §06.01 F1 BLOQUANT, arbitrage Val)* : `evenements.date_evenement` est **nullable** (). La ligne `evenements` est écrite dès la phase brouillon du formulaire (étape 1, cf. `f_collecte_editable` qui inclut `brouillon`), avant toute saisie de `date_collecte` — NOT NULL rendait cet INSERT impossible, tout comme l'ordre d'insertion événement→collectes à la confirmation. `NULL` = brouillon sans collecte datée. Le trigger pose la valeur dès la première `date_collecte` insérée. **Garde applicative à la confirmation** : une soumission confirmée comporte toujours ≥ 1 collecte datée → `date_evenement` n'est jamais NULL sur un événement confirmé (les rapports §12 ne lisent que des collectes confirmées).

**Usage** : `date_evenement` est la référence des rapports PDF client (§12). La règle de dérivation = `MIN(date_collecte)` V1, extensible V2 sans migration (ex. date réelle de l'événement recueillie séparément).

---

### R_pax_collecte *(ajout 2026-05-29 — Retiré V1 2026-05-29)*

> **Retiré V1 (2026-05-29)** — règle supprimée. Le pax est **unique au niveau événement** (`evenements.pax`), non modifiable par collecte. La tarification ZD, les rapports de recyclage (§12) et le payload E1 lisent directement `evenements.pax`. Cas multi-jours à pax variable reporté V2.



---

### R_collecte_evenement_rattachement *(ajout 2026-05-21, D1)*

**Règle** : une collecte est rattachée à un événement **explicitement** via `collectes.evenement_id`. Le formulaire unique §06.01 crée l'événement puis ses collectes dans la même transaction ; l'ajout ultérieur d'une collecte (autre type) cible un `evenement_id` existant via le bouton "Ajouter une collecte" de la fiche événement. **Révisé 2026-05-25 (Sujet 1, option A)** : le besoin « camion supplémentaire » ne crée plus de collecte — il est interne au TMS (1 collecte ZD → N tournées prestataire).

**Suppression du matching textuel** : l'ancienne logique de rattachement automatique par correspondance `date + lieu + nom client` est **supprimée** (refonte 2026-05-21). Elle était source de doublons d'événements (faute de frappe sur le nom client → second événement créé au lieu d'un rattachement). Plus aucun rattachement implicite.

**Multi-collectes par événement** : un événement porte normalement une collecte ZD et/ou une collecte AG (types différents). **Révisé 2026-05-25 (Sujet 1, option A)** : le multi-camions n'est plus un cas de collectes ZD multiples (interne au TMS — 1 collecte ZD → N tournées prestataire). Pas de contrainte d'unicité de type par événement ; un second exemplaire du même type reste techniquement possible (cas distincts rares), l'UI avertit alors.

---

### R_controle_acces_cascade

**Déclencheur** : à la confirmation d'une collecte, valeur de `collectes.controle_acces_requis`. **Refonte 2026-05-21** : la valeur est **saisie une fois au niveau événement** (formulaire §06.01 étape 2.c — la contrainte vient du site) puis **copiée sur chaque collecte** de l'événement à l'INSERT. Le trigger ci-dessous reste inchangé (il opère par collecte, valeur idempotente sur le lieu).

**Action (cascade upgrade-only)** :

| Cas | `lieux.controle_acces_requis_default` AVANT | `collectes.controle_acces_requis` saisi | Effet sur le lieu |
|-----|--------------------------------------------|----------------------------------------|-------------------|
| 1 | `false` | `true` (coché) | **UPDATE lieux** à `true` (cascade upgrade) |
| 2 | `true` | `true` (coché, défaut hérité) | Aucun (déjà à `true`) |
| 3 | `true` | `false` (décoché) | **Aucun** — la collecte porte `false`, le lieu reste `true` pour les futurs |
| 4 | `false` | `false` (non coché) | Aucun |

**Justification** : éviter qu'un seul traiteur "casse" l'exigence d'un lieu pour les autres traiteurs (downgrade volontaire ou erreur). Le downgrade reste un acte Admin uniquement, via le formulaire de gestion des lieux (Admin Savr a un toggle dédié dans le référentiel lieu).

**Implémentation** : trigger DB `AFTER INSERT/UPDATE` sur `plateforme.collectes` :

```sql
IF NEW.controle_acces_requis = true
  AND (SELECT controle_acces_requis_default FROM plateforme.lieux WHERE id = NEW.lieu_id) = false
THEN
  UPDATE plateforme.lieux
  SET controle_acces_requis_default = true,
      updated_at = NOW()
  WHERE id = NEW.lieu_id;
END IF;
```

**Audit** : chaque cascade est loggée dans `audit_log` *(nom canonique — résidu `audit_logs` corrigé 2026-06-07 F1, table définie [[04 - Data Model#Table : `audit_log`]])* (action `controle_acces_cascade_upgrade`, user déclencheur = traiteur, lieu cible).

**Notification Admin** : optionnelle V1 (le lieu est juste "renforcé"). Pas de blocage. Pas de validation requise.

---

## Décisions prises

- **Tarification ZD** : catalogue de grilles (`grilles_tarifaires_zd`, méthodes `paliers` | `fixe_variable`, formule affine `prix_base_ht + prix_par_couvert_ht × pax`), grille affectée par organisation (`grille_tarifaire_zd_id`, NULL = grille défaut « Standard paliers » : 1-250→450 / 251-500→600 / 501-750→800 / 751-1000→1000 / >1000→1€/pax). Composition base × remises figée à la facturation via `tarif_detail` + `montant_ligne_ht` (refonte 2026-05-26).
- **Débit pack AG** : au statut `realisee` (dès confirmation TMS), sur le pack `actif` unique de l'organisation programmatrice (refonte 2026-05-08 — pack unique actif, suppression FIFO multi-packs)
- **Recrédit annulation post-réalisation** : automatique via trigger DB (refonte 2026-05-08, ex-manuel) — `credits_consommes -= 1` + bascule `epuise → actif` si applicable + UPDATE `collectes.pack_antgaspi_id = NULL` + audit_log. Override manuel via "Ajuster crédits" pour cas exceptionnels.
- **Facturation mensuelle** : génération de brouillon automatique possible, mais **validation Admin obligatoire avant envoi Pennylane** en V1. Automatisation totale V2.
- **Annulation collecte validée** : demande soumise par le traiteur → notification admin + prestataire si mandaté → confirmation admin requise
- **Sélection association AG** *(refonte 2026-05-09 — scoring supprimé)* : filtres binaires d'éligibilité (actif + région + horaires compatibles + `capacite_max_beneficiaires × 2 > volume_estime_repas`) puis **tri unique sur distance Haversine croissante**. Plus de scoring sur 100 points ni de pondération distance/capacité (supprimé car non utilisé en pratique — cf. §2 Sélection Association). Historique de fiabilité non retenu en V1.
- **Auto-accept** : configurable par combinaison (association + type événement), décision Admin Savr, pas de règle d'activation algorithmique
- **Numérotation** : séquences globales Savr par type de document, reset annuel au 1er janvier
- **Cycle de vie collecte 100% automatisé en V1** : clôture auto, rapport + bordereau + facture brouillon générés sans intervention admin. Admin intervient UNIQUEMENT sur annulations, modifications post-programmation, ou incidents
- **Incidents facturation** : collecte manquée par prestataire = pas de facturation ; annulation client ≥ 12h avant = pas de facturation ; annulation client < 12h ou après mandat prestataire = plein tarif (seuil aligné §4bis Annulation last minute)
- **Contestation pesée** : délai **48h après réception du rapport de collecte** pour le traiteur (décision Val 2026-04-28) — la collecte reste `cloturee` (statut `en_reexamen` supprimé, audit sobriété §04 2026-05-25 D1), correction par édition Admin + recalcul, régénération bordereau + rapport + facture avec avoir si nécessaire
- **Équivalent roll** : saisi par le chauffeur TMS (pas 0,25 jusqu'à 2, puis pas 0,5) pour déclaration visuelle rapide sans pesée systématique
- **Bordereaux** : générés automatiquement à la clôture ZD, snapshot producteur/transporteur/exutoire, versionnés si correction
- **Attestations de don** : générées pour **100% des collectes AG** (batch J+1 6h), avec mention fiscale uniquement si association habilitée 2041-GE
- **Onboarding 100% automatisé V1** : création de compte libre, complétion progressive, aucune validation Admin amont. Facturation automatique dès clôture (contrôles SIRET/TVA/CGV). Admin peut désactiver a posteriori
- **Multi-domaines email** : table N-N `organisations_domaines_email` (1 organisation peut avoir plusieurs domaines email, 1 domaine pointé sur 1 organisation max)
- **Notifications V1** : email transactionnel uniquement, destinataire = programmeur de la collecte, événements déclencheurs métier + système. *(Template « plaque chauffeur » T+3h retiré V1 — la notification client de plaque a été supprimée ; la plaque reste saisie côté TMS pour traçabilité interne uniquement, cf. matrice §9.)*
- **SLAs V1** : rapport post-collecte max 24h (embargo H+24), bordereau et attestation batch J+1 6h. **Pas de SLA sur brouillon facture** (décision Val 2026-04-28 — pas d'engagement contractuel), ni sur délai programmation ni validation Admin
- **Dashboards gestionnaires de lieux** : vue agrégée par défaut, filtres période/lieu/traiteur/type événement, drill-down, données nominatives, KPIs V1 (taux de recyclage ZD-only formule à captation, tonnage par flux, CO₂e évité, nombre collectes/événements)
- **Remises négociées `tarifs_negocie`** (refonte 2026-05-26) : la table ne porte plus que des **remises %** (`remise_pct`), ZD + AG (AG = collectes unitaires uniquement), × scope organisation (programmateur) + scope gestionnaire (lieu). Cumul **multiplicatif** sur la base (catalogue de grilles ZD / tarif unitaire AG) : `prix = base × Π(1 − remise_pct)`. Plus de prix absolu ni de règle « plus bas l'emporte ». Versioning par fermeture + nouvelle ligne. Pas de pouvoir de commande accordé au gestionnaire (décision Val 2026-04-28, maintenue)
- **`reference_affaire` sur événements** : champ optionnel texte libre, saisi par `traiteur_commercial` ou `traiteur_manager` à la programmation. Reporté sur facture Pennylane (champ "Référence") et PDF Savr. Disponible pour tous les clients (décision Val 2026-04-28)
- **Suppression de comptes** : demande possible par l'utilisateur ou l'Admin, validation systématique Admin (SLA 48h). Deux niveaux : soft-delete (défaut) ou suppression dure / anonymisation PII (sur demande RGPD explicite). Données comptables légales conservées
- **Archivage** : aucune durée de conservation fixée en V1. Obligations légales min : 10 ans factures/bordereaux, 5 ans registre déchets
- **Bordereau, attestation et rapport de recyclage** : émission batch J+1 6h. Embargo H+24 strict sur le rapport de recyclage (pas généré ni accessible avant).
- : **supprimée V1 (décision Val 2026-06-15)** — type `alerte_ops_pesee_anormale` seedé mais jamais déclenché. V1.1 si besoin.
- **Régénération rapport** : disponible pour `traiteur_manager`. Picto ⟳ + mention "Mis à jour le [date]" sur l'interface et en pied de PDF. Traçabilité dans `audit_log`.
- **Export CSV** : disponible pour tous les profils, filtré par RLS (chaque profil exporte uniquement ses données)
- **Seuil alerte pack AG bas** : ≤ 10% des crédits initiaux restants
- **Pas de pénalité d'annulation** au-delà des règles 12h / post-mandat prestataire en V1
- **Réouvert 2026-05-07** : le gestionnaire de lieux peut programmer des collectes en V1 sur ses propres lieux (via `organisations_lieux`). Pas de nouveau rôle créé : le rôle `gestionnaire_lieux` existant est étendu (programmation + facturation + pack AG). Voir décisions ci-dessous.
- **Programmation ouverte aux 3 types en V1 (2026-05-07)** : `traiteur`, `agence` et `gestionnaire_lieux` peuvent programmer une collecte. Périmètre agence = ouvert (n'importe quel traiteur opérationnel et n'importe quel lieu). Périmètre gestionnaire = fermé à ses propres lieux (via `organisations_lieux`). Onboarding bloquant identique pour les 3 types.
- **Programmateur=facturé V1 (2026-05-07)** : `evenements.entite_facturation_id` doit appartenir à `evenements.organisation_id`. Pas de découplage. Refacturation interne (agence facturée puis refacture le traiteur en off-Plateforme) est hors scope Savr en V1. Découplage reportable V2 si besoin métier (réintroduction colonne `organisation_facturation_id`).
- **Validation traiteur opérationnel = info-only (2026-05-07)** : quand une agence ou un gestionnaire programme avec un traiteur opérationnel, ce dernier reçoit une notification email info-only (pas de validation requise). Le traiteur conserve le droit de retrait (annulation depuis son espace, workflow existant). Aucun statut de collecte additionnel créé.
- **Fiche traiteur shadow (2026-05-07)** : une agence (uniquement) peut programmer avec un traiteur hors référentiel Savr. Création d'une fiche `organisations` shadow (`est_shadow=true`, pas de user, pas d'`entite_facturation`). UX impose une alerte "SIRET fortement recommandé sinon bordereau réglementaire impossible". Notification Admin Savr → revue manuelle → promotion (continuité historique préservée) ou fusion avec organisation existante. Gestionnaires de lieux ne peuvent pas créer de fiche shadow (restreints au référentiel traiteurs Savr).
- **Pack AG ouvert aux 3 types (2026-05-07)** : un pack `packs_antgaspi` peut appartenir à un traiteur, une agence ou un gestionnaire de lieux. Le crédit AG est décompté sur le pack du programmateur (`evenements.organisation_id`), pas sur celui du traiteur opérationnel. Voir §06.09.

## Questions ouvertes

_Aucune — module stabilisé pour V1. (2026-04-28)_

**Clôturé** : traité côté contrat commercial, hors scope CDC. (2026-04-28)
**Clôturé** : à cadrer avec juridique séparément, hors scope CDC V1. (2026-04-28)

## Liens

- [[01 - Vision et objectifs]]
- [[03 - Périmètre fonctionnel global]]
- [[04 - Data Model]] (tables tarifaires, packs, factures, bordereaux, attestations)
- [[09 - Authentification et permissions]] (politiques RLS registre)
- [[08 - APIs et intégrations]] (Pennylane, Everest, TMS Savr)

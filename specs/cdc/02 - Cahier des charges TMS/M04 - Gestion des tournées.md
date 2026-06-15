# M04 — Gestion des tournées

**Statut** : V1 rédigée (session 2026-04-23 — 9 décisions structurantes tranchées) + revue sobriété 2026-04-29
**Persona principal** : Ops Savr (constitution, ajustements), Manager prestataire (assignation chauffeur/véhicule), Chauffeur (exécution terrain via M05)
**Contexte d'usage** : poste de commandement logistique — constitution au dispatch (6h-10h), suivi temps réel jour J, clôture et correction post-course
**Dernière mise à jour** : 2026-06-04 (**purge dette propagation S6 dans le corps** — revue sobriété, Dette Lot 2 : le webhook S6 `course-cout-calculee` était supprimé en tête depuis 2026-05-01 mais toujours décrit comme actif dans le corps (diagramme cycle de vie, table transitions, W5 step 7, W8 step 10, W « clôture forcée » step 7, §8 M07, §9 récap webhooks, D5, Liens ×2). Tous reframés sur **UPDATE `cout_final_ht`/`push_s6_version` → trigger DB cross-schema `plateforme.fn_recalc_marge_tournee()`** (lecture vue `plateforme.v_courses_logistiques`, synchrone en DB, plus de webhook HTTP). S3 + S7 inchangés. Cross-CDC 0.) / 2026-06-04 (propagation suppression saisie plaque terrain — arbitrage Val : retrait saisie plaque chauffeur au démarrage de tournée. Conséquences M04 : workflow W4 simplifié (plus de saisie plaque, plus d'écriture `plaque_saisie_terrain`, plus de webhook S7 côté chauffeur), KPI désync plaque retiré, cas C2 retiré, D4 caduque, addendum §3 W6 héritage plaque caduc, alertes `m04_plaque_mismatch_warning`+`m04_plaque_inconnue`+`plaque_divergente_autre_vehicule`+`plaque_inconnue_prestataire` retirées (7→5). **Clarification structurante : le webhook S7 `plaque-saisie` est émis par le MANAGER en M03 E4 (pré-saisie plaque pour contrôle d'accès), pas par le chauffeur** — lève les références erronées historiques ci-dessous qui confondaient plaque manager et plaque terrain.) / 2026-05-01 (propagation revue sobriété §08 Bloc A + Bloc C — webhook S6 `course-cout-calculee` supprimé Bloc A → trigger DB cross-schema `plateforme.fn_recalc_marge_tournee()` ; **webhook S7 `plaque-saisie` supprimé Bloc C → vue cross-schema `plateforme.v_courses_logistiques.plaque_saisie_terrain` + `heure_reelle_*`**. Toutes les mentions "S6 émis"/"S7 émis"/"webhook S6"/"webhook S7"/"fan-out email T+3h" ci-dessous sont obsolètes V1 — l'email T+3h avait déjà été retiré 2026-04-24, le webhook S7 est désormais aussi supprimé V1. Conservées en historique pour traçabilité.) / 2026-04-29 (revue sobriété M04 — voir Addendum ci-dessous + propagation revue sobriété M05 2026-04-29 : suppression Cas A "pré-saisie plaque manager", retrait R_M04.PLAQUE + champ `tournees.plaque_preassignee_manager` + alerte `m05_plaque_override_chauffeur`. Plaque saisie 100% chauffeur en M05 E3.)

---

## ⚠ Addendum 2026-04-29 — Revue sobriété M04

Issu de la revue de sobriété M04 (session dédiée 2026-04-29). 8 simplifications appliquées :

1. **Suppression "Nom tournée"** — champ libre optionnel sans valeur métier identifiée. T# (ID court) suffit comme identifiant. Impact : E1, E2, E3 Section 1, §11 paramètre, §13 question, toast.
2. **Réordonnancement collectes par Ops** — flèches ▲▼ par ligne dans E3 Section 2. Ajout colonne `ordre_dans_tournee` *(déplacée sur `tms.collecte_tournees` — multi-camions 2026-05-25, ex `collectes_tms`)* (propagation §04 TMS).
3. **E1 bloc récap collectes** — ajout adresse complète du lieu + nom traiteur (lisibilité au dispatch).
4. **E2 colonnes refondues** — 1 cellule unique "Événements" empilant lieu + traiteur + nb pax par event (vs N colonnes variables ingérables). Suppression colonnes "Nom" + "Coût calculé" + "Badges anomalies". Ajout équipier dans cellule "Chauffeur".
5. **E3 Section 2 enrichie** — ajout par collecte : traiteur, nb pax, nb rolls prévus (calcul à la volée M09 R4.4 par collecte), distance km depuis collecte précédente (calcul Haversine à la volée, pas de stockage).
6. **E3 Section 3 — suppression bouton "Ouvrir audit plaque"** — historique audit accessible Admin via SQL `audit_logs`. Pas d'UI dédiée V1.
7. **E3 Section 6 Historique reportée V2** — audit logs conservés en DB (réglementaire + debug). V1 = un simple badge "Audit disponible (Admin)" en pied de E3, pas de feed UI.
8. **V2 — Manager prestataire constitue tournées** — capacité de constitution côté portail M03 ouverte en V2 (déjà partiellement préparé via D1 retenue Option A V1).

**E4 portail prestataire** : reformulé "vue identique à E3 Ops avec restriction RLS `prestataire_id`". Spec UX détaillée reste dans M03.

---

## ⚠ Addendum 2026-04-24 (propagation M03) — Validation plaque avant dispatch — **RESTAURÉ 2026-05-01 — RENOMMÉ + ÉTENDU 2026-05-03 (refonte formulaire §06.01 Plateforme)**

> **NOTE 2026-05-03 (refonte formulaire §06.01 Plateforme)** : addendum **renommé + étendu** — `plaque_requise` → `controle_acces_requis` (flag unique plaque + nom chauffeur), R_M04.PLAQUE → R_M04.CONTROLE_ACCES, trigger `validate_tournee_plaque_requise` → `validate_tournee_controle_acces` (validation étendue à `tournees.chauffeur_id IS NOT NULL` en plus de la plaque). Webhook S7 enrichi payload `plaque + chauffeur_nom`. **Toutes les mentions strikethrough ci-dessous doivent être lues comme actives V1**, en remplaçant `plaque_requise` par `controle_acces_requis` et `R_M04.PLAQUE` par `R_M04.CONTROLE_ACCES`. Voir [[../05 - Règles métier TMS#R_M04.CONTROLE_ACCES]] et [[../04 - Data Model TMS]] table `tournees` section trigger.

> **NOTE 2026-05-01 (audit cohérence inter-CDC)** : la chaîne `plaque_requise` (puis `controle_acces_requis` 2026-05-03) est **restaurée V1** suite au besoin métier "commercial traiteur demande la plaque pour contrôle d'accès anticipé site → manager prestataire pré-saisit en M03 E4 → blocage validation tournée si manquante". Annule la NOTE 2026-04-29 ci-dessous.

> : **ANNULÉE 2026-05-01 + 2026-05-03** : voir notes ci-dessus. La plaque est saisie par le manager prestataire en M03 E4 (pré-saisie obligatoire si `controle_acces_requis=true`), restaurée 2026-05-01. — **restaurés** 2026-05-01 + renommés `R_M04.CONTROLE_ACCES` + extension validation chauffeur 2026-05-03.

Issu de la rédaction de [[M03 - Portail prestataire self-service]] (V1, 16 décisions). 3 impacts sur M04.

### 1. Nouvelle règle R_M04.PLAQUE — Blocage assignation tournée sans plaque pré-saisie — Retirée 2026-04-29




-
- (retiré data model)
- (retiré, M03 E4 Section 3 véhicule désormais toujours optionnel)

**Remplacement V1 (revue sobriété M05 2026-04-29)** : aucune contrainte de plaque pré-saisie. Le manager peut renseigner le véhicule à titre indicatif côté M03 E4 mais ce n'est jamais bloquant. La plaque effective est saisie par le chauffeur en M05 E3 puis émise via webhook S7.

### 2. Plaque pré-saisie = pré-remplissage M05 checklist (E3) — Retirée 2026-04-29



**Remplacement V1 (revue sobriété M05 2026-04-29)** : la plaque est saisie 100% chauffeur en M05 E3 (sans pré-remplissage). Webhook S7 `plaque-saisie` émet la plaque chauffeur en source de vérité unique.

### 3. W6 Remplacement chauffeur — héritage plaque (révisée 2026-04-29) — **Caduque (propagation suppression saisie plaque terrain 2026-06-04)**

Plus de saisie plaque chauffeur en M05 E3. Le remplacement de chauffeur (W6) n'a plus de logique d'héritage de plaque terrain. La plaque pour contrôle d'accès reste la **plaque pré-saisie manager** (`tournees.plaque_preassignee_manager`), indépendante du remplacement chauffeur.

---

**Cohérence CDC** :
- [[03 - Périmètre fonctionnel TMS#M04 — Gestion des tournées (vacations)]] — scope haut niveau
- [[04 - Data Model TMS#Table : `tournees`]] — 20 colonnes, FK, RLS
- [[05 - Règles métier TMS#R2 — Calcul coût tournée (M07)]] — algo coût
- [[05 - Règles métier TMS#R6.2 — Cycle de vie `tournees`]] — transitions
- [[08 - Contrat API Plateforme-TMS]] — S3 `tournee-upsert`, (supprimé Bloc A A2 → vue cross-schema `plateforme.v_courses_logistiques`), S7 `plaque-saisie` *(S7 émis par le manager M03 E4, pas par le chauffeur — propagation 2026-06-04)*
- [[09 - Authentification et permissions TMS]] — RLS tournées par rôle
- [[M01 - Réception ordres de collecte]] — en amont
- [[M02 - Dispatch Ops Savr]] — E1 étendu avec multi-sélection + "Créer tournée"

---

## 1. Objectif métier

La tournée est l'**unité d'exécution** du TMS. Elle lie 1 vacation (1 camion + 1 chauffeur + fenêtre opérationnelle) à N collectes logistiquement cohérentes (même prestataire, heures de collecte rapprochées, même zone). Tout le pilotage opérationnel et financier se fait au niveau tournée : coût vacation, plaque communiquée au client, pesées agrégées, facturation prestataire, statut temps réel. **Note 2026-04-29** : la fenêtre tournée (`heure_planifiee_debut/fin`) est conservée comme concept distinct de l'`heure_collecte` (point fixe par collecte). Le tampon entre `max(heure_collecte)` et `heure_planifiee_fin` est arbitré par Ops (paramètre `m04_tournee_tampon_minutes`, défaut 30).

**Ce que M04 résout vs MTS-1** :
- Constitution explicite de la tournée côté Savr (Ops) avant acceptation prestataire, au lieu du flou manuel actuel
- Traçabilité audit de chaque modification (création, ajout collecte, remplacement chauffeur/véhicule, correction durée)
- Calcul de coût automatique à la clôture (R2) sans ressaisie manuelle
- Contrôle géolocalisé de la clôture (détection de dérive facturation)

**KPI cibles V1** :
- 100% des tournées avec `cout_calcule_ht` dans les 2h suivant la clôture
- < 5% de tournées avec `cloture_hors_zone=true` par prestataire (au-delà → investigation)
- **Retiré V1 (propagation suppression saisie plaque terrain 2026-06-04)** — plus de plaque saisie chauffeur

---

## 2. Personas et contexte d'usage

### Ops Savr (constitution et supervision)
- Desktop bureau, écran 15"+
- Pic d'activité : constitution des tournées 6h-10h (au dispatch M02), supervision continue toute la journée
- Action critique : ajout collecte à tournée existante quand une collecte arrive tardivement (typique fin d'après-midi pour le lendemain)
- Peut corriger durée a posteriori, remplacer chauffeur/véhicule en urgence, annuler tournée avec motif

### Manager prestataire (assignation chauffeur/véhicule)
- Web desktop ou mobile via M03 (portail self-service)
- Voit la tournée en bloc dès création côté TMS (via webhook S3 miroir Plateforme → portail)
- Accepte les collectes **individuellement** (pas la tournée en bloc) — flux M02 inchangé
- Assigne chauffeur + véhicule (+ équipier optionnel) **au niveau tournée** (1 saisie pour N collectes)
- Périmètre V1 : Strike, Marathon, A Toutes! uniquement (province gérée par Ops)

### Admin TMS (Val, Louis)
- Accès complet. Seul acteur autorisé à :
  - Corriger la durée a posteriori d'une tournée dont la facture est en cours de rapprochement (Ops aussi autorisé, Admin garde le droit)
  - Re-synchroniser une tournée désynchronisée avec la Plateforme
  - Modifier les paramètres M04 (cut-off géoloc, seuil inactivité, etc.)

### Chauffeur (exécution terrain via M05)
- App mobile PWA
- Voit sa tournée : liste des collectes ordonnées, checklist pré-départ (ZD uniquement), boutons de transition statut
- **Retiré V1 (propagation suppression saisie plaque terrain 2026-06-04)** — plus de saisie plaque chauffeur ; la plaque pour contrôle d'accès est pré-saisie par le manager (M03 E4)
- Effectue collectes, pesées, clôture tournée au retour entrepôt (ZD) ou dernière livraison (AG)

---

## 3. Architecture des écrans

Cinq écrans V1.

| # | Écran | Rôle | Acteurs |
|---|-------|------|---------|
| E1 | Création tournée (modal dispatch) | Extension M02 — multi-sélection collectes → "Créer tournée" | Ops, Admin TMS |
| E2 | Liste tournées | Vue consolidée toutes tournées (filtres date, prestataire, statut) | Ops, Admin TMS |
| E3 | Détail tournée (cœur M04) | Fiche complète + actions + historique | Ops, Admin TMS |
| E4 | Vue tournée portail prestataire | Manager voit la tournée et assigne chauffeur/véhicule | Manager prestataire (via M03) |
| E5 | Vue tournée app mobile | Chauffeur exécute les collectes de sa tournée | Chauffeur (via M05) |

**Navigation** : depuis M02 E1 dashboard dispatch, lien "Tournées" ouvre E2. Depuis E2, clic sur une tournée ouvre E3. E3 est le seul écran avec pouvoir d'action côté Ops (modification, correction, annulation). E4 et E5 sont documentés ici mais spécifiés dans M03 (portail prestataire) et M05 (app mobile) respectivement — ce document couvre les **données** et **règles** métier, pas le détail UX app mobile.

---

## 4. Cycle de vie d'une tournée

Rappel [[05 - Règles métier TMS#R6.2 — Cycle de vie `tournees`]] enrichi avec les acteurs autorisés par transition :

```
[création]
  └─> planifiee  (Ops Savr au dispatch M02)
        │
        ├─> acceptee   (tournée PRÊTE : toutes collectes acceptées + chauffeur/véhicule assignés ;
        │     │          Strike/Marathon = via manager M03 W3 step 5 ; province = créée directement `acceptee` par Ops via W2 M02 — pas de validation prestataire)
        │     │
        │     ├─> en_cours   (Chauffeur clique "Démarrer" sur app M05 — chauffeur province inclus)
        │     │     │
        │     │     ├─> terminee  (Chauffeur clique "Terminer" → clôture auto coût M07 → trigger DB cross-schema recalc marge Plateforme)
        │     │     │
        │     │     └─> annulee  (jamais — une tournée en cours finit toujours, cf. R2.7 bis)
        │     │
        │     ├─> terminee   (FILET DE SÉCURITÉ : toutes collectes terminales par incident/annulation AVANT démarrage chauffeur, ou clôture forcée Ops W9 — tournée jamais passée en_cours)
        │     │
        │     └─> planifiee  (retour si Ops ajoute une collecte non encore acceptée, W2)
        │
        └─> annulee    (Ops Savr avec motif obligatoire, avant démarrage chauffeur)
```

**Transitions non autorisées** :
- `planifiee` → `en_cours` direct (il faut passer par `acceptee` — tournée prête, chauffeur/véhicule assignés ; décision 2026-06-06 alignant M04 sur R6.2 §05)
- `planifiee` → `terminee` direct (il faut passer par `acceptee` puis `en_cours`, ou filet de sécurité depuis `acceptee`)
- `terminee` → `planifiee` (terminal hors correction de durée)
- `annulee` → n'importe quoi (terminal)
- `en_cours` → `annulee` (R2.7 bis : une tournée démarrée finit même si toutes ses collectes sont annulées par le client — vacation facturée)

> **Note 2026-06-06 (résolution spec floue cycle de vie tournée)** : M04 décrivait historiquement `planifiee → en_cours` direct, alors que [[../05 - Règles métier TMS#R6.2 — Cycle de vie `tournees`]] et le trigger `fn_m07_calc_cost` (§04, `OLD.statut IN ('en_cours','acceptee')`) prévoyaient un état `acceptee`. **Tranché Val** : la tournée passe bien par `acceptee` (= tournée prête à rouler). État posé par M03 W3 step 5 (Strike/Marathon, toutes collectes acceptées + affectation faite) ou directement à la création province (W2 M02, confirmation manuelle Ops = acceptation, sans validation prestataire — le chauffeur province utilise l'app M05 comme les autres). Le `acceptee → terminee` = **filet de sécurité** (clôture sans démarrage), valable pour tous les prestataires.

**Événements déclencheurs** :

| Transition | Déclencheur | Acteur | Webhook émis |
|---|---|---|---|
| `[néant]` → `planifiee` | Création tournée au dispatch | Ops Savr | S3 `tournee-upsert` (création) |
| `planifiee` (modif) | Ajout collecte, remplacement véhicule/chauffeur assigné | Ops Savr ou Manager | S3 `tournee-upsert` (update) |
| `planifiee` → `acceptee` | Toutes collectes acceptées + chauffeur/véhicule assignés (M03 W3 step 5) ; ou création directe province (W2 M02) | Manager prestataire / Ops Savr | S3 `tournee-upsert` (re-émis pour chauffeur/véhicule) — **statut_tournee payload = `planifiee`** (`acceptee` = interne TMS, mappé `planifiee` dans le contrat §08, non exposé) |
| `acceptee` → `planifiee` | Ajout d'une collecte non encore acceptée (W2) — la tournée n'est plus complète | Ops Savr | S3 `tournee-upsert` (update) — payload `planifiee` inchangé |
| `acceptee` → `en_cours` | Clic "Démarrer" (checklist pré-départ M05 pour ZD, direct pour AG/vélo) | Chauffeur | S3 `tournee-upsert` (statut_tournee `en_cours`) — *plus de S7 côté chauffeur, propagation 2026-06-04* |
| `en_cours` (modif) | Remplacement véhicule ou chauffeur en urgence | Ops Savr | S3 `tournee-upsert` (update) |
| `en_cours` → `terminee` | Clic "Terminer" + toutes collectes terminales | Chauffeur (ou Ops si clôture forcée) | S3 `tournee-upsert` (statut_tournee `realisee` — mapping `terminee`→`realisee`) ; recalc marge Plateforme via trigger DB cross-schema `plateforme.fn_recalc_marge_tournee()` (ex-S6 supprimé Bloc A A2, plus de webhook HTTP) |
| `acceptee` → `terminee` | Filet de sécurité : toutes collectes terminales avant démarrage, ou clôture forcée Ops W9 | Système / Ops Savr | S3 `tournee-upsert` (statut_tournee `realisee`) ; recalc marge (idem ci-dessus) |
| `planifiee` / `acceptee` → `annulee` | Ops annule avec motif (avant démarrage) | Ops Savr | S3 `tournee-upsert` (statut_tournee `annulee`) |

**Clôture auto** (R6.2) : dès que **toutes** les `collectes_tms` de la tournée ont un `statut_operationnel` terminal (`realisee`, `realisee_sans_collecte`, `incident`, `annulee`), la tournée bascule auto en `terminee`. Déclenche immédiatement :
1. Calcul coût M07 (R2) → UPDATE `tms.tournees.cout_final_ht` + incrément `push_s6_version`
2. **Recalcul marge Plateforme via trigger DB cross-schema** `plateforme.fn_recalc_marge_tournee()` (sur UPDATE `cout_final_ht` / `push_s6_version`, lecture vue `plateforme.v_courses_logistiques`) — *ex-webhook S6 `course-cout-calculee` supprimé Bloc A A2, recalcul synchrone en DB, pas de réseau ni retry ni DLQ*
3. **Trigger M10 sur passage à `terminee`** : le passage `OLD.statut <> 'terminee' AND NEW.statut = 'terminee'` déclenche `trg_m10_auto_increment_pleins`. La fonction itère en interne sur `pesees_brutes JOIN collectes_tms` filtrées sur `type_flux IN ('biodechet','verre','dechet_residuel','emballage','carton')` (5 flux ZD V1). Si la tournée est purement AG (aucune pesée ZD) → no-op silencieux. Sinon : auto-incrémentation `stocks_bacs_entrepot.quantite_pleine` + décrément `quantite_vide_disponible` puis `UPDATE tournees SET stock_entrepot_update_at = now()` (cf. R5.5 / [[M10 - Gestion exutoires Veolia#W1|M10 W1]]) — propagation M10 2026-04-25. Idempotent par check `NEW.stock_entrepot_update_at IS NULL` au démarrage du trigger (skip si déjà propagé)

---

## 5. Écran par écran

### E1 — Création tournée (modal dispatch)

**Accès** : depuis M02 E1 dashboard dispatch, Ops multi-sélectionne N collectes (≥1) et clique "Créer tournée" dans la barre d'actions groupées.

**Layout modal** :

Entête : `Créer une tournée pour <Nom prestataire>` (nom tiré de `shared.prestataires` si toutes les collectes sélectionnées partagent le même `prestataire_id`).

Bloc récap collectes sélectionnées (tableau) :
- Lieu (nom + adresse complète + code postal — propagation revue sobriété 2026-04-29)
- Traiteur (nom — propagation revue sobriété 2026-04-29)
- Heure de collecte (point fixe — propagation 2026-04-29)
- Type (ZD / AG)
- Nb pax
- Bouton "Retirer de la tournée" (retourne la collecte dans la liste dispatch sans créer la tournée)

Bloc tournée :
- **Supprimé V1 (revue sobriété 2026-04-29)** — champ libre optionnel sans valeur métier. T# (ID court) suffit comme identifiant.
- **Fenêtre opérationnelle prévisionnelle** : auto-suggérée `min(heure_collecte)` → `max(heure_collecte) + m04_tournee_tampon_minutes` (défaut 30 min, paramétrable). **Éditable Ops** — Ops arbitre selon temps tournée nécessaire (V2 : dérivation automatique enrichie). Stockée dans `tournees.heure_planifiee_debut` / `heure_planifiee_fin` (propagation 2026-04-29).
- **Type tournée** : auto-déterminé selon prestataire (`zd_camion`, `ag_camion`, `ag_velo`). Non éditable (contrainte data model).
- **Véhicule pré-assigné** (optionnel) : dropdown des véhicules actifs du prestataire. Utile si Ops sait déjà quel camion sera dispo. Laissé vide → manager assignera.
- **Chauffeur pré-assigné** (optionnel) : idem.

Bloc validation :
- Contrôle 1 : toutes les collectes sélectionnées doivent avoir le même `prestataire_id`. Sinon erreur bloquante "Impossible : prestataires différents sur la sélection".
- Contrôle 2 : si `type_tournee=ag_velo` et N > 1 → erreur bloquante "Tournée vélo A Toutes! limitée à 1 collecte" (D8). *(Bloque N **collectes** sur 1 vélo. N'empêche **pas** le multi-vélo « 1 collecte = N vélos » : chaque tournée sœur est créée avec 1 seule collecte via « + Ajouter un vélo », cf. E1bis — généralisation 2026-05-29.)*
- Contrôle 3 : fenêtre opérationnelle prévisionnelle valide (`heure_planifiee_fin > heure_planifiee_debut`).

Bouton principal "Créer la tournée" → création `tournees` + **insertion des lignes `collecte_tournees`** (1 par collecte sélectionnée, avec `ordre_dans_tournee` = ordre de sélection) *(propagation multi-camions 2026-05-25 — ex `collectes_tms.tournee_id` retiré)* + webhook S3 émis (avec `collecte_ids[]`) + toast succès "Tournée T#<id> créée · 3 collectes · Strike · mardi 18h-22h · Manager notifié" (propagation revue sobriété 2026-04-29 : suppression mention nom tournée).

**Raccourci clavier** : `Ctrl+T` (ou `Cmd+T`) quand ≥2 collectes sélectionnées dans la liste dispatch → ouvre directement E1.

### E1bis — Multi-véhicules : plusieurs tournées pour une collecte (refonte 2026-05-25, arbitrage 3b ; **généralisé vélo AG 2026-05-29**)

**Problème** : une grosse collecte dépasse la capacité d'un seul véhicule → l'Ops doit la confier à **N véhicules = N tournées**. Deux cas concrets : une grosse collecte ZD (ex. 3000 pax) répartie sur N camions ; **une collecte AG dont le volume de repas dépasse la capacité d'un vélo cargo réfrigéré A Toutes! → N vélos** (généralisation 2026-05-29). Le découpage est **interne au TMS** (l'Ops/dispatch décide selon le volume réel) ; la Plateforme ne commande jamais un nombre de véhicules.

**Affordance "Ajouter un véhicule"** : sur la fiche collecte (E3 d'une tournée la contenant, et dans le drawer collecte M02), bouton **"+ Ajouter un véhicule"** *(libellé contextuel selon `type_tournee` : « + Ajouter un camion » pour ZD/AG camion, « + Ajouter un vélo » pour AG vélo — généralisation 2026-05-29, ex « + Ajouter un camion »)* qui :
- crée une **nouvelle tournée sœur** (même prestataire) pré-remplie avec cette collecte (nouvelle ligne `collecte_tournees`),
- ouvre E1 pour compléter chauffeur/véhicule/fenêtre de cette tournée additionnelle,
- **réutilisable autant de fois que nécessaire** (N véhicules illimité).

**Véhicules hétérogènes** : chaque tournée garde son propre véhicule/type/chauffeur/plaque — les N véhicules d'une collecte peuvent être de **types différents** (ex. 1 fourgon + 2 poids lourds en ZD). Aucune contrainte d'homogénéité. *(Pour le vélo AG, les N tournées sœurs sont toutes `ag_velo` même prestataire A Toutes! — homogènes en pratique car le multi-vélo ne se déclenche que sur un manque de capacité vélo.)*

**Conséquence sur la sélection au dispatch** : une collecte déjà rattachée à une (ou N) tournée(s) peut être **re-sélectionnée** pour être ajoutée à une tournée supplémentaire (le filtre d'exclusion de W1/§dispatch ne s'applique qu'à la **première** affectation ; l'ajout de véhicules passe par "+ Ajouter un véhicule" ou par sélection explicite "voir aussi collectes en tournée").

**Pesées & clôture** : chaque véhicule (tournée) pèse **sa portion** de la collecte (`pesees` par `tournee_id`) et son chauffeur clôture **sa** tournée. La collecte passe `realisee` quand **toutes** ses tournées sont `terminee` (dérivation R6.1, trigger `fn_derive_statut_collecte_multi_tournees`), déclenchant **un seul** S5 terminal avec les pesées des N véhicules sommées par flux (ZD) ou en `don_alimentaire` total (AG). Coût : chaque tournée répartit son coût sur ses collectes (`collecte_tournees.cout_reparti_centimes`), le coût total de la collecte = somme de ses parts.

**Multi-vélo AG — multi-facturation & Everest (2026-05-29)** : sur le vélo A Toutes!, chaque tournée sœur = **une mission Everest distincte** (`tms.everest_missions`, 1 ligne par tournée, même `collecte_tms_id`). A Toutes! facturant **par course/coursier**, N vélos = N missions = **N courses facturées** pour la même collecte (cohérent avec la justif d'origine de D8). L'acceptation Everest se fait mission par mission ; la collecte passe `acceptee` dès la **1re** mission dispatchée (les suivantes = no-op idempotent, cf. M14 W2 + R_M14.3). L'annulation de la collecte annule **toutes** ses missions vélo actives (cascade M14 W3, cf. R_M14.7). Détail technique : M14 §«Granularité Everest».

**Distinction avec D8 (deux axes orthogonaux)** : D8 interdit **N collectes sur 1 vélo** (« 1 vélo = 1 collecte ») — toujours en vigueur. Le multi-vélo ci-dessus est l'axe **inverse** (« 1 collecte = N vélos ») : chaque tournée vélo ne porte toujours qu'**une seule** collecte (D8 respecté), on autorise juste cette collecte à figurer sur N tournées vélo sœurs. Les deux règles sont compatibles.

### E2 — Liste tournées

**Accès** : onglet "Tournées" du header TMS (après "Dispatch" de M02).

**Layout** : tableau plein écran avec filtres latéraux gauche.

Colonnes (refonte revue sobriété 2026-04-29) :
- **T#** — ID court, clic → E3
- **Fenêtre tournée prévisionnelle** — date + `heure_planifiee_debut`/`heure_planifiee_fin`
- **Nb collectes** — entier
- **Événements** — cellule unique multi-lignes : 1 ligne par événement de la tournée, format `<lieu> · <traiteur> · <nb_pax> pax`. Hauteur de ligne du tableau variable selon le nombre d'events. Triés par ordre chronologique des collectes rattachées
- **Véhicule** — type + plaque (référentiel)
- **Chauffeur** — nom + téléphone cliquable + équipier potentiel (sur ligne secondaire si présent)
- **Statut** — badge coloré : bleu `planifiee`, orange `en_cours`, vert `terminee`, gris `annulee`
- **Prestataire** — nom + logo petit

Suppressions revue sobriété 2026-04-29 :
- — corollaire suppression champ Nom tournée
- — accessible via clic E3 Section 5, pas pertinent en vue liste
- — filtré via filtre latéral "Avec anomalies", pas dupliqué en colonne

Filtres :
- Date (défaut : aujourd'hui + lendemain)
- Prestataire (multi-select)
- Statut (multi-select, défaut tous)
- Avec anomalies (checkbox : filtre tournées avec `cloture_hors_zone=true`, durée corrigée, ou alerte M11 ouverte)

Actions en masse :
- Export CSV (pour rapprochement manuel Val)
- Aucune action de modification en masse V1 (risque trop élevé)

Tri par défaut : `heure_planifiee_debut` croissant.

### E3 — Détail tournée (cœur M04)

**Accès** : clic sur une ligne E2 ou sur le lien T# depuis n'importe quel autre écran TMS.

**Layout** : page dédiée, pas drawer (trop d'info pour un drawer latéral).

**Section 1 — En-tête tournée**
- T# + statut (badge) — suppression "Nom" propagation revue sobriété 2026-04-29
- Prestataire (nom + lien fiche M06)
- Fenêtre tournée prévisionnelle + réelle (si démarrée)
- Durée réelle (si terminée) + correction éventuelle en petit
- Coût calculé HT (ou "non calculé" si pas terminée)
- Boutons principaux contextuels :
  - Si `planifiee` : "Ajouter collecte", "Modifier véhicule/chauffeur", "Annuler tournée"
  - Si `acceptee` (tournée prête, non démarrée) : "Ajouter collecte" (repasse la tournée en `planifiee`, W2), "Modifier véhicule/chauffeur", "Annuler tournée", "Clôturer manuellement" (filet de sécurité W9 si la course n'a pas démarré)
  - Si `en_cours` : "Remplacer véhicule", "Remplacer chauffeur", "Clôturer manuellement" (si chauffeur injoignable)
  - Si `terminee` : "Corriger durée" (si facture non validée), "Voir calcul coût"
  - Si `annulee` : boutons désactivés, motif affiché

**Section 2 — Collectes de la tournée** (enrichie revue sobriété 2026-04-29)
Tableau :
- **Ordre** (numéroté `ordre_dans_tournee` — initialisé à l'ordre de sélection au dispatch, modifiable Ops via flèches ▲▼ par ligne — propagation revue sobriété 2026-04-29). Optimisation routing auto reportée V2.
- **Lieu** (nom + adresse + lien fiche lieu)
- **Traiteur** (nom + lien fiche traiteur — propagation revue sobriété 2026-04-29)
- **`heure_collecte`** (point fixe — propagation 2026-04-29)
- **Nb pax** (depuis `collectes_tms.nb_pax` — propagation revue sobriété 2026-04-29)
- **Nb rolls prévus** (calcul à la volée M09 R4.4 appliqué au `nb_pax` de la collecte — paliers `parametres_tms.stock.palier_rolls_par_pax_*` — informatif, pas de blocage — propagation revue sobriété 2026-04-29)
- **Distance km** (depuis collecte précédente — calcul Haversine à la volée sur coordonnées GPS `lieux.coords_gps`, pas de stockage. Vide pour la première collecte de la tournée — propagation revue sobriété 2026-04-29)
- **Statut opérationnel** (enum §04)
- **Pesées** (si ZD : liste flux avec poids / si AG : poids total + signature asso)
- **Photos** (miniatures cliquables)
- **Actions** : flèches ▲▼ réordonnancement (si `planifiee`), "Retirer de la tournée" (si `planifiee`), "Voir détail collecte"

**Action réordonnancement** : clic ▲ ou ▼ sur une ligne déclenche un échange `collecte_tournees.ordre_dans_tournee` *(multi-camions 2026-05-25 — colonne déplacée sur la liaison)* avec la ligne adjacente **de la même tournée**, via RPC `tms.m04_reordonner_collectes(tournee_id, collecte_id, direction)`. Trigger applicatif (pas SQL) — Ops uniquement, bloqué si `tournees.statut != 'planifiee'`. Audit log `action=TOURNEE_REORDER_COLLECTES` avec diff before/after de la séquence. Re-émission webhook S3 `tournee-upsert` avec nouvel ordre.

**Section 3 — Affectation**
- Chauffeur : nom, téléphone cliquable, statut (actif / inactif)
- Équipier : idem (si présent)
- Véhicule : type, plaque référentiel
- Plaque pré-saisie manager (si renseignée M03 E4) — pour contrôle d'accès site
- **Retiré V1 (propagation suppression saisie plaque terrain 2026-06-04)** — plus de plaque saisie chauffeur
- **Supprimé V1 (revue sobriété 2026-04-29)** — historique audit accessible Admin TMS via SQL `audit_logs` (filtres `table='tournees' AND row_id=<tournee_id>`). UI dédiée reportée V2 si besoin remonte.

**Section 4 — Géolocalisation et clôture**
Visible uniquement si `statut IN (en_cours, terminee)` :
- Position clôture : coordonnées GPS + distance entrepôt/dernière livraison
- Flag `cloture_hors_zone` + distance (si >300m)
- Lien Google Maps pour visualiser la position

**Section 5 — Coût**
Visible si `statut=terminee` :
- Détail calcul R2 (palier applicable, formule, décomposition)
- Ajustements manuels éventuels (Ops Savr) + trace auteur + motif
- Bouton "Corriger durée" (si fenêtre ouverte)
- Lien vers facture prestataire rapprochée (M08)

**Section 6 — Historique et audit** — **Reportée V2 (revue sobriété 2026-04-29)**

V1 : un simple badge en pied de page E3 — "Audit disponible (Admin)" — sans visualisation feed. Les audit logs sont **conservés en DB** (`tms.audit_logs`, table `tournees`, toutes actions `TOURNEE_*` continuent d'être insérées par les triggers/RPC : `TOURNEE_CREATE`, `TOURNEE_ADD_COLLECTE`, `TOURNEE_REORDER_COLLECTES`, `TOURNEE_ASSIGN_CHAUFFEUR`, `TOURNEE_ASSIGN_VEHICULE`, `TOURNEE_START`, `TOURNEE_END`, `TOURNEE_REPLACE_VEHICULE`, `TOURNEE_REPLACE_CHAUFFEUR`, `TOURNEE_DURATION_CORRECT`, `TOURNEE_CANCEL`, `TOURNEE_FORCE_CLOSE`, `COUT_CALCULE`).

Justification : conservation réglementaire + debug Admin (requête SQL ad-hoc Supabase Studio) couvre le besoin V1. UI feed UX-aware reportée V2 si Ops demande consultation régulière. Aucune dégradation fonctionnelle métier, juste pas d'UI temps réel V1.

V2 : feed chronologique cliquable avec détail before/after JSON pour chaque ligne (spec à reprendre alors).

### E4 — Vue tournée portail prestataire (spécifié dans M03)

**Principe (revue sobriété 2026-04-29)** : le manager prestataire voit **exactement la même chose que Ops Savr en E3**, avec restriction RLS `prestataire_id = current_user.prestataire_id`. Une seule UX cible, une seule maintenance, zéro divergence inter-rôle.

**Restrictions par rapport à E3 Ops** :
- RLS automatique sur `tournees`, `collectes_tms`, `chauffeurs`, `vehicules`, `audit_logs` filtrée `prestataire_id = current_user.prestataire_id`
- Sections **éditables** par le manager : Section 3 Affectation (chauffeur, véhicule, équipier — W3) uniquement
- Sections **lecture seule** : Section 1 En-tête, Section 2 Collectes (pas de réordonnancement, pas de retrait), Section 4 Géoloc, Section 5 Coût (pas de correction durée), Section 6 Audit (V1 = badge "Audit disponible Admin Savr" sans accès SQL)
- Pas de droit d'annulation tournée (W7 = Ops Savr uniquement)
- Pas de droit de remplacement véhicule/chauffeur en cours (W6 = Ops Savr uniquement V1)

**Liste tournées (équivalent E2)** : mêmes colonnes que E2 Ops avec RLS prestataire automatique. Tri par défaut date croissant. Filtres adaptés (pas de filtre "Prestataire" puisque mono-prestataire).

**Notifications** : push/email à création et à chaque modification Ops sur les tournées du prestataire (S3 miroir).

Spec UX détaillée et flux de notif : voir [[M03 - Portail prestataire self-service]].

### E5 — Vue tournée app mobile chauffeur (spécifié dans M05)

Le chauffeur voit uniquement sa tournée du jour. Résumé (spec UX détaillée dans M05) :
- Checklist pré-départ (bloquante, ZD uniquement — AG motorisé + vélo : E3 sauté, propagation 2026-06-04)
- **Retiré V1 (propagation suppression saisie plaque terrain 2026-06-04)**
- Liste des collectes à effectuer, ordonnées
- Statut de chaque collecte (en attente, en cours, terminée)
- Bouton "Démarrer tournée" (transition `acceptee` → `en_cours` ; actif uniquement si la tournée est `acceptee`)
- Bouton "Terminer tournée" avec capture GPS (transition `en_cours` → `terminee` + contrôle géoloc)

---

## 6. Workflows

Neuf workflows couvrent les cas opérationnels M04. Chaque workflow précise l'acteur, le déclencheur, les étapes, les données modifiées, les webhooks émis, les notifications.

### W1 — Création d'une tournée au dispatch

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Ops Savr | Multi-sélectionne N collectes même prestataire dans M02 E1 | Active le bouton "Créer tournée" |
| 2 | Ops Savr | Clique "Créer tournée" | Ouvre modal E1 |
| 3 | Ops Savr | Valide le formulaire | Contrôles 1-3 |
| 4 | Système | Crée `tournees` row (`statut=planifiee`) | UUID généré |
| 5 | Système | Insère N lignes `collecte_tournees` (collecte ↔ tournée + `ordre_dans_tournee`) *(multi-camions 2026-05-25, ex `collectes_tms.tournee_id`)* | Liaisons créées |
| 6 | Système | Émet webhook S3 `tournee-upsert` vers Plateforme | Idempotence event_id |
| 7 | Système | Notifie manager prestataire (push + email) | Via M03 |
| 8 | Système | Audit log `action=TOURNEE_CREATE` | Before=null, after=JSON tournée |

**Contraintes** (propagation A1 2026-04-25) :
- Toutes les collectes doivent être `statut_dispatch IN ('a_attribuer','attribuee_en_attente_acceptation','acceptee')` (pas déjà dans une autre tournée et pas encore en exécution)
- Toutes doivent avoir le même `prestataire_id`
- Si `type_tournee=ag_velo`, N=1 strict (D8 — 1 vélo ne porte qu'1 collecte ; le multi-vélo « 1 collecte = N vélos » passe par N tournées sœurs distinctes, cf. E1bis)

**Durée attendue** : < 30 secondes pour Ops expérimenté (3 clics + confirmation).

### W2 — Ajout d'une collecte à une tournée existante (`planifiee`)

Cas : une nouvelle collecte arrive tardivement via M01, Ops souhaite la greffer à une tournée déjà validée par le manager.

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Ops Savr | Ouvre E3 de la tournée cible | Affiche détail tournée |
| 2 | Ops Savr | Clique "Ajouter collecte" | Ouvre modal sélecteur de collectes disponibles (mêmes critères que W1) |
| 3 | Ops Savr | Sélectionne la collecte à ajouter | Validation contrôles (prestataire, type_tournee, V1 pas de contrôle capacité) |
| 4 | Système | Insère une ligne `collecte_tournees` (collecte ↔ tournée + `ordre_dans_tournee`) *(multi-camions 2026-05-25, ex `collectes_tms.tournee_id`)* | Liaison créée |
| 5 | Système | Re-émet webhook S3 `tournee-upsert` (payload complet avec nouvelle liste collectes) | |
| 6 | Système | Notifie manager : "Collecte ajoutée à votre tournée T#123 (total 3 collectes)" | Via M03 |
| 7 | Système | Notifie chauffeur si app mobile ouverte : "Nouveau stop ajouté" | Push M05 |
| 8 | Système | Audit log `action=TOURNEE_ADD_COLLECTE` | Diff collecte_ids |

**Contrainte bloquante** : tournée doit être `statut IN ('planifiee','acceptee')` (avant démarrage chauffeur). Si `en_cours` ou `terminee` ou `annulee` → bouton "Ajouter collecte" désactivé avec tooltip explicatif. **Si la tournée est `acceptee`** (toutes collectes déjà acceptées + chauffeur/véhicule assignés), l'ajout d'une collecte non encore acceptée fait **repasser la tournée en `planifiee`** (elle n'est plus complète) jusqu'à nouvelle acceptation de la collecte ajoutée — décision cycle de vie 2026-06-06.

**Hors périmètre V1** : contrôle capacité camion (V2), extension auto créneau (V2), droit de refus manager (non prévu).

### W3 — Assignation chauffeur/véhicule par le manager prestataire

Le manager agit sur son portail M03. Détail UX dans M03, ici on spécifie l'impact M04.

| Étape | Acteur | Action | Impact M04 |
|---|---|---|---|
| 1 | Manager | Reçoit notif "Tournée T#123 disponible" | Pas d'action M04 |
| 2 | Manager | Ouvre E4 dans son portail | Charge `tournees` via RLS |
| 3 | Manager | Assigne chauffeur + véhicule (+ équipier optionnel) | UPDATE `tournees.chauffeur_id`, `vehicule_id`, `equipier_id` |
| 4 | Manager | Accepte les collectes individuellement (flux M02 inchangé) | Transitions `collectes_tms.statut_dispatch` collecte par collecte (`attribuee_en_attente_acceptation` → `acceptee`, propagation A1 2026-04-25) |
| 5 | Système | Si toutes collectes `acceptee` ET chauffeur+véhicule assignés → bascule de toutes les collectes en `en_attente_execution` (propagation A1 2026-04-25) **ET tournée `planifiee` → `acceptee`** (tournée prête à rouler — décision cycle de vie 2026-06-06). Si une collecte non acceptée est ajoutée ensuite (W2), la tournée repasse `acceptee` → `planifiee` | |
| 6 | Système | Re-émet S3 `tournee-upsert` avec chauffeur/véhicule | Plateforme miroir |
| 7 | Système | Notifie chauffeur assigné (magic link app mobile) | Via M05 |
| 8 | Système | Audit log `action=TOURNEE_ASSIGN_CHAUFFEUR`, `action=TOURNEE_ASSIGN_VEHICULE` | |

**Règles** :
- Pas de contrôle double-booking chauffeur V1 (D6 : enchaînement libre)
- Chauffeur doit être `statut=actif` + `peut_conduire=true` (vérifié applicativement à l'assignation)
- Véhicule doit être `statut=actif` (pas `en_maintenance` ni `inactif`)

### W4 — Démarrage tournée (`acceptee` → `en_cours`)

> **Saisie plaque retirée (propagation suppression saisie plaque terrain 2026-06-04)** : plus de saisie plaque chauffeur, plus d'écriture `plaque_saisie_terrain`, plus de webhook S7 côté chauffeur, plus d'alerte divergence référentiel. La checklist E3 ne subsiste que pour le camion ZD ; AG motorisé + vélo cargo passent directement E2 → E4.

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Chauffeur | Ouvre app mobile M05, sélectionne sa tournée du jour | Charge via RLS |
| 2 | Chauffeur | Effectue checklist pré-départ (bloquante, **ZD uniquement** ; AG/vélo : étape sautée) | Validation critères §03 M05 |
| 3 | Chauffeur | Clique "Démarrer tournée" | Capture `heure_reelle_debut = NOW()` |
| 4 | Système | UPDATE `tournees.statut=en_cours`, `heure_reelle_debut` (transition `acceptee` → `en_cours` ; le bouton "Démarrer" est inactif tant que la tournée n'est pas `acceptee`) | |
| 5 | Système | Re-émet S3 `tournee-upsert` (statut=en_cours) | |
| 6 | Système | Audit log `action=TOURNEE_START` | |

*(Plus de fan-out email T+3h au démarrage — **retiré V1** : l'email plaque T+3h a été supprimé (Q10 2026-04-24) et le webhook S7 n'est plus émis par le chauffeur (propagation suppression saisie plaque terrain 2026-06-04). La plaque pour contrôle d'accès est pré-saisie par le manager en M03 E4. Voir §9 récap + D9.)*

### W5 — Exécution et clôture tournée (`en_cours` → `terminee`)

Sur toute la durée `en_cours`, le chauffeur effectue ses collectes via M05. Chaque collecte passe par ses propres transitions (`en_cours` → `realisee`, `realisee_sans_collecte`, `incident`). Dès que **toutes** les collectes ont un statut terminal :

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Chauffeur | Clique "Terminer tournée" (à l'entrepôt pour ZD, dernière livraison pour AG) | Capture GPS |
| 2 | Système | Calcule distance position vs entrepôt (ZD) ou dernière livraison (AG) | |
| 3 | Système | Si distance > 300m : stocke `cloture_hors_zone=true`, `cloture_gps`, `distance_cloture_metres`. Émet alerte M11 warning | Non bloquant |
| 4 | Système | Si distance ≤ 300m : `cloture_hors_zone=false` | |
| 5 | Système | UPDATE `tournees.statut=terminee`, `heure_reelle_fin=NOW()` | `duree_reelle_minutes` GENERATED |
| 6 | Système | Déclenche R2 calcul coût M07 | UPDATE `tournees.cout_calcule_ht`, `cout_detail`, `grille_tarifaire_id`, `cout_final_ht`, incrément `push_s6_version` |
| 7 | Système | Recalcul marge Plateforme via trigger DB cross-schema `plateforme.fn_recalc_marge_tournee()` | Lecture vue `plateforme.v_courses_logistiques` — *ex-webhook S6 supprimé Bloc A A2, synchrone en DB, pas de réseau* |
| 8 | Système | Re-émet S3 `tournee-upsert` (statut=terminee) | |
| 9 | Système | Audit log `action=TOURNEE_END` + `action=COUT_CALCULE` | |

**Clôture auto via collectes terminales** : alternative à l'étape 1, le système peut basculer la tournée en `terminee` dès que toutes ses collectes sont terminales (R6.2). Permet de gérer le cas où le chauffeur oublie de cliquer "Terminer" manuellement — après 8h d'inactivité, alerte M11 "tournée oubliée" + clôture forcée possible par Ops (E3 bouton "Clôturer manuellement").

### W6 — Remplacement véhicule ou chauffeur en urgence (`en_cours`)

Cas : panne camion à 19h30 alors que la tournée a démarré à 18h. Ops remplace le véhicule (prestataire envoie un autre camion).

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Ops Savr | Reçoit info panne (appel prestataire) | — |
| 2 | Ops Savr | Ouvre E3 de la tournée, clique "Remplacer véhicule" | Ouvre modal sélection véhicule du prestataire |
| 3 | Ops Savr | Sélectionne nouveau véhicule + saisit motif | Validation : véhicule actif du même prestataire |
| 4 | Système | UPDATE `tournees.vehicule_id` | |
| 5 | Système | Alerte M11 auto `gravité=warning` : "Tournée T#123 — véhicule remplacé en cours, motif : panne" | Destinataires : Ops + Val/Louis |
| 6 | Système | Notification push manager + chauffeur concerné + éventuel nouveau chauffeur | |
| 7 | Système | Re-émet S3 `tournee-upsert` avec nouveau `vehicule_id` | |
| 8 | Système | Audit log `action=TOURNEE_REPLACE_VEHICULE` avec motif | |

**Limitation V1 assumée (D3/B2)** : pas de re-notification automatique du client si la plaque de contrôle d'accès (pré-saisie manager M03 E4) devient caduque suite au remplacement véhicule. Si le client a un contrôle d'accès SAS, Ops contacte le client par téléphone. Documenté comme acceptable V1. *(L'ancien mécanisme email plaque T+3h est retiré V1 — Q10 2026-04-24.)*

**Remplacement chauffeur** : workflow identique, action "Remplacer chauffeur" (bouton distinct). Le nouveau chauffeur reçoit magic link app mobile + la tournée apparaît dans sa vue M05 instantanément (RLS).

### W7 — Annulation tournée `planifiee`

Cas : prestataire se désiste la veille au soir → Ops doit re-dispatcher les collectes.

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Ops Savr | Ouvre E3, clique "Annuler tournée" | Modal confirmation |
| 2 | Ops Savr | Saisit motif (obligatoire, min 10 caractères, D7) | Validation |
| 3 | Ops Savr | Confirme | |
| 4 | Système | UPDATE `tournees.statut=annulee`, `motif_annulation` | |
| 5 | Système | Pour chaque collecte de la tournée : **supprime la ligne `collecte_tournees`** (collecte↔cette tournée) ; si la collecte n'a plus aucune tournée → `statut_dispatch=a_attribuer`, `prestataire_id=NULL` (propagation A1 2026-04-25). *(multi-camions 2026-05-25 : une collecte servie par d'autres camions conserve ses autres tournées.)* | Retour file dispatch M02 si plus aucune tournée |
| 6 | Système | Émet S3 `tournee-upsert` avec `statut=annulee` + liste collectes vidée | |
| 7 | Système | Notifie manager prestataire : "Tournée T#123 annulée par Savr, motif : <motif>" | Via M03 |
| 8 | Système | Pas de webhook `collecte-rejetee` — la collecte n'est pas rejetée, elle est ré-orientée | |
| 9 | Système | Audit log `action=TOURNEE_CANCEL` avec motif | |

**Règle** : impossible d'annuler une tournée `en_cours` (R2.7 bis — la tournée finit quand même, vacation facturée). Le bouton "Annuler tournée" est actif tant que la tournée n'a pas démarré, soit `statut IN ('planifiee','acceptee')` ; désactivé avec tooltip si `statut IN ('en_cours','terminee','annulee')`.

### W8 — Correction durée a posteriori

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Ops / Admin TMS | Ouvre E3 d'une tournée `terminee` avec facture non encore `validee` | Section "Corriger durée" visible |
| 2 | Ops / Admin TMS | Clique "Corriger durée" | Ouvre modal avec champs |
| 3 | Ops / Admin TMS | Modifie `heure_reelle_debut` et/ou `heure_reelle_fin` | Validation : `fin > debut` |
| 4 | Ops / Admin TMS | Affiche temps réel : "Nouvelle durée : 4h15 · Nouveau coût : 220€ (avant : 282,50€)" | Re-simulation R2 |
| 5 | Ops / Admin TMS | Saisit motif obligatoire (min 10 caractères) | Validation |
| 6 | Ops / Admin TMS | Confirme | |
| 7 | Système | UPDATE `tournees.heure_reelle_debut/fin` | `duree_reelle_minutes` GENERATED |
| 8 | Système | Re-calcule R2 + UPDATE `cout_calcule_ht`, `cout_detail`, `cout_final_ht`, incrément `push_s6_version` | |
| 9 | Système | Si delta coût > 20% : alerte M11 `warning` à Val + Louis | |
| 10 | Système | Recalcul marge Plateforme via trigger DB cross-schema `plateforme.fn_recalc_marge_tournee()` | Lecture vue `plateforme.v_courses_logistiques` — *ex-S6 supprimé Bloc A A2* |
| 11 | Système | Si facture en `en_rapprochement` ou `en_attente_validation` : déclenche re-rapprochement auto M08 | |
| 12 | Système | Audit log `action=TOURNEE_DURATION_CORRECT` avec before/after + motif | |

**Fenêtre de correction** : tant que `factures_prestataires.statut NOT IN (validee, payee)` pour le mois concerné. Au-delà, blocage (litige à traiter hors TMS).

**Badge "Durée corrigée"** ajouté sur la tournée (E3 + E2 liste), visible jusqu'à purge (aucune — badge permanent).

### W10 — Modification collecte post-attribution / acceptation (cascade Plateforme — refonte 2026-05-04)

Cas : le traiteur modifie librement les informations d'une collecte depuis son espace Plateforme (refonte §06.04). La Plateforme propage le diff via `PATCH /collectes/:id` (E2, cf. [[../08 - Contrat API Plateforme-TMS#E2 — `PATCH /collectes/:id`]]).

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Système TMS | Reçoit `PATCH /collectes/:id` E2 avec `event_id` + `diff` (sobriété B5 2026-05-04 : plus de `side_effects`, le TMS calcule sa propre logique sur le diff) | Handler W3 (M01) appelle M04 |
| 2 | Système TMS | Vérifie statut TMS de la collecte | |
| 3 | Système TMS | Si `collectes_tms.statut_operationnel ∈ (en_cours, realisee, realisee_sans_collecte, incident)` → réponse 409 Conflict (alignement audit Run 6 2026-05-07 A3, ex `statut_tms IN (realisee, en_cours, terminee, cloturee)` — valeurs hors enum miroir + `cloturee` inexistant) | Plateforme alerte Ops, ne réessaye pas |
| 4 | Système TMS | Si `statut_dispatch = attribuee_en_attente_acceptation` (pas encore acceptée) → applique le diff `tms.collectes_tms` (et `tms.tournees` impactée) silencieusement, notification standard manager prestataire en M03 (alignement audit Run 6 2026-05-07 A2, ex `statut_tms = attribuee` valeur inexistante) | Pas de réacceptation |
| 5 | Système TMS | Si `statut_dispatch = acceptee` ET diff porte sur `date_collecte` ou `heure_collecte` → applique le diff + workflow réacceptation | |
| 5.1 | Système TMS | Statut collecte → `attribuee_en_attente_acceptation` (réutilisation enum existant, flag temporaire `re_confirmation = true` dans `tms.collectes_tms.flags_jsonb` pour distinguer d'une 1ère acceptation côté UI portail prestataire) | Webhook S2 `collecte-refusee` non émis ; webhook S1 `collecte-acceptee` sera émis à la re-confirmation. Plateforme miroir `statut_tms = attribuee_en_attente_acceptation`. |
| 5.2 | Système TMS | Push notification manager prestataire (email + portail M03) : "Modification créneau collecte X — re-confirmation requise" | Bandeau dédié dans portail M03 sur la collecte concernée pendant la phase de re-confirmation |
| 5.3 | Système TMS | Si tournée constituée et la collecte est partagée avec d'autres collectes : alerte Ops M11 `warning` "Collecte de la tournée T#xxx en re-confirmation" + recompute fenêtre opérationnelle tournée si nécessaire | |
| 6 | Système TMS | Si `statut_dispatch = acceptee` ET diff sur autres champs (notes, contact secours, `controle_acces_requis`, etc.) → push silencieux MAJ donnée, pas de réacceptation | Notification info manager prestataire (digest) |
| 7 | Système TMS | Si diff contient `lieu_id` ou `type_collecte` → réponse 422 (anomalie : Plateforme verrouille UI côté traiteur, sobriété A4 2026-05-04). Le traiteur doit annuler + reprogrammer côté Plateforme. | Plateforme alerte Ops |
| 8 | Système TMS | Réponse 200 OK à la Plateforme (avec ack du diff appliqué) | |
| 9 | Système TMS | Audit log `action=COLLECTE_PATCH` avec `diff`, `event_id`, `reacceptation_appliquee` (bool) | Source `tms.audit_log` |

**Réutilisation du statut `attribuee_en_attente_acceptation`** : pas de nouveau statut workflow M03 ajouté à l'enum (sobriété — éviter de propager une 7e valeur sur §04 + §03 + M01/M02/M03 + RLS). La distinction "re-confirmation" est portée par un flag temporaire `flags_jsonb.re_confirmation_requise = true` sur `tms.collectes_tms` (mis à `true` à l'étape 5.1, mis à `null` à la re-confirmation acceptée ou au refus). Le portail M03 et le bandeau prestataire utilisent ce flag pour afficher le message dédié "modification de créneau — re-confirmation requise" plutôt que "nouvelle assignation". Si re-confirmation refusée → statut `rejetee_par_prestataire` (S2 `collecte-refusee`). Si re-confirmation acceptée → retour à `acceptee` (S1 `collecte-acceptee`).

**Idempotency** : dédup serveur via `integrations_inbox` 7j sur `event_id` (Bloc B B5). Un PATCH rejoué retourne 200 sans réappliquer (conforme C4).

**Réacceptation chauffeur** : si la collecte est déjà assignée à une tournée avec chauffeur, **pas de re-validation chauffeur** V1 (le chauffeur subit la modification, push notification info via M05). Le workflow re-confirmation reste au niveau manager prestataire (M03), pas chauffeur (M05). Décision sobriété : éviter une cascade de re-validations sur un changement opérationnel mineur.

**Cohérence** : ce workflow miroir parfait le contrat E2 §08 + spec §06.04 Plateforme + template email Plateforme `admin_modification_collecte_traiteur` (alerte Ops Savr en parallèle de la cascade TMS).

### W9 — Clôture forcée par Ops (chauffeur injoignable)

Cas : chauffeur a oublié de terminer, n'est plus joignable, tournée en `en_cours` depuis 8h. Ops doit clôturer manuellement.

| Étape | Acteur | Action | Système |
|---|---|---|---|
| 1 | Système | Détecte tournée `en_cours` depuis > 8h (seuil configurable) | Alerte M11 auto |
| 2 | Ops Savr | Reçoit alerte, tente de joindre chauffeur | — |
| 3 | Ops Savr | Si injoignable, ouvre E3, clique "Clôturer manuellement" | Modal confirmation |
| 4 | Ops Savr | Saisit `heure_reelle_fin` estimée + motif obligatoire | Validation |
| 5 | Système | UPDATE `tournees.statut=terminee`, `heure_reelle_fin` saisie | |
| 6 | Système | Flag `cloture_manuelle_ops=true` dans audit | |
| 7 | Système | Applique suite W5 (R2 calcul coût → recalc marge Plateforme via trigger DB `fn_recalc_marge_tournee()`, S3) | *ex-S6 supprimé Bloc A A2* |
| 8 | Système | Alerte M11 `warning` supplémentaire : "Clôture manuelle forcée T#123" | |
| 9 | Système | Audit log `action=TOURNEE_FORCE_CLOSE` avec motif | |

**Fréquence attendue** : très rare (<1 cas/mois à l'usage). Si >2/mois : problème process prestataire, discussion à avoir.

---

## 7. Edge cases

### C1 — Ajout collecte à tournée dont le manager a déjà assigné le chauffeur

**Comportement** : ajout autorisé (W2), chauffeur déjà assigné hérite de la nouvelle collecte. Push notification chauffeur + manager. Manager n'a pas de droit de refus V1 (D1-bis).

### C2 — Plaque saisie correspond à un véhicule d'un autre prestataire — **Retiré V1 (propagation suppression saisie plaque terrain 2026-06-04)**

Plus de saisie plaque chauffeur → plus de cas de divergence terrain/référentiel.

### C3 — Chauffeur démarre la tournée sans avoir fait la checklist pré-départ

**Comportement** : impossible par design M05 (checklist bloquante). Si contournement détecté (exploitation faille), alerte M11 `critical`.

### C4 — Toutes les collectes d'une tournée sont refusées par le manager

**Comportement** : la tournée reste `planifiee` avec 0 collecte. Alerte M11 `warning` à Ops. Ops peut annuler (W7) ou ajouter de nouvelles collectes (W2). Pas de bascule auto en `annulee`.

### C5 — Manager modifie assignation chauffeur après démarrage

**Comportement** : interdit via portail M03 (champs verrouillés si `statut != planifiee`). Seul Ops peut remplacer via W6. Si le manager appelle Ops pour forcer, Ops utilise W6.

### C6 — Tentative d'ajout d'une **deuxième collecte** sur une tournée ag_velo déjà avec 1 collecte

**Comportement** : blocage bouton "Ajouter collecte" avec message "Tournée vélo A Toutes! limitée à 1 collecte" (D8). Ops doit créer une nouvelle tournée pour la collecte supplémentaire.

*(À ne pas confondre avec le multi-vélo : si Ops veut affecter **un deuxième vélo à la même collecte** — volume dépassant la capacité d'un vélo — il utilise « + Ajouter un vélo » sur la fiche collecte (E1bis), qui crée une tournée sœur avec cette unique collecte. C6 ne bloque que l'ajout d'une **autre** collecte sur un vélo donné — généralisation 2026-05-29.)*

### C7 — Chauffeur sélectionné sur 2 tournées qui se chevauchent

**Comportement V1** : aucun contrôle, Ops et manager assument (D6). Le chauffeur reçoit 2 tournées dans son app, il gère. Risque double-booking assumé.

### C8 — Clôture tournée avec pesée GPS indisponible (tunnel, parking souterrain)

**Comportement** : clôture autorisée, `cloture_gps=null`, `cloture_hors_zone=null` (pas de conclusion possible). Pas d'alerte M11. Si pattern récurrent sur un chauffeur (>20% des tournées sans GPS), Ops peut investiguer à froid.

### C9 — Correction durée alors que la facture du mois est déjà validée

**Comportement** : blocage UX (bouton "Corriger durée" désactivé avec tooltip "Facture <mois> validée, correction impossible"). Si erreur détectée, traitement hors TMS (avoir prestataire ou facture rectificative).

### C10 — Webhook S3 `tournee-upsert` échoue après 5 retries

**Comportement** : event en DLQ (cf. M01 cap 5 retries). Alerte M11 `critical` à Val + Louis. Admin TMS peut relancer manuellement ou marquer l'event comme `rejetee` (déclenche S11 `collecte-rejetee` sur les collectes concernées). Cohérence avec addendum seconde salve M01.

### C11 — Tournée créée sans chauffeur/véhicule pré-assigné et manager tarde à assigner

**Comportement** : alerte M11 `warning` si `statut=planifiee` sans `chauffeur_id` à J-1 17h pour tournée J+0. Délai configurable paramètre Admin TMS.

### C12 — Collecte retirée d'une tournée (W2 bouton "Retirer")

**Comportement** : **suppression de la ligne `collecte_tournees`** (collecte↔cette tournée) ; si la collecte n'a plus aucune tournée → retour à `statut_dispatch=a_attribuer` *(multi-camions 2026-05-25, ex `collectes_tms.tournee_id=NULL`)*. Re-émission S3 `tournee-upsert` avec liste amputée. Notification manager + chauffeur. Interdit si `statut_operationnel != planifiee` (collecte déjà démarrée/terminée ne peut pas sortir).

---

## 8. Intégration cross-module

### M01 — Réception ordres de collecte
Les collectes entrent via M01 avec `statut_dispatch=a_attribuer`. M04 les consomme au dispatch (W1). Référence pour `lieu_snapshot`, `nb_pax`, `heure_collecte` (`flux_prevus` retiré revue sobriété 2026-04-29 ; `creneau_debut/fin` → `heure_collecte` propagation 2026-04-29).

### M02 — Dispatch Ops Savr
M02 E1 étendu avec multi-sélection + bouton "Créer tournée" → ouvre M04 E1. Par défaut, la liste dispatch exclut les collectes déjà rattachées à une tournée (première affectation). **Multi-véhicules (2026-05-25, généralisé vélo 2026-05-29)** : une collecte peut être ajoutée à une tournée **supplémentaire** via "+ Ajouter un véhicule" (libellé contextuel « camion » ZD/AG camion / « vélo » AG vélo, E1bis) ou via le filtre explicite "voir aussi collectes en tournée" — l'exclusion par défaut ne bloque que la première affectation, pas les véhicules additionnels.

### M03 — Portail prestataire self-service
Le manager reçoit la tournée via webhook push M03 + email. Il assigne chauffeur/véhicule au niveau tournée (W3). En V1, il **ne peut pas** créer, modifier, annuler, ajouter une collecte ni réordonner les collectes d'une tournée (droits Ops uniquement). **V2 (revue sobriété 2026-04-29)** : capacité de **constitution de tournées** sera ouverte au manager côté portail M03 (cf. §13 Question 10) — création tournée multi-sélection miroir M02. Modif/annulation/réordonnancement restent V1+ Ops uniquement (à re-trancher V2). Vue tournée portail = vue identique E3 Ops + RLS prestataire (cf. §5 E4).

### M05 — App mobile chauffeur
Le chauffeur exécute la tournée via M05 (W4, W5). **Plus de saisie plaque chauffeur (propagation 2026-06-04)** : la plaque pour contrôle d'accès / registre est la plaque pré-saisie manager (M03 E4, S7). La clôture déclenche le contrôle géolocalisé M04 (non bloquant).

### M06 — Référentiel prestataires
Source des `chauffeurs`, `vehicules`, `prestataires`. M04 lit au dispatch (filtres, validation) et à l'assignation (W3). **Auto-complete plaque M05 + alerte divergence retirés V1 (propagation 2026-06-04)** — les plaques référentiel servent à la pré-saisie manager M03 E4.

### M07 — Pilotage financier logistique
M04 déclenche R2 à la clôture (W5 étape 6-7 + W8 étape 8). Le coût calculé (`cout_final_ht` + incrément `push_s6_version`) est exposé à la Plateforme en **lecture cross-schema** via la vue `plateforme.v_courses_logistiques`, et le trigger DB `plateforme.fn_recalc_marge_tournee()` recalcule la marge — *ex-webhook S6 `course-cout-calculee` supprimé Bloc A A2, plus de push HTTP*.

### M08 — Facturation prestataires
M04 `cout_calcule_ht` est consommé par M08 au rapprochement facture. Une correction durée W8 déclenche re-rapprochement auto.

### M09 — Stock matériel Savr
Les déclarations rolls/bacs du chauffeur à la clôture tournée (M05) alimentent M09. Pas d'impact direct M04 hors du fait que la tournée est le contexte d'agrégation.

### M11 — Alerting et monitoring ops
M04 émet 5 alertes automatiques (propagation 2026-06-04 : suppression `plaque_divergente_autre_vehicule` + `plaque_inconnue_prestataire`, plus de saisie plaque chauffeur) :
- `cloture_hors_zone` (warning)
- **Retiré V1 (propagation 2026-06-04)**
- **Retiré V1 (propagation 2026-06-04)**
- `tournee_sans_chauffeur_J-1_17h` (warning)
- `tournee_inactivite_8h` (warning)
- `delta_cout_correction_>20%` (warning)
- `remplacement_vehicule_chauffeur_en_cours` (warning)

### M13 — Administration TMS
Paramètres M04 configurables par Admin TMS via `parametres_tms` :
- Seuils géoloc, inactivité, délai assignation, etc. (cf. §11)

### M14 — Intégration Everest (A Toutes!)
Une tournée `type_tournee IN (ag_velo, ag_camion)` est doublée d'une ou plusieurs lignes `everest_missions`. Synchronisation fine spec dans M14. **Source de vérité unique : `tms.everest_missions(everest_mission_id UNIQUE, tournee_id, collecte_tms_id)`** — colonnes miroir `tournees.everest_mission_id` et `collectes_tms.everest_mission_id` retirées V1 (revue sobriété §04 2026-04-30 A6). Si `ag_camion` → `everest_missions.tournee_id` posé. Si `ag_velo` → `everest_missions.collecte_tms_id` posé. Lookup via JOIN sur `everest_missions`.

---

## 9. Contrat API (récap des webhooks M04)

Sortants TMS → Plateforme :

| ID | Endpoint | Déclencheur | Idempotence |
|---|---|---|---|
| S3 | `POST /webhooks/tms/tournee-upsert` | Création, modif, annulation tournée | `event_id` UUID par événement |
| | | **Émis par le manager (M03 E4), pas par M04/chauffeur — propagation 2026-06-04.** Plus déclenché au démarrage de tournée. | `event_id` |

: sans objet — l'email T+3h a été retiré V1 (Q10 2026-04-24) et la plaque pour contrôle d'accès est désormais pré-saisie manager (M03 E4). Voir M03.

Détails payloads : [[08 - Contrat API Plateforme-TMS#S3 — `POST /webhooks/tms/tournee-upsert`]]. *( supprimé Bloc A A2 → lecture cross-schema `plateforme.v_courses_logistiques`. S7 documenté côté [[M03 - Portail prestataire self-service]] + [[08 - Contrat API Plateforme-TMS#S7 — `POST /webhooks/tms/plaque-saisie`]].)*

---

## 10. Règles métier spécifiques M04

### R_M04.1 — Présomption 0kg sur flux non pesés — **Supprimée V1 (revue sobriété 2026-04-29)**

Règle retirée définitivement avec la suppression de `flux_prevus`. Le rapport recyclage Plateforme se base désormais uniquement sur les flux **réellement** pesés par le chauffeur. Plus d'auto-insertion à 0kg, plus de différenciation "non pesé" vs "non concerné".

### R_M04.2 — Contrôle géolocalisé à la clôture tournée

Déjà décrit W5 étapes 2-4. Paramètres : `seuil_distance_cloture_entrepot_metres` (défaut 300), `coords_gps_entrepot`.

### R_M04.3 — Fenêtre de correction durée

Correction durée autorisée tant que `factures_prestataires.statut NOT IN (validee, payee)` pour le mois concerné. Au-delà, UX bloquée + traitement hors TMS.

### R_M04.4 — Clôture automatique via collectes terminales

Repris de R6.2. Dès que toutes les `collectes_tms.statut_operationnel` sont terminales (`realisee`, `realisee_sans_collecte`, `incident`, `annulee`) pour une tournée `en_cours`, le TMS bascule auto en `terminee` et déclenche W5 étapes 6-11.

### R_M04.5 — Interdiction annulation tournée `en_cours`

Découle de R2.7 bis : une tournée démarrée finit toujours, même si toutes ses collectes sont annulées par le client. Vacation facturée.

---

## 11. Paramètres configurables (M13)

Tous dans `parametres_tms.parametres` (JSONB) :

| Clé | Défaut V1 | Description |
|---|---|---|
| `m04_seuil_distance_cloture_metres` | 300 | Rayon tolérance géoloc clôture |
| `m04_coords_gps_entrepot` | (lat, lng Savr Paris) | Point de référence clôture ZD |
| `m04_seuil_inactivite_tournee_heures` | 8 | Après ce délai, alerte tournée oubliée |
| `m04_seuil_delta_cout_correction_pct` | 20 | Seuil alerte delta coût après correction durée |
| `m04_delai_assignation_chauffeur_alerte_heures` | 17 (J-1) | Heure d'alerte si tournée sans chauffeur |

Évolution future (V2) : `m04_capacite_camion_max_m3`, `m04_extension_creneau_auto_active`, `m04_regroupement_auto_actif`.

---

## 12. Décisions prises

1. **D1 — Moment de création de la tournée** : Ops Savr crée au dispatch (avant acceptation prestataire), acceptation reste par collecte, manager assigne chauffeur/véhicule au niveau tournée. Option A retenue vs option B (manager crée) ou C (hybride). Justif : cohérence MTS-1, vision multi-prestataires Ops, flux M02 inchangé, cas province nativement géré. 2026-04-23.

2. **D1-bis — Ajout collecte à tournée `planifiee` post-acceptation** : autorisé par Ops Savr. Notif manager + push chauffeur + re-push S3. Pas de contrôle capacité camion V1 (V2). Pas d'extension auto créneau V1 (V2). Manager sans droit de refus V1. Interdit si `statut=en_cours`. 2026-04-23.

3. **D2 — Suggestion regroupement automatique** : V1 = 100% manuel (Ops regroupe via multi-sélection). Option B (suggestion non bloquante) reportée V1.1. Règle B documentée : même prestataire + créneau chevauchant + CP identique ou distance GPS ≤5km. Justif : volume V1 faible, pas de ROI auto V1, simplicité max. 2026-04-23.

4. **D3 — Modification tournée `en_cours`** : Option B retenue. Remplacement véhicule et chauffeur autorisés par Ops Savr (panne/malaise), trace audit + alerte M11 + re-push S3. Ajout/retrait collecte interdit. Modification créneau, changement prestataire interdits. Pas de re-notification automatique du client si la plaque de contrôle d'accès devient caduque (limitation B2 V1 assumée, Ops contacte client manuellement). *(L'email plaque T+3h est retiré V1 — Q10 2026-04-24.)* 2026-04-23.

5. **Décision caduque (propagation suppression saisie plaque terrain 2026-06-04)** — plus de saisie plaque chauffeur, donc plus de comparaison terrain/référentiel ni d'alerte associée. 2026-04-23.

6. **D5 — Correction durée a posteriori** : Ops + Admin TMS (manager exclu). Fenêtre = tant que facture prestataire non `validee`. Motif obligatoire (min 10 caractères), audit, re-calc R2 auto → recalc marge Plateforme via trigger DB cross-schema `fn_recalc_marge_tournee()` (*ex-re-push S6 supprimé Bloc A A2*). Alerte M11 si delta coût >20%. Blocage si facture validée. Bonus Val : contrôle géolocalisé au clic "Terminer" (seuil 300m non bloquant) + alerte inactivité 8h + règles conso batterie PWA (géoloc ponctuelle, pas de tracking continu, push Web, Background Sync). 2026-04-23.

7. **D6 — Enchaînement tournées même chauffeur** : Option A retenue. Libre, zéro contrôle. Pas de cut-off, pas de vérification double-booking, pas de contrôle temps de travail légal V1 (responsabilité prestataire employeur). 2026-04-23.

8. **D7 — Annulation tournée `planifiee`** : Option A. Collectes retournent à `a_attribuer` (M02). Motif obligatoire. Webhook S3 `statut=annulee`. Notif manager. Pas de `collecte-rejetee` (re-orientation). 2026-04-23.

9. **D8 — Tournée AG vélo multi-collectes** : Option A. 1 collecte strict. Contrainte bloquante au dispatch (E1 + W2). Justif : volume faible, zéro gain financier (tarif Everest par mission), cohérent `everest_missions`. **Toujours en vigueur.** 2026-04-23. ⚠️ **Ne pas confondre avec D8bis ci-dessous.**

9bis. **D8bis — Multi-vélo AG (1 collecte = N vélos)** : ouvert (généralisation 2026-05-29, arbitrages Val 2026-05-29). Axe **orthogonal** à D8 : une collecte AG dont le volume dépasse la capacité d'un vélo cargo réfrigéré peut être servie par **N vélos A Toutes! = N tournées sœurs**, chacune portant cette unique collecte (D8 respecté). Réutilise intégralement la mécanique multi-camions ZD (table `collecte_tournees` N↔N, dérivation statut R6.1, coût `cout_reparti_centimes`, S5 terminal unique). Découpage **interne TMS décidé par l'Ops au dispatch** (M12 inchangé, pas de split auto — V2 si retour terrain). Affordance « + Ajouter un vélo » (E1bis). **Multi-facturation** : N missions Everest = N courses facturées (cohérent tarif A Toutes! par course). Acceptation = 1re mission dispatchée (idempotent). Annulation collecte = cascade sur les N missions (M14 W3). Marqué **V2** (le TMS V1 ship avec 1 collecte = 1 vélo ; mécanique figée maintenant car héritée gratuitement du multi-camions).

10. **** — **Décision caduque (email plaque T+3h retiré V1, Q10 2026-04-24 ; webhook S7 chauffeur retiré 2026-06-04)**. La plaque pour contrôle d'accès est désormais pré-saisie par le manager en M03 E4 (S7 émis par le manager, pas par le chauffeur). Plus d'email de communication plaque côté Plateforme V1. 2026-04-23.

11. **** **Supprimée V1 (revue sobriété 2026-04-29)** — corollaire de la suppression `flux_prevus`. Plus d'auto-insertion à 0kg. Le rapport recyclage Plateforme reflète uniquement les pesées réelles chauffeur. Plus de webhook `pesee-brute-upsert` unitaire (déjà retiré).

12. **Rapport recyclage** : déclenchement à clôture complète événement (toutes collectes en `realisee` ou terminal) + embargo H+24 + batch J+1 6h. Règle existante CDC Plateforme §05, aucune modif — juste consommé par l'agrégation. 2026-04-23.

13. **Enums flux alignés** : 5 flux ZD communs Plateforme + TMS = `biodechet`, `verre`, `emballage`, `carton`, `dechet_residuel` (tous au singulier). `don_alimentaire` pour AG. Correction §04 Plateforme + §08 TMS propagée 2026-04-23. **Renommage `dib` → `dechet_residuel` 2026-05-02 (refonte Dashboard §05 App)** — alignement final.

---

## 13. Questions ouvertes

1. **Seuil distance clôture 300m** — valeur empirique, à calibrer sur premiers mois V1. Prévoir un rapport mensuel "taux clôture hors zone par chauffeur" pour Ops.

2. **Format plaque FR ancien (A-123-BC)** — regex souple acceptée V1. Si saisie erronée détectée fréquente → durcir V1.1.

3. **Extension créneau auto à l'ajout de collecte post-acceptation** — V2 confirmé. À prioriser si Ops signale perte opérationnelle.

4. **Contrôle capacité camion à l'ajout** — V2 confirmé. À prioriser si cas de tournée sur-remplie remonté.

5. **Double-booking chauffeur** — V1 pas de contrôle (D6). À re-trancher V1.1 selon incidents terrain.

6. **Clôture forcée Ops (W9)** — fréquence attendue <1/mois. Si >2/mois → process prestataire à revoir.

7. **Supprimée V1 (revue sobriété 2026-04-29)** — champ Nom retiré, T# suffit. Question fermée.

8. **Fermée — caduque** : l'email plaque T+3h est retiré V1 (Q10 2026-04-24) et la plaque de contrôle d'accès est pré-saisie manager (M03 E4). En cas de changement véhicule en cours (W6), Ops contacte le client par téléphone (B2 V1 assumée). Re-notification automatique éventuelle = sujet M03/Plateforme, pas M04.

9. **Rapport taux clôture hors zone mensuel par chauffeur** — à intégrer dashboard Ops M11 ? Ou export CSV manuel ? À trancher avec §11 Dashboards TMS.

10. **V2 — Constitution de tournées par Manager prestataire** (ouverte revue sobriété 2026-04-29) — V1 = D1 Option A (Ops Savr crée au dispatch). V2 ouvrira au manager la capacité de constituer ses propres tournées côté portail M03 (multi-sélection + bouton "Créer tournée" miroir M02). Implications à documenter en V2 : RLS création tournée par prestataire, conflits de constitution Ops vs Manager sur mêmes collectes (locking optimiste), notifications croisées, contrôle cohérence multi-prestataires (impossible cross-presta côté manager).

---

## 14. Propagations post-M04 (à acter côté CDC Plateforme)

1. **Obsolète V1** — l'email plaque T+3h est retiré (Q10 2026-04-24). Plus de template à gérer côté Plateforme.

2. **Obsolète V1** — corollaire de la suppression de l'email plaque T+3h (Q10 2026-04-24). Plus de scheduler à câbler.

3. **Agrégation pesées par événement live côté Plateforme** : structure existante confirmée (`SUM(pesees) WHERE collecte.evenement_id=:evt`). Pas de changement nécessaire §04 Plateforme.

4. **Déclenchement rapport recyclage** : à clôture complète événement (toutes collectes terminales) + embargo H+24 + batch J+1 6h. Règle §05 Plateforme existante, rien à ajouter.

5. **Obsolète V1** — plus de webhook unitaire. Pesées (uniquement réelles) incluses dans S5 `collecte-terminee` batch via `pesees[].source` (`chauffeur`, `ag_sans_collecte` — enum 2 valeurs post-revue sobriété 2026-04-29).

6. **Validation §08 Plateforme enum `type_flux`** : vérifier cohérence avec §08 TMS après ajout `carton`. Déjà fait dans ce CDC TMS.

---

## 14bis. Alertes M11 émises par M04 (propagation M11 2026-04-24)

> **Normatif (R_M11.1)** : toute émission d'alerte par M04 doit utiliser l'un des codes canoniques ci-dessous via `tms.alerte_emit(code, ...)`. Aucune émission ad-hoc tolérée (test pgTAP `check_codes_used_exist_in_catalogue` bloquant CI).

| Code canonique | Criticité | Trigger M04 |
|----------------|-----------|-------------|
| `m04_ecart_cout_dispatch` | warning | Delta coût > 20 % au dispatch (W9 étape 9) |
| `m04_cloture_manuelle_forcee` | warning | Ops Savr clôture manuelle tournée E3 |
| → `m05_checklist_contournement_detecte` | critical | **Retiré V1 (Bloc 6 B5bis 2026-04-28 — convention émetteur)** : contournement checklist pré-départ. L'émetteur réel est M05 (chauffeur agit sur l'app). Code unifié dans le catalogue M11 sous `m05_checklist_contournement_detecte`. |
| `m04_tournee_vide` | warning | Tournée `planifiee` sans collecte |
| `m04_evenement_dlq` | critical | Event dispatch DLQ après retries |
| `m04_tournee_sans_chauffeur_j1` | warning | Tournée J+0 sans chauffeur à J-1 17h (EC R_M04.X) |
| `m04_tournee_oubliee_cloture_auto` | warning | Tournée inactive > 8h, clôture forcée possible Ops (seedé catalogue M11 propagation A5 2026-04-25) |
| `m04_cloture_hors_zone` | warning | Clôture GPS > 300m du lieu théorique (W étape 3) (seedé catalogue M11 propagation A5 2026-04-25) |

**Résolution auto W7** : dès qu'un event en DLQ est rejoué avec succès, appeler `tms.alerte_resoudre_auto('m04_evenement_dlq', 'tournee', tournee_id, 'dlq_rejoue')`. Idem pour `m04_tournee_sans_chauffeur_j1` à affectation chauffeur.

---

## 15. Liens

- [[00 - Index]]
- [[03 - Périmètre fonctionnel TMS]]
- [[04 - Data Model TMS]] — table `tournees`, `pesees`, `collectes_tms`
- [[05 - Règles métier TMS]] — R2, R6.2
- [[08 - Contrat API Plateforme-TMS]] — S3, S7 (pesées via S5 `collecte-terminee` batch émis par M05) ; supprimé Bloc A A2 → lecture cross-schema `plateforme.v_courses_logistiques`
- [[09 - Authentification et permissions TMS]] — RLS tournées
- [[M01 - Réception ordres de collecte]] — amont
- [[M02 - Dispatch Ops Savr]] — extension E1 multi-sélection
- [[M10 - Gestion exutoires Veolia]] — clôture tournée ZD déclenche W1 M10 auto-incrémentation `stocks_bacs_entrepot.quantite_pleine` (propagation M10 2026-04-25)
- [[01 - Cahier des charges App/05 - Règles métier]] — embargo H+24 rapport recyclage
- [[01 - Cahier des charges App/04 - Data Model]] — `flux_dechets` aligné au singulier
- [[01 - Cahier des charges App/08 - APIs et intégrations]] — contrat API côté Plateforme

# M07 — Pilotage financier logistique


---

## ⚠ Addendum 2026-05-01 — Propagation revue sobriété §08 Bloc A (A2)

**Webhook S6 `course-cout-calculee` supprimé** — remplacé par lecture cross-schema directe via vue `plateforme.v_courses_logistiques`.

Conséquences sur M07 :

1. **Plus de push S6** — la Plateforme lit directement `tms.tournees` + `tms.collectes_tms` via la vue (cf. §08 TMS section S6 strikethrough). Toutes les mentions "push S6", "webhook S6", "DLQ S6" ci-dessous sont **obsolètes V1** (conservées en strikethrough pour traçabilité historique).
2. **Trigger DB cross-schema remplace le push** — sur UPDATE de `tms.tournees.cout_final_ht` ou `tms.tournees.push_s6_version` *(noms corrigés audit 2026-05-26 A2)*, la fonction Postgres `plateforme.fn_recalc_marge_tournee(tournee_id uuid)` recalcule `plateforme.factures.marge_logistique` automatiquement. Pas de réseau, pas de retry, pas de DLQ.
3. **Code alerte `m07_push_s6_dlq` supprimé** — sans objet (pas de webhook, donc pas de DLQ webhook).
4. **EC10 + EC15 sans objet** — les cas d'erreur push S6 disparaissent.
5. **D13 ajusté** — "trigger DB synchrone pour calcul, push S6 async" → **"trigger DB synchrone pour calcul + trigger cross-schema synchrone pour recalc marge"**.
6. **Performance cible "Push S6 delivery 30s"** — sans objet (lecture directe DB, latence négligeable).
7. **Sécurité grille tarifaire préservée** — la vue ne SELECT que `cout_final_ht`, `cout_ajuste` (dérivé `statut_financier='ajuste'`), `push_s6_version`, `duree_reelle_minutes`, `cout_reparti_ht` (par collecte) et `snapshot_cout_detail` (jsonb whitelisté construit par la vue, **exclut `grille_snapshot`** — audit 2026-05-26 A2/A3). Les colonnes `cout_detail` brut, `formules_tarifaires.*`, `grilles_tarifaires.*`, `cellules_grille.*` restent privées TMS (RLS deny par défaut).

Voir [[../08 - Contrat API Plateforme-TMS#Addendum 2026-05-01 — Revue sobriété §08 Bloc A]].
**Persona principal** : Admin TMS (paramétrage grilles + supervision) + Ops Savr (consultation + ajustements + export)
**Dépend de** : [[M04 - Gestion des tournées]] (clôture = déclencheur calcul), [[M06 - Référentiel prestataires]] (grilles tarifaires saisies en M06 E7), [[M12 - Attribution transporteur]] (prestataire = source grille), [[M14 - Intégration Everest (A Toutes!)]] (coût Everest rapproché)
**Bloque** : [[M08 - Facturation prestataires]] (rapprochement facture = coût TMS comme référence)

---

## 1. Objectif métier

Calculer automatiquement le coût HT de chaque tournée à la clôture, en appliquant la grille tarifaire négociée (Strike, Marathon, A Toutes!, prestataires province). Répartir ce coût par collecte. **Exposer en lecture cross-schema** vers la Plateforme via vue `plateforme.v_courses_logistiques` *(remplace ex-webhook S6, revue sobriété 2026-05-01 A2)* pour calcul marge événement. Permettre ajustements manuels Ops (cas litige négocié) et pilotage mensuel (dashboard + export CSV).

**Frontière claire** :
- **M07 calcule** : coût théorique TMS à la clôture tournée (source de vérité interne).
- **M08 rapproche** : coût M07 vs facture prestataire reçue (détection écart).
- **Plateforme calcule marge** : facture client − coût logistique (lu via vue cross-schema `plateforme.v_courses_logistiques`, ex-webhook S6 supprimé revue sobriété 2026-05-01 A2).
- **M07 ne facture pas le client** (c'est la Plateforme).
- **M07 ne paye pas les prestataires** (c'est M08 + Pennylane).

**Fréquence d'usage** :
- Calcul auto : à chaque clôture de tournée (~300 tournées/mois V1, pic 30/jour)
- Consultation dashboard : quotidien (Ops Savr) + hebdo (Val + Louis)
- Ajustement manuel : exceptionnel (~5-10/mois estimé)
- Saisie/MAJ grille : rare (3-4/an par renégociation ou nouveau prestataire)
- Export CSV : mensuel (clôture compta)

---

## 2. Personas et contexte d'usage

### 2.1 Admin TMS (Val, backup Louis)

- **Contexte** : bureau, desktop, sessions de 30-90 min ponctuelles
- **Besoins** :
  - Saisir et mettre à jour les grilles tarifaires négociées (renégo annuelle Strike/Marathon)
  - Créer formule personnalisée pour un nouveau prestataire province
  - Superviser ajustements Ops via digest quotidien (a posteriori, pas validation préalable — décision sobriété A3 2026-04-30)
  - Consulter dashboard pilotage mensuel
  - Lancer export CSV pour expert-compta
- **Contraintes** : données sensibles contractuelles (tarifs), aucun manager prestataire ne doit voir les autres
- **Fréquence** : 5-10 actions/mois

### 2.2 Ops Savr (2-3 personnes)

- **Contexte** : bureau, desktop, double écran, sessions longues (matin 6h-10h pic dispatch)
- **Besoins** :
  - Consulter coût calculé d'une tournée (après clôture M05)
  - Ajuster manuellement le coût en cas de négo exceptionnelle (ex: prestataire accepte une remise one-shot)
  - Consulter dashboard mensuel pour préparer réunions pilotage
- **Contraintes** : tous les ajustements sont auto-poussés Plateforme et tracés en audit log (`ajustements_couts_log` append-only). Supervision a posteriori par Admin TMS via digest quotidien.
- **Fréquence** : consultation pluri-quotidienne, ajustement exceptionnel

### 2.3 Manager prestataire (lecture seule)

- **Contexte** : bureau prestataire (Strike/Marathon/A Toutes!)
- **Besoins** : lire sa propre grille active (M03 portail), pas de visibilité sur les autres
- **Contraintes** : isolation RLS stricte (`prestataire_id = auth.user_prestataire_id()`)
- **Fréquence** : occasionnel (consultation pour vérification)

### 2.4 Système (calcul auto)

- **Déclencheur** : trigger DB sur `tournees.statut = 'terminee'` (transition depuis `en_cours`)
- **Action** : lookup grille, exécution formule, stockage `cout_calcule_ht` + `cout_detail`, `cout_final_ht`, incrément `push_s6_version` (déclenche le trigger cross-schema `plateforme.fn_recalc_marge_tournee`)
- **Contraintes** : idempotent, < 500ms p95 (calcul + recalc marge intégralement en DB, pas de réseau)

---

## 3. Architecture des écrans

| # | Écran | Route | Persona | RLS |
|---|-------|-------|---------|-----|
| E1 | Dashboard pilotage financier | `/tms/finance/dashboard` | Ops Savr + Admin TMS | staff_read |
| E2 | Liste tournées + coûts calculés | `/tms/finance/tournees` | Ops Savr + Admin TMS | staff_read |
| E3 | Détail coût tournée | `/tms/finance/tournees/:id` | Ops Savr + Admin TMS | staff_read |
| E4 | Formulaire ajustement manuel | `/tms/finance/tournees/:id/ajuster` | Ops Savr + Admin TMS | grilles_staff_read + tournees ajust write |
| E5 | Liste grilles tarifaires | `/tms/finance/grilles` | Admin TMS (RW), Ops Savr (R) | grilles_admin_tms_write / grilles_staff_read |
| E6 | Éditeur grille tarifaire (création + édition) | `/tms/finance/grilles/:id` ou `/tms/finance/grilles/nouvelle` | Admin TMS | grilles_admin_tms_write |
| E9 | Export CSV | action `/tms/finance/export` | Admin TMS + Ops Savr | staff_read |

**Navigation** : entrée unique dans le menu latéral TMS "Finance" (visible seulement si rôle `ops_savr` ou `admin_tms`). Sous-menu : Dashboard / Tournées / Grilles / Export.

**Nota** : M06 E7 (éditeur formule prestataire) est le même composant que E6 (réutilisation). Accès depuis le référentiel prestataires OU depuis la finance — même écran, même data. La création d'une grille passe aussi par E6 (formulaire vide) — pas de wizard dédié (décision sobriété A4 2026-04-30, ex-E7 supprimé). Pas d'écran de validation ajustements (décision sobriété A3 2026-04-30, ex-E8 supprimé).

---

## 4. Écran par écran

### E1 — Dashboard pilotage financier

**Layout** : 5 widgets en grille 2×3 (W1 + W2 + W3 + W4 + W6, dernier slot = export). W5 retiré V1 (sobriété A5 2026-04-30).

**Widget W1 — Coût total logistique**
- Mois en cours (cumul à date) + mois N-1 (référence) + variation %
- Clic → E2 filtrée sur période
- Source : `SUM(cout_final_ht) WHERE DATE_TRUNC('month', heure_reelle_fin) = DATE_TRUNC('month', CURRENT_DATE)`
- Calculé à la volée à chaque chargement (vue `v_m07_dashboard`)

**Widget W2 — Coût moyen par tournée × prestataire**
- Bar chart horizontal, une barre par prestataire actif
- Valeur = `AVG(cout_final_ht) GROUP BY prestataire_id` sur 30 derniers jours glissants
- Tri décroissant
- Clic barre → E2 filtrée prestataire

**Widget W3 — Coût par collecte (AG/ZD séparés)**
- Table 2 lignes :
  - Coût moyen/collecte AG (m€/collecte)
  - Coût moyen/collecte ZD (m€/collecte)
- 30 jours glissants
- Source : `AVG(collecte_tournees.cout_reparti_centimes / 100) GROUP BY collectes_tms.parcours` *(corrigé audit 2026-05-26 B2 — `cout_reparti_centimes` est déjà la quote-part PAR collecte, plus de division par `nb_collectes_tournee` qui double-comptait ; nom de vue `courses_logistiques` obsolète, lecture directe liaison)*
- **Retiré V1** : (décision D 2026-04-24, reporté V2)

**Widget W4 — Top 10 tournées les plus coûteuses**
- Table triée `cout_final_ht DESC`, 10 lignes
- Colonnes : date, prestataire, événement, durée réelle, coût HT, badge "ajusté" si applicable
- Clic ligne → E3
- Filtre période : jour / semaine / mois en cours (défaut = mois)

** — supprimé (sobriété A5 2026-04-30)**

> Information consultable directement dans M08 quand le module sera livré. Pas de placeholder dans le dashboard V1.

**Widget W6 — Répartition coûts par prestataire (pie chart)**
- Pie chart part de chaque prestataire sur coût total mois en cours
- Max 6 parts (top 5 + "Autres")
- Légende avec valeur HT et %

**Performance** : chargement p95 < 2s, queries agrégées sur vue `v_m07_dashboard` calculée **à la volée** (sobriété 2026-06-04 — ex-vue matérialisée `m07_dashboard_mv` + cron 5 min supprimés ; volume ~300 tournées/mois, les index composites §10 suffisent, aligné App §11 A1).

**Filtres globaux header** : période (mois en cours défaut, semaine, trimestre, année, custom), prestataire (multi-select), type (AG/ZD/all).

---

### E2 — Liste tournées + coûts calculés

**Layout** : tableau paginé 50 lignes/page, filtres en header, tri par colonne.

**Colonnes** :
- Date clôture (`heure_reelle_fin`)
- Prestataire
- Événement (via collecte_tms → evenement_id Plateforme, snapshot)
- Type (AG/ZD)
- Durée réelle (hh:mm)
- `cout_calcule_ht`
- `cout_ajuste_ht` (si présent, sinon "—")
- `cout_final_ht` (= COALESCE)
- Statut financier : badge (`calcule`, `ajuste`) — enum simplifié décision sobriété D1 2026-04-30 + revue sobriété §05 2026-05-01 D2 (`cout_manquant` retiré V1)
- Verrouillage facture : badge "verrouillée M08" si `cout_final_verrouille = true` (orthogonal au statut)
- Actions : voir détail (→ E3), ajuster (→ E4 si droits + `cout_final_verrouille = false`)

**Filtres** :
- Période (date range)
- Prestataire (multi)
- Type (AG/ZD)
- Statut financier (multi : `calcule`, `ajuste` — `cout_manquant` retiré revue sobriété §05 2026-05-01 D2)
- "Avec ajustement" (toggle — i.e. `statut_financier = ajuste`)
- "Verrouillée M08" (toggle)
- → **Supprimé revue sobriété §05 2026-05-01 D2** (cas impossible par construction grâce à R_M06.X)

**Tri défaut** : `heure_reelle_fin DESC`.

**Export CSV** : bouton "Exporter la sélection courante" (respecte les filtres actifs) — voir E9.

---

### E3 — Détail coût tournée

**Layout** : 4 blocs verticaux.

**Bloc B1 — Identité tournée**
- ID, lien vers M04 détail
- Prestataire (logo si présent M06), chauffeur (nom), véhicule (plaque réelle si saisie, sinon "—")
- Événement : nom, traiteur, lieu (snapshot lieu), date + `heure_collecte`
- Collectes rattachées : liste avec type (AG/ZD), statut opérationnel terminal, poids net total (ZD) ou statut `realisee`/`realisee_sans_collecte` (AG)

**Bloc B2 — Calcul appliqué**
- Grille tarifaire utilisée : nom + lien E6 + `date_debut_validite`
- Formule : nom (`vacations_paliers`, etc.) + lien doc
- Durée réelle : hh:mm (heure_reelle_fin − heure_reelle_debut)
- `nb_personnes_facturation` (1 ou 2)
- Palier appliqué (si `vacations_paliers`) : ex "0h-4h, 1 vacation"
- Zone appliquée (si grille matricielle) : ex "Zone 1 Paris"
- `type_course` (si A Toutes! vélo) : `complete` ou `incomplete`
- **Détail JSON formaté** : `cout_detail` rendu en tableau lisible (pas de JSON brut) — chaque clé = ligne avec libellé human-readable + valeur
- `cout_calcule_ht` en gras

**Bloc B3 — Ajustement (si applicable)**
- Affiché uniquement si `cout_ajuste_ht IS NOT NULL`
- Montant ajusté, écart (% vs `cout_calcule_ht`), motif
- Auteur ajustement (Ops Savr ou Admin TMS), date
- Tous les ajustements sont auto-poussés Plateforme (pas de workflow validation V1 — sobriété A3 2026-04-30). Audit log complet dans `ajustements_couts_log`.

**Bloc B4 — Exposition Plateforme (lecture cross-schema)**
- `cout_final_ht` exposé à la Plateforme via vue `plateforme.v_courses_logistiques` (lecture directe, pas de push réseau — ex-webhook S6 supprimé revue sobriété 2026-05-01 A2)
- `push_s6_version` : compteur de recalculs (incrémenté à chaque calcul/ajustement, déclenche le trigger cross-schema `plateforme.fn_recalc_marge_tournee`)
- Read-only : aucun bouton de relance (pas de DLQ, pas de retry — le recalcul marge est synchrone en DB)

**Actions header** :
- "Ajuster" (→ E4) — masqué si tournée rapprochée à une facture validée M08
- "Voir tournée" (→ M04 détail)
- "Voir historique audit" (modal audit log)

---

### E4 — Formulaire ajustement manuel

**Layout** : modale ou page dédiée avec preview côté droit.

**Formulaire** :
- `cout_calcule_ht` (read-only, référence)
- `cout_ajuste_ht` (numeric input, EUR HT)
- **Écart calculé en temps réel** : montant + % (indicateur visuel : vert <5%, orange 5-15%, rouge ≥15% — purement informationnel, pas de blocage)
- `motif_ajustement` : textarea obligatoire (min 30 caractères, max 500)
- Checkbox "Je confirme cet ajustement — l'audit log tracera mon identité"
- Bouton unique : "Valider l'ajustement"

**Note sobriété (A3 2026-04-30)** : suppression du workflow validation Admin TMS pour ajustements ≥ 15%. Tous les ajustements (Ops Savr ou Admin TMS) sont auto-poussés Plateforme immédiatement. Supervision a posteriori par Admin TMS via digest quotidien (cf. §9 N3 simplifiée). Si dérive observée → réintroduire seuil V1.1 paramétrable.

**Validation UI** :
- `cout_ajuste_ht > 0` (pas de négatif)
- `cout_ajuste_ht != cout_calcule_ht` (sinon pas d'ajustement)
- Motif rempli

**Validation backend (trigger DB)** :
- Check rôle : `ops_savr` ou `admin_tms` uniquement
- Check statut tournée : `statut = 'terminee'` ET `statut_financier IN ('calcule','ajuste')` (pas `cout_manquant`)
- Check rapprochement M08 : bloqué si `cout_final_verrouille = true` (rapprochée à une facture validée) — alerte UI "Cette tournée est rapprochée à une facture validée, déverrouillage nécessaire via M08"

**Effet** :
- INSERT audit log `ajustements_couts_log` (trace complète : ancienne valeur, nouvelle valeur, écart %, motif, auteur, timestamp)
- UPDATE `tournees` : `cout_ajuste_ht`, `motif_ajustement`, `ajuste_par_user_id`, `ajuste_at`, `statut_financier = 'ajuste'`, `cout_final_ht = cout_ajuste_ht`, incrément `push_s6_version`
- Recalcul marge Plateforme immédiat via trigger cross-schema synchrone (pas de workflow différé, pas de réseau)
- Pas de notification in-app à Admin TMS (silencieux ; supervision via digest quotidien N3)

---

### E5 — Liste grilles tarifaires

**Layout** : tableau + filtre prestataire + bouton "Nouvelle grille" (Admin TMS uniquement).

**Colonnes** :
- Prestataire
- Libellé grille
- Type véhicule (ou "Tous")
- Formule (code + libellé)
- `date_debut_validite`
- `date_fin_validite` (ou "En cours")
- Statut (`actif`, `archive`)
- Actions : voir (→ E6), archiver (Admin TMS, si pas d'autre active postérieure), dupliquer pour renégo

**Filtres** :
- Prestataire (multi)
- Statut (actif / archive / tous)
- Formule
- Période validité (range)

**Tri défaut** : `prestataire, date_debut_validite DESC`.

**Action "Dupliquer pour renégo"** : copie la grille active, ouvre E6 en mode création avec `date_debut_validite = date du jour + 1` par défaut. Anti-rétroactivité : règle authoritative dans `[[../05 - Règles métier TMS|§05 R2.8]]`, blocage côté contrainte SQL (cf. §04 grilles_tarifaires_prestataires CHECK). L'ancienne grille reçoit automatiquement `date_fin_validite = nouvelle.date_debut_validite - 1 jour` au moment de la publication de la nouvelle.

---

### E6 — Éditeur grille tarifaire

**Layout** : formulaire à 2 colonnes (champs | preview).

**Champs header** :
- Prestataire (FK, figé si édition)
- Libellé (texte libre, obligatoire)
- Type véhicule (FK `types_vehicules`, nullable — "Tous")
- `date_debut_validite` (date picker, obligatoire)
- `date_fin_validite` (date picker, nullable)
- Devise (EUR défaut, i18n futur)
- Notes négociation (textarea, optionnel)
- PDF contractuel (upload Supabase Storage, optionnel)

**Champs formule** :
- Formule (select depuis `formules_catalogue` où `statut='actif'`)
- À la sélection, génération dynamique du formulaire basé sur `formules_catalogue.schema_parametres` (JSON Schema)
- Bouton "Remplir l'exemple" (charge `exemple_parametres`)
- Preview JSON brut à droite (debug)
- Validation temps réel contre le JSON Schema + affichage erreurs inline

**Champs spécifiques par formule** :
- `vacations_paliers` : inputs pour tarif base HT, coût horaire supplémentaire HT, équipier supplément vacation HT, paliers (table éditable add/remove ligne), flag `tarif_sans_collecte_applicable` (boolean, défaut false)
- `grille_matricielle_zone_type_course` : table 2D éditable (zone × type_course), règle zone multi-site
- `grille_matricielle_zone` : table 1D éditable (zone), flag `tarif_sans_collecte_applicable` (défaut false)
- `forfait_km` : inputs forfait base, km inclus, tarif km supplémentaire
- `forfait_fixe` : input forfait HT

**Contraintes métier UI** :
- Anti-rétroactivité : CHECK SQL `date_debut_validite > CURRENT_DATE` en mode création. Règle authoritative §05 R2.8. → **Supprimée revue sobriété §05 2026-05-01 D2** (cas EC1 lui-même supprimé V1, plus de bypass rétroactif). Migration MTS-1 : SQL Admin direct sur Supabase Studio.
- Unicité : contrainte `EXCLUDE USING gist` sur `(prestataire_id, type_vehicule_id, daterange(date_debut_validite, COALESCE(date_fin_validite, 'infinity')))` WHERE `statut = 'actif'` (sobriété B2 2026-04-30 — remplace trigger custom). Erreur SQL native interceptée côté API.
- UI préremplit `date_debut_validite = CURRENT_DATE + 1`

**Actions** :
- "Enregistrer brouillon" (statut `actif` mais non publié — pas encore utilisé par calcul car `date_debut_validite > today`)
- "Publier" = confirmer et verrouiller : le trigger `date_fin_validite` ancienne grille = `nouvelle.date_debut_validite - 1` s'exécute automatiquement
- "Annuler" (retour E5 sans sauver)

**Audit** : chaque INSERT/UPDATE trace `cree_par_user_id`, `created_at`, `updated_at`. Audit log détaillé séparé : `grilles_tarifaires_audit` (append-only).

---

### E7 — Création grille (wizard) — supprimé (sobriété A4 2026-04-30)

> Création de grille gérée par E6 en mode formulaire vide. Preview live des exemples de calcul intégrée dans le panneau droit de E6. Pas de wizard 3 étapes V1 (3-4 créations/an, ne justifie pas un composant dédié).

---

### E8 — Validations ajustements en attente — supprimé (sobriété A3 2026-04-30)

> Plus de workflow validation Admin TMS. Tous les ajustements Ops sont auto-validés et poussés Plateforme immédiatement. Supervision a posteriori par Admin TMS via digest quotidien (cf. §9 N3).

---

### E9 — Export CSV

**Bouton** : "Exporter" sur E1, E2, E3 (drill-down tournée individuelle = export 1 ligne).

**Format CSV (UTF-8 BOM, séparateur `;` pour compatibilité Excel FR)** :

```
tournee_id;date_tournee;prestataire_code;prestataire_nom;evenement_id;evenement_nom;
traiteur_nom;lieu_code_postal;type_collecte;nb_collectes;duree_reelle_minutes;
nb_personnes_facturation;grille_libelle;formule_code;cout_calcule_ht;cout_ajuste_ht;
cout_final_ht;devise;cout_detail_json;statut_ajustement;ajuste_par;motif_ajustement;
valide_par_admin;heure_reelle_fin
```

**Paramètres** :
- Période (range obligatoire)
- Prestataires (multi, défaut tous)
- Statut financier (`all`, `calcule`, `ajuste`)

**Génération** : sync uniquement V1 (sobriété A2 2026-04-30 — suppression worker async + queue + email). Cap UI : si la sélection dépasse 5000 lignes → message bloquant "Restreignez la période (max 5000 lignes par export)".

**Performance** : p95 < 10s pour 5000 lignes.

**Note Pennylane** : cet export n'est pas auto-poussé vers Pennylane. L'intégration Pennylane vit côté Plateforme (cf. [[01 - Cahier des charges App/08 - APIs et intégrations]] §Pennylane). Le CSV M07 sert uniquement au contrôle manuel Admin TMS / expert-compta externe (décision H 2026-04-24).

---

## 5. Workflows détaillés

### W1 — Calcul automatique coût à la clôture tournée

**Déclencheur** : `UPDATE tournees SET statut='terminee'` (transition depuis `en_cours` ou `acceptee` exceptionnel).

**Steps** :

1. **Trigger DB AFTER UPDATE** `tms.trg_m07_calc_cost` (pas un job async — on veut calcul synchrone pour éviter race conditions avec M08). Spec complète + body PL/pgSQL : §04 addendum M07 §7 (propagation A6 2026-04-25). Filtre `WHEN OLD.statut IN ('en_cours','acceptee') AND NEW.statut='terminee'`. Sortie immédiate sur autres transitions, idempotence post-calcul, 4 cas erreur traités sans rollback (horaires manquants, durée nulle, grille absente, formule non implémentée — alerte M11 dédiée + statut_financier correspondant). **Trigger compagnon `trg_m07_recalc_on_horaires`** (arbitrage Val 2026-06-06, §04 §7) : `AFTER UPDATE OF heure_reelle_debut, heure_reelle_fin` ; quand Ops corrige des horaires manquants sur une tournée `terminee` à `cout_calcule_ht NULL`, il rejoue le coeur de calcul (`fn_m07_compute_and_store`) et résout l'alerte `m07_horaires_manquants`. Sans lui, le coût resterait NULL indéfiniment (le trigger principal n'écoute que `statut`).

2. **Précheck** :
   - `heure_reelle_debut IS NOT NULL AND heure_reelle_fin IS NOT NULL` sinon abort (erreur logs)
   - `duree_reelle_minutes > 0` sinon `cout_calcule_ht = 0` + alerte M11 gravité `warning` "Durée réelle nulle — à vérifier"
   - `grille_tarifaire_id IS NOT NULL` sinon → step 3 (lookup forcé) + **exception SQL bloquante** si échec (revue sobriété §05 2026-05-01 D2 — ex-`cout_manquant`)

3. **Lookup grille (fallback si non dérivée au dispatch)** :
   ```sql
   SELECT * FROM grilles_tarifaires_prestataires
   WHERE prestataire_id = tournee.prestataire_id
     AND (type_vehicule_id = tournee.vehicule.type_vehicule_id OR type_vehicule_id IS NULL)
     AND date_debut_validite <= tournee.date_planifiee
     AND (date_fin_validite IS NULL OR date_fin_validite >= tournee.date_planifiee)
     AND statut = 'actif'
   ORDER BY type_vehicule_id NULLS LAST, date_debut_validite DESC
   LIMIT 1;
   ```
   Si 0 résultat → **RAISE EXCEPTION `INVARIANT_VIOLATION`** (revue sobriété §05 2026-05-01 D2 — cas impossible par construction grâce à R_M06.X grille obligatoire à création prestataire + trigger DB anti-expiration sans successeur). Idem si formule code présent en `formules_catalogue` mais sans implémentation `tms.m07_compute_<code>` → **RAISE EXCEPTION** (mismatch DB seed vs code = bug déploiement à corriger immédiatement, pas un état métier).

4. **Exécution formule** : fonction SQL `tms.m07_compute(grille_id, tournee_id) RETURNS (cout_ht numeric, detail jsonb)` qui dispatch sur `formules_catalogue.code` :
   - `vacations_paliers` → logique paliers R2.2
   - `grille_matricielle_zone_type_course` → logique R2.3 (avec règle AG `realisee_sans_collecte` → `type_course = incomplete` SI `tarif_sans_collecte_applicable = true` dans la grille, sinon `type_course = complete` vacation facturée normale — décision C 2026-04-24)
   - `grille_matricielle_zone` → logique R2.4 (flag `tarif_sans_collecte_applicable` idem)
   - `forfait_km` / `forfait_fixe` → logique R2.5

5. **Cas annulation** : règle authoritative `[[../05 - Règles métier TMS|§05 R2.7]]` (seuil 3h — sobriété C3 2026-04-30, ex-1h). Logique appliquée par cette step :
   - Si `annulee_at >= heure_planifiee_debut - INTERVAL '3 hours'` → vacation facturée (calcul normal avec durée réelle = 0h ou durée minimale palier)
   - Si `annulee_at < heure_planifiee_debut - INTERVAL '3 hours'` → `cout_calcule_ht = 0`, `cout_detail = {"raison": "annulation_hors_delai_facturation"}`
   - Règle uniforme tous prestataires.

6. **Stockage** :
   - UPDATE `tournees` : `cout_calcule_ht`, `cout_detail`, `nb_unites_strike` (si `vacations_paliers`), `cout_calculated_at`, `cout_final_ht = cout_calcule_ht`, `statut_financier = 'calcule'` (sobriété B5 2026-04-30 : `cout_final_ht` mis à jour par trigger explicite, pas colonne GENERATED).

7. **Répartition par collecte** *(refonte multi-camions 2026-05-25 : écriture sur `collecte_tournees`, ex `collectes_tms.cout_reparti_centimes`)* :
   - `collecte_tournees.cout_reparti_centimes = FLOOR(cout_calcule_ht * 100 / nb_collectes_tournee)` pour les `nb_collectes_tournee − 1` premières lignes de liaison de **cette** tournée (répartition égale — décision §03 M07 ; **arbitrage Val 2026-06-06 floue #4 : FLOOR, le trigger §04 fait foi, ex-`ROUND` en prose corrigé pour valeur attendue unique en test**). `nb_collectes_tournee` = nombre de collectes de la tournée (lignes `collecte_tournees WHERE tournee_id = ...`).
   - Dernière collecte de la tournée reçoit le reste pour éviter rounding errors
   - Cas `nb_collectes_tournee = 0` (edge) : impossible car contrainte M04 (1 collecte min par tournée)
   - **Multi-camions** : une collecte servie par N tournées reçoit une part par tournée ; son coût logistique total = `SUM(collecte_tournees.cout_reparti_centimes)` sur ses lignes (lu par M08 + vue marge Plateforme).

8. **Exposition Plateforme (cross-schema, ex-push S6 supprimé 2026-05-01 A2)** :
   - Incrément `tournees.push_s6_version` (compteur de recalculs, `+1`)
   - Le trigger cross-schema sur UPDATE de `cout_final_ht` / `push_s6_version` appelle `plateforme.fn_recalc_marge_tournee(tournee_id)` qui recalcule `plateforme.factures.marge_logistique`. **Synchrone, en DB, pas de réseau, pas de retry, pas de DLQ.**
   - La Plateforme lit `cout_final_ht` directement via la vue `plateforme.v_courses_logistiques`.

9. **Fin** : tournée statut reste `terminee`, coût figé.

**Performance cible** : trigger DB calcul + recalc marge cross-schema < 100ms p95 (intégralement en DB).

---

### W2 — Ajustement manuel (Ops Savr OU Admin TMS)

1. Auteur ouvre E3 détail tournée
2. Clic "Ajuster" → E4
3. Saisie `cout_ajuste_ht` + motif (≥ 30 chars)
4. Preview écart en temps réel (informationnel : vert <5%, orange 5-15%, rouge ≥15% — pas de blocage)
5. POST `/api/tournees/:id/ajustement` avec body `{cout_ajuste_ht, motif_ajustement}`
6. Backend :
   - Check rôle : `ops_savr` OU `admin_tms`
   - Check `statut = 'terminee'` ET `statut_financier IN ('calcule','ajuste')` ET `cout_final_verrouille = false`
   - UPDATE `tournees` : `cout_ajuste_ht`, `motif_ajustement`, `ajuste_par_user_id`, `ajuste_at`, `statut_financier = 'ajuste'`, `cout_final_ht = cout_ajuste_ht`
   - INSERT `ajustements_couts_log` (append-only, audit : ancienne valeur, nouvelle valeur, écart %, motif, auteur, timestamp)
   - Incrément `push_s6_version` → trigger cross-schema recalcule la marge Plateforme immédiatement (synchrone, en DB) sur `cout_final_ht = cout_ajuste_ht`
7. Notif : silencieuse (audit log + supervision via digest quotidien N3)

> **W3 supprimé** (sobriété A3 2026-04-30) — plus de workflow validation Admin TMS pour ajustements ≥ 15%. Tous les ajustements suivent W2. Supervision a posteriori via digest quotidien (N3 simplifiée § 9). Réintroduction du seuil possible V1.1 si dérive observée en prod.

---

### W4 — Création nouvelle grille (renégo / nouveau prestataire)

1. Admin TMS va sur E5 → "Nouvelle grille" (ou "Dupliquer" depuis grille existante)
2. **E6 mode création** ouvert avec formulaire vide (sobriété A4 2026-04-30 — wizard E7 supprimé). Preview live des exemples de calcul intégrée dans le panneau droit de E6.
3. Saisie prestataire + libellé + type véhicule + formule + paramètres
4. "Publier"
5. Backend :
   - Validation JSON Schema
   - CHECK SQL `date_debut_validite > CURRENT_DATE` en mode création (anti-rétroactivité, règle authoritative §05 R2.8)
   - Contrainte `EXCLUDE USING gist` détecte chevauchement (sobriété B2 — remplace trigger custom)
   - INSERT `grilles_tarifaires_prestataires`
   - Si grille précédente active `date_fin_validite IS NULL` ET `(prestataire_id, type_vehicule_id)` match : UPDATE précédente `date_fin_validite = nouvelle.date_debut_validite - 1 jour`
   - INSERT `grilles_tarifaires_audit` (append-only)
6. Retour E6 consultation

**Effet sur tournées** :
- Tournées clôturées avant `nouvelle.date_debut_validite` : figées, coût inchangé (décision E)
- Tournées planifiées après `nouvelle.date_debut_validite` : utiliseront automatiquement la nouvelle grille via lookup W1-step3

---

### W5 — Modification d'une grille active en cours

**Contrainte** : interdit UI. Bouton "Modifier" désactivé si `date_debut_validite <= CURRENT_DATE`. Tooltip : "Grille en vigueur — créer une nouvelle grille pour toute modification tarifaire (anti-rétroactivité)".

**Seuls champs éditables sur grille active** :
- `libelle` (informatif)
- `notes_negociation`
- `pdf_contractuel_url`

**Hors ces champs, Admin TMS doit dupliquer + publier nouvelle grille avec date future.**

---

### W6 — Archivage grille

1. Admin TMS va sur E5 → action "Archiver" sur ligne grille
2. Contrôle : grille ne doit pas être actuellement `actif` SAUF si `date_fin_validite IS NOT NULL AND date_fin_validite < CURRENT_DATE` (expirée naturellement)
3. UPDATE `statut = 'archive'`
4. Effet : disparaît des listes filtrées "actifs", reste consultable en mode lecture pour audit tournées historiques (on ne supprime jamais, c'est une FK de `tournees.grille_tarifaire_id`)

---

### W7 — Export CSV (sobriété A2 2026-04-30 — sync uniquement)

1. User clic "Exporter" sur E1/E2/E3
2. Modal : période + filtres + statut financier
3. Front check : SELECT COUNT(*) avec filtres → si > 5000 → bloque avec message "Restreignez la période (max 5000 lignes par export)"
4. POST `/api/m07/export` → génération sync stream HTTP (pas de queue, pas de worker, pas d'email)
5. Réponse : `Content-Type: text/csv; charset=utf-8`, header BOM UTF-8, séparateur `;`
6. Performance cible p95 < 10s pour 5000 lignes (cf. §10)

---

## 6. Règles métier appliquées

Renvois explicites vers `[[../05 - Règles métier TMS|§05]]` (pas de duplication de règle) :

- **R2.1 Algorithme général** → cf. §05 R2.1. Utilisé par W1.
- **R2.2 Formule `vacations_paliers`** → cf. §05 R2.2. Strike (grilles réelles 2026-06-07 : Marathon reclassé `forfait_fixe` → R2.5 ; dépassement par heure entamée, supplément équipage double 31,25 €/h sur dépassement seul). Paliers JSON configurables.
- **R2.3 Formule `grille_matricielle_zone_type_course`** → cf. §05 R2.3. A Toutes! vélo. Avec précision 2026-04-24 : `type_course = incomplete` uniquement si `tarif_sans_collecte_applicable = true` dans la grille (défaut false pour Strike/Marathon).
- **R2.4 Formule `grille_matricielle_zone`** → cf. §05 R2.4. **Aucune grille V1** (arbitrage Val 2026-06-07 — camion A Toutes! = R2.6 manuel/Everest ; formule conservée au catalogue).
- **R2.5 Formules `forfait_km` / `forfait_fixe`** → cf. §05 R2.5. Prestataires province + **Marathon IDF (`forfait_fixe` 100 €/tournée — grille réelle 2026-06-07)**.
- **R2.6 Cas sans grille** → cf. §05 R2.6. **Refondu revue sobriété §05 2026-05-01 D2** : cas impossible par construction (R_M06.X grille obligatoire à création prestataire). Si déclenché → exception SQL bloquante. **Exception assumée V1 (arbitrage Val 2026-06-07)** : courses **camion A Toutes!** — aucune grille camion n'existe (seule la grille vélo est instanciée) → saisie manuelle Ops (§05 R2.6), pas une exception SQL.
- **R2.7 Annulation — règle authoritative `[[../05 - Règles métier TMS|§05 R2.7]]`** (seuil 3h, sobriété C3 2026-04-30, ex-1h) :
  - **Annulation ≥ 3h avant `heure_planifiee_debut`** : `cout_calcule_ht = 0`, règle uniforme tous prestataires
  - **Annulation < 3h avant `heure_planifiee_debut`** (ou après) : vacation facturée (formule normale sur durée minimale palier ou durée réelle si chauffeur mobilisé)
  - Renvoi cf. W1 step 5

- **R2.8 Figement post-clôture + anti-rétroactivité grilles** — règle authoritative `[[../05 - Règles métier TMS|§05 R2.8]]` (sobriété C4 2026-04-30, formulation centralisée) :
  - `cout_calcule_ht` immuable une fois la tournée `terminee`. Correction = ajustement manuel tracé (`cout_ajuste_ht`)
 - Modification rétroactive de grille interdite. → **Supprimée revue sobriété §05 2026-05-01 D2** (cas EC1 lui-même supprimé V1)

- ** Seuil validation ajustement — supprimée (sobriété A3 2026-04-30)** : workflow validation Admin TMS retiré V1. Tous les ajustements (peu importe l'écart) suivent W2. Supervision a posteriori via digest quotidien N3.

- **R2.10 Flag `tarif_sans_collecte_applicable`** (décision C 2026-04-24) — inchangée :
  - Ajouté dans `parametres_formule` des formules `vacations_paliers` et `grille_matricielle_zone`
  - Déjà natif dans `grille_matricielle_zone_type_course` via `type_course`
  - Défaut `false` (Strike, Marathon, province, A Toutes! camion)
  - `true` pour A Toutes! vélo (géré via `type_course = incomplete`)

---

## 7. Edge cases

| # | Cas | Comportement V1 |
|---|-----|-----------------|
| EC2 | `duree_reelle_minutes = 0` (erreur saisie chauffeur ou `heure_reelle_debut = heure_reelle_fin`) | `cout_calcule_ht = 0` + alerte M11 `m07_duree_nulle` (warning) "Durée nulle — vérifier saisie chauffeur". Ops Savr corrige via ajustement manuel. |
| EC3 | `heure_reelle_fin IS NULL` (tournée pas encore terminée alors que `statut = terminee`) | Impossible (contrainte DB sur transition statut). Trigger bloque. |
| EC5 | Double clôture tournée (UPDATE idempotent) | **No-op strict** (arbitrage Val 2026-06-06 floue #2) : si `cout_calcule_ht IS NOT NULL` → skip calcul, pas de réincrément `push_s6_version`, quelle que soit la grille. retiré — inatteignable et contraire au figement R2.8 (`cout_calcule_ht` immuable post-clôture, grille figée à la date tournée). La correction d'un coût erroné passe exclusivement par l'ajustement manuel `cout_ajuste_ht` (W2). |
| EC6 | Annulation **collecte** par le client pendant que la tournée est `en_cours` | **Reformulé (arbitrage Val 2026-06-06 floue #3)** : la tournée `en_cours` **ne transite jamais** vers `annulee` au niveau `tournees.statut` (cf. §05 R2.7bis authoritative). C'est la collecte qui passe `annulee_par_traiteur` ; la tournée finit toujours (clôture chauffeur) → **vacation facturée intégralement** (M07 calcule normalement sur durée réelle, coût ≠ 0). L'annulation **avant** démarrage tournée relève de R2.7 (≥ 3h = 0€, < 3h = facturée), pas d'EC6. |
| EC7 | Chevauchement grilles actives (bug insertion) | Contrainte `EXCLUDE USING gist` bloque INSERT/UPDATE (sobriété B2 2026-04-30 — remplace trigger custom `tg_grilles_unicite`). Défensif : query W1 LIMIT 1 avec ORDER BY prend la plus récente. Erreur SQL native interceptée côté API. |
| | | **Reformulé** (sobriété A3 2026-04-30) : tous les ajustements sont auto-validés, l'écart M08 sera calculé sur `cout_final_ht` (= `cout_ajuste_ht`). Pas de cas spécifique au seuil 15%. |
| EC9 | Ops tente d'ajuster une tournée verrouillée par facture M08 | UI bloquée (bouton désactivé sur `cout_final_verrouille = true`). Backend refuse avec message "Tournée verrouillée par facture M08 `numero_facture`. Déverrouillage nécessaire via M08 W9 (Admin TMS uniquement, motif ≥ 30 caractères) ou cycle avoir + nouvelle facture (M08 W6)." |
| EC11 | Modification rétroactive grille tentée par Admin TMS (bug ou erreur humaine) | CHECK SQL bloque + message "Rétroactivité interdite — créer nouvelle grille avec `date_debut_validite` future". Règle authoritative §05 R2.8. → **Exception EC1 supprimée revue sobriété §05 2026-05-01 D2** (cas EC1 lui-même refondu, plus de bypass rétroactif). Si rétroactivité ponctuelle nécessaire (migration MTS-1) → SQL Admin direct sur Supabase Studio + audit_log manuel. |
| EC12 | Grille expirée naturellement sans remplacement | **Refondu revue sobriété §05 2026-05-01 D2** : cas impossible par construction grâce au **trigger DB anti-expiration sans successeur** sur `grilles_tarifaires_prestataires` (BEFORE UPDATE) qui RAISE EXCEPTION si tentative `UPDATE date_fin_validite NOT NULL` ou `UPDATE statut = 'archive'` sur la dernière grille active du couple `(prestataire_id, type_vehicule_id)` sans qu'une grille successeur active soit publiée. Force Admin TMS à publier grille suivante AVANT d'expirer la précédente. Si déclenché côté UI → message UX "Une grille successeur active est requise avant d'expirer celle-ci." |
| EC13 | Tournée `realisee_sans_collecte` AG avec `tarif_sans_collecte_applicable = false` (Strike backup AG) | Vacation normale facturée (décision C). Flag appliqué uniquement si `type_collecte = ag`. |
| EC14 | Ajustement sur tournée déjà ajustée (correction de correction) | Autorisé. Nouvelle valeur `cout_ajuste_ht` remplace l'ancienne, audit log append-only conserve historique complet. Nouveau calcul écart % contre `cout_calcule_ht` original (pas contre l'ajustement précédent). |
| EC15 | Recalcul marge après ajustement mais Plateforme a déjà comptabilisé la version précédente dans clôture financière | Le trigger cross-schema `fn_recalc_marge_tournee` est idempotent (recalcule depuis `cout_final_ht` courant). Si la clôture compta côté Plateforme est figée, l'écart apparaîtra comme revue compta — communication humaine. |

---

## 8. États et transitions

### 8.1 Statut financier tournée — enum `statut_financier` (2 valeurs, refondu revue sobriété §05 2026-05-01 D2 ; ex-3)

```
[terminee] → [calcule]              (calcul OK — toujours, grille obligatoire par construction)
[calcule]  → [ajuste]               (ajustement manuel par Ops/Admin)
[ajuste]   → [ajuste]               (correction de correction, EC14)
```

**Verrouillage M08** : flag boolean orthogonal `cout_final_verrouille` (sobriété C2 2026-04-30 — fusionné, plus de statut `verrouille_facture`). Quand `cout_final_verrouille = true` : E4 bloque les ajustements, déverrouillage via M08 W9.

**États supprimés** (sobriété 2026-04-30 + revue sobriété §05 2026-05-01 D2) :
- — trigger sync <500ms, état jamais persisté observable (D1)
- — workflow validation supprimé, fusionnés en `ajuste` (A3)
- — comportement métier identique à `cout_manquant`, fusionné (A6 2026-04-30)
- — **Supprimé revue sobriété §05 2026-05-01 D2** : cas impossible par construction (R_M06.X grille obligatoire à création prestataire + trigger anti-expiration sans successeur). Si déclenché en prod = bug, surface par exception SQL bloquante.
- — orthogonal, géré par flag boolean (C2)

### 8.2 Statut grille — enum `statut` (2 valeurs, sobriété D2 2026-04-30)

Colonne persistée : `actif` ou `archive`. **L'état temporel (future / en vigueur / expirée) n'est PAS persisté** — il est dérivé à la demande via vue SQL `vue_grilles_etat_courant` qui calcule `etat_courant = CASE WHEN date_debut_validite > CURRENT_DATE THEN 'future' WHEN date_fin_validite IS NOT NULL AND date_fin_validite < CURRENT_DATE THEN 'expiree' ELSE 'en_vigueur' END`.

Transitions autorisées :
- `actif` → `archive` : manuel Admin TMS (si pas de FK actives dans tournées en cours)
- Pas de transition automatique cron quotidien (sobriété D2 — la dérivation par vue suffit)

---

## 9. Notifications

| # | Déclencheur | Cible | Canal | Template |
|---|-------------|-------|-------|----------|
| | | — | — | **Fusionnée dans N1** (sobriété A6 2026-04-30) |
| N3 | Digest ajustements quotidien | Admin TMS | Email digest 8h | "N ajustements effectués hier — récap (Ops auteur, tournée, écart %, motif)". Envoi seulement si N>0. **Supervision a posteriori** (sobriété A3 2026-04-30 — ex-N3 "validation requise" supprimée). |
| N7 | Durée réelle nulle (EC2) | Ops Savr | In-app | "Tournée [ID] : durée réelle = 0. À vérifier." |

**Pas de notification** :
- Calcul auto réussi (silencieux)
- Ajustement (silencieux ; trace audit + digest N3)
- Recalcul marge cross-schema réussi (silencieux, synchrone en DB)

---

## 10. Performance cibles

| Action | Cible p95 | Cible p99 |
|--------|-----------|-----------|
| Trigger DB W1 calcul auto + recalc marge cross-schema (formule simple `vacations_paliers`) | 50ms | 150ms |
| Trigger DB W1 formule complexe (matricielle + lookup zone CP) | 150ms | 400ms |
| Chargement E1 dashboard (vue `v_m07_dashboard` à la volée) | 2s | 5s |
| Chargement E2 liste tournées (50 lignes + pagination) | 800ms | 2s |
| Chargement E3 détail tournée | 600ms | 1.5s |
| POST ajustement E4 | 300ms | 800ms |
| Export CSV sync (≤ 5000 lignes) | 5s | 10s |

**Stratégies** :
- Vue `v_m07_dashboard` calculée **à la volée** (sobriété 2026-06-04 — ex-vue matérialisée + cron 5min supprimés ; volume ~300 tournées/mois)
- Index composites sur `tournees (prestataire_id, heure_reelle_fin DESC)` et `(statut_financier)` pour filtres E2 + agrégats dashboard
- JSONB index GIN sur `cout_detail` pour recherche audit (rare usage)

---

## 11. Décisions structurantes prises

| # | Décision | Alternatives écartées | Raison |
|---|----------|----------------------|--------|
| D1 (A) | **Coût calculé figé post-clôture** | Recalcul auto à chaque modif grille | Cohérence M08 + exports compta + audit. Toute correction = ajustement manuel tracé. |
| D2 (B) | **Ajustement manuel = champ séparé `cout_ajuste_ht`** (pas override) | Override direct `cout_calcule_ht` | Traçabilité audit, séparation calculé/humain, recalcul marge idempotent versionné (`push_s6_version`). |
| D4 (C) | **Flag `tarif_sans_collecte_applicable`** par grille (défaut false) | Règle hardcodée par type prestataire | Paramétrage Admin TMS sans code, cohérent avec philosophie JSON paliers. |
| D5 (C) | **Annulation < 3h avant démarrage = facturée, ≥ 3h = non facturée** (tous prestataires) — sobriété C3 2026-04-30 (ex-1h) | Seuil 1h initial / Ancienne R2.7 "avant/après début créneau" / règles différenciées par prestataire | Seuil élargi à 3h pour mieux couvrir les délais de mobilisation chauffeur. Règle uniforme simple et équitable. Authoritative §05 R2.7. |
| D6 (D) | **Dashboard V1 = 5 widgets** (coût total, coût moyen prestataire, coût/collecte AG/ZD, top 10, pie prestataires) — sobriété A5 2026-04-30 (ex-6 widgets, W5 écart facture supprimé) | Widget coût/kg collecté / W5 écart TMS vs facturé | Simplicité V1, coût/kg reporté V2. W5 supprimé — info consultable directement dans M08 quand livré. |
| D7 (E) | **Zéro rétroactivité sur grilles** (trigger DB bloque `date_debut_validite <= CURRENT_DATE`) | Autoriser modification rétroactive avec recalcul batch manuel | Simplicité, intégrité financière absolue. Cohérent avec D1 (figement). Renégos traitées par nouvelle grille future. → **Supprimée revue sobriété §05 2026-05-01 D2**. |
| D9 (F) | **Pas de pré-calcul coût estimatif au dispatch V1** | Afficher coût estimé M02 | Complexité (gestion formules en mode "prévisionnel"), pas prioritaire marge V1. Report V1.1 pour M12 scoring. |
| D10 (G) | **`nb_personnes_facturation` saisi par Ops Savr au dispatch (source de vérité)** | Override Manager à l'acceptation, correction chauffeur en fin de tournée | Ops = qui négocie avec prestataire, connaissance besoin événement. Divergence réelle équipier indispo = ajustement facturation M08 (pas refactoring `nb_personnes_facturation`). |
| D11 (H) | **Export CSV M07 pour contrôle manuel**, push Pennylane côté Plateforme (hors TMS) | Auto-push TMS → Pennylane | Séparation concerns : TMS = calcul coût logistique, Plateforme = intégration compta globale (marge incluse). |
| D12 | **Répartition coût par collecte = égale V1** (décision §03 M07) | Répartition au poids / temps / distance | Simplicité V1, pilotage marge suffisant. Affinement V2 possible si besoin précision. |
| D13 | **Trigger DB synchrone pour calcul + trigger cross-schema synchrone pour recalc marge** (ajusté addendum 2026-05-01 A2, ex-"push S6 async") | Push réseau async / webhook | Tout en DB (même instance Supabase) : intégrité immédiate M08 + marge Plateforme recalculée sans réseau, sans retry, sans DLQ. |
| D14 | **Formule = code + schema JSON (pas de DSL)** (décision §04) | DSL custom paramétrable par Admin | Trop complexe V1, risque bugs. Couplage DB↔code assumé (ajout formule = migration + code). |
| D15 | **Table `ajustements_couts_log` append-only** (audit) | Trace inline sur `tournees` | Traçabilité sans limite, historique complet, conforme RGPD 3 ans. |

---

## 12. Questions ouvertes

1. **Seed formules_catalogue V1** : 5 formules déjà listées (§04). Confirmer que province = `forfait_fixe` + `forfait_km` couvrent 100% des cas. Si prestataire province avec tarif horaire → utilise `vacations_paliers` générique. À valider lors seed MTS-1 (cf. Q6 Index TMS).
2. **Format CSV Pennylane** : colonnes attendues par Pennylane pour import coût logistique côté Plateforme. Cf. [[01 - Cahier des charges App/08 - APIs et intégrations|§08 Plateforme]]. Non bloquant M07 mais à cadrer pour H.
3. — **Tranchée sobriété B3 2026-04-30** : alerte supprimée V1. Détection via dashboard / EC12.
4. **Dashboard drill-down événement** : ajouter vue "coût logistique par événement" V1 ou V1.1 ? Croisement CDC Plateforme (`evenements`) — pourrait remonter côté Plateforme admin.
5. — **TRANCHÉE (arbitrage Val 2026-06-06, floue #5)** : trigger `trg_formules_catalogue_impl_check` `AFTER INSERT OR UPDATE OF code ON formules_catalogue` qui RAISE EXCEPTION si `tms.m07_compute_<code>` n'existe pas (introspection `pg_proc`). Le mismatch DB seed ↔ code échoue **au déploiement/seed**, pas en prod à la clôture d'une vraie tournée. L'exception SQL bloquante à la clôture (W1 step 5) reste le filet de sécurité runtime. Spec : §04 §5.
6. **Répartition coût collecte — cas tournée 100% `realisee_sans_collecte` AG** : coût réparti quand même (cout_reparti_centimes > 0 sur chaque collecte) ? Oui par défaut, sauf si règle métier Plateforme différente.
7. **Courbe apprentissage Admin TMS sur éditeur grille** : UI dynamique JSON Schema peut être complexe. Valider ergonomie avec Val sur seed Strike avant déploiement.

---

## 12bis. Alertes M11 émises par M07 (propagation M11 2026-04-24)

> **Normatif (R_M11.1)** : tous les triggers M07 utilisent `tms.alerte_emit(code, ...)` avec codes canoniques catalogue.

| Code canonique | Criticité | Trigger M07 |
|----------------|-----------|-------------|
| `m07_horaires_manquants` | critical | Tournée passée à `terminee` sans `heure_reelle_debut` ou `heure_reelle_fin` (précheck `trg_m07_calc_cost` step 2) |
| `m07_duree_nulle` | warning | Durée réelle tournée = 0 (erreur saisie) |
| `m07_ajustement_pendant_facturation` | critical | Tentative ajustement sur tournée verrouillée par facture (`cout_final_verrouille = true`, EC9) |

**Résolution auto W7** :
- → **N/A revue sobriété §05 2026-05-01 D2** (code supprimé V1)
- → **N/A revue sobriété 2026-05-01 A2 / propagation 2026-06-04** (code supprimé, S6 remplacé par recalcul cross-schema)

> **Codes M07 réellement seedés au catalogue M11 V1 (3 codes — source authoritative M11)** : `m07_horaires_manquants` (critical), `m07_duree_nulle` (warning), `m07_ajustement_pendant_facturation` (critical).

---

## 13. Liens

### Intra-CDC TMS
- [[../03 - Périmètre fonctionnel TMS|§03 M07]] — spec macro (annulation seuil 3h, ajustements auto-validés, dashboard 5 widgets, pas de pré-calcul V1, pas de wizard, statut financier 3 valeurs)
- [[../04 - Data Model TMS|§04]] — tables `formules_catalogue`, `grilles_tarifaires_prestataires` (contrainte `EXCLUDE USING gist`, vue `vue_grilles_etat_courant`), `tournees` (enum `statut_financier` 3 valeurs, `cout_final_verrouille` boolean unique, `cout_final_ht` non GENERATED, suppression `validation_admin_requise`), `ajustements_couts_log`, `parametres_tms` namespace `m07` (suppression `seuil_validation_ajustement_pourcent` + `alerte_expiration_grille_jours`)
- [[../05 - Règles métier TMS|§05 R2]] — R2.1 à R2.6 + R2.7 (seuil 3h authoritative) + R2.8 (anti-rétroactivité authoritative) + R2.10 (R2.9 supprimée)
- [[../08 - Contrat API Plateforme-TMS|§08]] — exposition cross-schema via vue `plateforme.v_courses_logistiques` (ex-webhook S6 supprimé 2026-05-01 A2 : `cout_final_ht`, `cout_ajuste` dérivé, `push_s6_version`)
- [[../09 - Authentification et permissions TMS|§09 RLS]] — policies `grilles_tarifaires_prestataires`, policies `tournees` ajustement + `ajustements_couts_log` (suppression policies E8 + état `ajuste_en_validation`)
- [[M04 - Gestion des tournées]] — trigger clôture = déclencheur W1
- [[M06 - Référentiel prestataires]] — E7 éditeur formule partagé avec M07 E6
- [[M08 - Facturation prestataires]] — `montant_ht_calcule_tms` = agrégat `cout_final_ht` par prestataire × période, flag `cout_final_verrouille` boolean
- [[M11 - Alerting transverse]] — codes alertes M07 (**3 codes V1**, source authoritative M11 : `m07_horaires_manquants` critical, `m07_duree_nulle` warning, `m07_ajustement_pendant_facturation` critical ; retiré §05 D2, retiré A2 2026-05-01 — S6 supprimé)
- [[M12 - Attribution transporteur]] — `prestataire_id` choisi = source grille lookup
- [[M13 - Administration TMS]] — paramètres `m07.*` (le namespace existe toujours mais sans `seuil_validation_ajustement_pourcent` ni `alerte_expiration_grille_jours`)
- [[M14 - Intégration Everest (A Toutes!)]] — `everest_missions.cout_everest_ht` comparatif audit

### Cross-CDC (Plateforme)
- [[01 - Cahier des charges App/04 - Data Model|§04 Plateforme]] — vue `v_courses_logistiques` *(ex-table `courses_logistiques` migrée en vue cross-schema 2026-05-01 A2)* (colonnes exposées : `cout_final_ht`, `cout_reparti_ht`, `cout_ajuste`, `version_paiement` = alias de `push_s6_version`, `snapshot_cout_detail`)
- [[01 - Cahier des charges App/08 - APIs et intégrations|§08 Plateforme]] — lecture marge cross-schema (ex-S6 reception side supprimé) + intégration Pennylane
- [[01 - Cahier des charges App/03 - Périmètre fonctionnel global|§03 Plateforme]] — Module 9 TMS + pilotage financier admin

### Décisions historiques
- [[03 - Ateliers/Atelier tech avec frère - 2026-04-23]] — architecture schéma `tms.*`, RLS cross-schema
- Décisions 2026-04-22 (§04) : table unifiée grilles, catalogue formules DB, paramétrable sans code
- Décisions 2026-04-24 (ce fichier) : D1-D15 ci-dessus
- Décisions sobriété 2026-04-30 (cf. Changelog) : A2/A3/A4/A5/A6 + B2/B3/B4/B5 + C1/C2/C3/C4 + D1/D2 — D3/D5/D6 révisés en conséquence

---

## Changelog

- **2026-06-04** — **Revue de sobriété M07 (skill `cdc-review-sobriete`)**. 0 suppression de fonctionnalité métier (module déjà élagué). Travail = purge de la dette de propagation S6 (Dette Lot 2) + 2 décisions Val :
  - **Bloc C — purge fantômes S6 (18 items, corps du module)** : l'addendum 2026-05-01 A2 avait supprimé le webhook S6 (→ lecture cross-schema `plateforme.v_courses_logistiques` + trigger `plateforme.fn_recalc_marge_tournee`) mais le corps décrivait toujours « Push webhook S6 + DLQ + retry + worker async » comme actif V1. Reframés/supprimés : Persona §2.4, Widget W1, E3 Bloc B4 (→ « Exposition Plateforme » read-only, plus de bouton relance), E4 Effet, W1 step 8, W1 Perf, W2 step 6, EC5, **EC10 supprimé**, EC15 reframe, **N6 supprimée**, §9 « pas de notif », §10 Perf (lignes push S6 delivery + export CSV async supprimées), D13, D2, §12bis W7 résolution auto, Liens §08/M11/§08 Plateforme. `push_s6_version` conservé (compteur de recalcul, déclencheur du trigger cross-schema).
  - **Bloc A — N1 supprimée** : notif « grille manquante / formule non implémentée » devenue exception SQL bloquante par construction (D2 §05) → aucun flux notif métier (remontée logs/Sentry).
  - **Bloc B — dashboard à la volée** : vue matérialisée `m07_dashboard_mv` + cron 5 min → vue `v_m07_dashboard` calculée à la volée (volume ~300 tournées/mois, index suffisent, aligné App §11 A1).
  - **Correction de cohérence** : catalogue §12bis M07 omettait `m07_horaires_manquants` (critical, seedé M11) → ajouté ; codes M07 V1 = **3** (M11 fait foi). Widget count §11 D3 corrigé 6→5 (W5 retiré A5).
  - **Propagation (zéro dette)** : §04 (trigger M07 §7 garde-fous + colonnes `cout_final_ht`/`push_s6_version` + vue dashboard), §11 (D3 mode refresh + widget count + perf + liens), §03 (exemple alerte critical), M11 (§13.10 M07 0 code auto-résolu). Cross-CDC : 0 divergence (tout interne TMS, contrat `v_courses_logistiques` inchangé).
- **2026-04-24** — V1 rédigée. 15 décisions D1-D15, 15 edge cases EC1-EC15, 9 écrans E1-E9, 7 workflows W1-W7, 3 nouvelles règles R2.8/R2.9/R2.10.
- **2026-04-30** — Revue de sobriété appliquée. Décisions Val :
  - **A2** Export CSV async supprimé → sync uniquement, cap 5000 lignes
  - **A3** Workflow validation Admin TMS pour ajustements ≥15% supprimé → tous ajustements auto-validés, supervision via digest quotidien (W3 supprimé, E8 supprimé, R2.9 supprimée, paramètre `seuil_validation_ajustement_pourcent` supprimé, états `ajuste_en_validation`/`ajuste_valide`/`ajuste_refuse` supprimés)
  - **A4** Wizard E7 création grille supprimé → E6 unique pour création + édition
  - **A5** Widget W5 écart TMS vs facturé supprimé V1 → 5 widgets restants
  - **A6** Statut `formule_non_implementee` fusionné dans `cout_manquant` → EC4 fusionné dans EC1, alerte M11 fusionnée
  - **B2** Trigger custom `tg_grilles_unicite` remplacé par contrainte `EXCLUDE USING gist`
  - **B3** Notion `m07_grille_expiration_imminente` supprimée partout → pas d'alerte auto, détection via dashboard / EC12, paramètre `m07.alerte_expiration_grille_jours` supprimé
  - **B4** Retries push S6 5 paliers (5min/30min/2h/6h/24h) → 2 paliers (1h/24h)
  - **B5** `cout_final_ht` non GENERATED → mis à jour par trigger explicite
  - **C1** Fusion `statut_ajustement` / `statut_financier` → un seul enum `statut_financier`
  - **C2** Fusion flag `cout_final_verrouille` (boolean) / statut `verrouille_facture` → boolean unique, statut retiré de l'enum
  - **C3** Seuil annulation 1h → 3h (R2.7), règle authoritative §05 R2.7
  - **C4** Anti-rétroactivité grille centralisée §05 R2.8 (renvoi depuis E5/E6/EC11/D7/D8)
  - **D1** Enum `statut_financier` réduit de 9 à 3 valeurs : `calcule`, `ajuste`, `cout_manquant` → puis **2 valeurs** revue sobriété §05 2026-05-01 D2 (`cout_manquant` retiré, cas impossible par construction)
  - **D2** Statut grille réduit de 4 valeurs persistées à 2 (`actif`, `archive`) + vue dérivée `vue_grilles_etat_courant`
- **Propagations à effectuer (suite revue 2026-04-30)** : §03 M07, §04 (enum `statut_financier` 3 valeurs, suppression colonne `validation_admin_requise`, `cout_final_ht` non GENERATED, `cout_final_verrouille` boolean unique, contrainte `EXCLUDE USING gist` grilles, vue `vue_grilles_etat_courant`, `parametres_tms` suppression `m07.seuil_validation_ajustement_pourcent` + `m07.alerte_expiration_grille_jours`), §05 (R2.7 seuil 3h centralisé, R2.8 anti-rétroactivité unique, R2.9 supprimée), §08 S6 (retries 1h/24h), §09 (suppression policies E8 + état ajuste_en_validation), M11 catalogue (suppression codes `m07_grille_expiration_imminente` + `m07_ajustement_manuel_seuil_depasse` + `m07_formule_non_implementee`), M08 (référence `cout_final_verrouille` boolean unique).

# M10 — Gestion exutoires Veolia

**Persona principal** : Ops Savr (consultation + saisie quotidienne / hebdomadaire). Admin TMS (paramétrage capacité + seuils).
**Priorité** : Cœur métier (V1).
**Dépendances** : M04 (clôture tournée ZD → auto-incrémentation pleins), M11 (alertes catalogue + dashboard), M13 (paramétrage `parametres_tms.m10`).

---

## 1. Objectif métier

Suivre en temps quasi-réel le stock de bacs (pleins / vides disponibles) à l'**entrepôt Savr central** et piloter les passages Veolia (planning + déclarations terrain) pour éviter le **débordement entrepôt**.

Remplace le suivi actuel par caméra de vidéosurveillance (fiabilité humaine) + déclenchements manuels par téléphone / interface web Veolia non tracés.

**Bénéfices V1** :
- Visibilité 24/7 sur saturation entrepôt (dashboard + alertes)
- Trace toutes les saisies passages Veolia → historique exploitable (pilotage V2)
- Empêche les ruptures de bacs vides en sortie tournée (seuil `quantite_vide_cible`)
- Signal qualité saisie chauffeur via écarts auto-incrémentation vs recomptage Ops

**Hors scope V1** :
- Coûts exutoires Veolia (saisie facturation reportée — voir D6)
- API Veolia (pas de doc → V2)
- BSD Trackdéchets (M16 V2)
- Multi-prestataires exutoires (Veolia hardcodé V1, refacto V2 si nouveau prestataire — voir D1)
- SMS / email automatique vers Veolia pour déclenchement (action manuelle Ops dans interface web Veolia V1)
- Confirmation atomique chauffeur de l'effectivité du passage (revue sobriété 2026-04-30 A1 — Ops vérifie vidéo avant déclaration `realise`, pas de modal M05)

### Plan de consolidation stocks bacs entrepôt migration MTS-1 (propagation §13 2026-04-27)

**Contexte** : décision §13 D4 (A5=c) — stocks initiaux estimés Ops Savr sans inventaire physique. Conséquence : `stocks_bacs_entrepot` faux à J0, alertes `m10_seuil_atteint` parasites possibles 1-2 premières semaines.

**Plan de rectification progressive** (cf. [[13 - Migration MTS-1#13.6 Plan de consolidation stocks (semaines 1-4)]]) :

| Date | Action | Owner | Outil |
|---|---|---|---|
| J-7 → J0 | Estimation initiale stocks bacs entrepôt par couple `(flux, type_contenant)` | Ops Savr | M13 E2 / `stocks_bacs_entrepot` (acteur `migration`) |
| J+7 | Recompte entrepôt forcé | Ops Savr | E3 recompte (workflow standard M10) |
| J+15 | Recompte entrepôt forcé (stabilisation) | Ops Savr | E3 recompte |
| J+30 | Recompte entrepôt final post-mois | Ops Savr | E3 recompte |

Pendant la fenêtre J0 → J+30, alertes M10 émises avec `contexte = 'migration_test'` (cf. §04 addendum §13). Auto-résolues à J+30 via cron `m13_cleanup_legacy` si critical (R_§13.8). Les warnings restent actives, à traiter normalement par Ops.

---

## 2. Personas et contexte d'usage

### Ops Savr (utilisateur principal)
- **Bureau** (PC) — pas de saisie terrain dans M10. L'agent entrepôt qui recompte fait remonter à Ops par message interne.
- **Fréquence consultation** : 1×/jour (jauges sur dashboard Ops global)
- **Fréquence saisie** : 1-3 saisies passages / semaine + recomptages ponctuels (1×/semaine)
- **Contexte** : matin tôt (7h) supervision saturation + planning Veolia avant lancement journée dispatch (M02). **Process V2 sobre** : Ops vérifie via vidéosurveillance que les bacs ont été vidés AVANT de déclarer le passage `realise`. La déclaration vaut confirmation effective (process humain pré-saisie, pas système).

### Admin TMS
- **Bureau** (PC) — onboarding TMS + ajustements ponctuels
- **Fréquence** : paramétrage initial puis ~1×/trimestre (ajustement seuils suite retour terrain)

### Agent entrepôt (acteur indirect)
- Pas d'utilisateur TMS V1. Recompte physiquement les bacs et fait remonter à Ops Savr (téléphone, message interne).
- V1.5 candidat : compte direct Ops Savr délégué à l'agent entrepôt avec accès limité à l'écran recomptage (E7).

---

## 3. Architecture des écrans

| # | Écran | Persona | Type | Localisation |
|---|-------|---------|------|--------------|
| E1 | Page exutoires (dashboard dédié) | Ops + Admin | Page principale | `/exutoires` |
| E2 | Tableau stock bacs (détail par flux × type_contenant) | Ops + Admin | Onglet E1 | `/exutoires#stock` |
| E3 | Planning passages Veolia (calendrier + liste) | Ops + Admin | Onglet E1 | `/exutoires#passages` |
| E4 | Modal création passage prévu | Ops + Admin | Modal | `/exutoires#passages?action=create` |
| E5 | Modal déclaration passage réalisé (= reset stock direct) | Ops + Admin | Modal | `/exutoires#passages?id={id}&action=realiser` |
| E6 | Modal "Déclencher collecte Veolia" (passage exceptionnel) | Ops + Admin | Modal | `/exutoires#passages?action=declencher` |
| E7 | Modal recomptage manuel stock | Ops + Admin | Modal | `/exutoires#stock?action=recompter` |
| E8 | Tuiles-jauges sur dashboard Ops global (intégration M02) | Ops | Widget | `/dispatch` (haut de page) |

> **Suppression revue sobriété 2026-04-30 A2** : ancien E5b (modal "confirmation effective" Ops vidéo) retiré — la déclaration E5 vaut confirmation effective (Ops vérifie vidéo AVANT saisie, pas après).

**Navigation** :
- E1 = page racine, 2 onglets (Stock / Passages) + bouton flottant "Déclencher collecte" (E6)
- Tuiles E8 sur dashboard Ops global → click sur tuile → drill-down vers E2 ou E3 selon contexte

---

## 4. Écran par écran

### E1 — Page exutoires (`/exutoires`)

**Layout** :
- Header : titre "Exutoires Veolia" + bouton primaire "Déclencher collecte Veolia" (ouvre E6) + bouton secondaire "Saisir passage prévu" (ouvre E4)
- 2 onglets : `Stock entrepôt` (E2 par défaut) | `Passages Veolia` (E3)

**Données** : aucune en propre (conteneur). Les onglets chargent leur propre payload.

**RLS appliquée** : accès `roles && ARRAY['admin_tms','ops_savr']`. Manager prestataire et chauffeur → 403.

### E2 — Tableau stock bacs (onglet E1)

**Layout** :
- Filtre haut : `flux` (multi-select : biodéchet / déchet résiduel / verre / emballage / carton / tous) + `type_contenant_id` (multi-select dynamique)
- Tableau (1 ligne par couple `flux × type_contenant`) :

| Colonne | Source | Format |
|---------|--------|--------|
| Flux | `stocks_bacs_entrepot.flux` | Badge couleur par flux |
| Type contenant | `types_contenants.libelle` | Texte (ex: "Bac 240L biodéchet") |
| Pleins | `quantite_pleine` | Entier (tooltip "Dernier recomptage : il y a 3j" si recomptage récent) |
| Vides dispo | `quantite_vide_disponible` | Entier |
| Capacité max | `capacite_max` | Entier |
| **Jauge saturation** | `quantite_pleine / capacite_max × 100` | Barre horizontale colorée + marker visuel sur seuil_saturation_pleins (vert <50%, jaune 50-84%, orange 85-99%, rouge ≥100%) — tooltip "Alerte si > X bacs pleins" sur le marker |
| Statut | calculé | Badge "OK" / "À surveiller" / "Saturation" / "Dépassement" |
| Dernière maj | `derniere_maj_at` | "il y a 2h" |

> **Simplifications revue sobriété 2026-04-30** :
> - **B5** : suppression colonne dédiée "Pleins (recomptés)" — 1 seule colonne `Pleins` (la valeur courante reflète déjà le dernier recomptage). Historique accessible via `recomptages_stocks_entrepot_log`. Champ DB `quantite_pleine_recomptee` peut être calculé à la demande plutôt que persisté (cf. §04 propagation).
> - **C2** : suppression colonne dédiée "Seuil saturation" — info reportée sur la jauge (marker visuel + tooltip).

**Tri par défaut** : `(quantite_pleine / capacite_max) DESC` — les plus saturés en haut.

**Actions** : bouton "Recompter" par ligne (ouvre E7 pré-rempli sur le couple `flux × type_contenant`).

**Performance** : pagination 50 lignes max. Volume V1 attendu : ~10-20 lignes (5 flux × 3-4 types contenant).

**RLS** : `stocks_bacs_entrepot` lecture pour Ops Savr / Admin TMS uniquement.

### E3 — Planning passages Veolia (onglet E1)

**Layout** :
- Filtre haut : `flux` + `statut` (multi-select : planifie / realise / annule) + période (date début → date fin, défaut 30j passés + 30j à venir)
- Vue calendrier (mensuel, lecture seule) — 1 case par jour avec mini-badges des passages prévus/réalisés/annulés
- Vue liste (par défaut) — table chronologique

| Colonne | Source | Format |
|---------|--------|--------|
| Date prévue | `passages_veolia.date_prevue` | "ven 2026-04-26" |
| Flux | `flux` | Badge couleur |
| Type contenant | `types_contenants.libelle` (si renseigné) | Texte |
| Statut | `statut` | Badge couleur (planifie=gris, realise=vert, annule=rouge) |
| Motif (si annulé) | `motif_annulation` | Badge "Annulation" / "Report" + tooltip motif libre |
| Bacs enlevés | `nb_bacs_enleves` (post-passage) | Entier (vide si pré-passage) |
| Source | `cree_par_action` (D5) | Badge "Saisie manuelle" / "Bouton déclencher" |
| Saisi par | `saisi_par_user_id → users_tms.email` | Texte |
| Actions | dépend du statut | Boutons (cf. ci-dessous) |

> **Simplifications revue sobriété 2026-04-30** :
> - **D1** : enum `statut` réduit de 5 → 3 valeurs (`planifie / realise / annule`). Statut `confirme` (B1) et `reporte` (B2) supprimés. Le report = `annule` avec `motif_annulation = 'report'` + Ops crée explicitement le nouveau passage `planifie`.
> - **B4** : suppression colonne "Bacs prévus" pré-passage (snapshot non utile, Ops voit le stock courant en E2).

**Actions par statut** :
- `planifie` → "Marquer comme réalisé" (ouvre E5) | "Annuler / Reporter" (prompt motif + flag `motif_annulation`)
- `realise` → "Voir détails" (modal lecture seule)
- `annule` → "Voir détails" (lecture seule). Si `motif_annulation = 'report'` → bouton "Créer nouveau passage" pré-rempli avec flux et type_contenant.

**Tri par défaut** : `date_prevue DESC` (récents en haut).

**Performance** : pagination 50 lignes, default fenêtre 30j passés + 30j futurs. Historique > 60j accessible via filtre date élargi.

### E4 — Modal création passage prévu

Saisie manuelle Ops Savr du planning Veolia (pas d'import CSV V1, voir D4).

**Champs** :
- `date_prevue` (date picker, obligatoire — **aucune contrainte de date** (arbitrage 2026-06-07 F1) : date passée acceptée → bascule a posteriori, date du jour acceptée → passage `planifie` normal)
- `flux` (select unique parmi 5 enum)
- `type_contenant_id` (select dynamique filtré sur `flux`, nullable si Veolia ne précise pas)
- `commentaire` (textarea libre)

**Bouton** "Créer le passage" → INSERT `passages_veolia` statut `planifie` + `cree_par_action = 'saisie_manuelle'` + `saisi_par_user_id = current_user`.

**Validation** :
- Si `date_prevue < aujourd'hui` (strictement — arbitrage 2026-06-07 F1) → bascule sur fonction "création a posteriori" → INSERT direct statut `realise` avec impact stock immédiat (cf. EC6 v3 + R5.8 v3). `date_prevue = aujourd'hui` → INSERT `planifie` normal (Ops déclarera via E5).
- Flux + type_contenant cohérents (si type_contenant renseigné)

### E5 — Modal déclaration passage réalisé (= reset stock direct)

> **Refonte v3 (revue sobriété 2026-04-30 A2)** : suppression de la dualité déclaration/confirmation effective. La déclaration `realise` par Ops Savr **vaut confirmation effective** et déclenche le reset total stock immédiatement. Process humain : Ops vérifie via vidéosurveillance que les bacs ont été vidés **avant** de cliquer "Marquer réalisé". Si Ops déclare à tort → correction via E7 recomptage (motif "Correction passage erroné").

**Acteur** : Ops Savr (depuis E3, action "Marquer comme réalisé") ou Admin TMS.

**Champs** :
- `date_realise_at` → écrit **tel quel** en `passages_veolia.statut_realise_at` (datetime picker, obligatoire, ≤ now() — peut être antérieur au jour de déclaration, ex. passage de la veille — arbitrage 2026-06-07 F2)
- `nb_bacs_enleves` (entier, obligatoire, ≥ 0)
- `type_contenant_id` (pré-rempli si renseigné en E4, modifiable, obligatoire)
- `poids_total_kg` (numeric, optionnel — Veolia ne le communique pas systématiquement)
- `bsd_numero` (text, optionnel — V2 BSD Trackdéchets)
- `bsd_url` (file uploader PDF, optionnel)
- `commentaire` (textarea)
- Checkbox obligatoire "J'ai vérifié via vidéosurveillance que les bacs ont été vidés" (audit inline — valeur tracée en `verification_video_at` colonne timestamp set à `now()` quand cochée)

**Bouton** "Déclarer passage réalisé" → appelle fonction SQL `tms.m10_declarer_passage_realise(...)` :
- UPDATE `passages_veolia` SET `statut = 'realise'`, `statut_realise_at = date_realise_at` (**valeur saisie**, pas now() — arbitrage 2026-06-07 F2), `nb_bacs_enleves = ...`, `verification_video_at = now()`, `saisi_par_user_id = current_user` WHERE id = passage_id
- Trigger DB `trg_m10_reset_total_pleins` se déclenche immédiatement (cf. R5.4 v3) :
  - `quantite_pleine` du couple `(flux, type_contenant_id)` du passage = 0 (reset total)
  - `quantite_vide_disponible` += `quantite_pleine_avant_reset` (les bacs vidés reviennent dans le stock vides)
  - `derniere_maj_at` = now()
- Résolution auto alertes M11 ouvertes pour ce flux/couple : `m10_bac_satur`, `m10_passage_non_confirme`

**Cohérence (validation pré-déclaration)** :
- Bloquant V1 si `nb_bacs_enleves > quantite_pleine` (cf. EC12) — Ops doit recompter via E7 avant de pouvoir déclarer.
- Warning informatif si `nb_bacs_enleves < quantite_pleine` (cas partiel EC7 v3 — Veolia vide tout en pratique, écart implique recomptage post).

> **Note revue sobriété 2026-04-30 A2** : ancien E5b (modal confirmation Ops vidéo après déclaration) supprimé. La case à cocher vidéo intégrée à E5 remplace le second flux applicatif. Plus de cron escalade J+1/J+3/J+7, plus de lock optimiste 3-source, plus d'auto-confirmation J+7.

### E6 — Modal "Déclencher collecte Veolia"

Bouton accessible depuis :
- Header E1 (action principale)
- Tuile-jauge E8 si saturation atteinte (CTA "Déclencher")

**Comportement** :
- Affiche infos contextuelles à copier-coller dans interface web Veolia : flux à enlever, nb bacs pleins courant, contact Veolia (paramétré `parametres_tms.m10.contact_veolia`), zone entrepôt
- Champ `date_prevue` (date picker, défaut J+1)
- Champ `flux` (select)
- Champ `commentaire` (textarea, ex: "Saturation biodéchet 95%, urgence")
- Bouton "Confirmer le déclenchement" → INSERT `passages_veolia` statut `planifie` + `cree_par_action = 'bouton_declencher'`

**Note importante** : ce bouton **n'envoie rien** à Veolia (pas d'API V1). L'Ops doit ensuite **manuellement** déclencher via l'interface web Veolia ou le téléphone. Le passage TMS sert de **trace**.

### E7 — Modal recomptage manuel stock

Permet à Ops Savr (ou à terme agent entrepôt délégué V1.5) de **corriger** le stock bacs pleins / vides après comptage physique.

**Champs** :
- `flux` + `type_contenant_id` (pré-rempli si lancé depuis E2)
- `quantite_pleine_recomptee` (entier ≥ 0) — affiche en regard `quantite_pleine` actuelle (estimation auto)
- `quantite_vide_disponible_recomptee` (entier ≥ 0) — affiche en regard `quantite_vide_disponible` actuelle
- `motif` (textarea obligatoire si écart ≥ 5 bacs ou ≥ 20% sur l'un des deux)

**Bouton** "Valider recomptage" :
- INSERT `recomptages_stocks_entrepot_log` avec valeurs avant/après + écarts + motif + user_id (append-only)
- UPDATE `stocks_bacs_entrepot` :
  - `quantite_pleine` = `quantite_pleine_recomptee`
  - `quantite_vide_disponible` = `quantite_vide_disponible_recomptee`
  - `derniere_maj_at` = now()
  - `derniere_maj_par_user_id` = current_user
- Si écart absolu (pleins) ≥ 5 OU écart relatif ≥ 20% → INSERT `tms.audit_logs` action `M10_RECOMPTAGE_ECART` avec context `{ancien, nouveau, delta, motif}` (Bloc 3 sobriété 2026-04-25 A1)

**Note D3** : malgré le recomptage, les **alertes saturation R5.3 continuent à se baser sur la valeur estimée auto** (`quantite_pleine` post-recomptage = la nouvelle référence, mais les triggers M04 continuent à incrémenter automatiquement à partir de cette nouvelle valeur). Le recomptage **réinitialise** la base d'estimation.

### E8 — Tuiles-jauges dashboard Ops global (intégration M02)

**Localisation** : haut de page `/dispatch` (dashboard Ops principal M02), juste sous les tuiles KPI dispatch.

**Layout** :
- Section "Exutoires" repliable (collapse/expand persisté en cookie utilisateur)
- 1 jauge horizontale par couple `flux × type_contenant` actif (où `capacite_max > 0`)
- Layout : grille 2 colonnes desktop, 1 colonne mobile (mais Ops = bureau V1, peu prioritaire mobile)
- Chaque jauge :
  - Libellé : "Verre 240L : 15/20 (75%)" — format `{flux} {type_contenant} : {pleins}/{capacite_max} ({%})`
  - Couleur barre selon palier saturation (E2)
  - Click → drill-down `/exutoires#stock?flux={flux}&type_contenant_id={id}`
- Bandeau alerte intégré : si ≥ 1 alerte M10 ouverte → bandeau rouge "X passages Veolia à confirmer" + CTA "Voir" → `/exutoires#passages?statut=planifie`

**Performance** : payload léger (10-20 lignes), polling 30s aligné avec dashboard alertes M11.

**Sécurité** : visible uniquement Ops Savr / Admin TMS. Cachée pour Manager prestataire / Chauffeur.

---

## 5. Workflows détaillés

### W1 — Auto-incrémentation `quantite_pleine` à clôture tournée ZD

**Déclencheur** : trigger DB `AFTER UPDATE` sur `tournees` quand `statut` passe à `terminee` (transition `OLD.statut <> 'terminee' AND NEW.statut = 'terminee'`). La fonction filtre en interne les pesées rattachées à des collectes `type_flux IN ('biodechet','verre','dechet_residuel','emballage','carton')` (5 flux ZD) — si la tournée n'a aucune pesée ZD (cas tournée AG pure), la fonction n'effectue aucune mutation stock.

**Étapes** :
1. Pour chaque pesée brute (`pesees_brutes`) rattachée aux collectes de la tournée :
   - Identifier `flux` + `type_contenant_id` de la pesée
   - Calculer `nb_bacs_pleins` retournés à l'entrepôt (count des pesées du couple flux × type_contenant)
2. UPDATE `stocks_bacs_entrepot` :
   - `quantite_pleine` += `nb_bacs_pleins`
   - `quantite_vide_disponible` = `GREATEST(0, quantite_vide_disponible - nb_bacs_pleins)` (les vides sortis de l'entrepôt deviennent les pleins en retour). **Si le décrément aurait rendu la valeur négative** (chauffeur retourne plus de bacs que sortis, cf. EC14) → clamp à 0 + émettre `m10_stock_incoherence` (warning) — arbitrage 2026-06-07 F4
   - `derniere_maj_at` = now()
   - `derniere_maj_par_user_id` = NULL (auto)
3. Vérifier seuils :
   - Si `quantite_pleine > seuil_saturation_pleins` → émettre `tms.alerte_emit('m10_bac_satur', criticite='critical', ...)` (M11)
   - Si `quantite_pleine / capacite_max ≥ 0.85` ET `≤ seuil_saturation_pleins` → émettre `m10_bac_satur` criticité `warning` — **fusion B3 revue sobriété 2026-04-30** : un seul code d'alerte avec criticité paramétrée par règle scope `alertes_catalogue` (warning à 85%, critical au-delà du seuil absolu ou ≥100%)
   - Si `quantite_vide_disponible < quantite_vide_cible` → émettre `m10_bacs_vides_sous_seuil` (warning)

**Idempotence** : trigger flagué par `tournees.stock_entrepot_update_at` (timestamp dernière propagation, colonne ajoutée à `tournees` via addendum M10 §04 2026-04-25). La fonction vérifie `IF NEW.stock_entrepot_update_at IS NOT NULL THEN RETURN NEW; END IF;` au démarrage. À la fin, écrit `UPDATE tournees SET stock_entrepot_update_at = now() WHERE id = NEW.id` pour figer la propagation. Évite double incrément si tournée repasse par `terminee` (cas réouverture/clôture multiple).

**Fallback dégradé** : si `pesees_brutes` est vide pour une collecte (cas R_M05.18 présomption 0kg) → aucun mouvement stock (la collecte n'a pas effectivement collecté).

**Trace** : pas d'INSERT dans `recomptages_stocks_entrepot_log` (réservé aux corrections manuelles humaines).

### W2 — Saisie manuelle planning Veolia (E4)

**Acteur** : Ops Savr.

**Étapes** :
1. Ops reçoit le planning Veolia (email mensuel, téléphone)
2. Ops ouvre `/exutoires#passages` → bouton "Saisir passage prévu" → E4
3. Saisit date / flux / type_contenant (optionnel)
4. INSERT `passages_veolia` statut `planifie`, `cree_par_action = 'saisie_manuelle'`
5. Pas d'alerte M11 émise (création normale, pas un événement à signaler)

**Périodicité** : ad hoc, ~1-3×/semaine.

### W3 — Déclaration passage réalisé (E5) — déclenche reset stock immédiat

**Acteur** : Ops Savr (ou agent entrepôt délégué V1.5).

**Déclencheur** : Veolia est venu enlever des bacs. Ops vérifie via vidéosurveillance, puis déclare le passage.

> **Refonte v3 (revue sobriété 2026-04-30 A2)** : la déclaration `realise` par Ops vaut confirmation effective et déclenche immédiatement le reset total stock (R5.4 v3). Plus de second flux confirmation. Plus de cron escalade. La case "J'ai vérifié vidéo" est un audit simple inline.

**Étapes** :
1. Ops ouvre E3 → click "Marquer comme réalisé" sur ligne `planifie`
2. E5 modal : saisie `date_realise_at`, `nb_bacs_enleves`, `type_contenant_id` (si pas pré-rempli), checkbox "Vérifié vidéo" (obligatoire), optionnels (`poids_total_kg`, `bsd_numero`, `bsd_url`, commentaire)
3. Validations bloquantes : `nb_bacs_enleves ≤ quantite_pleine` (sinon erreur EC12 — recomptage requis avant)
4. Appel `tms.m10_declarer_passage_realise(passage_id, date_realise_at, nb_bacs_enleves, type_contenant_id, ...)` :
   - UPDATE `passages_veolia` SET `statut = 'realise'`, `statut_realise_at = date_realise_at` saisi (F2 2026-06-07), `nb_bacs_enleves`, `verification_video_at = now()`, `saisi_par_user_id`
   - Trigger `trg_m10_reset_total_pleins` :
     - `quantite_pleine` du couple `(flux, type_contenant_id)` = 0
     - `quantite_vide_disponible` += `quantite_pleine_avant_reset`
     - `derniere_maj_at` = now()
5. Résolution auto alertes M11 ouvertes : `m10_bac_satur`, `m10_passage_non_confirme`

**Cas partiel (EC7 v3)** : si `nb_bacs_enleves` < `quantite_pleine` estimée → warning informatif uniquement. Reset total appliqué (R5.4 v3 — présomption "Veolia vide tout"). Si écart suspect → recomptage Ops E7 conseillé après.

### W4 — Déclencher collecte Veolia exceptionnelle (E6)

**Acteur** : Ops Savr (en cas de saturation imprévue ou anticipation).

**Étapes** :
1. Ops voit jauge rouge sur dashboard Ops global E8 ou tableau E2
2. Click "Déclencher collecte Veolia" → E6
3. Saisit date / flux + commentaire
4. INSERT `passages_veolia` statut `planifie`, `cree_par_action = 'bouton_declencher'`
5. **Action manuelle Ops post-clic** : copier-coller infos affichées E6 dans interface web Veolia OU téléphone Veolia
6. Pas de notification automatique vers Veolia (pas d'API V1)

**Trace** : `cree_par_action = 'bouton_declencher'` permet de filtrer E3 sur "passages déclenchés par bouton" (suivi qualité dispatch exutoire).

### W5 — Recomptage manuel stock (E7)

**Acteur** : Ops Savr.

**Déclencheur** : agent entrepôt fait remonter un comptage physique (généralement 1×/semaine ou suite à anomalie : bac perdu, bac contaminé, écart visible).

**Étapes** :
1. Ops ouvre `/exutoires#stock` → bouton "Recompter" sur ligne concernée → E7
2. Saisit `quantite_pleine_recomptee` + `quantite_vide_disponible_recomptee` + motif (si écart significatif)
3. INSERT `recomptages_stocks_entrepot_log` (append-only)
4. UPDATE `stocks_bacs_entrepot` valeurs corrigées
5. Si écart absolu pleins ≥ 5 OU écart relatif ≥ 20% → INSERT `tms.audit_logs` action `M10_RECOMPTAGE_ECART`
6. Si recomptage corrige une saturation perçue (ex: jauge à 100% ramenée à 70%) → résolution auto alertes `m10_bac_satur` ouvertes pour ce couple

### W6 — Alerte saturation R5.3 (trigger DB temps réel)

**Déclencheur** : trigger DB AFTER UPDATE sur `stocks_bacs_entrepot.quantite_pleine`.

**Étapes** :
1. Si `NEW.quantite_pleine > seuil_saturation_pleins` ET (`OLD.quantite_pleine ≤ seuil_saturation_pleins` OU pas d'alerte `m10_bac_satur` critical ouverte) → émet `m10_bac_satur` criticité `critical` (M11)
2. Si `NEW.quantite_pleine / capacite_max ≥ 0.85` ET `< 1.0` ET `NEW.quantite_pleine ≤ seuil_saturation_pleins` ET pas d'alerte `m10_bac_satur` ouverte → émet `m10_bac_satur` criticité `warning`
3. Debounce 5 min M11 standard évite re-flood si fluctuations rapides

> **Fusion revue sobriété 2026-04-30 B3** : un seul code `m10_bac_satur` au lieu de 2 (ancien `m10_bac_remplissage_85` warning fusionné). Criticité dynamique gérée par règle scope dans `alertes_catalogue`.

**Auto-résolution** : W3 (déclaration `realise`) appelle `alerte_resoudre_auto`.

### W7 — Alerte passage non confirmé (cron horaire)

**Déclencheur** : `pg_cron` job toutes les heures.

**Étapes** :
1. Pour `statut = 'planifie'` AND `date_prevue - now() <= '24h'::interval` AND `date_prevue >= now()::date - '1 day'::interval` → émettre `m10_passage_non_confirme` criticité `warning` (M11) avec entity_id = passage.id (couvre J-1 anticipation + J+1 retard de déclaration)
2. Pour `statut = 'planifie'` AND `date_prevue < now()::date - '1 day'::interval` (passage prévu il y a > 1 jour non déclaré) → émettre `m10_passage_non_confirme` criticité `critical` + email Resend
3. Idempotence M11 : debounce 5 min standard (cron horaire, peu de risque)

> **Fusion revue sobriété 2026-04-30 C1** : ancien W12 (cron quotidien escalade gradient J+1/J+3/J+7) supprimé. Anciens `m10_passage_realise_non_confirme_j1`/`_j3`/`m10_passage_auto_confirmee_j7` supprimés (corollaires A2/A3/A4). W7 unique gère le passage non déclaré avec criticité dynamique.

**Auto-résolution** : passage passé à `realise` ou `annule` → résolution auto.

### W8 — Alerte annulation / report (immédiate)

**Déclencheur** : trigger DB AFTER UPDATE sur `passages_veolia.statut` quand `OLD.statut = 'planifie'` AND `NEW.statut = 'annule'`.

**Étapes** :
1. Si `NEW.motif_annulation = 'report'` → émet `m10_passage_reporte` (warning M11) avec context `{ancienne_date, flux, motif_libre}`
2. Si `NEW.motif_annulation IN ('annulation','autre')` → émet `m10_passage_annule` (warning M11)
3. Si `quantite_pleine` du flux > seuil_saturation au moment de l'annulation/report → escalade en `critical` (override depuis `alertes_catalogue` règle scope)

### W9 — Réapprovisionnement bacs vides (information uniquement V1)

**V1 minimal** : pas de workflow dédié de commande fournisseur. Ops Savr commande à part (process hors TMS).

Quand commande livrée → Ops Savr utilise E7 recomptage manuel pour augmenter `quantite_vide_disponible` avec motif "Réception commande fournisseur" (motif normalisé en select V1.5).

**V2 candidat** : module dédié commandes fournisseur bacs.

### W10 — Annulation / report passage avant déclaration `realise`

**Déclencheur** : Ops change statut `planifie` → `annule` (avec `motif_annulation` obligatoire : `annulation` | `report` | `autre` + textarea motif libre).

**Étapes** :
1. UPDATE `passages_veolia.statut = 'annule'`, `motif_annulation`, `motif_annulation_libre`
2. Pas de modification stock entrepôt (le passage n'a jamais eu lieu, donc rien à reverser)
3. Émet alerte M11 via W8 (cf. W8)
4. Si saturation atteinte au moment de l'annulation → `m10_bac_satur` reste ouverte (pas d'auto-résolution)
5. Si `motif_annulation = 'report'` → bouton UI "Créer nouveau passage" pré-rempli avec flux et type_contenant, lien optionnel `passage_origine_id` (FK self) sur le nouveau passage

**Cas spécial annulation après `realise`** : interdit V1 (cf. R5.7 v3 + trigger anti-déconfirmation simplifié). Si erreur de saisie sur `realise`, correction via E7 recomptage manuel uniquement.

> **Simplification revue sobriété 2026-04-30 B2** : ancien statut `reporte` supprimé. Le report = `annule` avec `motif_annulation = 'report'`. Si Ops veut tracer le nouveau passage, il le crée explicitement via E4. Pas de création automatique liée par DB.

> **Suppression revue sobriété 2026-04-30 A1/A2/A3/A4** : workflows W11.a/b/c (confirmation chauffeur + Ops vidéo + auto J+7) et W12 (cron escalade gradient J+1/J+3/J+7) entièrement supprimés. Le reset stock se fait dans W3 directement à la déclaration `realise`. Plus de fonction `m10_confirmer_passage_chauffeur`/`_ops`, plus de cron `m10_escalade_non_confirme`, plus de paramètres `m10_delai_*`.

---

## 6. Règles métier appliquées

Renvois textuels (pas de duplication, source §05 Règles métier TMS) :

- **R5.1** — Alerte passage Veolia non confirmé (J-1 anticipation, J+1 retard, > 1j critical) avec criticité dynamique → W7
- **R5.2** — Alerte annulation / report passage → W8
- **R5.3** — Alerte saturation entrepôt (reformulée 2026-04-25 : seuil **absolu en bacs pleins** par couple `flux × type_contenant`, plus de seuil global ni de seuil en %) — fusion criticité dynamique B3 (warning à 85%, critical au-delà du seuil ou ≥100%) → W6
- **R5.4 v3** (refonte 2026-04-30) — **Reset total** stock pleins du flux à la **déclaration `realise`** par Ops Savr. Plus de second axe `confirme_at`. Trigger DB `trg_m10_reset_total_pleins` sur transition `statut` `planifie` → `realise`. Process humain : Ops vérifie vidéo avant déclaration (case à cocher `verification_video_at` audit simple inline) → W3
- **R5.5** — Auto-incrémentation `quantite_pleine` à clôture tournée ZD (transition `terminee`, filtrée sur `collectes_tms.type_flux` ZD) → W1
- **R5.6** (révisée Bloc 3 sobriété 2026-04-25 A1) — Recomptage manuel Ops trace écarts dans `tms.audit_logs` action `M10_RECOMPTAGE_ECART` si écart absolu pleins ≥ 5 OU relatif ≥ 20% → W5
- **R5.7 v3** — Toute transition depuis un état terminal interdite V1 (RAISE EXCEPTION trigger `trg_m10_anti_deconfirmation` **étendu aux 2 états terminaux — arbitrage 2026-06-07 F3** : `OLD.statut IN ('realise','annule') AND NEW.statut <> OLD.statut` interdit). Correction via E7 recomptage uniquement → W10 + EC5 v3
- **R5.8 v3** — Création passage a posteriori autorisée (E4 avec `date_prevue < now()` → INSERT direct statut `realise` + reset stock immédiat via fonction `tms.m10_creer_passage_a_posteriori` simplifiée — un seul appel atomique, plus de logique 3-source) → EC6 v3

> **Suppressions revue sobriété 2026-04-30** :
> - Ancienne **R5.4 v2** (reset à confirmation effective avec 3 sources) → remplacée par R5.4 v3
> - Ancienne **R5.4 bis** (3 sources mutuellement exclusives) → supprimée (corollaire A1/A2/A3)
> - Ancienne **R5.9** (distinction déclaration vs confirmation) → supprimée (corollaire A2)
> - Ancienne **R5.10** (cron escalade gradient J+1/J+3/J+7) → supprimée (corollaire A3/A4)

---

## 7. Edge cases

| # | Cas | Comportement V1 |
|---|-----|------------------|
| EC1 | 1 bac partagé multi-flux (biodéchet → carton après nettoyage) | **Interdit V1**. 1 ligne `stocks_bacs_entrepot` = 1 (`flux`, `type_contenant_id`) figé. Réaffectation = retrait manuel d'un côté + ajout de l'autre via E7 (motif "Réaffectation flux"). Traçabilité contamination flux préservée. |
| EC2 | Dépassement physique (`pleins > capacite_max`) | Jauge plafonne à 100% visuellement + badge "Dépassement" rouge. Émet `m10_bac_satur` critical. Pas d'erreur bloquante (la réalité physique peut dépasser le paramétrage). |
| EC3 | Recomptage Ops < estimation auto (chauffeur surdéclaré bac retour) | INSERT `recomptages_stocks_entrepot_log` + INSERT `tms.audit_logs` action `M10_RECOMPTAGE_ECART` + commentaire obligatoire si écart ≥ 5 bacs ou ≥ 20%. Signal qualité saisie chauffeur exploitable via export Supabase Studio à la demande. |
| EC4 | Recomptage Ops > estimation auto (bac entré non tracé : retour fournisseur, oubli pesée) | Idem EC3. Motif normalisé V1.5 ("Réception commande", "Pesée chauffeur manquante", "Recompte routinier", "Anomalie"). |
| EC5 v3 | Passage `realise` annulé OU déconfirmé après déclaration | **Interdit V1** au niveau DB (RAISE EXCEPTION trigger `trg_m10_anti_deconfirmation` simplifié sur transition `realise → annule` ou `realise → planifie`). Correction via recomptage manuel E7 uniquement (motif "Correction passage erroné"). |
| EC6 v3 | Passage non prévu mais réalisé (Veolia exceptionnel sans prévenir) | E4 avec `date_prevue < now()::date` (strictement — arbitrage 2026-06-07 F1, `= aujourd'hui` → `planifie` normal) → bascule sur fonction atomique `tms.m10_creer_passage_a_posteriori` qui pose statut `realise` + reset stock + `verification_video_at` directement. `cree_par_action = 'saisie_manuelle'`. |
| EC7 v3 | Veolia n'enlève qu'une partie des pleins (10 sur 15 estimés) | R5.4 v3 = reset TOTAL des bacs pleins du couple à déclaration. Le `nb_bacs_enleves` saisi est tracé pour audit / facturation V2 mais n'impacte plus le stock. Si écart suspect (Ops constate vidéo bacs résiduels) → ne pas déclarer `realise` (rester `planifie`) OU déclarer puis recomptage E7 immédiat. La présomption métier V1 = "Veolia vide tout ou rien". |
| EC8 | Type contenant déprécié (`types_contenants.statut = 'archive'`) | `passages_veolia` historiques préservés (FK `ON DELETE RESTRICT`). Plus de nouveaux INSERT possibles via E4/E5 (UI filtre out les types archivés). |
| EC9 | Capacité max diminuée par Admin (ex: réorganisation entrepôt, 30→20 bacs verre) | Si `quantite_pleine` actuelle > nouveau `capacite_max` → trigger DB émet `m10_capacite_max_diminuee_satur` (warning) + jauge passe immédiatement en dépassement. Admin alerté, action recomptage ou déclencher Veolia. |
| EC10 | Suppression d'un type contenant utilisé par stocks | Interdit (FK RESTRICT). UI Admin TMS bloque l'archivage si stocks > 0 ou passages historiques. |
| EC12 | `nb_bacs_enleves > quantite_pleine` (Veolia surdéclare ou Ops mal saisit) | Bloquant V1 : E5 affiche erreur "Impossible : ne peut pas enlever plus que présent". Demande recomptage E7 avant validation. |
| EC13 | Passage planifié pour flux X, Veolia enlève flux Y | Edge case rare. Ops crée 2 passages : annule planifié X (motif_annulation `annulation`, libre "Veolia a enlevé Y au lieu de X"), crée passage Y a posteriori (EC6 v3). |
| EC14 | Décrément W1 aurait rendu `quantite_vide_disponible` négatif (chauffeur retourne plus de bacs que sortis) | Possible si chauffeur récupère bacs traiteur non tracés. **Redéfini arbitrage 2026-06-07 F4** : la valeur est clampée à 0 (`GREATEST(0, ...)` R5.5 + CHECK ≥ 0 — jamais négative en base) et l'alerte `m10_stock_incoherence` (warning) est émise **au moment du clamping** dans W1. Ops corrige via recomptage. |
| EC15 | Param `capacite_max = 0` (jamais paramétré) | Jauge non affichée E2 + E8 (couple ignoré). Alerte Admin TMS au démarrage M13 si paramètres incomplets (cf. M13). |

> **Suppressions revue sobriété 2026-04-30** :
> - Ancien **EC11 v2** (concurrence 2 acteurs confirmation simultanée — chauffeur + Ops vidéo OU 2 Ops vidéo) → supprimé (corollaire A1/A2 — plus qu'un seul acteur Ops via E5 + lock optimiste classique sur transition `planifie → realise`)

---

## 8. États et transitions

### `passages_veolia.statut` (3 valeurs — D1 revue sobriété 2026-04-30)

```
[création E4 ou E6]
       ↓
   planifie ──┬──→ realise (terminal — RAISE EXCEPTION sur déconfirmation)
              │
              └──→ annule (terminal — motif_annulation ∈ {annulation, report, autre})
```

**Règles transitions** :
- `planifie → realise` : Ops Savr / Admin TMS (action E5 — déclaration W3, déclenche reset stock)
- `planifie → annule` : Ops Savr / Admin TMS (motif_annulation obligatoire)
- `realise → *` : **interdit V1 (RAISE EXCEPTION trigger `trg_m10_anti_deconfirmation`)** — terminal
- `annule → *` : **interdit V1 (RAISE EXCEPTION — même trigger `trg_m10_anti_deconfirmation` étendu aux 2 états terminaux, arbitrage 2026-06-07 F3)** — terminal. Si report → Ops crée explicitement nouveau passage `planifie` lié par `passage_origine_id` (FK self optionnelle).

> **Refonte revue sobriété 2026-04-30 D1/B1/B2/A2** :
> - Ancien statut `confirme` (intermédiaire planning) supprimé
> - Ancien statut `reporte` supprimé (= `annule + motif_annulation = 'report'`)
> - Ancien axe 2 orthogonal `confirme_at` supprimé (corollaire A2)
> - Anciens triggers anti-déconfirmation conditionnels conservés mais simplifiés (transition `realise → autre` interdite, plus de gestion `confirme_at NOT NULL → NULL`)
> - 4 CHECK constraints conditionnelles cohérence `confirme_at × source × auto_confirmee_j7` supprimées

### `stocks_bacs_entrepot.quantite_pleine` — états logiques (calculés, non persistés)

```
quantite_pleine / capacite_max :
  < 50%       → "OK" (jauge verte)
  50-84%      → "À surveiller" (jauge jaune)
  85-99% OU > seuil_saturation_pleins → "Saturation" (jauge orange + alerte M11 warning ou critical selon seuil absolu)
  ≥ 100%      → "Dépassement" (jauge rouge + alerte critical)
```

**Note** : "Saturation" est déclenchée par **2 conditions OR** : seuil % (85%) ou seuil absolu (R5.3). Couple les deux signaux via le code unique `m10_bac_satur` avec criticité dynamique (cf. fusion B3).

---

## 9. Notifications + alertes M11 émises

### Catalogue alertes M10 (à seed dans `alertes_catalogue` M11)

| Code canonique | Criticité | Trigger | Destinataires (règle) | Auto-résolution |
|----------------|-----------|---------|------------------------|------------------|
| `m10_bac_satur` | dynamic (warning à 85%, critical au-delà du seuil ou ≥100%) | W6 trigger DB | warning : `roles=['ops_savr']` ; critical : `roles=['ops_savr','admin_tms']` + email Resend | W3 déclaration `realise` OU W5 recomptage corrige |
| `m10_passage_non_confirme` | dynamic (warning J-1/J+1, critical si > 1j de retard) | W7 cron horaire | warning : `roles=['ops_savr']` ; critical : `roles=['ops_savr','admin_tms']` + email Resend | passage → `realise` ou `annule` |
| `m10_passage_reporte` | warning (critical si saturation simultanée) | W8 trigger DB (`motif_annulation = 'report'`) | `roles=['ops_savr']` (+ admin si critical) | nouveau passage planifié pour ce flux |
| `m10_passage_annule` | warning | W8 trigger DB (`motif_annulation IN ('annulation','autre')`) | `roles=['ops_savr']` | manuel (pas d'auto) |
| `m10_bacs_vides_sous_seuil` | warning | W1 trigger (`quantite_vide_disponible < quantite_vide_cible`) | `roles=['ops_savr']` | `quantite_vide_disponible ≥ quantite_vide_cible` |
| `m10_capacite_max_diminuee_satur` | warning | EC9 trigger Admin | `roles=['admin_tms','ops_savr']` | recomptage ou déclencher Veolia |
| `m10_stock_incoherence` | warning | W1 clamping vides à 0 (EC14 redéfini F4 2026-06-07) | `roles=['ops_savr']` | recomptage |

> **Suppressions revue sobriété 2026-04-30 (5 codes)** :
> - `m10_bac_remplissage_85` (fusion B3 dans `m10_bac_satur` criticité dynamique)
> - `m10_passage_realise_non_confirme_j1` (corollaire A2/A4)
> - `m10_passage_realise_non_confirme_j3` (corollaire A2/A4)
> - `m10_passage_auto_confirmee_j7` (corollaire A3)
> - `m10_chauffeur_signale_bacs_pleins` (corollaire A1)
>
> Catalogue M10 : 12 codes → 7 codes.

### Notifications utilisateur (post-action, hors alertes M11)

- **Email post-déclaration passage E5** : récap au saisi_par_user_id ("Passage Veolia du {date} déclaré : {nb_bacs} bacs {flux} enlevés. Stock pleins reset.") — V1 simple, V2 envoi à toute l'équipe Ops si paramétrage Admin
- **Email post-recomptage E7** : récap si écart ≥ 5 bacs (Bloc 3 sobriété 2026-04-25 A1)

### Notifications externes (vers Veolia)

**Aucune V1**. Pas d'API Veolia, pas d'email auto. Action manuelle Ops dans interface web Veolia ou téléphone (E6).

---

## 10. Performance cibles

| Cas | Cible V1 |
|-----|----------|
| E1 + E2 chargement initial (10-20 lignes) | < 800ms p95 |
| E3 chargement liste 30j (~50 lignes) | < 1s p95 |
| E5 déclaration `realise` (write + trigger reset stock) | < 1.5s p95 |
| E7 recomptage (write + log + trigger alertes) | < 1.5s p95 |
| E8 tuiles-jauges dashboard global (polling 30s) | < 300ms p95 |
| W1 trigger DB clôture tournée ZD (auto-incrémentation) | < 200ms (synchrone, bloque la transaction tournée) |
| W7 cron horaire (~10-50 passages à scanner) | < 10s |

> **Suppressions revue sobriété 2026-04-30** : entrées E5b, M05 W13 confirmation chauffeur, W11.c auto-confirmation J+7, W12 cron escalade gradient retirées.

**Volume V1 attendu** :
- ~10-20 lignes `stocks_bacs_entrepot` (5 flux × 3-4 types contenant)
- ~150 passages Veolia / an (3/semaine moyenne)
- ~50-100 recomptages / an (1-2/semaine)
- Croissance V2 : x3 si nouveaux exutoires multi-prestataires

---

## 11. Décisions structurantes prises

| # | Décision | Alternatives écartées | Motif |
|---|----------|------------------------|-------|
| D1 | **Hardcoder Veolia V1** (naming `passages_veolia`, écrans "Exutoires Veolia") | Génériser dès V1 (`passages_exutoires` + FK `prestataires_exutoires`) ; hybride faux découplage | Zéro besoin métier court terme (Veolia unique). Refacto V2 = rename + FK = trivial. Génériser maintenant = sur-ingénierie |
| D2 | **Auto-incrémentation pleins à clôture tournée ZD + recomptage Ops correctif** | Saisie manuelle Ops 1×/jour ; auto sans recompte | Auto donne base temps réel pour alertes. Recompte corrige les écarts (saisie chauffeur imprécise). Trace écarts = signal qualité M11 |
| D3 | **Alertes saturation basées sur estimation auto** (pas valeur recomptée) | Alertes basées sur recomptée (plus fiable mais lag) | Alertes doivent être temps réel pour anticiper saturation. Recompte = correction ponctuelle, pas signal continu |
| D4 | **Saisie manuelle Ops planning Veolia** (pas d'import CSV V1) | Import CSV mensuel ; API Veolia | Volume passages V1 faible (~3/semaine). Effort dev import non justifié. Bascule V1.5 si volume > 5/sem |
| D5 | **Bouton "Déclencher" crée passage `planifie` avec `cree_par_action`** | Bouton info-only sans trace ; bouton + tâche todo Ops | Trace minimale indispensable (sans elle, impossible de suivre déclenchements vs réalisés). Pas de notif Veolia auto (pas d'API) |
| D6 | **Pas de coûts Veolia V1** (`passages_veolia.cout_ht` non créé) | Saisie manuelle au passage ; mini-M08 Veolia | Pilotage exutoire reporté V2. Évite complexité M08-bis. Coûts globaux exutoires gérés hors TMS V1 (compta directe) |
| D7 | **Seuil saturation absolu en bacs pleins par flux × type_contenant** (R5.3 reformulée) | Seuil % de capacité_max ; seuil global entrepôt | Seuil absolu = règle ops simple (ex: "alerte si > 18 bacs pleins biodéchet 240L"). Combiné avec jauge % (informative) couvre les 2 angles |
| D8 | **Page dédiée `/exutoires` + tuiles-jauges dashboard Ops global** | Page dédiée seule ; widget global seul | Tuiles = vue rapide quotidienne, page = saisie/historique. Cohérent avec usage : 1×/jour vue / 1-3×/sem actions |
| D9 | **1 ligne `stocks_bacs_entrepot` = 1 `(flux, type_contenant_id)` figé** | Bac multi-flux réaffectable | Traçabilité contamination flux préservée. Bac biodéchet contaminé carton = problème compliance. Réaffectation = process explicite via E7 (motif "Réaffectation") |
| D10 | **Recomptage Ops trace écarts ≥ 5 bacs ou ≥ 20% dans `tms.audit_logs` action `M10_RECOMPTAGE_ECART`** (Bloc 3 sobriété 2026-04-25 A1) | Pas de trace ; trace warning systématique | Audit_logs = source de vérité audit, sans pollution de la table `tms.alertes`. |
| D11 | **Stock pleins NON-rétroactif après annulation passage** (W10 EC5 v3) | Reset stock automatique si annulé | Le passage n'a pas eu lieu, rien à reverser. Si erreur saisie Ops `realise` → correction via recomptage E7 (motif explicite) |
| D12 | **Création passage a posteriori autorisée** (R5.8 v3) | Refus passage avec date_prevue < now() | Passage Veolia non prévu mais réalisé = cas terrain réel. E4 avec date passée → bascule INSERT direct `realise` |
| D13 | **Annulation / déconfirmation passage post-`realise` interdite V1** (R5.7 v3) | Annulation libre tous statuts | `realise` = état terminal avec impact stock. Correction via recomptage manuel uniquement. Renforcé par RAISE EXCEPTION trigger DB |
| D14 v3 (refonte revue sobriété 2026-04-30 A2) | **Déclaration `realise` par Ops vaut confirmation effective** — la transition `planifie → realise` déclenche reset total stock immédiat (`trg_m10_reset_total_pleins`). Ops vérifie via vidéosurveillance AVANT déclaration (case à cocher `verification_video_at` audit simple inline). Plus de second axe `confirme_at` ni de 3 sources de confirmation ni de cron escalade J+1/J+3/J+7 ni d'auto-confirmation J+7. | (a) Reset à confirmation atomique via 3 sources (chauffeur M05 / Ops vidéo / auto J+7) ; (b) reset à déclaration sans audit vidéo ; (c) confirmation atomique chauffeur uniquement | (a) écarté revue sobriété 2026-04-30 — ratio complexité/fréquence cassé (~150 passages/an pour 8 écrans, lock optimiste 3-source, cron escalade gradient, 4 alertes dédiées). Le signal qualité "passage effectivement vidé" est déjà couvert par R5.6 (recomptage Ops trace écarts) — mécanisme curatif suffisant en V1. (b) écarté car Ops doit avoir un acte intentionnel d'audit vidéo. (c) écarté car frottement UX excessif sur app chauffeur (modal au démarrage de chaque tournée ZD pour signal rare). |
| D15 v3 (refonte revue sobriété 2026-04-30 A3/A4) | **Cron escalade unique W7 horaire avec criticité dynamique** — un seul cron `m10_passage_non_confirme_check` toutes les heures, alerte criticité warning si J-1/J+1 anticipation, critical si > 1j de retard. Plus de gradient J+1/J+3/J+7. Plus d'auto-confirmation J+7. | (a) Cron escalade gradient J+1 warning / J+3 critical / J+7 auto-confirmation ; (b) cron horaire avec auto-confirmation J+7 conservée ; (c) pas de cron du tout, alerte temps réel uniquement | (a) écarté revue sobriété 2026-04-30 — sur-paramétrage pour 150 passages/an (3 paliers, 3 alertes catalogue dédiées, paramètres délais). (b) écarté — auto-confirmation = perte d'acte intentionnel humain, source de bug silencieux. (c) écarté — un Ops qui oublie un passage `planifie` doit recevoir un signal proactif (cron horaire suffisant). |

---

## 12. Questions ouvertes

1. **Volume passages Veolia/semaine actuel** — chiffre Val à confirmer. Conditionne D4 (bascule V1.5 import CSV si > 5/sem). À mesurer 3 mois post go-live V1.
2. **Capacité max entrepôt par flux × type_contenant** — paramétrage Val à fournir au démarrage M13 (onboarding). Inconnu à date (cf. Q7 index TMS inventaire à réaliser).
3. **Seuil saturation absolu par flux × type_contenant** — Val à arbitrer post-paramétrage capacité (typiquement 80-90% de capacité_max).
4. **Délégation compte agent entrepôt V1.5** — créer rôle `agent_entrepot` avec accès limité E5 + E7 ? Reporté V1.5 selon retour terrain (charge Ops si trop d'allers-retours).
5. **Motifs normalisés recomptage E7 (V1.5)** — liste fermée ("Réception commande", "Pesée chauffeur manquante", "Recompte routinier", "Anomalie", "Réaffectation flux") vs textarea libre V1.
6. **Email récap équipe Ops post-passage** — V1 envoi unique au saisi_par. V2 envoi à toute l'équipe Ops paramétrable Admin.
7. **Multi-entrepôts** — V1 mono-entrepôt central. Si Savr ouvre 2ème entrepôt (V3), refacto `stocks_bacs_entrepot` avec FK `entrepot_id`. Pas anticipé V1.
8. **Coûts Veolia V2** — modèle à arbitrer : forfait passage, tonnage, mixte ? Décision V2 quand intégration facturation Veolia engagée.

---

## 13. Liens

### CDC TMS
- [[../03 - Périmètre fonctionnel TMS#M10 — Gestion exutoires Veolia|§03 M10]] — vue macro
- [[../04 - Data Model TMS#Niveau 4 — Stock et exutoires|§04 Niveau 4]] — `stocks_bacs_entrepot`, `passages_veolia` (colonnes confirmation supprimées 2026-04-30), `recomptages_stocks_entrepot_log`
- [[../05 - Règles métier TMS#R5 — Alertes Veolia et exutoires (M10)|§05 R5]] — R5.1 à R5.8 (R5.4 bis / R5.9 / R5.10 supprimées revue sobriété 2026-04-30)
- [[../09 - Authentification et permissions TMS|§09]] — RLS Ops Savr / Admin TMS (RLS chauffeur sur passages_veolia supprimées 2026-04-30)
- [[M11 - Alerting transverse|M11]] — catalogue alertes (7 codes M10) + dashboard Ops + résolution auto
- [[M04 - Gestion des tournées|M04]] — clôture tournée ZD = trigger W1 auto-incrémentation
- [[M13 - Administration TMS|M13]] — paramétrage `parametres_tms.m10` (capacité, seuils, contact Veolia — délais escalade supprimés revue sobriété 2026-04-30)
- [[M02 - Dispatch Ops Savr|M02]] — E8 tuiles-jauges intégrées dashboard Ops global
- [[M05 - App mobile chauffeur|M05]] — aucune intégration M10 V1 (modal confirmation chauffeur supprimée revue sobriété 2026-04-30 A1)

### CDC Plateforme
- Aucun lien direct V1 (M10 = TMS-only). V2 candidat : remontée coûts exutoires vers `courses_logistiques` Plateforme pour calcul marge globale.

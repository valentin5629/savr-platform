# M09 — Stock matériel Savr

---

## ⚠ Addendum 2026-05-01 — Propagation revue sobriété §08 Bloc A (A3)

**Webhook S8 `traiteur-stock-rolls-update` supprimé** — remplacé par lecture cross-schema directe via vue `plateforme.v_stocks_rolls`.

Conséquences sur M09 :

1. **Plus de push S8** — la Plateforme lit directement `tms.stocks_rolls_traiteurs` + `tms.types_contenants` via la vue. Toutes les mentions "push S8", "webhook S8", "DLQ S8" ci-dessous sont **obsolètes V1** (conservées en strikethrough pour traçabilité historique).
2. **R_M09.7 supprimé** — la règle "TMS push obligatoire" devient sans objet : TMS est source de vérité unique en lecture directe DB. Pas de canal de transmission asynchrone.
3. **Code alerte `m09_webhook_s8_dlq` supprimé** — sans objet (pas de webhook, donc pas de DLQ webhook). Conservation des autres alertes M09 (`m09_stock_bas` warning, `m09_stock_negatif` warning audit, `m09_tare_manquante` warning).
4. **EC5 "Webhook S8 push Plateforme échec" supprimé** — sans objet.
5. **D7 ajusté** — décision "Push webhook S8 obligatoire" remplacée par **"Lecture cross-schema directe (vue `v_stocks_rolls`)"**. Justification mise à jour : DB partagée entre Plateforme et TMS, écriture une seule source physique, lecture par vue = MAJ temps réel sans réseau ni retry.
6. **Workflows W1 + W2** — étape "push S8" supprimée. Reste : UPDATE `stocks_rolls_traiteurs` + log `rolls_mouvements` + alerte M11 (si seuil franchi). La Plateforme voit le nouveau stock immédiatement à la prochaine lecture de la vue (pas de cache, pas de table miroir).
7. **Pas de joint `organisations_lieux` côté vue** _(décision Val 2026-05-01)_ — les rolls sont attribués aux **traiteurs uniquement** (pas aux gestionnaires de lieux). Suppression du dashboard "stocks rolls" côté gestionnaire de lieux Plateforme. Dashboard Admin Savr Plateforme + dashboard traiteur Plateforme conservés (lecture vue filtrée par `traiteur_id`).
8. **Suppression simultanée de `plateforme.lieux_stocks_rolls`** — table miroir cross-CDC créée propagation M09 V1 2026-04-25 (option β), jamais déployée en prod, supprimée du §04 Plateforme.

Voir [[../08 - Contrat API Plateforme-TMS#Addendum 2026-05-01 — Revue sobriété §08 Bloc A]].
**Persona principal** : Ops Savr (consultation + recompte ponctuel) + Admin TMS (paramétrage tares + paliers)
**Priorité** : Cœur métier (V1)
**Dépendances** :

- [[M04 - Gestion des tournées|M04]] — clôture tournée ZD = trigger auto-incrément stock entrepôt (W1 exécuté côté M10) + affichage paliers rolls suggérés (W3 M09)
- [[M05 - App mobile chauffeur|M05]] — déclaration chauffeur rolls pleins/vides à clôture collecte ZD (W8 M05) → trigger M09 W1 update `stocks_rolls_traiteurs`
- [[M10 - Gestion exutoires Veolia|M10]] — consume `stocks_bacs_entrepot` (lecture/UI page /exutoires + workflow Veolia + alertes saturation `m10_bac_*`)
- [[M11 - Alerting transverse|M11]] — catalogue alertes `m09_*` + dashboard Ops
- [[M13 - Administration TMS|M13]] — paramétrage tares contenants + paliers pax via `parametres_tms` + référentiel `types_contenants`

---

## 1. Objectif métier

Suivre l'inventaire des **contenants Savr** (rolls déployés chez traiteurs + bacs à l'entrepôt central) avec mécanismes :

- **Auto-tare** des pesées (snapshot `pesees_brutes.tare_kg = types_contenants.tare_kg × nb_contenants` au moment de la pesée)
- **Alertes stock bas** rolls traiteur (seuil paramétrable, default 50% cible)
- **Paliers rolls par pax** suggérés à la préparation tournée (M04)
- **Recompte manuel Ops** correctif post-écart visible terrain

Remplace les outils MTS-1 actuels (Excel partagé + comptage manuel) par une mécanique tracée, alertes temps réel, **lecture Plateforme via vue cross-schema `v_stocks_rolls`** _(remplace ex-webhook S8, revue sobriété 2026-05-01 A3)_.

**Bénéfices V1** :

- Visibilité temps réel sur stock rolls par traiteur (dashboard + alertes)
- Trace mouvements rolls (`rolls_mouvements` append-only) → audit + reporting V2
- Empêche les ruptures rolls terrain (alerte M11 `m09_stock_bas`)
- Auto-tare des pesées chauffeur (M05) cohérente sans saisie manuelle

**Hors scope V1** :

- Numéro de série unique par roll (granularité par type uniquement, V2 si business case traçabilité fine)
- Multi-entrepôts (mono-entrepôt central V1, refonte schéma V3 si Savr ouvre 2ème entrepôt)
- Inventaire trimestriel automatique magic link traiteur (V1.1, cf. D4)
- UI dédiée historique mouvements bacs entrepôt (consultable via `recomptages_stocks_entrepot_log` géré M10)

---

## 2. Frontière M09 / M10 (option e — frontière documentaire 2026-04-25)

**Décision structurante D1** : option e validée Val 2026-04-25 — M09 décrit la **sémantique stock matériel complète** mais ne refactorise pas les tables/workflows déjà gérés par M10. La frontière est documentaire, pas data.

| Élément                                                                                | Owner V1                                                          | Référence             |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------- |
| Table `stocks_rolls_traiteurs`                                                         | M09                                                               | §04 niveau 4          |
| Table `rolls_mouvements`                                                               | M09                                                               | §04 niveau 2          |
| Table `stocks_bacs_entrepot`                                                           | **M10** (UI + workflow)                                           | §04 niveau 4 + M10 §4 |
| Table `passages_veolia`                                                                | M10                                                               | §04 niveau 4          |
| Table `recomptages_stocks_entrepot_log`                                                | M10 (mécanique recompte bacs)                                     | §04 niveau 4          |
| Table `types_contenants`                                                               | **M09** (référentiel sémantique)                                  | §04 niveau 2          |
| Auto-incrément `stocks_bacs_entrepot.quantite_pleine` à clôture tournée ZD             | M10 W1                                                            | M10 §5                |
| Recompte manuel stock bacs entrepôt                                                    | M10 W5/E7                                                         | M10 §4-5              |
| Reset total stock bacs à déclaration passage Veolia `realise` (V3 sobre 2026-04-30)    | M10 W3 (R5.4 v3)                                                  | M10 §5 + §05 R5.4 v3  |
| Update `stocks_rolls_traiteurs` à clôture collecte ZD                                  | **M09 W1** (R4.1)                                                 | M05 W8 + §05 R4.1     |
| Recompte manuel rolls traiteur                                                         | **M09 W2**                                                        | présente section §7   |
| Paliers rolls par pax (prep tournée M04)                                               | **M09 W3** (R4.4)                                                 | §05 R4.4 + M04        |
| Tares contenants (auto-tare pesées M05)                                                | **M09** (référentiel `types_contenants.tare_kg` + maintenance W4) | §04 niveau 2 + M05    |
| Alerte `m09_stock_bas` (rolls traiteur < 50% cible)                                    | **M09 R4.2**                                                      | §05 R4.2              |
| Alertes saturation `m10_bac_satur` (criticité dynamique fusion B3 V3 sobre 2026-04-30) | M10 (workflow Veolia)                                             | M10 §9                |
| Inventaire trimestriel rolls traiteurs                                                 | **M09 V1.1 reporté** (D4)                                         | —                     |

**Lecture pour Claude Code dev** : pour toute mécanique stock bacs entrepôt + workflow Veolia → lire M10. Pour toute mécanique stock rolls traiteur + référentiel contenants + tares + paliers → lire M09. Pas de duplication, pas de divergence.

---

## 3. Périmètre fonctionnel V1

### Inclus V1

- Suivi stock rolls Savr chez traiteurs : déclaration chauffeur (M05) → trigger M09 W1 → update `stocks_rolls_traiteurs` + alertes
- Référentiel `types_contenants` avec tare seed (paramétrable Admin TMS via M13 E4)
- Paliers rolls par pax pour préparation tournée (affichage informatif M04)
- Recompte manuel rolls traiteurs (Ops Savr correctif via E3)
- **Supprimé revue sobriété 2026-05-01 A3** — remplacé par vue cross-schema `plateforme.v_stocks_rolls` (lecture directe TMS). R_M09.7 supprimé corrélativement.
- Alertes M11 : `m09_stock_bas` (warning), `m09_stock_negatif` (warning audit), `m09_tare_manquante` (warning) — **supprimée revue sobriété 2026-05-01 A3** (sans objet, pas de webhook). **Bloc 3 sobriété 2026-04-25 (A1)** : codes ex-`info` retirés du catalogue (`m09_recompte_ecart_rolls`, `m09_tare_modifiee`, `m09_stock_initial_inconnu`). Events tracés directement dans tables d'audit dédiées (`rolls_mouvements`, `audit_logs`).
- Frontière documentaire avec M10 (lecture stock bacs entrepôt via M10 E2)

### Reporté V1.1

- Inventaire trimestriel automatique : email magic link au contact Ops de chaque traiteur, confirmation stock théorique, écarts → dashboard Ops Savr (D4 — V1.1 reporté arbitrage 2 audit cohérence inter-CDC 2026-04-25)
- Délégation compte agent entrepôt avec accès limité E3 recompte rolls + E_M10 recompte bacs (alignement M10 D11 — V1.5)
- Motifs normalisés recompte Ops (liste fermée vs textarea libre)

### Hors scope V1

- Numéro de série unique par roll (V2 si business case)
- Multi-entrepôts central + secondaire (V3, refonte schéma)
- Commandes fournisseur bacs (process hors TMS V1, V2 candidat module dédié — alignement M10 W9)
- UI dédiée stock bacs entrepôt côté M09 (M10 reste source UI E2 + E7)

### Plan de consolidation stocks rolls migration MTS-1 (propagation §13 2026-04-27)

**Contexte** : décision §13 D4 (A5=c) — stocks initiaux estimés Ops Savr sans inventaire physique. Conséquence : `stocks_rolls_traiteurs` faux à J0, alertes `m09_stock_bas` parasites possibles 2-4 semaines.

**Plan de rectification progressive** (cf. [[13 - Migration MTS-1#13.6 Plan de consolidation stocks (semaines 1-4)]]) :

| Date | Action                                                       | Owner    | Outil                                  |
| ---- | ------------------------------------------------------------ | -------- | -------------------------------------- |
| J0   | Stocks initiaux estimés saisis dans `stocks_rolls_traiteurs` | Ops Savr | E3 modal recompte (acteur `migration`) |
| J+7  | Cross-check rolls traiteurs majeurs (5 plus gros)            | Ops Savr | E3 modal recompte standard             |
| J+15 | Cross-check rolls 10 traiteurs suivants                      | Ops Savr | E3                                     |
| J+30 | Cross-check rolls traiteurs restants                         | Ops Savr | E3                                     |

Pendant la fenêtre J0 → J+30, alertes `m09_stock_bas` émises avec `contexte = 'migration_test'` (cf. §04 addendum §13). **M09 n'émet aucune alerte critical** (le seul, `m09_webhook_s8_dlq`, a été supprimé §08 Bloc A 2026-05-01) — la clause d'auto-résolution J+30 du cron `m13_cleanup_legacy` (R\_§13.8, critical only) est donc sans objet pour M09. Les warnings `m09_stock_bas` migration restent actives, à traiter normalement par Ops puis se résolvent naturellement au recompte (W2) ou à la prochaine collecte (W1).

---

## 4. Personas et contexte d'usage

### Chauffeur (acteur indirect)

- App mobile M05, déclaration rolls pleins récupérés / vides laissés à la **clôture collecte ZD** (W8 M05 → trigger M09 W1)
- **Pas d'accès UI M09 direct** (pas d'écran stock côté chauffeur V1)

### Ops Savr (utilisateur principal V1)

- **Bureau** (PC), consultation stock par traiteur 1-2×/jour (dashboard E1 ou recherche traiteur E2)
- Recompte stock rolls traiteur (E3) ad hoc (~1×/sem si retour terrain anomalie)
- Lecture alertes stock bas (in-app M11 + dashboard Ops global)
- Modifie paliers pax via M13 (paramétrage `parametres_tms.stock` — accessible Ops Savr D6 R4.4)

### Admin TMS

- **Bureau**, paramétrage tares contenants + paliers pax via M13 E4/E5 (rare, ~1×/trimestre — ajustement post-retour terrain ou nouveau type contenant)

### Agent entrepôt (acteur indirect)

- **Pas d'utilisateur TMS V1**. Recompte physiquement les bacs et fait remonter à Ops Savr (téléphone, message interne)
- V1.5 candidat : compte direct Ops Savr délégué avec accès limité E3 (rolls) + E_M10 E7 (bacs entrepôt)

---

## 5. Architecture des écrans

| #   | Écran                                                   | Persona              | Type            | Localisation                                                     |
| --- | ------------------------------------------------------- | -------------------- | --------------- | ---------------------------------------------------------------- |
| E1  | Dashboard stocks (vue d'ensemble rolls traiteurs)       | Ops + Admin TMS      | Page principale | `/stocks`                                                        |
| E2  | Détail stock rolls par traiteur + historique mouvements | Ops + Admin TMS      | Sous-page E1    | `/stocks/traiteurs/{id}`                                         |
| E3  | Modal recompte stock rolls traiteur                     | Ops + Admin TMS      | Modal           | `/stocks/traiteurs/{id}?action=recompter&type_contenant_id={id}` |
| E4  | Référentiel `types_contenants` + tares (intégré M13)    | Admin TMS            | Page M13        | `/admin/types-contenants`                                        |
| E5  | Paramétrage paliers pax (intégré M13)                   | Admin TMS + Ops Savr | Section M13 E2  | `/admin/parametres?ns=stock`                                     |

**Renvois M10 (pas de duplication UI)** :

- M10 E2 : tableau stock bacs entrepôt — accessible via `/exutoires#stock`
- M10 E7 : modal recompte stock bacs entrepôt
- E1 M09 contient un lien CTA "Voir le stock bacs entrepôt → /exutoires#stock" pour navigation transverse, mais aucune duplication de l'UI ni des données.

**Navigation** :

- E1 = page racine M09
- E2 = drill-down par traiteur (sélection depuis E1 ou recherche directe)
- E3 = modal lancée depuis E1 (bouton ligne) ou E2 (bouton ligne)
- E4/E5 = pages d'admin sous M13

---

## 6. Écran par écran

### E1 — Dashboard stocks (`/stocks`)

**Layout** :

- **Header** : titre "Stocks matériels" + filtres (search traiteur, multiselect type_contenant, multiselect statut)
- **KPI cards** (1 tuile, sobriété 2026-04-30 — 3 KPI vanity retirés A_M09_02/03/05) :
  - Nb stocks négatifs en attente correction (`m09_stock_negatif` ouverte)
- — **Supprimé sobriété 2026-04-30 A_M09_05** : duplique le tri par défaut tableau Section 1 (les bas remontent en haut), info déjà visible.
- — **Supprimé sobriété 2026-04-30 A_M09_02** : vanity metric sans action déclenchée. Audit dispo via E2 historique.
- — **Supprimé sobriété 2026-04-30 A_M09_03** : vanity metric. Analyse qualité via consultation `tms.audit_logs` filtre `M09_RECOMPTE_ECART_ROLLS`.
- **Section 1 — Tableau stock rolls par traiteur** :

| Colonne                  | Source                                                                | Format                                                                                                                                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Traiteur                 | `stocks_rolls_traiteurs.plateforme_traiteur_id` → cross-schema lookup | Nom traiteur                                                                                                                                                                                                                                                          |
| Lieu (si stock par lieu) | `plateforme_lieu_id` (nullable)                                       | Libellé lieu ou "(global)"                                                                                                                                                                                                                                            |
| Type contenant           | `types_contenants.libelle`                                            | Texte (ex: "Roll 850L emboîtable", "Roll pliable")                                                                                                                                                                                                                    |
| Quantité actuelle        | `quantite_actuelle`                                                   | Entier (rouge si < 0)                                                                                                                                                                                                                                                 |
| Quantité cible           | `quantite_cible`                                                      | Entier ou "—" si NULL                                                                                                                                                                                                                                                 |
| Statut                   | calculé                                                               | Badge "OK" (≥ 50% × cible) / "Bas" (< 50% × cible) / "Négatif" (< 0). **Sobriété 2026-04-30 B_M09_01** : badge "Critique" (< 25%) fusionné dans "Bas" — aucun comportement applicatif distinct (alerte M11 `m09_stock_bas` warning unique, pas de variante critical). |
| Dernière maj             | `derniere_maj_at`                                                     | "il y a 2h"                                                                                                                                                                                                                                                           |
| Dernière source          | `derniere_maj_par_chauffeur_id` ou `derniere_maj_par_user_id`         | "Chauffeur X" / "Ops Y"                                                                                                                                                                                                                                               |
| Actions                  | —                                                                     | Bouton "Recompter" (ouvre E3) + bouton "Détail" (ouvre E2)                                                                                                                                                                                                            |

**Tri par défaut** : `quantite_actuelle / NULLIF(quantite_cible, 0)` ASC NULLS LAST → les plus bas en haut.

**Section 2 — Lien transverse vers M10** : bandeau bas de page "Stock bacs à l'entrepôt central — voir page Exutoires" + CTA → `/exutoires#stock`.

**Performance** : pagination 50 lignes max. Volume V1 attendu : ~50-100 lignes (10-20 traiteurs × 1-3 types contenant).

**RLS** : accès `roles && ARRAY['admin_tms','ops_savr']`. Manager prestataire / chauffeur → 403.

---

### E2 — Détail stock rolls par traiteur (`/stocks/traiteurs/{id}`)

**Layout** :

- **Header** : nom traiteur (lookup cross-schema `plateforme.organisations`). **Sobriété 2026-04-30 A_M09_04** : retiré — recompte unitaire uniquement (Ops enchaîne 3-5 modaux si besoin global, fréquence rare).
- **Section 1 — Tableau stock par (type_contenant, lieu)** :
  - Colonnes : type contenant, lieu (si applicable), qté actuelle, qté cible, statut, dernière maj, dernière source
  - Action par ligne : "Recompter" (E3 pré-rempli sur le couple)
- **Section 2 — Historique mouvements (30 derniers)** :
  - Tableau lecture seule depuis `rolls_mouvements WHERE plateforme_traiteur_id = {id} ORDER BY created_at DESC LIMIT 30`
  - Colonnes : date, source (badge `cloture_collecte` / `recompte_ops`), collecte (FK clickable si cloture_collecte), chauffeur ou user_id, type contenant, pleins récup (+/-), vides laissés (+/-), stock après, motif (si recompte_ops)
  - **V1.5 candidat** : pagination > 30 mouvements (cf. QO5)

**RLS** : idem E1.

**Performance** : query indexée sur `(plateforme_traiteur_id, created_at DESC)` (cf. §04 niveau 2 `rolls_mouvements`).

---

### E3 — Modal recompte stock rolls traiteur

**Contexte d'ouverture** :

- Depuis E1 (bouton ligne) → pré-rempli sur `(traiteur, type_contenant)` de la ligne
- Depuis E2 (bouton ligne) → idem
- — **Supprimé sobriété 2026-04-30 A_M09_04** : recompte = ~1×/sem ad-hoc sur retour terrain anomalie ciblée. Mode unitaire seul, Ops enchaîne s'il veut.

**Champs** :

- `quantite_actuelle_recomptee` (entier ≥ 0) avec affichage en regard de qté actuelle (delta affiché en temps réel)
- `quantite_cible` (entier ≥ 0, modifiable, défaut = valeur courante)
- `motif` (textarea, **obligatoire** si écart absolu ≥ 3 ou écart relatif ≥ 30% sur l'un des deux champs)

**Bouton "Valider recompte"** :

- Appel `tms.m09_recompter_rolls(plateforme_traiteur_id uuid, plateforme_lieu_id uuid NULL, type_contenant_id uuid, qte_actuelle_recomptee int, qte_cible_recomptee int NULL, motif text NULL) RETURNS uuid`
  - INSERT `rolls_mouvements` avec `source = 'recompte_ops'`, delta calculé (`qte_actuelle_recomptee - quantite_actuelle_avant`), motif, `user_id = current_user`
  - UPDATE `stocks_rolls_traiteurs` : valeurs recomptées + `derniere_maj_at = now()` + `derniere_maj_par_user_id = current_user`
  - Si écart absolu ≥ 3 OU écart relatif ≥ 30% → INSERT `tms.audit_logs` action `M09_RECOMPTE_ECART_ROLLS` avec context `{ancien, nouveau, delta, motif}` (Bloc 3 sobriété 2026-04-25 A1 — auparavant alerte M11 `m09_recompte_ecart_rolls` info, retirée du catalogue. Trace audit conservée via `rolls_mouvements` source `recompte_ops` + `audit_logs` pour la qualification de l'écart)
  - Nouveau stock visible Plateforme immédiatement via vue cross-schema `plateforme.v_stocks_rolls` (lecture directe DB, plus de push HTTP — revue sobriété §08 Bloc A 2026-05-01 A3)
  - Retourne `id` du `rolls_mouvements` créé

**Validation** :

- `qte_actuelle_recomptee` ≥ 0 (refus négatif côté UI, mais autorisé en DB pour incohérences mesurées)
- `motif` ≥ 10 chars si seuil écart franchi
- Concurrence : si UPDATE échoue (concurrent recompte) → toast UI "Conflit recompte, re-charge la fiche traiteur" + re-fetch

---

### E4 — Référentiel `types_contenants` + tares (intégré M13)

**Localisation** : page M13 dédiée `/admin/types-contenants`. Spec UI complète dans M13 (référencée ici pour traçabilité M09).

**Tableau** :

- Colonnes : slug, libellé, catégorie (`roll`/`bac`/`sac`/`autre` — **sobriété 2026-04-30 D_M09_02** : `caisse` retiré, aucun seed actif), `tare_kg`, flux compatibles (multiselect badges), statut (`actif` / `archive`)
- Action Admin TMS : éditer tare via modal simple (champ `tare_kg numeric ≥ 0` max 200kg)
  - Bouton "Enregistrer" → UPDATE `types_contenants.tare_kg` + INSERT `tms.audit_logs` action `TYPE_CONTENANT_TARE_UPDATE` (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 `m09_tare_modifiee` info retirée du catalogue, audit_logs reste l'unique source de vérité pour cet event)
  - **Pas de recalcul rétroactif** : pesées historiques conservent leur snapshot `pesees_brutes.tare_kg` figé au moment de la pesée (cf. §04 niveau 2 `pesees_brutes`)
- Action Admin TMS : ajouter nouveau type
- **Archivage interdit** si `stocks_rolls_traiteurs.quantite_actuelle > 0` ou si pesées historiques référencent le type (FK RESTRICT — UI bloque l'archivage avec message "Type utilisé par X stocks et Y pesées historiques")

**RLS** : `admin_tms` write, `ops_savr` lecture seule. Manager prestataire / chauffeur → 403.

---

### E5 — Paramétrage paliers pax (intégré M13)

**Localisation** : section dédiée dans M13 E2 "Paramètres" filtrée sur namespace `stock`.

**Paramètres exposés** :

- `palier_rolls_par_pax_seuils` (JSON : `[{pax_max: 100, rolls: 1}, {pax_max: 200, rolls: 2}, {pax_max: 400, rolls: 4}, {pax_max: 800, rolls: 8}, {pax_max: null, rolls: null}]` — null/null signifie "saisie manuelle Ops requise")
- `seuil_alerte_stock_roll_pct` (numeric default 50, min 10, max 100)

**Modifiable par** : `roles && ARRAY['admin_tms', 'ops_savr']` (D6 — paliers ouverts à Ops Savr car ajustement terrain fréquent attendu V1, alignement M07 D5 paliers tarifaires)

**Effet immédiat** : pas de redéploiement requis (lecture cache 60s côté Edge Function — alignement M13 D6).

---

## 7. Workflows détaillés

### W1 — Update stock rolls traiteur à clôture collecte ZD (R4.1)

**Déclencheur** : trigger applicatif côté M05 W8 (clôture collecte ZD via app mobile chauffeur), pour chaque pesée ZD validée.

**Étapes** :

1. Identifier `plateforme_traiteur_id` (depuis `collectes_tms.plateforme_traiteur_id`) + `plateforme_lieu_id` (depuis `collectes_tms.plateforme_lieu_id`)
2. Pour chaque type_contenant déclaré sur la collecte :
   - `nb_pleins_recuperes` = somme des rolls remplis ramenés (saisie chauffeur)
   - `nb_vides_laisses` = somme des rolls vides neufs déposés (saisie chauffeur)
3. Appel `tms.m09_update_stock_rolls(plateforme_traiteur_id, plateforme_lieu_id, type_contenant_id, collecte_id, chauffeur_id, nb_pleins_recuperes, nb_vides_laisses) RETURNS uuid` :
   - INSERT `rolls_mouvements` : `source = 'cloture_collecte'`, collecte_id, chauffeur_id, deltas, idempotency par UNIQUE `(collecte_id, type_contenant_id)`
   - UPDATE `stocks_rolls_traiteurs` :
     - `quantite_actuelle = ancienne - nb_pleins_recuperes + nb_vides_laisses`
     - `derniere_maj_at = now()`
     - `derniere_maj_par_chauffeur_id = chauffeur_id`
     - `derniere_maj_collecte_id = collecte_id`
   - Vérifier seuils :
     - Si `nouvelle_quantite < 0` → émet `tms.alerte_emit('m09_stock_negatif', 'stocks_rolls_traiteurs', stock_id, criticite='warning', ...)` (pas de blocage métier)
     - Si `nouvelle_quantite < quantite_cible × seuil_alerte_stock_roll_pct / 100` (et `quantite_cible IS NOT NULL`) → émet `m09_stock_bas` (warning)
     - Si `nouvelle_quantite >= quantite_cible × seuil_alerte_stock_roll_pct / 100` ET alerte ouverte → résolution auto `m09_stock_bas`
   - Nouveau stock visible Plateforme immédiatement via vue cross-schema `plateforme.v_stocks_rolls` (lecture directe DB, plus de push HTTP — revue sobriété §08 Bloc A 2026-05-01 A3)
   - Retourne `id` du `rolls_mouvements` créé

**Idempotence** : par UNIQUE `(collecte_id, type_contenant_id)` sur `rolls_mouvements`. Replay W1 (cas retry M05 PWA queue offline) → INSERT échoue silencieusement (ON CONFLICT DO NOTHING), UPDATE stock skip si déjà appliqué (compare `rolls_mouvements.id` dernière propagation vs nouvelle insertion).

**Performance cible** : < 300ms p95 (synchrone côté W8 M05, bloque la transaction clôture collecte).

**Fallback dégradé** : si `stocks_rolls_traiteurs` absent pour `(traiteur, type_contenant, lieu)` → INSERT auto avec `quantite_actuelle = -nb_pleins_recuperes + nb_vides_laisses` + `quantite_cible = NULL` + INSERT `tms.audit_logs` action `M09_STOCK_INITIAL_INCONNU` avec context `{traiteur_id, lieu_id, type_contenant_id, quantite_initiale}` (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 `m09_stock_initial_inconnu` info retirée du catalogue. Ops Savr consulte les audit_logs filtrés par action pour paramétrer `quantite_cible` via E3).

---

### W2 — Recompte manuel stock rolls traiteur (E3)

**Acteur** : Ops Savr.

**Déclencheur** : retour terrain anomalie (chauffeur signale stock incohérent, traiteur appelle, inventaire annuel).

**Étapes** :

1. Ops ouvre E1 ou E2 → bouton "Recompter" → E3
2. Saisit `quantite_actuelle_recomptee` (+ `quantite_cible_recomptee` optionnel) + motif si seuil écart franchi
3. Appel `tms.m09_recompter_rolls(...)` (cf. §6 E3) :
   - INSERT `rolls_mouvements` source `'recompte_ops'`
   - UPDATE `stocks_rolls_traiteurs`
   - INSERT `tms.audit_logs` action `M09_RECOMPTE_ECART_ROLLS` si seuil franchi (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 info retirée)
   - Nouveau stock visible Plateforme via vue `plateforme.v_stocks_rolls` (lecture directe DB, plus de push S8 — revue sobriété §08 Bloc A 2026-05-01 A3)

**Performance cible** : < 800ms p95.

---

### W3 — Calcul paliers rolls suggérés à prep tournée (R4.4)

**Acteur** : système (M04 affichage prep tournée).

**Déclencheur** : Ops ouvre détail tournée M04 ou modifie composition tournée.

**Étapes** :

1. M04 calcule `nb_pax_total = SUM(collectes.nb_pax) WHERE tournee_id = X AND type_collecte = 'zero_dechet'`
2. Lecture `parametres_tms.stock.palier_rolls_par_pax_seuils` (cache Edge 60s)
3. Match : palier où `nb_pax_total <= pax_max` (premier match dans l'ordre) → `nb_rolls_suggeres`
4. Si `palier.rolls IS NULL` (cas `pax_max IS NULL` cf. paliers > 800) → affichage "Saisie manuelle Ops requise (>800 pax)" + CTA recompte
5. Affichage informatif M04 (badge bleu "X rolls suggérés" + tooltip explicatif "Basé sur Y pax × paliers paramétrés Ops")

**Pas de blocage** : si chauffeur emporte plus ou moins que suggéré, aucune contrainte. Trace dans `rolls_mouvements` à clôture (W1).

**Performance cible** : < 100ms p95 (cache).

---

### W4 — Update tare contenant (Admin TMS, E4)

**Acteur** : Admin TMS.

**Déclencheur** : ajustement post-pesée à blanc (Q10 Index TMS — Val pèse à blanc avant go-live ou ajustement trimestriel) ou nouveau type contenant créé.

**Étapes** :

1. Admin ouvre E4 (M13) → édite tare d'un `type_contenant`
2. UPDATE `types_contenants.tare_kg = new_value`
3. INSERT `audit_logs` (`table='types_contenants'`, `row_id=type_id`, `action='TYPE_CONTENANT_TARE_UPDATE'`, `diff={ancienne_tare, nouvelle_tare}`, `acteur_user_id=current_user`)
4. **Pas de recalcul rétroactif** : pesées historiques (`pesees_brutes.tare_kg`) restent figées (snapshot au moment de la pesée — cf. §04 niveau 2 `pesees_brutes`). Garantit traçabilité reportings historiques.
5. (Bloc 3 sobriété 2026-04-25 A1) Pas d'alerte M11 — l'audit est porté par l'INSERT `audit_logs` step 3. Visibilité Ops Savr via consultation audit_logs filtrée par action `TYPE_CONTENANT_TARE_UPDATE`.
6. — **Supprimé sobriété 2026-04-30 B_M09_02** : tare modifiée ~1×/trimestre, TTL 60s naturel suffit (60s max de désync acceptable Admin/chauffeur). Mécanisme invalidation forcée + clé cache retirés.

**Performance cible** : < 500ms p95.

---

## 8. Edge cases

| #    | Cas                                                                                     | Comportement V1                                                                                                                                                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EC1  | Chauffeur déclare 5 vides laissés mais traiteur a `quantite_cible = 3`                  | Stock dépasse cible — pas d'alerte, juste anomalie visible E2 historique. Ops contacte traiteur si récurrent (Ops voit dépassement via E2 statut > 100% × cible)                                                                                                               |
| EC2  | Stock négatif post-collecte (chauffeur prend plus de pleins qu'il n'en reste théorique) | Pas de blocage métier. `quantite_actuelle` peut devenir négatif. Alerte `m09_stock_negatif` (warning audit) émise. Correction via E3 recompte Ops (motif obligatoire "Stock négatif corrigé — comptage physique X rolls")                                                      |
| EC3  | Tare contenant modifiée par Admin TMS pendant tournée en cours                          | Pesées en cours utilisent tare snapshot `pesees_brutes.tare_kg` (figé à la pesée). Nouvelles pesées utilisent nouvelle tare. Pas de rétroactif (préserve audit historique)                                                                                                     |
| EC4  | Type contenant archivé alors que stock > 0 OU pesées historiques référencent            | **Interdit** (FK RESTRICT). UI Admin TMS bloque l'archivage avec message explicite ("Type utilisé par X stocks actifs et Y pesées historiques. Décommissionnement impossible. Soldez d'abord les stocks via E3 recompte = 0 + motif 'Décommission type contenant'")            |
| EC6  | Traiteur multi-entrepôts (stock par lieu)                                               | Géré via `stocks_rolls_traiteurs.plateforme_lieu_id` non-NULL (UNIQUE `(plateforme_traiteur_id, plateforme_lieu_id, type_contenant_id)`). UI E2 distingue stocks par lieu via colonne dédiée                                                                                   |
| EC7  | Roll Savr non répertorié dans `types_contenants` (oubli paramétrage)                    | Pesée auto-tare = 0 (`tare_kg=0` par défaut). Émet alerte M11 `m09_tare_manquante` (warning) destinataires Ops Savr + Admin TMS contexte `{type_contenant_id, slug, libelle}`. Auto-résolution dès que tare paramétrée via E4 (W4)                                             |
| EC8  | Inventaire physique annuel découvre 5 rolls perdus chez traiteur X                      | Recompte Ops via E3 (motif obligatoire "Inventaire annuel — 5 rolls non trouvés, écart à investiguer"). Trace `rolls_mouvements` source `recompte_ops` + INSERT `tms.audit_logs` action `M09_RECOMPTE_ECART_ROLLS` (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 info retirée)   |
| EC9  | Concurrence : 2 Ops recomptent simultanément le même `(traiteur, type_contenant)`       | Lock optimiste `UPDATE stocks_rolls_traiteurs SET quantite_actuelle = X, derniere_maj_at = now() WHERE id = Y AND derniere_maj_at = $previous_value RETURNING id`. Si 0 rows affectées → toast UI "Stock modifié par {autre_user} entre temps. Re-charger ?" + bouton re-fetch |
| EC10 | Suppression collecte source d'un mouvement rolls                                        | `rolls_mouvements.collecte_id` FK ON DELETE SET NULL. Le mouvement reste en historique audit (motif "Collecte source supprimée"). Pas de réversion stock automatique (correction via E3 si écart constaté)                                                                     |
| EC11 | Paliers pax modifiés Ops pendant prep tournée en cours                                  | M04 lit cache 60s. Tournées en cours d'affichage refreshent au prochain render (pas de notification temps réel V1)                                                                                                                                                             |
| EC12 | Type contenant utilisé pour 2 flux (ex: roll Savr utilisé pour biodéchet ET emballage)  | Géré via `types_contenants.flux_compatibles text[]`. Pas d'impact stock (granularité par type_contenant, pas par flux). M05 chauffeur sélectionne type + flux à la pesée                                                                                                       |

---

## 9. Notifications + alertes M11 émises

### Codes alertes M09 (à seed `alertes_catalogue` M11)

| Code                 | Criticité       | Trigger                                                                       | Destinataires (règle)            | Auto-résolution                                                         |
| -------------------- | --------------- | ----------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `m09_stock_bas`      | warning         | W1 (`quantite_actuelle < quantite_cible × seuil_alerte_stock_roll_pct / 100`) | `roles=['ops_savr']`             | Stock revient au-dessus du seuil (W1 prochaine collecte ou W2 recompte) |
| `m09_stock_negatif`  | warning (audit) | W1 (`quantite_actuelle < 0`)                                                  | `roles=['ops_savr']`             | Recompte E3 corrige (W2)                                                |
| `m09_tare_manquante` | warning         | EC7 (pesée avec `types_contenants.tare_kg = 0` ET non `sans_contenant`)       | `roles=['ops_savr','admin_tms']` | Tare paramétrée via E4 (W4)                                             |

> — **Supprimé revue sobriété §08 Bloc A 2026-05-01 A3** : webhook S8 supprimé (lecture cross-schema `plateforme.v_stocks_rolls`), plus de DLQ. **M09 n'émet donc plus aucune alerte critical V1** — toutes les alertes M09 sont des warnings.

**Codes ex-`info` retirés du catalogue M11 — Bloc 3 sobriété 2026-04-25 (A1)** :

- `m09_recompte_ecart_rolls` → trace via `rolls_mouvements` source `recompte_ops` + INSERT `tms.audit_logs` action `M09_RECOMPTE_ECART_ROLLS` (W2/EC8)
- `m09_tare_modifiee` → trace via `tms.audit_logs` action `TYPE_CONTENANT_TARE_UPDATE` (W4 step 3) — déjà obligatoire indépendamment de l'alerte M11
- `m09_stock_initial_inconnu` → trace via `tms.audit_logs` action `M09_STOCK_INITIAL_INCONNU` (W1 fallback) — Ops paramètre `quantite_cible` via E3 après consultation audit_logs filtrés par action

**Note importante (arbitrage 3 audit cohérence inter-CDC 2026-04-25)** : `m09_stock_bas` était initialement marqué V1.1 dans M11 catalogue ligne 761 — **corrigé V1** propagation immédiate cette session (cf. tâche A.bis). Cohérence rétablie avec §05 R4.2.

### Notifications utilisateur (post-action, hors alertes M11)

- — **Supprimé sobriété 2026-04-30 A_M09_01** : self-notif d'une action que l'Ops vient d'exécuter, zéro valeur informationnelle. Audit conservé via `tms.audit_logs` action `M09_RECOMPTE_ECART_ROLLS` + `rolls_mouvements` source `recompte_ops`. Ops consulte E2 historique si besoin.

### Notifications externes

**Aucune V1**. Pas d'API traiteur. Communication écarts hors-TMS (téléphone Ops).

---

## 10. Règles métier appliquées

Renvois textuels (source §05 R4 + nouveaux R_M09) :

- **R4.1** — Mise à jour stock rolls traiteur à chaque INSERT `rolls_mouvements` (source `cloture_collecte` ou `recompte_ops`) → W1 / W2
- **R4.2** — Alerte stock bas (seuil paramétrable `seuil_alerte_stock_roll_pct` default 50) → W1 émet `m09_stock_bas`
- **R4.3** — Stock négatif autorisé (warning audit, pas blocage métier) → W1 émet `m09_stock_negatif`
- **R4.4** — Paliers rolls suggérés à prep tournée (paramétrable `admin_tms` + `ops_savr` via M13 E5) → W3 affichage M04
- **R_M09.5 (nouvelle 2026-04-25, révisée Bloc 3 sobriété 2026-04-25)** — Recompte manuel Ops trace écarts dans `tms.audit_logs` action `M09_RECOMPTE_ECART_ROLLS` si écart absolu ≥ 3 OU relatif ≥ 30% → W2 (alerte M11 `m09_recompte_ecart_rolls` info dégagée Bloc 3 A1)
- **R_M09.6 (nouvelle 2026-04-25, révisée Bloc 3 sobriété 2026-04-25)** — Tare contenant modification = `tms.audit_logs` action `TYPE_CONTENANT_TARE_UPDATE`, **pas de recalcul rétroactif** (snapshot pesée préservé via `pesees_brutes.tare_kg` figé) → W4 (alerte M11 `m09_tare_modifiee` info dégagée Bloc 3 A1)
- — **Supprimée V1 (revue sobriété §08 Bloc A 2026-05-01 A3)** : la Plateforme lit le stock rolls cross-schema via vue `plateforme.v_stocks_rolls`. TMS = source de vérité unique en lecture directe DB, plus de push HTTP, plus de table miroir `plateforme.lieux_stocks_rolls`, plus d'alerte `m09_webhook_s8_dlq`. Cohérent avec §05 R_M09.7 (strikée).
- **R_M09.8 (nouvelle 2026-04-25)** — Type contenant archivage interdit si `quantite_actuelle > 0` ou pesées historiques référencent (FK RESTRICT enforced DB) → EC4

**Note** : R_M09.5-R_M09.8 sont nouvelles à cette session. Propagation §05 Règles métier TMS à effectuer (nouveau bloc R_M09 sous R4 existant).

---

## 11. Décisions structurantes M09 prises

| #                                          | Décision                                                                                                                                                                                                                                                                                        | Alternatives écartées                                                                                                                                               | Motif                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1**                                     | **Frontière documentaire avec M10** (option e validée Val 2026-04-25) — M09 décrit la sémantique stock matériel complète + owne stocks rolls traiteurs ; M10 garde workflow Veolia + UI page /exutoires + tables `stocks_bacs_entrepot` + `passages_veolia` + `recomptages_stocks_entrepot_log` | (b) Refactor data complet vers M09 ; (c) statu quo pas de M09 dédié                                                                                                 | Refactor lourd (4-5h) pour bénéfice marginal V1. Découpage actuel fonctionne. Option e = clarté docu sans refactor. Re-séparation V2 si déclencheur métier (multi-prestataires exutoires, multi-entrepôts)                                                                                  |
| **D2**                                     | **Granularité par type uniquement** (pas par numéro de série)                                                                                                                                                                                                                                   | Suivi par série unique (rolls trackés individuellement RFID/QR)                                                                                                     | V1 simplicité + coût lecture QR/RFID terrain non justifié pour le métier. V2 si traçabilité fine devient business case (vol, perte, audit qualité)                                                                                                                                          |
| **D3**                                     | **Tares paramétrables Admin TMS via M13** avec seed initial : roll Savr 400L = **40kg** (ajustement Val 2026-04-25 — vs 14kg legacy `roll_240L` qui ne correspond pas au roll Savr réel), bac 1100L = 60kg, bac 660L = 40kg, bac 240L = 14kg, sac = 0.5kg                                       | Tares hardcodées en config                                                                                                                                          | Permet ajustement post-pesée à blanc Val sans redéploiement. Snapshot pesées préserve l'historique. Renommage seed `roll_240L` → `roll_savr_400L` (slug) à propager §04 niveau 2 (cf. QO M09.6)                                                                                             |
| **D4**                                     | **Inventaire trimestriel V1.1** (arbitrage 2 audit cohérence inter-CDC 2026-04-25) — pas de cron magic link traiteur V1, déclarations chauffeur + recompte Ops Savr suffisent                                                                                                                   | (a) V1 complet (cron + magic link traiteur + UI write spécifique) ; (c) V1 minimaliste bouton Ops envoie email statique                                             | Pas critique go-live. Effort tech moyen. Bloqué par Q7 inventaire physique de toute façon. Mieux : valider mécanique stock auto en V1, ajouter inventaire V1.1 quand écarts terrain seront mesurables                                                                                       |
| **D5**                                     | **Alerte `m09_stock_bas` en V1** (arbitrage 3 audit cohérence inter-CDC 2026-04-25 — correction M11 catalogue ligne 761 V1.1 → V1)                                                                                                                                                              | V1.1 (alignement M11 catalogue initial)                                                                                                                             | Alerte fondamentale pour éviter ruptures terrain, code SQL trivial vu R4.2. Pas de raison de reporter. Propagation immédiate M11 catalogue (cf. tâche A.bis cette session)                                                                                                                  |
| **D6**                                     | **Paliers UI prep tournée dans M04 uniquement** (arbitrage 5 audit cohérence inter-CDC 2026-04-25, pas dans M02)                                                                                                                                                                                | (a) M02 dispatch + M04 ; (c) M02 seul                                                                                                                               | M02 = dispatch collecte (prestataire), pas l'endroit pour parler matériel. M04 = constitution tournée = bon endroit (Ops y reste pour finaliser). Évite polluer dashboard M02                                                                                                               |
| **D7** _(révisé §08 Bloc A 2026-05-01 A3)_ | **Lecture cross-schema directe — vue `plateforme.v_stocks_rolls`** (remplace l'ex-décision "push webhook S8 obligatoire")                                                                                                                                                                       | (a) Push webhook S8 + table miroir `lieux_stocks_rolls` (décision initiale, abandonnée) ; (b) Polling Plateforme ; (c) pas de push (Plateforme reconstruit logique) | DB partagée Plateforme/TMS : écriture une seule source physique (`tms.stocks_rolls_traiteurs`), lecture par vue = MAJ temps réel sans réseau ni retry. Supprime le push HTTP, la table miroir `lieux_stocks_rolls`, l'alerte `m09_webhook_s8_dlq` et R_M09.7. TMS = source de vérité unique |
| **D8**                                     | **Pas d'écran stock côté chauffeur V1** (chauffeur n'a pas vue UI stock traiteur, juste inputs déclaration M05)                                                                                                                                                                                 | (a) Écran lecture stock courant pour info chauffeur                                                                                                                 | Ajout UI mobile = effort PWA non justifié V1. Chauffeur a juste besoin de saisir, pas de consulter. Si retour terrain V1.5 demande, ajout simple (1 écran lecture)                                                                                                                          |
| **D9**                                     | **Stock multi-entrepôts traiteur** géré via `plateforme_lieu_id` nullable (UNIQUE composite) — ne s'active que si traiteur a > 1 lieu actif                                                                                                                                                     | Refacto V3 entrepot_id dédié                                                                                                                                        | Nullable suffit V1 pour 95% des cas (1 traiteur = 1 lieu). Si traiteur multi-lieux, stock par lieu activé naturellement. V3 si entrepôt Savr secondaire ouvre                                                                                                                               |
| **D10**                                    | **Recompte Ops traçé en `tms.audit_logs` action `M09_RECOMPTE_ECART_ROLLS`** si écart absolu ≥ 3 OU relatif ≥ 30% (audit only, pas notif) — révisé Bloc 3 sobriété 2026-04-25 A1 (initialement alerte M11 info, dégagée)                                                                        | (a) Pas de trace ; (c) trace warning systématique                                                                                                                   | Audit_logs = source de vérité audit, sans pollution de la table `tms.alertes`. Permet exploitation V2 (dashboard qualité saisie chauffeur — E5 dégagée revue sobriété 2026-04-25 A2, à recréer V1.1). Aligné avec M10 D10 trace écarts recompte bacs (révisé Bloc 3 idem)                   |

---

## 12. Questions ouvertes M09

1. **Inventaire physique initial** (Q7 Index TMS) — stocks initiaux partiels confirmés Val 2026-04-28 : Roll 850L emboîtable = 60, Roll pliable = 8. Répartition par traiteur à saisir par Ops Savr via E3 J0 (migration D4 A5=c). Bacs entrepôt seedés M10 (cf. §04 seed confirmé).
2. — **Résolu (Val 2026-04-28)** : tares confirmées et propagées §04 `types_contenants` seed. Roll 850L emboîtable = **37 kg**, Roll pliable = **26 kg**, Bac 1100L = **50 kg**, Bac 240L = **11 kg**, Sac = 0,5 kg. Mécanisme update Admin TMS via E4 (W4) inchangé.
3. **Codes alertes M09 V1 (révisé Bloc 3 sobriété 2026-04-25 + §08 Bloc A 2026-05-01)** : `m09_stock_bas` (warning), `m09_stock_negatif` (warning), `m09_tare_manquante` (warning) à seeder dans `alertes_catalogue` M11 — **aucun critical** (`m09_webhook_s8_dlq` supprimé §08 Bloc A A3). Codes ex-`info` retirés du catalogue Bloc 3 A1 (`m09_recompte_ecart_rolls`, `m09_tare_modifiee`, `m09_stock_initial_inconnu`) tracés directement en `tms.audit_logs`.
4. **Multi-entrepôts central + secondaire** — V1 mono-entrepôt central. Si Savr ouvre 2ème entrepôt V3, refacto avec `entrepot_id`. Pas anticipé V1.
5. **UI historique mouvements traiteur > 30** — V1 limite 30 mouvements affichés E2. Si retour Ops besoin > 30 → ajouter pagination V1.5.
6. **Renommage seed `roll_240L` → `roll_savr_400L`** dans `types_contenants` (cf. D3) — cohérence libellé avec réalité physique. Propagation §04 niveau 2 + impact M05 si chauffeurs ont déjà sélectionné `roll_240L` historiquement (data migration V0). À traiter dans propagation cette session.
7. **Délégation compte agent entrepôt V1.5** (alignement M10 D11) — créer rôle `agent_entrepot` avec accès limité E3 (rolls) + E_M10 E7 (bacs entrepôt) ? Reporté V1.5 selon retour terrain (charge Ops si trop d'allers-retours).
8. **Contact Ops traiteur pour V1.1 inventaire trimestriel** — table `contacts_traiteurs` Plateforme déjà créée (§04 Plateforme), à exposer via API ou cross-schema lecture pour M09 V1.1 cron. Pas spec V1.

---

## 13. Liens

### CDC TMS

- [[../03 - Périmètre fonctionnel TMS#M09 — Stock matériel Savr|§03 M09]] — vue macro
- [[../04 - Data Model TMS#Niveau 4 — Stock et exutoires|§04 niveau 4]] — `stocks_rolls_traiteurs`, `rolls_mouvements`
- [[../04 - Data Model TMS#Niveau 2|§04 niveau 2]] — `types_contenants` (référentiel + tares)
- [[../05 - Règles métier TMS#R4 — Stock rolls et alertes (M09 + M11)|§05 R4]] — règles stock rolls (R4.1-R4.4 existantes + R_M09.5-R_M09.8 nouvelles à propager)
- [[../09 - Authentification et permissions TMS|§09]] — RLS Ops Savr / Admin TMS sur tables stock + types_contenants
- [[M04 - Gestion des tournées|M04]] — clôture tournée + affichage paliers W3
- [[M05 - App mobile chauffeur|M05]] — déclaration chauffeur rolls pleins/vides W8 → trigger M09 W1
- [[M10 - Gestion exutoires Veolia|M10]] — workflow Veolia (lecture `stocks_bacs_entrepot` + UI page /exutoires) — frontière documentaire D1
- [[M11 - Alerting transverse|M11]] — catalogue alertes M09 + dashboard Ops + résolution auto
- [[M13 - Administration TMS|M13]] — paramétrage tares (E4) + paliers pax (E5) via `parametres_tms` + référentiel `types_contenants`

### CDC Plateforme

- [[../../01 - Cahier des charges App/04 - Data Model|§04 Plateforme]] — vue cross-schema `plateforme.v_stocks_rolls` (lecture directe `tms.stocks_rolls_traiteurs` + `tms.types_contenants`, filtre RLS par traiteur). **supprimée revue sobriété §08 Bloc A 2026-05-01 A3**
- [[../../01 - Cahier des charges App/08 - APIs et intégrations|§08 Plateforme]] — **supprimé §08 Bloc A 2026-05-01 A3**, remplacé par lecture vue `plateforme.v_stocks_rolls`

---

## 14. Changelog

- **2026-06-07 — Session test-scenarios M09 (52 scénarios, `tests/M09-stock-materiel-scenarios.md`)** : 4 specs floues tranchées Val + propagées : **#1** `m09_stock_negatif` = warning confirmé (§05 R4.3 corrigé, ex-critical stale) ; **#2 BLOQUANT** §04 `rolls_mouvements` réécrit modèle M09 (FK `type_contenant_id` remplace enum `type_roll`, colonnes `source`/`motif`/`user_id`/`plateforme_lieu_id`/`delta`/`stock_apres`, `collecte_tms_id` nullable + CHECK par source + ON DELETE SET NULL, UNIQUE partiel `(collecte_tms_id, type_contenant_id)`, correction chauffeur = reversement delta — jamais de double comptage) ; **#3** écriture `types_contenants` = `admin_tms` seul (§09 §4 policy dédiée + matrice §04 corrigées, M09 E4 faisait foi) ; **#4** paramètre `palier_rolls_par_pax_seuils` + seed M09 (§05 R4.4 corrigé, ex-`_biodechet_` stale). Résidu stale §04 « poussée via webhook » corrigé au passage. (purge dette propagation §08 Bloc A)** : aucune nouvelle suppression métier (M09 déjà élagué 2026-04-30). Alignement du corps sur l'addendum 2026-05-01 (suppression webhook S8 déclarée en tête mais jamais propagée dans le corps). 9 références mortes nettoyées : §6 E3 + §7 W1/W2 (étapes "push S8" → lecture vue `v_stocks_rolls`), §8 EC5 (struck), §9 alertes (`m09_webhook_s8_dlq` retiré → M09 zéro critical), §9 QO3, §10 R_M09.7 (struck), §11 D7 (reformulé lecture cross-schema), §13 liens Plateforme (`lieux_stocks_rolls` struck), §3 migration (clause auto-résolution critical rendue moot). Granularité stock par lieu **conservée\*\* (nullable, coût ~0). Cross-CDC = 0 (§05/§08/§04/M11 + Plateforme déjà nettoyés).
- **2026-04-30 — Revue de sobriété M09** (8 simplifications) :
  - **A_M09_01** : email post-recompte E3 supprimé (self-notif sans valeur)
  - **A_M09_02** : KPI E1 « Nb mouvements rolls 7j » supprimé (vanity metric)
  - **A_M09_03** : KPI E1 « Nb recompte Ops 30j » supprimé (vanity metric)
  - **A_M09_04** : mode multi E3 supprimé (bouton « Recompter tous types » + variant RPC) — recompte unitaire seul
  - **A_M09_05** : KPI E1 « Nb traiteurs avec stock < 50% » supprimé (duplique tri par défaut tableau Section 1)
  - **B_M09_01** : badge UI Statut 4→3 valeurs (fusion « Critique » dans « Bas » — aucun comportement applicatif distinct, alerte M11 unique)
  - **B_M09_02** : invalidation cache `types_contenants:v=auto` après W4 retirée (TTL 60s naturel suffit, tare modifiée ~1×/trimestre)
  - **D_M09_02** : valeur enum `categorie = 'caisse'` retirée (seed `caisse_plastique` déjà archivé revue M05 2026-04-30, aucun row actif)
  - **Cross-CDC** : 0 impact Plateforme (toutes coupes UI/data internes TMS).
  - **Compteurs M09 post-sobriété** : KPI cards E1 4→1, badges UI Statut 4→3, modes E3 2→1, notifications utilisateur 1→0, étapes W4 6→5, valeurs enum `categorie` 5→4.

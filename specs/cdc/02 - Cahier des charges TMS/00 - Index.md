# Cahier des charges — Savr TMS

**Objectif** : spécifier le **Savr TMS**, application logistique propriétaire qui remplace MTS-1 (licence terminée). Le TMS communique avec la [[01 - Cahier des charges App/00 - Index|Plateforme Savr]] via API (webhooks + REST). Deux apps distinctes, deux bases distinctes, entités partagées par ID.

**Stack cible** : Claude Code + Supabase + sous-domaine `tms.gosavr.io`.


### Propagations Bloc A — détail par section

- **§04 Data Model TMS** : enum `statut_dispatch` (A1) ; nouvelle colonne `collectes_tms.date_assignation_execution` (A1) ; colonne `suggestions_attribution_log.override_by_ops_user_id` ex boolean (A4) ; nouvelle section addendum M12 §6 fonction `m12_enrich_override` (A4) ; nouvelle section addendum M07 §7 fonction + trigger `fn_m07_calc_cost`/`trg_m07_calc_cost` (A6) ; nouvelle colonne `collectes_tms.cout_reparti_centimes` (A6).
- **§04 Data Model Plateforme** : cache `nb_collectes_6_mois_cache` aligné sur enum 3 valeurs (A1).
- **§05 Règles métier TMS** : R6.1 `annulee` → `annulee_par_traiteur` (A1).
- **§08 Contrat API TMS** : pas d'impact (les mentions `a_attribuer` étaient déjà alignées).
- **§09 Auth TMS** : signature fonction `m12_enrich_override` détaillée + référence audit_logs append-only (A4).
- **§03 Périmètre fonctionnel TMS** : workflow attribution V1 + province (A1).
- **§00 Index TMS** : enum `attribuee_source` (A3) + récap propagations.
- **M01** : statut_dispatch transitions W3 + W4 (A1).
- **M02** : transitions W1/W2/W3/W5/W6/W7 + invocation RPC `m12_enrich_override` (A1+A4).
- **M03** : enum + colonne `statut` → `statut_dispatch` 8 occurrences (A1) ; webhook IDs S1/S2 8 occurrences (A2).
- **M04** : contraintes création tournée W1+W3+W7 (A1) ; suppression `m04_plaque_override_chauffeur` legacy avec strikethrough (A5) ; ligne 33 référence corrigée (A5).
- **M05** : ligne 243 référence corrigée vers `m05_plaque_override_chauffeur` (A5).
- **M07** : ligne 381 référence trigger pointe vers §04 §7 (A6).
- **M11** : +10 codes seedés au catalogue §11.2 (A5+A6) ; compteur "40+" → "51+" ; note B5 cleanup `m04_checklist_bypass` vs `m05_checklist_contournement_detecte`.
- **M12** : algorithme W1/W2/W6 + schéma SQL `suggestions_attribution_log` aligné colonne uuid (A1+A4) ; transitions §8 États 6 valeurs (A1).

### Bugs détectés et corrigés en propagation Bloc A

1. **M03 utilisait `collectes_tms.statut`** alors que la colonne s'appelle `statut_dispatch` partout ailleurs (5 modules + §04 alignés). Impact : RLS policies + lock optimiste cassés. Corrigé A1 (3 SQL + 1 RLS).
2. **`override_by_ops` boolean** alors que signature fonction et invocation M02 supposaient uuid. Impact : audit "qui a overridé" impossible. Corrigé A4 → `override_by_ops_user_id uuid FK auth.users(id)`.
3. **Schéma `audit_logs` faux dans fonction A4** initiale (`record_id`, `actor_user_id`). Schéma authoritative §04 ligne 2000-2014 = `row_id`, `acteur_user_id`, `acteur_type` NOT NULL, `action` enum strict, `diff` before/after. Corrigé.
4. **`collectes_tms.cout_reparti_centimes` manquant** alors que M07 ligne 415-417 le référence (répartition coût égale). Impact : trigger A6 échouait `column does not exist`. Corrigé A6 → ajout colonne `integer nullable`.
5. **Doublon `m04_plaque_override_chauffeur` vs `m05_plaque_override_chauffeur`** pour le même événement métier. Impact : R_M11.1 violée, code émetteur ambigu. Tranché option (a) — préfixe = module émetteur (M05). M04 §14bis legacy retiré (strikethrough).

**Mise à jour 2026-04-30 — Revue sobriété M10 (V3 sobre)** : suppression dualité `realise`/`confirme_at`, suppression confirmation chauffeur M05 (W13), suppression cron escalade gradient + auto-confirmation J+7, statut réduit à 3 valeurs, fusion alertes saturation (criticité dynamique). M10 V3 sobre désormais en **15 décisions D1-D15** (D14/D15 reformulées v3), **8 écrans E1-E8** (E5b supprimé), **10 workflows W1-W10** (W11.a/b/c + W12 supprimés), **règles R5.1-R5.8** (R5.4 v3 reset à déclaration, R5.4 bis/R5.9/R5.10 supprimées), **5 paramètres `parametres_tms.m10_*`** (3 délais escalade supprimés), **7 codes alertes M10 seed** (5 codes supprimés : `m10_bac_remplissage_85` fusion B3, `m10_passage_realise_non_confirme_j1`/`_j3` corollaire A2/A4, `m10_passage_auto_confirmee_j7` corollaire A3, `m10_chauffeur_signale_bacs_pleins` corollaire A1).

**Refonte M10 V3 sobre (2026-04-30) — points clés** :
- **Suppression dualité** `realise`/`confirme_at` : la déclaration `realise` par Ops (E5 avec checkbox `verification_video_at` obligatoire) **vaut confirmation effective** et déclenche reset total stock immédiat (R5.4 v3) via trigger `trg_m10_reset_total_pleins` simplifié sur transition `statut: planifie → realise`. 6 colonnes V2 confirmation supprimées (`confirme_at`, `confirme_par_user_id`, `confirme_par_chauffeur_id`, `confirmation_source`, `auto_confirmee_j7`, `auto_confirmee_at`, `commentaire_confirmation`). 4 CHECK constraints conditionnelles supprimées.
- **Suppression confirmation chauffeur M05 (A1)** : W13 supprimé, plus de modal "Confirmation passage Veolia" au démarrage tournée ZD, plus d'API `/tms/passages-veolia/{id}/confirmer-chauffeur`, plus d'API `/signaler-bacs-pleins`. Policies RLS `passages_veolia_chauffeur_*` retirées de §09.
- **Suppression cron escalade gradient (A4) + auto-confirmation J+7 (A3)** : ancien W12 supprimé, ancien cron `m10_escalade_non_confirme` supprimé, 3 paramètres délais (`m10_delai_escalade_warning_h`, `m10_delai_escalade_critical_h`, `m10_delai_auto_confirmation_h`) supprimés.
- **Statut réduit (D1/B1/B2)** : enum `passages_veolia.statut` 5 → 3 valeurs (`planifie / realise / annule`). Statut `confirme` (intermédiaire planning) supprimé. Statut `reporte` supprimé (= `annule + motif_annulation = 'report'` + colonnes `motif_annulation` enum 3 valeurs + `motif_annulation_libre` text + `passage_origine_id` FK self).
- **Fusion alertes (B3 + C1)** : `m10_bac_remplissage_85` (warning) fusionné dans `m10_bac_satur` criticité dynamique (warning ≥85%, critical au-delà). `m10_passage_realise_non_confirme_j1`/`_j3` fusionnés dans `m10_passage_non_confirme` criticité dynamique (warning J-1/J+1, critical > 1j de retard).
- **Anti-déconfirmation simplifié** : trigger `trg_m10_anti_deconfirmation` V3 RAISE EXCEPTION sur transition `realise → autre statut` uniquement (plus de gestion `confirme_at NOT NULL → NULL`).
- **Audit vidéo simplifié** : checkbox obligatoire E5 "J'ai vérifié via vidéosurveillance que les bacs ont été vidés" + colonne `verification_video_at` timestamp (audit simple inline, plus de second flux applicatif).

**Propagations refonte V3 sobre 2026-04-30** : §04 (refonte `passages_veolia` 5 colonnes nettoyées + 3 nouvelles colonnes V3 + 4 CHECK V2 supprimées + 2 fonctions SQL supprimées + 2 triggers supprimés + 1 cron supprimé + 5 codes alertes supprimés + 3 paramètres délais supprimés + suppression `quantite_pleine_recomptee` B5 + statut enum 5→3), §05 (R5.4 v3 reset à déclaration + R5.7 v3 simplifiée + R5.8 v3 simplifiée + suppression R5.4 bis/R5.9/R5.10 + R5.1 fusion C1 criticité dynamique + R5.2 motif_annulation + R5.3 fusion B3 criticité dynamique + R5.6 sans `quantite_pleine_recomptee`), §06 M10 (refonte complète V2 sobre — 8 écrans / 10 workflows / 13 EC / 15 décisions D1-D15 / 7 alertes / 5 paramètres / D14-D15 reformulées v3 + ancienne section axe 2 supprimée), §06 M05 (W13 supprimé + étape 8-bis W3 supprimée + 1 endpoint API chauffeur supprimé), §06 M11 (catalogue -5 codes + résolution auto sur déclaration `realise`), §09 (suppression 2 policies RLS chauffeur + 8 tests pgTAP V3 alignés Ops only), §03 (synthèse macro V2 sobre + 7 codes alertes), §00 Index TMS (entrée historique).

Historique antérieur conservé : M10 v1 2026-04-25 D1-D13 (décrémentation partielle, R5.4 v0) → M10 v2 2026-04-25 D1-D15 (R5.4 v2 reset total + dual confirmation) → **M10 V3 sobre 2026-04-30 D1-D15 reformulées v3 (déclaration vaut confirmation effective)**.

---

## Rôle métier du TMS (rappel)

- Réception des ordres de collecte depuis la Plateforme (webhook)
- Gestion de l'acceptation par les prestataires logistiques (Strike, Marathon, futurs)
- Regroupement des collectes en **tournées** (1 camion → N collectes, même créneau, même zone)
- Saisie des informations chauffeur (nom, téléphone, plaque)
- Saisie des pesées brutes (push vers Plateforme pour facturation)
- Pilotage financier logistique (tarifs prestataires, calcul coût course)
- Exécution opérationnelle terrain (app mobile chauffeur V1.1 ou V2)

---

## ⚠ Addendum 2026-05-01 — Audit cohérence inter-CDC pré-handoff (skill `coherence-inter-cdc`) — restauration `plaque_requise` cross-CDC

**Annulation partielle revue sobriété M05 2026-04-29 + Bloc C C3** sur la chaîne `plaque_requise` (besoin métier "commercial traiteur demande la plaque pour contrôle d'accès anticipé site → manager prestataire pré-saisit M03 E4 → blocage validation tournée si manquante" non couvert par la lecture cross-schema seule).

**Restauration complète** :
1. **Data Model TMS** (§04) : `tms.collectes_tms.plaque_requise` + `tms.tournees.plaque_preassignee_manager` + `plaque_preassignee_par_user_id` + `plaque_preassignee_at` + trigger DB `validate_tournee_plaque_requise` (R_M04.PLAQUE).
2. **Règles métier TMS** (§05) : R_M03.4 (plaque conditionnelle niveau lieu avec override collecte) + R_M04.PLAQUE (trigger DB blocage validation tournée). Exception A Toutes! vélo cargo dans le trigger.
3. **Workflow M03 E4** (§06) : Section 3 véhicule obligatoire si `plaque_requise=true`, Section 5 validation tournée déclenche webhook S7. **Dette R_M03.X reconciliée 2026-05-02 (Option C)** — duplication §06 M03 supprimée, source de vérité unique §05 TMS R_M03.1 → R_M03.12 (R_M03.11 + R_M03.12 ajoutés depuis ex-§06 R_M03.4 + R_M03.5).
4. **Contrat API §08** : champ `plaque_requise` actif dans payload E1 (plus rétrocompat). Webhook S7 `plaque-saisie` restauré (annulation Bloc C C3) — émis à la saisie manager M03 E4 uniquement (Option B Val : plaque chauffeur terrain M05 reste TMS-only). Compteur endpoints API V1 : 11 → **12 endpoints actifs** + 2 vues.

**Côté Plateforme** : restauration `lieux.plaque_requise_default` + `collectes.plaque_requise` + `tournees.plaque_immatriculation` + `plaque_saisie_at`. Restauration formulaire programmation §06/01 section 2.e + dashboard §11 picto plaque. Message UX vélo cargo "Vélo cargo — pas de plaque possible" (soft, soumission autorisée).

**Arbitrages Val 2026-05-01** : Vélo cargo = exception trigger TMS + message UX inline Plateforme (pas de blocage hard) | S7 = unique sur saisie manager M03 E4 (Option B) | `collectes.plaque_requise` description = Option A (sémantique pré-2026-04-29).

> ⚠ **Mise à jour 2026-05-03 (refonte formulaire §06.01 Plateforme)** : la chaîne `plaque_requise` ci-dessus a été **renommée + étendue** :
> - `plaque_requise` → `controle_acces_requis` (flag unique plaque + nom chauffeur)
> - `plaque_requise_default` → `controle_acces_requis_default`
> - Trigger `validate_tournee_plaque_requise` → `validate_tournee_controle_acces` (validation étendue à `tournees.chauffeur_id IS NOT NULL` en plus de la plaque)
> - R_M04.PLAQUE → R_M04.CONTROLE_ACCES
> - Webhook S7 payload enrichi : ajout `chauffeur_nom` (lu via JOIN `chauffeurs.nom_complet` sur `tournees.chauffeur_id`)
> - Côté Plateforme : restauration `tournees.chauffeur_nom` en plus de `tournees.plaque_immatriculation`
> - Cascade upgrade-only sur le lieu (R_controle_acces_cascade §05 App) : cocher au formulaire = update lieu, décocher = pas d'update (downgrade Admin uniquement)
>
> Toutes les mentions ci-dessus doivent être lues avec ces renommages. Voir mémoire `project_refonte_formulaire_2026_05_03`.

**9 fichiers édités** (Plateforme + TMS).

**Résiduel BLOC B + A5 traité dans la même session 2026-05-01** :
- ✅ §00 Index TMS L76 (tableau §08) + L138-140 + L162 + L170 — 4 lignes mises à jour (12 endpoints actifs, S7 restauré, cap 3 retries, retry 3 paliers).
- ✅ §08 TMS L189 — champ `version` payload supprimé (cohérence Bloc B B3).
- ✅ §08 TMS + §07 TMS + Plateforme — sweep "5 paliers" → "3 paliers" sur les justifications actives (notes historiques "ex-5 paliers" conservées).
- ✅ §07 Plateforme L340 — typo "2 schémas" → "3 schémas" corrigée.

**Run final 2026-05-02 (skill `coherence-inter-cdc`) — pré-V0 Plateforme** :
- ✅ §04 Plateforme L85-87 — addendum plaque traiteur : titre + NOTE 2026-04-29 "RETIRÉ" remplacés par "RESTAURÉ 2026-05-01 (audit cohérence inter-CDC)" avec récap chaîne complète + exception vélo cargo (alignement avec restauration 2026-05-01).
- ✅ §00 Index TMS L157 — réécrite : retrait "plaque ex-S7 supprimé Bloc C C3", ajout "Webhook S7 `plaque-saisie` **restauré 2026-05-01 audit cohérence inter-CDC**".
- ✅ §00 Index TMS L272 (tableau Bloc C) — ligne C3 strikethrough + restauration C3 inline ajoutée.
- ✅ §00 Index TMS L295 — compteur "11 endpoints actifs" → "12 endpoints actifs" avec liste S1-S11 explicitant S7.
- **CDC TMS désormais cohérent figé** pour la décision V1 = Plateforme seule (roadmap 2026-04-30). Reste avant handoff dev TMS V2 : ✅ traité 2026-05-02 — voir bloc suivant, §16 Roadmap TMS, audit RLS, scénarios Gherkin, migration MTS-1, fixtures, observabilité, perf, handoff, cutover.

**Réconciliation dette intra-TMS R_M03.X 2026-05-02 (Option C — source de vérité unique §05 TMS)** :
- Diagnostic : §05 TMS et §06 M03 avaient 2 listes R_M03.X partiellement disjointes avec numérotation divergente (§06 utilisait une numérotation locale incohérente avec §05 référencée par §03/§04/§08/§12/§15). 10 fichiers TMS référençaient R_M03.X.
- ✅ §05 TMS — ajout R_M03.11 (Fenêtre de modification assignation, ex-§06 R_M03.4) + R_M03.12 (Blocage archivage chauffeur avec tournées futures, ex-§06 R_M03.5). Enrichissement R_M03.8 (email Ops, désactiver, PTAC) + R_M03.9 (lock collectes post-facture, ex-§06 R_M03.9).
- ✅ §06 M03 — section "11. Règles métier R_M03.x" remplacée par une **table de mapping** vers §05 (12 règles avec lien Wiki direct) + un bloc "Mapping ancien → nouveau" pour préserver la traçabilité des refs historiques.
- Refs cross-files §03/§04/§08/§12/§15 : déjà cohérentes avec §05 (aucun changement nécessaire).
- Catalogue R_M03.X final : R_M03.1 → R_M03.12 (10 actives + 1 supprimée + 1 ré-introduite vs ancien). Source de vérité unique = §05.
- 3 fichiers édités : §05 Règles métier TMS + §06 M03 + §00 Index TMS.

---

## ⚠ Addendum 2026-05-07 — Audit cohérence inter-CDC Run 6 (skill `coherence-inter-cdc`)

Audit déclenché par les modifs cumulées 2026-05-04 → 2026-05-07 (refontes §06.03, §06.04 ×2, §06.01 §2.a + suppression `notes_client`, Taux de recyclage, Extension programmation 3 types). Anti-régression confirmée pour tous les audits antérieurs (Runs 1-5).

**3 divergences bloquantes corrigées immédiatement** :

- **A1 — Sous-objets payload E1 désalignés** : §08 App L69 utilisait `traiteur_operationnel_snapshot` + `programmateur_snapshot`, contradictoire avec spec contractuelle §08 TMS L342+L351 sans suffixe `_snapshot`. Suffixe retiré côté App pour aligner sur la convention payload (où `lieu` et `contacts` sont aussi sans suffixe). Invariant V1 `traiteur_id = traiteur_operationnel.organisation_id` ajouté dans la même ligne (traite aussi B2 — rétrocompatibilité TMS via champ `traiteur_id` racine pointant systématiquement sur le producteur juridique).
- **A2 — Statut `attribuee` inexistant dans enum miroir 8 valeurs** : §08 TMS L437 + M04 TMS L500 utilisaient `statut_tms = attribuee` (valeur absente de l'enum miroir 8 valeurs `non_envoye, a_attribuer, attribuee_en_attente_acceptation, acceptee, en_attente_execution, rejetee_par_prestataire, annulee_par_traiteur, rejetee_par_tms`). Remplacé par `statut_dispatch = attribuee_en_attente_acceptation` (champ et valeur cohérents).
- **A3 — Statuts hors enum + `cloturee` inexistant nulle part** : §08 TMS L436 + M04 TMS L499 utilisaient `statut_tms = realisee, en_cours, terminee, cloturee` (aucune des 4 valeurs n'est dans `statut_tms` 8 valeurs miroir ni dans `statut_dispatch` 6 valeurs ; `cloturee` n'existe ni dans `statut_operationnel` collecte ni dans `tournees.statut`). Reformulé : `collectes_tms.statut_operationnel ∈ (en_cours, realisee, realisee_sans_collecte, incident)` (bon enum + bon champ pour bloquer modif sur exécution démarrée/terminée). Suppression définitive de `cloturee`.

**1 zone grise traitée** :

- **B1 — Lien Wiki cassé §08 TMS L411** : ancre cible `Modification des informations d'une collecte à venir` inexistante dans §06.04 App. Harmonisé sur le titre réel `Édition d'une collecte à venir (refonte 2026-05-04 + sobriété 2026-05-04)`.

**Aucune section manquante bloquante.** Audit clos pour le périmètre des modifs 2026-05-04 → 2026-05-07. CDC App + TMS cohérents.

4 fichiers édités : §08 App + §08 TMS + M04 TMS + §00 Index App. + ce §00 Index TMS pour traçabilité.

---

## État d'avancement

| # | Section | Statut | Priorité |
|---|---------|--------|----------|
| 00 | [[00 - Index]] | En construction | 1 |
| 01 | [[01 - Vision et objectifs TMS]] | **V1 rédigée** (§1 à §7) | 1 |
| 02 | [[02 - Personas TMS]] | Couvert dans §01 §3 — à étoffer si besoin | 1 |
| 03 | [[03 - Périmètre fonctionnel TMS]] | **V1 rédigée** — 14 modules V1 + 2 modules V2, décisions tracées | 1 |
| 04 | [[04 - Data Model TMS]] | **V1 rédigée** — 27 tables sur 6 niveaux, RLS multi-tenant, formules configurables Admin TMS | 1 |
| 05 | [[05 - Règles métier TMS]] | **V1 rédigée** — attribution (R1), calcul coût (R2), rapprochement factures (R3), stock rolls (R4), Veolia (R5), cycles de vie (R6) | 1 |
| 06 | [[06 - Fonctionnalités détaillées TMS]] | **V1 rédigée — 14/14 modules clôturés** : M01 + M02 + **M03** (V1 rédigée 2026-04-24, 16 décisions) + M04 + **M05** (V1 rédigée 2026-04-24) + M06 + M12 + **M07** (V1 rédigée 2026-04-24) + **M08 Facturation prestataires** (V1 rédigée 2026-04-24) + **M11 Alerting transverse** (V1 rédigée 2026-04-24 : 13 décisions, catalogue 40+ codes seed) + **M10 Gestion exutoires Veolia** (V2 sobre 2026-04-30 : 15 décisions D1-D15 reformulées v3, déclaration `realise` Ops vaut confirmation effective, suppression dualité + W13 chauffeur + cron escalade gradient + 5 codes alertes) + **M13 Administration TMS** (V1 rédigée 2026-04-25 : 15 décisions D1-D15, secrets Vault + Edge Function, session 30j glissantes admin+ops, wizard onboarding 4 étapes, impersonation tracée double acteur) + **M09 Stock matériel Savr** (V1 rédigée 2026-04-25 + revue sobriété appliquée 2026-04-30 : option e frontière documentaire avec M10, 10 décisions D1-D10, R_M09.5-R_M09.8 ; 8 simplifications sobriété 2026-04-30 : KPI cards E1 4→1 [A_M09_02/03/05], badge UI Statut 4→3 [B_M09_01], modes E3 2→1 mode multi retiré [A_M09_04], notifications utilisateur 1→0 self-email retiré [A_M09_01], invalidation cache W4 supprimée TTL 60s naturel [B_M09_02], enum `types_contenants.categorie` 5→4 valeurs `caisse` retiré [D_M09_02]) + **M14 Intégration Everest** (V1 rédigée 2026-04-25 + revue sobriété appliquée 2026-04-30 : 10 décisions D1-D10, **4 écrans** (E1-E2-E4 + E5 tab Everest M13 absorbe ex-E3), **7 workflows** (W7 Replay supprimé), 12 edge cases, 8 règles, **10 codes alertes** catalogue M11 dont `m14_everest_mission_late` seedé `active=false`, sécurité webhook token header filet V1 + HMAC Q2, course incomplète Q1, single source of truth `everest_service_id_target` sur `collectes_tms` posée par M12) — **0 module V1 restant** + 2 V2 (M15 routing, M16 BSD) | 2 |
| 07 | [[07 - Architecture technique TMS]] | **V1 rédigée** (atelier tech 2026-04-23) — 1 projet Supabase 3 schémas, monorepo pnpm+Turborepo, Next.js 15, Vercel 2 fronts, R2 + Supabase Storage, Mistral OCR, PgBouncer, PWA M05, kill switches | 2 |
| 08 | [[08 - Contrat API Plateforme-TMS]] | **V1 rédigée + revue sobriété §08 COMPLÈTE 2026-05-01 + restauration S7 audit cohérence inter-CDC 2026-05-01** — 12 endpoints actifs (4 entrants : E1, E2, E3, E5 + 8 sortants : S1, S2, S3, S4, S5, S7, S9, S11) + 2 vues cross-schema (`v_courses_logistiques`, `v_stocks_rolls`), auth HMAC+JWT, idempotence event_id, retry 3 paliers (5 min / 1h / 24h), dédup 7j | 2 |
| 09 | [[09 - Authentification et permissions TMS]] | **V1 rédigée + audit RLS 2026-06-05** — 4 rôles, cumul ops+manager interdit V1, SSO Google Ops/Admin V1, MFA TOTP Admin, policies RLS SQL par table (A3 §1-21), workflow invitation, RGPD + CGU distinctes + fin contrat prestataire 30j | 2 |
| 10 | [[10 - Design System TMS]] | **V1 rédigée 2026-04-28** — palette couleurs complète (savr-green/warning/critical/info + neutres), typographie Inter, 14 composants `packages/ui-tms`, Recharts V1 définitif (Tremor rejeté), principes UX terrain, responsive consolidé, évolution UX via Claude Design V1.1+ | 3 |
| 11 | [[11 - Dashboards TMS]] | **V1 rédigée 2026-04-27** — index transverse 14 dashboards par rôle, routes normalisées `/{section}` + `/admin/*`, pattern export commun, cumul cross-app sidebar, gating /403 audit, composants partagés `packages/ui-tms` | 3 |
| 12 | [[12 - App mobile chauffeur]] | **V1 rédigée 2026-04-27** — vue transverse + 9 décisions D1-D9 (PWA `tms.gosavr.io/m/*` mono-domaine, OS iOS 16.4+/Android 10+, Service Worker Serwist, offline-first complet V1, émetteur Web Push = Edge Function Supabase, géoloc **écran d'information à l'inscription** (D6 refondu Bloc 3 2026-06-04, base légale intérêt légitime, ex-CGU sans UI), force change password 1ère connexion, formation = PDF mémo manager prestataire, kill switch toast non-bloquant + grace 24h) | 3 |
| 13 | [[13 - Migration MTS-1]] | **V1 rédigée 2026-04-27** — 10 décisions D1-D10, double-run total 1 mois (Bubble/MTS-1 source légale + Savr shadow), mode migration runtime (paramètre + filtre Pennylane + audit + bandeau), plan consolidation stocks J+7/J+15/J+30, checklist go/no-go 12 critères, plan rollback (prolongation MTS-1 +1 mois + mode dégradé Admin Savr), comm J-30 + présentiel majeurs, Val pilote 100% + Louis backup nominé | 3 |
| 14 | [[14 - Scalabilité TMS]] | **V1 rédigée** (atelier tech 2026-04-23) — volumes V1/V2/V3, Supabase Pro suffit V1, triggers upgrade, p95 M02 < 1.5s / PWA < 200Ko, Paris single-region, purge géoloc 30j | 3 |
| 15 | [[15 - Sécurité et conformité TMS]] | **V1 rédigée** (atelier tech 2026-04-23) — pgTAP bloquant (couverture ciblée V1, 100% policies V1.1 — aligné App, arbitrage Val 2026-06-03), cross-schema deny, HMAC rotation annuelle, ⚠⚠ pas de RGPD tech structurant V1 (exception Bloc 3 : écran d'information géoloc à l'inscription + base légale intérêt légitime, §15.4.1 refondu), ⚠ pas d'audit externe V1, RPO 1h/RTO 4h, runbook DR 4 scénarios | 3 |
| 16 | [[16 - Roadmap et priorisation TMS]] | À démarrer | 3 |

**Légende priorité** : 1 = fondations indispensables, 2 = cœur métier + contrat API, 3 = optimisations + UX terrain + ops.

---

## Cohérence avec le CDC Plateforme

Le TMS ne vit pas en silo. Chaque spec TMS doit croiser :

- [[01 - Cahier des charges App/08 - APIs et intégrations]] — Contrat API côté Plateforme (webhooks entrants depuis TMS, endpoints exposés, supprimé revue sobriété §08 Bloc A 2026-05-01 A4, notion de tournée)
- [[01 - Cahier des charges App/04 - Data Model]] — Entités conceptuellement partagées : `tournees`, `collectes`, `courses_logistiques`. Le TMS a sa **propre base** mais référence les IDs Plateforme
- [[01 - Cahier des charges App/03 - Périmètre fonctionnel global]] — Module 9 TMS (statut acceptation, tournées, plaque chauffeur)

Toute divergence détectée entre un choix TMS et le CDC Plateforme doit être signalée à Val pour réconciliation ou documentation explicite comme décision consciente.

---

## Questions ouvertes (à trancher avec Val)

> **Nettoyage Bloc 3 (2026-06-04)** : reclassement complet. 3 familles — (1) **décisions spec résolues** (barrées) ; (2) **actions Val externes** (calendrier / commercial / juridique, pas des décisions spec → suivies dans « Actions Val hors spec » + TO DO) ; (3) **V2 / tuning opérationnel** (étiquetés, non bloquants V1). **Résultat : plus aucune décision spec V1 en suspens dans le périmètre TMS.**

1. — **Fait le 2026-04-21**. 10 modifications appliquées, cohérence CDC Plateforme ↔ CDC TMS restaurée.
2. — **Résolu 2026-04-22**. `tournee_id UNIQUE`, répartition prorata nb_collectes. MAJ §04 + §05 Plateforme + §04 TMS + §01 Vision TMS Q5.
3. **[ACTION VAL — calendrier]** Date d'échéance licence MTS-1 — inconnue, action Val prioritaire. Conditionne le planning V1 (go-live V1 = échéance − 1 mois de double-run). *Pas une décision spec — suivi « Actions Val hors spec » + TO DO. Retirée de la liste des décisions spec ouvertes (Bloc 3 2026-06-04).*
4. **[ACTION VAL — juridique]** Validation juriste RSE/RGPD — exposition risque amende BSD (V2) + obligations Registre transport, **+ base légale géoloc chauffeur (intérêt légitime) + notice d'information + opportunité AIPD (ajout Bloc 3, cf. §15.13 Q5)**. À valider avant go-live V1. *Action Val externe, suivi TO DO.*
5. **[OPÉRATIONNEL — mesure onboarding]** Baselines opérationnelles V1 — marge %, délai dispatch→assignation, délai collecte→facture prestataire. Se mesurent à l'onboarding, pas une décision spec. *Non bloquant V1 (Bloc 3 2026-06-04).*
6. **[ACTION VAL — opérationnel]** Seed data depuis MTS-1 — export + nettoyage. **Côté spec : résolu (§13 Migration MTS-1, Val pilote 100% + Louis backup).** Reste l'extraction effective = action Val. *Suivi TO DO.*
7. — **Résolu (Bloc 3 2026-06-04)** : stocks totaux confirmés Val 2026-04-28 (Roll 850L=60, Roll pliable=8, Bac verre 240L=20, Bac biodéchet 240L=8, Bac déchet résiduel 1100L=20, Bac emballage 1100L=6). Répartition par traiteur = process Ops Savr E3 à J0 migration (défini). Plus de décision spec en suspens.
8. **[ACTION VAL — commercial]** Tarif camion Strike en cas de prolongation de vacation — non négocié. **Côté spec : 0 impact (le data model encaisse n'importe quel tarif via grille versionnée `grilles_tarifaires_prestataires`).** Action Val. *Suivi TO DO.*
9. **[ACTION VAL — commercial]** Tarifs Marathon en cas de dépassement 4h — à clarifier avec Marathon. *Idem Q8 : 0 impact spec (grille versionnée). Action Val, suivi TO DO.*
10. — **Résolu (Val 2026-04-28)** : Roll 850L emboîtable = **37 kg**, Roll pliable = **26 kg**, Bac 1100L = **50 kg**, Bac 240L = **11 kg**, Sac = 0,5 kg. Propagé §04 `types_contenants` seed (confirmé, non indicatif).
11. — **Résolu (Bloc 3 2026-06-04)** : `types_vehicules` est une table paramétrable Admin TMS → ajout d'un type = saisie d'une ligne, aucun chantier schéma. Extensibilité déjà acquise par design. Plus une question.
12. — **Résolu Bloc 3 2026-06-04** : (a) base légale requalifiée **intérêt légitime** (≠ consentement); (b) **écran d'information bloquant à l'inscription** PWA (M05 W1 étape 5-bis) + trace `users_tms.consentements.geoloc_notice` + versioning, pas d'UI après inscription (arbitrage Val « point 4 » rejeté); (c) **suppression docs = cron seul** > 3 ans, pas de purge anticipée (3a). Propagé §15.4.1 + §15.5.1, §09 A5 (réconciliation modèle in-app stale), §04 `users_tms.consentements`, §12 D6, M05 W1/W2. Reste action Val : validation juriste (Q4) + privacy publique.
13. — **Résolu** : M12 Attribution transporteur entièrement spécifié 2026-04-24 (R1 7 branches, 5 triggers, codes canoniques). Marqué résolu Bloc 3 2026-06-04.
14. **[TUNING — post-V1]** Valeurs paliers rolls par pax — seed V1 en place et paramétrable (<100pax=1, 100-200=2, 200-400=4, 400-800=8), affinage à l'usage terrain. *Non bloquant V1, pas une décision spec en suspens (Bloc 3 2026-06-04).*
14bis. **[V2 — étiqueté, non bloquant V1]** Multi-vélo AG automatique (chantier TMS V2) — mécanique figée (héritée multi-camions), V1 = workaround manuel. Sous-point à traiter au démarrage TMS V2 : complétude AG du S5 agrégé. Décidé côté Plateforme 2026-05-29 : pour une grosse collecte AG de jour servie en vélo cargo A Toutes!, le TMS doit programmer **N courses Everest automatiquement** et agréger poids/coût au niveau collecte. **Réutilise le substrat multi-camions** (`tms.collecte_tournees` N↔N, S5 terminal agrégé, dispatch M04 "+ Ajouter un camion" — déjà en place, cf. Q15). Reste à confirmer la complétude AG du S5 agrégé : signature asso, déclenchement attestation 2041-GE Plateforme sur poids total, conversion poids→repas agrégée. V1 = workaround manuel hors TMS (1 course Everest Plateforme + duplication A Toutes!). Cf. [[01 - Cahier des charges App/06 - Fonctionnalités détaillées/09 - Flux algo attribution AG (Admin)]] §2.3 + Décisions.
15. — **RÉSOLU 2026-05-25 (session `cdc-tms-savr`)**. Table de liaison `tms.collecte_tournees` (N↔N), `collectes_tms.tournee_id` retiré, coût+ordre sur la liaison, dispatch M04 E1bis "+ Ajouter un camion", S3 réconcilie la liaison, S5 terminal unique, clôture chauffeur + statut collecte dérivé (R6.1/R6.2). 8 fichiers TMS propagés zéro dette. Cf. décision structurante ci-dessous + [[01 - Cahier des charges App/00 - Index]]. **Reste signalé** : écart noms colonnes vue App↔TMS (`cout_par_collecte_ht` vs `cout_reparti_centimes`) → run `coherence-inter-cdc`.

---

## Décisions structurantes prises

*Rappel des décisions Plateforme impactant directement le TMS (sources : [[01 - Cahier des charges App/00 - Index]]) :*

### Contexte et architecture
- **Architecture 2 apps** : Plateforme Savr + Savr TMS, communicants via API, isolation risques + cycles de dev
- **Sous-domaine TMS** : `tms.gosavr.io` (Plateforme : `app.gosavr.io`, webhooks entrants : `api.gosavr.io/webhooks/*`) — validé 2026-04-21
- **Stack TMS** : Supabase (DB + Auth + Storage + RLS) — identique Plateforme pour mutualiser l'expertise
- **MTS-1 terminé** : licence arrêtée, plus de fallback. En cas d'indisponibilité TMS : commandes manuelles Admin Savr

### Contrat API Plateforme↔TMS
- **Event-driven webhooks** uniquement *(polling fallback supprimé revue sobriété §08 Bloc A 2026-05-01 A4 — retry 3 paliers + dédup `integrations_inbox` couvrent les pannes <24h, intervention manuelle au-delà)*
- **Lecture cross-schema directe** Plateforme ← TMS via vues `plateforme.v_courses_logistiques` (ex-S6 supprimé Bloc A A2) + `plateforme.v_stocks_rolls` (ex-S8 supprimé Bloc A A3). Webhook S7 `plaque-saisie` **restauré 2026-05-01 audit cohérence inter-CDC** (annulation Bloc C C3) — alimente `plateforme.tournees.plaque_immatriculation` + `plaque_saisie_at` à la saisie manager M03 E4 (Option B Val : plaque chauffeur terrain M05 reste TMS-only).
- **Retry policy uniforme 3 paliers** : 5 min / 1h / 24h *(simplifié revue sobriété §08 Bloc B 2026-05-01 B1 — ex-5 paliers)*, dédup via `event_id` payload (header `Idempotency-Key` supprimé Bloc C C4)
- **Header `X-API-Version` autoritatif unique** *(double ceinture champ payload supprimée Bloc B B3)*, **photos en payload `photos: string[]` array unique** *(fusion `photo_url`/`photos_urls` Bloc B B2)*, **pas de geoloc S4** *(Bloc B B4)*, **dédup 7j** *(retour ex-30j Bloc B B5)*
- **12 endpoints API V1 actifs** (16 → 11 Blocs A+B+C, puis 11 → 12 restauration S7 audit cohérence inter-CDC 2026-05-01) : 4 entrants (E1, E2, E3, E5) + 8 sortants (S1, S2, S3, S4, S5, **S7**, S9, S11) + 2 vues cross-schema
- **Webhooks sortants TMS** déjà identifiés côté Plateforme :
  - `tms/collecte-acceptee` et `tms/collecte-refusee` (acceptation prestataire)
  - `tms/tournee-upsert` (constitution/modification tournée)
 - `tms/plaque-saisie` (S7 restauré 2026-05-01) → émis à la saisie manager prestataire en M03 E4, alimente Plateforme `tournees.plaque_immatriculation` + `plaque_saisie_at`. **Email T+3h supprimé V1 (propagation Q10 M05 2026-04-24)** — webhook conservé pour registre transport / dashboard traiteur / monitoring Admin.

### Notion de vacation, tournée et multi-camions par événement (validé 2026-04-21)
- **Vacation** = unité de base Strike : 4h, 1 camion + 1 chauffeur (+ éventuel équipier supplémentaire +125€/4h)
- **Tournée Savr = 1 vacation** = 1 camion → N collectes (N ≥ 1), même créneau
- **Révisé 2026-05-25 (cross-CDC Sujet 1, option A — à figer en session `cdc-tms-savr` dédiée)** : le multi-camions devient `1 collecte ZD → N tournées` (interne TMS), plus N collectes ZD par événement. La collecte ZD reste l'unité unique côté Plateforme; les N tournées se rattachent au `collecte_id`. **Volet App rédigé 2026-05-25** (relation N↔N via `plateforme.collecte_tournees`, `collectes.tournee_id` retiré, marge agrégée, statut agrégé, S5 terminal unique attendu — cf. [[01 - Cahier des charges App/00 - Index]]). **Volet TMS RÉDIGÉ 2026-05-25 (session `cdc-tms-savr`)** — arbitrages Val 1a/2a/3b/4/5/6a appliqués zéro dette : table de liaison `tms.collecte_tournees` (N↔N) créée + `collectes_tms.tournee_id` retiré, `cout_reparti_centimes`+`ordre_dans_tournee` déplacés sur la liaison (coût collecte = SUM), dispatch M02 E3 + M04 E1bis "+ Ajouter un camion" (N illimité, types différents), S3 réconcilie `collecte_tournees` depuis `collecte_ids[]`, S5 terminal unique après agrégation des N camions, **clôture chauffeur = clôture de SA tournée** + statut collecte `realisee` dérivé (reframe R6.1/R6.2 lève le deadlock), triggers `fn_m07_calc_cost`+`fn_validate_tournee_controle_acces`+RLS+vue `v_courses_logistiques` adaptés à la liaison. 8 fichiers TMS (§04+§05+§08+§09+M02+M04+§00). Écart pré-existant signalé (hors scope) : noms colonnes vue App `cout_par_collecte_ht`/`nb_collectes_tournee` vs TMS `cout_reparti_centimes` → à réconcilier en run `coherence-inter-cdc`. **Cible historique** : (1) cardinalité `tms.collectes_tms.tournee_id` singulier → N↔N (table de liaison TMS ou inversion FK); (2) dispatch M02 = comment l'Ops/dispatch découpe 1 collecte en N tournées; (3) payload S3 `tournee-upsert` = porter la **liste des `collecte_id`** servis par la tournée; (4) S5 `collecte-terminee` = n'émettre **qu'un seul** S5 terminal par collecte après agrégation des pesées des N camions; (5) vue `v_courses_logistiques` (jointure `c.tournee_id = t.id` ligne ~685 §08 TMS) à passer par la liaison N↔N.
- **Coût logistique événement** = somme des coûts des tournées qui l'ont servi
- Table `tournees` côté Plateforme (lecture seule pour l'Admin, source de vérité TMS)
- Dashboard Admin Plateforme affiche les tournées avec picto plaque demandée
- **Multi-vélo AG (généralisation 2026-05-29, session `cdc-tms-savr`, arbitrages Val 1a/2a/3/4a/5)** : axe **orthogonal à D8** — une collecte AG dont le volume dépasse la capacité d'un vélo cargo A Toutes! peut être servie par **N vélos = N tournées sœurs** (chacune portant cette unique collecte, D8 respecté). Réutilise intégralement la mécanique multi-camions (`collecte_tournees` N↔N, R6.1 dérivation, coût SUM, S5 terminal unique). Découpage **interne TMS, Ops au dispatch** (M12 inchangé, pas de split auto — V2 si retour terrain). Affordance « + Ajouter un véhicule » (libellé contextuel camion/vélo). **Multi-facturation : N missions Everest = N courses A Toutes! facturées** (cohérent tarif par course). Acceptation = **1re** mission `mission_dispatched` (idempotent, 1 seul S1). Annulation collecte = cascade sur les **N** missions (M14 W3/R_M14.7). **Everest reformulé « 1 mission = 1 tournée »** : `collecte_tms_id` non-unique, `client_ref`/idempotence keyés `tournee_id`, helper `m14_lookup_mission_by_collecte` → SETOF. Marqué **V2** (TMS V1 ship 1 collecte = 1 vélo ; mécanique figée car héritée du multi-camions). **8 fichiers TMS propagés zéro dette** (M04 E1bis+contrôles+C6+D8/D8bis, M14 W1/W2/W3+R_M14.2/.7+D3, §04 helper SETOF+cascade loop+cardinalité `collecte_tms_id`, §05 R6.1+R_M14.2, §08 S1+S5, M02 affordance). **Cross-CDC Plateforme : 0 divergence** — multi-vélo invisible par design (S1/S5 émis une fois par collecte, coût agrégé via `v_courses_logistiques` SUM, la Plateforme ne voit jamais le nombre de véhicules).

### Pilotage financier
- **Coûts logistiques** : table `courses_logistiques` côté Plateforme (vue agrégée pour marge)
- Sources des coûts : **Strike et Marathon via TMS** (calcul auto), **A Toutes! manuel V1** (hors TMS)
- La Plateforme reçoit le coût total, pas le détail des tarifs prestataires (reste privé au TMS)

### Seconde salve M01 (atelier 2026-04-23 — propagée)
- **Suppression totale pré-affectation Plateforme** : la Plateforme n'envoie plus de `prestataire_id_pre_affecte` dans E1. Toute attribution se fait côté TMS (M12). Enum `attribuee_source` réduit à 2 valeurs (`ops`, `auto_relance`) (propagation A3 2026-04-25 — alignement vocabulaire avec §04 / §05 / M01 / M12 — anciennes valeurs `dispatch` / `attribution_auto` jamais utilisées dans les modules).
- **Retournement prestataires → `shared.prestataires`** : table unique (fusion `plateforme.prestataires_logistiques` + `tms.prestataires`), écriture TMS, lecture cross-schema Plateforme. Module prestataires Plateforme V1 devient read-only. FK `collectes_tms.prestataire_id` cross-schema.
- **Retournement lieux Option C (refonte 2026-04-28 audit cohérence A2)** : `plateforme.lieux` reste côté Plateforme, le TMS enrichit 2 colonnes logistiques **existantes** (`acces_details`, `acces_office`) via RLS cross-schema column-level + UPDATE policy restrictive. Ex-4 colonnes addendum supprimées (fusion mapping). Contacts retirés des `lieux` (problème métier mutualisation traiteurs) → relogés sur `evenements.contact_principal_*` + `contact_secours_*`, transmis via payload E1 et figés sur `tms.collectes_tms.contact_principal_*`/`contact_secours_*`.
- **Webhook sortant S11 `tms/collecte-rejetee`** : nouveau flux TMS → Plateforme pour rejets TMS (hors refus prestataire). Renuméroté S11 (S7 était déjà pris par `plaque-saisie`).
- **Sérialisation FIFO par `occurred_at`** : pas de priorisation événementielle, skip out-of-order via anti-replay `sync_last_event_id` + colonne `last_occurred_at`.
- **Snapshot lieu figé + synchro manuelle** : `lieu_snapshot` JSONB figé dans `collectes_tms`, bouton "Synchroniser snapshot depuis lieu" (D15) + édition ponctuelle. Alerte `dispatch_lieu_snapshot_divergent` si lieu modifié post-snapshot.
- **Limite payload 256 KB** + **versioning API unique global** (header `X-API-Version`) + **cap 3 retries automatiques** *(simplifié revue sobriété Bloc B B1 2026-05-01 — ex-5 paliers)* + **rotation HMAC annuelle** (vs semestrielle).
- **pgTAP 100% policies RLS bloquant CI** : 4 nouveaux tests (`shared.prestataires` deny cross-schema + `plateforme.lieux` update column-level).
- **Ops Savr double profil** : même email, 2 `users_tms` possibles (claim JWT `app_domain()` recalculé par sous-domaine).

---

## Prochaine session

§01 Vision clôturée 2026-04-21. §03 Périmètre fonctionnel clôturé 2026-04-22 (14 modules V1 + 2 modules V2). §08 Contrat API clôturé 2026-04-22 puis revue sobriété complète 2026-05-01 (16 endpoints initiaux → **12 endpoints actifs** post Blocs A+B+C+D + restauration S7 audit cohérence inter-CDC 2026-05-01, auth HMAC+JWT, idempotence event_id, retry **3 paliers** Bloc B B1, versioning YYYY.MM via header `X-API-Version` autoritatif). §04 Data Model + §05 Règles métier + §09 Auth/permissions clôturés 2026-04-22.

**Ordre recommandé pour les prochaines sessions :**
1. — **FAIT 2026-04-22**
2. — **FAIT 2026-04-22**. 8 questions ouvertes, dont MAJ CDC Plateforme §08 (collecte-terminee unifié, aucun_repas, /sync/poll, integrations_inbox).
3. — **FAIT 2026-04-22**. 27 tables spécifiées. Formules de facturation configurables sans code (`formules_catalogue` + JSON paliers). Alerte pesées ZD normalisée par pax (total flux). OCR factures V1. Propagations effectuées : §03 M07, §04 Plateforme, §05 Plateforme, §12 Plateforme, §01 Vision Q5.
4. — **FAIT 2026-04-22**. 6 règles rédigées. M12 générique (zéro hardcoding prestataire), M07 formule JSON pilotée par `grilles_tarifaires_prestataires`, R3 rapprochement factures auto, R4 stock rolls + paliers pax, R5 alertes Veolia, R6 cycles de vie collectes/tournées/factures.
5. — **FAIT 2026-04-22** (clôturé avec 9 questions ouvertes tranchées). 4 rôles, cumul natif via `roles text[]`, SSO Google Workspace Ops/Admin V1, MFA TOTP Admin hors SSO, policies RLS SQL par table (17 tables), workflow magic link, anti-escalade trigger, RGPD (purge docs 3 ans, géoloc 30j, CGU TMS distinctes, suspension 30j fin contrat prestataire).
6. — **FAIT 2026-04-23** (module pilote, 10 décisions structurantes). 5 questions ouvertes restantes (seuils SLA V1 exacts, provider SMS V2, seuil digest, création prestataire province, zones géo, refus historique, raccourcis V1.1, réconciliation orpheline M13).
7. — **FAIT 2026-04-23, revue de sobriété appliquée 2026-04-30** (point d'entrée TMS, 10 décisions + seconde salve 2026-04-23 intégrée + 14 simplifications sobriété 2026-04-30 : `attribuee_source` colonne supprimée [B_M01_04+D_M01_03], dedup étendue `integrations_logs` 2 ans supprimée → `integrations_inbox` TTL 7j→30j [B_M01_01], cron polling 15 min→60 min [B_M01_02], push browser supprimé canaux Admin TMS [B_M01_03], action « Requalifier DLQ » supprimée [A_M01_01], action « Escalader Dev » supprimée [A_M01_03], bouton « Forcer polling full history » UI E1 supprimé [A_M01_02], Zone 2 Timeline graphique E1 retirée → 5 compteurs simples + lien CSV [A_M01_04], sync batch lieu→futures supprimé override ponctuel seul [A_M01_05], états `failed_dlq_again` + `escalated` + `requalifié` retirés du diagramme [D_M01_01+D_M01_02], W6/W8 fusionnés workflow canonique unique [C_M01_01], règle `heure_collecte` passée invalide unifiée création+modif [C_M01_02]). Propagations §04/§05/§08/§09/§11 TMS + M02 + M11 catalogue + §04 Plateforme terminées 2026-04-30.
8. — **FAIT 2026-04-23, aligné 2026-04-24, simplifié 2026-04-29** (Option A création à dispatch pre-acceptance, 9 workflows, 12 edge cases, 13 décisions + 6 paramètres M13). Règles clés : **→ supprimée définitivement V1 (revue sobriété 2026-04-29 — corollaire suppression `flux_prevus`)**; contrôle géoloc non bloquant au clic "terminer" (seuil 300m), 1 email traiteur par événement avec agrégation multi-tournées (fenêtre 3h, partiel si plaques manquantes), 5 ZD flux singulier alignés (`biodechet, verre, emballage, carton, dechet_residuel` post-renommage 2026-05-02). Plus de flag `presume_non_pese` payload S5 (uniquement pesées réelles).
9. — **FAIT 2026-04-24** (9 écrans, 7 workflows, 14 edge cases, 13 décisions). Split M06 (Admin TMS + Ops Savr) / M03 (Manager prestataire self-service) / M13 (config système) validé. Simplification V1 : retrait alertes échéance permis/CNI/visite médicale/assurance (reporté V2), seed MTS-1 par saisie unitaire manuelle, changement prestataire chauffeur = soft delete + création. Propagations §04 TMS (retrait colonnes `visite_medicale_date`, `assurance_date_fin`, `controle_technique_date_fin` + ajout `contact_operationnel/facturation`, `date_fin_contrat`, `last_everest_ping_*`) et §04 Plateforme (shared.prestataires miroir).
10. — **FAIT 2026-04-24** (backend pur, 5 triggers T1-T5, 7 branches R1 avec codes canoniques, 16 décisions, dashboard monitoring M13, cache Everest 7j, auto-relance max 2 cascades, fallback Everest down = supposer couvert, tri province secondaire par `nb_collectes_6_mois_cache ASC`). Propagations : §04 TMS (5 colonnes `collectes_tms` `suggestion_*` + `refusee_par_prestataire_id[]`, 2 nouvelles tables `suggestions_attribution_log` append-only + `everest_coverage_cache` TTL 7j, 6 paramètres `parametres_tms.attribution`, colonne `shared.prestataires.nb_collectes_6_mois_cache`), §04 Plateforme (colonne `nb_collectes_6_mois_cache` documentée cross-schema), §05 R1 (codes branches canoniques enum), §09 RLS (sections 17bis + 17ter), §03 M12 (lien détail), M01 triggers T1 + T3 référencés, M02 E5 bouton "Re-suggérer" (T4) + champ motif override + RPC `m12_enrich_override` (W6).
11. — **FAIT 2026-04-24** (9 écrans E1-E9, 7 workflows W1-W7, 15 edge cases EC1-EC15, 15 décisions D1-D15, 3 règles nouvelles R2.8-R2.10 + refonte R2.7 [seuil 1h uniforme]). Piliers : dashboard 5 widgets Ops/Admin TMS, ajustement manuel tournée avec seuil 15% validation Admin, grilles tarifaires versionnées strictement non rétroactives, figement `cout_calcule_ht` post-clôture (trigger DB BEFORE UPDATE), audit log append-only 3 ans. Propagations complétées : §04 TMS (addendum M07 : 12 colonnes `tournees` + table `ajustements_couts_log` + fonction `m07_compute` + 3 paramètres `m07`), §04 Plateforme (3 colonnes `courses_logistiques`), §05 (R2.7 refonte + R2.8/R2.9/R2.10), §08 TMS (S6 v2 versioning), §08 Plateforme (webhook v2 anti-replay), §09 (RLS 11bis + 11ter + 3 tests pgTAP), §03 (M07 + M02 `nb_personnes_facturation`).
12. — **FAIT 2026-04-24, revue de sobriété appliquée 2026-04-30** (9→8 écrans, 12→11 workflows, 14→10 notifications, 20 edge cases, 12 décisions D1-D12, 12 règles R_M08.x, 9→8 paramètres namespace `m08`, catalogue M11 5→4 codes M08). Piliers : upload double voie portail M03 + Ops E3, OCR Mistral synchrone pré-remplissage formulaire, rapprochement zéro tolérance centime (match exact HT par tournée + total), cycle contestation avoir + nouvelle facture (pratique comptable FR), verrouillage tournées rapprochées (`cout_final_verrouille`) avec blocage M07 ajustement, déverrouillage Admin TMS exclusif motif ≥ 30 car + audit 5 ans, règlement manuel post-virement (pas d'intégration bancaire V1), export Pennylane CSV V1 (API Pennylane v2 V2), rappel J+5 + escalade J+15, plusieurs factures/mois autorisées (warning non bloquant). Propagations complétées : §03 (M08 refait), §04 TMS (addendum M08 : 17 colonnes `factures_prestataires` + enum `statut_rapprochement` enrichi + `tournees.verrouillee_par_facture_id` + table append-only `exports_pennylane_log` 5 ans + 9 paramètres + 3 fonctions SQL `m08_rapprocher/verrouiller_tournees/deverrouiller_tournees` + décision historique seuils barrée), §05 (R3 refondue R3.1-R3.7), §06 M03 (E10/W10/EC8/D15 aligné), §06 M07 (EC9 wording M08 W9), §09 (RLS section 12 refaite + `exports_pennylane_log` append-only + 8 tests pgTAP bloquants), §15 (15.4.2 enrichie + 15.4.2.a nouveau).
13. — **FAIT 2026-04-24, revue de sobriété complète Blocs 1-6 terminée 2026-04-28** (13 décisions D1-D13, 6 écrans → 3, 10 workflows W1-W10, 18 edge cases, 12 règles R_M11.x, paramètres 12→5, crons 5→2, catalogue 70+→58 codes). Piliers : taxonomie 2 niveaux `warning/critical` (info dégagé Bloc 3), `alertes_catalogue` configurable Admin TMS, canaux V1 in-app + email critical, ack = metadata colonnes `ackee_par_user_id`/`ackee_at` (Bloc 6 B2), timeline = `shared.audit_logs` (Bloc 6 C1), debounce 5 min, snooze 1h/4h/24h, rétention 3 ans, fonction SQL unique `tms.alerte_emit`, enum `alerte_statut` 3 valeurs `ouverte/snoozee/resolue`. Propagations complétées : §03, §04 TMS, §05 R11 + R6.5, §09 RLS, §15, M13, M04, §06 modules émetteurs M01/M02/M03/M04/M05/M07/M08/M12.
14. — **FAIT 2026-04-25** (13 décisions D1-D13, 8 écrans E1-E8, 10 workflows W1-W10, 15 edge cases, refonte R5.1-R5.8, 5 paramètres `m10_*`, 9 codes alertes M10 seed). Piliers : page dédiée `/exutoires` (Ops Savr) + Zone 4 tuiles-jauges sur dashboard M02 (polling 30s), double signal saturation (seuil absolu R5.3 par couple flux × type_contenant + jauge 85% paramétrable), différenciation estimation auto vs recompte Ops (`quantite_pleine` vs `quantite_pleine_recomptee`), R5.4 refondue **décrémentation partielle** par `nb_bacs_enleves` saisi (vs reset total V0 — **à valider Val**), traçabilité origine passage (`cree_par_action` `saisie_manuelle` vs `bouton_declencher`), append-only `recomptages_stocks_entrepot_log` 3 ans rétention, motif obligatoire écart ≥5 bacs ou ≥20%, frontière M09/M10 nette (M09 = chez traiteurs, M10 = entrepôt + Veolia), idempotence W1 via `tournees.stock_entrepot_update_at`, coûts Veolia reportés V2. Propagations : §03 (M10 réécrit V1 + scope V2), §04 TMS (3 colonnes `stocks_bacs_entrepot` + 2 colonnes `passages_veolia` + renommage `nb_bacs_enleves` + table append-only `recomptages_stocks_entrepot_log` + 1 colonne `tournees.stock_entrepot_update_at` + 5 paramètres + 3 fonctions SQL + 6 triggers DB + 2 crons pg_cron), §05 (R5.1/R5.2 codes canoniques, R5.3 seuil absolu par couple, R5.4 décrémentation partielle, R5.5-R5.8 nouvelles), §09 (RLS section 13 + 5 tests pgTAP), §06 M11 (catalogue 9 codes M10 seed), §06 M04 (étape 4 clôture auto trigger M10 W1), §06 M02 (Zone 4 dashboard tuiles-jauges).
15. — **FAIT 2026-04-25, mis à jour Bloc 6 C3 2026-04-28, revue de sobriété Blocs A+B+C+D terminée 2026-04-30** (15 décisions D1-D15, 9 écrans E1-E9 + 4 sous-écrans, 12 workflows W1-W12, 18 edge cases EC1-EC18, 20 règles R_M13.1-R_M13.20, **3 paramètres seedés** `m13_*` (17→3 après sobriété B1 + 14 hardcodés constants), 10 codes alertes catalogue M11). Piliers : hub navigation + écrans propres transverses (D1), — **retiré Bloc 6 C3 2026-04-28**, E8 = lecture seule catalogue, CRUD users + impersonation V1 avec audit double acteur (D3+D15), secrets API Supabase Vault + Edge Function `reveal_secret` JWT 30s + `rotate_secret` test pré-validation (D4 — `marathon_webhook_signing_key` hors seed V1 sobriété D1), audit_logs strictement immutable (D5), cache 60s côté Edge pour params clients (D6), soft delete user V1 sans réactivation V1 (**D2 sobriété : transition `desactive→actif` retirée diagramme**), wizard onboarding **3 étapes** (identité + manager + activation) (D8 sobriété B4), replay manuel events `echec_final` admin only (D9), **session 30j glissantes admin+ops sans re-MFA actions sensibles** (D10 — risque assumé conscient documenté R_M13.13), MFA TOTP admin 1ère fois device (D11), flag `requires_redeploy` sur `parametres_tms` (D12), bandeau impersonation persistant (D13), cap 3 devices trusted/user (D14). Sobriété A : W11 cron session warning + paramètre `m13_session_warning_jours_avant_expiration` dégagés V1. Sobriété C : E3.b Onglet Audit mini-vue → lien E4 préfiltré (C1). Propagations : §03 (M13 statut V1 rédigée), §04 TMS (4 tables nouvelles + 2 modifiées + seed paramètres 3 seedés + 14 hardcodés), §05 (R_M13.1-R_M13.20), §07 (12 Edge Functions M13 + secrets enrichis), §09 (RLS + politique session + helper `auth.is_impersonating()` + 14 tests pgTAP), §15 (sections Vault + impersonation + audit_logs immutable confirmé), M11 catalogue (+10 codes `m13_*`).
16. — **FAIT 2026-04-25, revue de sobriété appliquée 2026-04-30** (10 décisions D1-D10, 5→4 écrans (E1-E2-E4 page `/everest` + E5 sous-écran tab Everest M13 E6; E3 absorbé dans M13 E6 tab Everest sobriété A_M14_05), 8→7 workflows W1-W8 (W7 Replay supprimé sobriété A_M14_04), 12 edge cases EC1-EC12, 8 règles R_M14.1-R_M14.8, **10 codes alertes** catalogue M11 (1 existant + 9 nouveaux; 3 ex-info retirés Bloc 3 + `m14_everest_mission_late` seedée `active=false` sobriété A_M14_07), **5 paramètres** `m14_*` (suppression `m14_dashboard_polling_ms` sobriété A_M14_01), 1 trigger DB `trg_m14_cascade_cancel`, 1 fonction SQL helper `m14_lookup_mission_by_collecte`, 6 API Routes Next.js + 1 worker queue listener (route `/replay/:inbox_id` supprimée sobriété A_M14_04). Piliers : reprise contrat Bubble↔Everest + supervision Ops, push à attribution M12 (pattern Strike/Marathon), granularité 1 mission/tournée camion + 1/collecte vélo, webhooks observabilité pure (M05 = vérité opérationnelle), auth Bearer lazy refresh sur 401 + cache token mémoire process Next.js uniquement V1 (sobriété B_M14_01), sécurité webhook token header par défaut V1 (HMAC Q2 à confirmer dev Everest), idempotence `integrations_inbox`, failover Everest down 1 retry 30s + Ops manuel E4 acceptation manuelle, annulation cascade trigger DB auto, course incomplète AG notif Everest direct (endpoint Q1 à confirmer dev Everest). **Single source of truth `everest_service_id`** : nouvelle colonne `tms.collectes_tms.everest_service_id_target smallint` posée par M12 (sobriété B_M14_02) — M14 W1 ne re-calcule plus la fenêtre last-minute. Propagations : §03 (M14 V1 rédigée), §04 TMS (`everest_missions` enum élargi 10 valeurs + 4 colonnes `manual_acceptance_*` + CHECK + 2 index, `collectes_tms.everest_mission_id` + index, **`collectes_tms.everest_service_id_target` ajouté sobriété 2026-04-30 B_M14_02**, 2 secrets Vault, 5 paramètres `m14_*` après suppression `m14_dashboard_polling_ms` sobriété A_M14_01, trigger + fonction SQL), §05 (R_M14.1-R_M14.8), §07 (section 18 — 6 API Routes + 2 triggers DB + 1 fonction SQL + worker), §09 (section 18bis RLS + 5 tests pgTAP), §15 (section 15.10quater sécurité Everest), M06 (bouton "Tester la connexion" pointe sur M14 W8 `POST /availabilities`), M11 (10 codes M14 dont `m14_everest_mission_late` seedé `active=false`), M12 (`everest_service_id_target` posé en miroir de `suggestion_detail.service_everest_id`), M13 (E6 tab Everest héberge audit webhooks 7j ex-E3), M02/M05 (notes intégration inchangées).
16. **Techniques à traiter avec son frère** : §07 Archi, §14 Scalabilité, §15 Sécurité (déjà rédigés V1 en atelier 2026-04-23), trigger cron J+30 archivage prestataire (ajouté M06), validation JSON Schema grilles tarifaires, fonction SQL `tms.m12_suggest` + `tms.m12_bulk_recompute` + triggers DB M12 (T1/T2/T3/T5), fonction SQL `tms.m07_compute(grille_id, tournee_id)` + triggers DB figement M07 + trigger BEFORE UPDATE seuil ajustement 15% + cron archivage `ajustements_couts_log` 3 ans, fonctions SQL M08 + cron rappel J+5 / escalade J+15 + génération CSV Pennylane + retention R2 Glacier 6 mois factures PDF + purge `exports_pennylane_log` > 5 ans, fonctions SQL M11 `tms.alerte_emit` & co + 5 crons pg_cron + worker Node email Resend critical + webhook Slack toggle + seed catalogue 40+ codes canoniques, **fonctions SQL M10 `tms.m10_recompter` + `tms.m10_confirmer_passage` + `tms.m10_declencher_collecte_veolia` + 6 triggers DB `trg_m10_*` (auto_increment_pleins idempotent par `stock_entrepot_update_at`, alerte_saturation, alerte_report, alerte_annule, capacite_diminuee, recomptage_log_append_only) + 2 crons pg_cron (`m10_alerte_non_confirme` horaire, `m10_purger_recomptages` mensuel) + seed 9 codes alertes M10 dans catalogue M11**.
17. — **FAIT 2026-04-27** (10 décisions D1-D10, index transverse 14 dashboards par rôle, routes `/{section}` + `/admin/*` + `/portail/*`, redirection rôle racine, sidebar repliable + switcher cross-app, refresh 3 modes, composant `<DashboardExportButton/>` partagé CSV+PDF, page `/403` + audit `AUDIT_403_ACCESS`, composants partagés `packages/ui-tms`, accessibilité WCAG 2.1 AA visé). 2 conflits structurants tranchés option a Val (sous-route `/admin/*` au lieu de sous-domaine + `audit_logs.action` text+CHECK regularisant dette 8+ codes ad-hoc). Reportés V1.1+ : widgets orphelins, drill-down événement M07, reports email scheduled, vue carte M02 V2. Propagations : §04 (text+CHECK + addendum), §07 (routing + monorepo + CORS), §08 (E10 endpoint cross-app), §09 (gating /403), §15 (15.4.6), M01/M11/M12/M13. Cross-CDC Plateforme : §08/§03/§00 Plateforme alignés (3 fichiers, 7 éditions).
18. — **FAIT 2026-04-27** (V1 rédigée — vue transverse + 9 décisions D1-D9). PWA `tms.gosavr.io/m/*` mono-domaine (D1), iOS 16.4+/Android 10+ Chrome 100+ (D2), Service Worker Serwist (D3), offline-first complet V1 source de vérité M05 (D4), Web Push Edge Function `tms.push_send` (D5), géoloc CGU sans UI in-app risque assumé V1 (D6 — **refondu Bloc 3 2026-06-04 : écran d'information à l'inscription + base légale intérêt légitime**), force change password 1ère connexion via `users_tms.must_change_password` (D7), formation = PDF mémo manager hors PWA (D8), kill switch toast non-bloquant + grace 24h + modal si `m05_force_update_strict=true` (D9). 8 fichiers TMS modifiés / 16 éditions + 1 cas non prévu détecté (`tms.savr.fr` ancien domaine) signalé pour propagation séparée. Cross-CDC : aucun impact Plateforme.

19. — **FAIT 2026-04-27** (V1 rédigée — 10 décisions D1-D10, double-run total 1 mois Bubble/MTS-1 source légale + Savr shadow, mode migration runtime via `parametres_tms.migration_mode_active` + filtre auto Pennylane via `factures_prestataires.migration_test`, plan consolidation stocks J+7/J+15/J+30, checklist go/no-go 12 critères Admin TMS, plan rollback prolongation MTS-1 +1 mois + mode dégradé Admin Savr, comm J-30 + présentiel Strike/Marathon, Val pilote 100% + Louis backup nominé). Date cible bascule mi-mai/début juin (T0 — année à confirmer Q9 Index). 9 fichiers TMS modifiés / 10 éditions (§04, §05, §15, M06, M08, M09, M10, M11, M13). Mini-chantier dépendant `shared.collectes_legacy` (cross-CDC, hors §13) à ouvrir séparément.

20. **Suite solo restante (option a Val 2026-04-27)** : **§10 Design System** prochaine étape → puis **§16 Roadmap et priorisation**. Date licence MTS-1 (Q9 Index) reste action Val externe en parallèle, conditionne T0 calendrier mais pas la rédaction.

**Actions Val hors spec** (à lancer en parallèle pour ne pas bloquer le planning V1) :
- Obtenir date d'échéance licence MTS-1
- Négocier prolongation vacation camion Strike
- Clarifier dépassement 4h Marathon
- Valider juriste RSE (BSD V2 + Registre transport V1)
- Planifier seed data MTS-1 (extraction + nettoyage)
- Planifier inventaire rolls/bacs/traiteurs

### Bloc 1 — Décisions de rédaction TMS (2026-06-03, arbitrages Val)

- **Alerte Ops acceptation sans réponse (M02)** — révise D4 : pas de SLA système (escalade/auto-accept restent supprimés), mais alerte warning `m02_acceptation_sans_reponse` au-delà de 48h (collecte lointaine > 48h) ou 3h (collecte proche ≤ 48h). Seuils paramétrables (`parametres_tms` namespace `m02`), cron 15 min, auto-résolution à la sortie du statut. M02 W6, §05 R1.4.
- **Carte dispatch M02 V1 (E6)** — révise D2 : carte des collectes du jour, pins GPS depuis `collectes_tms.lieu_adresse` (coords déjà fournies par E1, zéro géocodage TMS), MapLibre + tuiles OSM (§07 T.7.10). Limite V1 : AG + hors-IDF sans coords (encart dédié). Pas de routing/optimisation (V2).
- **Rapprochement partiel facture = non V1** — règle 1 facture = 1 période sans chevauchement (§05 R3.8), le verrouillage `cout_final_verrouille` existant exclut déjà les tournées facturées (0 double comptage, 0 nouvelle colonne). Résout §04 Q6.
- **Test RLS CI = pgTAP** — aligné App (couverture ciblée V1, 100 % policies V1.1). Résout §09 résiduelle 1, §15 réaligné.

### Bloc 3 — Décisions de rédaction TMS (2026-06-04, arbitrages Val)

- **Nettoyage questions ouvertes Index** — reclassement des 15 questions en 3 familles (résolues / actions Val externes / V2-tuning). Résolues marquées Bloc 3 : Q7 (inventaire), Q11 (3e camion = table paramétrable), Q13 (attribution = M12). Sorties de la liste spec → actions Val : Q3/Q4/Q6/Q8/Q9. Reclassées non-bloquantes : Q5 (mesure onboarding), Q14 (tuning paliers). Q14bis étiquetée V2. **Plus aucune décision spec V1 en suspens côté TMS.**
- **Workflow RGPD géoloc chauffeur (Q12 résolue)** — base légale requalifiée **intérêt légitime** (≠ consentement, position CNIL géoloc salariés) ; **écran d'information bloquant à l'inscription uniquement** (M05 W1 étape 5-bis + gate W2 sur version) + trace `users_tms.consentements.geoloc_notice` (acknowledged_at/version_notice/ip) + versioning matériel ; **pas d'UI après inscription** (point 4 — écran permanent + bouton opposition — rejeté par Val) ; exercice des droits **hors app, manuel Admin TMS** (aligné §15.5.1, pas de portail self-service V1). Réconciliation de 3 couches incohérentes (§09 A5 modèle in-app stale vs §12 D6 vs §15.5.1).
- **Suppression docs chauffeur = cron seul (3a)** — purge auto > 3 ans, **pas de purge manuelle anticipée** (rétention 3 ans = obligation employeur transport, suppression anticipée risquée). Réouverture V1.1 si besoin terrain.
- **Propagations Bloc 3** : §04 (`users_tms.consentements jsonb`), §09 A5 (refonte information géoloc + table droits requalifiée + purge docs), §15.4.1 (régime géoloc refondu) + §15.5.1 (exception documentée) + §15.13 (Q5 juriste/AIPD), §12 D6 (refondu), M05 W1/W2 (écran + gate). **Cross-CDC Plateforme : 0 divergence** (géoloc + consentements = natifs TMS, jamais exposés à la Plateforme). 6 fichiers TMS.

---

## Audit RLS TMS (skill `cdc-audit-rls`, 2026-06-05)

Session dédiée post revues sobriété + cohérence inter-CDC. 27 tables `tms.*`/`shared.*` croisées §04↔§09, 4 rôles, cross-schema, append-only, Edge Functions. **Couverture globale solide**, 4 trous corrigés + 1 incohérence schéma tranchée :

- **BLOC A (policies manquantes)** : `tms.chauffeurs_geolocalisation` (GPS/RGPD, CRITIQUE) et `tms.auth_sessions_tms` (sessions chauffeur) n'avaient **aucun bloc policy formel** en §09 A3 (décrites en prose seulement) → blocs SQL ajoutés §09 A3 **§20** (`auth_sessions_tms`) et **§21** (`chauffeurs_geolocalisation`).
- **BLOC B (bugs SQL)** : (B1) prédicats rôle chauffeur utilisaient `auth.uid()` (= `users_tms.id`) au lieu de `auth.user_chauffeur_id()` (= `chauffeurs.id`) → ne matchaient jamais ; corrigé partout (table M05 §09, §04 §4/§8, §05, M05 §06, §12). (B2) `NEW.actif` invalide en `WITH CHECK` RLS (`users_tms_devices_trusted`) → `actif`.
- **BLOC C (BLOQUANT — schéma)** : table `chauffeurs` ambiguë `tms.` vs `shared.`. **Tranché `tms.chauffeurs`** (canonique §04 FK cross-schema + nommage) ; 5 réfs `shared.chauffeurs` corrigées (§09×2, §04×2, §05, M05 §06).
- **BLOC D (pgTAP)** : `chauffeurs_geolocalisation` + `auth_sessions_tms` ajoutées au périmètre ciblé V1 (§15) + 4 nouveaux tests (isolation géoloc, scope manager, anti-spoofing insert, non-régression prédicat chauffeur).
- **BLOC E (Edge Functions/API routes)** : RAS bloquant. Webhooks Plateforme HMAC-SHA256, Edge Functions M13/M14 role-checked + service_role, idempotence `integrations_inbox`. Seul point ouvert assumé V1 : webhook public `/api/webhooks/everest` validé par token (pas HMAC) — filet M14 D6, upgrade HMAC prévu.

Fichiers édités : §09, §04, §05, §15, §12, M05 §06, Index. Cross-CDC 0 (chauffeurs = TMS-interne, App non impactée).

## Changelog revues de sobriété

### Revue de sobriété M08 — Facturation prestataires (2026-06-05)

Module déjà fortement assaini (16 simplifications 2026-04-30 + revue §05 2026-05-01 cron W11/auto-validation). Cette passe = **0 suppression fonctionnelle** (A1 paramètre `m08.ocr_confiance_min_blocage_pourcent` proposé suppression → **gardé** par Val) ; 1 duplication + 6 refs mortes purgées. Bloc C1 : E2 viewer PDF dédupliqué (Zone 3 = viewer unique, Zone 5 réduite à métadonnées). Bloc D : D1 `R_M08.9` retrait statut mort `rejetee_pour_correction` / D2 trigger §11.11 « vers `conteste` » (ex-`rejetee_pour_correction`) / D3 compteur enum `statut_rapprochement` corrigé « 9→8 » → **7 valeurs** / D4 propagation renommage param `escalade_*` marquée caduque (param supprimé §05 A1) / D5 propagation §05 R3.4+R3.6 ligne-à-ligne+SUM lignes marquées caduques (table `factures_prestataires_lignes` supprimée A5) / D6 N7 déclencheur « W4/W5 » → « W3 auto / W5 » (W4 supprimé). Fichiers dépendants (03/04/05/09/Index/M03) déjà propres (refs = notes « supprimé » ou valeur colonne audit `action_deverrouillage`). 1 fichier TMS (M08), cross-CDC 0.

### Revue de sobriété M11 — Alerting transverse (2026-06-04)

Module le plus revu du CDC (Blocs 1-6 + revues par module). Aucune suppression fonctionnelle possible. Purge dette doc uniquement. Bloc B : `integration_pennylane_down` seedé `active=false` V1 (code V2). Bloc C1 : décompte catalogue reconcilié — **SOLDE CATALOGUE V1 autoritaire** ajouté en §11.7 (60 lignes seedées dont 2 `active=false` → **58 codes émettables V1**), narrations périmées (56 / 61→58) marquées, note B5 doublon `m04_checklist_bypass` résolue. Bloc C2 : 2 questions ouvertes §15 fermées (Q3 sonore → E6 supprimé, Q4 test prod → W10 supprimé). Enum `alerte_statut` déjà 3 valeurs (item mémoire « 4→3 » soldé Bloc 6, pas de reste). Bloc A + D : néant. Cross-CDC 0, 1 fichier TMS + Index.

### Revue de sobriété M04 — Gestion des tournées (2026-06-04)

Module déjà purgé (revue 2026-04-29 + purge dette S6 2026-06-04). Cette passe = purge de la **dette résiduelle email plaque T+3h** (mécanisme retiré V1 le 2026-04-24 / Q10 mais encore décrit comme actif). Bloc C : 6 corrections M04 (W4 fan-out supprimé, D9 marqué caduque, §14.1/14.2 obsolètes, Q8 fermée, W6 + D3 reformulées sans référence morte) + queue cross-fichier (Vision §23 + tableau responsabilités, Périmètre §233). Bloc B : 1 micro-simplif (W2 étape no-op `heure_fin_prevue` retirée, renumérotation). Bloc A et D : néant (statut_tournee 4 valeurs déjà minimal). Cross-CDC 0 (App déjà propre — "Pas de notification T+3h en V1"). 3 fichiers TMS édités.

### Revue de sobriété §08 Contrat API Plateforme↔TMS — Bloc A (2026-05-01)

6 simplifications appliquées : réduction de 16 → 12 endpoints API V1 (-4 endpoints + 2 vues cross-schema en remplacement).

| Code | Suppression | Remplacement |
|------|-------------|--------------|
| A1 | Endpoint E10 `GET /me/has-profile` (SSO cross-app) | Bouton sidebar inconditionnel + page d'accès refusé propre |
| A2 | Webhook S6 `course-cout-calculee` | Vue `plateforme.v_courses_logistiques` + trigger DB `fn_recalc_marge_tournee` |
| A3 | Webhook S8 `traiteur-stock-rolls-update` + table miroir `plateforme.lieux_stocks_rolls` + R_M09.7 + alerte `m09_webhook_s8_dlq` | Vue `plateforme.v_stocks_rolls` (sans joint `organisations_lieux` — rolls aux traiteurs uniquement) |
| A4 | Endpoints `/sync/poll` E6 + S10 (polling fallback bidirectionnel 60 min) + W2 M01 | Retry 3 paliers (Bloc B B1, ex-5 paliers à l'arbitrage A4) + dédup `integrations_inbox` couvrent <24h, intervention manuelle au-delà |
| A5 | Alerte "Latence p95 > 30s" | Métrique conservée en dashboard sync, plus d'alerte automatique |
| A6 | Widget "Dérive horaire entre les 2 apps" du dashboard sync | Sans objet (DB partagée, même zone Vercel/Supabase eu-west-3) |

**Fichiers modifiés** : §08 TMS, §08 Plateforme, §04 TMS (`tournees` + `stocks_rolls_traiteurs` annotées cross-schema), §04 Plateforme (`courses_logistiques` migrée en vue + `lieux_stocks_rolls` migrée en vue), §07 TMS (architecture endpoints), §11 TMS Dashboards (D3 simplifié), §03 Plateforme (cumul cross-app), M01 TMS (B_M01_02 obsolète + W2 supprimé), M07 TMS (push S6 → trigger DB), M09 TMS (push S8 → vue + R_M09.7 supprimé), M11 TMS (codes `m07_push_s6_dlq` + `m09_webhook_s8_dlq` supprimés).

**** **Bloc B appliqué 2026-05-01** ↓.

### Revue de sobriété §08 Contrat API Plateforme↔TMS — Bloc B (2026-05-01)

5 simplifications appliquées : retry 5→3 paliers, fusion photos array, header version unique, geoloc S4 retirée, dédup retour 7j.

| Code | Avant | Après |
|------|-------|-------|
| B1 | Retry 5 paliers (5 min / 30 min / 2h / 6h / 24h) | Retry **3 paliers** (5 min / 1h / 24h) — paliers intermédiaires sans ROI |
| B2 | Dualité legacy `photo_url` (singulier) + `photos_urls` (array) dans S5/S9 | Champ unique **`photos: string[]`** array (même si 1 photo) |
| B3 | Header `X-API-Version` ET champ `version` dans payload (double ceinture) | Header `X-API-Version` **autoritatif unique**, champ payload retiré |
| B4 | Payload S4 `collecte-en-cours` contient `geoloc { lat, lng, precision_m }` | Payload S4 **sans `geoloc`** — Plateforme n'utilise pas la géoloc, retard traité côté TMS M11 (bonus RGPD minimisation) |
| B5 | `integrations_inbox` TTL 30j (post-sobriété M01 B_M01_01) | TTL **7j** (retour ex-7j) — avec polling supprimé Bloc A A4, retry max 24h donc re-émission >7j inexistante. M01 B_M01_01 obsolète. |

**Fichiers modifiés** : §08 TMS, §08 Plateforme, §04 TMS (`integrations_inbox` TTL + niveau 6), §04 Plateforme (`integrations_inbox`), M01 TMS (B_M01_01 obsolète + dédup 7j + référence `integrations_polling_state` strikethrough), M02 TMS (retry 5→3 paliers), M05 TMS (rename `photos_urls` → `photos` toutes occurrences), §05 TMS (retry pseudo-code).

**** **Bloc C appliqué 2026-05-01** ↓ + **Bloc D appliqué 2026-05-01** ↓↓.

### Revue de sobriété §08 Contrat API Plateforme↔TMS — Bloc C (2026-05-01)

2 simplifications appliquées (les items C1 et C2 du rapport initial sont sans objet — résolus respectivement par A3 suppression `lieux_stocks_rolls` et A4+B1 suppression polling + retry 5→3) :

| Code | Suppression | Remplacement |
|------|-------------|--------------|
| C3 | **Annulé 2026-05-01 (audit cohérence inter-CDC)** | **Restauration C3** : S7 réactivé (émis à la saisie manager M03 E4 uniquement, Option B Val) + colonnes Plateforme `tournees.plaque_immatriculation` + `plaque_saisie_at` restaurées. **Mise à jour 2026-06-04 (propagation suppression saisie plaque terrain, arbitrage Val)** : saisie plaque chauffeur supprimée, colonne `plaque_saisie_terrain` supprimée, exposition cross-schema retirée. Il ne reste qu'une seule plaque (pré-saisie manager). S7 inchangé. |
| C4 | Header HTTP `Idempotency-Key` | `event_id` du payload JSON suffit (PK `integrations_inbox`, dédup serveur lit `body.event_id`). |

**Réduction nette Bloc C** : -1 webhook (S7) + -2 colonnes Plateforme + -1 header HTTP. **8→7 webhooks sortants actifs**.

**Fichiers modifiés** : §08 TMS, §08 Plateforme (tableau S7 + section idempotence + auth + décisions), §04 Plateforme (colonnes `tournees.plaque_immatriculation` + `plaque_saisie_at` strikethrough), §05 TMS (R_M05.2 mise à jour), M03 TMS (header + 2 références), M04 TMS (dernière màj), M05 TMS (W tableau S7 + section webhooks), §00 Index TMS + Plateforme.

### Revue de sobriété §08 Contrat API Plateforme↔TMS — Bloc D (2026-05-01) — **REVUE §08 COMPLÈTE**

5 simplifications enums appliquées.

| Code | Avant | Après |
|------|-------|-------|
| D1+D2 | Enum `type_incident` 14 valeurs | **5 valeurs** (décision 2026-06-06, ex-6) : `acces_refuse`, `client_absent`, `probleme_tri`, `autre`, `client_annule_avant_arrivee`. Suppressions : `vehicule_panne`/`accident_route`/`chauffeur_indisponible`/`retard_chauffeur`/`absence_contenant`/`materiel_casse`/`erreur_pesee`/`blessure` (hors app ou `autre`) + **`pas_excedents` retiré 2026-06-06** (cas AG « aucun repas » via E5→S5, hors S9). |
| D3 | Enum `statut_collecte_apres` 6 valeurs (`incident` + `inchange` distincts) | **5 valeurs** — fusion `incident` dans `inchange` (comportement applicatif identique côté Plateforme : entrée `incidents_collectes` + alerte Ops + statut collecte non modifié). |
| D4 | Enum `stationnement` 5 valeurs (`non_defini` parmi) | **4 valeurs + nullable** — `non_defini` supprimé (équivalent NULL Postgres standard). |
| D5 | Enum `motif_dlq` 5 valeurs côté payload S11 | **Text libre côté payload** — enum conservé en interne TMS pour catégorisation dashboards M11, info utile portée par `commentaire_admin` ≥10 chars. |
| D6 | Enum `integrations_inbox.statut` 4 valeurs (`recu`/`traite`/`ignore_doublon`/`ignore_out_of_order`) | **3 valeurs** : `traite`/`ignore_doublon`/`ignore_out_of_order`. `recu` supprimé (insertion BDD APRÈS traitement réussi seulement). |

**Réduction nette Bloc D** : -10 valeurs d'enum + 1 enum migré en text libre côté payload.

**Fichiers modifiés** : §08 TMS (payloads S9 + S11 + E1, table enums normalisés, observabilité, décisions), §08 Plateforme (header, dernière màj), §04 TMS (table `incidents` enum 13→6 + `integrations_inbox.statut` 4→3 + suppression colonnes `erreur_message`/`tentatives_traitement`), §04 Plateforme (`stationnement` enum lieux + `integrations_inbox.statut`), M05 TMS (E4 motifs avant arrivée 4→1, E9 transitions, dernière màj), §00 Index TMS + Plateforme.

**Compteur cumulé revue sobriété §08 (Blocs A+B+C+D — COMPLÈTE) + restauration S7 audit cohérence inter-CDC 2026-05-01** :
- **16 endpoints API V1 → 12 endpoints actifs** (4 entrants : E1, E2, E3, E5 + 8 sortants : S1, S2, S3, S4, S5, **S7**, S9, S11) + 2 vues cross-schema (`v_courses_logistiques` ex-S6, `v_stocks_rolls` ex-S8)
- Payload simplifié (photos array unique, pas de geoloc S4, pas de version doublon, motif_dlq text libre, stationnement nullable)
- Auth simplifiée (pas d'`Idempotency-Key` header, pas de `version` payload)
- Retry 3 paliers (5 min / 1h / 24h)
- Dédup 7j
- **-10 valeurs d'enum** dont type_incident 14→6 + statut_collecte_apres 6→5 + stationnement 5→4 + integrations_inbox.statut 4→3
- 1 enum migré en text libre côté payload (motif_dlq)
- 0 polling, 0 endpoint utilitaire, 0 alerte latence p95, 0 widget dérive horaire

Revue §08 entièrement traitée. Prêt pour audits cohérence inter-CDC + RLS + tests Gherkin pré-handoff Claude Code.

---

## Règles de rédaction du Vault TMS

- Un fichier par section principale, interlié via `[[Nom du fichier]]`
- Chaque fichier se termine par : "Décisions prises" + "Questions ouvertes" + "Liens" (dont pointeurs CDC Plateforme en `[[01 - Cahier des charges App/...]]`)
- Ce fichier Index est mis à jour à chaque fin de session
- Les sections lourdes sont splittées en sous-dossiers (probable : `06 - Fonctionnalités détaillées TMS/`)

## Pour Claude Code (futur lecteur)

Quand le développement du TMS démarrera, Claude Code lira **ce Vault + le CDC Plateforme** pour comprendre les spécifications. Lire dans cet ordre :
1. Ce fichier Index
2. [[01 - Cahier des charges App/00 - Index]] (comprendre la Plateforme dont dépend le TMS)
3. [[08 - Contrat API Plateforme-TMS]] (contrat d'interface)
4. Sections 01 → 05 TMS (vision, personas, périmètre, data model, règles)
5. Sections 06 → 09 TMS (fonctionnalités, archi, API, auth)
6. Sections 10 → 16 TMS (UX, dashboards, mobile, migration, scalabilité, roadmap)

# Scénarios de test — M09 Stock matériel Savr

**Source CDC** : §06/M09 + §05 R4.1-R4.4 / R_M09.5-R_M09.8 + §04 `stocks_rolls_traiteurs` / `rolls_mouvements` / `types_contenants` + §09 RLS sections 4, 9, 13 + §04 App vue `plateforme.v_stocks_rolls`
**Généré le** : 2026-06-07
**Statut** : À implémenter par Claude Code

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests du module M09.
> Pour chaque scénario :
> - Couche `db` → test pgTAP dans `supabase/tests/`
> - Couche `api` → test Vitest dans `packages/tms/tests/api/`
> - Couche `ui` → test Playwright dans `packages/tms/tests/e2e/`
> Les tests P1-critique sont bloquants CI. P2/P3 non-bloquants V1.
> Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.

> **Périmètre API** : M09 est **100% interne TMS V1**. Webhook S8 supprimé (revue sobriété §08 Bloc A 2026-05-01 A3) — la Plateforme lit le stock via la vue cross-schema `plateforme.v_stocks_rolls`. La catégorie 6 teste donc le **contrat cross-schema** (fraîcheur de la vue + RLS Plateforme), pas d'endpoint HTTP E/S.

---

## Résumé de couverture

| Catégorie | Nb scénarios | Couverture |
|-----------|-------------|------------|
| 1. Happy path | 8 | W1, W2, W3, W4, E1, auto-résolution `m09_stock_bas` |
| 2. Cas limites métier | 9 | Seuil 50% strict, cible NULL/0, seuils écart 3 / 30%, bornes paliers pax, bornes `tare_kg` et `seuil_alerte_stock_roll_pct` |
| 3. Cas d'erreur | 10 | R_M09.8 (archivage), motif obligatoire, EC2, EC7, EC9, fallback stock inconnu, code immuable |
| 4. Isolation RLS | 9 | ops_savr / admin_tms / manager_prestataire / chauffeur, anti-spoofing, `parametres_tms.modifiable_par` |
| 5. Idempotence & états | 6 | UNIQUE (collecte, type), replay W1, snapshot tare figé, archivage après solde, EC10 |
| 6. Cross-schema (vue `v_stocks_rolls`) | 6 | Fraîcheur immédiate W1/W2, RLS Plateforme traiteur/gestionnaire/client, deny écriture cross-schema |
| 7. Migration | 4 | Seed J0 E3 acteur migration, `contexte='migration_test'`, non-purge J+30, idempotence relance |
| **TOTAL** | **52** | |

**✅ 4 specs floues TRANCHÉES Val 2026-06-07 + propagées dans le CDC (§05 + §04 + §09)**. Voir section finale. Tous les scénarios sont implémentables.

---

## Catégorie 1 — Happy path

```gherkin
# Source : §05 R4.1 / §06/M09 W1 / M05 W8
# Couche : db + api
# Priorité : P1-critique
Scénario : w1_cloture_collecte_zd_update_stock
  Étant donné un stock rolls Kaspia (type "Roll 850L emboîtable", lieu NULL) avec quantite_actuelle = 12 et quantite_cible = 20
  Et une collecte ZD Kaspia clôturée par le chauffeur Strike via M05 W8 avec 3 pleins récupérés et 2 vides laissés pour ce type
  Quand tms.m09_update_stock_rolls() est appelée
  Alors un rolls_mouvements est inséré avec source = 'cloture_collecte', collecte_id, chauffeur_id, nb_pleins_recuperes = 3, nb_vides_laisses = 2
  Et stocks_rolls_traiteurs.quantite_actuelle = 11 (12 − 3 + 2)
  Et derniere_maj_at = now(), derniere_maj_par_chauffeur_id = chauffeur, derniere_maj_collecte_id = collecte
  Et la fonction retourne l'id du rolls_mouvements créé
```

```gherkin
# Source : §05 R4.2 / §06/M09 W1 / §9 alertes
# Couche : db
# Priorité : P1-critique
Scénario : w1_franchissement_seuil_emet_stock_bas
  Étant donné un stock Kaspia "Roll 850L" quantite_actuelle = 11, quantite_cible = 20, seuil_alerte_stock_roll_pct = 50
  Quand une clôture collecte W1 fait passer quantite_actuelle à 9 (< 20 × 50% = 10)
  Alors tms.alerte_emit('m09_stock_bas') est appelée avec criticite = 'warning', destinataires roles = ['ops_savr']
  Et une seule alerte ouverte existe pour ce stock (pas de doublon si W1 re-franchit le seuil alors qu'une alerte est déjà ouverte)
```

```gherkin
# Source : §06/M09 W1 (résolution auto) / §9 alertes
# Couche : db
# Priorité : P1-critique
Scénario : w1_remontee_stock_auto_resout_stock_bas
  Étant donné une alerte m09_stock_bas ouverte sur le stock Kaspia "Roll 850L" (quantite_actuelle = 9, cible = 20)
  Quand une clôture collecte W1 dépose 4 vides (quantite_actuelle = 13 ≥ 10)
  Alors l'alerte m09_stock_bas passe en résolue automatiquement
```

```gherkin
# Source : §06/M09 W2 + E3 / R_M09.5
# Couche : api + db
# Priorité : P1-critique
Scénario : w2_recompte_ops_sans_ecart_significatif
  Étant donné un stock Kardamome "Roll pliable" quantite_actuelle = 8
  Et une Ops Savr connectée sur E3
  Quand elle valide un recompte qte_actuelle_recomptee = 7 (écart absolu 1 < 3, écart relatif 12,5% < 30%) sans motif
  Alors tms.m09_recompter_rolls() insère un rolls_mouvements source = 'recompte_ops' avec delta = −1 et user_id = ops
  Et stocks_rolls_traiteurs.quantite_actuelle = 7, derniere_maj_par_user_id = ops
  Et AUCUN tms.audit_logs action 'M09_RECOMPTE_ECART_ROLLS' n'est inséré
```

```gherkin
# Source : §06/M09 W2 / R_M09.5 / EC8
# Couche : api + db
# Priorité : P1-critique
Scénario : w2_recompte_ecart_significatif_trace_audit
  Étant donné un stock Kaspia "Roll 850L" quantite_actuelle = 15
  Quand l'Ops valide un recompte qte_actuelle_recomptee = 10 avec motif "Inventaire annuel — 5 rolls non trouvés, écart à investiguer" (≥ 10 chars)
  Alors le stock passe à 10 et un rolls_mouvements source = 'recompte_ops' est inséré
  Et un tms.audit_logs action = 'M09_RECOMPTE_ECART_ROLLS' est inséré avec diff {ancien: 15, nouveau: 10, delta: −5} et acteur_meta {motif, user_id}
  Et AUCUNE alerte M11 n'est émise (code m09_recompte_ecart_rolls retiré du catalogue — Bloc 3 A1)
```

```gherkin
# Source : §05 R4.4 / §06/M09 W3 / E5
# Couche : api
# Priorité : P2-important
Scénario : w3_paliers_rolls_suggeres_prep_tournee
  Étant donné palier_rolls_par_pax_seuils = [{pax_max:100,rolls:1},{pax_max:200,rolls:2},{pax_max:400,rolls:4},{pax_max:800,rolls:8},{pax_max:null,rolls:null}]
  Et une tournée M04 dont les collectes ZD totalisent nb_pax_total = 250
  Quand l'Ops ouvre le détail tournée M04
  Alors le badge affiche "4 rolls suggérés" (premier palier où 250 ≤ pax_max = 400)
  Et aucun blocage n'est appliqué si le chauffeur emporte un nombre différent
```

```gherkin
# Source : §06/M09 W4 + E4 / R_M09.6
# Couche : db + api
# Priorité : P1-critique
Scénario : w4_update_tare_audit_sans_recalcul_retroactif
  Étant donné le type "Roll 850L emboîtable" tare_kg = 37,00 et une pesée historique avec pesees_brutes.tare_kg = 74,00 (2 contenants)
  Quand l'Admin TMS passe la tare à 38,50 via E4
  Alors types_contenants.tare_kg = 38,50
  Et un tms.audit_logs action = 'TYPE_CONTENANT_TARE_UPDATE' est inséré avec diff {old: 37.00, new: 38.50, slug, libelle}
  Et la pesée historique conserve tare_kg = 74,00 (snapshot figé)
  Et les nouvelles pesées utilisent 38,50 (après TTL cache 60s max)
```

```gherkin
# Source : §06/M09 E1
# Couche : ui
# Priorité : P3-nominal
Scénario : e1_dashboard_tri_et_badges
  Étant donné 3 stocks : Kaspia 9/20 (45%), Kardamome 18/20 (90%), Maison Bleue −2/10
  Quand une Ops ouvre /stocks
  Alors le tri par défaut est quantite_actuelle / NULLIF(quantite_cible,0) ASC NULLS LAST (Maison Bleue, Kaspia, Kardamome)
  Et les badges sont "Négatif" (−2, affiché rouge), "Bas" (45% < 50%), "OK" (90%)
  Et la tuile KPI affiche le nb de m09_stock_negatif ouvertes
  Et il n'existe que 3 valeurs de badge (pas de "Critique" — fusion B_M09_01)
```

---

## Catégorie 2 — Cas limites métier

```gherkin
# Source : §05 R4.2 (inégalité stricte)
# Couche : db
# Priorité : P1-critique
Scénario : seuil_50_pct_exact_pas_d_alerte
  Étant donné un stock quantite_cible = 20, seuil 50%
  Quand W1 amène quantite_actuelle à exactement 10 (= 20 × 50%)
  Alors AUCUNE alerte m09_stock_bas n'est émise (condition < stricte)
```

```gherkin
# Source : §05 R4.2
# Couche : db
# Priorité : P1-critique
Scénario : seuil_juste_franchi_alerte
  Étant donné le même stock cible 20, seuil 50%
  Quand W1 amène quantite_actuelle à 9
  Alors m09_stock_bas est émise (warning)
```

```gherkin
# Source : §06/M09 W1 ("et quantite_cible IS NOT NULL")
# Couche : db
# Priorité : P1-critique
Scénario : cible_null_jamais_d_alerte_stock_bas
  Étant donné un stock quantite_cible = NULL (cas fallback W1 stock auto-créé)
  Quand W1 amène quantite_actuelle à 1 puis à −1
  Alors AUCUNE m09_stock_bas n'est émise (cible inconnue)
  Et m09_stock_negatif EST émise au passage sous 0
```

```gherkin
# Source : §05 R4.2 + E1 tri NULLIF
# Couche : db
# Priorité : P2-important
Scénario : cible_zero_pas_de_division_par_zero
  Étant donné un stock quantite_cible = 0
  Quand W1 met à jour le stock et que E1 calcule le tri
  Alors aucune erreur de division par zéro (NULLIF(0) → NULLS LAST)
  Et aucune m09_stock_bas n'est émise (seuil = 0 × 50% = 0, condition < 0 impossible pour stock ≥ 0)
```

```gherkin
# Source : §05 R_M09.5 (bornes ≥ 3 / ≥ 30%)
# Couche : db
# Priorité : P1-critique
Scénario : ecart_absolu_exactement_3_trace_audit
  Étant donné un stock quantite_actuelle = 20
  Quand l'Ops recompte à 17 (écart absolu = 3, relatif 15%)
  Alors l'audit_log M09_RECOMPTE_ECART_ROLLS est inséré (≥ 3 inclusif) et le motif est exigé
```

```gherkin
# Source : §05 R_M09.5
# Couche : db
# Priorité : P1-critique
Scénario : ecart_relatif_exactement_30_pct_trace_audit
  Étant donné un stock quantite_actuelle = 10
  Quand l'Ops recompte à 7 (écart absolu 3… utiliser 13 → écart 3/13 = 23%) — cas canonique : stock 10, recompte 7 = 30% exact
  Alors l'audit_log est inséré (≥ 30% inclusif)
  Et pour stock 10 recompte 8 (écart 2, 20%) : AUCUN audit_log, motif facultatif
```

```gherkin
# Source : §06/M09 W3 (bornes paliers)
# Couche : api
# Priorité : P2-important
Scénario : palier_pax_borne_exacte
  Étant donné les paliers V1 (100/200/400/800)
  Quand nb_pax_total = 100 exactement
  Alors suggestion = 1 roll (≤ inclusif, premier match)
  Et pour nb_pax_total = 101 → 2 rolls
```

```gherkin
# Source : §06/M09 W3 step 4 (palier null)
# Couche : api + ui
# Priorité : P2-important
Scénario : palier_au_dela_800_pax_saisie_manuelle
  Quand nb_pax_total = 801
  Alors le match tombe sur {pax_max: null, rolls: null}
  Et M04 affiche "Saisie manuelle Ops requise (>800 pax)" sans valeur suggérée
```

```gherkin
# Source : §06/M09 E5 (min 10 / max 100) + E4 (tare 0–200)
# Couche : db + api
# Priorité : P2-important
Scénario : bornes_parametres_seuil_et_tare
  Quand l'Admin tente seuil_alerte_stock_roll_pct = 9 puis 101
  Alors les deux sont refusés (min 10, max 100) ; 10 et 100 sont acceptés
  Quand l'Admin tente tare_kg = −1 puis 200,01
  Alors les deux sont refusés (numeric ≥ 0, max 200 kg) ; 0 et 200,00 sont acceptés
```

---

## Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : §06/M09 E3 validation
# Couche : api + ui
# Priorité : P1-critique
Scénario : recompte_quantite_negative_refusee
  Quand l'Ops saisit qte_actuelle_recomptee = −2 dans E3
  Alors la validation UI refuse (entier ≥ 0) et l'appel m09_recompter_rolls avec −2 retourne 422
  (le négatif en DB reste possible uniquement via W1 cloture_collecte — incohérence mesurée, jamais via recompte)
```

```gherkin
# Source : §06/M09 E3 ("motif ≥ 10 chars si seuil écart franchi")
# Couche : api
# Priorité : P1-critique
Scénario : motif_obligatoire_si_seuil_franchi
  Étant donné un recompte avec écart absolu = 5 (≥ 3)
  Quand l'Ops soumet sans motif, puis avec motif "trop court" de 9 caractères
  Alors les deux soumissions sont refusées (motif NOT NULL et ≥ 10 chars)
  Et la soumission avec motif valide ≥ 10 chars passe
```

```gherkin
# Source : §05 R_M09.8 / EC4
# Couche : db
# Priorité : P1-critique
Scénario : archivage_type_avec_stock_actif_interdit
  Étant donné le type "Roll pliable" avec un stock Kaspia quantite_actuelle = 5
  Quand l'Admin tente UPDATE types_contenants SET statut = 'archive'
  Alors le trigger BEFORE UPDATE lève RAISE EXCEPTION mentionnant le nb de stocks actifs et de pesées
  Et l'UI E4 bloque en amont avec le message explicite
```

```gherkin
# Source : §05 R_M09.8
# Couche : db
# Priorité : P1-critique
Scénario : archivage_type_avec_pesees_historiques_interdit
  Étant donné le type "Bac 240L" avec stock partout = 0 mais 12 pesees_brutes historiques le référençant
  Quand l'Admin tente l'archivage
  Alors RAISE EXCEPTION (la condition pesées historiques suffit seule)
```

```gherkin
# Source : §06/M09 EC2 / §9 alertes
# Couche : db
# Priorité : P1-critique
Scénario : stock_negatif_warning_sans_blocage
  Étant donné un stock Kaspia "Roll 850L" quantite_actuelle = 2
  Quand le chauffeur déclare 4 pleins récupérés, 0 vide laissé (clôture W1)
  Alors la transaction ABOUTIT (pas de blocage métier), quantite_actuelle = −2
  Et m09_stock_negatif est émise criticite = 'warning' destinataires ['ops_savr']
  Et l'alerte se résout après recompte E3 correctif (W2)
```

```gherkin
# Source : §06/M09 EC7 / §9 alertes
# Couche : db
# Priorité : P1-critique
Scénario : pesee_tare_zero_emet_tare_manquante
  Étant donné un type contenant actif avec tare_kg = 0 qui n'est PAS 'sans_contenant'
  Quand une pesée M05 référence ce type (auto-tare = 0)
  Alors m09_tare_manquante est émise (warning) destinataires ['ops_savr','admin_tms'] avec contexte {type_contenant_id, slug, libelle}
  Et l'alerte s'auto-résout dès que la tare est paramétrée via E4 (W4)
  Et une pesée 'sans_contenant' (tare légitime 0) n'émet RIEN
```

```gherkin
# Source : §06/M09 W1 fallback dégradé
# Couche : db
# Priorité : P1-critique
Scénario : w1_stock_inexistant_insert_auto
  Étant donné AUCUNE ligne stocks_rolls_traiteurs pour (Maison Bleue, "Roll pliable", lieu NULL)
  Quand une clôture collecte W1 déclare 2 pleins récupérés, 1 vide laissé
  Alors une ligne est INSERT avec quantite_actuelle = −1 (−2 + 1) et quantite_cible = NULL
  Et un tms.audit_logs action 'M09_STOCK_INITIAL_INCONNU' est inséré avec context {traiteur_id, lieu_id, type_contenant_id, quantite_initiale}
  Et AUCUNE alerte M11 n'est émise pour cet event (code info retiré Bloc 3 A1) — mais m09_stock_negatif OUI (quantite < 0)
```

```gherkin
# Source : §06/M09 EC9
# Couche : api + ui
# Priorité : P2-important
Scénarios : recompte_concurrent_lock_optimiste
  Étant donné 2 Ops ouvrant E3 sur le même (Kaspia, "Roll 850L") avec derniere_maj_at = T0
  Quand Ops A valide (UPDATE … WHERE derniere_maj_at = T0 → 1 row), puis Ops B valide avec le même T0
  Alors l'UPDATE de B affecte 0 rows
  Et l'UI de B affiche le toast "Stock modifié par {Ops A} entre temps. Re-charger ?" + bouton re-fetch
  Et aucun rolls_mouvements n'est inséré pour la tentative de B
```

```gherkin
# Source : §04 types_contenants ("code immuable")
# Couche : db
# Priorité : P2-important
Scénario : code_type_contenant_immuable
  Quand l'Admin tente UPDATE types_contenants SET code = 'roll_850L_v2' WHERE code = 'roll_850L'
  Alors la mutation est refusée (trigger ou contrainte d'immuabilité) — les références historiques ne cassent jamais
```

```gherkin
# Source : §06/M09 E4 (catégorie enum)
# Couche : db
# Priorité : P3-nominal
Scénario : categorie_enum_4_valeurs
  Quand l'Admin tente d'insérer un type avec categorie = 'caisse'
  Alors le CHECK constraint refuse (enum = roll, bac, sac, autre — D_M09_02)
```

---

## Catégorie 4 — Isolation données (RLS)

```gherkin
# Source : §09 section 13
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : rls_stocks_rolls_staff_only
  Étant donné un manager_prestataire Strike et un chauffeur authentifiés
  Quand chacun exécute SELECT sur tms.stocks_rolls_traiteurs
  Alors 0 rows pour les deux (policy stocks_rolls_staff_only — user_is_staff() requis)
  Et INSERT/UPDATE/DELETE sont également deny
  Et ops_savr et admin_tms ont accès complet (RW)
```

```gherkin
# Source : §09 section 9
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : rls_rolls_mouvements_chauffeur_insert_self_only
  Étant donné le chauffeur C1 (Strike) authentifié
  Quand C1 INSERT un rolls_mouvements avec saisi_par_chauffeur_id = C1
  Alors l'INSERT passe (policy rolls_chauffeur_insert)
  Quand C1 INSERT avec saisi_par_chauffeur_id = C2
  Alors deny (anti-spoofing WITH CHECK)
```

```gherkin
# Source : §09 section 9 (commentaire UPDATE/DELETE)
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : rls_rolls_mouvements_chauffeur_update_deny
  Étant donné le chauffeur C1 ayant inséré un mouvement
  Quand C1 tente UPDATE ou DELETE sur sa propre ligne
  Alors deny (correction historique réservée staff — §09 matrice "Modifier rolls_mouvements historique : Admin TMS oui")
  Et C1 peut SELECT ses propres saisies uniquement (rolls_chauffeur_read), pas celles de C2
```

```gherkin
# Source : §09 section 9 (rolls_manager_read)
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : rls_rolls_mouvements_manager_cross_presta_deny
  Étant donné des mouvements liés à des tournées Strike et Marathon
  Quand le manager_prestataire Strike SELECT rolls_mouvements
  Alors il ne voit QUE les mouvements dont la collecte appartient à une tournée prestataire_id = Strike
  Et 0 rows Marathon
```

```gherkin
# Source : §09 section 4
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : rls_types_contenants_lecture_publique_ecriture_admin_only
  Quand chauffeur et manager_prestataire SELECT types_contenants
  Alors lecture OK (référentiel public authentifié)
  Quand chauffeur, manager OU ops_savr tente INSERT/UPDATE (ex: modifier tare_kg)
  Alors deny — écriture admin_tms uniquement (policy types_contenants_admin_write, tranché Val 2026-06-07 floue #3)
  Et admin_tms UPDATE tare_kg → OK
```

```gherkin
# Source : §06/M09 E1/E2 ("Manager prestataire / chauffeur → 403")
# Couche : ui (Playwright)
# Priorité : P2-important
Scénario : ui_stocks_403_non_staff
  Quand un manager_prestataire navigue vers /stocks puis /stocks/traiteurs/{id}
  Alors 403 sur les deux routes
```

```gherkin
# Source : §06/M09 E5 / §05 R4.4 (modifiable_par)
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : rls_parametres_paliers_ops_autorise
  Étant donné palier_rolls_par_pax_seuils avec modifiable_par = ['admin_tms','ops_savr']
  Quand une ops_savr UPDATE la valeur du paramètre
  Alors l'UPDATE passe (D6)
  Quand un manager_prestataire tente la même chose
  Alors deny
```

```gherkin
# Source : §09 section 13 + tms.audit_logs
# Couche : db (pgTAP)
# Priorité : P2-important
Scénario : rls_audit_logs_lecture_staff_seulement
  Quand un manager_prestataire SELECT tms.audit_logs filtrés action 'M09_RECOMPTE_ECART_ROLLS'
  Alors 0 rows (matrice §04 : audit_logs R = staff uniquement V1)
```

```gherkin
# Source : §09 A3 + M09 D8
# Couche : db (pgTAP)
# Priorité : P2-important
Scénario : rls_chauffeur_pas_d_acces_stock_direct
  Quand le chauffeur SELECT stocks_rolls_traiteurs (même pour le traiteur de sa tournée du jour)
  Alors 0 rows — le pré-affichage stock dans M05 passe par l'app (service role / RPC), pas par un accès table direct chauffeur
```

---

## Catégorie 5 — Idempotence et états

```gherkin
# Source : §06/M09 W1 (idempotence UNIQUE)
# Couche : db
# Priorité : P1-critique
Scénario : w1_replay_meme_collecte_type_un_seul_effet
  Étant donné un W1 déjà appliqué pour (collecte X, "Roll 850L") : stock passé de 12 à 11
  Quand M05 rejoue W1 pour la même (collecte, type) — cas retry PWA queue offline
  Alors l'INSERT rolls_mouvements échoue silencieusement (ON CONFLICT DO NOTHING sur UNIQUE (collecte_id, type_contenant_id))
  Et quantite_actuelle reste 11 (UPDATE stock skippé — aucun double décompte)
```

```gherkin
# Source : §05 R_M09.6 / EC3
# Couche : db
# Priorité : P1-critique
Scénario : snapshot_tare_fige_pendant_tournee
  Étant donné une tournée en cours avec une pesée déjà validée (tare snapshot 37 kg)
  Quand l'Admin modifie la tare à 40 kg en plein milieu de tournée (EC3)
  Alors la pesée déjà validée conserve 37 kg
  Et la pesée suivante de la même tournée utilise 40 kg (après TTL 60s max)
  Et aucun job de recalcul rétroactif n'existe
```

```gherkin
# Source : §05 R_M09.8 / EC4 (sortie de l'état bloqué)
# Couche : db
# Priorité : P2-important
Scénario : archivage_possible_apres_solde_stocks
  Étant donné le type "Bac 240L" bloqué à l'archivage (stock Kaspia = 3, 0 pesée historique)
  Quand l'Ops recompte le stock à 0 via E3 (motif "Décommission type contenant")
  Et que l'Admin retente l'archivage
  Alors statut = 'archive' passe (plus de stock > 0, pas de pesée)
  Et le type n'apparaît plus dans les listes M05 chauffeur (statut actif filtré)
```

```gherkin
# Source : §06/M09 EC10
# Couche : db
# Priorité : P2-important
Scénario : suppression_collecte_source_mouvement_conserve
  Étant donné un rolls_mouvements lié à la collecte X
  Quand la collecte X est supprimée
  Alors le mouvement reste en historique avec collecte_id = NULL (FK ON DELETE SET NULL selon M09 EC10)
  Et aucune réversion de stock automatique n'est appliquée
```

```gherkin
# Source : §04 rolls_mouvements ("UPDATE si correction") vs M09 W1
# Couche : db
# Priorité : P1-critique
Scénario : correction_declaration_chauffeur_pas_de_double_comptage
  Étant donné un W1 appliqué : 3 pleins / 2 vides, stock 12 → 11 (delta = −1)
  Quand le chauffeur corrige sa déclaration en 2 pleins / 2 vides (UPDATE, pas INSERT — §04 tranché)
  Alors le trigger applique stock += new.delta − old.delta : stock final = 12 (11 + 0 − (−1))
  Et il n'existe toujours qu'UNE ligne rolls_mouvements pour (collecte, type), delta = 0, stock_apres = 12
```

```gherkin
# Source : §06/M09 §9 (catalogue alertes)
# Couche : db
# Priorité : P2-important
Scénario : catalogue_m09_trois_warnings_zero_critical
  Quand on SELECT alertes_catalogue WHERE code LIKE 'm09_%'
  Alors exactement 3 codes : m09_stock_bas, m09_stock_negatif, m09_tare_manquante — tous criticite = 'warning'
  Et m09_webhook_s8_dlq, m09_recompte_ecart_rolls, m09_tare_modifiee, m09_stock_initial_inconnu sont ABSENTS
```

---

## Catégorie 6 — Cross-schema (vue `plateforme.v_stocks_rolls`)

> Zéro endpoint HTTP : S8 supprimé (§08 Bloc A A3). Le contrat inter-apps = la vue. Tests de fraîcheur + RLS Plateforme.

```gherkin
# Source : §06/M09 W1/W2 + §04 App vue v_stocks_rolls
# Couche : db
# Priorité : P1-critique
Scénario : vue_refletee_immediatement_apres_w1
  Étant donné le stock Kaspia "Roll 850L" = 12 visible dans plateforme.v_stocks_rolls
  Quand W1 (clôture collecte) passe le stock à 11 puis W2 (recompte) à 14
  Alors chaque SELECT sur la vue retourne immédiatement la nouvelle valeur (lecture directe, zéro cache, zéro table miroir)
  Et la colonne derniere_maj_at reflète l'horodatage TMS
```

```gherkin
# Source : §04 App v_stocks_rolls (colonnes exposées)
# Couche : db
# Priorité : P1-critique
Scénario : vue_expose_contrat_colonnes_whitelist
  Quand on inspecte les colonnes de plateforme.v_stocks_rolls
  Alors exactement : traiteur_id, lieu_id, type_contenant_slug, type_contenant_libelle, quantite_actuelle, quantite_cible, derniere_maj_at, source
  Et AUCUNE colonne interne TMS (id, derniere_maj_par_chauffeur_id, derniere_maj_collecte_id) ne fuite
```

```gherkin
# Source : §04 App v_stocks_rolls RLS
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : rls_vue_traiteur_son_stock_uniquement
  Étant donné des stocks Kaspia et Kardamome
  Quand un traiteur_manager Kaspia SELECT plateforme.v_stocks_rolls
  Alors uniquement les lignes traiteur_id = Kaspia (0 ligne Kardamome)
  Et le traiteur_commercial Kaspia a la même visibilité (lecture org-wide)
```

```gherkin
# Source : §04 App v_stocks_rolls RLS (décision Val 2026-05-01)
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : rls_vue_gestionnaire_lieux_et_client_deny
  Quand un gestionnaire_lieux puis un client_organisateur SELECT plateforme.v_stocks_rolls
  Alors 0 rows pour les deux (rolls attribués aux traiteurs uniquement, dashboard gestionnaire supprimé)
  Et admin_savr + ops_savr Plateforme → lecture totale
```

```gherkin
# Source : §04 App addendum schémas (RLS cross-schema)
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : cross_schema_plateforme_ne_peut_pas_ecrire_stock_tms
  Quand admin_savr (Plateforme) tente INSERT/UPDATE/DELETE sur tms.stocks_rolls_traiteurs ou tms.rolls_mouvements
  Alors deny total (la Plateforme lit la vue, n'écrit jamais le schéma tms)
```

```gherkin
# Source : §04 App v_stocks_rolls ("la vue n'est jamais écrite")
# Couche : db
# Priorité : P2-important
Scénario : vue_lecture_seule
  Quand un rôle Plateforme quelconque tente INSERT/UPDATE/DELETE sur plateforme.v_stocks_rolls
  Alors erreur (vue non updatable / policy deny)
```

---

## Catégorie 7 — Scénarios de migration

> Référence : M09 §3 Plan de consolidation stocks (§13 D4 A5=c) — stocks initiaux estimés sans inventaire physique, rectification J0 → J+30 via E3.

```gherkin
# Source : §06/M09 §3 (J0) + §13 D4
# Couche : db
# Priorité : P1-critique
Scénario : migration_seed_stocks_initiaux_j0
  Étant donné le dataset seed_demo avec les stocks confirmés Val 2026-04-28 (Roll 850L = 60, Roll pliable = 8 au global)
  Quand Ops saisit la répartition par traiteur via E3 (acteur 'migration')
  Alors chaque saisie crée un rolls_mouvements source = 'recompte_ops' et le stock correspondant
  Et SUM(quantite_actuelle) par type = 60 et 8 (check réconciliation)
```

```gherkin
# Source : §06/M09 §3 (fenêtre J0 → J+30)
# Couche : db
# Priorité : P1-critique
Scénario : migration_alertes_contexte_migration_test
  Étant donné la fenêtre de migration active (J0 → J+30)
  Quand un stock estimé franchit le seuil 50% et émet m09_stock_bas
  Alors l'alerte porte contexte = 'migration_test' (cf. §04 addendum §13)
  Et elle reste traitée normalement par Ops (warning visible dashboard)
```

```gherkin
# Source : §06/M09 §3 (clause R_§13.8 sans objet pour M09)
# Couche : db
# Priorité : P2-important
Scénario : migration_pas_de_purge_auto_j30_warnings
  Étant donné des m09_stock_bas contexte 'migration_test' encore ouvertes à J+30
  Quand le cron m13_cleanup_legacy s'exécute (auto-résolution critical only — R_§13.8)
  Alors les warnings m09_* NE SONT PAS auto-résolues (M09 n'a aucun critical)
  Et elles se résolvent naturellement au prochain W1 ou W2 qui repasse le stock au-dessus du seuil
```

```gherkin
# Source : §06/M09 §3 + idempotence E3
# Couche : db
# Priorité : P2-important
Scénario : migration_relance_seed_pas_de_doublon
  Étant donné le seed J0 déjà exécuté
  Quand le script de saisie initiale est relancé sur les mêmes (traiteur, type)
  Alors aucun stock dupliqué (UNIQUE composite respecté) — le re-run passe par UPDATE recompte, pas INSERT
  Et SUM par type reste 60 / 8
```

---

## Scénarios hors scope (à générer en V1.1)

- **Inventaire trimestriel magic link traiteur** (D4 — V1.1) : cron + email + confirmation traiteur.
- **Pagination historique mouvements > 30** (QO5 — V1.5).
- **Rôle `agent_entrepot` délégué** (QO7 — V1.5, alignement M10 D11).
- **Cron M09 dédié** : aucun en V1 (résolutions d'alertes portées par W1/W2, pas de job périodique).
- **Stock bacs entrepôt** : couvert par les scénarios M10 (frontière documentaire D1 — ne pas dupliquer ici).

---

## ✅ Specs floues tranchées par Val (2026-06-07) — propagées dans le CDC

### #1 — Criticité `m09_stock_negatif` : **warning** (M09 fait foi)

§05 R4.3 disait encore `critical` (stale, jamais aligné post-sobriété). **Tranché : warning** — invariant « M09 zéro critical V1 » préservé. §05 R4.3 corrigé.

### #2 — BLOQUANT : schéma §04 `rolls_mouvements` **réécrit sur le modèle M09**

**Tranché : réécriture §04 modèle M09 — FAIT 2026-06-07.** Le §04 niveau 2 décrivait une table incompatible avec M09 (jamais propagée depuis M09 V1 2026-04-25) :

| Point | §04 actuel | M09 (W1/W2/EC10 + vue App) |
|---|---|---|
| Type | `type_roll` text enum (`roll_240L_biodechet`…) | FK `type_contenant_id` → `types_contenants` |
| UNIQUE | `(collecte_tms_id, type_roll)` | `(collecte_id, type_contenant_id)` |
| Recompte Ops | impossible : `collecte_tms_id` NOT NULL, `tournee_id` NOT NULL, `saisi_par_chauffeur_id` NOT NULL | W2 insère source `'recompte_ops'` sans collecte/tournée/chauffeur, avec `user_id` + `motif` |
| Colonnes manquantes | — | `source`, `motif`, `user_id`, `plateforme_lieu_id`, « stock après » (affiché E2), exposée `source` dans la vue App |
| FK collecte | NOT NULL | EC10 : ON DELETE **SET NULL** (contradictoire avec NOT NULL) |
| Correction chauffeur | « UPDATE (pas INSERT) » — mais R4.1 appliquerait le delta complet au re-UPDATE → **double comptage** non spécifié | idempotence ON CONFLICT DO NOTHING |

**Propagé** : §04 `rolls_mouvements` réécrit — FK `type_contenant_id` (remplace enum `type_roll`), colonnes `source`/`motif`/`user_id`/`plateforme_lieu_id`/`delta`/`stock_apres`, `collecte_tms_id` nullable + CHECK d'intégrité par source + FK ON DELETE SET NULL, UNIQUE partiel `(collecte_tms_id, type_contenant_id)`. Correction chauffeur = UPDATE avec reversement du delta précédent (`stock += new.delta − old.delta`) — jamais de double comptage. Les 2 scénarios ex-`[BLOQUÉ #2]` sont débloqués.

### #3 — Droits d'écriture sur les tares : **Admin TMS seul** (M09 E4 fait foi)

§09 section 4 disait écriture staff (Ops incluse), §04 « Écriture Ops Savr / Admin TMS ». **Tranché : `admin_tms` uniquement** — une tare fausse fausse toutes les pesées (auto-tare M05), fréquence ~1×/trimestre. **Propagé** : §09 §4 policy dédiée `types_contenants_admin_write` + matrice §04 + note RLS §04 corrigées. Scénario `rls_types_contenants_lecture_publique_ecriture_admin_only` aligné.

### #4 — Paramètre paliers : **nom + seed M09** (`palier_rolls_par_pax_seuils`)

§05 R4.4 disait `palier_rolls_par_pax_biodechet_seuils` (ex 50/150). **Tranché : convention M09** — pas de variante par flux V1, seed 100/200/400/800/null. **Propagé** : §05 R4.4 corrigé.

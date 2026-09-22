# Scénarios de test — M10 Gestion exutoires Veolia

**Source CDC** : §06/M10 (V3 sobre 2026-04-30) + §05 R5.1-R5.8 v3 + §04 Niveau 4 (`stocks_bacs_entrepot`, `passages_veolia`, `recomptages_stocks_entrepot_log`) + §09 RLS section 13
**Généré le** : 2026-06-07
**Statut** : À implémenter par Claude Code

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests du module M10.
> Pour chaque scénario :
> - Couche `db` → test pgTAP dans `supabase/tests/`
> - Couche `api` → test Vitest dans `packages/tms/tests/api/`
> - Couche `ui` → test Playwright dans `packages/tms/tests/e2e/`
> Les tests P1-critique sont bloquants CI. P2/P3 non-bloquants V1.
> Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.

> **Périmètre API** : M10 est **100% interne TMS V1**. Aucun endpoint E1-E6 / S1-S11, aucune exposition cross-schema vers la Plateforme (§13 Liens : "Aucun lien direct V1"). La catégorie 6 est donc **vide et justifiée**. Le seul couplage entrant est le trigger W1 sur `tms.tournees` (clôture M04), testé en catégories 1 et 5.

---

## Résumé de couverture

| Catégorie | Nb scénarios | Couverture |
|-----------|-------------|------------|
| 1. Happy path | 9 | W1-W8, W10, E2/E8 |
| 2. Cas limites métier | 12 | Bornes R5.3 (seuil absolu + 85%), EC12 borne, EC7, seuils recomptage R5.6 (5 bacs / 20%), `quantite_vide_cible`, F1/F2 (date jour J, passage veille) |
| 3. Cas d'erreur | 12 | EC2, EC8, EC9, EC10, EC12, EC14 (F4), R5.7 v3 étendu (F3), CHECK constraints, motif recomptage |
| 4. Isolation RLS | 6 | ops_savr / admin_tms / manager_prestataire / chauffeur, append-only log |
| 5. Idempotence & états | 9 | W1 `stock_entrepot_update_at`, R5.4 v3 reset unique, R5.8 v3 atomique, W10 sans impact stock, auto-résolutions |
| 6. Cross-app | 0 | N/A — M10 interne TMS (couplage M04 testé cat. 1/5) |
| 7. Migration | 3 | Plan consolidation stocks §13 D4 (contexte `migration_test`, cron J+30, acteur `migration`) |
| **TOTAL** | **52** | |

**4 specs floues TRANCHÉES par Val 2026-06-07 + PROPAGÉES (M10 + §05 + §04 + M11).** Voir section finale.

---

## Catégorie 1 — Happy path

```gherkin
# Source : §06/M10 W1 / R5.5
# Couche : db
# Priorité : P1-critique
Scénario : cloture_tournee_zd_incremente_stock_pleins
  Étant donné un stock biodéchet × bac 240L avec quantite_pleine = 5 et quantite_vide_disponible = 10
  Et une tournée ZD avec 3 pesées brutes flux biodéchet type bac 240L et stock_entrepot_update_at IS NULL
  Quand la tournée passe au statut 'terminee' (clôture chauffeur M04)
  Alors quantite_pleine = 8 et quantite_vide_disponible = 7 pour ce couple
  Et derniere_maj_at = now() et derniere_maj_par_user_id IS NULL (mutation auto)
  Et tournees.stock_entrepot_update_at est renseigné
  Et aucune ligne n'est insérée dans recomptages_stocks_entrepot_log (réservé corrections humaines)
```

```gherkin
# Source : §06/M10 W2 + E4
# Couche : api + ui
# Priorité : P2-important
Scénario : creation_passage_prevu_saisie_manuelle
  Étant donné une Ops Savr connectée sur /exutoires#passages
  Quand elle crée via E4 un passage date_prevue = J+3, flux 'verre', type_contenant 'bac 240L verre'
  Alors un passage_veolia est INSERT statut 'planifie', cree_par_action = 'saisie_manuelle', saisi_par_user_id = ops_user_id
  Et aucune alerte M11 n'est émise (création normale)
```

```gherkin
# Source : §06/M10 W3 + E5 / R5.4 v3
# Couche : db + api
# Priorité : P1-critique
Scénario : declaration_realise_reset_total_stock
  Étant donné un passage 'planifie' flux biodéchet × bac 240L et un stock quantite_pleine = 15, quantite_vide_disponible = 3
  Et une Ops Savr qui a coché la case "J'ai vérifié via vidéosurveillance"
  Quand elle déclare le passage réalisé via tms.m10_declarer_passage_realise avec nb_bacs_enleves = 15
  Alors passages_veolia.statut = 'realise', statut_realise_at et verification_video_at renseignés
  Et le trigger trg_m10_reset_total_pleins met quantite_pleine = 0 et quantite_vide_disponible = 18
  Et une ligne recomptages_stocks_entrepot_log est insérée motif 'reset_passage_veolia <passage_id>'
  Et les alertes ouvertes m10_bac_satur et m10_passage_non_confirme du couple sont auto-résolues
```

```gherkin
# Source : §06/M10 W4 + E6 / D5
# Couche : api + ui
# Priorité : P2-important
Scénario : bouton_declencher_cree_passage_trace
  Étant donné une jauge biodéchet à 95% sur le dashboard Ops E8
  Quand Ops clique "Déclencher collecte Veolia", saisit date J+1 + flux + commentaire et confirme
  Alors un passage 'planifie' est créé avec cree_par_action = 'bouton_declencher'
  Et aucune notification n'est envoyée à Veolia (pas d'API V1 — le passage sert uniquement de trace)
  Et E6 affiche les infos à copier-coller (flux, nb bacs pleins courant, contact_veolia paramétré)
```

```gherkin
# Source : §06/M10 W5 + E7 / R5.6
# Couche : db + api
# Priorité : P1-critique
Scénario : recomptage_manuel_corrige_stock
  Étant donné un stock verre × bac 240L quantite_pleine = 12 (estimation auto) et quantite_vide_disponible = 8
  Quand Ops valide E7 avec quantite_pleine_recomptee = 10, quantite_vide_disponible_recomptee = 9, motif 'Recompte routinier'
  Alors une ligne recomptages_stocks_entrepot_log est insérée avec valeurs avant/après + écarts + user_id
  Et stocks_bacs_entrepot est mis à jour (10 / 9), derniere_maj_par_user_id = ops_user_id
  Et aucun audit_log M10_RECOMPTAGE_ECART (écart 2 bacs < 5 et 16,7% < 20%)
```

```gherkin
# Source : §06/M10 W6 / R5.3
# Couche : db
# Priorité : P1-critique
Scénario : saturation_seuil_absolu_alerte_critical
  Étant donné un stock biodéchet × bac 240L avec seuil_saturation_pleins = 18 et quantite_pleine = 17
  Quand quantite_pleine passe à 19 (clôture tournée W1)
  Alors tms.alerte_emit('m10_bac_satur') est appelée avec criticite = 'critical' et context {flux, type_contenant_id, quantite_pleine, seuil}
  Et destinataires roles ['ops_savr','admin_tms'] + email Resend
```

```gherkin
# Source : §06/M10 W7 / R5.1
# Couche : db
# Priorité : P1-critique
Scénario : cron_passage_non_declare_j_moins_1_warning
  Étant donné un passage 'planifie' date_prevue = demain
  Quand le cron horaire m10_alerte_non_confirme s'exécute
  Alors une alerte m10_passage_non_confirme criticité 'warning' est émise avec entity_id = passage.id, destinataires ['ops_savr']
  Et sans email Resend
```

```gherkin
# Source : §06/M10 W8 + W10 / R5.2
# Couche : db + ui
# Priorité : P2-important
Scénario : report_passage_alerte_et_recreation
  Étant donné un passage 'planifie' flux carton
  Quand Ops l'annule avec motif_annulation = 'report' + motif libre
  Alors statut = 'annule', alerte m10_passage_reporte (warning) émise avec context {ancienne_date, flux, motif_libre}
  Et le stock entrepôt n'est PAS modifié
  Et E3 propose le bouton "Créer nouveau passage" pré-rempli ; le nouveau passage porte passage_origine_id = passage annulé
  Et l'alerte m10_passage_reporte est auto-résolue à la création du nouveau passage 'planifie' du même flux
```

```gherkin
# Source : §06/M10 E2 + E8
# Couche : ui
# Priorité : P3-nominal
Scénario : jauges_tri_saturation_et_drill_down
  Étant donné 3 couples actifs : biodéchet 240L à 90%, verre 240L à 40%, carton 660L à 60%
  Quand Ops ouvre /exutoires#stock
  Alors le tableau E2 est trié quantite_pleine/capacite_max DESC (biodéchet en premier, jauge orange "Saturation")
  Et sur /dispatch les tuiles E8 affichent "{flux} {type} : {pleins}/{capacite_max} ({%})" avec la même palette
  Et un clic sur la tuile biodéchet redirige vers /exutoires#stock?flux=biodechet&type_contenant_id={id}
```

---

## Catégorie 2 — Cas limites métier

```gherkin
# Source : §05 R5.3 (condition stricte >)
# Couche : db
# Priorité : P1-critique
Scénario : quantite_pleine_egale_seuil_pas_de_critical
  Étant donné seuil_saturation_pleins = 18, capacite_max = 30
  Quand quantite_pleine passe à exactement 18
  Alors aucune alerte critical n'est émise (règle = strictement supérieur au seuil)
  Et comme 18/30 = 60% < 85%, aucune alerte warning non plus
```

```gherkin
# Source : §05 R5.3
# Couche : db
# Priorité : P1-critique
Scénario : quantite_pleine_seuil_plus_un_critical
  Étant donné seuil_saturation_pleins = 18
  Quand quantite_pleine passe de 18 à 19
  Alors alerte m10_bac_satur criticité 'critical' émise
```

```gherkin
# Source : §05 R5.3 (borne 85%)
# Couche : db
# Priorité : P1-critique
Scénario : ratio_85_pct_exact_warning
  Étant donné capacite_max = 20 et seuil_saturation_pleins = 19, aucune alerte m10_bac_satur ouverte
  Quand quantite_pleine passe à 17 (17/20 = 85% exactement)
  Alors alerte m10_bac_satur criticité 'warning' émise (condition >= 0.85, et 17 <= seuil 19)
```

```gherkin
# Source : §05 R5.3
# Couche : db
# Priorité : P2-important
Scénario : ratio_sous_85_pct_pas_d_alerte
  Étant donné capacite_max = 20 et seuil_saturation_pleins = 19
  Quand quantite_pleine passe à 16 (80%)
  Alors aucune alerte m10_bac_satur émise
```

```gherkin
# Source : §06/M10 E5 + EC12 (borne exacte)
# Couche : api
# Priorité : P1-critique
Scénario : nb_bacs_enleves_egal_quantite_pleine_ok
  Étant donné un stock quantite_pleine = 15
  Quand Ops déclare un passage réalisé avec nb_bacs_enleves = 15
  Alors la déclaration passe sans erreur ni warning (le bloquant EC12 est strictement >)
```

```gherkin
# Source : §06/M10 EC7 v3 / R5.4 v3
# Couche : api + db
# Priorité : P1-critique
Scénario : enlevement_partiel_warning_mais_reset_total
  Étant donné un stock quantite_pleine = 15
  Quand Ops déclare nb_bacs_enleves = 10 (< 15)
  Alors un warning informatif non bloquant est affiché en E5
  Et le reset TOTAL est appliqué quand même : quantite_pleine = 0, quantite_vide_disponible += 15
  Et nb_bacs_enleves = 10 est tracé en base sans effet métier sur le stock (audit V2)
```

```gherkin
# Source : §05 R5.6 (borne écart absolu)
# Couche : db
# Priorité : P1-critique
Scénario : ecart_recomptage_5_bacs_exact_motif_et_audit
  Étant donné quantite_pleine = 20
  Quand Ops recompte quantite_pleine_recomptee = 15 (écart absolu = 5) avec motif renseigné
  Alors le recomptage passe et un audit_log action 'M10_RECOMPTAGE_ECART' est inséré avec diff {ecart_pleins, ecart_relatif, motif}
  Et un email récap est envoyé (écart >= 5 bacs)
```

```gherkin
# Source : §05 R5.6 (borne écart relatif)
# Couche : db
# Priorité : P2-important
Scénario : ecart_relatif_20_pct_exact_motif_obligatoire
  Étant donné quantite_pleine = 10
  Quand Ops recompte quantite_pleine_recomptee = 8 (écart 2 bacs < 5 MAIS 2/10 = 20% exactement)
  Alors le motif est obligatoire (condition >= 0.20) et l'audit_log M10_RECOMPTAGE_ECART est inséré
```

```gherkin
# Source : §06/M10 W1 / catalogue m10_bacs_vides_sous_seuil
# Couche : db
# Priorité : P2-important
Scénario : vides_sous_cible_alerte_et_retour_resolution
  Étant donné quantite_vide_cible = 10 et quantite_vide_disponible = 10
  Quand une clôture tournée W1 fait passer quantite_vide_disponible à 9
  Alors alerte m10_bacs_vides_sous_seuil (warning) émise
  Quand un recomptage E7 motif 'Réception commande fournisseur' remonte quantite_vide_disponible à 10
  Alors l'alerte est auto-résolue (condition >= quantite_vide_cible)
```

```gherkin
# Source : §06/M10 E4 + §05 R5.8 v3 (arbitrage F1 2026-06-07)
# Couche : api
# Priorité : P1-critique
Scénario : passage_date_prevue_aujourdhui_planifie_normal
  Étant donné une Ops Savr sur E4
  Quand elle crée un passage avec date_prevue = aujourd'hui
  Alors un passage statut 'planifie' est créé (pas de bascule a posteriori — réservée à date_prevue < now()::date strictement)
  Et le stock n'est pas modifié à la création
```

```gherkin
# Source : §06/M10 E5 (arbitrage F2 2026-06-07)
# Couche : db + api
# Priorité : P1-critique
Scénario : declaration_passage_de_la_veille_date_saisie_conservee
  Étant donné un passage 'planifie' date_prevue = hier
  Quand Ops le déclare réalisé aujourd'hui avec date_realise_at = hier 06:30
  Alors passages_veolia.statut_realise_at = hier 06:30 (valeur saisie, PAS now())
  Et verification_video_at = now() (horodatage de la déclaration)
  Et le reset stock R5.4 v3 s'applique normalement
```

```gherkin
# Source : §06/M10 EC15
# Couche : ui
# Priorité : P3-nominal
Scénario : capacite_max_zero_jauge_masquee
  Étant donné un couple emballage × bac 660L avec capacite_max = 0 (jamais paramétré)
  Quand Ops ouvre E2 et E8
  Alors la jauge de ce couple n'est affichée ni en E2 ni en E8 (couple ignoré)
  Et aucune alerte saturation 85% n'est émise pour ce couple (division par capacite_max protégée par condition capacite_max > 0)
```

---

## Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : §06/M10 EC12 + W3 étape 3
# Couche : api + ui
# Priorité : P1-critique
Scénario : nb_bacs_enleves_superieur_stock_bloquant
  Étant donné un stock quantite_pleine = 15
  Quand Ops tente de déclarer nb_bacs_enleves = 16
  Alors E5 affiche l'erreur bloquante "Impossible : ne peut pas enlever plus que présent"
  Et la déclaration est refusée — le passage reste 'planifie' et le stock inchangé
```

```gherkin
# Source : §05 R5.7 v3 / EC5 v3
# Couche : db
# Priorité : P1-critique
Scénario : deconfirmation_realise_vers_annule_exception
  Étant donné un passage 'realise'
  Quand un UPDATE tente statut = 'annule'
  Alors le trigger trg_m10_anti_deconfirmation lève RAISE EXCEPTION 'Annulation / déconfirmation post-realise interdite...'
  Et le passage et le stock restent inchangés
```

```gherkin
# Source : §05 R5.7 v3
# Couche : db
# Priorité : P1-critique
Scénario : deconfirmation_realise_vers_planifie_exception
  Étant donné un passage 'realise'
  Quand un UPDATE tente statut = 'planifie' (y compris par admin_tms)
  Alors RAISE EXCEPTION — realise est terminal pour tous les rôles
```

```gherkin
# Source : §05 R5.7 v3 étendu (arbitrage F3 2026-06-07)
# Couche : db
# Priorité : P1-critique
Scénario : reactivation_annule_vers_planifie_exception
  Étant donné un passage 'annule' (motif 'annulation')
  Quand un UPDATE tente statut = 'planifie' ou 'realise'
  Alors le trigger trg_m10_anti_deconfirmation étendu lève RAISE EXCEPTION (annule = terminal en DB)
  Et le report passe obligatoirement par la création d'un NOUVEAU passage planifie (passage_origine_id)
```

```gherkin
# Source : §04 CHECK passages_veolia (cohérence annulation)
# Couche : db
# Priorité : P1-critique
Scénario : annulation_sans_motif_check_violation
  Étant donné un passage 'planifie'
  Quand un UPDATE pose statut = 'annule' avec motif_annulation NULL
  Alors la contrainte CHECK (statut = 'annule' AND motif_annulation IS NOT NULL) rejette la transaction
```

```gherkin
# Source : §04 CHECK passages_veolia (cohérence statut_realise_at)
# Couche : db
# Priorité : P2-important
Scénario : realise_sans_statut_realise_at_check_violation
  Quand un INSERT/UPDATE pose statut = 'realise' avec statut_realise_at NULL
  Alors la contrainte CHECK (statut = 'realise' AND statut_realise_at IS NOT NULL) rejette
  Et inversement un statut 'planifie' avec statut_realise_at NOT NULL est rejeté
```

```gherkin
# Source : §06/M10 E5 (checkbox vidéo obligatoire)
# Couche : ui
# Priorité : P1-critique
Scénario : declaration_sans_checkbox_video_bloquee
  Étant donné le modal E5 ouvert sur un passage 'planifie'
  Quand Ops remplit tous les champs mais ne coche pas "J'ai vérifié via vidéosurveillance"
  Alors le bouton "Déclarer passage réalisé" reste désactivé ou la soumission est refusée
```

```gherkin
# Source : §05 R5.6
# Couche : db
# Priorité : P1-critique
Scénario : recomptage_ecart_significatif_sans_motif_exception
  Étant donné quantite_pleine = 20
  Quand tms.m10_recompter est appelée avec qte_pleine_apres = 12 (écart 8 >= 5) et motif NULL ou vide
  Alors RAISE EXCEPTION 'Motif obligatoire si écart significatif'
  Et aucune ligne log ni mise à jour stock
```

```gherkin
# Source : §04 CHECK stocks_bacs_entrepot
# Couche : db
# Priorité : P2-important
Scénario : valeurs_stock_negatives_rejetees
  Quand un UPDATE direct tente quantite_pleine = -1 ou quantite_vide_disponible = -1
  Alors les contraintes CHECK >= 0 rejettent la transaction
  Et idem pour capacite_max < 0 et seuil_saturation_pleins < 0
```

```gherkin
# Source : §06/M10 EC2
# Couche : db + ui
# Priorité : P2-important
Scénario : depassement_physique_non_bloquant
  Étant donné capacite_max = 20
  Quand quantite_pleine passe à 22 via W1 (la réalité physique dépasse le paramétrage)
  Alors aucune erreur bloquante — la jauge E2 plafonne à 100% avec badge "Dépassement" rouge
  Et alerte m10_bac_satur critical émise
```

```gherkin
# Source : §06/M10 EC8 + EC10
# Couche : db + ui
# Priorité : P2-important
Scénario : type_contenant_archive_filtre_et_protege
  Étant donné un type_contenant statut 'archive' référencé par des passages historiques
  Quand Ops ouvre E4 ou E5
  Alors le type archivé n'apparaît pas dans les selects (filtré UI)
  Et un DELETE sur ce type_contenant est rejeté (FK ON DELETE RESTRICT)
  Et l'archivage d'un type avec stocks > 0 est bloqué côté UI Admin TMS
```

```gherkin
# Source : §06/M10 EC9
# Couche : db
# Priorité : P2-important
Scénario : diminution_capacite_max_sous_stock_alerte
  Étant donné quantite_pleine = 25 et capacite_max = 30
  Quand Admin TMS diminue capacite_max à 20
  Alors le trigger émet m10_capacite_max_diminuee_satur (warning) destinataires ['admin_tms','ops_savr']
  Et la jauge passe immédiatement en "Dépassement"
```

```gherkin
# Source : §06/M10 EC14 redéfini + §05 R5.5 (arbitrage F4 2026-06-07)
# Couche : db
# Priorité : P1-critique
Scénario : clamping_vides_zero_alerte_incoherence
  Étant donné un stock biodéchet × bac 240L avec quantite_vide_disponible = 2
  Quand une clôture tournée W1 propage 5 bacs pleins de ce couple (décrément théorique vides = -3)
  Alors quantite_vide_disponible = 0 (GREATEST(0, ...) — jamais négatif en base, CHECK ≥ 0 respecté)
  Et quantite_pleine est bien incrémentée de 5
  Et l'alerte m10_stock_incoherence (warning) est émise au moment du clamping, destinataires ['ops_savr']
  Et elle est résolue par un recomptage E7 ultérieur
```

---

## Catégorie 4 — Isolation données (RLS)

```gherkin
# Source : §09 section 13 (tests pgTAP bloquants CI)
# Couche : db
# Priorité : P1-critique
Scénario : chauffeur_aucun_acces_passages_veolia
  Étant donné un chauffeur Strike authentifié
  Quand il tente SELECT puis UPDATE sur passages_veolia
  Alors les deux sont refusés (deny RLS V3 — policies chauffeur supprimées revue sobriété 2026-04-30 A1)
```

```gherkin
# Source : §09 section 13
# Couche : db
# Priorité : P1-critique
Scénario : manager_prestataire_aucun_acces_m10
  Étant donné un manager_prestataire Marathon authentifié
  Quand il tente SELECT sur passages_veolia, stocks_bacs_entrepot et recomptages_stocks_entrepot_log
  Alors les trois sont refusés (deny RLS — données internes Savr)
```

```gherkin
# Source : §09 policies stocks_bacs_staff_only / passages_veolia_staff_full
# Couche : db
# Priorité : P1-critique
Scénario : ops_savr_acces_complet_m10
  Étant donné une Ops Savr authentifiée
  Quand elle fait SELECT/INSERT/UPDATE sur passages_veolia et SELECT/UPDATE sur stocks_bacs_entrepot
  Alors toutes les opérations passent (policy staff `roles && ARRAY['admin_tms','ops_savr']`)
```

```gherkin
# Source : §09 policies recomptages_log_staff_*
# Couche : db
# Priorité : P1-critique
Scénario : recomptages_log_select_insert_staff_uniquement
  Étant donné une Ops Savr et un admin_tms authentifiés
  Quand ils font SELECT et INSERT sur recomptages_stocks_entrepot_log
  Alors les opérations passent pour les deux rôles
  Et chauffeur / manager_prestataire reçoivent un deny sur SELECT et INSERT
```

```gherkin
# Source : §09 trigger append-only recomptages_stocks_entrepot_log
# Couche : db
# Priorité : P1-critique
Scénario : recomptages_log_append_only_meme_admin
  Étant donné une ligne existante dans recomptages_stocks_entrepot_log
  Quand un admin_tms tente UPDATE puis DELETE sur cette ligne
  Alors le trigger BEFORE UPDATE OR DELETE lève RAISE EXCEPTION 'recomptages_stocks_entrepot_log est append-only — UPDATE/DELETE interdit'
```

```gherkin
# Source : §06/M10 E1 + E8 (sécurité écrans)
# Couche : ui
# Priorité : P2-important
Scénario : ecrans_exutoires_403_roles_non_staff
  Étant donné un manager_prestataire connecté
  Quand il accède à /exutoires en URL directe
  Alors il reçoit un 403
  Et la section tuiles "Exutoires" E8 n'est pas rendue sur son interface
```

---

## Catégorie 5 — Idempotence et états

```gherkin
# Source : §06/M10 W1 (idempotence stock_entrepot_update_at)
# Couche : db
# Priorité : P1-critique
Scénario : double_cloture_tournee_pas_de_double_increment
  Étant donné une tournée déjà propagée (stock_entrepot_update_at NOT NULL) et quantite_pleine = 8
  Quand la tournée repasse par le statut 'terminee' (réouverture W10 M04 puis re-clôture)
  Alors la fonction W1 retourne immédiatement (IF stock_entrepot_update_at IS NOT NULL THEN RETURN)
  Et quantite_pleine reste 8 (aucun double incrément)
```

```gherkin
# Source : §06/M10 W1 (filtre ZD)
# Couche : db
# Priorité : P1-critique
Scénario : tournee_ag_pure_aucune_mutation_stock
  Étant donné une tournée AG sans aucune pesée des 5 flux ZD
  Quand elle passe à 'terminee'
  Alors aucune ligne stocks_bacs_entrepot n'est modifiée (no-op silencieux)
  Et stock_entrepot_update_at est renseigné quand même (propagation marquée faite)
```

```gherkin
# Source : §06/M10 W1 fallback + §05 R5.5
# Couche : db
# Priorité : P2-important
Scénario : tournee_zd_sans_pesees_aucun_mouvement
  Étant donné une tournée ZD clôturée sans aucune pesée brute (chauffeur clôture sans collecter)
  Quand elle passe à 'terminee'
  Alors aucun mouvement stock (la collecte n'a pas effectivement collecté)
```

```gherkin
# Source : §05 R5.4 v3 (trigger WHEN planifie → realise)
# Couche : db
# Priorité : P1-critique
Scénario : re_update_realise_pas_de_double_reset
  Étant donné un passage déjà 'realise' (stock déjà reset, vides = 18)
  Quand un UPDATE modifie le commentaire du passage (statut realise → realise inchangé)
  Alors trg_m10_reset_total_pleins ne se redéclenche pas (WHEN OLD = 'planifie' AND NEW = 'realise')
  Et quantite_vide_disponible reste 18
```

```gherkin
# Source : §05 R5.8 v3 / EC6 v3
# Couche : db + api
# Priorité : P1-critique
Scénario : passage_a_posteriori_atomique
  Étant donné Veolia passé hier sans prévenir, stock biodéchet quantite_pleine = 12
  Quand Ops saisit E4 avec date_prevue = hier
  Alors la fonction tms.m10_creer_passage_a_posteriori fait en une transaction : INSERT statut 'realise' + statut_realise_at = date_realise_at saisi (F2) + verification_video_at = now() + cree_par_action 'saisie_manuelle' + reset stock (pleins 0, vides += 12)
  Et le trigger trg_m10_reset_total_pleins couvre bien l'INSERT direct (AFTER INSERT OR UPDATE — précision §05 2026-06-07)
  Et un rollback partiel est impossible (passage créé sans reset ou inversement = FAIL)
```

```gherkin
# Source : §06/M10 W10 / D11
# Couche : db
# Priorité : P1-critique
Scénario : annulation_passage_aucun_impact_stock
  Étant donné un passage 'planifie' et quantite_pleine = 15
  Quand Ops annule (motif 'annulation')
  Alors quantite_pleine reste 15 (le passage n'a jamais eu lieu, rien à reverser)
  Et si une alerte m10_bac_satur est ouverte, elle reste ouverte (pas d'auto-résolution)
```

```gherkin
# Source : §05 R5.2 (escalade saturation)
# Couche : db
# Priorité : P2-important
Scénario : annulation_pendant_saturation_escalade_critical
  Étant donné quantite_pleine = 19 > seuil_saturation_pleins = 18 pour le flux du passage
  Quand Ops annule le passage 'planifie' (motif 'report')
  Alors l'alerte m10_passage_reporte est émise en criticité 'critical' (override règle scope alertes_catalogue)
  Et destinataires incluent admin_tms
```

```gherkin
# Source : §06/M10 W5 étape 6
# Couche : db
# Priorité : P2-important
Scénario : recomptage_corrige_saturation_resolution_auto
  Étant donné une alerte m10_bac_satur ouverte (jauge 100%) sur verre × 240L
  Quand un recomptage E7 ramène quantite_pleine sous le seuil et sous 85% (motif renseigné)
  Alors l'alerte m10_bac_satur est auto-résolue
```

```gherkin
# Source : §05 R5.1 (auto-résolution)
# Couche : db
# Priorité : P2-important
Scénario : alerte_passage_non_confirme_resolue_par_statut
  Étant donné une alerte m10_passage_non_confirme ouverte sur un passage 'planifie' en retard
  Quand le passage passe à 'realise' (ou 'annule')
  Alors l'alerte est auto-résolue
  Et le cron horaire suivant ne ré-émet rien pour ce passage (debounce M11 + statut non planifie)
```

---

## Catégorie 6 — Scénarios cross-app (Plateforme ↔ TMS)

**VIDE — justifié.** M10 est 100% interne TMS V1 : aucun endpoint E1-E6 consommé, aucun webhook S1-S11 émis, aucune vue cross-schema exposée à la Plateforme (§13 Liens CDC Plateforme : "Aucun lien direct V1" ; remontée coûts exutoires = candidat V2). Le seul couplage entrant est le trigger DB W1 sur `tms.tournees` (module M04, même schéma), couvert en catégories 1 et 5. Pas d'Idempotency-Key, HMAC ni X-API-Version applicables.

---

## Catégorie 7 — Scénarios de migration

```gherkin
# Source : §06/M10 §1 plan consolidation + §13 D4 (A5=c)
# Couche : db
# Priorité : P2-important
Scénario : seed_stocks_initiaux_acteur_migration
  Étant donné l'environnement dev avec dataset seed_demo simulant la bascule MTS-1
  Quand les stocks initiaux estimés sont insérés par couple (flux, type_contenant) via M13 E2
  Alors chaque ligne stocks_bacs_entrepot porte un audit_log acteur_type = 'migration'
  Et les contraintes CHECK (>= 0) et l'index UNIQUE (type_contenant_id, flux) passent sur tout le seed
```

```gherkin
# Source : §06/M10 §1 (fenêtre J0 → J+30)
# Couche : db
# Priorité : P2-important
Scénario : alertes_fenetre_migration_contexte_migration_test
  Étant donné la fenêtre J0 → J+30 post-bascule active
  Quand une alerte m10_bac_satur est émise sur des stocks estimés faux
  Alors l'alerte porte contexte = 'migration_test' (cf. §04 addendum §13)
  Et elle est exclue des KPI alertes standards M11
```

```gherkin
# Source : §06/M10 §1 + R_§13.8 (cron m13_cleanup_legacy)
# Couche : db
# Priorité : P2-important
Scénario : cleanup_j30_resout_critical_migration_test_garde_warnings
  Étant donné 2 alertes M10 contexte 'migration_test' ouvertes : 1 critical + 1 warning
  Quand le cron m13_cleanup_legacy s'exécute à J+30
  Alors la critical est auto-résolue
  Et la warning reste ouverte (à traiter normalement par Ops)
  Et relancer le cron une 2e fois ne modifie rien (idempotence)
```

---

## Specs floues — TRANCHÉES par Val 2026-06-07, PROPAGÉES (M10 + §05 + §04 + M11)

### F1 — Passage avec `date_prevue` = aujourd'hui **[était BLOQUANT — TRANCHÉ]**
- Contradiction E4 (`<` aujourd'hui → a posteriori, champ contraint `≥ aujourd'hui`) vs R5.8 v3/EC6 v3 (`≤`).
- **Décision Val** : "le passage peut avoir eu lieu la veille quand Ops déclare — ne pas imposer de contraintes". → E4 accepte **toute date** (contrainte `≥ aujourd'hui` supprimée). `date_prevue < now()::date` strictement → a posteriori ; `= aujourd'hui` → `planifie` normal. R5.8/EC6 corrigés en `<`. Le passage de la veille est aussi couvert via E5 grâce à F2 (`date_realise_at` saisi rétroactif).
- Propagé : M10 E4 (champ + validation) + §05 R5.8 v3 + M10 EC6 v3. Scénario `passage_date_prevue_aujourdhui_planifie_normal` ajouté.

### F2 — `statut_realise_at` = valeur saisie **[TRANCHÉ]**
- **Décision Val** : ok reco. `statut_realise_at` = `date_realise_at` saisi (peut dater de la veille) ; `verification_video_at` = now() = horodatage de déclaration.
- Propagé : M10 E5 + W3 + §05 R5.8 v3 (fonction a posteriori) + §04 description colonne. Scénario `declaration_passage_de_la_veille_date_saisie_conservee` ajouté.

### F3 — `annule` terminal enforcé en DB **[TRANCHÉ]**
- **Décision Val** : ok reco. Trigger `trg_m10_anti_deconfirmation` étendu : `OLD.statut IN ('realise','annule') AND NEW.statut <> OLD.statut` → RAISE EXCEPTION.
- Propagé : §05 R5.7 v3 + M10 §6/§8. Scénario `reactivation_annule_vers_planifie_exception` ajouté.

### F4 — EC14 redéfini = alerte au clamping **[TRANCHÉ]**
- **Décision Val** : ok reco. `m10_stock_incoherence` émise dans W1 quand le décrément aurait rendu `quantite_vide_disponible` négatif (clamp GREATEST(0)) — la valeur ne devient jamais négative en base.
- Propagé : §05 R5.5 + M10 W1/EC14/§9 catalogue + §04 + M11 catalogue. Scénario `clamping_vides_zero_alerte_incoherence` ajouté.

### Précision technique dérivée (non-arbitrage)
`trg_m10_reset_total_pleins` doit être `AFTER INSERT OR UPDATE` (l'INSERT direct `realise` a posteriori R5.8 v3 ne déclencherait pas un AFTER UPDATE seul). Propagé §05 R5.4 v3 + R5.8 v3 + §04.

---

## Scénarios hors scope (V1.1 / V2)

- Coûts exutoires Veolia (D6 — `cout_ht` non créé V1)
- API / notifications automatiques Veolia (pas de doc V1)
- BSD Trackdéchets (M16 V2) — champs `bsd_numero`/`bsd_url` testés uniquement comme colonnes optionnelles
- Rôle `agent_entrepot` délégué (Q4 — V1.5)
- Motifs normalisés recomptage en select (Q5 — V1.5, textarea libre V1)
- Multi-entrepôts (Q7 — V3)
- Import CSV planning Veolia (D4 — bascule V1.5 si > 5 passages/sem)

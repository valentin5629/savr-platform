# Scénarios de test — M02 Dispatch Ops Savr

**Source CDC** : §06/M02 + §05 R1.1, R1.2, R1.3, R1.4, R2.7, R2.7bis, R6.1 + §09 RLS `collectes_tms` + §08 E1/E3/S1/S2
**Généré le** : 2026-06-05
**Statut** : À implémenter par Claude Code

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests du module M02.
> Pour chaque scénario :
> - Couche `db` → écrire un test pgTAP dans `supabase/tests/`
> - Couche `api` → écrire un test Vitest dans `packages/tms/tests/api/`
> - Couche `ui` → écrire un test Playwright dans `packages/tms/tests/e2e/`
> Les tests P1-critique sont bloquants CI. Les tests P2 et P3 sont non-bloquants V1.
> Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.
>
> **Conventions de données** : prestataires réels — Strike (ZD), Marathon (AG volume/nuit), A Toutes! (AG vélo, intégration Everest, pas de portail M03). Traiteurs : Kaspia, Kardamome. Statuts dispatch TMS (6 valeurs) : `a_attribuer`, `attribuee_en_attente_acceptation`, `acceptee`, `en_attente_execution`, `rejetee_par_prestataire`, `annulee_par_traiteur`. `rejetee_par_tms` est Plateforme-only (après S11), pas un statut dispatch TMS.

---

## Résumé de couverture

| Catégorie | Nb scénarios | Couverture estimée |
|-----------|-------------|-------------------|
| 1. Happy path | 6 | W1 self-service, W2 province, W3 refus, W4 annulation, W5 override, W6 alerte |
| 2. Cas limites | 7 | R1.4 seuils 3h/48h, R2.7 seuil 3h, heure_collecte 2h/4h, compat véhicule↔lieu, multi-véhicules |
| 3. Cas d'erreur | 7 | prestataire inactif, aucun prestataire, override post-démarrage, plaque invalide, doublon chauffeur, Everest down, doublon province SIRET |
| 4. Isolation RLS | 6 | ops_savr/admin_tms full, manager_prestataire deny, chauffeur scope, cross-org, fonction création province |
| 5. Idempotence/états | 7 | transitions R6.1, no-double-attribution, dérivation multi-tournées, snapshot sync, dedup event_id |
| 6. Cross-app + fallback | 9 | E1 réception, E3 DELETE, S1/S2 émission, HMAC, X-API-Version, collecte manuelle, réconciliation M13, unicité partielle |
| 7. Migration | 0 | Hors scope M02 (cf. cdc-migration-data / §13 MTS-1) |
| **TOTAL** | **42** | |

---

## Scénarios

### Catégorie 1 — Happy path

```gherkin
# Source : §06/M02 W1 + §05 R1.1
# Couche : api
# Priorité : P1-critique

Scénario : attribution_standard_zd_strike
  Étant donné une collecte ZD Kaspia reçue via E1 en statut_dispatch 'a_attribuer'
  Et la suggestion M12 calculée = Strike (branche R1 'zd_idf_strike')
  Et un Ops Savr connecté
  Quand l'Ops attribue la collecte à Strike via la modal E4 (confirmation suggestion)
  Alors collectes_tms.statut_dispatch passe à 'attribuee_en_attente_acceptation'
  Et collectes_tms.prestataire_id = Strike, attribuee_par_user_id et attribuee_at sont renseignés
  Et un INSERT audit_logs (action='ATTRIBUTION', diff before/after) est créé
  Et un INSERT suggestions_attribution_log est créé
  Et une notification email est envoyée au manager Strike (M03)
```

```gherkin
# Source : §06/M02 W2 + §05 R1.2 (branche province) + D6
# Couche : api
# Priorité : P1-critique

Scénario : attribution_province_confirmation_manuelle
  Étant donné une collecte AG reçue en 'a_attribuer' avec prestataire suggéré type='province'
  Et un Ops Savr connecté ayant contacté le prestataire hors TMS
  Quand l'Ops complète le tunnel E5 (prestataire province actif + chauffeur actif + véhicule compatible) et clique "Confirmer l'attribution province"
  Alors collectes_tms.statut_dispatch passe directement à 'en_attente_execution' (skip attribuee_en_attente_acceptation et acceptee)
  Et une ligne tournees est créée avec statut='acceptee', prestataire_id, chauffeur_id, vehicule_id
  Et un webhook S1 'tms/collecte-acceptee' est poussé vers la Plateforme
  Et un INSERT audit_logs complet est créé
```

```gherkin
# Source : §06/M02 W3 + §05 R6.1
# Couche : api
# Priorité : P1-critique

Scénario : refus_prestataire_retour_a_attribuer
  Étant donné une collecte en 'attribuee_en_attente_acceptation' chez Marathon
  Quand le webhook S2 'tms/collecte-refusee' est reçu avec motif_refus (text)
  Alors collectes_tms.statut_dispatch passe à 'rejetee_par_prestataire' avec motif_refus et date_refus renseignés (QO#8 : colonne simple, PAS de table collecte_refus_historique en V1)
  Et le prestataire_id reste Marathon (badge "Refusée par Marathon" en E1 Zone 2)
  Et la trace du refus (acteur/prestataire/timestamp) est disponible dans audit_logs (source du KPI taux de refus)
  Et après clic Ops "Réattribuer" dans E3 le statut retombe à 'a_attribuer'
```

```gherkin
# Source : §06/M02 W4 + §05 R2.7 + §08 E3
# Couche : api
# Priorité : P1-critique

Scénario : annulation_collecte_avant_demarrage_no_bill
  Étant donné une collecte en 'acceptee' rattachée à une tournée 'acceptee', annulée 4h avant heure_planifiee_debut
  Quand le webhook E3 'DELETE /collectes/:id' est reçu
  Alors collectes_tms.statut_dispatch passe à 'annulee_par_traiteur' avec annulee_at renseigné
  Et la collecte est détachée de la tournée ; la tournée devenue vide passe à statut='annulee' avec cout_calcule_ht=0
  Et aucun webhook sortant n'est émis (l'annulation est l'ack du DELETE Plateforme)
  Et un email est envoyé au manager prestataire
```

```gherkin
# Source : §06/M02 W5 + §05 R6.1
# Couche : api
# Priorité : P1-critique

Scénario : override_ops_reattribution_avant_demarrage
  Étant donné une collecte en 'attribuee_en_attente_acceptation' chez Strike, statut_operationnel='planifiee'
  Quand l'Ops clique "Réattribuer" dans E3 et confirme la modale simple (sans motif)
  Alors collectes_tms.statut_dispatch repasse à 'a_attribuer'
  Et l'ancien prestataire Strike reçoit un email de réattribution
  Et M12 recalcule la suggestion et l'Ops est ramené en E4 standard
```

```gherkin
# Source : §06/M02 W6 + §05 R1.4 (révise D4)
# Couche : db
# Priorité : P2-important

Scénario : alerte_ops_acceptation_sans_reponse_collecte_proche
  Étant donné une collecte en 'attribuee_en_attente_acceptation' avec proximite (heure_collecte − now) = 30h (≤ 48h) et attribuee_at il y a 3h05
  Et aucune alerte 'm02_acceptation_sans_reponse' active sur cette collecte
  Quand le cron cron_m02_alerte_acceptation s'exécute (fréquence 15 min)
  Alors tms.alerte_emit('m02_acceptation_sans_reponse', warning, collecte_id) est appelé une seule fois
  Et l'alerte s'auto-résout dès que la collecte quitte 'attribuee_en_attente_acceptation'
```

---

### Catégorie 2 — Cas limites métier

```gherkin
# Source : §05 R1.4 (seuil proche 3h, proximité 48h)
# Couche : db
# Priorité : P2-important

Scénario : alerte_acceptation_borne_proximite_48h_exact
  Étant donné une collecte en 'attribuee_en_attente_acceptation' avec proximite = exactement 48h (= m02_alerte_acceptation_seuil_proximite_heures)
  Et attribuee_at il y a exactement 3h (= m02_alerte_acceptation_delai_proche_heures)
  Quand le cron cron_m02_alerte_acceptation s'exécute
  Alors le seuil "proche" (3h) s'applique (proximite ≤ 48h) et l'alerte est émise (delai_ecoule ≥ seuil)
```

```gherkin
# Source : §05 R1.4 (seuil lointain 48h)
# Couche : db
# Priorité : P3-nominal

Scénario : alerte_acceptation_collecte_lointaine_pas_avant_48h
  Étant donné une collecte en 'attribuee_en_attente_acceptation' avec proximite = 100h (> 48h) et attribuee_at il y a 47h
  Quand le cron cron_m02_alerte_acceptation s'exécute
  Alors aucune alerte n'est émise (delai_ecoule 47h < seuil lointain 48h)
  Et à attribuee_at + 48h l'alerte 'm02_acceptation_sans_reponse' est émise
```

```gherkin
# Source : §05 R2.7 (seuil 3h annulation)
# Couche : db
# Priorité : P1-critique

Scénario : annulation_sous_seuil_3h_vacation_facturee
  Étant donné une collecte 'acceptee' rattachée à une tournée, annulée 2h59 avant heure_planifiee_debut
  Quand le webhook E3 'DELETE /collectes/:id' est reçu
  Alors la tournée n'est pas mise à 0€ : M07 calcule la vacation (durée minimale palier de la grille applicable)
  Et collectes_tms.statut_dispatch passe à 'annulee_par_traiteur'
```

```gherkin
# Source : §05 R2.7 (borne exacte 3h)
# Couche : db
# Priorité : P2-important

Scénario : annulation_borne_exacte_3h_no_bill
  Étant donné une collecte 'acceptee', annulée exactement 180 min avant heure_planifiee_debut (= delai_annulation_sans_facturation_minutes)
  Quand le DELETE E3 est reçu
  Alors cout_calcule_ht=0 et cout_detail={"raison":"annulation_hors_delai_facturation"} (≥ 3h = pas de facturation)
```

```gherkin
# Source : §05 R2.7bis
# Couche : db
# Priorité : P1-critique

Scénario : annulation_pendant_tournee_en_cours_vacation_facturee
  Étant donné une collecte dont la tournée est déjà 'en_cours' (chauffeur a démarré)
  Quand le webhook E3 'DELETE /collectes/:id' est reçu
  Alors collectes_tms.statut_dispatch = 'annulee_par_traiteur' et annulee_pendant_en_cours = true
  Et collectes_tms.statut_operationnel reste 'en_cours' jusqu'à clôture chauffeur puis passe à 'realisee'
  Et une alerte M11 'm02_annulation_en_cours_tournee' (warning) est émise
  Et la vacation prestataire est facturée intégralement
```

```gherkin
# Source : §06/M02 E5 (ajout 2026-05-08, R_M04.COMPATIBILITE_VEHICULE_LIEU)
# Couche : ui
# Priorité : P1-critique

Scénario : province_vehicule_incompatible_lieu_bloque
  Étant donné une collecte dont le lieu a type_vehicule_max='camionnette' (rang 2)
  Et l'Ops sélectionne en E5 étape 3 un véhicule categorie_plateforme='poids_lourd' (rang 5 > 2)
  Quand l'écran affiche la sélection
  Alors un bandeau warning rouge "Véhicule incompatible" s'affiche
  Et le bouton "Confirmer l'attribution province" est désactivé tant qu'un véhicule compatible n'est pas choisi
  Et si forcé côté DB, le trigger trg_validate_tournee_compat_vehicule_lieu lève une exception
```

```gherkin
# Source : §06/M02 E3 section 5 (multi-camions 2026-05-25)
# Couche : api
# Priorité : P2-important

Scénario : ajout_vehicule_cree_tournee_soeur
  Étant donné une grosse collecte ZD 3000 pax déjà attribuée à Strike avec une tournée
  Quand l'Ops clique "+ Ajouter un véhicule" dans E3 section Tournées
  Alors une tournée sœur (même prestataire Strike) est créée, pré-remplie avec cette collecte, liée via collecte_tournees
  Et M04 E1 s'ouvre sur la nouvelle tournée
  Et l'action est réutilisable N fois
```

---

### Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : §05 R1.3 (prestataire inactif non attribuable)
# Couche : api
# Priorité : P1-critique

Scénario : attribution_prestataire_inactif_refusee
  Étant donné un prestataire Marathon avec statut='inactif' (ou deleted_at IS NOT NULL)
  Quand l'Ops tente de l'attribuer en E4
  Alors le prestataire n'apparaît pas dans le select E4 ni dans les suggestions M12
  Et toute tentative d'attribution forcée côté API est rejetée
```

```gherkin
# Source : §05 R1.3 (aucun prestataire dispo)
# Couche : db
# Priorité : P1-critique

Scénario : aucun_prestataire_disponible_alerte_critical
  Étant donné une collecte AG nuit dont la branche M12 résout 'aucun_prestataire'
  Quand M12 calcule la suggestion
  Alors collectes_tms.statut_dispatch reste 'a_attribuer'
  Et une alerte M11 gravite='critical' (dispatch_no_provider / email Ops) est émise
```

```gherkin
# Source : §06/M02 W5 règle override + §05 R6.1
# Couche : api
# Priorité : P1-critique

Scénario : override_bloque_si_statut_operationnel_en_cours
  Étant donné une collecte avec statut_operationnel IN ('en_cours','realisee','realisee_sans_collecte','incident')
  Quand l'Ops tente "Réattribuer" dans E3
  Alors le bouton est grisé avec tooltip "Collecte démarrée, override bloqué"
  Et toute tentative API de repasser statut_dispatch à 'a_attribuer' est rejetée
```

```gherkin
# Source : §06/M02 7.9 + E5 étape 3
# Couche : ui
# Priorité : P2-important

Scénario : plaque_invalide_regex_fr
  Étant donné le formulaire E5 création véhicule sans toggle "Plaque étrangère"
  Quand l'Ops saisit une plaque "ABC123" (non conforme à ^[A-Z]{2}-\d{3}-[A-Z]{2}$)
  Alors la validation échoue et le formulaire refuse la soumission
  Et avec le toggle "Plaque étrangère" activé, la même valeur est acceptée (libre, max 15 car, uppercased)
```

```gherkin
# Source : §06/M02 E5 étape 2 (validation doublon chauffeur)
# Couche : ui
# Priorité : P2-important

Scénario : doublon_chauffeur_choix_explicite
  Étant donné un chauffeur avec nom normalisé + téléphone E.164 existant chez un autre prestataire
  Quand l'Ops crée un nouveau chauffeur identique en E5 étape 2
  Alors une alerte modale "Ce chauffeur existe chez {prestataire_x}. Réutiliser ou créer un doublon ?" s'affiche
  Et l'Ops doit faire un choix explicite (réutiliser / créer doublon)
```

```gherkin
# Source : §06/M02 7.7 (Everest down)
# Couche : api
# Priorité : P2-important

Scénario : everest_down_skip_a_toutes_bascule_marathon
  Étant donné parametres_tms.toutes_disponibilite_statut = 'indisponible'
  Quand M12 calcule la suggestion pour une collecte AG vélo jour
  Alors A Toutes! (branches 1/2/backup) est skippé et la bascule Marathon est proposée (ag_velo_fallback_marathon)
  Et un bandeau E1 warning "A Toutes! indisponible — report Marathon auto" s'affiche
```

```gherkin
# Source : §06/M02 E5/7.6 + QO#5 (tranché 2026-06-05) + §09 fn_create_prestataire_province
# Couche : db
# Priorité : P2-important

Scénario : creation_province_doublon_siret_rejetee
  Étant donné un prestataire province existant (non supprimé) avec SIRET '12345678900011'
  Quand l'Ops appelle tms.fn_create_prestataire_province avec le même SIRET
  Alors la fonction lève l'exception 'duplicate_prestataire' (garde-fou SIRET)
  Et aucune ligne shared.prestataires n'est créée
  Et avec un SIRET neuf mais (nom normalisé, ville) déjà présents → même rejet 'duplicate_prestataire'
```

---

### Catégorie 4 — Isolation données (RLS)

```gherkin
# Source : §09 RLS + §06/M02 §6 (USING true ops/admin)
# Couche : db
# Priorité : P1-critique

Scénario : rls_ops_savr_voit_toutes_collectes_tms
  Étant donné un user rôle 'ops_savr' (app_domain='tms')
  Quand il lit collectes_tms
  Alors il voit toutes les collectes (USING true) — Kaspia ET Kardamome
  Et il peut attribuer/réattribuer (transitions M02 autorisées)
```

```gherkin
# Source : §09 (manager prestataire hors M02)
# Couche : db
# Priorité : P1-critique

Scénario : rls_manager_prestataire_deny_collectes_tms
  Étant donné un user rôle 'manager_prestataire' Strike
  Quand il tente d'accéder en lecture à collectes_tms (table M02)
  Alors l'accès est refusé par RLS (le manager n'interagit qu'avec M03, pas M02)
```

```gherkin
# Source : §09 RLS chauffeur (via collecte_tournees)
# Couche : db
# Priorité : P1-critique

Scénario : rls_chauffeur_voit_seulement_ses_collectes
  Étant donné un chauffeur (claim tms_chauffeur_id) rattaché à une tournée T1 via collecte_tournees
  Et une autre collecte rattachée à une tournée d'un autre chauffeur
  Quand il lit collectes_tms
  Alors il ne voit que les collectes liées à T1 (prédicat auth.user_chauffeur_id(), pas auth.uid())
  Et il ne voit pas tournees.cout_calcule_ht ni cout_detail (colonnes masquées)
```

```gherkin
# Source : §09 RLS cross-org prestataires
# Couche : db
# Priorité : P1-critique

Scénario : rls_isolation_prestataire_strike_vs_marathon
  Étant donné un manager_prestataire Strike
  Quand il consulte les tournées via M03
  Alors il ne voit jamais les tournées Marathon (isolation cross-organisation prestataire)
```

```gherkin
# Source : §09 RLS admin_tms
# Couche : db
# Priorité : P2-important

Scénario : rls_admin_tms_supervision_full_read
  Étant donné un user rôle 'admin_tms'
  Quand il lit collectes_tms et tournees
  Alors il voit toutes les données (lecture + override), y compris les transitions force (ex : attribuee_en_attente_acceptation → rejetee_par_prestataire force)
```

```gherkin
# Source : §09 fn_create_prestataire_province (SECURITY DEFINER, GRANT EXECUTE ops/admin) — QO#5
# Couche : db
# Priorité : P2-important

Scénario : rls_creation_province_reservee_ops_admin
  Étant donné un user rôle 'manager_prestataire' (app_domain='tms')
  Quand il tente d'exécuter tms.fn_create_prestataire_province
  Alors la fonction lève 'forbidden' (garde interne has_role ops_savr/admin_tms)
  Et un user 'ops_savr' réussit la création d'un prestataire type='province' statut='actif'
  Et l'INSERT direct par ops_savr sur shared.prestataires (hors fonction) reste refusé (deny column-level opérationnel inchangé)
```

---

### Catégorie 5 — Idempotence et états

```gherkin
# Source : §08 dédup integrations_inbox (PK event_id, TTL 7j) — Idempotency-Key header SUPPRIMÉ (Bloc C C4)
# Couche : api
# Priorité : P1-critique

Scénario : dedup_event_id_pas_de_double_effet
  Étant donné un webhook entrant déjà traité avec event_id 'evt-123' (présent dans integrations_inbox)
  Quand le même event_id 'evt-123' est reçu une seconde fois (retry émetteur)
  Alors le serveur répond 200 sans rejouer l'effet métier (dédup sur body.event_id, pas sur un header Idempotency-Key qui n'existe plus)
  Et aucune ligne dupliquée n'est créée
```

```gherkin
# Source : §06/M02 7.1 (idempotency_key client)
# Couche : ui
# Priorité : P2-important

Scénario : attribution_reseau_coupe_retry_pas_de_double_attribution
  Étant donné une attribution Ops en cours avec idempotency_key UUID côté client et réseau coupé
  Quand le client retry automatiquement (2s / 5s / 10s)
  Alors une seule attribution est enregistrée (pas de double effet grâce à l'idempotency_key)
  Et en cas d'échec final un toast "Attribution non enregistrée, réessayer" s'affiche et la collecte reste 'a_attribuer'
```

```gherkin
# Source : §05 R6.1 (transition interdite)
# Couche : db
# Priorité : P1-critique

Scénario : transition_dispatch_illegale_bloquee
  Étant donné une collecte en 'a_attribuer'
  Quand on tente de la passer directement à 'acceptee' (transition non listée R6.1)
  Alors le trigger Postgres anti-escalade lève une exception et la transition est refusée
```

```gherkin
# Source : §05 R6.1 (dérivation multi-tournées realisee)
# Couche : db
# Priorité : P1-critique

Scénario : derivation_collecte_realisee_quand_toutes_tournees_terminee
  Étant donné une collecte ZD servie par 2 tournées sœurs (collecte_tournees), une 'terminee' et une 'en_cours'
  Quand la 2e tournée passe à 'terminee'
  Alors le trigger tms.fn_derive_statut_collecte_multi_tournees fait passer la collecte à 'realisee' (toutes tournées terminee)
  Et le S5 terminal unique est émis avec les pesées des N véhicules sommées par (collecte_tms_id, flux)
  Et tant qu'une seule tournée reste 'en_cours' la collecte ne passe PAS à 'realisee'
```

```gherkin
# Source : §05 R6.1 (garde ZD pesées > 0)
# Couche : db
# Priorité : P2-important

Scénario : realisee_zd_requiert_pesees_positives
  Étant donné une collecte ZD dont toutes les tournées passent 'terminee' mais SUM(pesees.poids_net) = 0
  Quand la dérivation s'exécute
  Alors la collecte ne bascule pas en 'realisee' silencieusement : une alerte Ops est levée (garde ZD SUM > 0)
```

```gherkin
# Source : §06/M02 E3 section 6 + Addendum M01 (snapshot sync)
# Couche : api
# Priorité : P3-nominal

Scénario : snapshot_sync_par_collecte_audit
  Étant donné une collecte avec alerte 'm02_lieu_snapshot_divergent' active (PATCH E5 lieu reçu)
  Quand l'Ops clique "Synchroniser snapshot pour cette collecte" et confirme la modale
  Alors collectes_tms.lieu_snapshot est rafraîchi depuis plateforme.lieux (par collecte uniquement, pas de batch)
  Et un audit_logs action='SNAPSHOT_SYNC' est créé
  Et l'alerte s'auto-dismiss (ou au passage statut_operationnel='en_cours')
```

```gherkin
# Source : §05 R6.1 + W4 (terminal annulee_par_traiteur — pas de webhook)
# Couche : api
# Priorité : P2-important

Scénario : annulation_terminale_pas_de_webhook_sortant
  Étant donné une collecte annulée via E3 (statut_dispatch='annulee_par_traiteur')
  Quand la transition terminale est appliquée
  Alors AUCUN webhook sortant n'est émis (mapping §08 : pas de webhook à annulee_par_traiteur)
  Et seuls S5 (realisee/realisee_sans_collecte) et S9 (incident) sont émis sur les autres transitions terminales
```

---

### Catégorie 6 — Scénarios cross-app (Plateforme ↔ TMS)

```gherkin
# Source : §08 E1 POST /collectes
# Couche : api
# Priorité : P1-critique

Scénario : reception_e1_collecte_apparait_en_a_attribuer
  Étant donné un webhook E1 'POST /collectes' valide (HMAC OK, X-API-Version 2026.04) avec payload conforme au schéma
  Quand le TMS le reçoit
  Alors une collecte est créée en collectes_tms avec statut_dispatch='a_attribuer'
  Et elle apparaît dans E1 Zone 2 "Collectes à attribuer" avec coloration selon heure_collecte
  Et M12 calcule la suggestion (suggestion_prestataire_id + branche R1)
```

```gherkin
# Source : §08 E3 DELETE /collectes/:id
# Couche : api
# Priorité : P1-critique

Scénario : reception_e3_delete_declenche_w4
  Étant donné une collecte existante côté TMS
  Quand le webhook E3 'DELETE /collectes/:id' est reçu (HMAC OK)
  Alors le workflow W4 s'exécute (statut_dispatch='annulee_par_traiteur', traitement tournée selon R2.7)
```

```gherkin
# Source : §08 S1 webhooks/tms/collecte-acceptee
# Couche : api
# Priorité : P1-critique

Scénario : emission_s1_a_acceptation
  Étant donné une collecte 'attribuee_en_attente_acceptation' chez Strike
  Quand le manager Strike accepte dans M03 (statut_dispatch → 'acceptee')
  Alors un webhook S1 'tms/collecte-acceptee' est poussé vers la Plateforme avec enveloppe complète (event_id, occurred_at, source, type='collecte.acceptee')
  Et en cas d'erreur 500 réception le retry suit 3 paliers 5min/1h/24h sans doublon (dédup event_id côté Plateforme)
```

```gherkin
# Source : §08 S2 webhooks/tms/collecte-refusee
# Couche : api
# Priorité : P1-critique

Scénario : emission_s2_a_refus
  Étant donné une collecte 'attribuee_en_attente_acceptation'
  Quand le manager refuse dans M03
  Alors un webhook S2 'tms/collecte-refusee' est poussé avec motif (enveloppe complète, type='collecte.refusee' sans préfixe tms.)
```

```gherkin
# Source : §08 Auth HMAC-SHA256
# Couche : api
# Priorité : P1-critique

Scénario : webhook_hmac_invalide_rejet_401
  Étant donné un webhook entrant dont le body a été modifié après signature (HMAC ne correspond plus au body brut UTF-8)
  Quand le TMS le reçoit
  Alors il répond 401 unauthorized (non retryable) et aucun effet métier n'est appliqué
```

```gherkin
# Source : §08 Versioning X-API-Version (B3 — header autoritatif unique)
# Couche : api
# Priorité : P2-important

Scénario : webhook_x_api_version_absente_ou_obsolete_rejet_400
  Étant donné un webhook entrant sans header X-API-Version (ou avec une version obsolète ≠ 2026.04)
  Quand le TMS le reçoit
  Alors il répond 400 invalid_payload (header autoritatif, le champ version dans le body est ignoré car retiré du schéma)
```

```gherkin
# Source : §06/M02 7.3 (formulaire manuel V1, tranché 2026-06-05) + §04 origine/plateforme_collecte_id nullable
# Couche : api
# Priorité : P2-important

Scénario : collecte_manuelle_creee_par_admin_pendant_panne
  Étant donné une panne du front/webhook Plateforme et un Admin TMS connecté
  Quand il crée une collecte via "Nouvelle collecte manuelle" (lieu + traiteur depuis plateforme.* local, heure_collecte future, parcours, nb_pax, contact principal)
  Alors une ligne collectes_tms est créée avec statut_dispatch='a_attribuer', origine='manuelle_tms', plateforme_collecte_id=NULL et plateforme_evenement_id=NULL
  Et M12 calcule la suggestion et le dispatch suit le flux normal
  Et un user 'ops_savr' n'a PAS accès au bouton (réservé Admin TMS, QO#6)
```

```gherkin
# Source : §06/M02 7.3 + QO#10 + M13 E6.c réconciliation orphelines
# Couche : api
# Priorité : P2-important

Scénario : reconciliation_collecte_manuelle_avec_webhook_e1
  Étant donné une collecte manuelle (origine='manuelle_tms', plateforme_collecte_id=NULL)
  Et le webhook E1 de la vraie collecte Plateforme arrive ensuite (même lieu, heure_collecte ±30 min, même traiteur, nb_pax ±10%)
  Quand l'Admin TMS ouvre M13 E6.c et clique "Fusionner" sur la suggestion de match
  Alors la collecte manuelle adopte plateforme_collecte_id / plateforme_evenement_id / plateforme_programmateur_id de la collecte webhook
  Et la ligne webhook en doublon est marquée résolue (DLQ succes_manuel), pas de seconde collecte active
  Et le dispatch déjà réalisé sur la collecte manuelle est préservé
  Et un audit_logs est créé
```

```gherkin
# Source : §04 plateforme_collecte_id UNIQUE partiel WHERE NOT NULL
# Couche : db
# Priorité : P3-nominal

Scénario : unicite_partielle_plateforme_collecte_id
  Étant donné deux collectes manuelles avec plateforme_collecte_id=NULL
  Quand elles coexistent en base
  Alors l'index unique partiel (WHERE plateforme_collecte_id IS NOT NULL) n'est PAS violé par les NULL multiples
  Et toute tentative d'insérer deux collectes avec le même plateforme_collecte_id non-NULL est rejetée
```

---

## Scénarios hors scope (à générer en V1.1 ou autre module)

- **Catégorie 7 — Migration (Bubble + MTS-1 → Supabase)** : non couverte par M02. Le module porte le dispatch runtime, pas la migration. À générer via `cdc-migration-data` + scénarios sur `04 - Migration/05 - Checks reconciliation.md` (côté TMS : §13 Migration MTS-1).
- **Réception E1 — validation payload incomplet / DLQ / Idempotency / heure_collecte rétrograde** : couverts en profondeur par les scénarios **M01** (réception ordres). M02 ne teste ici que la conséquence (apparition en `a_attribuer`).
- **Acceptation A Toutes! dérivée du webhook Everest `mission_dispatched`** : logique portée par **M14** (intégration Everest) + M12. M02 ne teste que l'effet aval (passage `acceptee` + S1, alerte W6 si pas de `mission_dispatched`).
- **Permis de conduire upload obligatoire en E5** : tranché V1.1 (warning visuel non bloquant en V1).
- **Raccourcis clavier, bulk actions, digest notifications** : reportés V1.1.

---

## Specs floues — TOUTES TRANCHÉES le 2026-06-05 (arbitrages Val)

1. **QO#5 — Création prestataire province à la volée** → **Ops Savr crée directement** via fonction `SECURITY DEFINER` `tms.fn_create_prestataire_province` (pas de validation Admin amont, garde-fou doublon SIRET puis `(nom, ville)`). Propagé : M02 §12/E5/7.6, §09 (définition fonction + GRANT), M06 (E3 accès + navigation). Scénarios ajoutés : `creation_province_doublon_siret_rejetee`, `rls_creation_province_reservee_ops_admin`.
2. **QO#8 — Historique des refus** → **colonne simple V1** : `collectes_tms.motif_refus` (text) + `date_refus`, KPI taux de refus dérivé de `audit_logs`. Pas de table `collecte_refus_historique` ni jsonb V1 (table reportée V1.1). Propagé : M02 W3 + §12. Scénario `refus_prestataire_retour_a_attribuer` mis à jour.
3. **7.3 — Formulaire collecte manuelle (fallback Plateforme down)** → **figé V1 minimal** (Admin TMS) : lieu/traiteur depuis `plateforme.*` local, `heure_collecte`/parcours/nb_pax/contacts, INSERT avec `origine='manuelle_tms'` + `plateforme_collecte_id=NULL`, réconciliation M13 E6.c. Propagé : M02 7.3 (+ retrait réf polling E6/S10 supprimé §08 A4), §04 (`plateforme_collecte_id`/`plateforme_evenement_id` nullable + colonne `origine`), M13 E6.c (écran réconciliation créé). Scénarios ajoutés : `collecte_manuelle_creee_par_admin_pendant_panne`, `reconciliation_collecte_manuelle_avec_webhook_e1`, `unicite_partielle_plateforme_collecte_id`.
4. **R1.4 — seeds seuils** → **vérifié OK** : les 3 clés (`m02_alerte_acceptation_seuil_proximite_heures`=48, `_delai_proche_heures`=3, `_delai_lointaine_heures`=48) sont bien déclarées en §04 section 7. Aucune correction. Effet de bord proche/lointain border-testé par `alerte_acceptation_collecte_lointaine_pas_avant_48h`.

Aucune spec floue résiduelle sur M02.

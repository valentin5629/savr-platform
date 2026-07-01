# Scénarios de test — §08 APIs et intégrations (lot ⑩)

**Source CDC** : §08 APIs et intégrations + §05 Règles métier (retry, idempotence) + §09 RLS (integrations_logs, emails_envoyes, parametres_*)
**Généré le** : 2026-06-07
**Statut** : À implémenter par Claude Code

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests du module §08.
> Pour chaque scénario :
> - Couche `db` → écrire un test pgTAP dans `supabase/tests/`
> - Couche `api` → écrire un test Vitest dans `packages/app/tests/api/`
> - Couche `ui` → écrire un test Playwright dans `packages/app/tests/e2e/`
> Les tests P1-critique sont bloquants CI. Les tests P2 et P3 sont non-bloquants V1.
> Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.

---

## Résumé de couverture

| Catégorie | Nb scénarios | Couverture estimée |
|-----------|-------------|-------------------|
| 1 — Happy path | 14 | E1/E2/S1/S5/S7/S11, MTS-1 flux nominal, Pennylane nominal, Resend nominal, Puppeteer |
| 2 — Cas limites métier | 12 | realisee_sans_collecte (dont Everest course vide V1, M2.5 R10a), multi-camions, out-of-order, 256KB, PATCH champs interdits, Pennylane 4xx, retry épuisé |
| 3 — Cas d'erreur | 11 | HMAC invalide, X-API-Version absent, collecte inconnue, validation 422/409, svix invalide, Everest mission_failed avant acceptation |
| 4 — Isolation RLS | 8 | ops_savr lecture/écriture, manager_traiteur, SERVICE_ROLE, admin_savr |
| 5 — Idempotence/états | 9 | dédup event_id, Idempotency-Key, orderNumber MTS-1, svix-id Resend, snapshot CO₂ figé |
| 6 — Cross-app | 4 | chaîne E1→S1→S5 complète, chaîne Pennylane create→finalize→send_email→poll |
| 7 — Migration | 4 | réconciliation customerOrderId, idempotence script MTS-1, rollback |
| 8 — Onboarding SIRET (§15 §2.6, ajout 2026-07-01) | 7 | revalidation INSEE (enqueue, 3 paliers, verifie/echec/epuise), anti-doublon, siret vide non bloquant |
| **TOTAL** | **69** | |

---

## Floues identifiées — à trancher avant de coder

**F1 — ✅ TRANCHÉE 2026-06-07 : Dédup integrations_inbox MTS-1 au polling**
`occurred_at` retiré de la clé de dédup MTS-1 (c'est `NOW()` au polling, pas un timestamp MTS-1 natif).
Clé retenue : `(source='mts1', customerOrderId, customerOrderStatus)`. `event_id` synthétique = `md5(source || customerOrderId || customerOrderStatus)` casté en UUID. Propagé §08 §3bis.7 + §04 `integrations_inbox`.

**F2 — ✅ TRANCHÉE 2026-06-07 : Scope du polling Pennylane J+1 — Option B**
Toutes les factures `emise` sans borne temporelle. Index partiel `WHERE statut='emise'` pour éviter le full-scan. Volume V1 < 500 lignes, coût négligeable. Revisit V1.1 si besoin. Propagé §08 §2.

**F3 — ✅ TRANCHÉE 2026-06-07 : Dispatch bouton 3 branches selon statut_tms**
- `non_envoye` → émet E1 (création) + `statut_tms = a_attribuer`.
- `{a_attribuer, attribuee_en_attente_acceptation}` + `dirty_tms=true` → émet E2 (patch).
- `rejetee_par_tms` → émet E1 (recréation).
Override AG (`prestataire_id` fourni) applique la même logique de branche + validations admin. Propagé §08 §10.1.

**F4 — Resend webhook `resend_id` inconnu : quelle table reçoit l'anomalie ?**
§08 §4 : « `resend_id` inconnu → 200 + anomalie tracée `integrations_logs` ». OK.
→ Pas de floue, mais à documenter explicitement dans le test (couche `api`, anomalie = INSERT integrations_logs, pas d'INSERT emails_envoyes).

**F5 — Trigger fn_sync_statut_collecte_from_tms : dérivation depuis quel(s) statut(s) ?**
§08 §1 : « trigger `fn_sync_statut_collecte_from_tms` dérive `programmee→validee` ».
→ **Question** : si la collecte est déjà à `validee` au moment de la réception de S1 (cas edge : double S1), le trigger est-il idempotent (no-op) ou génère-t-il une erreur ? Préciser dans §05/§08 pour éviter une exception silencieuse.

---

## Scénarios

---

### Catégorie 1 — Happy path

---

```gherkin
# Source : §08 §1 — E1 POST /collectes, §06/01 programmation collecte
# Couche : api
# Priorité : P1-critique

Scénario : e1_collecte_creee_envoyee_tms_nominal
  Étant donné une collecte ZD Kaspia Paris (traiteur = Kaspia, lieu = Salle Pleyel)
    Et la collecte vient d'être soumise (statut = programmee, statut_tms = non_envoye)
    Et le TMS retourne 201 avec event_id valide
  Quand l'Edge Function d'envoi E1 est déclenchée
  Alors une requête POST est envoyée à `{tms_base}/collectes`
    Et le payload contient traiteur_operationnel.organisation_id = Kaspia.id, type_collecte = zd, nb_pax, heure_collecte.{date,heure,fuseau}, contacts.principal obligatoire
    Et le payload ne contient PAS prestataire_id_pre_affecte
    Et les headers contiennent Authorization (JWT), X-Savr-Signature (HMAC-SHA256), X-Savr-Timestamp, X-API-Version: 2026.04
    Et collectes.statut_tms passe à a_attribuer
    Et une ligne est insérée dans integrations_logs (system=tms, direction=sortant, statut=succes)
```

---

```gherkin
# Source : §08 §1 — E2 PATCH /collectes/:id (modification date → réacceptation)
# Couche : api
# Priorité : P1-critique

Scénario : e2_modification_date_collecte_acceptee_declenche_reacceptation_tms
  Étant donné une collecte AG (statut_tms = acceptee) déjà poussée au TMS
    Et un manager traiteur modifie la date_collecte de 2026-07-15 à 2026-07-16
    Et le TMS retourne 200
  Quand le trigger PATCH /collectes/:id est émis
  Alors le payload diff contient uniquement date_collecte: {ancien: "2026-07-15", nouveau: "2026-07-16"}
    Et collectes.dirty_tms = false après succès
    Et une ligne integrations_logs est créée (system=tms, direction=sortant, statut=succes)
```

---

```gherkin
# Source : §08 §1 — S1 POST /webhooks/tms/collecte-acceptee → statut_tms + dérivation statut
# Couche : api + db
# Priorité : P1-critique

Scénario : s1_collecte_acceptee_derive_statut_validee
  Étant donné une collecte (statut=programmee, statut_tms=attribuee_en_attente_acceptation)
    Et le TMS poste sur POST /webhooks/tms/collecte-acceptee avec HMAC valide
    Et le payload contient {event_id, collecte_id, tournee_id, chauffeur_id, vehicule_id, plaque}
  Quand le handler webhook reçoit l'event
  Alors collectes.statut_tms = acceptee
    Et collectes.statut_tms_at est mis à jour
    Et le trigger fn_sync_statut_collecte_from_tms dérive collectes.statut = validee
    Et l'event est inséré dans integrations_inbox (statut=traite)
    Et une ligne integrations_logs est créée (system=tms, direction=entrant, statut=succes)
```

---

```gherkin
# Source : §08 §1 — S5 POST /webhooks/tms/collecte-terminee (realisee, ZD)
# Couche : api + db
# Priorité : P1-critique

Scénario : s5_collecte_terminee_realisee_zd_nominal
  Étant donné une collecte ZD (statut=en_cours, type=zero_dechet)
    Et le TMS poste sur POST /webhooks/tms/collecte-terminee
    Et le payload contient statut_final=realisee, pesees=[{flux:verre, poids_kg:120.5, source:chauffeur}, {flux:carton, poids_kg:80.0, source:chauffeur}], rolls={..}, signature_asso=null
    Et le payload contient photos_collecte=[url_signee_1, url_signee_2] (TTL 7j)
  Quand le handler webhook reçoit l'event
  Alors collectes.statut = realisee
    Et des lignes collecte_flux sont créées (verre 120.5kg, carton 80.0kg)
    Et les photos sont téléchargées depuis Storage TMS et ré-uploadées dans Storage Plateforme
    Et une ligne integrations_logs est créée (system=tms, direction=entrant, statut=succes)
```

---

```gherkin
# Source : §08 §1 — S7 POST /webhooks/tms/plaque-saisie
# Couche : api + db
# Priorité : P2-important

Scénario : s7_plaque_saisie_manager_alimente_tournees_plateforme
  Étant donné une tournée (tournee_id=UUID) avec controle_acces_requis=true
    Et le manager Strike a saisi plaque=AB-123-CD et nom chauffeur=Jean Dupont en M03 E4
    Et le TMS poste sur POST /webhooks/tms/plaque-saisie avec HMAC valide
  Quand le handler webhook reçoit l'event
  Alors plateforme.tournees.plaque_immatriculation = AB-123-CD
    Et plateforme.tournees.chauffeur_nom = Jean Dupont
    Et plateforme.tournees.plaque_saisie_at est renseigné
    Et l'event est inséré dans integrations_inbox (statut=traite)
```

---

```gherkin
# Source : §08 §1 — S11 POST /webhooks/tms/collecte-rejetee
# Couche : api + db
# Priorité : P1-critique

Scénario : s11_collecte_rejetee_par_tms_alerte_admin
  Étant donné une collecte (statut_tms=a_attribuer) rejetée définitivement par Admin TMS (DLQ)
    Et le TMS poste sur POST /webhooks/tms/collecte-rejetee avec HMAC valide
    Et le payload contient {event_id, collecte_id, motif_dlq, commentaire_admin, rejete_par_admin_id, rejete_at}
  Quand le handler webhook reçoit l'event
  Alors collectes.statut_tms = rejetee_par_tms
    Et une alerte Admin Plateforme est créée (type=collecte_rejetee_tms)
    Et l'event est inséré dans integrations_inbox (statut=traite)
    Et une ligne integrations_logs est créée (system=tms, direction=entrant, statut=succes)
```

---

```gherkin
# Source : §08 §3bis — MTS-1 flux nominal (create order → tour → dispatch → validate)
# Couche : api
# Priorité : P1-critique

Scénario : mts1_flux_nominal_creation_ordre_tournee_dispatch
  Étant donné une collecte AG Marathon province (transporteur.type_tms=mts1, branche=ag_province_proximite)
    Et la collecte vient d'être attribuée (statut_tms=non_envoye)
    Et MTS-1 DEMO retourne 201 sur POST /v3/customerOrders avec customerOrderId=CO_42XZ
    Et MTS-1 DEMO retourne 201 sur POST /v3/tours avec tourId=T_99AB
    Et MTS-1 DEMO retourne 200 sur POST /v3/tours/T_99AB/dispatch
    Et MTS-1 DEMO retourne 200 sur PUT /v3/tours/T_99AB/validate
  Quand le flux de création MTS-1 est déclenché
  Alors collectes.statut_tms = attribuee_en_attente_acceptation
    Et attributions_antgaspi.confirmation_transporteur = {statut:.., reference_externe:CO_42XZ, tour_id:T_99AB, recu_at:.., brut:..}
    Et les headers MTS-1 contiennent Authorization: Bearer <token_vault>
    Et le payload POST /v3/customerOrders contient orderNumber = collecte.reference (clé de corrélation)
    Et 4 lignes integrations_logs sont créées (system=mts1, direction=sortant, actions: create_order, create_tour, dispatch, validate)
```

---

```gherkin
# Source : §08 §3bis.7 — MTS-1 polling détecte acceptation (PLANNED/VALIDATED)
# Couche : api + db
# Priorité : P1-critique

Scénario : mts1_polling_detection_acceptation_positive
  Étant donné une collecte (statut_tms=attribuee_en_attente_acceptation, customerOrderId=CO_42XZ)
    Et le cron de polling appelle GET /v3/customerOrders?minDate=..&maxDate=..
    Et MTS-1 retourne customerOrderStatus=PLANNED pour CO_42XZ
    Et GET /v3/tours/T_99AB retourne tour.status.dispatch=ACCEPTED
  Quand le cron traite la réponse
  Alors collectes.statut_tms = acceptee
    Et le trigger fn_sync_statut_collecte_from_tms dérive collectes.statut = validee
    Et une entrée integrations_inbox est insérée (source=mts1, statut=traite)
```

---

```gherkin
# Source : §08 §2 — Pennylane create + finalize + send_email nominal
# Couche : api
# Priorité : P1-critique

Scénario : pennylane_create_finalize_send_email_nominal
  Étant donné une facture brouillon (factures.statut=brouillon, factures.pennylane_id=null)
    Et Admin Savr valide le brouillon
    Et Pennylane v2 retourne 201 sur POST /api/external/v2/customer_invoices avec id=PL_789
    Et Pennylane retourne 200 sur POST /api/external/v2/customer_invoices/PL_789/finalize
    Et Pennylane retourne 200 sur POST /api/external/v2/customer_invoices/PL_789/send_email
  Quand le flux de validation est exécuté
  Alors factures.pennylane_id = PL_789
    Et factures.statut = emise
    Et 3 lignes integrations_logs sont créées (system=pennylane, direction=sortant, actions: create, finalize, send_email, statut=succes)
```

---

```gherkin
# Source : §08 §2 — Pennylane polling J+1 3h (facture payee)
# Couche : api + db
# Priorité : P1-critique

Scénario : pennylane_polling_j1_detecte_facture_payee
  Étant donné une facture (statut=emise, pennylane_id=PL_789)
    Et le job quotidien à 3h du matin s'exécute
    Et Pennylane retourne payment_status=paid sur GET /api/external/v2/customer_invoices/PL_789
  Quand le job traite la réponse
  Alors factures.statut = payee
    Et factures.paye_le est renseigné
    Et une ligne integrations_logs est créée (system=pennylane, direction=sortant, action=poll_payment, statut=succes)
```

---

```gherkin
# Source : §08 §4 — Resend envoi email nominal
# Couche : api
# Priorité : P1-critique

Scénario : resend_envoi_email_nominal
  Étant donné une collecte clôturée déclenchant le template admin_collecte_cloturee
    Et toutes les variables requises sont disponibles
    Et Resend retourne 200 avec resend_id=RE_abc123
  Quand l'Edge Function send-email.ts est appelée
  Alors une ligne emails_envoyes est créée (template_slug=admin_collecte_cloturee, statut=envoye, resend_id=RE_abc123, tentative_numero=1)
    Et une ligne integrations_logs est créée (system=resend, direction=sortant, statut=succes)
```

---

```gherkin
# Source : §08 §4 — Resend webhook event opened → MAJ statut emails_envoyes
# Couche : api
# Priorité : P2-important

Scénario : resend_webhook_opened_maj_statut_emails_envoyes
  Étant donné un email envoyé (emails_envoyes.resend_id=RE_abc123, statut=envoye)
    Et Resend poste sur POST /webhooks/resend/events avec event=email.opened, resend_id=RE_abc123
    Et la signature svix est valide (svix-id, svix-timestamp, svix-signature vérifiés)
  Quand le handler webhook reçoit l'event
  Alors emails_envoyes.statut = ouvert
    Et la réponse est 200
```

---

```gherkin
# Source : §08 §5 — Puppeteer génération bordereau ZD
# Couche : api
# Priorité : P1-critique

Scénario : puppeteer_generation_bordereau_zd
  Étant donné une collecte ZD clôturée avec pesees[] renseignées
    Et Puppeteer container Railway est disponible
  Quand l'Edge Function generate-pdf.ts est appelée (template=bordereau_savr)
  Alors un PDF est généré et uploadé dans Supabase Storage (bucket=bordereaux)
    Et bordereaux_savr.fichier_id est renseigné (référence shared.fichiers)
    Et bordereaux_savr.template_version est enregistrée
```

---

```gherkin
# Source : §08 §9 — Endpoint GET taux recyclage
# Couche : api
# Priorité : P2-important

Scénario : endpoint_get_taux_recyclage_retourne_4_filieres
  Étant donné un utilisateur authentifié avec rôle admin_savr
  Quand il appelle GET /api/v1/admin/parametres/taux-recyclage
  Alors la réponse est 200
    Et le JSON contient 4 filières actives (verre, carton, biodechet, emballage)
    Et chaque filière expose taux_captation, prestataire, source_donnee, actif, date_maj
```

---

### Catégorie 2 — Cas limites métier

---

```gherkin
# Source : §08 §1 — S5 realisee_sans_collecte (AG uniquement)
# Couche : api + db
# Priorité : P1-critique

Scénario : s5_realisee_sans_collecte_ag_badge_et_alerte
  Étant donné une collecte AG (statut=en_cours)
    Et le chauffeur n'a pas trouvé de repas à collecter
    Et le TMS poste collecte-terminee avec statut_final=realisee_sans_collecte
    Et pesees=[], aucun_repas={motif_chauffeur:"Cuisine fermée", photo_lieu_url:"url_photo"}
  Quand le handler webhook traite l'event
  Alors collectes.statut = realisee
    Et aucune ligne collecte_flux n'est créée (pesees vides)
    Et une alerte Admin Ops Savr est créée (type=collecte_aucun_repas)
    Et aucune attestation 2041-GE n'est générée
    Et la facture client sera générée au tarif normal (flag facturation_tarif_normal=true)
```

---

```gherkin
# Source : §08 §1 — S5 multi-camions : un seul S5 terminal agrégé
# Couche : api + db
# Priorité : P1-critique

Scénario : s5_multi_camions_pesees_agregees_un_seul_event
  Étant donné une collecte ZD servie par 2 tournées (tournee_1 et tournee_2)
    Et tournee_1 et tournee_2 sont toutes deux terminées côté TMS
    Et le TMS agrège les pesées et émet un seul S5 avec pesees=[camion1+camion2] et tournee_id=tournee_2 (informatif)
  Quand le handler S5 reçoit l'event
  Alors collecte_flux contient les pesées agrégées des 2 camions
    Et collectes.statut = realisee (une seule fois, pas de doublon)
    Et le champ tournee_id du payload est informatif uniquement (clé = collecte_id)
```

---

```gherkin
# Source : §08 §6 — Event out-of-order (occurred_at antérieur) → ignoré
# Couche : api + db
# Priorité : P2-important

Scénario : event_out_of_order_ignore
  Étant donné une collecte (statut_tms=acceptee, dernier event traité occurred_at=2026-07-15T14:00:00Z)
    Et un event S1 tardif arrive avec occurred_at=2026-07-15T12:00:00Z (antérieur)
  Quand le handler webhook reçoit cet event
  Alors l'event est inséré dans integrations_inbox avec statut=ignore_out_of_order
    Et collectes.statut_tms reste inchangé (acceptee)
    Et la réponse est 200 (pas de retry Resend/TMS)
```

---

```gherkin
# Source : §08 addendum 2026-04-23 §1 — Payload > 256 KB rejeté
# Couche : api
# Priorité : P2-important

Scénario : payload_trop_grand_rejet_413_dlq
  Étant donné un webhook entrant TMS avec payload de 300 KB
  Quand le handler reçoit la requête
  Alors la réponse est 413 (Payload Too Large)
    Et une ligne integrations_inbox est créée avec statut=ignore (schema_invalide)
    Et collectes.statut_tms reste inchangé
```

---

```gherkin
# Source : §08 §1 PATCH — Champ lieu_id reçu en PATCH → rejeté 422
# Couche : api
# Priorité : P2-important

Scénario : patch_collecte_lieu_id_rejete_422
  Étant donné une collecte (statut_tms=acceptee) et un PATCH avec diff={lieu_id:{...}}
  Quand le TMS reçoit le PATCH /collectes/:id
  Alors la réponse est 422 (Unprocessable Entity)
    Et le message précise que lieu_id est immuable (annuler + reprogrammer)
    Et aucun side-effect côté TMS
```

---

```gherkin
# Source : §08 §1 PATCH — Modification notes/informations_supplementaires (statut quelconque) → push silencieux
# Couche : api
# Priorité : P2-important

Scénario : patch_collecte_notes_push_silencieux
  Étant donné une collecte (statut_tms=acceptee) et un PATCH avec diff={informations_supplementaires:{..}}
    Et le TMS retourne 200
  Quand le handler PATCH est exécuté
  Alors aucune réacceptation n'est déclenchée (statut_tms reste acceptee)
    Et une ligne integrations_logs est créée (statut=succes)
```

---

```gherkin
# Source : §08 §2 — Pennylane 4xx → facture reste brouillon, pas de retry
# Couche : api
# Priorité : P1-critique

Scénario : pennylane_4xx_facture_reste_brouillon_pas_de_retry
  Étant donné une facture brouillon validée par Admin
    Et Pennylane retourne 422 sur POST /customer_invoices (données invalides)
  Quand le flux de validation tente l'appel
  Alors factures.statut reste brouillon
    Et une notification Admin contient le message d'erreur Pennylane précis
    Et aucun retry n'est planifié (4xx = erreur définitive)
    Et une ligne integrations_logs est créée (system=pennylane, statut=echec_final, response_status=422)
```

---

```gherkin
# Source : §08 §6 — Retry épuisé (3 paliers) → echec_final + notification Admin
# Couche : api
# Priorité : P1-critique

Scénario : retry_epuise_echec_final_notification_admin
  Étant donné un appel TMS (E1) qui échoue en 5xx
    Et le retry à 5 min échoue en 5xx
    Et le retry à 1h échoue en 5xx
    Et le retry à 24h échoue en 5xx
  Quand les 3 retries sont épuisés (4 tentatives au total)
  Alors collectes.statut_tms reste non_envoye
    Et une notification Admin urgente est envoyée (email + canal ops)
    Et une ligne integrations_logs est créée (statut=echec_final, tentative_numero=4)
    Et le bouton "Rejouer la sync" est disponible Admin (endpoint 10.1)
```

---

```gherkin
# Source : §08 §3bis.6 — MTS-1 polling détecte refus (CANCELED/KO)
# Couche : api + db
# Priorité : P1-critique

Scénario : mts1_polling_detecte_refus_transporteur
  Étant donné une collecte (statut_tms=attribuee_en_attente_acceptation, customerOrderId=CO_42XZ)
    Et le polling lit customerOrderStatus=CANCELED pour CO_42XZ
  Quand le cron traite la réponse
  Alors collectes.statut_tms = rejetee_par_prestataire
    Et collectes.statut reste programmee (retour file, statut inchangé)
    Et une notification Admin Savr est créée (retour file + motif preset)
    Et integrations_inbox est mis à jour (statut=traite)
```

```gherkin
# Source : §08 §3bis.7 — agrégation terminale multi-camions : tous les tours CANCELED/KO (M1.8 Gap 2 / décision Val 2026-06-15)
# Couche : api + db
# Priorité : P1-critique

Scénario : mts1_polling_tous_tours_ko_collecte_reste_en_cours
  Étant donné une collecte multi-camions (statut=en_cours) servie par 2 tournées
    Et le polling lit un état terminal CANCELED/KO pour les 2 customerOrders
  Quand le cron agrège les états terminaux des tours (fn_agreger_terminal_collecte)
  Alors collectes.statut_tms = 'rejetee_par_prestataire'
    Et collectes.statut RESTE 'en_cours' (rejetee_par_prestataire absent de collecte_statut_enum — signal TMS uniquement)
    Et une alerte Ops in-app est créée (intervention manuelle attendue : re-dispatch / reprogrammation, aucune reprogrammation automatique)
    Et aucun bordereau ni PDF n'est généré
```

---

```gherkin
# Source : §08 §4 — Resend 3 retries épuisés → statut echec
# Couche : api
# Priorité : P2-important

Scénario : resend_3_retries_epuises_statut_echec
  Étant donné un envoi email qui échoue en 5xx Resend
    Et les retries à 5min et 1h échouent aussi
    Et le retry à 24h échoue
  Quand les 3 retries sont épuisés
  Alors emails_envoyes.statut = echec
    Et emails_envoyes.tentative_numero = 4
    Et une ligne integrations_logs est créée (system=resend, statut=echec_final)
```

---

```gherkin
# Source : §08 §9 PUT — taux_captation hors borne [0,1] → 422
# Couche : api
# Priorité : P2-important

Scénario : put_taux_recyclage_valeur_hors_borne
  Étant donné un admin_savr authentifié avec Idempotency-Key valide
  Quand il appelle PUT /api/v1/admin/parametres/taux-recyclage/{filiere_id}
    Avec taux_captation=1.5 (> 1)
  Alors la réponse est 422 (Unprocessable Entity)
    Et le message précise que taux_captation doit être compris entre 0 et 1
    Et parametres_taux_recyclage n'est pas modifié
```

---

### Catégorie 3 — Cas d'erreur métier

---

```gherkin
# Source : §08 §1 — HMAC invalide sur webhook entrant TMS → rejet 401
# Couche : api
# Priorité : P1-critique

Scénario : hmac_invalide_webhook_tms_rejet_401
  Étant donné une requête POST /webhooks/tms/collecte-acceptee
    Et le header X-Savr-Signature est forgé (HMAC incorrect)
  Quand le handler reçoit la requête
  Alors la réponse est 401 (Unauthorized)
    Et aucune modification de collectes.statut_tms n'est effectuée
    Et une ligne integrations_logs est créée (statut=echec_final, erreur_code=HMAC_INVALID)
```

---

```gherkin
# Source : §08 addendum §1 — X-API-Version absent → rejet 400
# Couche : api
# Priorité : P1-critique

Scénario : x_api_version_absent_rejet_400
  Étant donné une requête POST /webhooks/tms/collecte-terminee sans header X-API-Version
    Et le HMAC est valide
  Quand le handler reçoit la requête
  Alors la réponse est 400 (Bad Request)
    Et le message précise que X-API-Version est obligatoire
    Et aucune modification n'est effectuée en base
```

---

```gherkin
# Source : §08 §1 — S* pour collecte inconnue côté Plateforme → 200 + anomalie tracée
# Couche : api
# Priorité : P2-important

Scénario : webhook_tms_collecte_inconnue_200_anomalie_tracee
  Étant donné une requête POST /webhooks/tms/collecte-acceptee avec collecte_id inconnu (jamais créé côté Plateforme)
    Et HMAC et X-API-Version sont valides
  Quand le handler reçoit la requête
  Alors la réponse est 200 (évite la boucle de retry TMS)
    Et une ligne integrations_logs est créée (statut=echec_final, erreur_code=COLLECTE_INCONNUE)
    Et aucune modification en base
```

---

```gherkin
# Source : §08 §4 — Resend variable requise manquante → refus envoi
# Couche : api
# Priorité : P2-important

Scénario : resend_variable_requise_manquante_refus_envoi
  Étant donné un déclenchement d'email pour template admin_collecte_cloturee
    Et la variable {{prenom}} est absente du payload
  Quand l'Edge Function send-email.ts tente l'envoi
  Alors aucun appel API Resend n'est effectué
    Et une ligne integrations_logs est créée (erreur_code=MISSING_VARIABLE, system=resend)
    Et aucune ligne emails_envoyes n'est créée
```

---

```gherkin
# Source : §08 §4 — Resend webhook signature svix invalide → rejet 401
# Couche : api
# Priorité : P1-critique

Scénario : resend_webhook_signature_svix_invalide_rejet_401
  Étant donné une requête POST /webhooks/resend/events avec svix-signature forgée
  Quand le handler reçoit la requête
  Alors la réponse est 401 (Unauthorized)
    Et aucune écriture en base (ni emails_envoyes ni integrations_logs)
```

---

```gherkin
# Source : §08 §4 — Template slug inexistant → no-op + trace
# Couche : api
# Priorité : P3-nominal

Scénario : template_slug_inexistant_no_op_trace
  Étant donné un déclenchement d'email avec template_slug=template_fantome (inexistant en DB)
  Quand l'Edge Function send-email.ts tente l'envoi
  Alors aucun appel Resend n'est effectué
    Et une ligne integrations_logs est créée (erreur_code=TEMPLATE_NOT_FOUND)
```

---

```gherkin
# Source : §08 §9bis — POST coefficient perte labo doublon → 409
# Couche : api
# Priorité : P2-important

Scénario : post_coefficient_perte_labo_doublon_409
  Étant donné un coefficient perte labo existant pour (Kaspia, annee_reference=2025)
  Quand admin_savr POST /admin/organisations/{kaspia_id}/coefficients-perte-labo avec annee_reference=2025
  Alors la réponse est 409 (Conflict)
    Et le message conseille d'utiliser PATCH pour corriger
    Et coefficients_perte_labo n'est pas modifié
```

---

```gherkin
# Source : §08 §9ter — PUT CO₂ mix emballages Σ ≠ 100 → 422
# Couche : api
# Priorité : P2-important

Scénario : put_mix_emballages_somme_invalide_422
  Étant donné admin_savr authentifié
  Quand il appelle PUT /api/v1/admin/parametres/co2/mix-emballages
    Avec materiaux dont les part_pct somment à 98.5 (tolérance 0.05 dépassée)
  Alors la réponse est 422
    Et le message indique que la somme des parts doit égaler 100 (±0.05)
    Et parametres_mix_emballages n'est pas modifié
```

---

```gherkin
# Source : §08 §9ter — PUT FE flux emballage directement → 409 (valeur dérivée du mix)
# Couche : api
# Priorité : P2-important

Scénario : put_fe_emballage_direct_rejet_409
  Étant donné admin_savr authentifié
  Quand il appelle PUT /api/v1/admin/parametres/co2/facteurs/{emballage_id}
    Avec fe_induit_kg_t=0.85 (écriture directe sur flux emballage)
  Alors la réponse est 409 (Conflict)
    Et le message explique que fe_emballage est en lecture seule (dérivé du mix §9ter.1)
    Et parametres_facteurs_co2 n'est pas modifié
```

---

```gherkin
# Source : §08 §10.1 — Override dispatch prestataire par ops_savr → 403
# Couche : api
# Priorité : P1-critique

Scénario : dispatch_override_prestataire_par_ops_savr_interdit
  Étant donné un utilisateur ops_savr authentifié
  Quand il appelle POST /api/v1/admin/collectes/{collecte_id}/dispatch
    Avec body {prestataire_id: "uuid", motif_override: "Test"}
  Alors la réponse est 403 (Forbidden)
    Et collectes.prestataire_logistique_id n'est pas modifié
    Et aucun appel TMS/MTS-1/Everest n'est effectué
```

---

### Catégorie 4 — Isolation données (RLS)

---

```gherkin
# Source : §08 §11 RLS ops_savr — lecture integrations_logs autorisée
# Couche : db
# Priorité : P2-important

Scénario : rls_ops_savr_peut_lire_integrations_logs
  Étant donné un utilisateur ops_savr authentifié (rôle Supabase)
  Quand il exécute SELECT * FROM integrations_logs
  Alors il obtient les lignes sans erreur (accès SELECT autorisé)
```

---

```gherkin
# Source : §08 §9 — PUT taux recyclage par ops_savr → 403
# Couche : api
# Priorité : P1-critique

Scénario : rls_ops_savr_ne_peut_pas_modifier_taux_recyclage
  Étant donné un utilisateur ops_savr authentifié
  Quand il appelle PUT /api/v1/admin/parametres/taux-recyclage/{filiere_id}
    Avec un payload valide et Idempotency-Key
  Alors la réponse est 403 (Forbidden)
    Et parametres_taux_recyclage n'est pas modifié
```

---

```gherkin
# Source : §08 §4 — emails_envoyes : SELECT admin_savr seulement
# Couche : db (pgTAP)
# Priorité : P1-critique

Scénario : rls_emails_envoyes_select_admin_savr_seulement
  Étant donné un utilisateur manager_traiteur (Kaspia) authentifié
  Quand il exécute SELECT * FROM emails_envoyes
  Alors il obtient 0 lignes (RLS deny)
  Et un utilisateur admin_savr exécutant le même SELECT obtient toutes les lignes
```

---

```gherkin
# Source : §08 §4 — emails_envoyes : INSERT SERVICE_ROLE seulement
# Couche : db (pgTAP)
# Priorité : P1-critique

Scénario : rls_emails_envoyes_insert_service_role_seulement
  Étant donné un utilisateur admin_savr authentifié (rôle non-SERVICE_ROLE)
  Quand il tente INSERT INTO emails_envoyes (...)
  Alors l'INSERT échoue (RLS deny — écriture réservée SERVICE_ROLE)
  Et un INSERT via SERVICE_ROLE réussit
```

---

```gherkin
# Source : §08 §9 — GET historique taux recyclage par ops_savr → 200
# Couche : api
# Priorité : P2-important

Scénario : rls_ops_savr_peut_lire_historique_taux_recyclage
  Étant donné un utilisateur ops_savr authentifié
  Quand il appelle GET /api/v1/admin/parametres/taux-recyclage/{filiere_id}/history
  Alors la réponse est 200 avec le tableau history
```

---

```gherkin
# Source : §08 §9bis — GET coefficients perte labo par manager_traiteur → 403
# Couche : api
# Priorité : P2-important

Scénario : rls_manager_traiteur_ne_peut_pas_lire_coefficients_perte_labo
  Étant donné un utilisateur manager_traiteur (Kaspia) authentifié
  Quand il appelle GET /api/v1/admin/organisations/{kaspia_id}/coefficients-perte-labo
  Alors la réponse est 403 (Forbidden)
```

---

```gherkin
# Source : §08 §10.3 — GET KPIs dashboard par manager_traiteur → 403
# Couche : api
# Priorité : P2-important

Scénario : rls_manager_traiteur_ne_peut_pas_acceder_kpis_admin
  Étant donné un utilisateur manager_traiteur (Kaspia) authentifié
  Quand il appelle GET /api/v1/admin/dashboard/kpis
  Alors la réponse est 403 (Forbidden)
```

---

```gherkin
# Source : §08 §9 — DELETE filière taux recyclage → interdit (même admin_savr)
# Couche : api + db (pgTAP)
# Priorité : P2-important

Scénario : rls_delete_filiere_taux_recyclage_interdit_v1
  Étant donné un admin_savr authentifié
  Quand il tente DELETE FROM parametres_taux_recyclage WHERE id=...
  Alors l'opération est rejetée (pas de DELETE V1 — bascule via actif=false uniquement)
```

---

### Catégorie 5 — Idempotence et états

---

```gherkin
# Source : §08 §6 — dédup event_id TMS entrant (integrations_inbox 7j)
# Couche : api + db
# Priorité : P1-critique

Scénario : dedup_event_id_tms_entrant_idempotent
  Étant donné un event S1 (event_id=EVT_123) déjà traité et présent dans integrations_inbox
  Quand le TMS renvoie le même S1 (EVT_123, retry)
  Alors la réponse est 200 (pas de retry TMS)
    Et integrations_inbox est mis à jour (statut=ignore_doublon)
    Et collectes.statut_tms n'est PAS modifié une deuxième fois
```

---

```gherkin
# Source : §08 §9 — Idempotency-Key sur PUT taux recyclage (fenêtre 24h)
# Couche : api
# Priorité : P2-important

Scénario : idempotency_key_put_taux_recyclage_rejoue_meme_resultat
  Étant donné un PUT taux recyclage avec Idempotency-Key=IK_XYZ déjà exécuté dans les 24h
    Et le résultat précédent était 200 avec taux=0.92
  Quand le même PUT est rejoué avec Idempotency-Key=IK_XYZ
  Alors la réponse est 200 avec le même résultat (taux=0.92)
    Et aucun nouvel INSERT dans parametres_taux_recyclage_history
```

---

```gherkin
# Source : §08 §3bis.9 — Idempotence MTS-1 : recherche par orderNumber avant recréation
# Couche : api
# Priorité : P1-critique

Scénario : mts1_idempotence_creation_commande_doublon_recherche_orderNumber
  Étant donné une collecte (collecte.reference=COL_2026_001) dont POST /v3/customerOrders a déjà réussi
    Et un doute sur le succès (network timeout côté Plateforme)
  Quand la Plateforme tente un second POST /v3/customerOrders
  Alors elle appelle d'abord GET /v3/customerOrders?orderNumber=COL_2026_001
    Et si la commande existe (customerOrderId=CO_42XZ), elle ne crée pas de doublon
    Et attributions_antgaspi.confirmation_transporteur.reference_externe reste CO_42XZ
```

---

```gherkin
# Source : §08 §4 — svix-id Resend déjà traité → no-op idempotent
# Couche : api
# Priorité : P2-important

Scénario : resend_webhook_svix_id_deja_traite_noop
  Étant donné un event Resend (svix-id=SVX_789, type=email.opened) déjà appliqué
  Quand Resend renvoie le même event (svix-id=SVX_789, retry Resend)
  Alors la réponse est 200
    Et emails_envoyes.statut n'est PAS modifié une deuxième fois (no-op)
```

---

```gherkin
# Source : §08 §9 + §9ter — Snapshot CO₂ figé à la clôture → pas de recalcul rétroactif
# Couche : db
# Priorité : P1-critique

Scénario : snapshot_co2_caps_figes_pas_de_recalcul_retroactif
  Étant donné une collecte ZD clôturée avec caps_appliques={verre:0.96, carton:0.90, ...} et co2_facteurs_snapshot={...}
  Quand admin_savr modifie le taux carton de 0.90 à 0.85 (PUT taux recyclage)
  Alors la collecte déjà clôturée a toujours caps_appliques.carton=0.90 (snapshot figé)
    Et aucun UPDATE sur collectes.taux_recyclage ou collectes.co2_* n'est déclenché
    Et les nouvelles collectes clôturées après la modification appliquent carton=0.85
```

---

```gherkin
# Source : §08 §9 — trigger fn_taux_recyclage : taux_recyclage=NULL si SUM poids = 0
# Couche : db
# Priorité : P2-important

Scénario : trigger_taux_recyclage_null_si_aucune_pesee
  Étant donné une collecte ZD sans aucune ligne collecte_flux (pesees = 0)
    Et la collecte passe au statut cloturee
  Quand le trigger fn_taux_recyclage est exécuté
  Alors collectes.taux_recyclage = NULL (pas de division par zéro)
    Et collectes.caps_appliques = snapshot avec version_parametres_at renseigné
```

---

```gherkin
# Source : §08 §9ter — trigger fn_recompute_emballage_fe après PUT mix emballages
# Couche : db
# Priorité : P2-important

Scénario : trigger_recompute_emballage_fe_apres_mise_a_jour_mix
  Étant donné un mix emballages valide (Σ=100%, FE PET=1.2, PET part=30%)
  Quand admin_savr met à jour le mix avec PATCH atomique (part PET→35%, recalcul)
  Alors le trigger fn_recompute_emballage_fe est déclenché
    Et parametres_facteurs_co2 ligne emballage.fe_induit est recalculé = Σ(part_i × fe_i)
    Et la réponse contient fe_emballage_recalcule:{induit, evite} mis à jour
```

---

```gherkin
# Source : §08 §2 — Pennylane statut en_attente_pennylane sur 5xx (retry planifié)
# Couche : api + db
# Priorité : P1-critique

Scénario : pennylane_5xx_facture_en_attente_retry_planifie
  Étant donné une facture brouillon validée par Admin
    Et Pennylane retourne 503 sur POST /customer_invoices
  Quand le flux de validation reçoit l'erreur 5xx
  Alors factures.statut = en_attente_pennylane
    Et un retry est planifié à J+5min
    Et une ligne integrations_logs est créée (statut=echec_retryable, tentative_numero=1)
    Et l'email client n'est pas envoyé (uniquement après succès)
```

---

```gherkin
# Source : §08 §9bis — commentaire_modif manquant sur PUT coefficient → 422
# Couche : api
# Priorité : P2-important

Scénario : put_taux_recyclage_commentaire_modif_manquant_422
  Étant donné un admin_savr authentifié avec Idempotency-Key valide
  Quand il appelle PUT /api/v1/admin/parametres/taux-recyclage/{filiere_id}
    Sans champ commentaire_modif (ou avec commentaire_modif de 3 caractères < 5)
  Alors la réponse est 422
    Et parametres_taux_recyclage n'est pas modifié
```

---

### Catégorie 6 — Scénarios cross-app (chaînes complètes)

---

```gherkin
# Source : §08 §1 — Chaîne E1 → S1 → S5 complète (ZD)
# Couche : api + db
# Priorité : P1-critique

Scénario : chaine_e1_s1_s5_zd_complete
  Étant donné une collecte ZD Kaspia nouvellement programmée
  Quand :
    1. E1 est émis → collectes.statut_tms = a_attribuer
    2. Admin TMS dispatche → collectes.statut_tms = attribuee_en_attente_acceptation
    3. S1 reçu → collectes.statut_tms = acceptee, statut = validee
    4. S3 tournée-upsert reçu → collecte_tournees liaison créée
    5. S_en_cours reçu → collectes.statut = en_cours
    6. S5 reçu (statut_final=realisee) → collectes.statut = realisee, collecte_flux créés
    7. Batch embargo H+24 → collectes.statut = cloturee
    8. Trigger taux_recyclage → collectes.taux_recyclage calculé, caps_appliques figé
    9. Puppeteer → bordereau_savr PDF généré
  Alors l'intégralité de la chaîne s'exécute sans erreur
    Et integrations_logs contient une entrée succes pour chaque étape
    Et l'état final est cohérent : collecte clôturée + taux_recyclage non-null + bordereau PDF
```

---

```gherkin
# Source : §08 §2 — Chaîne Pennylane create → finalize → send_email → polling payee
# Couche : api + db
# Priorité : P1-critique

Scénario : chaine_pennylane_complete_create_finalize_email_poll_payee
  Étant donné une facture brouillon avec lignes correctes
  Quand :
    1. Admin valide → POST /customer_invoices → pennylane_id renseigné
    2. POST finalize → facture verrouillée Pennylane
    3. POST send_email → email envoyé au client Kaspia via Pennylane
    4. factures.statut = emise
    5. J+1 à 3h : job polling GET customer_invoices/PL_xxx → payment_status=paid
    6. factures.statut = payee, paye_le renseigné
  Alors 4 lignes integrations_logs (create/finalize/send_email/poll) sont créées (statut=succes)
    Et factures.statut final = payee
```

---

```gherkin
# Source : §08 §3 V1 — Everest appel direct : confirmation positive → acceptee
# Couche : api + db
# Priorité : P1-critique

Scénario : everest_confirmation_positive_statut_tms_acceptee
  Étant donné une collecte AG IDF (branche=ag_velo_programme, transporteur.type_tms=a_toutes)
    Et Everest retourne confirmation synchrone positive (service_id=71)
    Et confirmation_transporteur.statut=accepte
  Quand la Plateforme reçoit la confirmation Everest
  Alors collectes.statut_tms = acceptee
    Et le trigger fn_sync_statut_collecte_from_tms dérive collectes.statut = validee
    Et integrations_logs contient une entrée (system=everest, action=create_mission, statut=succes)
    Et aucune bascule automatique n'a eu lieu avant ce signal positif
```

---

```gherkin
# Source : §08 §3 V1 — Everest course sans marchandise → realisee_sans_collecte (AG, M2.5 R10a)
# Couche : api + db
# Priorité : P1-critique

Scénario : everest_course_vide_refetch_realisee_sans_collecte
  Étant donné une collecte AG IDF (transporteur.type_tms=a_toutes, statut=en_cours, non terminal)
    Et Everest envoie un webhook terminal (mission_failed)
    Et le re-fetch de la mission retourne mission_status="Client absent / Marchandise refusée"
  Quand l'adapter Everest traite le webhook (re-fetch mission, jamais le payload)
  Alors collectes.statut = realisee_sans_collecte
    Et collectes.realisee_at = now()
    Et aucun_repas_motif = "Client absent / Marchandise refusée"
    Et aucun_repas_photo_url = NULL (aucune photo de lieu fournie par Everest en V1)
    Et une alerte Ops in-app est créée (type=collecte_aucun_repas)
    Et aucune attestation 2041-GE n'est générée
    Et une collecte ZD équivalente ne déclencherait qu'une trace (aucune transition)
```

---

```gherkin
# Source : §08 §3 V1 — Everest mission_failed avant acceptation → rejetee_par_prestataire
# Couche : api + db
# Priorité : P1-critique

Scénario : everest_mission_failed_avant_acceptation_rejetee
  Étant donné une collecte AG IDF (transporteur.type_tms=a_toutes, statut_tms=attribuee_en_attente_acceptation)
    Et Everest envoie mission_failed / annulation externe avant acceptation
  Quand l'adapter Everest traite le webhook (re-fetch mission_status)
  Alors collectes.statut_tms = rejetee_par_prestataire
    Et collectes.statut métier reste programmee
    Et une alerte Ops est créée
```

---

```gherkin
# Source : §08 §3bis.7 — MTS-1 chaîne polling complète : create → dispatch → poll STARTED → poll OK
# Couche : api + db
# Priorité : P1-critique

Scénario : mts1_chaine_polling_complete
  Étant donné une collecte ZD Strike (type_tms=mts1)
  Quand :
    1. Création commande+tour+dispatch+validate MTS-1 → statut_tms=attribuee_en_attente_acceptation
    2. Polling : customerOrderStatus=PLANNED, tour.status.dispatch=ACCEPTED → statut_tms=acceptee, statut=validee
    3. Polling : customerOrderProgressionStatus=STARTED → statut=en_cours
    4. Polling : customerOrderStatus=OK, GET /v3/tours/{id} → pesées[stops.weight] → statut=realisee + collecte_flux créés
    5. Photos téléchargées + ré-uploadées Storage Plateforme
  Alors l'état final est collectes.statut=realisee avec collecte_flux et photos stockées
    Et integrations_inbox contient 3 entrées (PLANNED, STARTED, OK) avec statut=traite
```

---

### Catégorie 7 — Scénarios de migration

---

```gherkin
# Source : §08 §3bis.11 — Migration MTS-1 V1→V2 : corrélation customerOrderId ↔ collecte.reference
# Couche : db
# Priorité : P2-important

Scénario : migration_mts1_reconciliation_customerOrderId_collecte_reference
  Étant donné un jeu de seed_demo avec 50 collectes MTS-1 historiques
    Et attributions_antgaspi.confirmation_transporteur.reference_externe = customerOrderId
    Et collectes.reference = orderNumber MTS-1
  Quand le script de check de réconciliation s'exécute
  Alors pour chaque ligne attributions_antgaspi, un customerOrderId correspond à une collecte.reference unique
    Et aucune ligne orpheline (customerOrderId sans collecte.reference correspondant) n'existe
    Et le check vert est validé (count mismatch = 0)
```

---

```gherkin
# Source : §08 §6 — Migration integrations_logs : idempotence du script
# Couche : db
# Priorité : P2-important

Scénario : migration_integrations_logs_idempotence_script
  Étant donné un script de migration qui insère les logs historiques MTS-1 dans integrations_logs
  Quand le script est rejoué une seconde fois (test idempotence)
  Alors aucun doublon n'est créé dans integrations_logs
    Et le count final est identique aux deux runs
```

---

```gherkin
# Source : §08 §3bis.11 — Simulation rollback migration MTS-1 (corruption)
# Couche : db
# Priorité : P2-important

Scénario : migration_mts1_rollback_corruption_simulee
  Étant donné un dataset seed_demo avec une ligne corrompue (reference_externe=null)
    Et le script détecte l'anomalie en check de réconciliation
  Quand le rollback est exécuté
  Alors l'état initial de attributions_antgaspi est restauré
    Et la ligne corrompue est absente
    Et un rapport de rollback est tracé (nb_rollback, entites_concernees)
```

---

```gherkin
# Source : §08 §2 — Migration Pennylane : factures historiques sans pennylane_id
# Couche : db
# Priorité : P3-nominal

Scénario : migration_pennylane_factures_sans_pennylane_id_identifiees
  Étant donné un jeu de seed_demo avec des factures à statut=emise importées depuis Bubble (pennylane_id=null)
  Quand le check de réconciliation migration s'exécute
  Alors les factures sans pennylane_id sont identifiées dans un rapport (liste + count)
    Et ces factures sont marquées pour saisie manuelle Admin (flag migration_reconciliation_requise=true)
    Et aucune facture avec statut=payee n'a pennylane_id=null (invariant critique)
```

---

## §15 §2.6 — Onboarding : revalidation SIRET (INSEE) & anti-doublon

> Ajout 2026-07-01 (suite divergence M0.4 / lot R13). Source de vérité : [[15 - Sécurité et conformité]] §2.6 (l.69 anti-doublon, l.73 revalidation asynchrone) + [[04 - Data Model]] (`file_revalidation_siret`, `entites_facturation.siret_verification`, index `uniq_entites_facturation_siret`). Regroupés dans §08 car INSEE/VIES sont les intégrations API tierces de l'onboarding. Rappel §04 : la **facturation est bloquée tant que `siret_verification ≠ 'verifie'`** (cf. `06.08-generation-edition-facture-scenarios.md`).

```gherkin
# Source : §15 §2.6 l.73 + §04 file_revalidation_siret — INSEE injoignable au signup → compte créé, revalidation enfilée
# Couche : api + db
# Priorité : P1-critique

Scénario : revalidation_siret_signup_insee_injoignable_enfile_le_job
  Étant donné un candidat qui s'inscrit avec un SIRET syntaxiquement valide
    Et l'API INSEE/Sirene est injoignable (timeout > 3 s ou 5xx)
  Quand le flux d'inscription traite la vérification SIRET
  Alors le compte et son entite_facturation sont créés (inscription NON bloquée)
    Et entites_facturation.siret_verification = 'en_attente'
    Et une ligne file_revalidation_siret est créée (statut='en_attente', tentatives=0, prochaine_tentative_le = now()+15min)
    Et un second passage INSEE-down pour la même entite_facturation ne crée PAS de 2e ligne active (index unique (entite_facturation_id) WHERE statut='en_attente')
```

```gherkin
# Source : §15 §2.6 l.73 — revalidation asynchrone, 3 paliers 15 min / 1 h / 24 h
# Couche : db
# Priorité : P1-critique

Scénario : revalidation_siret_espacement_des_3_paliers
  Étant donné une ligne file_revalidation_siret en statut='en_attente'
    Et l'API INSEE reste injoignable à chaque échéance
  Quand le worker cron traite successivement les échéances sans réponse INSEE
  Alors après la 1re tentative : tentatives=1 et prochaine_tentative_le = base + 15 min
    Et après la 2e tentative : tentatives=2 et prochaine_tentative_le = base + 1 h
    Et après la 3e tentative : tentatives=3 et prochaine_tentative_le = base + 24 h
```

```gherkin
# Source : §15 §2.6 l.73 + §04 — une tentative obtient « entreprise active » → SIRET vérifié, facturation débloquée
# Couche : api + db
# Priorité : P1-critique

Scénario : revalidation_siret_insee_repond_active_resout_et_debloque_facturation
  Étant donné une ligne file_revalidation_siret (statut='en_attente', tentatives=1)
  Quand le worker cron rejoue la vérification et l'INSEE répond « entreprise existante et active »
  Alors entites_facturation.siret_verification = 'verifie'
    Et entites_facturation.siret_verifie_le est renseigné
    Et file_revalidation_siret.statut = 'resolu' (plus aucun essai ; prochaine_tentative_le conserve sa dernière échéance, non remise à NULL)
    Et la facturation de cette entité est désormais autorisée (gate §04 levé)
```

```gherkin
# Source : §15 §2.6 + §04 — une tentative obtient « inexistant/inactif » → échec, facturation reste bloquée
# Couche : api + db
# Priorité : P1-critique

Scénario : revalidation_siret_insee_repond_inactif_echec_alerte_admin
  Étant donné une ligne file_revalidation_siret (statut='en_attente')
  Quand le worker cron rejoue la vérification et l'INSEE répond « SIRET inexistant ou inactif »
  Alors entites_facturation.siret_verification = 'echec'
    Et file_revalidation_siret.statut = 'resolu' (verdict obtenu, plus aucun essai)
    Et l'organisation remonte dans le filtre Admin « nouvelles organisations » (alerte in-app)
    Et la facturation de cette entité reste bloquée (siret_verification ≠ 'verifie')
```

```gherkin
# Source : §15 §2.6 l.73 + §04 — 3 paliers épuisés sans réponse INSEE → abandon automate, reprise humaine
# Couche : db
# Priorité : P2-important

Scénario : revalidation_siret_3_paliers_epuises_reste_en_attente
  Étant donné une ligne file_revalidation_siret (statut='en_attente', tentatives=3)
  Quand l'échéance du 3e palier est traitée et l'INSEE ne répond toujours pas
  Alors file_revalidation_siret.statut = 'epuise' (plus aucun essai automatique)
    Et entites_facturation.siret_verification reste 'en_attente' (aucun verdict obtenu)
    Et l'organisation reste visible dans le filtre Admin « nouvelles organisations » pour traitement manuel
    Et la facturation de cette entité reste bloquée
```

```gherkin
# Source : §15 §2.6 l.69 + §04 index uniq_entites_facturation_siret — SIRET déjà rattaché → inscription bloquée
# Couche : api + db
# Priorité : P1-critique

Scénario : doublon_siret_signup_bloque
  Étant donné une entite_facturation existante avec siret = '83179309400017' (siret <> '')
  Quand un candidat s'inscrit avec le SIRET '83179309400017'
  Alors l'inscription est bloquée avec un message explicite (« SIRET déjà rattaché à une organisation »)
    Et aucune nouvelle organisation ni entite_facturation n'est créée
    Et l'index unique partiel uniq_entites_facturation_siret (siret) WHERE siret <> '' garantit le rejet au niveau base
```

```gherkin
# Source : §04 index partiel WHERE siret <> '' — les entités sans SIRET ne collisionnent pas entre elles
# Couche : db
# Priorité : P2-important

Scénario : siret_vide_plusieurs_entites_autorise
  Étant donné une entite_facturation existante avec siret = '' (onboarding partiel / shadow)
  Quand une seconde entite_facturation est créée avec siret = ''
  Alors les deux coexistent sans conflit (l'index unique ne s'applique qu'aux siret non vides)
```

---

## Scénarios hors scope V1 (à générer V1.1)

- Webhooks MTS-1 entrants push natifs (`customerOrder/progress`, `tour/update`) — différé V1.1 (décision Val 2026-06-05, polling seul V1)
- Webhook Pennylane `invoice.paid` — différé V1.1 (revue sobriété §08 B1)
- Endpoint `GET /v3/extract/activitysheet` MTS-1 (rapprochement coûts logistiques) — V2 seulement
- Endpoint SSO cross-app `has-profile` — supprimé V1 (sobriété Bloc A A1)
- Rate limiting Everest : nombre exact de req/min à valider avec A Toutes! avant dev
- Export CSV `GET /admin/dashboard/revenus-organisations.csv` — scénarios format (encoding, headers CSV)

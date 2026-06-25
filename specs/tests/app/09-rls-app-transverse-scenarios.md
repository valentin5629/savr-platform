# Scénarios de test — §09 RLS App transverse (pgTAP)

**Source CDC** : §09 (matrice §3 + matrice étendue ops_savr + §3ter audit RLS V1 + Bloc D) + §04 (RLS inline `sequences_facturation`, `audit_log`, `config_auto_accept_ag`, tables history) + §05 (`f_collecte_editable`) + §06.06 (matrice écrans) + §11 (Bloc 7)
**Généré le** : 2026-06-07
**Statut** : À implémenter par Claude Code

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests RLS transverses de la Plateforme.
> Pour chaque scénario :
> - Couche `db` → écrire un test pgTAP dans `supabase/tests/` — **tous les tests RLS s'exécutent sous le rôle `authenticated`** avec claims JWT simulés (`set_config('request.jwt.claims', …)`), jamais en superuser
> - Couche `api` → écrire un test Vitest dans `packages/plateforme/tests/api/`
> Les tests P1-critique sont bloquants CI. Les tests P2 et P3 sont non-bloquants V1.
> Ne pas démarrer le développement d'un module sans avoir écrit les tests P1 de ce fichier qui touchent ses tables.
>
> **Périmètre** : ce lot consolide la suite pgTAP **transverse** (couverture critique V1, sobriété 2026-06-03 B2). Les scénarios RLS spécifiques à un module (cat. 4 des lots ①–⑩) restent dans leurs fichiers — pas de doublon ici : ce fichier porte les tests **multi-tables, helpers, prédicats canoniques et chemins d'accès croisés**. Couverture 100 % des policies = V1.1.
>
> **4 décisions Val 2026-06-07 (lot ⑪)** intégrées : F1 `cf_update_staff` (pesées admin+ops), F2 règle staff canonique `f_is_staff()`, F3 `f_collecte_editable` sur UPDATE manager+agence, F4 `users` SELECT org-wide commercial.

---

## Résumé de couverture

| Catégorie | Nb scénarios | Couverture |
|-----------|-------------|------------|
| 1. Happy path | 8 | 7 rôles × périmètre nominal + helper `f_collecte_visible` |
| 2. Cas limites métier | 11 | frontières de visibilité (traiteur opérationnel, shadow, brouillons tiers, multi-camions, fenêtre édition, column-level) |
| 3. Cas d'erreur métier | 11 | écritures refusées par rôle (matrice étendue ops, périmètres INSERT) |
| 4. Isolation données (RLS) | 14 | cross-org deny par rôle, tables filles, fichiers polymorphes, PII |
| 5. Idempotence et états | 14 | append-only, immuabilité, SERVICE_ROLE only, soft delete users/fichiers, RGPD demandes_suppression |
| 6. Cross-app | 4 | réduite/justifiée — schéma `tms.*` inexistant V1 ; SERVICE_ROLE + claim `app_domain` |
| 7. Migration | 5 | mapping rôles, claims post-migration, échantillonnage cross-org, anonymisation, idempotence policies |
| **TOTAL** | **67** | |

**Fixtures de référence** : org A = Kaspia (traiteur), org B = Kardamome (traiteur), org C = Viparis (gestionnaire de lieux, 2 lieux liés via `organisations_lieux`), org D = agence événementielle, org E = client organisateur. Users : `manager_kaspia`, `commercial1_kaspia`, `commercial2_kaspia`, `manager_kardamome`, `gest_viparis`, `agence_d`, `client_e`, `ops1` (ops_savr), `val` (admin_savr).

---

## Catégorie 1 — Happy path

```gherkin
# Source : §09 §3 evenements/collectes + matrice étendue ops_savr
# Couche : db | Priorité : P1-critique

Scénario : admin_savr_voit_tout
  Étant donné des collectes appartenant à Kaspia, Kardamome et Viparis
  Quand `val` (admin_savr) exécute SELECT sur `collectes`
  Alors les collectes des 3 organisations sont retournées

Scénario : ops_savr_meme_surface_lecture_que_admin (staff_ops_read_surface_ok — F2)
  Étant donné les mêmes données
  Quand `ops1` exécute SELECT sur `evenements`, `collectes`, `factures`, `organisations`, `users`, `tournees`, `packs_antgaspi`
  Alors chaque SELECT retourne le même nombre de lignes que pour `val` (admin_savr)

Scénario : manager_voit_collectes_de_son_org
  Étant donné 3 collectes Kaspia (dont 1 créée par commercial1_kaspia) et 2 collectes Kardamome
  Quand `manager_kaspia` exécute SELECT sur `collectes`
  Alors exactement 3 lignes sont retournées (y compris celle du commercial)

Scénario : commercial_lecture_org_wide
  Étant donné 1 collecte créée par commercial1_kaspia et 1 créée par commercial2_kaspia
  Quand `commercial1_kaspia` exécute SELECT sur `collectes` et `factures`
  Alors il voit les 2 collectes et toutes les factures Kaspia (lecture alignée manager, révision 2026-05-29)

Scénario : gestionnaire_voit_evenements_de_ses_lieux
  Étant donné un événement Kaspia daté sur le lieu L1 (lié à Viparis via organisations_lieux)
  Quand `gest_viparis` exécute SELECT sur `evenements`
  Alors l'événement est visible (chemin lieu_id IN organisations_lieux + date_evenement NOT NULL)

Scénario : client_organisateur_lecture_seule_ses_evenements
  Étant donné un événement avec client_organisateur_organisation_id = org E
  Quand `client_e` exécute SELECT sur `evenements`
  Alors l'événement est visible
  Et tout INSERT/UPDATE/DELETE sur `evenements` par `client_e` échoue (0 ligne affectée)

Scénario : f_collecte_visible_miroir_policy_collectes
  Étant donné 1 collecte par chemin d'accès (programmateur, traiteur opérationnel, client organisateur, lieu gestionnaire)
  Quand on compare, pour chacun des 5 rôles clients, le résultat de SELECT `collectes` et la valeur de `f_collecte_visible(collecte_id)`
  Alors les deux sont strictement identiques pour chaque couple (rôle, collecte) — anti-dérive helper/policy

Scénario : agence_voit_ses_fiches_shadow
  Étant donné une organisation shadow `est_shadow=true, cree_par_organisation_id=org D` et une organisation shadow créée par une autre agence
  Quand `agence_d` exécute SELECT sur `organisations`
  Alors elle voit org D + sa propre fiche shadow, mais pas la fiche shadow de l'autre agence
```

---

## Catégorie 2 — Cas limites métier

```gherkin
# Source : §09 §3 (extensions 2026-05-07/05-29, décisions F3/F5/F6 lot ⑤, F3/F4 lot ⑪) + §05 f_collecte_editable
# Couche : db | Priorité : P1-critique sauf mention

Scénario : traiteur_operationnel_voit_collecte_programmee_par_tiers
  Étant donné un événement programmé par l'agence D avec traiteur_operationnel_organisation_id = Kaspia
  Quand `manager_kaspia` exécute SELECT sur `evenements`
  Alors l'événement est visible

Scénario : traiteur_operationnel_ne_peut_pas_modifier_programmation_tierce
  Étant donné le même événement (organisation_id = org D)
  Quand `manager_kaspia` exécute UPDATE sur cet événement
  Alors 0 ligne est affectée (UPDATE limité à organisation_id = self)

Scénario : gestionnaire_brouillon_tiers_exclu (evenements_brouillon_tiers_denied)
  Étant donné un brouillon Kaspia (date_evenement NULL) sur le lieu L1 de Viparis
  Quand `gest_viparis` exécute SELECT sur `evenements`
  Alors le brouillon n'apparaît pas (anti-fuite d'intention commerciale — décision F3 lot ⑤)
  Et son propre brouillon (organisation_id = Viparis, date NULL) reste visible

Scénario : manager_update_dans_fenetre_edition_ok (F3 lot ⑪)
  Étant donné un événement Kaspia dont une collecte est au statut `programmee`
  Quand `manager_kaspia` exécute UPDATE sur cet événement
  Alors la mise à jour réussit (f_collecte_editable = TRUE)

Scénario : manager_update_hors_fenetre_denied (evenements_update_manager_fenetre_denied — F3 lot ⑪)
  Étant donné un événement Kaspia dont toutes les collectes sont `realisee` ou `cloturee`
  Quand `manager_kaspia` exécute UPDATE sur cet événement
  Alors 0 ligne est affectée (f_collecte_editable = FALSE — protection des figés)

Scénario : agence_update_hors_fenetre_denied (evenements_update_agence_fenetre_denied — F3 lot ⑪)
  Étant donné un événement org D dont toutes les collectes sont `cloturee`
  Quand `agence_d` exécute UPDATE sur cet événement
  Alors 0 ligne est affectée

Scénario : admin_update_hors_fenetre_reste_possible (F3 lot ⑪ — forçage staff)
  Étant donné le même événement 100 % clôturé
  Quand `val` (admin_savr) exécute UPDATE sur cet événement
  Alors la mise à jour réussit (la garde ne s'applique qu'aux rôles clients)

Scénario : commercial_update_sa_collecte_dans_fenetre
  Étant donné un événement créé par commercial1_kaspia avec une collecte `validee`
  Quand `commercial1_kaspia` exécute UPDATE sur cet événement
  Alors la mise à jour réussit (created_by = self ET f_collecte_editable)

Scénario : lieux_colonnes_admin_only_invisibles_clients (lieux_admin_only_fields_hidden_from_clients)
  Étant donné le lieu L1 avec `commentaire_lieu`, `siren`, `email_gestionnaire`, `reference_citeo`, `commentaires_internes` renseignés
  Quand `manager_kaspia` puis `gest_viparis` exécutent SELECT de ces 5 colonnes sur `plateforme.lieux`
  Alors chaque requête échoue en erreur de privilège column-level
  Et `v_lieux_clients` (SECURITY INVOKER) retourne le lieu sans ces 5 colonnes (masquage via REVOKE/GRANT whitelist)
  # Couche : db | Priorité : P1-critique (REVOKE table-level + GRANT SELECT whitelist, pattern F5 factures)

Scénario : v_factures_client_sans_marge_logistique (test_factures_marge_invisible_clients — F5 lot ⑦)
  Étant donné une facture Kaspia avec marge_logistique renseignée
  Quand `manager_kaspia` interroge `v_factures_client`
  Alors la facture est visible et la vue n'expose ni `marge_logistique` ni `erreur_synchro*`
  Et le SELECT direct sur `plateforme.factures` par `manager_kaspia` retourne 0 ligne (table = staff only)

Scénario : v_factures_client_non_vide_manager (test_factures_vue_client_non_vide_manager — F5-corr M3.5 2026-06-16)
  # Prérequis : policy fac_client_select sur plateforme.factures — SANS elle, SECURITY INVOKER + DENY ALL → 0 ligne
  Étant donné une facture Kaspia émise (organisation_id = org_kaspia)
  Et `manager_kaspia` authentifié (rôle traiteur_manager, organisation_id = org_kaspia)
  Quand `manager_kaspia` interroge `v_factures_client`
  Alors ≥ 1 ligne retournée et aucune erreur RLS
  Et une facture d'organisation B est absente (org-scoping actif via fac_client_select)

Scénario : lieu_visible_par_double_chemin
  Étant donné un lieu L3 sans lien organisations_lieux avec Kaspia mais référencé par un événement Kaspia
  Quand `manager_kaspia` exécute SELECT sur `lieux`
  Alors L3 est visible (chemin evenements) ; un lieu L4 sans aucun des 2 chemins est invisible
  # Priorité : P2-important
```

---

## Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : §09 matrice étendue ops_savr (source de vérité) + §3 prédicats INSERT + A9/A9bis + §04 audit_log
# Couche : db | Priorité : P1-critique sauf mention

Scénario : agence_insert_organisation_non_shadow_refuse
  Quand `agence_d` exécute INSERT `organisations` avec est_shadow=false
  Alors l'INSERT échoue (WITH CHECK est_shadow=true obligatoire)

Scénario : agence_insert_shadow_type_non_traiteur_refuse
  Quand `agence_d` exécute INSERT `organisations` avec est_shadow=true, type='agence'
  Alors l'INSERT échoue (WITH CHECK type='traiteur')

Scénario : gestionnaire_insert_evenement_lieu_hors_perimetre_refuse
  Quand `gest_viparis` exécute INSERT `evenements` avec lieu_id = lieu non lié via organisations_lieux
  Alors l'INSERT échoue

Scénario : gestionnaire_insert_evenement_traiteur_shadow_refuse
  Quand `gest_viparis` exécute INSERT `evenements` avec traiteur_operationnel = organisation shadow
  Alors l'INSERT échoue (filtre est_shadow=false dans le WITH CHECK)

Scénario : commercial_update_collecte_d_un_collegue_refuse
  Étant donné un événement créé par commercial2_kaspia
  Quand `commercial1_kaspia` exécute UPDATE sur cet événement
  Alors 0 ligne est affectée (écriture = created_by self only, lecture org-wide n'ouvre pas l'écriture)

Scénario : commercial_invitation_user_refuse
  Quand `commercial1_kaspia` exécute INSERT sur `users`
  Alors l'INSERT échoue (invitation réservée manager/gestionnaire/staff)

Scénario : commercial_update_profil_collegue_refuse (users_commercial_update_collegue_denied — F4 lot ⑪)
  Quand `commercial1_kaspia` exécute UPDATE sur le profil de commercial2_kaspia
  Alors 0 ligne est affectée (SELECT org-wide F4 n'ouvre pas l'UPDATE — self only)

Scénario : ops_ecriture_parametres_refusee (ops_admin_only_writes_denied — F2 lot ⑪)
  Quand `ops1` exécute UPDATE sur `parametres_algo`, `parametres_taux_recyclage`, `tarifs_zero_dechet`, `grilles_tarifaires_zd`, `tarifs_packs_ag`
  Alors chaque UPDATE affecte 0 ligne (écriture Paramètres §9 = admin_savr only)

Scénario : ops_config_auto_accept_invisible (test_m09bis_config_auto_accept_ag_ops_deny)
  Quand `ops1` exécute SELECT sur `config_auto_accept_ag`
  Alors 0 ligne est retournée (table admin-only, hors surface staff lecture — exception explicite A9bis)

Scénario : delete_collecte_non_brouillon_refuse (test_collectes_delete_brouillon_only)
  Étant donné une collecte Kaspia au statut `programmee`
  Quand `manager_kaspia` exécute DELETE sur cette collecte
  Alors 0 ligne est affectée (DELETE limité statut brouillon — F5 lot ④ ; l'annulation passe par le statut `annulee`)

Scénario : tarifs_negocie_invisible_beneficiaire
  Étant donné une remise scope='organisation' au bénéfice de Kaspia
  Quand `manager_kaspia` exécute SELECT sur `tarifs_negocie`
  Alors 0 ligne est retournée (restitution uniquement via factures_collectes.tarif_detail figé)
  # Priorité : P2-important
```

---

## Catégorie 4 — Isolation données (RLS)

```gherkin
# Source : §09 §3ter Bloc D (liste canonique) + A1–A10 + C1
# Couche : db | Priorité : P1-critique (les 2 premiers = bloquants go-live)

Scénario : fichiers_cross_org_photo_denied ← BLOQUANT go-live
  Étant donné une photo de pesée (entity_type='plateforme.collectes') d'une collecte Kardamome
  Quand `agence_d` exécute SELECT sur `shared.fichiers`
  Alors la ligne n'est pas retournée (f_fichier_visible = false)

Scénario : fichiers_own_bordereau_ok ← BLOQUANT go-live
  Étant donné un bordereau PDF (entity_type='plateforme.bordereaux_savr') d'une collecte Kaspia
  Quand `manager_kaspia` exécute SELECT sur `shared.fichiers`
  Alors la ligne est retournée

Scénario : fichiers_entity_type_inconnu_deny_par_defaut
  Étant donné une ligne `shared.fichiers` avec entity_type='plateforme.table_inexistante'
  Quand n'importe quel rôle client exécute SELECT
  Alors la ligne n'est jamais retournée (ELSE false — fail-safe)

Scénario : org_lieux_cross_org_denied + org_lieux_self_select_ok
  Étant donné des lignes organisations_lieux pour Viparis et pour un autre gestionnaire
  Quand `gest_viparis` exécute SELECT sur `organisations_lieux`
  Alors seules ses propres lignes sont retournées (policy org_lieux_self_select — A1, anti-bug sous-requêtes)

Scénario : factures_collectes_cross_org_denied
  Étant donné des lignes de facture Kardamome (tarif_detail = remises négociées)
  Quand `manager_kaspia` exécute SELECT sur `factures_collectes`
  Alors 0 ligne Kardamome n'est retournée (A4 — anti-fuite remises)

Scénario : collecte_flux_cross_org_denied
  Quand `commercial1_kaspia` exécute SELECT sur `collecte_flux` d'une collecte Kardamome
  Alors 0 ligne est retournée

Scénario : attributions_ag_cross_org_denied
  Quand `agence_d` exécute SELECT sur `attributions_antgaspi` d'une collecte Kardamome
  Alors 0 ligne est retournée

Scénario : rapports_rse_cross_org_denied
  Quand `manager_kaspia` exécute SELECT sur `rapports_rse` d'un événement Kardamome
  Alors 0 ligne est retournée

Scénario : tournee_siblings_not_exposed (multi-camions)
  Étant donné une tournée mutualisée portant 1 collecte Kaspia + 1 collecte Kardamome (collecte_tournees)
  Quand `manager_kaspia` exécute SELECT sur `collecte_tournees` puis `tournees`
  Alors il voit sa liaison et la tournée, mais jamais la ligne de liaison de la collecte Kardamome

Scénario : users_cross_org_denied_tous_roles
  Quand `manager_kaspia`, `commercial1_kaspia` (F4 lot ⑪) et `gest_viparis` exécutent SELECT sur `users` de Kardamome
  Alors 0 ligne est retournée pour chacun (org-wide ≠ cross-org)

Scénario : packs_cross_org_denied
  Quand `manager_kaspia` exécute SELECT sur `packs_antgaspi` de Kardamome
  Alors 0 ligne est retournée

Scénario : emails_envoyes_pii_deny_clients
  Quand `manager_kaspia` exécute SELECT sur `emails_envoyes` (PII destinataire_email)
  Alors 0 ligne est retournée (lecture admin_savr seul — A2bis)

Scénario : exports_registre_self_only
  Étant donné un export généré par `gest_viparis` et un export généré par `manager_kaspia`
  Quand `manager_kaspia` exécute SELECT sur `exports_registre`
  Alors il ne voit que son propre export (user_id = auth.uid()) ; `ops1` voit les deux

Scénario : fichiers_facture_gestionnaire_scinde (fichiers_facture_gestionnaire_self_ok + fichiers_facture_traiteur_sur_lieu_denied — F6 lot ⑤)
  Étant donné un PDF de facture Viparis et un PDF de facture Kaspia pour une collecte tenue sur le lieu L1 de Viparis
  Quand `gest_viparis` exécute SELECT sur `shared.fichiers` (entity_type='plateforme.factures')
  Alors SA facture est visible et la facture Kaspia ne l'est pas (visibilité lieu ≠ visibilité facture)
```

---

## Catégorie 5 — Idempotence et états

```gherkin
# Source : §04 audit_log + history + sequences_facturation + outbox/inbox + §09 A2/A3 + C1 deleted_at + §3 factures
# Couche : db | Priorité : P1-critique sauf mention

Scénario : audit_log_append_only_meme_pour_admin
  Étant donné une entrée audit_log existante
  Quand `val` (admin_savr) exécute UPDATE puis DELETE sur cette entrée
  Alors les deux opérations affectent 0 ligne (immuable — aucune policy UPDATE/DELETE)

Scénario : audit_log_insert_api_refuse
  Quand `val` (admin_savr) exécute INSERT direct sur `audit_log` sous `authenticated`
  Alors l'INSERT échoue (écriture trigger DB / SERVICE_ROLE uniquement)

Scénario : history_tables_immuables
  Étant donné `parametres_taux_recyclage_history` (et pattern identique facteurs CO₂ history)
  Quand `val` (admin_savr) exécute INSERT direct, puis UPDATE d'une ligne existante
  Alors les deux échouent ; et un UPDATE légitime de `parametres_taux_recyclage` insère bien 1 ligne history via trigger

Scénario : outbox_denied_all_app_roles
  Quand `manager_kaspia` puis `ops1` exécutent SELECT/INSERT/UPDATE sur `outbox_events`
  Alors tout échoue ou retourne 0 ligne, sauf SELECT admin_savr (debug — A2)

Scénario : inbox_write_denied_app (inbox_write_denied_app)
  Quand `ops1` exécute INSERT sur `integrations_inbox`
  Alors l'INSERT échoue (SERVICE_ROLE only — la dédup ne doit jamais être falsifiable côté app)

Scénario : sequences_facturation_service_role_only
  Quand `val` (admin_savr) exécute UPDATE sur `sequences_facturation.dernier_numero` sous `authenticated`
  Alors l'UPDATE affecte 0 ligne (écriture = fonction de validation SERVICE_ROLE ; lecture admin OK — gapless non falsifiable)

Scénario : factures_delete_refuse_tous_roles
  Quand `val` (admin_savr) puis `manager_kaspia` exécutent DELETE sur une facture émise
  Alors 0 ligne affectée pour les deux (pas de policy DELETE — correction = avoir uniquement)

Scénario : fichiers_soft_deleted_invisibles
  Étant donné une ligne `shared.fichiers` avec deleted_at NOT NULL appartenant à Kaspia
  Quand `manager_kaspia` exécute SELECT sur `shared.fichiers`
  Alors la ligne n'est pas retournée (prédicat deleted_at IS NULL dans la policy)

Scénario : users_soft_deleted_invisibles_clients
  Étant donné un user Kaspia anonymisé (deleted_at NOT NULL) via fn_anonymize_user
  Quand `manager_kaspia` exécute SELECT sur `users` de son organisation
  Alors la ligne anonymisée n'est pas retournée (prédicat deleted_at IS NULL)
  Et `val` (admin_savr) la voit toujours (policy usr_admin non gatée)

Scénario : fn_anonymize_user_idempotente
  Étant donné un user déjà anonymisé (deleted_at NOT NULL)
  Quand le SERVICE_ROLE rappelle fn_anonymize_user sur ce même user
  Alors l'appel est un no-op (aucune nouvelle écriture, deleted_at inchangé), et aucune entrée audit_log dupliquée

Scénario : impersonation_journalisee
  Étant donné `val` en session impersonation de `manager_kaspia` (claims role=traiteur_manager, organisation_id=Kaspia, impersonator_id=val)
  Quand il modifie un événement Kaspia
  Alors la RLS appliquée est celle de traiteur_manager (un événement Kardamome reste invisible)
  Et l'entrée audit_log porte user_id=manager_kaspia ET impersonator_id=val
  # Couche : api | Priorité : P2-important

# Source : §04 demandes_suppression (RGPD §15 §3.3) — ajout divergence M0.4 R7 2026-06-25

Scénario : demande_suppression_self_insert_select
  Étant donné `manager_kaspia` connecté
  Quand il INSERT une demande de suppression le concernant puis SELECT
  Alors l'INSERT réussit et il voit sa propre demande (statut en_attente)

Scénario : demande_suppression_cloisonnee_cross_user
  Étant donné une demande de suppression de `manager_kaspia`
  Quand `commercial1_kaspia` (même org) puis `manager_kardamome` exécutent SELECT
  Alors aucun ne voit la demande (self SELECT only — pas org-wide)

Scénario : demande_suppression_statut_non_falsifiable_client
  Quand `manager_kaspia` exécute UPDATE statut='validee' sur sa propre demande sous `authenticated`
  Alors l'UPDATE affecte 0 ligne (pilotage statut = admin_savr / SERVICE_ROLE only)
```

---

## Catégorie 6 — Scénarios cross-app (réduite — justifiée)

> **Justification** : le schéma `tms.*` n'existe pas en V1 (§3ter — V1 = Plateforme seule + MTS-1 par polling, aucun endpoint entrant). Les pgTAP cross-schema de l'addendum 2026-04-23/28 (`prestataires_plateforme_write_denied`, `lieux_tms_write_only_2_logistic_cols`, `lieux_admin_only_fields_hidden_from_tms`…) sont **différés à la V2/TMS natif** — ils restent listés §09 comme dette contractuelle. Ce qui est testable V1 :

```gherkin
# Source : §09 addendum app_domain + A2/A3 + §3 collecte_tournees
# Couche : db | Priorité : P1-critique sauf mention

Scénario : service_role_bypasse_rls_ecritures_systeme
  Quand le SERVICE_ROLE (adapter MTS-1 / webhook tournee-upsert) exécute INSERT sur `collecte_tournees`, `outbox_events`, `integrations_inbox`, `emails_envoyes`
  Alors chaque INSERT réussit (bypass RLS) — alors que les mêmes INSERT sous `authenticated` échouent tous

Scénario : claim_app_domain_present_des_v1
  Étant donné un user Plateforme fraîchement créé
  Quand son JWT est généré au login
  Alors le claim `app_domain='plateforme'` est présent (préparation cloisonnement V2, addendum 2026-04-23)
  # Couche : api | Priorité : P2-important

Scénario : ecriture_collecte_tournees_refusee_roles_app
  Quand `val` (admin_savr) exécute INSERT direct sur `collecte_tournees` sous `authenticated`
  Alors l'INSERT échoue (écriture réservée système — la composition des tournées vient du TMS/MTS-1, jamais de l'app)

Scénario : shared_fichiers_seul_pont_inter_schemas_v1
  Quand on liste les policies des schémas `plateforme.*` et `shared.*`
  Alors aucune policy ne référence un objet `tms.*` (le pont V1 se limite à `shared.fichiers` + `shared.prestataires` en lecture staff)
  # Priorité : P3-nominal (test structurel pg_policies)
```

---

## Catégorie 7 — Scénarios de migration

> Référence : `13 - Migration depuis Bubble.md` + checks de réconciliation. Env dev, dataset `seed_demo`.

```gherkin
# Source : §13 + §09 (rôles, claims, anonymisation)
# Couche : db | Priorité : P1-critique sauf mention

Scénario : migration_lieu_independant_vers_gestionnaire
  Étant donné une org Bubble typée « lieu indépendant » migrée
  Quand on inspecte la ligne `organisations` + `users` + `organisations_lieux`
  Alors le rôle est `gestionnaire_lieux` avec exactement 1 ligne organisations_lieux, et sa RLS fonctionne (voit ses événements, pas ceux d'un autre lieu)

Scénario : migration_claims_jwt_enrichis_premier_login
  Étant donné un user migré de Bubble
  Quand il se connecte pour la première fois
  Alors son JWT porte role + organisation_id + organisation_type + app_domain corrects (trigger custom)
  # Couche : api

Scénario : migration_echantillon_cross_org
  Étant donné l'historique complet migré (collectes, factures, fichiers)
  Quand on rejoue, pour un échantillon de 20 collectes réparties sur ≥ 5 organisations, le SELECT sous le rôle de chaque org propriétaire et sous un rôle tiers
  Alors chaque propriétaire voit 100 % de son échantillon et chaque tiers en voit 0 %

Scénario : migration_anonymisation_preserve_fk
  Étant donné un user anonymisé via fn_anonymize_user (RGPD pré-migration ou post)
  Quand on inspecte ses collectes et factures historiques
  Alors les FK created_by pointent vers la ligne anonymisée (email anonymized+id@gosavr.io), les données business sont intactes, et l'entrée audit_log de l'anonymisation existe

Scénario : migration_policies_idempotentes
  Quand on rejoue 2 fois l'intégralité des migrations de policies (CREATE POLICY IF NOT EXISTS / drop-create)
  Alors le 2e passage ne crée ni doublon ni erreur, et pg_policies retourne exactement le même état
  # Priorité : P2-important
```

---

## Scénarios hors scope (à générer en V1.1)

- **Couverture 100 % des policies** (1 allow + 1 deny par policy de chaque table de référentiel) — promue V1.1 (sobriété 2026-06-03 B2). Ce fichier couvre le périmètre critique V1.
- **pgTAP cross-schema TMS↔Plateforme** (addendum 2026-04-23/28 : `shared.prestataires` write deny, `plateforme.lieux` 2 colonnes logistiques, 4 colonnes cachées TMS) — différés à la création du schéma `tms.*` (V2/TMS natif). Listés §09 comme dette contractuelle.
- **Benchmark RLS 100k rows** (`audit_log` p95 < 200 ms) — objectif de design V1, seuil bloquant V1.1 (sobriété 2026-06-03 A2).
- **Restriction colonne ops sur `attributions_antgaspi`** (ops limité à poids_repas_kg + volume_repas_realise) — contrôle **applicatif** V1 (décision F1 lot ⑧), non testable en pgTAP DB ; test Vitest API à écrire avec le module §06.09.
- **MFA / 2FA** — V2.

## Recommandations loggées (non bloquantes — à confirmer)

- **Reco A** : l'exemple de JWT §09 §4 n'inclut pas `app_domain` ni `impersonator_id` alors que les deux claims sont spécifiés ailleurs — mettre à jour l'exemple (doc stale, zéro impact spec).

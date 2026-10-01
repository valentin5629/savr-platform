-- =============================================================================
-- evenements : SELECT en liste blanche colonne-level (arbitrages Val C1-C5, 2026-10-01)
-- =============================================================================
-- Constat (reviewer-rls-securite, 2026-10-01, revue de la colonne « Client » des
-- listes Collectes ; re-mesuré le même jour sous rôle authenticated + claims
-- gestionnaire_lieux) : `authenticated` porte le SELECT TABLE-LEVEL sur
-- plateforme.evenements (blanket grant 0.4a, 20260611180000 l.27 — seule l'écriture
-- a été retirée, 20260915190000). Les policies evt_*_select filtrent les LIGNES,
-- jamais les colonnes : tout rôle client qui voit un événement en lit donc les 21
-- colonnes par PostgREST direct. Mesuré sur la base locale de développement (jeu de
-- démonstration) : sur 7 événements de traiteurs TIERS tenus sur son lieu
-- (evt_gestionnaire_select), un gestionnaire lit 7/7
-- `contact_principal_nom`, `contact_principal_telephone`, `entite_facturation_id` ;
-- `notes_internes`, `reference_affaire`, `contact_secours_*` sont interrogeables
-- sans refus. Même constat, par construction, pour le client organisateur
-- (evt_client_orga_select) et le traiteur opérationnel d'un événement programmé
-- par un tiers (evt_manager_select / evt_commercial_select).
--
-- §06.05 : le gestionnaire ne voit pas « les données commerciales/personnelles des
-- traiteurs au-delà du nom/logo ». §04 : `notes_internes` = « Notes Admin Savr
-- uniquement ».
--
-- Un privilège colonne ne distingue pas les rôles métier (tous portent le rôle PG
-- `authenticated`) et ne sait pas exprimer « l'organisation qui a programmé ». Ce
-- que le CDC conditionne passe donc par la route (service_role, après la lecture
-- RLS qui prouve la visibilité), jamais par le privilège. Même pattern que
-- tournees (20260930160000), organisations (20260918100000), lieux
-- (20260617170000) : on retire le privilège TABLE-LEVEL puis on re-GRANT une liste
-- blanche. Un REVOKE colonne seul serait INOPÉRANT tant que le privilège table
-- subsiste. Fail-closed : une colonne ajoutée demain n'est pas lisible par
-- authenticated, PARCE QUE le privilège table-level n'existe plus (un ADD COLUMN
-- n'hérite d'aucun grant colonne ; mesuré, et épinglé par les assertions 1, 42 et
-- 43 du test). Ce qui rouvrirait tout : un `GRANT SELECT ON plateforme.evenements`
-- ou un `GRANT … ON ALL TABLES IN SCHEMA plateforme TO authenticated` comme celui
-- de 0.4a. La liste est épinglée à l'identique par
-- SECU__evenements_select_liste_blanche.test.sql.
--
-- LISTE BLANCHE (14 colonnes) :
--   - clés lues par les policies d'AUTRES tables et par 3 vues security_invoker,
--     donc avec les privilèges de l'appelant — les fermer casserait la RLS :
--     id, organisation_id, traiteur_operationnel_organisation_id,
--     client_organisateur_organisation_id, lieu_id, created_by, date_evenement
--     (collectes : col_insert / col_update_* / col_delete_brouillon ; lieux :
--     lieux_clients_select ; bordereaux_savr, attestations_don : *_select ;
--     attributions_antgaspi : aa_select ; vues v_kpi_lieu, v_kpi_traiteur,
--     v_kpi_client_organisateur) ;
--   - ce que les listes, dashboards, exports et le registre affichent à tous les
--     rôles clients : nom_evenement, type_evenement_id, pax,
--     nom_client_organisateur, logo_client_organisateur_url (§06.05 : le
--     gestionnaire voit « les clients finaux si renseignés par le traiteur ») ;
--   - created_at, updated_at : dates techniques, sans lecture sous identité
--     utilisateur aujourd'hui, laissées ouvertes comme sur tournees (arbitrage C4).
--
-- COLONNES RETIRÉES à authenticated (7 — lues en service_role uniquement) :
--   - contact_principal_nom, contact_principal_telephone, contact_secours_nom,
--     contact_secours_telephone : nom + téléphone d'une personne physique. Servis
--     par la route de la fiche collecte (lib/collectes/fiche-client.ts) au
--     traiteur et à l'agence ; au gestionnaire sur ses SEULES programmations
--     (arbitrages C2 = masqué sur les événements de traiteurs tiers, C5).
--   - reference_affaire : référence interne du programmateur (« numéro d'affaire »,
--     §04). Servie par la même route à l'organisation programmatrice seule
--     (arbitrage C3) — elle n'alimente que le formulaire d'édition.
--   - notes_internes, entite_facturation_id : fermées à tous les rôles clients
--     (arbitrage C1). Aucune lecture sous authenticated ; côté routes, un chemin
--     les rendait encore au programmateur — la réponse du PATCH
--     programmation/evenements/[id], qui renvoyait la ligne entière produite par
--     fn_modifier_evenement (relevé par reviewer-rls-securite). Réduite dans le
--     même lot à l'id et aux champs éditables.
--
-- LECTEURS RECENSÉS (2026-10-01 : tous les `.from('evenements')` et embeds
-- `evenements(...)` de packages/ ; catalogue sur base rejouée depuis main) :
--   - Un seul lecteur authenticated des 7 colonnes retirées : la fiche collecte
--     (5 colonnes), basculée en service_role dans le même lot.
--   - Vues : v_kpi_lieu, v_kpi_traiteur, v_kpi_client_organisateur
--     (security_invoker) ne lisent que des colonnes de la liste blanche ;
--     v_registre_dechets tourne avec les droits de son propriétaire.
--   - Fonctions SECURITY INVOKER lisant evenements : fn_set_volume_estime_repas
--     (pax), fn_trg_bordereau_gate_shadow_siret (id, organisation_id,
--     traiteur_operationnel_organisation_id) — colonnes conservées ;
--     fn_set_date_evenement n'y fait qu'écrire (déjà hors d'atteinte de
--     authenticated depuis 20260915190000).
--   - Routes admin, programmation, adapters, batchs PDF, facturation,
--     notifications : service_role (privilèges intacts).
--
-- EFFET DE BORD ASSUMÉ : admin_savr / ops_savr portent eux aussi le rôle PG
-- `authenticated`. Par PostgREST direct avec leur JWT, les 7 colonnes retirées leur
-- sont fermées (42501) — même conséquence que tournees (#436) et organisations
-- (#360). Le back-office lit evenements exclusivement en service_role.
--
-- NON DESTRUCTIF : aucune donnée touchée, aucune colonne supprimée ou renommée.
-- FERME un accès (CLAUDE.md §12-2bis) — GO reviewer-rls-securite + pgTAP de preuve.
-- ORDRE DE DÉPLOIEMENT : le code de la fiche (lecture service_role) doit être en
-- ligne AVANT cette migration ; l'inverse ferait répondre 500 à la fiche collecte
-- des trois espaces clients (42501 sur l'embed evenements). Le nouveau code
-- fonctionne avec l'ancien schéma, l'ancien code casse avec le nouveau : avant de
-- pousser, vérifier que le déploiement de ce lot est bien en ligne (dev, puis
-- prod). Un retour arrière du code APRÈS la migration reproduit le 500 — il faut
-- alors rouvrir par le ROLLBACK SQL en fin de fichier. Toute préversion ou branche
-- en vol qui porte l'ancien fiche-client.ts casse contre une base migrée.
-- APRÈS APPLICATION, mesurer sur la base : has_table_privilege('authenticated',
-- 'plateforme.evenements', 'SELECT') = false, 14 colonnes lisibles, et aucun
-- privilège INSERT / UPDATE / DELETE (le commentaire de table ci-dessous suppose
-- la fermeture d'écriture 20260915190000 appliquée).
-- =============================================================================

REVOKE SELECT ON plateforme.evenements FROM authenticated;

GRANT SELECT (
  id,
  organisation_id,
  traiteur_operationnel_organisation_id,
  client_organisateur_organisation_id,
  lieu_id,
  created_by,
  nom_evenement,
  type_evenement_id,
  date_evenement,
  pax,
  nom_client_organisateur,
  logo_client_organisateur_url,
  created_at,
  updated_at
) ON plateforme.evenements TO authenticated;

COMMENT ON COLUMN plateforme.evenements.contact_principal_telephone IS
  'Téléphone du contact terrain principal, joignable le jour J. Hors GRANT SELECT authenticated depuis 20261001103000 (comme contact_principal_nom et contact_secours_*) : servi par la route de la fiche collecte (service_role) au traiteur et à l''agence, et au gestionnaire sur ses seules programmations (§06.05, arbitrage Val C2 2026-10-01).';

COMMENT ON COLUMN plateforme.evenements.reference_affaire IS
  'Référence interne du programmateur (numéro d''affaire), reportée sur la facture. Hors GRANT SELECT authenticated depuis 20261001103000 : servie par la route de la fiche collecte (service_role) à l''organisation programmatrice seule (arbitrage Val C3 2026-10-01).';

COMMENT ON COLUMN plateforme.evenements.notes_internes IS
  'Notes Admin Savr uniquement (§04). Hors GRANT SELECT authenticated depuis 20261001103000 : illisible par PostgREST direct, staff compris. Aucune route servant un rôle client ne doit la rendre (arbitrage Val C1 2026-10-01) — attention aux fonctions qui renvoient la ligne entière (fn_modifier_evenement).';

-- Le commentaire de table posé par 20260915190000 disait « SELECT reste accordé » :
-- vrai au niveau table à l'époque, faux depuis cette migration. On le réécrit
-- plutôt que de laisser le catalogue annoncer un droit qui n'existe plus.
COMMENT ON TABLE plateforme.evenements IS
  'Événement (réception) portant N collectes. Écriture FERMÉE à `authenticated` depuis 2026-09-15 : INSERT, UPDATE et DELETE retirés du GRANT table-level 0.4a, sans re-GRANT — toute écriture passe par les routes API (service_role), seules à émettre l''outbox E2 via fn_modifier_evenement, tracer l''audit_log et appliquer la matrice de rôles §09. Les policies evt_*_insert / evt_*_update / evt_manager_delete sont conservées mais INERTES pour PostgREST direct tant que le privilège n''est pas ré-accordé. Lecture : depuis 20261001103000, `authenticated` n''a plus le SELECT table-level mais une LISTE BLANCHE de 14 colonnes (épinglée par SECU__evenements_select_liste_blanche) ; contacts sur place, référence d''affaire, notes internes et entité de facturation sont hors privilège et servis, quand ils le sont, par les routes (service_role). Toute colonne ajoutée est fermée par défaut.';

-- ROLLBACK (rouvre des accès : décision explicite de Val, CLAUDE.md §12-2bis) :
--   GRANT SELECT ON plateforme.evenements TO authenticated;
--   (le grant colonne-level des 14 colonnes devient alors redondant : le retirer est
--   optionnel et purement cosmétique.)

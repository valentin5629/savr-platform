-- =============================================================================
-- Tests pgTAP — evenements : SELECT en liste blanche colonne-level
-- Migration prouvée : 20261001103000_plateforme_evenements_select_liste_blanche
-- =============================================================================
-- Fuite fermée (reviewer-rls-securite, 2026-10-01) : via les policies evt_*_select,
-- tout rôle client qui voit un événement en lisait par PostgREST direct les 21
-- colonnes — un gestionnaire lisait le nom et le téléphone du contact, et l'entité
-- de facturation, des événements de traiteurs tiers tenus sur son lieu.
--
-- Fixture = le cas mesuré, élargi aux deux autres lecteurs tiers : événement
-- programmé par une AGENCE, exécuté par un TRAITEUR opérationnel, sur le lieu d'un
-- GESTIONNAIRE, pour un CLIENT ORGANISATEUR doté d'un compte ; les 7 colonnes
-- retirées toutes renseignées.
--
-- NON-VACUITÉ (mesurée sur base rejouée SANS la migration, 2026-10-01) : les
-- assertions de fermeture tombent en `not ok` (les SELECT passent). Les contrôles
-- positifs (7, 8, 18, 21, 24, 38, 40) prouvent que chaque refus vient du privilège
-- colonne, pas d'une ligne invisible ni d'une fixture invalide. Les assertions
-- 29-37 prouvent l'inverse : ce qui DOIT rester lisible (policies d'autres tables
-- et vues security_invoker, qui relisent evenements avec les droits de l'appelant)
-- le reste — sondé colonne par colonne le 2026-10-01 : retirer created_by fait
-- rougir 36, pax 33 et 37, et lieu_id / date_evenement / l'un des trois
-- *organisation_id fait tomber 29 (42501 dans lieux_clients_select).
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(43);

-- Helpers ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION test_set_jwt_prod(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'role', 'authenticated',
    'user_role', p_role,
    'organisation_id', p_org_id,
    'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

CREATE OR REPLACE FUNCTION test_as_service_role()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', 'service_role', true);
END $$;

-- Fixture ---------------------------------------------------------------------
-- A = agence programmatrice ; T = traiteur opérationnel ; G = gestionnaire du lieu L ;
-- O = client organisateur ; X = traiteur sans lien (témoin de cloisonnement des lignes).
SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
  ('e7e70001-0000-0000-0000-0000000000e7'::uuid, 'E7 Traiteur', 'E7 Traiteur SAS', 'traiteur', '55570000000001', true),
  ('e7e70002-0000-0000-0000-0000000000e7'::uuid, 'E7 Agence', 'E7 Agence SAS', 'agence', '55570000000002', true),
  ('e7e70003-0000-0000-0000-0000000000e7'::uuid, 'E7 Gest', 'E7 Gest SA', 'gestionnaire_lieux', '55570000000003', true),
  ('e7e70004-0000-0000-0000-0000000000e7'::uuid, 'E7 Tiers', 'E7 Tiers SAS', 'traiteur', '55570000000004', true),
  ('e7e70005-0000-0000-0000-0000000000e7'::uuid, 'E7 Client', 'E7 Client SA', 'client_organisateur', '55570000000005', true);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('e7e7ef02-0000-0000-0000-0000000000e7'::uuid, 'e7e70002-0000-0000-0000-0000000000e7'::uuid,
        'E7 Agence SAS', '55570000000002', '2 rue Agence', '75002', 'Paris');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif) VALUES
  ('e7e70a02-0000-0000-0000-0000000000e7'::uuid, 'e7e70002-0000-0000-0000-0000000000e7'::uuid,
   'prog@e7-agence.test', 'Prog', 'Agence', 'agence', true),
  ('e7e70a01-0000-0000-0000-0000000000e7'::uuid, 'e7e70001-0000-0000-0000-0000000000e7'::uuid,
   'com@e7-traiteur.test', 'Com', 'Traiteur', 'traiteur_commercial', true);

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('e7e71001-0000-0000-0000-0000000000e7'::uuid, 'E7 Lieu', '3 rue Lieu', '75003', 'Paris', 'camionnette');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('e7e70003-0000-0000-0000-0000000000e7'::uuid, 'e7e71001-0000-0000-0000-0000000000e7'::uuid);

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('e7e77e01-0000-0000-0000-0000000000e7'::uuid, 'SECU_E7_EVENEMENTS', 'SECU E7 événements', 1, true);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, client_organisateur_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  nom_client_organisateur, contact_principal_nom, contact_principal_telephone,
  contact_secours_nom, contact_secours_telephone, reference_affaire, notes_internes
) VALUES (
  'e7e7e001-0000-0000-0000-0000000000e7'::uuid,
  'e7e70002-0000-0000-0000-0000000000e7'::uuid, 'e7e70001-0000-0000-0000-0000000000e7'::uuid,
  'e7e70005-0000-0000-0000-0000000000e7'::uuid,
  'e7e7ef02-0000-0000-0000-0000000000e7'::uuid, 'e7e70a02-0000-0000-0000-0000000000e7'::uuid,
  'e7e71001-0000-0000-0000-0000000000e7'::uuid, 'e7e77e01-0000-0000-0000-0000000000e7'::uuid,
  'E7 Gala', '2026-09-10', 300,
  'E7 Client final', 'Contact E7', '0600000077',
  'Secours E7', '0611111177', 'AFF-E7-042', 'NOTE ADMIN E7'
);

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, nb_camions_demande)
VALUES ('e7e7c001-0000-0000-0000-0000000000e7'::uuid, 'e7e7e001-0000-0000-0000-0000000000e7'::uuid,
        'zero_dechet', 'cloturee', 'non_envoye', '2026-09-10', '23:00', 1);

-- =============================================================================
-- 1-5 — Privilèges (structure) : table-level retiré, liste blanche exacte
-- =============================================================================
SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.evenements', 'SELECT'),
  '1. authenticated n''a plus le SELECT TABLE-LEVEL sur evenements (sinon un REVOKE colonne serait inopérant)');

SELECT is(
  (SELECT array_agg(attname::text ORDER BY attname)
     FROM pg_attribute
    WHERE attrelid = 'plateforme.evenements'::regclass AND attnum > 0 AND NOT attisdropped
      AND has_column_privilege('authenticated', attrelid, attnum, 'SELECT')),
  ARRAY['client_organisateur_organisation_id', 'created_at', 'created_by', 'date_evenement', 'id',
        'lieu_id', 'logo_client_organisateur_url', 'nom_client_organisateur', 'nom_evenement',
        'organisation_id', 'pax', 'traiteur_operationnel_organisation_id', 'type_evenement_id',
        'updated_at'],
  '2. liste blanche SELECT authenticated EXACTE (14 colonnes : un ajout comme un retrait fait rougir)');

SELECT is(
  (SELECT count(*)::int
     FROM pg_attribute
    WHERE attrelid = 'plateforme.evenements'::regclass AND attnum > 0 AND NOT attisdropped
      AND has_column_privilege('anon', attrelid, attnum, 'SELECT')),
  0,
  '3. anon ne lit aucune colonne de evenements');

SELECT ok(
  has_table_privilege('service_role', 'plateforme.evenements', 'SELECT'),
  '4. service_role garde le SELECT table-level (routes admin, programmation, fiche client, adapters, batchs)');

SELECT ok(
  NOT has_any_column_privilege('authenticated', 'plateforme.evenements', 'INSERT, UPDATE')
  AND NOT has_table_privilege('authenticated', 'plateforme.evenements', 'DELETE'),
  '5. l''écriture reste fermée à authenticated (20260915190000) : aucun privilège ré-accordé au passage');

-- 42-43 (fin de fichier) : colonne ajoutée demain = non lisible (fail-closed).

-- =============================================================================
-- 6 — Non-vacuité : la ligne existe et porte les 7 colonnes retirées renseignées
-- =============================================================================
SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements
    WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7'
      AND contact_principal_nom IS NOT NULL AND contact_principal_telephone IS NOT NULL
      AND contact_secours_nom IS NOT NULL AND contact_secours_telephone IS NOT NULL
      AND reference_affaire IS NOT NULL AND notes_internes IS NOT NULL
      AND entite_facturation_id IS NOT NULL),
  1,
  '6. non-vacuité (superuser) : l''événement existe, les 7 colonnes retirées sont renseignées');

-- =============================================================================
-- 7-17 — gestionnaire_lieux (événement d'un tiers tenu sur son lieu) : le cas mesuré
-- =============================================================================
SELECT test_set_jwt_prod('gestionnaire_lieux', 'e7e70003-0000-0000-0000-0000000000e7'::uuid);

SELECT is(
  (SELECT nom_evenement FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7'),
  'E7 Gala',
  '7. gestionnaire : la ligne reste visible (evt_gestionnaire_select inchangée) — les refus 9-17 portent sur la colonne');

SELECT lives_ok(
  $$ SELECT id, organisation_id, traiteur_operationnel_organisation_id,
            client_organisateur_organisation_id, lieu_id, created_by, nom_evenement,
            type_evenement_id, date_evenement, pax, nom_client_organisateur,
            logo_client_organisateur_url, created_at, updated_at
       FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '8. gestionnaire : les 14 colonnes de la liste blanche se lisent ensemble (listes, dashboards, exports)');

SELECT throws_ok($$ SELECT contact_principal_nom FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '9. gestionnaire : contact_principal_nom illisible (permission denied)');
SELECT throws_ok($$ SELECT contact_principal_telephone FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '10. gestionnaire : contact_principal_telephone illisible');
SELECT throws_ok($$ SELECT contact_secours_nom FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '11. gestionnaire : contact_secours_nom illisible');
SELECT throws_ok($$ SELECT contact_secours_telephone FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '12. gestionnaire : contact_secours_telephone illisible');
SELECT throws_ok($$ SELECT reference_affaire FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '13. gestionnaire : reference_affaire illisible (numéro d''affaire du programmateur)');
SELECT throws_ok($$ SELECT notes_internes FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '14. gestionnaire : notes_internes illisible (notes Admin Savr)');
SELECT throws_ok($$ SELECT entite_facturation_id FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '15. gestionnaire : entite_facturation_id illisible');
SELECT throws_ok($$ SELECT * FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '16. gestionnaire : SELECT * (PostgREST select=*) refusé');
SELECT throws_ok(
  $$ SELECT e.contact_principal_telephone
       FROM plateforme.collectes c JOIN plateforme.evenements e ON e.id = c.evenement_id
      WHERE c.id = 'e7e7c001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '17. gestionnaire : téléphone illisible aussi par l''embed collectes → evenements');

-- =============================================================================
-- 18-20 — traiteur opérationnel (traiteur_manager) d'un événement programmé par un tiers
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_manager', 'e7e70001-0000-0000-0000-0000000000e7'::uuid);

SELECT is(
  (SELECT nom_evenement FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7'),
  'E7 Gala',
  '18. traiteur opérationnel : la ligne reste visible');
SELECT throws_ok($$ SELECT reference_affaire FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '19. traiteur opérationnel : reference_affaire du donneur d''ordre illisible');
SELECT throws_ok($$ SELECT contact_principal_telephone FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '20. traiteur opérationnel : contact illisible en direct (servi par la route de la fiche)');

-- =============================================================================
-- 21-23 — agence programmatrice (propriétaire de l'événement)
-- =============================================================================
SELECT test_set_jwt_prod('agence', 'e7e70002-0000-0000-0000-0000000000e7'::uuid);

SELECT is(
  (SELECT nom_evenement FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7'),
  'E7 Gala',
  '21. agence : la ligne reste visible');
SELECT throws_ok($$ SELECT contact_principal_nom FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '22. agence : contact illisible en direct, même sur son propre événement (servi par la route)');
SELECT throws_ok($$ SELECT notes_internes FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '23. agence : notes_internes illisible');

-- =============================================================================
-- 24-27 — client organisateur (liste seule, pas de fiche collecte : §06.04)
-- =============================================================================
SELECT test_set_jwt_prod('client_organisateur', 'e7e70005-0000-0000-0000-0000000000e7'::uuid);

SELECT is(
  (SELECT nom_evenement FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7'),
  'E7 Gala',
  '24. client organisateur : la ligne reste visible (evt_client_orga_select inchangée)');
SELECT throws_ok($$ SELECT contact_principal_telephone FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '25. client organisateur : contact_principal_telephone illisible');
SELECT throws_ok($$ SELECT reference_affaire FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '26. client organisateur : reference_affaire illisible');
SELECT throws_ok($$ SELECT entite_facturation_id FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '27. client organisateur : entite_facturation_id illisible');

-- =============================================================================
-- 28 — traiteur sans lien : cloisonnement des LIGNES inchangé
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_manager', 'e7e70004-0000-0000-0000-0000000000e7'::uuid);

SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7'),
  0,
  '28. traiteur sans lien : l''événement reste invisible (policies inchangées)');

-- =============================================================================
-- 29-37 — Ce qui relit evenements avec les droits de l'APPELANT continue de tourner
-- =============================================================================
-- Policies d'autres tables (sous-SELECT sur evenements) et vues security_invoker :
-- une colonne qu'elles lisent, sortie de la liste blanche, les ferait lever 42501.
SELECT test_set_jwt_prod('agence', 'e7e70002-0000-0000-0000-0000000000e7'::uuid);

SELECT is(
  (SELECT count(*)::int FROM plateforme.lieux WHERE id = 'e7e71001-0000-0000-0000-0000000000e7'),
  1,
  '29. agence : lit toujours le lieu de son événement (lieux_clients_select → evenements.lieu_id / organisation_id)');

SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.attributions_antgaspi $$,
  '30. agence : aa_select (evenements.organisation_id / traiteur_operationnel_organisation_id) tourne');

SELECT test_set_jwt_prod('gestionnaire_lieux', 'e7e70003-0000-0000-0000-0000000000e7'::uuid);

SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes WHERE id = 'e7e7c001-0000-0000-0000-0000000000e7'),
  1,
  '31. gestionnaire : lit toujours la collecte tenue sur son lieu');

SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.attestations_don $$,
  '32. gestionnaire : att_gestionnaire_select (evenements.lieu_id) tourne');

SELECT lives_ok(
  $$ SELECT * FROM plateforme.v_kpi_lieu LIMIT 1 $$,
  '33. gestionnaire : v_kpi_lieu (security_invoker : id, lieu_id, organisation_id, pax) tourne');

SELECT test_set_jwt_prod('client_organisateur', 'e7e70005-0000-0000-0000-0000000000e7'::uuid);

SELECT lives_ok(
  $$ SELECT * FROM plateforme.v_kpi_client_organisateur LIMIT 1 $$,
  '34. client organisateur : v_kpi_client_organisateur (security_invoker) tourne');

SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.bordereaux_savr $$,
  '35. client organisateur : bord_client_orga_select (evenements.client_organisateur_organisation_id) tourne');

-- col_delete_brouillon lit evenements.created_by sous l'identité du commercial :
-- un DELETE qui ne vise aucune ligne suffit à faire vérifier le privilège colonne.
SELECT test_set_jwt_prod('traiteur_commercial', 'e7e70001-0000-0000-0000-0000000000e7'::uuid,
                         'e7e70a01-0000-0000-0000-0000000000e7'::uuid);

SELECT lives_ok(
  $$ DELETE FROM plateforme.collectes WHERE id = '00000000-0000-0000-0000-0000000000e7' $$,
  '36. traiteur_commercial : col_delete_brouillon (evenements.created_by) tourne — created_by doit rester lisible');

SELECT lives_ok(
  $$ SELECT * FROM plateforme.v_kpi_traiteur LIMIT 1 $$,
  '37. traiteur : v_kpi_traiteur (security_invoker : id, organisation_id, pax) tourne');

-- =============================================================================
-- 38-41 — staff et service_role
-- =============================================================================
SELECT test_set_jwt_prod('admin_savr', NULL);

SELECT is(
  (SELECT nom_evenement FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7'),
  'E7 Gala',
  '38. admin_savr (JWT) : la ligne reste visible');

-- Effet de bord ASSUMÉ et épinglé : le privilège est par rôle PG, admin_savr porte
-- `authenticated`. Le back-office lit evenements en service_role (aucun écran impacté).
SELECT throws_ok($$ SELECT notes_internes FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7' $$,
  '42501', NULL, '39. admin_savr (JWT, PostgREST direct) : notes_internes fermé aussi — le back-office lit en service_role');

SELECT test_as_service_role();
SELECT is(
  (SELECT contact_principal_nom || '|' || contact_principal_telephone || '|' || contact_secours_nom || '|'
          || contact_secours_telephone || '|' || reference_affaire || '|' || notes_internes || '|'
          || entite_facturation_id::text
     FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7'),
  'Contact E7|0600000077|Secours E7|0611111177|AFF-E7-042|NOTE ADMIN E7|e7e7ef02-0000-0000-0000-0000000000e7',
  '40. service_role : lit toujours les 7 colonnes retirées (fiche client, routes admin, adapters)');

SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements WHERE id = 'e7e7e001-0000-0000-0000-0000000000e7'),
  1,
  '41. service_role : la ligne est toujours là (aucune donnée touchée par la migration)');

-- =============================================================================
-- 42-43 — Fail-closed : une colonne ajoutée plus tard n'est pas lisible par défaut
-- =============================================================================
SELECT test_as_superuser();
ALTER TABLE plateforme.evenements ADD COLUMN sonde_e7_fail_closed text;

SELECT ok(
  NOT has_column_privilege('authenticated', 'plateforme.evenements', 'sonde_e7_fail_closed', 'SELECT'),
  '42. fail-closed : une colonne ajoutée à evenements n''est pas lisible par authenticated');
SELECT ok(
  has_column_privilege('service_role', 'plateforme.evenements', 'sonde_e7_fail_closed', 'SELECT'),
  '43. contrôle positif de la sonde : service_role, lui, lit la nouvelle colonne (privilège table-level)');

SELECT * FROM finish();
ROLLBACK;

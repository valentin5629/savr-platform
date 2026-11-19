-- =============================================================================
-- Tests pgTAP — collectes.origine (historique Bubble) et garde des documents
-- Migration prouvée : 20261119120000_plateforme_collectes_origine_historique
-- =============================================================================
-- Décisions Val : C1 (2026-11-15) colonne de marquage ; C3 (2026-11-16) aucun
-- document pour une collecte importée.
--
-- Prouvé ici :
--   1-4   la colonne : défaut 'plateforme', non nulle, bornée à deux valeurs ;
--   5-10  fermée aux clients : ni lecture, ni écriture, sous `authenticated`
--         (client et équipe Savr) comme sous `anon` ;
--   11-17 la garde : aucune ligne de bordereau, d'attestation ou de rapport pour
--         une collecte importée, quel que soit l'appelant (service_role, Admin
--         authentifiée), à l'insertion comme au rattachement ; une collecte de la
--         plateforme reste servie (non-vacuité) ;
--   18-19 la garde parle APRÈS la RLS : un client reçoit 42501, jamais 23514
--         (aucun oracle sur l'origine d'une collecte) ;
--   20    la fonction de déclencheur n'est exécutable par aucun rôle client.
--
-- NON-VACUITÉ (mesurée le 2026-11-19 sur une base neuve, migration retirée
-- dans une transaction annulée) : sans la migration, la fixture échoue et
-- aucune des 20 assertions ne passe ; avec la colonne mais sans les trois
-- déclencheurs, 11, 12, 13, 15 et 16 tombent en `not ok` (14, 17, 18 et 19
-- passent : témoins et refus de la RLS) et 20 échoue (fonction absente).
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(20);

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
    'app_domain', 'plateforme',
    'aal', 'aal2'
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
-- T = traiteur ; un événement, deux collectes ZD réalisées : P (plateforme) et
-- H (importée de l'historique), une collecte AG importée HA, et une association.
SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
  ('0a1a0001-0000-0000-0000-0000000000a1'::uuid, 'OR Traiteur', 'OR Traiteur SAS', 'traiteur', '55660000000001', true),
  ('0a1a0002-0000-0000-0000-0000000000a1'::uuid, 'OR Savr', 'OR Savr SAS', 'agence', '55660000000002', true);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('0a1aef01-0000-0000-0000-0000000000a1'::uuid, '0a1a0001-0000-0000-0000-0000000000a1'::uuid,
        'OR Traiteur SAS', '55660000000001', '1 rue Traiteur', '75001', 'Paris');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif) VALUES
  ('0a1a0a01-0000-0000-0000-0000000000a1'::uuid, '0a1a0001-0000-0000-0000-0000000000a1'::uuid,
   'manager@or-traiteur.test', 'Man', 'Traiteur', 'traiteur_manager', true),
  ('0a1a0a02-0000-0000-0000-0000000000a1'::uuid, '0a1a0002-0000-0000-0000-0000000000a1'::uuid,
   'admin@or-savr.test', 'Ad', 'Min', 'admin_savr', true);

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('0a1a1001-0000-0000-0000-0000000000a1'::uuid, 'OR Lieu', '3 rue Lieu', '75003', 'Paris', 'camionnette');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('0a1a7e01-0000-0000-0000-0000000000a1'::uuid, 'SECU_ORIGINE', 'SECU origine', 1, true);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  '0a1ae001-0000-0000-0000-0000000000a1'::uuid, '0a1a0001-0000-0000-0000-0000000000a1'::uuid,
  '0a1a0001-0000-0000-0000-0000000000a1'::uuid, '0a1aef01-0000-0000-0000-0000000000a1'::uuid,
  '0a1a0a01-0000-0000-0000-0000000000a1'::uuid, '0a1a1001-0000-0000-0000-0000000000a1'::uuid,
  '0a1a7e01-0000-0000-0000-0000000000a1'::uuid, 'OR Gala', '2026-06-10', 200,
  'Contact OR', '0600000066'
);

-- P : créée sans origine (prend le défaut).
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
VALUES ('0a1ac001-0000-0000-0000-0000000000a1'::uuid, '0a1ae001-0000-0000-0000-0000000000a1'::uuid,
        'zero_dechet', 'realisee', 'non_envoye', '2026-06-10', '23:00');

-- H et HA : importées (écrites comme le fait le script d'import, rôle postgres).
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, origine)
VALUES
  ('0a1ac002-0000-0000-0000-0000000000a1'::uuid, '0a1ae001-0000-0000-0000-0000000000a1'::uuid,
   'zero_dechet', 'cloturee', 'non_envoye', '2026-06-10', '23:00', 'migration_bubble'),
  ('0a1ac003-0000-0000-0000-0000000000a1'::uuid, '0a1ae001-0000-0000-0000-0000000000a1'::uuid,
   'anti_gaspi', 'cloturee', 'non_envoye', '2026-06-10', '23:00', 'migration_bubble');

INSERT INTO plateforme.associations (id, nom, adresse, region, ville, contact_email, description_rapport_impact)
VALUES ('0a1aa501-0000-0000-0000-0000000000a1'::uuid, 'OR Asso', '1 rue', 'idf', 'Paris', 'asso@or.test',
        'Association de test pour la garde des documents historiques.');

-- =============================================================================
-- 1-4 — La colonne
-- =============================================================================
SELECT col_not_null('plateforme', 'collectes', 'origine', '1. collectes.origine est non nulle');

SELECT col_default_is('plateforme', 'collectes', 'origine', 'plateforme'::text,
  '2. collectes.origine vaut ''plateforme'' par défaut');

SELECT is(
  (SELECT origine FROM plateforme.collectes WHERE id = '0a1ac001-0000-0000-0000-0000000000a1'),
  'plateforme',
  '3. une collecte créée sans origine porte ''plateforme''');

SELECT throws_ok(
  $$ UPDATE plateforme.collectes SET origine = 'autre' WHERE id = '0a1ac001-0000-0000-0000-0000000000a1' $$,
  '23514', NULL,
  '4. origine bornée à plateforme / migration_bubble (CHECK)');

-- =============================================================================
-- 5-10 — Fermée aux clients
-- =============================================================================
SELECT ok(
  NOT has_column_privilege('authenticated', 'plateforme.collectes', 'origine', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'plateforme.collectes', 'origine', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'plateforme.collectes', 'origine', 'UPDATE'),
  '5. authenticated n''a ni SELECT, ni INSERT, ni UPDATE sur collectes.origine');

SELECT ok(
  NOT has_column_privilege('anon', 'plateforme.collectes', 'origine', 'SELECT')
  AND NOT has_column_privilege('anon', 'plateforme.collectes', 'origine', 'UPDATE'),
  '6. anon n''a aucun droit sur collectes.origine');

SELECT test_set_jwt_prod('traiteur_manager', '0a1a0001-0000-0000-0000-0000000000a1', '0a1a0a01-0000-0000-0000-0000000000a1');

SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes WHERE id = '0a1ac002-0000-0000-0000-0000000000a1'),
  1,
  '7. témoin : le manager traiteur voit la collecte importée (le refus suivant vient du privilège colonne)');

SELECT throws_ok(
  $$ SELECT origine FROM plateforme.collectes WHERE id = '0a1ac002-0000-0000-0000-0000000000a1' $$,
  '42501', NULL,
  '8. un client ne lit pas collectes.origine');

SELECT throws_ok(
  $$ UPDATE plateforme.collectes SET origine = 'plateforme' WHERE id = '0a1ac002-0000-0000-0000-0000000000a1' $$,
  '42501', NULL,
  '9. un client n''écrit pas collectes.origine');

SELECT test_set_jwt_prod('admin_savr', '0a1a0002-0000-0000-0000-0000000000a1', '0a1a0a02-0000-0000-0000-0000000000a1');

SELECT throws_ok(
  $$ SELECT origine FROM plateforme.collectes WHERE id = '0a1ac002-0000-0000-0000-0000000000a1' $$,
  '42501', NULL,
  '10. sous authenticated, l''équipe Savr non plus (lecture en service_role côté serveur)');

-- =============================================================================
-- 11-17 — Garde des documents
-- =============================================================================
SELECT test_as_service_role();

SELECT throws_ok(
  $$ INSERT INTO plateforme.bordereaux_savr (collecte_id) VALUES ('0a1ac002-0000-0000-0000-0000000000a1') $$,
  '23514', NULL,
  '11. service_role : aucun bordereau pour une collecte importée');

SELECT throws_ok(
  $$ INSERT INTO plateforme.rapports_rse (collecte_id, evenement_id, disponible_a)
     VALUES ('0a1ac002-0000-0000-0000-0000000000a1', '0a1ae001-0000-0000-0000-0000000000a1', now()) $$,
  '23514', NULL,
  '12. service_role : aucun rapport pour une collecte importée');

SELECT throws_ok(
  $$ INSERT INTO plateforme.attestations_don (collecte_id, association_id)
     VALUES ('0a1ac003-0000-0000-0000-0000000000a1', '0a1aa501-0000-0000-0000-0000000000a1') $$,
  '23514', NULL,
  '13. service_role : aucune attestation de don pour une collecte importée');

SELECT lives_ok(
  $$ INSERT INTO plateforme.bordereaux_savr (id, collecte_id)
     VALUES ('0a1ab001-0000-0000-0000-0000000000a1', '0a1ac001-0000-0000-0000-0000000000a1') $$,
  '14. non-vacuité : une collecte de la plateforme reçoit son bordereau');

SELECT throws_ok(
  $$ UPDATE plateforme.bordereaux_savr SET collecte_id = '0a1ac002-0000-0000-0000-0000000000a1'
     WHERE id = '0a1ab001-0000-0000-0000-0000000000a1' $$,
  '23514', NULL,
  '15. un document existant ne se rattache pas à une collecte importée');

SELECT test_set_jwt_prod('admin_savr', '0a1a0002-0000-0000-0000-0000000000a1', '0a1a0a02-0000-0000-0000-0000000000a1');

SELECT throws_ok(
  $$ INSERT INTO plateforme.rapports_rse (collecte_id, evenement_id, disponible_a)
     VALUES ('0a1ac002-0000-0000-0000-0000000000a1', '0a1ae001-0000-0000-0000-0000000000a1', now()) $$,
  '23514', NULL,
  '16. Admin authentifiée : aucun rapport pour une collecte importée');

SELECT lives_ok(
  $$ INSERT INTO plateforme.rapports_rse (collecte_id, evenement_id, disponible_a)
     VALUES ('0a1ac001-0000-0000-0000-0000000000a1', '0a1ae001-0000-0000-0000-0000000000a1', now()) $$,
  '17. Admin authentifiée : une collecte de la plateforme reste servie (la garde lit l''origine malgré la colonne fermée)');

-- =============================================================================
-- 18-19 — La garde parle après la RLS (aucun oracle)
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_manager', '0a1a0001-0000-0000-0000-0000000000a1', '0a1a0a01-0000-0000-0000-0000000000a1');

SELECT throws_ok(
  $$ INSERT INTO plateforme.rapports_rse (collecte_id, evenement_id, disponible_a)
     VALUES ('0a1ac002-0000-0000-0000-0000000000a1', '0a1ae001-0000-0000-0000-0000000000a1', now()) $$,
  '42501', NULL,
  '18. client, collecte importée : refus de la RLS (42501), pas de la garde');

SELECT throws_ok(
  $$ INSERT INTO plateforme.bordereaux_savr (collecte_id) VALUES ('0a1ac002-0000-0000-0000-0000000000a1') $$,
  '42501', NULL,
  '19. client, bordereau sur collecte importée : 42501, comme sur toute collecte');

-- =============================================================================
-- 20 — Fonction de déclencheur fermée
-- =============================================================================
SELECT test_as_superuser();

SELECT ok(
  NOT has_function_privilege('authenticated', 'plateforme.fn_trg_document_refuse_collecte_importee()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'plateforme.fn_trg_document_refuse_collecte_importee()', 'EXECUTE'),
  '20. la fonction de déclencheur n''est exécutable ni par authenticated ni par anon');

SELECT * FROM finish();
ROLLBACK;

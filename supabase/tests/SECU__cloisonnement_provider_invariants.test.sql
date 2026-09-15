-- =============================================================================
-- Tests pgTAP — invariants DB du cloisonnement par provider
-- Migration prouvée : 20260915180000_plateforme_cloisonnement_provider_invariants
-- =============================================================================
-- Oracle : le cloisonnement par provider des adapters repose sur deux liens
-- que rien n'imposait en base.
--
--   1. `transporteurs.prestataire_logistique_id` -> un seul `type_tms`. Tant
--      que ce lien n'était qu'un index SIMPLE, deux transporteurs de types
--      différents pouvaient pointer le même prestataire : celui-ci entrait
--      alors dans l'ensemble MTS-1 ET dans l'ensemble Everest, et l'adapter
--      MTS-1 repoussait un id de mission Everest — sans qu'aucun test rougisse.
--
--   2. `tournees.external_ref_commande` -> une seule tournée. Sans index, deux
--      tournées pouvaient porter la même référence : le rapprochement entrant
--      (`findTourneeByOrderId`, `.maybeSingle()`) remontait PGRST116, l'ordre
--      passait pour « sans tournée Savr » et `markInboxDone(traite=true)`
--      consommait la clé d'idempotence définitivement.
--
-- Ce fichier prouve la FERMETURE, pas seulement l'existence des index :
-- chaque violation est REJETÉE (23505), et les NULL restent multiples des deux
-- côtés (la contrainte ne sur-ferme pas).
-- =============================================================================

BEGIN;
SELECT plan(12);

CREATE EXTENSION IF NOT EXISTS pgtap;

-- Fixtures. Codes/UUID improbables pour ne jamais entrer en collision avec le
-- seed. Les colonnes non nullables sont renseignées explicitement : un DEFAULT
-- ajouté plus tard ne doit pas rendre ce fichier dépendant de lui en silence.
INSERT INTO shared.prestataires
  (id, nom, code, type_prestation, mode_integration, statut)
VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'Presta Test Unique A',
   'TEST-UNIQ-A', ARRAY['ag'], 'mts1', 'actif'),
  ('d0000000-0000-0000-0000-0000000000a2', 'Presta Test Unique B',
   'TEST-UNIQ-B', ARRAY['ag'], 'mts1', 'actif');

-- ═══ 1. Un prestataire = un transporteur = un provider ═══════════════════════

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'plateforme'
      AND tablename  = 'transporteurs'
      AND indexname  = 'uniq_transporteur_par_prestataire'
  ),
  'index uniq_transporteur_par_prestataire présent'
);

SELECT ok(
  (SELECT i.indisunique
     FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = 'uniq_transporteur_par_prestataire'),
  'transporteurs : index UNIQUE (un index simple ne fermerait rien)'
);

SELECT ok(
  (SELECT pg_get_expr(i.indpred, i.indrelid) IS NOT NULL
     FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = 'uniq_transporteur_par_prestataire'),
  'transporteurs : index PARTIEL (les transporteurs sans prestataire restent multiples)'
);

INSERT INTO plateforme.transporteurs
  (nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
   contact_nom, contact_email, contact_telephone, prestataire_logistique_id)
VALUES
  ('Strike Test Unique', '900000001', '1 rue du Test', '75001', 'Paris',
   ARRAY['fourgon'], 'mts1', 'Test', 'test-uniq@example.invalid', '+33600000000',
   'd0000000-0000-0000-0000-0000000000a1');

SELECT throws_ok(
  $$INSERT INTO plateforme.transporteurs
      (nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
       contact_nom, contact_email, contact_telephone, prestataire_logistique_id)
    VALUES ('Doublon MTS-1', '900000002', '2 rue du Test', '75001', 'Paris',
            ARRAY['fourgon'], 'mts1', 'Test', 'dup-mts1@example.invalid',
            '+33600000000', 'd0000000-0000-0000-0000-0000000000a1')$$,
  '23505', NULL,
  'second transporteur sur le même prestataire → violation unique'
);

-- Le cas dangereux nommément : c'est CE scénario qui rouvrait la fuite, en
-- faisant entrer le prestataire dans l'ensemble `mts1` ET dans `a_toutes`.
SELECT throws_ok(
  $$INSERT INTO plateforme.transporteurs
      (nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
       contact_nom, contact_email, contact_telephone, prestataire_logistique_id)
    VALUES ('A Toutes Test', '900000003', '3 rue du Test', '75001', 'Paris',
            ARRAY['fourgon'], 'a_toutes', 'Test', 'dup-evr@example.invalid',
            '+33600000000', 'd0000000-0000-0000-0000-0000000000a1')$$,
  '23505', NULL,
  'même prestataire avec un type_tms différent → rejeté (fuite provider fermée)'
);

INSERT INTO plateforme.transporteurs
  (nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
   contact_nom, contact_email, contact_telephone, prestataire_logistique_id)
VALUES
  ('Sans presta 1', '900000004', '4 rue du Test', '75001', 'Paris',
   ARRAY['fourgon'], 'par_mail', 'Test', 'sp1@example.invalid',
   '+33600000000', NULL);

SELECT lives_ok(
  $$INSERT INTO plateforme.transporteurs
      (nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
       contact_nom, contact_email, contact_telephone, prestataire_logistique_id)
    VALUES ('Sans presta 2', '900000005', '5 rue du Test', '75001', 'Paris',
            ARRAY['fourgon'], 'par_telephone', 'Test', 'sp2@example.invalid',
            '+33600000000', NULL)$$,
  'plusieurs transporteurs sans prestataire restent acceptés'
);

-- ═══ 2. Une référence de commande = une tournée ══════════════════════════════

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'plateforme'
      AND tablename  = 'tournees'
      AND indexname  = 'uniq_tournee_par_external_ref'
  ),
  'index uniq_tournee_par_external_ref présent'
);

SELECT ok(
  (SELECT i.indisunique
     FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = 'uniq_tournee_par_external_ref'),
  'tournees : index UNIQUE'
);

SELECT ok(
  (SELECT pg_get_expr(i.indpred, i.indrelid) IS NOT NULL
     FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = 'uniq_tournee_par_external_ref'),
  'tournees : index PARTIEL (une tournée non dispatchée n''a pas de référence)'
);

INSERT INTO plateforme.tournees
  (reference_interne, date_tournee, creneau, prestataire_logistique_id,
   statut, external_ref_commande)
VALUES
  ('TEST-UNIQ-REF-1', CURRENT_DATE + 30, 'nuit',
   'd0000000-0000-0000-0000-0000000000a1', 'planifiee', 'REF-COMMANDE-UNIQ-1');

SELECT throws_ok(
  $$INSERT INTO plateforme.tournees
      (reference_interne, date_tournee, creneau, prestataire_logistique_id,
       statut, external_ref_commande)
    VALUES ('TEST-UNIQ-REF-2', CURRENT_DATE + 30, 'nuit',
            'd0000000-0000-0000-0000-0000000000a1', 'planifiee',
            'REF-COMMANDE-UNIQ-1')$$,
  '23505', NULL,
  'seconde tournée sur la même référence de commande → violation unique'
);

-- Le cas dangereux nommément : la colonne est PARTAGÉE entre providers. Une
-- tournée Everest homonyme d'un customerOrder MTS-1 rendait le rapprochement
-- entrant ambigu (PGRST116 avalé → clé d'idempotence consommée).
SELECT throws_ok(
  $$INSERT INTO plateforme.tournees
      (reference_interne, date_tournee, creneau, prestataire_logistique_id,
       statut, external_ref_commande)
    VALUES ('TEST-UNIQ-REF-3', CURRENT_DATE + 30, 'soir',
            'd0000000-0000-0000-0000-0000000000a2', 'planifiee',
            'REF-COMMANDE-UNIQ-1')$$,
  '23505', NULL,
  'même référence chez un AUTRE prestataire → rejetée (rapprochement entrant non ambigu)'
);

INSERT INTO plateforme.tournees
  (reference_interne, date_tournee, creneau, prestataire_logistique_id,
   statut, external_ref_commande)
VALUES
  ('TEST-UNIQ-REF-NULL-1', CURRENT_DATE + 30, 'nuit',
   'd0000000-0000-0000-0000-0000000000a1', 'planifiee', NULL);

SELECT lives_ok(
  $$INSERT INTO plateforme.tournees
      (reference_interne, date_tournee, creneau, prestataire_logistique_id,
       statut, external_ref_commande)
    VALUES ('TEST-UNIQ-REF-NULL-2', CURRENT_DATE + 30, 'nuit',
            'd0000000-0000-0000-0000-0000000000a1', 'planifiee', NULL)$$,
  'plusieurs tournées sans référence de commande restent acceptées'
);

SELECT * FROM finish();
ROLLBACK;

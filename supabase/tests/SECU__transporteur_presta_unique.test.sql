-- =============================================================================
-- Tests pgTAP — 1 prestataire logistique = AU PLUS 1 transporteur
-- Migration prouvée : 20260915140000_plateforme_transporteurs_presta_unique
-- =============================================================================
-- Oracle : le cloisonnement par provider des adapters repose sur le lien 1:1
-- `transporteurs.prestataire_logistique_id` → un seul `type_tms`. Tant que ce
-- lien n'était qu'un index SIMPLE, deux transporteurs de types différents
-- pouvaient pointer le même prestataire : celui-ci entrait alors dans
-- l'ensemble MTS-1 ET dans l'ensemble Everest, et l'adapter MTS-1 repoussait un
-- id de mission Everest — sans qu'aucun test ne rougisse.
--
-- Ce fichier prouve la FERMETURE, pas seulement l'existence de l'index :
--   1. l'index existe, est UNIQUE et PARTIEL (les transporteurs sans prestataire
--      restent multiples — `par_mail`/`par_telephone`/`autre` n'en ont pas) ;
--   2. le second INSERT sur le même prestataire est REJETÉ — c'est l'assertion
--      qui rougit si l'on remplace l'index unique par un index simple ;
--   3. le cas dangereux nommément : deux `type_tms` différents sur un même
--      prestataire ;
--   4. plusieurs NULL restent acceptés (la contrainte ne sur-ferme pas).
-- =============================================================================

BEGIN;
SELECT plan(6);

-- Fixtures. Codes/UUID improbables pour ne jamais entrer en collision avec le
-- seed. Les colonnes non nullables de `shared.prestataires` et de
-- `plateforme.transporteurs` sont renseignées explicitement : un DEFAULT ajouté
-- plus tard ne doit pas rendre ce fichier silencieusement dépendant de lui.
INSERT INTO shared.prestataires
  (id, nom, code, type_prestation, mode_integration, statut)
VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'Presta Test Unique A',
   'TEST-UNIQ-A', ARRAY['ag'], 'mts1', 'actif');

-- ─── 1-3. Forme de l'index ────────────────────────────────────────────────────
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
     FROM pg_class c
     JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = 'uniq_transporteur_par_prestataire'),
  'index UNIQUE (un index simple ne fermerait rien)'
);

SELECT ok(
  (SELECT pg_get_expr(i.indpred, i.indrelid) IS NOT NULL
     FROM pg_class c
     JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = 'uniq_transporteur_par_prestataire'),
  'index PARTIEL (les transporteurs sans prestataire restent multiples)'
);

-- ─── 4. Un second transporteur sur le MÊME prestataire est rejeté ─────────────
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
  '23505',
  NULL,
  'second transporteur sur le même prestataire → violation unique'
);

-- ─── 5. Le cas dangereux : deux type_tms sur un même prestataire ──────────────
-- C'est CE scénario qui rouvrait la fuite : le prestataire serait entré à la
-- fois dans l'ensemble `mts1` et dans l'ensemble `a_toutes`.
SELECT throws_ok(
  $$INSERT INTO plateforme.transporteurs
      (nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
       contact_nom, contact_email, contact_telephone, prestataire_logistique_id)
    VALUES ('A Toutes Test', '900000003', '3 rue du Test', '75001', 'Paris',
            ARRAY['fourgon'], 'a_toutes', 'Test', 'dup-evr@example.invalid',
            '+33600000000', 'd0000000-0000-0000-0000-0000000000a1')$$,
  '23505',
  NULL,
  'même prestataire avec un type_tms différent → rejeté (fuite provider fermée)'
);

-- ─── 6. La contrainte ne sur-ferme pas : plusieurs NULL restent permis ────────
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

SELECT * FROM finish();
ROLLBACK;

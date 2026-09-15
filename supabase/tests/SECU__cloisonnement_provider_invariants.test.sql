-- =============================================================================
-- Tests pgTAP — invariant DB : 1 reference de commande = AU PLUS 1 tournee
-- Migration prouvee : 20260915210000_plateforme_cloisonnement_provider_invariants
-- =============================================================================
-- Oracle : `tournees.external_ref_commande` est la cle de rapprochement du
-- polling entrant (`findTourneeByOrderId`, `.maybeSingle()`). Sans index, deux
-- tournees pouvaient porter la meme reference : la requete remontait PGRST116,
-- l'ordre passait pour « sans tournee Savr » et `markInboxDone(traite=true)`
-- consommait la cle d'idempotence definitivement.
--
-- L'autre invariant du cloisonnement — « 1 prestataire = au plus 1 transporteur »
-- — est prouve par `SECU__transporteur_presta_unique.test.sql` (#323).
--
-- Ce fichier prouve la FERMETURE, pas seulement l'existence de l'index : chaque
-- violation est REJETEE (23505), y compris le cas dangereux nommement (la meme
-- reference chez un prestataire d'un AUTRE provider), et les NULL restent
-- multiples (la contrainte ne sur-ferme pas).
-- =============================================================================

BEGIN;
SELECT plan(6);

CREATE EXTENSION IF NOT EXISTS pgtap;

-- Fixtures. Codes/UUID improbables pour ne jamais entrer en collision avec le
-- seed. Les colonnes non nullables sont renseignees explicitement : un DEFAULT
-- ajoute plus tard ne doit pas rendre ce fichier dependant de lui en silence.
INSERT INTO shared.prestataires
  (id, nom, code, type_prestation, mode_integration, statut)
VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'Presta Test Unique A',
   'TEST-UNIQ-A', ARRAY['ag'], 'mts1', 'actif'),
  ('d0000000-0000-0000-0000-0000000000a2', 'Presta Test Unique B',
   'TEST-UNIQ-B', ARRAY['ag'], 'mts1', 'actif');

-- ─── 1-3. Forme de l'index ───────────────────────────────────────────────────
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
  'tournees : index UNIQUE (un index simple ne fermerait rien)'
);

SELECT ok(
  (SELECT pg_get_expr(i.indpred, i.indrelid) IS NOT NULL
     FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = 'uniq_tournee_par_external_ref'),
  'tournees : index PARTIEL (une tournée non dispatchée n''a pas de référence)'
);

-- ─── 4. Une seconde tournée sur la même référence est rejetée ────────────────
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

-- ─── 5. Le cas dangereux : la même référence chez un AUTRE prestataire ───────
-- La colonne est PARTAGÉE entre providers. Une tournée Everest homonyme d'un
-- customerOrder MTS-1 rendait le rapprochement entrant ambigu (PGRST116 avalé →
-- clé d'idempotence consommée).
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

-- ─── 6. La contrainte ne sur-ferme pas : plusieurs NULL restent permis ───────
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

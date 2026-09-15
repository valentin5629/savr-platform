-- =============================================================================
-- Tests pgTAP — une référence de commande prestataire = AU PLUS une tournée
-- Migration prouvée : 20260915210000_plateforme_cloisonnement_provider_invariants
-- =============================================================================
-- Repris de la branche `fix/cloisonnement-provider-e2-e3` (PR #320), dont
-- l'index `uniq_tournee_par_external_ref` est conservé — le volet
-- `uniq_transporteur_par_prestataire` du fichier d'origine est déjà couvert par
-- SECU__transporteur_presta_unique.test.sql (#323) et n'est pas redupliqué ici.
--
-- Oracle : `tournees.external_ref_commande` est PARTAGÉE entre providers (MTS-1
-- y stocke son customerOrderId, Everest son mission_id). Le rapprochement
-- entrant du polling (`AdapterMts1.findTourneeByOrderId`) apparie dessus avec un
-- `.maybeSingle()` : sur deux tournées homonymes, PostgREST renvoie PGRST116,
-- l'erreur n'est pas lue, l'ordre passe pour inconnu et `markInboxDone` consomme
-- la clé d'idempotence — l'événement entrant est perdu définitivement.
--
-- Le fichier prouve la FERMETURE, pas seulement l'existence de l'index :
--   1-3. l'index existe, est UNIQUE et PARTIEL ;
--   4.   une seconde tournée sur la même référence est REJETÉE ;
--   5.   le cas dangereux nommément : même référence chez un AUTRE prestataire ;
--   6.   plusieurs tournées SANS référence restent acceptées (non-sur-fermeture).
-- =============================================================================

BEGIN;
SELECT plan(6);

INSERT INTO shared.prestataires
  (id, nom, code, type_prestation, mode_integration, statut)
VALUES
  ('d0000000-0000-0000-0000-0000000000b1', 'Presta Ref Unique A',
   'TEST-REFUNIQ-A', ARRAY['ag'], 'mts1', 'actif'),
  ('d0000000-0000-0000-0000-0000000000b2', 'Presta Ref Unique B',
   'TEST-REFUNIQ-B', ARRAY['ag'], 'everest', 'actif');

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

INSERT INTO plateforme.tournees
  (reference_interne, date_tournee, creneau, prestataire_logistique_id,
   statut, external_ref_commande)
VALUES
  ('TEST-REFUNIQ-1', CURRENT_DATE + 30, 'nuit',
   'd0000000-0000-0000-0000-0000000000b1', 'planifiee', 'REF-COMMANDE-REFUNIQ-1');

SELECT throws_ok(
  $$INSERT INTO plateforme.tournees
      (reference_interne, date_tournee, creneau, prestataire_logistique_id,
       statut, external_ref_commande)
    VALUES ('TEST-REFUNIQ-2', CURRENT_DATE + 30, 'nuit',
            'd0000000-0000-0000-0000-0000000000b1', 'planifiee',
            'REF-COMMANDE-REFUNIQ-1')$$,
  '23505', NULL,
  'seconde tournée sur la même référence de commande → violation unique'
);

-- Le cas dangereux nommément : une tournée Everest homonyme d'un customerOrder
-- MTS-1 rendait le rapprochement entrant ambigu.
SELECT throws_ok(
  $$INSERT INTO plateforme.tournees
      (reference_interne, date_tournee, creneau, prestataire_logistique_id,
       statut, external_ref_commande)
    VALUES ('TEST-REFUNIQ-3', CURRENT_DATE + 30, 'soir',
            'd0000000-0000-0000-0000-0000000000b2', 'planifiee',
            'REF-COMMANDE-REFUNIQ-1')$$,
  '23505', NULL,
  'même référence chez un AUTRE prestataire → rejetée (rapprochement entrant non ambigu)'
);

INSERT INTO plateforme.tournees
  (reference_interne, date_tournee, creneau, prestataire_logistique_id,
   statut, external_ref_commande)
VALUES
  ('TEST-REFUNIQ-NULL-1', CURRENT_DATE + 30, 'nuit',
   'd0000000-0000-0000-0000-0000000000b1', 'planifiee', NULL);

SELECT lives_ok(
  $$INSERT INTO plateforme.tournees
      (reference_interne, date_tournee, creneau, prestataire_logistique_id,
       statut, external_ref_commande)
    VALUES ('TEST-REFUNIQ-NULL-2', CURRENT_DATE + 30, 'nuit',
            'd0000000-0000-0000-0000-0000000000b1', 'planifiee', NULL)$$,
  'plusieurs tournées sans référence de commande restent acceptées'
);

SELECT * FROM finish();
ROLLBACK;

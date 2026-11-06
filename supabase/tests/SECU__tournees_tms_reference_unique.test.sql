-- =============================================================================
-- Tests pgTAP — invariant DB : 1 reference de tournee prestataire = AU PLUS
-- 1 ligne `tournees`
-- Migration prouvee : 20261013210000_plateforme_tournees_tms_reference_unique
-- =============================================================================
-- Oracle : `tournees.tms_reference` est l'identifiant de la tournee chez le
-- prestataire. La reprise d'un envoi refuse de reprendre une tournee qu'une
-- ligne porte deja, par une lecture suivie d'une ecriture : sans index, deux
-- passages simultanes pouvaient ecrire la meme reference sur deux lignes.
--
-- Ce fichier prouve la FERMETURE, pas seulement l'existence de l'index : la
-- seconde ecriture est REJETEE (23505) par INSERT comme par UPDATE (c'est un
-- UPDATE que fait l'adapter), y compris chez un autre prestataire ; et la
-- contrainte ne sur-ferme pas (plusieurs NULL, reference liberee reutilisable,
-- reecriture de la meme valeur sur la meme ligne).
-- =============================================================================

BEGIN;
SELECT plan(11);

CREATE EXTENSION IF NOT EXISTS pgtap;

-- Fixtures. Codes et references improbables pour ne jamais entrer en collision
-- avec le seed. Les colonnes non nullables sont renseignees explicitement.
INSERT INTO shared.prestataires
  (id, nom, code, type_prestation, mode_integration, statut)
VALUES
  ('d1000000-0000-0000-0000-0000000000a1', 'Presta Test Tour Unique A',
   'TEST-TOUR-UNIQ-A', ARRAY['zd'], 'manuel', 'actif'),
  ('d1000000-0000-0000-0000-0000000000a2', 'Presta Test Tour Unique B',
   'TEST-TOUR-UNIQ-B', ARRAY['zd'], 'manuel', 'actif');

-- ─── 1-4. Forme de l'index ───────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'plateforme'
      AND tablename  = 'tournees'
      AND indexname  = 'uniq_tournee_par_tms_reference'
  ),
  'index uniq_tournee_par_tms_reference présent sur plateforme.tournees'
);

SELECT ok(
  (SELECT i.indisunique
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_index i ON i.indexrelid = c.oid
    WHERE n.nspname = 'plateforme'
      AND c.relname = 'uniq_tournee_par_tms_reference'),
  'index UNIQUE (un index simple ne fermerait rien)'
);

SELECT is(
  (SELECT pg_get_expr(i.indpred, i.indrelid)
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_index i ON i.indexrelid = c.oid
    WHERE n.nspname = 'plateforme'
      AND c.relname = 'uniq_tournee_par_tms_reference'),
  '(tms_reference IS NOT NULL)',
  'index PARTIEL, borné aux références renseignées'
);

SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY k.ord)
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_index i ON i.indexrelid = c.oid
     CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE n.nspname = 'plateforme'
      AND c.relname = 'uniq_tournee_par_tms_reference'),
  ARRAY['tms_reference'],
  'index sur la seule colonne tms_reference (tous prestataires confondus)'
);

-- ─── 5. Une seconde ligne sur la même référence est rejetée (INSERT) ─────────
INSERT INTO plateforme.tournees
  (id, reference_interne, date_tournee, creneau, prestataire_logistique_id,
   statut, tms_reference)
VALUES
  ('d1000000-0000-0000-0000-0000000000b1', 'TEST-TOUR-UNIQ-1',
   CURRENT_DATE + 30, 'nuit', 'd1000000-0000-0000-0000-0000000000a1',
   'planifiee', 'REF-TOUR-UNIQ-1'),
  ('d1000000-0000-0000-0000-0000000000b2', 'TEST-TOUR-UNIQ-2',
   CURRENT_DATE + 30, 'nuit', 'd1000000-0000-0000-0000-0000000000a1',
   'planifiee', NULL);

SELECT throws_ok(
  $$INSERT INTO plateforme.tournees
      (reference_interne, date_tournee, creneau, prestataire_logistique_id,
       statut, tms_reference)
    VALUES ('TEST-TOUR-UNIQ-3', CURRENT_DATE + 30, 'nuit',
            'd1000000-0000-0000-0000-0000000000a1', 'planifiee',
            'REF-TOUR-UNIQ-1')$$,
  '23505', NULL,
  'INSERT : seconde ligne sur la même référence de tournée → violation unique'
);

-- ─── 6. L'écriture de l'adapter : UPDATE d'une ligne existante ───────────────
SELECT throws_ok(
  $$UPDATE plateforme.tournees
       SET tms_reference = 'REF-TOUR-UNIQ-1'
     WHERE id = 'd1000000-0000-0000-0000-0000000000b2'$$,
  '23505', NULL,
  'UPDATE : une ligne ne peut pas prendre la référence portée par une autre'
);

-- ─── 7. La même référence chez un AUTRE prestataire ──────────────────────────
SELECT throws_ok(
  $$INSERT INTO plateforme.tournees
      (reference_interne, date_tournee, creneau, prestataire_logistique_id,
       statut, tms_reference)
    VALUES ('TEST-TOUR-UNIQ-4', CURRENT_DATE + 30, 'soir',
            'd1000000-0000-0000-0000-0000000000a2', 'planifiee',
            'REF-TOUR-UNIQ-1')$$,
  '23505', NULL,
  'même référence chez un AUTRE prestataire → rejetée (unicité globale)'
);

-- ─── 8. La contrainte ne sur-ferme pas : plusieurs NULL restent permis ───────
SELECT lives_ok(
  $$INSERT INTO plateforme.tournees
      (reference_interne, date_tournee, creneau, prestataire_logistique_id,
       statut, tms_reference)
    VALUES ('TEST-TOUR-UNIQ-5', CURRENT_DATE + 30, 'nuit',
            'd1000000-0000-0000-0000-0000000000a1', 'planifiee', NULL)$$,
  'plusieurs lignes sans référence de tournée restent acceptées'
);

-- ─── 9. Une référence libérée redevient utilisable ───────────────────────────
-- Un rang refusé puis réattribué voit sa référence remise à NULL.
UPDATE plateforme.tournees
   SET tms_reference = NULL
 WHERE id = 'd1000000-0000-0000-0000-0000000000b1';

SELECT lives_ok(
  $$UPDATE plateforme.tournees
       SET tms_reference = 'REF-TOUR-UNIQ-1'
     WHERE id = 'd1000000-0000-0000-0000-0000000000b2'$$,
  'référence remise à NULL sur une ligne → une autre ligne peut la prendre'
);

-- ─── 10. Réécrire la même valeur sur la même ligne reste permis ─────────────
SELECT lives_ok(
  $$UPDATE plateforme.tournees
       SET tms_reference = 'REF-TOUR-UNIQ-1'
     WHERE id = 'd1000000-0000-0000-0000-0000000000b2'$$,
  'la ligne qui porte la référence peut la réécrire à l''identique'
);

-- ─── 11. Une ligne annulée garde sa référence : elle ferme toujours ──────────
-- L'unicité ne dépend pas du statut de la tournée.
UPDATE plateforme.tournees
   SET statut = 'annulee'
 WHERE id = 'd1000000-0000-0000-0000-0000000000b2';

SELECT throws_ok(
  $$UPDATE plateforme.tournees
       SET tms_reference = 'REF-TOUR-UNIQ-1'
     WHERE id = 'd1000000-0000-0000-0000-0000000000b1'$$,
  '23505', NULL,
  'référence portée par une tournée ANNULÉE → toujours refusée à une autre ligne'
);

SELECT * FROM finish();
ROLLBACK;

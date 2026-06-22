-- pgTAP — Garde anti-récurrence pour l'inscription self-service « nouvelle organisation ».
--
-- Contexte : la route /api/auth/signup (creerNouvelleOrga) insérait dans
-- plateforme.organisations SANS la colonne `nom` (NOT NULL, sans default) → violation
-- de contrainte → TOUTE inscription créant une nouvelle organisation échouait. Le bug
-- est passé car ce chemin n'avait aucune couverture.
--
-- Ce garde prouve, sur la base réelle (rôle postgres → RLS bypass), que :
--   1. l'ancien payload (raison_sociale + type, sans nom) ÉCHOUE (NOT NULL sur nom) ;
--   2. le nouveau payload (nom + raison_sociale + type + telephone) RÉUSSIT.

BEGIN;
SELECT plan(3);

-- Les colonnes écrites par creerNouvelleOrga existent.
SELECT lives_ok(
  $$ SELECT nom, raison_sociale, type, telephone
     FROM plateforme.organisations LIMIT 0 $$,
  'organisations : nom, raison_sociale, type, telephone existent'
);

-- ANCIEN payload (le bug) : insert sans `nom` → NOT NULL violation.
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (raison_sociale, type)
     VALUES ('Traiteur Test SAS', 'traiteur') $$,
  '23502', -- not_null_violation
  NULL,
  'organisations : INSERT sans nom échoue (NOT NULL) — reproduit le bug d''inscription'
);

-- NOUVEAU payload (le fix) : nom = raison_sociale + telephone → réussit.
SELECT lives_ok(
  $$ INSERT INTO plateforme.organisations (nom, raison_sociale, type, telephone)
     VALUES ('Traiteur Test SAS', 'Traiteur Test SAS', 'traiteur', '0102030405') $$,
  'organisations : INSERT avec nom + telephone réussit (payload corrigé de signup)'
);

SELECT * FROM finish();
ROLLBACK;

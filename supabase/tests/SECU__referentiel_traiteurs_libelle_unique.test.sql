-- =============================================================================
-- Tests pgTAP — v_referentiel_traiteurs : un seul libellé, plus de raison sociale
-- Migration : 20260922080000_plateforme_referentiel_traiteurs_libelle_unique.sql
-- =============================================================================
-- Fuite fermée (revue sécurité PR #363) : la vue exposait `raison_sociale` de TOUS
-- les traiteurs actifs non-shadow à TOUT utilisateur connecté — gestionnaire_lieux
-- et client_organisateur compris, sans aucun lien avec ces traiteurs. §06.05 : d'un
-- traiteur tiers, un gestionnaire ne voit rien au-delà du nom et du logo.
--
-- Oracle : la vue ne projette que id + nom (1-3), le libellé retombe sur la raison
-- sociale quand le nom commercial manque, sans jamais l'exposer en colonne (4-5),
-- le périmètre de lignes est inchangé (6-8), et elle reste en lecture seule pour
-- authenticated, fermée à anon et PUBLIC (9-12).
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(12);

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

-- Fixture ---------------------------------------------------------------------
-- N = traiteur avec nom commercial ; B = nom à blancs (organisations.nom est NOT
--     NULL : « pas de nom commercial » ne peut se matérialiser QUE par du vide)
-- H = shadow ; I = inactif ; G = gestionnaire_lieux (non traiteur)
SELECT test_as_superuser();

INSERT INTO plateforme.organisations
  (id, nom, raison_sociale, type, actif, est_shadow, siret, email_principal, cree_par_organisation_id)
VALUES
  ('6e1f0001-0000-0000-0000-0000000000d3'::uuid, 'REF Nom', 'REF Nom SAS', 'traiteur', true, false,
   '66610000000001', 'nom@ref.test', NULL),
  ('6e1f0003-0000-0000-0000-0000000000d3'::uuid, '   ', 'REF Blancs SARL', 'traiteur', true, false,
   '66610000000003', 'blancs@ref.test', NULL),
  ('6e1f0005-0000-0000-0000-0000000000d3'::uuid, 'REF Inactif', 'REF Inactif SAS', 'traiteur', false, false,
   '66610000000005', NULL, NULL),
  ('6e1f0006-0000-0000-0000-0000000000d3'::uuid, 'REF Gest', 'REF Gest SA', 'gestionnaire_lieux', true, false,
   '66610000000006', 'gest@ref.test', NULL);

-- Fiche shadow à part : chk_shadow_needs_creator impose un créateur, donc elle ne
-- peut être insérée qu'après l'organisation qui la référence.
INSERT INTO plateforme.organisations
  (id, nom, raison_sociale, type, actif, est_shadow, siret, email_principal, cree_par_organisation_id)
VALUES
  ('6e1f0004-0000-0000-0000-0000000000d3'::uuid, 'REF Shadow', 'REF Shadow SARL', 'traiteur', true, true,
   NULL, NULL, '6e1f0006-0000-0000-0000-0000000000d3'::uuid);

-- =============================================================================
-- 1-3 — la vue ne projette que id + nom
-- =============================================================================
SELECT is(
  (SELECT array_agg(attname::text ORDER BY attname::text COLLATE "C")
     FROM pg_attribute
    WHERE attrelid = 'plateforme.v_referentiel_traiteurs'::regclass
      AND attnum > 0 AND NOT attisdropped),
  ARRAY['id', 'nom']::text[],
  '1. v_referentiel_traiteurs : colonnes = {id, nom} exactement');

SELECT test_set_jwt_prod('gestionnaire_lieux', '6e1f0006-0000-0000-0000-0000000000d3'::uuid);

SELECT throws_ok(
  $$ SELECT raison_sociale FROM plateforme.v_referentiel_traiteurs $$,
  '42703', NULL, '2. gestionnaire : raison_sociale absente de la vue (column does not exist)');

SELECT throws_ok(
  $$ SELECT siret FROM plateforme.v_referentiel_traiteurs $$,
  '42703', NULL, '3. gestionnaire : siret absent de la vue');

-- =============================================================================
-- 4-5 — libellé unique : nom commercial d'abord, raison sociale en repli
-- =============================================================================
SELECT is(
  (SELECT nom FROM plateforme.v_referentiel_traiteurs
    WHERE id = '6e1f0001-0000-0000-0000-0000000000d3'),
  'REF Nom',
  '4. libellé = nom commercial quand il existe (§06.11 « Traiteur opérationnel : {{nom}} »)');

SELECT is(
  (SELECT nom FROM plateforme.v_referentiel_traiteurs
    WHERE id = '6e1f0003-0000-0000-0000-0000000000d3'),
  'REF Blancs SARL',
  '5. libellé = raison sociale quand le nom commercial n''est que des blancs (aucun écran sans libellé)');

-- =============================================================================
-- 6-8 — périmètre de lignes inchangé
-- =============================================================================
SELECT is(
  (SELECT count(*)::int FROM plateforme.v_referentiel_traiteurs
    WHERE id = '6e1f0004-0000-0000-0000-0000000000d3'),
  0, '6. fiche shadow exclue du référentiel');

SELECT is(
  (SELECT count(*)::int FROM plateforme.v_referentiel_traiteurs
    WHERE id = '6e1f0005-0000-0000-0000-0000000000d3'),
  0, '7. traiteur inactif exclu du référentiel');

SELECT is(
  (SELECT count(*)::int FROM plateforme.v_referentiel_traiteurs
    WHERE id = '6e1f0006-0000-0000-0000-0000000000d3'),
  0, '8. organisation non-traiteur exclue du référentiel');

-- =============================================================================
-- 9-12 — privilèges : lecture seule pour authenticated, rien pour anon/PUBLIC
-- =============================================================================
-- 9. Contrôle positif : un client_organisateur lit bien la vue (elle sert à tous
--     les rôles pour résoudre un libellé, c'est sa raison d'être).
SELECT test_set_jwt_prod('client_organisateur', '6e1f0006-0000-0000-0000-0000000000d3'::uuid);
SELECT is(
  (SELECT nom FROM plateforme.v_referentiel_traiteurs
    WHERE id = '6e1f0001-0000-0000-0000-0000000000d3'),
  'REF Nom',
  '9. client_organisateur : le libellé reste lisible (contrôle positif)');

-- 10. Écriture à travers la vue refusée. On vise `id`, colonne SIMPLE : c'est le
--     PRIVILÈGE qui parle (42501), le garde réel. Sur `nom`, PostgreSQL refuse en
--     amont (0A000 « cannot update column ») car c'est une expression calculée —
--     défense supplémentaire, mais qui ne prouve rien sur les droits.
SELECT throws_ok(
  $$ UPDATE plateforme.v_referentiel_traiteurs SET id = gen_random_uuid()
      WHERE id = '6e1f0001-0000-0000-0000-0000000000d3' $$,
  '42501', NULL, '10. écriture à travers la vue refusée (permission denied)');

SELECT test_as_superuser();

SELECT ok(
  NOT has_table_privilege('anon', 'plateforme.v_referentiel_traiteurs', 'SELECT')
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.oid = 'plateforme.v_referentiel_traiteurs'::regclass AND a.grantee = 0),
  '11. anon et PUBLIC : aucun privilège sur la vue');

SELECT ok(
  has_table_privilege('authenticated', 'plateforme.v_referentiel_traiteurs', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'plateforme.v_referentiel_traiteurs', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'plateforme.v_referentiel_traiteurs', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'plateforme.v_referentiel_traiteurs', 'DELETE'),
  '12. authenticated : SELECT seul sur la vue');

SELECT * FROM finish();
ROLLBACK;

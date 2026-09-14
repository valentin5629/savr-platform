-- =============================================================================
-- Tests pgTAP — Catalogue tarifaire : lecture STAFF ONLY (fermeture d'accès)
-- Migration prouvée : 20260914120000_plateforme_rls_catalogue_tarifaire_staff_only
-- =============================================================================
-- Oracle : aucun rôle client (traiteur, agence, gestionnaire de lieux) ne peut
-- lire `grilles_tarifaires_zd`, `tarifs_zero_dechet` ni `tarifs_packs_ag`,
-- tandis que le staff (admin_savr, ops_savr) lit tout.
-- L'assertion 15 est NON SCOPÉE : elle compte TOUTES les grilles visibles, donc
-- aussi la grille `est_defaut` du seed (les 2 fixtures ci-dessous ne peuvent pas
-- la porter — l'index `uniq_grille_tarifaire_defaut` n'admet qu'une seule grille
-- défaut active). Elle ancre mécaniquement ce que les assertions scopées par id
-- ne disaient que verbalement, et ne peut jamais être vacuous : les 2 fixtures
-- de la transaction garantissent au moins 2 lignes à masquer. Régression visée : `gtz_read`/`tzd_read`/`tpa_read` en
-- `auth.role() = 'authenticated'` laissaient un traiteur A énumérer la grille
-- négociée du traiteur B (divergence SECU-RLS_20260914, arbitrage Val).
--
-- ⚠ Les JWT posés ici sont au format PRODUCTION (claim réservé `role` =
-- 'authenticated' ET claim métier `user_role`). Un helper omettant `role`
-- rendrait l'ANCIENNE policy `auth.role() = 'authenticated'` inerte sous le
-- harnais → le test passerait au vert AVANT le fix (faux positif). C'est
-- exactement ce qui avait masqué la fuite `ct_read` (cf. M0_6__cat_4.test.sql).
-- =============================================================================

BEGIN;
SELECT plan(15);

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
    'role', 'authenticated',          -- claim réservé (auth.role(), PostgREST)
    'user_role', p_role,              -- claim métier (f_app_role() → f_is_staff())
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
-- Une grille publique (défaut) + une grille façonnée pour un seul client — le
-- cas prévu par §04 (`tarifs_negocie` → Migration : « un tarif de base négocié
-- devient une grille dédiée du catalogue affectée à l'organisation »).
SELECT test_as_superuser();

INSERT INTO plateforme.grilles_tarifaires_zd
  (id, nom, mode, est_defaut, actif, valide_du)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'SECU Grille catalogue A', 'paliers', false, true, '2026-01-01'),
  ('22222222-2222-2222-2222-222222222222',
   'SECU Négociée Traiteur B', 'fixe_variable', false, true, '2026-01-01');

INSERT INTO plateforme.tarifs_zero_dechet
  (grille_id, pax_min, pax_max, prix_base_ht, prix_par_couvert_ht)
VALUES
  ('11111111-1111-1111-1111-111111111111', 1, 250, 450.00, 0),
  ('22222222-2222-2222-2222-222222222222', 1, NULL, 120.00, 0.55);

-- NB : colonnes du schéma LIVE (type_pack/credits/prix_unitaire_ht) — le DDL de
-- création bloc5 est périmé (nb_collectes/prix_ht n'existent plus).
INSERT INTO plateforme.tarifs_packs_ag
  (id, type_pack, credits, prix_unitaire_ht, valide_du)
VALUES
  ('33333333-3333-3333-3333-333333333333', 'pack_10', 10, 500.00, '2026-01-01');

-- 1-4. Rôle client traiteur : aucune lecture du catalogue --------------------
SELECT test_set_jwt_prod('traiteur_manager', gen_random_uuid());

SELECT is(
  (SELECT count(*) FROM plateforme.grilles_tarifaires_zd
    WHERE id IN ('11111111-1111-1111-1111-111111111111',
                 '22222222-2222-2222-2222-222222222222'))::int,
  0,
  'traiteur_manager ne lit aucune grille tarifaire');

SELECT is(
  (SELECT count(*) FROM plateforme.grilles_tarifaires_zd
    WHERE nom = 'SECU Négociée Traiteur B')::int,
  0,
  'traiteur_manager ne voit pas la grille négociée d''un autre client (constat B6)');

SELECT is(
  (SELECT count(*) FROM plateforme.tarifs_zero_dechet
    WHERE grille_id IN ('11111111-1111-1111-1111-111111111111',
                        '22222222-2222-2222-2222-222222222222'))::int,
  0,
  'traiteur_manager ne lit aucun palier tarifs_zero_dechet');

SELECT is(
  (SELECT count(*) FROM plateforme.tarifs_packs_ag
    WHERE id = '33333333-3333-3333-3333-333333333333')::int,
  0,
  'traiteur_manager ne lit aucun tarif pack AG');

-- 5-6. Les autres rôles clients sont logés à la même enseigne ---------------
SELECT test_set_jwt_prod('agence', gen_random_uuid());
SELECT is(
  (SELECT count(*) FROM plateforme.grilles_tarifaires_zd
    WHERE nom LIKE 'SECU %')::int,
  0,
  'agence ne lit aucune grille tarifaire');

SELECT test_set_jwt_prod('gestionnaire_lieux', gen_random_uuid());
SELECT is(
  (SELECT count(*) FROM plateforme.grilles_tarifaires_zd
    WHERE nom LIKE 'SECU %')::int,
  0,
  'gestionnaire_lieux ne lit aucune grille tarifaire');

-- 7-10. Staff : lecture intégrale (prouve la NON-VACUITÉ des comptes à 0) ----
SELECT test_set_jwt_prod('admin_savr');
SELECT is(
  (SELECT count(*) FROM plateforme.grilles_tarifaires_zd
    WHERE nom LIKE 'SECU %')::int,
  2,
  'admin_savr lit les 2 grilles (non-vacuité : les lignes existent bien)');

SELECT is(
  (SELECT count(*) FROM plateforme.tarifs_zero_dechet
    WHERE grille_id IN ('11111111-1111-1111-1111-111111111111',
                        '22222222-2222-2222-2222-222222222222'))::int,
  2,
  'admin_savr lit les paliers (non-vacuité)');

SELECT is(
  (SELECT count(*) FROM plateforme.tarifs_packs_ag
    WHERE id = '33333333-3333-3333-3333-333333333333')::int,
  1,
  'admin_savr lit les tarifs packs AG (non-vacuité)');

SELECT test_set_jwt_prod('ops_savr');
SELECT is(
  (SELECT count(*) FROM plateforme.grilles_tarifaires_zd
    WHERE nom LIKE 'SECU %')::int,
  2,
  'ops_savr lit les grilles (staff = lecture, §09 A5 révisé)');

-- 11. Non-régression : l'écriture reste admin_savr only (§09 A5, scénario
--     Gherkin ops_ecriture_parametres_refusee) — ops LIT mais n'ÉCRIT pas.
UPDATE plateforme.grilles_tarifaires_zd
   SET nom = 'SECU Piratée par ops'
 WHERE id = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT count(*) FROM plateforme.grilles_tarifaires_zd
    WHERE nom = 'SECU Piratée par ops')::int,
  0,
  'ops_savr ne peut pas modifier une grille (écriture admin_savr only)');

-- 12-14. Cliquet sur le prédicat : plus jamais d'ouverture par auth.role() ---
SELECT test_as_superuser();

SELECT matches(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'plateforme' AND tablename = 'grilles_tarifaires_zd'
      AND policyname = 'gtz_read'),
  'f_is_staff',
  'gtz_read utilise f_is_staff() (claim user_role post-fix 20260617180000)');

SELECT unalike(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'plateforme' AND tablename = 'tarifs_zero_dechet'
      AND policyname = 'tzd_read'),
  '%authenticated%',
  'tzd_read ne se rouvre pas à tout authentifié');

SELECT unalike(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'plateforme' AND tablename = 'tarifs_packs_ag'
      AND policyname = 'tpa_read'),
  '%authenticated%',
  'tpa_read ne se rouvre pas à tout authentifié');

-- 15. Cliquet le plus large : pas la moindre grille visible, seed compris ------
-- (rouge avant le fix comme les autres assertions de fermeture ; c'est la seule
-- qui couvrirait une réouverture limitée à la seule grille par défaut.)
SELECT test_set_jwt_prod('traiteur_manager', gen_random_uuid());
SELECT is(
  (SELECT count(*) FROM plateforme.grilles_tarifaires_zd)::int,
  0,
  'traiteur_manager ne voit AUCUNE grille, y compris la grille est_defaut du seed');

SELECT finish();
ROLLBACK;

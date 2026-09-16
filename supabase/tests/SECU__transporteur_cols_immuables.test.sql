-- =============================================================================
-- Tests pgTAP — transporteurs : type_tms et prestataire_logistique_id immuables,
-- DELETE refusé sous tournées
-- Migration prouvée : 20260916150000_plateforme_transporteurs_cols_immuables
-- =============================================================================
-- Oracle : arbitrage Val 2026-09-16 (04 - Data Model table `transporteurs` ;
-- 06.06 §6 encadré « Immuabilité » ; scénario
-- `transporteur_lien_prestataire_obligatoire_et_immuable`) :
--   - les deux colonnes sont posées à la création et JAMAIS modifiables, quel
--     que soit le rôle et le chemin — prouvé en superuser (chemin SQL) ET sous
--     `authenticated` admin_savr / ops_savr (chemin PostgREST) ;
--   - NULL → valeur est une modification comme une autre (pas de rattachement
--     tardif) ;
--   - `actif = false` reste LIBRE, ainsi que les autres colonnes et la
--     réécriture de la même valeur (upsert des seeds) ;
--   - DELETE refusé dès qu'une tournée porte le prestataire du transporteur,
--     accepté sinon.
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(24);

CREATE OR REPLACE FUNCTION test_set_jwt(p_role text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'user_role', p_role, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ── Fixtures (UUID/SIREN improbables) ────────────────────────────────────────
INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, statut)
VALUES
  ('1a000000-0000-0000-0000-0000000000a1', 'Presta Immuable A', 'TEST-IMMU-A', ARRAY['ag'], 'mts1', 'actif'),
  ('1a000000-0000-0000-0000-0000000000a2', 'Presta Immuable B', 'TEST-IMMU-B', ARRAY['ag'], 'mts1', 'actif'),
  ('1a000000-0000-0000-0000-0000000000a3', 'Presta Immuable C', 'TEST-IMMU-C', ARRAY['ag'], 'everest', 'actif');

INSERT INTO plateforme.transporteurs
  (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
   code_transporteur_mts1, contact_nom, contact_email, contact_telephone,
   prestataire_logistique_id)
VALUES
  -- T1 : mts1 lié à A, référencé par une tournée
  ('1a000000-0000-0000-0000-000000000001', 'Immuable MTS1', '910000001', '1 rue T', '75001', 'Paris',
   ARRAY['fourgon'], 'mts1', 'IMMU-MTS1', 'T', 'immu1@example.invalid', '+33600000001',
   '1a000000-0000-0000-0000-0000000000a1'),
  -- T2 : par_mail sans prestataire
  ('1a000000-0000-0000-0000-000000000002', 'Immuable Mail', '910000002', '2 rue T', '75001', 'Paris',
   ARRAY['fourgon'], 'par_mail', NULL, 'T', 'immu2@example.invalid', '+33600000002',
   NULL),
  -- T3 : a_toutes lié à C, sans tournée
  ('1a000000-0000-0000-0000-000000000003', 'Immuable Velo', '910000003', '3 rue T', '75001', 'Paris',
   ARRAY['velo_cargo'], 'a_toutes', NULL, 'T', 'immu3@example.invalid', '+33600000003',
   '1a000000-0000-0000-0000-0000000000a3');

INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id)
SELECT '1a000000-0000-0000-0000-0000000000f1', 'TEST-IMMU-TOUR', current_date,
       (enum_range(NULL::plateforme.creneau))[1],
       '1a000000-0000-0000-0000-0000000000a1';

-- ── 1-4. Forme ───────────────────────────────────────────────────────────────
SELECT has_trigger('plateforme', 'transporteurs', 'trg_transporteur_cols_immuables',
  'trigger trg_transporteur_cols_immuables présent (nom exigé par le CDC)');
SELECT has_trigger('plateforme', 'transporteurs', 'trg_transporteur_delete_sous_tournees',
  'trigger de garde DELETE présent');
SELECT ok(
  NOT has_function_privilege('authenticated', 'plateforme.fn_trg_transporteur_delete_sous_tournees()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'plateforme.fn_trg_transporteur_delete_sous_tournees()', 'EXECUTE'),
  'fonction SECURITY DEFINER du DELETE : EXECUTE fermé à authenticated et anon'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'plateforme.fn_trg_transporteur_cols_immuables()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'plateforme.fn_trg_transporteur_cols_immuables()', 'EXECUTE'),
  'fonction d''immuabilité : EXECUTE fermé à authenticated et anon'
);

-- ── 5-9. Chemin SQL (superuser) : toute modification refusée ────────────────
SELECT throws_ok(
  $$UPDATE plateforme.transporteurs SET type_tms = 'a_toutes'
     WHERE id = '1a000000-0000-0000-0000-000000000001'$$,
  'P0045', NULL, 'SQL : type_tms mts1 → a_toutes refusé');
SELECT throws_ok(
  $$UPDATE plateforme.transporteurs SET prestataire_logistique_id = '1a000000-0000-0000-0000-0000000000a2'
     WHERE id = '1a000000-0000-0000-0000-000000000001'$$,
  'P0045', NULL, 'SQL : prestataire A → B refusé');
SELECT throws_ok(
  $$UPDATE plateforme.transporteurs SET prestataire_logistique_id = NULL
     WHERE id = '1a000000-0000-0000-0000-000000000001'$$,
  'P0045', NULL, 'SQL : prestataire → NULL refusé');
SELECT throws_ok(
  $$UPDATE plateforme.transporteurs SET prestataire_logistique_id = '1a000000-0000-0000-0000-0000000000a2'
     WHERE id = '1a000000-0000-0000-0000-000000000002'$$,
  'P0045', NULL, 'SQL : NULL → prestataire refusé (pas de rattachement tardif)');
SELECT throws_ok(
  $$UPDATE plateforme.transporteurs SET type_tms = 'par_telephone'
     WHERE id = '1a000000-0000-0000-0000-000000000002'$$,
  'P0045', NULL, 'SQL : type_tms entre deux types manuels refusé aussi');

-- ── 10-13. Ce qui reste libre ────────────────────────────────────────────────
SELECT lives_ok(
  $$UPDATE plateforme.transporteurs
       SET type_tms = type_tms, prestataire_logistique_id = prestataire_logistique_id, nom = 'Immuable MTS1 bis'
     WHERE id = '1a000000-0000-0000-0000-000000000001'$$,
  'SQL : réécrire la même valeur + changer une autre colonne passe');
SELECT lives_ok(
  $$INSERT INTO plateforme.transporteurs
      (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
       code_transporteur_mts1, contact_nom, contact_email, contact_telephone, prestataire_logistique_id)
    VALUES ('1a000000-0000-0000-0000-000000000001', 'Immuable MTS1', '910000001', '1 rue T', '75001', 'Paris',
            ARRAY['fourgon'], 'mts1', 'IMMU-MTS1', 'T', 'immu1@example.invalid', '+33600000001',
            '1a000000-0000-0000-0000-0000000000a1')
    ON CONFLICT (id) DO UPDATE SET nom = EXCLUDED.nom, type_tms = EXCLUDED.type_tms,
      prestataire_logistique_id = EXCLUDED.prestataire_logistique_id$$,
  'SQL : upsert du référentiel à valeurs identiques passe (seeds)');
SELECT throws_ok(
  $$INSERT INTO plateforme.transporteurs
      (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
       contact_nom, contact_email, contact_telephone, prestataire_logistique_id)
    VALUES ('1a000000-0000-0000-0000-000000000002', 'Immuable Mail', '910000002', '2 rue T', '75001', 'Paris',
            ARRAY['fourgon'], 'mts1', 'T', 'immu2@example.invalid', '+33600000002',
            '1a000000-0000-0000-0000-0000000000a2')
    ON CONFLICT (id) DO UPDATE SET type_tms = EXCLUDED.type_tms,
      prestataire_logistique_id = EXCLUDED.prestataire_logistique_id$$,
  'P0045', NULL, 'SQL : upsert qui change le type ou le lien refusé (ON CONFLICT DO UPDATE)');
SELECT is(
  (SELECT (type_tms::text, prestataire_logistique_id) FROM plateforme.transporteurs
    WHERE id = '1a000000-0000-0000-0000-000000000001')::text,
  ('mts1', '1a000000-0000-0000-0000-0000000000a1'::uuid)::text,
  'T1 garde son type et son prestataire après toutes les tentatives');

-- ── 14-19. Chemin PostgREST : authenticated admin_savr / ops_savr ────────────
SELECT test_set_jwt('admin_savr');
SELECT throws_ok(
  $$UPDATE plateforme.transporteurs SET type_tms = 'autre'
     WHERE id = '1a000000-0000-0000-0000-000000000003'$$,
  'P0045', NULL, 'admin_savr (authenticated) : type_tms refusé');
SELECT throws_ok(
  $$UPDATE plateforme.transporteurs SET prestataire_logistique_id = '1a000000-0000-0000-0000-0000000000a2'
     WHERE id = '1a000000-0000-0000-0000-000000000003'$$,
  'P0045', NULL, 'admin_savr (authenticated) : prestataire refusé');

SELECT test_set_jwt('ops_savr');
SELECT throws_ok(
  $$UPDATE plateforme.transporteurs SET type_tms = 'mts1'
     WHERE id = '1a000000-0000-0000-0000-000000000003'$$,
  'P0045', NULL, 'ops_savr (authenticated) : type_tms refusé');
SELECT throws_ok(
  $$UPDATE plateforme.transporteurs SET prestataire_logistique_id = NULL
     WHERE id = '1a000000-0000-0000-0000-000000000003'$$,
  'P0045', NULL, 'ops_savr (authenticated) : prestataire refusé');
SELECT lives_ok(
  $$UPDATE plateforme.transporteurs SET actif = false
     WHERE id = '1a000000-0000-0000-0000-000000000001'$$,
  'ops_savr (authenticated) : actif = false ACCEPTÉ');
SELECT test_as_superuser();
SELECT is(
  (SELECT actif FROM plateforme.transporteurs WHERE id = '1a000000-0000-0000-0000-000000000001'),
  false,
  'la désactivation par ops_savr a bien été écrite (pas un no-op RLS)');

-- ── 20-24. DELETE ────────────────────────────────────────────────────────────
SELECT test_set_jwt('admin_savr');
SELECT throws_ok(
  $$DELETE FROM plateforme.transporteurs WHERE id = '1a000000-0000-0000-0000-000000000001'$$,
  'P0046', NULL, 'admin_savr (authenticated) : DELETE d''un transporteur référencé par une tournée refusé');
SELECT test_as_superuser();
SELECT throws_ok(
  $$DELETE FROM plateforme.transporteurs WHERE id = '1a000000-0000-0000-0000-000000000001'$$,
  'P0046', NULL, 'SQL : DELETE sous tournée refusé aussi');
SELECT test_set_jwt('admin_savr');
SELECT lives_ok(
  $$DELETE FROM plateforme.transporteurs WHERE id = '1a000000-0000-0000-0000-000000000003'$$,
  'admin_savr : DELETE d''un transporteur lié mais sans tournée accepté');
SELECT lives_ok(
  $$DELETE FROM plateforme.transporteurs WHERE id = '1a000000-0000-0000-0000-000000000002'$$,
  'admin_savr : DELETE d''un transporteur sans prestataire accepté');
SELECT test_as_superuser();
SELECT is(
  (SELECT count(*)::int FROM plateforme.transporteurs WHERE id IN (
     '1a000000-0000-0000-0000-000000000001',
     '1a000000-0000-0000-0000-000000000002',
     '1a000000-0000-0000-0000-000000000003')),
  1,
  'seul T1 (sous tournée) subsiste — les deux DELETE acceptés ont réellement supprimé');

SELECT * FROM finish();
ROLLBACK;

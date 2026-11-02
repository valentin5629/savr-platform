-- =============================================================================
-- pgTAP — codes VIPARIS (Val 2026-11-02), migration
-- 20261102120000_plateforme_codes_viparis.sql
-- =============================================================================
-- Prouve :
--   • lieux.code_site_viparis : liste fermée des 8 sites, NULL admis ;
--   • evenements.code_affaire_viparis : 7 caractères alphanumériques
--     majuscules, NULL admis ;
--   • fn_enregistrer_programmation écrit le code affaire dans la même
--     transaction, à la création comme à la reprise d'un brouillon ;
--   • v_registre_dechets rend les deux codes ;
--   • AUCUN accès nouveau : un rôle client ne lit ni l'une ni l'autre colonne
--     directement (listes blanches de colonnes inchangées), et la fonction de
--     programmation reste fermée aux rôles clients.
-- JWT au format PRODUCTION (claim `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(16);

CREATE OR REPLACE FUNCTION _vip_jwt(p_role text, p_org uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(), 'role', 'authenticated', 'user_role', p_role,
    'organisation_id', p_org, 'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION _vip_su()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ── Jeu d'essai : organisation, lieu, entité de facturation et type d'un
-- événement existant (fixture outbox), comme programmation_par_carte.
CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT tests.outbox_fixture_collecte('zd') AS collecte_fixture,
       NULL::jsonb AS evt, NULL::uuid AS type_evt, NULL::uuid AS lieu,
       NULL::uuid AS org;
UPDATE t SET evt = jsonb_build_object(
    'organisation_id', e.organisation_id,
    'traiteur_operationnel_organisation_id', e.traiteur_operationnel_organisation_id,
    'entite_facturation_id', e.entite_facturation_id,
    'lieu_id', e.lieu_id,
    'created_by', e.created_by,
    'nom_evenement', 'Salon VIPARIS',
    'controle_acces_requis', false),
  type_evt = e.type_evenement_id,
  lieu = e.lieu_id,
  org = e.organisation_id
  FROM plateforme.collectes c JOIN plateforme.evenements e ON e.id = c.evenement_id
 WHERE c.id = t.collecte_fixture;

CREATE FUNCTION pg_temp.carte() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'type', 'zd', 'date_collecte', CURRENT_DATE + 12, 'heure_collecte', '19:00',
    'pax', 120, 'type_evenement_id', (SELECT type_evt FROM t),
    'contact_principal_nom', 'Alice', 'contact_principal_telephone', '0600000120')
$$;

-- ── 1-4. Code site du lieu ─────────────────────────────────────────────────
SELECT lives_ok(
  format($$ UPDATE plateforme.lieux SET code_site_viparis = 'CNIT2' WHERE id = %L $$, (SELECT lieu FROM t)),
  'code site : un code de la liste est accepté');
SELECT throws_ok(
  format($$ UPDATE plateforme.lieux SET code_site_viparis = 'XYZ' WHERE id = %L $$, (SELECT lieu FROM t)),
  '23514', NULL, 'code site : un code hors liste est refusé');
SELECT throws_ok(
  format($$ UPDATE plateforme.lieux SET code_site_viparis = 'pcp' WHERE id = %L $$, (SELECT lieu FROM t)),
  '23514', NULL, 'code site : la casse compte (liste en majuscules)');
SELECT lives_ok(
  format($$ UPDATE plateforme.lieux SET code_site_viparis = NULL WHERE id = %L $$, (SELECT lieu FROM t)),
  'code site : facultatif (NULL)');

-- ── 5-7. Code affaire de l'événement ───────────────────────────────────────
SELECT throws_ok(
  format($$ UPDATE plateforme.evenements e SET code_affaire_viparis = '26sial1'
             FROM plateforme.collectes c WHERE c.evenement_id = e.id AND c.id = %L $$,
         (SELECT collecte_fixture FROM t)),
  '23514', NULL, 'code affaire : minuscules refusées');
SELECT throws_ok(
  format($$ UPDATE plateforme.evenements e SET code_affaire_viparis = '26SIAL12'
             FROM plateforme.collectes c WHERE c.evenement_id = e.id AND c.id = %L $$,
         (SELECT collecte_fixture FROM t)),
  '23514', NULL, 'code affaire : 8 caractères refusés');
SELECT throws_ok(
  format($$ UPDATE plateforme.evenements e SET code_affaire_viparis = '26-SIA1'
             FROM plateforme.collectes c WHERE c.evenement_id = e.id AND c.id = %L $$,
         (SELECT collecte_fixture FROM t)),
  '23514', NULL, 'code affaire : caractère non alphanumérique refusé');

-- ── 8-9. Programmation : même transaction, création et reprise ─────────────
CREATE TEMP TABLE r ON COMMIT DROP AS
SELECT plateforme.fn_enregistrer_programmation(
  (SELECT evt FROM t) || jsonb_build_object('code_affaire_viparis', '26SIAL1'),
  jsonb_build_array(pg_temp.carte()), false) AS res;
CREATE FUNCTION pg_temp.evt_id() RETURNS uuid LANGUAGE sql AS
  $$ SELECT ((SELECT res FROM r)->>'evenement_id')::uuid $$;

SELECT is((SELECT code_affaire_viparis FROM plateforme.evenements WHERE id = pg_temp.evt_id()),
  '26SIAL1', 'création : le code affaire est écrit avec l’événement');

SELECT plateforme.fn_enregistrer_programmation(
  (SELECT evt FROM t) || jsonb_build_object('code_affaire_viparis', '26SIAL2'),
  jsonb_build_array(pg_temp.carte()), false, pg_temp.evt_id());
SELECT is((SELECT code_affaire_viparis FROM plateforme.evenements WHERE id = pg_temp.evt_id()),
  '26SIAL2', 'reprise du brouillon : le code affaire est remplacé');

-- ── 10-11. Registre : les deux codes sortent avec la collecte clôturée ─────
UPDATE plateforme.lieux SET code_site_viparis = 'PCP' WHERE id = (SELECT lieu FROM t);
UPDATE plateforme.evenements e SET code_affaire_viparis = '26SIAL9'
  FROM plateforme.collectes c
 WHERE c.evenement_id = e.id AND c.id = (SELECT collecte_fixture FROM t);
UPDATE plateforme.collectes SET statut = 'cloturee' WHERE id = (SELECT collecte_fixture FROM t);

SELECT _vip_jwt('admin_savr', (SELECT org FROM t));
SELECT is(
  (SELECT lieu_code_site_viparis FROM plateforme.v_registre_dechets
    WHERE collecte_id = (SELECT collecte_fixture FROM t)),
  'PCP', 'registre : le code site du lieu');
SELECT is(
  (SELECT evenement_code_affaire_viparis FROM plateforme.v_registre_dechets
    WHERE collecte_id = (SELECT collecte_fixture FROM t)),
  '26SIAL9', 'registre : le code affaire de l’événement');

-- Le traiteur programmateur lit aussi les codes de SON registre (aucune
-- confidentialité, Val 2026-11-02), par la vue et elle seule.
SELECT _vip_jwt('traiteur_manager', (SELECT org FROM t));
SELECT is(
  (SELECT lieu_code_site_viparis || '/' || evenement_code_affaire_viparis
     FROM plateforme.v_registre_dechets
    WHERE collecte_id = (SELECT collecte_fixture FROM t)),
  'PCP/26SIAL9', 'registre du traiteur : les deux codes');

-- ── 13-16. Aucun accès nouveau ─────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT code_site_viparis FROM plateforme.lieux LIMIT 1 $$,
  '42501', NULL, 'un rôle client ne lit pas la colonne du code site en direct');
SELECT throws_ok(
  $$ SELECT code_affaire_viparis FROM plateforme.evenements LIMIT 1 $$,
  '42501', NULL, 'un rôle client ne lit pas la colonne du code affaire en direct');
SELECT throws_ok(
  $$ UPDATE plateforme.evenements SET code_affaire_viparis = '26SIAL3' $$,
  '42501', NULL, 'un rôle client n’écrit pas le code affaire en direct');
SELECT _vip_su();
SELECT is(
  has_function_privilege('authenticated',
    'plateforme.fn_enregistrer_programmation(jsonb, jsonb, boolean, uuid)', 'EXECUTE'),
  false, 'la fonction de programmation reste fermée aux rôles clients');

SELECT * FROM finish();
ROLLBACK;

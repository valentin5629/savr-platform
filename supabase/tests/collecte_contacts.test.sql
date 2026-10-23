-- =============================================================================
-- pgTAP — type d'événement et contacts portés par chaque collecte (refonte Val
-- 2026-10-22, lot A), migration 20261022210000_plateforme_collecte_contacts_type_evenement.sql
-- =============================================================================
-- Prouve :
--   • `collecte_contacts` : RLS activée et forcée, une policy qui refuse tout, aucun droit à
--     anon / authenticated, lecture refusée à chaque rôle client ; service_role
--     seul ; bornes des contacts ; suppression en cascade avec la collecte ;
--   • une collecte créée reçoit le type et les contacts de son événement ; un
--     type donné à l'insertion est gardé ;
--   • fn_modifier_evenement recopie un changement de contacts ou de type sur
--     toutes les collectes de l'événement, et rien d'autre ; l'E2 d'une collecte
--     active commandée sur un changement de contact est inchangé ;
--   • les fonctions de déclencheur ne sont exécutables par aucun rôle client.
-- =============================================================================

BEGIN;
SELECT plan(42);

CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ── Jeu d'essai : un événement (contacts « Contact Fixture » / 0600000000),
-- une collecte ZD commandée, et une seconde collecte sur le même événement.
CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT tests.outbox_fixture_collecte('zd') AS commandee,
       NULL::uuid AS evt, NULL::uuid AS org, NULL::uuid AS seconde,
       NULL::uuid AS type_evt, NULL::uuid AS autre_type;
UPDATE t SET evt = c.evenement_id FROM plateforme.collectes c WHERE c.id = t.commandee;
UPDATE t SET org = e.organisation_id, type_evt = e.type_evenement_id
  FROM plateforme.evenements e WHERE e.id = t.evt;
UPDATE t SET seconde = plateforme.fn_creer_collecte(
  p_evenement_id := evt, p_type := 'ag',
  p_date_collecte := CURRENT_DATE + 31, p_heure_collecte := '21:00'::time, p_pax := 80);
INSERT INTO plateforme.types_evenements (code, libelle, created_at, updated_at)
VALUES ('LOT_A_AUTRE_TYPE', 'Lot A autre type', now(), now())
ON CONFLICT (code) DO UPDATE SET libelle = EXCLUDED.libelle;
UPDATE t SET autre_type = (SELECT id FROM plateforme.types_evenements WHERE code = 'LOT_A_AUTRE_TYPE');

CREATE FUNCTION pg_temp.contact(p_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT contact_principal_nom || ' / ' || contact_principal_telephone || ' / '
      || coalesce(contact_secours_nom, '-') || ' / ' || coalesce(contact_secours_telephone, '-')
    FROM plateforme.collecte_contacts WHERE collecte_id = p_id
$$;
CREATE FUNCTION pg_temp.type_evt(p_id uuid) RETURNS uuid LANGUAGE sql AS
  $$ SELECT type_evenement_id FROM plateforme.collectes WHERE id = p_id $$;

-- ── Table : structure et droits ──────────────────────────────────────────────
SELECT has_table('plateforme', 'collecte_contacts', 'la table collecte_contacts existe');
SELECT col_is_pk('plateforme', 'collecte_contacts', 'collecte_id', 'collecte_id est la clé primaire (1–1 avec collectes)');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
            WHERE oid = 'plateforme.collecte_contacts'::regclass),
  'RLS activée et forcée sur collecte_contacts');
SELECT is((SELECT array_agg(policyname || ' ' || cmd || ' ' || qual || ' ' || with_check)
             FROM pg_policies
            WHERE schemaname = 'plateforme' AND tablename = 'collecte_contacts'),
  ARRAY['collecte_contacts_ferme ALL false false'],
  'une seule policy sur collecte_contacts, qui refuse tout');
SELECT ok(NOT has_table_privilege('authenticated', 'plateforme.collecte_contacts', 'SELECT'),
  'authenticated : pas de SELECT');
SELECT ok(NOT has_table_privilege('authenticated', 'plateforme.collecte_contacts', 'INSERT, UPDATE, DELETE'),
  'authenticated : ni INSERT, ni UPDATE, ni DELETE');
SELECT ok(NOT has_table_privilege('anon', 'plateforme.collecte_contacts', 'SELECT, INSERT, UPDATE, DELETE'),
  'anon : aucun droit');
SELECT ok(has_table_privilege('service_role', 'plateforme.collecte_contacts', 'SELECT')
      AND has_table_privilege('service_role', 'plateforme.collecte_contacts', 'INSERT')
      AND has_table_privilege('service_role', 'plateforme.collecte_contacts', 'UPDATE')
      AND has_table_privilege('service_role', 'plateforme.collecte_contacts', 'DELETE'),
  'service_role : lecture et écriture');

-- ── Valeurs reprises de l'événement à la création ───────────────────────────
SELECT is(pg_temp.contact((SELECT commandee FROM t)), 'Contact Fixture / 0600000000 / - / -',
  'collecte créée : contacts repris de l’événement');
SELECT is(pg_temp.contact((SELECT seconde FROM t)), 'Contact Fixture / 0600000000 / - / -',
  'seconde collecte de l’événement : mêmes contacts repris');
SELECT is(pg_temp.type_evt((SELECT commandee FROM t)), (SELECT type_evt FROM t),
  'collecte créée : type d’événement repris de l’événement');
SELECT is(pg_temp.type_evt((SELECT seconde FROM t)), (SELECT type_evt FROM t),
  'seconde collecte : type d’événement repris de l’événement');

-- Un type donné à l'insertion est gardé.
ALTER TABLE t ADD COLUMN typee uuid;
INSERT INTO plateforme.collectes (evenement_id, type, date_collecte, heure_collecte, statut, statut_tms, pax, type_evenement_id)
SELECT evt, 'zero_dechet', CURRENT_DATE + 32, '20:00', 'programmee', 'non_envoye', 50, autre_type FROM t;
UPDATE t SET typee = (SELECT id FROM plateforme.collectes WHERE evenement_id = t.evt AND date_collecte = CURRENT_DATE + 32);
SELECT is(pg_temp.type_evt((SELECT typee FROM t)), (SELECT autre_type FROM t),
  'type donné à l’insertion : gardé');
SELECT is(pg_temp.contact((SELECT typee FROM t)), 'Contact Fixture / 0600000000 / - / -',
  'collecte insérée directement : contacts repris de l’événement');

-- ── fn_modifier_evenement : recopie sur toutes les collectes ────────────────
SELECT plateforme.fn_modifier_evenement(
  (SELECT evt FROM t),
  '{"contact_principal_nom": "Zoé Martin", "contact_principal_telephone": "0611223344", "contact_secours_nom": "Paul", "contact_secours_telephone": "0699887766"}'::jsonb,
  ARRAY['contact_principal_nom', 'contact_principal_telephone', 'contact_secours_nom', 'contact_secours_telephone']);
SELECT is(pg_temp.contact((SELECT commandee FROM t)), 'Zoé Martin / 0611223344 / Paul / 0699887766',
  'contacts modifiés sur l’événement : recopiés sur la collecte commandée');
SELECT is(pg_temp.contact((SELECT seconde FROM t)), 'Zoé Martin / 0611223344 / Paul / 0699887766',
  'contacts modifiés sur l’événement : recopiés sur la seconde collecte');
SELECT is(pg_temp.contact((SELECT typee FROM t)), 'Zoé Martin / 0611223344 / Paul / 0699887766',
  'contacts modifiés sur l’événement : recopiés sur la troisième collecte');
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
    WHERE aggregate_id = (SELECT commandee FROM t) AND event_type = 'collecte.modifiee'),
  1, 'collecte active commandée : le changement de contact émet toujours son E2');

SELECT plateforme.fn_modifier_evenement(
  (SELECT evt FROM t), jsonb_build_object('type_evenement_id', (SELECT autre_type FROM t)), ARRAY['type_evenement_id']);
SELECT is(pg_temp.type_evt((SELECT commandee FROM t)), (SELECT autre_type FROM t),
  'type modifié sur l’événement : recopié sur la collecte commandée');
SELECT is(pg_temp.type_evt((SELECT seconde FROM t)), (SELECT autre_type FROM t),
  'type modifié sur l’événement : recopié sur la seconde collecte');

-- Un autre champ de l'événement ne touche ni contacts ni type.
UPDATE plateforme.collecte_contacts SET contact_secours_nom = 'Propre à la seconde'
 WHERE collecte_id = (SELECT seconde FROM t);
UPDATE plateforme.collectes SET type_evenement_id = (SELECT type_evt FROM t)
 WHERE id = (SELECT seconde FROM t);
SELECT plateforme.fn_modifier_evenement((SELECT evt FROM t), '{"nom_evenement": "Gala renommé"}'::jsonb, ARRAY['nom_evenement']);
SELECT is(pg_temp.contact((SELECT seconde FROM t)), 'Zoé Martin / 0611223344 / Propre à la seconde / 0699887766',
  'renommer l’événement ne recopie pas les contacts');
SELECT is(pg_temp.type_evt((SELECT seconde FROM t)), (SELECT type_evt FROM t),
  'renommer l’événement ne recopie pas le type');

-- ── La recopie reste dans l'événement modifié ───────────────────────────────
-- Un second événement de la même organisation, avec ses propres contacts et son
-- type, et sa collecte : modifier le premier événement ne la touche pas.
INSERT INTO plateforme.evenements (organisation_id, lieu_id, nom_evenement, pax, type_evenement_id,
  contact_principal_nom, contact_principal_telephone, entite_facturation_id,
  traiteur_operationnel_organisation_id, created_by, created_at, updated_at)
SELECT e.organisation_id, e.lieu_id, 'Lot A autre événement', 10, t.type_evt,
       'Autre Contact', '0700000000', e.entite_facturation_id,
       e.traiteur_operationnel_organisation_id, e.created_by, now(), now()
  FROM plateforme.evenements e, t WHERE e.id = t.evt;
ALTER TABLE t ADD COLUMN autre_collecte uuid, ADD COLUMN troisieme_type uuid;
UPDATE t SET autre_collecte = plateforme.fn_creer_collecte(
  p_evenement_id := (SELECT id FROM plateforme.evenements WHERE nom_evenement = 'Lot A autre événement'),
  p_type := 'ag', p_date_collecte := CURRENT_DATE + 31, p_heure_collecte := '21:00'::time, p_pax := 80);
INSERT INTO plateforme.types_evenements (code, libelle, created_at, updated_at)
VALUES ('LOT_A_TROISIEME_TYPE', 'Lot A troisième type', now(), now())
ON CONFLICT (code) DO UPDATE SET libelle = EXCLUDED.libelle;
UPDATE t SET troisieme_type = (SELECT id FROM plateforme.types_evenements WHERE code = 'LOT_A_TROISIEME_TYPE');
SELECT plateforme.fn_modifier_evenement(
  (SELECT evt FROM t),
  '{"contact_principal_nom": "Léa Durand", "contact_principal_telephone": "0655443322"}'::jsonb,
  ARRAY['contact_principal_nom', 'contact_principal_telephone']);
SELECT plateforme.fn_modifier_evenement(
  (SELECT evt FROM t), jsonb_build_object('type_evenement_id', (SELECT troisieme_type FROM t)), ARRAY['type_evenement_id']);
SELECT is(pg_temp.contact((SELECT autre_collecte FROM t)), 'Autre Contact / 0700000000 / - / -',
  'contacts modifiés sur un événement : la collecte d’un autre événement garde les siens');
SELECT is(pg_temp.type_evt((SELECT autre_collecte FROM t)), (SELECT type_evt FROM t),
  'type modifié sur un événement : la collecte d’un autre événement garde le sien');

-- ── Bornes ───────────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ UPDATE plateforme.collecte_contacts SET contact_principal_nom = '   ' WHERE collecte_id = (SELECT seconde FROM t) $$,
  '23514', NULL, 'contact principal fait de blancs : refusé');
SELECT throws_ok(
  $$ UPDATE plateforme.collecte_contacts SET contact_principal_nom = repeat('a', 121) WHERE collecte_id = (SELECT seconde FROM t) $$,
  '23514', NULL, 'contact principal au-delà de 120 caractères : refusé');
SELECT throws_ok(
  $$ UPDATE plateforme.collecte_contacts SET contact_secours_nom = E'Paul\nFaux en-tête' WHERE collecte_id = (SELECT seconde FROM t) $$,
  '23514', NULL, 'contact de secours sur deux lignes : refusé');
SELECT throws_ok(
  $$ UPDATE plateforme.collecte_contacts SET contact_principal_telephone = repeat('1', 41) WHERE collecte_id = (SELECT seconde FROM t) $$,
  '23514', NULL, 'téléphone principal au-delà de 40 caractères : refusé');
SELECT throws_ok(
  $$ UPDATE plateforme.collecte_contacts SET contact_principal_nom = E'Zoé\nMartin' WHERE collecte_id = (SELECT seconde FROM t) $$,
  '23514', NULL, 'contact principal sur deux lignes : refusé');
SELECT throws_ok(
  $$ UPDATE plateforme.collecte_contacts SET contact_principal_telephone = '   ' WHERE collecte_id = (SELECT seconde FROM t) $$,
  '23514', NULL, 'téléphone principal fait de blancs : refusé');
SELECT throws_ok(
  $$ UPDATE plateforme.collecte_contacts SET contact_principal_telephone = E'0611\n223344' WHERE collecte_id = (SELECT seconde FROM t) $$,
  '23514', NULL, 'téléphone principal sur deux lignes : refusé');
SELECT throws_ok(
  $$ UPDATE plateforme.collecte_contacts SET contact_secours_nom = repeat('a', 121) WHERE collecte_id = (SELECT seconde FROM t) $$,
  '23514', NULL, 'contact de secours au-delà de 120 caractères : refusé');
SELECT throws_ok(
  $$ UPDATE plateforme.collecte_contacts SET contact_secours_telephone = repeat('1', 41) WHERE collecte_id = (SELECT seconde FROM t) $$,
  '23514', NULL, 'téléphone de secours au-delà de 40 caractères : refusé');
SELECT throws_ok(
  $$ UPDATE plateforme.collecte_contacts SET contact_secours_telephone = E'06\n99887766' WHERE collecte_id = (SELECT seconde FROM t) $$,
  '23514', NULL, 'téléphone de secours sur deux lignes : refusé');

-- ── Suppression en cascade ───────────────────────────────────────────────────
DELETE FROM plateforme.collectes WHERE id = (SELECT typee FROM t);
SELECT is((SELECT count(*)::int FROM plateforme.collecte_contacts WHERE collecte_id = (SELECT typee FROM t)),
  0, 'supprimer une collecte supprime ses contacts');

-- ── Rôles clients : aucune lecture ni écriture ──────────────────────────────
GRANT SELECT ON t TO authenticated;
SELECT test_set_jwt('traiteur_manager', (SELECT org FROM t));
SELECT throws_ok($$ SELECT count(*) FROM plateforme.collecte_contacts $$,
  '42501', NULL, 'traiteur_manager de l’organisation : lecture refusée');
SELECT throws_ok(
  $$ INSERT INTO plateforme.collecte_contacts (collecte_id, contact_principal_nom, contact_principal_telephone)
     VALUES ((SELECT seconde FROM t), 'Intrus', '0600000001') $$,
  '42501', NULL, 'traiteur_manager de l’organisation : écriture refusée');
SELECT test_set_jwt('traiteur_commercial', (SELECT org FROM t));
SELECT throws_ok($$ SELECT count(*) FROM plateforme.collecte_contacts $$,
  '42501', NULL, 'traiteur_commercial : lecture refusée');
SELECT test_set_jwt('agence', (SELECT org FROM t));
SELECT throws_ok($$ SELECT count(*) FROM plateforme.collecte_contacts $$,
  '42501', NULL, 'agence : lecture refusée');
SELECT test_set_jwt('gestionnaire_lieux', gen_random_uuid());
SELECT throws_ok($$ SELECT count(*) FROM plateforme.collecte_contacts $$,
  '42501', NULL, 'gestionnaire_lieux : lecture refusée');
SELECT test_set_jwt('client_organisateur', gen_random_uuid());
SELECT throws_ok($$ SELECT count(*) FROM plateforme.collecte_contacts $$,
  '42501', NULL, 'client_organisateur : lecture refusée');
SELECT test_as_superuser();

-- ── Fonctions de déclencheur ────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.fn_collecte_contacts_par_defaut()', 'execute')
      AND NOT has_function_privilege('authenticated', 'plateforme.fn_collectes_type_evenement_par_defaut()', 'execute'),
  'fonctions de déclencheur : EXECUTE refusé à authenticated');

SELECT * FROM finish();
ROLLBACK;

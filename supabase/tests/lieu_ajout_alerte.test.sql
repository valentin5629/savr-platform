-- =============================================================================
-- Demande d'ajout d'un lieu — garanties portées par la base
-- =============================================================================
-- §06.05 §3 « Ajout / retrait lieu », liste Lieux du gestionnaire (arbitrages
-- Val 2026-10-07). Vérifie :
--   · 1 demande OUVERTE par organisation : l'index unique partiel
--     `uniq_alerte_lieu_ajout_ouverte` refuse une 2e alerte ouverte du même
--     code pour la même organisation (les envois simultanés de la route
--     retombent sur cette violation), sans gêner une autre organisation ni un
--     autre code d'alerte ; une fois l'alerte résolue, une nouvelle demande en
--     ouvre une nouvelle ;
--   · `alertes_admin` reste fermée au rôle gestionnaire_lieux (ni INSERT ni
--     SELECT direct sous `authenticated`), y compris pour ce code et pour sa
--     propre organisation : la route est le seul chemin d'écriture ;
--   · la trace d'auteur de la route (`audit_log`, action `lieu_ajout_demande`
--     sur `organisations`) est acceptée par la base sous service_role, avec les
--     colonnes que la route écrit (user_id NULL ici, un utilisateur réel dans la
--     route).
-- =============================================================================

BEGIN;
SELECT plan(9);

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid()
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Deux organisations (alertes_admin.entity_id n'a pas de clé étrangère :
-- identifiants nus).
--   organisation A : de000000-0000-0000-0000-0000000000a1
--   organisation B : de000000-0000-0000-0000-0000000000b2

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'plateforme'
       AND tablename = 'alertes_admin'
       AND indexname = 'uniq_alerte_lieu_ajout_ouverte'
       AND indexdef ILIKE '%UNIQUE%'
       AND indexdef ILIKE '%(entity_id)%'
       AND indexdef ILIKE '%lieu_ajout_demande%'
       AND indexdef ILIKE '%ouverte%'
  ),
  'LIEU_AJOUT/index_unique_partiel_present — index unique partiel, par organisation, sur les alertes ouvertes du code'
);

SELECT lives_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, message, entity_type, entity_id)
    VALUES ('lieu_ajout_demande', 't', 'première demande', 'organisations',
            'de000000-0000-0000-0000-0000000000a1')$$,
  'LIEU_AJOUT/premiere_demande_ouverte — une première demande s''ouvre'
);

SELECT throws_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, message, entity_type, entity_id)
    VALUES ('lieu_ajout_demande', 't', 'seconde demande', 'organisations',
            'de000000-0000-0000-0000-0000000000a1')$$,
  '23505', NULL,
  'LIEU_AJOUT/seconde_demande_ouverte_refusee — une 2e demande ouverte de la même organisation est refusée (23505)'
);

SELECT lives_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, message, entity_type, entity_id)
    VALUES ('lieu_ajout_demande', 't', 'autre organisation', 'organisations',
            'de000000-0000-0000-0000-0000000000b2')$$,
  'LIEU_AJOUT/autre_organisation_libre — une autre organisation garde sa propre demande'
);

SELECT lives_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, message, entity_type, entity_id)
    VALUES ('shadow_traiteur_cree', 't', 'autre code', 'organisations',
            'de000000-0000-0000-0000-0000000000a1')$$,
  'LIEU_AJOUT/autre_code_libre — un autre code d''alerte sur la même organisation n''est pas gêné'
);

-- L'Admin résout la demande : une nouvelle peut s'ouvrir.
UPDATE plateforme.alertes_admin
   SET statut = 'resolue', resolue_at = now()
 WHERE code = 'lieu_ajout_demande'
   AND entity_id = 'de000000-0000-0000-0000-0000000000a1';

SELECT lives_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, message, entity_type, entity_id)
    VALUES ('lieu_ajout_demande', 't', 'après résolution', 'organisations',
            'de000000-0000-0000-0000-0000000000a1')$$,
  'LIEU_AJOUT/nouvelle_demande_apres_resolution — après résolution, une nouvelle demande s''ouvre'
);

-- ─── alertes_admin reste fermée au gestionnaire de lieux ─────────────────────
-- Y compris pour une alerte de ce code rattachée à SA propre organisation.
SELECT test_set_jwt('gestionnaire_lieux', 'de000000-0000-0000-0000-0000000000c3'::uuid);

SELECT throws_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, message, entity_type, entity_id)
    VALUES ('lieu_ajout_demande', 't', 'écriture directe', 'organisations',
            'de000000-0000-0000-0000-0000000000c3')$$,
  '42501', NULL,
  'LIEU_AJOUT/ecriture_directe_gestionnaire_refusee — le gestionnaire ne peut pas écrire alertes_admin en direct'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.alertes_admin),
  0,
  'LIEU_AJOUT/lecture_directe_gestionnaire_vide — le gestionnaire ne lit aucune alerte en direct'
);

SELECT test_as_superuser();

-- ─── Trace d'auteur écrite par la route (service_role) ───────────────────────
-- Mêmes colonnes que l'INSERT de la route ; user_id NULL ici (pas de compte en
-- fixture) — la route y met l'utilisateur de la session.
SELECT set_config('role', 'service_role', true);

SELECT lives_ok(
  $$INSERT INTO plateforme.audit_log
      (table_name, record_id, action, user_id, role, impersonator_id)
    VALUES ('organisations', 'de000000-0000-0000-0000-0000000000a1',
            'lieu_ajout_demande', NULL, 'gestionnaire_lieux', NULL)$$,
  'LIEU_AJOUT/trace_audit_acceptee — la ligne d''audit de la demande est acceptée sous service_role'
);

SELECT test_as_superuser();

SELECT * FROM finish();
ROLLBACK;

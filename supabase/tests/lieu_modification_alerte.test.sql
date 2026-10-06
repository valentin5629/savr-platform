-- =============================================================================
-- Demande de modification d'un lieu — garanties portées par la base
-- =============================================================================
-- §06.05 §3 Fiche lieu du gestionnaire (arbitrage Val 2026-10-06). Vérifie :
--   · 1 demande OUVERTE par lieu : l'index unique partiel
--     `uniq_alerte_lieu_modification_ouverte` refuse une 2e alerte ouverte du
--     même code sur le même lieu (les envois simultanés de la route retombent
--     sur cette violation), sans gêner un autre lieu ni un autre code d'alerte ;
--     une fois l'alerte résolue, une nouvelle demande en ouvre une nouvelle ;
--   · la trace d'auteur de la route (`audit_log`, action
--     `lieu_modification_demandee` sur `lieux`) est acceptée par la base sous
--     service_role, tel que la route l'écrit.
-- =============================================================================

BEGIN;
SELECT plan(7);

CREATE OR REPLACE FUNCTION test_as_superuser() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Deux lieux (alertes_admin.entity_id n'a pas de clé étrangère : identifiants nus).
--   lieu A : dd000000-0000-0000-0000-0000000000a1
--   lieu B : dd000000-0000-0000-0000-0000000000b2

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'plateforme'
       AND tablename = 'alertes_admin'
       AND indexname = 'uniq_alerte_lieu_modification_ouverte'
       AND indexdef ILIKE '%UNIQUE%'
       AND indexdef ILIKE '%(entity_id)%'
       AND indexdef ILIKE '%lieu_modification_demandee%'
       AND indexdef ILIKE '%ouverte%'
  ),
  'LIEU_MODIF/index_unique_partiel_present — index unique partiel, par lieu, sur les alertes ouvertes du code'
);

SELECT lives_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, message, entity_type, entity_id)
    VALUES ('lieu_modification_demandee', 't', 'première demande', 'lieux',
            'dd000000-0000-0000-0000-0000000000a1')$$,
  'LIEU_MODIF/premiere_demande_ouverte — une première demande s''ouvre'
);

SELECT throws_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, message, entity_type, entity_id)
    VALUES ('lieu_modification_demandee', 't', 'seconde demande', 'lieux',
            'dd000000-0000-0000-0000-0000000000a1')$$,
  '23505', NULL,
  'LIEU_MODIF/seconde_demande_ouverte_refusee — une 2e demande ouverte sur le même lieu est refusée (23505)'
);

SELECT lives_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, message, entity_type, entity_id)
    VALUES ('lieu_modification_demandee', 't', 'autre lieu', 'lieux',
            'dd000000-0000-0000-0000-0000000000b2')$$,
  'LIEU_MODIF/autre_lieu_libre — un autre lieu garde sa propre demande'
);

SELECT lives_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, message, entity_type, entity_id)
    VALUES ('lieu_override_programmation', 't', 'autre code', 'lieux',
            'dd000000-0000-0000-0000-0000000000a1')$$,
  'LIEU_MODIF/autre_code_libre — un autre code d''alerte sur le même lieu n''est pas gêné'
);

-- L'Admin résout la demande : une nouvelle peut s'ouvrir.
UPDATE plateforme.alertes_admin
   SET statut = 'resolue', resolue_at = now()
 WHERE code = 'lieu_modification_demandee'
   AND entity_id = 'dd000000-0000-0000-0000-0000000000a1';

SELECT lives_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, message, entity_type, entity_id)
    VALUES ('lieu_modification_demandee', 't', 'après résolution', 'lieux',
            'dd000000-0000-0000-0000-0000000000a1')$$,
  'LIEU_MODIF/nouvelle_demande_apres_resolution — après résolution, une nouvelle demande s''ouvre'
);

-- ─── Trace d'auteur écrite par la route (service_role) ───────────────────────
-- Mêmes colonnes que l'INSERT de la route ; user_id NULL ici (pas de compte en
-- fixture) — la route y met l'utilisateur de la session.
SELECT set_config('role', 'service_role', true);

SELECT lives_ok(
  $$INSERT INTO plateforme.audit_log
      (table_name, record_id, action, user_id, role, impersonator_id)
    VALUES ('lieux', 'dd000000-0000-0000-0000-0000000000a1',
            'lieu_modification_demandee', NULL, 'gestionnaire_lieux', NULL)$$,
  'LIEU_MODIF/trace_audit_acceptee — la ligne d''audit de la demande est acceptée sous service_role'
);

SELECT test_as_superuser();

SELECT * FROM finish();
ROLLBACK;

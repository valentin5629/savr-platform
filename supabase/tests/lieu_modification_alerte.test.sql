-- =============================================================================
-- Demande de modification d'un lieu — garanties portées par la base
-- =============================================================================
-- §06.05 §3 Fiche lieu du gestionnaire (arbitrage Val 2026-10-06). Vérifie :
--   · 1 demande OUVERTE par lieu : l'index unique partiel
--     `uniq_alerte_lieu_modification_ouverte` refuse une 2e alerte ouverte du
--     même code sur le même lieu (les envois simultanés de la route retombent
--     sur cette violation), sans gêner un autre lieu ni un autre code d'alerte ;
--     une fois l'alerte résolue, une nouvelle demande en ouvre une nouvelle et
--     l'historique est gardé ;
--   · `alertes_admin` reste fermée au rôle gestionnaire_lieux (ni INSERT ni
--     SELECT direct) : la route est le seul chemin d'écriture.
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

-- L'Admin résout la demande : une nouvelle peut s'ouvrir, l'ancienne est gardée.
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

SELECT is(
  (SELECT count(*)::int FROM plateforme.alertes_admin
    WHERE code = 'lieu_modification_demandee'
      AND entity_id = 'dd000000-0000-0000-0000-0000000000a1'),
  2,
  'LIEU_MODIF/historique_conserve — l''alerte résolue est conservée à côté de la nouvelle'
);

-- ─── alertes_admin reste fermée au gestionnaire de lieux ─────────────────────
SELECT test_set_jwt('gestionnaire_lieux', 'dd100000-0000-0000-0000-0000000000a1'::uuid);

SELECT throws_ok(
  $$INSERT INTO plateforme.alertes_admin (code, titre, message, entity_type, entity_id)
    VALUES ('lieu_modification_demandee', 't', 'écriture directe', 'lieux',
            'dd000000-0000-0000-0000-0000000000c3')$$,
  '42501', NULL,
  'LIEU_MODIF/ecriture_directe_gestionnaire_refusee — le gestionnaire ne peut pas écrire alertes_admin en direct'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.alertes_admin),
  0,
  'LIEU_MODIF/lecture_directe_gestionnaire_vide — le gestionnaire ne lit aucune alerte en direct'
);

SELECT test_as_superuser();

SELECT * FROM finish();
ROLLBACK;

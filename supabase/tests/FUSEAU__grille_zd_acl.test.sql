-- =============================================================================
-- Tests pgTAP — ACL de rpc_creer_grille_zd (SECURITY DEFINER)
-- =============================================================================
-- La RPC écrit `grilles_tarifaires_zd` + `tarifs_zero_dechet` en bypass RLS.
-- Un `CREATE OR REPLACE` sur une base où la fonction n'existerait pas dégénère
-- en `CREATE`, qui rend EXECUTE à PUBLIC (piège P0 #263) → cliquet permanent.
-- =============================================================================

BEGIN;
SELECT plan(3);

SELECT ok(
  NOT has_function_privilege('anon',
    'plateforme.rpc_creer_grille_zd(text, plateforme.mode_grille_zd, boolean, date, jsonb, text)',
    'EXECUTE'),
  'anon ne peut PAS exécuter rpc_creer_grille_zd');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'plateforme.rpc_creer_grille_zd(text, plateforme.mode_grille_zd, boolean, date, jsonb, text)',
    'EXECUTE'),
  'authenticated ne peut PAS exécuter rpc_creer_grille_zd');

SELECT ok(
  has_function_privilege('service_role',
    'plateforme.rpc_creer_grille_zd(text, plateforme.mode_grille_zd, boolean, date, jsonb, text)',
    'EXECUTE'),
  'service_role peut exécuter rpc_creer_grille_zd (chemin applicatif)');

SELECT * FROM finish();
ROLLBACK;

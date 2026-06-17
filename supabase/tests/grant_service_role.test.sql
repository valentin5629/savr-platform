-- pgTAP — Privilèges service_role sur les schémas custom plateforme/shared.
-- Régression : la 0.4a n'accordait USAGE + privilèges qu'à authenticated/anon ;
-- service_role (clé serveur, createAdminSupabaseClient) levait « permission denied
-- for schema plateforme » → app sans données. Migration 20260617160000 corrige.
-- service_role a BYPASSRLS : ces tests vérifient les GRANTs (privilège), pas la RLS.

BEGIN;
SELECT plan(8);

-- USAGE sur les schémas
SELECT ok(
  has_schema_privilege('service_role', 'plateforme', 'USAGE'),
  'service_role a USAGE sur le schéma plateforme'
);
SELECT ok(
  has_schema_privilege('service_role', 'shared', 'USAGE'),
  'service_role a USAGE sur le schéma shared'
);

-- CRUD sur une table métier représentative de chaque schéma
SELECT ok(
  has_table_privilege('service_role', 'plateforme.collectes', 'SELECT'),
  'service_role peut SELECT plateforme.collectes'
);
SELECT ok(
  has_table_privilege('service_role', 'plateforme.collectes', 'INSERT'),
  'service_role peut INSERT plateforme.collectes'
);
SELECT ok(
  has_table_privilege('service_role', 'plateforme.factures', 'UPDATE'),
  'service_role peut UPDATE plateforme.factures'
);
SELECT ok(
  has_table_privilege('service_role', 'shared.fichiers', 'SELECT'),
  'service_role peut SELECT shared.fichiers'
);

-- EXECUTE sur une fonction (les routes serveur appellent des RPC)
SELECT ok(
  has_function_privilege('service_role', 'plateforme.f_collecte_visible(uuid)', 'EXECUTE'),
  'service_role peut EXECUTE plateforme.f_collecte_visible'
);

-- ALTER DEFAULT PRIVILEGES : une table FUTURE créée par le rôle de migration
-- doit hériter du GRANT service_role automatiquement (sans GRANT explicite).
-- pgTAP tourne sous le même rôle que les migrations (postgres) → la table créée
-- ici déclenche les default privileges posés par la migration. Rollback en fin.
CREATE TABLE plateforme._tmp_grant_check (id int);
SELECT ok(
  has_table_privilege('service_role', 'plateforme._tmp_grant_check', 'SELECT'),
  'default privileges : une nouvelle table plateforme accorde SELECT à service_role'
);

SELECT * FROM finish();
ROLLBACK;

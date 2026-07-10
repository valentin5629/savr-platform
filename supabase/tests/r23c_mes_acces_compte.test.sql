-- =============================================================================
-- Tests pgTAP R23c / BL-P3-13 — f_mes_acces_compte() (page « Sécurité du compte »)
-- =============================================================================
-- Vérifie : (1) scope SELF strict (un user ne voit QUE ses propres accès admin) ;
-- (2) filtre action='impersonation_session' (les autres lignes audit exclues) ;
-- (3) projection minimale (date + libellé générique, jamais l'identité de l'admin) ;
-- (4) NON-RÉGRESSION : audit_log reste staff-only (al_select_staff intact, un client
--     ne peut pas lire audit_log en direct). CDC §15 §2.3.
-- =============================================================================

BEGIN;
SELECT plan(7);

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role    text,
  p_org_id  uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'user_role', p_role,
    'role', p_role,
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

-- ── SETUP (namespace b23c) ──────────────────────────────────────────────────
SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES ('b23c0001-0000-0000-0000-000000000001'::uuid, 'Sécu Org', 'traiteur', true, false, '77700000000001', 'secu@test.com');

-- admin (impersonateur), userA + userB (deux clients impersonés distincts)
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('b23c0003-0000-0000-0000-0000000000AD'::uuid, 'b23c0001-0000-0000-0000-000000000001'::uuid, 'admin@secu.test', 'Ad', 'Min', 'admin_savr'),
  ('b23c0003-0000-0000-0000-00000000000A'::uuid, 'b23c0001-0000-0000-0000-000000000001'::uuid, 'a@secu.test', 'User', 'A', 'client_organisateur'),
  ('b23c0003-0000-0000-0000-00000000000B'::uuid, 'b23c0001-0000-0000-0000-000000000001'::uuid, 'b@secu.test', 'User', 'B', 'client_organisateur');

-- Accès impersonation : 1 pour A, 1 pour B. + 1 ligne audit NON-impersonation pour A.
INSERT INTO plateforme.audit_log (table_name, record_id, action, user_id, impersonator_id, created_at) VALUES
  ('users', 'b23c0003-0000-0000-0000-00000000000A', 'impersonation_session',
     'b23c0003-0000-0000-0000-00000000000A'::uuid, 'b23c0003-0000-0000-0000-0000000000AD'::uuid, now() - interval '2 days'),
  ('users', 'b23c0003-0000-0000-0000-00000000000B', 'impersonation_session',
     'b23c0003-0000-0000-0000-00000000000B'::uuid, 'b23c0003-0000-0000-0000-0000000000AD'::uuid, now() - interval '1 day'),
  ('users', 'b23c0003-0000-0000-0000-00000000000A', 'update',
     'b23c0003-0000-0000-0000-00000000000A'::uuid, NULL, now());

-- ── Tests SELF-scope (userA) ────────────────────────────────────────────────
SELECT test_set_jwt('client_organisateur', 'b23c0001-0000-0000-0000-000000000001'::uuid, 'b23c0003-0000-0000-0000-00000000000A'::uuid);

SELECT is(
  (SELECT count(*)::int FROM plateforme.f_mes_acces_compte()),
  1,
  'userA voit exactement SON accès impersonation (pas celui de B, pas la ligne update)'
);

SELECT is(
  (SELECT type_acces FROM plateforme.f_mes_acces_compte() LIMIT 1),
  'acces_administrateur',
  'libellé générique (aucune identité admin exposée)'
);

-- Non-régression : un client ne peut PAS lire audit_log en direct (al_select_staff).
SELECT is(
  (SELECT count(*)::int FROM plateforme.audit_log),
  0,
  'audit_log reste staff-only : le client ne lit aucune ligne en direct'
);

-- ── Tests SELF-scope (userB) : ne voit que le sien ──────────────────────────
SELECT test_set_jwt('client_organisateur', 'b23c0001-0000-0000-0000-000000000001'::uuid, 'b23c0003-0000-0000-0000-00000000000B'::uuid);

SELECT is(
  (SELECT count(*)::int FROM plateforme.f_mes_acces_compte()),
  1,
  'userB voit exactement SON accès (isolation inter-utilisateur)'
);

-- ── Staff : audit_log toujours lisible (al_select_staff intact) ─────────────
SELECT test_set_jwt('admin_savr', 'b23c0001-0000-0000-0000-000000000001'::uuid, 'b23c0003-0000-0000-0000-0000000000AD'::uuid);

SELECT ok(
  (SELECT count(*)::int FROM plateforme.audit_log) >= 3,
  'le staff lit toujours audit_log en direct (RLS non élargie ni restreinte)'
);

-- ── Anon : aucune exécution ─────────────────────────────────────────────────
SELECT test_as_superuser();
SELECT ok(
  NOT has_function_privilege('anon', 'plateforme.f_mes_acces_compte()', 'EXECUTE'),
  'anon ne peut pas exécuter f_mes_acces_compte()'
);
SELECT ok(
  has_function_privilege('authenticated', 'plateforme.f_mes_acces_compte()', 'EXECUTE'),
  'authenticated peut exécuter f_mes_acces_compte()'
);

SELECT * FROM finish();
ROLLBACK;

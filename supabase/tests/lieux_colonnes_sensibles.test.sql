-- =============================================================================
-- pgTAP FIX P1 — Masquage colonne-level de plateforme.lieux
-- =============================================================================
-- Migration testée : 20260617170000_plateforme_fix_lieux_colonnes_sensibles.sql
-- Décision spec §09 (2026-06-12) : les colonnes admin/ops-only de lieux
-- (commentaire_lieu, siren, email_gestionnaire, reference_citeo) + la colonne
-- interne commentaires_internes ne doivent JAMAIS être lisibles en SELECT direct
-- par les rôles clients. Masquage par REVOKE SELECT table-level + GRANT SELECT
-- (whitelist colonnes) — pattern F5 factures.
--
-- ⚠ Tests sous le rôle `authenticated` (jamais service_role pour les denies —
-- sinon faux verts : service_role a BYPASSRLS + grant complet).
-- =============================================================================

BEGIN;
SELECT plan(24);

-- ── Helpers simulation JWT (alignés rls_0_4_smoke.test.sql + override app_domain) ─
CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid(),
  p_app_domain text DEFAULT 'plateforme'
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'role', p_role,
    'organisation_id', p_org_id, 'app_domain', p_app_domain
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

CREATE OR REPLACE FUNCTION test_as_service_role()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', 'service_role', true);
END $$;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
SELECT test_as_superuser();

-- Organisation cliente (traiteur) + un lieu rattaché + un lieu NON rattaché.
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd)
VALUES
  ('dd000000-0000-0000-0000-00000000000a'::uuid, 'Traiteur Test', 'Traiteur Test SARL', 'traiteur', '99999999900001', true, 1.0);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
VALUES
  ('dd000000-0000-0000-0000-000000000a01'::uuid, 'dd000000-0000-0000-0000-00000000000a'::uuid,
   'manager@traiteur.test', 'Manager', 'T', 'traiteur_manager', true);

INSERT INTO plateforme.lieux
  (id, nom, adresse_acces, code_postal, ville, type_vehicule_max,
   commentaires_internes, commentaire_lieu, siren, email_gestionnaire, reference_citeo)
VALUES
  -- Lieu rattaché à l'organisation cliente (visible via lieux_clients_select)
  ('dd000000-0000-0000-0000-000000000b01'::uuid,
   'Lieu Rattaché', '1 rue Test', '75001', 'Paris', 'camionnette',
   'note ops interne', 'commentaire admin', '123456789', 'contact@lieu.test', true),
  -- Lieu NON rattaché (hors périmètre — doit être invisible)
  ('dd000000-0000-0000-0000-000000000b02'::uuid,
   'Lieu Hors Périmètre', '2 rue Loin', '69001', 'Lyon', 'fourgon',
   NULL, NULL, NULL, NULL, false);

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES
  ('dd000000-0000-0000-0000-00000000000a'::uuid, 'dd000000-0000-0000-0000-000000000b01'::uuid);

-- ════════════════════════════════════════════════════════════════════════════
-- A. DENY colonnes sensibles en SELECT direct — sous CHAQUE rôle client
--    Acceptation : SELECT siren, email_gestionnaire, commentaire_lieu,
--                  reference_citeo FROM plateforme.lieux → permission denied (42501)
-- ════════════════════════════════════════════════════════════════════════════

SELECT test_set_jwt('traiteur_manager', 'dd000000-0000-0000-0000-00000000000a'::uuid);
SELECT throws_ok(
  $$ SELECT siren, email_gestionnaire, commentaire_lieu, reference_citeo FROM plateforme.lieux $$,
  '42501', NULL,
  'A1 : traiteur_manager — colonnes sensibles refusées en SELECT direct'
);

SELECT test_set_jwt('traiteur_commercial', 'dd000000-0000-0000-0000-00000000000a'::uuid);
SELECT throws_ok(
  $$ SELECT siren, email_gestionnaire, commentaire_lieu, reference_citeo FROM plateforme.lieux $$,
  '42501', NULL,
  'A2 : traiteur_commercial — colonnes sensibles refusées en SELECT direct'
);

SELECT test_set_jwt('agence', 'dd000000-0000-0000-0000-00000000000a'::uuid);
SELECT throws_ok(
  $$ SELECT siren, email_gestionnaire, commentaire_lieu, reference_citeo FROM plateforme.lieux $$,
  '42501', NULL,
  'A3 : agence — colonnes sensibles refusées en SELECT direct'
);

SELECT test_set_jwt('gestionnaire_lieux', 'dd000000-0000-0000-0000-00000000000a'::uuid);
SELECT throws_ok(
  $$ SELECT siren, email_gestionnaire, commentaire_lieu, reference_citeo FROM plateforme.lieux $$,
  '42501', NULL,
  'A4 : gestionnaire_lieux — colonnes sensibles refusées en SELECT direct'
);

SELECT test_set_jwt('client_organisateur', 'dd000000-0000-0000-0000-00000000000a'::uuid);
SELECT throws_ok(
  $$ SELECT siren, email_gestionnaire, commentaire_lieu, reference_citeo FROM plateforme.lieux $$,
  '42501', NULL,
  'A5 : client_organisateur — colonnes sensibles refusées en SELECT direct'
);

-- ════════════════════════════════════════════════════════════════════════════
-- B. DENY granulaire par colonne (sous traiteur_manager représentatif)
-- ════════════════════════════════════════════════════════════════════════════
SELECT test_set_jwt('traiteur_manager', 'dd000000-0000-0000-0000-00000000000a'::uuid);

SELECT throws_ok($$ SELECT siren FROM plateforme.lieux $$, '42501', NULL,
  'B1 : siren refusé en SELECT direct');
SELECT throws_ok($$ SELECT email_gestionnaire FROM plateforme.lieux $$, '42501', NULL,
  'B2 : email_gestionnaire refusé en SELECT direct');
SELECT throws_ok($$ SELECT commentaire_lieu FROM plateforme.lieux $$, '42501', NULL,
  'B3 : commentaire_lieu refusé en SELECT direct');
SELECT throws_ok($$ SELECT reference_citeo FROM plateforme.lieux $$, '42501', NULL,
  'B4 : reference_citeo refusé en SELECT direct');
SELECT throws_ok($$ SELECT commentaires_internes FROM plateforme.lieux $$, '42501', NULL,
  'B5 : commentaires_internes refusé en SELECT direct');

-- ════════════════════════════════════════════════════════════════════════════
-- H. DENY aussi côté TMS — lieux_admin_only_fields_hidden_from_tms (§09 l.67)
--    app_domain='tms' + admin_tms / ops_savr → aucun accès aux colonnes sensibles.
--    Testable en V1 par simulation JWT seule (pas besoin du schéma tms.*) : le
--    REVOKE est au niveau du rôle Postgres `authenticated`, indépendant du claim.
-- ════════════════════════════════════════════════════════════════════════════
SELECT test_set_jwt('admin_tms', NULL, gen_random_uuid(), 'tms');
SELECT throws_ok(
  $$ SELECT siren, email_gestionnaire, commentaire_lieu, reference_citeo FROM plateforme.lieux $$,
  '42501', NULL,
  'H1 : admin_tms (app_domain=tms) — colonnes sensibles refusées en SELECT direct'
);

SELECT test_set_jwt('ops_savr', NULL, gen_random_uuid(), 'tms');
SELECT throws_ok(
  $$ SELECT siren, email_gestionnaire, commentaire_lieu, reference_citeo FROM plateforme.lieux $$,
  '42501', NULL,
  'H2 : ops_savr (app_domain=tms) — colonnes sensibles refusées en SELECT direct'
);

-- ════════════════════════════════════════════════════════════════════════════
-- C. La vue v_lieux_clients ne contient AUCUNE colonne sensible
-- ════════════════════════════════════════════════════════════════════════════
SELECT hasnt_column('plateforme', 'v_lieux_clients', 'commentaire_lieu',
  'C1 : commentaire_lieu absent de v_lieux_clients');
SELECT hasnt_column('plateforme', 'v_lieux_clients', 'siren',
  'C2 : siren absent de v_lieux_clients');
SELECT hasnt_column('plateforme', 'v_lieux_clients', 'email_gestionnaire',
  'C3 : email_gestionnaire absent de v_lieux_clients');
SELECT hasnt_column('plateforme', 'v_lieux_clients', 'reference_citeo',
  'C4 : reference_citeo absent de v_lieux_clients');
SELECT hasnt_column('plateforme', 'v_lieux_clients', 'commentaires_internes',
  'C5 : commentaires_internes absent de v_lieux_clients');

-- ════════════════════════════════════════════════════════════════════════════
-- D. La vue v_lieux_clients expose bien les colonnes whitelist
-- ════════════════════════════════════════════════════════════════════════════
SELECT has_column('plateforme', 'v_lieux_clients', 'nom',  'D1 : nom exposé');
SELECT has_column('plateforme', 'v_lieux_clients', 'ville', 'D2 : ville exposée');

-- ════════════════════════════════════════════════════════════════════════════
-- E. Fonctionnel : colonnes whitelist + vue restent lisibles côté client
-- ════════════════════════════════════════════════════════════════════════════
SELECT test_set_jwt('traiteur_manager', 'dd000000-0000-0000-0000-00000000000a'::uuid);

SELECT lives_ok(
  $$ SELECT id, nom, adresse_acces, code_postal, ville, type_vehicule_max
       FROM plateforme.lieux
      WHERE id = 'dd000000-0000-0000-0000-000000000b01'::uuid $$,
  'E1 : SELECT colonnes whitelist sur lieux autorisé au client'
);

SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.v_lieux_clients
    WHERE id = 'dd000000-0000-0000-0000-000000000b01'::uuid),
  1,
  'E2 : v_lieux_clients retourne le lieu rattaché de l''organisation'
);

SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.v_lieux_clients
    WHERE id = 'dd000000-0000-0000-0000-000000000b02'::uuid),
  0,
  'E3 : v_lieux_clients exclut le lieu hors périmètre (RLS ligne préservée)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- F. L'ancienne vue v_lieux_public n'existe plus (renommée)
-- ════════════════════════════════════════════════════════════════════════════
SELECT is(
  (SELECT COUNT(*)::int FROM pg_views
    WHERE schemaname = 'plateforme' AND viewname = 'v_lieux_public'),
  0,
  'F1 : v_lieux_public supprimée (renommée v_lieux_clients)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- G. service_role conserve l'accès complet (lecture staff via createAdminClient)
-- ════════════════════════════════════════════════════════════════════════════
SELECT test_as_service_role();

SELECT lives_ok(
  $$ SELECT siren, email_gestionnaire, commentaire_lieu, reference_citeo, commentaires_internes
       FROM plateforme.lieux
      WHERE id = 'dd000000-0000-0000-0000-000000000b01'::uuid $$,
  'G1 : service_role lit les colonnes sensibles (accès staff complet préservé)'
);

SELECT test_as_superuser();
SELECT * FROM finish();
ROLLBACK;

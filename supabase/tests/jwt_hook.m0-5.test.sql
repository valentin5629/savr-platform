-- =============================================================================
-- Tests pgTAP M0.5 — Hook JWT custom access token
-- plateforme.fn_custom_access_token(jsonb) — AUTH-7 / AUTH-8
-- =============================================================================
-- Définition à HEAD : 20260612000002 (création) puis 20260617180000 (fix : le
-- rôle métier passe du claim réservé `role` au claim `user_role`, `role` reste
-- 'authenticated' pour PostgREST). On vérifie la dernière version appliquée.
--
-- La fonction est SECURITY DEFINER, EXECUTE révoqué à authenticated/anon/public
-- (réservée à supabase_auth_admin). On l'appelle DIRECTEMENT avec un event forgé,
-- sous le rôle postgres (superuser pgTAP) qui bypasse le REVOKE — pas de JWT à
-- poser ici (la fonction lit `event->>'user_id'`, pas auth.uid()/auth.jwt()).
-- =============================================================================

BEGIN;
SELECT plan(7);

-- ─── Fixture : 1 organisation + 1 user rattaché ──────────────────────────────
INSERT INTO plateforme.organisations
  (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES
  ('a99a0009-0000-0000-0000-000000000001'::uuid, 'Org Hook', 'traiteur',
   true, false, '99999999900001', 'hook@test.com');

INSERT INTO plateforme.users
  (id, organisation_id, email, prenom, nom, role)
VALUES
  ('a99a0001-0000-0000-0000-000000000001'::uuid,
   'a99a0009-0000-0000-0000-000000000001'::uuid,
   'manager@hook.test', 'Hook', 'Manager', 'traiteur_manager');

-- =============================================================================
-- AUTH-7 — user AVEC profil : claims métier injectés dans le JWT
-- =============================================================================
SELECT is(
  plateforme.fn_custom_access_token(
    '{"user_id":"a99a0001-0000-0000-0000-000000000001",
      "claims":{"sub":"a99a0001-0000-0000-0000-000000000001","role":"authenticated","aud":"authenticated"}}'::jsonb
  )->'claims'->>'user_role',
  'traiteur_manager',
  'AUTH-7 : claim user_role = rôle métier du profil'
);

SELECT is(
  plateforme.fn_custom_access_token(
    '{"user_id":"a99a0001-0000-0000-0000-000000000001",
      "claims":{"sub":"a99a0001-0000-0000-0000-000000000001","role":"authenticated"}}'::jsonb
  )->'claims'->>'organisation_id',
  'a99a0009-0000-0000-0000-000000000001',
  'AUTH-7 : claim organisation_id = org du profil'
);

SELECT is(
  plateforme.fn_custom_access_token(
    '{"user_id":"a99a0001-0000-0000-0000-000000000001",
      "claims":{"sub":"a99a0001-0000-0000-0000-000000000001","role":"authenticated"}}'::jsonb
  )->'claims'->>'app_domain',
  'plateforme',
  'AUTH-7 : claim app_domain = plateforme (fixe V1)'
);

SELECT is(
  plateforme.fn_custom_access_token(
    '{"user_id":"a99a0001-0000-0000-0000-000000000001",
      "claims":{"sub":"a99a0001-0000-0000-0000-000000000001","role":"authenticated"}}'::jsonb
  )->'claims'->>'organisation_type',
  'traiteur',
  'AUTH-7 : claim organisation_type = type de l''org'
);

-- Garde anti-régression du fix 20260617180000 : le claim réservé `role` (lu par
-- PostgREST pour SET ROLE) n'est JAMAIS écrasé par le rôle métier.
SELECT is(
  plateforme.fn_custom_access_token(
    '{"user_id":"a99a0001-0000-0000-0000-000000000001",
      "claims":{"sub":"a99a0001-0000-0000-0000-000000000001","role":"authenticated"}}'::jsonb
  )->'claims'->>'role',
  'authenticated',
  'AUTH-7 : claim réservé `role` reste authenticated (non écrasé)'
);

-- =============================================================================
-- AUTH-8 — user SANS profil : JWT retourné INTACT
-- =============================================================================
SELECT is(
  plateforme.fn_custom_access_token(
    '{"user_id":"b00b0002-0000-0000-0000-000000000002",
      "claims":{"sub":"b00b0002-0000-0000-0000-000000000002","role":"authenticated"}}'::jsonb
  ),
  '{"user_id":"b00b0002-0000-0000-0000-000000000002",
    "claims":{"sub":"b00b0002-0000-0000-0000-000000000002","role":"authenticated"}}'::jsonb,
  'AUTH-8 : aucun profil users → event retourné intact'
);

SELECT ok(
  plateforme.fn_custom_access_token(
    '{"user_id":"b00b0002-0000-0000-0000-000000000002",
      "claims":{"sub":"b00b0002-0000-0000-0000-000000000002","role":"authenticated"}}'::jsonb
  )->'claims'->>'user_role' IS NULL,
  'AUTH-8 : aucun claim métier user_role injecté pour un user sans profil'
);

SELECT * FROM finish();
ROLLBACK;

-- =============================================================================
-- R14 · BL-P1-AUTH-01 — Hook JWT : injection du claim `impersonator_id`
-- =============================================================================
-- Vérifie que `plateforme.fn_custom_access_token` (migration 20260701120000)
-- expose `impersonator_id` en claim top-level, LU depuis
-- `event->'claims'->'app_metadata'->>'impersonator_id'`, UNIQUEMENT si la fenêtre
-- `impersonation_expires_at` n'est pas expirée (fin auto 1h, §09 §7 + §15 §2.3).
--
-- Même approche que jwt_hook.m0-5 : fonction SECURITY DEFINER appelée directement
-- avec un event forgé, sous le rôle postgres (bypass REVOKE), pas de JWT à poser.
-- =============================================================================

BEGIN;
SELECT plan(5);

-- ─── Fixture : 1 organisation + 1 user (le user IMPERSONÉ) ───────────────────
INSERT INTO plateforme.organisations
  (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES
  ('a14a0009-0000-0000-0000-000000000001'::uuid, 'Org R14', 'traiteur',
   true, false, '14141414100001', 'r14@test.com');

INSERT INTO plateforme.users
  (id, organisation_id, email, prenom, nom, role)
VALUES
  ('a14a0001-0000-0000-0000-000000000001'::uuid,
   'a14a0009-0000-0000-0000-000000000001'::uuid,
   'cible@r14.test', 'Cible', 'Impersonee', 'traiteur_manager');

-- L'admin impersonateur (référence audit) — id arbitraire.
-- (Pas de FK vérifiée par le hook : c'est un simple passage de valeur.)

-- =============================================================================
-- AUTH-01a — app_metadata.impersonator_id + expiration FUTURE → claim injecté
-- =============================================================================
SELECT is(
  plateforme.fn_custom_access_token(
    ('{"user_id":"a14a0001-0000-0000-0000-000000000001",'
     || '"claims":{"sub":"a14a0001-0000-0000-0000-000000000001","role":"authenticated",'
     || '"app_metadata":{"impersonator_id":"adm00000-0000-0000-0000-0000000000aa",'
     || '"impersonation_expires_at":"2999-01-01T00:00:00Z"}}}')::jsonb
  )->'claims'->>'impersonator_id',
  'adm00000-0000-0000-0000-0000000000aa',
  'AUTH-01a : claim impersonator_id injecté quand la fenêtre 1h est active'
);

-- Le rôle métier reste injecté en parallèle (pas d'effet de bord).
SELECT is(
  plateforme.fn_custom_access_token(
    ('{"user_id":"a14a0001-0000-0000-0000-000000000001",'
     || '"claims":{"sub":"a14a0001-0000-0000-0000-000000000001","role":"authenticated",'
     || '"app_metadata":{"impersonator_id":"adm00000-0000-0000-0000-0000000000aa",'
     || '"impersonation_expires_at":"2999-01-01T00:00:00Z"}}}')::jsonb
  )->'claims'->>'user_role',
  'traiteur_manager',
  'AUTH-01a : user_role toujours injecté (rôle métier du user impersoné)'
);

-- =============================================================================
-- AUTH-01b — expiration PASSÉE → claim NON injecté (fin auto 1h côté serveur)
-- =============================================================================
SELECT ok(
  plateforme.fn_custom_access_token(
    ('{"user_id":"a14a0001-0000-0000-0000-000000000001",'
     || '"claims":{"sub":"a14a0001-0000-0000-0000-000000000001","role":"authenticated",'
     || '"app_metadata":{"impersonator_id":"adm00000-0000-0000-0000-0000000000aa",'
     || '"impersonation_expires_at":"2000-01-01T00:00:00Z"}}}')::jsonb
  )->'claims'->>'impersonator_id' IS NULL,
  'AUTH-01b : impersonator_id NON injecté quand la fenêtre est expirée'
);

-- =============================================================================
-- AUTH-01c — pas d'app_metadata impersonation → claim absent (session normale)
-- =============================================================================
SELECT ok(
  plateforme.fn_custom_access_token(
    ('{"user_id":"a14a0001-0000-0000-0000-000000000001",'
     || '"claims":{"sub":"a14a0001-0000-0000-0000-000000000001","role":"authenticated"}}')::jsonb
  )->'claims'->>'impersonator_id' IS NULL,
  'AUTH-01c : session normale (aucun flag) → pas de claim impersonator_id'
);

-- =============================================================================
-- AUTH-01d — impersonator_id présent mais SANS expiration → non injecté
--            (garde-fou : jamais d'impersonation illimitée)
-- =============================================================================
SELECT ok(
  plateforme.fn_custom_access_token(
    ('{"user_id":"a14a0001-0000-0000-0000-000000000001",'
     || '"claims":{"sub":"a14a0001-0000-0000-0000-000000000001","role":"authenticated",'
     || '"app_metadata":{"impersonator_id":"adm00000-0000-0000-0000-0000000000aa"}}}')::jsonb
  )->'claims'->>'impersonator_id' IS NULL,
  'AUTH-01d : impersonator_id sans expiration → non injecté (pas d''impersonation illimitée)'
);

SELECT * FROM finish();
ROLLBACK;

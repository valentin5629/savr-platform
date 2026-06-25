-- =============================================================================
-- Tests pgTAP R7 — BL-P0-09 — RGPD : effacement (anonymisation PII) + soft-delete.
-- =============================================================================
-- Oracle § 15 §3.3 :
--   · fn_anonymize_user neutralise les PII (prenom/nom/email) + deleted_at/actif,
--     MAIS préserve la ligne user (pas de hard-delete → FK comptables rattachables)
--     et les pièces comptables qui la référencent (audit_log retenu 5 ans, §15).
--   · audit_log = métadonnées seules (jamais la PII brute).
--   · fn_anonymize_user réservé service_role → rejet sous rôle authenticated.
--   · RLS users « deleted_at IS NULL » : un user anonymisé est invisible en lecture
--     non-admin, mais reste visible à l'admin (audit RGPD).
--   · RLS demandes_suppression : self insert/select, admin all, cross-user refusé.
-- =============================================================================

BEGIN;
SELECT plan(19);

-- ─── Helpers (mêmes que m2_5) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid()
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ─── Fixture ────────────────────────────────────────────────────────────────
SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES
  ('07000001-0000-0000-0000-000000000001'::uuid, 'Savr', 'traiteur', true, false, '70000000000001', 'admin@savr.test'),
  ('07000002-0000-0000-0000-000000000001'::uuid, 'Kaspia', 'traiteur', true, false, '70000000000002', 'mgr@kaspia.test');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES
  ('07050001-0000-0000-0000-000000000001'::uuid, '07000001-0000-0000-0000-000000000001'::uuid, 'admin@savr.test',  'Admin',   'Savr',   'admin_savr'),
  ('07050002-0000-0000-0000-000000000001'::uuid, '07000002-0000-0000-0000-000000000001'::uuid, 'reader@kaspia.test','Reader',  'Kaspia', 'traiteur_manager'),
  ('07050003-0000-0000-0000-000000000001'::uuid, '07000002-0000-0000-0000-000000000001'::uuid, 'victim@kaspia.test','Victime', 'Kaspia', 'traiteur_commercial');

-- Pièce comptable de référence (proxy facture/bordereau) : audit retenu 5 ans (§15),
-- référence la victime → doit survivre à l'anonymisation, FK intacte.
INSERT INTO plateforme.audit_log (user_id, role, action, table_name, record_id)
VALUES ('07050003-0000-0000-0000-000000000001'::uuid, 'traiteur_commercial',
        'facture_emise', 'plateforme.factures', '07050003-0000-0000-0000-000000000001'::uuid);

-- Demande de suppression de la victime (en_attente).
INSERT INTO plateforme.demandes_suppression (id, user_id, justification)
VALUES ('07d50001-0000-0000-0000-000000000001'::uuid,
        '07050003-0000-0000-0000-000000000001'::uuid, 'Je quitte la société');

-- ─── 1. Avant anonymisation : la victime est visible par un manager de son org ──
SELECT test_set_jwt('traiteur_manager', '07000002-0000-0000-0000-000000000001'::uuid,
                    '07050002-0000-0000-0000-000000000001'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.users WHERE id='07050003-0000-0000-0000-000000000001'::uuid),
  1, 'avant : victime (vivante) visible par un manager de la même org');

-- ─── 2. fn_anonymize_user sous authenticated → REJET (réservé service_role) ─────
SELECT throws_ok(
  $$ SELECT plateforme.fn_anonymize_user(
       '07050003-0000-0000-0000-000000000001'::uuid, 'hack', '07050002-0000-0000-0000-000000000001'::uuid) $$,
  '42501',
  NULL,
  'fn_anonymize_user : EXECUTE refusé au rôle authenticated (non service_role)');

-- ─── 3. Anonymisation (service-role simulé = superuser, auteur = admin) ──────────
SELECT test_as_superuser();
SELECT lives_ok(
  $$ SELECT plateforme.fn_anonymize_user(
       '07050003-0000-0000-0000-000000000001'::uuid,
       'Validation RGPD demande #1',
       '07050001-0000-0000-0000-000000000001'::uuid,
       '07d50001-0000-0000-0000-000000000001'::uuid) $$,
  'fn_anonymize_user : exécution sans erreur (service_role)');

-- PII neutralisées
SELECT is((SELECT prenom FROM plateforme.users WHERE id='07050003-0000-0000-0000-000000000001'::uuid),
  '(anonymisé)', 'PII : prenom anonymisé');
SELECT is((SELECT nom FROM plateforme.users WHERE id='07050003-0000-0000-0000-000000000001'::uuid),
  '(anonymisé)', 'PII : nom anonymisé');
SELECT ok(
  (SELECT email LIKE 'anonymise+%@anonymise.invalid'
     FROM plateforme.users WHERE id='07050003-0000-0000-0000-000000000001'::uuid),
  'PII : email remplacé par un placeholder unique');
SELECT ok(
  (SELECT deleted_at IS NOT NULL AND actif = false
     FROM plateforme.users WHERE id='07050003-0000-0000-0000-000000000001'::uuid),
  'soft-delete : deleted_at posé + actif=false');

-- Pièce comptable PRÉSERVÉE : ligne user conservée (pas de hard-delete) + audit
-- référençant la victime intact (FK rattachable).
SELECT is(
  (SELECT count(*)::int FROM plateforme.users WHERE id='07050003-0000-0000-0000-000000000001'::uuid),
  1, 'comptable : la ligne user est PRÉSERVÉE (pas de hard-delete → FK valides)');
SELECT is(
  (SELECT count(*)::int FROM plateforme.audit_log
     WHERE action='facture_emise' AND user_id='07050003-0000-0000-0000-000000000001'::uuid),
  1, 'comptable : la pièce (audit_log facture_emise) référençant la victime survit');

-- Demande clôturée
SELECT is(
  (SELECT statut::text FROM plateforme.demandes_suppression WHERE id='07d50001-0000-0000-0000-000000000001'::uuid),
  'validee', 'workflow : demande passée à validee');
SELECT is(
  (SELECT traitee_par FROM plateforme.demandes_suppression WHERE id='07d50001-0000-0000-0000-000000000001'::uuid),
  '07050001-0000-0000-0000-000000000001'::uuid, 'workflow : traitee_par = admin validant');

-- Audit RGPD : 1 ligne, motif = justification, AUCUNE PII brute dans new_values
SELECT is(
  (SELECT count(*)::int FROM plateforme.audit_log
     WHERE action='rgpd_anonymisation' AND record_id='07050003-0000-0000-0000-000000000001'::uuid
       AND motif='Validation RGPD demande #1'),
  1, 'audit : 1 ligne rgpd_anonymisation (auteur + motif)');
SELECT ok(
  (SELECT NOT (new_values ? 'prenom' OR new_values ? 'nom' OR new_values ? 'email')
     FROM plateforme.audit_log
     WHERE action='rgpd_anonymisation' AND record_id='07050003-0000-0000-0000-000000000001'::uuid),
  'audit : new_values ne stocke PAS la PII brute (§15)');

-- ─── 4. RLS users deleted_at IS NULL : invisible non-admin, visible admin ───────
SELECT test_set_jwt('traiteur_manager', '07000002-0000-0000-0000-000000000001'::uuid,
                    '07050002-0000-0000-0000-000000000001'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.users WHERE id='07050003-0000-0000-0000-000000000001'::uuid),
  0, 'RLS : victime anonymisée INVISIBLE au manager (deleted_at IS NULL)');

SELECT test_set_jwt('admin_savr', NULL, '07050001-0000-0000-0000-000000000001'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.users WHERE id='07050003-0000-0000-0000-000000000001'::uuid),
  1, 'RLS : victime anonymisée VISIBLE à l''admin (audit RGPD conservé)');

-- immutabilité : la victime (soft-deleted) ne peut plus rectifier son profil.
SELECT test_set_jwt('traiteur_commercial', '07000002-0000-0000-0000-000000000001'::uuid,
                    '07050003-0000-0000-0000-000000000001'::uuid);
UPDATE plateforme.users SET prenom='dé-anonymisé'
  WHERE id='07050003-0000-0000-0000-000000000001'::uuid;  -- RLS USING → 0 ligne
SELECT test_as_superuser();
SELECT is(
  (SELECT prenom FROM plateforme.users WHERE id='07050003-0000-0000-0000-000000000001'::uuid),
  '(anonymisé)', 'RLS : victime anonymisée NE PEUT PLUS éditer son profil (usr_self_update gaté)');

-- ─── 5. RLS demandes_suppression : self vs cross-user vs admin ──────────────────
-- self insert : la victime ne peut créer une demande que pour elle-même.
SELECT test_set_jwt('traiteur_manager', '07000002-0000-0000-0000-000000000001'::uuid,
                    '07050002-0000-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.demandes_suppression (user_id)
     VALUES ('07050003-0000-0000-0000-000000000001'::uuid) $$,
  '42501', NULL,
  'RLS : self-insert d''une demande pour AUTRUI refusé (WITH CHECK user_id=auth.uid())');

-- cross-user select : le reader ne voit pas la demande de la victime.
SELECT is(
  (SELECT count(*)::int FROM plateforme.demandes_suppression
     WHERE user_id='07050003-0000-0000-0000-000000000001'::uuid),
  0, 'RLS : un autre user ne lit PAS la demande de la victime');

-- admin select : l'admin voit la file.
SELECT test_set_jwt('admin_savr', NULL, '07050001-0000-0000-0000-000000000001'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.demandes_suppression
     WHERE user_id='07050003-0000-0000-0000-000000000001'::uuid),
  1, 'RLS : admin lit la demande (file in-app)');

SELECT finish();
ROLLBACK;

-- =============================================================================
-- Tests pgTAP M0.6 — R10b BL-P1-API-01 — RLS ops column-level / anti-escalade
-- =============================================================================
-- Prouve, sous le VRAI rôle Postgres `authenticated` + claim `user_role` (jamais
-- `role` métier — cf. f_app_role()), que :
--   • AUCUN user authentifié (ops OU traiteur) ne peut s'auto-promouvoir admin_savr
--     (escalade de privilège — trigger fn_users_block_role_escalation) ;
--   • admin_savr PEUT promouvoir (contrôle positif — pas de sur-blocage) ;
--   • ops_savr ne peut pas écrire montant facture / habilitation+désactivation asso /
--     tarif refacturé org (matrice §09 l.397/402-403/407) mais PEUT éditer les colonnes
--     opérationnelles (contrôle positif).
-- =============================================================================

BEGIN;
SELECT plan(11);

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'user_role', p_role,
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

-- =====================================================================
-- FIXTURE
-- =====================================================================
SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal, tarif_refacture_pax_zd)
VALUES ('0a900001-0000-0000-0000-0000000000a1'::uuid, 'Org A', 'traiteur', true, false, '11111111100001', 'a@test.com', 1.50);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES
  -- ops_savr
  ('05e70901-0000-0000-0000-0000000000a1'::uuid, '0a900001-0000-0000-0000-0000000000a1'::uuid, 'ops@savr.test', 'O', 'PS', 'ops_savr'),
  -- traiteur_manager (preuve : l'escalade ne touche pas que ops)
  ('05e70902-0000-0000-0000-0000000000a1'::uuid, '0a900001-0000-0000-0000-0000000000a1'::uuid, 'mgr@a.test', 'M', 'GR', 'traiteur_manager'),
  -- admin_savr (contrôle positif promotion)
  ('05e70903-0000-0000-0000-0000000000a1'::uuid, '0a900001-0000-0000-0000-0000000000a1'::uuid, 'adm@savr.test', 'A', 'DM', 'admin_savr'),
  -- cible de la promotion légitime par l'admin
  ('05e70904-0000-0000-0000-0000000000a1'::uuid, '0a900001-0000-0000-0000-0000000000a1'::uuid, 'cible@a.test', 'C', 'IB', 'traiteur_commercial');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('ee109001-0000-0000-0000-0000000000a1'::uuid, '0a900001-0000-0000-0000-0000000000a1'::uuid, 'A SA', '11111111100001', '1 rue', '75001', 'Paris');

INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, numero_facture, montant_ht, montant_tva, montant_ttc, statut)
VALUES ('fac09001-0000-0000-0000-0000000000a1'::uuid, '0a900001-0000-0000-0000-0000000000a1'::uuid, 'ee109001-0000-0000-0000-0000000000a1'::uuid, 'FAC-R10B-001', 100.00, 20.00, 120.00, 'brouillon');

INSERT INTO plateforme.associations (id, nom, adresse, region, ville, contact_email, description_rapport_impact, habilitee_attestation_fiscale, actif)
VALUES ('a5500901-0000-0000-0000-0000000000a1'::uuid, 'Asso R10b', '1 rue', 'idf', 'Paris', 'asso@test.com', 'Description suffisamment longue pour la contrainte.', false, true);

-- =====================================================================
-- 1-3 — ESCALADE DE PRIVILÈGE (users.role → admin_savr)
-- =====================================================================
SELECT test_set_jwt('ops_savr', '0a900001-0000-0000-0000-0000000000a1'::uuid, '05e70901-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'admin_savr' WHERE id = '05e70901-0000-0000-0000-0000000000a1'::uuid $$,
  '42501',
  NULL,
  'ops_savr NE PEUT PAS s''auto-promouvoir admin_savr (escalade refusée)'
);

SELECT test_set_jwt('traiteur_manager', '0a900001-0000-0000-0000-0000000000a1'::uuid, '05e70902-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'admin_savr' WHERE id = '05e70902-0000-0000-0000-0000000000a1'::uuid $$,
  '42501',
  NULL,
  'traiteur_manager NE PEUT PAS s''auto-promouvoir admin_savr (escalade large, pas que ops)'
);

SELECT test_set_jwt('admin_savr', '0a900001-0000-0000-0000-0000000000a1'::uuid, '05e70903-0000-0000-0000-0000000000a1'::uuid);
SELECT lives_ok(
  $$ UPDATE plateforme.users SET role = 'admin_savr' WHERE id = '05e70904-0000-0000-0000-0000000000a1'::uuid $$,
  'admin_savr PEUT promouvoir un user en admin_savr (pas de sur-blocage)'
);

-- =====================================================================
-- 4-5 — FACTURES : montant admin-only / colonnes ops-OK
-- =====================================================================
SELECT test_set_jwt('ops_savr', '0a900001-0000-0000-0000-0000000000a1'::uuid, '05e70901-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.factures SET montant_ht = 999.00 WHERE id = 'fac09001-0000-0000-0000-0000000000a1'::uuid $$,
  '42501',
  NULL,
  'ops_savr NE PEUT PAS modifier factures.montant_ht (§09 l.397)'
);
SELECT lives_ok(
  $$ UPDATE plateforme.factures SET devise = 'USD' WHERE id = 'fac09001-0000-0000-0000-0000000000a1'::uuid $$,
  'ops_savr PEUT modifier une colonne non-montant de factures (pas de sur-blocage)'
);
SELECT throws_ok(
  $$ UPDATE plateforme.factures SET statut = 'annulee' WHERE id = 'fac09001-0000-0000-0000-0000000000a1'::uuid $$,
  '42501',
  NULL,
  'ops_savr NE PEUT PAS annuler une facture (statut=annulee, §09 l.398)'
);

-- =====================================================================
-- 6-8 — ASSOCIATIONS : habilitation + désactivation admin-only / contacts ops-OK
-- =====================================================================
SELECT throws_ok(
  $$ UPDATE plateforme.associations SET habilitee_attestation_fiscale = true WHERE id = 'a5500901-0000-0000-0000-0000000000a1'::uuid $$,
  '42501',
  NULL,
  'ops_savr NE PEUT PAS modifier associations.habilitee_attestation_fiscale (§09 l.402)'
);
SELECT throws_ok(
  $$ UPDATE plateforme.associations SET actif = false WHERE id = 'a5500901-0000-0000-0000-0000000000a1'::uuid $$,
  '42501',
  NULL,
  'ops_savr NE PEUT PAS désactiver une association (actif=false, §09 l.403)'
);
SELECT lives_ok(
  $$ UPDATE plateforme.associations SET contact_telephone = '0600000000' WHERE id = 'a5500901-0000-0000-0000-0000000000a1'::uuid $$,
  'ops_savr PEUT éditer un contact d''association (pas de sur-blocage, §09 l.400)'
);

-- =====================================================================
-- 9-10 — ORGANISATIONS : tarif refacturé admin-only / infos ops-OK
-- =====================================================================
SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET tarif_refacture_pax_zd = 9.99 WHERE id = '0a900001-0000-0000-0000-0000000000a1'::uuid $$,
  '42501',
  NULL,
  'ops_savr NE PEUT PAS modifier organisations.tarif_refacture_pax_zd (§09 l.407)'
);
SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET nom = 'Org A (maj ops)' WHERE id = '0a900001-0000-0000-0000-0000000000a1'::uuid $$,
  'ops_savr PEUT modifier les infos générales d''une organisation (pas de sur-blocage, §09 l.406)'
);

SELECT * FROM finish();
ROLLBACK;

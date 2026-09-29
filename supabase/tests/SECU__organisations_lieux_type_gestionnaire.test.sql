-- =============================================================================
-- pgTAP — organisations_lieux : seule une organisation gestionnaire_lieux peut
-- être rattachée à un lieu (trigger P0047).
-- Migration prouvée : 20260929140000_plateforme_organisations_lieux_type_gestionnaire
-- CDC §04 `organisations_lieux` (note V1 2026-05-07) — arbitrage Val 2026-09-29
-- =============================================================================
-- POURQUOI. `f_collecte_visible` ouvre les collectes datées d'un lieu à toute
-- organisation rattachée, sans garde de rôle. L'assert 9 rejoue la fuite mesurée
-- le 2026-09-29 : un traiteur qu'on tente de rattacher ne voit toujours pas la
-- collecte d'un autre traiteur sur ce lieu.
--
-- ⚠ NON-VACUITÉ : chaque refus est doublé d'une écriture acceptée (gestionnaire)
--   sous le MÊME rôle, sans quoi un refus prouverait seulement que l'écriture
--   est impossible pour une autre raison.
-- =============================================================================

BEGIN;
SELECT plan(11);

CREATE OR REPLACE FUNCTION olt_superuser() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

CREATE OR REPLACE FUNCTION olt_service_role() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', 'service_role', true);
END $$;

CREATE OR REPLACE FUNCTION olt_jwt(p_role text, p_org uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'user_role', p_role,
    'organisation_id', p_org, 'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
SELECT olt_superuser();

INSERT INTO plateforme.organisations (id, nom, type, siret, actif, est_shadow) VALUES
  ('0e1a0001-0000-0000-0000-000000000001'::uuid, 'OLT Gest',     'gestionnaire_lieux',  '94000000000001', true, false),
  ('0e1a0001-0000-0000-0000-000000000002'::uuid, 'OLT Traiteur', 'traiteur',            '94000000000002', true, false),
  ('0e1a0001-0000-0000-0000-000000000003'::uuid, 'OLT Agence',   'agence',              '94000000000003', true, false),
  ('0e1a0001-0000-0000-0000-000000000004'::uuid, 'OLT Client',   'client_organisateur', '94000000000004', true, false),
  ('0e1a0001-0000-0000-0000-000000000005'::uuid, 'OLT Prog',     'traiteur',            '94000000000005', true, false);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('0e1a0002-0000-0000-0000-000000000005'::uuid, '0e1a0001-0000-0000-0000-000000000005'::uuid,
   'm@olt-prog.test', 'M', 'P', 'traiteur_manager');

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('0e1a0005-0000-0000-0000-000000000005'::uuid, '0e1a0001-0000-0000-0000-000000000005'::uuid,
   'OLT Prog SAS', '94000000000005', '5 rue test', '75005', 'Paris');

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('0e1a0006-0000-0000-0000-000000000001'::uuid, 'olt_cocktail', 'Cocktail OLT');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('0e1a0003-0000-0000-0000-000000000001'::uuid, 'OLT L1', '1 r', '75001', 'Paris', 'fourgon'),
  ('0e1a0003-0000-0000-0000-000000000002'::uuid, 'OLT L2', '2 r', '75002', 'Paris', 'fourgon'),
  ('0e1a0003-0000-0000-0000-000000000003'::uuid, 'OLT L3', '3 r', '75003', 'Paris', 'fourgon');

-- Collecte DATÉE d'un autre traiteur (OLT Prog) sur L3 : l'objet de la fuite.
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone) VALUES
  ('0e1a0004-0000-0000-0000-000000000001'::uuid, '0e1a0001-0000-0000-0000-000000000005'::uuid,
   '0e1a0003-0000-0000-0000-000000000003'::uuid, '0e1a0001-0000-0000-0000-000000000005'::uuid,
   '0e1a0005-0000-0000-0000-000000000005'::uuid, '0e1a0002-0000-0000-0000-000000000005'::uuid,
   '0e1a0006-0000-0000-0000-000000000001'::uuid, current_date + 5, 80, 'Alice', '0601020304');

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
VALUES ('0e1a0007-0000-0000-0000-000000000001'::uuid, '0e1a0004-0000-0000-0000-000000000001'::uuid,
        'zero_dechet', 'validee', 'non_envoye', current_date + 5, '23:00');

-- ── 1. Chemin des routes admin : service_role ────────────────────────────────
SELECT olt_service_role();

SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
     VALUES ('0e1a0001-0000-0000-0000-000000000002', '0e1a0003-0000-0000-0000-000000000001') $$,
  'P0047', NULL,
  'service_role : rattacher un TRAITEUR est refusé'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
     VALUES ('0e1a0001-0000-0000-0000-000000000003', '0e1a0003-0000-0000-0000-000000000001') $$,
  'P0047', NULL,
  'service_role : rattacher une AGENCE est refusé'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
     VALUES ('0e1a0001-0000-0000-0000-000000000004', '0e1a0003-0000-0000-0000-000000000001') $$,
  'P0047', NULL,
  'service_role : rattacher un CLIENT ORGANISATEUR est refusé'
);

SELECT lives_ok(
  $$ INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
     VALUES ('0e1a0001-0000-0000-0000-000000000001', '0e1a0003-0000-0000-0000-000000000001') $$,
  'NON-VACUITÉ service_role : rattacher un GESTIONNAIRE passe'
);

-- ── 2. UPDATE : repointer un rattachement vers un non-gestionnaire ───────────
SELECT throws_ok(
  $$ UPDATE plateforme.organisations_lieux
        SET organisation_id = '0e1a0001-0000-0000-0000-000000000002'
      WHERE lieu_id = '0e1a0003-0000-0000-0000-000000000001' $$,
  'P0047', NULL,
  'service_role : repointer un rattachement vers un traiteur est refusé'
);

SELECT lives_ok(
  $$ UPDATE plateforme.organisations_lieux
        SET lieu_id = '0e1a0003-0000-0000-0000-000000000002'
      WHERE organisation_id = '0e1a0001-0000-0000-0000-000000000001' $$,
  'NON-VACUITÉ : changer le LIEU d''un rattachement gestionnaire passe'
);

-- ── 3. Chemin SQL direct (scripts, migration V5) : superuser ─────────────────
SELECT olt_superuser();

SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
     VALUES ('0e1a0001-0000-0000-0000-000000000002', '0e1a0003-0000-0000-0000-000000000003') $$,
  'P0047', NULL,
  'superuser : rattacher un traiteur est refusé (scripts, migration V5)'
);

-- ── 4. Fonction fermée (P0 #263) ─────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated',
    'plateforme.fn_trg_organisations_lieux_type_gestionnaire()', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'plateforme.fn_trg_organisations_lieux_type_gestionnaire()', 'EXECUTE'),
  'fonction du trigger : EXECUTE retiré à authenticated et anon'
);

-- ── 5. La fuite mesurée reste fermée ─────────────────────────────────────────
-- Le traiteur n'a pu être rattaché à L3 (assert 7) : il ne lit pas la collecte
-- d'OLT Prog. Contrôle positif : OLT Prog, lui, la lit.
SELECT olt_jwt('traiteur_manager', '0e1a0001-0000-0000-0000-000000000002'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes
    WHERE id = '0e1a0007-0000-0000-0000-000000000001'::uuid),
  0,
  'traiteur non rattachable : la collecte d''un autre traiteur sur le lieu reste invisible'
);

SELECT olt_jwt('traiteur_manager', '0e1a0001-0000-0000-0000-000000000005'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes
    WHERE id = '0e1a0007-0000-0000-0000-000000000001'::uuid),
  1,
  'NON-VACUITÉ : le traiteur programmateur lit bien sa collecte'
);

-- ── 6. Le trigger est bien posé sur la table ─────────────────────────────────
SELECT olt_superuser();
SELECT has_trigger(
  'plateforme', 'organisations_lieux', 'trg_organisations_lieux_type_gestionnaire',
  'trigger trg_organisations_lieux_type_gestionnaire présent'
);

SELECT * FROM finish();
ROLLBACK;

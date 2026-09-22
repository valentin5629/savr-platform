-- =============================================================================
-- pgTAP — plateforme.lieux, 4e branche SELECT « traiteur opérationnel »
-- Migration prouvée : 20260921140000_plateforme_lieux_select_traiteur_operationnel
-- §09 Authentification et permissions (l.192-193) — arbitrage Val 2026-09-21
-- =============================================================================
-- Ce fichier prouve l'ÉTENDUE EXACTE d'un ÉLARGISSEMENT D'ACCÈS (CLAUDE.md
-- §12-2bis) : ce qui s'ouvre, ET tout ce qui NE s'ouvre PAS.
--
-- ⚠ Tous les asserts tournent sous `role = 'authenticated'` avec
--   `request.jwt.claims` simulé. Sous `service_role`/superuser la RLS est
--   BYPASSÉE et la suite serait verte par construction.
--
-- ⚠ NON-VACUITÉ : chaque assert négatif (« ne voit pas le lieu ») est doublé
--   d'un contrôle positif prouvant que la donnée EXISTE et que la sous-requête
--   n'est pas vide — sans quoi un 0 ne prouverait rien.
--
-- Rappel d'étendue (mesuré) : la RLS de la table interne s'applique DANS le
-- sous-SELECT d'une policy. Le sous-SELECT sur `evenements` est donc lui-même
-- borné par evt_*_select. La branche 4 ne peut pas ouvrir au-delà des
-- événements que le traiteur lit déjà.
-- =============================================================================

BEGIN;
SELECT plan(19);

-- ── Helpers JWT ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role    text,
  p_org_id  uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
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

-- Compte les lieux visibles portant un id donné, sous l'identité courante.
CREATE OR REPLACE FUNCTION test_voit_lieu(p_lieu uuid) RETURNS int
LANGUAGE sql AS $$ SELECT count(*)::int FROM plateforme.lieux WHERE id = p_lieu $$;

CREATE OR REPLACE FUNCTION test_voit_evenement(p_evt uuid) RETURNS int
LANGUAGE sql AS $$ SELECT count(*)::int FROM plateforme.evenements WHERE id = p_evt $$;

-- ── Fixtures (superuser) ─────────────────────────────────────────────────────
SELECT test_as_superuser();

-- Organisations : T1 opérateur, T2 concurrent, AG programmatrice,
-- CO client organisateur (aussi traiteur opérationnel sur E8), GL gestionnaire.
INSERT INTO plateforme.organisations (id, nom, type, siret, actif, est_shadow) VALUES
  ('0b6a0001-0000-0000-0000-000000000001'::uuid, 'Traiteur Op T1',  'traiteur',            '99000000000001', true, false),
  ('0b6a0001-0000-0000-0000-000000000002'::uuid, 'Traiteur Conc T2','traiteur',            '99000000000002', true, false),
  ('0b6a0001-0000-0000-0000-000000000003'::uuid, 'Agence Prog AG',  'agence',              '99000000000003', true, false),
  ('0b6a0001-0000-0000-0000-000000000004'::uuid, 'Client Orga CO',  'client_organisateur', '99000000000004', true, false),
  ('0b6a0001-0000-0000-0000-000000000005'::uuid, 'Gestionnaire GL', 'gestionnaire_lieux',  '99000000000005', true, false);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('0b6a0002-0000-0000-0000-000000000001'::uuid, '0b6a0001-0000-0000-0000-000000000001'::uuid, 'm@t1.test',  'M', 'T1', 'traiteur_manager'),
  ('0b6a0002-0000-0000-0000-000000000003'::uuid, '0b6a0001-0000-0000-0000-000000000003'::uuid, 'a@ag.test',  'A', 'AG', 'agence');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('0b6a0005-0000-0000-0000-000000000003'::uuid, '0b6a0001-0000-0000-0000-000000000003'::uuid, 'Agence Prog AG SAS', '99000000000003', '3 rue test', '75003', 'Paris'),
  ('0b6a0005-0000-0000-0000-000000000001'::uuid, '0b6a0001-0000-0000-0000-000000000001'::uuid, 'Traiteur Op T1 SARL','99000000000001', '1 rue test', '75001', 'Paris');

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('0b6a0006-0000-0000-0000-000000000001'::uuid, 'cocktail_lieux_traiteur_op', 'Cocktail test branche 4');

-- Lieux : un par situation à prouver.
INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('0b6a0003-0000-0000-0000-000000000001'::uuid, 'L1 evt tiers date',      '1 r', '75001', 'Paris', 'fourgon'),
  ('0b6a0003-0000-0000-0000-000000000002'::uuid, 'L2 evt tiers non date',  '2 r', '75002', 'Paris', 'fourgon'),
  ('0b6a0003-0000-0000-0000-000000000003'::uuid, 'L3 evt du concurrent',   '3 r', '75003', 'Paris', 'fourgon'),
  ('0b6a0003-0000-0000-0000-000000000004'::uuid, 'L4 co non date',         '4 r', '75004', 'Paris', 'fourgon'),
  ('0b6a0003-0000-0000-0000-000000000005'::uuid, 'L5 rattache au GL',      '5 r', '75005', 'Paris', 'fourgon'),
  ('0b6a0003-0000-0000-0000-000000000006'::uuid, 'L6 mon propre evt',      '6 r', '75006', 'Paris', 'fourgon'),
  ('0b6a0003-0000-0000-0000-000000000007'::uuid, 'L7 co date',             '7 r', '75007', 'Paris', 'fourgon'),
  ('0b6a0003-0000-0000-0000-000000000008'::uuid, 'L8 co et traiteur op',   '8 r', '75008', 'Paris', 'fourgon');

-- Branche 1 : lieu rattaché à l'organisation du gestionnaire.
INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('0b6a0001-0000-0000-0000-000000000005'::uuid, '0b6a0003-0000-0000-0000-000000000005'::uuid);

-- Événements. `traiteur_operationnel_organisation_id` est NOT NULL : il est
-- toujours renseigné, c'est bien le rôle de l'appelant qui discrimine.
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  client_organisateur_organisation_id, entite_facturation_id, created_by,
  type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES
  -- E1 : programmé par l'agence, opéré par T1, DATÉ → le cas corrigé.
  ('0b6a0004-0000-0000-0000-000000000001'::uuid, '0b6a0001-0000-0000-0000-000000000003'::uuid,
   '0b6a0003-0000-0000-0000-000000000001'::uuid, '0b6a0001-0000-0000-0000-000000000001'::uuid,
   NULL, '0b6a0005-0000-0000-0000-000000000003'::uuid, '0b6a0002-0000-0000-0000-000000000003'::uuid,
   '0b6a0006-0000-0000-0000-000000000001'::uuid, current_date + 10, 100, 'Alice', '0601020304'),
  -- E2 : idem mais NON DATÉ → Q1 (pas de garde de date sur la branche 4).
  ('0b6a0004-0000-0000-0000-000000000002'::uuid, '0b6a0001-0000-0000-0000-000000000003'::uuid,
   '0b6a0003-0000-0000-0000-000000000002'::uuid, '0b6a0001-0000-0000-0000-000000000001'::uuid,
   NULL, '0b6a0005-0000-0000-0000-000000000003'::uuid, '0b6a0002-0000-0000-0000-000000000003'::uuid,
   '0b6a0006-0000-0000-0000-000000000001'::uuid, NULL, 100, 'Alice', '0601020304'),
  -- E3 : même agence, opéré par le CONCURRENT T2 → cloisonnement.
  ('0b6a0004-0000-0000-0000-000000000003'::uuid, '0b6a0001-0000-0000-0000-000000000003'::uuid,
   '0b6a0003-0000-0000-0000-000000000003'::uuid, '0b6a0001-0000-0000-0000-000000000002'::uuid,
   NULL, '0b6a0005-0000-0000-0000-000000000003'::uuid, '0b6a0002-0000-0000-0000-000000000003'::uuid,
   '0b6a0006-0000-0000-0000-000000000001'::uuid, current_date + 10, 100, 'Alice', '0601020304'),
  -- E4 : CO client organisateur, NON DATÉ, opéré par T2 → branche 3 : la garde
  -- de date doit avoir SURVÉCU à la réécriture de la policy.
  ('0b6a0004-0000-0000-0000-000000000004'::uuid, '0b6a0001-0000-0000-0000-000000000003'::uuid,
   '0b6a0003-0000-0000-0000-000000000004'::uuid, '0b6a0001-0000-0000-0000-000000000002'::uuid,
   '0b6a0001-0000-0000-0000-000000000004'::uuid, '0b6a0005-0000-0000-0000-000000000003'::uuid,
   '0b6a0002-0000-0000-0000-000000000003'::uuid,
   '0b6a0006-0000-0000-0000-000000000001'::uuid, NULL, 100, 'Alice', '0601020304'),
  -- E6 : événement programmé par T1 lui-même → branche 2.
  ('0b6a0004-0000-0000-0000-000000000006'::uuid, '0b6a0001-0000-0000-0000-000000000001'::uuid,
   '0b6a0003-0000-0000-0000-000000000006'::uuid, '0b6a0001-0000-0000-0000-000000000001'::uuid,
   NULL, '0b6a0005-0000-0000-0000-000000000001'::uuid, '0b6a0002-0000-0000-0000-000000000001'::uuid,
   '0b6a0006-0000-0000-0000-000000000001'::uuid, current_date + 20, 100, 'Alice', '0601020304'),
  -- E7 : CO client organisateur, DATÉ → branche 3, cas positif.
  ('0b6a0004-0000-0000-0000-000000000007'::uuid, '0b6a0001-0000-0000-0000-000000000003'::uuid,
   '0b6a0003-0000-0000-0000-000000000007'::uuid, '0b6a0001-0000-0000-0000-000000000002'::uuid,
   '0b6a0001-0000-0000-0000-000000000004'::uuid, '0b6a0005-0000-0000-0000-000000000003'::uuid,
   '0b6a0002-0000-0000-0000-000000000003'::uuid,
   '0b6a0006-0000-0000-0000-000000000001'::uuid, current_date + 30, 100, 'Alice', '0601020304'),
  -- E8 : CO est à la fois client organisateur ET traiteur opérationnel, NON DATÉ.
  -- Discriminant de Q2 : sans garde de rôle, la branche 4 ouvrirait ce lieu à un
  -- client_organisateur et contournerait la garde de date de la branche 3.
  ('0b6a0004-0000-0000-0000-000000000008'::uuid, '0b6a0001-0000-0000-0000-000000000003'::uuid,
   '0b6a0003-0000-0000-0000-000000000008'::uuid, '0b6a0001-0000-0000-0000-000000000004'::uuid,
   '0b6a0001-0000-0000-0000-000000000004'::uuid, '0b6a0005-0000-0000-0000-000000000003'::uuid,
   '0b6a0002-0000-0000-0000-000000000003'::uuid,
   '0b6a0006-0000-0000-0000-000000000001'::uuid, NULL, 100, 'Alice', '0601020304');

-- ═════════════════════════════════════════════════════════════════════════════
-- A. BRANCHE 4 — ce qui s'ouvre
-- ═════════════════════════════════════════════════════════════════════════════

SELECT test_set_jwt('traiteur_manager', '0b6a0001-0000-0000-0000-000000000001'::uuid);
SELECT is(test_voit_lieu('0b6a0003-0000-0000-0000-000000000001'::uuid), 1,
  'A1 traiteur_manager VOIT le lieu d''un evenement programme par un tiers qu''il opere');

SELECT test_set_jwt('traiteur_commercial', '0b6a0001-0000-0000-0000-000000000001'::uuid);
SELECT is(test_voit_lieu('0b6a0003-0000-0000-0000-000000000001'::uuid), 1,
  'A2 traiteur_commercial VOIT ce meme lieu (les 2 roles traiteur)');

SELECT test_set_jwt('traiteur_manager', '0b6a0001-0000-0000-0000-000000000001'::uuid);
SELECT is(test_voit_lieu('0b6a0003-0000-0000-0000-000000000002'::uuid), 1,
  'A3 Q1 : VOIT aussi le lieu d''un evenement NON DATE qu''il opere (pas de garde de date)');

-- ═════════════════════════════════════════════════════════════════════════════
-- B. CLOISONNEMENT — ce qui NE s'ouvre PAS
-- ═════════════════════════════════════════════════════════════════════════════

SELECT test_set_jwt('traiteur_manager', '0b6a0001-0000-0000-0000-000000000001'::uuid);
SELECT is(test_voit_lieu('0b6a0003-0000-0000-0000-000000000003'::uuid), 0,
  'B1 NE VOIT PAS le lieu d''un evenement opere par un traiteur concurrent');

-- Non-vacuite de B1 : ce lieu existe bien et est visible du concurrent.
SELECT test_set_jwt('traiteur_manager', '0b6a0001-0000-0000-0000-000000000002'::uuid);
SELECT is(test_voit_lieu('0b6a0003-0000-0000-0000-000000000003'::uuid), 1,
  'B2 non-vacuite : le concurrent, lui, VOIT ce lieu (la donnee existe)');

SELECT is(test_voit_lieu('0b6a0003-0000-0000-0000-000000000001'::uuid), 0,
  'B3 symetrie : le concurrent NE VOIT PAS le lieu de l''evenement opere par T1');

-- ═════════════════════════════════════════════════════════════════════════════
-- C. Q2 — la garde de role est OBSERVABLE (test discriminant)
-- ═════════════════════════════════════════════════════════════════════════════
-- Meme organisation, meme evenement, meme donnee : seul le ROLE change.
-- Sans `f_app_role() IN (traiteur_manager, traiteur_commercial)`, C1 renverrait 1.

SELECT test_set_jwt('client_organisateur', '0b6a0001-0000-0000-0000-000000000004'::uuid);
SELECT is(test_voit_lieu('0b6a0003-0000-0000-0000-000000000008'::uuid), 0,
  'C1 Q2 : role client_organisateur NE VOIT PAS le lieu, bien que son orga soit traiteur operationnel');

SELECT is(test_voit_evenement('0b6a0004-0000-0000-0000-000000000008'::uuid), 1,
  'C2 non-vacuite de C1 : ce role VOIT bien l''evenement (la sous-requete n''est pas vide)');

SELECT test_set_jwt('traiteur_manager', '0b6a0001-0000-0000-0000-000000000004'::uuid);
SELECT is(test_voit_lieu('0b6a0003-0000-0000-0000-000000000008'::uuid), 1,
  'C3 discriminant : MEME orga, MEME donnee, role traiteur_manager → VOIT le lieu');

-- ═════════════════════════════════════════════════════════════════════════════
-- D. BRANCHES HISTORIQUES — inchangees par la reecriture
-- ═════════════════════════════════════════════════════════════════════════════

-- Branche 1 : lieu rattache a mon organisation.
SELECT test_set_jwt('gestionnaire_lieux', '0b6a0001-0000-0000-0000-000000000005'::uuid);
SELECT is(test_voit_lieu('0b6a0003-0000-0000-0000-000000000005'::uuid), 1,
  'D1 branche 1 : gestionnaire VOIT un lieu rattache a son organisation');
SELECT is(test_voit_lieu('0b6a0003-0000-0000-0000-000000000001'::uuid), 0,
  'D2 branche 1 bornee : il NE VOIT PAS un lieu non rattache');

-- Branche 2 : lieu d'un evenement que j'ai programme.
SELECT test_set_jwt('traiteur_manager', '0b6a0001-0000-0000-0000-000000000001'::uuid);
SELECT is(test_voit_lieu('0b6a0003-0000-0000-0000-000000000006'::uuid), 1,
  'D3 branche 2 : VOIT le lieu de son propre evenement');

SELECT test_set_jwt('agence', '0b6a0001-0000-0000-0000-000000000003'::uuid);
SELECT is(test_voit_lieu('0b6a0003-0000-0000-0000-000000000001'::uuid), 1,
  'D4 branche 2 : l''agence programmatrice conserve l''acces au lieu qu''elle a programme');

-- Branche 3 : client organisateur, evenement DATE seulement.
SELECT test_set_jwt('client_organisateur', '0b6a0001-0000-0000-0000-000000000004'::uuid);
SELECT is(test_voit_lieu('0b6a0003-0000-0000-0000-000000000007'::uuid), 1,
  'D5 branche 3 : client organisateur VOIT le lieu d''un evenement DATE');

SELECT is(test_voit_lieu('0b6a0003-0000-0000-0000-000000000004'::uuid), 0,
  'D6 BLOQUANT branche 3 : la garde date_evenement IS NOT NULL a SURVECU a la reecriture');

SELECT is(test_voit_evenement('0b6a0004-0000-0000-0000-000000000004'::uuid), 1,
  'D7 non-vacuite de D6 : ce role VOIT bien l''evenement non date, seul son LIEU reste ferme');

-- ═════════════════════════════════════════════════════════════════════════════
-- E. ANCRAGE DU TEXTE DE LA POLICY (anti-regression)
-- ═════════════════════════════════════════════════════════════════════════════
-- Le tableau du CDC §09 documente la branche 3 SANS sa garde de date. Toute
-- reecriture future recopiee du CDC la supprimerait en silence : on l'epingle.

SELECT test_as_superuser();

SELECT ok(
  (SELECT pg_get_expr(pol.polqual, pol.polrelid) LIKE '%date_evenement IS NOT NULL%'
     FROM pg_policy pol
     JOIN pg_class c ON c.oid = pol.polrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'plateforme' AND c.relname = 'lieux' AND pol.polname = 'lieux_clients_select'),
  'E1 BLOQUANT : la policy porte toujours la garde date_evenement IS NOT NULL'
);

SELECT ok(
  (SELECT pg_get_expr(pol.polqual, pol.polrelid) LIKE '%traiteur_operationnel_organisation_id%'
     FROM pg_policy pol
     JOIN pg_class c ON c.oid = pol.polrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'plateforme' AND c.relname = 'lieux' AND pol.polname = 'lieux_clients_select'),
  'E2 : la policy porte la 4e branche traiteur_operationnel_organisation_id'
);

SELECT ok(
  (SELECT pg_get_expr(pol.polqual, pol.polrelid) LIKE '%traiteur_commercial%'
     FROM pg_policy pol
     JOIN pg_class c ON c.oid = pol.polrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'plateforme' AND c.relname = 'lieux' AND pol.polname = 'lieux_clients_select'),
  'E3 Q2 : la 4e branche est gardee par un test de role explicite'
);

SELECT * FROM finish();
ROLLBACK;

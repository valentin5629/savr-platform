-- pgTAP — bordereau ZD lisible par tous ceux qui voient la collecte
-- (policy bord_collecte_visible_select, décision Val 2026-10-27).
--
-- Avant : le traiteur opérationnel désigné par un autre programmateur (producteur
-- juridique du déchet) et le gestionnaire qui programme hors de ses lieux
-- voyaient la collecte, son rapport et sa ligne de registre, mais pas son
-- bordereau. Après : la ligne bordereaux_savr suit f_collecte_visible.
-- Prouvé sous le rôle `authenticated`, avec le refus cross-org, la cohérence
-- avec v_registre_dechets et l'écriture toujours refusée.

BEGIN;
SELECT plan(19);

CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Bordereaux lisibles sous le JWT courant, parmi ceux de ce test.
CREATE OR REPLACE FUNCTION test_bordereaux_lus()
RETURNS text[] LANGUAGE sql AS $$
  SELECT COALESCE(array_agg(numero ORDER BY numero), ARRAY[]::text[])
  FROM plateforme.bordereaux_savr
  WHERE numero LIKE 'BSAV-TEST-4B-%'
$$;

-- Lignes du registre dont le bordereau n'est PAS lisible sous le JWT courant.
CREATE OR REPLACE FUNCTION test_registre_bordereau_illisible()
RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int
  FROM plateforme.v_registre_dechets r
  WHERE r.bordereau_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM plateforme.bordereaux_savr b WHERE b.id = r.bordereau_id)
$$;

GRANT EXECUTE ON FUNCTION test_bordereaux_lus(), test_registre_bordereau_illisible() TO authenticated;

-- ── Fixtures (superuser) ────────────────────────────────────────────────────
SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, actif) VALUES
  ('4b000000-0000-0000-0000-000000000001'::uuid, 'Kaspia',     'Kaspia SARL',     'traiteur',            true),
  ('4b000000-0000-0000-0000-000000000002'::uuid, 'Kardamome',  'Kardamome SARL',  'traiteur',            true),
  ('4b000000-0000-0000-0000-000000000003'::uuid, 'Magnifik',   'Magnifik SAS',    'agence',              true),
  ('4b000000-0000-0000-0000-000000000004'::uuid, 'Viparis',    'Viparis SA',      'gestionnaire_lieux',  true),
  ('4b000000-0000-0000-0000-000000000005'::uuid, 'EventCo',    'EventCo SAS',     'client_organisateur', true),
  ('4b000000-0000-0000-0000-000000000006'::uuid, 'AutreLieu',  'AutreLieu SA',    'gestionnaire_lieux',  true);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('4b010000-0000-0000-0000-000000000001'::uuid, '4b000000-0000-0000-0000-000000000001'::uuid, 'mgr@kaspia.4b.test',   'M', 'K', 'traiteur_manager'),
  ('4b010000-0000-0000-0000-000000000002'::uuid, '4b000000-0000-0000-0000-000000000002'::uuid, 'com@kardam.4b.test',   'C', 'D', 'traiteur_commercial'),
  ('4b010000-0000-0000-0000-000000000003'::uuid, '4b000000-0000-0000-0000-000000000003'::uuid, 'ag@magnifik.4b.test',  'A', 'M', 'agence'),
  ('4b010000-0000-0000-0000-000000000004'::uuid, '4b000000-0000-0000-0000-000000000004'::uuid, 'g@viparis.4b.test',    'G', 'V', 'gestionnaire_lieux'),
  ('4b010000-0000-0000-0000-000000000005'::uuid, '4b000000-0000-0000-0000-000000000005'::uuid, 'cli@eventco.4b.test',  'O', 'E', 'client_organisateur'),
  ('4b010000-0000-0000-0000-000000000006'::uuid, '4b000000-0000-0000-0000-000000000006'::uuid, 'g@autrelieu.4b.test',  'G', 'A', 'gestionnaire_lieux');

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('4b020000-0000-0000-0000-000000000001'::uuid, '4b000000-0000-0000-0000-000000000001'::uuid, 'Kaspia SARL',  '41111111100011', '1 rue K', '75001', 'Paris'),
  ('4b020000-0000-0000-0000-000000000003'::uuid, '4b000000-0000-0000-0000-000000000003'::uuid, 'Magnifik SAS', '43333333300033', '3 rue M', '75003', 'Paris'),
  ('4b020000-0000-0000-0000-000000000004'::uuid, '4b000000-0000-0000-0000-000000000004'::uuid, 'Viparis SA',   '44444444400044', '4 rue V', '75004', 'Paris');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('4b030000-0000-0000-0000-000000000001'::uuid, 'GALA_4B', 'Gala 4B', 1, true);

INSERT INTO plateforme.lieux
  (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region) VALUES
  ('4b050000-0000-0000-0000-000000000001'::uuid, 'Pavillon 4B', '5 rue P', '75001', 'Paris', 'camionnette', 48.86, 2.32, 'idf'),
  ('4b050000-0000-0000-0000-000000000002'::uuid, 'Dock 4B',     '10 quai', '75015', 'Paris', 'camionnette', 48.85, 2.29, 'idf');

-- Viparis gère le Pavillon ; AutreLieu ne gère aucun lieu de ce test.
INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('4b000000-0000-0000-0000-000000000004'::uuid, '4b050000-0000-0000-0000-000000000001'::uuid);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone, client_organisateur_organisation_id
) VALUES
  -- E1 : Magnifik (agence) programme au Dock, Kaspia opérationnel tiers
  ('4b060000-0000-0000-0000-000000000001'::uuid, '4b000000-0000-0000-0000-000000000003'::uuid, '4b000000-0000-0000-0000-000000000001'::uuid, '4b020000-0000-0000-0000-000000000003'::uuid, '4b010000-0000-0000-0000-000000000003'::uuid, '4b050000-0000-0000-0000-000000000002'::uuid, '4b030000-0000-0000-0000-000000000001'::uuid, 'Gala E1', CURRENT_DATE, 150, 'C', '0600000000', NULL),
  -- E2 : Viparis (gestionnaire) programme au Dock, hors de ses lieux ; Kardamome opérationnel tiers
  ('4b060000-0000-0000-0000-000000000002'::uuid, '4b000000-0000-0000-0000-000000000004'::uuid, '4b000000-0000-0000-0000-000000000002'::uuid, '4b020000-0000-0000-0000-000000000004'::uuid, '4b010000-0000-0000-0000-000000000004'::uuid, '4b050000-0000-0000-0000-000000000002'::uuid, '4b030000-0000-0000-0000-000000000001'::uuid, 'Gala E2', CURRENT_DATE, 200, 'C', '0600000000', NULL),
  -- E3 : Kaspia programme et opère au Pavillon (lieu de Viparis), client EventCo
  ('4b060000-0000-0000-0000-000000000003'::uuid, '4b000000-0000-0000-0000-000000000001'::uuid, '4b000000-0000-0000-0000-000000000001'::uuid, '4b020000-0000-0000-0000-000000000001'::uuid, '4b010000-0000-0000-0000-000000000001'::uuid, '4b050000-0000-0000-0000-000000000001'::uuid, '4b030000-0000-0000-0000-000000000001'::uuid, 'Gala E3', CURRENT_DATE, 300, 'C', '0600000000', '4b000000-0000-0000-0000-000000000005'::uuid);

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte) VALUES
  ('4b070000-0000-0000-0000-000000000001'::uuid, '4b060000-0000-0000-0000-000000000001'::uuid, 'zero_dechet', 'cloturee', CURRENT_DATE, '06:00'),
  ('4b070000-0000-0000-0000-000000000002'::uuid, '4b060000-0000-0000-0000-000000000002'::uuid, 'zero_dechet', 'cloturee', CURRENT_DATE, '06:00'),
  ('4b070000-0000-0000-0000-000000000003'::uuid, '4b060000-0000-0000-0000-000000000003'::uuid, 'zero_dechet', 'cloturee', CURRENT_DATE, '06:00');

INSERT INTO plateforme.bordereaux_savr (id, collecte_id, statut, numero, date_emission, exutoire_nom, version) VALUES
  ('4b080000-0000-0000-0000-000000000001'::uuid, '4b070000-0000-0000-0000-000000000001'::uuid, 'emis', 'BSAV-TEST-4B-1', CURRENT_DATE, 'Exutoire 1', 1),
  ('4b080000-0000-0000-0000-000000000002'::uuid, '4b070000-0000-0000-0000-000000000002'::uuid, 'emis', 'BSAV-TEST-4B-2', CURRENT_DATE, 'Exutoire 2', 1),
  ('4b080000-0000-0000-0000-000000000003'::uuid, '4b070000-0000-0000-0000-000000000003'::uuid, 'emis', 'BSAV-TEST-4B-3', CURRENT_DATE, 'Exutoire 3', 1);

-- ── 1. La policy : lecture seule, rôle authenticated ───────────────────────
SELECT is(
  (SELECT cmd || ' ' || array_to_string(roles, ',') FROM pg_policies
   WHERE schemaname = 'plateforme' AND tablename = 'bordereaux_savr'
     AND policyname = 'bord_collecte_visible_select'),
  'SELECT authenticated', 'policy bord_collecte_visible_select = SELECT, TO authenticated');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'plateforme' AND tablename = 'bordereaux_savr' AND cmd = 'DELETE'),
  0, 'aucune policy DELETE sur bordereaux_savr (registre auditable)');

-- ── 2. Traiteur opérationnel tiers (Kaspia, producteur sur E1) ─────────────
SELECT test_set_jwt('traiteur_manager', '4b000000-0000-0000-0000-000000000001'::uuid, '4b010000-0000-0000-0000-000000000001'::uuid);
SELECT is(current_user::text, 'authenticated', 'assertions jouées sous le rôle authenticated');
SELECT is(test_bordereaux_lus(), ARRAY['BSAV-TEST-4B-1', 'BSAV-TEST-4B-3'],
  'traiteur opérationnel tiers : lit le bordereau de E1 (producteur) et le sien, jamais E2');
SELECT is(test_registre_bordereau_illisible(), 0,
  'traiteur opérationnel tiers : aucune ligne de registre avec un bordereau illisible');

-- Écriture toujours refusée (aucune policy UPDATE / DELETE pour lui).
UPDATE plateforme.bordereaux_savr SET exutoire_nom = 'pirate'
  WHERE id = '4b080000-0000-0000-0000-000000000001'::uuid;
DELETE FROM plateforme.bordereaux_savr
  WHERE id = '4b080000-0000-0000-0000-000000000001'::uuid;

-- ── 3. Traiteur commercial opérationnel tiers (Kardamome sur E2) ───────────
SELECT test_set_jwt('traiteur_commercial', '4b000000-0000-0000-0000-000000000002'::uuid, '4b010000-0000-0000-0000-000000000002'::uuid);
SELECT is(test_bordereaux_lus(), ARRAY['BSAV-TEST-4B-2'],
  'commercial opérationnel tiers : lit le seul bordereau de E2');
SELECT is(test_registre_bordereau_illisible(), 0,
  'commercial opérationnel tiers : registre cohérent');

-- ── 4. Gestionnaire programmateur hors de ses lieux (Viparis sur E2) ───────
SELECT test_set_jwt('gestionnaire_lieux', '4b000000-0000-0000-0000-000000000004'::uuid, '4b010000-0000-0000-0000-000000000004'::uuid);
SELECT is(test_bordereaux_lus(), ARRAY['BSAV-TEST-4B-2', 'BSAV-TEST-4B-3'],
  'gestionnaire : sa programmation hors de ses lieux (E2) et son lieu (E3), jamais E1');
SELECT is(test_registre_bordereau_illisible(), 0,
  'gestionnaire : registre cohérent');

-- ── 5. Gestionnaire sans lien (AutreLieu) ──────────────────────────────────
SELECT test_set_jwt('gestionnaire_lieux', '4b000000-0000-0000-0000-000000000006'::uuid, '4b010000-0000-0000-0000-000000000006'::uuid);
SELECT is(test_bordereaux_lus(), ARRAY[]::text[],
  'gestionnaire sans lieu ni programmation : aucun bordereau');

-- ── 6. Agence programmatrice (Magnifik sur E1) ─────────────────────────────
SELECT test_set_jwt('agence', '4b000000-0000-0000-0000-000000000003'::uuid, '4b010000-0000-0000-0000-000000000003'::uuid);
SELECT is(test_bordereaux_lus(), ARRAY['BSAV-TEST-4B-1'],
  'agence programmatrice : son seul bordereau');

-- ── 7. Client organisateur (EventCo sur E3) ────────────────────────────────
SELECT test_set_jwt('client_organisateur', '4b000000-0000-0000-0000-000000000005'::uuid, '4b010000-0000-0000-0000-000000000005'::uuid);
SELECT is(test_bordereaux_lus(), ARRAY['BSAV-TEST-4B-3'],
  'client organisateur : le seul bordereau de son événement');
SELECT is(test_registre_bordereau_illisible(), 0,
  'client organisateur : registre cohérent');

-- ── 8. Organisation sans aucun lien ────────────────────────────────────────
SELECT test_set_jwt('traiteur_manager', gen_random_uuid());
SELECT is(test_bordereaux_lus(), ARRAY[]::text[],
  'organisation étrangère : aucun bordereau (cross-org)');

-- ── 9. JWT sans organisation ───────────────────────────────────────────────
SELECT test_set_jwt('traiteur_manager', NULL);
SELECT is(test_bordereaux_lus(), ARRAY[]::text[],
  'JWT sans organisation : aucun bordereau');

-- ── 10. Écritures refusées : rien n'a bougé ────────────────────────────────
SELECT test_as_superuser();
SELECT is(
  (SELECT exutoire_nom FROM plateforme.bordereaux_savr
   WHERE id = '4b080000-0000-0000-0000-000000000001'::uuid),
  'Exutoire 1', 'UPDATE par le traiteur opérationnel : aucune ligne modifiée');
SELECT is(
  (SELECT count(*)::int FROM plateforme.bordereaux_savr
   WHERE numero LIKE 'BSAV-TEST-4B-%'),
  3, 'DELETE par le traiteur opérationnel : aucune ligne supprimée');

-- ── 11. Le PDF suit la même règle (f_fichier_visible) ──────────────────────
SELECT test_set_jwt('traiteur_manager', '4b000000-0000-0000-0000-000000000001'::uuid, '4b010000-0000-0000-0000-000000000001'::uuid);
SELECT ok(
  shared.f_fichier_visible('plateforme.bordereaux_savr', '4b080000-0000-0000-0000-000000000001'::uuid),
  'PDF du bordereau de E1 visible du traiteur opérationnel (même règle que la ligne)');
SELECT ok(
  NOT shared.f_fichier_visible('plateforme.bordereaux_savr', '4b080000-0000-0000-0000-000000000002'::uuid),
  'PDF du bordereau de E2 refusé au traiteur opérationnel de E1');

SELECT * FROM finish();
ROLLBACK;

-- =============================================================================
-- pgTAP — Autocomplétion Lieux du formulaire de programmation (§06.01, étape 2)
-- Route prouvée : GET /api/v1/programmation/lieux (chemin rôle client)
-- =============================================================================
-- Ce fichier ne re-teste PAS la policy `lieux_clients_select` en général — c'est
-- l'objet de `lieux_traiteur_operationnel.test.sql`. Il prouve que la REQUÊTE
-- EXACTE de l'autocomplétion (projection + vue liste blanche + `actif = true`)
-- rend bien le résultat attendu sous l'identité de l'appelant. C'est le maillon
-- que la route ne peut plus fausser depuis qu'elle lit sous RLS : si elle
-- ré-implémentait à nouveau le périmètre, ce test resterait vert alors que la
-- route serait fausse — d'où son doublon côté Vitest
-- (tests/api/programmation/lieux-scope.test.ts), qui prouve la DÉLÉGATION.
--
-- ⚠ Tous les asserts tournent sous `role = 'authenticated'` avec
--   `request.jwt.claims` simulé : sous service_role la RLS est bypassée et la
--   suite serait verte par construction.
-- ⚠ NON-VACUITÉ : chaque assert négatif est doublé d'un positif prouvant que la
--   donnée existe et que la requête n'est pas vide pour d'autres raisons.
-- =============================================================================

BEGIN;
SELECT plan(9);

CREATE OR REPLACE FUNCTION pgl_jwt(p_role text, p_org uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'user_role', p_role,
    'organisation_id', p_org, 'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION pgl_superuser() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Requête EXACTE de l'autocomplétion (route, chemin rôle client) : même source
-- (vue liste blanche), même projection, même filtre `actif`. Renvoie les noms
-- proposés, pour que l'assert porte sur ce que l'utilisateur VOIT.
CREATE OR REPLACE FUNCTION pgl_autocompletion() RETURNS text[]
LANGUAGE sql AS $$
  SELECT coalesce(array_agg(nom ORDER BY nom), ARRAY[]::text[]) FROM (
    SELECT id, nom, adresse_acces, code_postal, ville, acces_details,
           acces_office, stationnement, type_vehicule_max,
           controle_acces_requis_default, contraintes_horaires, flux_autorises
      FROM plateforme.v_lieux_clients
     WHERE actif = true
     ORDER BY nom
     LIMIT 20) s
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
SELECT pgl_superuser();

INSERT INTO plateforme.organisations (id, nom, type, siret, actif, est_shadow) VALUES
  ('c1ea0001-0000-0000-0000-000000000001'::uuid, 'T1 operateur',      'traiteur', '95000000000001', true, false),
  ('c1ea0001-0000-0000-0000-000000000002'::uuid, 'T2 concurrent',     'traiteur', '95000000000002', true, false),
  ('c1ea0001-0000-0000-0000-000000000003'::uuid, 'AG programmatrice', 'agence',   '95000000000003', true, false);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('c1ea0002-0000-0000-0000-000000000003'::uuid, 'c1ea0001-0000-0000-0000-000000000003'::uuid,
   'a@ag.autocompletion', 'A', 'G', 'agence');

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('c1ea0005-0000-0000-0000-000000000003'::uuid, 'c1ea0001-0000-0000-0000-000000000003'::uuid,
   'AG SAS', '95000000000003', '3 rue test', '75003', 'Paris');

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('c1ea0006-0000-0000-0000-000000000001'::uuid, 'cocktail_autocompletion', 'Cocktail autocomplétion');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, actif) VALUES
  -- LX : connu de T1 UNIQUEMENT parce qu'il opère l'événement d'un tiers.
  ('c1ea0003-0000-0000-0000-000000000001'::uuid, 'AA Lieu evenement tiers', '1 r', '75001', 'Paris', 'fourgon', true),
  -- LY : rattaché à T2 → non-vacuité de l'assert négatif (T2 voit SES lieux).
  ('c1ea0003-0000-0000-0000-000000000002'::uuid, 'BB Lieu du concurrent',   '2 r', '75002', 'Paris', 'fourgon', true),
  -- LZ : opéré par T1 mais DÉSACTIVÉ → le filtre `actif` de la route doit l'exclure.
  ('c1ea0003-0000-0000-0000-000000000003'::uuid, 'CC Lieu desactive',       '3 r', '75003', 'Paris', 'fourgon', false);

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('c1ea0001-0000-0000-0000-000000000002'::uuid, 'c1ea0003-0000-0000-0000-000000000002'::uuid);

-- Deux événements programmés par l'AGENCE, opérés par T1 : T1 n'a aucun autre
-- lien vers ces lieux (ni rattachement, ni événement qu'il aurait programmé).
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone) VALUES
  ('c1ea0004-0000-0000-0000-000000000001'::uuid, 'c1ea0001-0000-0000-0000-000000000003'::uuid,
   'c1ea0003-0000-0000-0000-000000000001'::uuid, 'c1ea0001-0000-0000-0000-000000000001'::uuid,
   'c1ea0005-0000-0000-0000-000000000003'::uuid, 'c1ea0002-0000-0000-0000-000000000003'::uuid,
   'c1ea0006-0000-0000-0000-000000000001'::uuid, current_date + 10, 100, 'Alice', '0601020304'),
  ('c1ea0004-0000-0000-0000-000000000002'::uuid, 'c1ea0001-0000-0000-0000-000000000003'::uuid,
   'c1ea0003-0000-0000-0000-000000000003'::uuid, 'c1ea0001-0000-0000-0000-000000000001'::uuid,
   'c1ea0005-0000-0000-0000-000000000003'::uuid, 'c1ea0002-0000-0000-0000-000000000003'::uuid,
   'c1ea0006-0000-0000-0000-000000000001'::uuid, current_date + 10, 100, 'Alice', '0601020304');

-- ── 1. Le traiteur opérationnel se voit proposer le lieu ────────────────────
SELECT pgl_jwt('traiteur_manager', 'c1ea0001-0000-0000-0000-000000000001'::uuid);

SELECT ok(
  'AA Lieu evenement tiers' = ANY (pgl_autocompletion()),
  'traiteur_manager opérationnel : le lieu de l''événement programmé par un tiers EST proposé'
);

SELECT pgl_jwt('traiteur_commercial', 'c1ea0001-0000-0000-0000-000000000001'::uuid);
SELECT ok(
  'AA Lieu evenement tiers' = ANY (pgl_autocompletion()),
  'traiteur_commercial opérationnel : même proposition (les 2 rôles traiteur)'
);

-- Le lieu désactivé reste exclu : le filtre `actif` de la route n'a pas sauté.
SELECT ok(
  NOT ('CC Lieu desactive' = ANY (pgl_autocompletion())),
  'lieu actif=false : exclu de l''autocomplétion même si l''organisation l''opère'
);

-- ── 2. Le concurrent ne le voit pas (+ non-vacuité) ─────────────────────────
SELECT pgl_jwt('traiteur_manager', 'c1ea0001-0000-0000-0000-000000000002'::uuid);

SELECT ok(
  NOT ('AA Lieu evenement tiers' = ANY (pgl_autocompletion())),
  'traiteur concurrent : le lieu de l''événement qu''il n''opère pas n''est PAS proposé'
);

SELECT ok(
  'BB Lieu du concurrent' = ANY (pgl_autocompletion()),
  'NON-VACUITÉ : le concurrent voit bien SES lieux (la requête n''est pas vide par accident)'
);

-- ── 3. La vue liste blanche est le bon support (masquage colonne) ───────────
SELECT pgl_jwt('traiteur_manager', 'c1ea0001-0000-0000-0000-000000000001'::uuid);

SELECT lives_ok(
  $$ SELECT id, nom, adresse_acces, code_postal, ville, acces_details,
            acces_office, stationnement, type_vehicule_max,
            controle_acces_requis_default, contraintes_horaires, flux_autorises
       FROM plateforme.v_lieux_clients LIMIT 0 $$,
  'projection de la route : lisible par `authenticated` (aucune colonne fermée)'
);

SELECT throws_ok(
  $$ SELECT commentaires_internes FROM plateforme.v_lieux_clients LIMIT 0 $$,
  '42703',
  NULL,
  'colonne interne absente de la vue : l''ajouter à la projection casserait la route au lieu de fuir'
);

SELECT throws_ok(
  $$ SELECT siren FROM plateforme.lieux LIMIT 0 $$,
  '42501',
  NULL,
  'colonne admin-only sur la table : refusée à `authenticated` (masquage colonne intact)'
);

-- ── 4. Garde-fou : la lecture directe de la table reste fermée ──────────────
SELECT throws_ok(
  $$ SELECT * FROM plateforme.lieux LIMIT 0 $$,
  '42501',
  NULL,
  'SELECT * sur plateforme.lieux : refusé à `authenticated` — le GRANT est colonne-level, pas table-level (SELECT nom, lui, passe)'
);

SELECT * FROM finish();
ROLLBACK;

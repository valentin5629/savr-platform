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
SELECT plan(15);

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

-- ── Fixtures du régime « branche 3 » (client organisateur, événement daté) ──
-- Objet : PINER l'innocuité de son omission du miroir admin (cf. route.ts). Elle
-- repose sur deux régimes DIFFÉRENTS selon le rôle — si l'un des deux change, ces
-- asserts rougissent avant que le miroir ne devienne faux.
INSERT INTO plateforme.organisations (id, nom, type, siret, actif, est_shadow) VALUES
  ('c1ea0001-0000-0000-0000-000000000004'::uuid, 'AG2 client orga',   'agence',             '95000000000004', true, false),
  ('c1ea0001-0000-0000-0000-000000000005'::uuid, 'GL1 rattache',      'gestionnaire_lieux', '95000000000005', true, false),
  ('c1ea0001-0000-0000-0000-000000000006'::uuid, 'GL2 non rattache',  'gestionnaire_lieux', '95000000000006', true, false);

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, actif) VALUES
  ('c1ea0003-0000-0000-0000-000000000004'::uuid, 'DD Lieu co agence',   '4 r', '75004', 'Paris', 'fourgon', true),
  ('c1ea0003-0000-0000-0000-000000000005'::uuid, 'EE Lieu co gl1',      '5 r', '75005', 'Paris', 'fourgon', true),
  ('c1ea0003-0000-0000-0000-000000000006'::uuid, 'FF Lieu co gl2',      '6 r', '75006', 'Paris', 'fourgon', true),
  ('c1ea0003-0000-0000-0000-000000000007'::uuid, 'GG Lieu rattache ag2','7 r', '75007', 'Paris', 'fourgon', true),
  ('c1ea0003-0000-0000-0000-000000000008'::uuid, 'HH Lieu rattache gl2','8 r', '75008', 'Paris', 'fourgon', true);

-- GL1 est rattaché au lieu de SON événement (branche 1). GL2 ne l'est PAS au sien.
-- AG2 et GL2 reçoivent chacun un lieu rattaché SANS rapport avec leur événement b3 :
-- sans lui, les asserts 11 et 12 seraient des négatifs sur un ensemble VIDE et
-- passeraient aussi bien si c'était le LECTEUR qui cassait (claim JWT malformé, vue
-- illisible) — même idiome de non-vacuité que le couple 4/5.
INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id) VALUES
  ('c1ea0001-0000-0000-0000-000000000005'::uuid, 'c1ea0003-0000-0000-0000-000000000005'::uuid),
  ('c1ea0001-0000-0000-0000-000000000004'::uuid, 'c1ea0003-0000-0000-0000-000000000007'::uuid),
  ('c1ea0001-0000-0000-0000-000000000006'::uuid, 'c1ea0003-0000-0000-0000-000000000008'::uuid);

-- Trois événements DATÉS appartenant à l'agence AG, opérés par le concurrent T2
-- (choix assumé : cela élargit l'ensemble de T2 via la branche 4, sans rien changer
-- aux asserts 4/5 qui portent sur `AA` — opéré par T1 — et sur `BB`. Un futur assert
-- qui pinerait l'ensemble EXACT de T2 devrait en tenir compte),
-- dont AG2 / GL1 / GL2 sont SEULEMENT client organisateur. La garde de date de la
-- branche 3 est donc satisfaite : ce qui coupe, c'est la RLS imbriquée sur `evenements`.
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  client_organisateur_organisation_id, entite_facturation_id, created_by,
  type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone) VALUES
  ('c1ea0004-0000-0000-0000-000000000004'::uuid, 'c1ea0001-0000-0000-0000-000000000003'::uuid,
   'c1ea0003-0000-0000-0000-000000000004'::uuid, 'c1ea0001-0000-0000-0000-000000000002'::uuid,
   'c1ea0001-0000-0000-0000-000000000004'::uuid, 'c1ea0005-0000-0000-0000-000000000003'::uuid,
   'c1ea0002-0000-0000-0000-000000000003'::uuid, 'c1ea0006-0000-0000-0000-000000000001'::uuid,
   current_date + 10, 100, 'Alice', '0601020304'),
  ('c1ea0004-0000-0000-0000-000000000005'::uuid, 'c1ea0001-0000-0000-0000-000000000003'::uuid,
   'c1ea0003-0000-0000-0000-000000000005'::uuid, 'c1ea0001-0000-0000-0000-000000000002'::uuid,
   'c1ea0001-0000-0000-0000-000000000005'::uuid, 'c1ea0005-0000-0000-0000-000000000003'::uuid,
   'c1ea0002-0000-0000-0000-000000000003'::uuid, 'c1ea0006-0000-0000-0000-000000000001'::uuid,
   current_date + 10, 100, 'Alice', '0601020304'),
  ('c1ea0004-0000-0000-0000-000000000006'::uuid, 'c1ea0001-0000-0000-0000-000000000003'::uuid,
   'c1ea0003-0000-0000-0000-000000000006'::uuid, 'c1ea0001-0000-0000-0000-000000000002'::uuid,
   'c1ea0001-0000-0000-0000-000000000006'::uuid, 'c1ea0005-0000-0000-0000-000000000003'::uuid,
   'c1ea0002-0000-0000-0000-000000000003'::uuid, 'c1ea0006-0000-0000-0000-000000000001'::uuid,
   current_date + 10, 100, 'Alice', '0601020304');

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

-- ── 5. Branche 3 : pourquoi son omission du miroir admin est sans effet ──────
-- La justification écrite dans route.ts tient à DEUX régimes distincts. Ces asserts
-- les pinent : si `evt_agence_select` / `evt_gestionnaire_select` ou la branche 1
-- bougeaient, ils rougiraient AVANT que le miroir admin ne devienne faux.

-- NON-VACUITÉ d'abord : sous postgres, les 3 événements existent, sont DATÉS et
-- portent bien le rattachement client organisateur → la garde de la branche 3 est
-- satisfaite. Ce qui coupe ensuite, c'est la RLS imbriquée, rien d'autre.
SELECT pgl_superuser();
SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements
    WHERE client_organisateur_organisation_id IN (
            'c1ea0001-0000-0000-0000-000000000004'::uuid,
            'c1ea0001-0000-0000-0000-000000000005'::uuid,
            'c1ea0001-0000-0000-0000-000000000006'::uuid)
      AND date_evenement IS NOT NULL),
  3,
  'NON-VACUITÉ : les 3 événements « client organisateur » existent et sont DATÉS (garde b3 satisfaite)'
);

-- Régime A — agence : sous-SELECT de la branche 3 VIDE (evt_agence_select exige
-- `organisation_id = self`). Branche INATTEIGNABLE.
SELECT pgl_jwt('agence', 'c1ea0001-0000-0000-0000-000000000004'::uuid);
SELECT ok(
  NOT ('DD Lieu co agence' = ANY (pgl_autocompletion())),
  'branche 3 / agence : INATTEIGNABLE — client organisateur seul ne rend pas le lieu'
);

SELECT ok(
  'GG Lieu rattache ag2' = ANY (pgl_autocompletion()),
  'NON-VACUITÉ : AG2 voit bien son lieu RATTACHÉ (l''assert précédent n''est pas un 0 de lecteur)'
);

-- Régime B — gestionnaire NON rattaché : même résultat, le second disjoint de
-- `evt_gestionnaire_select` exigeant `lieu_id IN (mes organisations_lieux)`.
SELECT pgl_jwt('gestionnaire_lieux', 'c1ea0001-0000-0000-0000-000000000006'::uuid);
SELECT ok(
  NOT ('FF Lieu co gl2' = ANY (pgl_autocompletion())),
  'branche 3 / gestionnaire sans rattachement : rien de plus (le disjoint exige le rattachement)'
);

SELECT ok(
  'HH Lieu rattache gl2' = ANY (pgl_autocompletion()),
  'NON-VACUITÉ : GL2 voit bien son lieu RATTACHÉ (l''assert précédent n''est pas un 0 de lecteur)'
);

-- Régime C — gestionnaire RATTACHÉ : là, le sous-SELECT de la branche 3 est NON
-- VIDE. Mais l'invariant dont dépend le miroir admin est que la branche 3 n'ajoute
-- RIEN à ce que les branches 1+2 donnent déjà. C'est cette ÉGALITÉ qu'on pine —
-- pas « le gestionnaire ne voit pas le lieu », qui serait faux.
SELECT pgl_superuser();
-- `LIMIT 20` répliqué à l'identique : sans lui, une fixture de plus de 20 lieux
-- casserait l'égalité pour une raison étrangère à l'invariant testé.
SELECT set_config('pgl.miroir_b1_b2', (
  SELECT coalesce(string_agg(nom, ',' ORDER BY nom), '') FROM (
    SELECT nom FROM plateforme.lieux
     WHERE actif = true
       AND (id IN (SELECT lieu_id FROM plateforme.organisations_lieux
                    WHERE organisation_id = 'c1ea0001-0000-0000-0000-000000000005'::uuid)
         OR id IN (SELECT lieu_id FROM plateforme.evenements
                    WHERE organisation_id = 'c1ea0001-0000-0000-0000-000000000005'::uuid))
     ORDER BY nom
     LIMIT 20) s
), true);

SELECT pgl_jwt('gestionnaire_lieux', 'c1ea0001-0000-0000-0000-000000000005'::uuid);
SELECT is(
  array_to_string(pgl_autocompletion(), ','),
  current_setting('pgl.miroir_b1_b2'),
  'branche 3 / gestionnaire rattaché : REDONDANTE — l''autocomplétion égale exactement les branches 1+2 (ce que calcule le miroir admin)'
);

SELECT * FROM finish();
ROLLBACK;

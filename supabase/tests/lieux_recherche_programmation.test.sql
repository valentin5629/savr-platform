-- pgTAP — Recherche de lieux du formulaire ouverte à tout le référentiel
-- (20261119233000, décision Val 2026-11-19)
--
-- Prouve, sur base réelle :
--   A. ce qui est OUVERT : traiteur (manager, commercial) et agence trouvent un
--      lieu actif hors de leur périmètre, par nom, adresse ou ville ;
--   B. ce qui reste FERMÉ : ce même lieu reste invisible par `lieux` et
--      `v_lieux_clients` (listes, fiches, tableaux de bord) ; lieu inactif
--      absent ; gestionnaire, client organisateur, équipe Savr et anon refusés ;
--      aucune colonne hors formulaire ; 20 lignes au plus ; saisie sans joker ;
--   C. le lieu entre dans le périmètre de l'organisation dès qu'elle y a
--      programmé un événement, et seulement d'elle.

BEGIN;
SELECT plan(18);

CREATE OR REPLACE FUNCTION lrp_jwt(p_role text, p_org uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'user_role', p_role, 'aal', 'aal2',
    'organisation_id', p_org, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION lrp_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Noms rendus par la recherche, sous le rôle courant.
CREATE OR REPLACE FUNCTION lrp_noms(p_q text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(nom, ',' ORDER BY nom), '')
    FROM plateforme.f_rechercher_lieux_programmation(p_q)
$$;

SELECT lrp_superuser();

INSERT INTO plateforme.organisations (id, nom, type, siret, actif, est_shadow) VALUES
  ('1a000000-0000-0000-0000-000000000001'::uuid, 'LRP traiteur',     'traiteur',           '96200000000001', true, false),
  ('1a000000-0000-0000-0000-000000000002'::uuid, 'LRP concurrent',   'traiteur',           '96200000000002', true, false),
  ('1a000000-0000-0000-0000-000000000003'::uuid, 'LRP agence',       'agence',             '96200000000003', true, false),
  ('1a000000-0000-0000-0000-000000000004'::uuid, 'LRP gestionnaire', 'gestionnaire_lieux', '96200000000004', true, false);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('1a000002-0000-0000-0000-000000000001'::uuid, '1a000000-0000-0000-0000-000000000001'::uuid,
   't@lrp.recherche', 'T', 'M', 'traiteur_manager');

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('1a000005-0000-0000-0000-000000000001'::uuid, '1a000000-0000-0000-0000-000000000001'::uuid,
        'LRP SAS', '96200000000001', '1 rue test', '75001', 'Paris');

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('1a000006-0000-0000-0000-000000000001'::uuid, 'cocktail_lrp', 'Cocktail LRP');

INSERT INTO plateforme.lieux
  (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, actif,
   siren, commentaires_internes)
VALUES
  ('1a000003-0000-0000-0000-000000000001'::uuid, 'LRP Pavillon', '12 villa Wagram', '75008', 'Paris', 'fourgon', true,
   '123456789', 'note interne'),
  ('1a000003-0000-0000-0000-000000000002'::uuid, 'LRP Ferme',    '3 rue fermee',    '75002', 'Paris', 'fourgon', false,
   NULL, NULL);

-- 25 lieux de plus, pour la borne de 20 lignes.
INSERT INTO plateforme.lieux (nom, adresse_acces, code_postal, ville, type_vehicule_max, actif)
SELECT 'LRP serie ' || lpad(n::text, 2, '0'), n || ' rue serie', '75010', 'Lrpville', 'fourgon', true
  FROM generate_series(1, 25) AS n;

-- ── A. Ouvert ────────────────────────────────────────────────────────────────
SELECT lrp_jwt('traiteur_manager', '1a000000-0000-0000-0000-000000000001'::uuid);
SELECT is(lrp_noms('Pavillon'), 'LRP Pavillon',
  'A1 un traiteur manager trouve par son nom un lieu actif hors de son périmètre');
SELECT is(lrp_noms('villa wagram'), 'LRP Pavillon',
  'A2 recherche par adresse, sans tenir compte de la casse');

SELECT lrp_jwt('traiteur_commercial', '1a000000-0000-0000-0000-000000000001'::uuid);
SELECT is(lrp_noms('Pavillon'), 'LRP Pavillon',
  'A3 un traiteur commercial le trouve aussi');

SELECT lrp_jwt('agence', '1a000000-0000-0000-0000-000000000003'::uuid);
SELECT is(lrp_noms('Pavillon'), 'LRP Pavillon',
  'A4 une agence le trouve aussi');

-- ── B. Fermé ─────────────────────────────────────────────────────────────────
SELECT lrp_jwt('traiteur_manager', '1a000000-0000-0000-0000-000000000001'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.v_lieux_clients
    WHERE id = '1a000003-0000-0000-0000-000000000001'::uuid)
  + (SELECT count(*)::int FROM plateforme.lieux
    WHERE id = '1a000003-0000-0000-0000-000000000001'::uuid),
  0,
  'B1 le lieu trouvé reste invisible par lieux et v_lieux_clients (listes, fiches, tableaux de bord)');
SELECT is(lrp_noms('Ferme'), '',
  'B2 un lieu inactif n''est pas proposé');
SELECT is((SELECT count(*)::int FROM plateforme.f_rechercher_lieux_programmation('LRP serie')), 20,
  'B3 20 lignes au plus');
SELECT is((SELECT count(*)::int FROM plateforme.f_rechercher_lieux_programmation('%')), 0,
  'B4 « % » est cherché tel quel, pas comme un joker');
SELECT is((SELECT count(*)::int FROM plateforme.f_rechercher_lieux_programmation('LRP_serie')), 0,
  'B5 « _ » est cherché tel quel, pas comme un joker');

SELECT lrp_jwt('gestionnaire_lieux', '1a000000-0000-0000-0000-000000000004'::uuid);
SELECT throws_ok($$ SELECT * FROM plateforme.f_rechercher_lieux_programmation('Pavillon') $$,
  '42501', NULL, 'B6 le gestionnaire de lieux est refusé (il reste limité à ses lieux)');

SELECT lrp_jwt('client_organisateur', '1a000000-0000-0000-0000-000000000004'::uuid);
SELECT throws_ok($$ SELECT * FROM plateforme.f_rechercher_lieux_programmation('Pavillon') $$,
  '42501', NULL, 'B7 le client organisateur est refusé');

SELECT lrp_jwt('ops_savr', NULL);
SELECT throws_ok($$ SELECT * FROM plateforme.f_rechercher_lieux_programmation('Pavillon') $$,
  '42501', NULL, 'B8 l''équipe Savr est refusée (elle a son propre chemin)');

SELECT lrp_superuser();
SELECT ok(
  NOT has_function_privilege('anon', 'plateforme.f_rechercher_lieux_programmation(text)', 'EXECUTE'),
  'B9 anon ne peut pas exécuter la recherche');
SELECT ok(
  has_function_privilege('authenticated', 'plateforme.f_rechercher_lieux_programmation(text)', 'EXECUTE'),
  'B10 authenticated peut l''exécuter (le rôle applicatif est filtré dedans)');
SELECT ok(
  pg_get_function_result('plateforme.f_rechercher_lieux_programmation(text)'::regprocedure)
    !~ '(siren|commentaire|email|code_site|latitude|longitude|actif|gestionnaire)',
  'B11 aucune colonne hors formulaire dans le résultat');
SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=plateforme, pg_catalog']
     FROM pg_proc WHERE oid = 'plateforme.f_rechercher_lieux_programmation(text)'::regprocedure),
  'B12 SECURITY DEFINER avec search_path figé');

-- ── C. Après programmation ───────────────────────────────────────────────────
INSERT INTO plateforme.evenements (
  organisation_id, traiteur_operationnel_organisation_id, lieu_id,
  entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone)
VALUES ('1a000000-0000-0000-0000-000000000001'::uuid, '1a000000-0000-0000-0000-000000000001'::uuid,
        '1a000003-0000-0000-0000-000000000001'::uuid, '1a000005-0000-0000-0000-000000000001'::uuid,
        '1a000002-0000-0000-0000-000000000001'::uuid, '1a000006-0000-0000-0000-000000000001'::uuid,
        current_date + 10, 100, 'Alice', '0601020304');

SELECT lrp_jwt('traiteur_manager', '1a000000-0000-0000-0000-000000000001'::uuid);
SELECT is(
  (SELECT nom FROM plateforme.v_lieux_clients
    WHERE id = '1a000003-0000-0000-0000-000000000001'::uuid),
  'LRP Pavillon',
  'C1 une fois un événement programmé, le lieu entre dans le périmètre du traiteur');

SELECT lrp_jwt('traiteur_manager', '1a000000-0000-0000-0000-000000000002'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.v_lieux_clients
    WHERE id = '1a000003-0000-0000-0000-000000000001'::uuid),
  0,
  'C2 un concurrent ne voit toujours pas ce lieu dans ses listes');

SELECT lrp_superuser();
SELECT * FROM finish();
ROLLBACK;

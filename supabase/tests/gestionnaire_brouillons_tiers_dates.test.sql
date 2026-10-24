-- =============================================================================
-- pgTAP — Cloisonnement des brouillons pour le gestionnaire de lieux
-- Migration : 20261024190000_plateforme_gestionnaire_brouillons_tiers_statut.sql
-- (décision Val 2026-10-24, piste « garde sur le statut »)
-- =============================================================================
-- Un brouillon enregistré par le formulaire a une date d'événement (celle de
-- ses collectes, `date_collecte` NOT NULL). Le gestionnaire ne doit pourtant
-- lire aucun brouillon d'une autre organisation tenu sur un lieu de son parc
-- (CDC §06.05 F3) ; le programmeur, lui, voit toujours le sien.
--
--   1-2    non-vacuité : les brouillons tiers sont datés, leurs collectes sont
--          des brouillons (la garde de date seule ne les écarterait pas) ;
--   3-8    gestionnaire du lieu : aucun brouillon tiers par evenements,
--          collectes, f_collecte_visible, v_collectes_gestionnaire_lieux,
--          v_traiteurs_gestionnaire, f_benchmark_single_collecte ;
--   9-11   contrôle positif : un événement tiers confirmé reste lu ;
--   12-13  événement mixte (jeu de données de dev) : lu, sa collecte brouillon
--          non ;
--   14-15  son propre brouillon reste lu (régime « programmé par moi ») ;
--   16     conséquence assumée : événement tiers daté sans aucune collecte
--          (création Admin) non lu ;
--   17     gestionnaire d'un autre parc : rien ;
--   18-23  auteurs : le traiteur, l'agence et le second traiteur voient leurs
--          brouillons, le benchmark de sa collecte reste ouvert au traiteur.
--
-- Fixture : gestionnaire GA (lieu L1), gestionnaire GB (lieu L2), traiteurs T
-- et D, agence Y. Les programmations passent par la vraie fonction
-- `fn_enregistrer_programmation` sous service_role, comme la route.
-- JWT au format PRODUCTION (claim `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(23);

CREATE OR REPLACE FUNCTION _bgt_jwt(p_role text, p_org uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(), 'role', 'authenticated', 'user_role', p_role,
    'organisation_id', p_org, 'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION _bgt_su()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Une carte de programmation (cf. fn_creer_collecte_carte).
CREATE OR REPLACE FUNCTION _bgt_carte(p_type text, p_date date)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'type', p_type, 'type_evenement_id', 'b6d70000-0000-0000-0000-000000000bee',
    'date_collecte', p_date, 'heure_collecte', '20:00', 'pax', 150,
    'contact_principal_nom', 'Contact', 'contact_principal_telephone', '0600000000')
$$;

-- Le niveau événement d'une programmation sur le lieu L1.
CREATE OR REPLACE FUNCTION _bgt_evt(p_org uuid, p_traiteur uuid, p_entite uuid, p_user uuid, p_nom text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'organisation_id', p_org, 'traiteur_operationnel_organisation_id', p_traiteur,
    'entite_facturation_id', p_entite, 'lieu_id', 'b6d70000-0000-0000-0000-000000000b01',
    'created_by', p_user, 'nom_evenement', p_nom)
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd) VALUES
  ('b6d70000-0000-0000-0000-00000000000a', 'BGT Gest A',   'BGT Gest A SA',   'gestionnaire_lieux', '96700000000001', true, 0),
  ('b6d70000-0000-0000-0000-00000000000b', 'BGT Gest B',   'BGT Gest B SA',   'gestionnaire_lieux', '96700000000002', true, 0),
  ('b6d70000-0000-0000-0000-00000000000c', 'BGT Traiteur', 'BGT Traiteur SARL', 'traiteur',         '96700000000003', true, 0),
  ('b6d70000-0000-0000-0000-00000000000d', 'BGT Discret',  'BGT Discret SARL',  'traiteur',         '96700000000004', true, 0),
  ('b6d70000-0000-0000-0000-00000000000e', 'BGT Agence',   'BGT Agence SAS',    'agence',           '96700000000005', true, 0);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif) VALUES
  ('b6d70000-0000-0000-0000-000000000a01', 'b6d70000-0000-0000-0000-00000000000a', 'ga@bgt.test', 'G', 'A', 'gestionnaire_lieux', true),
  ('b6d70000-0000-0000-0000-000000000c01', 'b6d70000-0000-0000-0000-00000000000c', 't@bgt.test',  'T', 'T', 'traiteur_manager',   true),
  ('b6d70000-0000-0000-0000-000000000d01', 'b6d70000-0000-0000-0000-00000000000d', 'd@bgt.test',  'D', 'D', 'traiteur_manager',   true),
  ('b6d70000-0000-0000-0000-000000000e01', 'b6d70000-0000-0000-0000-00000000000e', 'y@bgt.test',  'Y', 'Y', 'agence',             true);

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('b6d70000-0000-0000-0000-0000000000fa', 'b6d70000-0000-0000-0000-00000000000a', 'BGT Gest A SA',     '96700000000001', '1 rue', '75001', 'Paris'),
  ('b6d70000-0000-0000-0000-0000000000fc', 'b6d70000-0000-0000-0000-00000000000c', 'BGT Traiteur SARL', '96700000000003', '3 rue', '75003', 'Paris'),
  ('b6d70000-0000-0000-0000-0000000000fd', 'b6d70000-0000-0000-0000-00000000000d', 'BGT Discret SARL',  '96700000000004', '4 rue', '75004', 'Paris'),
  ('b6d70000-0000-0000-0000-0000000000fe', 'b6d70000-0000-0000-0000-00000000000e', 'BGT Agence SAS',    '96700000000005', '5 rue', '75005', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('b6d70000-0000-0000-0000-000000000b01', 'BGT Lieu 1', '1 av BGT', '75008', 'Paris', 'camionnette'),
  ('b6d70000-0000-0000-0000-000000000b02', 'BGT Lieu 2', '2 av BGT', '75009', 'Paris', 'camionnette');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id) VALUES
  ('b6d70000-0000-0000-0000-00000000000a', 'b6d70000-0000-0000-0000-000000000b01'),
  ('b6d70000-0000-0000-0000-00000000000b', 'b6d70000-0000-0000-0000-000000000b02');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('b6d70000-0000-0000-0000-000000000bee', 'GALA_BGT', 'Gala BGT', 1, true);

-- Identifiants rendus par les programmations (k = événement de la fixture).
CREATE TEMP TABLE _bgt_ids (k text PRIMARY KEY, evt uuid, cols uuid[]) ON COMMIT DROP;
GRANT SELECT ON _bgt_ids TO authenticated;
GRANT SELECT, INSERT, UPDATE ON _bgt_ids TO service_role;

SET LOCAL ROLE service_role;
-- Brouillons tiers sur L1 : traiteur T (ZD + AG), agence Y (traiteur T), traiteur D.
INSERT INTO _bgt_ids SELECT 'brouillon_t', (r->>'evenement_id')::uuid,
  ARRAY(SELECT jsonb_array_elements_text(r->'collecte_ids')::uuid)
FROM plateforme.fn_enregistrer_programmation(
  _bgt_evt('b6d70000-0000-0000-0000-00000000000c', 'b6d70000-0000-0000-0000-00000000000c',
           'b6d70000-0000-0000-0000-0000000000fc', 'b6d70000-0000-0000-0000-000000000c01', 'Brouillon T'),
  jsonb_build_array(_bgt_carte('zd', '2026-12-10'), _bgt_carte('ag', '2026-12-11')), false) r;
INSERT INTO _bgt_ids SELECT 'brouillon_y', (r->>'evenement_id')::uuid,
  ARRAY(SELECT jsonb_array_elements_text(r->'collecte_ids')::uuid)
FROM plateforme.fn_enregistrer_programmation(
  _bgt_evt('b6d70000-0000-0000-0000-00000000000e', 'b6d70000-0000-0000-0000-00000000000c',
           'b6d70000-0000-0000-0000-0000000000fe', 'b6d70000-0000-0000-0000-000000000e01', 'Brouillon Y'),
  jsonb_build_array(_bgt_carte('zd', '2026-12-12')), false) r;
INSERT INTO _bgt_ids SELECT 'brouillon_d', (r->>'evenement_id')::uuid,
  ARRAY(SELECT jsonb_array_elements_text(r->'collecte_ids')::uuid)
FROM plateforme.fn_enregistrer_programmation(
  _bgt_evt('b6d70000-0000-0000-0000-00000000000d', 'b6d70000-0000-0000-0000-00000000000d',
           'b6d70000-0000-0000-0000-0000000000fd', 'b6d70000-0000-0000-0000-000000000d01', 'Brouillon D'),
  jsonb_build_array(_bgt_carte('ag', '2027-01-15')), false) r;
-- Événement tiers confirmé (contrôle positif).
INSERT INTO _bgt_ids SELECT 'confirme_t', (r->>'evenement_id')::uuid,
  ARRAY(SELECT jsonb_array_elements_text(r->'collecte_ids')::uuid)
FROM plateforme.fn_enregistrer_programmation(
  _bgt_evt('b6d70000-0000-0000-0000-00000000000c', 'b6d70000-0000-0000-0000-00000000000c',
           'b6d70000-0000-0000-0000-0000000000fc', 'b6d70000-0000-0000-0000-000000000c01', 'Confirme T'),
  jsonb_build_array(_bgt_carte('zd', '2026-11-20')), true) r;
-- Événement mixte : une collecte confirmée puis une collecte brouillon (seule
-- la seed de dev produit ce cas ; l'application ne le crée pas).
INSERT INTO _bgt_ids SELECT 'mixte_t', (r->>'evenement_id')::uuid,
  ARRAY(SELECT jsonb_array_elements_text(r->'collecte_ids')::uuid)
FROM plateforme.fn_enregistrer_programmation(
  _bgt_evt('b6d70000-0000-0000-0000-00000000000c', 'b6d70000-0000-0000-0000-00000000000c',
           'b6d70000-0000-0000-0000-0000000000fc', 'b6d70000-0000-0000-0000-000000000c01', 'Mixte T'),
  jsonb_build_array(_bgt_carte('zd', '2026-11-25')), true) r;
UPDATE _bgt_ids SET cols = cols || plateforme.fn_creer_collecte_carte(
  evt, _bgt_carte('ag', '2026-11-26'), false, NULL, false)
WHERE k = 'mixte_t';
-- Brouillon PROPRE du gestionnaire GA sur L1.
INSERT INTO _bgt_ids SELECT 'brouillon_ga', (r->>'evenement_id')::uuid,
  ARRAY(SELECT jsonb_array_elements_text(r->'collecte_ids')::uuid)
FROM plateforme.fn_enregistrer_programmation(
  _bgt_evt('b6d70000-0000-0000-0000-00000000000a', 'b6d70000-0000-0000-0000-00000000000c',
           'b6d70000-0000-0000-0000-0000000000fa', 'b6d70000-0000-0000-0000-000000000a01', 'Brouillon GA'),
  jsonb_build_array(_bgt_carte('zd', '2026-12-20')), false) r;
RESET ROLE;

-- Événement tiers daté sans aucune collecte (création Admin).
INSERT INTO plateforme.evenements (id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone)
VALUES ('b6d70000-0000-0000-0000-0000000000e9', 'b6d70000-0000-0000-0000-00000000000c',
  'b6d70000-0000-0000-0000-00000000000c', 'b6d70000-0000-0000-0000-0000000000fc',
  'b6d70000-0000-0000-0000-000000000c01', 'b6d70000-0000-0000-0000-000000000b01',
  'b6d70000-0000-0000-0000-000000000bee', 'Sans collecte T', '2026-12-22', 0, 'Contact', '0600000000');
INSERT INTO _bgt_ids VALUES ('sans_collecte_t', 'b6d70000-0000-0000-0000-0000000000e9', ARRAY[]::uuid[]);

-- ── 1-2. Non-vacuité ────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements e JOIN _bgt_ids i ON i.evt = e.id
    WHERE i.k IN ('brouillon_t', 'brouillon_y', 'brouillon_d') AND e.date_evenement IS NOT NULL),
  3,
  '1. les trois brouillons tiers ont une date d''événement (la garde de date seule ne les écarte pas)');

SELECT is(
  (SELECT array_agg(DISTINCT c.statut::text) FROM plateforme.collectes c JOIN _bgt_ids i ON c.id = ANY (i.cols)
    WHERE i.k IN ('brouillon_t', 'brouillon_y', 'brouillon_d')),
  ARRAY['brouillon'],
  '2. leurs quatre collectes sont des brouillons');

-- ── 3-8. Gestionnaire du lieu : aucun brouillon tiers ──────────────────────
SELECT _bgt_jwt('gestionnaire_lieux', 'b6d70000-0000-0000-0000-00000000000a');

SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements e
    WHERE e.id IN (SELECT evt FROM _bgt_ids WHERE k IN ('brouillon_t', 'brouillon_y', 'brouillon_d'))),
  0,
  'M3.2/brouillons_tiers_dates_evenements_invisibles — brouillon daté d''un traiteur ou d''une agence sur son lieu : événement non lu');

SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes c
    WHERE c.id IN (SELECT unnest(cols) FROM _bgt_ids WHERE k IN ('brouillon_t', 'brouillon_y', 'brouillon_d'))),
  0,
  'M3.2/brouillons_tiers_dates_collectes_invisibles — ses collectes brouillons non lues');

SELECT is(
  (SELECT count(*)::int FROM (SELECT unnest(cols) AS id FROM _bgt_ids
    WHERE k IN ('brouillon_t', 'brouillon_y', 'brouillon_d')) x
    WHERE plateforme.f_collecte_visible(x.id)),
  0,
  '5. f_collecte_visible rend faux pour les quatre collectes brouillons tiers');

SELECT is(
  (SELECT count(*)::int FROM plateforme.v_collectes_gestionnaire_lieux v
    WHERE v.evenement_id IN (SELECT evt FROM _bgt_ids WHERE k IN ('brouillon_t', 'brouillon_y', 'brouillon_d'))),
  0,
  '6. v_collectes_gestionnaire_lieux ne rend aucune collecte brouillon tiers');

SELECT is(
  (SELECT count(*)::int FROM plateforme.v_traiteurs_gestionnaire WHERE id = 'b6d70000-0000-0000-0000-00000000000d'),
  0,
  'M3.2/brouillons_tiers_dates_traiteur_brouillon_seul_absent — un traiteur qui n''a qu''un brouillon sur son lieu n''est pas listé');

SELECT throws_ok(
  format('SELECT * FROM plateforme.f_benchmark_single_collecte(%L)',
         (SELECT cols[1] FROM _bgt_ids WHERE k = 'brouillon_d')),
  'P0001', 'Collecte not accessible',
  'M3.2/brouillons_tiers_dates_benchmark_refuse — benchmark d''une collecte brouillon tiers : refusé');

-- ── 9-11. Contrôle positif : un événement tiers confirmé reste lu ──────────
SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements e WHERE e.id = (SELECT evt FROM _bgt_ids WHERE k = 'confirme_t')),
  1,
  '9. événement tiers confirmé sur son lieu : lu');

SELECT ok(
  plateforme.f_collecte_visible((SELECT cols[1] FROM _bgt_ids WHERE k = 'confirme_t')),
  '10. sa collecte confirmée : lue');

SELECT is(
  (SELECT count(*)::int FROM plateforme.v_traiteurs_gestionnaire WHERE id = 'b6d70000-0000-0000-0000-00000000000c'),
  1,
  '11. le traiteur de l''événement confirmé est listé');

-- ── 12-13. Événement mixte ─────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements e WHERE e.id = (SELECT evt FROM _bgt_ids WHERE k = 'mixte_t')),
  1,
  '12. événement tiers qui garde une collecte confirmée : lu');

SELECT is(
  (SELECT array_agg(c.statut::text) FROM plateforme.collectes c
    WHERE c.evenement_id = (SELECT evt FROM _bgt_ids WHERE k = 'mixte_t')),
  ARRAY['programmee'],
  'M3.2/brouillons_tiers_dates_evenement_mixte — sa collecte confirmée est lue, sa collecte brouillon non');

-- ── 14-15. Son propre brouillon reste lu ───────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements e WHERE e.id = (SELECT evt FROM _bgt_ids WHERE k = 'brouillon_ga')),
  1,
  'M3.2/brouillons_tiers_dates_propre_brouillon_lu — son propre brouillon : événement lu');

SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes c
    WHERE c.evenement_id = (SELECT evt FROM _bgt_ids WHERE k = 'brouillon_ga')),
  1,
  '15. son propre brouillon : collecte lue');

-- ── 16. Conséquence assumée ────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements e WHERE e.id = 'b6d70000-0000-0000-0000-0000000000e9'),
  0,
  'M3.2/brouillons_tiers_dates_sans_collecte_non_lu — événement tiers daté sans aucune collecte : non lu tant qu''aucune collecte n''y est confirmée');

-- ── 17. Gestionnaire d'un autre parc ───────────────────────────────────────
SELECT _bgt_jwt('gestionnaire_lieux', 'b6d70000-0000-0000-0000-00000000000b');
SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements e WHERE e.id IN (SELECT evt FROM _bgt_ids)),
  0,
  '17. gestionnaire d''un autre parc : aucun événement du lieu L1');

-- ── 18-23. Les auteurs voient leurs brouillons ─────────────────────────────
SELECT _bgt_jwt('traiteur_manager', 'b6d70000-0000-0000-0000-00000000000c');
SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements e
    WHERE e.id IN (SELECT evt FROM _bgt_ids WHERE k IN ('brouillon_t', 'brouillon_y'))),
  2,
  'M3.2/brouillons_tiers_dates_proprietaire_lit — le traiteur lit son brouillon et celui de l''agence qui le nomme traiteur opérationnel');

SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes c
    WHERE c.id IN (SELECT unnest(cols) FROM _bgt_ids WHERE k = 'brouillon_t')),
  2,
  '19. le traiteur lit les deux collectes de son brouillon');

SELECT lives_ok(
  format('SELECT * FROM plateforme.f_benchmark_single_collecte(%L)',
         (SELECT cols[1] FROM _bgt_ids WHERE k = 'brouillon_t')),
  '20. benchmark de sa collecte brouillon : ouvert au traiteur');

SELECT _bgt_jwt('agence', 'b6d70000-0000-0000-0000-00000000000e');
SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements e WHERE e.id = (SELECT evt FROM _bgt_ids WHERE k = 'brouillon_y')),
  1,
  '21. l''agence lit son brouillon');

SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes c
    WHERE c.id IN (SELECT unnest(cols) FROM _bgt_ids WHERE k = 'brouillon_y')),
  1,
  '22. l''agence lit la collecte de son brouillon');

SELECT _bgt_jwt('traiteur_manager', 'b6d70000-0000-0000-0000-00000000000d');
SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements e WHERE e.id = (SELECT evt FROM _bgt_ids WHERE k = 'brouillon_d')),
  1,
  '23. le second traiteur lit son brouillon');

SELECT _bgt_su();
SELECT * FROM finish();
ROLLBACK;

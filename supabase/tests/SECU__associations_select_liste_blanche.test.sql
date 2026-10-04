-- =============================================================================
-- Tests pgTAP — associations : SELECT en liste blanche colonne-level
-- Migration prouvée : 20261004200000_plateforme_associations_select_liste_blanche
-- =============================================================================
-- Fuite fermée (reviewer-rls-securite, 2026-10-04) : la policy `asso_read`
-- (auth.role() = 'authenticated') rend toutes les lignes du référentiel à tout
-- utilisateur connecté, et `authenticated` portait le SELECT table-level — tout
-- rôle client lisait donc par PostgREST direct les 26 colonnes, dont les notes
-- internes Savr, le contact (nom, email, téléphone), le SIREN, les instructions
-- d'accès et l'identifiant du point de collecte chez le transporteur.
--
-- Fixture = une association dont les 26 colonnes sont renseignées, bénéficiaire
-- d'une collecte Anti-Gaspi clôturée programmée par un TRAITEUR, sur le lieu d'un
-- GESTIONNAIRE, pour un CLIENT ORGANISATEUR doté d'un compte ; plus une AGENCE et
-- un traiteur SANS LIEN (le référentiel est global : eux aussi voient la ligne).
--
-- Deux façons de prouver, volontairement redondantes :
--   - le catalogue (1-4) : privilèges tels que PostgreSQL les déclare ;
--   - le comportement (helper test_asso_colonnes) : un SELECT réel de CHAQUE
--     colonne de la table, sous le rôle courant, classé lu / refusé (42501). Les
--     colonnes viennent de pg_attribute : une colonne ajoutée demain est sondée
--     sans toucher au test.
--
-- NON-VACUITÉ (mesurée le 2026-10-04 sur une base rejouée depuis zéro, 172
-- migrations de main, SANS cette migration) : 27 assertions tombent en `not ok`
-- — 1, 2, 8-17, 19, 26-35, 42, 44, 45, 48 : toutes celles qui affirment une
-- fermeture (les SELECT passent). Les 22 autres restent vertes : ce sont les
-- contrôles positifs (3-7, 18, 20-25, 36-41, 43, 46, 47, 49), qui tiennent
-- avant comme après. Ils prouvent que chaque refus vient du privilège colonne,
-- pas d'une ligne invisible ni d'une fixture invalide : sous la même identité,
-- la même ligne se lit par les colonnes de la liste blanche. AVEC la
-- migration : 49 sur 49.
-- Sondes de mutation sur la base migrée (même date) : policy asso_read retirée
-- → 6, 7, 17, 18, 21-25, 28, 30, 32, 34, 36 rougissent (la visibilité de la
-- ligne est tenue pour chaque rôle client) ; une colonne fermée rouverte
-- (contact_email) → 2, 9, 16, 17, 26-35, 45 ; une policy UPDATE ouverte aux
-- clients → 37, 40, 41.
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(49);

-- Helpers ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION test_set_jwt_prod(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'role', 'authenticated',
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

CREATE OR REPLACE FUNCTION test_as_service_role()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', 'service_role', true);
END $$;

-- Sonde de comportement : pour chaque colonne de la table (ordre alphabétique),
-- tente un SELECT réel de la ligne de la fixture sous le rôle COURANT (fonction
-- SECURITY INVOKER). Rend les colonnes lues (p_lisibles = true) ou refusées en
-- 42501 (p_lisibles = false). Toute autre erreur remonte et fait échouer le test.
-- « Lue » exige que la LIGNE revienne : une colonne dont le privilège passe mais
-- dont la ligne est invisible (policy asso_read retirée) sort suffixée
-- « [ligne invisible] » — la comparaison rougit avec un diagnostic lisible, au
-- lieu de rester verte sur le seul privilège.
CREATE OR REPLACE FUNCTION test_asso_colonnes(p_lisibles boolean)
RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE
  v_col text;
  v_lue boolean;
  v_lignes int;
  v_res text[] := ARRAY[]::text[];
BEGIN
  FOR v_col IN
    SELECT attname::text
      FROM pg_attribute
     WHERE attrelid = 'plateforme.associations'::regclass AND attnum > 0 AND NOT attisdropped
     ORDER BY attname
  LOOP
    v_lignes := NULL;
    BEGIN
      EXECUTE format(
        'SELECT count(*)::int FROM (SELECT %I FROM plateforme.associations WHERE id = %L) s',
        v_col, 'a55aa001-0000-0000-0000-0000000000a5') INTO v_lignes;
      v_lue := true;
    EXCEPTION WHEN insufficient_privilege THEN
      v_lue := false;
    END;
    IF v_lue = p_lisibles THEN
      v_res := v_res || CASE WHEN v_lue AND v_lignes = 0
                             THEN v_col || ' [ligne invisible]' ELSE v_col END;
    END IF;
  END LOOP;
  RETURN v_res;
END $$;

-- Fixture ---------------------------------------------------------------------
-- T = traiteur programmateur ; A = agence ; G = gestionnaire du lieu L ;
-- X = traiteur sans lien ; O = client organisateur.
SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
  ('a55a0001-0000-0000-0000-0000000000a5'::uuid, 'A5 Traiteur', 'A5 Traiteur SAS', 'traiteur', '55590000000001', true),
  ('a55a0002-0000-0000-0000-0000000000a5'::uuid, 'A5 Agence', 'A5 Agence SAS', 'agence', '55590000000002', true),
  ('a55a0003-0000-0000-0000-0000000000a5'::uuid, 'A5 Gest', 'A5 Gest SA', 'gestionnaire_lieux', '55590000000003', true),
  ('a55a0004-0000-0000-0000-0000000000a5'::uuid, 'A5 Tiers', 'A5 Tiers SAS', 'traiteur', '55590000000004', true),
  ('a55a0005-0000-0000-0000-0000000000a5'::uuid, 'A5 Client', 'A5 Client SA', 'client_organisateur', '55590000000005', true);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('a55aef01-0000-0000-0000-0000000000a5'::uuid, 'a55a0001-0000-0000-0000-0000000000a5'::uuid,
        'A5 Traiteur SAS', '55590000000001', '1 rue Traiteur', '75001', 'Paris');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif) VALUES
  ('a55a0a01-0000-0000-0000-0000000000a5'::uuid, 'a55a0001-0000-0000-0000-0000000000a5'::uuid,
   'mgr@a5-traiteur.test', 'Mgr', 'Traiteur', 'traiteur_manager', true);

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region)
VALUES ('a55a1001-0000-0000-0000-0000000000a5'::uuid, 'A5 Lieu', '3 rue Lieu', '75003', 'Paris', 'camionnette', 48.87, 2.36, 'idf');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('a55a0003-0000-0000-0000-0000000000a5'::uuid, 'a55a1001-0000-0000-0000-0000000000a5'::uuid);

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('a55a7e01-0000-0000-0000-0000000000a5'::uuid, 'SECU_A5_ASSOCIATIONS', 'SECU A5 associations', 1, true);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, client_organisateur_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  'a55ae001-0000-0000-0000-0000000000a5'::uuid,
  'a55a0001-0000-0000-0000-0000000000a5'::uuid, 'a55a0001-0000-0000-0000-0000000000a5'::uuid,
  'a55a0005-0000-0000-0000-0000000000a5'::uuid,
  'a55aef01-0000-0000-0000-0000000000a5'::uuid, 'a55a0a01-0000-0000-0000-0000000000a5'::uuid,
  'a55a1001-0000-0000-0000-0000000000a5'::uuid, 'a55a7e01-0000-0000-0000-0000000000a5'::uuid,
  'A5 Gala', '2026-09-12', 300, 'Contact A5', '0600000055'
);

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, realisee_at)
VALUES ('a55ac001-0000-0000-0000-0000000000a5'::uuid, 'a55ae001-0000-0000-0000-0000000000a5'::uuid,
        'anti_gaspi', 'cloturee', 'non_envoye', '2026-09-12', '23:00', now() - interval '30 hours');

-- L'association : les 26 colonnes renseignées (id + 25 ci-dessous).
INSERT INTO plateforme.associations (
  id, nom, adresse, latitude, longitude, region, ville,
  capacite_max_beneficiaires, types_aliments_acceptes, horaires_ouverture,
  contact_nom, contact_email, contact_telephone,
  habilitee_attestation_fiscale, actif, derniere_verification, commentaires_internes,
  description_rapport_impact, id_point_collecte_mts1, created_at, updated_at,
  logo_url, instructions_acces, siren, date_expiration_habilitation, numero_rup
) VALUES (
  'a55aa001-0000-0000-0000-0000000000a5'::uuid, 'A5 Asso', '5 rue Asso', 48.8566, 2.3522, 'idf', 'Paris',
  120, ARRAY['chaud', 'froid'], '{"lundi": [{"debut": "09:00", "fin": "18:00"}]}'::jsonb,
  'Contact Asso A5', 'contact@a5-asso.test', '0655555555',
  true, true, '2026-08-01', 'NOTE ADMIN A5',
  'Association de test A5 : distribue des repas aux personnes en difficulté.', 'PT-A5-042',
  '2026-01-01 10:00:00+00', '2026-01-02 10:00:00+00',
  'savr-logos/logos/a55aa001-0000-0000-0000-0000000000a5.png', 'Interphone A5, 2e porte', '555900005',
  '2027-12-31', 'RUP-A5-1901'
);

INSERT INTO plateforme.transporteurs
  (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms, contact_nom, contact_email, contact_telephone)
VALUES ('a55ab001-0000-0000-0000-0000000000a5'::uuid, 'A5 Trans', '555900009', '9 rue Trans', '75009', 'Paris',
        ARRAY['camionnette'], 'autre', 'C', 'trans@a5.test', '0600000059');

INSERT INTO plateforme.attributions_antgaspi
  (collecte_id, association_id, transporteur_id, branche_attribution, mode_validation, volume_repas_realise)
VALUES ('a55ac001-0000-0000-0000-0000000000a5'::uuid, 'a55aa001-0000-0000-0000-0000000000a5'::uuid,
        'a55ab001-0000-0000-0000-0000000000a5'::uuid, 'branche_1', 'manuel_top1', 120);

INSERT INTO plateforme.attestations_don
  (id, collecte_id, association_id, statut, genere_at, pdf_url, eligible_at,
   donateur_raison_sociale, donateur_siret, association_nom, nb_repas)
VALUES ('a55ad001-0000-0000-0000-0000000000a5'::uuid, 'a55ac001-0000-0000-0000-0000000000a5'::uuid,
        'a55aa001-0000-0000-0000-0000000000a5'::uuid, 'emise', now() - interval '29 hours', 'att/a5.pdf',
        now() - interval '6 hours', 'A5 Traiteur SAS', '55590000000001', 'A5 Asso', 120);

-- =============================================================================
-- 1-4 — Privilèges (catalogue) : table-level retiré, liste blanche exacte
-- =============================================================================
SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.associations', 'SELECT'),
  '1. authenticated n''a plus le SELECT TABLE-LEVEL sur associations (sinon un REVOKE colonne serait inopérant)');

SELECT is(
  (SELECT array_agg(attname::text ORDER BY attname)
     FROM pg_attribute
    WHERE attrelid = 'plateforme.associations'::regclass AND attnum > 0 AND NOT attisdropped
      AND has_column_privilege('authenticated', attrelid, attnum, 'SELECT')),
  ARRAY['description_rapport_impact', 'id', 'latitude', 'longitude', 'nom', 'region', 'ville'],
  '2. liste blanche SELECT authenticated EXACTE (7 colonnes : un ajout comme un retrait fait rougir)');

SELECT is(
  (SELECT count(*)::int
     FROM pg_attribute
    WHERE attrelid = 'plateforme.associations'::regclass AND attnum > 0 AND NOT attisdropped
      AND has_column_privilege('anon', attrelid, attnum, 'SELECT')),
  0,
  '3. anon ne lit aucune colonne de associations');

SELECT ok(
  has_table_privilege('service_role', 'plateforme.associations', 'SELECT'),
  '4. service_role garde le SELECT table-level (back-office Associations, algo, batch PDF, worker outbox)');

-- =============================================================================
-- 5 — Non-vacuité : la ligne existe et porte les 19 colonnes retirées renseignées
-- =============================================================================
SELECT is(
  (SELECT count(*)::int FROM plateforme.associations
    WHERE id = 'a55aa001-0000-0000-0000-0000000000a5'
      AND actif IS NOT NULL AND adresse IS NOT NULL AND capacite_max_beneficiaires IS NOT NULL
      AND commentaires_internes IS NOT NULL AND contact_email IS NOT NULL AND contact_nom IS NOT NULL
      AND contact_telephone IS NOT NULL AND created_at IS NOT NULL
      AND date_expiration_habilitation IS NOT NULL AND derniere_verification IS NOT NULL
      AND habilitee_attestation_fiscale IS NOT NULL AND horaires_ouverture IS NOT NULL
      AND id_point_collecte_mts1 IS NOT NULL AND instructions_acces IS NOT NULL AND logo_url IS NOT NULL
      AND numero_rup IS NOT NULL AND siren IS NOT NULL AND types_aliments_acceptes IS NOT NULL
      AND updated_at IS NOT NULL),
  1,
  '5. non-vacuité (superuser) : l''association existe, les 19 colonnes retirées sont renseignées');

-- =============================================================================
-- 6-20 — gestionnaire_lieux : le cas mesuré (PostgREST direct, select=*)
-- =============================================================================
SELECT test_set_jwt_prod('gestionnaire_lieux', 'a55a0003-0000-0000-0000-0000000000a5'::uuid);

SELECT is(
  (SELECT nom FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5'),
  'A5 Asso',
  '6. gestionnaire : la ligne reste visible (asso_read inchangée) — les refus 8-16 portent sur la colonne');

SELECT is(
  (SELECT id::text || '|' || nom || '|' || ville || '|' || region::text || '|' || latitude::text || '|'
          || longitude::text || '|' || description_rapport_impact
     FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5'),
  'a55aa001-0000-0000-0000-0000000000a5|A5 Asso|Paris|idf|48.8566|2.3522|'
    || 'Association de test A5 : distribue des repas aux personnes en difficulté.',
  '7. gestionnaire : les 7 colonnes de la liste blanche se lisent ensemble, avec leurs valeurs');

SELECT throws_ok($$ SELECT commentaires_internes FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5' $$,
  '42501', NULL, '8. gestionnaire : commentaires_internes illisible (notes Admin Savr)');
SELECT throws_ok($$ SELECT contact_email FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5' $$,
  '42501', NULL, '9. gestionnaire : contact_email illisible');
SELECT throws_ok($$ SELECT contact_telephone FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5' $$,
  '42501', NULL, '10. gestionnaire : contact_telephone illisible');
SELECT throws_ok($$ SELECT contact_nom FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5' $$,
  '42501', NULL, '11. gestionnaire : contact_nom illisible');
SELECT throws_ok($$ SELECT id_point_collecte_mts1 FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5' $$,
  '42501', NULL, '12. gestionnaire : id_point_collecte_mts1 illisible (identifiant chez le transporteur)');
SELECT throws_ok($$ SELECT siren FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5' $$,
  '42501', NULL, '13. gestionnaire : siren illisible');
SELECT throws_ok($$ SELECT instructions_acces FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5' $$,
  '42501', NULL, '14. gestionnaire : instructions_acces illisible');
SELECT throws_ok($$ SELECT * FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5' $$,
  '42501', NULL, '15. gestionnaire : SELECT * (PostgREST select=*) refusé — la requête du constat');

SELECT is(
  test_asso_colonnes(false),
  ARRAY['actif', 'adresse', 'capacite_max_beneficiaires', 'commentaires_internes', 'contact_email',
        'contact_nom', 'contact_telephone', 'created_at', 'date_expiration_habilitation',
        'derniere_verification', 'habilitee_attestation_fiscale', 'horaires_ouverture',
        'id_point_collecte_mts1', 'instructions_acces', 'logo_url', 'numero_rup', 'siren',
        'types_aliments_acceptes', 'updated_at'],
  '16. gestionnaire : un SELECT réel de chaque colonne — EXACTEMENT 19 refusées en 42501');

SELECT is(
  test_asso_colonnes(true),
  ARRAY['description_rapport_impact', 'id', 'latitude', 'longitude', 'nom', 'region', 'ville'],
  '17. gestionnaire : un SELECT réel de chaque colonne — EXACTEMENT 7 lues');

-- Route /gestionnaire/evenements/[id] : attestations_don(..., associations!association_id(nom)).
SELECT is(
  (SELECT a.nom
     FROM plateforme.attestations_don ad
     JOIN plateforme.associations a ON a.id = ad.association_id
    WHERE ad.collecte_id = 'a55ac001-0000-0000-0000-0000000000a5'),
  'A5 Asso',
  '18. gestionnaire : le nom de l''association se lit toujours par l''embed attestations_don → associations');

SELECT throws_ok(
  $$ SELECT a.contact_telephone
       FROM plateforme.attestations_don ad
       JOIN plateforme.associations a ON a.id = ad.association_id
      WHERE ad.collecte_id = 'a55ac001-0000-0000-0000-0000000000a5' $$,
  '42501', NULL, '19. gestionnaire : téléphone illisible aussi par l''embed, depuis une attestation qu''il voit');

-- Même route : attributions_antgaspi(..., associations!association_id(nom, ville, latitude,
-- longitude)). aa_select ne rend pas l'attribution d'un tiers au gestionnaire (objet du lot
-- v_attributions_gestionnaire) : la requête passe le contrôle de privilège et rend 0 ligne.
-- Les VALEURS de cette forme de requête sont prouvées sous le traiteur (25).
SELECT lives_ok(
  $$ SELECT a.nom, a.ville, a.latitude, a.longitude
       FROM plateforme.attributions_antgaspi aa
       JOIN plateforme.associations a ON a.id = aa.association_id
      WHERE aa.collecte_id = 'a55ac001-0000-0000-0000-0000000000a5' $$,
  '20. gestionnaire : l''embed attributions → associations(nom, ville, latitude, longitude) passe le contrôle de privilège');

-- =============================================================================
-- 21-27 — traiteur_manager programmateur : les lectures réelles des écrans clients
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_manager', 'a55a0001-0000-0000-0000-0000000000a5'::uuid,
                         'a55a0a01-0000-0000-0000-0000000000a5'::uuid);

SELECT is(
  (SELECT nom FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5'),
  'A5 Asso',
  '21. traiteur : la ligne reste visible');

SELECT is(
  (SELECT a.nom || '|' || a.ville || '|' || a.description_rapport_impact
     FROM plateforme.attributions_antgaspi aa
     JOIN plateforme.associations a ON a.id = aa.association_id
    WHERE aa.collecte_id = 'a55ac001-0000-0000-0000-0000000000a5'),
  'A5 Asso|Paris|Association de test A5 : distribue des repas aux personnes en difficulté.',
  '22. traiteur : fiche collecte (nom, ville, description_rapport_impact) servie par l''embed');

SELECT is(
  (SELECT a.nom || '|' || a.ville || '|' || a.region::text
     FROM plateforme.attributions_antgaspi aa
     JOIN plateforme.associations a ON a.id = aa.association_id
    WHERE aa.collecte_id = 'a55ac001-0000-0000-0000-0000000000a5'),
  'A5 Asso|Paris|idf',
  '23. traiteur : export CSV « Associations bénéficiaires AG » (nom, ville, region) servi (§12)');

SELECT is(
  (SELECT a.id::text || '|' || a.nom || '|' || a.ville
     FROM plateforme.attributions_antgaspi aa
     JOIN plateforme.associations a ON a.id = aa.association_id
    WHERE aa.collecte_id = 'a55ac001-0000-0000-0000-0000000000a5'),
  'a55aa001-0000-0000-0000-0000000000a5|A5 Asso|Paris',
  '24. traiteur : dashboards « Top associations » et synthèse PDF (id, nom, ville) servis');

SELECT is(
  (SELECT a.nom || '|' || a.ville || '|' || a.latitude::text || '|' || a.longitude::text
     FROM plateforme.attributions_antgaspi aa
     JOIN plateforme.associations a ON a.id = aa.association_id
    WHERE aa.collecte_id = 'a55ac001-0000-0000-0000-0000000000a5'),
  'A5 Asso|Paris|48.8566|2.3522',
  '25. embed (nom, ville, latitude, longitude) du détail événement : valeurs servies quand l''attribution est visible');

SELECT is(
  test_asso_colonnes(false),
  ARRAY['actif', 'adresse', 'capacite_max_beneficiaires', 'commentaires_internes', 'contact_email',
        'contact_nom', 'contact_telephone', 'created_at', 'date_expiration_habilitation',
        'derniere_verification', 'habilitee_attestation_fiscale', 'horaires_ouverture',
        'id_point_collecte_mts1', 'instructions_acces', 'logo_url', 'numero_rup', 'siren',
        'types_aliments_acceptes', 'updated_at'],
  '26. traiteur_manager : EXACTEMENT 19 colonnes refusées');

SELECT throws_ok(
  $$ SELECT a.contact_email
       FROM plateforme.attributions_antgaspi aa
       JOIN plateforme.associations a ON a.id = aa.association_id
      WHERE aa.collecte_id = 'a55ac001-0000-0000-0000-0000000000a5' $$,
  '42501', NULL, '27. traiteur : email du contact illisible par l''embed, depuis sa propre attribution');

-- =============================================================================
-- 28-36 — les autres rôles clients : même liste, mêmes refus
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_commercial', 'a55a0001-0000-0000-0000-0000000000a5'::uuid);
SELECT is(test_asso_colonnes(true),
  ARRAY['description_rapport_impact', 'id', 'latitude', 'longitude', 'nom', 'region', 'ville'],
  '28. traiteur_commercial : EXACTEMENT 7 colonnes lues');
SELECT is(array_length(test_asso_colonnes(false), 1), 19,
  '29. traiteur_commercial : 19 colonnes refusées');

SELECT test_set_jwt_prod('agence', 'a55a0002-0000-0000-0000-0000000000a5'::uuid);
SELECT is(test_asso_colonnes(true),
  ARRAY['description_rapport_impact', 'id', 'latitude', 'longitude', 'nom', 'region', 'ville'],
  '30. agence : EXACTEMENT 7 colonnes lues');
SELECT is(array_length(test_asso_colonnes(false), 1), 19,
  '31. agence : 19 colonnes refusées');

SELECT test_set_jwt_prod('client_organisateur', 'a55a0005-0000-0000-0000-0000000000a5'::uuid);
SELECT is(test_asso_colonnes(true),
  ARRAY['description_rapport_impact', 'id', 'latitude', 'longitude', 'nom', 'region', 'ville'],
  '32. client organisateur : EXACTEMENT 7 colonnes lues');
SELECT is(array_length(test_asso_colonnes(false), 1), 19,
  '33. client organisateur : 19 colonnes refusées');

SELECT test_set_jwt_prod('traiteur_manager', 'a55a0004-0000-0000-0000-0000000000a5'::uuid);
SELECT is(test_asso_colonnes(true),
  ARRAY['description_rapport_impact', 'id', 'latitude', 'longitude', 'nom', 'region', 'ville'],
  '34. traiteur sans lien : EXACTEMENT 7 colonnes lues');
SELECT is(array_length(test_asso_colonnes(false), 1), 19,
  '35. traiteur sans lien : 19 colonnes refusées');
SELECT is(
  (SELECT count(*)::int FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5'),
  1,
  '36. traiteur sans lien : la LIGNE reste visible — asso_read inchangée, ce lot ne ferme que des colonnes');

-- =============================================================================
-- 37-40 — Écriture : aucun rôle client n'écrit (policies inchangées)
-- =============================================================================
-- authenticated garde INSERT / UPDATE / DELETE table-level, bornés par asso_admin et
-- asso_ops_update. Épinglé ici pour que la fermeture en lecture ne laisse pas croire
-- que l'écriture a été regardée ailleurs.
SELECT test_set_jwt_prod('traiteur_manager', 'a55a0001-0000-0000-0000-0000000000a5'::uuid,
                         'a55a0a01-0000-0000-0000-0000000000a5'::uuid);

-- (CTE d'écriture : PostgreSQL l'exige au niveau supérieur de la requête.)
WITH u AS (
  UPDATE plateforme.associations SET nom = 'A5 pirate'
   WHERE id = 'a55aa001-0000-0000-0000-0000000000a5' RETURNING 1
)
SELECT is(
  (SELECT count(*)::int FROM u),
  0,
  '37. traiteur : UPDATE sur associations = 0 ligne (aucune policy d''écriture cliente)');

SELECT throws_ok(
  $$ INSERT INTO plateforme.associations (nom, adresse, region, ville, contact_email, description_rapport_impact)
     VALUES ('A5 intrus', '1 rue', 'idf', 'Paris', 'intrus@a5.test',
             'Association créée par un rôle client : ne doit jamais passer.') $$,
  '42501', NULL, '38. traiteur : INSERT sur associations refusé (RLS)');

WITH d AS (
  DELETE FROM plateforme.associations
   WHERE id = 'a55aa001-0000-0000-0000-0000000000a5' RETURNING 1
)
SELECT is(
  (SELECT count(*)::int FROM d),
  0,
  '39. traiteur : DELETE sur associations = 0 ligne');

SELECT test_as_superuser();
SELECT is(
  (SELECT nom FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5'),
  'A5 Asso',
  '40. contrôle (superuser) : la ligne est intacte après les tentatives 37 et 39');

-- =============================================================================
-- 41-47 — staff et service_role
-- =============================================================================
SELECT test_set_jwt_prod('admin_savr', NULL);

SELECT is(
  (SELECT nom FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5'),
  'A5 Asso',
  '41. admin_savr (JWT) : la ligne reste visible');

-- Effet de bord ASSUMÉ et épinglé : le privilège est par rôle PG, admin_savr et ops_savr
-- portent `authenticated`. Le back-office lit associations en service_role.
SELECT throws_ok($$ SELECT commentaires_internes FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5' $$,
  '42501', NULL, '42. admin_savr (JWT, PostgREST direct) : commentaires_internes fermé aussi — le back-office lit en service_role');

-- Écriture staff par JWT (policy asso_admin) : conservée, mais sans relecture des
-- colonnes fermées. Aucun code du dépôt n'écrit associations sous JWT ; épinglé
-- pour qu'une route qui le ferait un jour sache à quoi s'attendre.
WITH u AS (
  UPDATE plateforme.associations SET derniere_verification = '2026-09-30'
   WHERE id = 'a55aa001-0000-0000-0000-0000000000a5' RETURNING 1
)
SELECT is(
  (SELECT count(*)::int FROM u),
  1,
  '43. admin_savr (JWT) : UPDATE d''une colonne fermée filtré sur id = 1 ligne (écriture staff conservée)');

SELECT throws_ok(
  $$ UPDATE plateforme.associations SET derniere_verification = '2026-09-29'
      WHERE id = 'a55aa001-0000-0000-0000-0000000000a5' RETURNING commentaires_internes $$,
  '42501', NULL, '44. admin_savr (JWT) : le même UPDATE avec RETURNING d''une colonne fermée est refusé (PostgREST return=representation)');

SELECT test_set_jwt_prod('ops_savr', NULL);
SELECT is(array_length(test_asso_colonnes(false), 1), 19,
  '45. ops_savr (JWT, PostgREST direct) : mêmes 19 colonnes refusées');

SELECT test_as_service_role();
SELECT is(array_length(test_asso_colonnes(true), 1), 26,
  '46. service_role : lit les 26 colonnes — la fiche entière des écrans Admin Associations');

SELECT is(
  (SELECT commentaires_internes || '|' || contact_nom || '|' || contact_email || '|' || contact_telephone
          || '|' || id_point_collecte_mts1 || '|' || siren || '|' || instructions_acces || '|' || adresse
          || '|' || numero_rup || '|' || habilitee_attestation_fiscale::text
     FROM plateforme.associations WHERE id = 'a55aa001-0000-0000-0000-0000000000a5'),
  'NOTE ADMIN A5|Contact Asso A5|contact@a5-asso.test|0655555555|PT-A5-042|555900005|'
    || 'Interphone A5, 2e porte|5 rue Asso|RUP-A5-1901|true',
  '47. service_role : les colonnes retirées se lisent avec leurs valeurs (aucune donnée touchée)');

-- =============================================================================
-- 48-49 — Fail-closed : une colonne ajoutée plus tard n'est pas lisible par défaut
-- =============================================================================
SELECT test_as_superuser();
ALTER TABLE plateforme.associations ADD COLUMN sonde_a5_fail_closed text;

SELECT ok(
  NOT has_column_privilege('authenticated', 'plateforme.associations', 'sonde_a5_fail_closed', 'SELECT'),
  '48. fail-closed : une colonne ajoutée à associations n''est pas lisible par authenticated');
SELECT ok(
  has_column_privilege('service_role', 'plateforme.associations', 'sonde_a5_fail_closed', 'SELECT'),
  '49. contrôle positif de la sonde : service_role, lui, lit la nouvelle colonne (privilège table-level)');

SELECT * FROM finish();
ROLLBACK;

-- =============================================================================
-- Tests pgTAP — transporteurs : lecture cliente fermée (policy transp_read retirée)
-- Migration prouvée : plateforme_transporteurs_lecture_cliente_fermee (2026-10-05)
-- =============================================================================
-- Fuite fermée (constat du 2026-10-04, re-mesuré le 2026-10-05) : la policy
-- `transp_read` (auth.role() = 'authenticated') rendait toutes les lignes du
-- référentiel des transporteurs à tout utilisateur connecté, et `authenticated`
-- porte le SELECT table-level — tout rôle client lisait donc par PostgREST direct
-- les 22 colonnes : nom du prestataire (règle de marque blanche), contact (nom,
-- email, téléphone), prix d'achat (tarif_par_course), notes internes Savr, SIREN,
-- code chez le TMS externe, rattachement au prestataire logistique.
--
-- Aucun rôle client n'a de lecteur légitime de cette table (recensement dans
-- l'en-tête de la migration) : la fermeture porte sur les LIGNES, pas sur une
-- liste de colonnes. Restent les policies du staff (transp_admin,
-- transp_ops_select, transp_ops_write) et service_role, qui contourne la RLS.
--
-- Fixture = deux transporteurs (un actif dont les 22 colonnes sont renseignées,
-- un inactif) ; le premier est attribué à une collecte Anti-Gaspi programmée par
-- un TRAITEUR, sur le lieu d'un GESTIONNAIRE, pour un CLIENT ORGANISATEUR ; plus
-- une AGENCE et un traiteur SANS LIEN.
--
-- Deux façons de prouver, volontairement redondantes :
--   - le catalogue (1-8) : policies et privilèges tels que PostgreSQL les déclare.
--     Trois cliquets, parce que le privilège table-level reste à authenticated et
--     que la fermeture ne tient donc qu'à eux : 2 épingle chaque policy de la
--     table, prédicat compris (une policy ajoutée, ou élargie sous le même nom,
--     rougit) ; 7 refuse toute vue posée sur la table ; 8 refuse qu'une fonction
--     SECURITY DEFINER qui atteint la table devienne exécutable par un client ;
--   - le comportement (helper test_transp_colonnes) : un SELECT réel de CHAQUE
--     colonne de la ligne de la fixture, sous le rôle courant, classé « lue »
--     (la ligne revient), « invisible » (le privilège passe, la ligne ne revient
--     pas) ou « refusee » (42501). Les colonnes viennent de pg_attribute : une
--     colonne ajoutée demain est sondée sans toucher au test.
--
-- Un « rien ne revient » n'a de valeur que si le lecteur fonctionne. Trois
-- garde-fous contre le négatif vide :
--   - sous chaque rôle client, le JWT est contrôlé AVANT la lecture (12, 18, 24,
--     27, 30) : il satisfait exactement le prédicat de l'ancienne policy ;
--   - la même sonde, sous admin_savr, ops_savr et service_role, rend les 22
--     colonnes « lues » (39, 43, 45) ;
--   - sans la migration, ces mêmes assertions sont rouges (ci-dessous) : la ligne
--     était bien lisible par cette requête, sous ce rôle.
--
-- NON-VACUITÉ et SONDES DE MUTATION : mesurées, voir l'en-tête de la migration
-- (les numéros d'assertion y sont cités).
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

-- Toutes les colonnes de la table, ordre alphabétique (référence des sondes).
CREATE OR REPLACE FUNCTION test_transp_toutes_colonnes()
RETURNS text[] LANGUAGE sql AS $$
  SELECT array_agg(attname::text ORDER BY attname)
    FROM pg_attribute
   WHERE attrelid = 'plateforme.transporteurs'::regclass AND attnum > 0 AND NOT attisdropped
$$;

-- Sonde de comportement : pour chaque colonne de la table (ordre alphabétique),
-- tente un SELECT réel de la ligne de la fixture sous le rôle COURANT (fonction
-- SECURITY INVOKER) et classe la colonne :
--   'lue'       — la requête passe ET la ligne revient ;
--   'invisible' — la requête passe, la ligne ne revient pas (RLS) ;
--   'refusee'   — 42501 (privilège).
-- Rend les colonnes de l'état demandé. Toute autre erreur remonte et fait
-- échouer le test.
CREATE OR REPLACE FUNCTION test_transp_colonnes(p_etat text)
RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE
  v_col text;
  v_etat text;
  v_lignes int;
  v_res text[] := ARRAY[]::text[];
BEGIN
  FOR v_col IN
    SELECT attname::text
      FROM pg_attribute
     WHERE attrelid = 'plateforme.transporteurs'::regclass AND attnum > 0 AND NOT attisdropped
     ORDER BY attname
  LOOP
    BEGIN
      EXECUTE format(
        'SELECT count(*)::int FROM (SELECT %I FROM plateforme.transporteurs WHERE id = %L) s',
        v_col, '7a5bb001-0000-0000-0000-0000000000b7') INTO v_lignes;
      v_etat := CASE WHEN v_lignes > 0 THEN 'lue' ELSE 'invisible' END;
    EXCEPTION WHEN insufficient_privilege THEN
      v_etat := 'refusee';
    END;
    IF v_etat = p_etat THEN
      v_res := v_res || v_col;
    END IF;
  END LOOP;
  RETURN v_res;
END $$;

-- Écriture comptée : exécute l'ordre sous le rôle COURANT et rend le nombre de
-- lignes touchées. -1 si une clé étrangère a arrêté l'ordre : des lignes étaient
-- bien visées (le DELETE d'un transporteur attribué bute sur attributions_antgaspi).
CREATE OR REPLACE FUNCTION test_lignes_touchees(p_sql text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_n int;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
EXCEPTION WHEN foreign_key_violation THEN
  RETURN -1;
END $$;

-- Fixture ---------------------------------------------------------------------
-- T = traiteur programmateur ; A = agence ; G = gestionnaire du lieu L ;
-- X = traiteur sans lien ; O = client organisateur.
SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
  ('7a5b0001-0000-0000-0000-0000000000b7'::uuid, 'B7 Traiteur', 'B7 Traiteur SAS', 'traiteur', '77790000000001', true),
  ('7a5b0002-0000-0000-0000-0000000000b7'::uuid, 'B7 Agence', 'B7 Agence SAS', 'agence', '77790000000002', true),
  ('7a5b0003-0000-0000-0000-0000000000b7'::uuid, 'B7 Gest', 'B7 Gest SA', 'gestionnaire_lieux', '77790000000003', true),
  ('7a5b0004-0000-0000-0000-0000000000b7'::uuid, 'B7 Tiers', 'B7 Tiers SAS', 'traiteur', '77790000000004', true),
  ('7a5b0005-0000-0000-0000-0000000000b7'::uuid, 'B7 Client', 'B7 Client SA', 'client_organisateur', '77790000000005', true);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('7a5bef01-0000-0000-0000-0000000000b7'::uuid, '7a5b0001-0000-0000-0000-0000000000b7'::uuid,
        'B7 Traiteur SAS', '77790000000001', '1 rue Traiteur', '75001', 'Paris');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif) VALUES
  ('7a5b0a01-0000-0000-0000-0000000000b7'::uuid, '7a5b0001-0000-0000-0000-0000000000b7'::uuid,
   'mgr@b7-traiteur.test', 'Mgr', 'Traiteur', 'traiteur_manager', true);

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region)
VALUES ('7a5b1001-0000-0000-0000-0000000000b7'::uuid, 'B7 Lieu', '3 rue Lieu', '75003', 'Paris', 'camionnette', 48.87, 2.36, 'idf');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('7a5b0003-0000-0000-0000-0000000000b7'::uuid, '7a5b1001-0000-0000-0000-0000000000b7'::uuid);

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('7a5b7e01-0000-0000-0000-0000000000b7'::uuid, 'SECU_B7_TRANSPORTEURS', 'SECU B7 transporteurs', 1, true);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, client_organisateur_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  '7a5be001-0000-0000-0000-0000000000b7'::uuid,
  '7a5b0001-0000-0000-0000-0000000000b7'::uuid, '7a5b0001-0000-0000-0000-0000000000b7'::uuid,
  '7a5b0005-0000-0000-0000-0000000000b7'::uuid,
  '7a5bef01-0000-0000-0000-0000000000b7'::uuid, '7a5b0a01-0000-0000-0000-0000000000b7'::uuid,
  '7a5b1001-0000-0000-0000-0000000000b7'::uuid, '7a5b7e01-0000-0000-0000-0000000000b7'::uuid,
  'B7 Gala', '2026-09-12', 300, 'Contact B7', '0600000077'
);

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, realisee_at)
VALUES ('7a5bc001-0000-0000-0000-0000000000b7'::uuid, '7a5be001-0000-0000-0000-0000000000b7'::uuid,
        'anti_gaspi', 'cloturee', 'non_envoye', '2026-09-12', '23:00', now() - interval '30 hours');

INSERT INTO plateforme.associations (id, nom, adresse, region, ville, contact_email, description_rapport_impact)
VALUES ('7a5ba001-0000-0000-0000-0000000000b7'::uuid, 'B7 Asso', '5 rue Asso', 'idf', 'Paris', 'contact@b7-asso.test',
        'Association de test B7 : distribue des repas aux personnes en difficulté.');

INSERT INTO shared.prestataires (id, nom, code)
VALUES ('7a5b9001-0000-0000-0000-0000000000b7'::uuid, 'B7 Prestataire', 'B7_PRESTA');

-- Le transporteur de la fixture : les 22 colonnes renseignées (id + 21 ci-dessous).
INSERT INTO plateforme.transporteurs (
  id, nom, siren, adresse, code_postal, ville, latitude, longitude,
  types_vehicules, type_tms, code_transporteur_mts1,
  contact_nom, contact_email, contact_telephone, tarif_par_course,
  actif, derniere_verification, commentaires_internes, created_at,
  prestataire_logistique_id, types_collecte, description_process_collecte
) VALUES (
  '7a5bb001-0000-0000-0000-0000000000b7'::uuid, 'B7 Trans', '777900009', '9 rue Trans', '75009', 'Paris', 48.8767, 2.3371,
  ARRAY['camionnette'], 'autre', 'B7-CODE-042',
  'Contact Trans B7', 'trans@b7.test', '0677777777', 87.50,
  true, '2026-08-01', 'NOTE ADMIN B7', '2026-01-01 10:00:00+00',
  '7a5b9001-0000-0000-0000-0000000000b7'::uuid, ARRAY['anti_gaspi'], 'Process de collecte B7'
);

-- Un second transporteur, inactif et sans prestataire : la fermeture vaut pour
-- TOUTES les lignes, pas seulement pour celle qu'une attribution désigne.
INSERT INTO plateforme.transporteurs
  (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms, contact_nom, contact_email, contact_telephone, actif)
VALUES ('7a5bb002-0000-0000-0000-0000000000b7'::uuid, 'B7 Trans inactif', '777900008', '8 rue Trans', '75008', 'Paris',
        ARRAY['velo_cargo'], 'par_mail', 'Contact inactif B7', 'inactif@b7.test', '0677777778', false);

INSERT INTO plateforme.attributions_antgaspi
  (collecte_id, association_id, transporteur_id, branche_attribution, mode_validation, volume_repas_realise)
VALUES ('7a5bc001-0000-0000-0000-0000000000b7'::uuid, '7a5ba001-0000-0000-0000-0000000000b7'::uuid,
        '7a5bb001-0000-0000-0000-0000000000b7'::uuid, 'branche_1', 'manuel_top1', 120);

-- =============================================================================
-- 1-8 — Catalogue : la policy ouverte n'existe plus, celles du staff sont seules
-- =============================================================================
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'plateforme' AND tablename = 'transporteurs' AND policyname = 'transp_read'),
  0,
  '1. la policy transp_read (auth.role() = authenticated) n''existe plus');

SELECT is(
  (SELECT array_agg(policyname || ' | ' || cmd || ' | ' || permissive || ' | ' || array_to_string(roles, ',')
                    || ' | ' || coalesce(qual, '-') || ' | ' || coalesce(with_check, '-') ORDER BY policyname)
     FROM pg_policies WHERE schemaname = 'plateforme' AND tablename = 'transporteurs'),
  ARRAY[
    'transp_admin | ALL | PERMISSIVE | public | (plateforme.f_app_role() = ''admin_savr''::text) | (plateforme.f_app_role() = ''admin_savr''::text)',
    'transp_ops_select | SELECT | PERMISSIVE | public | (plateforme.f_app_role() = ''ops_savr''::text) | -',
    'transp_ops_write | UPDATE | PERMISSIVE | public | (plateforme.f_app_role() = ''ops_savr''::text) | (plateforme.f_app_role() = ''ops_savr''::text)'],
  '2. cliquet : les policies de transporteurs sont EXACTEMENT les 3 du staff, prédicat compris (ajout ou élargissement rougit)');

SELECT is(
  (SELECT relrowsecurity::text || '|' || relforcerowsecurity::text
     FROM pg_class WHERE oid = 'plateforme.transporteurs'::regclass),
  'true|true',
  '3. RLS activée ET forcée sur transporteurs (sans elle, le privilège table-level rendrait tout)');

-- Le privilège table-level RESTE à authenticated : admin_savr et ops_savr portent
-- ce rôle PG et lisent par leurs policies. La fermeture tient donc aux policies
-- seules — d'où le cliquet 2. Épinglé pour qu'un lecteur ne croie pas l'inverse.
SELECT ok(
  has_table_privilege('authenticated', 'plateforme.transporteurs', 'SELECT'),
  '4. authenticated garde le SELECT table-level (staff par JWT) : la fermeture cliente tient aux policies');

SELECT is(
  (SELECT count(*)::int
     FROM pg_attribute
    WHERE attrelid = 'plateforme.transporteurs'::regclass AND attnum > 0 AND NOT attisdropped
      AND has_column_privilege('anon', attrelid, attnum, 'SELECT')),
  0,
  '5. anon ne lit aucune colonne de transporteurs');

SELECT is(
  (SELECT has_table_privilege('service_role', 'plateforme.transporteurs', 'SELECT')::text
          || '|' || (SELECT rolbypassrls::text FROM pg_roles WHERE rolname = 'service_role')),
  'true|true',
  '6. service_role garde le SELECT table-level et contourne la RLS (back-office, algo, worker, cron, webhook)');

-- Deux chemins contournent une policy sans y toucher : une vue (elle lit avec les
-- droits de son propriétaire, sauf security_invoker) et une fonction SECURITY
-- DEFINER. Aucun n'existe aujourd'hui ; en poser un pour un rôle client est une
-- ouverture d'accès.
SELECT is(
  (SELECT count(DISTINCT v.oid)::int
     FROM pg_depend d
     JOIN pg_rewrite r ON r.oid = d.objid
     JOIN pg_class v ON v.oid = r.ev_class
    WHERE d.classid = 'pg_rewrite'::regclass
      AND d.refclassid = 'pg_class'::regclass
      AND d.refobjid = 'plateforme.transporteurs'::regclass
      AND v.oid <> 'plateforme.transporteurs'::regclass),
  0,
  '7. cliquet : aucune vue ne dépend de transporteurs');

-- Fermeture transitive des fonctions qui atteignent la table, tous schémas :
-- par le TEXTE du corps (prosrc) et par les DÉPENDANCES enregistrées (pg_depend),
-- seules à voir une fonction à corps SQL standard (BEGIN ATOMIC), dont prosrc est
-- vide. Un SQL dynamique (EXECUTE d'une chaîne construite) échappe aux deux.
-- Le premier terme prouve que le détecteur voit bien une fonction qui lit la
-- table ; le second liste celles sur lesquelles authenticated ou anon porte
-- EXECUTE. Le privilège seul compte, quel que soit le schéma : l'absence d'USAGE
-- sur un schéma n'empêche que l'appel PAR NOM. Une vue, ou une fonction à corps
-- SQL standard, référence la fonction par son OID et l'exécute pour le client
-- (mesuré : une lectrice SECURITY DEFINER posée dans le schéma tests, sans USAGE
-- pour authenticated, se lit à travers une vue de plateforme).
SELECT is(
  (WITH RECURSIVE atteint AS (
     SELECT p.oid, p.proname
       FROM pg_proc p
      WHERE p.prosrc ~* '\mtransporteurs\M'
         OR EXISTS (SELECT 1 FROM pg_depend d
                     WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                       AND d.refclassid = 'pg_class'::regclass
                       AND d.refobjid = 'plateforme.transporteurs'::regclass)
     UNION
     SELECT p.oid, p.proname
       FROM atteint a
       JOIN pg_proc p
         ON p.oid <> a.oid
        AND (p.prosrc ~* ('\m' || a.proname || '\M')
             OR EXISTS (SELECT 1 FROM pg_depend d
                         WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                           AND d.refclassid = 'pg_proc'::regclass AND d.refobjid = a.oid))
   )
   SELECT bool_or(a.proname = 'fn_calculer_algo_attribution_ag')::text || '|'
          || coalesce(string_agg(DISTINCT a.proname::text, ',') FILTER (
               WHERE p.prosecdef
                 AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
                      OR has_function_privilege('anon', p.oid, 'EXECUTE'))), '')
     FROM atteint a JOIN pg_proc p ON p.oid = a.oid),
  'true|',
  '8. cliquet : aucune fonction SECURITY DEFINER qui atteint transporteurs n''est exécutable par authenticated ou anon');

-- =============================================================================
-- 9-11 — Non-vacuité : les lignes existent, les 22 colonnes sont renseignées
-- =============================================================================
SELECT is(
  (SELECT count(*)::int FROM plateforme.transporteurs
    WHERE id = '7a5bb001-0000-0000-0000-0000000000b7'
      AND actif IS NOT NULL AND adresse IS NOT NULL AND code_postal IS NOT NULL
      AND code_transporteur_mts1 IS NOT NULL AND commentaires_internes IS NOT NULL
      AND contact_email IS NOT NULL AND contact_nom IS NOT NULL AND contact_telephone IS NOT NULL
      AND created_at IS NOT NULL AND derniere_verification IS NOT NULL
      AND description_process_collecte IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
      AND nom IS NOT NULL AND prestataire_logistique_id IS NOT NULL AND siren IS NOT NULL
      AND tarif_par_course IS NOT NULL AND type_tms IS NOT NULL AND types_collecte IS NOT NULL
      AND types_vehicules IS NOT NULL AND ville IS NOT NULL),
  1,
  '9. non-vacuité (superuser) : le transporteur de la fixture existe, ses 22 colonnes sont renseignées');

SELECT is(
  (SELECT count(*)::int FROM plateforme.transporteurs
    WHERE id IN ('7a5bb001-0000-0000-0000-0000000000b7', '7a5bb002-0000-0000-0000-0000000000b7')),
  2,
  '10. non-vacuité (superuser) : les deux transporteurs de la fixture existent');

SELECT is(
  array_length(test_transp_colonnes('lue'), 1),
  array_length(test_transp_toutes_colonnes(), 1),
  '11. non-vacuité de la sonde (superuser) : chaque colonne de la table est « lue »');

-- =============================================================================
-- 12-17 — gestionnaire_lieux, sur SON lieu : le cas mesuré (PostgREST select=*)
-- =============================================================================
SELECT test_set_jwt_prod('gestionnaire_lieux', '7a5b0003-0000-0000-0000-0000000000b7'::uuid);

SELECT is(
  auth.role() || '|' || plateforme.f_app_role(),
  'authenticated|gestionnaire_lieux',
  '12. gestionnaire : le JWT satisfait le prédicat de l''ancienne policy (auth.role() = authenticated)');

SELECT is(
  (SELECT count(*)::int FROM plateforme.transporteurs),
  0,
  '13. gestionnaire : SELECT sur transporteurs = 0 ligne, toute la table — la requête du constat');

SELECT is(
  test_transp_colonnes('lue'),
  ARRAY[]::text[],
  '14. gestionnaire : un SELECT réel de chaque colonne — AUCUNE ne rend la ligne');

SELECT is(
  test_transp_colonnes('invisible'),
  test_transp_toutes_colonnes(),
  '15. gestionnaire : chaque colonne est « invisible » (requête admise, ligne absente) — la sonde a bien tourné');

SELECT is(
  (SELECT count(*)::int FROM plateforme.transporteurs
    WHERE nom = 'B7 Trans' OR contact_email = 'trans@b7.test' OR tarif_par_course = 87.50
       OR siren = '777900009' OR code_transporteur_mts1 = 'B7-CODE-042'),
  0,
  '16. gestionnaire : aucune ligne non plus en filtrant sur une valeur sensible (pas d''oracle par WHERE)');

-- Contrôle positif sur le même rôle : un autre référentiel, resté ouvert par le
-- même prédicat, se lit. Le « 0 ligne » ci-dessus ne vient pas d'un JWT cassé.
SELECT is(
  (SELECT count(*)::int FROM plateforme.types_evenements WHERE id = '7a5b7e01-0000-0000-0000-0000000000b7'),
  1,
  '17. gestionnaire : types_evenements (te_read, même prédicat) se lit toujours — le lecteur fonctionne');

-- =============================================================================
-- 18-20 — traiteur programmateur : lecture directe
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_manager', '7a5b0001-0000-0000-0000-0000000000b7'::uuid,
                         '7a5b0a01-0000-0000-0000-0000000000b7'::uuid);

SELECT is(
  auth.role() || '|' || plateforme.f_app_role(),
  'authenticated|traiteur_manager',
  '18. traiteur : le JWT satisfait le prédicat de l''ancienne policy');

SELECT is(
  (SELECT count(*)::int FROM plateforme.transporteurs),
  0,
  '19. traiteur : SELECT sur transporteurs = 0 ligne (marque blanche : ni nom, ni contact, ni tarif)');

SELECT is(
  test_transp_colonnes('lue'),
  ARRAY[]::text[],
  '20. traiteur : un SELECT réel de chaque colonne — AUCUNE ne rend la ligne');

-- =============================================================================
-- 21-23 — traiteur programmateur : l'embed PostgREST attributions → transporteurs
-- =============================================================================
-- aa_select rend au traiteur l'attribution de sa collecte (identifiant du
-- transporteur compris : un uuid, pas une identité). Avant ce lot, l'embed
-- `transporteurs!transporteur_id(...)` lui rendait la fiche du prestataire.
SELECT is(
  (SELECT transporteur_id::text FROM plateforme.attributions_antgaspi
    WHERE collecte_id = '7a5bc001-0000-0000-0000-0000000000b7'),
  '7a5bb001-0000-0000-0000-0000000000b7',
  '21. traiteur : contrôle positif — l''attribution de sa collecte se lit (aa_select inchangée)');

SELECT is(
  (SELECT count(*)::int || '|' || count(t.id)::int
     FROM plateforme.attributions_antgaspi aa
     LEFT JOIN plateforme.transporteurs t ON t.id = aa.transporteur_id
    WHERE aa.collecte_id = '7a5bc001-0000-0000-0000-0000000000b7'),
  '1|0',
  '22. traiteur : l''embed attributions → transporteurs rend l''attribution SANS le transporteur (null)');

SELECT is(
  (SELECT count(*)::int
     FROM plateforme.attributions_antgaspi aa
     JOIN plateforme.transporteurs t ON t.id = aa.transporteur_id
    WHERE aa.collecte_id = '7a5bc001-0000-0000-0000-0000000000b7'),
  0,
  '23. traiteur : nom, email, téléphone et tarif illisibles par l''embed, depuis sa propre attribution');

-- =============================================================================
-- 24-32 — les autres rôles clients : même fermeture
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_commercial', '7a5b0001-0000-0000-0000-0000000000b7'::uuid);
SELECT is(auth.role() || '|' || plateforme.f_app_role(), 'authenticated|traiteur_commercial',
  '24. traiteur_commercial : le JWT satisfait le prédicat de l''ancienne policy');
SELECT is((SELECT count(*)::int FROM plateforme.transporteurs), 0,
  '25. traiteur_commercial : 0 ligne');
SELECT is(test_transp_colonnes('lue'), ARRAY[]::text[],
  '26. traiteur_commercial : aucune colonne ne rend la ligne');

SELECT test_set_jwt_prod('agence', '7a5b0002-0000-0000-0000-0000000000b7'::uuid);
SELECT is(auth.role() || '|' || plateforme.f_app_role(), 'authenticated|agence',
  '27. agence : le JWT satisfait le prédicat de l''ancienne policy');
SELECT is((SELECT count(*)::int FROM plateforme.transporteurs), 0,
  '28. agence : 0 ligne');
SELECT is(test_transp_colonnes('lue'), ARRAY[]::text[],
  '29. agence : aucune colonne ne rend la ligne');

SELECT test_set_jwt_prod('client_organisateur', '7a5b0005-0000-0000-0000-0000000000b7'::uuid);
SELECT is(auth.role() || '|' || plateforme.f_app_role(), 'authenticated|client_organisateur',
  '30. client organisateur : le JWT satisfait le prédicat de l''ancienne policy');
SELECT is((SELECT count(*)::int FROM plateforme.transporteurs), 0,
  '31. client organisateur : 0 ligne');
SELECT is(test_transp_colonnes('lue'), ARRAY[]::text[],
  '32. client organisateur : aucune colonne ne rend la ligne');

-- =============================================================================
-- 33-37 — Écriture : aucun rôle client n'écrit (policies inchangées)
-- =============================================================================
-- authenticated garde INSERT / UPDATE / DELETE table-level, bornés par transp_admin
-- et transp_ops_write. ⚠ PostgreSQL n'applique les policies SELECT à un UPDATE ou
-- à un DELETE que si l'ordre LIT une colonne de la table : WHERE sur une colonne,
-- RETURNING d'une colonne, SET depuis une colonne. Une fois la lecture fermée, un
-- tel ordre rend 0 ligne quel que soit l'état des policies d'écriture : il ne
-- prouve rien sur elles. Mesuré, policy UPDATE ouverte à tous, sous un rôle
-- client : WHERE id = …, RETURNING id ou SET nom = nom || … → 0 ligne ; sans
-- WHERE, WHERE true ou RETURNING 1 → les 2 lignes réécrites. Les assertions 34 et
-- 36 emploient donc un ordre qui ne lit AUCUNE colonne (ni WHERE ni RETURNING).
-- Par l'API : tout filtre PostgREST nomme une colonne, et l'extension safeupdate,
-- préchargée pour le rôle authenticator, refuse l'ordre sans WHERE (PATCH sans
-- filtre → 400). Elle ne refuse que cela — « WHERE true » la passe, c'est la RLS
-- qui l'arrête : la fermeture de l'écriture tient aux policies, pas à elle.
-- Rôle = traiteur SANS LIEN.
SELECT test_set_jwt_prod('traiteur_manager', '7a5b0004-0000-0000-0000-0000000000b7'::uuid);

SELECT is((SELECT count(*)::int FROM plateforme.transporteurs), 0,
  '33. traiteur sans lien : 0 ligne');

SELECT is(
  test_lignes_touchees($q$ UPDATE plateforme.transporteurs SET commentaires_internes = 'B7 pirate' $q$),
  0,
  '34. traiteur : UPDATE sans WHERE ni RETURNING = 0 ligne (aucune policy d''écriture cliente)');

SELECT throws_ok(
  $$ INSERT INTO plateforme.transporteurs
       (nom, siren, adresse, code_postal, ville, types_vehicules, type_tms, contact_nom, contact_email, contact_telephone)
     VALUES ('B7 intrus', '777900007', '7 rue Intrus', '75007', 'Paris', ARRAY['camionnette'], 'autre',
             'Intrus', 'intrus@b7.test', '0677777779') $$,
  '42501', NULL, '35. traiteur : INSERT sur transporteurs refusé (RLS)');

SELECT is(
  test_lignes_touchees($q$ DELETE FROM plateforme.transporteurs $q$),
  0,
  '36. traiteur : DELETE sans WHERE ni RETURNING = 0 ligne');

SELECT test_as_superuser();
SELECT is(
  (SELECT string_agg(nom || '/' || coalesce(commentaires_internes, '-'), '|' ORDER BY id) FROM plateforme.transporteurs
    WHERE id IN ('7a5bb001-0000-0000-0000-0000000000b7', '7a5bb002-0000-0000-0000-0000000000b7')),
  'B7 Trans/NOTE ADMIN B7|B7 Trans inactif/-',
  '37. contrôle (superuser) : les deux lignes sont intactes après les tentatives 34 à 36');

-- =============================================================================
-- 38-44 — staff par JWT : lecture et écriture conservées (§09, F3)
-- =============================================================================
SELECT test_set_jwt_prod('admin_savr', NULL);

SELECT is(
  (SELECT count(*)::int FROM plateforme.transporteurs
    WHERE id IN ('7a5bb001-0000-0000-0000-0000000000b7', '7a5bb002-0000-0000-0000-0000000000b7')),
  2,
  '38. admin_savr (JWT) : les deux transporteurs restent visibles (transp_admin)');

SELECT is(
  test_transp_colonnes('lue'),
  test_transp_toutes_colonnes(),
  '39. admin_savr (JWT) : la même sonde rend TOUTES les colonnes « lues » — elle n''est pas muette');

SELECT is(
  (SELECT nom || '|' || contact_email || '|' || tarif_par_course::text || '|' || commentaires_internes
     FROM plateforme.transporteurs WHERE id = '7a5bb001-0000-0000-0000-0000000000b7'),
  'B7 Trans|trans@b7.test|87.50|NOTE ADMIN B7',
  '40. admin_savr (JWT) : nom, contact, tarif et notes internes se lisent avec leurs valeurs');

WITH u AS (
  UPDATE plateforme.transporteurs SET commentaires_internes = 'NOTE ADMIN B7 bis'
   WHERE id = '7a5bb001-0000-0000-0000-0000000000b7' RETURNING commentaires_internes
)
SELECT is(
  (SELECT commentaires_internes FROM u),
  'NOTE ADMIN B7 bis',
  '41. admin_savr (JWT) : UPDATE avec RETURNING conservé (écriture staff intacte)');

SELECT test_set_jwt_prod('ops_savr', NULL);

SELECT is(
  (SELECT count(*)::int FROM plateforme.transporteurs
    WHERE id IN ('7a5bb001-0000-0000-0000-0000000000b7', '7a5bb002-0000-0000-0000-0000000000b7')),
  2,
  '42. ops_savr (JWT) : les deux transporteurs restent visibles (transp_ops_select)');

SELECT is(
  test_transp_colonnes('lue'),
  test_transp_toutes_colonnes(),
  '43. ops_savr (JWT) : toutes les colonnes « lues », SIREN compris (§09 F3)');

WITH u AS (
  UPDATE plateforme.transporteurs SET actif = false
   WHERE id = '7a5bb001-0000-0000-0000-0000000000b7' RETURNING actif
)
SELECT is(
  (SELECT actif FROM u),
  false,
  '44. ops_savr (JWT) : désactivation d''un transporteur conservée (transp_ops_write, §09 F3)');

-- =============================================================================
-- 45-49 — service_role : les lectures réelles du back-office et des adapters
-- =============================================================================
SELECT test_as_service_role();

SELECT is(
  test_transp_colonnes('lue'),
  test_transp_toutes_colonnes(),
  '45. service_role : lit toutes les colonnes — la fiche entière des écrans Admin Transporteurs');

SELECT is(
  (SELECT nom || '|' || siren || '|' || contact_nom || '|' || contact_email || '|' || contact_telephone
          || '|' || tarif_par_course::text || '|' || code_transporteur_mts1 || '|' || prestataire_logistique_id::text
          || '|' || description_process_collecte
     FROM plateforme.transporteurs WHERE id = '7a5bb001-0000-0000-0000-0000000000b7'),
  'B7 Trans|777900009|Contact Trans B7|trans@b7.test|0677777777|87.50|B7-CODE-042|'
    || '7a5b9001-0000-0000-0000-0000000000b7|Process de collecte B7',
  '46. service_role : les colonnes sensibles se lisent avec leurs valeurs (aucune donnée touchée)');

-- Worker outbox, cron de polling, webhook : résolution du transporteur par son
-- prestataire logistique.
SELECT is(
  (SELECT id::text || '|' || type_tms::text || '|' || code_transporteur_mts1
     FROM plateforme.transporteurs
    WHERE prestataire_logistique_id = '7a5b9001-0000-0000-0000-0000000000b7'),
  '7a5bb001-0000-0000-0000-0000000000b7|autre|B7-CODE-042',
  '47. service_role : résolution par prestataire (worker outbox, polling, webhook) servie');

-- Job d'attribution AG (emails) et fiche collecte Admin : embed depuis l'attribution.
SELECT is(
  (SELECT t.id::text || '|' || t.nom || '|' || t.contact_email || '|' || t.type_tms::text
     FROM plateforme.attributions_antgaspi aa
     JOIN plateforme.transporteurs t ON t.id = aa.transporteur_id
    WHERE aa.collecte_id = '7a5bc001-0000-0000-0000-0000000000b7'),
  '7a5bb001-0000-0000-0000-0000000000b7|B7 Trans|trans@b7.test|autre',
  '48. service_role : embed attributions → transporteurs(id, nom, contact_email, type_tms) servi');

SELECT is(
  (SELECT count(*)::int FROM plateforme.transporteurs
    WHERE id IN ('7a5bb001-0000-0000-0000-0000000000b7', '7a5bb002-0000-0000-0000-0000000000b7')),
  2,
  '49. service_role : la liste Admin rend les deux transporteurs, inactif compris');

SELECT * FROM finish();
ROLLBACK;

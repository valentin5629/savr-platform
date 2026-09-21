-- =============================================================================
-- Tests pgTAP — organisations : SELECT en liste blanche + garde UPDATE gestionnaire
-- Migration prouvée : 20260918100000_plateforme_organisations_select_liste_blanche
-- =============================================================================
-- Fuite fermée (reviewer-rls-securite, PR #357) : via org_gestionnaire_traiteur_select,
-- un gestionnaire_lieux lisait par PostgREST direct notes_internes,
-- tarif_refacture_pax_zd et grille_tarifaire_zd_id des traiteurs intervenus sur ses
-- lieux (§06.05 : pas d'accès aux tarifs, notes internes = Admin uniquement).
-- Même canal pour l'agence sur ses fiches shadow.
--
-- Deuxième point : org_gestionnaire_update n'avait aucun test, et le GRANT UPDATE
-- colonne-level de M3.1 laissait le gestionnaire modifier nom / raison_sociale / siret
-- de sa propre organisation (§06.05 §6 : nom en lecture seule, adresse + logo seuls).
--
-- NON-VACUITÉ (mesurée sur base rejouée SANS la migration) : les assertions de
-- fermeture (1-4, 13, 16, 21-25b) tombent en `not ok` — les SELECT et UPDATE passent
-- (constat pré-migration : le gestionnaire renomme son orga, change raison sociale,
-- SIRET et email). Les assertions de maintien (5, 9-10, 14-15, 18, 26-31) sont les
-- contrôles positifs :
-- elles prouvent que chaque refus vient du privilège ou du trigger, pas d'une ligne
-- invisible ni d'une fixture invalide.
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(34);

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

-- Fixture ---------------------------------------------------------------------
-- G  = gestionnaire_lieux (rattaché au lieu L)
-- T  = traiteur intervenu sur L (événement daté) → visible de G par v_traiteurs_gestionnaire
-- A  = agence ; S = fiche shadow créée par A
SELECT test_as_superuser();

INSERT INTO plateforme.grilles_tarifaires_zd (id, nom, mode, est_defaut, actif, valide_du)
VALUES ('5e1e9211-0000-0000-0000-0000000000b1'::uuid, 'SECU Grille SELECT', 'paliers', false, true, '2026-01-01');

INSERT INTO plateforme.organisations
  (id, nom, raison_sociale, type, actif, est_shadow, siret, email_principal, telephone, adresse,
   notes_internes, tarif_refacture_pax_zd, grille_tarifaire_zd_id, mode_facturation_zd, cree_par_organisation_id)
VALUES
  ('5e1e0001-0000-0000-0000-0000000000b1'::uuid, 'SECU Gest', 'SECU Gest SA', 'gestionnaire_lieux', true, false,
   '55510000000001', 'gest@secu.test', '0100000001', '1 rue Gest', NULL, 0, NULL, 'par_collecte', NULL),
  ('5e1e0002-0000-0000-0000-0000000000b1'::uuid, 'SECU Trait', 'SECU Trait SAS', 'traiteur', true, false,
   '55510000000002', 'trait@secu.test', '0100000002', '2 rue Trait', 'NOTE ADMIN SECRETE', 2.75,
   '5e1e9211-0000-0000-0000-0000000000b1'::uuid, 'mensuelle', NULL),
  ('5e1e0003-0000-0000-0000-0000000000b1'::uuid, 'SECU Agence', 'SECU Agence SAS', 'agence', true, false,
   '55510000000003', 'agence@secu.test', NULL, NULL, NULL, 0, NULL, 'par_collecte', NULL),
  ('5e1e0004-0000-0000-0000-0000000000b1'::uuid, 'SECU Shadow', 'SECU Shadow SARL', 'traiteur', true, true,
   NULL, NULL, NULL, NULL, 'NOTE SHADOW SECRETE', 1.50, NULL, 'par_collecte',
   '5e1e0003-0000-0000-0000-0000000000b1'::uuid);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
VALUES ('5e1e0a01-0000-0000-0000-0000000000b1'::uuid, '5e1e0002-0000-0000-0000-0000000000b1'::uuid,
        'chef@secu-trait.test', 'Chef', 'T', 'traiteur_manager', true);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('5e1eef01-0000-0000-0000-0000000000b1'::uuid, '5e1e0002-0000-0000-0000-0000000000b1'::uuid,
        'SECU Trait SAS', '55510000000002', '2 rue Trait', '75002', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('5e1e1001-0000-0000-0000-0000000000b1'::uuid, 'SECU Lieu', '3 rue Lieu', '75003', 'Paris', 'camionnette');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('5e1e0001-0000-0000-0000-0000000000b1'::uuid, '5e1e1001-0000-0000-0000-0000000000b1'::uuid);

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('5e1e7e01-0000-0000-0000-0000000000b1'::uuid, 'SECU_ORG_SEL', 'SECU org select', 1, true);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by,
  lieu_id, type_evenement_id, nom_evenement, date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES (
  '5e1ee001-0000-0000-0000-0000000000b1'::uuid,
  '5e1e0002-0000-0000-0000-0000000000b1'::uuid, '5e1e0002-0000-0000-0000-0000000000b1'::uuid,
  '5e1eef01-0000-0000-0000-0000000000b1'::uuid, '5e1e0a01-0000-0000-0000-0000000000b1'::uuid,
  '5e1e1001-0000-0000-0000-0000000000b1'::uuid, '5e1e7e01-0000-0000-0000-0000000000b1'::uuid,
  'SECU Gala', '2026-06-15', 200, 'Contact', '0600000009'
);

-- =============================================================================
-- 1-6 — gestionnaire_lieux → traiteur intervenu : colonnes staff fermées
-- =============================================================================
SELECT test_set_jwt_prod('gestionnaire_lieux', '5e1e0001-0000-0000-0000-0000000000b1'::uuid);

SELECT throws_ok(
  $$ SELECT notes_internes FROM plateforme.organisations WHERE id = '5e1e0002-0000-0000-0000-0000000000b1' $$,
  '42501', NULL, '1. gestionnaire : notes_internes d''un traiteur intervenu illisible (permission denied)');
SELECT throws_ok(
  $$ SELECT tarif_refacture_pax_zd FROM plateforme.organisations WHERE id = '5e1e0002-0000-0000-0000-0000000000b1' $$,
  '42501', NULL, '2. gestionnaire : tarif_refacture_pax_zd d''un traiteur intervenu illisible');
SELECT throws_ok(
  $$ SELECT grille_tarifaire_zd_id FROM plateforme.organisations WHERE id = '5e1e0002-0000-0000-0000-0000000000b1' $$,
  '42501', NULL, '3. gestionnaire : grille_tarifaire_zd_id d''un traiteur intervenu illisible');
SELECT throws_ok(
  $$ SELECT mode_facturation_zd FROM plateforme.organisations WHERE id = '5e1e0002-0000-0000-0000-0000000000b1' $$,
  '42501', NULL, '4. gestionnaire : mode_facturation_zd d''un traiteur intervenu illisible');

-- 5. Contrôle positif : le traiteur intervenu reste visible (nom lisible). Depuis
--    20260921090000 la table ne rend plus les traiteurs tiers au gestionnaire : la
--    fiche passe par la vue restreinte v_traiteurs_gestionnaire (id/nom/logo_url).
SELECT is(
  (SELECT nom FROM plateforme.v_traiteurs_gestionnaire WHERE id = '5e1e0002-0000-0000-0000-0000000000b1'),
  'SECU Trait',
  '5. gestionnaire : le traiteur intervenu reste visible (nom lisible) — le refus 1-4 porte sur la colonne');

-- 6. La fonction gardée ne rend rien au gestionnaire
SELECT is(
  plateforme.f_tarif_refacture_pax_zd('5e1e0002-0000-0000-0000-0000000000b1'::uuid),
  NULL::numeric,
  '6. gestionnaire : f_tarif_refacture_pax_zd(traiteur) = NULL');

-- =============================================================================
-- 7-12 — traiteur propriétaire : lecture légitime du tarif maintenue
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_manager', '5e1e0002-0000-0000-0000-0000000000b1'::uuid);

SELECT is(
  plateforme.f_tarif_refacture_pax_zd('5e1e0002-0000-0000-0000-0000000000b1'::uuid),
  2.75::numeric,
  '7. traiteur_manager : f_tarif_refacture_pax_zd(sa propre orga) = 2.75');
SELECT is(
  plateforme.f_tarif_refacture_pax_zd('5e1e0004-0000-0000-0000-0000000000b1'::uuid),
  NULL::numeric,
  '8. traiteur_manager : f_tarif_refacture_pax_zd(autre orga) = NULL');
SELECT lives_ok(
  $$ SELECT organisation_id, marge_zd_ht FROM plateforme.v_kpi_traiteur $$,
  '9. traiteur_manager : v_kpi_traiteur (security_invoker) reste lisible sans la colonne');
SELECT lives_ok(
  $$ SELECT id, nom, raison_sociale, siret, adresse, email_principal, telephone, logo_url
       FROM plateforme.organisations WHERE id = '5e1e0002-0000-0000-0000-0000000000b1' $$,
  '10. traiteur_manager : colonnes du profil (route mon-organisation) toujours lisibles');

SELECT test_set_jwt_prod('traiteur_commercial', '5e1e0002-0000-0000-0000-0000000000b1'::uuid);
SELECT is(
  plateforme.f_tarif_refacture_pax_zd('5e1e0002-0000-0000-0000-0000000000b1'::uuid),
  2.75::numeric,
  '11. traiteur_commercial : f_tarif_refacture_pax_zd(sa propre orga) = 2.75 (KPI Marge)');

SELECT test_set_jwt_prod('admin_savr', NULL);
SELECT is(
  plateforme.f_tarif_refacture_pax_zd('5e1e0002-0000-0000-0000-0000000000b1'::uuid),
  2.75::numeric,
  '12. admin_savr : f_tarif_refacture_pax_zd(toute orga) = 2.75');

-- =============================================================================
-- 13-15 — traiteur propriétaire : notes_internes fermée même sur sa propre ligne
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_manager', '5e1e0002-0000-0000-0000-0000000000b1'::uuid);
SELECT throws_ok(
  $$ SELECT notes_internes FROM plateforme.organisations WHERE id = '5e1e0002-0000-0000-0000-0000000000b1' $$,
  '42501', NULL, '13. traiteur_manager : notes_internes de sa propre orga illisible (§04 : non visible par le client)');

-- 14-15. service_role (chemins staff réels) : privilèges intacts
SELECT test_as_service_role();
SELECT is(
  (SELECT notes_internes FROM plateforme.organisations WHERE id = '5e1e0002-0000-0000-0000-0000000000b1'),
  'NOTE ADMIN SECRETE',
  '14. service_role : notes_internes lisible (routes admin)');
SELECT is(
  (SELECT grille_tarifaire_zd_id::text || '|' || mode_facturation_zd::text || '|' || tarif_refacture_pax_zd::text
     FROM plateforme.organisations WHERE id = '5e1e0002-0000-0000-0000-0000000000b1'),
  '5e1e9211-0000-0000-0000-0000000000b1|mensuelle|2.75',
  '15. service_role : grille / mode de facturation / tarif lisibles (tarif-zd, batch brouillons)');
SELECT is(
  plateforme.f_tarif_refacture_pax_zd('5e1e0002-0000-0000-0000-0000000000b1'::uuid),
  NULL::numeric,
  '15b. service_role sans claims : f_tarif_refacture_pax_zd = NULL (comportement figé — un job staff lit la colonne, cf. COMMENT)');

-- =============================================================================
-- 16-18 — agence → fiche shadow qu'elle a créée
-- =============================================================================
SELECT test_set_jwt_prod('agence', '5e1e0003-0000-0000-0000-0000000000b1'::uuid);
SELECT throws_ok(
  $$ SELECT notes_internes FROM plateforme.organisations WHERE id = '5e1e0004-0000-0000-0000-0000000000b1' $$,
  '42501', NULL, '16. agence : notes_internes de sa fiche shadow illisible');
SELECT is(
  plateforme.f_tarif_refacture_pax_zd('5e1e0004-0000-0000-0000-0000000000b1'::uuid),
  NULL::numeric,
  '17. agence : f_tarif_refacture_pax_zd(shadow) = NULL');
SELECT is(
  (SELECT nom FROM plateforme.organisations WHERE id = '5e1e0004-0000-0000-0000-0000000000b1'),
  'SECU Shadow',
  '18. agence : la fiche shadow reste visible (contrôle positif)');

-- =============================================================================
-- 19-20 — cliquets structurels
-- =============================================================================
SELECT is(
  (SELECT array_agg(attname::text ORDER BY attnum)
     FROM pg_attribute
    WHERE attrelid = 'plateforme.organisations'::regclass AND attnum > 0 AND NOT attisdropped
      AND has_column_privilege('authenticated', 'plateforme.organisations', attname, 'SELECT')),
  ARRAY['id','nom','raison_sociale','type','email_principal','telephone','adresse','siret',
        'logo_url','actif','est_shadow','cree_par_organisation_id','created_at','updated_at'],
  '19. cliquet : colonnes lisibles par authenticated = liste blanche exacte (un grant table-level rouvrant tout rougit ici)');
SELECT ok(
  NOT has_function_privilege('anon', 'plateforme.f_tarif_refacture_pax_zd(uuid)', 'EXECUTE'),
  '20. f_tarif_refacture_pax_zd : EXECUTE retiré à anon (et PUBLIC)');

-- =============================================================================
-- 21-30 — org_gestionnaire_update : policy + liste blanche adresse / logo_url
-- =============================================================================
SELECT test_set_jwt_prod('gestionnaire_lieux', '5e1e0001-0000-0000-0000-0000000000b1'::uuid);

SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET nom = 'Renommé' WHERE id = '5e1e0001-0000-0000-0000-0000000000b1' $$,
  '42501', NULL, '21. gestionnaire : nom de sa propre orga non modifiable (lecture seule §06.05 §6)');
SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET raison_sociale = 'Autre SA' WHERE id = '5e1e0001-0000-0000-0000-0000000000b1' $$,
  '42501', NULL, '22. gestionnaire : raison_sociale non modifiable');
SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET siret = '99999999999999' WHERE id = '5e1e0001-0000-0000-0000-0000000000b1' $$,
  '42501', NULL, '23. gestionnaire : siret non modifiable');
SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET email_principal = 'x@y.test' WHERE id = '5e1e0001-0000-0000-0000-0000000000b1' $$,
  '42501', NULL, '24. gestionnaire : email_principal non modifiable (hors liste §06.05 §6)');
SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET adresse = '9 rue Neuve', nom = 'Renommé' WHERE id = '5e1e0001-0000-0000-0000-0000000000b1' $$,
  '42501', NULL, '25. gestionnaire : un champ autorisé ne blanchit pas un champ interdit dans le même UPDATE');

SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET updated_at = '2000-01-01' WHERE id = '5e1e0001-0000-0000-0000-0000000000b1' $$,
  '42501', NULL, '25b. gestionnaire : updated_at non forgeable (hors liste blanche)');

SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET adresse = '9 rue Neuve', logo_url = 'savr-dev/logos/0f8b2c1e-3d4a-4b5c-9d6e-7f8091a2b3c4.png'
      WHERE id = '5e1e0001-0000-0000-0000-0000000000b1' $$,
  '26. gestionnaire : adresse + logo_url modifiables (contrôle positif)');
SELECT is(
  (SELECT adresse || '|' || logo_url FROM plateforme.organisations WHERE id = '5e1e0001-0000-0000-0000-0000000000b1'),
  '9 rue Neuve|savr-dev/logos/0f8b2c1e-3d4a-4b5c-9d6e-7f8091a2b3c4.png',
  '27. gestionnaire : l''UPDATE adresse/logo a bien été appliqué');

-- 28. Policy : l'UPDATE d'une autre orga (traiteur visible en SELECT) ne touche aucune ligne
UPDATE plateforme.organisations SET adresse = 'piraté' WHERE id = '5e1e0002-0000-0000-0000-0000000000b1';
SELECT test_as_superuser();
SELECT is(
  (SELECT adresse FROM plateforme.organisations WHERE id = '5e1e0002-0000-0000-0000-0000000000b1'),
  '2 rue Trait',
  '28. org_gestionnaire_update : l''orga d''un traiteur intervenu n''est pas modifiable (0 ligne)');

-- 29. Non-régression : le traiteur_manager garde raison_sociale / siret (route profil)
SELECT test_set_jwt_prod('traiteur_manager', '5e1e0002-0000-0000-0000-0000000000b1'::uuid);
SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET raison_sociale = 'SECU Trait Bis', siret = '55510000000099'
      WHERE id = '5e1e0002-0000-0000-0000-0000000000b1' $$,
  '29. traiteur_manager : raison_sociale + siret toujours modifiables (trigger limité au gestionnaire)');

-- 30. Cliquet : prédicat de la policy UPDATE gestionnaire (self uniquement)
SELECT test_as_superuser();
SELECT is(
  (SELECT qual FROM pg_policies WHERE schemaname = 'plateforme' AND tablename = 'organisations'
      AND policyname = 'org_gestionnaire_update'),
  '((plateforme.f_app_role() = ''gestionnaire_lieux''::text) AND (id = ((auth.jwt() ->> ''organisation_id''::text))::uuid))',
  '30. org_gestionnaire_update : USING = rôle gestionnaire ET id = organisation du JWT');

-- 31-32. Le trigger ne gêne ni le staff (service_role) ni une ré-ouverture accidentelle
SELECT test_as_service_role();
SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET nom = 'SECU Gest Admin' WHERE id = '5e1e0001-0000-0000-0000-0000000000b1' $$,
  '31. service_role : le nom reste modifiable par le staff');
SELECT test_as_superuser();
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'plateforme.organisations'::regclass
           AND tgname = 'trg_block_org_gestionnaire_cols_update' AND tgenabled = 'O'),
  '32. trigger trg_block_org_gestionnaire_cols_update présent et actif');

SELECT * FROM finish();
ROLLBACK;

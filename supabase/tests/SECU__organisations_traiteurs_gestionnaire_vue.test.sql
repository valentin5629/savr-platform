-- =============================================================================
-- Tests pgTAP — gestionnaire_lieux : fiches traiteurs tiers par vue restreinte
-- Migration : 20260918140000_plateforme_organisations_traiteurs_gestionnaire_vue.sql
-- =============================================================================
-- Fuite fermée (constat 2026-09-18, base locale) : via la policy
-- org_gestionnaire_traiteur_select, un gestionnaire_lieux lisait par PostgREST direct
-- siret, email_principal, telephone, adresse, raison_sociale des traiteurs intervenus
-- sur ses lieux. CDC §06.05 : nom + logo seulement (« pas d'email / téléphone /
-- SIRET »), « `traiteurs` (vue restreinte) ».
--
-- Oracle : la table ne rend plus aucune ligne traiteur au gestionnaire (1), la vue
-- rend exactement les mêmes lignes que l'ancienne policy (3-6) mais seulement
-- id / nom / logo_url (7-9), et aucun autre rôle n'y lit quoi que ce soit (12-16).
-- Contrôles positifs (2, 10, 13) : sa propre ligne et le parcours agence → shadow
-- restent intacts — les refus portent sur le périmètre, pas sur une fixture cassée.
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(21);

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

-- Fixture ---------------------------------------------------------------------
-- G  = gestionnaire_lieux rattaché au lieu L ; G2 = gestionnaire sans lieu
-- T  = traiteur intervenu sur L (événement daté)       → visible de G
-- X  = traiteur avec un BROUILLON seul sur L (date NULL) → invisible (F3)
-- Y  = traiteur jamais intervenu sur L                  → invisible
-- A  = agence ; S = fiche shadow créée par A ; C = client_organisateur
SELECT test_as_superuser();

INSERT INTO plateforme.organisations
  (id, nom, raison_sociale, type, actif, est_shadow, siret, email_principal, telephone, adresse,
   logo_url, cree_par_organisation_id)
VALUES
  ('7a1e0001-0000-0000-0000-0000000000c2'::uuid, 'VTG Gest', 'VTG Gest SA', 'gestionnaire_lieux', true, false,
   '77710000000001', 'gest@vtg.test', '0100000011', '1 rue Gest', NULL, NULL),
  ('7a1e0008-0000-0000-0000-0000000000c2'::uuid, 'VTG Gest2', 'VTG Gest2 SA', 'gestionnaire_lieux', true, false,
   '77710000000008', 'gest2@vtg.test', NULL, NULL, NULL, NULL),
  ('7a1e0002-0000-0000-0000-0000000000c2'::uuid, 'VTG Trait', 'VTG Trait SAS', 'traiteur', true, false,
   '77710000000002', 'trait@vtg.test', '0100000012', '2 rue Trait', 'https://cdn.test/vtg-trait.png', NULL),
  ('7a1e0005-0000-0000-0000-0000000000c2'::uuid, 'VTG Brouillon', 'VTG Brouillon SAS', 'traiteur', true, false,
   '77710000000005', 'brouillon@vtg.test', NULL, NULL, NULL, NULL),
  ('7a1e0006-0000-0000-0000-0000000000c2'::uuid, 'VTG Ailleurs', 'VTG Ailleurs SAS', 'traiteur', true, false,
   '77710000000006', 'ailleurs@vtg.test', NULL, NULL, NULL, NULL),
  ('7a1e0003-0000-0000-0000-0000000000c2'::uuid, 'VTG Agence', 'VTG Agence SAS', 'agence', true, false,
   '77710000000003', 'agence@vtg.test', NULL, NULL, NULL, NULL),
  ('7a1e0004-0000-0000-0000-0000000000c2'::uuid, 'VTG Shadow', 'VTG Shadow SARL', 'traiteur', true, true,
   '77710000000004', NULL, NULL, NULL, NULL, '7a1e0003-0000-0000-0000-0000000000c2'::uuid),
  ('7a1e0007-0000-0000-0000-0000000000c2'::uuid, 'VTG Client', 'VTG Client SA', 'client_organisateur', true, false,
   '77710000000007', 'client@vtg.test', NULL, NULL, NULL, NULL);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
VALUES ('7a1e0a01-0000-0000-0000-0000000000c2'::uuid, '7a1e0002-0000-0000-0000-0000000000c2'::uuid,
        'chef@vtg-trait.test', 'Chef', 'T', 'traiteur_manager', true);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('7a1eef01-0000-0000-0000-0000000000c2'::uuid, '7a1e0002-0000-0000-0000-0000000000c2'::uuid,
        'VTG Trait SAS', '77710000000002', '2 rue Trait', '75002', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('7a1e1001-0000-0000-0000-0000000000c2'::uuid, 'VTG Lieu', '3 rue Lieu', '75003', 'Paris', 'camionnette');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('7a1e0001-0000-0000-0000-0000000000c2'::uuid, '7a1e1001-0000-0000-0000-0000000000c2'::uuid);

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('7a1e7e01-0000-0000-0000-0000000000c2'::uuid, 'VTG_TRAIT_GEST', 'VTG traiteurs gestionnaire', 1, true);

-- T : événement daté sur L ; X : brouillon (date NULL) sur L.
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by,
  lieu_id, type_evenement_id, nom_evenement, date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES
  ('7a1ee001-0000-0000-0000-0000000000c2'::uuid,
   '7a1e0002-0000-0000-0000-0000000000c2'::uuid, '7a1e0002-0000-0000-0000-0000000000c2'::uuid,
   '7a1eef01-0000-0000-0000-0000000000c2'::uuid, '7a1e0a01-0000-0000-0000-0000000000c2'::uuid,
   '7a1e1001-0000-0000-0000-0000000000c2'::uuid, '7a1e7e01-0000-0000-0000-0000000000c2'::uuid,
   'VTG Gala', '2026-06-15', 200, 'Contact', '0600000019'),
  ('7a1ee002-0000-0000-0000-0000000000c2'::uuid,
   '7a1e0002-0000-0000-0000-0000000000c2'::uuid, '7a1e0005-0000-0000-0000-0000000000c2'::uuid,
   '7a1eef01-0000-0000-0000-0000000000c2'::uuid, '7a1e0a01-0000-0000-0000-0000000000c2'::uuid,
   '7a1e1001-0000-0000-0000-0000000000c2'::uuid, '7a1e7e01-0000-0000-0000-0000000000c2'::uuid,
   'VTG Brouillon', NULL, 100, 'Contact', '0600000020');

-- =============================================================================
-- 1-2 — gestionnaire : la table n'ouvre plus que sa propre ligne
-- =============================================================================
SELECT test_set_jwt_prod('gestionnaire_lieux', '7a1e0001-0000-0000-0000-0000000000c2'::uuid);

-- 1. Requête du constat (PostgREST ?type=eq.traiteur) : plus aucune ligne traiteur
SELECT is_empty(
  $$ SELECT id, nom, siret, email_principal, telephone, adresse, raison_sociale
       FROM plateforme.organisations WHERE type = 'traiteur' $$,
  '1. gestionnaire : organisations?type=eq.traiteur ne rend plus aucune ligne (siret/email/téléphone fermés)');

-- 2. Contrôle positif : sa propre fiche reste lisible en entier (profil Mon organisation)
SELECT is(
  (SELECT siret FROM plateforme.organisations WHERE id = '7a1e0001-0000-0000-0000-0000000000c2'),
  '77710000000001',
  '2. gestionnaire : sa propre organisation reste lisible (siret)');

-- =============================================================================
-- 3-6 — la vue rend exactement les lignes de l'ancienne policy
-- =============================================================================
-- 3. T intervenu (événement daté sur L) : id, nom, logo
SELECT results_eq(
  $$ SELECT id, nom, logo_url FROM plateforme.v_traiteurs_gestionnaire $$,
  $$ VALUES ('7a1e0002-0000-0000-0000-0000000000c2'::uuid, 'VTG Trait'::text,
             'https://cdn.test/vtg-trait.png'::text) $$,
  '3. gestionnaire : la vue rend le seul traiteur intervenu, avec nom et logo');

-- 4. X n'a qu'un brouillon sur L → invisible (exclusion F3 conservée)
SELECT is(
  (SELECT count(*)::int FROM plateforme.v_traiteurs_gestionnaire
    WHERE id = '7a1e0005-0000-0000-0000-0000000000c2'),
  0, '4. gestionnaire : traiteur à brouillon seul (date NULL) invisible dans la vue');

-- 5. Y jamais intervenu → invisible
SELECT is(
  (SELECT count(*)::int FROM plateforme.v_traiteurs_gestionnaire
    WHERE id = '7a1e0006-0000-0000-0000-0000000000c2'),
  0, '5. gestionnaire : traiteur jamais intervenu sur ses lieux invisible dans la vue');

-- 6. Embed des routes (evenements → traiteur opérationnel) : le nom se résout par la vue
SELECT is(
  (SELECT v.nom FROM plateforme.evenements e
     JOIN plateforme.v_traiteurs_gestionnaire v ON v.id = e.traiteur_operationnel_organisation_id
    WHERE e.id = '7a1ee001-0000-0000-0000-0000000000c2'),
  'VTG Trait',
  '6. gestionnaire : evenements → v_traiteurs_gestionnaire résout le nom du traiteur opérationnel');

-- =============================================================================
-- 7-9 — la vue ne projette QUE id / nom / logo_url
-- =============================================================================
SELECT test_as_superuser();

-- 7. Colonnes figées : toute colonne ajoutée élargit l'accès → ce test doit rougir
SELECT is(
  (SELECT array_agg(attname::text ORDER BY attname::text COLLATE "C")
     FROM pg_attribute
    WHERE attrelid = 'plateforme.v_traiteurs_gestionnaire'::regclass AND attnum > 0 AND NOT attisdropped),
  ARRAY['id', 'logo_url', 'nom']::text[],
  '7. v_traiteurs_gestionnaire : colonnes = {id, logo_url, nom} exactement');

SELECT test_set_jwt_prod('gestionnaire_lieux', '7a1e0001-0000-0000-0000-0000000000c2'::uuid);

-- 8. siret n'existe pas dans la vue
SELECT throws_ok(
  $$ SELECT siret FROM plateforme.v_traiteurs_gestionnaire $$,
  '42703', NULL, '8. gestionnaire : siret absent de la vue (column does not exist)');

-- 9. email_principal n'existe pas dans la vue
SELECT throws_ok(
  $$ SELECT email_principal FROM plateforme.v_traiteurs_gestionnaire $$,
  '42703', NULL, '9. gestionnaire : email_principal absent de la vue');

-- =============================================================================
-- 10-11 — régressions : agence → shadow (§06.11) intacte ; autre gestionnaire
-- =============================================================================
-- 10. L'agence lit toujours la fiche shadow qu'elle a créée (complétion SIRET §06.11)
SELECT test_set_jwt_prod('agence', '7a1e0003-0000-0000-0000-0000000000c2'::uuid);
SELECT is(
  (SELECT siret FROM plateforme.organisations WHERE id = '7a1e0004-0000-0000-0000-0000000000c2'),
  '77710000000004',
  '10. agence : sa fiche shadow reste lisible (policy org_agence_select inchangée)');

-- 11. Un gestionnaire sans lieu ne voit aucun traiteur dans la vue
SELECT test_set_jwt_prod('gestionnaire_lieux', '7a1e0008-0000-0000-0000-0000000000c2'::uuid);
SELECT is_empty(
  $$ SELECT id FROM plateforme.v_traiteurs_gestionnaire $$,
  '11. gestionnaire sans lieu : vue vide (prédicat porté par le JWT appelant)');

-- =============================================================================
-- 12-16 — aucun autre rôle ne lit la vue
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_manager', '7a1e0002-0000-0000-0000-0000000000c2'::uuid);
SELECT is_empty($$ SELECT id FROM plateforme.v_traiteurs_gestionnaire $$,
  '12. traiteur_manager : vue vide');

SELECT test_set_jwt_prod('traiteur_commercial', '7a1e0002-0000-0000-0000-0000000000c2'::uuid);
SELECT is_empty($$ SELECT id FROM plateforme.v_traiteurs_gestionnaire $$,
  '13. traiteur_commercial : vue vide');

SELECT test_set_jwt_prod('agence', '7a1e0003-0000-0000-0000-0000000000c2'::uuid);
SELECT is_empty($$ SELECT id FROM plateforme.v_traiteurs_gestionnaire $$,
  '14. agence : vue vide');

SELECT test_set_jwt_prod('client_organisateur', '7a1e0007-0000-0000-0000-0000000000c2'::uuid);
SELECT is_empty($$ SELECT id FROM plateforme.v_traiteurs_gestionnaire $$,
  '15. client_organisateur : vue vide');

-- 16. Client organisateur : aucune ligne traiteur par la table non plus
SELECT is_empty(
  $$ SELECT id FROM plateforme.organisations WHERE type = 'traiteur' $$,
  '16. client_organisateur : aucune fiche traiteur lisible par la table');

-- =============================================================================
-- 17-20 — structure : policy supprimée, vue barrière, privilèges
-- =============================================================================
SELECT test_as_superuser();

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'plateforme' AND tablename = 'organisations'
      AND policyname = 'org_gestionnaire_traiteur_select'),
  0, '17. policy org_gestionnaire_traiteur_select supprimée');

SELECT ok(
  (SELECT 'security_barrier=true' = ANY (reloptions) AND 'security_invoker=false' = ANY (reloptions)
     FROM pg_class WHERE oid = 'plateforme.v_traiteurs_gestionnaire'::regclass),
  '18. vue security_barrier=true et security_invoker=false');

SELECT ok(
  NOT has_table_privilege('anon', 'plateforme.v_traiteurs_gestionnaire', 'SELECT')
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.oid = 'plateforme.v_traiteurs_gestionnaire'::regclass AND a.grantee = 0),
  '19. anon et PUBLIC : aucun privilège sur la vue');

SELECT ok(
  has_table_privilege('authenticated', 'plateforme.v_traiteurs_gestionnaire', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'plateforme.v_traiteurs_gestionnaire', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'plateforme.v_traiteurs_gestionnaire', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'plateforme.v_traiteurs_gestionnaire', 'DELETE'),
  '20. authenticated : SELECT seul sur la vue');

-- 21. Écriture à travers la vue (auto-modifiable) refusée au gestionnaire
SELECT test_set_jwt_prod('gestionnaire_lieux', '7a1e0001-0000-0000-0000-0000000000c2'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.v_traiteurs_gestionnaire SET nom = 'pwn' WHERE id = '7a1e0002-0000-0000-0000-0000000000c2' $$,
  '42501', NULL, '21. gestionnaire : UPDATE à travers la vue refusé (permission denied)');

SELECT * FROM finish();
ROLLBACK;

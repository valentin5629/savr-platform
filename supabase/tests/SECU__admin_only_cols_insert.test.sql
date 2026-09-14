-- =============================================================================
-- Tests pgTAP — Colonnes admin-only : volet CRÉATION (INSERT)
-- Migration prouvée : 20260914200000_plateforme_admin_only_cols_a_la_creation
-- =============================================================================
-- Régression visée (revue reviewer-rls-securite, PR #299) : les colonnes « édition
-- admin-only » (§09 matrice ops l.397/402-403/407, §06.06 §5) n'étaient protégées
-- qu'à l'UPDATE — `trg_ops_immutable_cols` est un BEFORE UPDATE, muet à l'INSERT.
-- Ce fichier fixe l'oracle DB pour les 3 tables qui portent ce trigger :
--
--   1. `associations` et 2. `factures` — la création est fermée par ABSENCE de policy
--      INSERT pour ops (RLS : SELECT + UPDATE seulement). L'invariant n'était nulle
--      part épinglé : ces tests le rendent mécanique. Si une policy INSERT ops
--      apparaît un jour, les assertions de jeu de policies rougissent et la décision
--      redevient explicite (au lieu d'ouvrir le volet création en silence).
--
--   3. `organisations` — SEUL trou DB réel, et ouvert à un rôle CLIENT : la policy
--      `org_agence_insert_shadow` autorise une `agence` à créer une fiche traiteur
--      shadow, et le durcissement colonne de M3.1 (REVOKE UPDATE + GRANT UPDATE liste
--      blanche) ne porte QUE sur l'UPDATE. Une agence pouvait donc POSER elle-même
--      `tarif_refacture_pax_zd` (§09 l.407, tarif refacturé → KPI Marge),
--      `grille_tarifaire_zd_id` et `notes_internes` à la création.
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` = 'authenticated' ET claim métier
-- `user_role`) : un helper qui omet `role` rend inertes les policies écrites en
-- `auth.role() = 'authenticated'` et fabrique des faux positifs (cf. la note de
-- SECU__catalogue_tarifaire_staff_only.test.sql).
--
-- ⚠ Le volet ROUTE n'est pas prouvable ici : POST /api/v1/admin/associations écrit en
-- service_role (RLS bypassée, f_app_role() NULL → toutes ces gardes s'exemptent).
-- Son oracle est le test de route packages/plateforme/tests/api/admin/associations.m1-1b.test.ts.
-- =============================================================================

BEGIN;
SELECT plan(16);

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
    'role', 'authenticated',          -- claim réservé (auth.role(), PostgREST)
    'user_role', p_role,              -- claim métier (f_app_role())
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
SELECT test_as_superuser();

-- L'agence qui crée les fiches shadow (cree_par_organisation_id) + un traiteur
-- porteur de l'entité de facturation servant de cible FK aux INSERT factures.
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES
  ('5ec00001-0000-0000-0000-0000000000a1'::uuid, 'SECU Agence', 'agence',   true, false, '55500000000001', 'agence@secu.test'),
  ('5ec00002-0000-0000-0000-0000000000a1'::uuid, 'SECU Traiteur', 'traiteur', true, false, '55500000000002', 'trait@secu.test');

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('5ec0ef01-0000-0000-0000-0000000000a1'::uuid, '5ec00002-0000-0000-0000-0000000000a1'::uuid,
        'SECU Traiteur SAS', '55500000000002', '1 rue du Test', '75001', 'Paris');

INSERT INTO plateforme.grilles_tarifaires_zd (id, nom, mode, est_defaut, actif, valide_du)
VALUES ('5ec09211-0000-0000-0000-0000000000a1'::uuid, 'SECU Grille INSERT', 'paliers', false, true, '2026-01-01');

-- =============================================================================
-- 1-3 — associations : aucune création possible pour ops (pas de policy INSERT)
-- =============================================================================
-- `description_rapport_impact` est fournie explicitement : son DÉFAUT DDL
-- ('Description à compléter.', 26 car.) viole son propre CHECK ≥ 30 — sans elle,
-- l'INSERT échouerait en 23514 et l'oracle ne porterait plus sur le verdict d'accès.
SELECT test_set_jwt_prod('ops_savr', '5ec00002-0000-0000-0000-0000000000a1'::uuid);

-- 1. Le volet création est fermé par la RLS — d'où l'inutilité d'étendre
--    trg_ops_immutable_cols à l'INSERT (ce serait du code mort).
SELECT throws_ok(
  $$ INSERT INTO plateforme.associations
       (nom, adresse, region, ville, contact_email, description_rapport_impact, siren, habilitee_attestation_fiscale)
     VALUES ('SECU Asso ops', '1 rue ops', 'idf', 'Paris', 'ops@asso.test',
             'Association de test SECU pour la garde de creation admin-only.', '123456789', true) $$,
  '42501', NULL,
  'ops_savr NE PEUT PAS créer une association (aucune policy INSERT ops) — champs admin-only inatteignables à la création'
);

-- 2. Contrôle positif / non-vacuité : le refus ci-dessus vient bien de la RLS ops,
--    pas d'un GRANT manquant ni d'une fixture invalide — admin_savr crée la même ligne.
SELECT test_set_jwt_prod('admin_savr', '5ec00002-0000-0000-0000-0000000000a1'::uuid);
SELECT lives_ok(
  $$ INSERT INTO plateforme.associations
       (nom, adresse, region, ville, contact_email, description_rapport_impact, siren, habilitee_attestation_fiscale)
     VALUES ('SECU Asso admin', '1 rue admin', 'idf', 'Paris', 'admin@asso.test',
             'Association de test SECU pour la garde de creation admin-only.', '123456789', true) $$,
  'admin_savr PEUT créer une association avec SIREN + habilitation (contrôle positif)'
);

-- 3. Cliquet : le jeu des policies ouvrant l'INSERT sur associations reste réduit à
--    l'admin. Toute policy INSERT (ou ALL) supplémentaire rougit ce test.
SELECT is(
  (SELECT array_agg(policyname::text ORDER BY policyname)
     FROM pg_policies
    WHERE schemaname = 'plateforme' AND tablename = 'associations'
      AND cmd IN ('INSERT', 'ALL')),
  ARRAY['asso_admin'],
  'associations : seule asso_admin ouvre la création (aucune policy INSERT ops/client)'
);

-- =============================================================================
-- 4-5 — factures : idem, la création reste admin-only
-- =============================================================================
SELECT test_set_jwt_prod('ops_savr', '5ec00002-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.factures (entite_facturation_id, organisation_id, numero_facture, montant_ht, montant_ttc)
     VALUES ('5ec0ef01-0000-0000-0000-0000000000a1'::uuid, '5ec00002-0000-0000-0000-0000000000a1'::uuid,
             'SECU-FAC-0001', 9999.00, 11998.80) $$,
  '42501', NULL,
  'ops_savr NE PEUT PAS créer une facture (montants admin-only inatteignables à la création, §09 l.397)'
);

SELECT is(
  (SELECT array_agg(policyname::text ORDER BY policyname)
     FROM pg_policies
    WHERE schemaname = 'plateforme' AND tablename = 'factures'
      AND cmd IN ('INSERT', 'ALL')),
  ARRAY['fac_admin'],
  'factures : seule fac_admin ouvre la création (aucune policy INSERT ops/client)'
);

-- =============================================================================
-- 6-15 — organisations : colonnes staff-only fermées à la création (nouveau trigger)
-- =============================================================================
-- ⚠ Le MESSAGE est asserté (3e argument), pas seulement le SQLSTATE : une violation de
-- `WITH CHECK` RLS et un RAISE de trigger renvoient tous deux 42501. Sans le message,
-- ces 3 cas passeraient au vert même si le trigger n'existait pas (refus par une autre
-- barrière) — faux positif déjà vécu (PR #262). Un trigger BEFORE ROW parle avant
-- l'évaluation du WITH CHECK : c'est bien lui qui répond ici.
SELECT test_set_jwt_prod('agence', '5ec00001-0000-0000-0000-0000000000a1'::uuid);

-- 6. Le trou fermé : l'agence fixait le tarif que Savr lui refacture.
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, cree_par_organisation_id, tarif_refacture_pax_zd)
     VALUES ('SECU Shadow tarif', 'traiteur', true, '5ec00001-0000-0000-0000-0000000000a1'::uuid, 0) $$,
  '42501',
  'Seul admin_savr peut fixer organisations.tarif_refacture_pax_zd (§09 l.407)',
  'agence NE PEUT PAS poser tarif_refacture_pax_zd à la création (§09 l.407, admin-only)'
);

-- 7-8. Les deux autres colonnes hors liste blanche M3.1.
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, cree_par_organisation_id, grille_tarifaire_zd_id)
     VALUES ('SECU Shadow grille', 'traiteur', true, '5ec00001-0000-0000-0000-0000000000a1'::uuid,
             '5ec09211-0000-0000-0000-0000000000a1'::uuid) $$,
  '42501',
  'Seul admin_savr peut affecter organisations.grille_tarifaire_zd_id (§09 l.137)',
  'agence NE PEUT PAS affecter grille_tarifaire_zd_id à la création (admin-only)'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, cree_par_organisation_id, notes_internes)
     VALUES ('SECU Shadow notes', 'traiteur', true, '5ec00001-0000-0000-0000-0000000000a1'::uuid, 'note injectée') $$,
  '42501',
  'Seul le staff Savr peut écrire organisations.notes_internes',
  'agence NE PEUT PAS écrire notes_internes à la création (staff-only)'
);

-- 9-10. Les 2 colonnes staff-only oubliées au 1er jet (relevé reviewer-rls-securite) :
-- `actif` (hors liste blanche M3.1) et `mode_facturation_zd` (ajoutée APRÈS M3.1,
-- migration 20260619150000, donc absente du commentaire de liste blanche).
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, cree_par_organisation_id, actif)
     VALUES ('SECU Shadow actif', 'traiteur', true, '5ec00001-0000-0000-0000-0000000000a1'::uuid, false) $$,
  '42501',
  'Seul le staff Savr peut fixer organisations.actif à la création',
  'agence NE PEUT PAS fixer actif à la création (staff-only)'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, cree_par_organisation_id, mode_facturation_zd)
     VALUES ('SECU Shadow mode', 'traiteur', true, '5ec00001-0000-0000-0000-0000000000a1'::uuid, 'mensuelle') $$,
  '42501',
  'Seul le staff Savr peut fixer organisations.mode_facturation_zd à la création',
  'agence NE PEUT PAS fixer mode_facturation_zd à la création (§06.08, staff-only)'
);

-- 11. Pas de sur-blocage : le flux shadow §06.01 reste fonctionnel sans ces colonnes.
SELECT lives_ok(
  $$ INSERT INTO plateforme.organisations (nom, raison_sociale, type, est_shadow, cree_par_organisation_id, siret)
     VALUES ('SECU Shadow OK', 'SECU Shadow SAS', 'traiteur', true,
             '5ec00001-0000-0000-0000-0000000000a1'::uuid, '55500000000003') $$,
  'agence PEUT créer une fiche traiteur shadow sans colonne staff (contrôle positif, §06.01)'
);

-- 12. La ligne créée par l'agence porte bien le tarif par défaut : la garde protège
--     la VALEUR, elle ne se contente pas de refuser la colonne.
SELECT is(
  (SELECT tarif_refacture_pax_zd FROM plateforme.organisations WHERE nom = 'SECU Shadow OK'),
  1.50::numeric(10,2),
  'la fiche shadow créée par l''agence garde le tarif refacturé par défaut (1.50)'
);

-- 13. Cliquet sur les constantes du trigger : fn_block_org_staff_cols_insert compare à
--     1.50 en dur. Si le défaut de colonne change, ce test rougit AVANT que la garde
--     ne se mette à refuser toutes les créations shadow légitimes.
SELECT is(
  (SELECT array_agg(column_default::text ORDER BY column_name)
     FROM information_schema.columns
    WHERE table_schema = 'plateforme' AND table_name = 'organisations'
      AND column_name IN ('actif', 'mode_facturation_zd', 'tarif_refacture_pax_zd')),
  ARRAY['true', $$'par_collecte'::plateforme.mode_facturation_zd_enum$$, '1.50'],
  'les 3 défauts codés en dur dans la garde INSERT sont toujours ceux du schéma'
);

-- 14. Contrôle positif : admin_savr n'est pas gardé (il fixe le tarif à la création).
SELECT test_set_jwt_prod('admin_savr', '5ec00002-0000-0000-0000-0000000000a1'::uuid);
SELECT lives_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, tarif_refacture_pax_zd, notes_internes)
     VALUES ('SECU Org admin', 'traiteur', false, 2.50, 'note staff') $$,
  'admin_savr PEUT poser tarif_refacture_pax_zd + notes_internes à la création (contrôle positif)'
);

-- 15. Cliquet de CAUSE RACINE : la garde est une liste de colonnes, donc une colonne
--     ajoutée plus tard échappe à la matrice d'écriture sans que rien ne rougisse.
--     C'est exactement ce qui est arrivé à `mode_facturation_zd` (ajoutée en
--     20260619150000, APRÈS la liste blanche M3.1 de 20260616130000 : jamais
--     reconsidérée jusqu'à cette revue). On épingle donc l'ENSEMBLE des colonnes,
--     réparties en 3 régimes d'écriture à la création :
--       • ouvertes au client (liste blanche GRANT UPDATE M3.1) ;
--       • épinglées par le WITH CHECK de `org_agence_insert_shadow` ;
--       • gardées par `trg_block_org_staff_cols_insert` (staff-only).
--     Une 19e colonne fait rougir ce test : il faut alors TRANCHER son régime, puis
--     l'ajouter ici (et à la garde si elle est staff-only).
SELECT is(
  (SELECT array_agg(column_name::text ORDER BY column_name)
     FROM information_schema.columns
    WHERE table_schema = 'plateforme' AND table_name = 'organisations'),
  ARRAY[
    'actif',                     -- staff-only → gardée par le trigger
    'adresse',                   -- client (liste blanche M3.1)
    'created_at',                -- technique, non gouvernée (INFO tracé pour Val)
    'cree_par_organisation_id',  -- épinglée par le WITH CHECK de la policy shadow
    'email_principal',           -- client
    'est_shadow',                -- épinglée par le WITH CHECK
    'grille_tarifaire_zd_id',    -- staff-only → trigger
    'id',                        -- technique, non gouvernée (INFO)
    'logo_url',                  -- client
    'mode_facturation_zd',       -- staff-only → trigger (le cas qui avait échappé)
    'nom',                       -- client
    'notes_internes',            -- staff-only → trigger
    'raison_sociale',            -- client
    'siret',                     -- client
    'tarif_refacture_pax_zd',    -- staff-only → trigger
    'telephone',                 -- client
    'type',                      -- épinglée par le WITH CHECK
    'updated_at'                 -- client (liste blanche M3.1)
  ],
  'organisations : aucune colonne ajoutée hors matrice d''écriture (18 colonnes tranchées)'
);

-- 16. ops_savr non plus ne crée pas d'organisation (aucune policy INSERT ops) — la
--     garde colonne ci-dessus n'est donc pas la seule barrière pour ce rôle.
SELECT test_set_jwt_prod('ops_savr', '5ec00002-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow)
     VALUES ('SECU Org ops', 'traiteur', false) $$,
  '42501', NULL,
  'ops_savr NE PEUT PAS créer une organisation (aucune policy INSERT ops)'
);

SELECT * FROM finish();
ROLLBACK;

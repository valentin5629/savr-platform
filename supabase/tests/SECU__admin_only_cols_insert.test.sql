-- =============================================================================
-- Tests pgTAP — Colonnes admin-only : volet CRÉATION (INSERT)
-- Migrations prouvées : 20260914200000_plateforme_admin_only_cols_a_la_creation
--                       20260915100000_plateforme_organisations_grant_insert_liste_blanche
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
--      Depuis 20260915100000, la barrière de 1re ligne sur cette table n'est plus la
--      liste de colonnes du trigger mais le PRIVILÈGE : REVOKE INSERT table-level +
--      re-GRANT sur la liste blanche shadow, symétrique du durcissement UPDATE M3.1 et
--      fail-closed (une colonne ajoutée demain n'est pas insérable par défaut). Le
--      trigger est CONSERVÉ en défense en profondeur — il garde la VALEUR quand le GRANT
--      garde le DROIT D'ÉCRIRE — et il est exercé en propre aux cas 22-24, sous une
--      ré-ouverture accidentelle simulée du GRANT table-level.
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
SELECT plan(24);

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

-- `service_role` — le rôle RÉEL des 3 routes qui INSÈRENT une organisation
-- (createAdminSupabaseClient). Distinct de `postgres` : le superuser court-circuite les
-- privilèges par un autre mécanisme (bypass total), tandis que service_role les porte
-- vraiment. Le contrôle positif du cas 19 doit donc s'exécuter ICI, pas en superuser,
-- sinon il ne prouve rien du chemin applicatif. Claims JWT vidées → f_app_role() NULL,
-- ce qui exempte aussi le trigger de garde (même condition qu'en production).
CREATE OR REPLACE FUNCTION test_as_service_role()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', 'service_role', true);
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
-- 6-12 — organisations : colonnes hors liste blanche INATTEIGNABLES à la création
-- =============================================================================
-- Depuis 20260915100000, la 1re barrière n'est plus le trigger mais le PRIVILÈGE :
-- `REVOKE INSERT ON plateforme.organisations FROM authenticated` + re-GRANT sur la
-- liste blanche exacte {nom, raison_sociale, siret, type, est_shadow,
-- cree_par_organisation_id} — le pendant INSERT du durcissement UPDATE de M3.1.
-- Le contrôle de privilège s'exécute AVANT tout trigger BEFORE ROW : c'est donc lui
-- qui parle ici, avec le message table-level de PostgreSQL (vérifié : PG répond
-- « permission denied for table ... », pas « ... for column ... », quand l'INSERT vise
-- une colonne hors grant colonne-level).
--
-- ⚠ Le MESSAGE est asserté (3e argument), pas seulement le SQLSTATE : RLS WITH CHECK,
-- RAISE de trigger et refus de privilège renvoient TOUS 42501. Sans le message, ces cas
-- passeraient au vert même sans le REVOKE (refus par une autre barrière) — faux positif
-- déjà vécu (PR #262). Le trigger, lui, est exercé en propre aux cas 22-24.
--
-- NB `permission denied for table ...` est la chaîne ANGLAISE de PostgreSQL. Sur un
-- serveur dont `lc_messages` ne serait pas en C/en_US, ces cas produiraient un faux
-- ROUGE — jamais un faux vert : la dégradation est fail-closed, donc acceptable.
SELECT test_set_jwt_prod('agence', '5ec00001-0000-0000-0000-0000000000a1'::uuid);

-- 6. Le trou historique : l'agence fixait le tarif que Savr lui refacture.
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, cree_par_organisation_id, tarif_refacture_pax_zd)
     VALUES ('SECU Shadow tarif', 'traiteur', true, '5ec00001-0000-0000-0000-0000000000a1'::uuid, 0) $$,
  '42501',
  'permission denied for table organisations',
  'agence NE PEUT PAS poser tarif_refacture_pax_zd à la création (hors liste blanche GRANT INSERT, §09 l.407)'
);

-- 7-10. Les 4 autres colonnes staff-only (§09 / §06.08).
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, cree_par_organisation_id, grille_tarifaire_zd_id)
     VALUES ('SECU Shadow grille', 'traiteur', true, '5ec00001-0000-0000-0000-0000000000a1'::uuid,
             '5ec09211-0000-0000-0000-0000000000a1'::uuid) $$,
  '42501',
  'permission denied for table organisations',
  'agence NE PEUT PAS affecter grille_tarifaire_zd_id à la création (hors liste blanche)'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, cree_par_organisation_id, notes_internes)
     VALUES ('SECU Shadow notes', 'traiteur', true, '5ec00001-0000-0000-0000-0000000000a1'::uuid, 'note injectée') $$,
  '42501',
  'permission denied for table organisations',
  'agence NE PEUT PAS écrire notes_internes à la création (hors liste blanche)'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, cree_par_organisation_id, actif)
     VALUES ('SECU Shadow actif', 'traiteur', true, '5ec00001-0000-0000-0000-0000000000a1'::uuid, false) $$,
  '42501',
  'permission denied for table organisations',
  'agence NE PEUT PAS fixer actif à la création (hors liste blanche)'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, cree_par_organisation_id, mode_facturation_zd)
     VALUES ('SECU Shadow mode', 'traiteur', true, '5ec00001-0000-0000-0000-0000000000a1'::uuid, 'mensuelle') $$,
  '42501',
  'permission denied for table organisations',
  'agence NE PEUT PAS fixer mode_facturation_zd à la création (§06.08, hors liste blanche)'
);

-- 11-12. Les 2 colonnes qui n'étaient dans AUCUNE matrice avant cette migration :
-- `id` (PK forgeable) et `created_at` (horodatage forgeable). Impact borné — une
-- collision de PK échoue, et created_at n'alimente aucune logique de sécurité ni de
-- facturation — mais leur régime d'écriture est désormais tranché : serveur seul.
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (id, nom, type, est_shadow, cree_par_organisation_id)
     VALUES ('5ec0f06e-0000-0000-0000-0000000000a1'::uuid, 'SECU Shadow id', 'traiteur', true,
             '5ec00001-0000-0000-0000-0000000000a1'::uuid) $$,
  '42501',
  'permission denied for table organisations',
  'agence NE PEUT PAS forger id à la création (PK laissée au défaut gen_random_uuid())'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, cree_par_organisation_id, created_at)
     VALUES ('SECU Shadow created', 'traiteur', true, '5ec00001-0000-0000-0000-0000000000a1'::uuid,
             '2000-01-01T00:00:00Z'::timestamptz) $$,
  '42501',
  'permission denied for table organisations',
  'agence NE PEUT PAS forger created_at à la création (horodatage serveur)'
);

-- =============================================================================
-- 13-15 — pas de sur-blocage : le flux shadow §06.01/§06.11 reste fonctionnel
-- =============================================================================
-- Contrôle positif indispensable : sans lui, un REVOKE trop large (ou un re-GRANT
-- oublié) rendrait la policy org_agence_insert_shadow inapplicable — on aurait
-- SUPPRIMÉ une capacité du CDC au lieu de la border, et les cas 6-12 resteraient verts.
SELECT lives_ok(
  $$ INSERT INTO plateforme.organisations (nom, raison_sociale, type, est_shadow, cree_par_organisation_id, siret)
     VALUES ('SECU Shadow OK', 'SECU Shadow SAS', 'traiteur', true,
             '5ec00001-0000-0000-0000-0000000000a1'::uuid, '55500000000003') $$,
  'agence PEUT créer une fiche traiteur shadow avec TOUTE la liste blanche, SIRET compris (§06.11 différence #4)'
);

-- 14. La ligne créée par l'agence porte bien le tarif par défaut. Lu en superuser :
--     depuis 20260918100000 la colonne est hors GRANT SELECT authenticated (l'agence
--     ne lit plus le tarif de ses fiches shadow) ; l'oracle porte sur la valeur stockée.
SELECT test_as_superuser();
SELECT is(
  (SELECT tarif_refacture_pax_zd FROM plateforme.organisations WHERE nom = 'SECU Shadow OK'),
  1.50::numeric(10,2),
  'la fiche shadow créée par l''agence garde le tarif refacturé par défaut (1.50)'
);

-- 15. Cliquet sur les constantes du trigger : fn_block_org_staff_cols_insert compare à
--     1.50 / true / 'par_collecte' en dur. Si un défaut de colonne change, ce test rougit
--     AVANT que la garde ne se mette à refuser toutes les créations légitimes (le jour où
--     le trigger redevient la barrière active — cas 22-24).
SELECT is(
  (SELECT array_agg(column_default::text ORDER BY column_name)
     FROM information_schema.columns
    WHERE table_schema = 'plateforme' AND table_name = 'organisations'
      AND column_name IN ('actif', 'mode_facturation_zd', 'tarif_refacture_pax_zd')),
  ARRAY['true', $$'par_collecte'::plateforme.mode_facturation_zd_enum$$, '1.50'],
  'les 3 défauts codés en dur dans la garde INSERT sont toujours ceux du schéma'
);
-- (14-15 en superuser : information_schema.columns masque les colonnes que le rôle
--  courant ne peut pas lire — tarif et mode de facturation depuis 20260918100000.)
SELECT test_set_jwt_prod('agence', '5ec00001-0000-0000-0000-0000000000a1'::uuid);

-- =============================================================================
-- 16-17 — cliquet colonne → RÉGIME d'écriture (et pas seulement « colonne connue »)
-- =============================================================================
-- Limite du cliquet précédent (cas 20) : il épingle l'ENSEMBLE des colonnes, donc un
-- élargissement silencieux d'une liste blanche (GRANT INSERT/UPDATE ajouté sur une
-- colonne staff-only) resterait vert. On épingle ici les privilèges EFFECTIFS.
-- `has_column_privilege` est le bon oracle : il voit le privilège colonne ET un
-- éventuel GRANT table-level qui le ré-ouvrirait en masse (le scénario 22-24).
SELECT is(
  (SELECT array_agg(column_name::text ORDER BY column_name)
     FROM information_schema.columns
    WHERE table_schema = 'plateforme' AND table_name = 'organisations'
      AND has_column_privilege('authenticated', 'plateforme.organisations', column_name, 'INSERT')),
  ARRAY['cree_par_organisation_id', 'est_shadow', 'nom', 'raison_sociale', 'siret', 'type'],
  'INSERT authenticated : exactement la liste blanche shadow (20260915100000), ni plus ni moins'
);

SELECT is(
  (SELECT array_agg(column_name::text ORDER BY column_name)
     FROM information_schema.columns
    WHERE table_schema = 'plateforme' AND table_name = 'organisations'
      AND has_column_privilege('authenticated', 'plateforme.organisations', column_name, 'UPDATE')),
  ARRAY['adresse', 'email_principal', 'logo_url', 'nom', 'raison_sociale', 'siret', 'telephone', 'updated_at'],
  'UPDATE authenticated : exactement la liste blanche M3.1 (20260616130000), ni plus ni moins'
);

-- =============================================================================
-- 18-19 — le régime est un PRIVILÈGE, pas un rôle métier : chemins staff intacts
-- =============================================================================
-- 18. `admin_savr` porte lui aussi le rôle PostgreSQL `authenticated` : le REVOKE le
--     borne DONC également sur le chemin PostgREST direct. Ce n'est pas une régression
--     mais le régime établi par M3.1 (son REVOKE UPDATE borne déjà l'admin de la même
--     façon) : le staff écrit les organisations en service_role, via les routes
--     back-office (POST/PATCH /api/v1/admin/organisations, createAdminSupabaseClient).
--     Assertion explicite pour que ce choix soit lu, pas découvert.
SELECT test_set_jwt_prod('admin_savr', '5ec00002-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, tarif_refacture_pax_zd, notes_internes)
     VALUES ('SECU Org admin', 'traiteur', false, 2.50, 'note staff') $$,
  '42501',
  'permission denied for table organisations',
  'admin_savr non plus n''écrit pas les colonnes staff via PostgREST : le staff passe par service_role (précédent M3.1)'
);

-- 19. Contrôle positif du chemin réel, joué sous le VRAI rôle `service_role` (et non en
--     superuser, qui prouverait moins : il court-circuite les privilèges autrement) :
--     la création complète reste possible — id, created_at et colonnes staff comprises.
--     C'est exactement le chemin des 3 routes qui INSÈRENT une organisation
--     (shadow agence, back-office Admin, inscription), via createAdminSupabaseClient.
SELECT test_as_service_role();
SELECT lives_ok(
  $$ INSERT INTO plateforme.organisations
       (id, nom, raison_sociale, type, est_shadow, siret, actif, tarif_refacture_pax_zd,
        notes_internes, mode_facturation_zd, created_at)
     VALUES ('5ec05e41-0000-0000-0000-0000000000a1'::uuid, 'SECU Org service', 'SECU Org service SAS',
             'traiteur', false, '55500000000004', false, 2.50, 'note staff', 'mensuelle',
             '2026-01-01T00:00:00Z'::timestamptz) $$,
  'le chemin service_role crée une organisation complète (routes admin, route shadow, signup) — aucun sur-blocage'
);

-- On repasse en superuser : les cas suivants lisent les catalogues et manipulent les
-- privilèges, ce que service_role ne peut pas faire.
SELECT test_as_superuser();

-- =============================================================================
-- 20-21 — matrice d'écriture complète + absence de policy INSERT ops
-- =============================================================================
-- 20. Cliquet de CAUSE RACINE : la garde par trigger est une liste de colonnes, donc une
--     colonne ajoutée plus tard y échappe sans que rien ne rougisse. C'est exactement ce
--     qui est arrivé à `mode_facturation_zd` (ajoutée en 20260619150000, APRÈS la liste
--     blanche M3.1 de 20260616130000 : jamais reconsidérée jusqu'à la revue #302).
--     Depuis 20260915100000 le régime par défaut est FERMÉ (une colonne nouvelle n'est
--     pas insérable tant qu'on ne l'ajoute pas au GRANT), mais son RÉGIME reste à
--     trancher : on épingle donc l'ENSEMBLE des colonnes, réparties en 3 régimes :
--       • liste blanche GRANT INSERT (création shadow agence, cas 16) ;
--       • éditable par le client sur sa propre fiche (GRANT UPDATE M3.1, cas 17) ;
--       • serveur/staff seulement (ni INSERT ni UPDATE pour `authenticated`).
--     Une 19e colonne fait rougir ce test : il faut alors TRANCHER son régime, puis
--     l'ajouter ici (et aux GRANT si elle est ouverte au client).
SELECT is(
  (SELECT array_agg(column_name::text ORDER BY column_name)
     FROM information_schema.columns
    WHERE table_schema = 'plateforme' AND table_name = 'organisations'),
  ARRAY[
    'actif',                     -- serveur/staff (+ garde de valeur du trigger)
    'adresse',                   -- client : UPDATE seul (M3.1)
    'created_at',                -- serveur seul (fermé 20260915100000)
    'cree_par_organisation_id',  -- INSERT shadow, épinglée par le WITH CHECK de la policy
    'email_principal',           -- client : UPDATE seul
    'est_shadow',                -- INSERT shadow, épinglée par le WITH CHECK
    'grille_tarifaire_zd_id',    -- serveur/staff (+ trigger)
    'id',                        -- serveur seul (fermé 20260915100000)
    'logo_url',                  -- client : UPDATE seul
    'mode_facturation_zd',       -- serveur/staff (+ trigger) — le cas qui avait échappé
    'nom',                       -- client : INSERT shadow + UPDATE
    'notes_internes',            -- serveur/staff (+ trigger)
    'raison_sociale',            -- client : INSERT shadow + UPDATE
    'siret',                     -- client : INSERT shadow + UPDATE
    'tarif_refacture_pax_zd',    -- serveur/staff (+ trigger)
    'telephone',                 -- client : UPDATE seul
    'type',                      -- INSERT shadow, épinglée par le WITH CHECK
    'updated_at'                 -- client : UPDATE seul (M3.1)
  ],
  'organisations : aucune colonne ajoutée hors matrice d''écriture (18 colonnes tranchées)'
);

-- 21. ops_savr non plus ne crée pas d'organisation (aucune policy INSERT ops) — les
--     gardes ci-dessus ne sont donc pas la seule barrière pour ce rôle.
SELECT test_set_jwt_prod('ops_savr', '5ec00002-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow)
     VALUES ('SECU Org ops', 'traiteur', false) $$,
  '42501', NULL,
  'ops_savr NE PEUT PAS créer une organisation (aucune policy INSERT ops)'
);

-- =============================================================================
-- 22-24 — défense en profondeur : le trigger reste la dernière barrière
-- =============================================================================
-- Pourquoi garder `trg_block_org_staff_cols_insert` alors que le GRANT colonne rend sa
-- liste redondante ? Parce que le GRANT est ré-ouvrable PAR ACCIDENT : un simple
-- `GRANT INSERT ON plateforme.organisations TO authenticated`, copié-collé depuis une
-- table voisine (les migrations post-0.4a octroient table par table), rendrait les 18
-- colonnes de nouveau insérables — sans rien casser d'autre, donc sans alerte. Le cas 16
-- attrape ce scénario en CI ; le trigger, lui, couvre la fenêtre entre l'accident et la
-- CI, et tout rôle applicatif futur qui ne porterait pas le même privilège. Le trigger
-- garde la VALEUR, le GRANT garde le DROIT D'ÉCRIRE : deux mécanismes, deux rôles.
-- On SIMULE ici cette ré-ouverture (GRANT rejoué en superuser, annulé par le ROLLBACK
-- final du fichier) et on prouve que le trigger tient encore.
SELECT test_as_superuser();
GRANT INSERT ON plateforme.organisations TO authenticated; -- ré-ouverture accidentelle simulée
SELECT test_set_jwt_prod('agence', '5ec00001-0000-0000-0000-0000000000a1'::uuid);

-- 22-23. Le message asserté est celui du TRIGGER : c'est bien lui qui répond maintenant
--        que le privilège ne bloque plus (un trigger BEFORE ROW parle avant l'évaluation
--        du WITH CHECK RLS). Non-vacuité : sans le GRANT rejoué ci-dessus, ces 2 cas
--        échoueraient sur le message de privilège des cas 6/10.
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, cree_par_organisation_id, tarif_refacture_pax_zd)
     VALUES ('SECU Shadow tarif DP', 'traiteur', true, '5ec00001-0000-0000-0000-0000000000a1'::uuid, 0) $$,
  '42501',
  'Seul admin_savr peut fixer organisations.tarif_refacture_pax_zd (§09 l.407)',
  'GRANT table-level ré-ouvert par accident : le trigger refuse encore tarif_refacture_pax_zd (défense en profondeur)'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (nom, type, est_shadow, cree_par_organisation_id, mode_facturation_zd)
     VALUES ('SECU Shadow mode DP', 'traiteur', true, '5ec00001-0000-0000-0000-0000000000a1'::uuid, 'mensuelle') $$,
  '42501',
  'Seul le staff Savr peut fixer organisations.mode_facturation_zd à la création',
  'GRANT table-level ré-ouvert par accident : le trigger refuse encore mode_facturation_zd (défense en profondeur)'
);

-- 24. Non-vacuité du régime simulé : dans ce même état ré-ouvert, la création shadow
--     légitime passe toujours — le refus des cas 22-23 vient bien du trigger et de ses
--     colonnes, pas d'un blocage général hérité du GRANT rejoué.
SELECT lives_ok(
  $$ INSERT INTO plateforme.organisations (nom, raison_sociale, type, est_shadow, cree_par_organisation_id, siret)
     VALUES ('SECU Shadow OK DP', 'SECU Shadow DP SAS', 'traiteur', true,
             '5ec00001-0000-0000-0000-0000000000a1'::uuid, '55500000000005') $$,
  'GRANT table-level ré-ouvert : la création shadow légitime reste possible (le trigger ne sur-bloque pas)'
);

-- ⚠ REMISE EN ÉTAT OBLIGATOIRE — le ROLLBACK final annule déjà ce GRANT, mais tant qu'il
-- tient, TOUTE assertion ajoutée après ce point s'exécuterait dans le régime « privilège
-- ré-ouvert » et pourrait passer au vert à tort (faux positif silencieux, relevé par
-- reviewer-rls-securite). On restaure donc ici l'état nominal de la migration.
SELECT test_as_superuser();
REVOKE INSERT ON plateforme.organisations FROM authenticated;
GRANT INSERT (nom, raison_sociale, siret, type, est_shadow, cree_par_organisation_id)
  ON plateforme.organisations TO authenticated;

SELECT * FROM finish();
ROLLBACK;

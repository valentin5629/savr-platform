-- =============================================================================
-- SECU — shared.fichiers : photos de collecte visibles du client = celles que
-- l'équipe Savr a choisies (rang_client), 2 au maximum par collecte
-- =============================================================================
-- Migration : 20261007203000_shared_fichiers_photos_rang_client.sql
-- Décisions Val 2026-10-07 : sans choix de l'équipe Savr le client ne voit aucune
-- photo ; une photo non choisie est masquée jusque dans la base ; 2 au maximum.
--
-- Toutes les lectures et écritures « client » tournent sous le rôle PG
-- `authenticated` avec un JWT au format de production (jamais en service-role).
-- Chaque « 0 ligne » est adossé à une lecture positive du même rôle, pour qu'un
-- lecteur cassé ne passe pas pour un refus.
--
-- Jeu de données : 3 collectes (A, B, C).
--   A : traiteur A, lieu A (gestionnaire X), client organisateur Z
--   B : traiteur B, lieu B (gestionnaire Y)
--   C : programmée par l'agence, traiteur opérationnel A, lieu B
-- =============================================================================

BEGIN;
SELECT plan(36);

CREATE OR REPLACE FUNCTION photo_sel_jwt(p_role text, p_org uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'role', 'authenticated',
    'user_role', p_role, 'organisation_id', p_org, 'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION photo_sel_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('role', 'anon', true);
END $$;

CREATE OR REPLACE FUNCTION photo_sel_su() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Photos de collecte que le rôle courant lit, parmi celles du jeu de données.
CREATE OR REPLACE FUNCTION photo_sel_lues() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(right(id::text, 1), ',' ORDER BY id), '')
    FROM shared.fichiers
   WHERE id::text LIKE 'f0c8%' AND entity_type = 'plateforme.collectes'
$$;

-- ── Jeu de données ───────────────────────────────────────────────────────────
SELECT photo_sel_su();

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal) VALUES
  ('f0c10001-0000-0000-0000-000000000001','Sel Traiteur A','traiteur',true,false,'98000001100001','sel-a@test.invalid'),
  ('f0c10002-0000-0000-0000-000000000001','Sel Traiteur B','traiteur',true,false,'98000002200001','sel-b@test.invalid'),
  ('f0c10003-0000-0000-0000-000000000001','Sel Agence','agence',true,false,'98000003300001','sel-ag@test.invalid'),
  ('f0c10004-0000-0000-0000-000000000001','Sel Gest X','gestionnaire_lieux',true,false,'98000004400001','sel-gx@test.invalid'),
  ('f0c10005-0000-0000-0000-000000000001','Sel Gest Y','gestionnaire_lieux',true,false,'98000005500001','sel-gy@test.invalid'),
  ('f0c10006-0000-0000-0000-000000000001','Sel Client Z','client_organisateur',true,false,'98000006600001','sel-cz@test.invalid'),
  ('f0c10007-0000-0000-0000-000000000001','Sel Client W','client_organisateur',true,false,'98000007700001','sel-cw@test.invalid');
INSERT INTO plateforme.types_evenements (id, code, libelle)
  VALUES ('f0c50001-0000-0000-0000-000000000001','sel_photos','Sel');
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('f0c20001-0000-0000-0000-000000000001','f0c10001-0000-0000-0000-000000000001','sel-ua@test.invalid','A','A','traiteur_manager'),
  ('f0c20002-0000-0000-0000-000000000001','f0c10002-0000-0000-0000-000000000001','sel-ub@test.invalid','B','B','traiteur_manager'),
  ('f0c20003-0000-0000-0000-000000000001','f0c10003-0000-0000-0000-000000000001','sel-uag@test.invalid','G','G','agence');
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('f0c30001-0000-0000-0000-000000000001','f0c10001-0000-0000-0000-000000000001','A','98000001100001','1 r','75001','Paris'),
  ('f0c30002-0000-0000-0000-000000000001','f0c10002-0000-0000-0000-000000000001','B','98000002200001','2 r','75002','Paris'),
  ('f0c30003-0000-0000-0000-000000000001','f0c10003-0000-0000-0000-000000000001','AG','98000003300001','3 r','75003','Paris');
INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('f0c40001-0000-0000-0000-000000000001','Sel Lieu A','1 r','75001','Paris','fourgon'),
  ('f0c40002-0000-0000-0000-000000000001','Sel Lieu B','2 r','75002','Paris','fourgon');
INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id) VALUES
  ('f0c10004-0000-0000-0000-000000000001','f0c40001-0000-0000-0000-000000000001'),
  ('f0c10005-0000-0000-0000-000000000001','f0c40002-0000-0000-0000-000000000001');
INSERT INTO plateforme.evenements (id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id, client_organisateur_organisation_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone) VALUES
  ('f0c60001-0000-0000-0000-000000000001','f0c10001-0000-0000-0000-000000000001','f0c40001-0000-0000-0000-000000000001','f0c10001-0000-0000-0000-000000000001','f0c30001-0000-0000-0000-000000000001','f0c20001-0000-0000-0000-000000000001','f0c50001-0000-0000-0000-000000000001','f0c10006-0000-0000-0000-000000000001', now()+interval '10 days',100,'c','0600000001'),
  ('f0c60002-0000-0000-0000-000000000001','f0c10002-0000-0000-0000-000000000001','f0c40002-0000-0000-0000-000000000001','f0c10002-0000-0000-0000-000000000001','f0c30002-0000-0000-0000-000000000001','f0c20002-0000-0000-0000-000000000001','f0c50001-0000-0000-0000-000000000001',NULL, now()+interval '5 days',50,'c','0600000002'),
  ('f0c60003-0000-0000-0000-000000000001','f0c10003-0000-0000-0000-000000000001','f0c40002-0000-0000-0000-000000000001','f0c10001-0000-0000-0000-000000000001','f0c30003-0000-0000-0000-000000000001','f0c20003-0000-0000-0000-000000000001','f0c50001-0000-0000-0000-000000000001',NULL, now()+interval '7 days',80,'c','0600000003');
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte) VALUES
  ('f0c70001-0000-0000-0000-000000000001','f0c60001-0000-0000-0000-000000000001','zero_dechet','programmee','non_envoye',current_date+10,'08:00'),
  ('f0c70002-0000-0000-0000-000000000001','f0c60002-0000-0000-0000-000000000001','zero_dechet','programmee','non_envoye',current_date+5,'09:00'),
  ('f0c70003-0000-0000-0000-000000000001','f0c60003-0000-0000-0000-000000000001','zero_dechet','programmee','non_envoye',current_date+7,'10:00');
INSERT INTO plateforme.bordereaux_savr (id, collecte_id, statut)
  VALUES ('f0c90001-0000-0000-0000-000000000001','f0c70001-0000-0000-0000-000000000001','brouillon');

-- Photos (dernier chiffre de l'id = numéro cité dans les assertions) :
--   1 : collecte A, choisie (rang 1)      2 : collecte A, NON choisie
--   3 : collecte B, choisie (rang 1)      4 : collecte C, choisie (rang 1)
--   5 : collecte A, choisie (rang 2) puis supprimée (deleted_at)
-- et un bordereau de la collecte A (id …9), qui n'est pas une photo.
INSERT INTO shared.fichiers (id, storage_provider, bucket, key, size_bytes, content_type, entity_type, entity_id, rang_client, deleted_at) VALUES
  ('f0c80000-0000-0000-0000-000000000001','r2','savr-test','photos/a-1.jpg',1000,'image/jpeg','plateforme.collectes','f0c70001-0000-0000-0000-000000000001',1,NULL),
  ('f0c80000-0000-0000-0000-000000000002','r2','savr-test','photos/a-2.jpg',1000,'image/jpeg','plateforme.collectes','f0c70001-0000-0000-0000-000000000001',NULL,NULL),
  ('f0c80000-0000-0000-0000-000000000003','r2','savr-test','photos/b-3.jpg',1000,'image/jpeg','plateforme.collectes','f0c70002-0000-0000-0000-000000000001',1,NULL),
  ('f0c80000-0000-0000-0000-000000000004','r2','savr-test','photos/c-4.jpg',1000,'image/jpeg','plateforme.collectes','f0c70003-0000-0000-0000-000000000001',1,NULL),
  ('f0c80000-0000-0000-0000-000000000005','r2','savr-test','photos/a-5.jpg',1000,'image/jpeg','plateforme.collectes','f0c70001-0000-0000-0000-000000000001',2,now()),
  ('f0c80000-0000-0000-0000-000000000009','r2','savr-test','bdr/a.pdf',1000,'application/pdf','plateforme.bordereaux_savr','f0c90001-0000-0000-0000-000000000001',NULL,NULL);

-- ── 1. Lecture par rôle : seules les photos choisies ─────────────────────────
SELECT photo_sel_jwt('traiteur_manager','f0c10001-0000-0000-0000-000000000001');
SELECT is(current_user::text, 'authenticated', '00 les assertions tournent sous le rôle authenticated');
SELECT is(photo_sel_lues(), '1,4',
  '01 traiteur A (manager) : la photo choisie de sa collecte (1) et celle de la collecte où il est opérationnel (4) ; ni la non choisie (2), ni la supprimée (5), ni celle de B (3)');
SELECT is((SELECT count(*)::int FROM shared.fichiers WHERE id = 'f0c80000-0000-0000-0000-000000000009'), 1,
  '02 traiteur A : son bordereau reste lisible (rang_client vide, la règle ne vise que les photos de collecte)');

SELECT photo_sel_jwt('traiteur_commercial','f0c10001-0000-0000-0000-000000000001');
SELECT is(photo_sel_lues(), '1,4', '03 traiteur A (commercial) : mêmes photos choisies, pas la non choisie');

SELECT photo_sel_jwt('traiteur_manager','f0c10002-0000-0000-0000-000000000001');
SELECT is(photo_sel_lues(), '3', '04 traiteur B : sa photo choisie seulement ; rien de A ni de C');

SELECT photo_sel_jwt('agence','f0c10003-0000-0000-0000-000000000001');
SELECT is(photo_sel_lues(), '4', '05 agence : la photo choisie de la collecte qu''elle a programmée (C)');

SELECT photo_sel_jwt('gestionnaire_lieux','f0c10004-0000-0000-0000-000000000001');
SELECT is(photo_sel_lues(), '1', '06 gestionnaire X (lieu A) : la photo choisie (1), pas la non choisie (2)');

SELECT photo_sel_jwt('gestionnaire_lieux','f0c10005-0000-0000-0000-000000000001');
SELECT is(photo_sel_lues(), '3,4', '07 gestionnaire Y (lieu B) : photos choisies de B et C');

SELECT photo_sel_jwt('client_organisateur','f0c10006-0000-0000-0000-000000000001');
SELECT is(photo_sel_lues(), '1', '08 client organisateur Z (événement A) : la photo choisie (1), pas la non choisie (2)');

SELECT photo_sel_jwt('client_organisateur','f0c10007-0000-0000-0000-000000000001');
SELECT is(photo_sel_lues(), '', '09 client organisateur W (aucun événement) : aucune photo');

SELECT photo_sel_jwt('traiteur_manager', NULL);
SELECT is(photo_sel_lues(), '', '10 JWT sans organisation : aucune photo');

SELECT photo_sel_jwt(NULL, NULL);
SELECT is(photo_sel_lues(), '', '11 JWT sans rôle métier : aucune photo');

-- L'équipe Savr lit tout, photos non choisies comprises (c'est elle qui choisit).
SELECT photo_sel_jwt('ops_savr', NULL);
SELECT is(photo_sel_lues(), '1,2,3,4', '12 ops_savr : toutes les photos non supprimées, choisies ou non');
SELECT photo_sel_jwt('admin_savr', NULL);
SELECT is(photo_sel_lues(), '1,2,3,4,5',
  '13 admin_savr : toutes les photos, choisies ou non (et la supprimée : sa policy d''écriture FOR ALL ne filtre pas deleted_at, comportement antérieur à ce lot)');

SELECT photo_sel_anon();
SELECT throws_ok($$SELECT count(*) FROM shared.fichiers$$, '42501', NULL,
  '14 anon : lecture de shared.fichiers refusée');

-- ── 2. Un client ne peut ni choisir ni retirer une photo ─────────────────────
-- À ce stade le rang 2 de la collecte A est libre (la photo 5 est supprimée) :
-- un UPDATE qui passerait la policy réussirait. 0 ligne = c'est la policy qui refuse.
SELECT photo_sel_jwt('traiteur_manager','f0c10001-0000-0000-0000-000000000001');
SELECT results_eq(
  $$WITH u AS (UPDATE shared.fichiers SET rang_client = 2 WHERE id = 'f0c80000-0000-0000-0000-000000000002' RETURNING 1)
    SELECT count(*)::int FROM u$$,
  $$VALUES (0)$$,
  '15 traiteur A : choisir lui-même la photo non choisie de sa collecte = 0 ligne');
SELECT results_eq(
  $$WITH u AS (UPDATE shared.fichiers SET rang_client = NULL WHERE id = 'f0c80000-0000-0000-0000-000000000001' RETURNING 1)
    SELECT count(*)::int FROM u$$,
  $$VALUES (0)$$,
  '16 traiteur A : retirer la photo choisie de sa collecte = 0 ligne');
SELECT throws_ok($$INSERT INTO shared.fichiers (storage_provider, bucket, key, size_bytes, content_type, entity_type, entity_id, rang_client)
  VALUES ('r2','savr-test','photos/x.jpg',1,'image/jpeg','plateforme.collectes','f0c70001-0000-0000-0000-000000000001',2)$$,
  '42501', NULL, '17 traiteur A : ajouter une photo déjà « choisie » sur sa collecte est refusé');

SELECT photo_sel_jwt('gestionnaire_lieux','f0c10004-0000-0000-0000-000000000001');
SELECT results_eq(
  $$WITH u AS (UPDATE shared.fichiers SET rang_client = 2 WHERE id = 'f0c80000-0000-0000-0000-000000000002' RETURNING 1)
    SELECT count(*)::int FROM u$$,
  $$VALUES (0)$$,
  '18 gestionnaire X : choisir une photo = 0 ligne');

SELECT photo_sel_jwt('client_organisateur','f0c10006-0000-0000-0000-000000000001');
SELECT results_eq(
  $$WITH u AS (UPDATE shared.fichiers SET rang_client = 2 WHERE id = 'f0c80000-0000-0000-0000-000000000002' RETURNING 1)
    SELECT count(*)::int FROM u$$,
  $$VALUES (0)$$,
  '19 client organisateur Z : choisir une photo = 0 ligne');

SELECT photo_sel_jwt('agence','f0c10003-0000-0000-0000-000000000001');
SELECT results_eq(
  $$WITH u AS (UPDATE shared.fichiers SET rang_client = NULL WHERE id = 'f0c80000-0000-0000-0000-000000000004' RETURNING 1)
    SELECT count(*)::int FROM u$$,
  $$VALUES (0)$$,
  '20 agence : retirer la photo choisie de sa collecte = 0 ligne');

SELECT photo_sel_su();
SELECT is((SELECT string_agg(coalesce(rang_client::text, '-'), ',' ORDER BY id)
             FROM shared.fichiers WHERE id::text LIKE 'f0c8%'), '1,-,1,1,2,-',
  '21 contrôle : aucun rang n''a bougé après les tentatives des clients');

-- ── 3. Le choix de l'équipe Savr ouvre et referme la lecture ─────────────────
SELECT lives_ok($$UPDATE shared.fichiers SET rang_client = 2
                   WHERE id = 'f0c80000-0000-0000-0000-000000000002'$$,
  '22 équipe Savr : choisir la photo 2 au rang 2 (libéré par la photo supprimée)');
SELECT photo_sel_jwt('traiteur_manager','f0c10001-0000-0000-0000-000000000001');
SELECT is(photo_sel_lues(), '1,2,4', '23 traiteur A : la photo 2, une fois choisie, devient lisible');
SELECT photo_sel_jwt('client_organisateur','f0c10006-0000-0000-0000-000000000001');
SELECT is(photo_sel_lues(), '1,2', '24 client organisateur Z : idem');

SELECT photo_sel_su();
UPDATE shared.fichiers SET rang_client = NULL WHERE id = 'f0c80000-0000-0000-0000-000000000001';
SELECT photo_sel_jwt('traiteur_manager','f0c10001-0000-0000-0000-000000000001');
SELECT is(photo_sel_lues(), '2,4', '25 traiteur A : la photo 1, une fois retirée du choix, redevient invisible');

-- ── 4. Jamais plus de 2 photos choisies par collecte ─────────────────────────
SELECT photo_sel_su();
SELECT throws_ok($$UPDATE shared.fichiers SET rang_client = 2
                    WHERE id = 'f0c80000-0000-0000-0000-000000000001'$$,
  '23505', NULL, '26 deux photos au même rang sur une collecte : refusé par l''index unique');
SELECT throws_ok($$UPDATE shared.fichiers SET rang_client = 3
                    WHERE id = 'f0c80000-0000-0000-0000-000000000001'$$,
  '23514', NULL, '27 un rang 3 n''existe pas : refusé par le CHECK');
SELECT lives_ok($$UPDATE shared.fichiers SET rang_client = 1
                   WHERE id = 'f0c80000-0000-0000-0000-000000000001'$$,
  '28 le rang 1, libre, est accepté : 2 photos choisies sur la collecte A');
SELECT throws_ok($$INSERT INTO shared.fichiers (storage_provider, bucket, key, size_bytes, content_type, entity_type, entity_id, rang_client)
  VALUES ('r2','savr-test','photos/a-6.jpg',1,'image/jpeg','plateforme.collectes','f0c70001-0000-0000-0000-000000000001',1)$$,
  '23505', NULL, '29 une 3e photo choisie sur la collecte A est refusée, quel que soit le rang visé (1)');
SELECT throws_ok($$INSERT INTO shared.fichiers (storage_provider, bucket, key, size_bytes, content_type, entity_type, entity_id, rang_client)
  VALUES ('r2','savr-test','photos/a-7.jpg',1,'image/jpeg','plateforme.collectes','f0c70001-0000-0000-0000-000000000001',2)$$,
  '23505', NULL, '30 … (2)');
SELECT throws_ok($$UPDATE shared.fichiers SET deleted_at = NULL
                    WHERE id = 'f0c80000-0000-0000-0000-000000000005'$$,
  '23505', NULL, '31 restaurer une photo supprimée dont le rang est repris : refusé');
SELECT throws_ok($$UPDATE shared.fichiers SET rang_client = 1
                    WHERE id = 'f0c80000-0000-0000-0000-000000000009'$$,
  '23514', NULL, '32 rang_client sur un fichier qui n''est pas une photo de collecte : refusé par le CHECK');

-- ── 5. État des objets ───────────────────────────────────────────────────────
SELECT ok((SELECT qual LIKE '%rang_client IS NOT NULL%' FROM pg_policies
            WHERE schemaname = 'shared' AND tablename = 'fichiers' AND policyname = 'fichiers_select'),
  '33 la policy fichiers_select exige rang_client pour les photos de collecte');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'shared' AND tablename = 'fichiers'), 2,
  '34 shared.fichiers : exactement 2 policies (fichiers_select, fichiers_admin_write) — aucune autre ne peut rouvrir la lecture');
SELECT is((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'shared.fichiers'::regclass), true,
  '35 shared.fichiers : RLS activée et forcée');

SELECT * FROM finish();
ROLLBACK;

-- =============================================================================
-- SÉCURITÉ — création et suppression PostgREST directes de `plateforme.factures`
-- fermées.
--
-- Migration prouvée : 20260923150000_plateforme_factures_ecriture_client_fermee.
-- Suite de #318 (`collectes`), #328 (`evenements`), #306/#360 (`organisations`)
-- et #373 (`lieux`). CLAUDE.md §12 pt 2bis.
--
-- ⚠ CE FICHIER NE FERME PAS L'UPDATE, ET C'EST VOULU (arbitrage Val 2026-09-22).
-- Le §09 l.415 (matrice étendue `ops_savr`, « source de vérité unique des
-- permissions ops_savr » l.396, vers laquelle l.147 renvoie pour les écritures)
-- accorde à `ops_savr` « Valider + envoyer Pennylane » — capacité PRÉCISE, bornée
-- par l.417 (« Éditer ligne / montant : Non ») et l.418 (« Annuler / Générer
-- avoir : Non »). Ne pas l'élargir en « ops_savr écrit les factures ».
-- Cette frontière tient par DEUX mécanismes : les 2 triggers R10b couvrent
-- « montant » et « Annuler » ; « Éditer ligne » et « Générer avoir » sont fermés
-- par l'absence de policy d'écriture ops (respectivement sur `factures_collectes`
-- et pour l'INSERT sur `factures`) — R10b le dit l.134-135. A3 est donc une
-- assertion POSITIVE
-- — elle interdit la sur-fermeture — et le `lives_ok` de
-- `M0_6__rls_ops_column_level.test.sql` l.103-106 reste vert.
--
-- ⚠ La matrice `factures` (l.211-218) ne comporte AUCUNE ligne `ops_savr` : ne pas
-- la citer pour justifier l'UPDATE (rédaction corrigée en revue sécurité).
--
-- ⚠ RÉSIDUEL ASSUMÉ, épinglé par B7a/B7b et à ne pas minimiser. Les 2 triggers R10b
-- portés par `factures` ne gardent QUE `ops_savr` : leurs deux fonctions sortent
-- si `f_app_role()` n'est pas `ops_savr` (`20260629120000` l.87 et l.147). Sous JWT
-- `admin_savr` — le chemin même que ce fichier démontre atteignable — l'UPDATE
-- direct n'est borné par rien et n'est pas tracé. Mesuré APRÈS le REVOKE :
-- renumérotation d'une facture `emise` → UPDATE 1 ; `numero_facture = NULL` →
-- UPDATE 1 ; `montant_ht = 42` → UPDATE 1 ; `audit_log_2026` → 0 ligne. L'UNIQUE
-- interdit un doublon, pas une renumérotation.
--
-- ⚠ CE QUI ÉTAIT RÉELLEMENT OUVERT. Le chemin qui ABOUTISSAIT est celui
-- d'`admin_savr` : `fac_admin` est `FOR ALL` (`polcmd = '*'`), donc elle couvre
-- INSERT et DELETE malgré l'absence de policy nommément `FOR INSERT`. Mesuré avant
-- la migration, sous rôle `authenticated` avec un JWT staff (transaction
-- rollbackée) : INSERT 0 1 (facture `statut='emise'`, numéro `FAC-HORS-SEQUENCE-999`
-- posé à la main), INSERT 0 1 (facture `emise` SANS numéro), DELETE 1. Sous
-- `ops_savr` et `traiteur_manager`, le DELETE n'échouait pas : il affectait 0 ligne
-- en SILENCE — le gain y est un refus qui se voit.
--
-- ⚠ Tout se joue SOUS RÔLE `authenticated` (test_set_jwt pose `role`) : sous
-- service_role ou superuser, la RLS est bypassée ET les privilèges sont ceux d'un
-- autre rôle — le fichier passerait au vert quoi qu'il arrive. Les refus attendus
-- sont des 42501 levés AVANT l'évaluation RLS : c'est le privilège qui ferme, pas
-- la policy. Discriminant : chaque refus asserte le MESSAGE « permission denied for
-- table factures ». Sans lui, le cas serait complaisant — un `42501` est DÉJÀ levé
-- sur cette table par deux autres chemins : `fn_ops_block_column_change` et
-- `fn_ops_block_facture_annulation` (`20260629120000`, `RAISE … ERRCODE='42501'`),
-- et la RLS elle-même sur l'INSERT d'`ops_savr` (« new row violates row-level
-- security policy for table "factures" », mesuré).
--
-- ⚠ Fixtures RÉELLES et complètes (organisation + entité de facturation + facture
-- valide) : `factures` porte `organisation_id`/`entite_facturation_id` NOT NULL avec
-- FK. Un INSERT hostile bâclé rendrait `23502`/`23503` et ferait conclure à tort
-- « déjà refusé ». Un `23xxx` ici signifierait que la RLS a ADMIS l'écriture.
--
-- CONTRE-ÉPREUVE EXÉCUTÉE (2026-09-22, base jetable : bootstrap Supabase local +
-- les 159 migrations du repo rejouées sur base vierge ; suite entière
-- préalablement verte — 103 fichiers, 1589 assertions, 0 not ok, 0 ERROR).
-- Migration retirée, fichier rejoué : **8 rouges sur 27**, exactement
--   A1 A2 A4  +  B1 B2 B3 B4 B5
-- soit les trois assertions de privilège que le REVOKE rend vraies et les cinq
-- écritures qu'il ferme. Aucune autre. A3, A5, A6, A7, A8, A9, B6, B7a, B7b, B8,
-- B9, B10
-- et tout le bloc C (C1-C7) restent verts : ils portent sur ce que la migration NE
-- change PAS, et leur rôle est d'interdire la sur-fermeture (B7a/B7b épinglent en
-- plus le résiduel assumé). Aucun cas n'est vacant.
--   • A4 rougit parce que `information_schema.column_privileges` reporte aussi le
--     privilège table-level colonne par colonne : sans le REVOKE il rend 32, pas 0.
--   • Avec la migration : 27/27 vert, et la suite entière passe de 1589 à 1616
--     assertions (0 not ok, 0 ERROR) — les 27 de ce fichier, aucun autre déplacé.
--   • `rls_0_4_smoke.test.sql` recalé dans la même PR : T57 rougit lui aussi à la
--     contre-épreuve (1 rouge sur 60), il n'est donc pas vacant non plus.
-- =============================================================================

BEGIN;
SELECT plan(27);

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ── Helpers JWT (cf. SECU__lieux_ecriture_client_fermee) ────────────────────
CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- `service_role` exercé par de VRAIES écritures, jamais par has_table_privilege
-- seul : c'est le chemin des routes API, et la non-régression qui compte.
CREATE OR REPLACE FUNCTION test_as_service_role()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', 'service_role', true);
END $$;

-- ── Fixtures (UUID improbables, pas de collision avec la seed) ──────────────
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal) VALUES
  ('fac10000-0000-0000-0000-000000000001'::uuid, 'Traiteur FACT', 'traiteur', true, false, 'FAC10000000001', 'fact-t@test.internal');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('fac10000-0000-0000-0000-0000000000a1'::uuid, 'fac10000-0000-0000-0000-000000000001'::uuid, 'mgr@fact.test', 'Mgr', 'Fact', 'traiteur_manager');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('fac1ef00-0000-0000-0000-000000000001'::uuid, 'fac10000-0000-0000-0000-000000000001'::uuid, 'FACT SA', '11111111100099', '1 rue', '75001', 'Paris');

-- f1 : la cible des UPDATE et de la lecture. f2 : la cible du DELETE (B3), pour que
-- l'échec attendu ne puisse jamais être imputé à une FK entrante.
-- f3 : cible dédiée de B7a/B7b, le seul bloc qui MUTE une facture. La confiner ici
-- évite que f1 sorte du fichier avec un `numero_facture` qui ne correspond plus à sa
-- fixture — piège classique pour l'auteur suivant, qui retrouverait f1 par son numéro
-- d'origine et obtiendrait 0 ligne (famille « fixture complaisante »). Relevé en revue
-- sécurité. Elle est `emise` : c'est une facture déjà numérotée qu'on renumérote.
INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, numero_facture, montant_ht, montant_tva, montant_ttc, statut) VALUES
  ('fac1a000-0000-0000-0000-000000000001'::uuid, 'fac10000-0000-0000-0000-000000000001'::uuid, 'fac1ef00-0000-0000-0000-000000000001'::uuid, 'FAC-SECU-001', 100.00, 20.00, 120.00, 'brouillon'),
  ('fac1a000-0000-0000-0000-000000000002'::uuid, 'fac10000-0000-0000-0000-000000000001'::uuid, 'fac1ef00-0000-0000-0000-000000000001'::uuid, 'FAC-SECU-002', 100.00, 20.00, 120.00, 'brouillon'),
  ('fac1a000-0000-0000-0000-000000000004'::uuid, 'fac10000-0000-0000-0000-000000000001'::uuid, 'fac1ef00-0000-0000-0000-000000000001'::uuid, 'FAC-SECU-004', 100.00, 20.00, 120.00, 'emise');

-- =============================================================================
-- A. PRIVILÈGES — le GRANT table-level 0.4a est amputé de l'INSERT et du DELETE,
--    et de RIEN d'autre
-- =============================================================================
SELECT test_as_superuser();

SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.factures', 'INSERT'),
  'A1 authenticated n''a plus INSERT table-level sur factures'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.factures', 'DELETE'),
  'A2 authenticated n''a plus DELETE table-level sur factures'
);

-- A3 NON-RÉGRESSION — assertion POSITIVE, volontairement à contre-courant de la
-- série. L'UPDATE reste accordé (arbitrage Val 2026-09-22) : le §09 l.415
-- (matrice étendue `ops_savr`) donne à `ops_savr` « Valider + envoyer Pennylane »,
-- capacité bornée par l.417-418. Si un lot futur ferme l'UPDATE, ce cas rougira —
-- et ce sera le signal qu'il faut relire l'arbitrage, pas le contourner.
SELECT ok(
  has_table_privilege('authenticated', 'plateforme.factures', 'UPDATE'),
  'A3 non-regression : UPDATE table-level CONSERVE (arbitrage Val, capacite ops_savr §09)'
);

-- A4 cliquet : interdit de ré-ouvrir par la porte colonne-level. Un
-- `GRANT INSERT (montant_ht)` laisserait A1 vrai tout en ré-autorisant la création
-- directe que ce fichier ferme.
--
-- ⚠ Le cliquet ne porte que sur INSERT, et ce n'est pas un oubli : PostgreSQL ne
-- connaît de privilèges colonne-level que pour SELECT, INSERT, UPDATE et
-- REFERENCES. Il n'existe AUCUN `GRANT DELETE (colonne)` — le DELETE est
-- nécessairement table-level, donc A2 suffit à le verrouiller, et une première
-- rédaction qui ajoutait 'DELETE' ici faisait lever
-- « unrecognized privilege type » à has_any_column_privilege (mesuré).
-- 'UPDATE' est exclu pour une autre raison : l'UPDATE reste ouvert (A3), un GRANT
-- colonne légitime ferait donc rougir le cliquet à tort.
SELECT is(
  (SELECT count(*)::int FROM information_schema.column_privileges
    WHERE grantee = 'authenticated'
      AND table_schema = 'plateforme' AND table_name = 'factures'
      AND privilege_type = 'INSERT'),
  0,
  'A4 aucun GRANT colonne-level INSERT residuel sur factures (DELETE n''existe pas en colonne-level)'
);

-- A5 NON-RÉGRESSION — le SELECT est hors périmètre. Il avait été retiré au niveau
-- table par 20260616120000 l.386 puis ré-accordé sur une liste blanche de colonnes
-- (masquage de marge_logistique, erreur_synchro, erreur_synchro_at,
-- derniere_tentative_pennylane_at, pennylane_statut, pennylane_push_at). Ce lot ne
-- doit ni l'élargir ni le réduire — le compte exact est le cliquet des deux côtés.
-- Le 26 est MESURÉ sur le catalogue (base jetable, 2026-09-22), pas déduit du
-- source de la migration.
SELECT is(
  (SELECT count(*)::int FROM information_schema.column_privileges
    WHERE grantee = 'authenticated'
      AND table_schema = 'plateforme' AND table_name = 'factures'
      AND privilege_type = 'SELECT'),
  26,
  'A5 non-regression : liste blanche SELECT de 20260616120000 intacte (26 colonnes)'
);

-- A6 NON-RÉGRESSION : les routes et les crons écrivent sous service_role.
SELECT ok(
  has_table_privilege('service_role', 'plateforme.factures', 'SELECT')
  AND has_table_privilege('service_role', 'plateforme.factures', 'INSERT')
  AND has_table_privilege('service_role', 'plateforme.factures', 'UPDATE')
  AND has_table_privilege('service_role', 'plateforme.factures', 'DELETE'),
  'A6 service_role conserve SELECT + INSERT + UPDATE + DELETE (les routes ecrivent toujours)'
);

-- A7 cliquet d'arbitrage : les policies sont CONSERVÉES (même décision qu'en #318,
-- #328 et #373) — `fac_admin` est bien `FOR ALL` (polcmd = '*'), c'est elle qui
-- rendait le GRANT atteignable, et la retirer serait une seconde décision.
-- `fac_ops_update` reste pleinement ACTIVE, l'UPDATE n'étant pas révoqué.
-- Compte TOTAL, pas `polname IN (…)` : un filtre par nom détecte une suppression
-- mais pas un AJOUT de policy — strictement plus faible (relevé en revue sécurité).
SELECT is(
  (SELECT count(*)::int FROM pg_policy
    WHERE polrelid = 'plateforme.factures'::regclass),
  4,
  'A7 exactement 4 policies sur factures : aucune retiree, aucune ajoutee'
);

SELECT ok(
  (SELECT polcmd FROM pg_policy
    WHERE polrelid = 'plateforme.factures'::regclass AND polname = 'fac_admin') = '*',
  'A8 fac_admin est bien FOR ALL (polcmd=*) — le GRANT n''etait donc PAS inerte'
);

SELECT ok(
  NOT has_table_privilege('anon', 'plateforme.factures', 'INSERT')
  AND NOT has_table_privilege('anon', 'plateforme.factures', 'DELETE')
  AND NOT has_any_column_privilege('anon', 'plateforme.factures', 'INSERT'),
  'A9 anon ne detient ni creation ni suppression sur factures (ni table, ni colonne)'
);

-- =============================================================================
-- B. FERMETURE SOUS RÔLE — le POST/DELETE PostgREST direct est refusé
-- =============================================================================
-- B1-B3 rejouent EXACTEMENT les trois écritures qui ABOUTISSAIENT avant la
-- migration. Leur policy les autorise toujours : le 42501 prouve que c'est le
-- privilège qui ferme.

SELECT test_set_jwt('admin_savr', NULL, 'fac10000-0000-0000-0000-0000000000a1'::uuid);

-- B1 la création hors séquence : le numéro posé à la main, sans passer par
-- f_attribuer_numero_facture, et en statut `emise`. C'est le cas qui casse la
-- numérotation gapless fiscale.
SELECT throws_ok(
  $$INSERT INTO plateforme.factures (organisation_id, entite_facturation_id, numero_facture, montant_ht, montant_tva, montant_ttc, statut)
    VALUES ('fac10000-0000-0000-0000-000000000001'::uuid, 'fac1ef00-0000-0000-0000-000000000001'::uuid,
            'FAC-HORS-SEQUENCE-999', 1.00, 0.20, 1.20, 'emise')$$,
  '42501', 'permission denied for table factures',
  'B1 admin_savr : INSERT direct refuse (42501) malgre fac_admin FOR ALL — numero hors sequence'
);

-- B2 la même création, SANS numéro du tout. `numero_facture` est NULLABLE depuis
-- 20260615000100 l.74 : contrairement à ce qu'affirmait le relevé d'origine, rien
-- n'empêchait une facture `emise` sans numéro par le chemin direct (mesuré).
SELECT throws_ok(
  $$INSERT INTO plateforme.factures (organisation_id, entite_facturation_id, montant_ht, montant_tva, montant_ttc, statut)
    VALUES ('fac10000-0000-0000-0000-000000000001'::uuid, 'fac1ef00-0000-0000-0000-000000000001'::uuid,
            5.00, 1.00, 6.00, 'emise')$$,
  '42501', 'permission denied for table factures',
  'B2 admin_savr : INSERT direct d''une facture emise SANS numero refuse (42501)'
);

-- B3 sur f2, qu'aucune FK entrante ne retient : sans le REVOKE, la suppression
-- aboutissait pour de bon — alors que le §09 l.213 (matrice `factures`, l.211-218) pose
-- `admin_savr | DELETE | — (pas de suppression, uniquement avoirs)`.
SELECT throws_ok(
  $$DELETE FROM plateforme.factures WHERE id = 'fac1a000-0000-0000-0000-000000000002'::uuid$$,
  '42501', 'permission denied for table factures',
  'B3 admin_savr : DELETE direct refuse (42501) — le §09 l.213 devient vrai par construction'
);

-- B4-B5 défense en profondeur. Avant la migration, ces deux DELETE n'échouaient
-- pas : ils affectaient 0 ligne en silence (aucune policy DELETE applicable). Le
-- passage à un 42501 franc est le gain — un refus qui se voit, au lieu d'un no-op
-- qu'un appelant peut confondre avec un succès. C'est ce que recale T57 de
-- rls_0_4_smoke.test.sql, dont l'oracle était précisément « 0 ligne ».
SELECT test_set_jwt('ops_savr', NULL, 'fac10000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$DELETE FROM plateforme.factures WHERE id = 'fac1a000-0000-0000-0000-000000000001'::uuid$$,
  '42501', 'permission denied for table factures',
  'B4 ops_savr : DELETE direct refuse (42501) — plus de no-op silencieux (recalage T57)'
);

SELECT test_set_jwt('traiteur_manager', 'fac10000-0000-0000-0000-000000000001'::uuid, 'fac10000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$DELETE FROM plateforme.factures WHERE id = 'fac1a000-0000-0000-0000-000000000001'::uuid$$,
  '42501', 'permission denied for table factures',
  'B5 traiteur_manager : DELETE direct refuse (42501) — plus de no-op silencieux'
);

-- ── Non-régression de l'ÉCRITURE CONSERVÉE : pas de sur-fermeture ───────────
-- B6 l'UPDATE d'`ops_savr` sur une colonne non-montant reste possible. C'est le
-- pendant de A3, mesuré par une VRAIE écriture : c'est exactement l'assertion
-- `lives_ok` de M0_6__rls_ops_column_level.test.sql l.103-106, rejouée ici pour
-- que la preuve de l'arbitrage Val vive dans le fichier du lot qui l'applique.
SELECT test_set_jwt('ops_savr', NULL, 'fac10000-0000-0000-0000-0000000000a1'::uuid);
SELECT lives_ok(
  $$UPDATE plateforme.factures SET devise = 'USD' WHERE id = 'fac1a000-0000-0000-0000-000000000001'::uuid$$,
  'B6 non-regression : ops_savr modifie toujours une colonne non-montant (UPDATE conserve)'
);

-- ── Le RÉSIDUEL, épinglé plutôt que passé sous silence ─────────────────────
-- B7a/B7b sous `admin_savr`, l'UPDATE direct reste possible ET non borné : aucun
-- des 2 triggers R10b ne mord (tous deux sortent si f_app_role() <> 'ops_savr'),
-- donc même `numero_facture` est mutable — la contrainte UNIQUE interdit un
-- doublon, pas une renumérotation. C'est le résiduel ASSUMÉ de l'arbitrage Val :
-- ces cas ne l'approuvent pas, ils le rendent VISIBLE et le datent. Le jour où le
-- lot dédié fermera l'UPDATE, ils rougiront — c'est le signal attendu, pas un bug.
--
-- ⚠ DEUX assertions, et non un `lives_ok` seul : `lives_ok` est vert aussi bien
-- quand l'UPDATE aboutit que quand il affecte 0 ligne sans lever d'erreur — la
-- confusion même que B4/B5 et le recalage de T57 abolissent. Si un lot futur
-- fermait l'UPDATE côté RLS (restriction ou retrait de `fac_admin`) plutôt qu'au
-- privilège, l'écriture deviendrait un no-op muet : `lives_ok` resterait vert, et
-- A3 aussi puisqu'il ne lit que le privilège. B7b est l'oracle d'EFFET qui couvre
-- ce second mode de fermeture (relevé en revue sécurité).
SELECT test_set_jwt('admin_savr', NULL, 'fac10000-0000-0000-0000-0000000000a1'::uuid);
SELECT lives_ok(
  $$UPDATE plateforme.factures SET numero_facture = 'FAC-RENUMEROTEE-000'
     WHERE id = 'fac1a000-0000-0000-0000-000000000004'::uuid$$,
  'B7a residuel ASSUME : admin_savr renumerote encore une facture emise en direct (aucune erreur levee)'
);
SELECT is(
  (SELECT numero_facture FROM plateforme.factures
    WHERE id = 'fac1a000-0000-0000-0000-000000000004'::uuid),
  'FAC-RENUMEROTEE-000',
  'B7b residuel ASSUME : la renumerotation a REELLEMENT eu lieu (oracle d''effet, pas un no-op)'
);

-- ── Non-régression de la LECTURE : la fermeture ne doit pas sur-fermer ──────
-- B8 le client lit toujours ses factures par les 26 colonnes de la liste blanche
-- (c'est le chemin des 5 lectures applicatives : traiteur, agence, gestionnaire,
-- page agence, export CSV).
SELECT test_set_jwt('traiteur_manager', 'fac10000-0000-0000-0000-000000000001'::uuid, 'fac10000-0000-0000-0000-0000000000a1'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.factures
    WHERE id = 'fac1a000-0000-0000-0000-000000000001'::uuid),
  1,
  'B8 non-regression : traiteur_manager lit toujours sa facture (fac_client_select intacte)'
);

-- B9 la vue whitelist prescrite par le §09 l.220 reste exploitable elle aussi.
-- Le CDC prescrit ce canal ; le code lit la table en direct (divergence déposée).
-- La non-régression se mesure donc sur LES DEUX.
SELECT lives_ok(
  $$SELECT count(*) FROM plateforme.v_factures_client
     WHERE id = 'fac1a000-0000-0000-0000-000000000001'::uuid$$,
  'B9 non-regression : v_factures_client (vue whitelist §09 l.220) toujours lisible'
);

-- B10 et la colonne sensible reste masquée : le REVOKE d'écriture n'a pas déplacé
-- la frontière de lecture posée par 20260616120000.
-- Message asserté comme partout ailleurs dans ce fichier : un `NULL` ici serait
-- une exception non justifiée à sa propre doctrine (relevé en revue sécurité).
-- Mesuré : PostgreSQL rend « permission denied for table factures », pas
-- « … for column marge_logistique ».
SELECT throws_ok(
  $$SELECT marge_logistique FROM plateforme.factures
     WHERE id = 'fac1a000-0000-0000-0000-000000000001'::uuid$$,
  '42501', 'permission denied for table factures',
  'B10 non-regression : marge_logistique toujours masquee a authenticated'
);

-- =============================================================================
-- C. LE CANAL LÉGITIME reste ouvert, et le MOTIF de la fermeture est établi
-- =============================================================================
-- Sans ce bloc, une migration qui fermerait `factures` à TOUT LE MONDE passerait
-- A1-A2 et B1-B5 au vert tout en cassant la facturation en production.
SELECT test_as_service_role();

SELECT lives_ok(
  $$INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, numero_facture, montant_ht, montant_tva, montant_ttc, statut)
    VALUES ('fac1a000-0000-0000-0000-000000000003'::uuid, 'fac10000-0000-0000-0000-000000000001'::uuid,
            'fac1ef00-0000-0000-0000-000000000001'::uuid, 'FAC-SECU-003', 10.00, 2.00, 12.00, 'brouillon')$$,
  'C1 non-vacuite : service_role INSERT toujours (routes admin + cron batch-brouillons-j1)'
);

SELECT lives_ok(
  $$UPDATE plateforme.factures SET notes = 'maj par la route'
     WHERE id = 'fac1a000-0000-0000-0000-000000000003'::uuid$$,
  'C2 non-vacuite : service_role UPDATE toujours (PATCH /api/v1/admin/factures/[id])'
);

SELECT lives_ok(
  $$DELETE FROM plateforme.factures WHERE id = 'fac1a000-0000-0000-0000-000000000003'::uuid$$,
  'C3 non-vacuite : service_role DELETE toujours (aucun ecran ne casse)'
);

-- C4 le canal de numérotation lui-même : `f_attribuer_numero_facture` est
-- SECURITY DEFINER et consomme `sequences_facturation`. C'est LE chemin que
-- l'INSERT direct de B1 contournait. Il doit rester fonctionnel.
SELECT is(
  plateforme.f_attribuer_numero_facture('FZD'::text, 2098::smallint),
  'FZD-2098-00001',
  'C4 non-vacuite : f_attribuer_numero_facture (sequence gapless) fonctionne toujours'
);

-- ── Le motif : aucune trace d'audit n'est posée PAR LA BASE ─────────────────
SELECT test_as_superuser();

-- C5 `factures` ne porte aucun trigger d'audit : l'`audit_log` est écrit par les
-- routes (`lib/facturation/numerotation.ts`, `edition-facture.ts`,
-- `validation-admin.ts`, `admin/factures/[id]/avoir/route.ts`) et par elles seules.
-- C'est ce qui rend l'écriture directe silencieuse — et c'est le motif de la
-- fermeture. Si un trigger d'audit était ajouté un jour, ce cas rougirait et le
-- motif serait à relire. Le filtre sur `tgrelid` est indispensable :
-- `trg_ops_immutable_cols` existe AUSSI sur `associations` et `organisations`.
SELECT is(
  (SELECT count(*)::int FROM pg_trigger
    WHERE tgrelid = 'plateforme.factures'::regclass AND NOT tgisinternal
      AND tgname NOT IN ('trg_check_avoir_facture_valide', 'trg_avoir_annule_origine',
                         'trg_ops_immutable_cols', 'trg_ops_block_facture_annulation')),
  0,
  'C5 motif : aucun trigger d''audit sur factures — l''audit_log est porte par les routes'
);

-- C6 le corollaire, mesuré en DELTA (jamais en valeur absolue : un compte absolu
-- ferait dépendre ce cas de l'issue de C2, et la contre-épreuve le ferait rougir
-- pour une raison qui n'est pas la sienne). Une écriture qui ne passe pas par une
-- route ne laisse AUCUNE ligne d'audit.
CREATE TEMP TABLE _c6_avant AS
SELECT (SELECT count(*)::int FROM plateforme.audit_log_2026
         WHERE record_id = 'fac1a000-0000-0000-0000-000000000001'::uuid) AS audit;

UPDATE plateforme.factures SET notes = 'posee en direct'
 WHERE id = 'fac1a000-0000-0000-0000-000000000001'::uuid;

SELECT is(
  (SELECT count(*)::int FROM plateforme.audit_log_2026
    WHERE record_id = 'fac1a000-0000-0000-0000-000000000001'::uuid)
    - (SELECT audit FROM _c6_avant),
  0,
  'C6 motif : une ecriture directe n''ecrit aucun audit_log (la trace est route-only)'
);

-- C7 la contrainte qui tient toute seule, et qu'il ne faut PAS sur-vendre : le
-- chemin direct ne pouvait pas produire de DOUBLON de numéro. Ce cas fixe la
-- frontière du motif — si `factures_numero_facture_key` disparaissait, le motif
-- de la migration devrait être réécrit, pas élargi en silence.
SELECT col_is_unique('plateforme', 'factures', 'numero_facture',
  'C7 frontiere du motif : numero_facture reste UNIQUE (aucun doublon possible, quel que soit le canal)');

SELECT * FROM finish();
ROLLBACK;

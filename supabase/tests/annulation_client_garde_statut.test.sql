-- pgTAP — Annulation d'une collecte par un client : le statut se vérifie sous le
-- verrou (fn_annuler_collecte_client, migration 20261101140000).
--
-- La route cliente lit le statut sans verrou puis appelle la RPC. Si la relève
-- MTS-1 a fait passer la collecte en cours (ou au-delà) entre les deux, la RPC
-- refuse : la collecte garde son statut, aucun ordre d'annulation (E3) n'entre
-- dans la file, le pack AG n'est pas débité. Depuis un statut annulable, elle
-- annule comme avant (E3 émis, débit d'annulation tardive). Seul le rôle de
-- service peut l'appeler.

BEGIN;
SELECT plan(22);

-- ── Fixtures (identifiants improbables) ──────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
  ('ac100000-0000-0000-0000-000000000001', 'Org Annulation Client', 'Org Annulation Client', 'traiteur', '98765432109821', true);
INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('ac100000-0000-0000-0000-000000000009', 'ANNUL_CLIENT_TEST', 'Annulation client Test', 1, true);
INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max)
VALUES ('ac100000-0000-0000-0000-000000000002', 'Salle Annulation Client', '1 rue Test', 'Paris', '75001', 'camionnette');
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('ac100000-0000-0000-0000-000000000010', 'ac100000-0000-0000-0000-000000000001',
  'traiteur@test-annulation-client.test', 'Traiteur', 'Test', 'traiteur_manager');
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('ac100000-0000-0000-0000-000000000011', 'ac100000-0000-0000-0000-000000000001',
  'Org Annulation Client SARL', '98765432109821', '1 rue Test', '75001', 'Paris');
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  'ac100000-0000-0000-0000-000000000003', 'ac100000-0000-0000-0000-000000000001',
  'ac100000-0000-0000-0000-000000000001', 'ac100000-0000-0000-0000-000000000011',
  'ac100000-0000-0000-0000-000000000010', 'ac100000-0000-0000-0000-000000000002',
  'ac100000-0000-0000-0000-000000000009', CURRENT_DATE, 200, 'Contact Test', '0600000001'
);
-- Pack actif : un débit d'annulation tardive s'y verrait.
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, type_pack, credits_initiaux, credits_consommes, montant_total_ht, mode_facturation, statut, date_achat)
VALUES ('ac100000-0000-0000-0000-0000000000a1', 'ac100000-0000-0000-0000-000000000001',
  'personnalise', 5, 0, 2500, 'par_collecte', 'actif', CURRENT_DATE);

-- Collectes AG, créneau dans une heure (heure de Paris) : toute annulation
-- maintenant est tardive (< 4 h) et débiterait le pack.
--   c1 : programmée, la relève la fait passer en cours (cas de la revue)
--   c2 : validée, la relève la fait passer en cours
--   c3, c5, c6 : statuts que le client ne peut plus annuler
--   c7 : programmée, le statut ne bouge pas (annulation légitime)
--   c8 : brouillon
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte, nb_camions_demande, statut_tms)
SELECT ('ac100000-0000-0000-0000-0000000000' || suffixe)::uuid, 'ac100000-0000-0000-0000-000000000003',
       'anti_gaspi', 'programmee',
       ((now() + interval '1 hour') AT TIME ZONE 'Europe/Paris')::date,
       ((now() + interval '1 hour') AT TIME ZONE 'Europe/Paris')::time,
       1, 'acceptee'
  FROM (VALUES ('c1'), ('c2'), ('c3'), ('c5'), ('c6'), ('c7'), ('c8')) AS v(suffixe);

-- Statuts posés comme les poserait la relève, par UPDATE direct.
UPDATE plateforme.collectes SET statut = 'validee'
 WHERE id IN ('ac100000-0000-0000-0000-0000000000c2', 'ac100000-0000-0000-0000-0000000000c3');
UPDATE plateforme.collectes SET statut = 'brouillon', statut_tms = 'non_envoye'
 WHERE id = 'ac100000-0000-0000-0000-0000000000c8';

-- ── 1. Droits : seul le rôle de service appelle la RPC ───────────────────────
SELECT ok(NOT has_function_privilege('authenticated', 'plateforme.fn_annuler_collecte_client(uuid, text)', 'EXECUTE'),
  'authenticated ne peut pas exécuter fn_annuler_collecte_client');
SELECT ok(NOT has_function_privilege('anon', 'plateforme.fn_annuler_collecte_client(uuid, text)', 'EXECUTE'),
  'anon ne peut pas exécuter fn_annuler_collecte_client');
SELECT ok(NOT has_function_privilege('public', 'plateforme.fn_annuler_collecte_client(uuid, text)', 'EXECUTE'),
  'PUBLIC ne peut pas exécuter fn_annuler_collecte_client');
SELECT ok(has_function_privilege('service_role', 'plateforme.fn_annuler_collecte_client(uuid, text)', 'EXECUTE'),
  'service_role peut exécuter fn_annuler_collecte_client');

-- ── 2. Le cas de la revue : lue programmée, passée en cours avant l'écriture ──
-- La route a lu « programmee » ; la relève écrit « en_cours » ; la route appelle.
UPDATE plateforme.collectes SET statut = 'en_cours'
 WHERE id IN ('ac100000-0000-0000-0000-0000000000c1', 'ac100000-0000-0000-0000-0000000000c2');

SELECT throws_like(
  $$ SELECT plateforme.fn_annuler_collecte_client('ac100000-0000-0000-0000-0000000000c1', 'trop tard') $$,
  'ANNULATION_CLIENT_STATUT%',
  'c1 (lue programmée, passée en cours) : refus ANNULATION_CLIENT_STATUT');
SELECT is((SELECT statut::text FROM plateforme.collectes WHERE id = 'ac100000-0000-0000-0000-0000000000c1'),
  'en_cours', 'c1 : reste en cours, pas écrasée par l''annulation');
SELECT is((SELECT count(*)::int FROM plateforme.outbox_events
            WHERE aggregate_id = 'ac100000-0000-0000-0000-0000000000c1' AND event_type = 'collecte.annulee'),
  0, 'c1 : aucun ordre d''annulation (E3) dans la file');
SELECT is((SELECT annulee_cote_savr_motif FROM plateforme.collectes WHERE id = 'ac100000-0000-0000-0000-0000000000c1'),
  NULL, 'c1 : motif non écrit');

SELECT throws_like(
  $$ SELECT plateforme.fn_annuler_collecte_client('ac100000-0000-0000-0000-0000000000c2', 'trop tard') $$,
  'ANNULATION_CLIENT_STATUT%',
  'c2 (lue validée, passée en cours) : refus');
SELECT is((SELECT count(*)::int FROM plateforme.outbox_events
            WHERE aggregate_id = 'ac100000-0000-0000-0000-0000000000c2' AND event_type = 'collecte.annulee'),
  0, 'c2 : aucun E3');

SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'ac100000-0000-0000-0000-0000000000a1'),
  0, 'c1, c2 : annulation tardive refusée, pack non débité');

-- ── 3. Statuts terminaux ou déjà annulés : refus ─────────────────────────────
UPDATE plateforme.collectes SET statut = 'en_cours' WHERE id = 'ac100000-0000-0000-0000-0000000000c3';
UPDATE plateforme.collectes SET statut = 'realisee' WHERE id = 'ac100000-0000-0000-0000-0000000000c3';
UPDATE plateforme.collectes SET statut = 'annulee' WHERE id = 'ac100000-0000-0000-0000-0000000000c5';
UPDATE plateforme.collectes SET statut = 'annulation_demandee' WHERE id = 'ac100000-0000-0000-0000-0000000000c6';
-- Remet le pack à zéro : l'annulation de c5 ci-dessus (UPDATE direct) a pu débiter.
UPDATE plateforme.packs_antgaspi SET credits_consommes = 0, statut = 'actif'
 WHERE id = 'ac100000-0000-0000-0000-0000000000a1';
DELETE FROM plateforme.outbox_events
 WHERE aggregate_id IN ('ac100000-0000-0000-0000-0000000000c5', 'ac100000-0000-0000-0000-0000000000c6');

SELECT throws_like(
  $$ SELECT plateforme.fn_annuler_collecte_client('ac100000-0000-0000-0000-0000000000c3', 'x') $$,
  'ANNULATION_CLIENT_STATUT%', 'c3 réalisée : refus');
SELECT is((SELECT statut::text FROM plateforme.collectes WHERE id = 'ac100000-0000-0000-0000-0000000000c3'),
  'realisee', 'c3 : reste réalisée');
SELECT throws_like(
  $$ SELECT plateforme.fn_annuler_collecte_client('ac100000-0000-0000-0000-0000000000c5', 'x') $$,
  'ANNULATION_CLIENT_STATUT%', 'c5 déjà annulée : refus (pas de second E3)');
SELECT throws_like(
  $$ SELECT plateforme.fn_annuler_collecte_client('ac100000-0000-0000-0000-0000000000c6', 'x') $$,
  'ANNULATION_CLIENT_STATUT%', 'c6 annulation demandée : refus');
SELECT is((SELECT count(*)::int FROM plateforme.outbox_events
            WHERE aggregate_id IN ('ac100000-0000-0000-0000-0000000000c3',
                                   'ac100000-0000-0000-0000-0000000000c5',
                                   'ac100000-0000-0000-0000-0000000000c6')
              AND event_type = 'collecte.annulee'),
  0, 'c3, c5, c6 : aucun E3');

-- ── 4. Collecte inconnue ─────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT plateforme.fn_annuler_collecte_client('ac100000-0000-0000-0000-0000000000ff', 'x') $$,
  'P0002', NULL, 'collecte inconnue : P0002');

-- ── 5. Statut encore annulable : l'annulation aboutit comme avant ────────────
SELECT lives_ok(
  $$ SELECT plateforme.fn_annuler_collecte_client('ac100000-0000-0000-0000-0000000000c7', 'événement annulé') $$,
  'c7 programmée : annulation acceptée');
SELECT is((SELECT statut::text || '|' || annulee_cote_savr_motif FROM plateforme.collectes
            WHERE id = 'ac100000-0000-0000-0000-0000000000c7'),
  'annulee|événement annulé', 'c7 : annulée, motif écrit');
SELECT is((SELECT count(*)::int FROM plateforme.outbox_events
            WHERE aggregate_id = 'ac100000-0000-0000-0000-0000000000c7' AND event_type = 'collecte.annulee'),
  1, 'c7 : un E3 dans la file');
SELECT is((SELECT credits_consommes FROM plateforme.packs_antgaspi WHERE id = 'ac100000-0000-0000-0000-0000000000a1'),
  1, 'c7 : annulation tardive, un crédit débité');

SELECT lives_ok(
  $$ SELECT plateforme.fn_annuler_collecte_client('ac100000-0000-0000-0000-0000000000c8', '') $$,
  'c8 brouillon : annulation acceptée');

SELECT * FROM finish();
ROLLBACK;

-- pgTAP M4.2 — Registre réglementaire ZD (§06.03)
-- Couvre les scénarios DB (test-scenarios §06.03) :
--   périmètre vue (cloturee + ZD only : realisee/AG/annulee exclues), poids total
--   agrégé, isolation RLS (6 rôles + traiteur opérationnel + exclusion agence F6 +
--   cross-org), exports_registre self-only + INSERT usurpé/org étrangère deny,
--   bordereaux append-only (DELETE deny tous rôles, UPDATE manager deny, URL
--   directe hors périmètre deny), flag historique_partiel non modifiable client.
-- Rôle métier lu via user_role (f_app_role) — test_set_jwt pose le claim.

BEGIN;
SELECT plan(24);

-- ── Helpers JWT (identiques aux autres tests RLS) ───────────────────────────
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

-- ── Fixtures (superuser) ────────────────────────────────────────────────────
SELECT test_as_superuser();

-- Organisations : 2 traiteurs, 1 agence, 1 gestionnaire, 1 client organisateur
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, actif) VALUES
  ('42000000-0000-0000-0000-000000000001'::uuid, 'Kaspia',    'Kaspia SARL',    'traiteur',            true),
  ('42000000-0000-0000-0000-000000000002'::uuid, 'Kardamome', 'Kardamome SARL', 'traiteur',            true),
  ('42000000-0000-0000-0000-000000000003'::uuid, 'Magnifik',  'Magnifik SAS',   'agence',              true),
  ('42000000-0000-0000-0000-000000000004'::uuid, 'Viparis',   'Viparis SA',     'gestionnaire_lieux',  true),
  ('42000000-0000-0000-0000-000000000005'::uuid, 'EventCo',   'EventCo SAS',    'client_organisateur', true);

-- Users (1 par rôle)
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('42010000-0000-0000-0000-000000000001'::uuid, '42000000-0000-0000-0000-000000000001'::uuid, 'mgr@kaspia.test',  'M', 'K', 'traiteur_manager'),
  ('42010000-0000-0000-0000-000000000002'::uuid, '42000000-0000-0000-0000-000000000001'::uuid, 'com@kaspia.test',  'C', 'K', 'traiteur_commercial'),
  ('42010000-0000-0000-0000-000000000003'::uuid, '42000000-0000-0000-0000-000000000002'::uuid, 'mgr@kardam.test',  'M', 'D', 'traiteur_manager'),
  ('42010000-0000-0000-0000-000000000004'::uuid, '42000000-0000-0000-0000-000000000003'::uuid, 'ag@magnifik.test', 'A', 'M', 'agence'),
  ('42010000-0000-0000-0000-000000000005'::uuid, '42000000-0000-0000-0000-000000000004'::uuid, 'g@viparis.test',   'G', 'V', 'gestionnaire_lieux'),
  ('42010000-0000-0000-0000-000000000006'::uuid, '42000000-0000-0000-0000-000000000005'::uuid, 'cli@eventco.test', 'O', 'E', 'client_organisateur'),
  -- admin_savr : users.organisation_id est NOT NULL → org de rattachement
  -- factice (Kaspia). Sans effet sur la RLS staff (role, pas org) ; le JWT admin
  -- est posé avec organisation_id = NULL par test_set_jwt.
  ('42010000-0000-0000-0000-000000000007'::uuid, '42000000-0000-0000-0000-000000000001'::uuid, 'admin@savr.test',  'A', 'S', 'admin_savr');

-- Entités de facturation (evenements.entite_facturation_id NOT NULL)
INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('42020000-0000-0000-0000-000000000001'::uuid, '42000000-0000-0000-0000-000000000001'::uuid, 'Kaspia SARL',    '11111111100011', '1 rue K', '75001', 'Paris'),
  ('42020000-0000-0000-0000-000000000002'::uuid, '42000000-0000-0000-0000-000000000002'::uuid, 'Kardamome SARL', '22222222200022', '2 rue D', '75002', 'Paris'),
  ('42020000-0000-0000-0000-000000000003'::uuid, '42000000-0000-0000-0000-000000000003'::uuid, 'Magnifik SAS',   '33333333300033', '3 rue M', '75003', 'Paris');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('42030000-0000-0000-0000-000000000001'::uuid, 'GALA_M42', 'Gala M4.2', 1, true);

INSERT INTO shared.prestataires (id, nom, code)
VALUES ('42040000-0000-0000-0000-000000000001'::uuid, 'Strike', 'STRIKE_M42');

-- Lieux : lieu1 (associé Viparis), lieu2 (non associé)
INSERT INTO plateforme.lieux
  (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region) VALUES
  ('42050000-0000-0000-0000-000000000001'::uuid, 'Pavillon Cambon', '5 rue Cambon', '75001', 'Paris', 'camionnette', 48.86, 2.32, 'idf'),
  ('42050000-0000-0000-0000-000000000002'::uuid, 'Dock Eiffel',     '10 quai',      '75015', 'Paris', 'camionnette', 48.85, 2.29, 'idf');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('42000000-0000-0000-0000-000000000004'::uuid, '42050000-0000-0000-0000-000000000001'::uuid);

-- Événements (date_evenement NOT NULL pour le chemin gestionnaire_lieux)
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone, client_organisateur_organisation_id
) VALUES
  -- ev_kaspia : Kaspia programmateur + opérationnel, lieu1, client orga EventCo
  ('42060000-0000-0000-0000-000000000001'::uuid, '42000000-0000-0000-0000-000000000001'::uuid, '42000000-0000-0000-0000-000000000001'::uuid, '42020000-0000-0000-0000-000000000001'::uuid, '42010000-0000-0000-0000-000000000001'::uuid, '42050000-0000-0000-0000-000000000001'::uuid, '42030000-0000-0000-0000-000000000001'::uuid, 'Gala Kaspia', CURRENT_DATE, 300, 'C', '0600000000', '42000000-0000-0000-0000-000000000005'::uuid),
  -- ev_kardam : Kardamome, lieu2
  ('42060000-0000-0000-0000-000000000002'::uuid, '42000000-0000-0000-0000-000000000002'::uuid, '42000000-0000-0000-0000-000000000002'::uuid, '42020000-0000-0000-0000-000000000002'::uuid, '42010000-0000-0000-0000-000000000003'::uuid, '42050000-0000-0000-0000-000000000002'::uuid, '42030000-0000-0000-0000-000000000001'::uuid, 'Gala Kardam', CURRENT_DATE, 200, 'C', '0611111111', NULL),
  -- ev_realisee / ev_ag / ev_annulee : Kaspia, lieu1
  ('42060000-0000-0000-0000-000000000003'::uuid, '42000000-0000-0000-0000-000000000001'::uuid, '42000000-0000-0000-0000-000000000001'::uuid, '42020000-0000-0000-0000-000000000001'::uuid, '42010000-0000-0000-0000-000000000001'::uuid, '42050000-0000-0000-0000-000000000001'::uuid, '42030000-0000-0000-0000-000000000001'::uuid, 'Evt realisee', CURRENT_DATE, 100, 'C', '0600000000', NULL),
  ('42060000-0000-0000-0000-000000000004'::uuid, '42000000-0000-0000-0000-000000000001'::uuid, '42000000-0000-0000-0000-000000000001'::uuid, '42020000-0000-0000-0000-000000000001'::uuid, '42010000-0000-0000-0000-000000000001'::uuid, '42050000-0000-0000-0000-000000000001'::uuid, '42030000-0000-0000-0000-000000000001'::uuid, 'Evt AG', CURRENT_DATE, 100, 'C', '0600000000', NULL),
  ('42060000-0000-0000-0000-000000000005'::uuid, '42000000-0000-0000-0000-000000000001'::uuid, '42000000-0000-0000-0000-000000000001'::uuid, '42020000-0000-0000-0000-000000000001'::uuid, '42010000-0000-0000-0000-000000000001'::uuid, '42050000-0000-0000-0000-000000000001'::uuid, '42030000-0000-0000-0000-000000000001'::uuid, 'Evt annulee', CURRENT_DATE, 100, 'C', '0600000000', NULL),
  -- ev_agence : Magnifik programmateur, Kaspia opérationnel, lieu2
  ('42060000-0000-0000-0000-000000000006'::uuid, '42000000-0000-0000-0000-000000000003'::uuid, '42000000-0000-0000-0000-000000000001'::uuid, '42020000-0000-0000-0000-000000000003'::uuid, '42010000-0000-0000-0000-000000000004'::uuid, '42050000-0000-0000-0000-000000000002'::uuid, '42030000-0000-0000-0000-000000000001'::uuid, 'Gala Magnifik', CURRENT_DATE, 150, 'C', '0600000000', NULL);

-- Collectes
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, prestataire_logistique_id, date_collecte, heure_collecte) VALUES
  ('42070000-0000-0000-0000-000000000001'::uuid, '42060000-0000-0000-0000-000000000001'::uuid, 'zero_dechet', 'cloturee', '42040000-0000-0000-0000-000000000001'::uuid, CURRENT_DATE, '06:00'),
  ('42070000-0000-0000-0000-000000000002'::uuid, '42060000-0000-0000-0000-000000000002'::uuid, 'zero_dechet', 'cloturee', '42040000-0000-0000-0000-000000000001'::uuid, CURRENT_DATE, '06:00'),
  ('42070000-0000-0000-0000-000000000003'::uuid, '42060000-0000-0000-0000-000000000003'::uuid, 'zero_dechet', 'realisee', NULL, CURRENT_DATE, '06:00'),
  ('42070000-0000-0000-0000-000000000004'::uuid, '42060000-0000-0000-0000-000000000004'::uuid, 'anti_gaspi',  'cloturee', NULL, CURRENT_DATE, '06:00'),
  ('42070000-0000-0000-0000-000000000005'::uuid, '42060000-0000-0000-0000-000000000005'::uuid, 'zero_dechet', 'annulee',  NULL, CURRENT_DATE, '06:00'),
  ('42070000-0000-0000-0000-000000000006'::uuid, '42060000-0000-0000-0000-000000000006'::uuid, 'zero_dechet', 'cloturee', '42040000-0000-0000-0000-000000000001'::uuid, CURRENT_DATE, '06:00');

-- Pesées coll_kaspia : biodéchet 36 kg + verre 30 kg → poids total 66 kg
INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg) VALUES
  ('42070000-0000-0000-0000-000000000001'::uuid, (SELECT id FROM plateforme.flux_dechets WHERE code = 'biodechet'), 36),
  ('42070000-0000-0000-0000-000000000001'::uuid, (SELECT id FROM plateforme.flux_dechets WHERE code = 'verre'),     30);

-- Bordereaux émis (coll_kaspia + coll_kardam pour le test cross-org)
INSERT INTO plateforme.bordereaux_savr (id, collecte_id, statut, numero, date_emission, exutoire_nom, version) VALUES
  ('42080000-0000-0000-0000-000000000001'::uuid, '42070000-0000-0000-0000-000000000001'::uuid, 'emis', 'BSAV-2026-00001', CURRENT_DATE, 'Veolia Saint-Denis', 1),
  ('42080000-0000-0000-0000-000000000002'::uuid, '42070000-0000-0000-0000-000000000002'::uuid, 'emis', 'BSAV-2026-00002', CURRENT_DATE, 'Veolia Ivry',        1);

-- Exports tracés (1 Kaspia, 1 Kardamome) pour le test self-only
INSERT INTO plateforme.exports_registre (id, organisation_id, user_id, periode_debut, periode_fin, nb_lignes, type_export, format) VALUES
  ('42090000-0000-0000-0000-000000000001'::uuid, '42000000-0000-0000-0000-000000000001'::uuid, '42010000-0000-0000-0000-000000000001'::uuid, CURRENT_DATE, CURRENT_DATE, 8, 'registre_dechets', 'csv'),
  ('42090000-0000-0000-0000-000000000002'::uuid, '42000000-0000-0000-0000-000000000002'::uuid, '42010000-0000-0000-0000-000000000003'::uuid, CURRENT_DATE, CURRENT_DATE, 5, 'registre_dechets', 'csv');

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Périmètre de la vue (F2 : cloturee + ZD only)
-- ════════════════════════════════════════════════════════════════════════════
SELECT test_set_jwt('admin_savr', NULL, '42010000-0000-0000-0000-000000000007'::uuid);

SELECT is(
  (SELECT count(*)::int FROM plateforme.v_registre_dechets
   WHERE collecte_id = '42070000-0000-0000-0000-000000000003'::uuid),
  0, 'collecte_realisee_absente_du_registre');

SELECT is(
  (SELECT count(*)::int FROM plateforme.v_registre_dechets
   WHERE collecte_id = '42070000-0000-0000-0000-000000000004'::uuid),
  0, 'collecte_ag_cloturee_absente_du_registre');

SELECT is(
  (SELECT count(*)::int FROM plateforme.v_registre_dechets
   WHERE collecte_id = '42070000-0000-0000-0000-000000000005'::uuid),
  0, 'collecte_annulee_jamais_au_registre');

SELECT is(
  (SELECT count(*)::int FROM plateforme.v_registre_dechets),
  3, 'admin_savr_vue_globale — 3 collectes cloturee ZD (Kaspia, Kardam, Magnifik/Kaspia)');

SELECT is(
  (SELECT poids_total_kg FROM plateforme.v_registre_dechets
   WHERE collecte_id = '42070000-0000-0000-0000-000000000001'::uuid),
  66.000, 'poids_total_somme_multi_pesees_meme_flux — 36 + 30 = 66 kg');

SELECT hasnt_column(
  'plateforme', 'v_registre_dechets', 'attestation_don_numero',
  'collecte_ag_absente — la vue n''expose aucune colonne attestation_don_* (AG=V2)');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Isolation RLS (cloisonnement interne f_collecte_visible + exclusion agence)
-- ════════════════════════════════════════════════════════════════════════════
SELECT test_set_jwt('traiteur_manager', '42000000-0000-0000-0000-000000000001'::uuid, '42010000-0000-0000-0000-000000000001'::uuid);

SELECT is(
  (SELECT count(*)::int FROM plateforme.v_registre_dechets
   WHERE collecte_id = '42070000-0000-0000-0000-000000000002'::uuid),
  0, 'manager_kaspia_ne_voit_pas_kardamome');

SELECT is(
  (SELECT count(*)::int FROM plateforme.v_registre_dechets
   WHERE collecte_id = '42070000-0000-0000-0000-000000000001'::uuid),
  1, 'manager_kaspia_voit_sa_collecte');

SELECT is(
  (SELECT count(*)::int FROM plateforme.v_registre_dechets
   WHERE collecte_id = '42070000-0000-0000-0000-000000000006'::uuid),
  1, 'traiteur_operationnel_voit_collecte_programmee_par_tiers');

-- Commercial : lecture org-wide
SELECT test_set_jwt('traiteur_commercial', '42000000-0000-0000-0000-000000000001'::uuid, '42010000-0000-0000-0000-000000000002'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.v_registre_dechets
   WHERE collecte_id = '42070000-0000-0000-0000-000000000001'::uuid),
  1, 'commercial_select_org_wide');

-- Agence : exclusion totale (F6) — 0 ligne même sur ses propres événements
SELECT test_set_jwt('agence', '42000000-0000-0000-0000-000000000003'::uuid, '42010000-0000-0000-0000-000000000004'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.v_registre_dechets),
  0, 'registre_agence_denied — agence ne voit aucune ligne (donneuse d''ordre, non productrice)');

-- Gestionnaire de lieux : voit via organisations_lieux (lieu1), pas lieu2
SELECT test_set_jwt('gestionnaire_lieux', '42000000-0000-0000-0000-000000000004'::uuid, '42010000-0000-0000-0000-000000000005'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.v_registre_dechets
   WHERE collecte_id = '42070000-0000-0000-0000-000000000001'::uuid),
  1, 'gestionnaire_lieux_voit_evenements_de_ses_lieux');
SELECT is(
  (SELECT count(*)::int FROM plateforme.v_registre_dechets
   WHERE collecte_id = '42070000-0000-0000-0000-000000000002'::uuid),
  0, 'gestionnaire_ne_voit_pas_lieu_non_associe');

-- Client organisateur : voit ses événements (lecture seule)
SELECT test_set_jwt('client_organisateur', '42000000-0000-0000-0000-000000000005'::uuid, '42010000-0000-0000-0000-000000000006'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.v_registre_dechets
   WHERE collecte_id = '42070000-0000-0000-0000-000000000001'::uuid),
  1, 'client_organisateur_lecture_seule');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. exports_registre — self-only + WITH CHECK INSERT
-- ════════════════════════════════════════════════════════════════════════════
SELECT test_set_jwt('traiteur_manager', '42000000-0000-0000-0000-000000000001'::uuid, '42010000-0000-0000-0000-000000000001'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.exports_registre),
  1, 'exports_registre_self_only_select — manager Kaspia ne voit que son export');

SELECT test_set_jwt('admin_savr', NULL, '42010000-0000-0000-0000-000000000007'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.exports_registre),
  2, 'exports_registre_admin_voit_tout');

-- Usurpation user_id → deny (WITH CHECK user_id = auth.uid())
SELECT test_set_jwt('traiteur_manager', '42000000-0000-0000-0000-000000000001'::uuid, '42010000-0000-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.exports_registre (organisation_id, user_id, periode_debut, periode_fin, nb_lignes, type_export, format)
     VALUES ('42000000-0000-0000-0000-000000000001'::uuid, '42010000-0000-0000-0000-000000000007'::uuid, CURRENT_DATE, CURRENT_DATE, 1, 'registre_dechets', 'csv') $$,
  '42501', NULL, 'insert_exports_registre_user_id_usurpe_deny');

-- Organisation étrangère → deny (WITH CHECK organisation_id = jwt org)
SELECT throws_ok(
  $$ INSERT INTO plateforme.exports_registre (organisation_id, user_id, periode_debut, periode_fin, nb_lignes, type_export, format)
     VALUES ('42000000-0000-0000-0000-000000000002'::uuid, '42010000-0000-0000-0000-000000000001'::uuid, CURRENT_DATE, CURRENT_DATE, 1, 'registre_dechets', 'csv') $$,
  '42501', NULL, 'insert_exports_registre_organisation_etrangere_deny');

-- Trace propre périmètre → autorisée
SELECT lives_ok(
  $$ INSERT INTO plateforme.exports_registre (organisation_id, user_id, periode_debut, periode_fin, nb_lignes, type_export, format)
     VALUES ('42000000-0000-0000-0000-000000000001'::uuid, '42010000-0000-0000-0000-000000000001'::uuid, CURRENT_DATE, CURRENT_DATE, 8, 'registre_dechets', 'csv') $$,
  'exports_registre_trace_self_autorisee');

-- ════════════════════════════════════════════════════════════════════════════
-- 4. bordereaux_savr — append-only (registre auditable)
-- ════════════════════════════════════════════════════════════════════════════
-- DELETE refusé pour admin (aucune policy DELETE — §09 matrice DELETE = —)
SELECT test_set_jwt('admin_savr', NULL, '42010000-0000-0000-0000-000000000007'::uuid);
DELETE FROM plateforme.bordereaux_savr WHERE id = '42080000-0000-0000-0000-000000000001'::uuid;
SELECT is(
  (SELECT count(*)::int FROM plateforme.bordereaux_savr WHERE id = '42080000-0000-0000-0000-000000000001'::uuid),
  1, 'delete_bordereau_emis_deny_admin');

-- DELETE refusé pour manager
SELECT test_set_jwt('traiteur_manager', '42000000-0000-0000-0000-000000000001'::uuid, '42010000-0000-0000-0000-000000000001'::uuid);
DELETE FROM plateforme.bordereaux_savr WHERE id = '42080000-0000-0000-0000-000000000001'::uuid;
SELECT is(
  (SELECT count(*)::int FROM plateforme.bordereaux_savr WHERE id = '42080000-0000-0000-0000-000000000001'::uuid),
  1, 'delete_bordereau_emis_deny_manager');

-- UPDATE (régénération) refusé pour manager → statut inchangé
UPDATE plateforme.bordereaux_savr SET statut = 'annule' WHERE id = '42080000-0000-0000-0000-000000000001'::uuid;
SELECT is(
  (SELECT statut::text FROM plateforme.bordereaux_savr WHERE id = '42080000-0000-0000-0000-000000000001'::uuid),
  'emis', 'regeneration_bordereau_par_manager_deny');

-- URL directe d'un bordereau hors périmètre → 0 ligne
SELECT is(
  (SELECT count(*)::int FROM plateforme.bordereaux_savr WHERE collecte_id = '42070000-0000-0000-0000-000000000002'::uuid),
  0, 'url_directe_bordereau_hors_perimetre_deny');

-- ════════════════════════════════════════════════════════════════════════════
-- 5. historique_partiel non modifiable par le client (flag F3)
-- ════════════════════════════════════════════════════════════════════════════
UPDATE plateforme.collectes SET historique_partiel = true WHERE id = '42070000-0000-0000-0000-000000000001'::uuid;
SELECT is(
  (SELECT historique_partiel FROM plateforme.v_registre_dechets WHERE collecte_id = '42070000-0000-0000-0000-000000000001'::uuid),
  false, 'flag_historique_partiel_non_modifiable_par_client');

SELECT * FROM finish();
ROLLBACK;

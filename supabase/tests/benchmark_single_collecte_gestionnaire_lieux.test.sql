-- =============================================================================
-- pgTAP — Radar de la fiche collecte : le gestionnaire de lieux sur les collectes
-- que des traiteurs tiers tiennent sur ses lieux (décision Val 2026-10-20)
-- Migration : 20261020180000_plateforme_benchmark_single_collecte_gestionnaire_lieux.sql
-- =============================================================================
-- `f_benchmark_single_collecte` accepte désormais, en plus de l'organisation
-- programmatrice et du traiteur opérationnel, le gestionnaire dont
-- l'organisation est rattachée (`organisations_lieux`) au lieu d'un événement
-- daté : la borne du régime (b) de `evt_gestionnaire_select`.
--
--   1      non-vacuité de la fixture ;
--   2-3    accepté : collecte d'un traiteur tiers sur un lieu rattaché, ratio
--          kg/pax rendu par flux ;
--   4-5    aucune donnée nouvelle : la session du gestionnaire lit déjà le poids
--          du flux et les pax de cet événement, et le ratio rendu est leur
--          quotient ;
--   6-8    refusé : lieu non rattaché, autre gestionnaire, événement sans date ;
--   9-11   refusé : même organisation sous un autre rôle client (traiteur,
--          agence, client organisateur) — l'ouverture tient au rôle ;
--   12     inchangé : un traiteur sans lien avec la collecte reste refusé.
--
-- Fixture : gestionnaire G (lieu L1), gestionnaire G2 (lieu L2), traiteurs T et
-- T2. T programme et opère trois événements : E1 daté sur L1 (collecte C1 ZD
-- clôturée, 2 flux pesés), E2 daté sur L2 (C2), E3 sur L1 sans date (C3, sa
-- seule collecte, est annulée : le déclencheur `fn_set_date_evenement` date
-- l'événement par ses collectes non annulées et lui laisse donc une date vide —
-- un moyen réaliste d'avoir une collecte sur un événement sans date).
-- JWT au format PRODUCTION (claim `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(12);

CREATE OR REPLACE FUNCTION _bsg_jwt(p_role text, p_org uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(), 'role', 'authenticated', 'user_role', p_role,
    'organisation_id', p_org, 'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION _bsg_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Lignes rendues à la session, -1 si la fonction refuse. Un refus ne doit pas
-- interrompre le fichier : chaque cas rend son verdict (lecture avant/après).
CREATE OR REPLACE FUNCTION _bsg_nb(p_collecte uuid)
RETURNS integer LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT count(*)::int FROM plateforme.f_benchmark_single_collecte(p_collecte));
EXCEPTION WHEN OTHERS THEN
  RETURN -1;
END $$;

-- Ratio kg/pax du flux biodéchet rendu à la session, NULL si la fonction refuse.
CREATE OR REPLACE FUNCTION _bsg_ratio_bio(p_collecte uuid)
RETURNS numeric LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT ratio_user
            FROM plateforme.f_benchmark_single_collecte(p_collecte)
           WHERE flux_code = 'biodechet');
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

-- Fixture ---------------------------------------------------------------------
SELECT _bsg_superuser();

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
  ('b5c1d000-0000-0000-0000-0000000000a1', 'BSG Gestionnaire', 'BSG Gest SAS', 'gestionnaire_lieux', '98100000000011', true),
  ('b5c1d000-0000-0000-0000-0000000000a2', 'BSG Gestionnaire 2', 'BSG Gest 2 SAS', 'gestionnaire_lieux', '98100000000022', true),
  ('b5c1d000-0000-0000-0000-0000000000b1', 'BSG Traiteur', 'BSG T SARL', 'traiteur', '98100000000101', true),
  ('b5c1d000-0000-0000-0000-0000000000b2', 'BSG Traiteur 2', 'BSG T2 SARL', 'traiteur', '98100000000202', true);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif) VALUES
  ('b5c1d000-0000-0000-0000-0000000001b1', 'b5c1d000-0000-0000-0000-0000000000b1',
   'chef@bsg.test', 'Chef', 'BSG', 'traiteur_manager', true);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('b5c1d000-0000-0000-0000-0000000002b1', 'b5c1d000-0000-0000-0000-0000000000b1',
   'BSG T SARL', '98100000000101', '1 rue BSG', '75001', 'Paris');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('b5c1d000-0000-0000-0000-0000000000d1', 'BSG_TYPE', 'BSG Type', 1, true);

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('b5c1d000-0000-0000-0000-0000000000c1', 'BSG Lieu 1', '1 av BSG', '75002', 'Paris', 'camionnette'),
  ('b5c1d000-0000-0000-0000-0000000000c2', 'BSG Lieu 2', '2 av BSG', '75003', 'Paris', 'camionnette');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id) VALUES
  ('b5c1d000-0000-0000-0000-0000000000a1', 'b5c1d000-0000-0000-0000-0000000000c1'),
  ('b5c1d000-0000-0000-0000-0000000000a2', 'b5c1d000-0000-0000-0000-0000000000c2');

-- E1 sur L1, E2 sur L2, E3 sur L1 : tous programmés et opérés par T, jamais par
-- un gestionnaire. Les dates de E1 et E2 sont recalculées par le déclencheur à
-- l'insertion des collectes ; celle de E3 reste vide (collecte annulée).
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone) VALUES
  ('b5c1d000-0000-0000-0000-0000000003e1',
   'b5c1d000-0000-0000-0000-0000000000b1', 'b5c1d000-0000-0000-0000-0000000000b1',
   'b5c1d000-0000-0000-0000-0000000002b1', 'b5c1d000-0000-0000-0000-0000000001b1',
   'b5c1d000-0000-0000-0000-0000000000c1', 'b5c1d000-0000-0000-0000-0000000000d1',
   'BSG Evt 1', current_date - 30, 500, 'C', '0600000001'),
  ('b5c1d000-0000-0000-0000-0000000003e2',
   'b5c1d000-0000-0000-0000-0000000000b1', 'b5c1d000-0000-0000-0000-0000000000b1',
   'b5c1d000-0000-0000-0000-0000000002b1', 'b5c1d000-0000-0000-0000-0000000001b1',
   'b5c1d000-0000-0000-0000-0000000000c2', 'b5c1d000-0000-0000-0000-0000000000d1',
   'BSG Evt 2', current_date - 31, 500, 'C', '0600000002'),
  ('b5c1d000-0000-0000-0000-0000000003e3',
   'b5c1d000-0000-0000-0000-0000000000b1', 'b5c1d000-0000-0000-0000-0000000000b1',
   'b5c1d000-0000-0000-0000-0000000002b1', 'b5c1d000-0000-0000-0000-0000000001b1',
   'b5c1d000-0000-0000-0000-0000000000c1', 'b5c1d000-0000-0000-0000-0000000000d1',
   'BSG Evt 3', NULL, 500, 'C', '0600000003');

INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, dirty_tms, annulee_cote_savr) VALUES
  ('b5c1d000-0000-0000-0000-0000000004c1', 'b5c1d000-0000-0000-0000-0000000003e1',
   'zero_dechet', 'cloturee', 'non_envoye', current_date - 30, '20:00', false, false),
  ('b5c1d000-0000-0000-0000-0000000004c2', 'b5c1d000-0000-0000-0000-0000000003e2',
   'zero_dechet', 'cloturee', 'non_envoye', current_date - 31, '20:00', false, false),
  ('b5c1d000-0000-0000-0000-0000000004c3', 'b5c1d000-0000-0000-0000-0000000003e3',
   'zero_dechet', 'annulee', 'non_envoye', current_date - 32, '20:00', false, false);

INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT c.id, f.id, CASE f.code WHEN 'biodechet' THEN 250 ELSE 50 END::decimal
  FROM (VALUES ('b5c1d000-0000-0000-0000-0000000004c1'::uuid),
               ('b5c1d000-0000-0000-0000-0000000004c2'::uuid),
               ('b5c1d000-0000-0000-0000-0000000004c3'::uuid)) AS c(id)
  CROSS JOIN plateforme.flux_dechets f
 WHERE f.code IN ('biodechet', 'carton');

-- Identifiant du flux biodéchet, lu ici en superutilisateur : le cas 4 ne doit
-- dépendre que de ce que la session du gestionnaire lit sur la collecte.
SELECT set_config('bsg.flux_bio',
  (SELECT id::text FROM plateforme.flux_dechets WHERE code = 'biodechet'), true);

-- 1. Non-vacuité ---------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int
     FROM plateforme.collecte_flux cf
     JOIN plateforme.collectes c  ON c.id = cf.collecte_id
     JOIN plateforme.evenements e ON e.id = c.evenement_id
     JOIN plateforme.organisations_lieux ol
       ON ol.lieu_id = e.lieu_id AND ol.organisation_id = 'b5c1d000-0000-0000-0000-0000000000a1'
    WHERE c.id = 'b5c1d000-0000-0000-0000-0000000004c1'
      AND c.statut = 'cloturee'
      AND e.date_evenement IS NOT NULL
      AND e.organisation_id = 'b5c1d000-0000-0000-0000-0000000000b1'
      AND e.traiteur_operationnel_organisation_id = 'b5c1d000-0000-0000-0000-0000000000b1')
  + (SELECT count(*)::int
       FROM plateforme.evenements e
      WHERE e.id = 'b5c1d000-0000-0000-0000-0000000003e3'
        AND e.date_evenement IS NULL
        AND e.lieu_id = 'b5c1d000-0000-0000-0000-0000000000c1'),
  3,
  '1. non-vacuité : C1 est clôturée, pesée sur 2 flux, programmée et opérée par T, sur un lieu rattaché à G ; E3, sur ce même lieu, est resté sans date');

-- 2-3. Accepté -----------------------------------------------------------------
SELECT _bsg_jwt('gestionnaire_lieux', 'b5c1d000-0000-0000-0000-0000000000a1');
SELECT is(
  _bsg_nb('b5c1d000-0000-0000-0000-0000000004c1'),
  2,
  'M3.2/benchmark_single_collecte_tiers_lieu_rattache — le gestionnaire obtient le radar d''une collecte d''un traiteur tiers tenue sur son lieu (une ligne par flux pesé)');

SELECT is(
  _bsg_ratio_bio('b5c1d000-0000-0000-0000-0000000004c1'),
  0.5::numeric,
  '3. ratio kg/pax du flux biodéchet : 250 kg / 500 pax');

-- 4-5. Aucune donnée nouvelle --------------------------------------------------
SELECT is(
  (SELECT (SELECT cf.poids_reel_kg
             FROM plateforme.collecte_flux cf
            WHERE cf.collecte_id = 'b5c1d000-0000-0000-0000-0000000004c1'
              AND cf.flux_id = current_setting('bsg.flux_bio')::uuid)
        / (SELECT c.pax
             FROM plateforme.collectes c
            WHERE c.id = 'b5c1d000-0000-0000-0000-0000000004c1')),
  0.5::numeric,
  'M3.2/benchmark_single_collecte_tiers_sans_donnee_nouvelle — la session du gestionnaire lit déjà le poids du flux et le pax de la collecte (lot C1) : leur quotient est le ratio rendu');

SELECT is(
  (SELECT count(*)::int
     FROM plateforme.collecte_flux cf
    WHERE cf.collecte_id = 'b5c1d000-0000-0000-0000-0000000004c1'
      AND cf.poids_reel_kg IS NOT NULL),
  2,
  '5. la session du gestionnaire lit les 2 flux pesés de C1');

-- 6-8. Refusé hors du régime (b) ----------------------------------------------
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_single_collecte('b5c1d000-0000-0000-0000-0000000004c2') $$,
  'P0001', 'Collecte not accessible',
  'M3.2/benchmark_single_collecte_tiers_lieu_non_rattache_refuse — collecte d''un traiteur tiers sur un lieu non rattaché : refusée');

SELECT _bsg_jwt('gestionnaire_lieux', 'b5c1d000-0000-0000-0000-0000000000a2');
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_single_collecte('b5c1d000-0000-0000-0000-0000000004c1') $$,
  'P0001', 'Collecte not accessible',
  '7. un autre gestionnaire, dont l''organisation n''est pas rattachée au lieu de C1 : refusé');

SELECT _bsg_jwt('gestionnaire_lieux', 'b5c1d000-0000-0000-0000-0000000000a1');
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_single_collecte('b5c1d000-0000-0000-0000-0000000004c3') $$,
  'P0001', 'Collecte not accessible',
  'M3.2/benchmark_single_collecte_tiers_evenement_sans_date_refuse — événement sans date d''un tiers sur son lieu : refusé');

-- 9-11. L'ouverture tient au rôle ---------------------------------------------
-- Même organisation (rattachée à L1), autre rôle client : refusé.
SELECT _bsg_jwt('traiteur_manager', 'b5c1d000-0000-0000-0000-0000000000a1');
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_single_collecte('b5c1d000-0000-0000-0000-0000000004c1') $$,
  'P0001', 'Collecte not accessible',
  'M3.2/benchmark_single_collecte_tiers_autre_role_refuse — organisation rattachée au lieu mais rôle traiteur_manager : refusé');

SELECT _bsg_jwt('agence', 'b5c1d000-0000-0000-0000-0000000000a1');
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_single_collecte('b5c1d000-0000-0000-0000-0000000004c1') $$,
  'P0001', 'Collecte not accessible',
  '10. organisation rattachée au lieu mais rôle agence : refusé');

SELECT _bsg_jwt('client_organisateur', 'b5c1d000-0000-0000-0000-0000000000a1');
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_single_collecte('b5c1d000-0000-0000-0000-0000000004c1') $$,
  'P0001', 'Collecte not accessible',
  '11. organisation rattachée au lieu mais rôle client_organisateur : refusé');

-- 12. Inchangé : traiteur sans lien avec la collecte --------------------------
SELECT _bsg_jwt('traiteur_manager', 'b5c1d000-0000-0000-0000-0000000000b2');
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_single_collecte('b5c1d000-0000-0000-0000-0000000004c1') $$,
  'P0001', 'Collecte not accessible',
  '12. traiteur sans lien avec la collecte : toujours refusé');

SELECT * FROM finish();
ROLLBACK;

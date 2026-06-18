-- pgTAP ECR-1 M2.4 — Trigger fn_trg_co2_ag_cloture
-- Vérifie que la transition collecte.statut → 'cloturee' (anti_gaspi)
-- peuple co2_evite_kg et co2_facteurs_snapshot.
-- Tests exécutés sous rôle authenticated (admin_savr) + test RLS cross-org.

BEGIN;
SELECT plan(10);

-- ── Helpers JWT ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role    text,
  p_org_id  uuid    DEFAULT NULL,
  p_user_id uuid    DEFAULT gen_random_uuid()
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ── 1. Schéma — fonction et trigger existent ──────────────────────────────

SELECT has_function(
  'plateforme', 'fn_trg_co2_ag_cloture', ARRAY[]::text[],
  'ECR-1 : fonction fn_trg_co2_ag_cloture existe'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c  ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'plateforme'
      AND c.relname = 'collectes'
      AND t.tgname = 'trg_co2_ag_cloture'
  ),
  'ECR-1 : trigger trg_co2_ag_cloture existe sur collectes'
);

-- ── Fixtures (superuser) ──────────────────────────────────────────────────

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES ('aa000000-0000-0000-0000-000000000001'::uuid,
        'TestOrg CO2 AG', 'TestOrg CO2 AG', 'traiteur', '11111111100001', true);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('aa000000-0000-0000-0000-000000000002'::uuid,
        'aa000000-0000-0000-0000-000000000001'::uuid,
        'admin@trg-co2-ag.test', 'Admin', 'Test', 'admin_savr');

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('aa000000-0000-0000-0000-000000000003'::uuid,
        'aa000000-0000-0000-0000-000000000001'::uuid,
        'TestOrg CO2 AG SARL', '11111111100001', '1 rue Test CO2', '75001', 'Paris');

INSERT INTO plateforme.lieux
  (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region)
VALUES ('aa000000-0000-0000-0000-000000000004'::uuid,
        'Salle CO2 Test', '1 rue CO2', '75001', 'Paris', 'camionnette', 48.8566, 2.3522, 'idf');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('aa000000-0000-0000-0000-000000000005'::uuid, 'GALA_CO2', 'Gala CO2 Test', 1, true);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id,
  nom_evenement, date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES (
  'aa000000-0000-0000-0000-000000000006'::uuid,
  'aa000000-0000-0000-0000-000000000001'::uuid,
  'aa000000-0000-0000-0000-000000000001'::uuid,
  'aa000000-0000-0000-0000-000000000003'::uuid,
  'aa000000-0000-0000-0000-000000000002'::uuid,
  'aa000000-0000-0000-0000-000000000004'::uuid,
  'aa000000-0000-0000-0000-000000000005'::uuid,
  'Gala CO2 Test', '2026-06-15', 200, 'Contact CO2', '0600000099'
);

INSERT INTO plateforme.associations
  (id, nom, adresse, region, ville, contact_email,
   description_rapport_impact, habilitee_attestation_fiscale, actif)
VALUES ('aa000000-0000-0000-0000-000000000007'::uuid,
  'Asso CO2 Test', '2 rue Asso', 'idf', 'Paris', 'asso@co2-test.fr',
  'Description rapport impact suffisamment longue pour passer la contrainte', true, true);

INSERT INTO plateforme.transporteurs
  (id, nom, siren, adresse, code_postal, ville,
   types_vehicules, type_tms, contact_nom, contact_email, contact_telephone, actif)
VALUES ('aa000000-0000-0000-0000-000000000008'::uuid,
  'Transp CO2', '222222222', '3 rue Transp', '75001', 'Paris',
  ARRAY['camionnette'], 'autre', 'Contact Transp', 'transp@co2-test.fr', '0600000098', true);

-- Facteur CO2 AG (idempotent ; écrase toute valeur différente pour avoir un test déterministe)
INSERT INTO plateforme.parametres_facteurs_co2_ag (cle, facteur_co2_evite_par_repas_kg, source_donnee, actif)
VALUES ('co2_ag_ademe_v1', 2.5, 'FAO ADEME figé V1', true)
ON CONFLICT (cle) DO UPDATE SET facteur_co2_evite_par_repas_kg = 2.5, actif = true;

-- Équivalence km voiture (pour T1d — s'assure que la valeur est 0.218 pendant ce test)
INSERT INTO plateforme.parametres_co2_divers (cle, valeur, unite, description)
VALUES ('equiv_km_voiture_kgco2', 0.218, 'kgCO₂e/km', 'Équivalence 1 km voiture thermique — ADEME 2024')
ON CONFLICT (cle) DO UPDATE SET valeur = 0.218;

-- Collecte AG en statut 'realisee' — cible des tests T1-T2
INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, realisee_at)
VALUES ('aa000000-0000-0000-0001-000000000001'::uuid,
        'aa000000-0000-0000-0000-000000000006'::uuid,
        'anti_gaspi', 'realisee', 'non_envoye', '2026-06-15', '20:00', now() - interval '2h');

-- Attribution AG (volume 120 repas)
INSERT INTO plateforme.attributions_antgaspi (
  id, collecte_id, association_id, transporteur_id,
  branche_attribution, mode_validation, volume_repas_realise, poids_repas_kg
) VALUES (
  'aa000000-0000-0000-0001-000000000002'::uuid,
  'aa000000-0000-0000-0001-000000000001'::uuid,
  'aa000000-0000-0000-0000-000000000007'::uuid,
  'aa000000-0000-0000-0000-000000000008'::uuid,
  'ag_velo_idf', 'manuel_top1', 120, 54.0
);

-- Collecte ZD en statut 'realisee' — cible test T3 (trigger ne doit pas s'activer)
INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, realisee_at)
VALUES ('aa000000-0000-0000-0002-000000000001'::uuid,
        'aa000000-0000-0000-0000-000000000006'::uuid,
        'zero_dechet', 'realisee', 'non_envoye', '2026-06-15', '20:00', now() - interval '2h');

-- Collecte AG sans attribution — cible test T4 (co2_evite_kg = 0)
INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, realisee_at)
VALUES ('aa000000-0000-0000-0003-000000000001'::uuid,
        'aa000000-0000-0000-0000-000000000006'::uuid,
        'anti_gaspi', 'realisee', 'non_envoye', '2026-06-15', '20:00', now() - interval '2h');

-- Collecte AG en statut 'realisee' — cible test T_RLS (cross-org, ne doit pas être clôturée)
INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, realisee_at)
VALUES ('aa000000-0000-0000-0004-000000000001'::uuid,
        'aa000000-0000-0000-0000-000000000006'::uuid,
        'anti_gaspi', 'realisee', 'non_envoye', '2026-06-15', '20:00', now() - interval '2h');

-- ── T1 : Transition realisee → cloturee sous rôle admin_savr ─────────────

SELECT test_set_jwt('admin_savr', 'aa000000-0000-0000-0000-000000000001'::uuid,
                    'aa000000-0000-0000-0000-000000000002'::uuid);
UPDATE plateforme.collectes
SET statut = 'cloturee', updated_at = now()
WHERE id = 'aa000000-0000-0000-0001-000000000001'::uuid;
SELECT test_as_superuser();

SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes
   WHERE id = 'aa000000-0000-0000-0001-000000000001'::uuid)::numeric,
  300.00::numeric,
  'T1 : co2_evite_kg = 120 repas × 2.5 kgCO2e = 300.00'
);

SELECT is(
  (SELECT co2_facteurs_snapshot->>'type' FROM plateforme.collectes
   WHERE id = 'aa000000-0000-0000-0001-000000000001'::uuid),
  'anti_gaspi',
  'T1b : snapshot.type = ''anti_gaspi'''
);

SELECT is(
  (SELECT (co2_facteurs_snapshot->>'volume_repas_realise')::integer FROM plateforme.collectes
   WHERE id = 'aa000000-0000-0000-0001-000000000001'::uuid),
  120,
  'T1c : snapshot.volume_repas_realise = 120'
);

SELECT is(
  (SELECT (co2_facteurs_snapshot->'equivalences'->>'km_voiture')::integer FROM plateforme.collectes
   WHERE id = 'aa000000-0000-0000-0001-000000000001'::uuid),
  round(300.0 / 0.218)::integer,
  'T1d : snapshot.equivalences.km_voiture = round(300 / 0.218 kgCO2e/km)'
);

-- ── T2 : Idempotence — UPDATE sans changement de statut (WHEN clause = false) ──

UPDATE plateforme.collectes
SET notes_internes = 'idempotence-test'
WHERE id = 'aa000000-0000-0000-0001-000000000001'::uuid;

SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes
   WHERE id = 'aa000000-0000-0000-0001-000000000001'::uuid)::numeric,
  300.00::numeric,
  'T2 : UPDATE sans changement de statut ne recalcule pas co2_evite_kg (WHEN clause)'
);

-- ── T3 : Collecte ZD → trigger non déclenché ─────────────────────────────

SELECT test_set_jwt('admin_savr', 'aa000000-0000-0000-0000-000000000001'::uuid,
                    'aa000000-0000-0000-0000-000000000002'::uuid);
UPDATE plateforme.collectes
SET statut = 'cloturee', updated_at = now()
WHERE id = 'aa000000-0000-0000-0002-000000000001'::uuid;
SELECT test_as_superuser();

SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes
   WHERE id = 'aa000000-0000-0000-0002-000000000001'::uuid),
  NULL,
  'T3 : collecte ZD → co2_evite_kg reste NULL (trigger non déclenché pour type=zero_dechet)'
);

-- ── T4 : AG sans attribution → co2_evite_kg = 0 ─────────────────────────

SELECT test_set_jwt('admin_savr', 'aa000000-0000-0000-0000-000000000001'::uuid,
                    'aa000000-0000-0000-0000-000000000002'::uuid);
UPDATE plateforme.collectes
SET statut = 'cloturee', updated_at = now()
WHERE id = 'aa000000-0000-0000-0003-000000000001'::uuid;
SELECT test_as_superuser();

SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes
   WHERE id = 'aa000000-0000-0000-0003-000000000001'::uuid)::numeric,
  0::numeric,
  'T4 : AG sans attribution → co2_evite_kg = 0 (COALESCE(NULL, 0) × facteur)'
);

-- ── T_RLS : traiteur_manager cross-org ne peut pas clôturer ──────────────
-- RLS col_update_client : UPDATE exige statut IN ('programmee','validee')
-- et organisation_id du JWT = organisation de l'événement.
-- Un traiteur_manager d'une autre org ne peut ni clôturer cette collecte.

SELECT test_set_jwt('traiteur_manager', 'bb000000-0000-0000-0000-000000000001'::uuid);
UPDATE plateforme.collectes
SET statut = 'cloturee', updated_at = now()
WHERE id = 'aa000000-0000-0000-0004-000000000001'::uuid;
SELECT test_as_superuser();

SELECT is(
  (SELECT statut::text FROM plateforme.collectes
   WHERE id = 'aa000000-0000-0000-0004-000000000001'::uuid),
  'realisee',
  'T_RLS : traiteur_manager cross-org bloqué par RLS — collecte reste en realisee'
);

SELECT * FROM finish();
ROLLBACK;

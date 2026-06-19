-- pgTAP M4.3 — Trigger fn_trg_co2_zd_cloture (Reporting CO₂ ADEME ZD).
-- Vérifie le calcul induit/évité/net/énergie + taux_recyclage + snapshots figés
-- à la transition collecte.statut → 'cloturee' (type = zero_dechet).
-- Valeurs attendues calculées contre les facteurs seedés (bloc8) + forfait M4.3.
--
-- Facteurs seedés utilisés :
--   parametres_facteurs_co2  : verre 10/300/400 ; carton 25/520/1800 ;
--                              biodechet 20/250/800 ; dechet_residuel 500/0/0 (kgCO₂/t + kWh/t)
--   parametres_taux_recyclage: verre 0.90 ; carton 0.80 ; biodechet 0.85 ; emballage 0.60
--   parametres_co2_divers    : km_collecte_aller_retour 50 ; fe_camion_benne_kg_km 2.1 → forfait 105

BEGIN;
SELECT plan(20);

-- ── Helpers JWT ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION test_as_superuser() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

SELECT test_as_superuser();

-- ── 1. Schéma — fonction et trigger existent ──────────────────────────────

SELECT has_function(
  'plateforme', 'fn_trg_co2_zd_cloture', ARRAY[]::text[],
  'M4.3 : fonction fn_trg_co2_zd_cloture existe'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c     ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'plateforme'
      AND c.relname = 'collectes'
      AND t.tgname = 'trg_co2_zd_cloture'
  ),
  'M4.3 : trigger trg_co2_zd_cloture existe sur collectes'
);

-- ── Fixtures (superuser) ──────────────────────────────────────────────────

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES ('cc000000-0000-0000-0000-000000000001'::uuid,
        'TestOrg CO2 ZD', 'TestOrg CO2 ZD', 'traiteur', '33333333300001', true);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('cc000000-0000-0000-0000-000000000002'::uuid,
        'cc000000-0000-0000-0000-000000000001'::uuid,
        'admin@trg-co2-zd.test', 'Admin', 'Test', 'admin_savr');

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('cc000000-0000-0000-0000-000000000003'::uuid,
        'cc000000-0000-0000-0000-000000000001'::uuid,
        'TestOrg CO2 ZD SARL', '33333333300001', '1 rue Test ZD', '75001', 'Paris');

INSERT INTO plateforme.lieux
  (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region)
VALUES ('cc000000-0000-0000-0000-000000000004'::uuid,
        'Salle CO2 ZD', '1 rue CO2 ZD', '75001', 'Paris', 'camionnette', 48.8566, 2.3522, 'idf');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('cc000000-0000-0000-0000-000000000005'::uuid, 'GALA_CO2_ZD', 'Gala CO2 ZD Test', 1, true);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id,
  nom_evenement, date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES (
  'cc000000-0000-0000-0000-000000000006'::uuid,
  'cc000000-0000-0000-0000-000000000001'::uuid,
  'cc000000-0000-0000-0000-000000000001'::uuid,
  'cc000000-0000-0000-0000-000000000003'::uuid,
  'cc000000-0000-0000-0000-000000000002'::uuid,
  'cc000000-0000-0000-0000-000000000004'::uuid,
  'cc000000-0000-0000-0000-000000000005'::uuid,
  'Gala CO2 ZD Test', '2026-06-15', 300, 'Contact ZD', '0600000077'
);

-- Collectes ZD en statut 'realisee' (cibles des transitions → cloturee)
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, realisee_at)
VALUES
  ('cc000000-0000-0001-0000-000000000001'::uuid, 'cc000000-0000-0000-0000-000000000006'::uuid, 'zero_dechet', 'realisee', 'non_envoye', '2026-06-15', '20:00', now() - interval '2h'),  -- nominal
  ('cc000000-0000-0002-0000-000000000001'::uuid, 'cc000000-0000-0000-0000-000000000006'::uuid, 'zero_dechet', 'realisee', 'non_envoye', '2026-06-15', '20:00', now() - interval '2h'),  -- OMR seul
  ('cc000000-0000-0004-0000-000000000001'::uuid, 'cc000000-0000-0000-0000-000000000006'::uuid, 'zero_dechet', 'realisee', 'non_envoye', '2026-06-15', '20:00', now() - interval '2h'),  -- figé
  ('cc000000-0000-0005-0000-000000000001'::uuid, 'cc000000-0000-0000-0000-000000000006'::uuid, 'zero_dechet', 'realisee', 'non_envoye', '2026-06-15', '20:00', now() - interval '2h'),  -- recalcul
  ('cc000000-0000-0006-0000-000000000001'::uuid, 'cc000000-0000-0000-0000-000000000006'::uuid, 'anti_gaspi',  'realisee', 'non_envoye', '2026-06-15', '20:00', now() - interval '2h');  -- AG (ne doit pas déclencher le trigger ZD)

-- Collecte vide (pas de pesées) : co2_induit_kg pré-rempli pour prouver la mise à NULL
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, realisee_at, co2_induit_kg)
VALUES ('cc000000-0000-0003-0000-000000000001'::uuid, 'cc000000-0000-0000-0000-000000000006'::uuid, 'zero_dechet', 'realisee', 'non_envoye', '2026-06-15', '20:00', now() - interval '2h', 999.00);

-- Pesées par flux
-- Nominal : verre 100 / carton 200 / biodechet 300 / OMR 400 → P_total 1000
INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT 'cc000000-0000-0001-0000-000000000001'::uuid, fd.id, v.poids
FROM (VALUES ('verre', 100), ('carton', 200), ('biodechet', 300), ('dechet_residuel', 400)) AS v(code, poids)
JOIN plateforme.flux_dechets fd ON fd.code = v.code;

-- OMR seul : dechet_residuel 500
INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT 'cc000000-0000-0002-0000-000000000001'::uuid, fd.id, 500
FROM plateforme.flux_dechets fd WHERE fd.code = 'dechet_residuel';

-- Figé : carton 100
INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT 'cc000000-0000-0004-0000-000000000001'::uuid, fd.id, 100
FROM plateforme.flux_dechets fd WHERE fd.code = 'carton';

-- Recalcul : verre 100 (corrigé plus tard à 200)
INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT 'cc000000-0000-0005-0000-000000000001'::uuid, fd.id, 100
FROM plateforme.flux_dechets fd WHERE fd.code = 'verre';

-- ── T1 : nominal — transition realisee → cloturee ─────────────────────────

UPDATE plateforme.collectes SET statut = 'cloturee', updated_at = now()
WHERE id = 'cc000000-0000-0001-0000-000000000001'::uuid;

SELECT is(
  (SELECT co2_induit_kg FROM plateforme.collectes WHERE id = 'cc000000-0000-0001-0000-000000000001'::uuid),
  317.00::decimal,
  'M4.3 / nominal_co2_induit : Σ(P_X/1000×fe_induit + forfait pro rata) = 317.00'
);
SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes WHERE id = 'cc000000-0000-0001-0000-000000000001'::uuid),
  209.00::decimal,
  'M4.3 / nominal_co2_evite : Σ(P_X/1000×fe_evite) = 209.00'
);
SELECT is(
  (SELECT co2_net_kg FROM plateforme.collectes WHERE id = 'cc000000-0000-0001-0000-000000000001'::uuid),
  108.00::decimal,
  'M4.3 / nominal_co2_net : induit − evite = 108.00'
);
SELECT is(
  (SELECT energie_primaire_evitee_kwh FROM plateforme.collectes WHERE id = 'cc000000-0000-0001-0000-000000000001'::uuid),
  640.00::decimal,
  'M4.3 / nominal_energie : Σ(P_X/1000×energie) = 640.00'
);
SELECT is(
  (SELECT taux_recyclage FROM plateforme.collectes WHERE id = 'cc000000-0000-0001-0000-000000000001'::uuid),
  50.50::decimal,
  'M4.3 / nominal_taux_recyclage : Σ(P_X×cap_X)/P_total×100 = 50.50'
);

-- T2 : snapshot figé bien formé
SELECT is(
  (SELECT (co2_facteurs_snapshot->'forfait_collecte'->>'km')::numeric
   FROM plateforme.collectes WHERE id = 'cc000000-0000-0001-0000-000000000001'::uuid),
  50::numeric,
  'M4.3 / snapshot_forfait_collecte : forfait_collecte.km = 50'
);
SELECT is(
  (SELECT (co2_facteurs_snapshot->'facteurs'->'verre'->>'evite')::numeric
   FROM plateforme.collectes WHERE id = 'cc000000-0000-0001-0000-000000000001'::uuid),
  300::numeric,
  'M4.3 / snapshot_facteurs : facteurs.verre.evite = 300'
);
SELECT is(
  (SELECT (caps_appliques->>'verre')::numeric
   FROM plateforme.collectes WHERE id = 'cc000000-0000-0001-0000-000000000001'::uuid),
  0.90::numeric,
  'M4.3 / snapshot_caps_appliques : caps_appliques.verre = 0.90'
);
SELECT ok(
  (SELECT co2_facteurs_snapshot->>'version_parametres_at'
   FROM plateforme.collectes WHERE id = 'cc000000-0000-0001-0000-000000000001'::uuid) IS NOT NULL,
  'M4.3 / snapshot_horodate : version_parametres_at présent'
);

-- ── T3 : OMR seul → taux_recyclage = 0.00 (et CO₂ calculé) ────────────────

UPDATE plateforme.collectes SET statut = 'cloturee', updated_at = now()
WHERE id = 'cc000000-0000-0002-0000-000000000001'::uuid;

SELECT is(
  (SELECT taux_recyclage FROM plateforme.collectes WHERE id = 'cc000000-0000-0002-0000-000000000001'::uuid),
  0.00::decimal,
  'M4.3 / taux_recyclage_zero_si_omr_seul : taux = 0.00 (et non NULL)'
);
SELECT ok(
  (SELECT co2_evite_kg = 0 AND co2_induit_kg > 0
   FROM plateforme.collectes WHERE id = 'cc000000-0000-0002-0000-000000000001'::uuid),
  'M4.3 / omr_seul_co2 : evite = 0, induit > 0 (incinération + forfait)'
);

-- ── T4 : pas de pesées → toutes grandeurs NULL (mise à NULL d'un résidu) ──

UPDATE plateforme.collectes SET statut = 'cloturee', updated_at = now()
WHERE id = 'cc000000-0000-0003-0000-000000000001'::uuid;

SELECT ok(
  (SELECT co2_induit_kg IS NULL AND co2_evite_kg IS NULL AND co2_net_kg IS NULL
      AND energie_primaire_evitee_kwh IS NULL AND co2_facteurs_snapshot IS NULL
      AND taux_recyclage IS NULL AND caps_appliques IS NULL
   FROM plateforme.collectes WHERE id = 'cc000000-0000-0003-0000-000000000001'::uuid),
  'M4.3 / p_total_zero_tout_null : aucune pesée → toutes grandeurs CO₂ + taux NULL'
);

-- ── T_AG : collecte AG clôturée → trigger ZD non déclenché ────────────────

UPDATE plateforme.collectes SET statut = 'cloturee', updated_at = now()
WHERE id = 'cc000000-0000-0006-0000-000000000001'::uuid;

SELECT is(
  (SELECT taux_recyclage FROM plateforme.collectes WHERE id = 'cc000000-0000-0006-0000-000000000001'::uuid),
  NULL::decimal,
  'M4.3 / ag_taux_recyclage_null : trigger ZD ne s''active pas pour type=anti_gaspi'
);

-- ── T_fige_initial : C_fige clôturée avec km=50 → induit 107.50 ───────────
-- induit_carton = (100/1000)×25 + (100/100)×105 = 2.5 + 105 = 107.50

UPDATE plateforme.collectes SET statut = 'cloturee', updated_at = now()
WHERE id = 'cc000000-0000-0004-0000-000000000001'::uuid;

SELECT is(
  (SELECT co2_induit_kg FROM plateforme.collectes WHERE id = 'cc000000-0000-0004-0000-000000000001'::uuid),
  107.50::decimal,
  'M4.3 / fige_calcul_initial : C_fige co2_induit = 107.50 (km=50)'
);

-- ── T_recalc_before : C_recalc clôturée avec km=50, verre 100 → 106.00 ────
-- induit_verre = (100/1000)×10 + (100/100)×105 = 1.0 + 105 = 106.00

UPDATE plateforme.collectes SET statut = 'cloturee', updated_at = now()
WHERE id = 'cc000000-0000-0005-0000-000000000001'::uuid;

SELECT is(
  (SELECT co2_induit_kg FROM plateforme.collectes WHERE id = 'cc000000-0000-0005-0000-000000000001'::uuid),
  106.00::decimal,
  'M4.3 / recalc_avant : C_recalc co2_induit = 106.00 (km=50, verre 100)'
);

-- ── T_idem : UPDATE sans changement de statut → pas de recalcul ───────────

UPDATE plateforme.collectes SET notes_internes = 'idempotence-test'
WHERE id = 'cc000000-0000-0001-0000-000000000001'::uuid;

SELECT is(
  (SELECT co2_induit_kg FROM plateforme.collectes WHERE id = 'cc000000-0000-0001-0000-000000000001'::uuid),
  317.00::decimal,
  'M4.3 / idempotence : UPDATE sans transition de statut ne recalcule pas (clause WHEN)'
);

-- ── Modification d'un facteur APRÈS clôture (forfait km 50 → 100) ─────────
-- Désactivation de l'audit (auth.uid() NULL en contexte superuser).

ALTER TABLE plateforme.parametres_co2_divers DISABLE TRIGGER trg_audit_parametres_co2_divers;
UPDATE plateforme.parametres_co2_divers SET valeur = 100 WHERE cle = 'km_collecte_aller_retour';
ALTER TABLE plateforme.parametres_co2_divers ENABLE TRIGGER trg_audit_parametres_co2_divers;

-- ── T5 : snapshot figé — C_fige inchangée malgré la modif du forfait ─────

SELECT is(
  (SELECT co2_induit_kg FROM plateforme.collectes WHERE id = 'cc000000-0000-0004-0000-000000000001'::uuid),
  107.50::decimal,
  'M4.3 / modification_facteur_sans_effet_sur_collectes_figees : C_fige reste 107.50'
);

-- ── T_recalc_after : correction pesée + re-clôture → facteurs DU MOMENT ───
-- verre corrigé 100 → 200 ; km désormais 100 → forfait 210
-- induit_verre = (200/1000)×10 + (200/200)×210 = 2.0 + 210 = 212.00

UPDATE plateforme.collecte_flux SET poids_reel_kg = 200
WHERE collecte_id = 'cc000000-0000-0005-0000-000000000001'::uuid
  AND flux_id = (SELECT id FROM plateforme.flux_dechets WHERE code = 'verre');

UPDATE plateforme.collectes SET statut = 'realisee', updated_at = now()
WHERE id = 'cc000000-0000-0005-0000-000000000001'::uuid;
UPDATE plateforme.collectes SET statut = 'cloturee', updated_at = now()
WHERE id = 'cc000000-0000-0005-0000-000000000001'::uuid;

SELECT is(
  (SELECT co2_induit_kg FROM plateforme.collectes WHERE id = 'cc000000-0000-0005-0000-000000000001'::uuid),
  212.00::decimal,
  'M4.3 / recalcul_apres_correction_pesee_facteurs_du_moment : recalcul = 212.00 (km=100, verre 200)'
);

SELECT * FROM finish();
ROLLBACK;

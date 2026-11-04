-- pgTAP — Documents fabriqués dès que les poids sont là (Val 2026-11-04,
-- migration 20261104120000) : CO₂ recalculé à chaque changement de poids sur une
-- collecte réalisée ou clôturée, plus seulement à la clôture ; calculs fermés
-- aux rôles clients.

BEGIN;
SELECT plan(25);

SELECT set_config('role', 'postgres', true);
SELECT set_config('request.jwt.claims', NULL, true);

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES ('dd000000-0000-0000-0000-000000000001', 'Org Docs Poids', 'Org Docs Poids', 'traiteur', '44444444400001', true);
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('dd000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000001', 'admin@docs-poids.test', 'Admin', 'Test', 'admin_savr');
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('dd000000-0000-0000-0000-000000000003', 'dd000000-0000-0000-0000-000000000001', 'Org Docs Poids SARL', '44444444400001', '1 rue Test', '75001', 'Paris');
INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region)
VALUES ('dd000000-0000-0000-0000-000000000004', 'Salle Docs Poids', '1 rue Docs', '75001', 'Paris', 'camionnette', 48.8566, 2.3522, 'idf');
INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('dd000000-0000-0000-0000-000000000005', 'GALA_DOCS_POIDS', 'Gala Docs Poids', 1, true);
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  'dd000000-0000-0000-0000-000000000006', 'dd000000-0000-0000-0000-000000000001',
  'dd000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000003',
  'dd000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000004',
  'dd000000-0000-0000-0000-000000000005', 'Gala Docs Poids', '2026-06-15', 300,
  'Contact', '0600000066'
);
INSERT INTO plateforme.associations (id, nom, adresse, region, ville, contact_email, description_rapport_impact, habilitee_attestation_fiscale, actif)
VALUES ('dd000000-0000-0000-0000-000000000007', 'Asso Docs Poids', '2 rue Asso', 'idf', 'Paris', 'asso@docs-poids.test',
        'Description rapport impact suffisamment longue pour passer la contrainte', true, true);
INSERT INTO plateforme.transporteurs (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms, contact_nom, contact_email, contact_telephone, actif)
VALUES ('dd000000-0000-0000-0000-000000000008', 'Transp Docs Poids', '333333333', '3 rue Transp', '75001', 'Paris',
        ARRAY['camionnette'], 'autre', 'Contact', 'transp@docs-poids.test', '0600000065', true);
INSERT INTO plateforme.parametres_facteurs_co2_ag (cle, facteur_co2_evite_par_repas_kg, source_donnee, actif)
VALUES ('co2_ag_ademe_v1', 2.5, 'FAO ADEME figé V1', true)
ON CONFLICT (cle) DO UPDATE SET facteur_co2_evite_par_repas_kg = 2.5, actif = true;

-- ZD : une réalisée, une en cours, une clôturée.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, realisee_at)
VALUES
  ('dd000000-0000-0001-0000-000000000001', 'dd000000-0000-0000-0000-000000000006', 'zero_dechet', 'realisee',  'non_envoye', '2026-06-15', '20:00', now() - interval '2 hours'),
  ('dd000000-0000-0002-0000-000000000001', 'dd000000-0000-0000-0000-000000000006', 'zero_dechet', 'en_cours',  'non_envoye', '2026-06-15', '20:00', NULL),
  ('dd000000-0000-0003-0000-000000000001', 'dd000000-0000-0000-0000-000000000006', 'zero_dechet', 'cloturee',  'non_envoye', '2026-06-15', '20:00', now() - interval '3 days');

-- ── ZD réalisée : la pesée suffit à calculer ────────────────────────────────
INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT 'dd000000-0000-0001-0000-000000000001', id, 100 FROM plateforme.flux_dechets WHERE code = 'verre';

SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes WHERE id = 'dd000000-0000-0001-0000-000000000001'),
  115.80::decimal,
  'ZD réalisée : 100 kg de verre pesés → CO₂ évité 115,80 kg, sans attendre la clôture'
);
SELECT is(
  (SELECT taux_recyclage FROM plateforme.collectes WHERE id = 'dd000000-0000-0001-0000-000000000001'),
  90.00::decimal,
  'ZD réalisée : taux de recyclage calculé dès la pesée'
);

-- Correction de la pesée : recalcul.
UPDATE plateforme.collecte_flux SET poids_reel_kg = 200
WHERE collecte_id = 'dd000000-0000-0001-0000-000000000001';
SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes WHERE id = 'dd000000-0000-0001-0000-000000000001'),
  231.60::decimal,
  'ZD réalisée : pesée corrigée à 200 kg → CO₂ évité recalculé à 231,60 kg'
);

-- ── ZD en cours : rien avant la réalisation ─────────────────────────────────
INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT 'dd000000-0000-0002-0000-000000000001', id, 100 FROM plateforme.flux_dechets WHERE code = 'verre';
SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes WHERE id = 'dd000000-0000-0002-0000-000000000001'),
  NULL::decimal,
  'ZD en cours : une pesée écrite ne calcule rien tant que la collecte n''est pas réalisée'
);

-- Passage à realisee (l'adapter dérive les pesées juste avant) : calcul.
UPDATE plateforme.collectes SET statut = 'realisee', realisee_at = now()
WHERE id = 'dd000000-0000-0002-0000-000000000001';
SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes WHERE id = 'dd000000-0000-0002-0000-000000000001'),
  115.80::decimal,
  'ZD : passage à réalisée → CO₂ calculé sur les pesées déjà là'
);

-- ── ZD clôturée : la correction Admin recalcule aussi ───────────────────────
INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT 'dd000000-0000-0003-0000-000000000001', id, 100 FROM plateforme.flux_dechets WHERE code = 'verre';
SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes WHERE id = 'dd000000-0000-0003-0000-000000000001'),
  115.80::decimal,
  'ZD clôturée : pesée saisie après la clôture → CO₂ recalculé'
);

-- ── AG : le poids saisi donne les repas, puis le CO₂ ────────────────────────
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, realisee_at)
VALUES
  ('dd000000-0000-0004-0000-000000000001', 'dd000000-0000-0000-0000-000000000006', 'anti_gaspi', 'realisee', 'non_envoye', '2026-06-15', '20:00', now() - interval '2 hours'),
  ('dd000000-0000-0005-0000-000000000001', 'dd000000-0000-0000-0000-000000000006', 'anti_gaspi', 'validee',  'non_envoye', '2026-06-15', '20:00', NULL);
INSERT INTO plateforme.attributions_antgaspi (id, collecte_id, association_id, transporteur_id, branche_attribution, mode_validation)
VALUES
  ('dd000000-0000-0004-0000-000000000002', 'dd000000-0000-0004-0000-000000000001', 'dd000000-0000-0000-0000-000000000007', 'dd000000-0000-0000-0000-000000000008', 'ag_velo_idf', 'manuel_top1'),
  ('dd000000-0000-0005-0000-000000000002', 'dd000000-0000-0005-0000-000000000001', 'dd000000-0000-0000-0000-000000000007', 'dd000000-0000-0000-0000-000000000008', 'ag_velo_idf', 'manuel_top1');

UPDATE plateforme.attributions_antgaspi SET poids_repas_kg = 45
WHERE id = 'dd000000-0000-0004-0000-000000000002';
SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes WHERE id = 'dd000000-0000-0004-0000-000000000001'),
  250.000::decimal,
  'AG réalisée : 45 kg saisis → 100 repas → CO₂ évité 250 kg, sans attendre la clôture'
);

UPDATE plateforme.attributions_antgaspi SET poids_repas_kg = 90
WHERE id = 'dd000000-0000-0004-0000-000000000002';
SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes WHERE id = 'dd000000-0000-0004-0000-000000000001'),
  500.000::decimal,
  'AG réalisée : poids corrigé à 90 kg → 200 repas → CO₂ recalculé à 500 kg'
);

UPDATE plateforme.attributions_antgaspi SET poids_repas_kg = 45
WHERE id = 'dd000000-0000-0005-0000-000000000002';
SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes WHERE id = 'dd000000-0000-0005-0000-000000000001'),
  NULL::decimal,
  'AG validée (pas encore réalisée) : un poids saisi ne calcule rien'
);

-- ── Pesée déplacée d'une collecte à une autre : les deux sont recalculées ───
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, realisee_at)
VALUES ('dd000000-0000-0006-0000-000000000001', 'dd000000-0000-0000-0000-000000000006', 'zero_dechet', 'realisee', 'non_envoye', '2026-06-15', '20:00', now() - interval '2 hours');
UPDATE plateforme.collecte_flux SET collecte_id = 'dd000000-0000-0006-0000-000000000001'
WHERE collecte_id = 'dd000000-0000-0001-0000-000000000001';
SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes WHERE id = 'dd000000-0000-0001-0000-000000000001'),
  NULL::decimal,
  'ZD : pesée déplacée vers une autre collecte → l''ancienne n''a plus de pesée, son CO₂ est remis à vide'
);
SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes WHERE id = 'dd000000-0000-0006-0000-000000000001'),
  231.60::decimal,
  'ZD : pesée déplacée → la nouvelle collecte est recalculée'
);

-- ── Sous le rôle authenticated : client propriétaire ────────────────────────
-- Collecte AG clôturée avec son attribution, pour les écritures ci-dessous.
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, realisee_at)
VALUES ('dd000000-0000-0007-0000-000000000001', 'dd000000-0000-0000-0000-000000000006', 'anti_gaspi', 'cloturee', 'non_envoye', '2026-06-15', '20:00', now() - interval '3 days');
INSERT INTO plateforme.attributions_antgaspi (id, collecte_id, association_id, transporteur_id, branche_attribution, mode_validation)
VALUES ('dd000000-0000-0007-0000-000000000002', 'dd000000-0000-0007-0000-000000000001', 'dd000000-0000-0000-0000-000000000007', 'dd000000-0000-0000-0000-000000000008', 'ag_velo_idf', 'manuel_top1');

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims',
  '{"sub":"dd000000-0000-0000-0000-000000000002","user_role":"traiteur_manager","organisation_id":"dd000000-0000-0000-0000-000000000001"}', true);

SELECT throws_ok(
  $$ SELECT plateforme.fn_calculer_co2_zd('dd000000-0000-0003-0000-000000000001') $$,
  '42501', NULL,
  'client : fn_calculer_co2_zd refusée (permission denied)'
);
SELECT throws_ok(
  $$ SELECT plateforme.fn_calculer_co2_ag('dd000000-0000-0007-0000-000000000001') $$,
  '42501', NULL,
  'client : fn_calculer_co2_ag refusée (permission denied)'
);
-- Écritures que la RLS ne lui ouvre pas : aucune ligne touchée.
UPDATE plateforme.collecte_flux SET poids_reel_kg = 999
WHERE collecte_id = 'dd000000-0000-0003-0000-000000000001';
DELETE FROM plateforme.collecte_flux
WHERE collecte_id = 'dd000000-0000-0003-0000-000000000001';
UPDATE plateforme.attributions_antgaspi SET poids_repas_kg = 999
WHERE id = 'dd000000-0000-0007-0000-000000000002';

RESET role;
SELECT set_config('request.jwt.claims', NULL, true);
SELECT is(
  (SELECT poids_reel_kg FROM plateforme.collecte_flux
   WHERE collecte_id = 'dd000000-0000-0003-0000-000000000001'),
  100::decimal,
  'client : UPDATE et DELETE d''une pesée de sa collecte clôturée → 0 ligne, pesée intacte'
);
SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes WHERE id = 'dd000000-0000-0003-0000-000000000001'),
  115.80::decimal,
  'client : le CO₂ de sa collecte clôturée n''a pas bougé'
);
SELECT is(
  (SELECT poids_repas_kg FROM plateforme.attributions_antgaspi WHERE id = 'dd000000-0000-0007-0000-000000000002'),
  NULL::decimal,
  'client : UPDATE du poids AG → 0 ligne'
);

-- ── Sous le rôle authenticated : client d'une autre organisation ────────────
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims',
  '{"sub":"ee000000-0000-0000-0000-000000000002","user_role":"traiteur_manager","organisation_id":"ee000000-0000-0000-0000-000000000001"}', true);
SELECT is(
  (SELECT count(*)::int FROM plateforme.collecte_flux WHERE collecte_id::text LIKE 'dd000000-%'),
  0,
  'autre organisation : aucune pesée visible'
);
SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes WHERE id::text LIKE 'dd000000-%'),
  0,
  'autre organisation : aucune collecte visible'
);
SELECT is(
  (SELECT count(*)::int FROM plateforme.bordereaux_savr WHERE collecte_id::text LIKE 'dd000000-%'),
  0,
  'autre organisation : aucun bordereau visible'
);

-- ── Sous le rôle authenticated : équipe Savr, la correction recalcule ───────
SELECT set_config('request.jwt.claims',
  '{"sub":"dd000000-0000-0000-0000-000000000002","user_role":"ops_savr","organisation_id":"dd000000-0000-0000-0000-000000000001"}', true);
UPDATE plateforme.collecte_flux SET poids_reel_kg = 200
WHERE collecte_id = 'dd000000-0000-0003-0000-000000000001';
UPDATE plateforme.attributions_antgaspi SET poids_repas_kg = 45
WHERE id = 'dd000000-0000-0007-0000-000000000002';
SELECT set_config('request.jwt.claims',
  '{"sub":"dd000000-0000-0000-0000-000000000002","user_role":"admin_savr","organisation_id":"dd000000-0000-0000-0000-000000000001"}', true);
INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT 'dd000000-0000-0006-0000-000000000001', id, 50 FROM plateforme.flux_dechets WHERE code = 'carton';

RESET role;
SELECT set_config('request.jwt.claims', NULL, true);
SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes WHERE id = 'dd000000-0000-0003-0000-000000000001'),
  231.60::decimal,
  'ops_savr (authenticated) : pesée corrigée sur collecte clôturée → CO₂ recalculé, sans erreur de droits'
);
SELECT is(
  (SELECT co2_evite_kg FROM plateforme.collectes WHERE id = 'dd000000-0000-0007-0000-000000000001'),
  250.000::decimal,
  'ops_savr (authenticated) : poids AG saisi sur collecte clôturée → CO₂ recalculé'
);
SELECT ok(
  (SELECT co2_evite_kg FROM plateforme.collectes WHERE id = 'dd000000-0000-0006-0000-000000000001') > 231.60,
  'admin_savr (authenticated) : pesée ajoutée → CO₂ recalculé avec elle'
);

-- ── Calculs fermés aux rôles clients ────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'plateforme.fn_calculer_co2_zd(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'plateforme.fn_calculer_co2_zd(uuid)', 'EXECUTE'),
  'fn_calculer_co2_zd : non exécutable par authenticated ni anon'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'plateforme.fn_calculer_co2_ag(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'plateforme.fn_calculer_co2_ag(uuid)', 'EXECUTE'),
  'fn_calculer_co2_ag : non exécutable par authenticated ni anon'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'plateforme.fn_trg_co2_zd_pesees()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'plateforme.fn_trg_co2_zd_pesees()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'plateforme.fn_trg_co2_ag_repas()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'plateforme.fn_trg_co2_ag_repas()', 'EXECUTE'),
  'fonctions des deux nouveaux triggers : non exécutables par authenticated ni anon'
);

SELECT * FROM finish();
ROLLBACK;

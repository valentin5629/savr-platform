-- pgTAP R11 — Reste de l'algo attribution AG (BL-P1-ALGO-01, 03, 06)
-- Tests : top 3 transporteurs province, audit attribution_manuelle_aucune_reco,
--         évaluation auto-accept (déclenchement + SINON + valide_par NULL).

BEGIN;
SELECT plan(11);

CREATE OR REPLACE FUNCTION test_as_superuser_r11()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

SELECT test_as_superuser_r11();

-- ── Fixtures ───────────────────────────────────────────────────────────────

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES ('b1000000-0000-0000-0000-000000000001'::uuid, 'OrgR11', 'OrgR11 SARL', 'traiteur', '77700000000000', true);

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('b1000000-0000-0000-0000-000000000011'::uuid, 'b1000000-0000-0000-0000-000000000001'::uuid,
  'OrgR11 SARL', '77700000000000', '1 Rue R11', '75001', 'Paris');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('b1000000-0000-0000-0000-000000000010'::uuid, 'b1000000-0000-0000-0000-000000000001'::uuid,
  'admin-r11@test.test', 'Admin', 'R11', 'admin_savr');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('b1000000-0000-0000-0000-000000000009'::uuid, 'GALA_R11', 'Gala R11', 1, true);

-- Lieu province (Rouen) + lieu IDF (Paris)
INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max, latitude, longitude, region)
VALUES
  ('b1000000-0000-0000-0000-000000000020'::uuid, 'Lieu Province R11', '5 Quai Rouen', 'Rouen', '76000', 'poids_lourd', 49.4431, 1.0993, 'province'),
  ('b1000000-0000-0000-0000-000000000021'::uuid, 'Lieu IDF R11', '1 Rue Rivoli', 'Paris', '75001', 'camionnette', 48.8566, 2.3522, 'idf');

-- 3 transporteurs province (mts1) à distances croissantes du lieu Rouen
INSERT INTO plateforme.transporteurs (id, nom, siren, adresse, code_postal, ville, type_tms, actif, contact_nom, contact_email, contact_telephone, types_vehicules, latitude, longitude)
VALUES
  ('b1000000-0000-0000-0000-000000000040'::uuid, 'ProvA R11', '111111111', '1 Quai', '76000', 'Rouen', 'mts1', true, 'A', 'a@t.test', '0600000001', ARRAY['fourgon'], 49.4431, 1.0993),
  ('b1000000-0000-0000-0000-000000000041'::uuid, 'ProvB R11', '222222222', '2 Quai', '76100', 'Rouen', 'mts1', true, 'B', 'b@t.test', '0600000002', ARRAY['fourgon'], 49.4631, 1.1593),
  ('b1000000-0000-0000-0000-000000000042'::uuid, 'ProvC R11', '333333333', '3 Quai', '76200', 'Rouen', 'mts1', true, 'C', 'c@t.test', '0600000003', ARRAY['fourgon'], 49.5031, 1.2593);

-- Prestataires shared correspondants (rayon NULL = pas de filtre rayon)
INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, siret, statut, nb_collectes_6_mois_cache)
VALUES
  ('b1000000-0000-0000-0000-000000000050'::uuid, 'ProvA R11', 'PROVA_R11', ARRAY['ag'], 'mts1', '111111111012345', 'actif', 2),
  ('b1000000-0000-0000-0000-000000000051'::uuid, 'ProvB R11', 'PROVB_R11', ARRAY['ag'], 'mts1', '222222222012345', 'actif', 4),
  ('b1000000-0000-0000-0000-000000000052'::uuid, 'ProvC R11', 'PROVC_R11', ARRAY['ag'], 'mts1', '333333333012345', 'actif', 1)
ON CONFLICT (id) DO NOTHING;

-- Marathon IDF (pour auto-accept nuit) + pont prestataire
INSERT INTO plateforme.transporteurs (id, nom, siren, adresse, code_postal, ville, type_tms, actif, contact_nom, contact_email, contact_telephone, types_vehicules, latitude, longitude)
VALUES ('b1000000-0000-0000-0000-000000000043'::uuid, 'Marathon R11', '444444444', '4 Rue', '75020', 'Paris', 'mts1', true, 'M', 'm@t.test', '0600000004', ARRAY['fourgon','poids_lourd'], 48.8616, 2.3722);

INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, siret, statut)
VALUES ('b1000000-0000-0000-0000-000000000053'::uuid, 'Marathon R11', 'MARA_R11', ARRAY['ag'], 'mts1', '444444444012345', 'actif')
ON CONFLICT (id) DO NOTHING;

UPDATE plateforme.transporteurs
  SET prestataire_logistique_id = 'b1000000-0000-0000-0000-000000000053'::uuid
  WHERE id = 'b1000000-0000-0000-0000-000000000043'::uuid;

-- §05 R2 filtres province : transporteur ZD-only (prestataire sans 'ag') au lieu
-- Rouen (distance 0 → serait top1 SI éligible) — doit être EXCLU du top 3.
INSERT INTO plateforme.transporteurs (id, nom, siren, adresse, code_postal, ville, type_tms, actif, contact_nom, contact_email, contact_telephone, types_vehicules, latitude, longitude)
VALUES ('b1000000-0000-0000-0000-000000000044'::uuid, 'ProvZD R11', '555555555', '0 Quai', '76000', 'Rouen', 'mts1', true, 'Z', 'z@t.test', '0600000005', ARRAY['fourgon'], 49.4431, 1.0993);
INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, siret, statut, nb_collectes_6_mois_cache)
VALUES ('b1000000-0000-0000-0000-000000000054'::uuid, 'ProvZD R11', 'PROVZD_R11', ARRAY['zd'], 'mts1', '555555555012345', 'actif', 0)
ON CONFLICT (id) DO NOTHING;

-- §05 R2 compat véhicule : lieu province ÉTROIT (type_vehicule_max='camionnette')
-- situé à LYON (loin de Rouen, pour ne pas polluer le top 3 de la collecte 080).
-- Transporteur 'poids_lourd' (incompatible, EXCLU) vs 'camionnette' (OK).
INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max, latitude, longitude, region)
VALUES ('b1000000-0000-0000-0000-000000000022'::uuid, 'Lieu Province Étroit', '9 Ruelle', 'Lyon', '69001', 'camionnette', 45.7640, 4.8357, 'province');
INSERT INTO plateforme.transporteurs (id, nom, siren, adresse, code_postal, ville, type_tms, actif, contact_nom, contact_email, contact_telephone, types_vehicules, latitude, longitude)
VALUES
  ('b1000000-0000-0000-0000-000000000045'::uuid, 'ProvBig R11', '666666666', '1 Quai', '69001', 'Lyon', 'mts1', true, 'BG', 'bg@t.test', '0600000006', ARRAY['poids_lourd'], 45.7640, 4.8357),
  ('b1000000-0000-0000-0000-000000000046'::uuid, 'ProvSmall R11', '777777777', '2 Quai', '69001', 'Lyon', 'mts1', true, 'SM', 'sm@t.test', '0600000007', ARRAY['camionnette'], 45.7640, 4.8357);
INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, siret, statut, nb_collectes_6_mois_cache)
VALUES
  ('b1000000-0000-0000-0000-000000000055'::uuid, 'ProvBig R11', 'PROVBIG_R11', ARRAY['ag'], 'mts1', '666666666012345', 'actif', 0),
  ('b1000000-0000-0000-0000-000000000056'::uuid, 'ProvSmall R11', 'PROVSMALL_R11', ARRAY['ag'], 'mts1', '777777777012345', 'actif', 0)
ON CONFLICT (id) DO NOTHING;

-- Associations : 1 province (Rouen) + 2 IDF (A = la plus proche, B = config auto-accept différente)
INSERT INTO plateforme.associations (id, nom, adresse, ville, region, contact_email, capacite_max_beneficiaires, actif, description_rapport_impact, latitude, longitude)
VALUES
  ('b1000000-0000-0000-0000-000000000060'::uuid, 'Asso Province R11', '1 Rue', 'Rouen', 'province', 'p@asso.test', 800, true, 'Association province Normandie pour les tests R11 algo.', 49.4431, 1.0993),
  ('b1000000-0000-0000-0000-000000000061'::uuid, 'Asso IDF A R11', '2 Rue', 'Paris', 'idf', 'a@asso.test', 800, true, 'Association IDF A proche pour tests auto-accept R11.', 48.8606, 2.3600),
  ('b1000000-0000-0000-0000-000000000062'::uuid, 'Asso IDF B R11', '3 Rue', 'Paris', 'idf', 'b@asso.test', 800, true, 'Association IDF B lointaine pour tests auto-accept R11.', 48.8900, 2.4500);

-- Événements + collectes
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES
  -- province
  ('b1000000-0000-0000-0000-000000000070'::uuid, 'b1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-000000000001'::uuid,
   'b1000000-0000-0000-0000-000000000011'::uuid, 'b1000000-0000-0000-0000-000000000010'::uuid,
   'b1000000-0000-0000-0000-000000000020'::uuid, 'b1000000-0000-0000-0000-000000000009'::uuid, CURRENT_DATE + 7, 200, 'C', '0600000099'),
  -- IDF (auto-accept)
  ('b1000000-0000-0000-0000-000000000071'::uuid, 'b1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-000000000001'::uuid,
   'b1000000-0000-0000-0000-000000000011'::uuid, 'b1000000-0000-0000-0000-000000000010'::uuid,
   'b1000000-0000-0000-0000-000000000021'::uuid, 'b1000000-0000-0000-0000-000000000009'::uuid, CURRENT_DATE + 7, 200, 'C', '0600000099'),
  -- province lieu étroit (camionnette max) — test compat véhicule
  ('b1000000-0000-0000-0000-000000000072'::uuid, 'b1000000-0000-0000-0000-000000000001'::uuid, 'b1000000-0000-0000-0000-000000000001'::uuid,
   'b1000000-0000-0000-0000-000000000011'::uuid, 'b1000000-0000-0000-0000-000000000010'::uuid,
   'b1000000-0000-0000-0000-000000000022'::uuid, 'b1000000-0000-0000-0000-000000000009'::uuid, CURRENT_DATE + 7, 200, 'C', '0600000099');

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
VALUES
  -- province (heure 10:00) — top 3 transporteurs
  ('b1000000-0000-0000-0000-000000000080'::uuid, 'b1000000-0000-0000-0000-000000000070'::uuid, 'anti_gaspi', 'programmee', 'non_envoye', CURRENT_DATE + 7, '10:00', 200),
  -- IDF nuit (22:00 → Marathon) pour auto-accept déclenché
  ('b1000000-0000-0000-0000-000000000081'::uuid, 'b1000000-0000-0000-0000-000000000071'::uuid, 'anti_gaspi', 'programmee', 'non_envoye', CURRENT_DATE + 7, '22:00', 200),
  -- IDF nuit pour auto-accept NON déclenché (config sur asso B mais top1 = asso A)
  ('b1000000-0000-0000-0000-000000000082'::uuid, 'b1000000-0000-0000-0000-000000000071'::uuid, 'anti_gaspi', 'programmee', 'non_envoye', CURRENT_DATE + 7, '22:00', 200),
  -- province lieu étroit (camionnette) — test compat véhicule
  ('b1000000-0000-0000-0000-000000000083'::uuid, 'b1000000-0000-0000-0000-000000000072'::uuid, 'anti_gaspi', 'programmee', 'non_envoye', CURRENT_DATE + 7, '10:00', 200);

-- ═══════════════════════════════════════════════════════════════════════════
-- BL-P1-ALGO-01 : top 3 transporteurs province
-- ═══════════════════════════════════════════════════════════════════════════

-- R11-T1 : la clé `transporteurs` contient 3 entrées (top 3)
SELECT is(
  jsonb_array_length(
    (plateforme.fn_calculer_algo_attribution_ag('b1000000-0000-0000-0000-000000000080'::uuid))->'transporteurs'
  ),
  3,
  'R11-T1 : province → 3 transporteurs (top 3) dans `transporteurs`'
);

-- R11-T2 : top 1 = le plus proche (ProvA, distance ~0)
SELECT is(
  ((plateforme.fn_calculer_algo_attribution_ag('b1000000-0000-0000-0000-000000000080'::uuid))->'transporteurs'->0->>'id')::uuid,
  'b1000000-0000-0000-0000-000000000040'::uuid,
  'R11-T2 : top 1 province = transporteur le plus proche (ProvA)'
);

-- R11-T3 : `transporteur` (top 1, rétro-compat) cohérent avec transporteurs[0]
SELECT is(
  ((plateforme.fn_calculer_algo_attribution_ag('b1000000-0000-0000-0000-000000000080'::uuid))->'transporteur'->>'id')::uuid,
  'b1000000-0000-0000-0000-000000000040'::uuid,
  'R11-T3 : `transporteur` top 1 = transporteurs[0] (rétro-compat)'
);

-- R11-T4 : branche province inchangée
SELECT is(
  (plateforme.fn_calculer_algo_attribution_ag('b1000000-0000-0000-0000-000000000080'::uuid))->>'branche',
  'ag_province_proximite',
  'R11-T4 : branche province reste ag_province_proximite'
);

-- R11-T4b : §05 R2 — transporteur ZD-only (prestataire sans 'ag') exclu du top 3
-- (ProvZD est à distance 0 → serait top1 SI le filtre type_prestation manquait)
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      (plateforme.fn_calculer_algo_attribution_ag('b1000000-0000-0000-0000-000000000080'::uuid))->'transporteurs'
    ) e
    WHERE (e->>'id')::uuid = 'b1000000-0000-0000-0000-000000000044'::uuid
  ),
  'R11-T4b : transporteur ZD-only (type_prestation sans ag) exclu du top 3 province'
);

-- R11-T4c : §05 R2 — compat véhicule. Lieu max=camionnette : ProvBig (poids_lourd)
-- exclu, ProvSmall (camionnette) inclus.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      (plateforme.fn_calculer_algo_attribution_ag('b1000000-0000-0000-0000-000000000083'::uuid))->'transporteurs'
    ) e
    WHERE (e->>'id')::uuid = 'b1000000-0000-0000-0000-000000000045'::uuid
  )
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      (plateforme.fn_calculer_algo_attribution_ag('b1000000-0000-0000-0000-000000000083'::uuid))->'transporteurs'
    ) e
    WHERE (e->>'id')::uuid = 'b1000000-0000-0000-0000-000000000046'::uuid
  ),
  'R11-T4c : compat véhicule — poids_lourd exclu (lieu max camionnette), camionnette inclus'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- BL-P1-ALGO-03 : audit attribution_manuelle_aucune_reco
-- ═══════════════════════════════════════════════════════════════════════════

-- Créer une attribution puis logger l'audit aucune-reco
INSERT INTO plateforme.attributions_antgaspi (id, collecte_id, association_id, transporteur_id, branche_attribution, mode_validation)
VALUES ('b1000000-0000-0000-0000-000000000090'::uuid, 'b1000000-0000-0000-0000-000000000080'::uuid,
  'b1000000-0000-0000-0000-000000000060'::uuid, 'b1000000-0000-0000-0000-000000000040'::uuid, 'ag_province_proximite', 'manuel_top1');

SELECT lives_ok(
  $$SELECT plateforme.rpc_log_attribution_aucune_reco(
      'b1000000-0000-0000-0000-000000000080'::uuid,
      'b1000000-0000-0000-0000-000000000090'::uuid,
      'b1000000-0000-0000-0000-000000000010'::uuid
    )$$,
  'R11-T5 : rpc_log_attribution_aucune_reco s''exécute'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM plateforme.audit_log
    WHERE table_name = 'attributions_antgaspi'
      AND record_id = 'b1000000-0000-0000-0000-000000000090'::uuid
      AND action = 'attribution_manuelle_aucune_reco'
      AND user_id = 'b1000000-0000-0000-0000-000000000010'::uuid
  ),
  'R11-T6 : audit_log contient attribution_manuelle_aucune_reco (user Admin)'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- BL-P1-ALGO-06 : évaluation auto-accept
-- ═══════════════════════════════════════════════════════════════════════════

-- Config active : org + asso IDF A (= top1 du lieu IDF) → déclenchement attendu
INSERT INTO plateforme.config_auto_accept_ag (id, organisation_id, association_id, auto_accept_actif)
VALUES ('b1000000-0000-0000-0000-0000000000a1'::uuid, 'b1000000-0000-0000-0000-000000000001'::uuid,
  'b1000000-0000-0000-0000-000000000061'::uuid, true);

-- R11-T7 : auto-accept déclenché → auto_accepted=true
SELECT is(
  (plateforme.rpc_evaluer_auto_accept_ag('b1000000-0000-0000-0000-000000000081'::uuid))->>'auto_accepted',
  'true',
  'R11-T7 : config match (org + asso top1) → auto_accepted=true'
);

-- R11-T8 : attribution créée en mode auto_accept + valide_par NULL (CDC §6)
SELECT is(
  (SELECT mode_validation::text || '|' || COALESCE(valide_par::text, 'NULL')
   FROM plateforme.attributions_antgaspi
   WHERE collecte_id = 'b1000000-0000-0000-0000-000000000081'::uuid),
  'auto_accept|NULL',
  'R11-T8 : attribution auto_accept avec valide_par NULL (zéro humain)'
);

-- R11-T9 : non-déclenchement — config sur asso B mais top1 du lieu = asso A
INSERT INTO plateforme.config_auto_accept_ag (id, organisation_id, association_id, auto_accept_actif)
VALUES ('b1000000-0000-0000-0000-0000000000a2'::uuid, 'b1000000-0000-0000-0000-000000000001'::uuid,
  'b1000000-0000-0000-0000-000000000062'::uuid, true);
-- NB : on retire la config asso A pour que la collecte 082 ne matche PAS
DELETE FROM plateforme.config_auto_accept_ag WHERE id = 'b1000000-0000-0000-0000-0000000000a1'::uuid;

SELECT is(
  (plateforme.rpc_evaluer_auto_accept_ag('b1000000-0000-0000-0000-000000000082'::uuid))->>'auto_accepted',
  'false',
  'R11-T9 : top1 (asso A) ≠ config (asso B) → auto_accepted=false (branche SINON)'
);

SELECT * FROM finish();
ROLLBACK;

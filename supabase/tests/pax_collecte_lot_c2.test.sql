-- =============================================================================
-- pgTAP — Lot C2 : pax de LA collecte (décisions Val du 2026-10-24)
-- Migration : 20261025100000_plateforme_pax_collecte_lot_c2.sql
-- =============================================================================
-- Chaque fixture fait différer la collecte de son événement (le pax de
-- l'événement est calculé : par jour, max(Σ ZD, Σ AG), puis somme des jours).
--
--   ALGO (Q2)    : une collecte AG de 300 convives dans un événement de 900
--                  ne passe plus en branche grand volume ; nb_pax = 300.
--   AUTO (Q2)    : la fourchette de pax de config_auto_accept_ag se lit sur la
--                  collecte (300 dans 200–400 : déclenché ; 300 hors 800–1000 :
--                  non déclenché, alors que l'événement, à 900, y est).
--   LABO (Q6)    : coefficient de l'année de l'événement − 1, sans repli ; pax
--                  de l'événement 0 → NULL (arbitrage Val du 2026-09-21).
--   BORDEREAU    : refait au SIRET d'un traiteur shadow, il imprime les
--   (Q5)           convives de la collecte (300, pas 1 200) ; 0 → null.
--
-- Dates relatives (CURRENT_DATE + n) : aucune échéance figée dans le test.
-- =============================================================================

BEGIN;
SELECT plan(16);

CREATE OR REPLACE FUNCTION test_c2_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

CREATE OR REPLACE FUNCTION test_c2_jwt(p_role text, p_org_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(),
    'role', 'authenticated',
    'user_role', p_role,
    'organisation_id', p_org_id,
    'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

SELECT test_c2_superuser();

-- ── Référentiel ──────────────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, est_shadow, cree_par_organisation_id)
VALUES
  ('c2c20000-0000-0000-0000-000000000001'::uuid, 'C2 Traiteur', 'C2 Traiteur SAS', 'traiteur', '77720000000001', true, false, NULL),
  ('c2c20000-0000-0000-0000-000000000002'::uuid, 'C2 Traiteur Bis', 'C2 Traiteur Bis SAS', 'traiteur', '77720000000002', true, false, NULL),
  ('c2c20000-0000-0000-0000-000000000003'::uuid, 'C2 Gestionnaire', 'C2 Gestionnaire SA', 'gestionnaire_lieux', '77720000000003', true, false, NULL),
  ('c2c20000-0000-0000-0000-000000000004'::uuid, 'C2 Agence', 'C2 Agence SAS', 'agence', '77720000000004', true, false, NULL),
  ('c2c20000-0000-0000-0000-000000000005'::uuid, 'C2 Shadow', 'C2 Shadow SARL', 'traiteur', NULL, true, true,
   'c2c20000-0000-0000-0000-000000000004'::uuid),
  ('c2c20000-0000-0000-0000-000000000006'::uuid, 'C2 Autre Gest', 'C2 Autre Gest SA', 'gestionnaire_lieux', '77720000000006', true, false, NULL);

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('c2c20000-0000-0000-0000-000000000011'::uuid, 'c2c20000-0000-0000-0000-000000000001'::uuid,
        'C2 Traiteur SAS', '77720000000001', '1 rue C2', '75008', 'Paris');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('c2c20000-0000-0000-0000-000000000012'::uuid, 'c2c20000-0000-0000-0000-000000000001'::uuid,
        'admin-c2@test.test', 'Admin', 'C2', 'admin_savr');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('c2c20000-0000-0000-0000-000000000013'::uuid, 'GALA_C2', 'Gala C2', 1, true);

INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max, latitude, longitude, region)
VALUES ('c2c20000-0000-0000-0000-000000000020'::uuid, 'Lieu IDF C2', '1 av C2', 'Paris', '75008',
        'poids_lourd', 48.8700, 2.3100, 'idf');
INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('c2c20000-0000-0000-0000-000000000003'::uuid, 'c2c20000-0000-0000-0000-000000000020'::uuid);

-- Transporteur grand volume IDF (branche 2 et repli de la branche vélo).
INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, siret, statut)
VALUES ('c2c20000-0000-0000-0000-000000000030'::uuid, 'Marathon C2', 'MARA_C2', ARRAY['ag'], 'mts1', '777200000012345', 'actif')
ON CONFLICT (id) DO NOTHING;
INSERT INTO plateforme.transporteurs (id, nom, siren, adresse, code_postal, ville, type_tms, actif, contact_nom,
  contact_email, contact_telephone, types_vehicules, latitude, longitude, prestataire_logistique_id)
VALUES ('c2c20000-0000-0000-0000-000000000031'::uuid, 'Marathon C2', '777200000', '4 rue C2', '75020', 'Paris',
  'mts1', true, 'M', 'm@c2.test', '0600000201', ARRAY['fourgon','poids_lourd'], 48.8616, 2.3722,
  'c2c20000-0000-0000-0000-000000000030'::uuid);

-- Une seule association active : le top 1 de l'algorithme est connu.
UPDATE plateforme.associations SET actif = false WHERE actif = true;
INSERT INTO plateforme.associations (id, nom, adresse, ville, region, contact_email, capacite_max_beneficiaires,
  actif, description_rapport_impact, latitude, longitude)
VALUES ('c2c20000-0000-0000-0000-000000000040'::uuid, 'Asso C2', '2 rue C2', 'Paris', 'idf', 'asso@c2.test', 800,
  true, 'Association IDF des tests du lot C2 (pax de la collecte).', 48.8710, 2.3150);

-- Coefficients labo : C2 Traiteur pour l'année − 1 (0,15) ET pour l'année de
-- l'événement (0,50, la plus récente) ; C2 Traiteur Bis pour l'année seule.
INSERT INTO plateforme.coefficients_perte_labo (id, organisation_id, annee_reference, coefficient_kg_couvert, saisi_par)
VALUES
  ('c2c20000-0000-0000-0000-000000000050'::uuid, 'c2c20000-0000-0000-0000-000000000001'::uuid,
   EXTRACT(YEAR FROM CURRENT_DATE + 7)::int - 1, 0.1500, 'c2c20000-0000-0000-0000-000000000012'::uuid),
  ('c2c20000-0000-0000-0000-000000000051'::uuid, 'c2c20000-0000-0000-0000-000000000001'::uuid,
   EXTRACT(YEAR FROM CURRENT_DATE + 7)::int, 0.5000, 'c2c20000-0000-0000-0000-000000000012'::uuid),
  ('c2c20000-0000-0000-0000-000000000052'::uuid, 'c2c20000-0000-0000-0000-000000000002'::uuid,
   EXTRACT(YEAR FROM CURRENT_DATE + 7)::int, 0.2000, 'c2c20000-0000-0000-0000-000000000012'::uuid);

-- ── Événements (pax posé à 0 : il est recalculé depuis les collectes) ────────
INSERT INTO plateforme.evenements (id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, pax, contact_principal_nom, contact_principal_telephone)
SELECT e.id::uuid, 'c2c20000-0000-0000-0000-000000000001'::uuid, e.traiteur::uuid,
       'c2c20000-0000-0000-0000-000000000011'::uuid, 'c2c20000-0000-0000-0000-000000000012'::uuid,
       'c2c20000-0000-0000-0000-000000000020'::uuid, 'c2c20000-0000-0000-0000-000000000013'::uuid,
       0, 'Contact C2', '0600000202'
FROM (VALUES
  ('c2c20000-0000-0000-0000-0000000000e1', 'c2c20000-0000-0000-0000-000000000001'),  -- E1 : ZD 900 + 2 AG 300
  ('c2c20000-0000-0000-0000-0000000000e2', 'c2c20000-0000-0000-0000-000000000001'),  -- E2 : AG 700 (contrôle)
  ('c2c20000-0000-0000-0000-0000000000e3', 'c2c20000-0000-0000-0000-000000000001'),  -- E3 : ZD 400 (labo)
  ('c2c20000-0000-0000-0000-0000000000e4', 'c2c20000-0000-0000-0000-000000000002'),  -- E4 : ZD 400, Traiteur Bis
  ('c2c20000-0000-0000-0000-0000000000e5', 'c2c20000-0000-0000-0000-000000000001'),  -- E5 : ZD 250 puis 0
  ('c2c20000-0000-0000-0000-0000000000e6', 'c2c20000-0000-0000-0000-000000000005')   -- E6 : traiteur shadow
) AS e(id, traiteur);

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte,
  type_evenement_id, pax)
SELECT c.id::uuid, c.evt::uuid, c.type::plateforme.collecte_type, 'programmee', 'non_envoye',
       CURRENT_DATE + c.jour, '14:00', 'c2c20000-0000-0000-0000-000000000013'::uuid, c.pax
FROM (VALUES
  ('c2c20000-0000-0000-0000-0000000000a1', 'c2c20000-0000-0000-0000-0000000000e1', 'zero_dechet', 7, 900),
  ('c2c20000-0000-0000-0000-0000000000a2', 'c2c20000-0000-0000-0000-0000000000e1', 'anti_gaspi', 7, 300),
  ('c2c20000-0000-0000-0000-0000000000a3', 'c2c20000-0000-0000-0000-0000000000e1', 'anti_gaspi', 7, 300),
  ('c2c20000-0000-0000-0000-0000000000a4', 'c2c20000-0000-0000-0000-0000000000e2', 'anti_gaspi', 7, 700),
  ('c2c20000-0000-0000-0000-0000000000a5', 'c2c20000-0000-0000-0000-0000000000e3', 'zero_dechet', 7, 400),
  ('c2c20000-0000-0000-0000-0000000000a6', 'c2c20000-0000-0000-0000-0000000000e4', 'zero_dechet', 7, 400),
  ('c2c20000-0000-0000-0000-0000000000a7', 'c2c20000-0000-0000-0000-0000000000e5', 'zero_dechet', 7, 250),
  -- E6 : deux soirées (900 puis 300) et une troisième collecte à 0 convive.
  ('c2c20000-0000-0000-0000-0000000000b1', 'c2c20000-0000-0000-0000-0000000000e6', 'zero_dechet', 7, 900),
  ('c2c20000-0000-0000-0000-0000000000b2', 'c2c20000-0000-0000-0000-0000000000e6', 'zero_dechet', 8, 300),
  ('c2c20000-0000-0000-0000-0000000000b3', 'c2c20000-0000-0000-0000-0000000000e6', 'zero_dechet', 9, 120)
) AS c(id, evt, type, jour, pax);
-- Le déclencheur remplace un 0 inséré par le pax de l'événement : le 0
-- (inconnu, reprise Bubble) s'écrit après l'insertion.
UPDATE plateforme.collectes SET pax = 0 WHERE id = 'c2c20000-0000-0000-0000-0000000000b3'::uuid;

-- C2-F : la fixture fait bien différer collecte et événement.
SELECT is(
  (SELECT array_agg(pax ORDER BY id) FROM plateforme.evenements
    WHERE id IN ('c2c20000-0000-0000-0000-0000000000e1'::uuid, 'c2c20000-0000-0000-0000-0000000000e6'::uuid)),
  ARRAY[900, 1200],
  'C2-F : événements à 900 (ZD 900 + AG 2 × 300 le même soir) et 1 200 (900 + 300, deux soirées)'
);

-- =============================================================================
-- ALGO — seuil grand volume et nb_pax sur la collecte AG (Q2)
-- =============================================================================
SELECT is(
  plateforme.fn_calculer_algo_attribution_ag('c2c20000-0000-0000-0000-0000000000a2'::uuid)->>'nb_pax',
  '300',
  'C2-ALGO-1 : nb_pax rendu = 300 convives de la collecte AG, pas 900 de l''événement'
);

SELECT ok(
  plateforme.fn_calculer_algo_attribution_ag('c2c20000-0000-0000-0000-0000000000a2'::uuid)->>'branche' LIKE 'ag_velo%',
  'C2-ALGO-2 : collecte AG de 300 convives (événement de 900), en journée IDF : branche vélo, pas grand volume'
);

SELECT is(
  plateforme.fn_calculer_algo_attribution_ag('c2c20000-0000-0000-0000-0000000000a4'::uuid)->>'branche',
  'ag_marathon_volume',
  'C2-ALGO-3 : contrôle, collecte AG de 700 convives en journée IDF : branche grand volume (seuil 600)'
);

-- =============================================================================
-- AUTO — fourchette de pax de l'auto-acceptation sur la collecte (Q2)
-- =============================================================================
INSERT INTO plateforme.config_auto_accept_ag (id, organisation_id, association_id, auto_accept_actif, seuil_pax_min, seuil_pax_max)
VALUES ('c2c20000-0000-0000-0000-000000000060'::uuid, 'c2c20000-0000-0000-0000-000000000001'::uuid,
        'c2c20000-0000-0000-0000-000000000040'::uuid, true, 200, 400);

SELECT is(
  plateforme.rpc_evaluer_auto_accept_ag('c2c20000-0000-0000-0000-0000000000a2'::uuid)->>'auto_accepted',
  'true',
  'C2-AUTO-1 : fourchette 200–400, collecte de 300 dans un événement de 900 : acceptée automatiquement'
);

DELETE FROM plateforme.config_auto_accept_ag WHERE id = 'c2c20000-0000-0000-0000-000000000060'::uuid;
INSERT INTO plateforme.config_auto_accept_ag (id, organisation_id, association_id, auto_accept_actif, seuil_pax_min, seuil_pax_max)
VALUES ('c2c20000-0000-0000-0000-000000000061'::uuid, 'c2c20000-0000-0000-0000-000000000001'::uuid,
        'c2c20000-0000-0000-0000-000000000040'::uuid, true, 800, 1000);

SELECT is(
  plateforme.rpc_evaluer_auto_accept_ag('c2c20000-0000-0000-0000-0000000000a3'::uuid)->>'reason',
  'no_config_match',
  'C2-AUTO-2 : fourchette 800–1000, collecte de 300 (événement de 900, dans la fourchette) : validation manuelle'
);

-- =============================================================================
-- LABO — année de l'événement − 1, pax 0 (Q6, arbitrage du 2026-09-21)
-- =============================================================================
SELECT test_c2_jwt('gestionnaire_lieux', 'c2c20000-0000-0000-0000-000000000003'::uuid);

SELECT is(
  plateforme.f_dechets_labo_estimes('c2c20000-0000-0000-0000-0000000000e3'::uuid),
  60.0000::numeric,
  'C2-LABO-1 : 400 convives × 0,15 (année − 1), pas 0,50 (année de l''événement, la plus récente)'
);

SELECT is(
  plateforme.f_dechets_labo_estimes('c2c20000-0000-0000-0000-0000000000e4'::uuid),
  NULL::numeric,
  'C2-LABO-2 : coefficient de l''année de l''événement seul, aucun pour l''année − 1 : NULL, sans repli'
);

SELECT test_c2_superuser();
UPDATE plateforme.collectes SET pax = 0 WHERE id = 'c2c20000-0000-0000-0000-0000000000a7'::uuid;
SELECT test_c2_jwt('gestionnaire_lieux', 'c2c20000-0000-0000-0000-000000000003'::uuid);

SELECT is(
  plateforme.f_dechets_labo_estimes('c2c20000-0000-0000-0000-0000000000e5'::uuid),
  NULL::numeric,
  'C2-LABO-3 : pax de l''événement 0 (inconnu) : NULL, pas 0 kg'
);

SELECT test_c2_superuser();
UPDATE plateforme.collectes SET pax = 250 WHERE id = 'c2c20000-0000-0000-0000-0000000000a7'::uuid;
SELECT test_c2_jwt('gestionnaire_lieux', 'c2c20000-0000-0000-0000-000000000003'::uuid);

SELECT is(
  plateforme.f_dechets_labo_estimes('c2c20000-0000-0000-0000-0000000000e5'::uuid),
  37.5000::numeric,
  'C2-LABO-4 : non-vacuité de C2-LABO-3, même événement remis à 250 convives : 37,5 kg'
);

SELECT test_c2_jwt('gestionnaire_lieux', 'c2c20000-0000-0000-0000-000000000006'::uuid);
SELECT is(
  plateforme.f_dechets_labo_estimes('c2c20000-0000-0000-0000-0000000000e3'::uuid),
  NULL::numeric,
  'C2-LABO-5 : gestionnaire d''un autre parc : NULL (garde de périmètre inchangée)'
);

SELECT test_c2_jwt('admin_savr', NULL);
SELECT is(
  plateforme.f_dechets_labo_estimes('c2c20000-0000-0000-0000-0000000000e3'::uuid),
  60.0000::numeric,
  'C2-LABO-6 : non-vacuité de C2-LABO-5, le staff lit 60 kg sur le même événement'
);

-- =============================================================================
-- BORDEREAU — refait au SIRET du traiteur shadow : convives de la collecte (Q5)
-- =============================================================================
SELECT test_c2_superuser();
INSERT INTO plateforme.bordereaux_savr (id, collecte_id, numero, producteur_raison_sociale, statut)
VALUES
  ('c2c20000-0000-0000-0000-000000000070'::uuid, 'c2c20000-0000-0000-0000-0000000000b2'::uuid, 'BSAV-C2-1', 'C2 Shadow SARL', 'brouillon'),
  ('c2c20000-0000-0000-0000-000000000071'::uuid, 'c2c20000-0000-0000-0000-0000000000b3'::uuid, 'BSAV-C2-2', 'C2 Shadow SARL', 'brouillon');

UPDATE plateforme.organisations SET siret = '83179309400017'
WHERE id = 'c2c20000-0000-0000-0000-000000000005'::uuid;

SELECT is(
  (SELECT statut::text FROM plateforme.bordereaux_savr WHERE id = 'c2c20000-0000-0000-0000-000000000070'::uuid),
  'emis',
  'C2-BORD-1 : contrôle, le SIRET arrivé finalise le bordereau brouillon'
);

SELECT is(
  (SELECT payload->'nb_pax' FROM plateforme.jobs_pdf
    WHERE entity_type = 'bordereaux_savr' AND entity_id = 'c2c20000-0000-0000-0000-000000000070'::uuid),
  '300'::jsonb,
  'C2-BORD-2 : bordereau refait de la 2e soirée : 300 convives de la collecte, pas 1 200 de l''événement'
);

SELECT is(
  (SELECT jsonb_typeof(payload->'nb_pax') FROM plateforme.jobs_pdf
    WHERE entity_type = 'bordereaux_savr' AND entity_id = 'c2c20000-0000-0000-0000-000000000071'::uuid),
  'null',
  'C2-BORD-3 : collecte à 0 convive (inconnu) : nb_pax null, la mention est omise'
);

-- =============================================================================
-- Propriétés que CREATE OR REPLACE peut défaire en silence
-- =============================================================================
SELECT is(
  (SELECT string_agg(p.proname || ':' || p.prosecdef || ':' || array_to_string(p.proconfig, ';'), ' | ' ORDER BY p.proname)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme'
      AND p.proname IN ('f_dechets_labo_estimes', 'fn_calculer_algo_attribution_ag', 'fn_trg_cerfa_debloque_siret')),
  'f_dechets_labo_estimes:true:search_path=plateforme, pg_catalog | '
  || 'fn_calculer_algo_attribution_ag:true:search_path=plateforme, public | '
  || 'fn_trg_cerfa_debloque_siret:true:search_path=plateforme, pg_catalog',
  'C2-SECU : SECURITY DEFINER et search_path des trois fonctions conservés'
);

SELECT * FROM finish();
ROLLBACK;

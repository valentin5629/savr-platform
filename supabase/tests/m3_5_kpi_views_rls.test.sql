-- M3.5 — Tests pgTAP vues KPI (couche commune)
-- Source : §11 §8/§9 + R_taux_recyclage + R_marge_zd_traiteur + R_revenus_imputation_organisation
--          + §04 f_benchmark_kg_pax_zd (k-anonymat, garde traiteur)
-- Couche : db — Priorité : P1-critique

BEGIN;

SELECT plan(10);

-- ─── Helpers JWT ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role    text,
  p_org_id  uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'role', p_role,
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

-- ─── Fixtures ────────────────────────────────────────────────────────────────

DO $$ BEGIN
  -- Organisations
  INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd) VALUES
    ('d0000000-0000-0000-0000-000000000001'::uuid, 'Kardamome', 'Kardamome SAS', 'traiteur', '12312312312301', true, 1.50),
    ('d0000000-0000-0000-0000-000000000002'::uuid, 'Kaspia',    'Kaspia SARL',   'traiteur', '12312312312302', true, 2.00),
    ('d0000000-0000-0000-0000-000000000003'::uuid, 'ClientOrg', 'ClientOrg SA',  'client_organisateur', '12312312312303', true, 0.00);

  -- Entités de facturation
  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
    ('d1000000-0000-0000-0000-000000000001'::uuid, 'd0000000-0000-0000-0000-000000000001'::uuid, 'Kardamome SAS', '12312312312301', '1 Rue K', '75001', 'Paris'),
    ('d1000000-0000-0000-0000-000000000002'::uuid, 'd0000000-0000-0000-0000-000000000002'::uuid, 'Kaspia SARL',   '12312312312302', '2 Rue K', '75002', 'Paris');

  -- Utilisateurs
  INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
    ('d2000000-0000-0000-0000-000000000001'::uuid, 'd0000000-0000-0000-0000-000000000001'::uuid, 'mgr-k@kpi-test.local', 'Mgr', 'K', 'traiteur_manager'),
    ('d2000000-0000-0000-0000-000000000002'::uuid, 'd0000000-0000-0000-0000-000000000002'::uuid, 'mgr-s@kpi-test.local', 'Mgr', 'S', 'traiteur_manager'),
    ('d2000000-0000-0000-0000-000000000003'::uuid, 'd0000000-0000-0000-0000-000000000001'::uuid, 'admin@kpi-test.local', 'Admin', 'Savr', 'admin_savr');

  -- Lieu
  INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region) VALUES
    ('d3000000-0000-0000-0000-000000000001'::uuid, 'Salle KPI', '1 Rue KPI', '75001', 'Paris', 'camionnette', 48.8566, 2.3522, 'idf');

  -- Type événement
  INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif) VALUES
    ('d4000000-0000-0000-0000-000000000001'::uuid, 'GALA_M35', 'Gala M3.5', 1, true);

  -- Événements Kardamome : E1 (pax=200) + E2 (pax=100)
  INSERT INTO plateforme.evenements (
    id, organisation_id, traiteur_operationnel_organisation_id,
    entite_facturation_id, created_by, lieu_id, type_evenement_id,
    nom_evenement, pax, contact_principal_nom, contact_principal_telephone,
    client_organisateur_organisation_id
  ) VALUES
    -- E1 : pax=200, avec client organisateur
    ('d5000000-0000-0000-0000-000000000001'::uuid,
     'd0000000-0000-0000-0000-000000000001'::uuid,
     'd0000000-0000-0000-0000-000000000001'::uuid,
     'd1000000-0000-0000-0000-000000000001'::uuid,
     'd2000000-0000-0000-0000-000000000001'::uuid,
     'd3000000-0000-0000-0000-000000000001'::uuid,
     'd4000000-0000-0000-0000-000000000001'::uuid,
     'Gala KPI E1', 200, 'Contact E1', '0600000001',
     'd0000000-0000-0000-0000-000000000003'::uuid),
    -- E2 : pax=100, même traiteur, sans client org
    ('d5000000-0000-0000-0000-000000000002'::uuid,
     'd0000000-0000-0000-0000-000000000001'::uuid,
     'd0000000-0000-0000-0000-000000000001'::uuid,
     'd1000000-0000-0000-0000-000000000001'::uuid,
     'd2000000-0000-0000-0000-000000000001'::uuid,
     'd3000000-0000-0000-0000-000000000001'::uuid,
     'd4000000-0000-0000-0000-000000000001'::uuid,
     'Gala KPI E2', 100, 'Contact E2', '0600000002',
     NULL),
    -- E3 : Kaspia (pour test cross-org)
    ('d5000000-0000-0000-0000-000000000003'::uuid,
     'd0000000-0000-0000-0000-000000000002'::uuid,
     'd0000000-0000-0000-0000-000000000002'::uuid,
     'd1000000-0000-0000-0000-000000000002'::uuid,
     'd2000000-0000-0000-0000-000000000002'::uuid,
     'd3000000-0000-0000-0000-000000000001'::uuid,
     'd4000000-0000-0000-0000-000000000001'::uuid,
     'Gala KPI E3 Kaspia', 150, 'Contact E3', '0600000003',
     NULL);

  -- Flux déchets : réutilise le flux seedé 'biodechet' (codes flux = liste fermée + ids non déterministes)

  -- Collectes ZD cloturees pour Kardamome (mois 2026-05)
  -- C1 : E1, taux_recyclage=80%, tonnage=100kg (via collecte_flux)
  -- C2 : E2, taux_recyclage=60%, tonnage=50kg
  -- C3 : E1, sans taux (pesées = 0) — exclue de la pondération
  INSERT INTO plateforme.collectes (
    id, evenement_id, type, statut,
    date_collecte, heure_collecte, taux_recyclage, co2_induit_kg, co2_evite_kg, co2_net_kg
  ) VALUES
    ('d7000000-0000-0000-0000-000000000001'::uuid,
     'd5000000-0000-0000-0000-000000000001'::uuid,
     'zero_dechet', 'cloturee',
     '2026-05-15', '08:00', 80.00, 10.00, 5.00, -5.00),
    ('d7000000-0000-0000-0000-000000000002'::uuid,
     'd5000000-0000-0000-0000-000000000002'::uuid,
     'zero_dechet', 'cloturee',
     '2026-05-20', '08:00', 60.00, 8.00, 3.00, -5.00),
    ('d7000000-0000-0000-0000-000000000003'::uuid,
     'd5000000-0000-0000-0000-000000000001'::uuid,
     'zero_dechet', 'cloturee',
     '2026-05-25', '08:00', NULL, 0.00, 0.00, 0.00);

  -- Collecte ZD cloturee pour Kaspia (même mois)
  INSERT INTO plateforme.collectes (
    id, evenement_id, type, statut,
    date_collecte, heure_collecte, taux_recyclage, co2_induit_kg, co2_evite_kg, co2_net_kg
  ) VALUES
    ('d7000000-0000-0000-0000-000000000004'::uuid,
     'd5000000-0000-0000-0000-000000000003'::uuid,
     'zero_dechet', 'cloturee',
     '2026-05-18', '08:00', 75.00, 6.00, 4.00, -2.00);

  -- Association + transporteur (requis pour attribution AG)
  INSERT INTO plateforme.associations (
    id, nom, adresse, region, ville, contact_email, description_rapport_impact
  ) VALUES (
    'da000000-0000-0000-0000-000000000001'::uuid,
    'Asso KPI', '1 Rue Asso', 'idf', 'Paris',
    'asso@kpi-test.local',
    'Association test pour les scénarios KPI M3.5 — fixtures pgTAP'
  );

  INSERT INTO plateforme.transporteurs (
    id, nom, siren, adresse, code_postal, ville,
    types_vehicules, type_tms,
    contact_nom, contact_email, contact_telephone
  ) VALUES (
    'db000000-0000-0000-0000-000000000001'::uuid,
    'Trans KPI', '123123123', '1 Rue Trans', '75001', 'Paris',
    ARRAY['camionnette'], 'autre',
    'Contact Trans', 'trans@kpi-test.local', '0600000099'
  );

  -- Collecte AG cloturee pour Kardamome
  INSERT INTO plateforme.collectes (
    id, evenement_id, type, statut,
    date_collecte, heure_collecte, co2_evite_kg
  ) VALUES
    ('d7000000-0000-0000-0000-000000000005'::uuid,
     'd5000000-0000-0000-0000-000000000001'::uuid,
     'anti_gaspi', 'cloturee',
     '2026-05-22', '08:00', 200.00);

  -- Attribution AG (volume_repas_realise vit ici, pas dans collectes)
  INSERT INTO plateforme.attributions_antgaspi (
    collecte_id, association_id, transporteur_id,
    branche_attribution, mode_validation, volume_repas_realise
  ) VALUES (
    'd7000000-0000-0000-0000-000000000005'::uuid,
    'da000000-0000-0000-0000-000000000001'::uuid,
    'db000000-0000-0000-0000-000000000001'::uuid,
    'branche_1', 'manuel_top1', 80
  );

  -- Poids réels ZD (collecte_flux) — flux seedé 'biodechet'
  INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg) VALUES
    ('d7000000-0000-0000-0000-000000000001'::uuid, (SELECT id FROM plateforme.flux_dechets WHERE code = 'biodechet'), 100.00),
    ('d7000000-0000-0000-0000-000000000002'::uuid, (SELECT id FROM plateforme.flux_dechets WHERE code = 'biodechet'), 50.00);
  -- C3 n'a pas de collecte_flux (pesées = 0)

  -- Facture ZD Kardamome liée à C1 (pour test marge)
  INSERT INTO plateforme.factures (
    id, organisation_id, entite_facturation_id, numero_facture, type,
    statut, date_emission, montant_ht, montant_tva, montant_ttc
  ) VALUES
    ('d9000000-0000-0000-0000-000000000001'::uuid,
     'd0000000-0000-0000-0000-000000000001'::uuid,
     'd1000000-0000-0000-0000-000000000001'::uuid,
     'FZD-2026-00001', 'zero_dechet', 'emise',
     '2026-05-16', 150.00, 30.00, 180.00);

  INSERT INTO plateforme.factures_collectes (facture_id, collecte_id, montant_ht) VALUES
    ('d9000000-0000-0000-0000-000000000001'::uuid,
     'd7000000-0000-0000-0000-000000000001'::uuid,
     150.00);
END $$;

-- ─── T1-T9 : Basculer en authenticated (Kardamome traiteur_manager) ────────
-- security_invoker sur les vues = RLS des tables sources appliquée au caller
SELECT test_set_jwt('traiteur_manager', 'd0000000-0000-0000-0000-000000000001'::uuid);

-- ─── T1 : Taux recyclage pondéré (collectes A=80%/100kg, B=60%/50kg, C=NULL) ─

SELECT is(
  (SELECT ROUND(taux_recyclage_pondere::numeric, 2)
   FROM plateforme.v_kpi_traiteur
   WHERE organisation_id = 'd0000000-0000-0000-0000-000000000001'::uuid
     AND type_collecte = 'zero_dechet'
     AND mois = '2026-05-01'::date
   LIMIT 1),
  ROUND(
    (80.0 * 100.0 + 60.0 * 50.0) / (100.0 + 50.0)
  , 2),
  'T1 : taux recyclage pondéré = (80×100 + 60×50)/(150) — collecte NULL exclue'
);

-- ─── T2 : Collecte taux NULL exclue de la pondération ─────────────────────

SELECT is(
  (SELECT nb_collectes
   FROM plateforme.v_kpi_traiteur
   WHERE organisation_id = 'd0000000-0000-0000-0000-000000000001'::uuid
     AND type_collecte = 'zero_dechet'
     AND mois = '2026-05-01'::date),
  3::bigint,
  'T2 : 3 collectes ZD Kardamome (dont 1 sans taux) — toutes comptées dans nb_collectes'
);

-- ─── T3 : Marge ZD Kardamome — pax distincts par événement ───────────────

-- E1 (pax=200) et E2 (pax=100) → pax_total = 300
-- tarif = 1.50 → 1.50 × 300 = 450
-- facture emise = 150 → marge = 450 - 150 = 300
SELECT is(
  (SELECT ROUND(marge_zd_ht::numeric, 2)
   FROM plateforme.v_kpi_traiteur
   WHERE organisation_id = 'd0000000-0000-0000-0000-000000000001'::uuid
     AND type_collecte = 'zero_dechet'
     AND mois = '2026-05-01'::date),
  300.00::numeric,
  'T3 : marge ZD = 1.50×300pax − 150€ facture = 300€'
);

-- ─── T4 : nb_repas_donnes AG ──────────────────────────────────────────────

SELECT is(
  (SELECT nb_repas_donnes
   FROM plateforme.v_kpi_traiteur
   WHERE organisation_id = 'd0000000-0000-0000-0000-000000000001'::uuid
     AND type_collecte = 'anti_gaspi'
     AND mois = '2026-05-01'::date),
  80::bigint,
  'T4 : nb_repas_donnes AG = volume_repas_realise = 80'
);

-- ─── T5 : v_kpi_lieu — sous Kardamome JWT, RLS exclut Kaspia (3 ZD, pas 4) ─

SELECT is(
  (SELECT nb_collectes
   FROM plateforme.v_kpi_lieu
   WHERE lieu_id = 'd3000000-0000-0000-0000-000000000001'::uuid
     AND type_collecte = 'zero_dechet'
     AND mois = '2026-05-01'::date),
  3::bigint,
  'T5 : v_kpi_lieu security_invoker — Kardamome voit ses 3 ZD, pas la ZD Kaspia'
);

-- ─── T6 : v_kpi_client_organisateur — scoping par client_organisateur_organisation_id

-- Sous superuser pour tester la logique de filtrage de la vue (pas la RLS)
SELECT test_as_superuser();

SELECT is(
  (SELECT nb_evenements
   FROM plateforme.v_kpi_client_organisateur
   WHERE organisation_id = 'd0000000-0000-0000-0000-000000000003'::uuid
     AND type_collecte = 'zero_dechet'
     AND mois = '2026-05-01'::date),
  1::bigint,
  'T6 : v_kpi_client_organisateur filtre par client_organisateur_organisation_id (1 événement E1)'
);

-- ─── T7 : Setup check — données Kaspia existent bien (superuser)
SELECT ok(
  (SELECT COUNT(*) > 0
   FROM plateforme.v_kpi_traiteur
   WHERE organisation_id = 'd0000000-0000-0000-0000-000000000002'::uuid),
  'T7 setup : données Kaspia visibles sous superuser (RLS bypass confirmé)'
);

-- Basculer en Kardamome authenticated pour T8/T9
SELECT test_set_jwt('traiteur_manager', 'd0000000-0000-0000-0000-000000000001'::uuid);

SELECT is(
  (SELECT COUNT(*)::integer
   FROM plateforme.v_kpi_traiteur
   WHERE organisation_id = 'd0000000-0000-0000-0000-000000000002'::uuid),
  0,
  'T8 : RLS cross-org — Kardamome ne voit pas les KPIs de Kaspia'
);

-- Kardamome voit ses propres données
SELECT ok(
  (SELECT COUNT(*)::integer > 0
   FROM plateforme.v_kpi_traiteur
   WHERE organisation_id = 'd0000000-0000-0000-0000-000000000001'::uuid),
  'T9 : Kardamome voit ses propres KPIs'
);

-- ─── T10 : mv_benchmark_kg_pax_zd_base — SELECT direct refusé authenticated ─

SELECT test_set_jwt('traiteur_manager', 'd0000000-0000-0000-0000-000000000001'::uuid);

SELECT throws_ok(
  $q$SELECT COUNT(*) FROM plateforme.mv_benchmark_kg_pax_zd_base$q$,
  '42501',
  NULL,
  'T10 : SELECT direct mv_benchmark_kg_pax_zd_base refusé (SECURITY DEFINER via f_benchmark seulement)'
);

SELECT * FROM finish();
ROLLBACK;

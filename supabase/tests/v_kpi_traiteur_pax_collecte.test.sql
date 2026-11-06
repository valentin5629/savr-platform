-- Lot 3 du pax porté par la collecte — v_kpi_traiteur au grain de la COLLECTE
-- (décisions Val Q1, Q2, Q3 et Q5 du 2026-10-25).
-- Un cas par mois, pour qu'une assertion n'en lise qu'un :
--   mars    : événement de deux soirées (ZD 300 le 10, AG 500 le 11 → événement 800)
--   avril   : ZD 200 et AG 400 le même soir (→ événement 400)
--   mai     : collectes à 0 convive (reprise Bubble) à côté de collectes à convives
--   juillet/août : un événement à cheval sur deux mois (ZD 100 le 31/07, ZD 150 le 01/08)
-- Chaque assertion rougit sur la vue de 20260918100000 (pax des événements distincts).

BEGIN;

SELECT plan(12);

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role    text,
  p_org_id  uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

-- ─── Fixtures (superuser) ───────────────────────────────────────────────────
DO $$
DECLARE
  v_flux uuid := (SELECT id FROM plateforme.flux_dechets WHERE code = 'biodechet');
BEGIN
  INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd) VALUES
    ('e3a00000-0000-0000-0000-000000000001'::uuid, 'Traiteur L3', 'Traiteur L3 SAS', 'traiteur', '33300000000001', true, 2.00);
  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
    ('e3a10000-0000-0000-0000-000000000001'::uuid, 'e3a00000-0000-0000-0000-000000000001'::uuid, 'Traiteur L3 SAS', '33300000000001', '3 Rue L3', '75003', 'Paris');
  INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
    ('e3a20000-0000-0000-0000-000000000001'::uuid, 'e3a00000-0000-0000-0000-000000000001'::uuid, 'mgr@l3-pax.local', 'Mgr', 'L3', 'traiteur_manager');
  INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region) VALUES
    ('e3a30000-0000-0000-0000-000000000001'::uuid, 'Salle L3', '3 Rue Salle', '75003', 'Paris', 'camionnette', 48.86, 2.36, 'idf');
  INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif) VALUES
    ('e3a40000-0000-0000-0000-000000000001'::uuid, 'GALA_L3', 'Gala L3', 1, true);
  INSERT INTO plateforme.associations (id, nom, adresse, region, ville, contact_email, description_rapport_impact) VALUES
    ('e3a50000-0000-0000-0000-000000000001'::uuid, 'Asso L3', '3 Rue Asso', 'idf', 'Paris', 'asso@l3-pax.local',
     'Association de test du lot 3 (pax porté par la collecte) — fixtures pgTAP');
  INSERT INTO plateforme.transporteurs (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
                                        contact_nom, contact_email, contact_telephone) VALUES
    ('e3a60000-0000-0000-0000-000000000001'::uuid, 'Trans L3', '333000001', '3 Rue Trans', '75003', 'Paris',
     ARRAY['camionnette'], 'autre', 'Contact L3', 'trans@l3-pax.local', '0600000333');

  -- Pax de l'événement provisoire (0) : le trigger le calcule depuis ses collectes.
  INSERT INTO plateforme.evenements (
    id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
    created_by, lieu_id, type_evenement_id, nom_evenement, pax,
    contact_principal_nom, contact_principal_telephone
  )
  SELECT e.id, 'e3a00000-0000-0000-0000-000000000001'::uuid, 'e3a00000-0000-0000-0000-000000000001'::uuid,
         'e3a10000-0000-0000-0000-000000000001'::uuid, 'e3a20000-0000-0000-0000-000000000001'::uuid,
         'e3a30000-0000-0000-0000-000000000001'::uuid, 'e3a40000-0000-0000-0000-000000000001'::uuid,
         e.nom, 0, 'Contact L3', '0600000334'
    FROM (VALUES
      ('e3a70000-0000-0000-0000-000000000001'::uuid, 'Deux soirées'),
      ('e3a70000-0000-0000-0000-000000000002'::uuid, 'ZD et AG le même soir'),
      ('e3a70000-0000-0000-0000-000000000003'::uuid, 'Collectes à 0 convive'),
      ('e3a70000-0000-0000-0000-000000000004'::uuid, 'À cheval sur deux mois')
    ) AS e(id, nom);

  INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte, taux_recyclage, pax) VALUES
    -- mars : deux soirées
    ('e3a80000-0000-0000-0000-000000000011'::uuid, 'e3a70000-0000-0000-0000-000000000001'::uuid, 'zero_dechet', 'cloturee', '2026-03-10', '22:00', 80.00, 300),
    ('e3a80000-0000-0000-0000-000000000012'::uuid, 'e3a70000-0000-0000-0000-000000000001'::uuid, 'anti_gaspi',  'cloturee', '2026-03-11', '22:00', NULL,  500),
    -- avril : ZD et AG le même soir
    ('e3a80000-0000-0000-0000-000000000021'::uuid, 'e3a70000-0000-0000-0000-000000000002'::uuid, 'zero_dechet', 'cloturee', '2026-04-12', '22:00', 70.00, 200),
    ('e3a80000-0000-0000-0000-000000000022'::uuid, 'e3a70000-0000-0000-0000-000000000002'::uuid, 'anti_gaspi',  'cloturee', '2026-04-12', '23:00', NULL,  400),
    -- mai : une ZD et une AG à convives, puis une ZD et une AG passées à 0 ci-dessous
    ('e3a80000-0000-0000-0000-000000000031'::uuid, 'e3a70000-0000-0000-0000-000000000003'::uuid, 'zero_dechet', 'cloturee', '2026-05-13', '22:00', 60.00, 300),
    ('e3a80000-0000-0000-0000-000000000032'::uuid, 'e3a70000-0000-0000-0000-000000000003'::uuid, 'zero_dechet', 'cloturee', '2026-05-14', '22:00', 60.00, 120),
    ('e3a80000-0000-0000-0000-000000000033'::uuid, 'e3a70000-0000-0000-0000-000000000003'::uuid, 'anti_gaspi',  'cloturee', '2026-05-13', '23:00', NULL,  100),
    ('e3a80000-0000-0000-0000-000000000034'::uuid, 'e3a70000-0000-0000-0000-000000000003'::uuid, 'anti_gaspi',  'cloturee', '2026-05-14', '23:00', NULL,  120),
    -- juillet / août : à cheval sur deux mois
    ('e3a80000-0000-0000-0000-000000000041'::uuid, 'e3a70000-0000-0000-0000-000000000004'::uuid, 'zero_dechet', 'cloturee', '2026-07-31', '22:00', 75.00, 100),
    ('e3a80000-0000-0000-0000-000000000042'::uuid, 'e3a70000-0000-0000-0000-000000000004'::uuid, 'zero_dechet', 'cloturee', '2026-08-01', '22:00', 75.00, 150);

  -- 0 convive = reprise Bubble sans pax : seul un UPDATE direct le pose (la saisie
  -- et fn_modifier_collecte le refusent ; à l'INSERT, le trigger le remplace).
  UPDATE plateforme.collectes SET pax = 0
   WHERE id IN ('e3a80000-0000-0000-0000-000000000032'::uuid, 'e3a80000-0000-0000-0000-000000000034'::uuid);

  INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg) VALUES
    ('e3a80000-0000-0000-0000-000000000011'::uuid, v_flux, 90.00),
    ('e3a80000-0000-0000-0000-000000000021'::uuid, v_flux, 40.00),
    ('e3a80000-0000-0000-0000-000000000031'::uuid, v_flux, 60.00),
    ('e3a80000-0000-0000-0000-000000000032'::uuid, v_flux, 50.00),
    ('e3a80000-0000-0000-0000-000000000041'::uuid, v_flux, 20.00),
    ('e3a80000-0000-0000-0000-000000000042'::uuid, v_flux, 30.00);

  INSERT INTO plateforme.attributions_antgaspi (collecte_id, association_id, transporteur_id,
                                                branche_attribution, mode_validation, volume_repas_realise)
  SELECT a.collecte_id, 'e3a50000-0000-0000-0000-000000000001'::uuid, 'e3a60000-0000-0000-0000-000000000001'::uuid,
         'branche_1', 'manuel_top1', a.repas
    FROM (VALUES
      ('e3a80000-0000-0000-0000-000000000012'::uuid, 60),
      ('e3a80000-0000-0000-0000-000000000022'::uuid, 100),
      ('e3a80000-0000-0000-0000-000000000033'::uuid, 30),
      ('e3a80000-0000-0000-0000-000000000034'::uuid, 20)
    ) AS a(collecte_id, repas);

  -- Facture ZD émise de 100 € sur la ZD de mars (marge)
  INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, numero_facture, type,
                                   statut, date_emission, montant_ht, montant_tva, montant_ttc) VALUES
    ('e3a90000-0000-0000-0000-000000000001'::uuid, 'e3a00000-0000-0000-0000-000000000001'::uuid,
     'e3a10000-0000-0000-0000-000000000001'::uuid, 'FZD-L3-00001', 'zero_dechet', 'emise',
     '2026-03-12', 100.00, 20.00, 120.00);
  INSERT INTO plateforme.factures_collectes (facture_id, collecte_id, montant_ht) VALUES
    ('e3a90000-0000-0000-0000-000000000001'::uuid, 'e3a80000-0000-0000-0000-000000000011'::uuid, 100.00);
END $$;

-- Contrôle des fixtures : le pax des événements est bien celui que l'ancienne vue
-- lisait (sinon les assertions ci-dessous ne prouveraient rien).
SELECT results_eq(
  $q$SELECT pax FROM plateforme.evenements
      WHERE id IN ('e3a70000-0000-0000-0000-000000000001', 'e3a70000-0000-0000-0000-000000000002',
                   'e3a70000-0000-0000-0000-000000000004')
      ORDER BY id$q$,
  $q$VALUES (800), (400), (250)$q$,
  'L3-VUE-0 : fixtures — événements de 800 (deux soirées), 400 (même soir) et 250 (deux mois) convives'
);

SELECT test_set_jwt('traiteur_manager', 'e3a00000-0000-0000-0000-000000000001'::uuid);

CREATE TEMP VIEW kpi_l3 AS
  SELECT * FROM plateforme.v_kpi_traiteur
   WHERE organisation_id = 'e3a00000-0000-0000-0000-000000000001'::uuid;

-- ─── Deux soirées (mars) ────────────────────────────────────────────────────
SELECT is(
  (SELECT pax_total FROM kpi_l3 WHERE mois = '2026-03-01' AND type_collecte = 'zero_dechet'),
  300::bigint,
  'L3-VUE-1 : deux soirées — pax ZD de mars = 300 convives de la collecte ZD, pas 800 de l''événement'
);
SELECT is(
  (SELECT pax_total FROM kpi_l3 WHERE mois = '2026-03-01' AND type_collecte = 'anti_gaspi'),
  500::bigint,
  'L3-VUE-2 : deux soirées — pax AG de mars = 500 convives de la collecte AG, pas 800 de l''événement'
);

-- ─── ZD et AG le même soir (avril) ──────────────────────────────────────────
SELECT is(
  (SELECT pax_total FROM kpi_l3 WHERE mois = '2026-04-01' AND type_collecte = 'zero_dechet'),
  200::bigint,
  'L3-VUE-3 : même soir — pax ZD d''avril = 200 de la ZD, pas les 400 de l''AG plus grosse'
);
SELECT is(
  (SELECT pax_total FROM kpi_l3 WHERE mois = '2026-04-01' AND type_collecte = 'anti_gaspi'),
  400::bigint,
  'L3-VUE-4 : même soir — pax AG d''avril = 400 de l''AG'
);

-- ─── Collectes à 0 convive (mai) ────────────────────────────────────────────
SELECT results_eq(
  $q$SELECT tonnage_kg, tonnage_kg_pax_connu, pax_total FROM kpi_l3
      WHERE mois = '2026-05-01' AND type_collecte = 'zero_dechet'$q$,
  $q$VALUES (110.00::numeric, 60.00::numeric, 300::bigint)$q$,
  'L3-VUE-5 : collecte ZD à 0 convive — tonnage 110 kg, mais 60 kg seulement au numérateur du kg/pax (300 pax)'
);
SELECT results_eq(
  $q$SELECT nb_repas_donnes, nb_repas_pax_connu, pax_total FROM kpi_l3
      WHERE mois = '2026-05-01' AND type_collecte = 'anti_gaspi'$q$,
  $q$VALUES (50::bigint, 30::bigint, 100::bigint)$q$,
  'L3-VUE-6 : collecte AG à 0 convive — 50 repas donnés, mais 30 seulement au numérateur du repas/pax (100 pax)'
);
SELECT is(
  (SELECT tonnage_kg_pax_connu FROM kpi_l3 WHERE mois = '2026-04-01' AND type_collecte = 'anti_gaspi'),
  NULL::numeric,
  'L3-VUE-7 : une ligne AG n''a pas de poids au numérateur du kg/pax (NULL, comme tonnage_kg)'
);

-- ─── À cheval sur deux mois (juillet / août) ────────────────────────────────
SELECT results_eq(
  $q$SELECT mois, pax_total FROM kpi_l3 WHERE type_collecte = 'zero_dechet'
       AND mois IN ('2026-07-01', '2026-08-01') ORDER BY mois$q$,
  $q$VALUES ('2026-07-01'::date, 100::bigint), ('2026-08-01'::date, 150::bigint)$q$,
  'L3-VUE-8 : deux mois — juillet 100 et août 150 convives, pas 250 de l''événement chaque mois'
);

-- ─── Marge (Q3) ─────────────────────────────────────────────────────────────
SELECT is(
  (SELECT marge_zd_ht FROM kpi_l3 WHERE mois = '2026-03-01' AND type_collecte = 'zero_dechet'),
  500.00::numeric,
  'L3-VUE-9 : marge de mars = 2,00 € × 300 pax de la collecte ZD − 100 € facturés = 500 €, pas 1 500 €'
);

-- ─── Options et droits de la vue inchangés ──────────────────────────────────
SELECT test_set_jwt('traiteur_manager', NULL);
SELECT set_config('role', 'postgres', true);

SELECT is(
  (SELECT reloptions FROM pg_class WHERE oid = 'plateforme.v_kpi_traiteur'::regclass),
  ARRAY['security_invoker=true']::text[],
  'L3-VUE-10 : v_kpi_traiteur reste security_invoker (la RLS des tables s''applique à l''appelant)'
);
SELECT ok(
  has_table_privilege('authenticated', 'plateforme.v_kpi_traiteur', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'plateforme.v_kpi_traiteur', 'INSERT')
  AND NOT has_table_privilege('anon', 'plateforme.v_kpi_traiteur', 'SELECT'),
  'L3-VUE-11 : droits inchangés — SELECT seul pour authenticated, rien pour anon'
);

SELECT * FROM finish();
ROLLBACK;

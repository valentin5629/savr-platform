-- pgTAP — Algo attribution AG : une distance NON CALCULABLE (coordonnées GPS
-- manquantes) est restituée NULL, jamais 0 (revue E2E 2026-09-29).
-- Régression : `COALESCE(distance_km, 0)` affichait « 0 km » sur l'écran
-- d'attribution pour une association dont on ignore la position.
-- Date pivot : 2030-01-07 = LUNDI.

BEGIN;
SELECT plan(5);

SELECT set_config('role', 'postgres', true);
SELECT set_config('request.jwt.claims', NULL, true);

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES ('c7e10000-0000-0000-0000-000000000001'::uuid, 'OrgDistance', 'OrgDistance SARL', 'traiteur', '77711200000000', true);
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('c7e10000-0000-0000-0000-000000000002'::uuid, 'c7e10000-0000-0000-0000-000000000001'::uuid,
  'OrgDistance SARL', '77711200000000', '1 Rue D', '76000', 'Rouen');
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('c7e10000-0000-0000-0000-000000000003'::uuid, 'c7e10000-0000-0000-0000-000000000001'::uuid,
  'admin-distance@test.test', 'Admin', 'Distance', 'admin_savr');
INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('c7e10000-0000-0000-0000-000000000004'::uuid, 'GALA_DISTANCE', 'Gala Distance', 1, true);
INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max, latitude, longitude, region)
VALUES
  ('c7e10000-0000-0000-0000-000000000005'::uuid, 'Lieu Géocodé', '1 Quai', 'Rouen', '76000', 'poids_lourd', 49.4431, 1.0993, 'province'),
  ('c7e10000-0000-0000-0000-000000000006'::uuid, 'Lieu Sans GPS', '2 Quai', 'Rouen', '76000', 'poids_lourd', NULL, NULL, 'province');

-- Isolation : l'algo ne garde que le top 3 ; les associations actives d'autres
-- fixtures (seed, autres tests) pourraient évincer celles du test. Annulé au ROLLBACK.
UPDATE plateforme.associations SET actif = false WHERE actif = true;

-- Horaires NULL = pas d'exclusion (fn_association_ouverte).
INSERT INTO plateforme.associations (id, nom, adresse, ville, region, contact_email, capacite_max_beneficiaires, actif, description_rapport_impact, latitude, longitude)
VALUES
  ('c7e10000-0000-0000-0000-000000000010'::uuid, 'Asso Géocodée Distance', '1 Rue', 'Rouen', 'province', 'geo@asso.test', 500, true,
   'Association géocodée pour les tests de distance de l''algo.', 49.4531, 1.0993),
  ('c7e10000-0000-0000-0000-000000000011'::uuid, 'Asso Sans GPS Distance', '2 Rue', 'Rouen', 'province', 'sansgps@asso.test', 500, true,
   'Association sans coordonnées pour les tests de distance de l''algo.', NULL, NULL);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES
  ('c7e10000-0000-0000-0000-000000000020'::uuid, 'c7e10000-0000-0000-0000-000000000001'::uuid,
   'c7e10000-0000-0000-0000-000000000001'::uuid, 'c7e10000-0000-0000-0000-000000000002'::uuid,
   'c7e10000-0000-0000-0000-000000000003'::uuid, 'c7e10000-0000-0000-0000-000000000005'::uuid,
   'c7e10000-0000-0000-0000-000000000004'::uuid, '2030-01-07', 150, 'C', '0600000098'),
  ('c7e10000-0000-0000-0000-000000000021'::uuid, 'c7e10000-0000-0000-0000-000000000001'::uuid,
   'c7e10000-0000-0000-0000-000000000001'::uuid, 'c7e10000-0000-0000-0000-000000000002'::uuid,
   'c7e10000-0000-0000-0000-000000000003'::uuid, 'c7e10000-0000-0000-0000-000000000006'::uuid,
   'c7e10000-0000-0000-0000-000000000004'::uuid, '2030-01-07', 150, 'C', '0600000097');

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
VALUES
  ('c7e10000-0000-0000-0000-000000000030'::uuid, 'c7e10000-0000-0000-0000-000000000020'::uuid,
   'anti_gaspi', 'programmee', 'non_envoye', '2030-01-07', '22:00', 15),
  ('c7e10000-0000-0000-0000-000000000031'::uuid, 'c7e10000-0000-0000-0000-000000000021'::uuid,
   'anti_gaspi', 'programmee', 'non_envoye', '2030-01-07', '22:00', 15);

CREATE TEMP TABLE algo_lieu_geo AS
SELECT e->>'id' AS id, e->'distance_km' AS distance
FROM jsonb_array_elements(
  plateforme.fn_calculer_algo_attribution_ag('c7e10000-0000-0000-0000-000000000030'::uuid)->'associations'
) e;

CREATE TEMP TABLE algo_lieu_sans_gps AS
SELECT e->>'id' AS id, e->'distance_km' AS distance
FROM jsonb_array_elements(
  plateforme.fn_calculer_algo_attribution_ag('c7e10000-0000-0000-0000-000000000031'::uuid)->'associations'
) e;

SELECT is(
  (SELECT jsonb_typeof(distance) FROM algo_lieu_geo WHERE id = 'c7e10000-0000-0000-0000-000000000011'),
  'null',
  'D1 : association sans coordonnées → distance_km JSON null (jamais 0)'
);

SELECT ok(
  (SELECT (distance)::numeric FROM algo_lieu_geo WHERE id = 'c7e10000-0000-0000-0000-000000000010') > 0,
  'D2 : association géocodée → distance_km numérique calculée (≈ 1,1 km)'
);

SELECT is(
  (SELECT array_agg(id ORDER BY ord) FROM (
     SELECT e->>'id' AS id, ord
     FROM jsonb_array_elements(
       plateforme.fn_calculer_algo_attribution_ag('c7e10000-0000-0000-0000-000000000030'::uuid)->'associations'
     ) WITH ORDINALITY AS t(e, ord)
     WHERE e->>'id' LIKE 'c7e10000-%') s),
  ARRAY['c7e10000-0000-0000-0000-000000000010', 'c7e10000-0000-0000-0000-000000000011'],
  'D3 : distance inconnue classée APRÈS la distance connue (NULLS LAST inchangé)'
);

SELECT is(
  (SELECT count(*)::int FROM algo_lieu_sans_gps
    WHERE id LIKE 'c7e10000-%' AND jsonb_typeof(distance) = 'null'),
  2,
  'D4 : lieu sans coordonnées → toutes les distances null, aucune à 0'
);

SELECT ok(
  NOT has_function_privilege('authenticated',
    'plateforme.fn_calculer_algo_attribution_ag(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'plateforme.fn_calculer_algo_attribution_ag(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'plateforme.fn_calculer_algo_attribution_ag(uuid)', 'EXECUTE'),
  'D5 : ACL de l''algo inchangée (service_role seul)'
);

SELECT * FROM finish();
ROLLBACK;

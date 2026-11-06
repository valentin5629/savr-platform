-- pgTAP — Algo attribution AG : un lieu SANS région suit la région déduite de
-- son code postal (choix C1, Val 2026-11-03, migration 20261103170000).
-- Régression : lieu créé depuis le formulaire (région NULL) à Courbevoie →
-- aucune association (filtre région = NULL) et voie province (aucun
-- transporteur). Date pivot : 2030-01-07 = LUNDI.

BEGIN;
SELECT plan(8);

SELECT set_config('role', 'postgres', true);
SELECT set_config('request.jwt.claims', NULL, true);

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES ('c7e20000-0000-0000-0000-000000000001'::uuid, 'OrgRegion', 'OrgRegion SARL', 'traiteur', '77711300000000', true);
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('c7e20000-0000-0000-0000-000000000002'::uuid, 'c7e20000-0000-0000-0000-000000000001'::uuid,
  'OrgRegion SARL', '77711300000000', '1 Rue R', '92400', 'Courbevoie');
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('c7e20000-0000-0000-0000-000000000003'::uuid, 'c7e20000-0000-0000-0000-000000000001'::uuid,
  'admin-region@test.test', 'Admin', 'Region', 'admin_savr');
INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('c7e20000-0000-0000-0000-000000000004'::uuid, 'GALA_REGION', 'Gala Region', 1, true);

-- 05 : sans région, 92400 ; 06 : sans région, 69000 ; 07 : région saisie
-- « province » à 92400 (prioritaire) ; 08 : ni région ni code postal exploitable.
INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max, latitude, longitude, region)
VALUES
  ('c7e20000-0000-0000-0000-000000000005'::uuid, 'Lieu 92 sans région', '1 Quai', 'Courbevoie', '92400', 'poids_lourd', 48.8973, 2.2534, NULL),
  ('c7e20000-0000-0000-0000-000000000006'::uuid, 'Lieu 69 sans région', '2 Quai', 'Lyon', '69000', 'poids_lourd', 45.7640, 4.8357, NULL),
  ('c7e20000-0000-0000-0000-000000000007'::uuid, 'Lieu 92 province saisie', '3 Quai', 'Courbevoie', '92400', 'poids_lourd', 48.8973, 2.2534, 'province'),
  ('c7e20000-0000-0000-0000-000000000008'::uuid, 'Lieu sans code postal', '4 Quai', 'Nulle part', '  ', 'poids_lourd', NULL, NULL, NULL);

-- Isolation : l'algo ne garde que le top 3. Annulé au ROLLBACK.
UPDATE plateforme.associations SET actif = false WHERE actif = true;

-- Horaires NULL = pas d'exclusion (fn_association_ouverte).
INSERT INTO plateforme.associations (id, nom, adresse, ville, region, contact_email, capacite_max_beneficiaires, actif, description_rapport_impact, latitude, longitude)
VALUES
  ('c7e20000-0000-0000-0000-000000000010'::uuid, 'Asso IDF Région', '1 Rue', 'Paris', 'idf', 'idf@asso.test', 500, true,
   'Association IDF pour les tests de région de l''algo.', 48.8566, 2.3522),
  ('c7e20000-0000-0000-0000-000000000011'::uuid, 'Asso Province Région', '2 Rue', 'Lyon', 'province', 'prov@asso.test', 500, true,
   'Association province pour les tests de région de l''algo.', 45.7640, 4.8357);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, date_evenement, pax, contact_principal_nom, contact_principal_telephone
)
SELECT
  ('c7e20000-0000-0000-0000-00000000002' || n)::uuid, 'c7e20000-0000-0000-0000-000000000001'::uuid,
  'c7e20000-0000-0000-0000-000000000001'::uuid, 'c7e20000-0000-0000-0000-000000000002'::uuid,
  'c7e20000-0000-0000-0000-000000000003'::uuid, ('c7e20000-0000-0000-0000-00000000000' || (n + 5))::uuid,
  'c7e20000-0000-0000-0000-000000000004'::uuid, '2030-01-07', 150, 'C', '060000009' || n
FROM generate_series(0, 3) n;

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
SELECT
  ('c7e20000-0000-0000-0000-00000000003' || n)::uuid, ('c7e20000-0000-0000-0000-00000000002' || n)::uuid,
  'anti_gaspi', 'programmee', 'non_envoye', '2030-01-07', '14:00', 50
FROM generate_series(0, 3) n;

CREATE TEMP TABLE algo_r AS
SELECT n, plateforme.fn_calculer_algo_attribution_ag(('c7e20000-0000-0000-0000-00000000003' || n)::uuid) AS r
FROM generate_series(0, 3) n;

SELECT is(
  (SELECT (r->>'is_idf')::boolean FROM algo_r WHERE n = 0),
  true,
  'R1 : lieu sans région au 92400 → voie IDF'
);

SELECT is(
  (SELECT array_agg(e->>'id') FROM algo_r, jsonb_array_elements(r->'associations') e WHERE n = 0),
  ARRAY['c7e20000-0000-0000-0000-000000000010'],
  'R2 : lieu sans région au 92400 → associations IDF seules'
);

SELECT is(
  (SELECT (r->>'is_idf')::boolean FROM algo_r WHERE n = 1),
  false,
  'R3 : lieu sans région au 69000 → voie province'
);

SELECT is(
  (SELECT array_agg(e->>'id') FROM algo_r, jsonb_array_elements(r->'associations') e WHERE n = 1),
  ARRAY['c7e20000-0000-0000-0000-000000000011'],
  'R4 : lieu sans région au 69000 → associations province seules'
);

SELECT is(
  (SELECT (r->>'is_idf')::boolean FROM algo_r WHERE n = 2),
  false,
  'R5 : région saisie « province » prioritaire sur le code postal 92400'
);

SELECT is(
  (SELECT array_agg((r->>'region_inconnue')::boolean ORDER BY n) FROM algo_r),
  ARRAY[false, false, false, true],
  'R6 : region_inconnue vrai seulement sans région ni code postal'
);

SELECT is(
  (SELECT (r->>'assoc_count')::int FROM algo_r WHERE n = 3),
  0,
  'R7 : sans région ni code postal → aucune association (inchangé)'
);

SELECT ok(
  NOT has_function_privilege('authenticated',
    'plateforme.fn_calculer_algo_attribution_ag(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'plateforme.fn_calculer_algo_attribution_ag(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'plateforme.fn_calculer_algo_attribution_ag(uuid)', 'EXECUTE')
  AND (SELECT prosecdef FROM pg_proc
        WHERE oid = 'plateforme.fn_calculer_algo_attribution_ag(uuid)'::regprocedure),
  'R8 : ACL inchangée (service_role seul) et SECURITY DEFINER conservé'
);

SELECT * FROM finish();
ROLLBACK;

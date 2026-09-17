-- pgTAP — Algo attribution AG : le filtre « horaires compatibles » (§05) lit le
-- format écrit par l'éditeur Admin (tableau jour/ouvert/creneaux).
-- Régression : l'algo lisait un objet {"lun":{debut,fin}} → toute association aux
-- horaires saisis à l'écran était exclue (« Aucune association disponible »).
-- Date pivot : 2030-01-07 = LUNDI.

BEGIN;
SELECT plan(16);

SELECT set_config('role', 'postgres', true);
SELECT set_config('request.jwt.claims', NULL, true);

-- ── Prédicat fn_association_ouverte ────────────────────────────────────────

SELECT ok(
  plateforme.fn_association_ouverte(NULL, '2030-01-07', '22:00'),
  'H1 : horaires NULL → pas d''exclusion'
);

SELECT ok(
  plateforme.fn_association_ouverte(
    '[{"jour":"lundi","ouvert":true,"creneaux":[{"debut":"09:00","fin":"18:00"}]}]',
    '2030-01-07', '10:00'),
  'H2 : lundi ouvert 09:00-18:00, collecte 10:00 → ouverte'
);

SELECT ok(
  NOT plateforme.fn_association_ouverte(
    '[{"jour":"lundi","ouvert":true,"creneaux":[{"debut":"09:00","fin":"18:00"}]}]',
    '2030-01-07', '22:00'),
  'H3 : lundi ouvert 09:00-18:00, collecte 22:00 → fermée'
);

SELECT ok(
  NOT plateforme.fn_association_ouverte(
    '[{"jour":"lundi","ouvert":true,"creneaux":[{"debut":"09:00","fin":"18:00"}]}]',
    '2030-01-07', '18:00'),
  'H4 : fin exclusive — collecte 18:00 → fermée'
);

SELECT ok(
  NOT plateforme.fn_association_ouverte(
    '[{"jour":"lundi","ouvert":false,"creneaux":[{"debut":"00:00","fin":"00:00"}]}]',
    '2030-01-07', '22:00'),
  'H5 : case « Ouvert » décochée → fermée, quels que soient les créneaux'
);

SELECT ok(
  plateforme.fn_association_ouverte(
    '[{"jour":"lundi","ouvert":true,"creneaux":[{"debut":"00:00","fin":"00:00"}]}]',
    '2030-01-07', '22:00'),
  'H6 : 00:00→00:00 = ouverte 24h/24'
);

SELECT ok(
  plateforme.fn_association_ouverte(
    '[{"jour":"lundi","ouvert":true,"creneaux":[{"debut":"20:00","fin":"02:00"}]}]',
    '2030-01-07', '23:30'),
  'H7 : créneau passant minuit (20:00→02:00), collecte 23:30 → ouverte'
);

SELECT ok(
  plateforme.fn_association_ouverte(
    '[{"jour":"lundi","ouvert":true,"creneaux":[{"debut":"09:00","fin":"12:00"},{"debut":"14:00","fin":"18:00"}]}]',
    '2030-01-07', '15:00')
  AND NOT plateforme.fn_association_ouverte(
    '[{"jour":"lundi","ouvert":true,"creneaux":[{"debut":"09:00","fin":"12:00"},{"debut":"14:00","fin":"18:00"}]}]',
    '2030-01-07', '13:00'),
  'H8 : second créneau pris en compte (15:00 ouverte, 13:00 pause fermée)'
);

SELECT ok(
  NOT plateforme.fn_association_ouverte(
    '[{"jour":"mardi","ouvert":true,"creneaux":[{"debut":"00:00","fin":"00:00"}]}]',
    '2030-01-07', '10:00'),
  'H9 : seul le mardi est ouvert, collecte un lundi → fermée'
);

SELECT lives_ok(
  $$ SELECT plateforme.fn_association_ouverte(
       '[{"jour":"lundi","ouvert":true,"creneaux":[{"debut":"abc","fin":"25:99"}]}, 42]',
       '2030-01-07', '10:00') $$,
  'H10 : créneau / élément mal formé → aucune exception'
);

SELECT ok(
  NOT has_function_privilege('authenticated',
    'plateforme.fn_association_ouverte(jsonb, date, time)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'plateforme.fn_association_ouverte(jsonb, date, time)', 'EXECUTE'),
  'H11 : prédicat interne — pas d''EXECUTE pour authenticated / anon'
);

SELECT ok(
  NOT has_function_privilege('authenticated',
    'plateforme.fn_calculer_algo_attribution_ag(uuid)', 'EXECUTE'),
  'H12 : ACL de l''algo conservée par le CREATE OR REPLACE (service_role only)'
);

-- Refus réel sous un client authenticated (JWT admin_savr) : 42501 avant exécution.
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'c7e00000-0000-0000-0000-0000000000aa',
  'user_role', 'admin_savr',
  'organisation_id', 'c7e00000-0000-0000-0000-0000000000ab',
  'app_domain', 'plateforme'
)::text, true);
SELECT set_config('role', 'authenticated', true);

SELECT throws_ok(
  $$ SELECT plateforme.fn_association_ouverte(NULL, '2030-01-07', '10:00') $$,
  '42501', NULL::text,
  'H12b : authenticated — fn_association_ouverte : permission denied'
);

SELECT throws_ok(
  $$ SELECT plateforme.fn_calculer_algo_attribution_ag('c7e00000-0000-0000-0000-000000000030'::uuid) $$,
  '42501', NULL::text,
  'H12c : authenticated — fn_calculer_algo_attribution_ag : permission denied'
);

SELECT set_config('role', 'postgres', true);
SELECT set_config('request.jwt.claims', NULL, true);

-- ── Bout en bout : l'algo propose l'association saisie à l'écran ───────────

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES ('c7e00000-0000-0000-0000-000000000001'::uuid, 'OrgHoraires', 'OrgHoraires SARL', 'traiteur', '77711100000000', true);
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('c7e00000-0000-0000-0000-000000000002'::uuid, 'c7e00000-0000-0000-0000-000000000001'::uuid,
  'OrgHoraires SARL', '77711100000000', '1 Rue H', '76000', 'Rouen');
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('c7e00000-0000-0000-0000-000000000003'::uuid, 'c7e00000-0000-0000-0000-000000000001'::uuid,
  'admin-horaires@test.test', 'Admin', 'Horaires', 'admin_savr');
INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('c7e00000-0000-0000-0000-000000000004'::uuid, 'GALA_HORAIRES', 'Gala Horaires', 1, true);
INSERT INTO plateforme.lieux (id, nom, adresse_acces, ville, code_postal, type_vehicule_max, latitude, longitude, region)
VALUES ('c7e00000-0000-0000-0000-000000000005'::uuid, 'Lieu Horaires', '1 Quai', 'Rouen', '76000', 'poids_lourd', 49.4431, 1.0993, 'province');

INSERT INTO plateforme.associations (id, nom, adresse, ville, region, contact_email, capacite_max_beneficiaires, actif, description_rapport_impact, latitude, longitude, horaires_ouverture)
VALUES
  -- ouverte 24h/24 le lundi (format éditeur Admin)
  ('c7e00000-0000-0000-0000-000000000010'::uuid, 'Asso 24h Horaires', '1 Rue', 'Rouen', 'province', 'h24@asso.test', 500, true,
   'Association ouverte 24h/24 pour les tests horaires algo.', 49.4431, 1.0993,
   '[{"jour":"lundi","ouvert":true,"creneaux":[{"debut":"00:00","fin":"00:00"}]}]'::jsonb),
  -- horaires par défaut de l'éditeur (7 jours décochés, 09:00-18:00)
  ('c7e00000-0000-0000-0000-000000000011'::uuid, 'Asso Fermée Horaires', '2 Rue', 'Rouen', 'province', 'ferme@asso.test', 500, true,
   'Association fermée (horaires par défaut) pour les tests horaires algo.', 49.4431, 1.0993,
   (SELECT jsonb_agg(jsonb_build_object('jour', j, 'ouvert', false,
      'creneaux', '[{"debut":"09:00","fin":"18:00"}]'::jsonb))
    FROM unnest(ARRAY['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche']) j));

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES ('c7e00000-0000-0000-0000-000000000020'::uuid, 'c7e00000-0000-0000-0000-000000000001'::uuid,
  'c7e00000-0000-0000-0000-000000000001'::uuid, 'c7e00000-0000-0000-0000-000000000002'::uuid,
  'c7e00000-0000-0000-0000-000000000003'::uuid, 'c7e00000-0000-0000-0000-000000000005'::uuid,
  'c7e00000-0000-0000-0000-000000000004'::uuid, '2030-01-07', 150, 'C', '0600000099');

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, volume_estime_repas)
VALUES ('c7e00000-0000-0000-0000-000000000030'::uuid, 'c7e00000-0000-0000-0000-000000000020'::uuid,
  'anti_gaspi', 'programmee', 'non_envoye', '2030-01-07', '22:00', 15);

SELECT ok(
  (plateforme.fn_calculer_algo_attribution_ag('c7e00000-0000-0000-0000-000000000030'::uuid))->'associations'
    @> '[{"id":"c7e00000-0000-0000-0000-000000000010"}]'::jsonb,
  'H13 : association ouverte 24h/24 (format éditeur) proposée pour une collecte lundi 22:00'
);

SELECT ok(
  NOT ((plateforme.fn_calculer_algo_attribution_ag('c7e00000-0000-0000-0000-000000000030'::uuid))->'associations'
    @> '[{"id":"c7e00000-0000-0000-0000-000000000011"}]'::jsonb),
  'H14 : association aux horaires par défaut (tous jours décochés) exclue'
);

SELECT * FROM finish();
ROLLBACK;

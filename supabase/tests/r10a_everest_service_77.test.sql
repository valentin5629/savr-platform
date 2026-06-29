-- =============================================================================
-- Tests pgTAP R10a / BL-P1-API-04 — CHECK everest_service_id élargi au service 77
-- =============================================================================
-- Garde schéma de la migration 20260629110000 : le domaine autorisé passe de
-- IN (71,74,91) à IN (71,74,77,91). Sans le 77, le dispatch « camion express
-- last-minute » (branche ag_everest_camion_express) échouait au CHECK.
-- =============================================================================

BEGIN;
SELECT plan(2);

-- ─── Fixture minimale (superuser → RLS bypass, on ne teste que le CHECK) ──────

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES ('0a770002-0000-0000-0000-000000000001'::uuid, 'Kaspia77', 'traiteur', true, false, '20000000000077', 'm77@kaspia.test');

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('e0770001-0000-0000-0000-000000000001'::uuid, 'ev_r10a_77', 'Test R10a 77');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('1e770001-0000-0000-0000-000000000001'::uuid, 'Salle 77', '1 rue 77', '75001', 'Paris', 'poids_lourd');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('ee770001-0000-0000-0000-000000000001'::uuid, '0a770002-0000-0000-0000-000000000001'::uuid, 'Kaspia77 SAS', '20000000000077', '1 rue', '75001', 'Paris');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('05770002-0000-0000-0000-000000000001'::uuid, '0a770002-0000-0000-0000-000000000001'::uuid, 'mgr77@kaspia.test', 'Mgr', '77', 'traiteur_manager');

INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
)
VALUES (
  'e0e77001-0000-0000-0000-000000000001'::uuid,
  '0a770002-0000-0000-0000-000000000001'::uuid,
  '1e770001-0000-0000-0000-000000000001'::uuid,
  '0a770002-0000-0000-0000-000000000001'::uuid,
  'ee770001-0000-0000-0000-000000000001'::uuid,
  '05770002-0000-0000-0000-000000000001'::uuid,
  'e0770001-0000-0000-0000-000000000001'::uuid,
  NOW() + INTERVAL '10 days', 100, 'Contact', '0601010177'
);

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
VALUES (
  'c0770001-0000-0000-0000-000000000001'::uuid,
  'e0e77001-0000-0000-0000-000000000001'::uuid,
  'anti_gaspi', 'validee', 'attribuee_en_attente_acceptation',
  current_date + 3, '22:00'
);

INSERT INTO shared.prestataires (id, nom, code, mode_integration)
VALUES ('fa770001-0000-0000-0000-000000000001'::uuid, 'A Toutes! 77', 'a-toutes-r10a', 'api');

INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, type_vehicule, prestataire_logistique_id, statut)
VALUES
  ('b0770001-0000-0000-0000-000000000001'::uuid, 'EVR-c0770001-001', current_date + 3, 'soir', 'poids_lourd', 'fa770001-0000-0000-0000-000000000001'::uuid, 'planifiee'),
  ('b0770002-0000-0000-0000-000000000001'::uuid, 'EVR-c0770001-002', current_date + 3, 'soir', 'poids_lourd', 'fa770001-0000-0000-0000-000000000001'::uuid, 'planifiee');

-- ─── T1 : service 77 accepté (le cœur du fix) ────────────────────────────────

SELECT lives_ok(
  $$INSERT INTO plateforme.everest_missions (tournee_id, collecte_id, everest_service_id, statut_everest)
    VALUES (
      'b0770001-0000-0000-0000-000000000001'::uuid,
      'c0770001-0000-0000-0000-000000000001'::uuid,
      77, 'creation_failed'
    )$$,
  'T1 — INSERT everest_service_id=77 accepté (camion express, BL-P1-API-04)'
);

-- ─── T2 : un service hors domaine reste rejeté (23514 check_violation) ────────

SELECT throws_ok(
  $$INSERT INTO plateforme.everest_missions (tournee_id, collecte_id, everest_service_id, statut_everest)
    VALUES (
      'b0770002-0000-0000-0000-000000000001'::uuid,
      'c0770001-0000-0000-0000-000000000001'::uuid,
      99, 'creation_failed'
    )$$,
  '23514',
  NULL,
  'T2 — INSERT everest_service_id=99 rejeté par le CHECK (domaine fermé 71/74/77/91)'
);

SELECT * FROM finish();
ROLLBACK;

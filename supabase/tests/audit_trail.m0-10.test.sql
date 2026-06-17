-- =============================================================================
-- Tests pgTAP M0.10 — Audit trail
-- =============================================================================
-- 13 tests : colonnes, triggers DB (6), f_log_audit(), immuabilité, motif GUC
-- =============================================================================

BEGIN;
SELECT plan(13);

-- Helpers (identiques aux autres fichiers de test)
CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role    text,
  p_org_id  uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'user_role', p_role,
    'organisation_id', p_org_id,
    'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- =====================================================================
-- SETUP — Données minimales (UUIDs namespace a09f pour ce fichier)
-- =====================================================================

SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES ('a09f0001-0000-0000-0000-000000000001'::uuid, 'Audit Test Org', 'traiteur', true, false, '99900000000001', 'audit@test.com');

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('a09f0002-0000-0000-0000-000000000001'::uuid, 'audit_test', 'Audit test');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('a09f0003-0000-0000-0000-000000000001'::uuid, 'a09f0001-0000-0000-0000-000000000001'::uuid, 'mgr@audit.test', 'Audit', 'User', 'traiteur_manager');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('a09f0004-0000-0000-0000-000000000001'::uuid, 'a09f0001-0000-0000-0000-000000000001'::uuid, 'Audit SARL', '99900000000001', '99 rue audit', '75009', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('a09f0005-0000-0000-0000-000000000001'::uuid, 'Salle Audit', '99 rue audit', '75009', 'Paris', 'fourgon');

INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
)
VALUES (
  'a09f0006-0000-0000-0000-000000000001'::uuid,
  'a09f0001-0000-0000-0000-000000000001'::uuid,
  'a09f0005-0000-0000-0000-000000000001'::uuid,
  'a09f0001-0000-0000-0000-000000000001'::uuid,
  'a09f0004-0000-0000-0000-000000000001'::uuid,
  'a09f0003-0000-0000-0000-000000000001'::uuid,
  'a09f0002-0000-0000-0000-000000000001'::uuid,
  now() + interval '7 days', 80, 'Audit Contact', '0600000099'
);

-- Collecte ZD (pour trigger controle_acces)
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
VALUES ('a09f0007-0000-0000-0000-000000000001'::uuid, 'a09f0006-0000-0000-0000-000000000001'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 7, '08:00');

-- Tarif pack + pack AG (pour triggers pack)
INSERT INTO plateforme.tarifs_packs_ag (id, nb_collectes, prix_ht, valide_du, actif, type_pack, credits, prix_unitaire_ht)
VALUES ('a09f0008-0000-0000-0000-000000000001'::uuid, 5, 250.00, '2026-01-01', true, 'unitaire', 5, 250.00);

INSERT INTO plateforme.packs_antgaspi (id, organisation_id, tarif_pack_id, nb_collectes, nb_utilisees, nb_annulees, statut, date_achat, credits_initiaux, type_pack)
VALUES ('a09f0009-0000-0000-0000-000000000001'::uuid, 'a09f0001-0000-0000-0000-000000000001'::uuid, 'a09f0008-0000-0000-0000-000000000001'::uuid, 5, 2, 0, 'actif', current_date, 5, 'personnalise');

-- Collecte AG programmee (pour trigger pack_debit — date dans moins de 12h)
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, pack_antgaspi_id)
VALUES (
  'a09f000a-0000-0000-0000-000000000001'::uuid,
  'a09f0006-0000-0000-0000-000000000001'::uuid,
  'anti_gaspi', 'programmee', 'non_envoye',
  current_date,
  (now() + interval '1 hour')::time,
  'a09f0009-0000-0000-0000-000000000001'::uuid
);

-- Collecte AG realisee (pour trigger pack_recredit)
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, pack_antgaspi_id)
VALUES (
  'a09f000b-0000-0000-0000-000000000001'::uuid,
  'a09f0006-0000-0000-0000-000000000001'::uuid,
  'anti_gaspi', 'realisee', 'non_envoye',
  current_date - 1,
  '09:00',
  'a09f0009-0000-0000-0000-000000000001'::uuid
);

-- Paramètres algo et co2_divers (pour triggers paramètres)
INSERT INTO plateforme.parametres_algo (id, cle, valeur, type_valeur, description)
VALUES ('a09f000c-0000-0000-0000-000000000001'::uuid, 'seuil_test_audit', '"42"', 'int', 'Param test audit');

INSERT INTO plateforme.parametres_co2_divers (id, cle, valeur, unite, description)
VALUES ('a09f000d-0000-0000-0000-000000000001'::uuid, 'co2_test_audit', 1.5, 'kgCO2e', 'CO2 test audit');

-- Config auto-accept (pour trigger config)
INSERT INTO plateforme.config_auto_accept_ag (id, organisation_id, auto_accept_actif)
VALUES ('a09f000e-0000-0000-0000-000000000001'::uuid, 'a09f0001-0000-0000-0000-000000000001'::uuid, false);

-- =====================================================================
-- T01 : audit_log a la colonne impersonator_id
-- =====================================================================

SELECT ok(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'plateforme' AND table_name = 'audit_log'
      AND column_name = 'impersonator_id'
  ),
  'T01 audit_log.impersonator_id présente'
);

-- T02 : audit_log a la colonne motif
SELECT ok(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'plateforme' AND table_name = 'audit_log'
      AND column_name = 'motif'
  ),
  'T02 audit_log.motif présente'
);

-- T03 : audit_log a la colonne details
SELECT ok(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'plateforme' AND table_name = 'audit_log'
      AND column_name = 'details'
  ),
  'T03 audit_log.details présente'
);

-- =====================================================================
-- T04 : trigger controle_acces_cascade → écrit dans audit_log
-- DML en superuser (triggers s'exécutent quelle que soit l'identité).
-- Le trigger est SECURITY DEFINER → peut écrire dans audit_log.
-- =====================================================================

SELECT test_as_superuser();

UPDATE plateforme.collectes
SET controle_acces_requis = true
WHERE id = 'a09f0007-0000-0000-0000-000000000001'::uuid;

SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.audit_log
    WHERE action = 'controle_acces_cascade_upgrade'
      AND record_id = 'a09f0007-0000-0000-0000-000000000001'::uuid$$,
  $$VALUES (1)$$,
  'T04 trigger controle_acces_cascade écrit dans audit_log'
);

-- =====================================================================
-- T05 : trigger pack_debit_annulation_tardive → écrit dans audit_log
-- Passe collecte AG à annulee avec date_collecte dans moins de 12h.
-- =====================================================================

SELECT test_as_superuser();

UPDATE plateforme.collectes
SET statut = 'annulee'
WHERE id = 'a09f000a-0000-0000-0000-000000000001'::uuid;

SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.audit_log
    WHERE action = 'pack_debite_annulation_tardive'
      AND record_id = 'a09f0009-0000-0000-0000-000000000001'::uuid$$,
  $$VALUES (1)$$,
  'T05 trigger pack_debit_annulation_tardive écrit dans audit_log'
);

-- =====================================================================
-- T06 : trigger pack_recredit_annulation_collecte → écrit dans audit_log
-- Passe collecte AG de realisee à annulee.
-- =====================================================================

SELECT test_as_superuser();

UPDATE plateforme.collectes
SET statut = 'annulee'
WHERE id = 'a09f000b-0000-0000-0000-000000000001'::uuid;

SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.audit_log
    WHERE action = 'pack_recredite_annulation_collecte'
      AND record_id = 'a09f0009-0000-0000-0000-000000000001'::uuid$$,
  $$VALUES (1)$$,
  'T06 trigger pack_recredite_annulation_collecte écrit dans audit_log'
);

-- =====================================================================
-- T07 : trigger config_auto_accept_update → écrit dans audit_log
-- =====================================================================

SELECT test_as_superuser();

UPDATE plateforme.config_auto_accept_ag
SET auto_accept_actif = true
WHERE id = 'a09f000e-0000-0000-0000-000000000001'::uuid;

SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.audit_log
    WHERE action = 'config_auto_accept_update'
      AND record_id = 'a09f000e-0000-0000-0000-000000000001'::uuid
      AND (new_values->>'auto_accept_actif')::boolean = true$$,
  $$VALUES (1)$$,
  'T07 trigger config_auto_accept écrit dans audit_log (UPDATE false→true)'
);

-- =====================================================================
-- T08 : trigger parametres_algo_update → écrit dans audit_log
-- =====================================================================

SELECT test_as_superuser();

UPDATE plateforme.parametres_algo
SET valeur = '"99"'
WHERE id = 'a09f000c-0000-0000-0000-000000000001'::uuid;

SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.audit_log
    WHERE action = 'parametres_algo_update'
      AND record_id = 'a09f000c-0000-0000-0000-000000000001'::uuid$$,
  $$VALUES (1)$$,
  'T08 trigger parametres_algo écrit dans audit_log'
);

-- =====================================================================
-- T09 : trigger parametres_co2_divers_update → écrit dans audit_log
-- =====================================================================

SELECT test_as_superuser();

UPDATE plateforme.parametres_co2_divers
SET valeur = 2.0
WHERE id = 'a09f000d-0000-0000-0000-000000000001'::uuid;

SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.audit_log
    WHERE action = 'parametres_co2_divers_update'
      AND record_id = 'a09f000d-0000-0000-0000-000000000001'::uuid$$,
  $$VALUES (1)$$,
  'T09 trigger parametres_co2_divers écrit dans audit_log'
);

-- =====================================================================
-- T10 : f_log_audit() appelable par service_role (superuser en test)
-- =====================================================================

SELECT test_as_superuser();

SELECT plateforme.f_log_audit(
  NULL,                                             -- user_id
  NULL,                                             -- impersonator_id
  'service',                                        -- role
  'test_service_call',                              -- action
  'test',                                           -- table_name
  NULL,                                             -- record_id
  NULL,                                             -- old_values
  '{"test": true}'::jsonb,                          -- new_values
  NULL,                                             -- motif
  NULL                                              -- details
);

SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.audit_log WHERE action = 'test_service_call'$$,
  $$VALUES (1)$$,
  'T10 f_log_audit() insère une ligne depuis service_role'
);

-- =====================================================================
-- T11 : INSERT direct dans audit_log refusé par rôle authenticated
-- (pas de policy INSERT → deny all pour authenticated)
-- =====================================================================

SELECT test_set_jwt('admin_savr', NULL);

SELECT throws_ok(
  $$INSERT INTO plateforme.audit_log (action, table_name)
    VALUES ('tentative_directe', 'test')$$,
  '42501',
  NULL,
  'T11 INSERT direct audit_log refusé pour authenticated (pas de policy INSERT)'
);

-- =====================================================================
-- T12 : audit_log immuable — UPDATE refusé (REVOKE UPDATE FROM authenticated)
-- =====================================================================

SELECT test_set_jwt('admin_savr', NULL);

SELECT throws_ok(
  $$UPDATE plateforme.audit_log SET motif = 'tampered' WHERE action = 'test_service_call'$$,
  '42501',
  NULL,
  'T12 UPDATE audit_log refusé pour authenticated (REVOKE UPDATE)'
);

-- =====================================================================
-- T13 : motif GUC savr.audit_motif snapshoté dans details par trigger parametres_algo
-- =====================================================================

SELECT test_as_superuser();

-- Deuxième paramètre algo pour isoler ce test
INSERT INTO plateforme.parametres_algo (id, cle, valeur, type_valeur, description)
VALUES ('a09f000f-0000-0000-0000-000000000001'::uuid, 'seuil_motif_test', '"10"', 'int', 'Test motif GUC');

SET LOCAL "savr.audit_motif" = 'motif audit test GUC';

UPDATE plateforme.parametres_algo
SET valeur = '"11"'
WHERE id = 'a09f000f-0000-0000-0000-000000000001'::uuid;

SELECT results_eq(
  $$SELECT (details->>'motif')::text
    FROM plateforme.audit_log
    WHERE action = 'parametres_algo_update'
      AND record_id = 'a09f000f-0000-0000-0000-000000000001'::uuid
    LIMIT 1$$,
  $$VALUES ('motif audit test GUC')$$,
  'T13 motif GUC savr.audit_motif snapshoté dans details par trigger parametres_algo'
);

-- =====================================================================

SELECT * FROM finish();
ROLLBACK;

-- =============================================================================
-- Tests pgTAP M0.6 — RLS exhaustive — Catégorie 4 (Isolation données)
-- =============================================================================
-- Périmètre : 14 tests RLS pures — cross-org, soft-delete, polymorphe, PII
-- Validation de la cloisonnement complet entre organisations
-- =============================================================================

BEGIN;
SELECT plan(14);

-- Helpers
CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'role', p_role,
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
-- SETUP FIXTURE — 3 orgas pour tester cross-org
-- =====================================================================

SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES
  ('org0001-0000-0000-0000-000000000001'::uuid, 'Org A', 'traiteur', true, false, '11111111100001', 'a@test.com'),
  ('org0002-0000-0000-0000-000000000001'::uuid, 'Org B', 'traiteur', true, false, '22222222200001', 'b@test.com'),
  ('org0003-0000-0000-0000-000000000001'::uuid, 'Org C', 'client_organisateur', true, false, '33333333300001', 'c@test.com');

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('evt_type_0001-0000-0000-0000-000000000001'::uuid, 'test', 'Test');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('lieu_0001-0000-0000-0000-000000000001'::uuid, 'Lieu', '1 rue', '75001', 'Paris', 'fourgon');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES
  ('usr_0001-0000-0000-0000-000000000001'::uuid, 'org0001-0000-0000-0000-000000000001'::uuid, 'a@a.test', 'A', 'A', 'traiteur_manager'),
  ('usr_0002-0000-0000-0000-000000000001'::uuid, 'org0002-0000-0000-0000-000000000001'::uuid, 'b@b.test', 'B', 'B', 'traiteur_manager');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES
  ('ent_0001-0000-0000-0000-000000000001'::uuid, 'org0001-0000-0000-0000-000000000001'::uuid, 'A SA', '11111111100001', '1 rue', '75001', 'Paris'),
  ('ent_0002-0000-0000-0000-000000000001'::uuid, 'org0002-0000-0000-0000-000000000001'::uuid, 'B SA', '22222222200001', '2 rue', '75002', 'Paris');

-- Événements A et B
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
)
VALUES
  ('evt_0001-0000-0000-0000-000000000001'::uuid, 'org0001-0000-0000-0000-000000000001'::uuid, 'lieu_0001-0000-0000-0000-000000000001'::uuid, 'org0001-0000-0000-0000-000000000001'::uuid, 'ent_0001-0000-0000-0000-000000000001'::uuid, 'usr_0001-0000-0000-0000-000000000001'::uuid, 'evt_type_0001-0000-0000-0000-000000000001'::uuid, NOW() + INTERVAL '10 days', 100, 'Contact A', '0601010101'),
  ('evt_0002-0000-0000-0000-000000000001'::uuid, 'org0002-0000-0000-0000-000000000001'::uuid, 'lieu_0001-0000-0000-0000-000000000001'::uuid, 'org0002-0000-0000-0000-000000000001'::uuid, 'ent_0002-0000-0000-0000-000000000001'::uuid, 'usr_0002-0000-0000-0000-000000000001'::uuid, 'evt_type_0001-0000-0000-0000-000000000001'::uuid, NOW() + INTERVAL '5 days', 50, 'Contact B', '0602020202');

-- Collectes A et B
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
VALUES
  ('col_0001-0000-0000-0000-000000000001'::uuid, 'evt_0001-0000-0000-0000-000000000001'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00'),
  ('col_0002-0000-0000-0000-000000000001'::uuid, 'evt_0002-0000-0000-0000-000000000001'::uuid, 'anti_gaspi', 'programmee', 'non_envoye', current_date + 5, '09:00');

-- Bordereaux A et B
INSERT INTO plateforme.bordereaux_savr (id, collecte_id, statut)
VALUES
  ('bdr_0001-0000-0000-0000-000000000001'::uuid, 'col_0001-0000-0000-0000-000000000001'::uuid, 'en_attente'),
  ('bdr_0002-0000-0000-0000-000000000001'::uuid, 'col_0002-0000-0000-0000-000000000001'::uuid, 'en_attente');

-- Fichiers A et B (polymorphes)
INSERT INTO shared.fichiers (id, storage_provider, bucket, key, size_bytes, content_type, entity_type, entity_id)
VALUES
  ('fil_0001-0000-0000-0000-000000000001'::uuid, 'r2', 'savr-docs', 'bdr/a.pdf', 1024, 'application/pdf', 'plateforme.bordereaux_savr', 'bdr_0001-0000-0000-0000-000000000001'::uuid),
  ('fil_0002-0000-0000-0000-000000000001'::uuid, 'r2', 'savr-docs', 'bdr/b.pdf', 1024, 'application/pdf', 'plateforme.bordereaux_savr', 'bdr_0002-0000-0000-0000-000000000001'::uuid),
  ('fil_0003-0000-0000-0000-000000000001'::uuid, 'r2', 'savr-docs', 'photos/a.jpg', 2048, 'image/jpeg', 'plateforme.collectes', 'col_0001-0000-0000-0000-000000000001'::uuid);

-- Factures A et B
INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, numero_facture, montant_ht, montant_ttc, statut)
VALUES
  ('fac_0001-0000-0000-0000-000000000001'::uuid, 'org0001-0000-0000-0000-000000000001'::uuid, 'ent_0001-0000-0000-0000-000000000001'::uuid, 'FAC-001', 100.00, 120.00, 'brouillon'),
  ('fac_0002-0000-0000-0000-000000000001'::uuid, 'org0002-0000-0000-0000-000000000001'::uuid, 'ent_0002-0000-0000-0000-000000000001'::uuid, 'FAC-002', 150.00, 180.00, 'brouillon');

-- Packs AG A et B
INSERT INTO plateforme.tarifs_packs_ag (id, nb_collectes, prix_ht, valide_du, actif)
VALUES ('tar_0001-0000-0000-0000-000000000001'::uuid, 10, 500.00, '2026-01-01', true);

INSERT INTO plateforme.packs_antgaspi (id, organisation_id, tarif_pack_id, nb_collectes, nb_utilisees, nb_annulees, statut, date_achat)
VALUES
  ('pack_0001-0000-0000-0000-000000000001'::uuid, 'org0001-0000-0000-0000-000000000001'::uuid, 'tar_0001-0000-0000-0000-000000000001'::uuid, 10, 0, 0, 'actif', current_date),
  ('pack_0002-0000-0000-0000-000000000001'::uuid, 'org0002-0000-0000-0000-000000000001'::uuid, 'tar_0001-0000-0000-0000-000000000001'::uuid, 5, 0, 0, 'actif', current_date);

-- =====================================================================
-- CATÉGORIE 4 — ISOLATION DONNÉES (14 tests cross-org, soft-delete, etc.)
-- =====================================================================

-- T31 : Photo A invisible à user B
SELECT test_set_jwt('traiteur_manager', 'org0002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers WHERE id = 'fil_0003-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T31 Isolation : photo A invisible à user B'
);

-- T32 : Bordereau A invisible à user B
SELECT test_set_jwt('traiteur_manager', 'org0002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers WHERE id = 'fil_0001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T32 Isolation : bordereau A invisible à user B'
);

-- T33 : Facture A invisible à user B
SELECT test_set_jwt('traiteur_manager', 'org0002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.factures WHERE id = 'fac_0001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T33 Isolation : facture A invisible à user B'
);

-- T34 : Pack A invisible à user B
SELECT test_set_jwt('traiteur_manager', 'org0002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.packs_antgaspi WHERE id = 'pack_0001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T34 Isolation : pack A invisible à user B'
);

-- T35 : Événement A invisible à user B
SELECT test_set_jwt('traiteur_manager', 'org0002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.evenements WHERE id = 'evt_0001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T35 Isolation : événement A invisible à user B'
);

-- T36 : Soft-delete fichier — après deleted_at, invisible
SELECT test_as_superuser();
UPDATE shared.fichiers SET deleted_at = NOW() WHERE id = 'fil_0002-0000-0000-0000-000000000001';
SELECT test_set_jwt('traiteur_manager', 'org0002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers WHERE id = 'fil_0002-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T36 Isolation : fichier soft-deleted invisible'
);

-- T37 : User A voit TOUS ses fichiers A (count=2 : bordereau + photo)
SELECT test_set_jwt('traiteur_manager', 'org0001-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers WHERE entity_id IN ('col_0001-0000-0000-0000-000000000001', 'bdr_0001-0000-0000-0000-000000000001')$$,
  $$VALUES (2)$$,
  'T37 Isolation : user A voit TOUS ses fichiers (polymorphes)'
);

-- T38 : Tournées isolées par collecte (test structurel)
SELECT test_as_superuser();
INSERT INTO plateforme.tournees (id, collecte_id, statut_tms, num_tour, chauffeur_nom)
VALUES
  ('tour_0001-0000-0000-0000-000000000001'::uuid, 'col_0001-0000-0000-0000-000000000001'::uuid, 'en_cours', 1, 'Chauffeur A'),
  ('tour_0002-0000-0000-0000-000000000001'::uuid, 'col_0002-0000-0000-0000-000000000001'::uuid, 'en_cours', 1, 'Chauffeur B');

SELECT test_set_jwt('traiteur_manager', 'org0002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.tournees WHERE id = 'tour_0001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T38 Isolation : tour A invisible à user B'
);

-- T39 : Attributions AG cross-org denied
SELECT test_as_superuser();
INSERT INTO plateforme.attributions_antgaspi (id, collecte_id, association_id, montant_don_estime)
VALUES ('attr_0001-0000-0000-0000-000000000001'::uuid, 'col_0001-0000-0000-0000-000000000001'::uuid, gen_random_uuid(), 250.00);

SELECT test_set_jwt('traiteur_manager', 'org0002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.attributions_antgaspi WHERE id = 'attr_0001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T39 Isolation : attribution A invisible à user B'
);

-- T40 : Rapports RSE cross-org denied
SELECT test_as_superuser();
INSERT INTO plateforme.rapports_rse (id, evenement_id, collecte_id, disponible_a)
VALUES ('rse_0001-0000-0000-0000-000000000001'::uuid, 'evt_0001-0000-0000-0000-000000000001'::uuid, 'col_0001-0000-0000-0000-000000000001'::uuid, NOW());

SELECT test_set_jwt('traiteur_manager', 'org0002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.rapports_rse WHERE id = 'rse_0001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T40 Isolation : rapport RSE A invisible à user B'
);

-- T41 : Factures_collectes cross-org denied
SELECT test_as_superuser();
INSERT INTO plateforme.factures_collectes (facture_id, collecte_id)
VALUES ('fac_0001-0000-0000-0000-000000000001'::uuid, 'col_0001-0000-0000-0000-000000000001'::uuid);

SELECT test_set_jwt('traiteur_manager', 'org0002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.factures_collectes WHERE facture_id = 'fac_0001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T41 Isolation : facture_collecte A invisible à user B'
);

-- T42 : Collecte_flux cross-org denied
SELECT test_as_superuser();
INSERT INTO plateforme.flux_dechets (id, code, libelle)
VALUES ('flux_0001-0000-0000-0000-000000000001'::uuid, 'test_flux', 'Test Flux');

INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_kg)
VALUES ('col_0001-0000-0000-0000-000000000001'::uuid, 'flux_0001-0000-0000-0000-000000000001'::uuid, 50);

SELECT test_set_jwt('traiteur_manager', 'org0002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.collecte_flux WHERE collecte_id = 'col_0001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T42 Isolation : collecte_flux A invisible à user B'
);

-- T43 : Users org isolation — user B ne voit pas user A
SELECT test_set_jwt('traiteur_manager', 'org0002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.users WHERE id = 'usr_0001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T43 Isolation : user A invisible à user B (org isolation)'
);

-- T44 : Polymorphe isolation — fichier lié à collecte A via bordereau, invisible à B
SELECT test_set_jwt('traiteur_manager', 'org0002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers WHERE entity_id = 'bdr_0001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T44 Isolation : fichier polymorphe (bordereau A) invisible à user B'
);

-- =====================================================================

SELECT * FROM finish();
ROLLBACK;

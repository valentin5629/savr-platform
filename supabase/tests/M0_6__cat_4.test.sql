-- =============================================================================
-- Tests pgTAP M0.6 — RLS exhaustive — Catégorie 4 (Isolation données)
-- =============================================================================
-- Périmètre : 16 tests RLS pures — cross-org, soft-delete, polymorphe, PII
-- Validation de la cloisonnement complet entre organisations
-- =============================================================================

BEGIN;
SELECT plan(16);

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

-- JWT au format PRODUCTION (post-fix 20260617180000) : claim réservé `role` =
-- 'authenticated' (lu par PostgREST + auth.role()) ET claim métier `user_role`
-- (lu par la RLS via f_app_role()). test_set_jwt ci-dessus OMET `role`, ce qui
-- rend inertes les policies lisant auth.role()/auth.jwt()->>'role' sous le harnais
-- (c'est précisément ce qui a masqué la fuite ct_read). Ce helper reproduit
-- fidèlement le JWT prod pour exercer ces policies.
CREATE OR REPLACE FUNCTION test_set_jwt_prod(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'role', 'authenticated',
    'user_role', p_role,
    'organisation_id', p_org_id,
    'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

-- =====================================================================
-- SETUP FIXTURE — 3 orgas pour tester cross-org
-- =====================================================================

SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES
  ('0a900001-0000-0000-0000-000000000001'::uuid, 'Org A', 'traiteur', true, false, '11111111100001', 'a@test.com'),
  ('0a900002-0000-0000-0000-000000000001'::uuid, 'Org B', 'traiteur', true, false, '22222222200001', 'b@test.com'),
  ('0a900003-0000-0000-0000-000000000001'::uuid, 'Org C', 'client_organisateur', true, false, '33333333300001', 'c@test.com');

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('e0010001-0000-0000-0000-000000000001'::uuid, 'test', 'Test');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('1e000001-0000-0000-0000-000000000001'::uuid, 'Lieu', '1 rue', '75001', 'Paris', 'fourgon');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES
  ('05e70001-0000-0000-0000-000000000001'::uuid, '0a900001-0000-0000-0000-000000000001'::uuid, 'a@a.test', 'A', 'A', 'traiteur_manager'),
  ('05e70002-0000-0000-0000-000000000001'::uuid, '0a900002-0000-0000-0000-000000000001'::uuid, 'b@b.test', 'B', 'B', 'traiteur_manager');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES
  ('ee100001-0000-0000-0000-000000000001'::uuid, '0a900001-0000-0000-0000-000000000001'::uuid, 'A SA', '11111111100001', '1 rue', '75001', 'Paris'),
  ('ee100002-0000-0000-0000-000000000001'::uuid, '0a900002-0000-0000-0000-000000000001'::uuid, 'B SA', '22222222200001', '2 rue', '75002', 'Paris');

-- Événements A et B
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
)
VALUES
  ('e0e00001-0000-0000-0000-000000000001'::uuid, '0a900001-0000-0000-0000-000000000001'::uuid, '1e000001-0000-0000-0000-000000000001'::uuid, '0a900001-0000-0000-0000-000000000001'::uuid, 'ee100001-0000-0000-0000-000000000001'::uuid, '05e70001-0000-0000-0000-000000000001'::uuid, 'e0010001-0000-0000-0000-000000000001'::uuid, NOW() + INTERVAL '10 days', 100, 'Contact A', '0601010101'),
  ('e0e00002-0000-0000-0000-000000000001'::uuid, '0a900002-0000-0000-0000-000000000001'::uuid, '1e000001-0000-0000-0000-000000000001'::uuid, '0a900002-0000-0000-0000-000000000001'::uuid, 'ee100002-0000-0000-0000-000000000001'::uuid, '05e70002-0000-0000-0000-000000000001'::uuid, 'e0010001-0000-0000-0000-000000000001'::uuid, NOW() + INTERVAL '5 days', 50, 'Contact B', '0602020202');

-- Collectes A et B
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
VALUES
  ('c01c0001-0000-0000-0000-000000000001'::uuid, 'e0e00001-0000-0000-0000-000000000001'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00'),
  ('c01c0002-0000-0000-0000-000000000001'::uuid, 'e0e00002-0000-0000-0000-000000000001'::uuid, 'anti_gaspi', 'programmee', 'non_envoye', current_date + 5, '09:00');

-- Bordereaux A et B
INSERT INTO plateforme.bordereaux_savr (id, collecte_id, statut)
VALUES
  ('bd100001-0000-0000-0000-000000000001'::uuid, 'c01c0001-0000-0000-0000-000000000001'::uuid, 'brouillon'),
  ('bd100002-0000-0000-0000-000000000001'::uuid, 'c01c0002-0000-0000-0000-000000000001'::uuid, 'brouillon');

-- Fichiers A et B (polymorphes)
INSERT INTO shared.fichiers (id, storage_provider, bucket, key, size_bytes, content_type, entity_type, entity_id)
VALUES
  ('f1100001-0000-0000-0000-000000000001'::uuid, 'r2', 'savr-docs', 'bdr/a.pdf', 1024, 'application/pdf', 'plateforme.bordereaux_savr', 'bd100001-0000-0000-0000-000000000001'::uuid),
  ('f1100002-0000-0000-0000-000000000001'::uuid, 'r2', 'savr-docs', 'bdr/b.pdf', 1024, 'application/pdf', 'plateforme.bordereaux_savr', 'bd100002-0000-0000-0000-000000000001'::uuid),
  ('f1100003-0000-0000-0000-000000000001'::uuid, 'r2', 'savr-docs', 'photos/a.jpg', 2048, 'image/jpeg', 'plateforme.collectes', 'c01c0001-0000-0000-0000-000000000001'::uuid);

-- Factures A et B
INSERT INTO plateforme.factures (id, organisation_id, entite_facturation_id, numero_facture, montant_ht, montant_ttc, statut)
VALUES
  ('fac00001-0000-0000-0000-000000000001'::uuid, '0a900001-0000-0000-0000-000000000001'::uuid, 'ee100001-0000-0000-0000-000000000001'::uuid, 'FAC-001', 100.00, 120.00, 'brouillon'),
  ('fac00002-0000-0000-0000-000000000001'::uuid, '0a900002-0000-0000-0000-000000000001'::uuid, 'ee100002-0000-0000-0000-000000000001'::uuid, 'FAC-002', 150.00, 180.00, 'brouillon');

-- Packs AG A et B
INSERT INTO plateforme.tarifs_packs_ag (id, valide_du, type_pack, credits, prix_unitaire_ht)
VALUES ('da100001-0000-0000-0000-000000000001'::uuid, '2026-01-01', 'pack_10', 10, 500.00);

INSERT INTO plateforme.packs_antgaspi (id, organisation_id, statut, date_achat, credits_initiaux, type_pack)
VALUES
  ('ace00001-0000-0000-0000-000000000001'::uuid, '0a900001-0000-0000-0000-000000000001'::uuid, 'actif', current_date, 10, 'personnalise'),
  ('ace00002-0000-0000-0000-000000000001'::uuid, '0a900002-0000-0000-0000-000000000001'::uuid, 'actif', current_date, 5, 'personnalise');

-- =====================================================================
-- CATÉGORIE 4 — ISOLATION DONNÉES (16 tests cross-org, soft-delete, etc.)
-- =====================================================================

-- T31 : Photo A invisible à user B
SELECT test_set_jwt('traiteur_manager', '0a900002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers WHERE id = 'f1100003-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T31 Isolation : photo A invisible à user B'
);

-- T32 : Bordereau A invisible à user B
SELECT test_set_jwt('traiteur_manager', '0a900002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers WHERE id = 'f1100001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T32 Isolation : bordereau A invisible à user B'
);

-- T33 : Facture A invisible à user B
SELECT test_set_jwt('traiteur_manager', '0a900002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.factures WHERE id = 'fac00001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T33 Isolation : facture A invisible à user B'
);

-- T34 : Pack A invisible à user B
SELECT test_set_jwt('traiteur_manager', '0a900002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.packs_antgaspi WHERE id = 'ace00001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T34 Isolation : pack A invisible à user B'
);

-- T35 : Événement A invisible à user B
SELECT test_set_jwt('traiteur_manager', '0a900002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.evenements WHERE id = 'e0e00001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T35 Isolation : événement A invisible à user B'
);

-- T36 : Soft-delete fichier — après deleted_at, invisible
SELECT test_as_superuser();
UPDATE shared.fichiers SET deleted_at = NOW() WHERE id = 'f1100002-0000-0000-0000-000000000001';
SELECT test_set_jwt('traiteur_manager', '0a900002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers WHERE id = 'f1100002-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T36 Isolation : fichier soft-deleted invisible'
);

-- T37 : User A voit TOUS ses fichiers A (count=2 : bordereau + photo)
SELECT test_set_jwt('traiteur_manager', '0a900001-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers WHERE entity_id IN ('c01c0001-0000-0000-0000-000000000001', 'bd100001-0000-0000-0000-000000000001')$$,
  $$VALUES (2)$$,
  'T37 Isolation : user A voit TOUS ses fichiers (polymorphes)'
);

-- T38 : Tournées isolées par collecte (test structurel)
SELECT test_as_superuser();
-- Prestataire requis (prestataire_logistique_id NOT NULL dans tournees)
INSERT INTO shared.prestataires (id, nom, code)
VALUES ('0ea5ca04-0000-0000-0000-000000000001'::uuid, 'Presta Test Cat4', 'presta-cat4');

-- Tournées avec vraies colonnes (pas de collecte_id direct — passe par collecte_tournees)
INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, chauffeur_nom)
VALUES
  ('d00e0001-0000-0000-0000-000000000001'::uuid, 'T-CAT4-A', current_date + 10, 'matin', '0ea5ca04-0000-0000-0000-000000000001'::uuid, 'Chauffeur A'),
  ('d00e0002-0000-0000-0000-000000000001'::uuid, 'T-CAT4-B', current_date + 5, 'matin', '0ea5ca04-0000-0000-0000-000000000001'::uuid, 'Chauffeur B');

-- Liaisons collecte ↔ tournée via table N-N
INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id)
VALUES
  ('c01c0001-0000-0000-0000-000000000001'::uuid, 'd00e0001-0000-0000-0000-000000000001'::uuid),
  ('c01c0002-0000-0000-0000-000000000001'::uuid, 'd00e0002-0000-0000-0000-000000000001'::uuid);

SELECT test_set_jwt('traiteur_manager', '0a900002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.tournees WHERE id = 'd00e0001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T38 Isolation : tour A invisible à user B'
);

-- T39 : Attributions AG cross-org denied
SELECT test_as_superuser();
-- Association et transporteur requis par les FK NOT NULL de attributions_antgaspi
INSERT INTO plateforme.associations (id, nom, adresse, region, ville, contact_email, description_rapport_impact)
VALUES ('a5500001-0000-0000-0000-000000000001'::uuid, 'Asso Test Cat4', '1 rue', 'idf', 'Paris', 'asso@test.com', 'Association de test pour les tests pgTAP RLS.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.transporteurs (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms, contact_nom, contact_email, contact_telephone)
VALUES ('7a000001-0000-0000-0000-000000000001'::uuid, 'Transporteur Cat4', '123456789', '1 rue', '75001', 'Paris', ARRAY['fourgon'], 'mts1', 'Contact', 'transp@test.com', '0601010101')
ON CONFLICT (id) DO NOTHING;

INSERT INTO plateforme.attributions_antgaspi (id, collecte_id, association_id, transporteur_id, branche_attribution, mode_validation)
VALUES ('add00001-0000-0000-0000-000000000001'::uuid, 'c01c0001-0000-0000-0000-000000000001'::uuid, 'a5500001-0000-0000-0000-000000000001'::uuid, '7a000001-0000-0000-0000-000000000001'::uuid, 'IDF', 'manuel_top1');

SELECT test_set_jwt('traiteur_manager', '0a900002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.attributions_antgaspi WHERE id = 'add00001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T39 Isolation : attribution A invisible à user B'
);

-- T40 : Rapports RSE cross-org denied
SELECT test_as_superuser();
INSERT INTO plateforme.rapports_rse (id, evenement_id, collecte_id, disponible_a)
VALUES ('e0005e01-0000-0000-0000-000000000001'::uuid, 'e0e00001-0000-0000-0000-000000000001'::uuid, 'c01c0001-0000-0000-0000-000000000001'::uuid, NOW());

SELECT test_set_jwt('traiteur_manager', '0a900002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.rapports_rse WHERE id = 'e0005e01-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T40 Isolation : rapport RSE A invisible à user B'
);

-- T41 : Factures_collectes cross-org denied
SELECT test_as_superuser();
INSERT INTO plateforme.factures_collectes (facture_id, collecte_id)
VALUES ('fac00001-0000-0000-0000-000000000001'::uuid, 'c01c0001-0000-0000-0000-000000000001'::uuid);

SELECT test_set_jwt('traiteur_manager', '0a900002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.factures_collectes WHERE facture_id = 'fac00001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T41 Isolation : facture_collecte A invisible à user B'
);

-- T42 : Collecte_flux cross-org denied
-- Utilise un flux_dechets existant (seedé par la migration bloc8)
SELECT test_as_superuser();
INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT 'c01c0001-0000-0000-0000-000000000001'::uuid, id, 50
FROM plateforme.flux_dechets WHERE code = 'biodechet' LIMIT 1;

SELECT test_set_jwt('traiteur_manager', '0a900002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.collecte_flux WHERE collecte_id = 'c01c0001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T42 Isolation : collecte_flux A invisible à user B'
);

-- T43 : Users org isolation — user B ne voit pas user A
SELECT test_set_jwt('traiteur_manager', '0a900002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.users WHERE id = '05e70001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T43 Isolation : user A invisible à user B (org isolation)'
);

-- T44 : Polymorphe isolation — fichier lié à collecte A via bordereau, invisible à B
SELECT test_set_jwt('traiteur_manager', '0a900002-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers WHERE entity_id = 'bd100001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T44 Isolation : fichier polymorphe (bordereau A) invisible à user B'
);

-- T63/T64 : contacts_traiteurs — fuite PII cross-org (régression ct_read PERMISSIVE)
-- contacts_traiteurs porte organisation_id NOT NULL + PII (prenom/nom/telephone/email).
-- ct_read (auth.role()='authenticated', migration 20260611180000) ouvrait la lecture à
-- TOUS les rôles authentifiés → fuite cross-org. Fix = DROP ct_read (20260622150000).
-- Accès légitime restant : admin_savr / ops_savr / traiteurs de l'org propriétaire.
SELECT test_as_superuser();
INSERT INTO plateforme.contacts_traiteurs (id, organisation_id, prenom, nom, telephone, email)
VALUES
  ('c0a70001-0000-0000-0000-000000000001'::uuid, '0a900001-0000-0000-0000-000000000001'::uuid, 'Alice', 'Martin', '0611111111', 'alice@a.test'),
  ('c0a70002-0000-0000-0000-000000000001'::uuid, '0a900002-0000-0000-0000-000000000001'::uuid, 'Bob', 'Durand', '0622222222', 'bob@b.test');

-- T63 : traiteur org A ne voit QUE ses propres contacts (org-scopé, pas les contacts de B)
-- JWT prod (role=authenticated + user_role) → exerce ct_read : AVANT le fix la fuite
-- ferait voir les 2 contacts (count=2), APRÈS le DROP seul ct_traiteur_select → 1.
SELECT test_set_jwt_prod('traiteur_manager', '0a900001-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.contacts_traiteurs$$,
  $$VALUES (1)$$,
  'T63 Isolation : traiteur org A voit uniquement SES contacts (org-scopé)'
);

-- T64 : rôle non-staff d'une AUTRE organisation ne voit AUCUN contact de org A (DENY PII cross-org)
-- JWT prod (role=authenticated) → AVANT le fix ct_read fuiterait le contact de org A (count=1),
-- APRÈS le DROP aucune policy ne couvre client_organisateur → 0.
SELECT test_set_jwt_prod('client_organisateur', '0a900003-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.contacts_traiteurs WHERE organisation_id = '0a900001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T64 Isolation : contacts (PII) de org A invisibles à un rôle non-staff d''une autre org'
);

-- =====================================================================

SELECT * FROM finish();
ROLLBACK;

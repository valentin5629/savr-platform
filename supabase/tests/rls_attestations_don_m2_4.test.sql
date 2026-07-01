-- M2.4 — Tests pgTAP RLS attestations_don + trigger R9 régénération auto
-- Source : §09 matrice attestations_don + spec 11-12 scénarios attestations_don_org_scoped
--          + §06.09 correction_volume_repas_realise_regenere_attestation
-- Couche : db — Priorité : P1-critique

BEGIN;

SELECT plan(19);

-- ─── Helpers JWT (pattern canonique repo) ──────────────────────────────────

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role    text,
  p_org_id  uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
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

-- ─── UUIDs déterministes ────────────────────────────────────────────────────

DO $$ BEGIN
  -- organisations
  INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
    ('a0000000-0000-0000-0000-000000000001'::uuid, 'Org A', 'Org A SARL', 'traiteur', '11111111100001', true),
    ('a0000000-0000-0000-0000-000000000002'::uuid, 'Org B', 'Org B SARL', 'traiteur', '22222222200002', true);

  -- entités de facturation (FK requise pour evenements)
  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
    ('a1000000-0000-0000-0000-000000000001'::uuid,
     'a0000000-0000-0000-0000-000000000001'::uuid,
     'Org A SARL', '11111111100001', '1 Rue A', '75001', 'Paris'),
    ('a1000000-0000-0000-0000-000000000002'::uuid,
     'a0000000-0000-0000-0000-000000000002'::uuid,
     'Org B SARL', '22222222200002', '2 Rue B', '75002', 'Paris');

  -- utilisateurs (table plateforme.users — pas de profils, pas de auth.users en pgTAP)
  INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
    ('b0000000-0000-0000-0000-000000000001'::uuid,
     'a0000000-0000-0000-0000-000000000001'::uuid,
     'mgr-a@rls-test.local', 'Mgr', 'A', 'traiteur_manager'),
    ('b0000000-0000-0000-0000-000000000002'::uuid,
     'a0000000-0000-0000-0000-000000000002'::uuid,
     'mgr-b@rls-test.local', 'Mgr', 'B', 'traiteur_manager'),
    ('b0000000-0000-0000-0000-000000000003'::uuid,
     'a0000000-0000-0000-0000-000000000001'::uuid,
     'admin@rls-test.local', 'Admin', 'Savr', 'admin_savr'),
    ('b0000000-0000-0000-0000-000000000004'::uuid,
     'a0000000-0000-0000-0000-000000000001'::uuid,
     'com-a@rls-test.local', 'Com', 'A', 'traiteur_commercial');

  -- lieu partagé (pas d'organisation_id sur lieux — référentiel partagé)
  INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region) VALUES
    ('c0000000-0000-0000-0000-000000000001'::uuid, 'Salle A',
     '1 rue Test', '75001', 'Paris', 'camionnette', 48.8566, 2.3522, 'idf');

  -- type d'événement requis par la FK
  INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif) VALUES
    ('c1000000-0000-0000-0000-000000000001'::uuid, 'GALA_M24', 'Gala M2.4 Test', 1, true);

  -- événements (colonnes NOT NULL obligatoires)
  INSERT INTO plateforme.evenements (
    id, organisation_id, traiteur_operationnel_organisation_id,
    entite_facturation_id, created_by, lieu_id, type_evenement_id,
    nom_evenement, date_evenement, pax,
    contact_principal_nom, contact_principal_telephone
  ) VALUES
    ('d0000000-0000-0000-0000-000000000001'::uuid,
     'a0000000-0000-0000-0000-000000000001'::uuid,
     'a0000000-0000-0000-0000-000000000001'::uuid,
     'a1000000-0000-0000-0000-000000000001'::uuid,
     'b0000000-0000-0000-0000-000000000001'::uuid,
     'c0000000-0000-0000-0000-000000000001'::uuid,
     'c1000000-0000-0000-0000-000000000001'::uuid,
     'Gala A', '2026-06-01', 100, 'Contact A', '0600000001'),
    ('d0000000-0000-0000-0000-000000000002'::uuid,
     'a0000000-0000-0000-0000-000000000002'::uuid,
     'a0000000-0000-0000-0000-000000000002'::uuid,
     'a1000000-0000-0000-0000-000000000002'::uuid,
     'b0000000-0000-0000-0000-000000000002'::uuid,
     'c0000000-0000-0000-0000-000000000001'::uuid,
     'c1000000-0000-0000-0000-000000000001'::uuid,
     'Gala B', '2026-06-02', 80, 'Contact B', '0600000002');

  -- collectes (date_collecte + heure_collecte NOT NULL ; pas de cloturee_at ni created_by)
  INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, realisee_at) VALUES
    ('e0000000-0000-0000-0000-000000000001'::uuid,
     'd0000000-0000-0000-0000-000000000001'::uuid,
     'anti_gaspi', 'cloturee', 'non_envoye', '2026-06-01', '08:00', now() - interval '26h'),
    ('e0000000-0000-0000-0000-000000000002'::uuid,
     'd0000000-0000-0000-0000-000000000002'::uuid,
     'anti_gaspi', 'cloturee', 'non_envoye', '2026-06-02', '08:00', now() - interval '26h');

  -- association (colonnes NOT NULL : adresse, region, ville, contact_email ;
  -- description_rapport_impact requiert >= 30 caractères, le DEFAULT n'y suffit pas)
  INSERT INTO plateforme.associations (id, nom, adresse, region, ville, contact_email, description_rapport_impact, habilitee_attestation_fiscale, actif) VALUES
    ('f0000000-0000-0000-0000-000000000001'::uuid,
     'Asso Test', '10 Rue Solidaire', 'idf', 'Paris', 'contact@asso-test.fr',
     'Association de test pour les attestations de don M2.4.', true, true);

  -- attestations (une par org)
  INSERT INTO plateforme.attestations_don (
    id, collecte_id, association_id, mention_fiscale_2041ge,
    numero, date_emission, date_collecte,
    donateur_raison_sociale, donateur_siret,
    association_nom, association_habilitation,
    volume_repas, version, statut
  ) VALUES
    ('f0000000-0000-0000-0001-000000000001'::uuid,
     'e0000000-0000-0000-0000-000000000001'::uuid,
     'f0000000-0000-0000-0000-000000000001'::uuid, true,
     'ATT-DON-2026-00101', '2026-06-02', '2026-06-01',
     'Org A', '11111111100001', 'Asso Test', 'habilitee',
     120, 1, 'emise'),
    ('f0000000-0000-0000-0001-000000000002'::uuid,
     'e0000000-0000-0000-0000-000000000002'::uuid,
     'f0000000-0000-0000-0000-000000000001'::uuid, true,
     'ATT-DON-2026-00102', '2026-06-03', '2026-06-02',
     'Org B', '22222222200002', 'Asso Test', 'habilitee',
     80, 1, 'emise');
END $$;

-- ─── Section RLS ─────────────────────────────────────────────────────────────

-- T1/T1b : traiteur_manager org A voit uniquement son attestation
SELECT test_set_jwt(
  'traiteur_manager',
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'b0000000-0000-0000-0000-000000000001'::uuid
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.attestations_don),
  1,
  'T1 : traiteur_manager org A voit 1 attestation'
);

SELECT is(
  (SELECT id FROM plateforme.attestations_don LIMIT 1),
  'f0000000-0000-0000-0001-000000000001'::uuid,
  'T1b : attestation visible = att org A'
);

-- T2/T2b : attestations_don_org_scoped — org B ne voit pas attestation org A
SELECT test_set_jwt(
  'traiteur_manager',
  'a0000000-0000-0000-0000-000000000002'::uuid,
  'b0000000-0000-0000-0000-000000000002'::uuid
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.attestations_don),
  1,
  'T2 : attestations_don_org_scoped — org B voit 1 attestation'
);

SELECT is(
  (SELECT id FROM plateforme.attestations_don LIMIT 1),
  'f0000000-0000-0000-0001-000000000002'::uuid,
  'T2b : org B voit uniquement att-rls-b'
);

-- T3 : INSERT direct par traiteur → deny (regeneration_bordereau_et_attestation_interdites_traiteur)
SELECT test_set_jwt(
  'traiteur_manager',
  'a0000000-0000-0000-0000-000000000002'::uuid,
  'b0000000-0000-0000-0000-000000000002'::uuid
);

SELECT throws_ok(
  $$INSERT INTO plateforme.attestations_don (
      collecte_id, association_id, mention_fiscale_2041ge,
      numero, date_emission, date_collecte,
      donateur_raison_sociale, donateur_siret,
      association_nom, association_habilitation,
      volume_repas, version, statut
    ) VALUES (
      'e0000000-0000-0000-0000-000000000002'::uuid,
      'f0000000-0000-0000-0000-000000000001'::uuid, false,
      'ATT-DON-2026-99999', '2026-06-15', '2026-06-14',
      'Hack', '00000000000000', 'Asso X', 'non_habilitee',
      10, 1, 'brouillon'
    )$$,
  '42501',
  NULL,
  'T3 : INSERT attestations_don par traiteur_manager → deny RLS'
);

-- T4 : admin_savr voit toutes les attestations
SELECT test_set_jwt(
  'admin_savr',
  NULL,
  'b0000000-0000-0000-0000-000000000003'::uuid
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.attestations_don),
  2,
  'T4 : admin_savr voit toutes les attestations (2)'
);

-- AUTH-02 (delete_attestation_deny) : l'attestation de don (Cerfa 2041-GE) est un
-- document fiscal immuable — aucune policy DELETE (att_admin scindé, migration
-- 20260701120100). Le DELETE ne lève pas mais n'affecte 0 ligne (RLS DENY résiduel).
SELECT lives_ok(
  $$DELETE FROM plateforme.attestations_don WHERE id = 'f0000000-0000-0000-0001-000000000002'$$,
  'delete_attestation_deny : DELETE admin_savr ne lève pas (RLS filtre silencieusement)'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.attestations_don
   WHERE id = 'f0000000-0000-0000-0001-000000000002'::uuid),
  1,
  'delete_attestation_deny : attestation TOUJOURS présente après DELETE admin (aucune policy DELETE)'
);

-- T5/T5b : admin_savr peut UPDATE
SELECT lives_ok(
  $$UPDATE plateforme.attestations_don
    SET statut = 'corrigee'
    WHERE id = 'f0000000-0000-0000-0001-000000000001'$$,
  'T5 : admin_savr peut UPDATE attestations_don'
);

SELECT is(
  (SELECT statut::text FROM plateforme.attestations_don
   WHERE id = 'f0000000-0000-0000-0001-000000000001'::uuid),
  'corrigee',
  'T5b : statut mis à jour à corrigee'
);

-- Restaurer en emise avant les tests trigger
SELECT test_as_superuser();
UPDATE plateforme.attestations_don
SET statut = 'emise'
WHERE id = 'f0000000-0000-0000-0001-000000000001'::uuid;

-- T6 : traiteur_commercial voit ses attestations
SELECT test_set_jwt(
  'traiteur_commercial',
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'b0000000-0000-0000-0000-000000000004'::uuid
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.attestations_don),
  1,
  'T6 : traiteur_commercial org A voit 1 attestation'
);

-- ─── Section R9 : trigger fn_trg_regenerer_attestation ───────────────────────
-- Source : §06.09 correction_volume_repas_realise_regenere_attestation + §12 §1.3

SELECT test_as_superuser();

-- Fixtures trigger R9
-- type_tms='autre' suffit pour ce test (le type n'est pas vérifié par le trigger)
INSERT INTO plateforme.transporteurs (
  id, nom, siren, adresse, code_postal, ville,
  types_vehicules, type_tms,
  contact_nom, contact_email, contact_telephone, actif
) VALUES (
  '90000000-0000-0000-0000-000000000001'::uuid,
  'Transp Test', '987654321', '1 Rue Logistique', '75001', 'Paris',
  ARRAY['camionnette'], 'autre',
  'Contact Test', 'contact@transp-test.fr', '0100000001', true
);

INSERT INTO plateforme.attributions_antgaspi (
  id, collecte_id, association_id, transporteur_id,
  branche_attribution, mode_validation,
  volume_repas_realise, poids_repas_kg
) VALUES (
  '80000000-0000-0000-0000-000000000001'::uuid,
  'e0000000-0000-0000-0000-000000000001'::uuid,
  'f0000000-0000-0000-0000-000000000001'::uuid,
  '90000000-0000-0000-0000-000000000001'::uuid,
  'ag_velo_idf', 'manuel_top1',
  120, 54.0
);

-- Relier attestation existante à cette attribution
UPDATE plateforme.attestations_don
SET attribution_antgaspi_id = '80000000-0000-0000-0000-000000000001'::uuid
WHERE id = 'f0000000-0000-0000-0001-000000000001'::uuid;

-- Seed facteur CO2 AG (ECR-2 : source = parametres_facteurs_co2_ag)
INSERT INTO plateforme.parametres_facteurs_co2_ag (cle, facteur_co2_evite_par_repas_kg, source_donnee, actif)
VALUES ('co2_ag_ademe_v1', 2.5, 'FAO ADEME figé V1', true)
ON CONFLICT (cle) DO UPDATE SET facteur_co2_evite_par_repas_kg = 2.5;

-- Déclencher le trigger : correction volume 120 → 100
UPDATE plateforme.attributions_antgaspi
SET volume_repas_realise = 100
WHERE id = '80000000-0000-0000-0000-000000000001'::uuid;

-- T7 : ancienne attestation marquée corrigee
SELECT is(
  (SELECT statut::text FROM plateforme.attestations_don
   WHERE id = 'f0000000-0000-0000-0001-000000000001'::uuid),
  'corrigee',
  'T7 (R9) : ancienne attestation marquée corrigee après correction volume'
);

-- T8 : nouvelle attestation version=2 créée
SELECT is(
  (SELECT count(*)::int FROM plateforme.attestations_don
   WHERE attribution_antgaspi_id = '80000000-0000-0000-0000-000000000001'::uuid
     AND version = 2),
  1,
  'T8 (R9) : attestation version=2 créée'
);

-- T9 : volume_repas = 100 dans la version 2
SELECT is(
  (SELECT volume_repas FROM plateforme.attestations_don
   WHERE attribution_antgaspi_id = '80000000-0000-0000-0000-000000000001'::uuid
     AND version = 2),
  100,
  'T9 (R9) : volume_repas = 100 dans la nouvelle version'
);

-- T10 : co2_evite_kg = 250 (100 × 2.5)
SELECT is(
  (SELECT co2_evite_kg FROM plateforme.attestations_don
   WHERE attribution_antgaspi_id = '80000000-0000-0000-0000-000000000001'::uuid
     AND version = 2),
  250.0::numeric(10,3),
  'T10 (R9) : co2_evite_kg = 250 (100 × 2.5 kgCO2e)'
);

-- T11 : job PDF attestation-don enqueué pour la version 2
SELECT is(
  (SELECT count(*)::int
   FROM plateforme.jobs_pdf j
   JOIN plateforme.attestations_don a ON a.id = j.entity_id
   WHERE j.type_document = 'attestation-don'
     AND a.version = 2
     AND a.attribution_antgaspi_id = '80000000-0000-0000-0000-000000000001'::uuid),
  1,
  'T11 (R9) : 1 job PDF attestation-don enqueué pour version 2'
);

-- T12 : job en statut pending
SELECT is(
  (SELECT j.statut::text
   FROM plateforme.jobs_pdf j
   JOIN plateforme.attestations_don a ON a.id = j.entity_id
   WHERE j.type_document = 'attestation-don'
     AND a.version = 2
     AND a.attribution_antgaspi_id = '80000000-0000-0000-0000-000000000001'::uuid
   LIMIT 1),
  'pending',
  'T12 (R9) : job en statut pending'
);

-- T13 : idempotence — trigger no-op si aucune attestation emise (version 2 est brouillon)
UPDATE plateforme.attributions_antgaspi
SET volume_repas_realise = 90
WHERE id = '80000000-0000-0000-0000-000000000001'::uuid;

SELECT is(
  (SELECT count(*)::int FROM plateforme.attestations_don
   WHERE attribution_antgaspi_id = '80000000-0000-0000-0000-000000000001'::uuid),
  2,
  'T13 (R9 idempotence) : trigger no-op si aucune attestation emise (2 versions au total)'
);

-- T14 : nouveau numéro distinct de l'original
SELECT isnt(
  (SELECT numero FROM plateforme.attestations_don
   WHERE attribution_antgaspi_id = '80000000-0000-0000-0000-000000000001'::uuid
     AND version = 2),
  'ATT-DON-2026-00101',
  'T14 (R9) : nouvelle attestation reçoit un numéro distinct'
);

SELECT * FROM finish();
ROLLBACK;

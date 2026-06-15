-- M2.4 — Tests pgTAP RLS attestations_don + trigger R9 régénération auto
-- Source : §09 matrice attestations_don + spec 11-12 scénarios attestations_don_org_scoped
--          + §06.09 correction_volume_repas_realise_regenere_attestation
-- Couche : db — Priorité : P1-critique

BEGIN;

SELECT plan(17);

-- ─── Helpers JWT (pattern canonique repo) ──────────────────────────────────

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role    text,
  p_org_id  uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
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

-- ─── UUIDs déterministes ────────────────────────────────────────────────────

DO $$ BEGIN
  -- organisations
  INSERT INTO plateforme.organisations (id, nom, type, siret, actif) VALUES
    ('a0000000-0000-0000-0000-000000000001'::uuid, 'Org A', 'traiteur', '11111111100001', true),
    ('a0000000-0000-0000-0000-000000000002'::uuid, 'Org B', 'traiteur', '22222222200002', true);

  -- utilisateurs
  INSERT INTO auth.users (id, email) VALUES
    ('b0000000-0000-0000-0000-000000000001'::uuid, 'mgr-a@rls-test.local'),
    ('b0000000-0000-0000-0000-000000000002'::uuid, 'mgr-b@rls-test.local'),
    ('b0000000-0000-0000-0000-000000000003'::uuid, 'admin@rls-test.local'),
    ('b0000000-0000-0000-0000-000000000004'::uuid, 'com-a@rls-test.local');

  INSERT INTO plateforme.profils (user_id, organisation_id, role) VALUES
    ('b0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid, 'traiteur_manager'),
    ('b0000000-0000-0000-0000-000000000002'::uuid, 'a0000000-0000-0000-0000-000000000002'::uuid, 'traiteur_manager'),
    ('b0000000-0000-0000-0000-000000000003'::uuid, NULL, 'admin_savr'),
    ('b0000000-0000-0000-0000-000000000004'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid, 'traiteur_commercial');

  -- lieu partagé
  INSERT INTO plateforme.lieux (id, nom, organisation_id, adresse_acces, code_postal, ville, actif) VALUES
    ('c0000000-0000-0000-0000-000000000001'::uuid, 'Salle A',
     'a0000000-0000-0000-0000-000000000001'::uuid, '1 rue Test', '75001', 'Paris', true);

  -- événements
  INSERT INTO plateforme.evenements (id, organisation_id, lieu_id, nom_evenement, date_evenement, nb_pax, statut) VALUES
    ('d0000000-0000-0000-0000-000000000001'::uuid,
     'a0000000-0000-0000-0000-000000000001'::uuid,
     'c0000000-0000-0000-0000-000000000001'::uuid, 'Gala A', '2026-06-01', 100, 'programme'),
    ('d0000000-0000-0000-0000-000000000002'::uuid,
     'a0000000-0000-0000-0000-000000000002'::uuid,
     'c0000000-0000-0000-0000-000000000001'::uuid, 'Gala B', '2026-06-02', 80, 'programme');

  -- collectes
  INSERT INTO plateforme.collectes (id, evenement_id, type, statut, realisee_at, cloturee_at, created_by) VALUES
    ('e0000000-0000-0000-0000-000000000001'::uuid,
     'd0000000-0000-0000-0000-000000000001'::uuid,
     'anti_gaspi', 'cloturee', now() - interval '26h', now() - interval '25h',
     'b0000000-0000-0000-0000-000000000001'::uuid),
    ('e0000000-0000-0000-0000-000000000002'::uuid,
     'd0000000-0000-0000-0000-000000000002'::uuid,
     'anti_gaspi', 'cloturee', now() - interval '26h', now() - interval '25h',
     'b0000000-0000-0000-0000-000000000002'::uuid);

  -- association
  INSERT INTO plateforme.associations (id, nom, habilitee_attestation_fiscale, actif) VALUES
    ('f0000000-0000-0000-0000-000000000001'::uuid, 'Asso Test', true, true);

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
      10, 1, 'en_attente'
    )$$,
  '42501',
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
INSERT INTO plateforme.transporteurs (id, nom, type_tms, siret, actif) VALUES
  ('g0000000-0000-0000-0000-000000000001'::uuid, 'Strike', 'mts1', '98765432100011', true);

INSERT INTO plateforme.attributions_antgaspi (
  id, collecte_id, association_id, transporteur_id,
  branche_attribution, mode_validation,
  volume_repas_realise, poids_repas_kg
) VALUES (
  'h0000000-0000-0000-0000-000000000001'::uuid,
  'e0000000-0000-0000-0000-000000000001'::uuid,
  'f0000000-0000-0000-0000-000000000001'::uuid,
  'g0000000-0000-0000-0000-000000000001'::uuid,
  'ag_velo_idf', 'admin',
  120, 54.0
);

-- Relier attestation existante à cette attribution
UPDATE plateforme.attestations_don
SET attribution_antgaspi_id = 'h0000000-0000-0000-0000-000000000001'::uuid
WHERE id = 'f0000000-0000-0000-0001-000000000001'::uuid;

-- Seed paramètre CO2 (INSERT ou no-op si déjà présent via migration)
INSERT INTO plateforme.parametres_algo (cle, valeur, type_valeur, description)
VALUES ('co2_kg_par_repas_ag', '2.5'::jsonb, 'decimal', 'CO2 évité par repas AG (kgCO2e)')
ON CONFLICT (cle) DO UPDATE SET valeur = '2.5'::jsonb;

-- Déclencher le trigger : correction volume 120 → 100
UPDATE plateforme.attributions_antgaspi
SET volume_repas_realise = 100
WHERE id = 'h0000000-0000-0000-0000-000000000001'::uuid;

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
   WHERE attribution_antgaspi_id = 'h0000000-0000-0000-0000-000000000001'::uuid
     AND version = 2),
  1,
  'T8 (R9) : attestation version=2 créée'
);

-- T9 : volume_repas = 100 dans la version 2
SELECT is(
  (SELECT volume_repas FROM plateforme.attestations_don
   WHERE attribution_antgaspi_id = 'h0000000-0000-0000-0000-000000000001'::uuid
     AND version = 2),
  100,
  'T9 (R9) : volume_repas = 100 dans la nouvelle version'
);

-- T10 : co2_evite_kg = 250 (100 × 2.5)
SELECT is(
  (SELECT co2_evite_kg FROM plateforme.attestations_don
   WHERE attribution_antgaspi_id = 'h0000000-0000-0000-0000-000000000001'::uuid
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
     AND a.attribution_antgaspi_id = 'h0000000-0000-0000-0000-000000000001'::uuid),
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
     AND a.attribution_antgaspi_id = 'h0000000-0000-0000-0000-000000000001'::uuid
   LIMIT 1),
  'pending',
  'T12 (R9) : job en statut pending'
);

-- T13 : idempotence — trigger no-op si aucune attestation emise (version 2 est en_attente)
UPDATE plateforme.attributions_antgaspi
SET volume_repas_realise = 90
WHERE id = 'h0000000-0000-0000-0000-000000000001'::uuid;

SELECT is(
  (SELECT count(*)::int FROM plateforme.attestations_don
   WHERE attribution_antgaspi_id = 'h0000000-0000-0000-0000-000000000001'::uuid),
  2,
  'T13 (R9 idempotence) : trigger no-op si aucune attestation emise (2 versions au total)'
);

-- T14 : nouveau numéro distinct de l'original
SELECT isnt(
  (SELECT numero FROM plateforme.attestations_don
   WHERE attribution_antgaspi_id = 'h0000000-0000-0000-0000-000000000001'::uuid
     AND version = 2),
  'ATT-DON-2026-00101',
  'T14 (R9) : nouvelle attestation reçoit un numéro distinct'
);

SELECT * FROM finish();
ROLLBACK;

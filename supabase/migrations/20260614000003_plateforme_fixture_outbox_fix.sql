-- =============================================================================
-- Fix helper pgTAP tests.outbox_fixture_collecte (CI pgtap-rls-outbox)
-- =============================================================================
-- La version initiale (20260614000001) ne fournissait pas les 6 colonnes
-- NOT NULL de plateforme.evenements (traiteur_operationnel_organisation_id,
-- entite_facturation_id, created_by, type_evenement_id,
-- contact_principal_nom, contact_principal_telephone).
-- Cette migration remplace la fonction avec toutes les dépendances FK.
-- =============================================================================

CREATE OR REPLACE FUNCTION tests.outbox_fixture_collecte(p_type text DEFAULT 'zd')
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_org_id        uuid := gen_random_uuid();
  v_user_id       uuid := gen_random_uuid();
  v_lieu_id       uuid;
  v_entite_id     uuid;
  v_type_evt_id   uuid;
  v_evt_id        uuid;
  v_collecte_id   uuid;
BEGIN
  -- Organisation minimale
  INSERT INTO plateforme.organisations (id, nom, type, siret, created_at, updated_at)
  VALUES (v_org_id, 'FixtureOrg-G4', 'traiteur', '00000000000001', now(), now());

  -- User minimal (created_by NOT NULL sur evenements)
  INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, created_at)
  VALUES (v_user_id, v_org_id, 'fixture-g4@test.internal', 'Fixture', 'G4', 'traiteur_manager', now());

  -- Entite de facturation minimale (entite_facturation_id NOT NULL)
  INSERT INTO plateforme.entites_facturation (
    organisation_id, raison_sociale, siret,
    adresse_facturation, code_postal, ville, created_at, updated_at
  ) VALUES (
    v_org_id, 'FixtureEntite-G4', '00000000000001',
    '1 rue Fixture', '75001', 'Paris', now(), now()
  ) RETURNING id INTO v_entite_id;

  -- Type événement minimal (type_evenement_id NOT NULL, code UNIQUE)
  INSERT INTO plateforme.types_evenements (code, libelle, created_at, updated_at)
  VALUES ('FIXTURE_G4', 'Fixture G4', now(), now())
  ON CONFLICT (code) DO UPDATE SET libelle = EXCLUDED.libelle
  RETURNING id INTO v_type_evt_id;

  -- Lieu minimal
  INSERT INTO plateforme.lieux (nom, adresse_acces, code_postal, ville, type_vehicule_max, created_at, updated_at)
  VALUES ('FixtureLieu-G4', '1 rue Test', '75001', 'Paris', 'fourgon', now(), now())
  RETURNING id INTO v_lieu_id;

  -- Événement avec toutes les colonnes NOT NULL
  INSERT INTO plateforme.evenements (
    organisation_id,
    traiteur_operationnel_organisation_id,
    entite_facturation_id,
    lieu_id,
    created_by,
    type_evenement_id,
    nom_evenement,
    pax,
    contact_principal_nom,
    contact_principal_telephone,
    created_at, updated_at
  ) VALUES (
    v_org_id, v_org_id, v_entite_id, v_lieu_id, v_user_id, v_type_evt_id,
    'FixtureEvenement-G4', 100,
    'Contact Fixture', '0600000000',
    now(), now()
  ) RETURNING id INTO v_evt_id;

  -- Création collecte via RPC (émet E1 atomiquement)
  v_collecte_id := plateforme.fn_creer_collecte(
    p_evenement_id   := v_evt_id,
    p_type           := p_type,
    p_date_collecte  := CURRENT_DATE + 30,
    p_heure_collecte := '09:00'::time
  );

  -- Simulation : tms_reference posée manuellement pour E2/E3
  UPDATE plateforme.collectes SET tms_reference = 'FIXTURE-REF-001' WHERE id = v_collecte_id;

  -- Dispatch (émet E2) — setup complet pour le test E2
  PERFORM plateforme.fn_dispatcher_collecte(p_id := v_collecte_id);

  RETURN v_collecte_id;
END;
$$;

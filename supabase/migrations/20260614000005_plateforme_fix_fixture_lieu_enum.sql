-- =============================================================================
-- Fix helper pgTAP tests.outbox_fixture_lieu (CI pgtap-rls-outbox run 3)
-- =============================================================================
-- La version initiale (20260614000001) utilisait 'camion_20m3' comme valeur de
-- type_vehicule_max — valeur périmée depuis la refonte enum App 2026-05-08.
-- L'enum plateforme.type_vehicule_enum ne contient que :
--   'velo_cargo', 'camionnette', 'fourgon', 'vul', 'poids_lourd'
-- On remplace par 'poids_lourd' (catégorie la plus permissive, cohérente avec
-- un lieu de collecte standard camion de collecte).
-- =============================================================================

CREATE OR REPLACE FUNCTION tests.outbox_fixture_lieu()
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_lieu_id uuid;
BEGIN
  INSERT INTO plateforme.lieux (nom, adresse_acces, code_postal, ville, type_vehicule_max, created_at, updated_at)
  VALUES ('FixtureLieu-E5', '1 avenue Fixture', '69001', 'Lyon', 'poids_lourd', now(), now())
  RETURNING id INTO v_lieu_id;
  RETURN v_lieu_id;
END;
$$;

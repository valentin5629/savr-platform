-- =============================================================================
-- R14 · BL-P1-AUTH-04 — tournee_siblings_not_exposed
-- =============================================================================
-- Cloisonnement `tournees` (§09 policy `t_select`) : un client ne voit une
-- tournée QUE si une ligne `collecte_tournees` la relie à une collecte qui lui
-- est visible (`f_collecte_visible`). On vérifie qu'une tournée « sœur » (liée à
-- la collecte d'une AUTRE organisation) n'est PAS exposée au traiteur_manager
-- de l'org A. Sous rôle `authenticated` + claim `user_role` (jamais `role`).
-- =============================================================================

BEGIN;
SELECT plan(3);

-- ─── Helpers JWT (pattern canonique repo) ────────────────────────────────────
CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid()
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ─── Fixtures ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
    ('a4000000-0000-0000-0000-000000000001'::uuid, 'Org A', 'Org A SARL', 'traiteur', '41111111100001', true),
    ('a4000000-0000-0000-0000-000000000002'::uuid, 'Org B', 'Org B SARL', 'traiteur', '42222222200002', true);

  INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
    ('a4100000-0000-0000-0000-000000000001'::uuid, 'a4000000-0000-0000-0000-000000000001'::uuid, 'Org A SARL', '41111111100001', '1 Rue A', '75001', 'Paris'),
    ('a4100000-0000-0000-0000-000000000002'::uuid, 'a4000000-0000-0000-0000-000000000002'::uuid, 'Org B SARL', '42222222200002', '2 Rue B', '75002', 'Paris');

  -- Manager de l'org A (l'observateur).
  INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
    ('b4000000-0000-0000-0000-000000000001'::uuid, 'a4000000-0000-0000-0000-000000000001'::uuid,
     'mgr-a@r14-tour.local', 'Mgr', 'A', 'traiteur_manager');

  -- Lieu partagé — NON rattaché à l'org A via organisations_lieux (pas de fuite lieu).
  INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region) VALUES
    ('c4000000-0000-0000-0000-000000000001'::uuid, 'Salle R14', '9 rue Test', '75009', 'Paris', 'camionnette', 48.87, 2.34, 'idf');

  INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif) VALUES
    ('c4100000-0000-0000-0000-000000000001'::uuid, 'GALA_R14', 'Gala R14', 1, true);

  -- Événements : A appartient à org A, B à org B.
  INSERT INTO plateforme.evenements (
    id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
    created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
    contact_principal_nom, contact_principal_telephone
  ) VALUES
    ('d4000000-0000-0000-0000-000000000001'::uuid, 'a4000000-0000-0000-0000-000000000001'::uuid,
     'a4000000-0000-0000-0000-000000000001'::uuid, 'a4100000-0000-0000-0000-000000000001'::uuid,
     'b4000000-0000-0000-0000-000000000001'::uuid, 'c4000000-0000-0000-0000-000000000001'::uuid,
     'c4100000-0000-0000-0000-000000000001'::uuid, 'Evt A', '2026-06-10', 100, 'Contact A', '0600000041'),
    ('d4000000-0000-0000-0000-000000000002'::uuid, 'a4000000-0000-0000-0000-000000000002'::uuid,
     'a4000000-0000-0000-0000-000000000002'::uuid, 'a4100000-0000-0000-0000-000000000002'::uuid,
     'b4000000-0000-0000-0000-000000000001'::uuid, 'c4000000-0000-0000-0000-000000000001'::uuid,
     'c4100000-0000-0000-0000-000000000001'::uuid, 'Evt B', '2026-06-11', 80, 'Contact B', '0600000042');

  INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte) VALUES
    ('e4000000-0000-0000-0000-000000000001'::uuid, 'd4000000-0000-0000-0000-000000000001'::uuid, 'zero_dechet', 'validee', 'non_envoye', '2026-06-10', '08:00'),
    ('e4000000-0000-0000-0000-000000000002'::uuid, 'd4000000-0000-0000-0000-000000000002'::uuid, 'zero_dechet', 'validee', 'non_envoye', '2026-06-11', '08:00');

  INSERT INTO shared.prestataires (id, nom, code) VALUES
    ('90400000-0000-0000-0000-000000000001'::uuid, 'Presta R14', 'presta-r14') ON CONFLICT (id) DO NOTHING;

  -- Tournée A (collecte org A) et tournée B « sœur » (collecte org B).
  INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, statut) VALUES
    ('f4000000-0000-0000-0000-000000000001'::uuid, 'T-R14-A', '2026-06-10', 'matin', '90400000-0000-0000-0000-000000000001'::uuid, 'planifiee'),
    ('f4000000-0000-0000-0000-000000000002'::uuid, 'T-R14-B', '2026-06-11', 'matin', '90400000-0000-0000-0000-000000000001'::uuid, 'planifiee');

  INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang) VALUES
    ('e4000000-0000-0000-0000-000000000001'::uuid, 'f4000000-0000-0000-0000-000000000001'::uuid, 1),
    ('e4000000-0000-0000-0000-000000000002'::uuid, 'f4000000-0000-0000-0000-000000000002'::uuid, 1);
END $$;

-- ─── Observateur = traiteur_manager de l'org A ───────────────────────────────
SELECT test_set_jwt(
  'traiteur_manager',
  'a4000000-0000-0000-0000-000000000001'::uuid,
  'b4000000-0000-0000-0000-000000000001'::uuid
);

-- tournee_siblings_not_exposed : la tournée de l'org B N'EST PAS exposée.
SELECT is(
  (SELECT count(*)::int FROM plateforme.tournees
   WHERE id = 'f4000000-0000-0000-0000-000000000002'::uuid),
  0,
  'tournee_siblings_not_exposed : tournée de l''org B invisible au manager org A'
);

-- Contrôle positif : la tournée de sa propre org A EST visible.
SELECT is(
  (SELECT count(*)::int FROM plateforme.tournees
   WHERE id = 'f4000000-0000-0000-0000-000000000001'::uuid),
  1,
  'tournee_siblings_not_exposed : tournée de l''org A visible au manager org A'
);

-- Total : le manager org A ne voit QUE sa tournée (pas de sur-exposition).
SELECT is(
  (SELECT count(*)::int FROM plateforme.tournees),
  1,
  'tournee_siblings_not_exposed : manager org A voit exactement 1 tournée (la sienne)'
);

SELECT test_as_superuser();
SELECT * FROM finish();
ROLLBACK;

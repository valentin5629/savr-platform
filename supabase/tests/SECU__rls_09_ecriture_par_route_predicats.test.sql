-- =============================================================================
-- §09 RLS transverse — prédicats d'écriture `evenements` portés par les routes
-- (révision 2026-09-16 des scénarios §09, en-tête « ⚠ NORMATIF »).
-- =============================================================================
-- Depuis 20260915160000 / 20260915190000, l'écriture directe d'un rôle client sur
-- `collectes` et `evenements` lève 42501 AVANT la RLS (couvert par
-- SECU__rls_09_ecriture_directe_revoke.test.sql). Les scénarios « 0 ligne
-- affectée / réussit » se jouent donc par la route. Ce fichier en est la moitié
-- DB : chaque valeur dont la route dépend est lue ICI sur de vrais statuts, sous
-- le JWT du rôle (lecture RLS, f_collecte_editable) ou sous service_role (lookups
-- et écriture de la route). La moitié route (codes HTTP, aucune écriture par la
-- session) : packages/plateforme/tests/api/programmation/edition-evenement.m1-2.test.ts,
-- un test nommé du nom de chaque scénario.
--
-- Scénarios (specs/tests/app/09-rls-app-transverse-scenarios.md) :
--   C1 traiteur_operationnel_ne_peut_pas_modifier_programmation_tierce
--   C2 manager_update_hors_fenetre_denied
--   C3 agence_update_hors_fenetre_denied
--   C4 admin_update_hors_fenetre_reste_possible
--   C5 commercial_update_sa_collecte_dans_fenetre
--   C6 gestionnaire_insert_evenement_lieu_hors_perimetre_refuse
--   C7 gestionnaire_insert_evenement_traiteur_shadow_refuse
--   C8 commercial_update_collecte_d_un_collegue_refuse
--   C9 impersonation_journalisee
--
-- Discriminant : pour chaque refus, le cas pose aussi la valeur des AUTRES gardes
-- de la route (visibilité, fenêtre) à « passant », pour que le refus ne puisse
-- s'expliquer que par le prédicat du scénario.
-- =============================================================================

BEGIN;
SELECT plan(41);

CREATE EXTENSION IF NOT EXISTS pgtap;

CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid, p_user_id uuid, p_impersonator uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', (jsonb_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  ) || CASE WHEN p_impersonator IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('impersonator_id', p_impersonator) END)::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ── Fixtures (UUID/SIRET improbables) ────────────────────────────────────────
-- Organisations : Kaspia (traiteur A), Kardamome (traiteur B), agence D,
-- gestionnaire Viparis, traiteur shadow créé par D, org interne Savr.
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal) VALUES
  ('09f80000-0000-0000-0000-00000000000a'::uuid, 'Kaspia R09P', 'traiteur', true, false, '09F80000000001', 'r09p-a@test.internal'),
  ('09f80000-0000-0000-0000-00000000000b'::uuid, 'Kardamome R09P', 'traiteur', true, false, '09F80000000002', 'r09p-b@test.internal'),
  ('09f80000-0000-0000-0000-00000000000d'::uuid, 'Agence D R09P', 'agence', true, false, '09F80000000004', 'r09p-d@test.internal'),
  ('09f80000-0000-0000-0000-00000000000c'::uuid, 'Viparis R09P', 'gestionnaire_lieux', true, false, '09F80000000003', 'r09p-c@test.internal'),
  ('09f80000-0000-0000-0000-000000000005'::uuid, 'Savr R09P', 'traiteur', true, false, '09F80000000005', 'r09p-s@test.internal');
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, cree_par_organisation_id) VALUES
  ('09f80000-0000-0000-0000-0000000000e5'::uuid, 'Shadow R09P', 'traiteur', true, true, '09f80000-0000-0000-0000-00000000000d'::uuid);

INSERT INTO plateforme.types_evenements (id, code, libelle) VALUES
  ('09f80000-0000-0000-0000-00000000007e'::uuid, 'cocktail_r09p', 'Cocktail R09P');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('09f80000-0000-0000-0000-0000000000a1'::uuid, '09f80000-0000-0000-0000-00000000000a'::uuid, 'manager_kaspia@r09p.test', 'M', 'K', 'traiteur_manager'),
  ('09f80000-0000-0000-0000-0000000000a2'::uuid, '09f80000-0000-0000-0000-00000000000a'::uuid, 'commercial1_kaspia@r09p.test', 'C1', 'K', 'traiteur_commercial'),
  ('09f80000-0000-0000-0000-0000000000a3'::uuid, '09f80000-0000-0000-0000-00000000000a'::uuid, 'commercial2_kaspia@r09p.test', 'C2', 'K', 'traiteur_commercial'),
  ('09f80000-0000-0000-0000-0000000000b1'::uuid, '09f80000-0000-0000-0000-00000000000b'::uuid, 'manager_kardamome@r09p.test', 'M', 'KD', 'traiteur_manager'),
  ('09f80000-0000-0000-0000-0000000000d1'::uuid, '09f80000-0000-0000-0000-00000000000d'::uuid, 'agence_d@r09p.test', 'A', 'D', 'agence'),
  ('09f80000-0000-0000-0000-0000000000c1'::uuid, '09f80000-0000-0000-0000-00000000000c'::uuid, 'gest_viparis@r09p.test', 'G', 'V', 'gestionnaire_lieux'),
  ('09f80000-0000-0000-0000-0000000000f1'::uuid, '09f80000-0000-0000-0000-000000000005'::uuid, 'val@r09p.test', 'V', 'S', 'admin_savr');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('09f80000-0000-0000-0000-0000000000fa'::uuid, '09f80000-0000-0000-0000-00000000000a'::uuid, 'Kaspia R09P SAS', '09F80000000001', '1 rue', '75001', 'Paris'),
  ('09f80000-0000-0000-0000-0000000000fb'::uuid, '09f80000-0000-0000-0000-00000000000b'::uuid, 'Kardamome R09P SAS', '09F80000000002', '1 rue', '75001', 'Paris'),
  ('09f80000-0000-0000-0000-0000000000fd'::uuid, '09f80000-0000-0000-0000-00000000000d'::uuid, 'Agence D R09P SAS', '09F80000000004', '1 rue', '75001', 'Paris');

-- L1 lié à Viparis, L4 lié à personne.
INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('09f80000-0000-0000-0000-0000000001e1'::uuid, 'Salle L1 R09P', '1 rue', '75001', 'Paris', 'fourgon'),
  ('09f80000-0000-0000-0000-0000000001e4'::uuid, 'Salle L4 R09P', '4 rue', '75004', 'Paris', 'fourgon');
INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id) VALUES
  ('09f80000-0000-0000-0000-00000000000c'::uuid, '09f80000-0000-0000-0000-0000000001e1'::uuid);

-- Événements :
--   eT  org D, traiteur opérationnel Kaspia, collecte programmee (C1)
--   eF  Kaspia, collectes realisee + cloturee (C2)
--   eA  org D, toutes collectes cloturee (C3, C4)
--   eC1 Kaspia créé par commercial1, collecte validee (C5)
--   eC2 Kaspia créé par commercial2, collecte programmee (C8)
--   eK  Kaspia, collecte programmee (C9) ; eB Kardamome (C9, invisible)
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES
  ('09f80000-0000-0000-0000-00000000e071'::uuid, '09f80000-0000-0000-0000-00000000000d'::uuid, '09f80000-0000-0000-0000-0000000001e1'::uuid, '09f80000-0000-0000-0000-00000000000a'::uuid, '09f80000-0000-0000-0000-0000000000fd'::uuid, '09f80000-0000-0000-0000-0000000000d1'::uuid, '09f80000-0000-0000-0000-00000000007e'::uuid, current_date + 10, 100, 'Alice', '0601'),
  ('09f80000-0000-0000-0000-00000000e0f1'::uuid, '09f80000-0000-0000-0000-00000000000a'::uuid, '09f80000-0000-0000-0000-0000000001e1'::uuid, '09f80000-0000-0000-0000-00000000000a'::uuid, '09f80000-0000-0000-0000-0000000000fa'::uuid, '09f80000-0000-0000-0000-0000000000a1'::uuid, '09f80000-0000-0000-0000-00000000007e'::uuid, current_date - 10, 100, 'Bob', '0602'),
  ('09f80000-0000-0000-0000-00000000e0a1'::uuid, '09f80000-0000-0000-0000-00000000000d'::uuid, '09f80000-0000-0000-0000-0000000001e1'::uuid, '09f80000-0000-0000-0000-00000000000a'::uuid, '09f80000-0000-0000-0000-0000000000fd'::uuid, '09f80000-0000-0000-0000-0000000000d1'::uuid, '09f80000-0000-0000-0000-00000000007e'::uuid, current_date - 10, 100, 'Carl', '0603'),
  ('09f80000-0000-0000-0000-00000000e0c1'::uuid, '09f80000-0000-0000-0000-00000000000a'::uuid, '09f80000-0000-0000-0000-0000000001e1'::uuid, '09f80000-0000-0000-0000-00000000000a'::uuid, '09f80000-0000-0000-0000-0000000000fa'::uuid, '09f80000-0000-0000-0000-0000000000a2'::uuid, '09f80000-0000-0000-0000-00000000007e'::uuid, current_date + 10, 100, 'Dora', '0604'),
  ('09f80000-0000-0000-0000-00000000e0c2'::uuid, '09f80000-0000-0000-0000-00000000000a'::uuid, '09f80000-0000-0000-0000-0000000001e1'::uuid, '09f80000-0000-0000-0000-00000000000a'::uuid, '09f80000-0000-0000-0000-0000000000fa'::uuid, '09f80000-0000-0000-0000-0000000000a3'::uuid, '09f80000-0000-0000-0000-00000000007e'::uuid, current_date + 10, 100, 'Emma', '0605'),
  ('09f80000-0000-0000-0000-00000000e0e1'::uuid, '09f80000-0000-0000-0000-00000000000a'::uuid, '09f80000-0000-0000-0000-0000000001e1'::uuid, '09f80000-0000-0000-0000-00000000000a'::uuid, '09f80000-0000-0000-0000-0000000000fa'::uuid, '09f80000-0000-0000-0000-0000000000a1'::uuid, '09f80000-0000-0000-0000-00000000007e'::uuid, current_date + 10, 100, 'Fred', '0606'),
  ('09f80000-0000-0000-0000-00000000e0b1'::uuid, '09f80000-0000-0000-0000-00000000000b'::uuid, '09f80000-0000-0000-0000-0000000001e1'::uuid, '09f80000-0000-0000-0000-00000000000b'::uuid, '09f80000-0000-0000-0000-0000000000fb'::uuid, '09f80000-0000-0000-0000-0000000000b1'::uuid, '09f80000-0000-0000-0000-00000000007e'::uuid, current_date + 10, 100, 'Gina', '0607');

-- Statuts terminaux posés sans rejouer la machine à états (triggers CO₂/packs
-- hors sujet ici) : seul le statut lu par f_collecte_editable compte.
SET LOCAL session_replication_role = replica;
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte) VALUES
  ('09f80000-0000-0000-0000-00000000c071'::uuid, '09f80000-0000-0000-0000-00000000e071'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00'),
  ('09f80000-0000-0000-0000-00000000c0f1'::uuid, '09f80000-0000-0000-0000-00000000e0f1'::uuid, 'zero_dechet', 'realisee',   'non_envoye', current_date - 10, '08:00'),
  ('09f80000-0000-0000-0000-00000000c0f2'::uuid, '09f80000-0000-0000-0000-00000000e0f1'::uuid, 'zero_dechet', 'cloturee',   'non_envoye', current_date - 10, '09:00'),
  ('09f80000-0000-0000-0000-00000000c0a1'::uuid, '09f80000-0000-0000-0000-00000000e0a1'::uuid, 'zero_dechet', 'cloturee',   'non_envoye', current_date - 10, '08:00'),
  ('09f80000-0000-0000-0000-00000000c0a2'::uuid, '09f80000-0000-0000-0000-00000000e0a1'::uuid, 'zero_dechet', 'cloturee',   'non_envoye', current_date - 10, '09:00'),
  ('09f80000-0000-0000-0000-00000000c0c1'::uuid, '09f80000-0000-0000-0000-00000000e0c1'::uuid, 'zero_dechet', 'validee',    'non_envoye', current_date + 10, '08:00'),
  ('09f80000-0000-0000-0000-00000000c0c2'::uuid, '09f80000-0000-0000-0000-00000000e0c2'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00'),
  ('09f80000-0000-0000-0000-00000000c0e1'::uuid, '09f80000-0000-0000-0000-00000000e0e1'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00'),
  ('09f80000-0000-0000-0000-00000000c0b1'::uuid, '09f80000-0000-0000-0000-00000000e0b1'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00');
SET LOCAL session_replication_role = origin;

-- =============================================================================
-- C0. Aucun contournement de la route : l'écriture d'une route passe par
--     fn_modifier_evenement, que la session cliente ne peut pas appeler.
-- =============================================================================
SELECT test_set_jwt('traiteur_manager', '09f80000-0000-0000-0000-00000000000a'::uuid, '09f80000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$ SELECT plateforme.fn_modifier_evenement('09f80000-0000-0000-0000-00000000e0f1'::uuid, '{"pax": 1}'::jsonb, ARRAY['pax']) $$,
  '42501', 'permission denied for function fn_modifier_evenement',
  'C0 manager_kaspia — fn_modifier_evenement non executable par la session (la fenetre ne se contourne pas par la RPC)');

-- =============================================================================
-- C1. traiteur_operationnel_ne_peut_pas_modifier_programmation_tierce
-- =============================================================================
-- La route lit l'événement sous le JWT (visible → pas 404), puis compare
-- organisation_id au JWT (→ 403). La fenêtre est ouverte : elle n'explique rien.
SELECT is((SELECT count(*)::int FROM plateforme.evenements WHERE id = '09f80000-0000-0000-0000-00000000e071'::uuid), 1,
  'C1 manager_kaspia voit l''evenement programme par l''agence D (traiteur operationnel) — la route ne repond pas 404');
SELECT is((SELECT organisation_id FROM plateforme.evenements WHERE id = '09f80000-0000-0000-0000-00000000e071'::uuid),
  '09f80000-0000-0000-0000-00000000000d'::uuid,
  'C1b l''organisation_id lue par la route est celle de l''agence, pas celle du JWT — la route repond 403');
SELECT is(plateforme.f_collecte_editable('09f80000-0000-0000-0000-00000000e071'::uuid), true,
  'C1c collecte programmee : fenetre ouverte — le refus ne vient que du perimetre organisation');

-- =============================================================================
-- C2. manager_update_hors_fenetre_denied
-- =============================================================================
SELECT is((SELECT organisation_id FROM plateforme.evenements WHERE id = '09f80000-0000-0000-0000-00000000e0f1'::uuid),
  '09f80000-0000-0000-0000-00000000000a'::uuid,
  'C2 manager_kaspia lit son evenement (perimetre organisation satisfait)');
SELECT is(plateforme.f_collecte_editable('09f80000-0000-0000-0000-00000000e0f1'::uuid), false,
  'C2b collectes realisee + cloturee : f_collecte_editable = false sous le JWT du manager — la route repond 422');

-- =============================================================================
-- C3. agence_update_hors_fenetre_denied
-- =============================================================================
SELECT test_set_jwt('agence', '09f80000-0000-0000-0000-00000000000d'::uuid, '09f80000-0000-0000-0000-0000000000d1'::uuid);
SELECT is((SELECT organisation_id FROM plateforme.evenements WHERE id = '09f80000-0000-0000-0000-00000000e0a1'::uuid),
  '09f80000-0000-0000-0000-00000000000d'::uuid,
  'C3 agence_d lit son evenement (perimetre organisation satisfait)');
SELECT is(plateforme.f_collecte_editable('09f80000-0000-0000-0000-00000000e0a1'::uuid), false,
  'C3b collectes toutes cloturee : f_collecte_editable = false sous le JWT de l''agence — la route repond 422');
SELECT throws_ok(
  $$ UPDATE plateforme.evenements SET pax = 1 WHERE id = '09f80000-0000-0000-0000-00000000e0a1'::uuid $$,
  '42501', 'permission denied for table evenements',
  'C3c agence_d — l''UPDATE direct ne contourne pas la route (42501 avant RLS)');

-- Contre-épreuve de la fenêtre : le même prédicat s'ouvre sur un statut éditable.
SELECT test_as_superuser();
SET LOCAL session_replication_role = replica;
UPDATE plateforme.collectes SET statut = 'programmee' WHERE id = '09f80000-0000-0000-0000-00000000c0a2'::uuid;
SET LOCAL session_replication_role = origin;
SELECT test_set_jwt('agence', '09f80000-0000-0000-0000-00000000000d'::uuid, '09f80000-0000-0000-0000-0000000000d1'::uuid);
SELECT is(plateforme.f_collecte_editable('09f80000-0000-0000-0000-00000000e0a1'::uuid), true,
  'C3d contre-epreuve — une collecte programmee suffit a rouvrir la fenetre (le false de C3b est porte par les statuts)');
SELECT test_as_superuser();
SET LOCAL session_replication_role = replica;
UPDATE plateforme.collectes SET statut = 'cloturee' WHERE id = '09f80000-0000-0000-0000-00000000c0a2'::uuid;
SET LOCAL session_replication_role = origin;

-- =============================================================================
-- C4. admin_update_hors_fenetre_reste_possible
-- =============================================================================
-- Route back-office PATCH /api/v1/admin/evenements/[id] : requireStaff, aucune
-- garde de fenêtre, écriture par fn_modifier_evenement sous service_role.
SELECT test_set_jwt('admin_savr', '09f80000-0000-0000-0000-000000000005'::uuid, '09f80000-0000-0000-0000-0000000000f1'::uuid);
SELECT is(plateforme.f_collecte_editable('09f80000-0000-0000-0000-00000000e0a1'::uuid), false,
  'C4 le meme evenement 100 % cloture reste hors fenetre (la reussite suivante est bien un forcage staff)');

SELECT test_as_superuser();
SET LOCAL role service_role;
SELECT lives_ok(
  $$ SELECT plateforme.fn_modifier_evenement('09f80000-0000-0000-0000-00000000e0a1'::uuid, '{"pax": 180}'::jsonb, ARRAY['pax']) $$,
  'C4b route admin (service_role) — fn_modifier_evenement reussit hors fenetre');
RESET role;
SELECT is((SELECT pax FROM plateforme.evenements WHERE id = '09f80000-0000-0000-0000-00000000e0a1'::uuid), 180,
  'C4c la mise a jour hors fenetre est effective');

-- =============================================================================
-- C5. commercial_update_sa_collecte_dans_fenetre
-- =============================================================================
SELECT test_set_jwt('traiteur_commercial', '09f80000-0000-0000-0000-00000000000a'::uuid, '09f80000-0000-0000-0000-0000000000a2'::uuid);
SELECT is((SELECT created_by = auth.uid() FROM plateforme.evenements WHERE id = '09f80000-0000-0000-0000-00000000e0c1'::uuid), true,
  'C5 commercial1_kaspia lit son evenement et en est le createur (created_by = self)');
SELECT is(plateforme.f_collecte_editable('09f80000-0000-0000-0000-00000000e0c1'::uuid), true,
  'C5b collecte validee : f_collecte_editable = true sous le JWT du commercial');

SELECT test_as_superuser();
SET LOCAL role service_role;
SELECT lives_ok(
  $$ SELECT plateforme.fn_modifier_evenement('09f80000-0000-0000-0000-00000000e0c1'::uuid, '{"pax": 140}'::jsonb, ARRAY['pax']) $$,
  'C5c route (service_role) — fn_modifier_evenement reussit dans la fenetre');
RESET role;
SELECT is((SELECT pax FROM plateforme.evenements WHERE id = '09f80000-0000-0000-0000-00000000e0c1'::uuid), 140,
  'C5d la mise a jour est effective');

-- =============================================================================
-- C8. commercial_update_collecte_d_un_collegue_refuse
-- =============================================================================
SELECT test_set_jwt('traiteur_commercial', '09f80000-0000-0000-0000-00000000000a'::uuid, '09f80000-0000-0000-0000-0000000000a2'::uuid);
SELECT is((SELECT count(*)::int FROM plateforme.evenements WHERE id = '09f80000-0000-0000-0000-00000000e0c2'::uuid), 1,
  'C8 commercial1_kaspia voit l''evenement de commercial2 (lecture org-wide) — la route ne repond pas 404');
SELECT is((SELECT created_by FROM plateforme.evenements WHERE id = '09f80000-0000-0000-0000-00000000e0c2'::uuid),
  '09f80000-0000-0000-0000-0000000000a3'::uuid,
  'C8b created_by lu par la route = commercial2, pas le sub du JWT — la route repond 403');
SELECT is(plateforme.f_collecte_editable('09f80000-0000-0000-0000-00000000e0c2'::uuid), true,
  'C8c collecte programmee : fenetre ouverte — le refus ne vient que du createur');
SELECT is((SELECT organisation_id FROM plateforme.evenements WHERE id = '09f80000-0000-0000-0000-00000000e0c2'::uuid),
  '09f80000-0000-0000-0000-00000000000a'::uuid,
  'C8d meme organisation que le JWT — un prédicat organisation seul laisserait passer');

-- =============================================================================
-- C6. gestionnaire_insert_evenement_lieu_hors_perimetre_refuse
-- =============================================================================
-- La route POST tourne sous service_role et interroge organisations_lieux
-- (organisation du JWT × lieu du body) ; aucune ligne → 403 avant tout INSERT.
SELECT test_as_superuser();
SET LOCAL role service_role;
SELECT is(
  (SELECT count(*)::int FROM plateforme.organisations_lieux
    WHERE organisation_id = '09f80000-0000-0000-0000-00000000000c'::uuid
      AND lieu_id = '09f80000-0000-0000-0000-0000000001e4'::uuid),
  0, 'C6 lookup de la route — L4 non lie a Viparis : 0 ligne, la route repond 403');
SELECT is(
  (SELECT count(*)::int FROM plateforme.organisations_lieux
    WHERE organisation_id = '09f80000-0000-0000-0000-00000000000c'::uuid
      AND lieu_id = '09f80000-0000-0000-0000-0000000001e1'::uuid),
  1, 'C6b contre-epreuve — L1 lie a Viparis : 1 ligne, la route poursuit');
RESET role;

-- Le lookup de la route et la policy (inerte) evt_gestionnaire_insert lisent le
-- même lien : sous le JWT du gestionnaire, L4 n'apparaît pas dans son parc.
SELECT test_set_jwt('gestionnaire_lieux', '09f80000-0000-0000-0000-00000000000c'::uuid, '09f80000-0000-0000-0000-0000000000c1'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.organisations_lieux WHERE lieu_id = '09f80000-0000-0000-0000-0000000001e4'::uuid),
  0, 'C6c gest_viparis — L4 absent de son parc sous RLS (meme verdict que le lookup service_role)');
SELECT throws_ok(
  $$ INSERT INTO plateforme.evenements (organisation_id, lieu_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by, type_evenement_id, date_evenement, pax, contact_principal_nom, contact_principal_telephone)
       VALUES ('09f80000-0000-0000-0000-00000000000c'::uuid, '09f80000-0000-0000-0000-0000000001e4'::uuid, '09f80000-0000-0000-0000-00000000000a'::uuid, '09f80000-0000-0000-0000-0000000000fa'::uuid, '09f80000-0000-0000-0000-0000000000c1'::uuid, '09f80000-0000-0000-0000-00000000007e'::uuid, current_date + 12, 40, 'Zoe', '0609') $$,
  '42501', 'permission denied for table evenements',
  'C6d gest_viparis — l''INSERT direct ne contourne pas la route (42501 avant RLS)');

-- =============================================================================
-- C7. gestionnaire_insert_evenement_traiteur_shadow_refuse
-- =============================================================================
-- Route POST, rôle gestionnaire_lieux : le traiteur opérant doit exister, être
-- actif, de type traiteur et non shadow (§06.01 l.294, miroir du WITH CHECK
-- evt_gestionnaire_insert). Lookup sous service_role.
SELECT test_as_superuser();
SET LOCAL role service_role;
SELECT is(
  (SELECT count(*)::int FROM plateforme.organisations
    WHERE id = '09f80000-0000-0000-0000-0000000000e5'::uuid
      AND actif = true AND type = 'traiteur' AND est_shadow = false),
  0, 'C7 lookup de la route — traiteur shadow : 0 ligne, la route repond 403');
SELECT is(
  (SELECT type::text || '/' || est_shadow::text FROM plateforme.organisations WHERE id = '09f80000-0000-0000-0000-0000000000e5'::uuid),
  'traiteur/true', 'C7b la fixture est un traiteur actif : seul est_shadow l''exclut');
SELECT is(
  (SELECT count(*)::int FROM plateforme.organisations
    WHERE id = '09f80000-0000-0000-0000-00000000000a'::uuid
      AND actif = true AND type = 'traiteur' AND est_shadow = false),
  1, 'C7c contre-epreuve — traiteur reference (Kaspia) : 1 ligne, la route poursuit');
SELECT is(
  (SELECT count(*)::int FROM plateforme.organisations
    WHERE id = '09f80000-0000-0000-0000-00000000000c'::uuid
      AND actif = true AND type = 'traiteur' AND est_shadow = false),
  0, 'C7d l''organisation du gestionnaire elle-meme n''est pas un traiteur operant (ancien defaut de la route)');
RESET role;

-- La policy (inerte) exprime le même prédicat : sa sous-requête exclut la shadow.
SELECT test_as_superuser();
SELECT ok(
  (SELECT with_check FROM pg_policies WHERE schemaname = 'plateforme' AND tablename = 'evenements' AND policyname = 'evt_gestionnaire_insert')
    ~ 'est_shadow = false',
  'C7e evt_gestionnaire_insert exige est_shadow = false — la route porte le meme predicat');

SELECT test_set_jwt('gestionnaire_lieux', '09f80000-0000-0000-0000-00000000000c'::uuid, '09f80000-0000-0000-0000-0000000000c1'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.evenements (organisation_id, lieu_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by, type_evenement_id, date_evenement, pax, contact_principal_nom, contact_principal_telephone)
       VALUES ('09f80000-0000-0000-0000-00000000000c'::uuid, '09f80000-0000-0000-0000-0000000001e1'::uuid, '09f80000-0000-0000-0000-0000000000e5'::uuid, '09f80000-0000-0000-0000-0000000000fa'::uuid, '09f80000-0000-0000-0000-0000000000c1'::uuid, '09f80000-0000-0000-0000-00000000007e'::uuid, current_date + 12, 40, 'Zoe', '0609') $$,
  '42501', 'permission denied for table evenements',
  'C7f gest_viparis — l''INSERT direct avec traiteur shadow ne contourne pas la route (42501 avant RLS)');

-- =============================================================================
-- C9. impersonation_journalisee
-- =============================================================================
-- Session impersonée : claims du manager + impersonator_id = val.
SELECT test_set_jwt('traiteur_manager', '09f80000-0000-0000-0000-00000000000a'::uuid, '09f80000-0000-0000-0000-0000000000a1'::uuid,
  '09f80000-0000-0000-0000-0000000000f1'::uuid);
SELECT is(auth.jwt() ->> 'impersonator_id', '09f80000-0000-0000-0000-0000000000f1',
  'C9 le claim impersonator_id est porte par la session impersonee');
SELECT is((SELECT count(*)::int FROM plateforme.evenements WHERE id = '09f80000-0000-0000-0000-00000000e0b1'::uuid), 0,
  'C9b RLS de traiteur_manager appliquee — l''evenement Kardamome reste invisible (route : 404)');
SELECT is((SELECT count(*)::int FROM plateforme.evenements WHERE id = '09f80000-0000-0000-0000-00000000e0e1'::uuid), 1,
  'C9c l''evenement Kaspia est visible');
SELECT is(plateforme.f_collecte_editable('09f80000-0000-0000-0000-00000000e0e1'::uuid), true,
  'C9d evenement Kaspia dans la fenetre — la modification passe');
SELECT is((SELECT count(*)::int FROM plateforme.evenements WHERE organisation_id = '09f80000-0000-0000-0000-00000000000b'::uuid), 0,
  'C9e aucun evenement Kardamome visible sous la session impersonee (pas de privilege admin herite)');
SELECT is((SELECT count(*)::int FROM plateforme.audit_log WHERE record_id = '09f80000-0000-0000-0000-00000000e0e1'::uuid), 0,
  'C9f audit_log reste illisible pour la session impersonee (lecture staff seule)');

-- L'écriture de la route sous service_role : modification + ligne d'audit
-- portant user_id = identité assumée ET impersonator_id = admin réel.
SELECT test_as_superuser();
SET LOCAL role service_role;
SELECT lives_ok(
  $$ SELECT plateforme.fn_modifier_evenement('09f80000-0000-0000-0000-00000000e0e1'::uuid, '{"pax": 160}'::jsonb, ARRAY['pax']) $$,
  'C9g route (service_role) — la modification reussit');
SELECT lives_ok(
  $$ INSERT INTO plateforme.audit_log (table_name, record_id, action, user_id, impersonator_id, old_values, new_values)
       VALUES ('evenements', '09f80000-0000-0000-0000-00000000e0e1'::uuid, 'UPDATE',
               '09f80000-0000-0000-0000-0000000000a1'::uuid, '09f80000-0000-0000-0000-0000000000f1'::uuid,
               '{}'::jsonb, '{"updates": {"pax": 160}}'::jsonb) $$,
  'C9h schema — audit_log accepte user_id + impersonator_id sous service_role (la valeur ecrite par la route est prouvee par le test de route, pas ici)');
RESET role;
SELECT test_set_jwt('admin_savr', '09f80000-0000-0000-0000-000000000005'::uuid, '09f80000-0000-0000-0000-0000000000f1'::uuid);
SELECT is(
  (SELECT user_id::text || '|' || impersonator_id::text FROM plateforme.audit_log
    WHERE table_name = 'evenements' AND record_id = '09f80000-0000-0000-0000-00000000e0e1'::uuid),
  '09f80000-0000-0000-0000-0000000000a1|09f80000-0000-0000-0000-0000000000f1',
  'C9i schema — val (admin) relit les deux colonnes distinctes (lecture staff de audit_log)');

-- impersonator_id est une vraie référence utilisateur : un identifiant forgé
-- ne peut pas être journalisé.
SELECT test_as_superuser();
SET LOCAL role service_role;
SELECT throws_ok(
  $$ INSERT INTO plateforme.audit_log (table_name, record_id, action, user_id, impersonator_id)
       VALUES ('evenements', '09f80000-0000-0000-0000-00000000e0e1'::uuid, 'UPDATE',
               '09f80000-0000-0000-0000-0000000000a1'::uuid, '09f80000-0000-0000-0000-0000000000ff'::uuid) $$,
  '23503', NULL,
  'C9j impersonator_id inexistant -> 23503 (FK users)');
RESET role;

SELECT * FROM finish();
ROLLBACK;

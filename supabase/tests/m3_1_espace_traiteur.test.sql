-- pgTAP M3.1 — Espace client traiteur
-- Tests : restriction colonne tarif_refacture_pax_zd (lecture traiteur / écriture
--         Admin only), benchmark grain single_collecte fail-fast RLS,
--         DELETE collectes restreint à 'brouillon'.

BEGIN;
SELECT plan(11);

-- ── Helpers JWT (identiques aux autres tests RLS) ───────────────────────────
CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
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

-- ── Fixtures (superuser) ────────────────────────────────────────────────────
SELECT test_as_superuser();

-- Org A (Kaspia) + Org B (Kardamome)
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd)
VALUES
  ('bb000000-0000-0000-0000-00000000000a'::uuid, 'Kaspia', 'Kaspia SARL', 'traiteur', '11111111100009', true, 1.50),
  ('bb000000-0000-0000-0000-00000000000b'::uuid, 'Kardamome', 'Kardamome SARL', 'traiteur', '22222222200009', true, 1.50);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES
  ('bb000000-0000-0000-0000-000000000a01'::uuid, 'bb000000-0000-0000-0000-00000000000a'::uuid, 'mgr-a@kaspia.test', 'Mgr', 'A', 'traiteur_manager'),
  ('bb000000-0000-0000-0000-000000000a02'::uuid, 'bb000000-0000-0000-0000-00000000000a'::uuid, 'com-a@kaspia.test', 'Com', 'A', 'traiteur_commercial'),
  ('bb000000-0000-0000-0000-000000000b01'::uuid, 'bb000000-0000-0000-0000-00000000000b'::uuid, 'mgr-b@kardamome.test', 'Mgr', 'B', 'traiteur_manager');

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('bb000000-0000-0000-0000-0000000000f1'::uuid,
        'bb000000-0000-0000-0000-00000000000a'::uuid,
        'Kaspia SARL', '11111111100009', '1 rue Kaspia', '75001', 'Paris');

INSERT INTO plateforme.lieux
  (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region)
VALUES ('bb000000-0000-0000-0000-0000000000f2'::uuid,
        'Pavillon Royal', '1 rue Royale', '75008', 'Paris', 'camionnette', 48.86, 2.35, 'idf');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('bb000000-0000-0000-0000-0000000000f3'::uuid, 'GALA_M31', 'Gala M3.1', 1, true);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, lieu_id, type_evenement_id,
  nom_evenement, date_evenement, pax, contact_principal_nom, contact_principal_telephone
) VALUES (
  'bb000000-0000-0000-0000-0000000000e1'::uuid,
  'bb000000-0000-0000-0000-00000000000a'::uuid,
  'bb000000-0000-0000-0000-00000000000a'::uuid,
  'bb000000-0000-0000-0000-0000000000f1'::uuid,
  'bb000000-0000-0000-0000-000000000a02'::uuid,
  'bb000000-0000-0000-0000-0000000000f2'::uuid,
  'bb000000-0000-0000-0000-0000000000f3'::uuid,
  'Gala M3.1', '2026-06-15', 800, 'Contact', '0600000001'
);

-- Collecte ZD cloturee (Org A) — cible benchmark single_collecte
INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
VALUES ('bb000000-0000-0000-0000-0000000000c1'::uuid,
        'bb000000-0000-0000-0000-0000000000e1'::uuid,
        'zero_dechet', 'cloturee', 'non_envoye', '2026-06-15', '20:00');

-- Collecte brouillon + programmee (Org A) — cibles DELETE brouillon-only
INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
VALUES
  ('bb000000-0000-0000-0000-0000000000c2'::uuid, 'bb000000-0000-0000-0000-0000000000e1'::uuid,
   'zero_dechet', 'brouillon', 'non_envoye', '2026-07-01', '20:00'),
  ('bb000000-0000-0000-0000-0000000000c3'::uuid, 'bb000000-0000-0000-0000-0000000000e1'::uuid,
   'zero_dechet', 'programmee', 'non_envoye', '2026-07-02', '20:00');

-- ════════════════════════════════════════════════════════════════════════════
-- 1. tarif_refacture_pax_zd : lecture traiteur / écriture Admin only
-- ════════════════════════════════════════════════════════════════════════════

-- T1 : manager lit tarif_refacture (nécessaire au KPI Marge)
SELECT test_set_jwt('traiteur_manager', 'bb000000-0000-0000-0000-00000000000a'::uuid,
                    'bb000000-0000-0000-0000-000000000a01'::uuid);
SELECT lives_ok(
  $$ SELECT tarif_refacture_pax_zd FROM plateforme.organisations
     WHERE id = 'bb000000-0000-0000-0000-00000000000a'::uuid $$,
  'T1 : manager lit tarif_refacture_pax_zd de son orga'
);

-- T2 : commercial lit tarif_refacture
SELECT test_set_jwt('traiteur_commercial', 'bb000000-0000-0000-0000-00000000000a'::uuid,
                    'bb000000-0000-0000-0000-000000000a02'::uuid);
SELECT lives_ok(
  $$ SELECT tarif_refacture_pax_zd FROM plateforme.organisations
     WHERE id = 'bb000000-0000-0000-0000-00000000000a'::uuid $$,
  'T2 : commercial lit tarif_refacture_pax_zd'
);

-- T3 : manager UPDATE tarif_refacture → permission denied colonne (42501)
SELECT test_set_jwt('traiteur_manager', 'bb000000-0000-0000-0000-00000000000a'::uuid,
                    'bb000000-0000-0000-0000-000000000a01'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET tarif_refacture_pax_zd = 9.99
     WHERE id = 'bb000000-0000-0000-0000-00000000000a'::uuid $$,
  '42501', NULL,
  'T3 : manager ne peut PAS écrire tarif_refacture_pax_zd (privilège colonne)'
);

-- T4 : commercial UPDATE tarif_refacture → refusé
SELECT test_set_jwt('traiteur_commercial', 'bb000000-0000-0000-0000-00000000000a'::uuid,
                    'bb000000-0000-0000-0000-000000000a02'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET tarif_refacture_pax_zd = 9.99
     WHERE id = 'bb000000-0000-0000-0000-00000000000a'::uuid $$,
  '42501', NULL,
  'T4 : commercial ne peut PAS écrire tarif_refacture_pax_zd'
);

-- T5 : manager UPDATE colonne autorisée (nom) → OK
SELECT test_set_jwt('traiteur_manager', 'bb000000-0000-0000-0000-00000000000a'::uuid,
                    'bb000000-0000-0000-0000-000000000a01'::uuid);
SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET nom = 'Kaspia Traiteur'
     WHERE id = 'bb000000-0000-0000-0000-00000000000a'::uuid $$,
  'T5 : manager peut écrire les colonnes de la liste blanche (nom)'
);

-- T6 : Admin (service_role = superuser) écrit tarif_refacture → OK
SELECT test_as_superuser();
SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET tarif_refacture_pax_zd = 2.00
     WHERE id = 'bb000000-0000-0000-0000-00000000000a'::uuid $$,
  'T6 : Admin (service_role) peut écrire tarif_refacture_pax_zd'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. f_benchmark_single_collecte : fail-fast RLS (collecte non accessible)
-- ════════════════════════════════════════════════════════════════════════════

-- T7 : manager Org B appelle sur une collecte d'Org A → exception fail-fast
SELECT test_set_jwt('traiteur_manager', 'bb000000-0000-0000-0000-00000000000b'::uuid,
                    'bb000000-0000-0000-0000-000000000b01'::uuid);
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_single_collecte('bb000000-0000-0000-0000-0000000000c1'::uuid) $$,
  'P0001', 'Collecte not accessible',
  'T7 : benchmark single_collecte cross-org → fail fast'
);

-- T8 : manager Org A appelle sur sa propre collecte → OK (table, éventuellement vide)
SELECT test_set_jwt('traiteur_manager', 'bb000000-0000-0000-0000-00000000000a'::uuid,
                    'bb000000-0000-0000-0000-000000000a01'::uuid);
SELECT lives_ok(
  $$ SELECT * FROM plateforme.f_benchmark_single_collecte('bb000000-0000-0000-0000-0000000000c1'::uuid) $$,
  'T8 : benchmark single_collecte sur sa propre collecte → autorisé'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. DELETE collectes restreint à statut 'brouillon' (F5)
-- ════════════════════════════════════════════════════════════════════════════

-- T9 : manager DELETE collecte brouillon → 1 ligne supprimée
-- (CTE data-modifying obligatoirement au TOP level — leçon M2.4)
SELECT test_set_jwt('traiteur_manager', 'bb000000-0000-0000-0000-00000000000a'::uuid,
                    'bb000000-0000-0000-0000-000000000a01'::uuid);
WITH d AS (
  DELETE FROM plateforme.collectes
  WHERE id = 'bb000000-0000-0000-0000-0000000000c2'::uuid RETURNING 1
)
SELECT is(count(*)::int, 1, 'T9 : DELETE collecte brouillon autorisé') FROM d;

-- T10 : manager DELETE collecte programmee → 0 ligne (RLS bloque, pas d'erreur)
WITH d AS (
  DELETE FROM plateforme.collectes
  WHERE id = 'bb000000-0000-0000-0000-0000000000c3'::uuid RETURNING 1
)
SELECT is(count(*)::int, 0, 'T10 : DELETE collecte programmee refusé (brouillon-only)') FROM d;

-- T11 : commercial UPDATE organisations (nom) → 0 ligne (aucune policy UPDATE
-- commercial ; org_commercial_select = SELECT only) — §09 écriture org = Manager only
SELECT test_set_jwt('traiteur_commercial', 'bb000000-0000-0000-0000-00000000000a'::uuid,
                    'bb000000-0000-0000-0000-000000000a02'::uuid);
WITH u AS (
  UPDATE plateforme.organisations SET nom = 'Hack'
  WHERE id = 'bb000000-0000-0000-0000-00000000000a'::uuid RETURNING 1
)
SELECT is(count(*)::int, 0, 'T11 : commercial ne peut PAS écrire organisations (RLS)') FROM u;

SELECT test_as_superuser();
SELECT * FROM finish();
ROLLBACK;

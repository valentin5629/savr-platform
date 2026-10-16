-- =============================================================================
-- Tests pgTAP — transporteurs : fiche prestataire créée par la base à
-- l'insertion d'un transporteur `mts1` / `a_toutes` arrivé sans lien
-- Migration prouvée : 20261016160000_plateforme_transporteurs_prestataire_auto
-- =============================================================================
-- Oracle : décision Val 2026-10-16 (choix C1, divergence
-- M1.1b_20261016_transporteur-prestataire-auto) — « la fiche prestataire est
-- créée automatiquement à la création du transporteur et le champ disparaît du
-- formulaire » :
--   - chemin de l'écran (route serveur, service_role) : la fiche est créée et
--     liée dans la même instruction, au nom du transporteur, flux copiés de
--     `types_collecte`, code unique ;
--   - un lien fourni est respecté, un type manuel n'a pas de fiche ;
--   - aucun accès ouvert : sous `authenticated` admin_savr, l'insertion sans
--     lien est refusée par la RLS de `shared.prestataires` et ne laisse rien.
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(22);

CREATE OR REPLACE FUNCTION test_jwt_presta_auto(p_role text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'user_role', p_role, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Insère un transporteur de test ; `p_presta` NULL = sans lien.
CREATE OR REPLACE FUNCTION test_insert_transporteur(
  p_id uuid, p_nom text, p_type text, p_flux text[], p_presta uuid
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO plateforme.transporteurs
    (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
     code_transporteur_mts1, contact_nom, contact_email, contact_telephone,
     types_collecte, prestataire_logistique_id)
  VALUES (p_id, p_nom, '920000001', '1 rue T', '75001', 'Paris',
          ARRAY['fourgon'], p_type::plateforme.type_tms,
          CASE WHEN p_type = 'mts1' THEN 'AUTO-TEST' END,
          'T', 'auto@example.invalid', '+33600000001', p_flux, p_presta);
$$;

-- Fixtures : un code déjà pris (collision) et une fiche existante (lien fourni).
INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, statut)
VALUES
  ('2b000000-0000-0000-0000-0000000000a1', 'Ancienne fiche', 'SOCIETEAUTOTEST', ARRAY['zd'], 'mts1', 'actif'),
  ('2b000000-0000-0000-0000-0000000000a2', 'Fiche fournie', 'TEST-AUTO-FOURNIE', ARRAY['ag'], 'mts1', 'actif');

-- ── 1-3. Forme ───────────────────────────────────────────────────────────────
SELECT has_trigger('plateforme', 'transporteurs', 'trg_transporteur_prestataire_auto',
  'trigger trg_transporteur_prestataire_auto présent');
SELECT ok(
  NOT has_function_privilege('authenticated', 'plateforme.fn_trg_transporteur_prestataire_auto()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'plateforme.fn_trg_transporteur_prestataire_auto()', 'EXECUTE'),
  'fonction du trigger : EXECUTE fermé à authenticated et anon'
);
SELECT is(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'plateforme.fn_trg_transporteur_prestataire_auto()'::regprocedure),
  false,
  'fonction du trigger en SECURITY INVOKER : elle n''écrit qu''avec les droits de l''appelant'
);

-- ── 4-9. Chemin de l'écran (service_role) : mts1 sans lien ──────────────────
SELECT set_config('role', 'service_role', true);
SELECT lives_ok(
  $$SELECT test_insert_transporteur('2b000000-0000-0000-0000-000000000001',
      'Société Auto-Test', 'mts1', ARRAY['zero_dechet', 'anti_gaspi'], NULL)$$,
  'service_role : transporteur mts1 sans lien créé');
SELECT test_as_superuser();
SELECT isnt(
  (SELECT prestataire_logistique_id FROM plateforme.transporteurs
    WHERE id = '2b000000-0000-0000-0000-000000000001'),
  NULL,
  'mts1 : le lien est posé sur la ligne insérée');
SELECT is(
  (SELECT p.nom FROM plateforme.transporteurs t
     JOIN shared.prestataires p ON p.id = t.prestataire_logistique_id
    WHERE t.id = '2b000000-0000-0000-0000-000000000001'),
  'Société Auto-Test',
  'mts1 : la fiche porte le nom du transporteur');
SELECT is(
  (SELECT p.code FROM plateforme.transporteurs t
     JOIN shared.prestataires p ON p.id = t.prestataire_logistique_id
    WHERE t.id = '2b000000-0000-0000-0000-000000000001'),
  'SOCIETEAUTOTEST-2',
  'code : majuscules sans accents ni ponctuation, suffixé s''il est déjà pris');
SELECT is(
  (SELECT p.type_prestation FROM plateforme.transporteurs t
     JOIN shared.prestataires p ON p.id = t.prestataire_logistique_id
    WHERE t.id = '2b000000-0000-0000-0000-000000000001'),
  ARRAY['zd', 'ag'],
  'flux copiés de types_collecte (zero_dechet → zd, anti_gaspi → ag)');
SELECT is(
  (SELECT (p.mode_integration, p.statut)::text FROM plateforme.transporteurs t
     JOIN shared.prestataires p ON p.id = t.prestataire_logistique_id
    WHERE t.id = '2b000000-0000-0000-0000-000000000001'),
  ('mts1', 'actif')::text,
  'mts1 : fiche active, même mode d''intégration que les fiches existantes');

-- ── 10-11. a_toutes sans lien, sans flux déclarés ───────────────────────────
SELECT set_config('role', 'service_role', true);
SELECT test_insert_transporteur('2b000000-0000-0000-0000-000000000002',
  'Vélo Auto-Test', 'a_toutes', NULL, NULL);
SELECT test_as_superuser();
SELECT is(
  (SELECT (p.nom, p.code, p.mode_integration)::text FROM plateforme.transporteurs t
     JOIN shared.prestataires p ON p.id = t.prestataire_logistique_id
    WHERE t.id = '2b000000-0000-0000-0000-000000000002'),
  ('Vélo Auto-Test', 'VELOAUTOTEST', 'everest')::text,
  'a_toutes : fiche créée et liée, mode everest');
SELECT is(
  (SELECT p.type_prestation FROM plateforme.transporteurs t
     JOIN shared.prestataires p ON p.id = t.prestataire_logistique_id
    WHERE t.id = '2b000000-0000-0000-0000-000000000002'),
  '{}'::text[],
  'types_collecte vide : aucun flux copié');

-- ── 12-15. Lien fourni respecté, type manuel sans fiche ─────────────────────
SELECT test_insert_transporteur('2b000000-0000-0000-0000-000000000003',
  'Fourni Auto-Test', 'mts1', ARRAY['anti_gaspi'], '2b000000-0000-0000-0000-0000000000a2');
SELECT is(
  (SELECT prestataire_logistique_id FROM plateforme.transporteurs
    WHERE id = '2b000000-0000-0000-0000-000000000003'),
  '2b000000-0000-0000-0000-0000000000a2'::uuid,
  'lien fourni (seeds, fixtures) : conservé tel quel');
SELECT is(
  (SELECT count(*)::int FROM shared.prestataires WHERE nom = 'Fourni Auto-Test'),
  0,
  'lien fourni : aucune fiche créée');
SELECT test_insert_transporteur('2b000000-0000-0000-0000-000000000004',
  'Mail Auto-Test', 'par_mail', ARRAY['anti_gaspi'], NULL);
SELECT is(
  (SELECT prestataire_logistique_id FROM plateforme.transporteurs
    WHERE id = '2b000000-0000-0000-0000-000000000004'),
  NULL,
  'type manuel (par_mail) : toujours sans prestataire');
SELECT is(
  (SELECT count(*)::int FROM shared.prestataires WHERE nom = 'Mail Auto-Test'),
  0,
  'type manuel : aucune fiche créée');

-- ── 16-18. Code : second suffixe, repli ; autres types manuels ─────────────
SELECT test_insert_transporteur('2b000000-0000-0000-0000-000000000007',
  'Societe Auto Test', 'mts1', NULL, NULL);
SELECT is(
  (SELECT p.code FROM plateforme.transporteurs t
     JOIN shared.prestataires p ON p.id = t.prestataire_logistique_id
    WHERE t.id = '2b000000-0000-0000-0000-000000000007'),
  'SOCIETEAUTOTEST-3',
  'code : second conflit → suffixe -3');
SELECT test_insert_transporteur('2b000000-0000-0000-0000-000000000008',
  '!!!', 'a_toutes', NULL, NULL);
SELECT matches(
  (SELECT p.code FROM plateforme.transporteurs t
     JOIN shared.prestataires p ON p.id = t.prestataire_logistique_id
    WHERE t.id = '2b000000-0000-0000-0000-000000000008'),
  '^PRESTATAIRE(-[0-9]+)?$',
  'code : nom sans lettre ni chiffre → repli PRESTATAIRE');
SELECT test_insert_transporteur('2b000000-0000-0000-0000-000000000009',
  'Autre Auto-Test', 'autre', NULL, NULL);
SELECT test_insert_transporteur('2b000000-0000-0000-0000-00000000000a',
  'Tel Auto-Test', 'par_telephone', NULL, NULL);
SELECT is(
  (SELECT count(*)::int FROM plateforme.transporteurs
    WHERE id IN ('2b000000-0000-0000-0000-000000000009', '2b000000-0000-0000-0000-00000000000a')
      AND prestataire_logistique_id IS NULL),
  2,
  'types manuels autre et par_telephone : toujours sans prestataire');

-- ── 19-22. Aucun accès ouvert : authenticated admin_savr (PostgREST) ────────
SELECT test_jwt_presta_auto('admin_savr');
SELECT throws_ok(
  $$SELECT test_insert_transporteur('2b000000-0000-0000-0000-000000000005',
      'Admin Auto-Test', 'mts1', ARRAY['anti_gaspi'], NULL)$$,
  '42501', NULL,
  'admin_savr par PostgREST : mts1 sans lien refusé (RLS de shared.prestataires)');
SELECT lives_ok(
  $$SELECT test_insert_transporteur('2b000000-0000-0000-0000-000000000006',
      'Admin Mail Auto-Test', 'par_mail', NULL, NULL)$$,
  'admin_savr par PostgREST : un type manuel reste créable');
SELECT test_as_superuser();
SELECT is(
  (SELECT count(*)::int FROM plateforme.transporteurs
    WHERE id = '2b000000-0000-0000-0000-000000000005'),
  0,
  'refus admin_savr : aucun transporteur écrit');
SELECT is(
  (SELECT count(*)::int FROM shared.prestataires WHERE nom = 'Admin Auto-Test'),
  0,
  'refus admin_savr : aucune fiche écrite');

SELECT * FROM finish();
ROLLBACK;

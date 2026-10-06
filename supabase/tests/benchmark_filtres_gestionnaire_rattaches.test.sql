-- =============================================================================
-- Benchmark : filtres Lieux / Traiteurs du gestionnaire bornés à son périmètre
-- Migration : 20261006220000_plateforme_benchmark_filtres_gestionnaire_rattaches.sql
-- =============================================================================
-- Décision Val 2026-10-06 (§06.05 Bloc 3 ZD, divergence
-- M3.2_20261006_benchmark-filtres-lieux-traiteurs-rattaches) : sans sélection, le
-- repère reste calculé sur tout le parc Savr ; s'il nomme un lieu ou un traiteur, le
-- gestionnaire ne nomme que ses lieux rattachés et les traiteurs intervenus sur ses
-- lieux.
--
-- Migration FERMANTE (CLAUDE.md §12 2bis) : ce fichier prouve la fermeture ET
-- qu'elle ne déborde pas.
--   1      non-vacuité de la fixture (10 collectes pesées, 5 par lieu) ;
--   2-3    les deux listes « parc » sont refusées au gestionnaire ;
--   4-6    elles restent servies aux autres rôles, à l'identique (lieux : rôle
--          traiteur ; traiteurs : staff seul, rôle traiteur toujours refusé) ;
--   7-8    gestionnaire A : tout le parc sans rien nommer, puis son propre lieu ;
--   9-10   gestionnaire A : lieu d'un tiers refusé, seul ou mêlé à l'un des siens ;
--   11-13  gestionnaire A : traiteurs intervenus acceptés, traiteur jamais intervenu
--          refusé, seul ou mêlé ;
--   14-17  bords : tableaux vides acceptés, élément NULL refusé (lieux, puis
--          traiteurs), jeton sans organisation refusé ;
--   18-20  gestionnaire B : la garde suit l'organisation du jeton (miroir de A) ;
--   21-24  la garde ne touche ni le rôle traiteur, ni le staff, ni un appel en
--          service_role (rafraîchissement de la vue matérialisée, PDF), ni la
--          fiche collecte du gestionnaire (f_benchmark_single_collecte, qui
--          appelle le calcul sous SON jeton, sans lieu ni traiteur) ;
--   25-27  durcissement conservé par les trois CREATE OR REPLACE : SECURITY
--          DEFINER + search_path, bénéficiaires d'EXECUTE, contrat de sortie.
--
-- Mesuré sur une base rejouée SANS la migration : 11 cas rouges (2, 3, 9, 10, 12,
-- 13, 15, 16, 17, 19, 20) — chacun rendait une liste ou un segment au lieu de
-- refuser. Les 16 autres sont verts avant comme après : ils bornent ce qui ne doit
-- pas bouger.
--
-- Fixture : deux gestionnaires (A, lieu LA ; B, lieu LB), quatre traiteurs.
--   LA : T1, T2, T3, T1, T2     → T1, T2, T3 intervenus chez A ;
--   LB : T2, T3, T4, T4, T3     → T4 n'est jamais intervenu chez A, T1 jamais chez B.
-- Chaque lieu porte 5 collectes et 3 acteurs : son segment franchit le k-anonymat,
-- si bien qu'un refus ne peut pas se confondre avec un segment masqué.
-- JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(27);

CREATE OR REPLACE FUNCTION _bfr_jwt(p_role text, p_org uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(), 'role', 'authenticated', 'user_role', p_role,
    'organisation_id', p_org, 'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION _bfr_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Segment biodéchet du type de la fixture : nombre de collectes, NULL si masqué
-- ou absent. Le filtre sur le type isole la fixture du reste de la base.
CREATE OR REPLACE FUNCTION _bfr_nb(p_lieux uuid[] DEFAULT NULL, p_traiteurs uuid[] DEFAULT NULL)
RETURNS integer LANGUAGE sql AS $$
  SELECT nb_collectes_segment
    FROM plateforme.f_benchmark_kg_pax_zd(
           p_type_evenement_ids => ARRAY['ba9c0000-0000-0000-0000-0000000000d1'::uuid],
           p_lieu_ids           => p_lieux,
           p_traiteur_ids       => p_traiteurs)
   WHERE flux_code = 'biodechet'
$$;

-- Fixture ---------------------------------------------------------------------
SELECT _bfr_superuser();

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
  ('ba9c0000-0000-0000-0000-0000000000a1', 'BFR Gestionnaire A', 'BFR Gest A SAS', 'gestionnaire_lieux', '97000000000011', true),
  ('ba9c0000-0000-0000-0000-0000000000a2', 'BFR Gestionnaire B', 'BFR Gest B SAS', 'gestionnaire_lieux', '97000000000022', true),
  ('ba9c0000-0000-0000-0000-0000000000b1', 'BFR Traiteur 1', 'BFR T1 SARL', 'traiteur', '97000000000101', true),
  ('ba9c0000-0000-0000-0000-0000000000b2', 'BFR Traiteur 2', 'BFR T2 SARL', 'traiteur', '97000000000202', true),
  ('ba9c0000-0000-0000-0000-0000000000b3', 'BFR Traiteur 3', 'BFR T3 SARL', 'traiteur', '97000000000303', true),
  ('ba9c0000-0000-0000-0000-0000000000b4', 'BFR Traiteur 4', 'BFR T4 SARL', 'traiteur', '97000000000404', true);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
SELECT ('ba9c0000-0000-0000-0000-0000000001b' || n)::uuid,
       ('ba9c0000-0000-0000-0000-0000000000b' || n)::uuid,
       'chef' || n || '@bfr.test', 'Chef', 'BFR' || n, 'traiteur_manager', true
  FROM generate_series(1, 4) AS n;

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
SELECT ('ba9c0000-0000-0000-0000-0000000002b' || n)::uuid,
       ('ba9c0000-0000-0000-0000-0000000000b' || n)::uuid,
       'BFR T' || n || ' SARL', '9700000000' || n || '0' || n || '0', n || ' rue BFR', '75001', 'Paris'
  FROM generate_series(1, 4) AS n;

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('ba9c0000-0000-0000-0000-0000000000d1', 'BFR_TYPE', 'BFR Type', 1, true);

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('ba9c0000-0000-0000-0000-0000000000c1', 'BFR Lieu A', '1 av BFR', '75002', 'Paris', 'camionnette'),
  ('ba9c0000-0000-0000-0000-0000000000c2', 'BFR Lieu B', '2 av BFR', '75003', 'Paris', 'camionnette');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id) VALUES
  ('ba9c0000-0000-0000-0000-0000000000a1', 'ba9c0000-0000-0000-0000-0000000000c1'),
  ('ba9c0000-0000-0000-0000-0000000000a2', 'ba9c0000-0000-0000-0000-0000000000c2');

-- 10 événements datés, taille M (600 pax), dans les 24 derniers mois.
CREATE TEMP TABLE _bfr_plan (n int, traiteur int, lieu int) ON COMMIT DROP;
INSERT INTO _bfr_plan VALUES
  (0, 1, 1), (1, 2, 1), (2, 3, 1), (3, 1, 1), (4, 2, 1),
  (5, 2, 2), (6, 3, 2), (7, 4, 2), (8, 4, 2), (9, 3, 2);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone)
SELECT ('ba9c0000-0000-0000-0000-0000000003e' || p.n)::uuid,
       ('ba9c0000-0000-0000-0000-0000000000b' || p.traiteur)::uuid,
       ('ba9c0000-0000-0000-0000-0000000000b' || p.traiteur)::uuid,
       ('ba9c0000-0000-0000-0000-0000000002b' || p.traiteur)::uuid,
       ('ba9c0000-0000-0000-0000-0000000001b' || p.traiteur)::uuid,
       ('ba9c0000-0000-0000-0000-0000000000c' || p.lieu)::uuid,
       'ba9c0000-0000-0000-0000-0000000000d1', 'BFR Evt ' || p.n,
       current_date - (30 + p.n), 600, 'C', '060000000' || p.n
  FROM _bfr_plan p;

INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, dirty_tms, annulee_cote_savr)
SELECT ('ba9c0000-0000-0000-0000-0000000004c' || p.n)::uuid,
       ('ba9c0000-0000-0000-0000-0000000003e' || p.n)::uuid,
       'zero_dechet', 'cloturee', 'non_envoye', current_date - (30 + p.n), '20:00', false, false
  FROM _bfr_plan p;

INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT ('ba9c0000-0000-0000-0000-0000000004c' || p.n)::uuid,
       (SELECT id FROM plateforme.flux_dechets WHERE code = 'biodechet'), 600::decimal
  FROM _bfr_plan p;

-- 1. Non-vacuité ---------------------------------------------------------------
SELECT is(
  (SELECT array_agg(nb ORDER BY lieu)
     FROM (SELECT e.lieu_id::text AS lieu, count(*)::int AS nb
             FROM plateforme.collecte_flux cf
             JOIN plateforme.collectes c  ON c.id = cf.collecte_id
             JOIN plateforme.evenements e ON e.id = c.evenement_id
            WHERE c.id::text LIKE 'ba9c0000-%' AND c.statut = 'cloturee'
            GROUP BY e.lieu_id) t),
  ARRAY[5, 5],
  '1. non-vacuité : 5 collectes pesées et clôturées sur chacun des deux lieux');

-- 2-3. Les listes « parc » sont refusées au gestionnaire ----------------------
SELECT _bfr_jwt('gestionnaire_lieux', 'ba9c0000-0000-0000-0000-0000000000a1');
SELECT throws_ok(
  $$SELECT count(*) FROM plateforme.f_benchmark_lieux_parc()$$,
  'P0001', 'Role non autorise pour la liste benchmark',
  '2. gestionnaire : la liste des lieux du parc lui est refusée');
SELECT throws_ok(
  $$SELECT count(*) FROM plateforme.f_benchmark_traiteurs_parc()$$,
  'P0001', 'Role non autorise pour la liste traiteurs benchmark',
  '3. gestionnaire : la liste des traiteurs du parc lui est refusée');

-- 4-6. Les autres rôles ne bougent pas ----------------------------------------
SELECT _bfr_jwt('traiteur_manager', 'ba9c0000-0000-0000-0000-0000000000b1');
SELECT is(
  (SELECT count(*)::int FROM plateforme.f_benchmark_lieux_parc()
    WHERE id IN ('ba9c0000-0000-0000-0000-0000000000c1', 'ba9c0000-0000-0000-0000-0000000000c2')),
  2,
  '4. rôle traiteur : obtient toujours les lieux du parc (LA et LB nommés)');
SELECT throws_ok(
  $$SELECT count(*) FROM plateforme.f_benchmark_traiteurs_parc()$$,
  'P0001', 'Role non autorise pour la liste traiteurs benchmark',
  '5. rôle traiteur : la liste des traiteurs reste refusée (préservation compétitive)');
SELECT _bfr_jwt('ops_savr');
SELECT is(
  (SELECT count(*)::int FROM plateforme.f_benchmark_traiteurs_parc()
    WHERE id::text LIKE 'ba9c0000-0000-0000-0000-0000000000b%'),
  4,
  '6. staff : obtient toujours la liste des traiteurs du parc (T1 à T4 nommés)');

-- 7-8. Gestionnaire A : tout le parc, puis son lieu ----------------------------
SELECT _bfr_jwt('gestionnaire_lieux', 'ba9c0000-0000-0000-0000-0000000000a1');
SELECT is(
  _bfr_nb(), 10,
  '7. gestionnaire A sans lieu ni traiteur nommé : repère sur tout le parc (10 collectes, dont 5 hors de ses lieux)');
SELECT is(
  _bfr_nb(ARRAY['ba9c0000-0000-0000-0000-0000000000c1'::uuid]), 5,
  '8. gestionnaire A : son lieu rattaché LA est accepté (5 collectes)');

-- 9-10. Gestionnaire A : lieu d'un tiers --------------------------------------
SELECT throws_ok(
  $$SELECT _bfr_nb(ARRAY['ba9c0000-0000-0000-0000-0000000000c2'::uuid])$$,
  '42501', 'Filtre lieu_ids hors des lieux rattaches au gestionnaire',
  '9. gestionnaire A : le lieu LB d''un tiers est refusé');
SELECT throws_ok(
  $$SELECT _bfr_nb(ARRAY['ba9c0000-0000-0000-0000-0000000000c1'::uuid,
                         'ba9c0000-0000-0000-0000-0000000000c2'::uuid])$$,
  '42501', 'Filtre lieu_ids hors des lieux rattaches au gestionnaire',
  '10. gestionnaire A : un lieu tiers mêlé à l''un des siens est refusé');

-- 11-13. Gestionnaire A : traiteurs -------------------------------------------
SELECT is(
  _bfr_nb(NULL, ARRAY['ba9c0000-0000-0000-0000-0000000000b1'::uuid,
                      'ba9c0000-0000-0000-0000-0000000000b2'::uuid,
                      'ba9c0000-0000-0000-0000-0000000000b3'::uuid]), 8,
  '11. gestionnaire A : T1, T2, T3 intervenus sur ses lieux sont acceptés (8 collectes sur tout le parc)');
SELECT throws_ok(
  $$SELECT _bfr_nb(NULL, ARRAY['ba9c0000-0000-0000-0000-0000000000b4'::uuid])$$,
  '42501', 'Filtre traiteur_ids hors des traiteurs intervenus sur les lieux du gestionnaire',
  '12. gestionnaire A : T4, jamais intervenu sur ses lieux, est refusé');
SELECT throws_ok(
  $$SELECT _bfr_nb(NULL, ARRAY['ba9c0000-0000-0000-0000-0000000000b1'::uuid,
                               'ba9c0000-0000-0000-0000-0000000000b4'::uuid])$$,
  '42501', 'Filtre traiteur_ids hors des traiteurs intervenus sur les lieux du gestionnaire',
  '13. gestionnaire A : T4 mêlé à un traiteur intervenu est refusé');

-- 14-16. Bords ----------------------------------------------------------------
SELECT lives_ok(
  $$SELECT _bfr_nb('{}'::uuid[], '{}'::uuid[])$$,
  '14. gestionnaire A : deux tableaux vides ne nomment rien, la garde ne lève pas');
SELECT throws_ok(
  $$SELECT _bfr_nb(ARRAY[NULL]::uuid[])$$,
  '42501', 'Filtre lieu_ids hors des lieux rattaches au gestionnaire',
  '15. gestionnaire A : un élément NULL dans lieu_ids est refusé (fail-closed)');
SELECT throws_ok(
  $$SELECT _bfr_nb(NULL, ARRAY[NULL]::uuid[])$$,
  '42501', 'Filtre traiteur_ids hors des traiteurs intervenus sur les lieux du gestionnaire',
  '16. gestionnaire A : un élément NULL dans traiteur_ids est refusé (fail-closed)');
SELECT _bfr_jwt('gestionnaire_lieux', NULL);
SELECT throws_ok(
  $$SELECT _bfr_nb(ARRAY['ba9c0000-0000-0000-0000-0000000000c1'::uuid])$$,
  '42501', 'Filtre lieu_ids hors des lieux rattaches au gestionnaire',
  '17. gestionnaire sans organisation dans le jeton : tout lieu nommé est refusé');

-- 18-20. Gestionnaire B : miroir ----------------------------------------------
SELECT _bfr_jwt('gestionnaire_lieux', 'ba9c0000-0000-0000-0000-0000000000a2');
SELECT is(
  _bfr_nb(ARRAY['ba9c0000-0000-0000-0000-0000000000c2'::uuid]), 5,
  '18. gestionnaire B : LB, refusé à A, lui est accepté (la garde suit le jeton)');
SELECT throws_ok(
  $$SELECT _bfr_nb(ARRAY['ba9c0000-0000-0000-0000-0000000000c1'::uuid])$$,
  '42501', 'Filtre lieu_ids hors des lieux rattaches au gestionnaire',
  '19. gestionnaire B : LA, accepté à A, lui est refusé');
SELECT throws_ok(
  $$SELECT _bfr_nb(NULL, ARRAY['ba9c0000-0000-0000-0000-0000000000b1'::uuid])$$,
  '42501', 'Filtre traiteur_ids hors des traiteurs intervenus sur les lieux du gestionnaire',
  '20. gestionnaire B : T1, accepté à A, lui est refusé (jamais intervenu sur LB)');

-- 21-24. La garde ne déborde pas ----------------------------------------------
SELECT _bfr_jwt('traiteur_manager', 'ba9c0000-0000-0000-0000-0000000000b1');
SELECT is(
  _bfr_nb(ARRAY['ba9c0000-0000-0000-0000-0000000000c2'::uuid]), 5,
  '21. rôle traiteur : filtre toujours sur un lieu du parc où il n''est jamais intervenu');
SELECT _bfr_jwt('ops_savr');
SELECT is(
  _bfr_nb(ARRAY['ba9c0000-0000-0000-0000-0000000000c2'::uuid],
          ARRAY['ba9c0000-0000-0000-0000-0000000000b2'::uuid,
                'ba9c0000-0000-0000-0000-0000000000b3'::uuid,
                'ba9c0000-0000-0000-0000-0000000000b4'::uuid]), 5,
  '22. staff : nomme librement lieu et traiteurs');
-- Chemin réel du rafraîchissement de la vue matérialisée et du PDF : jeton de
-- service, sans rôle applicatif.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('role', 'service_role', true);
SELECT is(
  _bfr_nb(ARRAY['ba9c0000-0000-0000-0000-0000000000c2'::uuid]), 5,
  '23. appel en service_role (vue matérialisée, PDF) : non concerné par la garde');
-- Fiche collecte : f_benchmark_single_collecte appelle le calcul sous le jeton
-- du gestionnaire, sans lieu ni traiteur. Collecte programmée par A sur son lieu
-- (la fonction n'accepte que l'organisation programmatrice ou opérationnelle).
SELECT _bfr_superuser();
UPDATE plateforme.evenements
   SET organisation_id = 'ba9c0000-0000-0000-0000-0000000000a1'
 WHERE id = 'ba9c0000-0000-0000-0000-0000000003e0';
SELECT _bfr_jwt('gestionnaire_lieux', 'ba9c0000-0000-0000-0000-0000000000a1');
SELECT is(
  (SELECT nb_collectes_segment
     FROM plateforme.f_benchmark_single_collecte('ba9c0000-0000-0000-0000-0000000004c0')
    WHERE flux_code = 'biodechet'),
  10,
  '24. fiche collecte du gestionnaire : repère parc toujours servi (10 collectes), la garde ne lève pas');

-- 25-27. Durcissement conservé ------------------------------------------------
SELECT _bfr_superuser();
SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme'
      AND p.proname IN ('f_benchmark_lieux_parc', 'f_benchmark_traiteurs_parc', 'f_benchmark_kg_pax_zd')
      AND p.prosecdef
      AND 'search_path=plateforme, pg_catalog' = ANY(coalesce(p.proconfig, '{}'))),
  3,
  '25. les trois fonctions restent SECURITY DEFINER avec search_path verrouillé');

SELECT is(
  (SELECT array_agg(DISTINCT beneficiaires)
     FROM (SELECT p.proname,
                  string_agg(DISTINCT coalesce(r.rolname, 'PUBLIC'), ','
                             ORDER BY coalesce(r.rolname, 'PUBLIC')) AS beneficiaires
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace,
             LATERAL aclexplode(p.proacl) a
             LEFT JOIN pg_roles r ON r.oid = a.grantee
            WHERE n.nspname = 'plateforme'
              AND p.proname IN ('f_benchmark_lieux_parc', 'f_benchmark_traiteurs_parc', 'f_benchmark_kg_pax_zd')
              AND a.privilege_type = 'EXECUTE'
            GROUP BY p.proname) t),
  ARRAY['authenticated,postgres,service_role'],
  '26. bénéficiaires d''EXECUTE inchangés sur les trois fonctions (PUBLIC et anon absents)');

SELECT is(
  (SELECT pg_get_function_identity_arguments(p.oid) || ' -> ' || pg_get_function_result(p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme' AND p.proname = 'f_benchmark_kg_pax_zd'),
  'p_flux_id uuid, p_type_evenement_ids uuid[], p_taille_evenement_codes text[], p_periode_debut date, p_periode_fin date, p_lieu_ids uuid[], p_traiteur_ids uuid[]'
    || ' -> TABLE(flux_id uuid, flux_code text, type_evenement_id uuid, taille_evenement text, kg_par_pax_moyen numeric, nb_collectes_segment integer, nb_organisations_distinctes integer)',
  '27. f_benchmark_kg_pax_zd : 7 paramètres et colonnes de sortie inchangés');

SELECT * FROM finish();
ROLLBACK;

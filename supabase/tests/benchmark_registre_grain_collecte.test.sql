-- pgTAP — benchmark kg/pax et registre au grain de la COLLECTE (lot C1, 2026-10-24).
-- ---------------------------------------------------------------------------
-- Décisions Val : C3 (2026-10-22, chaque collecte selon son propre type), C4
-- (2026-10-20, taille XS–XL de la collecte pour le radar et la fiche), Q4
-- (2026-10-24, « Collectes, 0 écartée » : une collecte à 0 convive sort du parc).
-- Migration prouvée : 20261024120000_plateforme_benchmark_registre_grain_collecte.
--
-- La fixture fait porter l'écart à la collecte n°2, jamais à la n°1 : la n°1 est
-- recopiée sur l'événement par déclencheur (type), et le pax de l'événement est
-- le total du jour. Chaque événement du parc a ainsi :
--   n°1 : ZD, type A, 300 convives (taille S), 30 kg de biodéchet  ⇒ 0,10 kg/pax ;
--   n°2 : ZD, type B, 800 convives (taille L), 160 kg              ⇒ 0,20 kg/pax ;
--   n°3 (événements 1 à 5) : ZD, type B, 0 convive (inconnu), 999 kg.
-- L'événement, lui, est de type A (copie de la n°1) et compte 1 100 convives
-- (taille XL). Lu à l'événement, le parc ne rendrait qu'un segment (A, XL) :
-- les assertions 3 à 5 et 7 à 13 échouent sur l'ancienne lecture ; 1 et 2
-- vérifient la fixture ; 6 garde la règle Q4 (elle rougit si l'exclusion des
-- collectes à 0 convive est retirée).
--
-- Deux types d'événement DÉDIÉS bornent le parc aux lignes de ce test, quel que
-- soit le seed de la base. Trois organisations tournent sur les six événements :
-- chaque segment porte 6 collectes et 3 acteurs de part et d'autre (k-anonymat).
-- ---------------------------------------------------------------------------

BEGIN;
SELECT plan(15);

SET LOCAL role = 'postgres';

CREATE OR REPLACE FUNCTION _bgc_jwt(p_role text, p_org uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(), 'role', 'authenticated', 'user_role', p_role,
    'organisation_id', p_org, 'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION _bgc_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd) VALUES
  ('c1c00000-0000-0000-0000-0000000000a1'::uuid, 'Grain Traiteur 1', 'Grain 1 SARL', 'traiteur', '77777777710001', true, 0),
  ('c1c00000-0000-0000-0000-0000000000a2'::uuid, 'Grain Traiteur 2', 'Grain 2 SARL', 'traiteur', '77777777710002', true, 0),
  ('c1c00000-0000-0000-0000-0000000000a3'::uuid, 'Grain Traiteur 3', 'Grain 3 SARL', 'traiteur', '77777777710003', true, 0);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif) VALUES
  ('c1c00000-0000-0000-0000-0000000000b1'::uuid, 'c1c00000-0000-0000-0000-0000000000a1'::uuid,
   'chef1@grain.test', 'Chef', 'G1', 'traiteur_manager', true),
  ('c1c00000-0000-0000-0000-0000000000b2'::uuid, 'c1c00000-0000-0000-0000-0000000000a2'::uuid,
   'chef2@grain.test', 'Chef', 'G2', 'traiteur_manager', true),
  ('c1c00000-0000-0000-0000-0000000000b3'::uuid, 'c1c00000-0000-0000-0000-0000000000a3'::uuid,
   'chef3@grain.test', 'Chef', 'G3', 'traiteur_manager', true);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('c1c00000-0000-0000-0000-0000000000f1'::uuid, 'c1c00000-0000-0000-0000-0000000000a1'::uuid,
   'Grain 1 SARL', '77777777710001', '1 rue Grain', '75001', 'Paris'),
  ('c1c00000-0000-0000-0000-0000000000f2'::uuid, 'c1c00000-0000-0000-0000-0000000000a2'::uuid,
   'Grain 2 SARL', '77777777710002', '2 rue Grain', '75001', 'Paris'),
  ('c1c00000-0000-0000-0000-0000000000f3'::uuid, 'c1c00000-0000-0000-0000-0000000000a3'::uuid,
   'Grain 3 SARL', '77777777710003', '3 rue Grain', '75001', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('c1c00000-0000-0000-0000-0000000000f0'::uuid, 'Grain Lieu', '2 av Grain', '75002', 'Paris', 'camionnette');

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif) VALUES
  ('c1c00000-0000-0000-0000-0000000000d1'::uuid, 'GRAIN_A', 'Grain A', 1, true),
  ('c1c00000-0000-0000-0000-0000000000d2'::uuid, 'GRAIN_B', 'Grain B', 2, true);

-- Événements 1 à 6 (parc) et 10 (cible, collectes « realisee » donc hors parc).
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
)
SELECT
  ('c1c00000-0000-0000-0000-00000000e' || lpad(g::text, 3, '0'))::uuid,
  ('c1c00000-0000-0000-0000-0000000000a' || (g % 3 + 1)::text)::uuid,
  ('c1c00000-0000-0000-0000-0000000000a' || (g % 3 + 1)::text)::uuid,
  ('c1c00000-0000-0000-0000-0000000000f' || (g % 3 + 1)::text)::uuid,
  ('c1c00000-0000-0000-0000-0000000000b' || (g % 3 + 1)::text)::uuid,
  'c1c00000-0000-0000-0000-0000000000f0'::uuid,
  'c1c00000-0000-0000-0000-0000000000d1'::uuid,
  'Grain Evt ' || g,
  DATE '2026-05-01' + g,
  300,
  'Contact',
  '0600000000'
FROM (SELECT unnest(ARRAY[1, 2, 3, 4, 5, 6, 10]) AS g) s;

-- n°1 (18:00, type A, 300) puis n°2 (22:00, type B, 800) le même soir : la n°1 reste
-- la n°1 (ZD, même date, heure antérieure) et l'événement garde le type A.
INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, dirty_tms,
   annulee_cote_savr, type_evenement_id, pax)
SELECT
  ('c1c00000-0000-0000-0000-0000000' || n.rang || lpad(s.g::text, 3, '0'))::uuid,
  ('c1c00000-0000-0000-0000-00000000e' || lpad(s.g::text, 3, '0'))::uuid,
  'zero_dechet'::plateforme.collecte_type,
  (CASE WHEN s.g = 10 THEN 'realisee' ELSE 'cloturee' END)::plateforme.collecte_statut,
  'non_envoye'::plateforme.collecte_statut_tms,
  DATE '2026-05-01' + s.g,
  n.heure,
  false, false,
  n.type_id,
  n.pax
FROM (SELECT unnest(ARRAY[1, 2, 3, 4, 5, 6, 10]) AS g) s
CROSS JOIN (VALUES
  ('c1', '18:00'::time, 'c1c00000-0000-0000-0000-0000000000d1'::uuid, 300),
  ('c2', '22:00'::time, 'c1c00000-0000-0000-0000-0000000000d2'::uuid, 800),
  ('c3', '23:00'::time, 'c1c00000-0000-0000-0000-0000000000d2'::uuid, 300)) AS n(rang, heure, type_id, pax)
WHERE n.rang <> 'c3' OR s.g IN (1, 2, 3, 4, 5, 10);

-- n°3 : convives inconnus. Le déclencheur d'insertion remplace un pax 0 ; la valeur
-- 0 se pose donc après coup (cas réel : reprise Bubble).
UPDATE plateforme.collectes SET pax = 0
 WHERE id IN (SELECT ('c1c00000-0000-0000-0000-0000000c3' || lpad(g::text, 3, '0'))::uuid
                FROM unnest(ARRAY[1, 2, 3, 4, 5, 10]) AS g);

INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT
  ('c1c00000-0000-0000-0000-0000000' || n.rang || lpad(s.g::text, 3, '0'))::uuid,
  (SELECT id FROM plateforme.flux_dechets WHERE code = 'biodechet'),
  CASE WHEN s.g = 10 THEN n.poids_cible ELSE n.poids END
FROM (SELECT unnest(ARRAY[1, 2, 3, 4, 5, 6, 10]) AS g) s
CROSS JOIN (VALUES ('c1', 30::decimal, 20::decimal),
                   ('c2', 160::decimal, 80::decimal),
                   ('c3', 999::decimal, 50::decimal)) AS n(rang, poids, poids_cible)
WHERE n.rang <> 'c3' OR s.g IN (1, 2, 3, 4, 5, 10);

-- 1-2. Non-vacuité -------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int
     FROM plateforme.collectes c
     JOIN plateforme.evenements e ON e.id = c.evenement_id
    WHERE c.id IN (SELECT ('c1c00000-0000-0000-0000-0000000c2' || lpad(g::text, 3, '0'))::uuid
                     FROM generate_series(1, 6) g)
      AND c.statut = 'cloturee'
      AND e.type_evenement_id = 'c1c00000-0000-0000-0000-0000000000d1'::uuid
      AND c.type_evenement_id = 'c1c00000-0000-0000-0000-0000000000d2'::uuid
      AND e.pax = 1100
      AND c.pax = 800),
  6,
  'C1/benchmark_grain_collecte_fixture — les 6 collectes n°2 du parc sont de type B et de 800 convives, leur événement de type A et de 1 100 convives');

SELECT is(
  (SELECT count(*)::int
     FROM plateforme.collectes c
     JOIN plateforme.collecte_flux cf ON cf.collecte_id = c.id
    WHERE c.id IN (SELECT ('c1c00000-0000-0000-0000-0000000c3' || lpad(g::text, 3, '0'))::uuid
                     FROM generate_series(1, 5) g)
      AND c.statut = 'cloturee'
      AND c.pax = 0
      AND cf.poids_reel_kg = 999),
  5,
  '2. non-vacuité : 5 collectes clôturées, pesées, à 0 convive, de type B — de quoi former un segment au-dessus du k-anonymat si elles comptaient');

-- 3-6. Parc (f_benchmark_kg_pax_zd, sans jeton : chemin du rafraîchissement) ------
SELECT results_eq(
  $$ SELECT type_evenement_id, taille_evenement, round(kg_par_pax_moyen, 4), nb_collectes_segment
       FROM plateforme.f_benchmark_kg_pax_zd(
              p_type_evenement_ids => ARRAY['c1c00000-0000-0000-0000-0000000000d1'::uuid,
                                            'c1c00000-0000-0000-0000-0000000000d2'::uuid])
      ORDER BY 1 $$,
  $$ VALUES ('c1c00000-0000-0000-0000-0000000000d1'::uuid, 'S'::text, 0.1000::numeric, 6),
            ('c1c00000-0000-0000-0000-0000000000d2'::uuid, 'L'::text, 0.2000::numeric, 6) $$,
  'C1/benchmark_parc_segment_type_et_taille_de_la_collecte — un segment par type et taille de collecte, kg/pax divisé par ses propres convives (A, S, 0,10 ; B, L, 0,20)');

SELECT results_eq(
  $$ SELECT taille_evenement FROM plateforme.f_benchmark_kg_pax_zd(
       p_type_evenement_ids => ARRAY['c1c00000-0000-0000-0000-0000000000d2'::uuid]) $$,
  $$ VALUES ('L'::text) $$,
  'C1/benchmark_parc_filtre_type_sur_la_collecte — le filtre type B trouve les collectes n°2, dont l''événement est de type A');

SELECT results_eq(
  $$ SELECT type_evenement_id FROM plateforme.f_benchmark_kg_pax_zd(
       p_type_evenement_ids     => ARRAY['c1c00000-0000-0000-0000-0000000000d1'::uuid,
                                         'c1c00000-0000-0000-0000-0000000000d2'::uuid],
       p_taille_evenement_codes => ARRAY['L']) $$,
  $$ VALUES ('c1c00000-0000-0000-0000-0000000000d2'::uuid) $$,
  'C1/benchmark_parc_filtre_taille_sur_la_collecte — le filtre taille L rend le segment des collectes de 800 convives, pas celui de l''événement (XL)');

SELECT is(
  (SELECT count(*)::int FROM plateforme.f_benchmark_kg_pax_zd(
     p_type_evenement_ids     => ARRAY['c1c00000-0000-0000-0000-0000000000d2'::uuid],
     p_taille_evenement_codes => ARRAY['XS'])),
  0,
  'C1/benchmark_parc_pax_zero_ecarte — les 5 collectes à 0 convive ne forment aucun segment : hors du parc (Q4 du 2026-10-24)');

-- 7-8. Point « Vous » de la fiche (f_benchmark_single_collecte, jeton du traiteur) --
-- L'événement 10 est programmé et opéré par le traiteur 2 (rotation 10 % 3 + 1).
SELECT _bgc_jwt('traiteur_manager', 'c1c00000-0000-0000-0000-0000000000a2'::uuid);

SELECT results_eq(
  $$ SELECT taille_evenement, round(ratio_user, 4), round(benchmark_kg_pax, 4), nb_collectes_segment
       FROM plateforme.f_benchmark_single_collecte('c1c00000-0000-0000-0000-0000000c2010'::uuid) $$,
  $$ VALUES ('L'::text, 0.1000::numeric, 0.2000::numeric, 6) $$,
  'C1/benchmark_fiche_point_vous_de_la_collecte — collecte n°2 : 80 kg / 800 convives, comparée au segment (type B, taille L)');

SELECT is(
  (SELECT bool_and(ratio_user IS NULL) AND count(*) = 1
     FROM plateforme.f_benchmark_single_collecte('c1c00000-0000-0000-0000-0000000c3010'::uuid)),
  true,
  'C1/benchmark_fiche_pax_zero_sans_point_vous — collecte à 0 convive : le flux pesé est rendu, sans ratio');

SELECT _bgc_superuser();

-- 9-11. Rapport (f_rapport_benchmark_zd, service_role) ---------------------------
SELECT results_eq(
  $$ SELECT taille_evenement, round(collecte_kg_pax, 4), round(benchmark_kg_pax, 4), nb_collectes_segment
       FROM plateforme.f_rapport_benchmark_zd('c1c00000-0000-0000-0000-0000000c2010'::uuid) $$,
  $$ VALUES ('L'::text, 0.1000::numeric, 0.2000::numeric, 6) $$,
  'C1/benchmark_rapport_defaut_type_et_taille_de_la_collecte — sans filtre, le rapport de la collecte n°2 se compare au segment (B, L)');

SELECT results_eq(
  $$ SELECT taille_evenement, round(collecte_kg_pax, 4), round(benchmark_kg_pax, 4), nb_collectes_segment
       FROM plateforme.f_rapport_benchmark_zd('c1c00000-0000-0000-0000-0000000c1010'::uuid) $$,
  $$ VALUES ('S'::text, 0.0667::numeric, 0.1000::numeric, 6) $$,
  '10. la collecte n°1 du même événement garde son propre segment (A, S) : 20 kg / 300 convives');

SELECT is(
  (SELECT bool_and(collecte_kg_pax IS NULL) AND count(*) = 1
     FROM plateforme.f_rapport_benchmark_zd('c1c00000-0000-0000-0000-0000000c3010'::uuid)),
  true,
  'C1/benchmark_rapport_pax_zero_sans_ratio — rapport d''une collecte à 0 convive : flux rendu, sans ratio kg/pax');

-- 12-13. Registre (v_registre_dechets, jeton Admin) ------------------------------
SELECT _bgc_jwt('admin_savr', NULL);

SELECT results_eq(
  $$ SELECT pax, taille_bracket, type_evenement_id FROM plateforme.v_registre_dechets
      WHERE collecte_id = 'c1c00000-0000-0000-0000-0000000c2001'::uuid $$,
  $$ VALUES (800, 'L'::text, 'c1c00000-0000-0000-0000-0000000000d2'::uuid) $$,
  'C1/registre_pax_taille_type_de_la_collecte — la ligne de la collecte n°2 porte ses 800 convives, sa taille L et son type B');

SELECT results_eq(
  $$ SELECT pax, taille_bracket, type_evenement_id FROM plateforme.v_registre_dechets
      WHERE collecte_id = 'c1c00000-0000-0000-0000-0000000c1001'::uuid $$,
  $$ VALUES (300, 'S'::text, 'c1c00000-0000-0000-0000-0000000000d1'::uuid) $$,
  '13. la ligne de la collecte n°1 du même événement porte 300 convives, taille S, type A');

SELECT _bgc_superuser();

-- 14-15. Options et droits de la vue, que CREATE OR REPLACE VIEW peut défaire en
-- silence (une clause WITH omise remet les options à zéro ; relecture du lot C1).
-- Égalité d'ensemble, qui mord dans les deux sens (droit retiré ou ajouté).
SELECT is(
  (SELECT c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'plateforme' AND c.relname = 'v_registre_dechets'),
  ARRAY['security_invoker=false'],
  '14. v_registre_dechets garde security_invoker = false');

SELECT is(
  (SELECT string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || a.privilege_type, ','
                     ORDER BY coalesce(r.rolname, 'PUBLIC'), a.privilege_type)
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace,
     LATERAL aclexplode(c.relacl) a
     LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'plateforme' AND c.relname = 'v_registre_dechets'
      AND coalesce(r.rolname, 'PUBLIC') <> 'postgres'),
  'authenticated:SELECT,service_role:DELETE,service_role:INSERT,service_role:SELECT,service_role:UPDATE',
  '15. droits de v_registre_dechets inchangés : SELECT pour authenticated, rien pour anon ni PUBLIC');

SELECT * FROM finish();
ROLLBACK;

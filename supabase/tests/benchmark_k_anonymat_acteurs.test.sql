-- pgTAP — k-anonymat du benchmark parc : compter les ACTEURS, pas que les collectes.
-- ---------------------------------------------------------------------------
-- Verrouille le durcissement de `plateforme.f_benchmark_kg_pax_zd`
-- (migration 20260922160000, arbitrage Val 2026-09-22, §04 « RLS / k-anonymat ») :
-- un segment n'est publié qu'à partir de 5 collectes ET de 3 acteurs distincts,
-- comptés des DEUX côtés — organisation programmatrice (`evenements.organisation_id`)
-- et traiteur opérationnel (`evenements.traiteur_operationnel_organisation_id`).
--
-- Avant ce durcissement, 5 collectes d'un MÊME acteur franchissaient le seuil et
-- sa moyenne kg/pax était publiée. La fonction porte `GRANT EXECUTE … TO
-- authenticated` : n'importe quel utilisateur connecté pouvait resserrer ses
-- filtres jusqu'à isoler un concurrent — ce que la garde compétitive sur
-- `p_traiteur_ids` empêche déjà par l'autre porte.
--
-- La fixture bâtit 5 segments indépendants (5 types d'événement dédiés, même flux
-- et même bracket) qui ne diffèrent QUE par la répartition des acteurs. Chacun
-- porte exactement 5 collectes clôturées et pesées : le seuil « collectes » est
-- donc satisfait partout, et tout masquage observé ne peut venir que du seuil
-- « acteurs ». Chaque assertion de masquage est adossée à un contrôle de
-- non-vacuité lu en direct sur les tables (la fixture existe bien) et au segment
-- TRIO, qui reste visible dans la même requête.
--
-- Fixtures 100 % isolées (BEGIN…ROLLBACK) — UUID et SIRET distincts de
-- r19b_gest04_benchmark_ponderee et benchmark_agregation_segments_ponderee, qui
-- bâtissent des parcs voisins.
-- ---------------------------------------------------------------------------

BEGIN;
SELECT plan(17);

-- ── Helper JWT (isolé) ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _kanon_set_jwt(p_role text, p_org uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'user_role', p_role,
    'organisation_id', p_org, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

-- ── Fixtures (superuser) ────────────────────────────────────────────────────
SET LOCAL role = 'postgres';

-- 3 traiteurs (acteurs opérationnels) + 3 gestionnaires de lieux (programmateurs
-- tiers) : les deux colonnes comptées peuvent ainsi varier indépendamment.
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd) VALUES
  ('ac000000-0000-0000-0000-0000000000a1'::uuid, 'Kanon Traiteur 1', 'Kanon T1 SARL', 'traiteur',           '77777777700001', true, 0),
  ('ac000000-0000-0000-0000-0000000000a2'::uuid, 'Kanon Traiteur 2', 'Kanon T2 SARL', 'traiteur',           '77777777700002', true, 0),
  ('ac000000-0000-0000-0000-0000000000a3'::uuid, 'Kanon Traiteur 3', 'Kanon T3 SARL', 'traiteur',           '77777777700003', true, 0),
  ('ac000000-0000-0000-0000-0000000000a4'::uuid, 'Kanon Gestion 1',  'Kanon G1 SARL', 'gestionnaire_lieux', '77777777700004', true, 0),
  ('ac000000-0000-0000-0000-0000000000a5'::uuid, 'Kanon Gestion 2',  'Kanon G2 SARL', 'gestionnaire_lieux', '77777777700005', true, 0),
  ('ac000000-0000-0000-0000-0000000000a6'::uuid, 'Kanon Gestion 3',  'Kanon G3 SARL', 'gestionnaire_lieux', '77777777700006', true, 0);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
SELECT ('ac000000-0000-0000-0000-0000000000b' || n)::uuid,
       ('ac000000-0000-0000-0000-0000000000a' || n)::uuid,
       'user' || n || '@kanon.test', 'User', 'K' || n,
       CASE WHEN n <= 3 THEN 'traiteur_manager' ELSE 'gestionnaire_lieux' END::plateforme.user_role,
       true
FROM generate_series(1, 6) n;

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
SELECT ('ac000000-0000-0000-0000-0000000000f' || n)::uuid,
       ('ac000000-0000-0000-0000-0000000000a' || n)::uuid,
       'Kanon ' || n || ' SARL', '7777777770000' || n, n || ' rue Kanon', '75001', 'Paris'
FROM generate_series(1, 6) n;

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('ac000000-0000-0000-0000-0000000000f0'::uuid, 'Kanon Lieu', '9 av Kanon', '75002', 'Paris', 'camionnette');

-- 5 types d'événement dédiés = 5 segments parc indépendants (même flux, même
-- bracket XS via pax = 100), bornés aux lignes de ce test quel que soit le seed.
INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif) VALUES
  ('ac000000-0000-0000-0000-0000000000d1'::uuid, 'KANON_MONO', 'Kanon mono-acteur',        1, true),
  ('ac000000-0000-0000-0000-0000000000d2'::uuid, 'KANON_DUO',  'Kanon deux acteurs',       2, true),
  ('ac000000-0000-0000-0000-0000000000d3'::uuid, 'KANON_TRIO', 'Kanon trois acteurs',      3, true),
  ('ac000000-0000-0000-0000-0000000000d4'::uuid, 'KANON_TOP1', 'Kanon traiteur unique',    4, true),
  ('ac000000-0000-0000-0000-0000000000d5'::uuid, 'KANON_ORG1', 'Kanon programmateur seul', 5, true);

-- 25 événements = 5 segments × 5 collectes. Seule la répartition des acteurs
-- change d'un segment à l'autre ; pax et poids sont identiques partout, de sorte
-- que la visibilité ne puisse dépendre que des compteurs d'acteurs.
--   MONO : 1 programmateur  / 1 traiteur   → masqué des deux côtés
--   DUO  : 2 programmateurs / 2 traiteurs  → masqué (le seuil est 3, pas 2)
--   TRIO : 3 programmateurs / 3 traiteurs  → VISIBLE (référence positive)
--   TOP1 : 3 programmateurs / 1 traiteur   → masqué par le SEUL compteur traiteur
--   ORG1 : 1 programmateur  / 3 traiteurs  → masqué par le SEUL compteur programmateur
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
)
SELECT
  ('ac000000-0000-0000-0000-00000000e' || lpad(s.rang::text, 3, '0'))::uuid,
  ('ac000000-0000-0000-0000-0000000000a' || s.org)::uuid,
  ('ac000000-0000-0000-0000-0000000000a' || s.top)::uuid,
  ('ac000000-0000-0000-0000-0000000000f' || s.org)::uuid,
  ('ac000000-0000-0000-0000-0000000000b' || s.org)::uuid,
  'ac000000-0000-0000-0000-0000000000f0'::uuid,
  ('ac000000-0000-0000-0000-0000000000d' || s.segment)::uuid,
  'Evt kanon ' || s.rang,
  DATE '2026-05-01' + s.rang,
  100,
  'Contact', '0600000000'
FROM (VALUES
  -- (rang, segment, org programmatrice, traiteur opérationnel)
  ( 1,'1','1','1'), ( 2,'1','1','1'), ( 3,'1','1','1'), ( 4,'1','1','1'), ( 5,'1','1','1'),
  ( 6,'2','1','1'), ( 7,'2','1','1'), ( 8,'2','2','2'), ( 9,'2','2','2'), (10,'2','1','1'),
  (11,'3','1','1'), (12,'3','2','2'), (13,'3','3','3'), (14,'3','1','1'), (15,'3','2','2'),
  (16,'4','4','1'), (17,'4','5','1'), (18,'4','6','1'), (19,'4','4','1'), (20,'4','5','1'),
  (21,'5','4','1'), (22,'5','4','2'), (23,'5','4','3'), (24,'5','4','1'), (25,'5','4','2')
) AS s(rang, segment, org, top);

INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, dirty_tms, annulee_cote_savr)
SELECT
  ('ac000000-0000-0000-0000-00000000c' || lpad(g::text, 3, '0'))::uuid,
  ('ac000000-0000-0000-0000-00000000e' || lpad(g::text, 3, '0'))::uuid,
  'zero_dechet', 'cloturee', 'non_envoye', DATE '2026-05-01' + g, '20:00', false, false
FROM generate_series(1, 25) g;

INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT ('ac000000-0000-0000-0000-00000000c' || lpad(g::text, 3, '0'))::uuid,
       (SELECT id FROM plateforme.flux_dechets WHERE code = 'biodechet'),
       50::decimal
FROM generate_series(1, 25) g;

-- 2 collectes CIBLES pour les appelants (fiche collecte + PDF rapport RSE), une
-- par segment testé. Statut 'realisee' ⇒ hors parc : les segments gardent leurs
-- 5 collectes, et la cible ne se compare qu'au parc.
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES
  ('ac000000-0000-0000-0000-0000000000e8'::uuid, 'ac000000-0000-0000-0000-0000000000a1'::uuid,
   'ac000000-0000-0000-0000-0000000000a1'::uuid, 'ac000000-0000-0000-0000-0000000000f1'::uuid,
   'ac000000-0000-0000-0000-0000000000b1'::uuid, 'ac000000-0000-0000-0000-0000000000f0'::uuid,
   'ac000000-0000-0000-0000-0000000000d1'::uuid, 'Cible segment MONO', '2026-06-01', 100, 'Contact', '0600000098'),
  ('ac000000-0000-0000-0000-0000000000e9'::uuid, 'ac000000-0000-0000-0000-0000000000a1'::uuid,
   'ac000000-0000-0000-0000-0000000000a1'::uuid, 'ac000000-0000-0000-0000-0000000000f1'::uuid,
   'ac000000-0000-0000-0000-0000000000b1'::uuid, 'ac000000-0000-0000-0000-0000000000f0'::uuid,
   'ac000000-0000-0000-0000-0000000000d3'::uuid, 'Cible segment TRIO', '2026-06-02', 100, 'Contact', '0600000099');

INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, dirty_tms, annulee_cote_savr)
VALUES
  ('ac000000-0000-0000-0000-0000000000c8'::uuid, 'ac000000-0000-0000-0000-0000000000e8'::uuid,
   'zero_dechet', 'realisee', 'non_envoye', '2026-06-01', '20:00', false, false),
  ('ac000000-0000-0000-0000-0000000000c9'::uuid, 'ac000000-0000-0000-0000-0000000000e9'::uuid,
   'zero_dechet', 'realisee', 'non_envoye', '2026-06-02', '20:00', false, false);

INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT c, (SELECT id FROM plateforme.flux_dechets WHERE code = 'biodechet'), 40::decimal
FROM (VALUES ('ac000000-0000-0000-0000-0000000000c8'::uuid),
             ('ac000000-0000-0000-0000-0000000000c9'::uuid)) AS v(c);

-- ════════════════════════════════════════════════════════════════════════════
-- Assertions. La fonction est SECURITY DEFINER : elle agrège le parc entier quel
-- que soit l'appelant, et seule sa garde compétitive dépend du rôle — on l'appelle
-- donc sous un JWT de rôle benchmark. Les oracles de non-vacuité, eux, lisent les
-- tables EN DIRECT : ils doivent repasser en `postgres`, sinon la RLS masque les
-- organisations tierces et l'oracle mesure le lecteur au lieu de la fixture
-- (mesuré : sous JWT gestionnaire, le segment MONO paraissait vide — un négatif
-- vrai pour la mauvaise raison, exactement ce que ces contrôles existent pour
-- attraper). D'où l'alternance explicite de rôle ci-dessous.
-- ════════════════════════════════════════════════════════════════════════════
SELECT _kanon_set_jwt('gestionnaire_lieux', 'ac000000-0000-0000-0000-0000000000a4'::uuid);

-- 1-2. Référence POSITIVE : 3 programmateurs × 3 traiteurs ⇒ segment publié.
SELECT is(
  (SELECT nb_collectes_segment FROM plateforme.f_benchmark_kg_pax_zd(
     p_type_evenement_ids => ARRAY['ac000000-0000-0000-0000-0000000000d3'::uuid])),
  5,
  'KANON-1 : segment TRIO (3 programmateurs × 3 traiteurs) PUBLIÉ avec ses 5 collectes'
);

SELECT is(
  (SELECT nb_organisations_distinctes FROM plateforme.f_benchmark_kg_pax_zd(
     p_type_evenement_ids => ARRAY['ac000000-0000-0000-0000-0000000000d3'::uuid])),
  3,
  'KANON-2 : segment TRIO — 3 organisations distinctes exposées'
);

-- 3-4. Le cas de la faille : 5 collectes, UN SEUL acteur ⇒ segment masqué.
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.f_benchmark_kg_pax_zd(
     p_type_evenement_ids => ARRAY['ac000000-0000-0000-0000-0000000000d1'::uuid])),
  0,
  'KANON-3 : segment MONO (5 collectes d''UN SEUL acteur) MASQUÉ'
);

SET LOCAL role = 'postgres';  -- oracle lu hors RLS
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.collectes c
     JOIN plateforme.evenements e ON e.id = c.evenement_id
     JOIN plateforme.collecte_flux cf ON cf.collecte_id = c.id
    WHERE e.type_evenement_id = 'ac000000-0000-0000-0000-0000000000d1'::uuid
      AND c.statut = 'cloturee' AND c.type = 'zero_dechet' AND cf.poids_reel_kg IS NOT NULL),
  5,
  'KANON-4 : non-vacuité — le segment MONO porte bien 5 collectes clôturées et pesées (le seuil ≥5 est satisfait, seul celui des acteurs masque)'
);
SELECT _kanon_set_jwt('gestionnaire_lieux', 'ac000000-0000-0000-0000-0000000000a4'::uuid);

-- 5-6. Le seuil est 3, pas 2 : deux acteurs ne suffisent pas (chacun déduit
--      l'autre par soustraction, connaissant sa propre performance).
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.f_benchmark_kg_pax_zd(
     p_type_evenement_ids => ARRAY['ac000000-0000-0000-0000-0000000000d2'::uuid])),
  0,
  'KANON-5 : segment DUO (2 acteurs) MASQUÉ — le seuil retenu est 3, pas 2'
);

SET LOCAL role = 'postgres';  -- oracle lu hors RLS
SELECT is(
  (SELECT ARRAY[COUNT(DISTINCT e.organisation_id)::int,
                COUNT(DISTINCT e.traiteur_operationnel_organisation_id)::int,
                COUNT(DISTINCT c.id)::int]
     FROM plateforme.collectes c
     JOIN plateforme.evenements e ON e.id = c.evenement_id
    WHERE e.type_evenement_id = 'ac000000-0000-0000-0000-0000000000d2'::uuid
      AND c.statut = 'cloturee'),
  ARRAY[2, 2, 5],
  'KANON-6 : non-vacuité — le segment DUO porte bien 2 programmateurs, 2 traiteurs et 5 collectes'
);
SELECT _kanon_set_jwt('gestionnaire_lieux', 'ac000000-0000-0000-0000-0000000000a4'::uuid);

-- 7-8. Le compteur « traiteur opérationnel » mord seul : 3 programmateurs
--      tiers, mais un unique traiteur derrière — c'est lui que la garde
--      compétitive protège, et c'est lui que `p_traiteur_ids` cible.
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.f_benchmark_kg_pax_zd(
     p_type_evenement_ids => ARRAY['ac000000-0000-0000-0000-0000000000d4'::uuid])),
  0,
  'KANON-7 : segment TOP1 (3 programmateurs mais 1 SEUL traiteur opérationnel) MASQUÉ'
);

SET LOCAL role = 'postgres';  -- oracle lu hors RLS
SELECT is(
  (SELECT ARRAY[COUNT(DISTINCT e.organisation_id)::int,
                COUNT(DISTINCT e.traiteur_operationnel_organisation_id)::int]
     FROM plateforme.collectes c
     JOIN plateforme.evenements e ON e.id = c.evenement_id
    WHERE e.type_evenement_id = 'ac000000-0000-0000-0000-0000000000d4'::uuid
      AND c.statut = 'cloturee'),
  ARRAY[3, 1],
  'KANON-8 : non-vacuité — TOP1 a bien 3 organisations programmatrices : le masquage ne peut venir que du compteur traiteur'
);
SELECT _kanon_set_jwt('gestionnaire_lieux', 'ac000000-0000-0000-0000-0000000000a4'::uuid);

-- 9-10. Le compteur « organisation programmatrice » mord seul : symétrique du
--       précédent, il couvre le gestionnaire de lieux unique du §04.
SELECT is(
  (SELECT COUNT(*)::int FROM plateforme.f_benchmark_kg_pax_zd(
     p_type_evenement_ids => ARRAY['ac000000-0000-0000-0000-0000000000d5'::uuid])),
  0,
  'KANON-9 : segment ORG1 (3 traiteurs mais 1 SEULE organisation programmatrice) MASQUÉ'
);

SET LOCAL role = 'postgres';  -- oracle lu hors RLS
SELECT is(
  (SELECT ARRAY[COUNT(DISTINCT e.organisation_id)::int,
                COUNT(DISTINCT e.traiteur_operationnel_organisation_id)::int]
     FROM plateforme.collectes c
     JOIN plateforme.evenements e ON e.id = c.evenement_id
    WHERE e.type_evenement_id = 'ac000000-0000-0000-0000-0000000000d5'::uuid
      AND c.statut = 'cloturee'),
  ARRAY[1, 3],
  'KANON-10 : non-vacuité — ORG1 a bien 3 traiteurs opérationnels : le masquage ne peut venir que du compteur programmateur'
);
SELECT _kanon_set_jwt('gestionnaire_lieux', 'ac000000-0000-0000-0000-0000000000a4'::uuid);

-- 11-12. Propagation à la fiche collecte (§06.04) : `f_benchmark_single_collecte`
--        réutilise la fonction, donc hérite de la garde. Le couple NULL / non-NULL
--        prouve que c'est bien la garde qui parle, pas un appelant cassé.
SELECT _kanon_set_jwt('admin_savr', 'ac000000-0000-0000-0000-0000000000a1'::uuid);

SELECT ok(
  (SELECT benchmark_kg_pax IS NULL AND nb_collectes_segment = 0
     FROM plateforme.f_benchmark_single_collecte('ac000000-0000-0000-0000-0000000000c8'::uuid)
    WHERE flux_code = 'biodechet'),
  'KANON-11 : fiche collecte — cible du segment MONO ⇒ pas de point de comparaison (benchmark NULL)'
);

SELECT ok(
  (SELECT benchmark_kg_pax IS NOT NULL AND nb_collectes_segment = 5
     FROM plateforme.f_benchmark_single_collecte('ac000000-0000-0000-0000-0000000000c9'::uuid)
    WHERE flux_code = 'biodechet'),
  'KANON-12 : fiche collecte — cible du segment TRIO ⇒ point de comparaison servi (appelant fonctionnel)'
);

-- 13-14. Propagation au PDF rapport RSE (§12 §1.2) via `f_rapport_benchmark_zd`.
SET LOCAL role = 'postgres';

SELECT ok(
  (SELECT benchmark_kg_pax IS NULL AND nb_collectes_segment = 0
     FROM plateforme.f_rapport_benchmark_zd(
       p_collecte_id        => 'ac000000-0000-0000-0000-0000000000c8'::uuid,
       p_type_evenement_ids => ARRAY['ac000000-0000-0000-0000-0000000000d1'::uuid])
    WHERE flux_code = 'biodechet'),
  'KANON-13 : PDF rapport RSE — segment MONO ⇒ aucun point parc (mention « données insuffisantes »)'
);

SELECT ok(
  (SELECT benchmark_kg_pax IS NOT NULL AND nb_collectes_segment = 5
     FROM plateforme.f_rapport_benchmark_zd(
       p_collecte_id        => 'ac000000-0000-0000-0000-0000000000c9'::uuid,
       p_type_evenement_ids => ARRAY['ac000000-0000-0000-0000-0000000000d3'::uuid])
    WHERE flux_code = 'biodechet'),
  'KANON-14 : PDF rapport RSE — segment TRIO ⇒ point parc servi (appelant fonctionnel)'
);

-- 15-17. Le `CREATE OR REPLACE` de la migration remplace proconfig : sans
--        reconduction explicite, le durcissement CWE-426 tomberait en silence.
--        L'ACL, elle, est préservée par REPLACE — on vérifie qu'aucun accès
--        n'a été ouvert au passage (grantees mesurés en ENSEMBLE, car
--        has_function_privilege répond vrai via PUBLIC).
SELECT is(
  (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme' AND p.proname = 'f_benchmark_kg_pax_zd'),
  true,
  'KANON-15 : f_benchmark_kg_pax_zd reste SECURITY DEFINER après le CREATE OR REPLACE'
);

SELECT is(
  (SELECT proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme' AND p.proname = 'f_benchmark_kg_pax_zd'),
  ARRAY['search_path=plateforme, pg_catalog'],
  'KANON-16 : search_path figé reconduit (le CREATE OR REPLACE réinitialise proconfig)'
);

SELECT is(
  (SELECT array_agg(DISTINCT grantee ORDER BY grantee)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN LATERAL (
       SELECT COALESCE(NULLIF(a.grantee::regrole::text, '-'), 'PUBLIC') AS grantee
       FROM aclexplode(p.proacl) a
       WHERE a.privilege_type = 'EXECUTE'
     ) g
    WHERE n.nspname = 'plateforme' AND p.proname = 'f_benchmark_kg_pax_zd'),
  ARRAY['authenticated', 'postgres', 'service_role'],
  'KANON-17 : EXECUTE reste limité à authenticated/service_role — ni PUBLIC ni anon'
);

SELECT * FROM finish();
ROLLBACK;

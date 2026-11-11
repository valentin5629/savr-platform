-- =============================================================================
-- pgTAP — plateforme.f_lieux_visibles_organisation(uuid)
-- Migration : 20261111100000_plateforme_lieux_visibles_organisation.sql
-- Route servie : GET /api/v1/programmation/lieux?organisation_id=… (l'Admin
-- programme une collecte POUR un client, §06.01 champ « Lieu »).
-- =============================================================================
-- POURQUOI CETTE FONCTION. La route relisait par l'API de données tous les
-- événements de l'organisation cible, puis tous ses lieux par un seul filtre
-- `in.(…)` : réponse amputée à 1 000 lignes sans erreur, échec passé quelques
-- centaines d'identifiants. La fonction rend l'ensemble côté base, en un appel.
--
-- CE QUE CE FICHIER PROUVE, dans l'ordre :
--   1-5    structure et droits : SECURITY INVOKER, EXECUTE au propriétaire et à
--          service_role seulement (ni PUBLIC, ni anon, ni authenticated) ;
--   6-9    FERMETURE, sous `authenticated` puis `anon` : l'appel est refusé
--          (42501), y compris pour sa propre organisation et pour un jeton de
--          l'équipe Savr — la fonction n'est appelée que par le serveur. Le
--          MESSAGE est contrôlé aussi : c'est la fonction qui est refusée. Un
--          refus de lecture de la table porterait le même code 42501 alors que
--          la fonction, elle, serait ouverte ;
--   10-17  contenu, sous `service_role` (l'identité de la route) : chaque
--          branche, le cloisonnement entre organisations, la garde « traiteur »
--          de la branche 4, l'absence de la branche 3, organisation inconnue ;
--   18-23  ÉGALITÉ avec la policy `lieux_clients_select` : ce que rend la
--          fonction pour une organisation = ce que lit un utilisateur de cette
--          organisation sous `authenticated`, pour chaque rôle qui programme.
--          Les trois régimes de la branche 3 « client organisateur », que la
--          fonction ne transcrit pas, y sont : hors d'atteinte (traiteur,
--          agence, gestionnaire non rattaché au lieu) et atteinte mais
--          redondante (gestionnaire rattaché, assert 23) ;
--   24-26  volume : 1 100 événements sur 400 lieux distincts, rendus en entier
--          et sans doublon, y compris le lieu du seul 1 100e événement.
--
-- ⚠ L'égalité 18-22 est le garde-fou de comportement : le cliquet
--   `lieux_clients_select_cliquet.test.sql` ne fait que signaler que le TEXTE de
--   la policy a changé. Si l'égalité rougit après un changement de policy, c'est
--   la fonction qui doit suivre (ou l'écart qui doit être assumé et écrit).
-- ⚠ NON-VACUITÉ : chaque ensemble comparé est épinglé à sa valeur exacte, non
--   vide, par les asserts 10 à 14 ; chaque négatif est doublé de la preuve que
--   la donnée écartée existe (asserts 13 et 23).
-- =============================================================================

BEGIN;
SELECT plan(26);

-- ── Helpers ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lvo_superuser() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

CREATE OR REPLACE FUNCTION lvo_jwt(p_role text, p_org uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'user_role', p_role,
    'organisation_id', p_org, 'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

-- L'identité de la route : le client de service.
CREATE OR REPLACE FUNCTION lvo_service() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END $$;

-- Noms rendus par la fonction pour une organisation (sous le rôle courant).
CREATE OR REPLACE FUNCTION lvo_fonction(p_org uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(nom, ',' ORDER BY nom), '')
    FROM plateforme.f_lieux_visibles_organisation(p_org)
$$;

-- Noms lus par l'utilisateur courant, par la vue que lit le chemin client de la
-- route (`v_lieux_clients`, donc la policy `lieux_clients_select`).
CREATE OR REPLACE FUNCTION lvo_rls() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(nom, ',' ORDER BY nom), '')
    FROM plateforme.v_lieux_clients
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
SELECT lvo_superuser();

INSERT INTO plateforme.organisations (id, nom, type, siret, actif, est_shadow) VALUES
  ('f1eeb001-0000-0000-0000-000000000001'::uuid, 'LVO T1 traiteur',     'traiteur',           '96100000000001', true, false),
  ('f1eeb001-0000-0000-0000-000000000002'::uuid, 'LVO T2 concurrent',   'traiteur',           '96100000000002', true, false),
  ('f1eeb001-0000-0000-0000-000000000003'::uuid, 'LVO AG agence',       'agence',             '96100000000003', true, false),
  ('f1eeb001-0000-0000-0000-000000000004'::uuid, 'LVO GL gestionnaire', 'gestionnaire_lieux', '96100000000004', true, false),
  ('f1eeb001-0000-0000-0000-000000000005'::uuid, 'LVO T3 volume',       'traiteur',           '96100000000005', true, false);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('f1eeb002-0000-0000-0000-000000000003'::uuid, 'f1eeb001-0000-0000-0000-000000000003'::uuid,
   'a@lvo.visibles', 'A', 'G', 'agence');

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
SELECT ('f1eeb005-0000-0000-0000-00000000000' || n)::uuid,
       ('f1eeb001-0000-0000-0000-00000000000' || n)::uuid,
       'LVO SAS ' || n, '9610000000000' || n, n || ' rue test', '75001', 'Paris'
  FROM generate_series(1, 5) AS n;

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('f1eeb006-0000-0000-0000-000000000001'::uuid, 'cocktail_lvo', 'Cocktail LVO');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, actif) VALUES
  -- LVO-1 : rattaché au gestionnaire GL (branche 1). Il s'y tient aussi un
  -- événement DATÉ de T2 dont GL est client organisateur, avec une collecte
  -- programmée : la branche 3 l'atteint pour GL, sans rien lui apporter de plus.
  ('f1eeb003-0000-0000-0000-000000000001'::uuid, 'LVO-1', '1 r', '75001', 'Paris', 'fourgon', true),
  -- LVO-2 : événement programmé et opéré par T1 (branche 2).
  ('f1eeb003-0000-0000-0000-000000000002'::uuid, 'LVO-2', '2 r', '75002', 'Paris', 'fourgon', true),
  -- LVO-3 : événement programmé par l'agence AG, opéré par T1 (branche 4 pour
  -- T1, branche 2 pour AG).
  ('f1eeb003-0000-0000-0000-000000000003'::uuid, 'LVO-3', '3 r', '75003', 'Paris', 'fourgon', true),
  -- LVO-4 : comme LVO-3, mais lieu DÉSACTIVÉ. La fonction le rend : le filtre
  -- `actif` est celui de l'écran, la policy ne le porte pas non plus.
  ('f1eeb003-0000-0000-0000-000000000004'::uuid, 'LVO-4', '4 r', '75004', 'Paris', 'fourgon', false),
  -- LVO-5 : événement DATÉ programmé et opéré par le concurrent T2, dont T1 est
  -- seulement client organisateur (branche 3, hors d'atteinte pour un traiteur).
  ('f1eeb003-0000-0000-0000-000000000005'::uuid, 'LVO-5', '5 r', '75005', 'Paris', 'fourgon', true),
  -- LVO-6 : programmé par T2, « opéré » par l'AGENCE AG (donnée anormale : une
  -- agence n'opère pas). La branche 4 ne vaut que pour un traiteur.
  ('f1eeb003-0000-0000-0000-000000000006'::uuid, 'LVO-6', '6 r', '75006', 'Paris', 'fourgon', true),
  -- LVO-7 : programmé et opéré par T2, événement DATÉ dont AG est seulement
  -- client organisateur (branche 3, non transcrite).
  ('f1eeb003-0000-0000-0000-000000000007'::uuid, 'LVO-7', '7 r', '75007', 'Paris', 'fourgon', true),
  -- LVO-8 : programmé par le gestionnaire GL, opéré par T2 (branche 2 pour GL,
  -- branche 4 pour T2).
  ('f1eeb003-0000-0000-0000-000000000008'::uuid, 'LVO-8', '8 r', '75008', 'Paris', 'fourgon', true),
  -- LVO-9 : événement DATÉ de T2 dont GL est client organisateur, sur un lieu
  -- qui ne lui est PAS rattaché (branche 3, hors d'atteinte sans rattachement).
  ('f1eeb003-0000-0000-0000-000000000009'::uuid, 'LVO-9', '9 r', '75009', 'Paris', 'fourgon', true);

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id) VALUES
  ('f1eeb001-0000-0000-0000-000000000004'::uuid, 'f1eeb003-0000-0000-0000-000000000001'::uuid);

-- (programmateur, opérateur, client organisateur, lieu). L'entité de facturation
-- est celle du programmateur.
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id,
  client_organisateur_organisation_id, lieu_id, entite_facturation_id, created_by,
  type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone)
SELECT ('f1eeb004-0000-0000-0000-00000000000' || e.lieu)::uuid,
       ('f1eeb001-0000-0000-0000-00000000000' || e.programmateur)::uuid,
       ('f1eeb001-0000-0000-0000-00000000000' || e.operateur)::uuid,
       CASE WHEN e.client IS NULL THEN NULL
            ELSE ('f1eeb001-0000-0000-0000-00000000000' || e.client)::uuid END,
       ('f1eeb003-0000-0000-0000-00000000000' || e.lieu)::uuid,
       ('f1eeb005-0000-0000-0000-00000000000' || e.programmateur)::uuid,
       'f1eeb002-0000-0000-0000-000000000003'::uuid,
       'f1eeb006-0000-0000-0000-000000000001'::uuid,
       current_date + 10, 100, 'Alice', '0601020304'
  FROM (VALUES
    -- lieu, programmateur, opérateur, client organisateur
    (1, 2, 2, 4),      -- LVO-1 : T2 programme et opère, GL client organisateur
    (2, 1, 1, NULL),   -- LVO-2 : T1 programme et opère
    (3, 3, 1, NULL),   -- LVO-3 : AG programme, T1 opère
    (4, 3, 1, NULL),   -- LVO-4 : AG programme, T1 opère (lieu désactivé)
    (5, 2, 2, 1),      -- LVO-5 : T2 programme et opère, T1 client organisateur
    (6, 2, 3, NULL),   -- LVO-6 : T2 programme, AG « opère » (anomalie)
    (7, 2, 2, 3),      -- LVO-7 : T2 programme et opère, AG client organisateur
    (8, 4, 2, NULL),   -- LVO-8 : GL programme, T2 opère
    (9, 2, 2, 4)       -- LVO-9 : T2 programme et opère, GL client organisateur
  ) AS e(lieu, programmateur, operateur, client);

-- Une collecte programmée sur l'événement de LVO-1 : un gestionnaire ne lit
-- l'événement d'un tiers tenu sur son lieu que s'il porte une collecte hors
-- brouillon (`evt_gestionnaire_select`). Déclencheurs coupés le temps de
-- l'insertion : seule la ligne compte ici.
SET LOCAL session_replication_role = replica;
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte) VALUES
  ('f1eeb007-0000-0000-0000-000000000001'::uuid, 'f1eeb004-0000-0000-0000-000000000001'::uuid,
   'zero_dechet', 'programmee', current_date + 10, '08:00');
SET LOCAL session_replication_role = origin;

-- Volume : T3 programme 1 100 événements sur 400 lieux distincts. Les 1 099
-- premiers tournent sur les lieux 1 à 399 ; le 1 100e est le SEUL à se tenir au
-- lieu 400 — celui qu'une lecture amputée à 1 000 lignes ne voyait pas.
INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, actif)
SELECT ('f1eeb00c-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       'LVO-V-' || lpad(n::text, 3, '0'), n || ' r', '75010', 'Paris', 'fourgon', true
  FROM generate_series(1, 400) AS n;

INSERT INTO plateforme.evenements (
  organisation_id, traiteur_operationnel_organisation_id, lieu_id,
  entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone)
SELECT 'f1eeb001-0000-0000-0000-000000000005'::uuid,
       'f1eeb001-0000-0000-0000-000000000005'::uuid,
       ('f1eeb00c-0000-0000-0000-'
         || lpad((CASE WHEN n = 1100 THEN 400 ELSE ((n - 1) % 399) + 1 END)::text, 12, '0'))::uuid,
       'f1eeb005-0000-0000-0000-000000000005'::uuid,
       'f1eeb002-0000-0000-0000-000000000003'::uuid,
       'f1eeb006-0000-0000-0000-000000000001'::uuid,
       current_date + 10, 100, 'Alice', '0601020304'
  FROM generate_series(1, 1100) AS n;

-- =============================================================================
-- 1-5. Structure et droits
-- =============================================================================
SELECT has_function(
  'plateforme', 'f_lieux_visibles_organisation', ARRAY['uuid'],
  '1. plateforme.f_lieux_visibles_organisation(uuid) existe'
);

SELECT ok(
  NOT p.prosecdef AND p.provolatile = 's',
  '2. SECURITY INVOKER (droits de l''appelant, aucune RLS contournée) et STABLE'
)
  FROM pg_proc p
 WHERE p.oid = 'plateforme.f_lieux_visibles_organisation(uuid)'::regprocedure;

-- Ensemble EXACT des bénéficiaires (aclexplode) : has_function_privilege seul
-- ne distingue pas un GRANT nominatif d'un GRANT à PUBLIC.
SELECT is(
  (SELECT array_agg(coalesce(r.rolname, 'PUBLIC') ORDER BY coalesce(r.rolname, 'PUBLIC'))
     FROM pg_proc p
     CROSS JOIN LATERAL aclexplode(p.proacl) a
     LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE p.oid = 'plateforme.f_lieux_visibles_organisation(uuid)'::regprocedure
      AND a.privilege_type = 'EXECUTE'),
  ARRAY['postgres', 'service_role']::name[],
  '3. EXECUTE : le propriétaire et service_role seulement (ni PUBLIC, ni anon, ni authenticated)'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'plateforme.f_lieux_visibles_organisation(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'plateforme.f_lieux_visibles_organisation(uuid)', 'EXECUTE'),
  '4. ni authenticated ni anon n''ont le droit d''exécuter la fonction'
);

SELECT ok(
  has_function_privilege('service_role', 'plateforme.f_lieux_visibles_organisation(uuid)', 'EXECUTE'),
  '5. service_role (la route) a le droit d''exécuter la fonction'
);

-- =============================================================================
-- 6-9. Fermeture sous `authenticated` et `anon`
-- =============================================================================
SELECT lvo_jwt('traiteur_manager', 'f1eeb001-0000-0000-0000-000000000001'::uuid);

SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_lieux_visibles_organisation('f1eeb001-0000-0000-0000-000000000001'::uuid) $$,
  '42501', 'permission denied for function f_lieux_visibles_organisation',
  '6. authenticated (traiteur_manager) : refusé, même pour SA PROPRE organisation'
);

SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_lieux_visibles_organisation('f1eeb001-0000-0000-0000-000000000002'::uuid) $$,
  '42501', 'permission denied for function f_lieux_visibles_organisation',
  '7. authenticated (traiteur_manager) : refusé pour l''organisation d''un concurrent'
);

SELECT lvo_jwt('admin_savr', 'f1eeb001-0000-0000-0000-000000000001'::uuid);

SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_lieux_visibles_organisation('f1eeb001-0000-0000-0000-000000000001'::uuid) $$,
  '42501', 'permission denied for function f_lieux_visibles_organisation',
  '8. authenticated (jeton admin_savr) : refusé aussi — seul le serveur appelle la fonction'
);

SELECT lvo_superuser();
SELECT set_config('role', 'anon', true);

SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_lieux_visibles_organisation('f1eeb001-0000-0000-0000-000000000001'::uuid) $$,
  '42501', 'permission denied for function f_lieux_visibles_organisation',
  '9. anon (visiteur sans compte) : refusé'
);

-- =============================================================================
-- 10-17. Contenu, sous l'identité de la route (service_role)
-- =============================================================================
SELECT lvo_superuser();
SELECT lvo_service();

SELECT is(
  lvo_fonction('f1eeb001-0000-0000-0000-000000000001'::uuid),
  'LVO-2,LVO-3,LVO-4',
  '10. traiteur T1 : le lieu de son événement (branche 2) et ceux des événements qu''il opère (branche 4), lieu désactivé compris — pas ceux du concurrent, pas même LVO-5 dont il n''est que client organisateur'
);

SELECT is(
  lvo_fonction('f1eeb001-0000-0000-0000-000000000002'::uuid),
  'LVO-1,LVO-5,LVO-6,LVO-7,LVO-8,LVO-9',
  '11. traiteur T2 : ses événements (branche 2) et celui qu''il opère pour le gestionnaire (branche 4) — aucun lieu de T1'
);

SELECT is(
  lvo_fonction('f1eeb001-0000-0000-0000-000000000003'::uuid),
  'LVO-3,LVO-4',
  '12. agence AG : les lieux des événements qu''elle a programmés seulement — ni LVO-6 (branche 4 réservée au type traiteur) ni LVO-7 (branche 3 non transcrite)'
);

-- Non-vacuité des négatifs de 10, 12 et 14 : les événements écartés existent.
SELECT lvo_superuser();
SELECT is(
  (SELECT string_agg(l.nom, ',' ORDER BY l.nom)
     FROM plateforme.evenements e
     JOIN plateforme.lieux l ON l.id = e.lieu_id
    WHERE e.traiteur_operationnel_organisation_id = 'f1eeb001-0000-0000-0000-000000000003'::uuid
       OR (e.date_evenement IS NOT NULL
           AND e.client_organisateur_organisation_id IN (
                 'f1eeb001-0000-0000-0000-000000000001'::uuid,
                 'f1eeb001-0000-0000-0000-000000000003'::uuid,
                 'f1eeb001-0000-0000-0000-000000000004'::uuid))),
  'LVO-1,LVO-5,LVO-6,LVO-7,LVO-9',
  '13. NON-VACUITÉ : l''événement « opéré » par l''agence (LVO-6) et les quatre événements datés dont T1, AG ou GL sont client organisateur (LVO-5, LVO-7, LVO-1, LVO-9) existent'
);
SELECT lvo_service();

SELECT is(
  lvo_fonction('f1eeb001-0000-0000-0000-000000000004'::uuid),
  'LVO-1,LVO-8',
  '14. gestionnaire GL : son lieu rattaché (branche 1) et le lieu de l''événement qu''il a programmé (branche 2) — pas LVO-9, dont il n''est que client organisateur'
);

SELECT is(
  (SELECT count(*)::int
     FROM plateforme.f_lieux_visibles_organisation('f1eeb001-0000-0000-0000-000000000001'::uuid)
    WHERE nom = 'LVO-4' AND actif = false),
  1,
  '15. le lieu désactivé est rendu avec actif = false : c''est la route qui l''écarte, sur ses deux chemins'
);

SELECT is(
  lvo_fonction('f1eeb001-0000-0000-0000-0000000000ff'::uuid),
  '',
  '16. organisation inconnue : aucun lieu'
);

SELECT is(
  lvo_fonction(NULL),
  '',
  '17. organisation NULL : aucun lieu'
);

-- =============================================================================
-- 18-23. Égalité avec la policy : la fonction rend, pour une organisation, ce
-- que lit un utilisateur de cette organisation sous `authenticated`
-- =============================================================================
-- Les ensembles de la fonction sont pris sous service_role, puis comparés à la
-- lecture sous RLS. Ils sont épinglés à leur valeur exacte par 10, 11, 12 et 14.
SELECT set_config('lvo.t1', lvo_fonction('f1eeb001-0000-0000-0000-000000000001'::uuid), true);
SELECT set_config('lvo.t2', lvo_fonction('f1eeb001-0000-0000-0000-000000000002'::uuid), true);
SELECT set_config('lvo.ag', lvo_fonction('f1eeb001-0000-0000-0000-000000000003'::uuid), true);
SELECT set_config('lvo.gl', lvo_fonction('f1eeb001-0000-0000-0000-000000000004'::uuid), true);

SELECT lvo_superuser();
SELECT lvo_jwt('traiteur_manager', 'f1eeb001-0000-0000-0000-000000000001'::uuid);
SELECT is(lvo_rls(), current_setting('lvo.t1'),
  '18. traiteur_manager de T1 : lit sous RLS exactement ce que rend la fonction');

SELECT lvo_jwt('traiteur_commercial', 'f1eeb001-0000-0000-0000-000000000001'::uuid);
SELECT is(lvo_rls(), current_setting('lvo.t1'),
  '19. traiteur_commercial de T1 : idem');

SELECT lvo_jwt('traiteur_manager', 'f1eeb001-0000-0000-0000-000000000002'::uuid);
SELECT is(lvo_rls(), current_setting('lvo.t2'),
  '20. traiteur_manager de T2 : idem');

SELECT lvo_jwt('agence', 'f1eeb001-0000-0000-0000-000000000003'::uuid);
SELECT is(lvo_rls(), current_setting('lvo.ag'),
  '21. agence AG : idem — la branche 4 (rôle) et la branche 3 (RLS des événements) ne lui donnent rien de plus');

SELECT lvo_jwt('gestionnaire_lieux', 'f1eeb001-0000-0000-0000-000000000004'::uuid);
SELECT is(lvo_rls(), current_setting('lvo.gl'),
  '22. gestionnaire_lieux GL : idem — la branche 3 ne lui donne rien de plus');

-- Le 22 n'est pas une égalité à vide de ce côté : sous la session de GL, la
-- branche 3 atteint bien un événement (celui de LVO-1, lieu qui lui est déjà
-- rattaché) et pas l'autre (LVO-9, non rattaché). Atteinte, donc, et redondante.
SELECT is(
  (SELECT string_agg(l.nom, ',' ORDER BY l.nom)
     FROM plateforme.evenements e
     JOIN plateforme.v_lieux_clients l ON l.id = e.lieu_id
    WHERE e.client_organisateur_organisation_id = 'f1eeb001-0000-0000-0000-000000000004'::uuid
      AND e.date_evenement IS NOT NULL),
  'LVO-1',
  '23. NON-VACUITÉ : sous la session du gestionnaire, la branche 3 atteint l''événement de son lieu rattaché (LVO-1) — elle est redondante, pas vide'
);

-- =============================================================================
-- 24-26. Volume : au-delà de 1 000 événements et de 390 lieux distincts
-- =============================================================================
SELECT lvo_superuser();
SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements
    WHERE organisation_id = 'f1eeb001-0000-0000-0000-000000000005'::uuid),
  1100,
  '24. NON-VACUITÉ : T3 porte 1 100 événements'
);

SELECT lvo_service();
SELECT is(
  (SELECT count(*)::int || ' lignes, ' || count(DISTINCT id)::int || ' lieux distincts'
     FROM plateforme.f_lieux_visibles_organisation('f1eeb001-0000-0000-0000-000000000005'::uuid)),
  '400 lignes, 400 lieux distincts',
  '25. T3 : ses 400 lieux sont rendus en un appel, sans doublon'
);

SELECT is(
  (SELECT count(*)::int
     FROM plateforme.f_lieux_visibles_organisation('f1eeb001-0000-0000-0000-000000000005'::uuid)
    WHERE nom = 'LVO-V-400'),
  1,
  '26. T3 : le lieu du seul 1 100e événement est rendu'
);

SELECT lvo_superuser();
SELECT * FROM finish();
ROLLBACK;

-- pgTAP — Jusqu'à 3 adresses de livraison par lieu (20261119150000, Val 2026-11-19)
--
-- Prouve, sur base réelle :
--   A. ce qui est OUVERT : les 13 colonnes sont lisibles par `authenticated`
--      (privilège colonne + vue `v_lieux_clients`), et un gestionnaire rattaché
--      lit les adresses n° 2 et n° 3 de SON lieu ;
--   B. ce qui reste FERMÉ : la ligne d'un lieu hors périmètre reste invisible
--      (policy `lieux_clients_select` inchangée), aucune écriture cliente,
--      les colonnes admin-only restent hors de la vue ;
--   C. les contraintes : emplacement vide ou complet, pas de n° 3 sans n° 2,
--      bornes de longueur alignées sur `validerLieuOverrides` ;
--   D. aucun ordre E5 sur une modification des adresses n° 2 / n° 3.

BEGIN;
SELECT plan(19);

CREATE OR REPLACE FUNCTION ald_jwt(p_role text, p_org uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'user_role', p_role,
    'organisation_id', p_org, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION ald_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

SELECT ald_superuser();

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
  ('ad000000-0000-0000-0000-00000000000a'::uuid, 'GL adresses', 'GL adresses SA', 'gestionnaire_lieux', '93300000000001', true),
  ('ad000000-0000-0000-0000-00000000000b'::uuid, 'GL autre',    'GL autre SA',    'gestionnaire_lieux', '93300000000002', true);

INSERT INTO plateforme.lieux
  (id, nom, adresse_acces, code_postal, ville, type_vehicule_max,
   libelle_adresse_1,
   libelle_adresse_2, adresse_acces_2, code_postal_2, ville_2,
   libelle_adresse_3, adresse_acces_3, code_postal_3, ville_3)
VALUES
  ('ad000000-0000-0000-0000-000000000b01'::uuid, 'Carrousel test', '99 rue de Rivoli', '75001', 'Paris', 'fourgon',
   'Entrée public',
   'Livraison', '1 avenue du General Lemonnier', '75001', 'Paris',
   'Quai', '2 quai test', '75001', 'Paris'),
  ('ad000000-0000-0000-0000-000000000b02'::uuid, 'Lieu autre GL', '3 rue autre', '75002', 'Paris', 'fourgon',
   NULL,
   NULL, '4 rue cachee', '75002', 'Paris',
   NULL, NULL, NULL, NULL);

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id) VALUES
  ('ad000000-0000-0000-0000-00000000000a'::uuid, 'ad000000-0000-0000-0000-000000000b01'::uuid),
  ('ad000000-0000-0000-0000-00000000000b'::uuid, 'ad000000-0000-0000-0000-000000000b02'::uuid);

-- ── A. Ouvert ────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT bool_and(has_column_privilege('authenticated', 'plateforme.lieux', c, 'SELECT'))
     FROM unnest(ARRAY[
       'libelle_adresse_1',
       'libelle_adresse_2','adresse_acces_2','code_postal_2','ville_2','latitude_2','longitude_2',
       'libelle_adresse_3','adresse_acces_3','code_postal_3','ville_3','latitude_3','longitude_3'
     ]) AS c),
  'A1 authenticated lit les 13 colonnes d''adresses de livraison'
);

SELECT ald_jwt('gestionnaire_lieux', 'ad000000-0000-0000-0000-00000000000a'::uuid);

SELECT is(
  (SELECT adresse_acces_2 FROM plateforme.v_lieux_clients
    WHERE id = 'ad000000-0000-0000-0000-000000000b01'::uuid),
  '1 avenue du General Lemonnier',
  'A2 le gestionnaire rattaché lit l''adresse n° 2 de son lieu par v_lieux_clients'
);
SELECT is(
  (SELECT libelle_adresse_3 || ' / ' || ville_3 FROM plateforme.v_lieux_clients
    WHERE id = 'ad000000-0000-0000-0000-000000000b01'::uuid),
  'Quai / Paris',
  'A3 le gestionnaire rattaché lit l''adresse n° 3 de son lieu'
);
SELECT is(
  (SELECT libelle_adresse_1 FROM plateforme.lieux
    WHERE id = 'ad000000-0000-0000-0000-000000000b01'::uuid),
  'Entrée public',
  'A4 lecture directe de la table : libellé n° 1 lisible sous la liste blanche'
);

-- ── B. Fermé ─────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM plateforme.v_lieux_clients
    WHERE id = 'ad000000-0000-0000-0000-000000000b02'::uuid),
  0,
  'B1 le lieu d''un autre gestionnaire reste invisible (ses adresses avec)'
);
SELECT throws_ok(
  $$ UPDATE plateforme.lieux SET adresse_acces_2 = '5 rue pirate', code_postal_2 = '75001', ville_2 = 'Paris'
      WHERE id = 'ad000000-0000-0000-0000-000000000b01'::uuid $$,
  '42501', NULL,
  'B2 un client ne peut pas écrire une adresse de livraison'
);
SELECT throws_ok(
  $$ SELECT siren FROM plateforme.v_lieux_clients LIMIT 1 $$,
  '42703', NULL,
  'B3 la vue n''expose toujours pas les colonnes admin-only (siren)'
);
SELECT throws_ok(
  $$ SELECT code_site_viparis FROM plateforme.v_lieux_clients LIMIT 1 $$,
  '42703', NULL,
  'B4 la vue n''expose pas code_site_viparis'
);

SELECT ald_superuser();

SELECT ok(
  NOT has_column_privilege('authenticated', 'plateforme.lieux', 'adresse_acces_2', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'plateforme.lieux', 'adresse_acces_2', 'INSERT'),
  'B5 aucun privilège d''écriture colonne sur les adresses de livraison'
);
SELECT ok(
  (SELECT 'security_invoker=true' = ANY(reloptions) FROM pg_class
    WHERE oid = 'plateforme.v_lieux_clients'::regclass),
  'B6 v_lieux_clients reste security_invoker'
);

-- ── C. Contraintes ───────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ UPDATE plateforme.lieux SET adresse_acces_2 = '1 rue seule', code_postal_2 = NULL, ville_2 = NULL,
       libelle_adresse_3 = NULL, adresse_acces_3 = NULL, code_postal_3 = NULL, ville_3 = NULL
      WHERE id = 'ad000000-0000-0000-0000-000000000b01'::uuid $$,
  '23514', NULL,
  'C1 emplacement incomplet (sans code postal ni ville) refusé'
);
SELECT throws_ok(
  $$ UPDATE plateforme.lieux SET ville_2 = '   '
      WHERE id = 'ad000000-0000-0000-0000-000000000b01'::uuid $$,
  '23514', NULL,
  'C2 ville blanche refusée'
);
SELECT throws_ok(
  $$ UPDATE plateforme.lieux SET libelle_adresse_2 = NULL, adresse_acces_2 = NULL, code_postal_2 = NULL, ville_2 = NULL
      WHERE id = 'ad000000-0000-0000-0000-000000000b01'::uuid $$,
  '23514', NULL,
  'C3 adresse n° 3 sans adresse n° 2 refusée'
);
SELECT throws_ok(
  $$ UPDATE plateforme.lieux SET adresse_acces_2 = repeat('a', 201)
      WHERE id = 'ad000000-0000-0000-0000-000000000b01'::uuid $$,
  '23514', NULL,
  'C4 adresse de plus de 200 caractères refusée'
);
SELECT throws_ok(
  $$ UPDATE plateforme.lieux SET latitude_3 = NULL, libelle_adresse_3 = NULL, adresse_acces_3 = NULL,
       code_postal_3 = NULL, ville_3 = NULL, longitude_3 = 2.3
      WHERE id = 'ad000000-0000-0000-0000-000000000b01'::uuid $$,
  '23514', NULL,
  'C5 coordonnées sans adresse refusées'
);
SELECT throws_ok(
  $$ UPDATE plateforme.lieux SET libelle_adresse_1 = repeat('l', 61)
      WHERE id = 'ad000000-0000-0000-0000-000000000b01'::uuid $$,
  '23514', NULL,
  'C6 libellé de plus de 60 caractères refusé'
);
SELECT lives_ok(
  $$ UPDATE plateforme.lieux SET libelle_adresse_3 = NULL, adresse_acces_3 = NULL, code_postal_3 = NULL, ville_3 = NULL
      WHERE id = 'ad000000-0000-0000-0000-000000000b01'::uuid $$,
  'C7 retirer l''adresse n° 3 (emplacement vidé entièrement) est accepté'
);

-- ── D. Aucun ordre E5 ────────────────────────────────────────────────────────
UPDATE plateforme.lieux
   SET adresse_acces_2 = '10 avenue nouvelle', latitude_2 = 48.86, longitude_2 = 2.33,
       adresse_acces_3 = '11 quai nouveau', code_postal_3 = '75001', ville_3 = 'Paris',
       libelle_adresse_1 = 'Public'
 WHERE id = 'ad000000-0000-0000-0000-000000000b01'::uuid;

SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
    WHERE aggregate_id = 'ad000000-0000-0000-0000-000000000b01'::uuid
      AND event_type = 'lieu.champ_critique_modifie'),
  0,
  'D1 modifier les adresses n° 2 / n° 3 (et le libellé n° 1) n''émet aucun E5'
);

UPDATE plateforme.lieux SET adresse_acces = '100 rue de Rivoli'
 WHERE id = 'ad000000-0000-0000-0000-000000000b01'::uuid;
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
    WHERE aggregate_id = 'ad000000-0000-0000-0000-000000000b01'::uuid
      AND event_type = 'lieu.champ_critique_modifie'),
  1,
  'D2 témoin : modifier l''adresse n° 1 émet toujours un E5'
);

SELECT * FROM finish();
ROLLBACK;

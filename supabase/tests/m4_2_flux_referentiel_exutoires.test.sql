-- pgTAP M4.2 — Référentiel des flux ZD lu par l'export du registre (§06.03) :
-- exutoire final, code déchet, code de traitement, filière (migration
-- 20261004203000). L'export sort une ligne par flux et tire trois colonnes de
-- l'adresse de l'exutoire : elle doit suivre « voie, code postal ville »
-- (lib/registre/csv.ts, decouperAdresse). Le CSV est produit sous le JWT de
-- l'utilisateur : la colonne ajoutée doit rester lisible par un rôle client.

BEGIN;
SELECT plan(4);

SELECT is(
  (SELECT count(*)::int FROM plateforme.flux_dechets
    WHERE actif
      AND (code_dechet_europeen IS NULL OR code_traitement IS NULL
           OR exutoire IS NULL OR exutoire_adresse IS NULL)),
  0,
  'flux_referentiel_complet — chaque flux actif porte code déchet, code de traitement, exutoire et adresse');

SELECT is(
  (SELECT count(*)::int FROM plateforme.flux_dechets
    WHERE actif AND exutoire_adresse !~ '^.+, [0-9]{5} [^0-9]+$'),
  0,
  'flux_referentiel_adresse_decoupable — adresse au format « voie, code postal ville »');

SELECT results_eq(
  $$SELECT code, code_dechet_europeen, code_traitement, filiere_valorisation::text
      FROM plateforme.flux_dechets WHERE actif ORDER BY code$$,
  $$VALUES
      ('biodechet',       '20 01 08', 'R3',    'methanisation'),
      ('carton',          '15 01 01', 'R3',    'recyclage'),
      ('dechet_residuel', '20 03 01', 'R1',    'valorisation_energetique'),
      ('emballage',       '15 01 06', 'R3/R5', 'recyclage'),
      ('verre',           '15 01 07', 'R5',    'recyclage')$$,
  'flux_referentiel_codes — codes déchets, codes de traitement et filières des 5 flux');

-- Lecture sous un rôle client (gestionnaire de lieux), comme la route d'export.
-- Le claim `role` est celui d'un vrai jeton : la policy fd_read lit auth.role().
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', gen_random_uuid(), 'role', 'authenticated', 'user_role', 'gestionnaire_lieux',
  'organisation_id', gen_random_uuid(), 'app_domain', 'plateforme')::text, true);
SELECT set_config('role', 'authenticated', true);

SELECT is(
  (SELECT count(*)::int FROM plateforme.flux_dechets
    WHERE actif AND code_traitement IS NOT NULL AND exutoire IS NOT NULL),
  5,
  'flux_referentiel_lisible_client — code de traitement et exutoire lisibles sous JWT client');

SELECT set_config('role', 'postgres', true);
SELECT set_config('request.jwt.claims', NULL, true);

SELECT * FROM finish();
ROLLBACK;

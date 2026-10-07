-- pgTAP M4.2 — Référentiel des flux ZD lu par l'export du registre (§06.03) :
-- exutoire final, code déchet, code de traitement, filière (migration
-- 20261004203000). L'export sort une ligne par flux et tire trois colonnes de
-- l'adresse de l'exutoire : elle doit suivre « voie, code postal ville »
-- (lib/registre/csv.ts, decouperAdresse). Le CSV est produit sous le JWT de
-- l'utilisateur : la colonne ajoutée doit rester lisible par un rôle client.
-- Unité de mesure : les 5 flux V1 sont en kg (§04 « Valeurs initiales ») — le
-- seed bloc8 avait posé les Emballages en 'bac' (migration 20261006130000).

BEGIN;
SELECT plan(4);

SELECT is(
  (SELECT count(*)::int FROM plateforme.flux_dechets
    WHERE actif
      AND (exutoire_adresse IS NULL
           OR exutoire_adresse !~ '^.+, [0-9]{5} [^0-9]+$')),
  0,
  'flux_referentiel_adresse_decoupable — adresse au format « voie, code postal ville »');

SELECT results_eq(
  $$SELECT code, code_dechet_europeen, code_traitement, filiere_valorisation::text,
           exutoire, exutoire_adresse
      FROM plateforme.flux_dechets WHERE actif ORDER BY code$$,
  $$VALUES
      ('biodechet', '20 01 08', 'R3', 'methanisation',
       'GENERIS VSG DCDT',
       'ZI des Graviers, 6 avenue Winston Churchill, 94190 Villeneuve-Saint-Georges'),
      ('carton', '15 01 01', 'R3', 'recyclage',
       'TAIS VILLENEUVE LE ROI TDI',
       '6 rue des Vœux Saint-Georges, 94290 Villeneuve-le-Roi'),
      ('dechet_residuel', '20 03 01', 'R1', 'valorisation_energetique',
       'NOVAZUR ARGENTEUIL UVEND',
       '2 rue du Chemin Vert, 95100 Argenteuil'),
      ('emballage', '15 01 06', 'R3/R5', 'recyclage',
       'CENTRE DE TRI SELECTIF PAPREC TRIVALO 93',
       '10 rue de la Victoire, 93150 Le Blanc-Mesnil'),
      ('verre', '15 01 07', 'R5', 'recyclage',
       'REVIVAL GENNEVILLIERS TRSFT',
       '9 route du Môle Central, 92230 Gennevilliers')$$,
  'flux_referentiel_codes — codes, filières, exutoires et adresses des 5 flux');

SELECT results_eq(
  $$SELECT code, unite_mesure::text FROM plateforme.flux_dechets WHERE actif ORDER BY code$$,
  $$VALUES ('biodechet', 'kg'), ('carton', 'kg'), ('dechet_residuel', 'kg'),
           ('emballage', 'kg'), ('verre', 'kg')$$,
  'flux_referentiel_unite_kg — les 5 flux V1 sont mesurés en kg');

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

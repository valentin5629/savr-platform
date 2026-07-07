-- pgTAP M1.6 (R21a) — Fonctions du bloc benchmark rapport RSE §12 §1.2.
--   f_rapport_benchmark_zd        : wrapper grain collecte (5 jauges kg/pax + point rouge)
--   f_taux_recyclage_moyen_parc   : moyenne Savr anonymisée (≥3 acteurs)
-- Existence + signatures + privilèges (service_role only, PAS authenticated/anon =
-- aucune surface d'appel client, pas de fuite inter-org) + exécution sans erreur.
-- NB : le chemin RETURN QUERY complet (LATERAL vers f_benchmark_kg_pax_zd → 5 jauges)
-- est validé hors CI contre des données réelles (savr local) ; ici la DB migrée est
-- non seedée → f_rapport_benchmark_zd(inconnue) exerce le lookup + le NOT FOUND.

BEGIN;
SELECT plan(9);

-- ── 1. Existence + signatures ─────────────────────────────────────────────
SELECT has_function(
  'plateforme', 'f_rapport_benchmark_zd',
  ARRAY['uuid','date','date','uuid[]','uuid[]','text[]'],
  'f_rapport_benchmark_zd(uuid, date, date, uuid[], uuid[], text[]) existe'
);
SELECT has_function(
  'plateforme', 'f_taux_recyclage_moyen_parc',
  ARRAY['date','date','integer'],
  'f_taux_recyclage_moyen_parc(date, date, integer) existe'
);

-- ── 2. Privilèges : service_role EXECUTE, PAS authenticated ni anon ────────
SELECT ok(
  has_function_privilege('service_role',
    'plateforme.f_rapport_benchmark_zd(uuid,date,date,uuid[],uuid[],text[])','EXECUTE'),
  'service_role peut exécuter f_rapport_benchmark_zd'
);
SELECT ok(
  NOT has_function_privilege('authenticated',
    'plateforme.f_rapport_benchmark_zd(uuid,date,date,uuid[],uuid[],text[])','EXECUTE'),
  'authenticated ne peut PAS exécuter f_rapport_benchmark_zd (pas de surface client)'
);
SELECT ok(
  NOT has_function_privilege('anon',
    'plateforme.f_rapport_benchmark_zd(uuid,date,date,uuid[],uuid[],text[])','EXECUTE'),
  'anon ne peut PAS exécuter f_rapport_benchmark_zd'
);
SELECT ok(
  has_function_privilege('service_role',
    'plateforme.f_taux_recyclage_moyen_parc(date,date,integer)','EXECUTE'),
  'service_role peut exécuter f_taux_recyclage_moyen_parc'
);
SELECT ok(
  NOT has_function_privilege('authenticated',
    'plateforme.f_taux_recyclage_moyen_parc(date,date,integer)','EXECUTE'),
  'authenticated ne peut PAS exécuter f_taux_recyclage_moyen_parc'
);

-- ── 3. Exécution sans erreur (colonnes/types du corps validés au runtime) ──
SELECT is(
  (SELECT count(*)::int FROM plateforme.f_rapport_benchmark_zd(
     '00000000-0000-0000-0000-000000000000'::uuid)),
  0,
  'f_rapport_benchmark_zd(collecte inconnue) → 0 jauge (NOT FOUND)'
);
SELECT lives_ok(
  $$ SELECT * FROM plateforme.f_taux_recyclage_moyen_parc() $$,
  'f_taux_recyclage_moyen_parc s''exécute (agrégat parc, gate anonymat)'
);

SELECT * FROM finish();
ROLLBACK;

-- =============================================================================
-- Tests pgTAP — fuseau métier unique : rpc_creer_grille_zd
-- =============================================================================
-- Oracle : la date de prise d'effet par défaut d'une grille ZD est le jour à
-- PARIS, quel que soit le fuseau de la SESSION Postgres (UTC sur Supabase).
--
-- On ne peut pas figer `now()` en pgTAP ; on prouve donc la propriété visée —
-- l'indépendance au fuseau de session — en appelant la RPC depuis deux fuseaux
-- extrêmes (26h d'écart : à tout instant, au moins l'un des deux est un jour
-- différent de Paris). Avec l'ancien `current_date`, les deux appels rendaient
-- des jours différents et ce test tombait.
--
-- Cliquet ACL en prime : la RPC est SECURITY DEFINER et écrit les grilles
-- tarifaires — elle ne doit JAMAIS être exécutable par anon/authenticated.
-- =============================================================================

BEGIN;
SELECT plan(5);

SELECT has_function(
  'plateforme', 'rpc_creer_grille_zd',
  'rpc_creer_grille_zd présente');

-- Extrême est (UTC+14) : le jour y est en avance sur Paris une partie de la journée.
SET LOCAL TimeZone = 'Etc/GMT-14';
SELECT lives_ok(
  $$ SELECT plateforme.rpc_creer_grille_zd(
       'Grille Fuseau Est', 'paliers'::plateforme.mode_grille_zd, false, NULL,
       jsonb_build_array(jsonb_build_object(
         'pax_min', 1, 'pax_max', 250,
         'prix_base_ht', 450, 'prix_par_couvert_ht', 0)),
       'test fuseau') $$,
  'création depuis une session en UTC+14 : pas d''erreur');

-- Extrême ouest (UTC-12) : le jour y est en retard sur Paris une partie de la journée.
SET LOCAL TimeZone = 'Etc/GMT+12';
SELECT lives_ok(
  $$ SELECT plateforme.rpc_creer_grille_zd(
       'Grille Fuseau Ouest', 'paliers'::plateforme.mode_grille_zd, false, NULL,
       jsonb_build_array(jsonb_build_object(
         'pax_min', 1, 'pax_max', 250,
         'prix_base_ht', 450, 'prix_par_couvert_ht', 0)),
       'test fuseau') $$,
  'création depuis une session en UTC-12 : pas d''erreur');

-- Le cœur du test : même jour de prise d'effet des deux côtés…
SELECT is(
  (SELECT valide_du FROM plateforme.grilles_tarifaires_zd WHERE nom = 'Grille Fuseau Est'),
  (SELECT valide_du FROM plateforme.grilles_tarifaires_zd WHERE nom = 'Grille Fuseau Ouest'),
  'valide_du identique quel que soit le fuseau de session (UTC+14 vs UTC-12)');

-- …et ce jour est bien celui de Paris.
SELECT is(
  (SELECT valide_du FROM plateforme.grilles_tarifaires_zd WHERE nom = 'Grille Fuseau Est'),
  (now() AT TIME ZONE 'Europe/Paris')::date,
  'valide_du = jour courant à Paris (fuseau métier), jamais le jour UTC');

SELECT * FROM finish();
ROLLBACK;

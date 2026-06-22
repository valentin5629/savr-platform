-- pgTAP — Convergence G1 cluster B.1 (migration 20260623120000)
-- Verrouille la convergence VALEURS de pack_statut_enum vers le cible pack_statut :
--   • colonne au type cible, ancien type supprimé, 'expire' retiré (mapping -> epuise)
--   • index partiel uniq_pack_actif_par_org reconstruit
--   • PIÈGE corps PL/pgSQL : aucun corps de fonction ne référence encore pack_statut_enum
--   • les 4 fonctions pack conservent leur signature

BEGIN;
SELECT plan(13);

-- ── 1. Colonne au type cible ────────────────────────────────────────────────
SELECT col_type_is('plateforme', 'packs_antgaspi', 'statut', 'plateforme.pack_statut',
  'packs_antgaspi.statut convergé en plateforme.pack_statut');

-- ── 2. Ancien type supprimé, nouveau type avec EXACTEMENT les valeurs cible ──
SELECT hasnt_type('plateforme', 'pack_statut_enum', 'type pack_statut_enum supprimé');
SELECT has_type('plateforme', 'pack_statut', 'type pack_statut présent');
SELECT enum_has_labels('plateforme', 'pack_statut', ARRAY['actif', 'epuise', 'annule'],
  'pack_statut = exactement (actif, epuise, annule) — expire retiré');

-- ── 3. Valeur retirée rejetée / valeur cible acceptée (au niveau du type) ────
SELECT throws_ok(
  $$ SELECT 'expire'::plateforme.pack_statut $$, '22P02', NULL,
  'expire n''est plus une valeur valide de pack_statut');
SELECT lives_ok(
  $$ SELECT 'epuise'::plateforme.pack_statut $$,
  'epuise reste une valeur valide de pack_statut');

-- ── 4. DEFAULT conservé + index partiel reconstruit ─────────────────────────
SELECT col_default_is('plateforme', 'packs_antgaspi', 'statut', 'actif',
  'DEFAULT actif conservé');
SELECT has_index('plateforme', 'packs_antgaspi', 'uniq_pack_actif_par_org',
  'uniq_pack_actif_par_org reconstruit');

-- ── 5. PIÈGE corps PL/pgSQL : 0 fonction ne référence encore l'ancien type ──
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'plateforme' AND p.prosrc ~ 'pack_statut_enum'),
  0,
  'aucun corps de fonction ne référence encore pack_statut_enum');

-- ── 6. Les 4 fonctions pack conservent leur signature (recréées, non cassées) ─
SELECT has_function('plateforme', 'fn_trg_pack_debit_realisee', ARRAY[]::text[],
  'fn_trg_pack_debit_realisee présente');
SELECT has_function('plateforme', 'fn_trg_pack_debit_annulation_tardive', ARRAY[]::text[],
  'fn_trg_pack_debit_annulation_tardive présente');
SELECT has_function('plateforme', 'fn_trg_pack_recredit', ARRAY[]::text[],
  'fn_trg_pack_recredit présente');
SELECT has_function('plateforme', 'rpc_annuler_credit_collecte', ARRAY['uuid', 'text'],
  'rpc_annuler_credit_collecte(uuid, text) présente');

SELECT * FROM finish();
ROLLBACK;

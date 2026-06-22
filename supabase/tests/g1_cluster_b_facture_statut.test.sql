-- pgTAP — Convergence G1 cluster B.2 (migration 20260623130000)
-- Verrouille la convergence VALEURS de facture_statut_enum vers le cible facture_statut :
--   • colonne au type cible, ancien type supprimé, 'envoyee'/'en_retard' retirés (mapping -> emise)
--   • 3 index partiels + 2 vues reconstruits
--   • v_ops_factures_bloquees migrée sur en_attente_pennylane (intention préservée, plus 'envoyee')
--   • PIÈGE corps PL/pgSQL : aucun corps ne référence encore facture_statut_enum

BEGIN;
SELECT plan(15);

-- ── 1. Colonne au type cible ────────────────────────────────────────────────
SELECT col_type_is('plateforme', 'factures', 'statut', 'plateforme.facture_statut',
  'factures.statut convergé en plateforme.facture_statut');

-- ── 2. Ancien type supprimé, nouveau type avec EXACTEMENT les valeurs cible ──
SELECT hasnt_type('plateforme', 'facture_statut_enum', 'type facture_statut_enum supprimé');
SELECT enum_has_labels('plateforme', 'facture_statut',
  ARRAY['brouillon', 'en_attente_pennylane', 'emise', 'payee', 'annulee'],
  'facture_statut = exactement les 5 valeurs cible — envoyee/en_retard retirés');

-- ── 3. Valeurs retirées rejetées / valeur cible acceptée ────────────────────
SELECT throws_ok($$ SELECT 'envoyee'::plateforme.facture_statut $$, '22P02', NULL,
  'envoyee n''est plus une valeur valide de facture_statut');
SELECT throws_ok($$ SELECT 'en_retard'::plateforme.facture_statut $$, '22P02', NULL,
  'en_retard n''est plus une valeur valide de facture_statut');
SELECT lives_ok($$ SELECT 'emise'::plateforme.facture_statut $$,
  'emise reste une valeur valide de facture_statut');

-- ── 4. DEFAULT conservé + 3 index partiels reconstruits ─────────────────────
SELECT col_default_is('plateforme', 'factures', 'statut', 'brouillon',
  'DEFAULT brouillon conservé');
SELECT has_index('plateforme', 'factures', 'idx_factures_emises_polling',
  'idx_factures_emises_polling reconstruit');
SELECT has_index('plateforme', 'factures', 'idx_factures_attente_pennylane',
  'idx_factures_attente_pennylane reconstruit');
SELECT has_index('plateforme', 'factures', 'idx_factures_statut_date_emission',
  'idx_factures_statut_date_emission reconstruit');

-- ── 5. 2 vues reconstruites ; v_ops_factures_bloquees ne référence plus 'envoyee' ─
SELECT has_view('plateforme', 'v_factures_client', 'v_factures_client reconstruite');
SELECT has_view('plateforme', 'v_kpi_admin', 'v_kpi_admin reconstruite');
SELECT has_view('plateforme', 'v_kpi_traiteur', 'v_kpi_traiteur reconstruite');
SELECT matches(
  pg_get_viewdef('plateforme.v_ops_factures_bloquees'::regclass),
  'en_attente_pennylane',
  'v_ops_factures_bloquees migrée sur en_attente_pennylane (plus de envoyee)');

-- ── 6. PIÈGE corps PL/pgSQL : 0 fonction ne référence encore l'ancien type ──
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'plateforme' AND p.prosrc ~ 'facture_statut_enum'),
  0,
  'aucun corps de fonction ne référence encore facture_statut_enum');

SELECT * FROM finish();
ROLLBACK;

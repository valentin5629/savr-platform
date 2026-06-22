-- pgTAP — Convergence G1 cluster C (migration 20260623150000)
-- Verrouille la convergence du NOM du type document_statut_enum → document_general_statut :
--   • colonne documents_generaux_savr.statut au type cible, ancien type supprimé
--   • valeurs INCHANGÉES (rename pur, aucun retrait de valeur)
--   • DEFAULT conservé + index + RLS dg_read intacts (suivent par OID)
--   • PIÈGE corps PL/pgSQL : aucun corps de fonction ne référence encore document_statut_enum

BEGIN;
SELECT plan(10);

-- ── 1. Colonne au type cible ────────────────────────────────────────────────
SELECT col_type_is('plateforme', 'documents_generaux_savr', 'statut',
  'plateforme.document_general_statut',
  'documents_generaux_savr.statut convergé en plateforme.document_general_statut');

-- ── 2. Ancien type supprimé, nouveau type présent ───────────────────────────
SELECT hasnt_type('plateforme', 'document_statut_enum', 'type document_statut_enum supprimé');
SELECT has_type('plateforme', 'document_general_statut', 'type document_general_statut présent');

-- ── 3. Valeurs INCHANGÉES (rename pur — les 4 valeurs V1 sont préservées) ────
SELECT enum_has_labels('plateforme', 'document_general_statut',
  ARRAY['en_attente', 'genere', 'erreur', 'expire'],
  'document_general_statut conserve exactement (en_attente, genere, erreur, expire)');
SELECT lives_ok(
  $$ SELECT 'genere'::plateforme.document_general_statut $$,
  'genere reste une valeur valide (lue par RLS dg_read et f_fichier_visible)');

-- ── 4. DEFAULT conservé + index sur statut intact ───────────────────────────
SELECT col_default_is('plateforme', 'documents_generaux_savr', 'statut', 'en_attente',
  'DEFAULT en_attente conservé');
SELECT has_index('plateforme', 'documents_generaux_savr', 'idx_docs_generaux_statut',
  'idx_docs_generaux_statut intact');

-- ── 5. RLS dg_read toujours présente (qual suit par OID) ────────────────────
SELECT policy_cmd_is('plateforme', 'documents_generaux_savr', 'dg_read', 'SELECT',
  'policy dg_read (lecture des documents generes) intacte');

-- ── 6. PIÈGE corps PL/pgSQL : 0 fonction ne référence encore l'ancien nom ────
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('plateforme', 'shared') AND p.prosrc ~ 'document_statut_enum'),
  0,
  'aucun corps de fonction ne référence encore document_statut_enum');

-- ── 7. f_fichier_visible (lit statut='genere') reste appelable ──────────────
SELECT lives_ok(
  $$ SELECT shared.f_fichier_visible('plateforme.documents_generaux_savr', gen_random_uuid()) $$,
  'shared.f_fichier_visible reste appelable après le rename');

SELECT * FROM finish();
ROLLBACK;

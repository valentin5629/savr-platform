-- pgTAP — Convergence G1 cluster A (migration 20260623110000)
-- Verrouille la convergence valeurs/type vers le DDL cible :
--   serie_facturation_enum -> sequences_facturation.serie : text
--   job_statut_enum        -> jobs_pdf.statut             : text + CHECK
-- + suppression des 2 types, signatures fonctions en text, index/contrainte.

BEGIN;
SELECT plan(10);

-- ── 1. Colonnes au type cible (text) ───────────────────────────────────────
SELECT col_type_is('plateforme', 'sequences_facturation', 'serie', 'text',
  'sequences_facturation.serie convergé en text');
SELECT col_type_is('plateforme', 'jobs_pdf', 'statut', 'text',
  'jobs_pdf.statut convergé en text');

-- ── 2. Les 2 enums cluster A n'existent plus ───────────────────────────────
SELECT hasnt_type('plateforme', 'serie_facturation_enum',
  'type serie_facturation_enum supprimé');
SELECT hasnt_type('plateforme', 'job_statut_enum',
  'type job_statut_enum supprimé');

-- ── 3. Fonctions de numérotation recréées en signature text ────────────────
SELECT has_function('plateforme', 'f_attribuer_numero_facture',
  ARRAY['text','smallint'], 'f_attribuer_numero_facture(text, smallint) existe');
SELECT has_function('plateforme', 'f_next_numero_facture',
  ARRAY['text','smallint'], 'f_next_numero_facture(text, smallint) existe');

-- ── 4. Index partiels reconstruits (prédicats text valides) ────────────────
SELECT has_index('plateforme', 'jobs_pdf', 'idx_jobs_pdf_anti_dupe',
  'idx_jobs_pdf_anti_dupe présent');
SELECT has_index('plateforme', 'jobs_pdf', 'idx_jobs_pdf_queued',
  'idx_jobs_pdf_queued présent');

-- ── 5. CHECK jobs_pdf : rejette une valeur hors cible, accepte une valeur cible ─
SELECT throws_ok(
  $$ INSERT INTO plateforme.jobs_pdf (type_document, entity_type, entity_id, payload, statut)
     VALUES ('bordereau-zd', 'bordereaux_savr', '00000000-0000-0000-0000-0000000000a1', '{}'::jsonb, 'queued') $$,
  '23514',
  NULL,
  'CHECK jobs_pdf_statut_check rejette une valeur héritée hors cible (queued)'
);
SELECT lives_ok(
  $$ INSERT INTO plateforme.jobs_pdf (type_document, entity_type, entity_id, payload)
     VALUES ('bordereau-zd', 'bordereaux_savr', '00000000-0000-0000-0000-0000000000a2', '{}'::jsonb) $$,
  'INSERT sans statut applique le DEFAULT pending (valeur cible) sans violer la CHECK'
);

SELECT * FROM finish();
ROLLBACK;

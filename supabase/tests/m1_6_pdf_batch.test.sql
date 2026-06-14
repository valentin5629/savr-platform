-- pgTAP M1.6 — Génération PDF ZD
-- Tests : f_next_numero_bordereau gapless, f_upsert_alerte_admin dédup,
--         migration schema (enums, colonnes), RLS alertes_admin.

BEGIN;
SELECT plan(14);

-- ── 1. Enums présents ─────────────────────────────────────────────────────

SELECT has_type('plateforme', 'genere_par', 'enum genere_par existe');
SELECT has_type('plateforme', 'bordereau_statut', 'enum bordereau_statut existe');

-- ── 2. Colonnes bordereaux_savr ───────────────────────────────────────────

SELECT has_column('plateforme', 'bordereaux_savr', 'numero',                   'col numero');
SELECT has_column('plateforme', 'bordereaux_savr', 'producteur_raison_sociale','col producteur_raison_sociale');
SELECT has_column('plateforme', 'bordereaux_savr', 'detail_flux',              'col detail_flux');
SELECT has_column('plateforme', 'rapports_rse',    'genere_par',               'col genere_par sur rapports_rse');

-- ── 3. Table alertes_admin ────────────────────────────────────────────────

SELECT has_table('plateforme', 'alertes_admin', 'table alertes_admin existe');

-- ── 4. f_next_numero_bordereau — séquence gapless ────────────────────────

-- Nettoyer la séquence de test
DELETE FROM plateforme.sequences_facturation WHERE serie = 'BSAV' AND annee = 2099;

SELECT is(
  plateforme.f_next_numero_bordereau(2099),
  'BSAV-2099-00001',
  'premier numéro BSAV-2099-00001'
);

SELECT is(
  plateforme.f_next_numero_bordereau(2099),
  'BSAV-2099-00002',
  'deuxième numéro BSAV-2099-00002 (gapless)'
);

SELECT is(
  plateforme.f_next_numero_bordereau(2099),
  'BSAV-2099-00003',
  'troisième numéro BSAV-2099-00003'
);

-- Nettoyage
DELETE FROM plateforme.sequences_facturation WHERE serie = 'BSAV' AND annee = 2099;

-- ── 5. f_upsert_alerte_admin — déduplication ─────────────────────────────

-- Insérer deux fois la même alerte → une seule ligne ouverte
SELECT plateforme.f_upsert_alerte_admin(
  'test_dedup', 'Titre test', 'Message', 'collectes', gen_random_uuid()
);

-- Capturer l'entity_id utilisé
DO $$
DECLARE
  v_entity_id uuid;
BEGIN
  SELECT entity_id INTO v_entity_id
  FROM plateforme.alertes_admin
  WHERE code = 'test_dedup'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Second appel avec le même entity_id → doit être ignoré
  PERFORM plateforme.f_upsert_alerte_admin(
    'test_dedup', 'Titre test', 'Message bis', 'collectes', v_entity_id
  );
END $$;

SELECT is(
  (SELECT COUNT(*)::integer FROM plateforme.alertes_admin
   WHERE code = 'test_dedup' AND statut = 'ouverte'),
  1,
  'f_upsert_alerte_admin dédup : 1 seule alerte ouverte pour le même (code, entity)'
);

-- Nettoyage
DELETE FROM plateforme.alertes_admin WHERE code = 'test_dedup';

-- ── 6. RLS alertes_admin — admin voit tout ───────────────────────────────

SELECT policies_are(
  'plateforme',
  'alertes_admin',
  ARRAY['aa_admin'],
  'alertes_admin a la policy aa_admin'
);

-- ── 7. jobs_pdf — colonnes renommées présentes ───────────────────────────

SELECT has_column('plateforme', 'jobs_pdf', 'attempts',      'col attempts (ex tentatives)');
SELECT has_column('plateforme', 'jobs_pdf', 'next_retry_at', 'col next_retry_at (ex prochaine_tentative_at)');
SELECT has_column('plateforme', 'jobs_pdf', 'payload',       'col payload ajoutée');

SELECT * FROM finish();
ROLLBACK;

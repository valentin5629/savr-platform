-- =============================================================================
-- shared.fichiers : un fichier vivant au plus par objet (bucket, clé)
-- =============================================================================
-- Migration : 20261113120000_shared_fichiers_cle_unique.sql
-- Constat du 2026-11-13 : deux relèves MTS-1 simultanées enregistraient deux
-- fois la même photo. L'index refuse le second enregistrement (23505), que la
-- relève lit comme « déjà là ».
-- =============================================================================

BEGIN;
SELECT plan(5);

SELECT has_index('shared', 'fichiers', 'uniq_fichiers_objet_vivant',
  '1 l''index uniq_fichiers_objet_vivant existe');

INSERT INTO shared.fichiers (id, storage_provider, bucket, key, size_bytes, content_type, entity_type, entity_id)
VALUES ('0b1e0001-0000-0000-0000-000000000001', 'r2', 'savr-test',
        'photos/collectes/test/empreinte-a.jpg', 10, 'image/jpeg',
        'plateforme.collectes', '0b1e0000-0000-0000-0000-000000000001');

SELECT throws_ok($$INSERT INTO shared.fichiers (storage_provider, bucket, key, size_bytes, content_type, entity_type, entity_id)
  VALUES ('r2', 'savr-test', 'photos/collectes/test/empreinte-a.jpg', 10, 'image/jpeg',
          'plateforme.collectes', '0b1e0000-0000-0000-0000-000000000001')$$,
  '23505', NULL, '2 un second fichier vivant sur la même clé est refusé');

SELECT lives_ok($$INSERT INTO shared.fichiers (storage_provider, bucket, key, size_bytes, content_type, entity_type, entity_id)
  VALUES ('r2', 'savr-test', 'photos/collectes/test/empreinte-b.jpg', 10, 'image/jpeg',
          'plateforme.collectes', '0b1e0000-0000-0000-0000-000000000001')$$,
  '3 une autre clé passe');

UPDATE shared.fichiers SET deleted_at = now()
 WHERE id = '0b1e0001-0000-0000-0000-000000000001';

SELECT lives_ok($$INSERT INTO shared.fichiers (storage_provider, bucket, key, size_bytes, content_type, entity_type, entity_id)
  VALUES ('r2', 'savr-test', 'photos/collectes/test/empreinte-a.jpg', 10, 'image/jpeg',
          'plateforme.collectes', '0b1e0000-0000-0000-0000-000000000001')$$,
  '4 une ligne supprimée ne bloque pas un nouvel enregistrement de la clé');

SELECT is(
  (SELECT count(*)::int FROM shared.fichiers
    WHERE key = 'photos/collectes/test/empreinte-a.jpg' AND deleted_at IS NULL),
  1, '5 une seule ligne vivante pour la clé');

SELECT * FROM finish();
ROLLBACK;

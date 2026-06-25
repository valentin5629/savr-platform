-- pgTAP — Garde de persistance de l'acceptation des CGU (R6 / BL-P0-04).
--
-- Contexte : /api/auth/signup recevait `acceptation_cgu`, le contrôlait comme
-- garde PUIS le jetait → aucune preuve opposable (CGU Art. 11/22). Le fix ajoute
-- plateforme.users.cgu_accepte_le (timestamptz) + cgu_version (text), écrits à la
-- création du compte par la route.
--
-- Ce garde prouve, sur la base réelle (rôle postgres → RLS bypass), que :
--   1. les colonnes cgu_accepte_le / cgu_version existent et ont le bon type ;
--   2. un INSERT users avec ces colonnes persiste des valeurs NON NULL
--      (= ce que la route écrit) → la trace d'acceptation est récupérable.

BEGIN;
SELECT plan(6);

-- 1. Les colonnes écrites par signup existent.
SELECT has_column('plateforme', 'users', 'cgu_accepte_le',
  'users.cgu_accepte_le existe');
SELECT has_column('plateforme', 'users', 'cgu_version',
  'users.cgu_version existe');

-- 2. Types attendus (horodatage + version texte).
SELECT col_type_is('plateforme', 'users', 'cgu_accepte_le',
  'timestamp with time zone', 'users.cgu_accepte_le = timestamptz');
SELECT col_type_is('plateforme', 'users', 'cgu_version', 'text',
  'users.cgu_version = text');

-- Fixture minimale : 1 organisation + 1 user portant la trace d'acceptation.
INSERT INTO plateforme.organisations (id, nom, raison_sociale, type)
VALUES ('c6c00001-0000-0000-0000-000000000001'::uuid,
        'Org CGU Test', 'Org CGU Test', 'traiteur');

INSERT INTO plateforme.users
  (id, organisation_id, email, prenom, nom, role, cgu_accepte_le, cgu_version)
VALUES ('05ec6001-0000-0000-0000-000000000001'::uuid,
        'c6c00001-0000-0000-0000-000000000001'::uuid,
        'cgu@savr.test', 'Jean', 'D', 'traiteur_manager', now(), 'v1');

-- 3. La trace d'acceptation est persistée NON NULL (preuve opposable récupérable).
SELECT isnt(
  (SELECT cgu_accepte_le FROM plateforme.users WHERE email = 'cgu@savr.test'),
  NULL,
  'users.cgu_accepte_le persisté NON NULL (horodatage acceptation)'
);
SELECT is(
  (SELECT cgu_version FROM plateforme.users WHERE email = 'cgu@savr.test'),
  'v1',
  'users.cgu_version persisté (version du texte acceptée)'
);

SELECT * FROM finish();
ROLLBACK;

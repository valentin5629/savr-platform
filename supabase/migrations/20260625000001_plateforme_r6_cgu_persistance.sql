-- =============================================================================
-- R6 / BL-P0-04 — Persistance de l'acceptation des CGU (preuve opposable)
-- =============================================================================
-- La route /api/auth/signup recevait `acceptation_cgu` (booléen), le contrôlait
-- comme garde (422 si absent) PUIS le JETAIT : aucune trace n'était persistée.
-- Or les CGU (CGU Savr V1 Draft) prévoient que « le Contrat prend effet à compter
-- de la création du Compte Utilisateur, qui vaut acceptation des présentes CGU »
-- (Art. 11) et que cette acceptation « constitue un document original faisant foi
-- entre les Parties jusqu'à preuve contraire » (Art. 22 — convention sur la preuve).
-- Sans horodatage ni version stockés, Savr n'a aucune preuve opposable de quelle
-- version des CGU a été acceptée ni quand.
--
-- Ajoute sur plateforme.users :
--   · cgu_accepte_le (timestamptz) — instant d'acceptation (= création du compte) ;
--   · cgu_version    (text)        — version du texte CGU acceptée
--                                    (constante CGU_VERSION_COURANTE, cf.
--                                     packages/plateforme/src/lib/cgu.ts).
--
-- V1 = une seule acceptation à la création (les CGU ne prévoient PAS de
-- ré-acceptation à chaque nouvelle version) → 2 colonnes suffisent, pas de table
-- d'historique multi-versions.
--
-- NULLABLE : les comptes existants/migrés (Bubble) sans trace d'acceptation
-- restent valides avec cgu_accepte_le/cgu_version = NULL ; aucun rétro-remplissage
-- (le CDC ne l'exige pas). Add column nullable = migration non destructive
-- (CLAUDE.md §2). Les GRANT existants au niveau table couvrent les colonnes
-- ajoutées (pas de GRANT colonne en place → inutile de re-grant).
--
-- Colonnes PERMANENTES (preuve légale) → convergent dans le DDL cible V2
-- (divergence clair _Divergences/M0.4_20260625.md) ; NON allowlistées V1-only.
-- =============================================================================

ALTER TABLE plateforme.users
  ADD COLUMN IF NOT EXISTS cgu_accepte_le timestamptz;

ALTER TABLE plateforme.users
  ADD COLUMN IF NOT EXISTS cgu_version text;

COMMENT ON COLUMN plateforme.users.cgu_accepte_le IS
  'Horodatage de l''acceptation des CGU (= création du compte, CGU Art. 11/22 — preuve opposable). NULL pour les comptes migrés sans trace (BL-P0-04).';
COMMENT ON COLUMN plateforme.users.cgu_version IS
  'Version du texte CGU acceptée à la création du compte (CGU_VERSION_COURANTE). NULL pour les comptes migrés sans trace (BL-P0-04).';

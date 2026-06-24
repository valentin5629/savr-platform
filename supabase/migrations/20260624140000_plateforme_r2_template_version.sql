-- =============================================================================
-- R2 / BL-P1-API-07 — Versioning des templates PDF (re-rendu iso traçable)
-- =============================================================================
-- Ajoute `template_version` (text, NULLABLE → backward-compatible) sur les trois
-- entités porteuses d'un PDF généré. Le worker PDF (pdf-worker.ts) y écrit la
-- constante TEMPLATE_VERSIONS[type] du contrat partagé
-- (@savr/shared/src/pdf/document-types.ts) à chaque rendu. Un re-rendu ultérieur
-- avec la même version garantit un gabarit identique (preuve fiscale/réglementaire
-- reproductible).
--
-- NULLABLE : les lignes existantes (rendues avant ce lot) restent valides avec
-- template_version = NULL ; aucune réécriture rétroactive (les PDF déjà émis ne
-- sont pas re-rendus). Add column nullable = migration non destructive (CLAUDE.md §2).
-- Les GRANT existants au niveau table couvrent les colonnes ajoutées (pas de GRANT
-- colonne en place → inutile de re-grant).
-- =============================================================================

ALTER TABLE plateforme.bordereaux_savr
  ADD COLUMN IF NOT EXISTS template_version text;

ALTER TABLE plateforme.rapports_rse
  ADD COLUMN IF NOT EXISTS template_version text;

ALTER TABLE plateforme.attestations_don
  ADD COLUMN IF NOT EXISTS template_version text;

COMMENT ON COLUMN plateforme.bordereaux_savr.template_version IS
  'Version figée du gabarit PDF utilisé (TEMPLATE_VERSIONS, ex. bordereau-zd@1) — re-rendu iso (BL-P1-API-07).';
COMMENT ON COLUMN plateforme.rapports_rse.template_version IS
  'Version figée du gabarit PDF utilisé (TEMPLATE_VERSIONS, ex. rapport-recyclage-zd@1) — re-rendu iso (BL-P1-API-07).';
COMMENT ON COLUMN plateforme.attestations_don.template_version IS
  'Version figée du gabarit PDF utilisé (TEMPLATE_VERSIONS, ex. attestation-don@1) — re-rendu iso (BL-P1-API-07).';

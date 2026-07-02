-- R17b (décision Val 2026-07-02) — nouveaux champs référentiel demandés à la revue
-- visuelle du lot R17 sous-lot 1 (formulaires association / transporteur).
--
-- Associations (BL-P1-BOA-01) :
--   - logo_url                        : logo de l'asso (affiché rapports AG), non oblig.
--   - instructions_acces              : « Instructions d'accès (pour le transporteur) », non oblig.
--   - siren                           : SIREN INSEE, NON obligatoire (arbitrage Val — le CDC
--                                       le disait « Oui », Val tranche « non obligatoire »).
--   - date_expiration_habilitation    : date d'expiration de l'habilitation 2041-GE (CDC
--                                       « booléen + date expiration »), non oblig.
-- Transporteurs (BL-P1-BOA-02) :
--   - types_collecte text[]           : flux gérés — 'anti_gaspi' et/ou 'zero_dechet' (multi,
--                                       arbitrage Val — un transporteur peut faire les deux).
--   - description_process_collecte    : texte libre (ex-champ fusionné 2026-05-08, ré-ajouté
--                                       à la demande Val — process de création de collecte).
--
-- Frontière garde-fou 1 : ces colonnes sont AJOUTÉES aussi au DDL cible V2
-- (specs/ddl-cible/schema_cible_v2.sql) → V1 ⊆ cible préservé (gate schema-vs-cible).

-- ── associations ────────────────────────────────────────────────────────────
ALTER TABLE plateforme.associations
  ADD COLUMN IF NOT EXISTS logo_url                     text,
  ADD COLUMN IF NOT EXISTS instructions_acces           text,
  ADD COLUMN IF NOT EXISTS siren                        text,
  ADD COLUMN IF NOT EXISTS date_expiration_habilitation date;

-- SIREN nullable mais, si fourni, 9 chiffres (validation INSEE). CHECK tolérant au NULL.
DO $$ BEGIN
  ALTER TABLE plateforme.associations
    ADD CONSTRAINT chk_associations_siren
    CHECK (siren IS NULL OR siren ~ '^[0-9]{9}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── transporteurs ───────────────────────────────────────────────────────────
ALTER TABLE plateforme.transporteurs
  ADD COLUMN IF NOT EXISTS types_collecte             text[],
  ADD COLUMN IF NOT EXISTS description_process_collecte text;

-- ── Défense en profondeur : édition admin-only (CDC §5 associations l.425-426) ─
-- SIREN + habilitation (booléen + date d'expiration) = admin only ; ops ne peut pas
-- les modifier. Le trigger r10b (fn_ops_block_column_change) est étendu aux 2
-- nouvelles colonnes admin-only (siren, date_expiration_habilitation).
DROP TRIGGER IF EXISTS trg_ops_immutable_cols ON plateforme.associations;
CREATE TRIGGER trg_ops_immutable_cols
  BEFORE UPDATE ON plateforme.associations
  FOR EACH ROW
  EXECUTE FUNCTION plateforme.fn_ops_block_column_change(
    'habilitee_attestation_fiscale', 'actif', 'siren', 'date_expiration_habilitation');

-- associations.numero_rup — source de l'instantané `attestations_don.association_numero_rup`.
--
-- CDC §04 Data Model table `associations` (ajout 2026-09-14, arbitrage Val, divergence
-- M2.4 `numero-rup-source`, sync specs #296) + §06.06 §5 Associations l.422.
--
-- Contexte : `attestations_don.association_numero_rup` (migration 20260615250000) était
-- défini SANS colonne source côté `associations`. Le batch AG hardcodait donc `null`
-- (packages/plateforme/src/lib/pdf/batch-pdf-j1-ag.ts) et la mention RUP n'apparaissait
-- jamais sur le Cerfa 2041-GE. Val tranche : la source est saisie dans la modale
-- association du back-office Admin, facultative, édition admin-only.
--
-- Non destructif : ADD COLUMN nullable, sans défaut, sans backfill. N'ouvre ni n'élargit
-- aucun accès (CLAUDE.md §12-2bis) : aucun GRANT, aucune policy, la colonne hérite du
-- GRANT table-level existant sur `plateforme.associations`.
--
-- Frontière garde-fou 1 (CLAUDE.md §3bis-1) : la colonne vient du CDC §04, elle a donc
-- vocation à figurer au DDL cible V2 — mais `specs/ddl-cible/schema_cible_v2.sql` est un
-- fichier DÉRIVÉ du Vault, non régénéré au sync #296. Divergence tracée
-- (_Divergences/M2.4_20260914.md, type `clair`) : G6 signalera la colonne tant que le
-- DDL cible n'est pas régénéré. Volontairement PAS ajoutée à
-- `specs/ddl-cible/v1-divergences-allowlist.txt` : ce n'est pas une divergence V1-only
-- assumée, c'est un dérivé en retard.

ALTER TABLE plateforme.associations
  ADD COLUMN IF NOT EXISTS numero_rup text;

COMMENT ON COLUMN plateforme.associations.numero_rup IS
  'N° RUP (Reconnue d''Utilité Publique), facultatif. Source de l''instantané '
  'attestations_don.association_numero_rup. Édition admin-only (trg_ops_immutable_cols).';

-- ── Défense en profondeur : édition admin-only (CDC §06.06 §5 « Édition admin-only ») ──
-- Le filtre ADMIN_FIELDS de la route PATCH est la 1re barrière ; ce trigger est la
-- seconde (ops_savr écrivant via PostgREST direct). Recréation à l'identique + numero_rup
-- (fn_ops_block_column_change prend la liste en arguments — cf. 20260629120000 / 20260702020100).
DROP TRIGGER IF EXISTS trg_ops_immutable_cols ON plateforme.associations;
CREATE TRIGGER trg_ops_immutable_cols
  BEFORE UPDATE ON plateforme.associations
  FOR EACH ROW
  EXECUTE FUNCTION plateforme.fn_ops_block_column_change(
    'habilitee_attestation_fiscale', 'actif', 'siren',
    'date_expiration_habilitation', 'numero_rup');

-- ROLLBACK (additif — aucune donnée touchée) : retirer la colonne `numero_rup`
-- (opération inverse de l'ADD COLUMN ci-dessus), puis recréer
-- trg_ops_immutable_cols sans l'argument 'numero_rup' (cf. 20260702020100).
-- SQL de rollback volontairement non littéral : le garde CI anti-destructif du
-- job `migrations` est un grep textuel qui ne distingue pas le commentaire du
-- code exécuté. Cette migration n'exécute qu'un ADD COLUMN nullable.

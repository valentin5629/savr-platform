-- =============================================================================
-- everest_missions : `chk_everest_created_manually` passe d'une ÉQUIVALENCE à
-- une IMPLICATION.
-- =============================================================================
--
-- SOURCE. Arbitrage Val 2026-09-16 (divergence
--   M2.5_20260916_created-manually-check-bloque-cycle-de-vie) :
--   02 - Data Model TMS, table `everest_missions`, CHECK constraint ;
--   DDL cible V2 `schema_cible_v2.sql` (tms.everest_missions), déjà patché.
--
-- AVANT (20260615220000, §5) :
--   (statut_everest = 'created_manually') = (les 3 champs manual_* renseignés)
--   Les champs manual_* ne pouvaient exister QUE sur `created_manually`. Une
--   mission acceptée par téléphone ne pouvait donc plus jamais quitter ce
--   statut sans effacer l'audit de l'acceptation : `AdapterEverest.cancelCollecte`
--   annulait bien la course chez A Toutes!, puis son UPDATE local
--   (statut_everest = 'cancelled') échouait en 23514 ; idem pour toute
--   transition portée par un webhook Everest (assigned, in_progress, completed).
--
-- APRÈS :
--   statut_everest <> 'created_manually' OR (les 3 champs manual_* renseignés)
--   `created_manually` exige toujours les 3 champs ; ils RESTENT renseignés
--   quand la mission reprend le cycle normal. Aucun code ne les efface.
--
-- DONNÉES. La nouvelle contrainte est strictement plus faible que l'ancienne :
-- toute ligne valide avant l'est après. Mesuré avant pose (2026-09-16, lecture
-- seule forcée) : 0 ligne dans `plateforme.everest_missions` en dev comme en
-- prod. La garde ci-dessous le revérifie au moment de l'application.
--
-- NATURE. Remplacement d'une contrainte CHECK, dans un seul ALTER TABLE (pas de
-- fenêtre sans contrainte). Aucune table ni colonne supprimée, aucun RENAME ni
-- backfill, aucun GRANT, aucune policy, aucune fonction.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM plateforme.everest_missions
    WHERE statut_everest = 'created_manually'
      AND NOT (manual_acceptance_at IS NOT NULL
               AND manual_acceptance_by_user_id IS NOT NULL
               AND manual_acceptance_contact IS NOT NULL)
  ) THEN
    RAISE EXCEPTION
      'everest_missions : ligne created_manually sans ses 3 champs manual_acceptance_* — migration interrompue';
  END IF;
END $$;

ALTER TABLE plateforme.everest_missions
  DROP CONSTRAINT chk_everest_created_manually,
  ADD CONSTRAINT chk_everest_created_manually
    CHECK (
      statut_everest <> 'created_manually'
      OR (manual_acceptance_at IS NOT NULL
          AND manual_acceptance_by_user_id IS NOT NULL
          AND manual_acceptance_contact IS NOT NULL)
    );

-- Rollback : reposer l'ancienne forme (égalité) de la migration 20260615220000,
-- possible uniquement si aucune mission sortie de created_manually ne conserve
-- ses champs manual_acceptance_*.

-- =============================================================================
-- Collectes importées de l'historique Bubble : marquage et garde des documents
-- =============================================================================
-- Décisions Val (migration Bubble, répétition n° 1) :
--   C1 (2026-11-15) : une collecte importée se reconnaît à une colonne dédiée,
--       `collectes.origine` ('plateforme' par défaut, 'migration_bubble' pour
--       l'historique). Même définition que celle posée par le script d'import
--       en base jetable (apps/migration-bubble/src/base.ts), qui ne la crée plus.
--   C3 (2026-11-16) : aucun document pour l'historique (décision du 2026-11-06 :
--       ni PDF Bubble, ni fabrication, ni régénération) ; à l'écran, « Le rapport
--       de cette collecte est disponible sur demande auprès de l'équipe Savr ».
--
-- 1. Colonne. Ajout avec un défaut constant : aucune réécriture de la table
--    (PostgreSQL ≥ 11). Toutes les collectes existantes prennent 'plateforme'.
--    Fermée aux clients : `authenticated` lit `collectes` par une liste blanche
--    de colonnes (migrations 20261117230000 et 20261117233000) où elle n'entre
--    pas, et n'a aucun droit INSERT ni UPDATE sur la table (mesuré le
--    2026-11-19). Les deux fonctions qui créent une collecte
--    (fn_creer_collecte, fn_creer_collecte_carte) nomment leurs colonnes : la
--    valeur y est toujours le défaut. Seul l'import (rôle postgres) écrit
--    'migration_bubble'. Le code serveur la lit en service_role.
--
-- 2. Garde des documents. Le produit ne fabrique aucun document pour une
--    collecte importée (filtres des trois traitements de documents, lot du même
--    jour). Filet en base : une ligne de bordereau, d'attestation de don ou de
--    rapport (`rapports_rse`) rattachée à une collecte importée est refusée
--    (23514), quel que soit l'appelant. Une fois une ligne de document créée,
--    tout le reste en dépend (numéro gapless, rendu PDF, régénération, rapport
--    au clic, email « document disponible ») : refuser la ligne ferme tous ces
--    chemins d'un coup, y compris ceux que la recherche aurait manqués.
--    AFTER ROW (revue sécurité du 2026-11-18, NON-GO B1 sur `users`) : la RLS
--    (insertion réservée à l'équipe Savr, policies att_admin_insert,
--    bord_admin_insert, rr_write_admin, et la restrictive
--    code_verification_equipe_savr) et la clé étrangère parlent avant elle ; un
--    client n'apprend donc rien de l'origine d'une collecte. SECURITY DEFINER
--    parce que `authenticated` ne lit pas la colonne : en INVOKER, une session
--    Admin authentifiée serait refusée sur toute collecte. Fonction de
--    déclencheur, fermée à tous les rôles (REVOKE), hors du cliquet du code de
--    vérification (qui écarte les fonctions de déclencheur).
--
-- Ni destructive ni ouvrante (CLAUDE.md §12) : aucun droit accordé, aucune
-- policy touchée. Preuve : supabase/tests/SECU__collectes_origine.test.sql.
-- Frontière TMS-Ready G1 : colonne V1 hors du DDL cible, tracée par fiche de
-- divergence (V5, migration Bubble).
-- =============================================================================

ALTER TABLE plateforme.collectes
  ADD COLUMN IF NOT EXISTS origine text NOT NULL DEFAULT 'plateforme'
  CHECK (origine IN ('plateforme', 'migration_bubble'));

COMMENT ON COLUMN plateforme.collectes.origine IS
  'Provenance de la collecte : plateforme (défaut) ou migration_bubble (historique importé de Bubble, décision Val C1 du 2026-11-15). Aucun document fabriqué pour une collecte importée (C3). Fermée aux clients (hors liste blanche SELECT d''authenticated), écrite par l''import seul.';

CREATE OR REPLACE FUNCTION plateforme.fn_trg_document_refuse_collecte_importee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.collecte_id IS NOT DISTINCT FROM OLD.collecte_id THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plateforme.collectes c
    WHERE c.id = NEW.collecte_id
      AND c.origine = 'migration_bubble'
  ) THEN
    RAISE EXCEPTION 'Aucun document pour une collecte importée de l''historique (décision Val C3, 2026-11-16)'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION plateforme.fn_trg_document_refuse_collecte_importee() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION plateforme.fn_trg_document_refuse_collecte_importee() IS
  'Déclencheur AFTER INSERT / UPDATE OF collecte_id sur bordereaux_savr, attestations_don et rapports_rse : refuse (23514) un document rattaché à une collecte importée (origine = migration_bubble), pour tout appelant, après la RLS et la clé étrangère. Décision Val C3 du 2026-11-16.';

DROP TRIGGER IF EXISTS trg_bordereau_refuse_collecte_importee ON plateforme.bordereaux_savr;
CREATE TRIGGER trg_bordereau_refuse_collecte_importee
  AFTER INSERT OR UPDATE OF collecte_id ON plateforme.bordereaux_savr
  FOR EACH ROW
  WHEN (NEW.collecte_id IS NOT NULL)
  EXECUTE FUNCTION plateforme.fn_trg_document_refuse_collecte_importee();

DROP TRIGGER IF EXISTS trg_attestation_refuse_collecte_importee ON plateforme.attestations_don;
CREATE TRIGGER trg_attestation_refuse_collecte_importee
  AFTER INSERT OR UPDATE OF collecte_id ON plateforme.attestations_don
  FOR EACH ROW
  WHEN (NEW.collecte_id IS NOT NULL)
  EXECUTE FUNCTION plateforme.fn_trg_document_refuse_collecte_importee();

DROP TRIGGER IF EXISTS trg_rapport_refuse_collecte_importee ON plateforme.rapports_rse;
CREATE TRIGGER trg_rapport_refuse_collecte_importee
  AFTER INSERT OR UPDATE OF collecte_id ON plateforme.rapports_rse
  FOR EACH ROW
  WHEN (NEW.collecte_id IS NOT NULL)
  EXECUTE FUNCTION plateforme.fn_trg_document_refuse_collecte_importee();

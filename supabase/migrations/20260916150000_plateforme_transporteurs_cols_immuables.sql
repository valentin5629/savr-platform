-- =============================================================================
-- transporteurs : `type_tms` et `prestataire_logistique_id` IMMUABLES après
-- création ; DELETE refusé dès qu'une tournée référence le transporteur.
-- =============================================================================
--
-- SOURCE. Arbitrage Val 2026-09-16 (divergence M1.1b_20260916, archivée) :
--   04 - Data Model, table `transporteurs`, colonnes `type_tms` et
--   `prestataire_logistique_id` ; 06.06 Back-office Admin §6, encadré
--   « Immuabilité ». Ces deux colonnes sont posées à la création et jamais
--   modifiables, quel que soit le rôle et le chemin (écran, PostgREST, SQL).
--   Pour changer l'un ou l'autre : créer un nouveau transporteur.
--
-- POURQUOI UN TRIGGER. `admin_savr` et `ops_savr` écrivent la table par
-- PostgREST (policies transp_admin / transp_ops_write) : retirer les champs du
-- PATCH ne ferme que l'écran.
--
-- CE QUE L'IMMUABILITÉ ÉVITE. Les adapters reconnaissent les tournées d'un
-- provider par `tournees.prestataire_logistique_id` → transporteur → `type_tms`
-- (#313, #323, #327). Repointer le prestataire, ou changer le type, rend les
-- E2/E3 des collectes en cours silencieuses (`noop_no_remote` marqué `done`),
-- casse le rapprochement des pesées MTS-1 et, pour `type_tms`, rouvre la fuite
-- inter-provider.
--
-- NULL → VALEUR REFUSÉ AUSSI. « Posées à la création » : aucun rattachement
-- tardif. Mesuré avant pose (2026-09-16, lecture seule forcée) :
--   prod : 1 transporteur (A Toutes!, a_toutes), lien posé ;
--   dev  : 5 transporteurs, 4 liés ; le 5e (« Presta sans code », mts1) est la
--          fixture NÉGATIVE volontaire de `seed_demo`, réécrite à l'identique.
-- Aucune ligne réelle n'attend donc un rattachement.
--
-- CE QUI RESTE LIBRE. Tout le reste, dont `actif` (désactiver est le geste Ops
-- normal). Une mise à jour qui réécrit la MÊME valeur passe (IS DISTINCT FROM) :
-- les seeds upsertent le référentiel. TRUNCATE (reset dev) ne déclenche pas les
-- triggers de ligne.
--
-- DELETE. Refusé si une tournée porte le prestataire du transporteur : la
-- suppression orphelinerait ces tournées (plus de `type_tms` pour les résoudre).
-- Un transporteur sans prestataire n'est référencé par aucune tournée.
-- SECURITY DEFINER : le décompte ne doit pas dépendre de ce que les policies de
-- `tournees` laissent voir à l'appelant (fail-open sinon). EXECUTE retiré à tous
-- (P0 #263) — un trigger s'exécute sans ce droit, le pgTAP le prouve sous
-- `authenticated`.
--
-- NATURE. Fermante et non destructive : aucun DROP de table ou de colonne, aucun
-- RENAME ni backfill, aucun GRANT,
-- aucune policy ; seule fonction SECURITY DEFINER = celle du DELETE, fermée.
-- =============================================================================

-- ─── 1. Immuabilité des deux colonnes (UPDATE) ───────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.fn_trg_transporteur_cols_immuables()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.type_tms IS DISTINCT FROM OLD.type_tms THEN
    RAISE EXCEPTION
      'transporteurs.type_tms est immuable après création — créez un nouveau transporteur'
      USING ERRCODE = 'P0045';
  END IF;
  IF NEW.prestataire_logistique_id IS DISTINCT FROM OLD.prestataire_logistique_id THEN
    RAISE EXCEPTION
      'transporteurs.prestataire_logistique_id est immuable après création — créez un nouveau transporteur'
      USING ERRCODE = 'P0045';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_trg_transporteur_cols_immuables()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_transporteur_cols_immuables ON plateforme.transporteurs;
CREATE TRIGGER trg_transporteur_cols_immuables
  BEFORE UPDATE ON plateforme.transporteurs
  FOR EACH ROW
  EXECUTE FUNCTION plateforme.fn_trg_transporteur_cols_immuables();

-- ─── 2. DELETE refusé sous tournées ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.fn_trg_transporteur_delete_sous_tournees()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.prestataire_logistique_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM plateforme.tournees t
     WHERE t.prestataire_logistique_id = OLD.prestataire_logistique_id
  ) THEN
    RAISE EXCEPTION
      'transporteur référencé par des tournées : suppression refusée — désactivez-le (actif = false)'
      USING ERRCODE = 'P0046';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_trg_transporteur_delete_sous_tournees()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_transporteur_delete_sous_tournees ON plateforme.transporteurs;
CREATE TRIGGER trg_transporteur_delete_sous_tournees
  BEFORE DELETE ON plateforme.transporteurs
  FOR EACH ROW
  EXECUTE FUNCTION plateforme.fn_trg_transporteur_delete_sous_tournees();

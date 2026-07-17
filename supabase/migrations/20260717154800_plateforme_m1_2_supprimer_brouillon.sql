-- =============================================================================
-- M1.2 — Suppression d'un brouillon (§06.01 l.309 « Suppression manuelle par
-- l'utilisateur ("Supprimer ce brouillon") »)
-- RPC : fn_supprimer_brouillon
-- =============================================================================

-- ─── RPC : fn_supprimer_brouillon ────────────────────────────────────────────
-- Supprime un événement brouillon ET ses collectes, atomiquement.
--
-- Pourquoi une RPC alors que la route faisait `DELETE FROM evenements` :
--  1. AUCUNE FK vers `evenements` n'est ON DELETE CASCADE (`confdeltype='a'` sur
--     `collectes_evenement_id_fkey` ET `rapports_rse_evenement_id_fkey`, dans les
--     migrations comme dans le DDL cible V2). Le DELETE seul violait donc la FK →
--     500 systématique dès qu'un brouillon avait au moins une collecte, c'est-à-dire
--     TOUS les brouillons réels (la programmation crée événement + collectes d'une
--     seule passe). Le bouton « Supprimer ce brouillon » n'a jamais fonctionné, pour
--     aucun rôle. Le commentaire de la route qui invoquait un ON DELETE CASCADE
--     décrivait une contrainte inexistante.
--  2. La garde « brouillon uniquement » vivait dans la route, en deux allers-retours
--     (SELECT des statuts puis DELETE) : fenêtre TOCTOU, et surtout `collectes?.some()`
--     valait `undefined` si le SELECT échouait → garde franchie (fail-open). Ici la
--     garde et la suppression sont dans la même transaction, sous le row lock.
--
-- On ne pose PAS d'ON DELETE CASCADE sur la FK : le DDL cible V2 n'en a pas
-- (garde-fou G1, data model V1 ⊆ cible) et un cascade combiné à une garde fail-open
-- transformerait le moindre défaut amont en suppression silencieuse de collectes
-- confirmées et de leurs rapports_rse.
--
-- Pas d'event outbox : un brouillon n'a jamais été dispatché (statut_tms='non_envoye',
-- E1 n'est émis qu'à la confirmation) → rien à annuler côté TMS, pas de E3. G4 sans objet.

CREATE OR REPLACE FUNCTION plateforme.fn_supprimer_brouillon(
  p_evenement_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_non_brouillon int;
BEGIN
  -- Lock agrégat AVANT toute lecture de garde (concurrence : sans lui, une
  -- confirmation concurrente pourrait passer entre la garde et le DELETE).
  PERFORM id FROM plateforme.evenements WHERE id = p_evenement_id FOR UPDATE;

  -- Garde §06.01 : suppression réservée au brouillon. Une collecte confirmée
  -- s'ANNULE, elle ne se supprime pas.
  SELECT count(*) INTO v_non_brouillon
  FROM plateforme.collectes
  WHERE evenement_id = p_evenement_id
    AND statut <> 'brouillon';

  IF v_non_brouillon > 0 THEN
    RAISE EXCEPTION 'Des collectes sont déjà confirmées'
      USING ERRCODE = '22023'; -- → 422 via typedRpcError
  END IF;

  DELETE FROM plateforme.collectes WHERE evenement_id = p_evenement_id;
  DELETE FROM plateforme.evenements WHERE id = p_evenement_id;
END;
$$;

-- Appelée uniquement via createAdminSupabaseClient (service role) — même pattern
-- que fn_confirmer_programmation_brouillon (B1).
REVOKE EXECUTE ON FUNCTION plateforme.fn_supprimer_brouillon(uuid) FROM PUBLIC;
ALTER FUNCTION plateforme.fn_supprimer_brouillon(uuid)
  SET search_path = plateforme, public;

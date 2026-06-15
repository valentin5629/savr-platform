-- M1.8 — Agrégation terminale multi-camions.
-- Comble le gap M1.5c : transition collecte → realisee/rejetee_par_prestataire
-- quand tous les N camions ont un statut terminal (terminee | annulee).
-- Concurrence-sûre : FOR UPDATE sur collectes garantit l'idempotence.

CREATE OR REPLACE FUNCTION plateforme.fn_agreger_terminal_collecte(
  p_collecte_id uuid
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_nb_demande    integer;
  v_nb_terminee   integer;
  v_nb_annulee    integer;
  v_total_term    integer;
BEGIN
  -- Lock la ligne collecte pour garantir l'idempotence concurrente (R5/R6 CLAUDE.md §4)
  SELECT nb_camions_demande
  INTO   v_nb_demande
  FROM   plateforme.collectes
  WHERE  id = p_collecte_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  -- Compter les tournées terminales pour cette collecte
  SELECT
    COUNT(*) FILTER (WHERE t.statut = 'terminee') AS nb_terminee,
    COUNT(*) FILTER (WHERE t.statut = 'annulee')  AS nb_annulee
  INTO v_nb_terminee, v_nb_annulee
  FROM plateforme.collecte_tournees ct
  JOIN plateforme.tournees t ON t.id = ct.tournee_id
  WHERE ct.collecte_id = p_collecte_id;

  v_total_term := COALESCE(v_nb_terminee, 0) + COALESCE(v_nb_annulee, 0);

  -- Pas encore tous terminaux → rien à faire
  IF v_total_term < v_nb_demande THEN
    RETURN 'pending';
  END IF;

  -- Au moins 1 tour OK → realisee (realisee_at figé : embargo H+24 stable)
  IF v_nb_terminee > 0 THEN
    UPDATE plateforme.collectes
    SET
      statut      = 'realisee',
      realisee_at = COALESCE(realisee_at, now())
    WHERE id      = p_collecte_id
      AND statut  IN ('programmee', 'validee', 'en_cours');

    RETURN 'realisee';
  END IF;

  -- Tous annulés → signal 'rejetee_par_prestataire' renvoyé au caller.
  -- On NE touche PAS collectes.statut : 'rejetee_par_prestataire' est absent de
  -- collecte_statut_enum V1 (c'est une valeur de statut_tms_enum).
  -- Le statut_tms a déjà été positionné par processOrder() via MTS1_STATUS_TO_TMS.
  -- (divergence M1.8_20260615 — à trancher avec Val pour V2)
  RETURN 'rejetee_par_prestataire';
END;
$$;

-- Révoque les droits publics ; exécutable uniquement via service_role
REVOKE ALL ON FUNCTION plateforme.fn_agreger_terminal_collecte(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_agreger_terminal_collecte(uuid)
  TO service_role;

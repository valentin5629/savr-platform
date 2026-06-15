-- A1+A2 (M1.8) — Corrige fn_agreger_terminal_collecte maintenant que
-- 'rejetee_par_prestataire' est dans collecte_statut_enum (migration 20260615115900).

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

  -- Tous annulés → rejetee_par_prestataire
  -- 'rejetee_par_prestataire' est dans collecte_statut_enum depuis migration 20260615115900.
  UPDATE plateforme.collectes
  SET statut = 'rejetee_par_prestataire'
  WHERE id   = p_collecte_id
    AND statut NOT IN ('realisee', 'cloturee', 'rejetee_par_prestataire',
                       'realisee_sans_collecte');

  RETURN 'rejetee_par_prestataire';
END;
$$;

-- Droits inchangés (déjà REVOKE PUBLIC + GRANT service_role dans migration 20260615100000)
